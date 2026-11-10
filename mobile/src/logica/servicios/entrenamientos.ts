/**
 * Las sesiones y sus series. Puerto de `backend/app/routers/entrenamientos.py`: mismas
 * comprobaciones, en el mismo orden y con los mismos textos.
 */
import type { Contexto } from '../contexto'
import { conflicto, noEncontrado, noValido } from '../fallos'
import { aCentesimas, aTexto, claveExacta } from '../reglas/centesimas'
import { cambiosDeSeries, mezclaEnHueco, motivoDeLaFecha } from '../reglas/ediciones'
import { validarMedidas } from '../reglas/medidas'
import type { Entrenamiento, Serie } from '../tipos'
import type {
  CambiosDeEntrenamiento,
  EntrenamientoNuevo,
  SerieDelDiaPedida,
  SeriePedida,
} from '../validacion/entrenamientos'
import { obtenerEjercicioLegible, obtenerEjercicioVisible } from './ejercicios'
import { diasDelPlan, enTexto, type DiaPlan } from './plan'
import { obtenerRutinaVisible } from './rutinas'
import {
  agrupar,
  ejercicioOut,
  marcas,
  pesoOut,
  porIds,
  type FilaEjercicio,
  type FilaSerie,
  type FilaSlot,
} from './salidas'
import {
  cuenta,
  enCurso,
  estaCancelada,
  intercambiar,
  plazo,
  type FilaEntrenamiento,
} from './seguimiento'

// --- Salidas -------------------------------------------------------------------------------

function serieOut(fila: FilaSerie, ejercicio: FilaEjercicio): Serie {
  return {
    ejercicio_id: fila.ejercicio_id,
    slot_id: fila.slot_id,
    numero_serie: fila.numero_serie,
    peso: pesoOut(fila.peso_centesimas),
    repeticiones: fila.repeticiones,
    duracion_s: fila.duracion_s,
    distancia_m: fila.distancia_m,
    peso_corporal: pesoOut(fila.peso_corporal_centesimas),
    variante: fila.variante,
    id: fila.id,
    entrenamiento_id: fila.entrenamiento_id,
    created_at: fila.created_at,
    updated_at: fila.updated_at,
    ejercicio: ejercicioOut(ejercicio),
  }
}

/** Las series ya convertidas, con su ejercicio cargado de una vez. */
function seriesOut(ctx: Contexto, filas: readonly FilaSerie[]): Serie[] {
  const ejercicios = porIds<FilaEjercicio>(
    ctx.bd,
    'ejercicios',
    filas.map((s) => s.ejercicio_id),
  )
  return filas.map((s) => serieOut(s, ejercicios.get(s.ejercicio_id)!))
}

/** Las sesiones con sus series (por `numero_serie` e id), por lotes. */
export function entrenamientosOut(
  ctx: Contexto,
  filas: readonly FilaEntrenamiento[],
): Entrenamiento[] {
  if (filas.length === 0) return []
  const ids = filas.map((e) => e.id)
  const series = agrupar(
    seriesOut(
      ctx,
      ctx.bd.todas<FilaSerie>(
        `SELECT * FROM series WHERE entrenamiento_id IN ${marcas(ids)}` +
          ' ORDER BY numero_serie, id',
        ...ids,
      ),
    ),
    (s) => s.entrenamiento_id,
  )
  return filas.map((e) => ({
    fecha: e.fecha,
    notas: e.notas,
    id: e.id,
    rutina_id: e.rutina_id,
    cubre_fecha: e.cubre_fecha,
    terminada_en: e.terminada_en,
    en_curso: enCurso(ctx, e),
    created_at: e.created_at,
    updated_at: e.updated_at,
    series: series.get(e.id) ?? [],
  }))
}

function entrenamientoOut(ctx: Contexto, id: number): Entrenamiento {
  return entrenamientosOut(ctx, [leer(ctx, id)!])[0]
}

function leer(ctx: Contexto, id: number): FilaEntrenamiento | undefined {
  return ctx.bd.una<FilaEntrenamiento>('SELECT * FROM entrenamientos WHERE id = ?', id)
}

