/**
 * Tests de las migraciones del teléfono (`PRAGMA user_version`). Sustituyen a los de la
 * cadena de Alembic del backend.
 */
import { readFileSync } from 'node:fs'

import type { Bd } from '../../src/logica/bd/bd'
import {
  aplicarMigraciones,
  BaseMasNueva,
  comprobarPaso,
  MIGRACIONES,
  MigracionPeligrosa,
  VERSION_ACTUAL,
  versionDeLaBase,
  type Migracion,
} from '../../src/logica/bd/migraciones'
import { ESQUEMA_V1 } from '../../src/logica/bd/esquema'
import { huella } from '../../src/logica/bd/siembra'
import { abrirBdNode } from '../apoyo/bdNode'
import { rehacerIgual } from '../apoyo/rehacerIgual'
import { BASE_V1, baseVaciaEnLaVersion, cargarVolcado, volcar } from '../apoyo/volcado'

function tablas(bd: Bd): string[] {
  return bd
    .todas<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" +
        ' ORDER BY name',
    )
    .map((t) => t.name)
}

function esquemaEntero(bd: Bd) {
  return bd.todas('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name')
}

test('una_base_vacia_queda_en_la_ultima_version', () => {
  const bd = abrirBdNode()
  expect(versionDeLaBase(bd)).toBe(0)

  const aplicados = aplicarMigraciones(bd)

  expect(aplicados).toEqual(MIGRACIONES.map((m) => m.version))
  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL)
  expect(tablas(bd)).toContain('series')
})

test('aplicarlas_otra_vez_no_hace_nada', () => {
  const bd = abrirBdNode()
  aplicarMigraciones(bd)
  const antes = esquemaEntero(bd)

  expect(aplicarMigraciones(bd)).toEqual([])
  expect(esquemaEntero(bd)).toEqual(antes)
  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL)
})

test('una_base_de_una_version_mas_nueva_lanza_base_mas_nueva_sin_tocarla', () => {
  const bd = abrirBdNode()
  bd.ejecutarVarias(`PRAGMA user_version = ${VERSION_ACTUAL + 1}`)

  let lanzado: unknown
  try {
    aplicarMigraciones(bd)
  } catch (e) {
    lanzado = e
  }

  expect(lanzado).toBeInstanceOf(BaseMasNueva)
  expect(lanzado).toMatchObject({
    versionDeLaBase: VERSION_ACTUAL + 1,
    versionDeLaApp: VERSION_ACTUAL,
    message:
      'Tus datos son de una versión más nueva de la app. Instala la última versión para abrirlos.',
  })
  expect(tablas(bd)).toEqual([])
  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL + 1)
})

const PRUEBA: Migracion[] = [
  { version: 1, sql: 'CREATE TABLE a (x INTEGER) STRICT;' },
  { version: 2, sql: 'CREATE TABLE b (x INTEGER) STRICT; INSERT INTO b VALUES (1);' },
  // Falla en la segunda sentencia, con la primera ya hecha.
  { version: 3, sql: 'CREATE TABLE c (x INTEGER) STRICT; INSERT INTO no_existe VALUES (1);' },
]

test('aplica_solo_los_pasos_que_van_detras_de_la_version_guardada', () => {
  const bd = abrirBdNode()
  expect(aplicarMigraciones(bd, PRUEBA.slice(0, 1))).toEqual([1])

  expect(aplicarMigraciones(bd, PRUEBA.slice(0, 2))).toEqual([2])

  expect(tablas(bd)).toEqual(['a', 'b'])
  expect(versionDeLaBase(bd)).toBe(2)
})

test('si_un_paso_falla_desde_una_base_vacia_no_queda_nada', () => {
  const bd = abrirBdNode()

  expect(() => aplicarMigraciones(bd, PRUEBA)).toThrow(/no_existe/)

  expect(tablas(bd)).toEqual([])
  expect(versionDeLaBase(bd)).toBe(0)
})

test('si_un_paso_falla_a_mitad_la_base_queda_en_la_version_que_tenia', () => {
  const bd = abrirBdNode()
  aplicarMigraciones(bd, PRUEBA.slice(0, 1))

  // Pendientes el 2 (bueno) y el 3 (falla): tampoco queda el 2.
  expect(() => aplicarMigraciones(bd, PRUEBA)).toThrow(/no_existe/)

  expect(tablas(bd)).toEqual(['a'])
  expect(versionDeLaBase(bd)).toBe(1)
  expect(bd.enTransaccion).toBe(false)
})

