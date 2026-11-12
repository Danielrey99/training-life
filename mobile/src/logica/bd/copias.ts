/**
 * La copia de la base que se guarda antes de ponerla al día: si algo saliera mal, el archivo
 * de antes sigue entero, con su forma vieja, y se puede recuperar desde el PC con el código
 * de su versión. No se mete nunca a la fuerza en una base de otra versión.
 *
 * Aquí solo lo que es igual en el teléfono y en los tests: copiar con SQL y decidir qué copias
 * sobran. Dónde se guardan y cómo se borran los archivos es cosa de la plataforma.
 */
import type { Bd } from './bd'

/** No se ha podido copiar la base o la copia no cuadra: no se pone al día. */
export class SinCopia extends Error {
  constructor(readonly causa: unknown) {
    super(
      `No se ha podido guardar la copia: ${causa instanceof Error ? causa.message : String(causa)}`,
    )
    this.name = 'SinCopia'
  }
}

function recuentos(bd: Bd, esquema: 'main' | 'copia'): Map<string, number> {
  const tablas = bd.todas<{ name: string }>(
    `SELECT name FROM ${esquema}.sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  )
  return new Map(
    tablas.map(({ name }) => [
      name,
      bd.una<{ n: number }>(`SELECT COUNT(*) AS n FROM ${esquema}."${name.replace(/"/g, '""')}"`)
        ?.n ?? 0,
    ]),
  )
}

/**
 * Copia la base entera en `ruta` (que no debe existir: la borra quien llama) y comprueba que
 * la copia tiene las mismas tablas y filas, la misma versión y que está sana. `VACUUM INTO`
 * copia también lo que esté aún en el archivo `-wal`.
 */
export function copiarBase(bd: Bd, ruta: string): void {
  if (bd.enTransaccion) throw new Error('La base no se copia dentro de una transacción.')
  try {
    bd.ejecutar('VACUUM INTO ?', ruta)
    bd.ejecutar('ATTACH DATABASE ? AS copia', ruta)
    try {
      const original = recuentos(bd, 'main')
      const copia = recuentos(bd, 'copia')
      for (const [tabla, filas] of original) {
        if (copia.get(tabla) !== filas) {
          throw new Error(
            `la tabla ${tabla} tiene ${filas} filas y en la copia ${copia.get(tabla) ?? 0}`,
          )
        }
      }
      const version = (esquema: string) =>
        bd.una<{ user_version: number }>(`PRAGMA ${esquema}.user_version`)?.user_version
      if (version('copia') !== version('main')) throw new Error('la copia es de otra versión')
      const sana = bd.una<{ quick_check: string }>('PRAGMA copia.quick_check')?.quick_check
      if (sana !== 'ok') throw new Error(`la copia está dañada: ${sana}`)
    } finally {
      bd.ejecutarVarias('DETACH DATABASE copia')
    }
  } catch (error) {
    throw new SinCopia(error)
  }
}

/** El nombre de la copia de antes de poner la base en la versión `hasta`. */
export function nombreDeLaCopia(hasta: number): string {
  return `antes-de-la-v${hasta}.db`
}

const COPIA = /^antes-de-la-v(\d+)\.db$/

/** Las copias que hay que borrar: se quedan las `quedarse` de versiones más altas. */
export function copiasQueSobran(nombres: string[], quedarse = 2): string[] {
  return nombres
    .map((nombre) => ({ nombre, version: Number(COPIA.exec(nombre)?.[1] ?? NaN) }))
    .filter((copia) => Number.isInteger(copia.version))
    .sort((a, b) => b.version - a.version)
    .slice(quedarse)
    .map((copia) => copia.nombre)
}
