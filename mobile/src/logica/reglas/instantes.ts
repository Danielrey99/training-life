/**
 * Comparar instantes ISO con zona («2026-09-01T10:00:00.123456+02:00», «…Z»).
 *
 * Los importados se guardan tal cual llegan, así que en la base conviven zonas distintas y
 * compararlos como texto los desordenaría; `Date.parse` tampoco sirve, porque pierde los
 * microsegundos que sí ordena PostgreSQL. Aquí se pasan a microsegundos desde 1970 en
 * `BigInt`, con la aritmética de días de `dias.ts`.
 */
import { aOrdinal } from './dias'

const INSTANTE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|([+-])(\d{2}):?(\d{2}))?$/

const ORDINAL_1970 = aOrdinal('1970-01-01')

/** Microsegundos desde el 1-1-1970 UTC. Sin zona, se toma como UTC. */
export function enMicrosegundos(iso: string): bigint {
  const m = INSTANTE.exec(iso)
  if (!m) throw new Error(`No es un instante: ${iso}`)
  const dias = BigInt(aOrdinal(m[1]) - ORDINAL_1970)
  let segundos = dias * 86400n + BigInt(Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0))
  if (m[7]) {
    const desfase = BigInt(Number(m[8]) * 3600 + Number(m[9]) * 60)
    segundos += m[7] === '+' ? -desfase : desfase
  }
  return segundos * 1_000_000n + BigInt((m[5] ?? '').padEnd(6, '0'))
}

/** Negativo si `a` es antes que `b`, positivo si después y 0 si es el mismo instante. */
export function compararInstantes(a: string, b: string): number {
  const x = enMicrosegundos(a)
  const y = enMicrosegundos(b)
  return x < y ? -1 : x > y ? 1 : 0
}
