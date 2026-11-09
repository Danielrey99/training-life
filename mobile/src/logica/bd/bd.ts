/**
 * La base de datos tal y como la ve la lógica: SQL a mano con parámetros, sin ORM.
 *
 * La misma lógica corre en el teléfono (expo-sqlite) y en los tests (node:sqlite). Cada
 * uno pone un `Motor` con lo mínimo, y `crearBd` le añade lo que tiene que ser igual en
 * los dos: las claves ajenas activadas y comprobadas, y las transacciones.
 */

/** Lo que se puede pasar como parámetro de una sentencia. */
export type Valor = string | number | bigint | null

/** Lo mínimo que tiene que saber hacer cada SQLite (el del teléfono y el de los tests). */
export interface Motor {
  /** Una o varias sentencias sin parámetros (el esquema, los PRAGMA). */
  exec(sql: string): void
  run(sql: string, params: Valor[]): { changes: number; lastInsertRowid: number | bigint }
  all(sql: string, params: Valor[]): unknown[]
  get(sql: string, params: Valor[]): unknown
}

export interface Bd {
  /** Una sentencia que escribe. Devuelve cuántas filas tocó y el id de la última insertada. */
  ejecutar(sql: string, ...params: Valor[]): { cambios: number; ultimoId: number }
  /** Varias sentencias seguidas, sin parámetros: solo para el esquema y las migraciones. */
  ejecutarVarias(sql: string): void
  todas<T>(sql: string, ...params: Valor[]): T[]
  /** La primera fila, o `undefined` si no hay ninguna. */
  una<T>(sql: string, ...params: Valor[]): T | undefined
  /**
   * Hace `fn` entera o nada: si lanza, deshace lo que hubiera escrito y vuelve a lanzar.
   * Es lo que en el backend es una petición (una sesión y un `commit()`). No se anidan:
   * una llamada a la api es una transacción, y lo que llama por dentro ya está en ella.
   */
  transaccion<T>(fn: () => T): T
  readonly enTransaccion: boolean
}

export function crearBd(motor: Motor): Bd {
  // Sin esto, SQLite no aplica ni los CASCADE ni los RESTRICT: hay que activarlo en cada
  // conexión, fuera de una transacción, y comprobar que ha cogido.
  motor.exec('PRAGMA foreign_keys = ON')
  const fk = motor.get('PRAGMA foreign_keys', []) as { foreign_keys: number } | undefined
  if (fk?.foreign_keys !== 1) {
    throw new Error('Esta base de datos no admite claves ajenas (PRAGMA foreign_keys).')
  }
  motor.exec('PRAGMA journal_mode = WAL')

  let enTransaccion = false
  return {
    ejecutar(sql, ...params) {
      const r = motor.run(sql, params)
      return { cambios: r.changes, ultimoId: Number(r.lastInsertRowid) }
    },
    ejecutarVarias(sql) {
      motor.exec(sql)
    },
    todas<T>(sql: string, ...params: Valor[]) {
      return motor.all(sql, params) as T[]
    },
    una<T>(sql: string, ...params: Valor[]) {
      // expo-sqlite da null y node:sqlite undefined cuando no hay fila: aquí, siempre undefined.
      return (motor.get(sql, params) ?? undefined) as T | undefined
    },
    transaccion(fn) {
      if (enTransaccion) throw new Error('Las transacciones no se anidan.')
      // IMMEDIATE: coge el cerrojo de escritura al empezar, y no a la mitad.
      motor.exec('BEGIN IMMEDIATE')
      enTransaccion = true
      try {
        const resultado = fn()
        motor.exec('COMMIT')
        return resultado
      } catch (error) {
        try {
          motor.exec('ROLLBACK')
        } catch {
          // SQLite ya la deshizo por su cuenta (disco lleno, por ejemplo): lo que importa
          // es el error de verdad, no que el ROLLBACK no encuentre transacción.
        }
        throw error
      } finally {
        enTransaccion = false
      }
    },
    get enTransaccion() {
      return enTransaccion
    },
  }
}