test('las_versiones_de_la_lista_real_van_de_una_en_una_desde_1', () => {
  // Un hueco o un número repetido haría que un paso no se aplicara nunca.
  expect(MIGRACIONES.map((m) => m.version)).toEqual(MIGRACIONES.map((_, i) => i + 1))
})

// --- Lo publicado no se edita -----------------------------------------------------------------
// Un teléfono que ya aplicó un paso no lo vuelve a aplicar: si el paso cambia después, las
// instalaciones nuevas y las viejas acaban con bases distintas. Estas huellas se apuntan al
// publicar cada paso en un APK y no se cambian nunca. Si uno de estos tests falla, es que se
// ha editado algo ya publicado: hay que deshacerlo y llevar el cambio a un paso nuevo.

/** La huella (`huella()` de `siembra.ts`) de `ESQUEMA_V1`, la v1 publicada (APK 0.2.0). */
const HUELLA_DEL_ESQUEMA_V1 = '3f6f2ced'

/** La huella del SQL de cada paso publicado, por versión. Se añade al publicar uno nuevo. */
const HUELLAS_PUBLICADAS: Record<number, string> = {
  1: HUELLA_DEL_ESQUEMA_V1,
}

test('el_esquema_v1_publicado_no_cambia', () => {
  expect(huella(ESQUEMA_V1)).toBe(HUELLA_DEL_ESQUEMA_V1)
})

test('cada_paso_publicado_conserva_su_huella', () => {
  const actuales = Object.keys(HUELLAS_PUBLICADAS).map((version) => {
    const paso = MIGRACIONES.find((m) => m.version === Number(version))
    return [Number(version), paso === undefined ? 'falta el paso' : huella(paso.sql)]
  })

  expect(actuales).toEqual(Object.entries(HUELLAS_PUBLICADAS).map(([v, h]) => [Number(v), h]))
})

// --- Que poner al día la base no pierda datos -------------------------------------------------
// Los datos solo están en el teléfono: un paso que borra de más (las series de cada sesión al
// rehacer `entrenamientos`, por ejemplo) no tiene vuelta atrás. Estos tests montan la base v1
// con datos (`tests/fijos/base_v1.sql`) y comprueban que la red lo para y lo deshace todo.

const V1 = MIGRACIONES[0]

function baseV1ConDatos(): Bd {
  const bd = baseVaciaEnLaVersion(1)
  cargarVolcado(bd, readFileSync(BASE_V1, 'utf8'))
  return bd
}

function clavesAjenas(bd: Bd): number {
  return bd.una<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys
}

