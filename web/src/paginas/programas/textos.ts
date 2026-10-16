import type { Rutina } from '../../api/tipos'

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

/** "3 días"; ninguno, "Sin días de entreno". */
export function cuantosDias(cuantos: number) {
  if (cuantos === 0) return 'Sin días de entreno'
  return cuantos === 1 ? '1 día' : `${cuantos} días`
}

/** Los ejercicios de una rutina son sus huecos visibles: los ocultos ya no se entrenan. */
export function ejercicios(rutina: Rutina) {
  const cuantos = rutina.slots.filter((hueco) => hueco.oculto_desde === null).length
  if (cuantos === 0) return 'Sin ejercicios'
  return cuantos === 1 ? '1 ejercicio' : `${cuantos} ejercicios`
}

/** "4 × 6-10"; si las dos reps coinciden, "3 × 8". */
export function objetivo(hueco: { series_objetivo: number; reps_min: number; reps_max: number }) {
  const reps =
    hueco.reps_min === hueco.reps_max ? hueco.reps_min : `${hueco.reps_min}-${hueco.reps_max}`
  return `${hueco.series_objetivo} × ${reps}`
}

/** "1 alternativa" o "3 alternativas", bajo el ejercicio en P3; sin ninguna, nada. */
export function lineaDeAlternativas(cuantas: number) {
  // Solo cuántas, no sus nombres (decisión del autor): con varias, la lista ocupaba tres
  // líneas y deformaba la rutina. Los nombres se ven al abrir el ejercicio.
  if (cuantas === 0) return null
  return cuantas === 1 ? '1 alternativa' : `${cuantas} alternativas`
}

/** "Pecho · predefinido" o "Pecho · tuyo": de qué grupo es y quién lo creó. */
export function deDonde(
  ejercicio: { grupo_muscular_id: number; es_predefinido: boolean },
  grupos: Map<number, string>,
) {
  const grupo = grupos.get(ejercicio.grupo_muscular_id) ?? 'Sin grupo'
  return `${grupo} · ${ejercicio.es_predefinido ? 'predefinido' : 'tuyo'}`
}
