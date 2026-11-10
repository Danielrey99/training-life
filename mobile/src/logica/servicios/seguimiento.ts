/**
 * Qué día del plan cuenta cada sesión, y cuándo lo cuenta de verdad. Puerto de
 * `backend/app/seguimiento.py`.
 *
 * `estaCancelada` y `canceladaSql` (y `enCurso` y `enCursoSql`) dicen lo mismo, una en JS
 * y otra para un WHERE: si cambia una regla, cambian las dos.
 */
import type { Contexto } from '../contexto'
import { conflicto } from '../fallos'
import { aOrdinal, desdeOrdinal, lunesDe, sumarDiasSinSalirse } from '../reglas/dias'
import { ordenarPorNombre } from '../reglas/orden'
import type { Condicion } from './comun'
import {
  diasDelPlan,
  enTexto,
  ponerExcepcion,
  resolverDias,
  validarRangoDelPlan,
  type DiaPlan,
} from './plan'
import { porIds, type FilaRutina } from './salidas'

export interface FilaEntrenamiento {
  id: number
  rutina_id: number
  fecha: string
  cubre_fecha: string | null
  notas: string | null
  terminada_en: string | null
  created_at: string
  updated_at: string
}

/** Sin terminar y de hoy: la que se puede continuar (`Entrenamiento.en_curso`). */
export function enCurso(ctx: Contexto, sesion: FilaEntrenamiento): boolean {
  return sesion.terminada_en === null && sesion.fecha === ctx.reloj.hoy()
}

/** `enCurso` para un WHERE sobre `entrenamientos`. */
export function enCursoSql(ctx: Contexto): Condicion {
  return {
    sql: 'entrenamientos.terminada_en IS NULL AND entrenamientos.fecha = ?',
    params: [ctx.reloj.hoy()],
  }
}

/**
 * Una sesión sin ninguna serie que ya no está en curso: no se hizo nada. La que está en
 * curso sí cuenta aunque esté vacía: se acaba de empezar.
 *
 * `vacia` es para quien ya sabe si tiene series; si no, se pregunta a la base.
 */
export function estaCancelada(ctx: Contexto, sesion: FilaEntrenamiento, vacia?: boolean): boolean {
  const sinSeries =
    vacia ??
    ctx.bd.una('SELECT 1 FROM series WHERE entrenamiento_id = ? LIMIT 1', sesion.id) === undefined
  return !enCurso(ctx, sesion) && sinSeries
}

/** `estaCancelada` para un WHERE sobre `entrenamientos`. */
export function canceladaSql(ctx: Contexto): Condicion {
  const enCursoHoy = enCursoSql(ctx)
  return {
    sql:
      'NOT EXISTS (SELECT 1 FROM series WHERE series.entrenamiento_id = entrenamientos.id)' +
      ` AND NOT (${enCursoHoy.sql})`,
    params: enCursoHoy.params,
  }
}

/**
 * Las sesiones cuyas series son todas de las que cumplen `seBorran` (una condición sobre
 * `series`: las de un hueco, las de un ejercicio). Al borrarlas se quedarían sin ninguna,
 * que es estar cancelada, así que se borran con ellas. Menos la de hoy en curso, que puede
 * estar abierta en la sesión.
 *
 * Se calcula **antes** de borrar las series: después ya no se sabría cuáles eran.
 */
export function sesionesQueSeVacian(ctx: Contexto, seBorran: Condicion): FilaEntrenamiento[] {
  const enCursoHoy = enCursoSql(ctx)
  return ctx.bd.todas<FilaEntrenamiento>(
    'SELECT * FROM entrenamientos WHERE' +
      ' EXISTS (SELECT 1 FROM series WHERE series.entrenamiento_id = entrenamientos.id' +
      ` AND (${seBorran.sql}))` +
      ' AND NOT EXISTS (SELECT 1 FROM series WHERE series.entrenamiento_id = entrenamientos.id' +
      ` AND NOT (${seBorran.sql}))` +
      ` AND NOT (${enCursoHoy.sql})` +
      ' ORDER BY fecha',
    ...seBorran.params,
    ...seBorran.params,
    ...enCursoHoy.params,
  )
}

