/**
 * Tests del esquema SQLite del teléfono: que tiene las mismas tablas, claves ajenas y
 * restricciones que el de PostgreSQL (`backend/app/models.py`), y lo que SQLite no hace
 * por sí solo (STRICT, longitudes, topes de las centésimas, `updated_at`).
 *
 * Sustituyen al test del backend que compara la base con los modelos.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Bd, Valor } from '../../src/logica/bd/bd'
import { AHORA, baseNueva } from '../apoyo/baseNueva'
import {
  filaAlternativa,
  filaEjercicio,
  filaEntrenamiento,
  filaHueco,
  filaPrograma,
  filaRutina,
  filaSerie,
  insertar,
  unGrupo,
} from '../apoyo/filas'

let bd: Bd
beforeEach(() => {
  bd = baseNueva()
})

const TABLAS = [
  'ejercicios',
  'entrenamientos',
  'excepciones_del_plan',
  'grupos_musculares',
  'meta',
  'notas_ejercicio',
  'programa_dias',
  'programa_periodos',
  'programas',
  'rutina_periodos_ocultos',
  'rutina_slots',
  'rutinas',
  'series',
  'slot_alternativas',
]

const MODELOS = readFileSync(
  join(__dirname, '..', '..', '..', 'backend', 'app', 'models.py'),
  'utf8',
)

/** Espera que la base rechace la escritura con un CHECK concreto (su nombre o su expresión). */
function chocaCon(fn: () => unknown, restriccion: string) {
  expect(fn).toThrow(`CHECK constraint failed: ${restriccion}`)
}

// --- Tablas y claves ajenas ---

