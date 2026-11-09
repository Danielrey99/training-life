/**
 * Cuentas con fechas 'YYYY-MM-DD' (las `date` de Python) sin usar `Date`.
 *
 * `Date` mezcla la hora y la zona del teléfono, y en los bordes falla: `new Date(1, 0, 3)`
 * es del año 1901. Aquí una fecha es un número de días desde el 1 de enero del año 1
 * (el `toordinal()` de Python, que va de 1 a 3652059), y se pasa de una forma a otra con
 * la cuenta del calendario gregoriano.
 */

export const PRIMERA = '0001-01-01'
export const ULTIMA = '9999-12-31'
const ORDINAL_MIN = 1
const ORDINAL_MAX = 3652059

const FORMA = /^(\d{4})-(\d{2})-(\d{2})$/

export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0
}

export function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28
  return [4, 6, 9, 11].includes(mes) ? 30 : 31
}

/** Las partes de una fecha, o `null` si no es una fecha que exista. */
export function partes(iso: string): { anio: number; mes: number; dia: number } | null {
  const m = FORMA.exec(iso)
  if (!m) return null
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (anio < 1 || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return null
  return { anio, mes, dia }
}

export function esFecha(iso: string): boolean {
  return partes(iso) !== null
}

function partesSeguras(iso: string) {
  const p = partes(iso)
  if (!p) throw new Error(`No es una fecha: ${iso}`)
  return p
}

export function componer(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** `date.toordinal()`: el 1 de enero del año 1 es el 1. */
export function aOrdinal(iso: string): number {
  const { anio, mes, dia } = partesSeguras(iso)
  const a = anio - 1
  let n = a * 365 + Math.floor(a / 4) - Math.floor(a / 100) + Math.floor(a / 400)
  for (let m = 1; m < mes; m++) n += diasDelMes(anio, m)
  return n + dia
}

/** `date.fromordinal(n)`. */
export function desdeOrdinal(n: number): string {
  if (!Number.isInteger(n) || n < ORDINAL_MIN || n > ORDINAL_MAX) {
    throw new RangeError(`Fecha fuera del calendario: ${n}`)
  }
  // Bloques de 400 años (146097 días), de 100, de 4 y de 1, como `_ord2ymd` de CPython.
  let resto = n - 1
  const n400 = Math.floor(resto / 146097)
  resto %= 146097
  const n100 = Math.floor(resto / 36524)
  resto %= 36524
  const n4 = Math.floor(resto / 1461)
  resto %= 1461
  const n1 = Math.floor(resto / 365)
  resto %= 365
  const anio = n400 * 400 + n100 * 100 + n4 * 4 + n1 + 1
  // El último día de un bloque de 400 o de 4 años se sale de la cuenta: es el 31 de
  // diciembre (de un bisiesto) del año anterior.
  if (n1 === 4 || n100 === 4) return componer(anio - 1, 12, 31)
  let mes = 1
  while (resto >= diasDelMes(anio, mes)) {
    resto -= diasDelMes(anio, mes)
    mes++
  }
  return componer(anio, mes, resto + 1)
}

/** La fecha `dias` días después (o antes, si es negativo). Lanza fuera de 0001-9999. */
export function sumarDias(iso: string, dias: number): string {
  return desdeOrdinal(aOrdinal(iso) + dias)
}

/** Como `sumarDias`, pero se queda en el 1 de enero del año 1 o en el 31-12-9999. */
export function sumarDiasSinSalirse(iso: string, dias: number): string {
  const n = Math.min(Math.max(aOrdinal(iso) + dias, ORDINAL_MIN), ORDINAL_MAX)
  return desdeOrdinal(n)
}

/** `b - a` en días. */
export function diasEntre(a: string, b: string): number {
  return aOrdinal(b) - aOrdinal(a)
}

/** 1 = lunes … 7 = domingo (`isoweekday()`). El 1-1-0001 fue lunes. */
export function diaDeLaSemana(iso: string): number {
  return ((aOrdinal(iso) - 1) % 7) + 1
}

/** El lunes de la semana de esa fecha (sin salirse del calendario). */
export function lunesDe(iso: string): string {
  return sumarDiasSinSalirse(iso, 1 - diaDeLaSemana(iso))
}

/** El día 1 del mes de esa fecha. */
export function primeroDelMes(iso: string): string {
  const { anio, mes } = partesSeguras(iso)
  return componer(anio, mes, 1)
}

export function anioDe(iso: string): number {
  return partesSeguras(iso).anio
}

export function menor(a: string, b: string): string {
  return a <= b ? a : b
}

export function mayor(a: string, b: string): string {
  return a >= b ? a : b
}
