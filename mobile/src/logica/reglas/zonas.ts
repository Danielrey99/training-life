/**
 * Las zonas horarias: la del teléfono, y la que trae un archivo exportado en otro sitio.
 * Copia de `hoy_en` y `zona_horaria` de `backend/app/fechas.py`, con `Intl` en vez de
 * `zoneinfo`.
 */
import { componer } from './dias'

const VALIDAS = new Map<string, boolean>()

/**
 * Si `nombre` es una zona que se conoce (`Europe/Madrid`). Rechaza otra forma de escribir
 * una zona canónica (`europe/madrid`), como el backend.
 *
 * Diferencia a propósito con el backend: sin la base de datos de zonas no se puede saber
 * si un alias está bien escrito, y aquí se acepta lo que `Intl` entienda aunque Python no
 * lo tenga: un alias con otras mayúsculas (`US/EASTERN`) o un nombre antiguo (`Gmt`,
 * `SystemV/AST4`). Funciona igual (Intl lo entiende), y una zona que no se reconoce
 * bloquea la importación entera: es mejor pasarse de tolerante que rechazar un archivo
 * bueno.
 */
export function zonaValida(nombre: string): boolean {
  const guardada = VALIDAS.get(nombre)
  if (guardada !== undefined) return guardada
  let valida: boolean
  try {
    const formato = new Intl.DateTimeFormat('en-US', { timeZone: nombre })
    const resuelta = formato.resolvedOptions().timeZone
    // `Intl` devuelve el nombre canónico: un alias válido («US/Eastern») resuelve a otro
    // nombre, y una variante en minúsculas también. Se acepta si coincide o si es un alias
    // escrito tal cual en la lista de zonas que conoce.
    const otraMayuscula = resuelta !== nombre && resuelta.toLowerCase() === nombre.toLowerCase()
    valida =
      resuelta === nombre ||
      zonasConocidas().has(nombre) ||
      (!otraMayuscula && esAliasExacto(nombre))
  } catch {
    valida = false
  }
  VALIDAS.set(nombre, valida)
  return valida
}

function zonasConocidas(): Set<string> {
  const lista = (Intl as { supportedValuesOf?: (clave: string) => string[] }).supportedValuesOf
  return new Set(lista ? lista('timeZone') : [])
}

// Un alias se reconoce porque su forma es la de una zona («Area/Lugar» con mayúsculas en su
// sitio) y `Intl` lo acepta. No se puede distinguir de una variante en minúsculas de otra
// forma sin la base de datos de zonas.
function esAliasExacto(nombre: string): boolean {
  return /^([A-Z][A-Za-z0-9_+-]*)(\/[A-Z0-9][A-Za-z0-9_+-]*)*$/.test(nombre) || nombre === 'UTC'
}

/** El día de hoy en esa zona, para el instante `ahora`. */
export function hoyEn(zona: string, ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(ahora)
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value)
  return componer(valor('year'), valor('month'), valor('day'))
}
