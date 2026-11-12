/**
 * Tests del arranque (`prepararBase`): poner la base al día copiándola antes, sincronizar los
 * predefinidos y limpiar las copias viejas, y qué estado devuelve cuando algo falla. Nunca
 * lanza: con un fallo, la app enseña la pantalla de arranque fallido.
 */
import { readFileSync } from 'node:fs'

import type { Bd } from '../../src/logica/bd/bd'
import { detalleDe, prepararBase, type PrepararBase } from '../../src/logica/bd/abrir'
import { SinCopia } from '../../src/logica/bd/copias'
import {
  MIGRACIONES,
  VERSION_ACTUAL,
  versionDeLaBase,
  type Migracion,
} from '../../src/logica/bd/migraciones'
import { AHORA, predefinidos } from '../apoyo/baseNueva'
import { abrirBdNode } from '../apoyo/bdNode'
import { BASE_V1, baseVaciaEnLaVersion, cargarVolcado, volcar } from '../apoyo/volcado'

const V2: Migracion = {
  version: VERSION_ACTUAL + 1,
  sql: 'CREATE TABLE nueva_en_la_v2 (x INTEGER) STRICT;',
}

function baseV1ConDatos(): Bd {
  const bd = baseVaciaEnLaVersion(1)
  cargarVolcado(bd, readFileSync(BASE_V1, 'utf8'))
  return bd
}

/** Las opciones de `prepararBase`, con espías para copiar y limpiar. */
function opciones({ migraciones }: Pick<PrepararBase, 'migraciones'> = {}) {
  return {
    copiar: jest.fn<void, [number, number]>(),
    limpiarCopias: jest.fn<void, []>(),
    predefinidos: predefinidos(),
    ahora: AHORA,
    migraciones,
  }
}

function predefinidosEnLaBase(bd: Bd): number {
  return bd.una<{ n: number }>('SELECT COUNT(*) AS n FROM ejercicios WHERE es_predefinido = 1')!.n
}

// --- Lo que sale bien ---------------------------------------------------------------------------

test('una_base_nueva_queda_lista_sembrada_y_sin_copiar', () => {
  const bd = abrirBdNode()
  const o = opciones()

  expect(prepararBase(bd, o)).toEqual({ tipo: 'lista' })

  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL)
  expect(predefinidosEnLaBase(bd)).toBe(predefinidos().ejercicios.length)
  // Una base nueva no tiene nada que copiar.
  expect(o.copiar).not.toHaveBeenCalled()
  expect(o.limpiarCopias).toHaveBeenCalledTimes(1)
})

test('una_base_con_datos_y_un_paso_pendiente_se_copia_antes_y_se_limpia_despues', () => {
  const bd = baseV1ConDatos()
  let versionAlCopiar: number | null = null
  const o = opciones({ migraciones: [...MIGRACIONES, V2] })
  o.copiar.mockImplementation(() => {
    versionAlCopiar = versionDeLaBase(bd)
  })

  expect(prepararBase(bd, o)).toEqual({ tipo: 'lista' })

  expect(o.copiar.mock.calls).toEqual([[VERSION_ACTUAL, VERSION_ACTUAL + 1]])
  // Se copia la base de antes, no la puesta al día.
  expect(versionAlCopiar).toBe(VERSION_ACTUAL)
  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL + 1)
  expect(o.limpiarCopias).toHaveBeenCalledTimes(1)
  expect(o.copiar.mock.invocationCallOrder[0]).toBeLessThan(
    o.limpiarCopias.mock.invocationCallOrder[0],
  )
})

test('una_base_al_dia_queda_lista_sin_copiar', () => {
  const bd = baseV1ConDatos()
  const o = opciones()

  expect(prepararBase(bd, o)).toEqual({ tipo: 'lista' })

  expect(o.copiar).not.toHaveBeenCalled()
  expect(o.limpiarCopias).toHaveBeenCalledTimes(1)
})

