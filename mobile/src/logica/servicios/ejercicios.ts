/**
 * Los ejercicios, sus notas y los grupos musculares. Puerto de
 * `backend/app/routers/ejercicios.py` y `grupos_musculares.py`: mismas comprobaciones, en
 * el mismo orden y con los mismos textos.
 */
import type { Contexto } from '../contexto'
import { conflicto, noEncontrado, prohibido } from '../fallos'
import { compararInstantes } from '../reglas/instantes'
import { claveDeNombre } from '../reglas/nombres'
import { compararNombres, ordenarPorNombre } from '../reglas/orden'
import type {
  AvisoDeBorrarEjercicio,
  Ejercicio,
  GrupoMuscular,
  Nota,
  ProgramaDeUnUso,
  SesionHistorial,
  UsoEnRutina,
} from '../tipos'
import type { DatosDeEjercicio, EjercicioNuevo } from '../validacion/ejercicios'
import { exigirVisible, type Condicion } from './comun'
import { sesionesConSeries } from './historial'
import {
  ejercicioOut,
  marcas,
  rutinaMinima,
  type FilaEjercicio,
  type FilaRutina,
  type FilaSlot,
} from './salidas'
import { sesionesQueSeVacian } from './seguimiento'

export type ModoBorrado = 'ocultar' | 'definitivo'

// --- Grupos musculares ---------------------------------------------------------------------

/** El catálogo fijo de grupos, para elegir el de un ejercicio. */
export function listarGruposMusculares(ctx: Contexto): GrupoMuscular[] {
  const grupos = ctx.bd.todas<GrupoMuscular>('SELECT id, nombre FROM grupos_musculares')
  return ordenarPorNombre(grupos)
}

// --- Comprobaciones ------------------------------------------------------------------------

function validarGrupoMuscular(ctx: Contexto, grupoMuscularId: number): void {
  if (ctx.bd.una('SELECT 1 FROM grupos_musculares WHERE id = ?', grupoMuscularId) === undefined) {
    throw noEncontrado('Ese grupo muscular no existe.')
  }
}

/**
 * Un ejercicio nuevo o renombrado no puede llamarse como otro, sin distinguir mayúsculas,
 * tildes ni espacios. La base no lo impide, a propósito: un predefinido nuevo que se llame
 * como uno propio convive con él.
 */
function validarNombreLibre(ctx: Contexto, nombre: string): void {
  const clave = claveDeNombre(nombre)
  const iguales = ctx.bd
    .todas<Pick<FilaEjercicio, 'nombre' | 'es_predefinido' | 'oculto_desde'>>(
      'SELECT nombre, es_predefinido, oculto_desde FROM ejercicios ORDER BY id',
    )
    .filter((otro) => claveDeNombre(otro.nombre) === clave)
  if (iguales.length === 0) return
  // Si conviven varios con ese nombre, se nombra el que más ayuda a encontrarlo: el
  // predefinido y, si no, el visible.
  const peso = (e: (typeof iguales)[number]) =>
    (e.es_predefinido === 1 ? 0 : 2) + (e.oculto_desde === null ? 0 : 1)
  const otro = iguales.reduce((mejor, e) => (peso(e) < peso(mejor) ? e : mejor))
  let mensaje: string
  if (otro.es_predefinido === 1) {
    mensaje =
      `Ya hay un ejercicio predefinido que se llama «${otro.nombre}». ` +
      'Búscalo en la pestaña Ejercicios o elige otro nombre.'
  } else if (otro.oculto_desde === null) {
    mensaje = `Ya tienes un ejercicio que se llama «${otro.nombre}». Elige otro nombre.`
  } else {
    mensaje =
      `Ya tienes un ejercicio oculto que se llama «${otro.nombre}». ` +
      'Muéstralo desde la pestaña Ejercicios o elige otro nombre.'
  }
  throw conflicto({ mensaje, campo: 'nombre' })
}

/** El ejercicio aunque esté oculto, o 404: para *leer* (la ficha, el historial). */
export function obtenerEjercicioLegible(ctx: Contexto, ejercicioId: number): FilaEjercicio {
  const ejercicio = ctx.bd.una<FilaEjercicio>('SELECT * FROM ejercicios WHERE id = ?', ejercicioId)
  if (ejercicio === undefined) {
    throw noEncontrado('Este ejercicio ya no existe. Puede que lo hayas borrado.')
  }
  return ejercicio
}

