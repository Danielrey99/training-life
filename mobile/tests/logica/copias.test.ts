/**
 * Tests de la copia de la base que se guarda antes de ponerla al día (`copias.ts`): que copia
 * todo, que no da por buena una copia que no cuadra, que no deja la copia adjunta a la base y
 * qué copias se borran.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { crearBd, type Bd } from '../../src/logica/bd/bd'
import { copiarBase, copiasQueSobran, nombreDeLaCopia, SinCopia } from '../../src/logica/bd/copias'
import { aplicarMigraciones, versionDeLaBase } from '../../src/logica/bd/migraciones'
import { motorNode } from '../apoyo/bdNode'
import { BASE_V1, baseVaciaEnLaVersion, cargarVolcado, volcar } from '../apoyo/volcado'

let carpeta: string
/** Las conexiones a archivos que abre el test: se cierran antes de borrar la carpeta. */
let abiertas: DatabaseSync[]

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), 'training-life-copias-'))
  abiertas = []
})

afterEach(() => {
  for (const conexion of abiertas) {
    try {
      conexion.close()
    } catch {
      // Ya estaba cerrada.
    }
  }
  rmSync(carpeta, { recursive: true, force: true })
})

/** Una base sobre un archivo, que se cierra al terminar el test. */
function abrirArchivo(ruta: string): Bd {
  const conexion = new DatabaseSync(ruta)
  abiertas.push(conexion)
  return crearBd(motorNode(conexion))
}

function baseV1ConDatos(): Bd {
  const bd = baseVaciaEnLaVersion(1)
  cargarVolcado(bd, readFileSync(BASE_V1, 'utf8'))
  return bd
}

/** Las bases adjuntas además de la propia (`main`) y la temporal de SQLite (`temp`). */
function basesAdjuntas(bd: Bd): string[] {
  return bd
    .todas<{ name: string }>('PRAGMA database_list')
    .map((d) => d.name)
    .filter((nombre) => nombre !== 'main' && nombre !== 'temp')
}

function lanzado(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('No ha lanzado nada.')
}

test('la_copia_tiene_las_mismas_filas_secuencias_y_version_y_esta_sana', () => {
  const bd = baseV1ConDatos()
  const ruta = join(carpeta, nombreDeLaCopia(2))

  copiarBase(bd, ruta)

  const copia = abrirArchivo(ruta)
  // El volcado lleva la versión, todas las filas con sus valores y las secuencias.
  expect(volcar(copia)).toBe(volcar(bd))
  expect(versionDeLaBase(copia)).toBe(1)
  expect(copia.todas('PRAGMA quick_check')).toEqual([{ quick_check: 'ok' }])
  expect(basesAdjuntas(bd)).toEqual([])
})

test.each([
  // Reintentar sin borrar la de la vez anterior (lo hace quien llama).
  ['una copia anterior', (bd: Bd, ruta: string) => copiarBase(bd, ruta)],
  ['otro archivo', (_: Bd, ruta: string) => writeFileSync(ruta, 'lo que hubiera')],
])('si_el_destino_ya_existe_lanza_sin_copia_y_no_lo_toca (%s)', (_, ponerAntes) => {
  const bd = baseV1ConDatos()
  const ruta = join(carpeta, nombreDeLaCopia(2))
  ponerAntes(bd, ruta)
  const antes = readFileSync(ruta)
  bd.ejecutar("INSERT INTO grupos_musculares (nombre) VALUES ('Después de la copia')")

  const error = lanzado(() => copiarBase(bd, ruta))

  expect(error).toBeInstanceOf(SinCopia)
  expect(error).toMatchObject({ name: 'SinCopia' })
  // Con el error de SQLite dentro, para el detalle de la pantalla.
  const causa = (error as SinCopia).causa as { message: string }
  expect(causa.message.length).toBeGreaterThan(0)
  // (En Jest el error de node:sqlite es de otro contexto y no pasa por `instanceof Error`:
  // sale con su «Error: » delante. En el teléfono no.)
  expect((error as Error).message).toMatch(/^No se ha podido guardar la copia: /)
  expect((error as Error).message).toContain(causa.message)
  expect(readFileSync(ruta).equals(antes)).toBe(true)
  expect(basesAdjuntas(bd)).toEqual([])
})

test('dentro_de_una_transaccion_lanza_sin_crear_nada', () => {
  const bd = baseV1ConDatos()
  const ruta = join(carpeta, nombreDeLaCopia(2))

  expect(() => bd.transaccion(() => copiarBase(bd, ruta))).toThrow(/transacción/)

  expect(existsSync(ruta)).toBe(false)
  expect(basesAdjuntas(bd)).toEqual([])
})