// --- Comprobaciones ------------------------------------------------------------------------

/** 404 si no existe. */
function obtenerEntrenamiento(ctx: Contexto, entrenamientoId: number): FilaEntrenamiento {
  const entrenamiento = leer(ctx, entrenamientoId)
  if (entrenamiento === undefined) {
    throw noEncontrado('Esta sesión ya no existe. Puede que la hayas cancelado o borrado.')
  }
  return entrenamiento
}

/** Se registra lo que se entrenó, no lo que se va a entrenar. */
function validarFechaNoFutura(ctx: Contexto, fecha: string): void {
  if (fecha > ctx.reloj.hoy()) {
    throw noValido(
      `El ${enTexto(ctx, fecha)} todavía no ha llegado. Solo se apuntan días de` +
        ' hoy hacia atrás.',
    )
  }
}

/**
 * Una sesión por día como mucho. Si la que ocupa el día está cancelada, se borra y el día
 * queda libre. `moviendo`: se está cambiando la fecha de un día del historial, y el aviso
 * va marcado como de la fecha.
 */
function validarDiaLibre(ctx: Contexto, fecha: string, moviendo = false): void {
  const otra = ctx.bd.una<FilaEntrenamiento>('SELECT * FROM entrenamientos WHERE fecha = ?', fecha)
  if (otra === undefined) return
  if (estaCancelada(ctx, otra)) {
    ctx.bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', otra.id)
    return
  }
  const otraEnCurso = enCurso(ctx, otra)
  const detalle: Record<string, unknown> = { entrenamiento_id: otra.id, en_curso: otraEnCurso }
  let mensaje: string
  if (moviendo && otraEnCurso) {
    mensaje =
      `El ${enTexto(ctx, fecha)} ya tiene una sesión empezada, y solo se hace una por` +
      ' día. Termínala o cancélala desde la pestaña Entrenar antes de mover esta.'
    detalle.campo = 'fecha'
  } else if (moviendo) {
    mensaje =
      `El ${enTexto(ctx, fecha)} ya tiene una sesión, y solo se hace una por día. Para` +
      ' usar ese día, cambia antes la fecha de esa sesión desde su día en la pestaña' +
      ' Historial.'
    detalle.campo = 'fecha'
  } else if (otraEnCurso) {
    mensaje = 'Ya hay una sesión en curso hoy. Termínala o cancélala antes de empezar otra.'
  } else {
    mensaje =
      'Ese día ya tiene una sesión, y se entrena una rutina al día. Para usarlo, cambia' +
      ' antes la fecha de la otra desde su día en el historial.'
  }
  throw conflicto({ mensaje, ...detalle })
}

/** Lo de un día se entrena dentro de su plazo. */
function validarEnPlazo(ctx: Contexto, fecha: string, cubre: string): void {
  const [desde, hasta] = plazo(cubre)
  if (!(desde <= fecha && fecha <= hasta)) {
    throw noValido(
      `Lo del ${enTexto(ctx, cubre)} solo se puede entrenar entre el` +
        ` ${enTexto(ctx, desde)} y el ${enTexto(ctx, hasta)}. Se adelanta dentro` +
        ' de su semana y se recupera hasta el día antes del mismo día de la semana' +
        ' siguiente.',
    )
  }
}

/** Que la sesión puede contar para el día que dice; devuelve ese día del plan. Todo, 422. */
function validarCubreFecha(ctx: Contexto, datos: EntrenamientoNuevo): DiaPlan {
  const fecha = datos.fecha
  const cubre = datos.cubre_fecha!
  validarEnPlazo(ctx, fecha, cubre)
  const plan = new Map(
    diasDelPlan(ctx, fecha < cubre ? fecha : cubre, fecha < cubre ? cubre : fecha).map((d) => [
      d.fecha,
      d,
    ]),
  )
  const dia = plan.get(cubre)!
  if (dia.descanso || dia.rutina!.id !== datos.rutina_id) {
    throw noValido(`El ${enTexto(ctx, cubre)} no toca esa rutina.`)
  }
  // Lo que tocaba con un programa que ya no está activo no se recupera.
  if (dia.programa_id !== plan.get(fecha)!.programa_id) {
    throw noValido(
      `El ${enTexto(ctx, cubre)} lo planificaba otro programa, y lo que tocaba con` +
        ' un programa que ya no está activo no se recupera.',
    )
  }
  return dia
}

