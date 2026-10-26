import { ajustes } from './ajustes'
import { conPesoYReps, type Medidas } from './medidas'

const LIBRAS_POR_KILO = 2.20462

/** La unidad en que se enseñan y se apuntan los pesos: "kg" o "lb". */
export function unidad(): 'kg' | 'lb' {
  return ajustes().unidad
}

/**
 * Un peso de la base de datos (siempre en kg) en la unidad elegida. Todo lo que es
 * peso por algo (el volumen, el 1RM) se convierte igual.
 */
export function enUnidad(kilos: string | number): number {
  return unidad() === 'lb' ? Number(kilos) * LIBRAS_POR_KILO : Number(kilos)
}

/** Lo que se ha apuntado en la unidad elegida, en kg para la base (con dos decimales). */
export function aKilos(valor: number): number {
  const kilos = unidad() === 'lb' ? valor / LIBRAS_POR_KILO : valor
  return Math.round(kilos * 100) / 100
}

/** "17,5": un número como se escribe en español, sin ceros de más. */
export function numeroLegible(valor: number, decimales = 2): string {
  return valor.toLocaleString('es-ES', { maximumFractionDigits: decimales })
}

/**
 * El peso llega como texto ("17.50") porque es un DECIMAL, y en pantalla se lee
 * como se escribe en español: "17,5", sin ceros de más. En libras, con un decimal
 * como mucho: guardado en kg con dos decimales, 135 lb vuelve como 134,99.
 */
export function pesoLegible(kilos: string | number): string {
  return numeroLegible(enUnidad(kilos), unidad() === 'lb' ? 1 : 2)
}

/**
 * Una duración (la API va siempre en segundos) como se dice en voz alta: «45 s»,
 * «1 min 30 s», «28 min 15 s», «1 h 5 min». Sin dos puntos: es lo que se teclea con el
 * teclado numérico, y los dos puntos solo los lleva el ritmo.
 */
export function duracionLegible(segundos: number): string {
  const horas = Math.floor(segundos / 3600)
  const minutos = Math.floor((segundos % 3600) / 60)
  const resto = segundos % 60
  const partes = []
  if (horas > 0) partes.push(`${horas} h`)
  if (minutos > 0) partes.push(`${minutos} min`)
  if (resto > 0 || partes.length === 0) partes.push(`${resto} s`)
  return partes.join(' ')
}

const METROS_POR_MILLA = 1609.344

/** La unidad en que se enseñan y se apuntan las distancias: «km» o «mi». */
export function unidadDeDistancia(): 'km' | 'mi' {
  return ajustes().distancia
}

/** Una distancia de la base de datos (siempre en metros) en la unidad elegida. */
export function enUnidadDeDistancia(metros: number): number {
  return unidadDeDistancia() === 'mi' ? metros / METROS_POR_MILLA : metros / 1000
}

/** Lo que se ha apuntado en la unidad elegida, en metros para la base (sin decimales). */
export function aMetros(valor: number): number {
  return Math.round(valor * (unidadDeDistancia() === 'mi' ? METROS_POR_MILLA : 1000))
}

/** «5,2 km»: la distancia en la unidad elegida, con dos decimales como mucho. */
export function distanciaLegible(metros: number): string {
  return `${numeroLegible(enUnidadDeDistancia(metros), 2)} ${unidadDeDistancia()}`
}

/**
 * El ritmo de una serie de cardio, «5:26 min/km»: lo que se tarda en recorrer un kilómetro (o
 * una milla). Es la única medida con dos puntos. Nulo sin distancia.
 */
export function ritmoLegible(segundos: number, metros: number | null): string | null {
  if (!metros) return null
  return ritmoEnTexto(segundos / enUnidadDeDistancia(metros))
}

/** «5:26 min/km» de lo que se tarda (en segundos) en recorrer un kilómetro o una milla. */
export function ritmoEnTexto(segundosPorUnidad: number): string {
  const total = Math.round(segundosPorUnidad)
  const minutos = Math.floor(total / 60)
  const resto = String(total % 60).padStart(2, '0')
  return `${minutos}:${resto} min/${unidadDeDistancia()}`
}

/**
 * El 1RM estimado de un día, con la fórmula de Epley para cada serie:
 * peso × (1 + reps / 30). Es la medida de "si mejoró" en un día (H2) y la de la
 * gráfica de progresión (H3), y tiene que ser la misma en las dos. En kg, como el peso.
 *
 * Por defecto, la media de las series: con rutinas de doble progresión (3 × 8-12) el
 * progreso de casi todas las semanas está en las series de después, que la mejor serie
 * no ve. Y la media y no la suma, para que hacer una serie menos no cuente como
 * empeorar. En Ajustes se puede elegir la mejor serie, lo habitual en fuerza máxima.
 */
export function unoRM(series: Medidas[]): number {
  const estimados = conPesoYReps(series).map(
    (serie) => Number(serie.peso) * (1 + serie.repeticiones / 30),
  )
  if (ajustes().unoRM === 'mejor') return Math.max(...estimados)
  return estimados.reduce((total, valor) => total + valor, 0) / estimados.length
}

/**
 * Lee lo que se ha tecleado en un campo numérico, con coma o con punto (el
 * teclado del móvil en español pone coma). Devuelve `null` si no es un número.
 */
export function leerNumero(texto: string): number | null {
  let limpio = texto.trim()
  // «22.045» es como escribe `numeroLegible` un número de cinco cifras (en lb, un peso
  // grande), y el punto ahí separa miles. Un peso nunca lleva tres decimales, así que
  // «22.5» o «22,5» no se confunden con él.
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio)) limpio = limpio.replaceAll('.', '')
  limpio = limpio.replace(',', '.')
  if (limpio === '') return null
  const numero = Number(limpio)
  return Number.isFinite(numero) ? numero : null
}
