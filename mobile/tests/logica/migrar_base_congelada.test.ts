/**
 * Las bases congeladas de la versión 1 (`congelar_bases.test.ts`) se ponen al día con las
 * migraciones de ahora sin perder nada, y la app las sigue leyendo.
 *
 * Es la red para el día en que llegue la v2: un teléfono con datos de verdad no empieza en
 * una base vacía, y un paso que funciona en la base de los tests puede romper una con
 * historial. Hoy no hay pasos detrás de la v1, así que migrar no hace nada; los tests ya
 * están para cuando los haya.
 *
 * - `tests/fijos/base_v1.sql`: la sintética, siempre.
 * - `.claude/datos_reales/base_v1_real_2026_11_10.sql`: la real, solo en el equipo del autor
 *   (fuera de git); si falta, sus tests se saltan con un aviso.
 */
import { existsSync, readFileSync } from 'node:fs'

import type { Bd } from '../../src/logica/bd/bd'
import {
  aplicarMigraciones,
  MigracionPeligrosa,
  MIGRACIONES,
  VERSION_ACTUAL,
  versionDeLaBase,
} from '../../src/logica/bd/migraciones'
import { ClienteDeTest, RelojDeTest, ZONA } from '../apoyo/cliente'
import { rehacerIgual } from '../apoyo/rehacerIgual'
import {
  BASE_V1,
  BASE_V1_REAL,
  baseVaciaEnLaVersion,
  cargarVolcado,
  tablasEnOrden,
  versionDelVolcado,
  volcar,
} from '../apoyo/volcado'

interface Foto {
  filas: Record<string, number>
  ids: Record<string, number[]>
  secuencias: Record<string, number>
}

