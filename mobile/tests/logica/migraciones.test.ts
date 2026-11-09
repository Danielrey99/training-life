/**
 * Tests de las migraciones del teléfono (`PRAGMA user_version`). Sustituyen a los de la
 * cadena de Alembic del backend.
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  aplicarMigraciones,
  BaseMasNueva,
  MIGRACIONES,
  VERSION_ACTUAL,
  versionDeLaBase,
  type Migracion,
} from '../../src/logica/bd/migraciones'
import { abrirBdNode } from '../apoyo/bdNode'

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