/** Empezar hoy lo que toca otro día. Todo, 422; se mira antes de tocar el plan. */
function validarIntercambio(ctx: Contexto, datos: EntrenamientoNuevo): void {
  const otro = datos.intercambiar_con!
  const hoy = ctx.reloj.hoy()
  let detalle: string
  if (datos.fecha !== hoy) {
    detalle = 'Solo se intercambia al empezar la sesión de hoy.'
  } else if (otro === datos.fecha) {
    detalle = 'Para intercambiar hacen falta dos días distintos.'
  } else if (otro < hoy) {
    detalle =
      `El ${enTexto(ctx, otro)} ya ha pasado. Solo se puede intercambiar con un día` +
      ' de hoy en adelante.'
  } else if (datos.cubre_fecha !== datos.fecha) {
    detalle = 'Al intercambiar, la sesión cuenta como lo que toca hoy.'
  } else {
    const [dia] = diasDelPlan(ctx, otro, otro)
    if (!dia.descanso && dia.rutina!.id === datos.rutina_id) return
    detalle =
      `El ${enTexto(ctx, otro)} no toca esa rutina. Intercambiar trae a hoy lo que` +
      ' toca ese día.'
  }
  throw noValido(detalle)
}

/**
 * Un día del plan lo cuenta una sesión como mucho. Si ya lo cuenta otra, 409 con su id; si
 * lo retiene una que no lo cuenta, lo suelta (la cancelada se borra).
 */
function dejarSitioEn(ctx: Contexto, dia: DiaPlan): void {
  const otra = ctx.bd.una<FilaEntrenamiento>(
    'SELECT * FROM entrenamientos WHERE cubre_fecha = ?',
    dia.fecha,
  )
  if (otra === undefined) return
  if (cuenta(ctx, otra, dia)) {
    throw conflicto({
      mensaje:
        `Lo del ${enTexto(ctx, dia.fecha)} ya está hecho. Lo cuenta la sesión del` +
        ` ${enTexto(ctx, otra.fecha)}.`,
      entrenamiento_id: otra.id,
    })
  }
  if (estaCancelada(ctx, otra)) {
    ctx.bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', otra.id)
  } else {
    ctx.bd.ejecutar('UPDATE entrenamientos SET cubre_fecha = NULL WHERE id = ?', otra.id)
  }
}

// --- Sesiones ------------------------------------------------------------------------------

export interface FiltroDeEntrenamientos {
  desde: string | null
  hasta: string | null
  sin_terminar: boolean
  rutina_id: number | null
  limite: number | null
}

/** Las sesiones, de la más reciente a la más antigua. */
export function listarEntrenamientos(ctx: Contexto, f: FiltroDeEntrenamientos): Entrenamiento[] {
  if (f.desde !== null && f.hasta !== null && f.desde > f.hasta) {
    throw noValido(
      `Las fechas están al revés. El ${enTexto(ctx, f.desde)} va después del` +
        ` ${enTexto(ctx, f.hasta)}.`,
    )
  }
  const condiciones: string[] = []
  const params: (string | number)[] = []
  if (f.desde !== null) {
    condiciones.push('fecha >= ?')
    params.push(f.desde)
  }
  if (f.hasta !== null) {
    condiciones.push('fecha <= ?')
    params.push(f.hasta)
  }
  if (f.sin_terminar) {
    condiciones.push('fecha < ? AND terminada_en IS NULL')
    params.push(ctx.reloj.hoy())
  }
  if (f.rutina_id !== null) {
    condiciones.push('rutina_id = ?')
    params.push(f.rutina_id)
  }
  const where = condiciones.length > 0 ? ` WHERE ${condiciones.join(' AND ')}` : ''
  const limite = f.limite === null ? '' : ` LIMIT ${f.limite}`
  const filas = ctx.bd.todas<FilaEntrenamiento>(
    `SELECT * FROM entrenamientos${where} ORDER BY fecha DESC, id DESC${limite}`,
    ...params,
  )
  return entrenamientosOut(ctx, filas)
}