function filas(bd: Bd, tabla: string): number {
  return bd.una<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla}`)!.n
}

/** Lo que lanza `fn`; si no lanza nada, el test falla. */
function lanzado(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('No ha lanzado nada.')
}

/** El volcado con otra versión en la cabecera: para comparar solo los datos. */
function comoVersion(volcado: string, version: number): string {
  return volcado.replace(/versión \d+\./, `versión ${version}.`)
}

/** La base sigue exactamente como estaba: datos, secuencias, esquema, versión y claves ajenas. */
function expectIntacta(bd: Bd, volcado: string, esquema: unknown[]): void {
  expect(volcar(bd)).toBe(volcado)
  expect(esquemaEntero(bd)).toEqual(esquema)
  expect(versionDeLaBase(bd)).toBe(Number(/versión (\d+)\./.exec(volcado)![1]))
  expect(clavesAjenas(bd)).toBe(1)
  expect(bd.enTransaccion).toBe(false)
}

test('rehacer_entrenamientos_sin_claves_ajenas_conserva_todas_sus_series', () => {
  const bd = baseV1ConDatos()
  const antes = volcar(bd)
  expect(filas(bd, 'series')).toBeGreaterThan(0)

  const aplicados = aplicarMigraciones(bd, [
    V1,
    { version: 2, sinClavesAjenas: true, sql: rehacerIgual(bd, 'entrenamientos') },
  ])

  expect(aplicados).toEqual([2])
  // Mismas filas con los mismos ids y valores en todas las tablas, y las mismas secuencias.
  expect(volcar(bd)).toBe(comoVersion(antes, 2))
  expect(clavesAjenas(bd)).toBe(1)
  // Las series siguen colgando de la tabla nueva con su CASCADE, y ella de rutinas.
  expect(
    bd.todas(
      'SELECT "table", on_delete FROM pragma_foreign_key_list(?) WHERE "from" = ?',
      'series',
      'entrenamiento_id',
    ),
  ).toEqual([{ table: 'entrenamientos', on_delete: 'CASCADE' }])
  const { entrenamiento_id: sesion } = bd.una<{ entrenamiento_id: number }>(
    'SELECT entrenamiento_id FROM series ORDER BY id LIMIT 1',
  )!
  expect(() =>
    bd.ejecutar('UPDATE entrenamientos SET rutina_id = 999999 WHERE id = ?', sesion),
  ).toThrow(/FOREIGN KEY/)
  bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', sesion)
  expect(bd.una('SELECT COUNT(*) AS n FROM series WHERE entrenamiento_id = ?', sesion)).toEqual({
    n: 0,
  })
})

test('rehacer_una_tabla_sin_la_marca_se_rechaza_antes_de_escribir', () => {
  const bd = baseV1ConDatos()
  const volcado = volcar(bd)
  const esquema = esquemaEntero(bd)
  const antesDeMigrar = jest.fn()

  const error = lanzado(() =>
    aplicarMigraciones(bd, [V1, { version: 2, sql: rehacerIgual(bd, 'entrenamientos') }], {
      antesDeMigrar,
    }),
  )

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect(error).toMatchObject({ version: 2, message: expect.stringContaining('sinClavesAjenas') })
  // Ni siquiera se ha copiado: se rechaza mirando el texto.
  expect(antesDeMigrar).not.toHaveBeenCalled()
  expectIntacta(bd, volcado, esquema)
})

test('renombrar_la_tabla_vieja_en_vez_de_la_nueva_se_para_y_se_deshace', () => {
  // Al renombrar la vieja, SQLite cambia las claves ajenas de las series para que apunten al
  // nombre viejo; al borrarla, se quedan apuntando a una tabla que no existe.
  const bd = baseV1ConDatos()
  const volcado = volcar(bd)
  const esquema = esquemaEntero(bd)
  const crear = (tipo: string, nombre: string) =>
    bd.una<{ sql: string }>(
      'SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?',
      tipo,
      nombre,
    )!.sql
  const sql = [
    'ALTER TABLE entrenamientos RENAME TO entrenamientos__vieja;',
    `${crear('table', 'entrenamientos')};`,
    'INSERT INTO entrenamientos SELECT * FROM entrenamientos__vieja;',
    'DROP TABLE entrenamientos__vieja;',
    `${crear('index', 'ix_entrenamientos_rutina_id')};`,
    `${crear('trigger', 'entrenamientos_updated_at')};`,
  ].join('\n')

  const error = lanzado(() =>
    aplicarMigraciones(bd, [V1, { version: 2, sinClavesAjenas: true, sql }]),
  )

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect((error as Error).message).toMatch(/filas de series sin su entrenamientos__vieja/)
  expectIntacta(bd, volcado, esquema)
})

test.each([
  [[], /deja la tabla (entrenamientos|series) con 0 filas de \d+/],
  // Declarar solo las sesiones no basta: el CASCADE se lleva también sus series.
  [['entrenamientos'], /deja la tabla series con 0 filas de \d+/],
])(
  'borrar_sesiones_sin_declarar_todo_lo_que_se_pierde_se_para_por_el_recuento (%j)',
  (pierdeAProposito, mensaje) => {
    const bd = baseV1ConDatos()
    const volcado = volcar(bd)
    const esquema = esquemaEntero(bd)

    const error = lanzado(() =>
      aplicarMigraciones(bd, [
        V1,
        { version: 2, sql: 'DELETE FROM entrenamientos;', pierdeAProposito },
      ]),
    )

    expect(error).toBeInstanceOf(MigracionPeligrosa)
    expect(error).toMatchObject({ version: 2, message: expect.stringMatching(mensaje) })
    expectIntacta(bd, volcado, esquema)
  },
)

test('borrar_sesiones_declarando_sesiones_y_series_pasa', () => {
  const bd = baseV1ConDatos()

  aplicarMigraciones(bd, [
    V1,
    {
      version: 2,
      sql: 'DELETE FROM entrenamientos;',
      pierdeAProposito: ['entrenamientos', 'series'],
    },
  ])

  expect(versionDeLaBase(bd)).toBe(2)
  expect([filas(bd, 'entrenamientos'), filas(bd, 'series')]).toEqual([0, 0])
})

test('un_paso_sin_claves_que_deja_series_huerfanas_se_para_nombrando_la_tabla', () => {
  const bd = baseV1ConDatos()
  const volcado = volcar(bd)
  const esquema = esquemaEntero(bd)

  // Sin claves ajenas no hay CASCADE: la sesión se va y sus series se quedan sin ella. El
  // recuento no lo ve (las series no bajan): lo tiene que ver `foreign_key_check`.
  const error = lanzado(() =>
    aplicarMigraciones(bd, [
      V1,
      {
        version: 2,
        sinClavesAjenas: true,
        pierdeAProposito: ['entrenamientos'],
        sql: 'DELETE FROM entrenamientos WHERE id = (SELECT min(entrenamiento_id) FROM series);',
      },
    ]),
  )

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect(error).toMatchObject({
    version: 2,
    message: expect.stringMatching(/deja \d+ filas de series sin su entrenamientos\./),
  })
  expectIntacta(bd, volcado, esquema)
})

test.each([
  [
    'un error de SQL',
    (bd: Bd) => `${rehacerIgual(bd, 'series')}\nINSERT INTO no_existe VALUES (1);`,
  ],
  ['la red de filas', () => 'DELETE FROM series;'],
  ['la red de claves ajenas', () => 'DELETE FROM entrenamientos;'],
])('las_claves_ajenas_vuelven_a_encenderse_si_un_paso_sin_ellas_falla (%s)', (_, sql) => {
  const bd = baseV1ConDatos()
  const volcado = volcar(bd)
  const esquema = esquemaEntero(bd)

  expect(() =>
    aplicarMigraciones(bd, [
      V1,
      { version: 2, sinClavesAjenas: true, pierdeAProposito: ['entrenamientos'], sql: sql(bd) },
    ]),
  ).toThrow()

  // `expectIntacta` mira también que vuelvan a estar encendidas.
  expectIntacta(bd, volcado, esquema)
  // Y que de verdad actúan: el CASCADE se lleva las series.
  bd.ejecutar('DELETE FROM entrenamientos')
  expect(filas(bd, 'series')).toBe(0)
})

test.each([
  ['ix_entrenamientos_rutina_id', 'DROP INDEX ix_entrenamientos_rutina_id;'],
  ['entrenamientos_updated_at', 'DROP TRIGGER entrenamientos_updated_at;'],
])('quitar_%s_sin_declararlo_se_rechaza_y_declarado_pasa', (nombre, sql) => {
  const sinDeclarar = abrirBdNode()
  aplicarMigraciones(sinDeclarar, [V1])

  const error = lanzado(() => aplicarMigraciones(sinDeclarar, [V1, { version: 2, sql }]))

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect((error as Error).message).toContain(nombre)
  expect(versionDeLaBase(sinDeclarar)).toBe(1)
  expect(sinDeclarar.una('SELECT name FROM sqlite_schema WHERE name = ?', nombre)).toEqual({
    name: nombre,
  })

  const declarado = abrirBdNode()
  aplicarMigraciones(declarado, [V1])
  aplicarMigraciones(declarado, [V1, { version: 2, sql, pierdeAProposito: [nombre] }])
  expect(versionDeLaBase(declarado)).toBe(2)
  expect(declarado.una('SELECT name FROM sqlite_schema WHERE name = ?', nombre)).toBeUndefined()
})

// --- Lo que un paso no puede llevar (se mira en el texto, antes de escribir) ------------------

/** Un paso con algo bueno delante, para que lo prohibido no vaya solo al principio. */
function conDelante(sql: string, marcas: Partial<Migracion> = {}): Migracion {
  return { version: 2, sql: `CREATE TABLE b (x INTEGER) STRICT;\n${sql}`, ...marcas }
}

test.each([
  ['PRAGMA foreign_keys = OFF;', 'PRAGMA'],
  ['pragma user_version = 9;', 'PRAGMA'],
  ['VACUUM;', 'VACUUM'],
  ["ATTACH DATABASE 'otra.db' AS otra;", 'ATTACH'],
  ['DETACH DATABASE otra;', 'DETACH'],
])('comprobar_paso_rechaza_lo_que_es_de_la_infraestructura (%s)', (sql, palabra) => {
  const error = lanzado(() => comprobarPaso(conDelante(sql)))

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect(error).toMatchObject({ version: 2, message: expect.stringContaining(palabra) })
})

test.each([
  'BEGIN;',
  'BEGIN TRANSACTION;',
  'begin immediate transaction;',
  'BEGIN EXCLUSIVE;',
  'COMMIT;',
  'COMMIT TRANSACTION;',
  'END TRANSACTION;',
  'ROLLBACK;',
  // Al final del paso, sin punto y coma.
  'ROLLBACK',
  '/* abre */ BEGIN DEFERRED ;',
])('comprobar_paso_rechaza_abrir_o_cerrar_una_transaccion (%s)', (sql) => {
  const error = lanzado(() => comprobarPaso(conDelante(sql)))

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect(error).toMatchObject({ version: 2, message: expect.stringContaining('transacción') })
})

test.each([
  ['DROP TABLE a;'],
  ['drop table if exists a;'],
  ['ALTER TABLE a RENAME TO c;'],
  ['alter table a  rename  to c;'],
])('comprobar_paso_rechaza_borrar_o_renombrar_una_tabla_sin_la_marca (%s)', (sql) => {
  expect(lanzado(() => comprobarPaso(conDelante(sql)))).toMatchObject({
    name: 'MigracionPeligrosa',
    message: expect.stringContaining('sinClavesAjenas'),
  })
  expect(() => comprobarPaso(conDelante(sql, { sinClavesAjenas: true }))).not.toThrow()
})

test.each([
  [
    'un disparador con RAISE(ROLLBACK, …)',
    "CREATE TRIGGER b_sin_borrar BEFORE DELETE ON b BEGIN SELECT RAISE(ROLLBACK, 'No'); END;",
  ],
  [
    'un disparador con dos sentencias',
    'CREATE TRIGGER b_doble AFTER INSERT ON b BEGIN UPDATE b SET x = 1; DELETE FROM b WHERE x = 2; END;',
  ],
  [
    'palabras prohibidas dentro de un texto',
    "INSERT INTO b VALUES ('DROP TABLE series; COMMIT; PRAGMA x');",
  ],
  ['un texto con comillas escapadas', "INSERT INTO b VALUES ('it''s; COMMIT;');"],
  [
    'palabras prohibidas en comentarios',
    '-- antes era un DROP TABLE con PRAGMA\n/* COMMIT; */ SELECT 1;',
  ],
  ['renombrar una columna', 'ALTER TABLE b RENAME COLUMN x TO y;'],
  ['borrar filas (lo vigila el recuento, no el texto)', 'DELETE FROM b;'],
])('comprobar_paso_acepta_lo_que_no_es_peligroso (%s)', (_, sql) => {
  expect(() => comprobarPaso(conDelante(sql))).not.toThrow()
})

test('comprobar_paso_acepta_la_v1_y_todos_los_pasos_de_la_lista', () => {
  // La v1 lleva disparadores con `BEGIN … END;`: no son transacciones.
  expect(() => comprobarPaso({ version: 1, sql: ESQUEMA_V1 })).not.toThrow()
  for (const migracion of MIGRACIONES) expect(() => comprobarPaso(migracion)).not.toThrow()
})

// Fallo que ya ocurrió (12-11-2026): `sinTextos` quitaba los comentarios antes que los textos,
// así que un `--` o un `/*` dentro de un texto se comía lo que iba detrás como si fuera un
// comentario, y lo prohibido que hubiera ahí pasaba sin verse.
test.each([
  ["INSERT INTO b VALUES ('--'); DROP TABLE a;"],
  ["INSERT INTO b VALUES ('--'); PRAGMA foreign_keys = OFF;"],
  ["INSERT INTO b VALUES ('/*'); COMMIT; INSERT INTO b VALUES ('*/');"],
  // Un nombre entre comillas dobles con un `--` dentro, igual.
  ['CREATE TABLE "x--y" (x INTEGER) STRICT; DROP TABLE a;'],
])('comprobar_paso_no_se_deja_enganar_por_un_comentario_dentro_de_un_texto (%s)', (sql) => {
  expect(lanzado(() => comprobarPaso(conDelante(sql)))).toBeInstanceOf(MigracionPeligrosa)
})

