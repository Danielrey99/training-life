/**
 * Las rutinas y sus huecos. Puerto de `backend/app/routers/rutinas.py`: mismas
 * comprobaciones, en el mismo orden y con los mismos textos.
 */
import type { Contexto } from '../contexto'
import { conflicto, noEncontrado, noValido } from '../fallos'
import { diaDeLaSemana, mayor, menor, PRIMERA, sumarDiasSinSalirse, ULTIMA } from '../reglas/dias'
import { repartoDelOrden } from '../reglas/ediciones'
import { validarObjetivo } from '../reglas/medidas'
import { claveDeNombre } from '../reglas/nombres'
import { ordenarPorNombre } from '../reglas/orden'
import { esEspacio } from '../reglas/textos'
import type { AvisoDeBorrarHueco, AvisoDeBorrarRutina, HuecoDeRutina, Rutina } from '../tipos'
import type {
  AlternativaPedida,
  CambiosDeRutina,
  HuecoPedido,
  RutinaNueva,
} from '../validacion/rutinas'
import { exigirVisible, type Condicion } from './comun'
import { obtenerEjercicioVisible, type ModoBorrado } from './ejercicios'
import {
  CAMPOS_DEL_OBJETIVO,
  huecoOut,
  objetivoDe,
  rutinaOut,
  rutinasOut,
  valoresDelObjetivo,
  type FilaAlternativa,
  type FilaEjercicio,
  type FilaObjetivo,
  type FilaRutina,
  type FilaSlot,
} from './salidas'
import { canceladaSql, enCursoSql, sesionesQueSeVacian } from './seguimiento'

// --- Rutinas -------------------------------------------------------------------------------

/** Para leer: 404 si no existe. Admite las ocultas, que tienen su propia vista. */
function obtenerRutinaLegible(ctx: Contexto, rutinaId: number): FilaRutina {
  const rutina = ctx.bd.una<FilaRutina>('SELECT * FROM rutinas WHERE id = ?', rutinaId)
  if (rutina === undefined) {
    throw noEncontrado('Esta rutina ya no existe. Puede que la hayas borrado.')
  }
  return rutina
}

/**
 * Para *usar* una rutina que llega en una petición (un día de un programa): 404 si no
 * existe o está oculta. Lo usan también otros servicios.
 */
export function obtenerRutinaVisible(ctx: Contexto, rutinaId: number): FilaRutina {
  const rutina = ctx.bd.una<FilaRutina>('SELECT * FROM rutinas WHERE id = ?', rutinaId)
  if (rutina === undefined || rutina.oculto_desde !== null) {
    throw noEncontrado('Esa rutina no existe o está oculta.')
  }
  return rutina
}

/** Para modificar: 404 si no existe y 409 si está oculta, salvo para borrarla o mostrarla. */
function obtenerRutinaModificable(
  ctx: Contexto,
  rutinaId: number,
  admitirOculta = false,
): FilaRutina {
  const rutina = obtenerRutinaLegible(ctx, rutinaId)
  if (!admitirOculta) {
    exigirVisible(rutina, 'Esta rutina está oculta. Muéstrala antes de cambiarla.')
  }
  return rutina
}

/**
 * ¿Tiene huecos (también ocultos) o sesiones? Las canceladas no cuentan, pero se borran
 * con ella; la vacía en curso hoy sí cuenta: se acaba de empezar.
 */
function tieneDependientes(ctx: Contexto, rutinaId: number): boolean {
  if (ctx.bd.una('SELECT 1 FROM rutina_slots WHERE rutina_id = ? LIMIT 1', rutinaId)) return true
  const cancelada = canceladaSql(ctx)
  return (
    ctx.bd.una(
      `SELECT 1 FROM entrenamientos WHERE rutina_id = ? AND NOT (${cancelada.sql}) LIMIT 1`,
      rutinaId,
      ...cancelada.params,
    ) !== undefined
  )
}