export function obtenerEntrenamientoOut(ctx: Contexto, entrenamientoId: number): Entrenamiento {
  obtenerEntrenamiento(ctx, entrenamientoId)
  return entrenamientoOut(ctx, entrenamientoId)
}

/**
 * La sesión «vacía» (sin series todavía). `cubre_fecha` es el día del plan que cuenta; sin
 * él, no cuenta para ninguno. Con `intercambiar_con`, antes intercambia lo que toca hoy con
 * lo que toca ese día, todo en la misma transacción.
 */
export function crearEntrenamiento(ctx: Contexto, datos: EntrenamientoNuevo): Entrenamiento {
  validarFechaNoFutura(ctx, datos.fecha)
  obtenerRutinaVisible(ctx, datos.rutina_id)
  // Primero lo que es un error de la petición (422); después lo que choca con otras
  // sesiones, que puede borrar las canceladas.
  if (datos.intercambiar_con !== null) {
    validarIntercambio(ctx, datos)
    // Antes de tocar el plan: si hoy ya hay sesión, el plan se queda como está.
    validarDiaLibre(ctx, datos.fecha)
    intercambiar(ctx, datos.fecha, datos.intercambiar_con)
  }
  const dia = datos.cubre_fecha !== null ? validarCubreFecha(ctx, datos) : null
  validarDiaLibre(ctx, datos.fecha)
  if (dia !== null) dejarSitioEn(ctx, dia)
  const ahora = ctx.reloj.ahora()
  const { ultimoId } = ctx.bd.ejecutar(
    'INSERT INTO entrenamientos (rutina_id, fecha, cubre_fecha, notas, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?)',
    datos.rutina_id,
    datos.fecha,
    datos.cubre_fecha,
    datos.notas,
    ahora,
    ahora,
  )
  return entrenamientoOut(ctx, ultimoId)
}

/** Un fallo al mover la fecha de un día, marcado para enseñarlo bajo la fecha. */
function falloDeLaFecha(mensaje: string) {
  return noValido({ mensaje, campo: 'fecha' })
}

/**
 * La fecha nueva de una sesión: no del futuro, dentro del plazo del día que cuenta y en un
 * día del mismo programa que él. Una sesión que ya cruzaba programas se puede seguir
 * corrigiendo: solo se valida lo que cambia.
 */
function validarFechaNueva(ctx: Contexto, entrenamiento: FilaEntrenamiento, fecha: string): void {
  if (fecha > ctx.reloj.hoy()) {
    throw falloDeLaFecha(
      `El ${enTexto(ctx, fecha)} todavía no ha llegado. Solo se apuntan días de hoy` +
        ' hacia atrás.',
    )
  }
  const cubre = entrenamiento.cubre_fecha
  if (cubre === null) return
  const [desde, hasta] = plazo(cubre)
  // El plan, solo en plazo: una fecha muy lejana pasaría del tope de `diasDelPlan`.
  if (desde <= fecha && fecha <= hasta) {
    const fechas = [fecha, entrenamiento.fecha, cubre].sort()
    const plan = new Map(diasDelPlan(ctx, fechas[0], fechas[2]).map((d) => [d.fecha, d]))
    const programaDe = (f: string) => plan.get(f)!.programa_id
    const cruzaba = programaDe(entrenamiento.fecha) !== programaDe(cubre)
    if (cruzaba || programaDe(fecha) === programaDe(cubre)) return
  }
  const rutina = ctx.bd.una<{ nombre: string }>(
    'SELECT nombre FROM rutinas WHERE id = ?',
    entrenamiento.rutina_id,
  )!
  throw falloDeLaFecha(motivoDeLaFecha(rutina.nombre, cubre, fecha, desde, hasta, ctx.reloj.hoy()))
}

