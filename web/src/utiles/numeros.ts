/**
 * El peso llega como texto ("17.50") porque es un DECIMAL, y en pantalla se lee
 * como se escribe en español: "17,5", sin ceros de más.
 */
export function pesoLegible(peso: string | number): string {
  return Number(peso).toLocaleString('es-ES', { maximumFractionDigits: 2 })
}

/**
 * El 1RM estimado medio de las series, cada una con la fórmula de Epley:
 * peso × (1 + reps / 30). Es la medida de "si mejoró" en un día (H2) y la de la
 * gráfica de progresión (H3), y tiene que ser la misma en las dos.
 *
 * La media y no la mejor serie: con rutinas de doble progresión (3 × 8-12) el progreso
 * de casi todas las semanas está en las series de después, que la mejor serie no ve.
 * Y la media y no la suma, para que hacer una serie menos no cuente como empeorar.
 */
export function unoRM(series: { peso: string | number; repeticiones: number }[]): number {
  const estimados = series.map((serie) => Number(serie.peso) * (1 + serie.repeticiones / 30))
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