/**
 * Lo mismo, pero además no puede estar oculto: para *usarlo* (ponerlo en un hueco,
 * apuntar una serie). Lo usan también los otros servicios.
 */
export function obtenerEjercicioVisible(ctx: Contexto, ejercicioId: number): FilaEjercicio {
  const ejercicio = ctx.bd.una<FilaEjercicio>('SELECT * FROM ejercicios WHERE id = ?', ejercicioId)
  if (ejercicio === undefined) {
    throw noEncontrado(
      'Uno de los ejercicios que has elegido ya no existe. Elige otro en su lugar.',
    )
  }
  if (ejercicio.oculto_desde !== null) {
    throw noEncontrado(
      `«${ejercicio.nombre}» está oculto, así que no se puede elegir. ` +
        'Muéstralo desde la pestaña Ejercicios o elige otro.',
    )
  }
  return ejercicio
}

/**
 * Las series que se van con el ejercicio: las suyas y todas las de los huecos donde es el
 * principal (también las hechas con un comodín). Una sola condición para el aviso y el
 * borrado, para que lo que se anuncia sea lo que se borra.
 */
function seriesQueSeBorran(ejercicioId: number): Condicion {
  return {
    sql:
      'series.ejercicio_id = ? OR series.slot_id IN' +
      ' (SELECT id FROM rutina_slots WHERE ejercicio_principal_id = ?)',
    params: [ejercicioId, ejercicioId],
  }
}

/**
 * ¿Se usa? Como principal o comodín de un hueco, o con series. Son RESTRICT, así que un
 * borrado directo fallaría en la base. Las notas no cuentan: se van con él.
 */
function tieneHistorialEjercicio(ctx: Contexto, ejercicioId: number): boolean {
  return (
    ctx.bd.una(
      'SELECT 1 WHERE EXISTS (SELECT 1 FROM rutina_slots WHERE ejercicio_principal_id = ?)' +
        ' OR EXISTS (SELECT 1 FROM slot_alternativas WHERE ejercicio_id = ?)' +
        ' OR EXISTS (SELECT 1 FROM series WHERE ejercicio_id = ?)',
      ejercicioId,
      ejercicioId,
      ejercicioId,
    ) !== undefined
  )
}

/**
 * Los huecos donde aparece el ejercicio, con su número entre los visibles de la rutina, si
 * están ocultos y en qué programas visibles está la rutina.
 */
function usosEnRutinas(ctx: Contexto, ejercicioId: number): UsoEnRutina[] {
  const filas = ctx.bd.todas<FilaSlot & { r_nombre: string; r_oculto_desde: string | null }>(
    'SELECT s.*, r.nombre AS r_nombre, r.oculto_desde AS r_oculto_desde FROM rutina_slots s' +
      ' JOIN rutinas r ON r.id = s.rutina_id' +
      ' WHERE s.ejercicio_principal_id = ?' +
      ' OR EXISTS (SELECT 1 FROM slot_alternativas a WHERE a.slot_id = s.id AND a.ejercicio_id = ?)',
    ejercicioId,
    ejercicioId,
  )
  if (filas.length === 0) return []
  // Por rutina (nombre e id) y, dentro, por el orden del hueco.
  filas.sort(
    (a, b) =>
      compararNombres(a.r_nombre, b.r_nombre) || a.rutina_id - b.rutina_id || a.orden - b.orden,
  )
  const rutinaIds = [...new Set(filas.map((f) => f.rutina_id))]

  // El número de un hueco es su posición entre los visibles, no su `orden`.
  const posiciones = new Map<number, number>()
  const vistos = new Map<number, number>()
  for (const { id, rutina_id } of ctx.bd.todas<{ id: number; rutina_id: number }>(
    `SELECT id, rutina_id FROM rutina_slots WHERE rutina_id IN ${marcas(rutinaIds)}` +
      ' AND oculto_desde IS NULL ORDER BY rutina_id, orden',
    ...rutinaIds,
  )) {
    vistos.set(rutina_id, (vistos.get(rutina_id) ?? 0) + 1)
    posiciones.set(id, vistos.get(rutina_id)!)
  }

  // Los programas visibles donde la rutina tiene algún día vigente.
  const filasDeProgramas = ctx.bd.todas<{
    rutina_id: number
    id: number
    nombre: string
    dia_semana: number
    activo: number
  }>(
    'SELECT d.rutina_id, p.id, p.nombre, d.dia_semana,' +
      ' EXISTS (SELECT 1 FROM programa_periodos pp WHERE pp.programa_id = p.id' +
      ' AND pp.hasta IS NULL) AS activo' +
      ' FROM programa_dias d JOIN programas p ON p.id = d.programa_id' +
      ` WHERE d.rutina_id IN ${marcas(rutinaIds)} AND d.hasta IS NULL AND p.oculto_desde IS NULL`,
    ...rutinaIds,
  )
  filasDeProgramas.sort(
    (a, b) => compararNombres(a.nombre, b.nombre) || a.id - b.id || a.dia_semana - b.dia_semana,
  )
  const programas = new Map<number, Map<number, ProgramaDeUnUso>>()
  for (const f of filasDeProgramas) {
    const delPrograma = programas.get(f.rutina_id) ?? new Map<number, ProgramaDeUnUso>()
    programas.set(f.rutina_id, delPrograma)
    if (!delPrograma.has(f.id)) {
      delPrograma.set(f.id, { id: f.id, nombre: f.nombre, activo: f.activo === 1 })
    }
  }

  return filas.map((f) => {
    const rutina: FilaRutina = {
      id: f.rutina_id,
      nombre: f.r_nombre,
      oculto_desde: f.r_oculto_desde,
      created_at: '',
      updated_at: '',
    }
    return {
      rutina: rutinaMinima(rutina),
      slot_id: f.id,
      rol: f.ejercicio_principal_id === ejercicioId ? 'principal' : 'comodin',
      posicion: posiciones.get(f.id) ?? null,
      oculto: f.oculto_desde !== null || f.r_oculto_desde !== null,
      programas: [...(programas.get(f.rutina_id)?.values() ?? [])],
    }
  })
}