/** Lo que se compara de una serie, con los pesos como valor exacto (como `Decimal`). */
function comparable(s: SeriePedida | FilaSerie) {
  const exacto = (v: number | string | null) => (v === null ? null : claveExacta(v))
  const deFila = 'peso_centesimas' in s
  return {
    ejercicio_id: s.ejercicio_id,
    slot_id: s.slot_id,
    numero_serie: s.numero_serie,
    peso: deFila
      ? exacto(s.peso_centesimas === null ? null : aTexto(s.peso_centesimas))
      : exacto((s as SeriePedida).peso),
    repeticiones: s.repeticiones,
    duracion_s: s.duracion_s,
    distancia_m: s.distancia_m,
    peso_corporal: deFila
      ? exacto(s.peso_corporal_centesimas === null ? null : aTexto(s.peso_corporal_centesimas))
      : exacto((s as SeriePedida).peso_corporal),
    variante: s.variante,
  }
}

/**
 * Las series de un día como deben quedar: cada una nueva o cambiada se valida como al
 * apuntarla o corregirla una a una, y la que llega igual no. Un ejercicio por hueco: si en
 * un hueco tocado quedan series de dos ejercicios, 422.
 */
function validarSeriesDelDia(
  ctx: Contexto,
  entrenamiento: FilaEntrenamiento,
  pedidas: readonly SerieDelDiaPedida[],
): [FilaSerie[], SerieDelDiaPedida[], SerieDelDiaPedida[]] {
  const guardadas = new Map(
    ctx.bd
      .todas<FilaSerie>(
        'SELECT * FROM series WHERE entrenamiento_id = ? ORDER BY numero_serie, id',
        entrenamiento.id,
      )
      .map((s) => [s.id, s] as [number, FilaSerie]),
  )
  const [aBorrar, aCambiar, , ajenas] = cambiosDeSeries(
    new Map([...guardadas].map(([id, s]) => [id, comparable(s)])),
    pedidas.map((s) => ({ ...comparable(s), id: s.id, original: s })),
  )
  const cambian = new Set(aCambiar.map((s) => s.id))
  const ajenasSet = new Set(ajenas)
  const nuevas = pedidas.filter((s) => s.id === null)
  const cambiadas = pedidas.filter((s) => s.id !== null && cambian.has(s.id))
  const tocados = new Set<number>()
  // En el orden en que llegan: el primer fallo es el de la primera serie que no vale.
  for (const serie of pedidas) {
    if (serie.id !== null && ajenasSet.has(serie.id)) {
      throw noEncontrado(
        'Una de las series de este día ya no existe. Pulsa Cancelar y vuelve a' + ' editar el día.',
      )
    }
    let ejercicio: FilaEjercicio
    if (serie.id === null) {
      ejercicio = obtenerEjercicioVisible(ctx, serie.ejercicio_id)
      validarSlot(ctx, serie.slot_id, entrenamiento.rutina_id, serie.ejercicio_id)
      tocados.add(serie.slot_id)
    } else if (cambian.has(serie.id)) {
      const antes = guardadas.get(serie.id)!
      // Como al corregir una suelta: el mismo ejercicio basta con que sea legible.
      ejercicio =
        serie.ejercicio_id === antes.ejercicio_id
          ? obtenerEjercicioLegible(ctx, serie.ejercicio_id)
          : obtenerEjercicioVisible(ctx, serie.ejercicio_id)
      validarSlot(ctx, serie.slot_id, entrenamiento.rutina_id, serie.ejercicio_id, [
        antes.slot_id,
        antes.ejercicio_id,
      ])
      if (serie.slot_id !== antes.slot_id || serie.ejercicio_id !== antes.ejercicio_id) {
        tocados.add(serie.slot_id)
        tocados.add(antes.slot_id)
      }
    } else {
      continue
    }
    validarMedidasDeLaSerie(ejercicio, serie)
  }
  const finales: [number, number][] = [
    ...[...guardadas.values()]
      .filter((s) => !aBorrar.includes(s.id) && !cambian.has(s.id))
      .map((s): [number, number] => [s.slot_id, s.ejercicio_id]),
    ...[...cambiadas, ...nuevas].map((s): [number, number] => [s.slot_id, s.ejercicio_id]),
  ]
  const mezcla = mezclaEnHueco(finales, tocados)
  if (mezcla !== null) {
    const [uno, otro] = mezcla.map(
      (id) =>
        ctx.bd.una<{ nombre: string }>('SELECT nombre FROM ejercicios WHERE id = ?', id)!.nombre,
    )
    throw noValido(
      `En un mismo ejercicio de la rutina hay series de «${uno}» y de «${otro}», y en` +
        ' cada uno se hace un solo ejercicio por sesión. Deja solo las de uno.',
    )
  }
  return [aBorrar.map((id) => guardadas.get(id)!), cambiadas, nuevas]
}

