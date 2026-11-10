/**
 * Las filas de la base y cómo se convierten en lo que devuelve la api: los `*Out` de
 * `backend/app/schemas.py`, con las formas de `tipos.ts`.
 *
 * Lo que en el backend resuelve el ORM al serializar (el ejercicio de un hueco, sus
 * alternativas, en cuántos programas está una rutina) aquí se carga **por lotes**: una
 * consulta para todas las filas de la lista, nunca una por fila.
 */
import type { Bd, Valor } from '../bd/bd'
import { aTexto } from '../reglas/centesimas'
import type { TipoRegistro } from '../reglas/medidas'
import type {
  AlternativaDeHueco,
  Ejercicio,
  HuecoDeRutina,
  Rutina,
  RutinaMinima,
  SerieHistorial,
} from '../tipos'

// --- Filas ---------------------------------------------------------------------------------

export interface FilaEjercicio {
  id: number
  nombre: string
  grupo_muscular_id: number
  descripcion: string | null
  es_predefinido: number
  tipo_registro: TipoRegistro
  oculto_desde: string | null
  created_at: string
  updated_at: string
}

export interface FilaRutina {
  id: number
  nombre: string
  oculto_desde: string | null
  created_at: string
  updated_at: string
}

export interface FilaObjetivo {
  series_objetivo: number
  reps_min: number | null
  reps_max: number | null
  duracion_min_s: number | null
  duracion_max_s: number | null
}

export interface FilaSlot extends FilaObjetivo {
  id: number
  rutina_id: number
  ejercicio_principal_id: number
  orden: number
  oculto_desde: string | null
  created_at: string
  updated_at: string
}

export interface FilaAlternativa extends FilaObjetivo {
  id: number
  slot_id: number
  ejercicio_id: number
}

export interface FilaSerie {
  id: number
  entrenamiento_id: number
  slot_id: number
  ejercicio_id: number
  numero_serie: number
  peso_centesimas: number | null
  repeticiones: number | null
  duracion_s: number | null
  distancia_m: number | null
  peso_corporal_centesimas: number | null
  variante: string | null
  created_at: string
  updated_at: string
}

// --- Ayudas para el SQL --------------------------------------------------------------------

/** `(?, ?, ?)` para un `IN` con tantos valores como `lista`. */
export function marcas(lista: readonly unknown[]): string {
  return `(${lista.map(() => '?').join(', ')})`
}

/** Las filas de `tabla` con esos ids, por id. Sin ids, ninguna consulta. */
export function porIds<T extends { id: number }>(
  bd: Bd,
  tabla: string,
  ids: Iterable<number>,
): Map<number, T> {
  const lista = [...new Set(ids)]
  if (lista.length === 0) return new Map()
  const filas = bd.todas<T>(`SELECT * FROM ${tabla} WHERE id IN ${marcas(lista)}`, ...lista)
  return new Map(filas.map((fila) => [fila.id, fila]))
}

/** Agrupa una lista por una clave, conservando el orden. */
export function agrupar<T, K>(lista: readonly T[], clave: (x: T) => K): Map<K, T[]> {
  const grupos = new Map<K, T[]>()
  for (const x of lista) {
    const k = clave(x)
    const grupo = grupos.get(k)
    if (grupo) grupo.push(x)
    else grupos.set(k, [x])
  }
  return grupos
}

export const CAMPOS_DEL_OBJETIVO = [
  'series_objetivo',
  'reps_min',
  'reps_max',
  'duracion_min_s',
  'duracion_max_s',
] as const

/** Los cinco campos del objetivo de un hueco, una alternativa o un cuerpo. */
export function objetivoDe(origen: FilaObjetivo): FilaObjetivo {
  return {
    series_objetivo: origen.series_objetivo,
    reps_min: origen.reps_min,
    reps_max: origen.reps_max,
    duracion_min_s: origen.duracion_min_s,
    duracion_max_s: origen.duracion_max_s,
  }
}

/** Los valores del objetivo, en el orden de `CAMPOS_DEL_OBJETIVO`, para un INSERT. */
export function valoresDelObjetivo(origen: FilaObjetivo): Valor[] {
  return CAMPOS_DEL_OBJETIVO.map((campo) => origen[campo])
}

// --- Salidas -------------------------------------------------------------------------------

export function ejercicioOut(fila: FilaEjercicio): Ejercicio {
  return {
    id: fila.id,
    nombre: fila.nombre,
    grupo_muscular_id: fila.grupo_muscular_id,
    descripcion: fila.descripcion,
    es_predefinido: fila.es_predefinido === 1,
    tipo_registro: fila.tipo_registro,
    oculto_desde: fila.oculto_desde,
    created_at: fila.created_at,
    updated_at: fila.updated_at,
  }
}

