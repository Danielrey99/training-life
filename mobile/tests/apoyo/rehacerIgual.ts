/**
 * Un paso de ensayo que rehace una tabla con su mismo `CREATE`, sacado de `sqlite_schema`:
 * la tabla queda igual que estaba, así que cualquier diferencia en los datos después es una
 * pérdida. Es lo que hará una v2 de verdad, pero cambiando algo del cuerpo.
 */
import type { Bd } from '../../src/logica/bd/bd'
import { rehacerTabla } from '../../src/logica/bd/rehacer'

/** El SQL de `rehacerTabla` para dejar `tabla` exactamente como está, con sus índices y su disparador. */
export function rehacerIgual(bd: Bd, tabla: string): string {
  const crear = bd.una<{ sql: string }>(
    "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
    tabla,
  )
  if (crear === undefined) throw new Error(`No hay ninguna tabla ${tabla}.`)
  // `CREATE TABLE x (…) STRICT`: lo de dentro de los paréntesis, sin el STRICT, que lo pone
  // `rehacerTabla`.
  const cuerpo = crear.sql.slice(crear.sql.indexOf('(') + 1, crear.sql.lastIndexOf(')'))
  const columnas = Object.fromEntries(
    bd
      .todas<{ name: string }>('SELECT name FROM pragma_table_info(?)', tabla)
      .map(({ name }) => [name, name]),
  )
  // Los de las restricciones UNIQUE (`sqlite_autoindex_…`) no tienen SQL: los crea la tabla.
  const indices = bd
    .todas<{ sql: string }>(
      "SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL" +
        ' ORDER BY name',
      tabla,
    )
    .map((f) => f.sql)
  const disparadores = bd.todas<{ sql: string }>(
    "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?",
    tabla,
  )
  if (disparadores.length > 1) throw new Error(`${tabla} tiene más de un disparador.`)
  return rehacerTabla({
    tabla,
    cuerpo,
    columnas,
    indices,
    // Tal cual sale de `sqlite_schema`, sin el `;` final: `rehacerTabla` se lo pone.
    disparador: disparadores[0]?.sql,
  })
}
