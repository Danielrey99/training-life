import { ajustes } from './ajustes'

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
 * El 1RM estimado de un día, con la fórmula de Epley para cada serie:
 * peso × (1 + reps / 30). Es la medida de "si mejoró" en un día (H2) y la de la
 * gráfica de progresión (H3), y tiene que ser la misma en las dos. En kg, como el peso.
 *
 * Por defecto, la media de las series: con rutinas de doble progresión (3 × 8-12) el
 * progreso de casi todas las semanas está en las series de después, que la mejor serie
 * no ve. Y la media y no la suma, para que hacer una serie menos no cuente como
 * empeorar. En Ajustes se puede elegir la mejor serie, lo habitual en fuerza máxima.
 */
export function unoRM(series: { peso: string | number; repeticiones: number }[]): number {
  const estimados = series.map((serie) => Number(serie.peso) * (1 + serie.repeticiones / 30))
  if (ajustes().unoRM === 'mejor') return Math.max(...estimados)
  return estimados.reduce((total, valor) => total + valor, 0) / estimados.length
}

/**
 * Lee lo que se ha tecleado en un campo numérico, con coma o con punto (el
 * teclado del móvil en español pone coma). Devuelve `null` si no es un número.
 */
export function leerNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (limpio === '') return null
  const numero = Number(limpio)
  return Number.isFinite(numero) ? numero : null
}