test('la_siembra_se_aplica_despues_de_poner_la_base_al_dia', () => {
  // La v2 de prueba apunta cada ejercicio que se inserta: si la siembra fuera antes de
  // migrar, no habría nada apuntado.
  const bd = abrirBdNode()
  const apuntar: Migracion = {
    version: VERSION_ACTUAL + 1,
    sql:
      'CREATE TABLE apuntados (nombre TEXT NOT NULL) STRICT;' +
      ' CREATE TRIGGER apuntar_ejercicio AFTER INSERT ON ejercicios' +
      ' BEGIN INSERT INTO apuntados (nombre) VALUES (NEW.nombre); END;',
  }

  expect(prepararBase(bd, opciones({ migraciones: [...MIGRACIONES, apuntar] }))).toEqual({
    tipo: 'lista',
  })

  expect(bd.una('SELECT COUNT(*) AS n FROM apuntados')).toEqual({
    n: predefinidos().ejercicios.length,
  })
})

test('si_limpiar_las_copias_falla_la_base_sigue_lista', () => {
  const bd = baseV1ConDatos()
  const o = opciones({ migraciones: [...MIGRACIONES, V2] })
  o.limpiarCopias.mockImplementation(() => {
    throw new Error('No se puede borrar')
  })

  expect(prepararBase(bd, o)).toEqual({ tipo: 'lista' })
  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL + 1)
})

// --- Lo que falla -------------------------------------------------------------------------------

test('una_base_mas_nueva_falla_sin_copiar_ni_tocarla', () => {
  const bd = baseV1ConDatos()
  bd.ejecutarVarias(`PRAGMA user_version = ${VERSION_ACTUAL + 1}`)
  const volcado = volcar(bd)
  const o = opciones()

  expect(prepararBase(bd, o)).toEqual({
    tipo: 'fallida',
    motivo: 'base_mas_nueva',
    detalle:
      'BaseMasNueva: Tus datos son de una versión más nueva de la app. Instala la última versión para abrirlos.',
  })

  expect(volcar(bd)).toBe(volcado)
  expect(o.copiar).not.toHaveBeenCalled()
  expect(o.limpiarCopias).not.toHaveBeenCalled()
})

test('si_no_se_puede_copiar_falla_sin_copia_sin_tocar_la_base', () => {
  const bd = baseV1ConDatos()
  const volcado = volcar(bd)
  const o = opciones({ migraciones: [...MIGRACIONES, V2] })
  o.copiar.mockImplementation(() => {
    throw new SinCopia(new Error('disco lleno'))
  })

  expect(prepararBase(bd, o)).toEqual({
    tipo: 'fallida',
    motivo: 'sin_copia',
    detalle: 'SinCopia: No se ha podido guardar la copia: disco lleno',
  })

  expect(volcar(bd)).toBe(volcado)
  expect(o.limpiarCopias).not.toHaveBeenCalled()
})

test('volver_a_intentarlo_tras_un_fallo_de_la_copia_pone_la_base_al_dia', () => {
  const bd = baseV1ConDatos()
  const migraciones = [...MIGRACIONES, V2]
  const sinEspacio = opciones({ migraciones })
  sinEspacio.copiar.mockImplementation(() => {
    throw new SinCopia(new Error('disco lleno'))
  })
  expect(prepararBase(bd, sinEspacio)).toMatchObject({ motivo: 'sin_copia' })

  const conEspacio = opciones({ migraciones })
  expect(prepararBase(bd, conEspacio)).toEqual({ tipo: 'lista' })

  expect(conEspacio.copiar.mock.calls).toEqual([[VERSION_ACTUAL, VERSION_ACTUAL + 1]])
  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL + 1)
})