// Fallo que ya ocurrió (12-11-2026): SQLite también admite nombres entre corchetes (`[x]`) y
// entre acentos graves (`` `x` ``), y `sinTextos` no los conocía. Una comilla simple dentro de
// uno abría un «texto» que se comía lo que iba detrás, y lo prohibido que hubiera ahí pasaba
// sin verse.
test.each([
  ["CREATE TABLE [it's] (x INTEGER) STRICT; PRAGMA foreign_keys = OFF; SELECT 'x';"],
  ["CREATE TABLE `it's` (x INTEGER) STRICT; DROP TABLE a; SELECT 'x';"],
])('comprobar_paso_no_se_deja_enganar_por_una_comilla_en_un_nombre (%s)', (sql) => {
  expect(lanzado(() => comprobarPaso(conDelante(sql)))).toBeInstanceOf(MigracionPeligrosa)
})

// --- `END` a secas es `COMMIT` para SQLite, pero también cierra un disparador o un `CASE` ----
// Fallo que ya ocurrió (12-11-2026): solo se buscaba `END TRANSACTION`. Un `END;` suelto
// confirmaba lo hecho hasta ahí: si el paso fallaba después, eso se quedaba sin que subiera la
// versión, y el siguiente arranque volvía a empezar el paso sobre una base a medias («table b
// already exists»).

