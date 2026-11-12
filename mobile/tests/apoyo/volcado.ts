/**
 * Volcar una base del teléfono a SQL y cargarla otra vez: para congelar una base de una
 * versión (`tests/fijos/base_v1.sql`) y comprobar que las migraciones de las versiones
 * siguientes la ponen al día sin perder nada.
 *
 * El volcado son solo datos: un `INSERT` por fila, tabla a tabla, con los padres antes que
 * los hijos (así se carga con las claves ajenas activadas), y al final las filas de
 * `sqlite_sequence`, para que un id borrado tampoco se reutilice en la base cargada. El
 * esquema no va: se carga sobre una base recién creada con las migraciones de su versión.
 *
 * Cada fila va en una línea, en el orden de sus ids: un cambio en los datos se ve en el diff.
 * Los saltos de línea de un texto se escriben con `char(10)` para no partir la fila.
 */
import { join } from 'node:path'

import type { Bd } from '../../src/logica/bd/bd'
import { aplicarMigraciones, MIGRACIONES, versionDeLaBase } from '../../src/logica/bd/migraciones'
import { abrirBdNode } from './bdNode'

/** La base v1 sintética congelada (en git). */
export const BASE_V1 = join(__dirname, '..', 'fijos', 'base_v1.sql')

/** La base v1 con los datos reales del autor (local, fuera de git). */
export const BASE_V1_REAL = join(
  __dirname,
  '..',
  '..',
  '..',
  '.claude',
  'datos_reales',
  'base_v1_real_2026_11_10.sql',
)

const CABECERA = '-- Volcado de la base del teléfono, versión '

interface Columna {
  name: string
}

/** Las tablas de datos (sin las internas de SQLite), con los padres antes que los hijos. */
export function tablasEnOrden(bd: Bd): string[] {
  const tablas = bd
    .todas<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" +
        ' ORDER BY name',
    )
    .map((t) => t.name)
  const padres = new Map<string, Set<string>>(
    tablas.map((tabla) => [
      tabla,
      new Set(
        bd
          .todas<{ table: string }>('SELECT "table" FROM pragma_foreign_key_list(?)', tabla)
          .map((fk) => fk.table)
          // Una tabla que se apunta a sí misma no espera a nadie (hoy no hay ninguna).
          .filter((padre) => padre !== tabla),
      ),
    ]),
  )
  const orden: string[] = []
  const puestas = new Set<string>()
  while (orden.length < tablas.length) {
    // De las que ya tienen puestos todos sus padres, la primera por nombre: así el orden no
    // depende de cómo devuelva SQLite el esquema.
    const siguiente = tablas.find(
      (tabla) => !puestas.has(tabla) && [...padres.get(tabla)!].every((p) => puestas.has(p)),
    )
    if (siguiente === undefined) {
      throw new Error('Las claves ajenas forman un ciclo: no hay un orden de padres a hijos.')
    }
    orden.push(siguiente)
    puestas.add(siguiente)
  }
  return orden
}

/** Un valor como literal de SQL, que al cargarlo da exactamente el mismo valor y tipo. */
function literal(valor: unknown): string {
  if (valor === null || valor === undefined) return 'NULL'
  if (typeof valor === 'bigint') return valor.toString()
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`No se puede volcar el número ${valor}.`)
    // `String` de un número de JS se vuelve a leer como el mismo número. Uno entero de una
    // columna REAL saldría sin decimales, pero STRICT lo vuelve a guardar como REAL.
    return String(valor)
  }
  if (typeof valor === 'string') {
    const partes = valor.split(/(\r|\n)/).map((trozo) => {
      if (trozo === '\n') return 'char(10)'
      if (trozo === '\r') return 'char(13)'
      return `'${trozo.replaceAll("'", "''")}'`
    })
    return partes.length === 1 ? partes[0] : partes.join(' || ')
  }
  throw new Error(`No se sabe volcar un valor de tipo ${typeof valor}.`)
}

function columnasDe(bd: Bd, tabla: string): string[] {
  return bd.todas<Columna>('SELECT name FROM pragma_table_info(?)', tabla).map((c) => c.name)
}

/** La base entera (sus datos, no su esquema) como SQL que entiende `cargarVolcado`. */
export function volcar(bd: Bd): string {
  const lineas: string[] = [`${CABECERA}${versionDeLaBase(bd)}.`]
  for (const tabla of tablasEnOrden(bd)) {
    const columnas = columnasDe(bd, tabla)
    const orden = columnas.includes('id') ? 'id' : columnas.map((_, i) => i + 1).join(', ')
    const filas = bd.todas<Record<string, unknown>>(`SELECT * FROM ${tabla} ORDER BY ${orden}`)
    lineas.push('', `-- ${tabla}: ${filas.length} filas`)
    for (const fila of filas) {
      const valores = columnas.map((c) => literal(fila[c])).join(', ')
      lineas.push(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${valores});`)
    }
  }
  const secuencias = bd.todas<{ name: string; seq: number }>(
    'SELECT name, seq FROM sqlite_sequence ORDER BY name',
  )
  // Después de las filas: cada INSERT con id sube la secuencia a ese id, y aquí se deja en la
  // que tenía, que puede ser mayor si se borraron los últimos.
  lineas.push('', '-- sqlite_sequence', 'DELETE FROM sqlite_sequence;')
  for (const { name, seq } of secuencias) {
    lineas.push(`INSERT INTO sqlite_sequence (name, seq) VALUES (${literal(name)}, ${seq});`)
  }
  return lineas.join('\n') + '\n'
}

/** La versión del esquema que dice la cabecera del volcado. */
export function versionDelVolcado(sql: string): number {
  const m = /^-- Volcado de la base del teléfono, versión (\d+)\./.exec(sql)
  if (m === null) throw new Error('Esto no es un volcado de `volcar` (le falta la cabecera).')
  return Number(m[1])
}

/**
 * Una base nueva con el esquema de esa versión y sin datos (sin la siembra de los
 * predefinidos: van en el volcado, con sus ids).
 */
export function baseVaciaEnLaVersion(version: number): Bd {
  const pasos = MIGRACIONES.filter((m) => m.version <= version)
  if (pasos.length === 0 || pasos[pasos.length - 1].version !== version) {
    throw new Error(`No hay ningún paso de migración que deje la base en la versión ${version}.`)
  }
  const bd = abrirBdNode()
  // Con la lista cortada en esa versión, la «última» para `aplicarMigraciones` es la del
  // volcado: la base queda como la de un teléfono que aún no ha recibido las siguientes.
  aplicarMigraciones(bd, pasos)
  return bd
}

/**
 * Carga el volcado en `bd`, que tiene que ser una base recién creada en la versión del
 * volcado y sin filas (`baseVaciaEnLaVersion`). Todo o nada, con las claves ajenas activadas.
 */
export function cargarVolcado(bd: Bd, sql: string): void {
  const version = versionDelVolcado(sql)
  if (versionDeLaBase(bd) !== version) {
    throw new Error(
      `El volcado es de la versión ${version} y la base está en la ${versionDeLaBase(bd)}.`,
    )
  }
  const conFilas = tablasEnOrden(bd).filter(
    (tabla) => bd.una(`SELECT 1 FROM ${tabla} LIMIT 1`) !== undefined,
  )
  if (conFilas.length > 0) {
    throw new Error(
      `La base ya tiene datos en ${conFilas.join(', ')}: no es una base recién creada.`,
    )
  }
  bd.transaccion(() => bd.ejecutarVarias(sql))
}