/**
 * ¿Tocó algún día que ya pasó? Por un día del programa mientras estaba activo, o por un día
 * planificado a mano. Borrarla se llevaría esos días y el calendario los pintaría como
 * descanso, así que pide `modo`.
 */
function estuvoEnElPlan(ctx: Contexto, rutinaId: number): boolean {
  const hoy = ctx.reloj.hoy()
  if (
    ctx.bd.una(
      'SELECT 1 FROM excepciones_del_plan WHERE rutina_id = ? AND fecha < ? LIMIT 1',
      rutinaId,
      hoy,
    )
  ) {
    return true
  }
  const filas = ctx.bd.todas<{
    dia_semana: number
    fila_desde: string | null
    fila_hasta: string | null
    desde: string
    hasta: string | null
  }>(
    'SELECT d.dia_semana, d.desde AS fila_desde, d.hasta AS fila_hasta, p.desde, p.hasta' +
      ' FROM programa_dias d JOIN programa_periodos p ON p.programa_id = d.programa_id' +
      ' WHERE d.rutina_id = ?',
    rutinaId,
  )
  for (const f of filas) {
    // Lo que la fila y el periodo tienen en común antes de hoy (los dos de `desde` a
    // `hasta` sin incluirlo; nulo es sin límite).
    const inicio = mayor(f.desde, f.fila_desde ?? PRIMERA)
    const fin = menor(menor(f.hasta ?? ULTIMA, f.fila_hasta ?? ULTIMA), hoy)
    if (inicio >= fin) continue
    // Y dentro de eso, algún día de la semana de la fila.
    const hasta = (((f.dia_semana - diaDeLaSemana(inicio)) % 7) + 7) % 7
    if (sumarDiasSinSalirse(inicio, hasta) < fin) return true
  }
  return false
}

/** Las visibles por defecto; con `ocultas`, solo las ocultas. */
export function listarRutinas(ctx: Contexto, ocultas: boolean): Rutina[] {
  const filas = ctx.bd.todas<FilaRutina>(
    `SELECT * FROM rutinas WHERE oculto_desde IS ${ocultas ? 'NOT ' : ''}NULL`,
  )
  return rutinasOut(ctx.bd, ordenarPorNombre(filas))
}

export function obtenerRutina(ctx: Contexto, rutinaId: number): Rutina {
  obtenerRutinaLegible(ctx, rutinaId)
  return rutinaOut(ctx.bd, rutinaId)
}

/**
 * Una rutina nueva o renombrada no puede llamarse como otra, sin distinguir mayúsculas,
 * tildes ni espacios. La base no lo impide: un archivo importado puede traer dos iguales.
 */
function validarNombreLibre(ctx: Contexto, nombre: string): void {
  const clave = claveDeNombre(nombre)
  const iguales = ctx.bd
    .todas<Pick<FilaRutina, 'nombre' | 'oculto_desde'>>(
      'SELECT nombre, oculto_desde FROM rutinas ORDER BY id',
    )
    .filter((otra) => claveDeNombre(otra.nombre) === clave)
  if (iguales.length === 0) return
  // Si conviven varias, se nombra la visible, que es la que se encuentra.
  const otra = iguales.find((r) => r.oculto_desde === null) ?? iguales[0]
  const mensaje =
    otra.oculto_desde === null
      ? `Ya tienes una rutina que se llama «${otra.nombre}». Elige otro nombre.`
      : `Ya tienes una rutina oculta que se llama «${otra.nombre}». ` +
        'Muéstrala desde la pestaña Programas o elige otro nombre.'
  throw conflicto({ mensaje, campo: 'nombre' })
}

function insertarHueco(ctx: Contexto, rutinaId: number, orden: number, hueco: HuecoPedido): number {
  const ahora = ctx.reloj.ahora()
  const { ultimoId } = ctx.bd.ejecutar(
    `INSERT INTO rutina_slots (rutina_id, ejercicio_principal_id, orden, ${CAMPOS_DEL_OBJETIVO.join(', ')},` +
      ' created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    rutinaId,
    hueco.ejercicio_principal_id,
    orden,
    ...valoresDelObjetivo(hueco),
    ahora,
    ahora,
  )
  for (const alternativa of hueco.alternativas ?? []) {
    insertarAlternativa(ctx, ultimoId, alternativa.ejercicio_id, alternativa)
  }
  return ultimoId
}