test.each([
  ['END;'],
  ['end'],
  ['END TRANSACTION;'],
  // El `CASE … END` de un disparador no se lleva por delante el `END;` suelto de después.
  [
    'CREATE TRIGGER b_caso AFTER INSERT ON b BEGIN UPDATE b SET x = CASE WHEN x > 0 THEN 1 ELSE 0 END; END;\nEND;',
  ],
  // Ni el `CASE … END` de una sentencia normal.
  ['UPDATE b SET x = CASE WHEN x > 0 THEN 1 END;\nEND;'],
])('comprobar_paso_rechaza_un_end_suelto_que_cierra_la_transaccion (%s)', (sql) => {
  expect(lanzado(() => comprobarPaso(conDelante(sql)))).toMatchObject({
    name: 'MigracionPeligrosa',
    message: expect.stringContaining('transacción'),
  })
})

test.each([
  [
    'un CASE … END en el cuerpo',
    'CREATE TRIGGER b_caso AFTER INSERT ON b BEGIN UPDATE b SET x = CASE WHEN NEW.x > 0 THEN 1 ELSE 0 END WHERE rowid = NEW.rowid; END;',
  ],
  [
    'dos CASE, uno dentro de otro',
    'CREATE TRIGGER b_casos AFTER INSERT ON b BEGIN UPDATE b SET x = CASE WHEN NEW.x > 0 THEN CASE NEW.x WHEN 1 THEN 1 END END; END;',
  ],
  [
    'un CASE … END en el WHEN de la cabecera',
    'CREATE TRIGGER b_cuando AFTER INSERT ON b WHEN CASE WHEN NEW.x > 0 THEN 1 ELSE 0 END BEGIN SELECT 1; END;',
  ],
  [
    'dos disparadores seguidos y algo detrás',
    'CREATE TRIGGER b_uno AFTER INSERT ON b BEGIN SELECT 1; END;\nCREATE TEMP TRIGGER b_dos AFTER DELETE ON b BEGIN SELECT 2; END;\nCREATE TABLE c (x INTEGER) STRICT;',
  ],
  ['un UPDATE con CASE … END al final', 'UPDATE b SET x = CASE WHEN x > 0 THEN 1 END;'],
])('comprobar_paso_acepta_un_end_que_no_cierra_la_transaccion (%s)', (_, sql) => {
  expect(() => comprobarPaso(conDelante(sql))).not.toThrow()
  // Y SQLite lo ejecuta: no es un SQL que solo valga para el test.
  const bd = abrirBdNode()
  expect(() => bd.ejecutarVarias(conDelante(sql).sql)).not.toThrow()
})