/** Unas centésimas como las da el backend (un NUMERIC(n, 2) en texto: «80.00»), o nulo. */
export function pesoOut(centesimas: number | null): string | null {
  return centesimas === null ? null : aTexto(centesimas)
}

/** Una serie dentro del historial de un ejercicio, sin fecha ni ejercicio. */
export function serieHistorial(fila: FilaSerie): SerieHistorial {
  return {
    id: fila.id,
    slot_id: fila.slot_id,
    numero_serie: fila.numero_serie,
    peso: pesoOut(fila.peso_centesimas),
    repeticiones: fila.repeticiones,
    duracion_s: fila.duracion_s,
    distancia_m: fila.distancia_m,
    variante: fila.variante,
  }
}

export function rutinaMinima(fila: FilaRutina): RutinaMinima {
  return { id: fila.id, nombre: fila.nombre, oculto_desde: fila.oculto_desde }
}

/** Los huecos con su ejercicio principal y sus alternativas, en el orden en que llegan. */
export function huecosOut(bd: Bd, slots: readonly FilaSlot[]): HuecoDeRutina[] {
  if (slots.length === 0) return []
  const ids = slots.map((s) => s.id)
  const alternativas = bd.todas<FilaAlternativa>(
    `SELECT * FROM slot_alternativas WHERE slot_id IN ${marcas(ids)} ORDER BY id`,
    ...ids,
  )
  const ejercicios = porIds<FilaEjercicio>(bd, 'ejercicios', [
    ...slots.map((s) => s.ejercicio_principal_id),
    ...alternativas.map((a) => a.ejercicio_id),
  ])
  const delSlot = agrupar(alternativas, (a) => a.slot_id)
  return slots.map((slot) => ({
    id: slot.id,
    rutina_id: slot.rutina_id,
    ejercicio_principal_id: slot.ejercicio_principal_id,
    orden: slot.orden,
    ...objetivoDe(slot),
    oculto_desde: slot.oculto_desde,
    created_at: slot.created_at,
    updated_at: slot.updated_at,
    ejercicio_principal: ejercicioOut(ejercicios.get(slot.ejercicio_principal_id)!),
    alternativas: (delSlot.get(slot.id) ?? []).map((a): AlternativaDeHueco => ({
      ...objetivoDe(a),
      ejercicio: ejercicioOut(ejercicios.get(a.ejercicio_id)!),
    })),
  }))
}

/** Un hueco por su id, ya convertido. */
export function huecoOut(bd: Bd, slotId: number): HuecoDeRutina {
  const slot = bd.una<FilaSlot>('SELECT * FROM rutina_slots WHERE id = ?', slotId)!
  return huecosOut(bd, [slot])[0]
}

/**
 * Las rutinas con sus huecos (por `orden`) y en cuántos programas visibles aparecen hoy
 * (`num_programas`: los días vigentes, sin contar las filas cerradas).
 */
export function rutinasOut(bd: Bd, rutinas: readonly FilaRutina[]): Rutina[] {
  if (rutinas.length === 0) return []
  const ids = rutinas.map((r) => r.id)
  const slots = bd.todas<FilaSlot>(
    `SELECT * FROM rutina_slots WHERE rutina_id IN ${marcas(ids)} ORDER BY rutina_id, orden`,
    ...ids,
  )
  const huecos = agrupar(huecosOut(bd, slots), (h) => h.rutina_id)
  const programas = bd.todas<{ rutina_id: number; n: number }>(
    'SELECT d.rutina_id, COUNT(DISTINCT d.programa_id) AS n FROM programa_dias d' +
      ' JOIN programas p ON p.id = d.programa_id' +
      ` WHERE d.rutina_id IN ${marcas(ids)} AND d.hasta IS NULL AND p.oculto_desde IS NULL` +
      ' GROUP BY d.rutina_id',
    ...ids,
  )
  const numProgramas = new Map(programas.map((p) => [p.rutina_id, p.n]))
  return rutinas.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    oculto_desde: r.oculto_desde,
    num_programas: numProgramas.get(r.id) ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
    slots: huecos.get(r.id) ?? [],
  }))
}

/** Una rutina por su id, ya convertida. */
export function rutinaOut(bd: Bd, rutinaId: number): Rutina {
  const rutina = bd.una<FilaRutina>('SELECT * FROM rutinas WHERE id = ?', rutinaId)!
  return rutinasOut(bd, [rutina])[0]
}