function insertarAlternativa(
  ctx: Contexto,
  slotId: number,
  ejercicioId: number,
  objetivo: FilaObjetivo,
): void {
  ctx.bd.ejecutar(
    `INSERT INTO slot_alternativas (slot_id, ejercicio_id, ${CAMPOS_DEL_OBJETIVO.join(', ')})` +
      ' VALUES (?, ?, ?, ?, ?, ?, ?)',
    slotId,
    ejercicioId,
    ...valoresDelObjetivo(objetivo),
  )
}

/**
 * Una rutina, vacía o con sus huecos y comodines de una vez. Primero se comprueba cada
 * ejercicio y solo después se escribe nada. El orden de los huecos es el de la lista.
 */
export function crearRutina(ctx: Contexto, datos: RutinaNueva): Rutina {
  validarEjerciciosElegidos(
    ctx,
    datos.slots.flatMap((hueco) => idsDelHueco(hueco)),
  )
  validarObjetivos(ctx, datos.slots)
  validarNombreLibre(ctx, datos.nombre)
  const ahora = ctx.reloj.ahora()
  const { ultimoId } = ctx.bd.ejecutar(
    'INSERT INTO rutinas (nombre, created_at, updated_at) VALUES (?, ?, ?)',
    datos.nombre,
    ahora,
    ahora,
  )
  datos.slots.forEach((hueco, i) => insertarHueco(ctx, ultimoId, i + 1, hueco))
  return rutinaOut(ctx.bd, ultimoId)
}

/**
 * El *Guardar* de la rutina: el nombre y, si llega, el orden de los huecos visibles. Los
 * visibles se reparten los `orden` que ya tenían y los ocultos conservan el suyo.
 */
export function actualizarRutina(ctx: Contexto, rutinaId: number, datos: CambiosDeRutina): Rutina {
  const rutina = obtenerRutinaModificable(ctx, rutinaId)
  let reparto = new Map<number, number>()
  if (datos.slot_ids !== null) {
    const visibles = new Map(
      ctx.bd
        .todas<{ id: number; orden: number }>(
          'SELECT id, orden FROM rutina_slots WHERE rutina_id = ? AND oculto_desde IS NULL',
          rutinaId,
        )
        .map((s) => [s.id, s.orden] as [number, number]),
    )
    const pedido = repartoDelOrden(visibles, datos.slot_ids)
    // 422 y no 404 con un id que no es de esta rutina.
    if (pedido === null) {
      throw noValido(
        'Para ordenar la rutina hacen falta todos sus ejercicios a la vista, cada uno una vez.',
      )
    }
    reparto = pedido
  }
  // Solo si cambia de verdad: cambiar mayúsculas o tildes vale.
  if (claveDeNombre(datos.nombre) !== claveDeNombre(rutina.nombre)) {
    validarNombreLibre(ctx, datos.nombre)
  }
  ctx.bd.ejecutar('UPDATE rutinas SET nombre = ? WHERE id = ?', datos.nombre, rutinaId)
  // Dos pasos: primero cada uno a un valor que no choca con nadie (los ocultos tienen
  // orden positivo) y luego el definitivo. SQLite comprueba el UNIQUE fila a fila.
  for (const slotId of reparto.keys()) {
    ctx.bd.ejecutar('UPDATE rutina_slots SET orden = ? WHERE id = ?', -slotId, slotId)
  }
  for (const [slotId, orden] of reparto) {
    ctx.bd.ejecutar('UPDATE rutina_slots SET orden = ? WHERE id = ?', orden, slotId)
  }
  return rutinaOut(ctx.bd, rutinaId)
}

