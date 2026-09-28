/**
 * El peso llega como texto ("17.50") porque es un DECIMAL, y en pantalla se lee
 * como se escribe en español: "17,5", sin ceros de más.
 */
export function pesoLegible(peso: string | number): string {
  return Number(peso).toLocaleString('es-ES', { maximumFractionDigits: 2 })
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
