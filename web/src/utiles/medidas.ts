import type { TipoRegistro } from '../api/tipos'
import { distanciaLegible, duracionLegible, pesoLegible, ritmoLegible, unidad } from './numeros'

/**
 * Las medidas que puede llevar una serie, según el tipo de su ejercicio: las que no le
 * tocan van nulas. Es la misma regla que `app/medidas.py` del backend; el móvil copiará
 * este archivo.
 *
 * - `peso_reps`: peso (0 o más) y repeticiones.
 * - `corporal`: repeticiones y una carga (`peso`): 0 sin carga, positiva con lastre y
 *   negativa con ayuda.
 * - `tiempo`: duración y, si se lleva, peso.
 * - `cardio`: duración y, si se quiere, distancia.
 */
export type Medidas = {
  peso: string | number | null
  repeticiones: number | null
  duracion_s: number | null
  // Solo las de cardio, y si se apuntó.
  distancia_m?: number | null
}

/** Una serie con peso y repeticiones: lo único que entra en el volumen y en el 1RM. */
export type ConPesoYReps = { peso: string | number; repeticiones: number }

/** El peso de una serie como número, en kg; nulo si no lo lleva. Nunca `Number(serie.peso)`: daría 0. */
export function kilos(serie: { peso: string | number | null }): number | null {
  return serie.peso === null ? null : Number(serie.peso)
}

/** Las series que tienen peso y repeticiones, tal cual y con el tipo ya estrechado. */
export function conPesoYReps<T extends Medidas>(series: T[]): (T & ConPesoYReps)[] {
  return series.filter(
    (serie): serie is T & ConPesoYReps => serie.peso !== null && serie.repeticiones !== null,
  )
}

/** "5 kg" (o en lb), con el signo de menos si es una ayuda. */
function cargaLegible(valor: number): string {
  return `${pesoLegible(Math.abs(valor))} ${unidad()}`
}

/** «28 min 15 s · 5,2 km»; sin distancia, solo el tiempo. */
function tiempoYDistancia(serie: Medidas): string {
  const tiempo = duracionLegible(serie.duracion_s ?? 0)
  return serie.distancia_m ? `${tiempo} · ${distanciaLegible(serie.distancia_m)}` : tiempo
}

/** «Ritmo 5:26 /km», en su línea debajo de una serie de cardio; nulo sin distancia. */
export function ritmoDeLaSerie(serie: Medidas): string | null {
  if (!serie.duracion_s || !serie.distancia_m) return null
  return `Ritmo ${ritmoLegible(serie.duracion_s, serie.distancia_m)}`
}

/**
 * Una serie en una línea: «40 kg × 12 reps», «8 reps con 10 kg de lastre», «45 s»,
 * «40 s con 5 kg».
 */
export function serieLarga(tipo: TipoRegistro, serie: Medidas): string {
  const carga = kilos(serie)
  const reps = serie.repeticiones
  if (tipo === 'cardio') return tiempoYDistancia(serie)
  if (tipo === 'tiempo') {
    const tiempo = duracionLegible(serie.duracion_s ?? 0)
    return carga ? `${tiempo} con ${cargaLegible(carga)}` : tiempo
  }
  if (tipo === 'corporal') {
    const cuantas = `${reps} reps`
    if (!carga) return cuantas
    return `${cuantas} con ${cargaLegible(carga)} de ${carga > 0 ? 'lastre' : 'ayuda'}`
  }
  return `${pesoLegible(carga ?? 0)} ${unidad()} × ${reps} reps`
}

/**
 * Una serie en una ficha, sin unidades: «40 × 12», «12», «+10 × 8», «−20 × 8», «45 s»,
 * «38 s con 5 kg».
 */
export function serieCorta(tipo: TipoRegistro, serie: Medidas): string {
  const carga = kilos(serie)
  const reps = serie.repeticiones
  if (tipo === 'cardio') return tiempoYDistancia(serie)
  if (tipo === 'tiempo') {
    const tiempo = duracionLegible(serie.duracion_s ?? 0)
    return carga ? `${tiempo} con ${pesoLegible(carga)} ${unidad()}` : tiempo
  }
  if (tipo === 'corporal') {
    if (!carga) return `${reps}`
    return `${carga > 0 ? '+' : '−'}${pesoLegible(Math.abs(carga))} × ${reps}`
  }
  return `${pesoLegible(carga ?? 0)} × ${reps}`
}

/** «Peso corporal 78 kg», en su línea debajo de una serie; nulo si la serie no lo lleva. */
export function pesoCorporalLegible(serie: { peso_corporal: string | null }): string | null {
  if (serie.peso_corporal === null) return null
  return `Peso corporal ${pesoLegible(serie.peso_corporal)} ${unidad()}`
}