/**
 * El nombre de la copia como lo pone Windows: «Push - copia», «Push - copia (2)»… Si no
 * cabe en 100 caracteres, se recorta el nombre y no el sufijo.
 */
export function nombreDeCopia(nombre: string, ocupados: ReadonlySet<string>): string {
  for (let numero = 1; ; numero++) {
    const sufijo = numero === 1 ? ' - copia' : ` - copia (${numero})`
    const letras = [...nombre].slice(0, 100 - sufijo.length)
    while (letras.length > 0 && esEspacio(letras[letras.length - 1])) letras.pop()
    const candidato = letras.join('') + sufijo
    if (!ocupados.has(claveDeNombre(candidato))) return candidato
  }
}

/**
 * Una copia para que diverja del original: los huecos visibles con su ejercicio y sus
 * comodines, aunque alguno esté oculto. Ni huecos ocultos, ni días de programa, ni
 * historial. Admite una rutina oculta; la copia nace visible.
 */
export function duplicarRutina(ctx: Contexto, rutinaId: number): Rutina {
  const rutina = obtenerRutinaModificable(ctx, rutinaId, true)
  const ocupados = new Set(
    ctx.bd
      .todas<{ nombre: string }>('SELECT nombre FROM rutinas')
      .map((r) => claveDeNombre(r.nombre)),
  )
  const ahora = ctx.reloj.ahora()
  const { ultimoId } = ctx.bd.ejecutar(
    'INSERT INTO rutinas (nombre, created_at, updated_at) VALUES (?, ?, ?)',
    nombreDeCopia(rutina.nombre, ocupados),
    ahora,
    ahora,
  )
  const slots = ctx.bd.todas<FilaSlot>(
    'SELECT * FROM rutina_slots WHERE rutina_id = ? AND oculto_desde IS NULL ORDER BY orden',
    rutinaId,
  )
  for (const slot of slots) {
    const alternativas = ctx.bd.todas<FilaAlternativa>(
      'SELECT * FROM slot_alternativas WHERE slot_id = ? ORDER BY id',
      slot.id,
    )
    insertarHueco(ctx, ultimoId, slot.orden, {
      ...objetivoDe(slot),
      ejercicio_principal_id: slot.ejercicio_principal_id,
      orden: slot.orden,
      alternativas: alternativas.map((a) => ({ ...objetivoDe(a), ejercicio_id: a.ejercicio_id })),
    })
  }
  return rutinaOut(ctx.bd, ultimoId)
}

/** Lo que se perdería al borrarla, para el diálogo de confirmar. */
export function avisoDeBorrarRutina(ctx: Contexto, rutinaId: number): AvisoDeBorrarRutina {
  obtenerRutinaLegible(ctx, rutinaId)
  const tocoDiasPasados = estuvoEnElPlan(ctx, rutinaId)
  const contar = (sql: string, ...params: (string | number)[]) =>
    ctx.bd.una<{ n: number }>(`SELECT COUNT(*) AS n FROM ${sql}`, ...params)!.n
  const enCursoHoy = enCursoSql(ctx)
  return {
    con_historial: tieneDependientes(ctx, rutinaId) || tocoDiasPasados,
    huecos: contar('rutina_slots WHERE rutina_id = ?', rutinaId),
    sesiones: contar(
      'entrenamientos WHERE rutina_id = ? AND EXISTS' +
        ' (SELECT 1 FROM series WHERE series.entrenamiento_id = entrenamientos.id)',
      rutinaId,
    ),
    dias_de_programa: contar('programa_dias WHERE rutina_id = ? AND hasta IS NULL', rutinaId),
    dias_planificados: contar('excepciones_del_plan WHERE rutina_id = ?', rutinaId),
    toco_dias_pasados: tocoDiasPasados,
    sesion_en_curso:
      ctx.bd.una(
        `SELECT 1 FROM entrenamientos WHERE rutina_id = ? AND ${enCursoHoy.sql} LIMIT 1`,
        rutinaId,
        ...enCursoHoy.params,
      ) !== undefined,
  }
}

