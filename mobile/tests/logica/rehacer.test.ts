/**
 * Tests de `rehacerTabla`: el SQL que rehace una tabla para cambiarle lo que `ALTER TABLE` no
 * deja cambiar, sin perder sus filas, sus hijas, sus índices ni su secuencia de ids.
 *
 * Que las hijas se conservan con el esquema v1 real lo prueba `migraciones.test.ts`; aquí, la
 * función en sí y las secuencias.
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  aplicarMigraciones,
  MigracionPeligrosa,
  type Migracion,
} from '../../src/logica/bd/migraciones'
import { rehacerTabla, type TablaRehecha } from '../../src/logica/bd/rehacer'
import { abrirBdNode } from '../apoyo/bdNode'

const CUERPO = 'id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER NOT NULL'

const V1: Migracion = {
  version: 1,
  sql: `CREATE TABLE t (${CUERPO}) STRICT; CREATE INDEX ix_t_x ON t (x);`,
}

const T_IGUAL: TablaRehecha = {
  tabla: 't',
  cuerpo: CUERPO,
  columnas: { id: 'id', x: 'x' },
  indices: ['CREATE INDEX ix_t_x ON t (x)'],
}

/** Una base con la tabla `t` y las filas de `x` dadas (ids 1, 2, 3…). */
function baseConT(...valores: number[]): Bd {
  const bd = abrirBdNode()
  aplicarMigraciones(bd, [V1])
  for (const x of valores) bd.ejecutar('INSERT INTO t (x) VALUES (?)', x)
  return bd
}

function rehacer(bd: Bd, sql: string, marcas: Partial<Migracion> = {}): number[] {
  return aplicarMigraciones(bd, [V1, { version: 2, sinClavesAjenas: true, sql, ...marcas }])
}

function secuencia(bd: Bd, tabla: string): number | undefined {
  return bd.una<{ seq: number }>('SELECT seq FROM sqlite_sequence WHERE name = ?', tabla)?.seq
}

function lanzado(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('No ha lanzado nada.')
}

test('crea_la_nueva_copia_borra_la_vieja_y_renombra_la_nueva', () => {
  const sql = rehacerTabla(T_IGUAL)
  const lineas = sql.split('\n')

  // El `)` en su propia línea: un comentario `--` al final del cuerpo no se lo come.
  expect(
    sql.startsWith(`CREATE TABLE t__nueva (${CUERPO}
) STRICT;
`),
  ).toBe(true)
  expect(lineas).toContain('INSERT INTO t__nueva (id, x) SELECT id, x FROM t;')
  // Se renombra la nueva, nunca la vieja (renombrar la vieja cambiaría las claves ajenas de
  // sus hijas al nombre viejo), y después de borrar la vieja.
  expect(lineas.indexOf('DROP TABLE t;')).toBeLessThan(
    lineas.indexOf('ALTER TABLE t__nueva RENAME TO t;'),
  )
  expect(sql).not.toMatch(/ALTER TABLE t RENAME/)
  // A los índices se les pone el `;` que no traen.
  expect(lineas).toContain('CREATE INDEX ix_t_x ON t (x);')
})

test('las_columnas_se_llenan_con_su_expresion_sobre_la_vieja', () => {
  const bd = baseConT(1, 2)

  rehacer(
    bd,
    rehacerTabla({
      ...T_IGUAL,
      cuerpo: `${CUERPO}, doble INTEGER NOT NULL`,
      columnas: { id: 'id', x: 'x', doble: 'x * 2' },
    }),
  )

  expect(bd.todas('SELECT id, x, doble FROM t ORDER BY id')).toEqual([
    { id: 1, x: 1, doble: 2 },
    { id: 2, x: 2, doble: 4 },
  ])
  expect(bd.una("SELECT name FROM sqlite_schema WHERE name = 'ix_t_x'")).toEqual({ name: 'ix_t_x' })
})

test.each([
  ['una tabla con mayúsculas', { tabla: 'T' }],
  ['una tabla con SQL dentro', { tabla: 't; DROP TABLE series' }],
  ['una columna con espacios', { columnas: { 'x y': 'x' } }],
  ['una columna con comillas', { columnas: { "x'": 'x' } }],
])('rechaza_un_nombre_que_no_es_de_este_codigo (%s)', (_, cambio) => {
  expect(() => rehacerTabla({ ...T_IGUAL, ...cambio })).toThrow(/Nombre no válido/)
})

// --- La secuencia de ids ------------------------------------------------------------------------
// Con AUTOINCREMENT un id borrado no se reutiliza. La tabla nueva nace sin secuencia y, al copiar,
// SQLite le pone la del id más alto copiado: si el último se borró, bajaría.

test('la_secuencia_no_baja_si_el_ultimo_id_se_borro', () => {
  const bd = baseConT(10, 20, 30)
  bd.ejecutar('DELETE FROM t WHERE id = 3')
  expect(secuencia(bd, 't')).toBe(3)

  rehacer(bd, rehacerTabla(T_IGUAL))

  expect(secuencia(bd, 't')).toBe(3)
  expect(bd.ejecutar('INSERT INTO t (x) VALUES (40)').ultimoId).toBe(4)
  // La de la tabla de paso no se queda colgando.
  expect(secuencia(bd, 't__nueva')).toBeUndefined()
})