const COLUMNAS_DE_SERIE =
  'ejercicio_id, slot_id, numero_serie, peso_centesimas, repeticiones, duracion_s,' +
  ' distancia_m, peso_corporal_centesimas, variante'

/** Los valores de una serie para el SQL, con los pesos ya redondeados a centésimas. */
function valoresDeSerie(s: SeriePedida) {
  return [
    s.ejercicio_id,
    s.slot_id,
    s.numero_serie,
    s.peso === null ? null : aCentesimas(s.peso),
    s.repeticiones,
    s.duracion_s,
    s.distancia_m,
    s.peso_corporal === null ? null : aCentesimas(s.peso_corporal),
    s.variante,
  ]
}

function insertarSerie(ctx: Contexto, entrenamientoId: number, s: SeriePedida): number {
  const ahora = ctx.reloj.ahora()
  return ctx.bd.ejecutar(
    `INSERT INTO series (entrenamiento_id, ${COLUMNAS_DE_SERIE}, created_at, updated_at)` +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    entrenamientoId,
    ...valoresDeSerie(s),
    ahora,
    ahora,
  ).ultimoId
}

function actualizarFilaDeSerie(ctx: Contexto, serieId: number, s: SeriePedida): void {
  const asignaciones = COLUMNAS_DE_SERIE.split(',')
    .map((c) => `${c.trim()} = ?`)
    .join(', ')
  ctx.bd.ejecutar(`UPDATE series SET ${asignaciones} WHERE id = ?`, ...valoresDeSerie(s), serieId)
}

/**
 * El *Guardar* de un día del historial: la fecha, la nota y, si llegan, todas las series
 * como deben quedar. Todo se valida antes de escribir. Sin `series`, solo la fecha y la
 * nota (la nota de la sesión en curso).
 */
export function actualizarEntrenamiento(
  ctx: Contexto,
  entrenamientoId: number,
  datos: CambiosDeEntrenamiento,
): Entrenamiento {
  const entrenamiento = obtenerEntrenamiento(ctx, entrenamientoId)
  const mueve = datos.fecha !== entrenamiento.fecha
  if (mueve) validarFechaNueva(ctx, entrenamiento, datos.fecha)
  let cambios: [FilaSerie[], SerieDelDiaPedida[], SerieDelDiaPedida[]] | null = null
  if (datos.series !== null) cambios = validarSeriesDelDia(ctx, entrenamiento, datos.series)
  // Lo último: puede borrar una sesión cancelada que ocupe el día nuevo.
  if (mueve) validarDiaLibre(ctx, datos.fecha, true)
  ctx.bd.ejecutar(
    'UPDATE entrenamientos SET fecha = ?, notas = ? WHERE id = ?',
    datos.fecha,
    datos.notas,
    entrenamientoId,
  )
  if (cambios !== null) {
    const [aBorrar, cambiadas, nuevas] = cambios
    for (const s of aBorrar) ctx.bd.ejecutar('DELETE FROM series WHERE id = ?', s.id)
    for (const s of cambiadas) actualizarFilaDeSerie(ctx, s.id!, s)
    for (const s of nuevas) insertarSerie(ctx, entrenamientoId, s)
  }
  return entrenamientoOut(ctx, entrenamientoId)
}