/** Cuántas filas tiene cada tabla, sus ids y las secuencias de `sqlite_sequence`. */
function foto(bd: Bd): Foto {
  const filas: Record<string, number> = {}
  const ids: Record<string, number[]> = {}
  for (const tabla of tablasEnOrden(bd)) {
    filas[tabla] = bd.una<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla}`)!.n
    const columnas = bd.todas<{ name: string }>('SELECT name FROM pragma_table_info(?)', tabla)
    if (columnas.some((c) => c.name === 'id')) {
      ids[tabla] = bd.todas<{ id: number }>(`SELECT id FROM ${tabla} ORDER BY id`).map((f) => f.id)
    }
  }
  const secuencias = Object.fromEntries(
    bd
      .todas<{ name: string; seq: number }>('SELECT name, seq FROM sqlite_sequence')
      .map((s) => [s.name, s.seq]),
  )
  return { filas, ids, secuencias }
}

/** Lo de `despues` que estaba en `antes`: una tabla nueva de una versión futura no cuenta. */
function soloLasDe<T>(antes: Record<string, T>, despues: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(antes).map((clave) => [clave, despues[clave]]))
}

function cargar(ruta: string): { bd: Bd; sql: string } {
  const sql = readFileSync(ruta, 'utf8')
  const bd = baseVaciaEnLaVersion(versionDelVolcado(sql))
  cargarVolcado(bd, sql)
  return { bd, sql }
}

function clienteSobre(bd: Bd, hoy: string): ClienteDeTest {
  const reloj = new RelojDeTest()
  reloj.fijar(hoy)
  return new ClienteDeTest({ bd, reloj, zona: () => ZONA })
}

function leer(cliente: ClienteDeTest, url: string, params = {}): any {
  const respuesta = cliente.get(url, { params })
  expect([url, respuesta.status_code, respuesta.text]).toEqual([url, 200, respuesta.text])
  return respuesta.json()
}

/** El archivo de exportar sin `exportado_en`, que cambia en cada exportación. */
function exportado(cliente: ClienteDeTest): Record<string, unknown> {
  const { exportado_en: _fuera, ...resto } = leer(cliente, '/datos/exportar')
  return resto
}

/** El mes (`2026-09`) de la última sesión: el que se mira en el historial. */
function mesDeLaUltimaSesion(bd: Bd): string {
  return bd
    .una<{ fecha: string }>('SELECT max(fecha) AS fecha FROM entrenamientos')!
    .fecha.slice(0, 7)
}

function ultimoDiaDe(mes: string): string {
  const [anio, numero] = mes.split('-').map(Number)
  const dia = new Date(Date.UTC(anio, numero, 0)).getUTCDate()
  return `${mes}-${String(dia).padStart(2, '0')}`
}

interface Congelada {
  nombre: string
  ruta: string
  /** El día en que se congeló: «hoy» para leerla. */
  hoy: string
}

const SINTETICA: Congelada = { nombre: 'sintética', ruta: BASE_V1, hoy: '2026-10-01' }
const REAL: Congelada = { nombre: 'real', ruta: BASE_V1_REAL, hoy: '2026-11-10' }

const hayReal = existsSync(BASE_V1_REAL)
if (!hayReal) {
  console.warn(
    `Se saltan los tests de la base v1 real: no está ${BASE_V1_REAL} (es local, fuera de git).`,
  )
}

describe.each([
  [SINTETICA, true],
  [REAL, hayReal],
])('la base v1 congelada', (congelada, hay) => {
  const siHay = hay ? test : test.skip

  siHay(`se_carga_tal_cual (${congelada.nombre})`, () => {
    const { bd, sql } = cargar(congelada.ruta)

    expect(versionDeLaBase(bd)).toBe(1)
    // Volcarla otra vez da el mismo archivo: el volcado no se deja nada por el camino.
    expect(volcar(bd)).toBe(sql)
  })

  siHay(`se_pone_al_dia_sin_perder_filas_ids_ni_secuencias (${congelada.nombre})`, () => {
    const { bd } = cargar(congelada.ruta)
    const antes = foto(bd)

    const aplicados = aplicarMigraciones(bd)

    expect(aplicados).toEqual(MIGRACIONES.filter((m) => m.version > 1).map((m) => m.version))
    expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL)
    const despues = foto(bd)
    expect(soloLasDe(antes.filas, despues.filas)).toEqual(antes.filas)
    expect(soloLasDe(antes.ids, despues.ids)).toEqual(antes.ids)
    expect(soloLasDe(antes.secuencias, despues.secuencias)).toEqual(antes.secuencias)
    expect(bd.todas('PRAGMA foreign_key_check')).toEqual([])
    expect(bd.todas('PRAGMA quick_check')).toEqual([{ quick_check: 'ok' }])
  })

  siHay(`la_app_la_lee_entera_despues_de_ponerla_al_dia (${congelada.nombre})`, () => {
    const { bd } = cargar(congelada.ruta)
    const ids = foto(bd).ids
    const exportadoAntes = exportado(clienteSobre(bd, congelada.hoy))
    const resumenAntes = leer(clienteSobre(bd, congelada.hoy), '/datos/resumen')
    aplicarMigraciones(bd)
    const cliente = clienteSobre(bd, congelada.hoy)

    leer(cliente, '/plan/hoy')
    const mes = mesDeLaUltimaSesion(bd)
    const desde = `${mes}-01`
    const hasta = ultimoDiaDe(mes)
    leer(cliente, '/plan/seguimiento', { desde, hasta })
    leer(cliente, '/resumen', { mes })
    // El historial del mes trae justo las sesiones de ese mes, con sus ids.
    const delMes = leer(cliente, '/entrenamientos', { desde, hasta })
    const idsDelMes = bd
      .todas<{ id: number }>(
        'SELECT id FROM entrenamientos WHERE fecha BETWEEN ? AND ? ORDER BY id',
        desde,
        hasta,
      )
      .map((f) => f.id)
    expect(delMes.map((s: any) => s.id).sort((a: number, b: number) => a - b)).toEqual(idsDelMes)
    // Cada sesión, rutina y ejercicio propio se abre por su id de antes.
    for (const id of ids.entrenamientos) leer(cliente, `/entrenamientos/${id}`)
    for (const id of ids.rutinas) leer(cliente, `/rutinas/${id}`)
    for (const { id } of bd.todas<{ id: number }>(
      'SELECT id FROM ejercicios WHERE es_predefinido = 0',
    )) {
      leer(cliente, `/ejercicios/${id}`)
      leer(cliente, `/ejercicios/${id}/notas`)
    }

    expect(leer(cliente, '/datos/resumen')).toEqual(resumenAntes)
    // Mientras no cambie el formato del archivo, exportar da lo mismo antes y después.
    expect(exportado(cliente)).toEqual(exportadoAntes)
  })

  // El ensayo de una v2 que rehace tablas: con su mismo `CREATE` no cambia nada, así que
  // cualquier diferencia en lo exportado es algo que se ha perdido por el camino.
  siHay(
    `rehacer_entrenamientos_series_y_rutina_slots_tal_cual_deja_exportar_igual (${congelada.nombre})`,
    () => {
      const { bd } = cargar(congelada.ruta)
      aplicarMigraciones(bd)
      const exportadoAntes = exportado(clienteSobre(bd, congelada.hoy))
      const volcado = volcar(bd)
      const sql = ['entrenamientos', 'series', 'rutina_slots']
        .map((tabla) => rehacerIgual(bd, tabla))
        .join('\n')
      const ensayo = { version: VERSION_ACTUAL + 1, sql }

      // Sin la marca, se rechaza sin tocar nada.
      expect(() => aplicarMigraciones(bd, [...MIGRACIONES, ensayo])).toThrow(MigracionPeligrosa)
      expect(volcar(bd)).toBe(volcado)

      expect(
        aplicarMigraciones(bd, [...MIGRACIONES, { ...ensayo, sinClavesAjenas: true }]),
      ).toEqual([VERSION_ACTUAL + 1])
      expect(volcar(bd)).toBe(volcado.replace(/versión \d+\./, `versión ${VERSION_ACTUAL + 1}.`))
      expect(exportado(clienteSobre(bd, congelada.hoy))).toEqual(exportadoAntes)
    },
  )
})