// --- Ejercicios ----------------------------------------------------------------------------

/**
 * Por defecto, la biblioteca: predefinidos y propios, sin los ocultos. Con `ocultos`, en
 * cambio, solo los ocultos.
 */
export function listarEjercicios(ctx: Contexto, ocultos: boolean): Ejercicio[] {
  const filas = ctx.bd.todas<FilaEjercicio>(
    `SELECT * FROM ejercicios WHERE oculto_desde IS ${ocultos ? 'NOT ' : ''}NULL`,
  )
  return ordenarPorNombre(filas).map(ejercicioOut)
}

/** Legible y no visible: la ficha de un ejercicio oculto necesita abrirlo. */
export function obtenerEjercicio(ctx: Contexto, ejercicioId: number): Ejercicio {
  return ejercicioOut(obtenerEjercicioLegible(ctx, ejercicioId))
}

/** Las rutinas donde aparece, para la ficha. Admite ocultos y predefinidos. */
export function dondeSeUsa(ctx: Contexto, ejercicioId: number): UsoEnRutina[] {
  obtenerEjercicioLegible(ctx, ejercicioId)
  return usosEnRutinas(ctx, ejercicioId)
}

/** Lo que se perdería al borrarlo. Un predefinido da 404: no se puede borrar. */
export function avisoDeBorrarEjercicio(ctx: Contexto, ejercicioId: number): AvisoDeBorrarEjercicio {
  const ejercicio = obtenerEjercicioLegible(ctx, ejercicioId)
  if (ejercicio.es_predefinido === 1) {
    throw noEncontrado('Los ejercicios predefinidos no se pueden ocultar ni borrar.')
  }
  const seBorran = seriesQueSeBorran(ejercicioId)
  const cuenta = ctx.bd.una<{ series: number; sesiones: number; desde: string | null }>(
    'SELECT COUNT(series.id) AS series, COUNT(DISTINCT series.entrenamiento_id) AS sesiones,' +
      ' MIN(entrenamientos.fecha) AS desde FROM series' +
      ' JOIN entrenamientos ON entrenamientos.id = series.entrenamiento_id' +
      ` WHERE ${seBorran.sql}`,
    ...seBorran.params,
  )!
  const notas = ctx.bd.una<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notas_ejercicio WHERE ejercicio_id = ?',
    ejercicioId,
  )!.n
  return {
    // Lo mismo que decide el 409 del DELETE, para que el diálogo no diga otra cosa.
    con_historial: tieneHistorialEjercicio(ctx, ejercicioId),
    series: cuenta.series,
    sesiones: cuenta.sesiones,
    desde: cuenta.desde,
    notas,
    huecos: usosEnRutinas(ctx, ejercicioId),
    sesiones_que_se_vacian: sesionesQueSeVacian(ctx, seBorran).map((s) => ({
      entrenamiento_id: s.id,
      fecha: s.fecha,
      cubre_fecha: s.cubre_fecha,
    })),
  }
}