test('un_end_suelto_no_deja_la_base_a_medias', () => {
  const bd = abrirBdNode()
  aplicarMigraciones(bd, PRUEBA.slice(0, 1))

  expect(() =>
    aplicarMigraciones(bd, [
      PRUEBA[0],
      {
        version: 2,
        sql: 'CREATE TABLE b (x INTEGER) STRICT; END; INSERT INTO no_existe VALUES (1);',
      },
    ]),
  ).toThrow()

  expect(tablas(bd)).toEqual(['a'])
  expect(versionDeLaBase(bd)).toBe(1)
})

// --- Un lote de varios pasos es todo o nada ---------------------------------------------------

/** Un paso normal (con claves ajenas) que deja huella en los datos y en el esquema. */
const PASO_NORMAL: Migracion = {
  version: 2,
  sql: "UPDATE entrenamientos SET notas = 'del paso 2'; CREATE TABLE extra (x INTEGER) STRICT;",
}

test('un_lote_mixto_va_en_una_transaccion_si_falla_el_segundo_no_queda_el_primero', () => {
  const bd = baseV1ConDatos()
  const volcado = volcar(bd)
  const esquema = esquemaEntero(bd)

  expect(() =>
    aplicarMigraciones(bd, [
      V1,
      PASO_NORMAL,
      {
        version: 3,
        sinClavesAjenas: true,
        sql: `${rehacerIgual(bd, 'series')}\nINSERT INTO no_existe VALUES (1);`,
      },
    ]),
  ).toThrow(/no_existe/)

  expectIntacta(bd, volcado, esquema)
})