/**
 * La base, pero con una respuesta cambiada al mirar la copia: para ver qué hace `copiarBase`
 * con una copia que no cuadra (la que se escribe de verdad siempre cuadra).
 */
function conLaCopiaCambiada(bd: Bd, cambiar: (sql: string) => unknown): Bd {
  return {
    ...bd,
    una<T>(sql: string, ...params: Parameters<Bd['una']>[1][]) {
      const cambiada = cambiar(sql)
      return (cambiada === undefined ? bd.una<T>(sql, ...params) : cambiada) as T | undefined
    },
    get enTransaccion() {
      return bd.enTransaccion
    },
  }
}

test.each([
  [
    'le falta una fila',
    (sql: string) => (/FROM copia\."series"/.test(sql) ? { n: 0 } : undefined),
    /la tabla series tiene \d+ filas y en la copia 0/,
  ],
  [
    'es de otra versión',
    (sql: string) => (sql === 'PRAGMA copia.user_version' ? { user_version: 0 } : undefined),
    /la copia es de otra versión/,
  ],
  [
    'está dañada',
    (sql: string) =>
      sql === 'PRAGMA copia.quick_check' ? { quick_check: 'página 3 rota' } : undefined,
    /la copia está dañada: página 3 rota/,
  ],
])('una_copia_que_%s_lanza_sin_copia_y_la_suelta', (_, cambiar, mensaje) => {
  const bd = baseV1ConDatos()

  const error = lanzado(() => copiarBase(conLaCopiaCambiada(bd, cambiar), join(carpeta, 'c.db')))

  expect(error).toBeInstanceOf(SinCopia)
  expect((error as Error).message).toMatch(mensaje)
  // Con el fallo después de adjuntarla, también se suelta.
  expect(basesAdjuntas(bd)).toEqual([])
})

test('una_base_en_wal_copia_tambien_lo_que_aun_esta_en_el_wal', () => {
  const ruta = join(carpeta, 'base.db')
  const bd = abrirArchivo(ruta)
  expect(bd.una('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' })
  aplicarMigraciones(bd)
  bd.ejecutar("INSERT INTO grupos_musculares (nombre) VALUES ('Recién escrito')")
  // Lo último está aún en el `-wal`, no en el `.db`: copiar el archivo a mano lo perdería.
  expect(statSync(`${ruta}-wal`).size).toBeGreaterThan(0)

  const copia = join(carpeta, nombreDeLaCopia(2))
  copiarBase(bd, copia)

  expect(
    abrirArchivo(copia).una("SELECT nombre FROM grupos_musculares WHERE nombre = 'Recién escrito'"),
  ).toEqual({ nombre: 'Recién escrito' })
})

test('el_nombre_de_la_copia_lleva_la_version_de_destino', () => {
  expect(nombreDeLaCopia(2)).toBe('antes-de-la-v2.db')
  expect(nombreDeLaCopia(10)).toBe('antes-de-la-v10.db')
  // Y lo que da se reconoce como copia.
  expect(copiasQueSobran([nombreDeLaCopia(2)], 0)).toEqual([nombreDeLaCopia(2)])
})

test('sobran_las_copias_que_no_son_de_las_dos_versiones_mas_altas_en_orden_numerico', () => {
  const nombres = [
    'antes-de-la-v9.db',
    'antes-de-la-v10.db',
    'antes-de-la-v2.db',
    'antes-de-la-v11.db',
  ]

  // v10 y v11 van después de v9 aunque por letras irían antes.
  expect(copiasQueSobran(nombres).sort()).toEqual(['antes-de-la-v2.db', 'antes-de-la-v9.db'])
  expect(copiasQueSobran(nombres, 3)).toEqual(['antes-de-la-v2.db'])
})

test('lo_que_no_es_una_copia_no_se_borra_nunca', () => {
  const nombres = [
    'antes-de-la-v2.db',
    'antes-de-la-v3.db',
    'antes-de-la-v4.db',
    // Lo que deja SQLite junto a un archivo, y cualquier otra cosa de la carpeta.
    'antes-de-la-v1.db-wal',
    'antes-de-la-v1.db-journal',
    'antes-de-la-vx.db',
    'antes-de-la-v.db',
    'otra-cosa.db',
    'ANTES-DE-LA-V1.DB',
  ]

  expect(copiasQueSobran(nombres)).toEqual(['antes-de-la-v2.db'])
  expect(copiasQueSobran([])).toEqual([])
  expect(copiasQueSobran(['antes-de-la-v2.db', 'antes-de-la-v3.db'])).toEqual([])
})