/**
 * Oculta una rutina visible desde hoy. Si se había mostrado hoy (un tramo cerrado que
 * acaba hoy o después), ese tramo se reabre: no quedan dos tramos pegados.
 */
function ocultar(ctx: Contexto, rutinaId: number): void {
  const hoy = ctx.reloj.hoy()
  const pegados = ctx.bd.todas<{ id: number; desde: string }>(
    'SELECT id, desde FROM rutina_periodos_ocultos WHERE rutina_id = ? AND hasta >= ?',
    rutinaId,
    hoy,
  )
  const desde = pegados.reduce((m, tramo) => menor(m, tramo.desde), hoy)
  ctx.bd.ejecutar('UPDATE rutinas SET oculto_desde = ? WHERE id = ?', desde, rutinaId)
  for (const tramo of pegados) {
    ctx.bd.ejecutar('DELETE FROM rutina_periodos_ocultos WHERE id = ?', tramo.id)
  }
}

/**
 * Muestra una rutina y guarda el tramo en que estuvo oculta, para que mostrarla no
 * convierta en «sin hacer» los días que le tocaban entonces. Si se ocultó hoy, el tramo
 * estaría vacío y no se guarda.
 */
function mostrar(ctx: Contexto, rutina: FilaRutina): void {
  const hoy = ctx.reloj.hoy()
  if (rutina.oculto_desde !== null && rutina.oculto_desde < hoy) {
    ctx.bd.ejecutar(
      'INSERT INTO rutina_periodos_ocultos (rutina_id, desde, hasta) VALUES (?, ?, ?)',
      rutina.id,
      rutina.oculto_desde,
      hoy,
    )
  }
  ctx.bd.ejecutar('UPDATE rutinas SET oculto_desde = NULL WHERE id = ?', rutina.id)
}

/** Deshace un `modo=ocultar`. Los días en que estuvo oculta siguen siendo descanso. */
export function mostrarRutina(ctx: Contexto, rutinaId: number): Rutina {
  const rutina = obtenerRutinaModificable(ctx, rutinaId, true)
  mostrar(ctx, rutina)
  return rutinaOut(ctx.bd, rutinaId)
}

/**
 * Sin huecos ni sesiones (las canceladas no cuentan) y sin días pasados en el plan, se
 * borra directa. Si no, hace falta `modo`: `ocultar` o `definitivo` (se lo lleva todo, y
 * esos días pasan a descanso en el calendario).
 */
export function borrarRutina(ctx: Contexto, rutinaId: number, modo: ModoBorrado | null): void {
  const rutina = obtenerRutinaModificable(ctx, rutinaId, true)

  if (modo === 'ocultar') {
    // Si ya estaba oculta, se conserva desde cuándo.
    if (rutina.oculto_desde === null) ocultar(ctx, rutinaId)
    return
  }

  if (
    modo !== 'definitivo' &&
    (tieneDependientes(ctx, rutinaId) || estuvoEnElPlan(ctx, rutinaId))
  ) {
    throw conflicto(
      'Esta rutina tiene historial. Repite la petición con ?modo=ocultar (conserva' +
        ' todo) o ?modo=definitivo (la borra con todo lo que la usa, sin poder' +
        ' deshacerlo).',
    )
  }

  // Los huecos y las sesiones son RESTRICT, y en este orden: al irse las sesiones se van
  // sus series (en cascada), que son las que bloquearían los huecos. Los días de programa,
  // los planificados y los tramos ocultos se van con ella, en cascada.
  ctx.bd.ejecutar('DELETE FROM entrenamientos WHERE rutina_id = ?', rutinaId)
  ctx.bd.ejecutar('DELETE FROM rutina_slots WHERE rutina_id = ?', rutinaId)
  ctx.bd.ejecutar('DELETE FROM rutinas WHERE id = ?', rutinaId)
}

// --- Huecos --------------------------------------------------------------------------------