/** Un ejercicio propio: nunca predefinido. */
export function crearEjercicio(ctx: Contexto, datos: EjercicioNuevo): Ejercicio {
  validarGrupoMuscular(ctx, datos.grupo_muscular_id)
  validarNombreLibre(ctx, datos.nombre)
  const ahora = ctx.reloj.ahora()
  const { ultimoId } = ctx.bd.ejecutar(
    'INSERT INTO ejercicios (nombre, grupo_muscular_id, descripcion, es_predefinido,' +
      ' tipo_registro, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    datos.nombre,
    datos.grupo_muscular_id,
    datos.descripcion,
    datos.tipo_registro,
    ahora,
    ahora,
  )
  return obtenerEjercicio(ctx, ultimoId)
}

/** Edita uno propio. Los predefinidos no se editan, y el tipo no cambia. */
export function actualizarEjercicio(
  ctx: Contexto,
  ejercicioId: number,
  datos: DatosDeEjercicio,
): Ejercicio {
  const ejercicio = obtenerEjercicioLegible(ctx, ejercicioId)
  if (ejercicio.es_predefinido === 1) {
    throw prohibido('Los ejercicios predefinidos no se pueden editar.')
  }
  exigirVisible(ejercicio, 'Este ejercicio está oculto. Muéstralo antes de editarlo.')
  validarGrupoMuscular(ctx, datos.grupo_muscular_id)
  // Solo se valida lo que cambia: cambiar solo mayúsculas o tildes vale.
  if (claveDeNombre(datos.nombre) !== claveDeNombre(ejercicio.nombre)) {
    validarNombreLibre(ctx, datos.nombre)
  }
  ctx.bd.ejecutar(
    'UPDATE ejercicios SET nombre = ?, grupo_muscular_id = ?, descripcion = ? WHERE id = ?',
    datos.nombre,
    datos.grupo_muscular_id,
    datos.descripcion,
    ejercicioId,
  )
  return obtenerEjercicio(ctx, ejercicioId)
}

/**
 * Borra uno propio. Sin usos, directo. En uso, hace falta `modo`: `ocultar` (conserva
 * todo) o `definitivo` (se lleva sus series, sus huecos y las sesiones que se vacían). Sin
 * `modo`, 409: lo que se perdería lo cuenta el aviso de borrado.
 */
export function borrarEjercicio(
  ctx: Contexto,
  ejercicioId: number,
  modo: ModoBorrado | null,
): void {
  // Admite lo oculto: la ficha de un ejercicio oculto ofrece borrarlo.
  const ejercicio = obtenerEjercicioLegible(ctx, ejercicioId)
  if (ejercicio.es_predefinido === 1) {
    throw prohibido('Los ejercicios predefinidos no se pueden ocultar ni borrar.')
  }

  if (modo === 'ocultar') {
    // Si ya estaba oculto, se conserva desde cuándo.
    if (ejercicio.oculto_desde === null) {
      ctx.bd.ejecutar(
        'UPDATE ejercicios SET oculto_desde = ? WHERE id = ?',
        ctx.reloj.hoy(),
        ejercicioId,
      )
    }
    return
  }

  if (modo !== 'definitivo' && tieneHistorialEjercicio(ctx, ejercicioId)) {
    throw conflicto(
      'Este ejercicio está en uso. Repite la petición con ?modo=ocultar (conserva' +
        ' todo) o ?modo=definitivo (lo borra con todo lo que lo usa, sin poder' +
        ' deshacerlo).',
    )
  }

  // En este orden, por los RESTRICT: antes de nada, las sesiones que se vacían (sin las
  // series ya no se sabría cuáles eran); luego las series (también las de un comodín en
  // sus huecos), esas sesiones, sus huecos (con sus comodines, en cascada), los comodines
  // donde está, y él (con sus notas, en cascada).
  const seBorran = seriesQueSeBorran(ejercicioId)
  const vacias = sesionesQueSeVacian(ctx, seBorran)
  ctx.bd.ejecutar(`DELETE FROM series WHERE ${seBorran.sql}`, ...seBorran.params)
  for (const sesion of vacias) {
    ctx.bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', sesion.id)
  }
  ctx.bd.ejecutar('DELETE FROM rutina_slots WHERE ejercicio_principal_id = ?', ejercicioId)
  ctx.bd.ejecutar('DELETE FROM slot_alternativas WHERE ejercicio_id = ?', ejercicioId)
  ctx.bd.ejecutar('DELETE FROM ejercicios WHERE id = ?', ejercicioId)
}

