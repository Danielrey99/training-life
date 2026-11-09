/**
 * Tests de `crearBd`: lo que tiene que ser igual en el teléfono y en los tests (claves
 * ajenas y transacciones), probado sobre node:sqlite.
 */
import { crearBd, type Motor } from '../../src/logica/bd/bd'
import { abrirBdNode } from '../apoyo/bdNode'

function conMeta() {
  const bd = abrirBdNode()
  bd.ejecutarVarias('CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL) STRICT')
  return bd
}

const filas = (bd: ReturnType<typeof conMeta>) =>
  bd.todas<{ clave: string }>('SELECT clave FROM meta')

test('transaccion_guarda_lo_escrito_y_devuelve_lo_que_devuelve_fn', () => {
  const bd = conMeta()

  const resultado = bd.transaccion(() => {
    bd.ejecutar("INSERT INTO meta VALUES ('a', '1')")
    return 42
  })

  expect(resultado).toBe(42)
  expect(filas(bd)).toEqual([{ clave: 'a' }])
  expect(bd.enTransaccion).toBe(false)
})

test('transaccion_deshace_todo_si_fn_lanza_y_relanza_el_mismo_error', () => {
  const bd = conMeta()
  bd.ejecutar("INSERT INTO meta VALUES ('antes', '1')")
  const error = new Error('a mitad')

  let lanzado: unknown
  try {
    bd.transaccion(() => {
      bd.ejecutar("INSERT INTO meta VALUES ('a', '1')")
      bd.ejecutar("UPDATE meta SET valor = '2' WHERE clave = 'antes'")
      throw error
    })
  } catch (e) {
    lanzado = e
  }

  expect(lanzado).toBe(error)
  expect(bd.todas('SELECT clave, valor FROM meta')).toEqual([{ clave: 'antes', valor: '1' }])
  expect(bd.enTransaccion).toBe(false)
})

test('transaccion_deshace_lo_escrito_antes_de_una_sentencia_que_choca_con_la_base', () => {
  const bd = conMeta()

  expect(() =>
    bd.transaccion(() => {
      bd.ejecutar("INSERT INTO meta VALUES ('a', '1')")
      bd.ejecutar("INSERT INTO meta VALUES ('a', '2')") // clave repetida
    }),
  ).toThrow(/UNIQUE/)

  expect(filas(bd)).toEqual([])
})

test('si_el_rollback_falla_sale_el_error_de_fn_y_no_el_del_rollback', () => {
  // Como cuando SQLite ya deshizo la transacción por su cuenta (disco lleno): el ROLLBACK
  // no encuentra transacción y lanza. Antes, ese error tapaba al de verdad.
  const ordenes: string[] = []
  const motor: Motor = {
    exec: (sql) => {
      ordenes.push(sql)
      if (sql === 'ROLLBACK') throw new Error('cannot rollback - no transaction is active')
    },
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    all: () => [],
    get: () => ({ foreign_keys: 1 }),
  }
  const bd = crearBd(motor)
  const error = new Error('database or disk is full')

  let lanzado: unknown
  try {
    bd.transaccion(() => {
      throw error
    })
  } catch (e) {
    lanzado = e
  }

  expect(lanzado).toBe(error)
  expect(ordenes).toContain('ROLLBACK')
  expect(bd.enTransaccion).toBe(false)
})

test('las_transacciones_no_se_anidan_y_la_de_fuera_se_deshace', () => {
  const bd = conMeta()

  expect(() =>
    bd.transaccion(() => {
      bd.ejecutar("INSERT INTO meta VALUES ('a', '1')")
      bd.transaccion(() => bd.ejecutar("INSERT INTO meta VALUES ('b', '1')"))
    }),
  ).toThrow('Las transacciones no se anidan.')

  expect(filas(bd)).toEqual([])
  expect(bd.enTransaccion).toBe(false)
  // Y la base sigue sirviendo para otra transacción.
  bd.transaccion(() => bd.ejecutar("INSERT INTO meta VALUES ('c', '1')"))
  expect(filas(bd)).toEqual([{ clave: 'c' }])
})

test('en_transaccion_es_verdadero_solo_dentro', () => {
  const bd = conMeta()
  let dentro: boolean | undefined

  bd.transaccion(() => {
    dentro = bd.enTransaccion
  })

  expect(dentro).toBe(true)
  expect(bd.enTransaccion).toBe(false)
})

test('una_devuelve_undefined_sin_filas', () => {
  const bd = conMeta()

  expect(bd.una("SELECT * FROM meta WHERE clave = 'no'")).toBeUndefined()
})

test('una_devuelve_undefined_aunque_el_motor_de_null_como_expo_sqlite', () => {
  const motor: Motor = {
    exec: () => {},
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    all: () => [],
    get: (sql) => (sql === 'PRAGMA foreign_keys' ? { foreign_keys: 1 } : null),
  }

  expect(crearBd(motor).una('SELECT 1 WHERE 0')).toBeUndefined()
})

test('ejecutar_devuelve_las_filas_cambiadas_y_el_ultimo_id', () => {
  const bd = abrirBdNode()
  bd.ejecutarVarias('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER) STRICT')
  bd.ejecutar('INSERT INTO t (x) VALUES (?)', 1)

  expect(bd.ejecutar('INSERT INTO t (x) VALUES (?)', 2)).toEqual({ cambios: 1, ultimoId: 2 })
  expect(bd.ejecutar('UPDATE t SET x = 0').cambios).toBe(2)
})

test('abrir_una_base_activa_las_claves_ajenas', () => {
  const bd = abrirBdNode()

  expect(bd.una('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 })
})

test('abrir_una_base_que_no_admite_claves_ajenas_lanza', () => {
  // Un SQLite compilado sin claves ajenas ignora el PRAGMA y sigue dando 0.
  const motor: Motor = {
    exec: () => {},
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    all: () => [],
    get: () => ({ foreign_keys: 0 }),
  }

  expect(() => crearBd(motor)).toThrow(/claves ajenas/)
})

test('admite_parametros_numerados_repetidos', () => {
  // La siembra usa «?1» tres veces con un solo valor.
  const bd = abrirBdNode()

  expect(bd.una('SELECT ?1 AS a, ?2 AS b, ?1 AS c', 'x', 'y')).toEqual({ a: 'x', b: 'y', c: 'x' })
})
