/**
 * Lo que vale en cada campo de Ajustes, sin React para poder probarlo. Copia de las
 * comprobaciones de `web/src/paginas/ajustes/Preferencias.tsx`, que allí van dentro de cada
 * campo. Si cambian allí, se cambian aquí.
 */
import { leerNumero } from '../utiles/numeros'

/** Lo que cabe en cada campo: los mismos límites que la API pone a un ejercicio de rutina. */
export const MAXIMO_SERIES = 50
export const MAXIMO_REPS = 1000
export const MAXIMO_SEGUNDOS = 86400
// El peso corporal que vale, en kg.
export const MINIMO_PESO_CORPORAL = 20
export const MAXIMO_PESO_CORPORAL = 400

/** Un número entero de 1 al máximo; lo demás no vale. */
export const entero = (valor: number | null, maximo: number): valor is number =>
  valor !== null && Number.isInteger(valor) && valor >= 1 && valor <= maximo

/** El paso de los botones − / + del peso: mayor que 0 y hasta 100, en la unidad elegida. */
export function pasoDelPesoValido(valor: number | null): valor is number {
  return valor !== null && valor > 0 && valor <= 100
}

/** El paso de los segundos de una duración: un número entero de segundos, de 1 a 59. */
export function pasoDelTiempoValido(valor: number | null): valor is number {
  return entero(valor, 59)
}

/** Los textos de los tres campos del objetivo de un ejercicio nuevo. */
export type TextosDelObjetivo = { series: string; min: string; max: string }

/**
 * Por qué no vale el objetivo de un ejercicio nuevo, o `null` si vale: series y reps (o
 * duración, en segundos) enteras dentro de los límites, y el máximo no menor que el mínimo.
 */
export function falloDelObjetivo(textos: TextosDelObjetivo, porDuracion: boolean): string | null {
  const series = leerNumero(textos.series)
  const min = leerNumero(textos.min)
  const max = leerNumero(textos.max)
  const maximo = porDuracion ? MAXIMO_SEGUNDOS : MAXIMO_REPS
  if (!entero(series, MAXIMO_SERIES)) {
    return `Las series, un número entero del 1 al ${MAXIMO_SERIES}.`
  }
  if (!entero(min, maximo) || !entero(max, maximo)) {
    return porDuracion
      ? 'La duración, de 1 segundo a 24 horas.'
      : 'Las reps, números enteros mayores que 0.'
  }
  if (max < min) {
    return porDuracion
      ? 'La duración máxima no puede ser menos que la mínima.'
      : 'Las reps máximas no pueden ser menos que las mínimas.'
  }
  return null
}