/**
 * Para modificar un hueco: 404 si no existe él o su rutina, y 409 si la rutina está oculta.
 * `admitirOculto` deja pasar solo al hueco oculto, para mostrarlo o borrarlo. Los 404 van
 * antes que los 409.
 */
function obtenerSlotModificable(
  ctx: Contexto,
  rutinaId: number,
  slotId: number,
  admitirOculto = false,
): FilaSlot {
  const rutina = obtenerRutinaModificable(ctx, rutinaId, true)
  const slot = ctx.bd.una<FilaSlot>('SELECT * FROM rutina_slots WHERE id = ?', slotId)
  if (slot === undefined || slot.rutina_id !== rutinaId) {
    throw noEncontrado('Ese ejercicio no está en esta rutina.')
  }
  exigirVisible(rutina, 'Esta rutina está oculta. Muéstrala antes de cambiarla.')
  if (!admitirOculto) {
    exigirVisible(
      slot,
      'Este ejercicio está oculto en la rutina. Muéstralo en la rutina antes de cambiarlo.',
    )
  }
  return slot
}

/** Para leer un hueco (su aviso de borrado): admite que él o su rutina estén ocultos. */
function obtenerSlotLegible(ctx: Contexto, rutinaId: number, slotId: number): FilaSlot {
  obtenerRutinaLegible(ctx, rutinaId)
  const slot = ctx.bd.una<FilaSlot>('SELECT * FROM rutina_slots WHERE id = ?', slotId)
  if (slot === undefined || slot.rutina_id !== rutinaId) {
    throw noEncontrado('Ese ejercicio no está en esta rutina.')
  }
  return slot
}

/** El UNIQUE(rutina_id, orden), comprobado antes para dar un 409 legible. */
function validarOrdenDisponible(
  ctx: Contexto,
  rutinaId: number,
  orden: number,
  excluirSlotId: number | null = null,
): void {
  const otro = ctx.bd.una(
    'SELECT 1 FROM rutina_slots WHERE rutina_id = ? AND orden = ? AND id IS NOT ? LIMIT 1',
    rutinaId,
    orden,
    excluirSlotId,
  )
  if (otro !== undefined) {
    throw conflicto(`Ya hay otro ejercicio en la posición ${orden} de esta rutina.`)
  }
}

/** Cada ejercicio elegido tiene que ser visible. Cada id se mira una vez, en orden. */
function validarEjerciciosElegidos(ctx: Contexto, ids: readonly number[]): void {
  for (const ejercicioId of new Set(ids)) obtenerEjercicioVisible(ctx, ejercicioId)
}

function idsDelHueco(hueco: HuecoPedido): number[] {
  return [hueco.ejercicio_principal_id, ...(hueco.alternativas ?? []).map((a) => a.ejercicio_id)]
}

/**
 * Cada ejercicio de un hueco (el principal y cada alternativa del cuerpo) lleva un objetivo
 * de su familia: 422 con el primer fallo. Los ids ya se comprobaron.
 */
function validarObjetivos(ctx: Contexto, huecos: readonly HuecoPedido[]): void {
  for (const hueco of huecos) {
    const elegidos: [number, FilaObjetivo][] = [
      [hueco.ejercicio_principal_id, hueco],
      ...(hueco.alternativas ?? []).map((a): [number, FilaObjetivo] => [a.ejercicio_id, a]),
    ]
    for (const [ejercicioId, objetivo] of elegidos) {
      const ejercicio = ctx.bd.una<FilaEjercicio>(
        'SELECT * FROM ejercicios WHERE id = ?',
        ejercicioId,
      )!
      const error = validarObjetivo(ejercicio.nombre, ejercicio.tipo_registro, objetivo)
      if (error) throw noValido(error)
    }
  }
}

const ORDEN_MAXIMO = 100

/**
 * Al final de la rutina: el mayor `orden` de todos sus huecos, también los ocultos, más
 * uno. Con tope, porque el PUT de un hueco exige `orden <= 100`.
 */
