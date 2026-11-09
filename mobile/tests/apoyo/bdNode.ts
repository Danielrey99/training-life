/**
 * La base de los tests: el mismo `crearBd` que usa el teléfono, sobre el SQLite que trae
 * Node (`node:sqlite`) en vez de expo-sqlite.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { crearBd, type Bd, type Motor, type Valor } from '../../src/logica/bd/bd'

/**
 * Los parámetros tal y como los quiere node:sqlite. Los numerados (`?1`, repetidos o no)
 * node:sqlite 22 no los enlaza por posición («column index out of range»), pero sí por
 * nombre: `{ '1': valor }`. Los `?` sueltos van por posición, como siempre.
 */
function parametros(sql: string, params: Valor[]): SQLInputValue[] {
  if (!/\?\d/.test(sql)) return params
  const porNumero: Record<string, SQLInputValue> = {}
  params.forEach((valor, i) => {
    porNumero[String(i + 1)] = valor
  })
  return [porNumero as unknown as SQLInputValue]
}

/** Un `Motor` sobre una conexión de `node:sqlite`. */
export function motorNode(conexion: DatabaseSync): Motor {
  return {
    exec(sql) {
      conexion.exec(sql)
    },
    run(sql, params) {
      const r = conexion.prepare(sql).run(...parametros(sql, params))
      return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }
    },
    // Objetos normales, como los de expo-sqlite (node:sqlite los da sin prototipo).
    all(sql, params) {
      return conexion
        .prepare(sql)
        .all(...parametros(sql, params))
        .map((fila) => ({ ...fila }))
    },
    get(sql, params) {
      const fila = conexion.prepare(sql).get(...parametros(sql, params))
      return fila === undefined ? undefined : { ...fila }
    },
  }
}

/** Abre una base (en memoria si no se dice otra cosa) con `crearBd`. */
export function abrirBdNode(ruta = ':memory:'): Bd {
  return crearBd(motorNode(new DatabaseSync(ruta)))
}