test('la_secuencia_se_conserva_en_una_tabla_vacia_que_tuvo_filas', () => {
  const bd = baseConT(10, 20, 30, 40, 50)
  bd.ejecutar('DELETE FROM t')

  rehacer(bd, rehacerTabla(T_IGUAL))

  expect(secuencia(bd, 't')).toBe(5)
  expect(bd.ejecutar('INSERT INTO t (x) VALUES (60)').ultimoId).toBe(6)
})

test('una_tabla_que_nunca_tuvo_filas_sigue_empezando_por_el_1', () => {
  const bd = baseConT()

  rehacer(bd, rehacerTabla(T_IGUAL))

  expect(secuencia(bd, 't') ?? 0).toBe(0)
  expect(bd.ejecutar('INSERT INTO t (x) VALUES (1)').ultimoId).toBe(1)
})

test('la_secuencia_no_baja_aunque_se_rehagan_varias_tablas_en_un_paso', () => {
  const bd = abrirBdNode()
  const dos: Migracion = {
    version: 1,
    sql: `CREATE TABLE t (${CUERPO}) STRICT; CREATE TABLE u (${CUERPO}) STRICT;`,
  }
  aplicarMigraciones(bd, [dos])
  for (const tabla of ['t', 'u']) {
    for (const x of [1, 2, 3]) bd.ejecutar(`INSERT INTO ${tabla} (x) VALUES (?)`, x)
    bd.ejecutar(`DELETE FROM ${tabla} WHERE id = 3`)
  }

  aplicarMigraciones(bd, [
    dos,
    {
      version: 2,
      sinClavesAjenas: true,
      sql: [
        rehacerTabla({ ...T_IGUAL, indices: [] }),
        rehacerTabla({ ...T_IGUAL, tabla: 'u', indices: [] }),
      ].join('\n'),
    },
  ])

  expect([secuencia(bd, 't'), secuencia(bd, 'u')]).toEqual([3, 3])
})

test.each([
  ['si el último id se borró', [10, 20, 30], 'DELETE FROM t WHERE id = 3', /de t de 3 a 2/],
  ['si la tabla quedó vacía', [10, 20], 'DELETE FROM t', /de t de 2 a 0/],
])('rehacer_a_mano_sin_cuidar_la_secuencia_se_para %s', (_, valores, borrar, mensaje) => {
  // El procedimiento sin las dos líneas de la secuencia: la red tiene que verlo.
  const bd = baseConT(...valores)
  bd.ejecutar(borrar)
  const sinSecuencia = rehacerTabla(T_IGUAL)
    .split('\n')
    .filter((linea) => !linea.includes('sqlite_sequence'))
    .join('\n')

  const error = lanzado(() => rehacer(bd, sinSecuencia))

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect((error as Error).message).toMatch(/baja la secuencia de ids/)
  expect((error as Error).message).toMatch(mensaje)
  expect(bd.una('PRAGMA user_version')).toEqual({ user_version: 1 })
})

test('olvidar_los_indices_al_rehacer_se_para', () => {
  const bd = baseConT(1)

  const error = lanzado(() => rehacer(bd, rehacerTabla({ ...T_IGUAL, indices: [] })))

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect((error as Error).message).toContain('ix_t_x')
  expect(bd.una("SELECT name FROM sqlite_schema WHERE name = 'ix_t_x'")).toEqual({ name: 'ix_t_x' })
})

test('un_disparador_con_su_punto_y_coma_deja_seguir_con_otra_tabla_en_el_mismo_paso', () => {
  const bd = baseConT(1)
  const disparador = 'CREATE TRIGGER t_tocada AFTER UPDATE ON t BEGIN SELECT 1; END;'

  rehacer(bd, `${rehacerTabla({ ...T_IGUAL, disparador })}\nCREATE TABLE otra (x INTEGER) STRICT;`)

  expect(
    bd.todas("SELECT name FROM sqlite_schema WHERE name IN ('t_tocada', 'otra') ORDER BY name"),
  ).toEqual([{ name: 'otra' }, { name: 't_tocada' }])
})

// Fallo que ya ocurrió (12-11-2026): `rehacerTabla` ponía el `;` que faltara a los índices,
// pero no al disparador. El `sql` de `sqlite_schema` viene sin él, así que un disparador sacado
// de ahí pegaba lo que fuera detrás en el mismo paso (`… END CREATE TABLE …`): error de
// sintaxis y la app no arrancaba.
test('un_disparador_sin_punto_y_coma_no_rompe_lo_que_va_detras', () => {
  const bd = baseConT(1)
  const disparador = 'CREATE TRIGGER t_tocada AFTER UPDATE ON t BEGIN SELECT 1; END'

  rehacer(bd, `${rehacerTabla({ ...T_IGUAL, disparador })}\nCREATE TABLE otra (x INTEGER) STRICT;`)

  expect(bd.una("SELECT name FROM sqlite_schema WHERE name = 'otra'")).toEqual({ name: 'otra' })
})

// Fallo que ya ocurrió (12-11-2026): el cuerpo iba pegado al `)` del final. Si su última línea
// acababa en un comentario `--`, como al copiar el cuerpo de un `CREATE TABLE` con comentarios,
// el `)` y el `STRICT` quedaban dentro del comentario: error de sintaxis y la app no arrancaba.
test('un_cuerpo_que_acaba_en_un_comentario_no_rompe_el_create', () => {
  const bd = baseConT(1)

  rehacer(bd, rehacerTabla({ ...T_IGUAL, cuerpo: `${CUERPO} -- la x siempre va` }))

  expect(bd.todas('SELECT id, x FROM t')).toEqual([{ id: 1, x: 1 }])
})