test('un_lote_mixto_que_sale_bien_deja_los_dos_pasos', () => {
  const bd = baseV1ConDatos()
  const series = filas(bd, 'series')

  expect(
    aplicarMigraciones(bd, [
      V1,
      PASO_NORMAL,
      { version: 3, sinClavesAjenas: true, sql: rehacerIgual(bd, 'series') },
    ]),
  ).toEqual([2, 3])

  expect(versionDeLaBase(bd)).toBe(3)
  expect(tablas(bd)).toContain('extra')
  expect(bd.todas('SELECT DISTINCT notas FROM entrenamientos')).toEqual([{ notas: 'del paso 2' }])
  expect(filas(bd, 'series')).toBe(series)
  expect(clavesAjenas(bd)).toBe(1)
})

test('en_un_lote_mixto_el_cascade_de_un_paso_normal_no_actua_y_lo_para_foreign_key_check', () => {
  const borrarUnaSesion: Migracion = {
    version: 2,
    sql: 'DELETE FROM entrenamientos WHERE id = (SELECT min(entrenamiento_id) FROM series);',
    pierdeAProposito: ['entrenamientos', 'series'],
  }
  // Solo, con las claves encendidas, el CASCADE se lleva sus series y pasa.
  const solo = baseV1ConDatos()
  const series = filas(solo, 'series')
  aplicarMigraciones(solo, [V1, borrarUnaSesion])
  expect(filas(solo, 'series')).toBeLessThan(series)

  // Con un paso sin claves detrás, el lote entero va sin ellas: las series se quedan huérfanas.
  const mixto = baseV1ConDatos()
  const volcado = volcar(mixto)
  const esquema = esquemaEntero(mixto)
  const error = lanzado(() =>
    aplicarMigraciones(mixto, [
      V1,
      borrarUnaSesion,
      { version: 3, sinClavesAjenas: true, sql: rehacerIgual(mixto, 'rutina_slots') },
    ]),
  )

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect((error as Error).message).toMatch(/filas de series sin su entrenamientos/)
  expectIntacta(mixto, volcado, esquema)
})

