/**
 * La base de datos del teléfono, sobre expo-sqlite. Se usa su API síncrona: la lógica es
 * síncrona para que nada se cuele en medio de una transacción.
 */
import { openDatabaseSync, type SQLiteBindValue, type SQLiteDatabase } from 'expo-sqlite'

import { crearBd, type Bd, type Motor, type Valor } from '../logica/bd/bd'

export const NOMBRE_DEL_ARCHIVO = 'training-life.db'

function aExpo(params: Valor[]): SQLiteBindValue[] {
  // expo-sqlite no acepta bigint: los enteros de la app caben de sobra en un number.
  return params.map((p) => (typeof p === 'bigint' ? Number(p) : p))
}

function motorDe(bd: SQLiteDatabase): Motor {
  return {
    exec: (sql) => bd.execSync(sql),
    run: (sql, params) => {
      const r = bd.runSync(sql, aExpo(params))
      return { changes: r.changes, lastInsertRowid: r.lastInsertRowId }
    },
    all: (sql, params) => bd.getAllSync(sql, aExpo(params)),
    get: (sql, params) => bd.getFirstSync(sql, aExpo(params)),
  }
}

/** Abre una base por su nombre (la autocomprobación usa una en memoria, `:memory:`). */
export function abrirBdExpo(nombre: string = NOMBRE_DEL_ARCHIVO): Bd {
  return crearBd(motorDe(openDatabaseSync(nombre)))
}

export interface BaseAbierta {
  bd: Bd
  /** La ruta del archivo en el teléfono, sin `file://`: la que necesita SQLite para copiarlo. */
  ruta: string
  cerrar: () => void
}

/** Abre la base del teléfono sabiendo dónde está su archivo, para copiarlo o compartirlo. */
export function abrirArchivoDeLaBase(): BaseAbierta {
  const nativa = openDatabaseSync(NOMBRE_DEL_ARCHIVO)
  try {
    return {
      bd: crearBd(motorDe(nativa)),
      ruta: decodeURIComponent(nativa.databasePath.replace(/^file:\/\//, '')),
      cerrar: () => nativa.closeSync(),
    }
  } catch (error) {
    nativa.closeSync()
    throw error
  }
}
