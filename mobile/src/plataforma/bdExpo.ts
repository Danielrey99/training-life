/**
 * La base de datos del teléfono, sobre expo-sqlite. Se usa su API síncrona: la lógica es
 * síncrona para que nada se cuele en medio de una transacción.
 */
import { openDatabaseSync, type SQLiteBindValue } from 'expo-sqlite'

import { crearBd, type Bd, type Motor, type Valor } from '../logica/bd/bd'

export const NOMBRE_DEL_ARCHIVO = 'training-life.db'

function aExpo(params: Valor[]): SQLiteBindValue[] {
  // expo-sqlite no acepta bigint: los enteros de la app caben de sobra en un number.
  return params.map((p) => (typeof p === 'bigint' ? Number(p) : p))
}

/** Abre la base del teléfono (o una en memoria, para la autocomprobación). */
export function abrirBdExpo(nombre: string = NOMBRE_DEL_ARCHIVO): Bd {
  const bd = openDatabaseSync(nombre)
  const motor: Motor = {
    exec: (sql) => bd.execSync(sql),
    run: (sql, params) => {
      const r = bd.runSync(sql, aExpo(params))
      return { changes: r.changes, lastInsertRowid: r.lastInsertRowId }
    },
    all: (sql, params) => bd.getAllSync(sql, aExpo(params)),
    get: (sql, params) => bd.getFirstSync(sql, aExpo(params)),
  }
  return crearBd(motor)
}