test.each([
  [
    'un error de SQL',
    { version: VERSION_ACTUAL + 1, sql: 'INSERT INTO no_existe VALUES (1);' },
    /^Error: no such table: no_existe/,
  ],
  [
    'la red que impide perder datos',
    { version: VERSION_ACTUAL + 1, sql: 'DELETE FROM series;' },
    /^MigracionPeligrosa: La puesta al día a la versión \d+ deja la tabla series con 0 filas/,
  ],
  [
    'un paso que no se puede aplicar',
    { version: VERSION_ACTUAL + 1, sql: 'PRAGMA foreign_keys = OFF;' },
    /^MigracionPeligrosa: El paso \d+ lleva PRAGMA/,
  ],
])('si_poner_la_base_al_dia_falla_por_%s_queda_como_estaba', (_, paso, detalle) => {
  const bd = baseV1ConDatos()
  const volcado = volcar(bd)
  const o = opciones({ migraciones: [...MIGRACIONES, paso] })

  const estado = prepararBase(bd, o)

  expect(estado).toEqual({
    tipo: 'fallida',
    motivo: 'al_poner_al_dia',
    detalle: expect.any(String),
  })
  expect(estado).toMatchObject({ detalle: expect.stringMatching(detalle) })
  expect(volcar(bd)).toBe(volcado)
  expect(o.limpiarCopias).not.toHaveBeenCalled()
})

test('si_copiar_lanza_otra_cosa_que_sin_copia_falla_al_poner_al_dia', () => {
  // `hacerCopia` lo envuelve siempre en SinCopia; si no, cuenta como un fallo de la puesta al día.
  const bd = baseV1ConDatos()
  const o = opciones({ migraciones: [...MIGRACIONES, V2] })
  o.copiar.mockImplementation(() => {
    throw 'sin espacio'
  })

  expect(prepararBase(bd, o)).toEqual({
    tipo: 'fallida',
    motivo: 'al_poner_al_dia',
    detalle: 'sin espacio',
  })
  expect(versionDeLaBase(bd)).toBe(VERSION_ACTUAL)
})

test('si_la_siembra_falla_el_motivo_es_otro_y_no_se_limpian_las_copias', () => {
  const bd = abrirBdNode()
  const sinPredefinidos: Migracion = {
    version: VERSION_ACTUAL + 1,
    sql:
      'CREATE TRIGGER no_sembrar BEFORE INSERT ON ejercicios' +
      " BEGIN SELECT RAISE(ABORT, 'siembra rota'); END;",
  }
  const o = opciones({ migraciones: [...MIGRACIONES, sinPredefinidos] })

  const estado = prepararBase(bd, o)

  expect(estado).toEqual({ tipo: 'fallida', motivo: 'otro', detalle: expect.any(String) })
  expect(estado).toMatchObject({ detalle: expect.stringContaining('siembra rota') })
  // La siembra es todo o nada.
  expect(predefinidosEnLaBase(bd)).toBe(0)
  expect(o.limpiarCopias).not.toHaveBeenCalled()
})

test('el_detalle_es_el_nombre_y_el_mensaje_cortado_a_500_caracteres', () => {
  const largo = new Error('x'.repeat(600))

  expect(detalleDe(largo)).toBe(`Error: ${'x'.repeat(493)}`)
  expect(detalleDe(largo)).toHaveLength(500)
  expect(detalleDe(new SinCopia(new Error('disco lleno')))).toBe(
    'SinCopia: No se ha podido guardar la copia: disco lleno',
  )
  expect(detalleDe('sin espacio')).toBe('sin espacio')
  expect(detalleDe('y'.repeat(600))).toHaveLength(500)
})

test('un_fallo_largo_de_la_puesta_al_dia_llega_cortado', () => {
  const bd = baseV1ConDatos()
  const nombre = `no_existe_${'x'.repeat(600)}`

  const estado = prepararBase(
    bd,
    opciones({
      migraciones: [
        ...MIGRACIONES,
        { version: VERSION_ACTUAL + 1, sql: `INSERT INTO ${nombre} VALUES (1);` },
      ],
    }),
  )

  expect(estado).toMatchObject({ tipo: 'fallida', motivo: 'al_poner_al_dia' })
  expect((estado as { detalle: string }).detalle).toHaveLength(500)
})