function siguienteOrden(ctx: Contexto, rutinaId: number): number {
  const { mayor: m } = ctx.bd.una<{ mayor: number | null }>(
    'SELECT MAX(orden) AS mayor FROM rutina_slots WHERE rutina_id = ?',
    rutinaId,
  )!
  const siguiente = (m ?? 0) + 1
  if (siguiente > ORDEN_MAXIMO) throw conflicto('Esta rutina no admite más ejercicios.')
  return siguiente
}

export function crearSlot(ctx: Contexto, rutinaId: number, datos: HuecoPedido): HuecoDeRutina {
  obtenerRutinaModificable(ctx, rutinaId)
  validarEjerciciosElegidos(ctx, idsDelHueco(datos))
  validarObjetivos(ctx, [datos])
  let orden: number
  if (datos.orden === null) {
    orden = siguienteOrden(ctx, rutinaId)
  } else {
    validarOrdenDisponible(ctx, rutinaId, datos.orden)
    orden = datos.orden
  }
  return huecoOut(ctx.bd, insertarHueco(ctx, rutinaId, orden, datos))
}

/**
 * Cambia un hueco. Con `alternativas`, la lista sustituye a las actuales (vacía, las quita
 * todas); sin ella, no se tocan.
 */
export function actualizarSlot(
  ctx: Contexto,
  rutinaId: number,
  slotId: number,
  datos: HuecoPedido,
): HuecoDeRutina {
  const slot = obtenerSlotModificable(ctx, rutinaId, slotId)
  const actuales = new Map(
    ctx.bd
      .todas<FilaAlternativa>(
        'SELECT * FROM slot_alternativas WHERE slot_id = ? ORDER BY id',
        slotId,
      )
      .map((a) => [a.ejercicio_id, a] as [number, FilaAlternativa]),
  )
  // El principal solo se valida si cambia: corregir sus series o reps no es elegirlo.
  if (datos.ejercicio_principal_id !== slot.ejercicio_principal_id) {
    obtenerEjercicioVisible(ctx, datos.ejercicio_principal_id)
  }
  // Solo las alternativas que se añaden: una oculta que se conserva no se elige de nuevo.
  if (datos.alternativas !== null) {
    validarEjerciciosElegidos(
      ctx,
      datos.alternativas.filter((a) => !actuales.has(a.ejercicio_id)).map((a) => a.ejercicio_id),
    )
  }
  validarObjetivos(ctx, [datos])
  // Con la lista nueva, el validador ya garantiza que el principal no está en ella.
  if (
    datos.alternativas === null &&
    datos.ejercicio_principal_id !== slot.ejercicio_principal_id &&
    actuales.has(datos.ejercicio_principal_id)
  ) {
    throw conflicto(
      'Ese ejercicio ya es una alternativa de este. Quítalo de las alternativas antes' +
        ' de hacerlo el principal.',
    )
  }
  validarOrdenDisponible(ctx, rutinaId, datos.orden!, slotId)
  ctx.bd.ejecutar(
    `UPDATE rutina_slots SET ${CAMPOS_DEL_OBJETIVO.map((c) => `${c} = ?`).join(', ')},` +
      ' ejercicio_principal_id = ?, orden = ? WHERE id = ?',
    ...valoresDelObjetivo(datos),
    datos.ejercicio_principal_id,
    datos.orden,
    slotId,
  )
  if (datos.alternativas !== null) {
    // Se conservan las filas de los que siguen (con su id, que da su orden).
    const nuevos = new Set(datos.alternativas.map((a) => a.ejercicio_id))
    for (const [ejercicioId, fila] of actuales) {
      if (!nuevos.has(ejercicioId)) {
        ctx.bd.ejecutar('DELETE FROM slot_alternativas WHERE id = ?', fila.id)
      }
    }
    for (const alternativa of datos.alternativas) {
      const fila = actuales.get(alternativa.ejercicio_id)
      if (fila === undefined) {
        insertarAlternativa(ctx, slotId, alternativa.ejercicio_id, alternativa)
      } else {
        actualizarAlternativa(ctx, fila, alternativa)
      }
    }
  }
  return huecoOut(ctx.bd, slotId)
}