test('aplicar_migraciones_dentro_de_una_transaccion_lanza_sin_tocar_nada', () => {
  const bd = abrirBdNode()
  aplicarMigraciones(bd, PRUEBA.slice(0, 1))
  const antesDeMigrar = jest.fn()

  const error = lanzado(() =>
    bd.transaccion(() => aplicarMigraciones(bd, PRUEBA.slice(0, 2), { antesDeMigrar })),
  )

  expect(error).toBeInstanceOf(MigracionPeligrosa)
  expect(error).toMatchObject({ version: null })
  expect(antesDeMigrar).not.toHaveBeenCalled()
  expect(tablas(bd)).toEqual(['a'])
  expect(versionDeLaBase(bd)).toBe(1)
  expect(clavesAjenas(bd)).toBe(1)
})

// --- antesDeMigrar (donde se copia la base) ---------------------------------------------------

/** Tres pasos buenos; el último sin claves, para ver en qué estado las encuentra la copia. */
const TRES: Migracion[] = [
  { version: 1, sql: 'CREATE TABLE a (x INTEGER) STRICT;' },
  { version: 2, sql: 'CREATE TABLE b (x INTEGER) STRICT;' },
  { version: 3, sinClavesAjenas: true, sql: 'CREATE TABLE c (x INTEGER) STRICT;' },
]

test('antes_de_migrar_se_llama_una_vez_con_desde_y_hasta_y_ve_la_base_sin_tocar', () => {
  const bd = abrirBdNode()
  aplicarMigraciones(bd, TRES.slice(0, 1))
  const vista: unknown[] = []
  const antesDeMigrar = jest.fn((_desde: number, _hasta: number) => {
    vista.push(versionDeLaBase(bd), tablas(bd), bd.enTransaccion, clavesAjenas(bd))
  })

  expect(aplicarMigraciones(bd, TRES, { antesDeMigrar })).toEqual([2, 3])

  expect(antesDeMigrar.mock.calls).toEqual([[1, 3]])
  // Fuera de una transacción (VACUUM INTO no va dentro) y con las claves aún encendidas.
  expect(vista).toEqual([1, ['a'], false, 1])
})

test.each([
  ['con una base nueva', 0],
  ['sin pasos pendientes', 3],
])('antes_de_migrar_no_se_llama %s', (_, version) => {
  const bd = abrirBdNode()
  if (version > 0) aplicarMigraciones(bd, TRES)
  const antesDeMigrar = jest.fn()

  aplicarMigraciones(bd, TRES, { antesDeMigrar })

  expect(antesDeMigrar).not.toHaveBeenCalled()
  expect(versionDeLaBase(bd)).toBe(3)
})

test('antes_de_migrar_no_se_llama_con_una_base_mas_nueva', () => {
  const bd = abrirBdNode()
  bd.ejecutarVarias('PRAGMA user_version = 4')
  const antesDeMigrar = jest.fn()

  expect(() => aplicarMigraciones(bd, TRES, { antesDeMigrar })).toThrow(BaseMasNueva)
  expect(antesDeMigrar).not.toHaveBeenCalled()
})

test('antes_de_migrar_no_se_llama_si_un_paso_pendiente_se_rechaza', () => {
  // Se comprueban todos antes de copiar: el malo es el último.
  const bd = abrirBdNode()
  aplicarMigraciones(bd, TRES.slice(0, 1))
  const antesDeMigrar = jest.fn()

  expect(() =>
    aplicarMigraciones(bd, [...TRES, { version: 4, sql: 'PRAGMA foreign_keys = OFF;' }], {
      antesDeMigrar,
    }),
  ).toThrow(MigracionPeligrosa)
  expect(antesDeMigrar).not.toHaveBeenCalled()
  expect(tablas(bd)).toEqual(['a'])
})

test('si_antes_de_migrar_lanza_no_se_migra', () => {
  const bd = abrirBdNode()
  aplicarMigraciones(bd, TRES.slice(0, 1))
  const sinEspacio = new Error('No queda espacio.')

  const error = lanzado(() =>
    aplicarMigraciones(bd, TRES, {
      antesDeMigrar: () => {
        throw sinEspacio
      },
    }),
  )

  expect(error).toBe(sinEspacio)
  expect(tablas(bd)).toEqual(['a'])
  expect(versionDeLaBase(bd)).toBe(1)
  expect(clavesAjenas(bd)).toBe(1)
})