/** Terminarla otra vez no hace nada: se conserva la hora de la primera. */
export function terminarEntrenamiento(ctx: Contexto, entrenamientoId: number): Entrenamiento {
  const entrenamiento = obtenerEntrenamiento(ctx, entrenamientoId)
  if (entrenamiento.terminada_en === null) {
    ctx.bd.ejecutar(
      'UPDATE entrenamientos SET terminada_en = ? WHERE id = ?',
      ctx.reloj.ahora(),
      entrenamientoId,
    )
  }
  return entrenamientoOut(ctx, entrenamientoId)
}

/** Con todas sus series, en cascada. Sin `modo`: nada depende de una sesión. */
export function borrarEntrenamiento(ctx: Contexto, entrenamientoId: number): void {
  obtenerEntrenamiento(ctx, entrenamientoId)
  ctx.bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', entrenamientoId)
}

// --- Series --------------------------------------------------------------------------------

function obtenerSerie(ctx: Contexto, entrenamientoId: number, serieId: number): FilaSerie {
  obtenerEntrenamiento(ctx, entrenamientoId)
  const serie = ctx.bd.una<FilaSerie>('SELECT * FROM series WHERE id = ?', serieId)
  if (serie === undefined || serie.entrenamiento_id !== entrenamientoId) {
    throw noEncontrado('Esa serie ya no existe. Puede que la hayas borrado.')
  }
  return serie
}

/**
 * El hueco de una serie tiene que ser de la rutina de la sesión y no estar oculto (404), y
 * el ejercicio, su principal o una alternativa (422). `actual` es el [hueco, ejercicio] que
 * la serie ya tenía, al editarla: corregir lo apuntado no es elegir nada nuevo.
 */
function validarSlot(
  ctx: Contexto,
  slotId: number,
  rutinaId: number,
  ejercicioId: number,
  actual: [number, number] | null = null,
): void {
  const slot = ctx.bd.una<FilaSlot>('SELECT * FROM rutina_slots WHERE id = ?', slotId)
  const ocultoYNuevo =
    slot !== undefined && slot.oculto_desde !== null && (actual === null || slotId !== actual[0])
  if (slot === undefined || slot.rutina_id !== rutinaId || ocultoYNuevo) {
    throw noEncontrado('Ese ejercicio no está en la rutina de esta sesión.')
  }
  if (actual !== null && actual[0] === slotId && actual[1] === ejercicioId) return
  const delHueco = new Set([
    slot.ejercicio_principal_id,
    ...ctx.bd
      .todas<{ ejercicio_id: number }>(
        'SELECT ejercicio_id FROM slot_alternativas WHERE slot_id = ?',
        slotId,
      )
      .map((a) => a.ejercicio_id),
  ])
  if (!delHueco.has(ejercicioId)) {
    throw noValido('Ese ejercicio no es ni el de la rutina ni una de sus alternativas.')
  }
}

/** Las medidas tienen que ser las que pide el tipo de su ejercicio (422). */
function validarMedidasDeLaSerie(ejercicio: FilaEjercicio, datos: SeriePedida): void {
  const error = validarMedidas(ejercicio.nombre, ejercicio.tipo_registro, datos)
  if (error !== null) throw noValido(error)
}

/**
 * En una sesión, cada hueco se hace con un solo ejercicio: si ya hay series de otro, 409.
 * `exceptoSerieId` deja fuera la serie que se está cambiando.
 */