/** Lo más lejos que puede quedar una sesión del día que cuenta (ver `plazo`). */
export const MARGEN = 6

/**
 * Las fechas en que se puede entrenar lo que tocaba `dia`, las dos incluidas: desde el
 * lunes de su semana (adelantar) hasta el día antes del mismo día de la semana siguiente
 * (recuperar).
 */
export function plazo(dia: string): [string, string] {
  return [lunesDe(dia), sumarDiasSinSalirse(dia, MARGEN)]
}

/**
 * Si la sesión cuenta de verdad para `dia`: lo dice su `cubre_fecha`, el plan de ese día
 * sigue siendo su rutina y no está cancelada. Que la rutina estuviera oculta ese día no
 * importa: ocultarla no deshace lo que ya contaba.
 */
export function cuenta(
  ctx: Contexto,
  sesion: FilaEntrenamiento,
  dia: DiaPlan,
  vacia?: boolean,
): boolean {
  return (
    sesion.cubre_fecha === dia.fecha &&
    dia.rutina !== null &&
    dia.rutina.id === sesion.rutina_id &&
    !estaCancelada(ctx, sesion, vacia)
  )
}

// --- El estado de cada día -----------------------------------------------------------------

export type Estado = 'descanso' | 'hecho' | 'movido' | 'sin_hacer' | 'pendiente' | 'proximo'

/** Lo que se hizo un día, cuente o no para alguno. */
export interface SesionDelDia {
  entrenamiento_id: number
  rutina: FilaRutina
  en_curso: boolean
  cubre_fecha: string | null
  /** Si cuenta de verdad para `cubre_fecha`. */
  cuenta: boolean
}

/** La sesión que cuenta un día, y en qué fecha se hizo. */
export interface Cobertura {
  entrenamiento_id: number
  fecha: string
}

export interface DiaSeguimiento extends DiaPlan {
  estado: Estado
  cubierto_por: Cobertura | null
  sesion: SesionDelDia | null
}

/**
 * El estado de cada día de `desde` a `hasta`, los dos incluidos. El plan se resuelve con
 * `MARGEN` días de más a cada lado, porque la sesión de un día puede contar otro que cae
 * fuera del rango pedido: así el resultado de un día no depende del rango.
 */
export function seguimiento(ctx: Contexto, desde: string, hasta: string): DiaSeguimiento[] {
  validarRangoDelPlan(ctx, desde, hasta)
  const antes = sumarDiasSinSalirse(desde, -MARGEN)
  const despues = sumarDiasSinSalirse(hasta, MARGEN)
  const plan = new Map(resolverDias(ctx, antes, despues).map((d) => [d.fecha, d]))

  const filas = ctx.bd.todas<FilaEntrenamiento & { con_series: number }>(
    'SELECT entrenamientos.*, EXISTS (SELECT 1 FROM series' +
      ' WHERE series.entrenamiento_id = entrenamientos.id) AS con_series' +
      ' FROM entrenamientos WHERE (fecha >= ? AND fecha <= ?)' +
      ' OR (cubre_fecha >= ? AND cubre_fecha <= ?)',
    antes,
    despues,
    desde,
    hasta,
  )
  const rutinas = porIds<FilaRutina>(
    ctx.bd,
    'rutinas',
    filas.map((f) => f.rutina_id),
  )

  const delDia = new Map<string, SesionDelDia>()
  const cuentan = new Map<string, Cobertura>()
  for (const sesion of filas) {
    const vacia = sesion.con_series === 0
    if (estaCancelada(ctx, sesion, vacia)) continue
    const diaQueCubre = sesion.cubre_fecha ? plan.get(sesion.cubre_fecha) : undefined
    const deVerdad = diaQueCubre !== undefined && cuenta(ctx, sesion, diaQueCubre, vacia)
    delDia.set(sesion.fecha, {
      entrenamiento_id: sesion.id,
      rutina: rutinas.get(sesion.rutina_id)!,
      en_curso: enCurso(ctx, sesion),
      cubre_fecha: sesion.cubre_fecha,
      cuenta: deVerdad,
    })
    if (deVerdad) {
      cuentan.set(sesion.cubre_fecha!, { entrenamiento_id: sesion.id, fecha: sesion.fecha })
    }
  }

  const hoy = ctx.reloj.hoy()
  const resultado: DiaSeguimiento[] = []
  // Contando días y no sumando hasta pasarse: después del 31-12-9999 no hay fecha.
  for (let n = aOrdinal(desde); n <= aOrdinal(hasta); n++) {
    const fecha = desdeOrdinal(n)
    const dia = plan.get(fecha)!
    const cubiertoPor = cuentan.get(fecha) ?? null
    let estado: Estado
    // Primero lo que se hizo: un día ya contado sigue contado aunque luego se ocultara
    // su rutina.
    if (cubiertoPor !== null) estado = cubiertoPor.fecha === fecha ? 'hecho' : 'movido'
    else if (dia.descanso) estado = 'descanso'
    else if (fecha < hoy) estado = 'sin_hacer'
    else estado = fecha === hoy ? 'pendiente' : 'proximo'
    resultado.push({
      ...dia,
      descanso: dia.descanso && cubiertoPor === null,
      estado,
      cubierto_por: cubiertoPor,
      sesion: delDia.get(fecha) ?? null,
    })
  }
  return resultado
}

