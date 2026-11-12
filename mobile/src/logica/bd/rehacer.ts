/**
 * Rehacer una tabla para cambiarle algo que SQLite no deja cambiar con `ALTER TABLE` (un
 * CHECK, una clave ajena, el tipo de una columna): el procedimiento oficial de SQLite
 * («Making Other Kinds Of Table Schema Changes», en la página de ALTER TABLE).
 *
 * Va siempre en un paso con `sinClavesAjenas: true`: con las claves encendidas, borrar la
 * tabla vieja borraría en cascada sus hijas. `aplicarMigraciones` comprueba después que no
 * falta ninguna fila, índice, disparador ni secuencia.
 */

export interface TablaRehecha {
  /** El nombre de la tabla, que no cambia. */
  tabla: string
  /** Lo que va entre los paréntesis del `CREATE TABLE`: columnas y restricciones. */
  cuerpo: string
  /** Cada columna de la tabla nueva y de dónde sale su valor (una expresión sobre la vieja). */
  columnas: Record<string, string>
  /** Sus `CREATE INDEX`, que se van con la tabla vieja. */
  indices: string[]
  /** Su `CREATE TRIGGER` de `updated_at`, si lo tiene. */
  disparador?: string
}

const NOMBRE = /^[a-z_][a-z0-9_]*$/

export function rehacerTabla({
  tabla,
  cuerpo,
  columnas,
  indices,
  disparador,
}: TablaRehecha): string {
  // Los nombres se escriben tal cual en el SQL: solo los de este código, en minúsculas.
  for (const nombre of [tabla, ...Object.keys(columnas)]) {
    if (!NOMBRE.test(nombre)) throw new Error(`Nombre no válido para rehacer una tabla: ${nombre}`)
  }
  const nueva = `${tabla}__nueva`
  const destino = Object.keys(columnas).join(', ')
  const origen = Object.values(columnas).join(', ')
  return [
    // El salto de línea antes del paréntesis: si el cuerpo acaba en un comentario `--`, el
    // cierre no se queda dentro de él.
    `CREATE TABLE ${nueva} (${cuerpo}\n) STRICT;`,
    `INSERT INTO ${nueva} (${destino}) SELECT ${origen} FROM ${tabla};`,
    // La secuencia de ids sigue donde iba, aunque los últimos se borraran: un id borrado
    // no se reutiliza. Al insertar, SQLite la pone en el id más alto copiado; aquí sube a la
    // de la vieja si era mayor, o se crea si la tabla estaba vacía.
    `UPDATE sqlite_sequence SET seq = max(seq, (SELECT seq FROM sqlite_sequence WHERE name = '${tabla}')) WHERE name = '${nueva}' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '${tabla}');`,
    `INSERT INTO sqlite_sequence (name, seq) SELECT '${nueva}', seq FROM sqlite_sequence WHERE name = '${tabla}' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '${nueva}');`,
    `DROP TABLE ${tabla};`,
    // Se renombra la nueva, nunca la vieja: al renombrar la vieja, SQLite cambiaría las
    // claves ajenas de sus hijas para que apuntaran al nombre viejo.
    `ALTER TABLE ${nueva} RENAME TO ${tabla};`,
    // `sqlite_schema` los guarda sin el `;` del final, y sin él la sentencia siguiente del
    // paso (otra tabla rehecha) se pegaría a esta.
    ...[...indices, ...(disparador ? [disparador] : [])].map((sentencia) =>
      sentencia.trim().endsWith(';') ? sentencia : `${sentencia};`,
    ),
  ].join('\n')
}