function validarUnEjercicioPorHueco(
  ctx: Contexto,
  entrenamientoId: number,
  slotId: number,
  ejercicioId: number,
  exceptoSerieId: number | null = null,
): void {
  const series = ctx.bd.todas<FilaSerie>(
    'SELECT * FROM series WHERE entrenamiento_id = ? AND slot_id = ? AND ejercicio_id != ?' +
      ' AND id IS NOT ? ORDER BY id',
    entrenamientoId,
    slotId,
    ejercicioId,
    exceptoSerieId,
  )
  if (series.length === 0) return
  const nombre = (id: number) =>
    ctx.bd.una<{ nombre: string }>('SELECT nombre FROM ejercicios WHERE id = ?', id)!.nombre
  const [cuantas, esas] =
    series.length === 1 ? ['la serie', 'esa serie'] : [`las ${series.length} series`, 'esas series']
  throw conflicto(
    `Esta sesión ya tiene ${cuantas} de «${nombre(series[0].ejercicio_id)}» en ese ejercicio de la rutina, ` +
      `y en cada uno se hace un solo ejercicio por sesión. Borra antes ${esas} ` +
      `para apuntar «${nombre(ejercicioId)}».`,
  )
}

function serieOutPorId(ctx: Contexto, serieId: number): Serie {
  return seriesOut(ctx, [ctx.bd.una<FilaSerie>('SELECT * FROM series WHERE id = ?', serieId)!])[0]
}

export function crearSerie(ctx: Contexto, entrenamientoId: number, datos: SeriePedida): Serie {
  const entrenamiento = obtenerEntrenamiento(ctx, entrenamientoId)
  const ejercicio = obtenerEjercicioVisible(ctx, datos.ejercicio_id)
  validarSlot(ctx, datos.slot_id, entrenamiento.rutina_id, datos.ejercicio_id)
  validarMedidasDeLaSerie(ejercicio, datos)
  validarUnEjercicioPorHueco(ctx, entrenamientoId, datos.slot_id, datos.ejercicio_id)
  return serieOutPorId(ctx, insertarSerie(ctx, entrenamientoId, datos))
}

export function actualizarSerie(
  ctx: Contexto,
  entrenamientoId: number,
  serieId: number,
  datos: SeriePedida,
): Serie {
  const serie = obtenerSerie(ctx, entrenamientoId, serieId)
  const entrenamiento = obtenerEntrenamiento(ctx, entrenamientoId)
  // Si el ejercicio no cambia, basta con que sea legible; si cambia, el otro tiene que
  // estar visible.
  const ejercicio =
    datos.ejercicio_id === serie.ejercicio_id
      ? obtenerEjercicioLegible(ctx, datos.ejercicio_id)
      : obtenerEjercicioVisible(ctx, datos.ejercicio_id)
  validarSlot(ctx, datos.slot_id, entrenamiento.rutina_id, datos.ejercicio_id, [
    serie.slot_id,
    serie.ejercicio_id,
  ])
  validarMedidasDeLaSerie(ejercicio, datos)
  // Solo si cambia el par (hueco, ejercicio) hay que mirar que no se mezcle.
  if (datos.slot_id !== serie.slot_id || datos.ejercicio_id !== serie.ejercicio_id) {
    validarUnEjercicioPorHueco(ctx, entrenamientoId, datos.slot_id, datos.ejercicio_id, serie.id)
  }
  actualizarFilaDeSerie(ctx, serieId, datos)
  return serieOutPorId(ctx, serieId)
}

/**
 * Todas las series de la sesión en un hueco, de una vez: cambiar de ejercicio en la sesión
 * en curso. Un hueco oculto vale. No borra la sesión aunque se quede vacía.
 */
export function borrarSeriesDelHueco(ctx: Contexto, entrenamientoId: number, slotId: number): void {
  const entrenamiento = obtenerEntrenamiento(ctx, entrenamientoId)
  const slot = ctx.bd.una<FilaSlot>('SELECT * FROM rutina_slots WHERE id = ?', slotId)
  if (slot === undefined || slot.rutina_id !== entrenamiento.rutina_id) {
    throw noEncontrado('Ese ejercicio no está en la rutina de esta sesión.')
  }
  ctx.bd.ejecutar(
    'DELETE FROM series WHERE entrenamiento_id = ? AND slot_id = ?',
    entrenamientoId,
    slotId,
  )
}

export function borrarSerie(ctx: Contexto, entrenamientoId: number, serieId: number): void {
  obtenerSerie(ctx, entrenamientoId, serieId)
  ctx.bd.ejecutar('DELETE FROM series WHERE id = ?', serieId)
}