// --- La pantalla de hoy --------------------------------------------------------------------

export type Situacion =
  'en_curso' | 'hecho' | 'primera_vez' | 'sin_programa' | 'movido' | 'descanso' | 'entrenamiento'

export type Accion = 'intercambiar' | 'adelantar' | 'sin_contar'

/** Hasta dónde se busca el próximo entrenamiento. */
const HORIZONTE = 14

export interface Recuperable {
  fecha: string
  rutina: FilaRutina
  /** El último día en que se puede recuperar. */
  plazo: string
  /** Falso si ese día ya hay sesión: la lista se enseña, pero sin botón. */
  se_puede_hoy: boolean
}

export interface Ofrecida {
  accion: Accion
  rutina: FilaRutina
  fecha: string | null
  se_puede_hoy: boolean
}

export interface UltimaSesion {
  entrenamiento_id: number
  fecha: string
  rutina: FilaRutina
  cubre_fecha: string | null
  series: number
  ejercicios: number
}

export interface RutinaDeHoy {
  id: number
  nombre: string
  /** Los huecos visibles. */
  ejercicios: number
  /** La última sesión con algo apuntado antes del día que se mira. */
  ultima_vez: string | null
}

export interface ResumenDeHoy {
  fecha: string
  situacion: Situacion
  semana: DiaSeguimiento[]
  sesion: SesionDelDia | null
  proximo: DiaSeguimiento | null
  por_recuperar: Recuperable[]
  ofrecidas: Ofrecida[]
  ultima_sesion: UltimaSesion | null
  rutinas: RutinaDeHoy[]
}

/**
 * Sin programa activo, un descanso que venga de una excepción (planificado con el programa
 * anterior) sigue siendo «sin programa». Una excepción con rutina sí es un día que entrenar.
 */
function sinPrograma(dia: DiaSeguimiento): boolean {
  return dia.origen === 'sin_programa' || (dia.programa_id === null && dia.descanso)
}

/** La primera que encaje, en este orden. */
function situacionDe(dia: DiaSeguimiento, hayRutinas: boolean): Situacion {
  if (dia.sesion !== null) return dia.sesion.en_curso ? 'en_curso' : 'hecho'
  if (sinPrograma(dia)) return hayRutinas ? 'sin_programa' : 'primera_vez'
  // Lo de hoy ya se hizo otro día: se comporta como un descanso.
  if (dia.estado === 'movido') return 'movido'
  return dia.descanso ? 'descanso' : 'entrenamiento'
}

/** El primer día de cada rutina: ofrecer dos veces la misma no aporta nada. */
function unaPorRutina(dias: DiaSeguimiento[]): DiaSeguimiento[] {
  const vistas = new Set<number>()
  return dias.filter((dia) => {
    if (vistas.has(dia.rutina!.id)) return false
    vistas.add(dia.rutina!.id)
    return true
  })
}