test('estan_las_13_tablas_del_backend_mas_meta_y_todas_son_strict', () => {
  const tablas = bd.todas<{ name: string; strict: number }>(
    "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table'" +
      " AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )

  expect(tablas.map((t) => t.name)).toEqual(TABLAS)
  expect(tablas.filter((t) => t.strict !== 1)).toEqual([])
})

test('las_tablas_son_las_de_los_modelos_del_backend', () => {
  const delBackend = [...MODELOS.matchAll(/__tablename__ = "(\w+)"/g)].map((m) => m[1])

  expect(delBackend).toHaveLength(13)
  expect([...delBackend, 'meta'].sort()).toEqual(TABLAS)
})

test('las_claves_ajenas_son_las_de_los_modelos_del_backend_con_su_on_delete', () => {
  // De models.py: «columna: Mapped[...] = mapped_column(ForeignKey("tabla.id", ondelete=...»,
  // dentro de la clase de cada tabla.
  const esperadas: string[] = []
  for (const clase of MODELOS.split(/\nclass /).slice(1)) {
    const tabla = clase.match(/__tablename__ = "(\w+)"/)?.[1]
    if (!tabla) continue
    const fks = clase.matchAll(
      /(\w+): Mapped\[[^\]]*\] = mapped_column\(\s*ForeignKey\("(\w+)\.id"(?:, ondelete="(\w+)")?/g,
    )
    for (const [, columna, destino, alBorrar] of fks) {
      esperadas.push(`${tabla}.${columna} -> ${destino} ${alBorrar ?? 'NO ACTION'}`)
    }
  }
  const reales = TABLAS.flatMap((tabla) =>
    bd
      .todas<{ from: string; table: string; on_delete: string }>(
        'SELECT * FROM pragma_foreign_key_list(?)',
        tabla,
      )
      .map((fk) => `${tabla}.${fk.from} -> ${fk.table} ${fk.on_delete}`),
  )

  expect(esperadas).toHaveLength(15)
  expect(reales.sort()).toEqual(esperadas.sort())
})

test('las_claves_ajenas_estan_activadas_al_abrir', () => {
  expect(bd.una('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 })
  expect(bd.todas('PRAGMA foreign_key_check')).toEqual([])
})

test('una_clave_ajena_a_una_fila_que_no_existe_se_rechaza', () => {
  expect(() => filaEjercicio(bd, { grupo_muscular_id: 9999 })).toThrow(
    'FOREIGN KEY constraint failed',
  )
})

// --- Un CHECK de cada tabla ---

test('grupos_musculares_rechaza_un_nombre_repetido', () => {
  expect(() => insertar(bd, 'grupos_musculares', { nombre: 'Pecho' })).toThrow(
    'UNIQUE constraint failed: grupos_musculares.nombre',
  )
})

test('grupos_musculares_rechaza_un_nombre_de_51', () => {
  expect(() => insertar(bd, 'grupos_musculares', { nombre: 'x'.repeat(50) })).not.toThrow()
  expect(() => insertar(bd, 'grupos_musculares', { nombre: 'y'.repeat(51) })).toThrow(
    'CHECK constraint failed',
  )
})

// Ya falló: con `nombre ... CONSTRAINT grupos_musculares_nombre_key UNIQUE CHECK (...)`,
// SQLite le daba el nombre del UNIQUE también al CHECK, y un nombre de 51 caracteres salía
// como «grupos_musculares_nombre_key», el nombre de un nombre repetido.
test('el_check_de_longitud_de_grupos_musculares_no_se_llama_como_el_unique', () => {
  chocaCon(
    () => insertar(bd, 'grupos_musculares', { nombre: 'x'.repeat(51) }),
    'length(nombre) <= 50',
  )
})

test('ejercicios_rechaza_un_tipo_que_no_existe', () => {
  chocaCon(() => filaEjercicio(bd, { tipo_registro: 'otro' }), 'ejercicios_tipo_registro_check')
})

test('ejercicios_rechaza_un_es_predefinido_que_no_es_0_ni_1', () => {
  chocaCon(() => filaEjercicio(bd, { es_predefinido: 2 }), 'es_predefinido IN (0, 1)')
})

test('ejercicios_rechaza_una_descripcion_de_501', () => {
  expect(() => filaEjercicio(bd, { descripcion: 'x'.repeat(500) })).not.toThrow()
  chocaCon(
    () => filaEjercicio(bd, { nombre: 'Otro', descripcion: 'x'.repeat(501) }),
    'length(descripcion) <= 500',
  )
})

test('ejercicios_pone_peso_reps_y_no_predefinido_si_no_se_dice', () => {
  const id = insertar(bd, 'ejercicios', {
    nombre: 'Remo',
    grupo_muscular_id: unGrupo(bd),
    created_at: AHORA,
    updated_at: AHORA,
  })

  expect(bd.una('SELECT tipo_registro, es_predefinido FROM ejercicios WHERE id = ?', id)).toEqual({
    tipo_registro: 'peso_reps',
    es_predefinido: 0,
  })
})

test('notas_ejercicio_rechaza_una_nota_de_1001', () => {
  const ejercicio = filaEjercicio(bd)
  const nota = (texto: string) =>
    insertar(bd, 'notas_ejercicio', {
      ejercicio_id: ejercicio,
      nota: texto,
      created_at: AHORA,
      updated_at: AHORA,
    })

  expect(() => nota('x'.repeat(1000))).not.toThrow()
  chocaCon(() => nota('x'.repeat(1001)), 'length(nota) <= 1000')
})

test('rutina_periodos_ocultos_rechaza_un_tramo_sin_dias', () => {
  const rutina = filaRutina(bd)
  const tramo = (desde: string, hasta: string) =>
    insertar(bd, 'rutina_periodos_ocultos', { rutina_id: rutina, desde, hasta })

  expect(() => tramo('2026-09-01', '2026-09-02')).not.toThrow()
  chocaCon(() => tramo('2026-09-01', '2026-09-01'), 'rutina_periodos_ocultos_rango_check')
  chocaCon(() => tramo('2026-09-02', '2026-09-01'), 'rutina_periodos_ocultos_rango_check')
})

describe.each([
  ['rutina_slots', 'rutina_slots_objetivo_check'],
  ['slot_alternativas', 'slot_alternativas_objetivo_check'],
])('%s: el objetivo es de repeticiones o de duración, cada par completo', (tabla, check) => {
  const SIN = { reps_min: null, reps_max: null, duracion_min_s: null, duracion_max_s: null }

  function conObjetivo(objetivo: Record<string, Valor>) {
    const rutina = filaRutina(bd)
    const ejercicio = filaEjercicio(bd)
    if (tabla === 'rutina_slots') return filaHueco(bd, rutina, ejercicio, { ...SIN, ...objetivo })
    const hueco = filaHueco(bd, rutina, ejercicio)
    return filaAlternativa(bd, hueco, filaEjercicio(bd, { nombre: 'Otro' }), {
      ...SIN,
      ...objetivo,
    })
  }

  test('de_repeticiones_vale', () => {
    expect(() => conObjetivo({ reps_min: 8, reps_max: 12 })).not.toThrow()
  })

  test('de_duracion_vale', () => {
    expect(() => conObjetivo({ duracion_min_s: 30, duracion_max_s: 60 })).not.toThrow()
  })

  test.each([
    ['sin objetivo', {}],
    ['con las dos cosas', { reps_min: 8, reps_max: 12, duracion_min_s: 30, duracion_max_s: 60 }],
    ['con repeticiones a medias', { reps_min: 8 }],
    ['con duración a medias', { duracion_max_s: 60 }],
  ])('%s se rechaza', (_, objetivo) => {
    chocaCon(() => conObjetivo(objetivo), check)
  })
})

test('rutina_slots_no_repite_orden_en_la_misma_rutina_y_si_en_otra', () => {
  const ejercicio = filaEjercicio(bd)
  const push = filaRutina(bd)
  filaHueco(bd, push, ejercicio, { orden: 1 })

  expect(() => filaHueco(bd, push, ejercicio, { orden: 1 })).toThrow(
    'UNIQUE constraint failed: rutina_slots.rutina_id, rutina_slots.orden',
  )
  expect(() =>
    filaHueco(bd, filaRutina(bd, { nombre: 'Pull' }), ejercicio, { orden: 1 }),
  ).not.toThrow()
})

test('slot_alternativas_no_repite_ejercicio_en_el_mismo_hueco', () => {
  const ejercicio = filaEjercicio(bd)
  const comodin = filaEjercicio(bd, { nombre: 'Press en máquina' })
  const hueco = filaHueco(bd, filaRutina(bd), ejercicio)
  filaAlternativa(bd, hueco, comodin)

  expect(() => filaAlternativa(bd, hueco, comodin)).toThrow(
    'UNIQUE constraint failed: slot_alternativas.slot_id, slot_alternativas.ejercicio_id',
  )
})

test('entrenamientos_no_repite_fecha_ni_cubre_fecha_pero_si_cubre_fecha_nula', () => {
  const rutina = filaRutina(bd)
  filaEntrenamiento(bd, rutina, { fecha: '2026-09-01', cubre_fecha: '2026-08-31' })

  expect(() => filaEntrenamiento(bd, rutina, { fecha: '2026-09-01' })).toThrow(
    'UNIQUE constraint failed: entrenamientos.fecha',
  )
  expect(() =>
    filaEntrenamiento(bd, rutina, { fecha: '2026-09-02', cubre_fecha: '2026-08-31' }),
  ).toThrow('UNIQUE constraint failed: entrenamientos.cubre_fecha')
  filaEntrenamiento(bd, rutina, { fecha: '2026-09-03', cubre_fecha: null })
  expect(() =>
    filaEntrenamiento(bd, rutina, { fecha: '2026-09-04', cubre_fecha: null }),
  ).not.toThrow()
})

test('entrenamientos_rechaza_unas_notas_de_1001', () => {
  chocaCon(
    () => filaEntrenamiento(bd, filaRutina(bd), { notas: 'x'.repeat(1001) }),
    'length(notas) <= 1000',
  )
})

describe('series', () => {
  let entrenamiento: number
  let hueco: number
  let ejercicio: number
  beforeEach(() => {
    const rutina = filaRutina(bd)
    ejercicio = filaEjercicio(bd)
    hueco = filaHueco(bd, rutina, ejercicio)
    entrenamiento = filaEntrenamiento(bd, rutina)
  })
  const SIN = { peso_centesimas: null, repeticiones: null, duracion_s: null, distancia_m: null }
  const serie = (medidas: Record<string, Valor>) =>
    filaSerie(bd, entrenamiento, hueco, ejercicio, { ...SIN, ...medidas })

  test.each([
    ['peso y repeticiones', { peso_centesimas: 8000, repeticiones: 8 }],
    ['peso 0 y repeticiones', { peso_centesimas: 0, repeticiones: 8 }],
    ['ayuda y repeticiones', { peso_centesimas: -2000, repeticiones: 8 }],
    ['con peso corporal', { peso_centesimas: 0, repeticiones: 8, peso_corporal_centesimas: 7500 }],
    ['solo tiempo', { duracion_s: 60 }],
    ['tiempo con lastre', { duracion_s: 60, peso_centesimas: 1000 }],
    ['cardio', { duracion_s: 1200, distancia_m: 5000 }],
  ])('%s vale', (_, medidas) => {
    expect(() => serie(medidas)).not.toThrow()
  })

  test.each([
    ['repeticiones sin peso', { repeticiones: 8 }],
    ['peso sin nada más', { peso_centesimas: 8000 }],
    ['sin ninguna medida', {}],
    ['repeticiones y tiempo', { peso_centesimas: 0, repeticiones: 8, duracion_s: 60 }],
    ['repeticiones y distancia', { peso_centesimas: 0, repeticiones: 8, distancia_m: 100 }],
    ['tiempo con peso y distancia', { duracion_s: 60, peso_centesimas: 1000, distancia_m: 100 }],
    ['distancia sin tiempo', { distancia_m: 100 }],
  ])('%s se rechaza por series_medidas_check', (_, medidas) => {
    chocaCon(() => serie(medidas), 'series_medidas_check')
  })

  test('una_ayuda_sin_repeticiones_se_rechaza_por_series_peso_check', () => {
    chocaCon(() => serie({ duracion_s: 60, peso_centesimas: -1000 }), 'series_peso_check')
  })

  test('una_duracion_de_0_se_rechaza_por_series_duracion_check', () => {
    chocaCon(() => serie({ duracion_s: 0 }), 'series_duracion_check')
  })

  test('una_distancia_de_0_se_rechaza_por_series_distancia_check', () => {
    chocaCon(() => serie({ duracion_s: 60, distancia_m: 0 }), 'series_distancia_check')
  })

  test.each([
    ['sin repeticiones', { duracion_s: 60, peso_corporal_centesimas: 7500 }],
    ['de 0', { peso_centesimas: 0, repeticiones: 8, peso_corporal_centesimas: 0 }],
    ['negativo', { peso_centesimas: 0, repeticiones: 8, peso_corporal_centesimas: -100 }],
  ])('un peso corporal %s se rechaza por series_peso_corporal_check', (_, medidas) => {
    chocaCon(() => serie(medidas), 'series_peso_corporal_check')
  })

  test('el_peso_llega_hasta_9999_99_por_arriba_y_por_abajo', () => {
    expect(() => serie({ repeticiones: 1, peso_centesimas: 999999 })).not.toThrow()
    expect(() => serie({ repeticiones: 1, peso_centesimas: -999999 })).not.toThrow()
    chocaCon(
      () => serie({ repeticiones: 1, peso_centesimas: 1000000 }),
      'peso_centesimas BETWEEN -999999 AND 999999',
    )
    chocaCon(
      () => serie({ repeticiones: 1, peso_centesimas: -1000000 }),
      'peso_centesimas BETWEEN -999999 AND 999999',
    )
  })

  test('el_peso_corporal_llega_hasta_999_99', () => {
    const conCorporal = (centesimas: number) =>
      serie({ repeticiones: 8, peso_centesimas: 0, peso_corporal_centesimas: centesimas })

    expect(() => conCorporal(99999)).not.toThrow()
    chocaCon(() => conCorporal(100000), 'peso_corporal_centesimas <= 99999')
  })

  test('la_variante_llega_hasta_100', () => {
    const conVariante = (variante: string) =>
      serie({ repeticiones: 8, peso_centesimas: 0, variante })

    expect(() => conVariante('x'.repeat(100))).not.toThrow()
    chocaCon(() => conVariante('x'.repeat(101)), 'length(variante) <= 100')
  })

  test('strict_rechaza_un_80_5_en_una_columna_entera', () => {
    expect(() => serie({ repeticiones: 8, peso_centesimas: 80.5 })).toThrow(
      'cannot store REAL value in INTEGER column series.peso_centesimas',
    )
  })

  test('strict_rechaza_un_texto_que_no_es_un_numero_en_una_columna_entera', () => {
    expect(() => serie({ repeticiones: 'ocho', peso_centesimas: 0 })).toThrow(
      'cannot store TEXT value in INTEGER column series.repeticiones',
    )
  })
})

describe.each([
  ['ejercicios', (b: Bd, nombre: string) => filaEjercicio(b, { nombre })],
  ['rutinas', (b: Bd, nombre: string) => filaRutina(b, { nombre })],
  ['programas', (b: Bd, nombre: string) => filaPrograma(b, { nombre })],
])('%s: el nombre llega hasta 100 caracteres', (_, crear) => {
  test('100_vale_y_101_no', () => {
    expect(() => crear(bd, 'x'.repeat(100))).not.toThrow()
    chocaCon(() => crear(bd, 'x'.repeat(101)), 'length(nombre) <= 100')
  })

  test('cuenta_caracteres_y_no_bytes', () => {
    // String(100) de PostgreSQL cuenta caracteres: 100 eñes caben, aunque sean 200 bytes.
    expect(() => crear(bd, 'ñ'.repeat(100))).not.toThrow()
  })
})

// --- Programas ---

describe('programa_dias', () => {
  let programa: number
  let rutina: number
  beforeEach(() => {
    programa = filaPrograma(bd)
    rutina = filaRutina(bd)
  })
  const dia = (cambios: Record<string, Valor>) =>
    insertar(bd, 'programa_dias', {
      programa_id: programa,
      rutina_id: rutina,
      dia_semana: 1,
      ...cambios,
    })

  test.each([0, 8])('el_dia_%i_se_rechaza', (n) => {
    chocaCon(() => dia({ dia_semana: n }), 'programa_dias_dia_semana_check')
  })

  test('del_1_al_7_valen', () => {
    for (let n = 1; n <= 7; n++) expect(() => dia({ dia_semana: n })).not.toThrow()
  })

  test('una_vigencia_sin_dias_se_rechaza_y_una_abierta_por_un_lado_vale', () => {
    chocaCon(
      () => dia({ desde: '2026-09-01', hasta: '2026-09-01' }),
      'programa_dias_vigencia_check',
    )
    expect(() => dia({ desde: null, hasta: '2026-09-01' })).not.toThrow()
    expect(() => dia({ dia_semana: 2, desde: '2026-09-01', hasta: null })).not.toThrow()
  })

  test('dos_filas_abiertas_del_mismo_dia_chocan_y_una_cerrada_no', () => {
    dia({ dia_semana: 1, desde: '2026-09-01' })
    expect(() => dia({ dia_semana: 1, desde: '2026-08-01', hasta: '2026-09-01' })).not.toThrow()

    expect(() => dia({ dia_semana: 1, desde: '2026-10-01' })).toThrow(
      'UNIQUE constraint failed: programa_dias.programa_id, programa_dias.dia_semana',
    )
  })

  test('el_mismo_dia_abierto_en_dos_programas_no_choca', () => {
    dia({ dia_semana: 1 })

    expect(() =>
      insertar(bd, 'programa_dias', {
        programa_id: filaPrograma(bd, { nombre: 'Otro' }),
        rutina_id: rutina,
        dia_semana: 1,
      }),
    ).not.toThrow()
  })
})

describe('programa_periodos', () => {
  const periodo = (programa: number, desde: string, hasta: string | null) =>
    insertar(bd, 'programa_periodos', { programa_id: programa, desde, hasta })

  test('un_periodo_que_acaba_antes_de_empezar_se_rechaza_y_uno_de_cero_dias_vale', () => {
    const programa = filaPrograma(bd)

    chocaCon(() => periodo(programa, '2026-09-02', '2026-09-01'), 'programa_periodos_rango_check')
    expect(() => periodo(programa, '2026-09-01', '2026-09-01')).not.toThrow()
  })

  test('dos_periodos_abiertos_chocan_aunque_sean_de_programas_distintos', () => {
    const ppl = filaPrograma(bd)
    const torso = filaPrograma(bd, { nombre: 'Torso-pierna' })
    periodo(ppl, '2026-09-01', null)

    expect(() => periodo(torso, '2026-09-05', null)).toThrow('UNIQUE constraint failed')
    expect(() => periodo(ppl, '2026-09-05', null)).toThrow('UNIQUE constraint failed')
  })

  test('muchos_periodos_cerrados_y_uno_abierto_conviven', () => {
    const ppl = filaPrograma(bd)
    const torso = filaPrograma(bd, { nombre: 'Torso-pierna' })

    expect(() => {
      periodo(ppl, '2026-08-01', '2026-08-10')
      periodo(torso, '2026-08-10', '2026-08-20')
      periodo(ppl, '2026-08-20', '2026-09-01')
      periodo(torso, '2026-09-01', null)
    }).not.toThrow()
  })
})

test('excepciones_del_plan_no_repite_fecha_y_admite_descanso', () => {
  const excepcion = (fecha: string, rutina: number | null) =>
    insertar(bd, 'excepciones_del_plan', {
      fecha,
      rutina_id: rutina,
      created_at: AHORA,
      updated_at: AHORA,
    })
  excepcion('2026-09-01', filaRutina(bd))

  expect(() => excepcion('2026-09-01', null)).toThrow(
    'UNIQUE constraint failed: excepciones_del_plan.fecha',
  )
  expect(() => excepcion('2026-09-02', null)).not.toThrow()
})

// --- updated_at ---

describe('el disparador de updated_at', () => {
  const VIEJO = '2026-01-01T00:00:00.000Z'
  const updatedAt = (id: number) =>
    bd.una<{ updated_at: string }>('SELECT updated_at FROM rutinas WHERE id = ?', id)!.updated_at

  test('lo_cambia_al_cambiar_otra_columna', () => {
    const rutina = filaRutina(bd, { updated_at: VIEJO })

    bd.ejecutar("UPDATE rutinas SET nombre = 'Pull' WHERE id = ?", rutina)

    expect(updatedAt(rutina)).not.toBe(VIEJO)
    // Con el mismo formato que `toISOString()`, el de los instantes nuevos.
    expect(updatedAt(rutina)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    expect(Math.abs(Date.parse(updatedAt(rutina)) - Date.now())).toBeLessThan(60_000)
  })

  test('no_lo_cambia_si_el_update_no_cambia_nada', () => {
    const rutina = filaRutina(bd, { nombre: 'Push', updated_at: VIEJO })

    const { cambios } = bd.ejecutar("UPDATE rutinas SET nombre = 'Push' WHERE id = ?", rutina)

    expect(cambios).toBe(1)
    expect(updatedAt(rutina)).toBe(VIEJO)
  })

  test('cuenta_el_paso_de_un_valor_a_null_como_un_cambio', () => {
    const rutina = filaRutina(bd, { oculto_desde: '2026-09-01', updated_at: VIEJO })

    bd.ejecutar('UPDATE rutinas SET oculto_desde = NULL WHERE id = ?', rutina)

    expect(updatedAt(rutina)).not.toBe(VIEJO)
  })

  test('respeta_un_updated_at_puesto_a_mano', () => {
    const rutina = filaRutina(bd, { updated_at: VIEJO })

    bd.ejecutar(
      "UPDATE rutinas SET nombre = 'Pull', updated_at = '2030-05-05T05:05:05.000Z' WHERE id = ?",
      rutina,
    )

    expect(updatedAt(rutina)).toBe('2030-05-05T05:05:05.000Z')
  })

  test('esta_en_las_8_tablas_con_updated_at_y_mira_todas_sus_demas_columnas', () => {
    // Todo sale de la base migrada, no de la lista con la que se monta la v1: así vale
    // también cuando una versión nueva añada tablas, columnas o disparadores propios.
    const columnasDe = (tabla: string) =>
      bd.todas<{ name: string }>('SELECT name FROM pragma_table_info(?)', tabla).map((c) => c.name)
    const conUpdatedAt = TABLAS.filter((tabla) => columnasDe(tabla).includes('updated_at'))
    const disparadores = bd.todas<{ name: string; tbl_name: string; sql: string }>(
      "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name",
    )

    expect(conUpdatedAt).toHaveLength(8)
    expect(disparadores.map((d) => [d.name, d.tbl_name])).toEqual(
      conUpdatedAt.map((t) => [`${t}_updated_at`, t]).sort(),
    )
    for (const { tbl_name: tabla, sql } of disparadores) {
      // Las columnas que mira son las de «NEW.x IS NOT OLD.x»: tienen que ser todas menos
      // `id` y `updated_at`, o cambiar una de las que falten no actualizaría `updated_at`.
      const miradas = [...sql.matchAll(/NEW\.(\w+) IS NOT OLD\.\1\b/g)].map((m) => m[1])
      const demas = columnasDe(tabla).filter((c) => c !== 'id' && c !== 'updated_at')
      expect([tabla, miradas.sort()]).toEqual([tabla, demas.sort()])
    }
  })
})
