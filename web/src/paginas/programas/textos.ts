import type { HuecoDeRutina, Objetivo, Rutina, RutinaMinima } from '../../api/tipos'
import { duracionLegible } from '../../utiles/numeros'

/** 1 = lunes … 7 = domingo, en minúscula para ir dentro de una frase. */
export const NOMBRES_DE_LOS_DIAS = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
]

/** "Lunes", para encabezar la fila de un día. */
export function nombreDelDiaSemana(diaSemana: number) {
  const nombre = NOMBRES_DE_LOS_DIAS[diaSemana - 1]
  return nombre[0].toUpperCase() + nombre.slice(1)
}

/** "lunes, miércoles y viernes". */
export function enumerar(partes: string[]) {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * El párrafo del diálogo de activar un programa cuyos días no se podrán entrenar: sin
 * ninguna rutina, todo descanso; con rutinas sin ejercicios, cuáles, una vez cada una y en el
 * orden de la semana. Si no pasa nada de eso, `null`. Las ocultas ya lo dicen aparte.
 */
export function avisoDeRutinasVacias(
  semana: readonly (RutinaMinima | null)[],
  vacias: ReadonlySet<number>,
): string | null {
  if (semana.every((rutina) => rutina === null)) {
    return 'Este programa no tiene rutinas, así que todos los días serán descanso.'
  }
  const nombres = [
    ...new Map(
      semana
        .filter((rutina) => rutina && rutina.oculto_desde === null && vacias.has(rutina.id))
        .map((rutina) => [rutina!.id, rutina!.nombre]),
    ).values(),
  ]
  if (nombres.length === 0) return null
  if (nombres.length === 1) {
    return `${nombres[0]} no tiene ejercicios, así que no podrás entrenarla los días que le tocan hasta que le añadas alguno.`
  }
  return `${enumerar(nombres)} no tienen ejercicios, así que no podrás entrenarlas los días que les tocan hasta que les añadas alguno.`
}

/** "3 días"; ninguno, "Sin días de entreno". */
export function cuantosDias(cuantos: number) {
  if (cuantos === 0) return 'Sin días de entreno'
  return cuantos === 1 ? '1 día' : `${cuantos} días`
}

/** «Sin ejercicios», «1 ejercicio» o «N ejercicios»: la misma cifra en todas las pantallas. */
export function cuantosEjercicios(cuantos: number) {
  if (cuantos === 0) return 'Sin ejercicios'
  return cuantos === 1 ? '1 ejercicio' : `${cuantos} ejercicios`
}

/**
 * Sin ningún ejercicio visible no hay nada que entrenar: no se puede poner en un día ni
 * empezar (decisión del autor). Uno oculto solo en la biblioteca sí cuenta.
 */
export function sinEjercicios(rutina: Rutina) {
  return rutina.slots.every((hueco) => hueco.oculto_desde !== null)
}

/** Los ejercicios de una rutina son sus huecos visibles: los ocultos ya no se entrenan. */
export function ejercicios(rutina: Rutina) {
  return cuantosEjercicios(rutina.slots.filter((hueco) => hueco.oculto_desde === null).length)
}

/**
 * Si ocultar o borrar ese ejercicio deja la rutina sin ninguno visible, la frase que lo
 * avisa; si no (le quedan otros, o ya estaba oculto), `null`.
 */
export function avisoDeRutinaVacia(rutina: Rutina, huecoId: number): string | null {
  const visibles = rutina.slots.filter((hueco) => hueco.oculto_desde === null)
  if (visibles.length !== 1 || visibles[0].id !== huecoId) return null
  return `${rutina.nombre} se quedará sin ejercicios y no podrás entrenarla hasta que le añadas otro.`
}

/**
 * Las dos duraciones de un objetivo: con las dos en segundos o las dos en minutos enteros,
 * la unidad una sola vez («30-45 s», «20-30 min»); si no, cada cifra con la suya
 * («30 s-1 min»). Con las dos iguales, un solo valor.
 */
function rangoDeDuracion(min: number, max: number): string {
  if (min === max) return duracionLegible(min)
  if (min < 60 && max < 60) return `${min}-${max} s`
  if (min >= 60 && min % 60 === 0 && max % 60 === 0) return `${min / 60}-${max / 60} min`
  return `${duracionLegible(min)}-${duracionLegible(max)}`
}

/** "4 × 6-10"; si las dos reps coinciden, "3 × 8"; en duración, "3 × 30-45 s", "1 × 20-30 min". */
export function objetivo(hueco: Objetivo) {
  if (hueco.duracion_min_s !== null && hueco.duracion_max_s !== null) {
    return `${hueco.series_objetivo} × ${rangoDeDuracion(hueco.duracion_min_s, hueco.duracion_max_s)}`
  }
  const reps =
    hueco.reps_min === hueco.reps_max ? hueco.reps_min : `${hueco.reps_min}-${hueco.reps_max}`
  return `${hueco.series_objetivo} × ${reps}`
}

/**
 * El objetivo del ejercicio que se hace en un hueco: el del principal o el de esa
 * alternativa. Sin ejercicio, el del principal; con uno que ya no está en el hueco
 * (se quitó después de hacerlo), ninguno.
 */
function objetivoDe(hueco: HuecoDeRutina, ejercicioId: number | undefined): Objetivo | null {
  if (ejercicioId === undefined || ejercicioId === hueco.ejercicio_principal_id) return hueco
  return hueco.alternativas.find((otra) => otra.ejercicio.id === ejercicioId) ?? null
}

/** "3 × 8-12" del ejercicio que se hace en el hueco; nulo si ya no es uno de los suyos. */
export function objetivoDelEjercicio(hueco: HuecoDeRutina, ejercicioId: number | undefined) {
  const suyo = objetivoDe(hueco, ejercicioId)
  return suyo ? objetivo(suyo) : null
}

/** Las series que pide el hueco con ese ejercicio; si ya no es uno de los suyos, las del principal. */
export function seriesObjetivoDe(hueco: HuecoDeRutina, ejercicioId: number | undefined) {
  return (objetivoDe(hueco, ejercicioId) ?? hueco).series_objetivo
}

/** "1 alternativa" o "3 alternativas", bajo el ejercicio en P3; sin ninguna, nada. */
export function lineaDeAlternativas(cuantas: number) {
  // Solo cuántas, no sus nombres (decisión del autor): con varias, la lista ocupaba tres
  // líneas y deformaba la rutina. Los nombres se ven al abrir el ejercicio.
  if (cuantas === 0) return null
  return cuantas === 1 ? '1 alternativa' : `${cuantas} alternativas`
}

/**
 * "Pecho · predefinido" o "Pecho · mío", como en la pestaña Ejercicios: de qué grupo es y
 * quién lo creó.
 */
export function deDonde(
  ejercicio: { grupo_muscular_id: number; es_predefinido: boolean },
  grupos: Map<number, string>,
) {
  const grupo = grupos.get(ejercicio.grupo_muscular_id) ?? 'Sin grupo'
  return `${grupo} · ${ejercicio.es_predefinido ? 'predefinido' : 'mío'}`
}

/**
 * Lo que dice el aviso de activar un programa cuando hay días cambiados a mano de hoy en
 * adelante: cuántos y entre qué fechas, sin enumerarlos (pueden ser muchos).
 */
export function diasCambiadosAMano(fechas: string[], enFrase: (iso: string) => string) {
  const ordenadas = [...fechas].sort()
  const primero = enFrase(ordenadas[0])
  if (ordenadas.length === 1) return `Tienes 1 día cambiado a mano, ${primero}.`
  const ultimo = enFrase(ordenadas[ordenadas.length - 1])
  return `Tienes ${ordenadas.length} días cambiados a mano, entre ${primero} y ${ultimo}.`
}

export const QUE_HACER_CON_ELLOS =
  'Puedes dejarlos como están o quitarlos para que esos días sigan el programa nuevo.'