/**
 * Todo lo que necesita la pantalla de hoy para el día `fecha`: hoy en Entrenar, o un día
 * pasado en la hoja de registrarlo desde el calendario (que no intercambia ni adelanta).
 */
export function resumenDeHoy(ctx: Contexto, fecha: string): ResumenDeHoy {
  const lunes = lunesDe(fecha)
  const domingo = sumarDiasSinSalirse(lunes, 6)
  // Una sola vez, de lo más antiguo que aún se puede recuperar al próximo entrenamiento
  // más lejano que se busca.
  const ordenados = seguimiento(
    ctx,
    sumarDiasSinSalirse(fecha, -MARGEN),
    sumarDiasSinSalirse(fecha, HORIZONTE),
  )
  const dia = ordenados.find((d) => d.fecha === fecha)!
  const rutinas = ordenarPorNombre(
    ctx.bd.todas<FilaRutina>('SELECT * FROM rutinas WHERE oculto_desde IS NULL'),
  )
  const visibles = new Set(rutinas.map((r) => r.id))
  const situacion = situacionDe(dia, rutinas.length > 0)

  /** Un día con rutina que ninguna sesión cuenta, de una rutina que aún se puede elegir. */
  const sinContar = (d: DiaSeguimiento) =>
    !d.descanso && d.cubierto_por === null && visibles.has(d.rutina!.id)

  const siguientes = ordenados.filter((d) => d.fecha > fecha)
  const proximo = siguientes.find(sinContar) ?? null

  // Lo faltado de los seis días anteriores, con el mismo programa que este día.
  const anteriores = ordenados.filter((d) => d.fecha < fecha)
  const candidatos = anteriores.filter((d) => sinContar(d) && d.programa_id === dia.programa_id)
  // Hoy mismo, si ya se entrenó otra cosa y lo suyo sigue sin hacer.
  if (dia.sesion !== null && sinContar(dia)) candidatos.push(dia)
  const porRecuperar: Recuperable[] = candidatos.map((d) => ({
    fecha: d.fecha,
    rutina: d.rutina!,
    plazo: plazo(d.fecha)[1],
    se_puede_hoy: dia.sesion === null,
  }))

  let ofrecidas: Ofrecida[] = []
  const estaSemana = siguientes.filter((d) => d.fecha <= domingo && sinContar(d))
  const esHoy = fecha === ctx.reloj.hoy()
  const ofrecer = (accion: Accion, d: DiaSeguimiento, sePuede: boolean): Ofrecida => ({
    accion,
    rutina: d.rutina!,
    fecha: d.fecha,
    se_puede_hoy: sePuede,
  })
  if (dia.sesion === null) {
    // Un día pasado no intercambia ni adelanta: lo que queda de su semana sale abajo,
    // sin contar.
    if (esHoy && situacion === 'entrenamiento') {
      ofrecidas = unaPorRutina(estaSemana)
        .filter((d) => d.rutina!.id !== dia.rutina!.id)
        .map((d) => ofrecer('intercambiar', d, true))
    } else if (esHoy && (situacion === 'descanso' || situacion === 'movido')) {
      ofrecidas = unaPorRutina(estaSemana).map((d) => ofrecer('adelantar', d, true))
    }
    // Sin programa se puede entrenar cualquier rutina, y un día pasado admite apuntar
    // cualquiera aunque no cuente. Hoy, las que se recuperan no se repiten.
    if (situacion === 'sin_programa' || situacion === 'primera_vez' || !esHoy) {
      const excluidas = new Set(esHoy ? porRecuperar.map((r) => r.rutina.id) : [])
      ofrecidas = [
        ...ofrecidas,
        ...rutinas
          .filter((r) => !excluidas.has(r.id))
          .map((r): Ofrecida => ({
            accion: 'sin_contar',
            rutina: r,
            fecha: null,
            se_puede_hoy: true,
          })),
      ]
    }
  } else if (esHoy && !sinPrograma(dia)) {
    // Hoy ya se entrenó: lo que queda de la semana sale como recordatorio, sin botón.
    ofrecidas = unaPorRutina(estaSemana).map((d) => ofrecer('adelantar', d, false))
  }

  // La de ese mismo día cuenta si ya está terminada; la que está a medias no.
  const conSeries =
    'EXISTS (SELECT 1 FROM series WHERE series.entrenamiento_id = entrenamientos.id)'
  const ultima = ctx.bd.una<FilaEntrenamiento>(
    'SELECT * FROM entrenamientos WHERE fecha <= ?' +
      ` AND (fecha < ? OR terminada_en IS NOT NULL) AND ${conSeries}` +
      ' ORDER BY fecha DESC LIMIT 1',
    fecha,
    ctx.reloj.hoy(),
  )
  let ultimaSesion: UltimaSesion | null = null
  if (ultima !== undefined) {
    const cuentas = ctx.bd.una<{ series: number; ejercicios: number }>(
      'SELECT COUNT(*) AS series, COUNT(DISTINCT ejercicio_id) AS ejercicios FROM series' +
        ' WHERE entrenamiento_id = ?',
      ultima.id,
    )!
    ultimaSesion = {
      entrenamiento_id: ultima.id,
      fecha: ultima.fecha,
      rutina: ctx.bd.una<FilaRutina>('SELECT * FROM rutinas WHERE id = ?', ultima.rutina_id)!,
      cubre_fecha: ultima.cubre_fecha,
      series: cuentas.series,
      ejercicios: cuentas.ejercicios,
    }
  }

  // Dos consultas agrupadas para todas las rutinas, en vez de dos por rutina.
  const huecos = new Map(
    ctx.bd
      .todas<{ rutina_id: number; n: number }>(
        'SELECT rutina_id, COUNT(*) AS n FROM rutina_slots WHERE oculto_desde IS NULL' +
          ' GROUP BY rutina_id',
      )
      .map((f) => [f.rutina_id, f.n] as [number, number]),
  )
  const ultimasVeces = new Map(
    ctx.bd
      .todas<{ rutina_id: number; fecha: string }>(
        'SELECT rutina_id, MAX(fecha) AS fecha FROM entrenamientos' +
          ` WHERE fecha < ? AND ${conSeries} GROUP BY rutina_id`,
        fecha,
      )
      .map((f) => [f.rutina_id, f.fecha] as [number, string]),
  )

  return {
    fecha,
    situacion,
    semana: ordenados.filter((d) => lunes <= d.fecha && d.fecha <= domingo),
    sesion: dia.sesion,
    proximo,
    por_recuperar: porRecuperar,
    ofrecidas,
    ultima_sesion: ultimaSesion,
    rutinas: rutinas.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      ejercicios: huecos.get(r.id) ?? 0,
      ultima_vez: ultimasVeces.get(r.id) ?? null,
    })),
  }
}