/** Deshace un `modo=ocultar`. */
export function mostrarEjercicio(ctx: Contexto, ejercicioId: number): Ejercicio {
  const ejercicio = obtenerEjercicioLegible(ctx, ejercicioId)
  if (ejercicio.es_predefinido === 1) {
    throw prohibido('Los ejercicios predefinidos no se ocultan.')
  }
  ctx.bd.ejecutar('UPDATE ejercicios SET oculto_desde = NULL WHERE id = ?', ejercicioId)
  return obtenerEjercicio(ctx, ejercicioId)
}

/**
 * Los días en que se hizo, del más reciente al más antiguo, con sus series: en la rutina
 * que fuera y como principal o como comodín.
 */
export function historialDeEjercicio(
  ctx: Contexto,
  ejercicioId: number,
  hasta: string | null,
  limite: number,
): SesionHistorial[] {
  obtenerEjercicioLegible(ctx, ejercicioId)
  return sesionesConSeries(
    ctx,
    { sql: 'series.ejercicio_id = ?', params: [ejercicioId] },
    hasta,
    limite,
  )
}

// --- Notas ---------------------------------------------------------------------------------

interface FilaNota {
  id: number
  ejercicio_id: number
  nota: string
  created_at: string
  updated_at: string
}

function notaOut(fila: FilaNota): Nota {
  return {
    nota: fila.nota,
    id: fila.id,
    ejercicio_id: fila.ejercicio_id,
    created_at: fila.created_at,
    updated_at: fila.updated_at,
  }
}

/**
 * 404 si el ejercicio o la nota no existen, o la nota es de otro. Admite ejercicios
 * ocultos: una nota es justo donde apuntar por qué se ocultó.
 */
function obtenerNota(ctx: Contexto, ejercicioId: number, notaId: number): FilaNota {
  obtenerEjercicioLegible(ctx, ejercicioId)
  const nota = ctx.bd.una<FilaNota>('SELECT * FROM notas_ejercicio WHERE id = ?', notaId)
  if (nota === undefined || nota.ejercicio_id !== ejercicioId) {
    throw noEncontrado('Esa nota ya no existe. Puede que la hayas borrado.')
  }
  return nota
}

/** Las notas del ejercicio, de la más reciente a la más antigua. */
export function listarNotas(ctx: Contexto, ejercicioId: number): Nota[] {
  obtenerEjercicioLegible(ctx, ejercicioId)
  const notas = ctx.bd.todas<FilaNota>(
    'SELECT * FROM notas_ejercicio WHERE ejercicio_id = ?',
    ejercicioId,
  )
  notas.sort((a, b) => compararInstantes(b.created_at, a.created_at) || b.id - a.id)
  return notas.map(notaOut)
}

export function crearNota(ctx: Contexto, ejercicioId: number, texto: string): Nota {
  obtenerEjercicioLegible(ctx, ejercicioId)
  const ahora = ctx.reloj.ahora()
  const { ultimoId } = ctx.bd.ejecutar(
    'INSERT INTO notas_ejercicio (ejercicio_id, nota, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ejercicioId,
    texto,
    ahora,
    ahora,
  )
  return notaOut(ctx.bd.una<FilaNota>('SELECT * FROM notas_ejercicio WHERE id = ?', ultimoId)!)
}

export function actualizarNota(
  ctx: Contexto,
  ejercicioId: number,
  notaId: number,
  texto: string,
): Nota {
  obtenerNota(ctx, ejercicioId, notaId)
  ctx.bd.ejecutar('UPDATE notas_ejercicio SET nota = ? WHERE id = ?', texto, notaId)
  return notaOut(ctx.bd.una<FilaNota>('SELECT * FROM notas_ejercicio WHERE id = ?', notaId)!)
}

/** Directo: nada referencia una nota. */
export function borrarNota(ctx: Contexto, ejercicioId: number, notaId: number): void {
  obtenerNota(ctx, ejercicioId, notaId)
  ctx.bd.ejecutar('DELETE FROM notas_ejercicio WHERE id = ?', notaId)
}