function actualizarAlternativa(
  ctx: Contexto,
  fila: FilaAlternativa,
  nueva: AlternativaPedida,
): void {
  ctx.bd.ejecutar(
    `UPDATE slot_alternativas SET ${CAMPOS_DEL_OBJETIVO.map((c) => `${c} = ?`).join(', ')}` +
      ' WHERE id = ?',
    ...valoresDelObjetivo(nueva),
    fila.id,
  )
}

function seriesDelSlot(slotId: number): Condicion {
  return { sql: 'series.slot_id = ?', params: [slotId] }
}

function tieneHistorialSlot(ctx: Contexto, slotId: number): boolean {
  return ctx.bd.una('SELECT 1 FROM series WHERE slot_id = ? LIMIT 1', slotId) !== undefined
}

/** Lo que se perdería al borrarlo: cuántas series, desde cuándo y qué sesiones se vacían. */
export function avisoDeBorrarSlot(
  ctx: Contexto,
  rutinaId: number,
  slotId: number,
): AvisoDeBorrarHueco {
  obtenerSlotLegible(ctx, rutinaId, slotId)
  const { series, desde } = ctx.bd.una<{ series: number; desde: string | null }>(
    'SELECT COUNT(series.id) AS series, MIN(entrenamientos.fecha) AS desde FROM series' +
      ' JOIN entrenamientos ON entrenamientos.id = series.entrenamiento_id' +
      ' WHERE series.slot_id = ?',
    slotId,
  )!
  return {
    series,
    desde,
    sesiones_que_se_vacian: sesionesQueSeVacian(ctx, seriesDelSlot(slotId)).map((s) => ({
      entrenamiento_id: s.id,
      fecha: s.fecha,
      cubre_fecha: s.cubre_fecha,
    })),
  }
}

/**
 * Sin series, se borra directo (sus comodines, en cascada). Con series hace falta `modo`:
 * `ocultar` o `definitivo` (se lleva sus series y las sesiones que se vacían).
 */
export function borrarSlot(
  ctx: Contexto,
  rutinaId: number,
  slotId: number,
  modo: ModoBorrado | null,
): void {
  const slot = obtenerSlotModificable(ctx, rutinaId, slotId, true)

  if (modo === 'ocultar') {
    if (slot.oculto_desde === null) {
      ctx.bd.ejecutar(
        'UPDATE rutina_slots SET oculto_desde = ? WHERE id = ?',
        ctx.reloj.hoy(),
        slotId,
      )
    }
    return
  }

  if (modo !== 'definitivo' && tieneHistorialSlot(ctx, slotId)) {
    throw conflicto(
      'Este ejercicio de la rutina tiene series apuntadas. Repite la petición con' +
        ' ?modo=ocultar' +
        ' (conserva todo) o ?modo=definitivo (lo borra con sus series, sin poder' +
        ' deshacerlo).',
    )
  }

  // Antes de tocar nada: sin las series del hueco, ya no se sabría cuáles se vacían.
  const vacias = sesionesQueSeVacian(ctx, seriesDelSlot(slotId))
  // series.slot_id es RESTRICT: primero las series.
  ctx.bd.ejecutar('DELETE FROM series WHERE slot_id = ?', slotId)
  for (const sesion of vacias) {
    ctx.bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', sesion.id)
  }
  ctx.bd.ejecutar('DELETE FROM rutina_slots WHERE id = ?', slotId)
}

/** Deshace un `modo=ocultar`: el hueco vuelve a su rutina, en el mismo sitio. */
export function mostrarSlot(ctx: Contexto, rutinaId: number, slotId: number): HuecoDeRutina {
  obtenerSlotModificable(ctx, rutinaId, slotId, true)
  ctx.bd.ejecutar('UPDATE rutina_slots SET oculto_desde = NULL WHERE id = ?', slotId)
  return huecoOut(ctx.bd, slotId)
}