// --- Replanificar con días ya contados -----------------------------------------------------

function hoyAlDomingo(ctx: Contexto): [string, string] {
  const hoy = ctx.reloj.hoy()
  return [hoy, sumarDiasSinSalirse(lunesDe(hoy), 6)]
}

/**
 * Las sesiones que cuentan algún día de hoy al domingo: las únicas que un cambio del plan
 * puede dejar sin su día. Se piden **antes** de cambiar nada, para `reubicarCoberturas`.
 */
export function coberturasEnJuego(ctx: Contexto): number[] {
  return seguimiento(ctx, ...hoyAlDomingo(ctx))
    .filter((d) => d.cubierto_por !== null)
    .map((d) => d.cubierto_por!.entrenamiento_id)
}

/**
 * Tras cambiar el plan, lleva lo hecho por adelantado a donde haya ido su día: cada sesión
 * que contaba un día y ha dejado de contarlo va al primer día de hoy al domingo que toque
 * su rutina y que nadie cuente. Si no queda ninguno, 409 y no se guarda nada.
 */
export function reubicarCoberturas(ctx: Contexto, contaban: readonly number[]): void {
  const dias = seguimiento(ctx, ...hoyAlDomingo(ctx))
  const siguen = new Set(
    dias.filter((d) => d.cubierto_por !== null).map((d) => d.cubierto_por!.entrenamiento_id),
  )
  const perdidas = contaban
    .filter((id) => !siguen.has(id))
    .map((id) => ctx.bd.una<FilaEntrenamiento>('SELECT * FROM entrenamientos WHERE id = ?', id)!)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id))
  if (perdidas.length === 0) return

  const ocupados = new Set(dias.filter((d) => d.cubierto_por !== null).map((d) => d.fecha))
  const destinos = new Map<number, string>()
  for (const sesion of perdidas) {
    const destino = dias.find(
      (d) => !ocupados.has(d.fecha) && !d.descanso && d.rutina!.id === sesion.rutina_id,
    )
    if (destino === undefined) {
      const rutina = ctx.bd.una<FilaRutina>('SELECT * FROM rutinas WHERE id = ?', sesion.rutina_id)!
      const sinDia =
        `La sesión del ${enTexto(ctx, sesion.fecha)} cuenta como lo del` +
        ` ${enTexto(ctx, sesion.cubre_fecha!)}, y con este cambio ya no queda ningún` +
        ` día de esta semana con «${rutina.nombre}» para ella`
      throw conflicto({
        mensaje:
          rutina.oculto_desde !== null
            ? `${sinDia}, porque «${rutina.nombre}» está oculta. Muestra «${rutina.nombre}» desde la` +
              ' pestaña Programas o borra antes esa sesión.'
            : `${sinDia}. Deja algún día con esa rutina o borra antes esa sesión.`,
        entrenamiento_id: sesion.id,
        fecha: sesion.fecha,
      })
    }
    destinos.set(sesion.id, destino.fecha)
    ocupados.add(destino.fecha)
  }

  // Un día de destino puede estar retenido por una sesión que no lo cuenta: se suelta como
  // al crear una sesión (la cancelada se borra).
  const ids = perdidas.map((s) => s.id)
  const fechas = [...destinos.values()]
  const retenidas = ctx.bd.todas<FilaEntrenamiento>(
    `SELECT * FROM entrenamientos WHERE cubre_fecha IN (${fechas.map(() => '?').join(', ')})` +
      ` AND id NOT IN (${ids.map(() => '?').join(', ')})`,
    ...fechas,
    ...ids,
  )
  for (const retenida of retenidas) {
    if (estaCancelada(ctx, retenida)) {
      ctx.bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', retenida.id)
    } else {
      ctx.bd.ejecutar('UPDATE entrenamientos SET cubre_fecha = NULL WHERE id = ?', retenida.id)
    }
  }
  // En dos fases: si dos sesiones intercambian sus días, asignarlos de una vez chocaría con
  // la unicidad de cubre_fecha a mitad de camino.
  for (const sesion of perdidas) {
    ctx.bd.ejecutar('UPDATE entrenamientos SET cubre_fecha = NULL WHERE id = ?', sesion.id)
  }
  for (const sesion of perdidas) {
    ctx.bd.ejecutar(
      'UPDATE entrenamientos SET cubre_fecha = ? WHERE id = ?',
      destinos.get(sesion.id)!,
      sesion.id,
    )
  }
}

/**
 * Lo que toca un día pasa al otro y al revés. Una rutina que ese día contaba como descanso
 * (porque está oculta) se intercambia como descanso. Lo hecho por adelantado se reubica.
 */
export function intercambiar(ctx: Contexto, fechaA: string, fechaB: string): void {
  const [diaA] = diasDelPlan(ctx, fechaA, fechaA)
  const [diaB] = diasDelPlan(ctx, fechaB, fechaB)
  const rutinaA = diaA.descanso ? null : diaA.rutina!.id
  const rutinaB = diaB.descanso ? null : diaB.rutina!.id
  const contaban = coberturasEnJuego(ctx)
  ponerExcepcion(ctx, fechaA, rutinaB)
  ponerExcepcion(ctx, fechaB, rutinaA)
  reubicarCoberturas(ctx, contaban)
}
