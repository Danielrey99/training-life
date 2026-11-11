/**
 * Cómo le fue a cada ejercicio de un día frente a la última vez (`mejora`) y el volumen del
 * día (`volumenDe`), de `src/reglasDePantalla/mejora.ts` (copia de las funciones de H2 de la
 * web, que no tenía tests). La especificación es el código, sus comentarios y las viñetas de H2
 * del diseño: qué decide si mejoró en cada tipo, qué insignias salen y en qué color, «nuevo»
 * sin vez anterior y el volumen solo de peso y repeticiones.
 */
import type { Serie, SesionHistorial, TipoRegistro } from '../../src/logica/tipos'
import { mejora, volumenDe } from '../../src/reglasDePantalla/mejora'
import { cambiarAjustes } from '../../src/utiles/ajustes'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

beforeEach(() => {
  cambiarAjustes({ unidad: 'kg', distancia: 'km', unoRM: 'media' })
})

type Medida = {
  peso?: string | null
  repeticiones?: number | null
  duracion_s?: number | null
  distancia_m?: number | null
}

let contador = 0

function serie(medidas: Medida, tipo: TipoRegistro = 'peso_reps'): Serie {
  contador += 1
  return {
    id: contador,
    entrenamiento_id: 1,
    ejercicio_id: 1,
    slot_id: 1,
    numero_serie: contador,
    peso: null,
    repeticiones: null,
    duracion_s: null,
    distancia_m: null,
    peso_corporal: null,
    variante: null,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ejercicio: {
      id: 1,
      nombre: 'Ejercicio',
      grupo_muscular_id: 1,
      descripcion: null,
      es_predefinido: false,
      tipo_registro: tipo,
      oculto_desde: null,
      created_at: '2026-01-01T00:00:00',
      updated_at: '2026-01-01T00:00:00',
    },
    ...medidas,
  }
}

function sesion(series: Serie[]): SesionHistorial {
  return {
    entrenamiento_id: 1,
    fecha: '2026-01-01',
    rutina: 'Push',
    series: series.map((s) => ({
      id: s.id,
      slot_id: s.slot_id,
      numero_serie: s.numero_serie,
      peso: s.peso,
      repeticiones: s.repeticiones,
      duracion_s: s.duracion_s,
      distancia_m: s.distancia_m,
      variante: s.variante,
    })),
  }
}

/** Series de un tipo a partir de sus medidas. */
const de = (tipo: TipoRegistro, ...medidas: Medida[]) => medidas.map((m) => serie(m, tipo))

/** La mejora de `hoy` frente a `antes` (listas de medidas). */
function comparar(tipo: TipoRegistro, hoy: Medida[], antes: Medida[]) {
  return mejora(tipo, de(tipo, ...hoy), sesion(de(tipo, ...antes)))
}

describe('sin series o sin vez anterior', () => {
  test('sin_series_hoy_no_hay_mejora', () => {
    expect(
      mejora('peso_reps', [], sesion(de('peso_reps', { peso: '80.00', repeticiones: 8 }))),
    ).toBeNull()
    expect(mejora('cardio', [], null)).toBeNull()
  })

  test.each<TipoRegistro>(['peso_reps', 'corporal', 'tiempo', 'cardio'])(
    'sin_vez_anterior_solo_sale_nuevo_en_%s',
    (tipo) => {
      const hoy = de(tipo, { peso: '10.00', repeticiones: 5, duracion_s: 60, distancia_m: 1000 })
      const esperado = { clase: 'igual', insignias: [{ texto: 'nuevo', clase: 'igual' }] }
      expect(mejora(tipo, hoy, null)).toEqual(esperado)
      expect(mejora(tipo, hoy, sesion([]))).toEqual(esperado)
    },
  )
})

describe('peso y repeticiones', () => {
  test('mas_repeticiones_con_el_mismo_peso_mejora_el_1rm', () => {
    // 80 × 8 = 101,33 frente a 80 × 6 = 96: +5,3 de 1RM.
    const resultado = comparar(
      'peso_reps',
      [
        { peso: '80.00', repeticiones: 8 },
        { peso: '80.00', repeticiones: 8 },
      ],
      [
        { peso: '80.00', repeticiones: 6 },
        { peso: '80.00', repeticiones: 6 },
      ],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '+4 reps', clase: 'mejor' },
        { texto: '↑ 1RM 101,3 kg (+5,3)', clase: 'mejor' },
      ],
    })
  })

  test('una_repeticion_de_diferencia_va_en_singular', () => {
    const resultado = comparar(
      'peso_reps',
      [{ peso: '80.00', repeticiones: 9 }],
      [{ peso: '80.00', repeticiones: 8 }],
    )
    expect(resultado?.insignias[0]).toEqual({ texto: '+1 rep', clase: 'mejor' })
  })

  test('subir_peso_y_bajar_reps_se_compensa_con_el_1rm', () => {
    // 60 × 10 = 80 frente a 70 × 7 = 86,33: sube el peso, bajan las reps y el 1RM sube.
    const resultado = comparar(
      'peso_reps',
      [{ peso: '70.00', repeticiones: 7 }],
      [{ peso: '60.00', repeticiones: 10 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '+10 kg', clase: 'mejor' },
        { texto: '−3 reps', clase: 'peor' },
        { texto: '↑ 1RM 86,3 kg (+6,3)', clase: 'mejor' },
      ],
    })
  })

  test('subir_peso_puede_empeorar_si_el_1rm_baja', () => {
    // 60 × 12 = 84 frente a 62,5 × 6 = 75: aunque el peso sube, el ejercicio empeora.
    const resultado = comparar(
      'peso_reps',
      [{ peso: '62.50', repeticiones: 6 }],
      [{ peso: '60.00', repeticiones: 12 }],
    )
    expect(resultado).toEqual({
      clase: 'peor',
      insignias: [
        { texto: '+2,5 kg', clase: 'mejor' },
        { texto: '−6 reps', clase: 'peor' },
        { texto: '↓ 1RM 75 kg (−9)', clase: 'peor' },
      ],
    })
  })

  test('bajar_peso_sale_en_gris_con_su_signo', () => {
    const resultado = comparar(
      'peso_reps',
      [{ peso: '70.00', repeticiones: 8 }],
      [{ peso: '80.00', repeticiones: 8 }],
    )
    expect(resultado?.clase).toBe('peor')
    expect(resultado?.insignias[0]).toEqual({ texto: '−10 kg', clase: 'peor' })
    // 70 × (1 + 8/30) = 88,67 frente a 80 × (1 + 8/30) = 101,33.
    expect(resultado?.insignias[1]).toEqual({ texto: '↓ 1RM 88,7 kg (−12,7)', clase: 'peor' })
  })

  test('lo_mismo_sale_igual', () => {
    const resultado = comparar(
      'peso_reps',
      [{ peso: '80.00', repeticiones: 8 }],
      [{ peso: '80.00', repeticiones: 8 }],
    )
    expect(resultado).toEqual({
      clase: 'igual',
      insignias: [
        { texto: 'igual', clase: 'igual' },
        { texto: '1RM 101,3 kg (igual)', clase: 'igual' },
      ],
    })
  })

  test('el_1rm_decide_con_la_media_o_con_la_mejor_serie_segun_los_ajustes', () => {
    // Misma mejor serie (100 × 3) y la segunda sube: la media mejora, la mejor serie no.
    const hoy = [
      { peso: '100.00', repeticiones: 3 },
      { peso: '60.00', repeticiones: 10 },
    ]
    const antes = [
      { peso: '100.00', repeticiones: 3 },
      { peso: '60.00', repeticiones: 5 },
    ]
    expect(comparar('peso_reps', hoy, antes)?.clase).toBe('mejor')

    cambiarAjustes({ unoRM: 'mejor' })
    const resultado = comparar('peso_reps', hoy, antes)
    expect(resultado?.clase).toBe('igual')
    expect(resultado?.insignias).toEqual([
      { texto: '+5 reps', clase: 'mejor' },
      { texto: '1RM 110 kg (igual)', clase: 'igual' },
    ])
  })

  test('en_libras_el_peso_y_el_1rm_salen_en_libras', () => {
    cambiarAjustes({ unidad: 'lb' })
    // 100 kg frente a 90 kg, a 5 reps: +10 kg = 22 lb; 1RM 116,67 kg = 257,2 lb (+25,7).
    const resultado = comparar(
      'peso_reps',
      [{ peso: '100.00', repeticiones: 5 }],
      [{ peso: '90.00', repeticiones: 5 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '+22 lb', clase: 'mejor' },
        { texto: '↑ 1RM 257,2 lb (+25,7)', clase: 'mejor' },
      ],
    })
  })

  test('una_diferencia_de_1rm_que_no_se_ve_con_un_decimal_cuenta_como_igual', () => {
    // 80 × 8 = 101,3333 frente a 80,01 × 8 = 101,3459: la diferencia (0,01) se redondea a 0.
    const resultado = comparar(
      'peso_reps',
      [{ peso: '80.01', repeticiones: 8 }],
      [{ peso: '80.00', repeticiones: 8 }],
    )
    expect(resultado?.clase).toBe('igual')
    // El peso sí sube (verde siempre que algo sube), pero el veredicto es el 1RM.
    expect(resultado?.insignias).toEqual([
      { texto: '+0,01 kg', clase: 'mejor' },
      { texto: '1RM 101,3 kg (igual)', clase: 'igual' },
    ])
  })

  test('las_series_sin_peso_no_rompen_la_comparacion', () => {
    // Una serie sin peso (por ejemplo, sin apuntar) no cuenta para el peso más alto.
    const resultado = comparar(
      'peso_reps',
      [
        { peso: '80.00', repeticiones: 8 },
        { peso: null, repeticiones: 8 },
      ],
      [{ peso: '80.00', repeticiones: 8 }],
    )
    // Ni «Infinity» ni «NaN»: el peso y el 1RM salen solo de la serie con peso.
    expect(resultado?.insignias).toEqual([
      { texto: '+8 reps', clase: 'mejor' },
      { texto: '1RM 101,3 kg (igual)', clase: 'igual' },
    ])
  })
})

describe('peso corporal', () => {
  test('la_carga_con_lastre_manda_sobre_las_repeticiones', () => {
    const resultado = comparar(
      'corporal',
      [{ peso: '10.00', repeticiones: 5 }],
      [{ peso: '5.00', repeticiones: 15 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '+5 kg', clase: 'mejor' },
        { texto: '−10 reps', clase: 'peor' },
      ],
    })
  })

  test('menos_lastre_empeora_aunque_se_hagan_mas_repeticiones', () => {
    const resultado = comparar(
      'corporal',
      [{ peso: '5.00', repeticiones: 15 }],
      [{ peso: '10.00', repeticiones: 5 }],
    )
    expect(resultado?.clase).toBe('peor')
    expect(resultado?.insignias[0]).toEqual({ texto: '−5 kg', clase: 'peor' })
  })

  test('con_ayuda_negativa_menos_ayuda_es_mejorar', () => {
    // De −30 kg de ayuda a −20: la carga sube 10 kg.
    const resultado = comparar(
      'corporal',
      [{ peso: '-20.00', repeticiones: 8 }],
      [{ peso: '-30.00', repeticiones: 8 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [{ texto: '+10 kg', clase: 'mejor' }],
    })
  })

  test('pasar_de_ayuda_a_sin_ayuda_es_mejorar', () => {
    // Sin carga (nulo) cuenta como 0, por encima de cualquier ayuda.
    const resultado = comparar(
      'corporal',
      [{ peso: null, repeticiones: 8 }],
      [{ peso: '-10.00', repeticiones: 8 }],
    )
    expect(resultado?.clase).toBe('mejor')
    expect(resultado?.insignias[0]).toEqual({ texto: '+10 kg', clase: 'mejor' })
  })

  test('con_la_misma_carga_decide_la_media_de_repeticiones', () => {
    const resultado = comparar(
      'corporal',
      [{ repeticiones: 10 }, { repeticiones: 10 }, { repeticiones: 10 }],
      [{ repeticiones: 8 }, { repeticiones: 8 }, { repeticiones: 8 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [{ texto: '+6 reps', clase: 'mejor' }],
    })
  })

  test('hacer_una_serie_mas_con_las_mismas_repeticiones_por_serie_suma_reps_pero_no_mejora', () => {
    // La media por serie decide la clase: 3 × 10 frente a 2 × 10 es igual de bueno.
    const resultado = comparar(
      'corporal',
      [{ repeticiones: 10 }, { repeticiones: 10 }, { repeticiones: 10 }],
      [{ repeticiones: 10 }, { repeticiones: 10 }],
    )
    expect(resultado?.clase).toBe('igual')
    expect(resultado?.insignias).toEqual([{ texto: '+10 reps', clase: 'mejor' }])
  })

  test('con_la_misma_carga_y_menos_reps_empeora', () => {
    const resultado = comparar('corporal', [{ repeticiones: 9 }], [{ repeticiones: 10 }])
    expect(resultado).toEqual({
      clase: 'peor',
      insignias: [{ texto: '−1 rep', clase: 'peor' }],
    })
  })

  test('lo_mismo_sale_igual', () => {
    const resultado = comparar('corporal', [{ repeticiones: 10 }], [{ repeticiones: 10 }])
    expect(resultado).toEqual({
      clase: 'igual',
      insignias: [{ texto: 'igual', clase: 'igual' }],
    })
  })

  test('en_libras_la_carga_sale_en_libras', () => {
    cambiarAjustes({ unidad: 'lb' })
    const resultado = comparar(
      'corporal',
      [{ peso: '10.00', repeticiones: 8 }],
      [{ peso: '5.00', repeticiones: 8 }],
    )
    // 5 kg = 11,0231 lb → «11» con un decimal como mucho.
    expect(resultado?.insignias).toEqual([{ texto: '+11 lb', clase: 'mejor' }])
  })
})

describe('tiempo', () => {
  test('sin_peso_decide_la_duracion_media', () => {
    const resultado = comparar(
      'tiempo',
      [{ duracion_s: 60 }, { duracion_s: 60 }],
      [{ duracion_s: 50 }, { duracion_s: 50 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [{ texto: '+10 s', clase: 'mejor' }],
    })
  })

  test('menos_duracion_empeora', () => {
    const resultado = comparar('tiempo', [{ duracion_s: 50 }], [{ duracion_s: 60 }])
    expect(resultado).toEqual({
      clase: 'peor',
      insignias: [{ texto: '−10 s', clase: 'peor' }],
    })
  })

  test('la_duracion_de_la_diferencia_se_escribe_con_minutos', () => {
    const resultado = comparar('tiempo', [{ duracion_s: 150 }], [{ duracion_s: 60 }])
    expect(resultado?.insignias).toEqual([{ texto: '+1 min 30 s', clase: 'mejor' }])
  })

  test('el_peso_manda_sobre_la_duracion', () => {
    const resultado = comparar(
      'tiempo',
      [{ peso: '10.00', duracion_s: 30 }],
      [{ peso: '5.00', duracion_s: 60 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '+5 kg', clase: 'mejor' },
        { texto: '−30 s', clase: 'peor' },
      ],
    })
  })

  test('con_el_mismo_peso_decide_la_duracion_media', () => {
    const resultado = comparar(
      'tiempo',
      [{ peso: '10.00', duracion_s: 45 }],
      [{ peso: '10.00', duracion_s: 30 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [{ texto: '+15 s', clase: 'mejor' }],
    })
  })

  test('menos_peso_empeora_aunque_dure_mas', () => {
    const resultado = comparar(
      'tiempo',
      [{ peso: '5.00', duracion_s: 90 }],
      [{ peso: '10.00', duracion_s: 30 }],
    )
    expect(resultado?.clase).toBe('peor')
  })

  test('la_misma_duracion_sale_igual', () => {
    const resultado = comparar('tiempo', [{ duracion_s: 60 }], [{ duracion_s: 60 }])
    expect(resultado).toEqual({
      clase: 'igual',
      insignias: [{ texto: 'igual', clase: 'igual' }],
    })
  })

  test('en_libras_el_peso_sale_en_libras', () => {
    cambiarAjustes({ unidad: 'lb' })
    const resultado = comparar(
      'tiempo',
      [{ peso: '10.00', duracion_s: 30 }],
      [{ peso: '5.00', duracion_s: 30 }],
    )
    expect(resultado?.insignias).toEqual([{ texto: '+11 lb', clase: 'mejor' }])
  })
})

describe('cardio', () => {
  test('las_tres_insignias_con_su_texto', () => {
    // 5,2 km en 28 min 15 s frente a 4,8 km en 26 min 40 s: ritmo 5:26 frente a 5:33.
    const resultado = comparar(
      'cardio',
      [{ distancia_m: 5200, duracion_s: 1695 }],
      [{ distancia_m: 4800, duracion_s: 1600 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '5,2 km (+0,4)', clase: 'mejor' },
        { texto: '28 min 15 s (+1 min 35 s)', clase: 'mejor' },
        { texto: '↑ Ritmo 5:26 min/km (−0:07)', clase: 'mejor' },
      ],
    })
  })

  test('menos_distancia_empeora_aunque_el_ritmo_sea_mejor', () => {
    // 4 km en 20 min (5:00) frente a 5 km en 30 min (6:00): menos lejos, más rápido.
    const resultado = comparar(
      'cardio',
      [{ distancia_m: 4000, duracion_s: 1200 }],
      [{ distancia_m: 5000, duracion_s: 1800 }],
    )
    expect(resultado).toEqual({
      clase: 'peor',
      insignias: [
        { texto: '4 km (−1)', clase: 'igual' },
        { texto: '20 min (−10 min)', clase: 'igual' },
        { texto: '↑ Ritmo 5:00 min/km (−1:00)', clase: 'mejor' },
      ],
    })
  })

  test('con_la_misma_distancia_decide_el_ritmo', () => {
    const resultado = comparar(
      'cardio',
      [{ distancia_m: 5000, duracion_s: 1600 }],
      [{ distancia_m: 5000, duracion_s: 1700 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '5 km (igual)', clase: 'igual' },
        { texto: '26 min 40 s (−1 min 40 s)', clase: 'igual' },
        { texto: '↑ Ritmo 5:20 min/km (−0:20)', clase: 'mejor' },
      ],
    })
  })

  test('con_la_misma_distancia_y_ritmo_mas_lento_empeora', () => {
    const resultado = comparar(
      'cardio',
      [{ distancia_m: 5000, duracion_s: 1700 }],
      [{ distancia_m: 5000, duracion_s: 1600 }],
    )
    expect(resultado?.clase).toBe('peor')
    expect(resultado?.insignias.at(-1)).toEqual({
      texto: '↓ Ritmo 5:40 min/km (+0:20)',
      clase: 'peor',
    })
  })

  test('lo_mismo_sale_igual', () => {
    const resultado = comparar(
      'cardio',
      [{ distancia_m: 5000, duracion_s: 1600 }],
      [{ distancia_m: 5000, duracion_s: 1600 }],
    )
    expect(resultado).toEqual({
      clase: 'igual',
      insignias: [
        { texto: '5 km (igual)', clase: 'igual' },
        { texto: '26 min 40 s (igual)', clase: 'igual' },
        { texto: 'Ritmo 5:20 min/km (igual)', clase: 'igual' },
      ],
    })
  })

  test('sin_distancia_en_ninguna_decide_el_tiempo_y_no_hay_insignias_de_distancia_ni_ritmo', () => {
    const resultado = comparar('cardio', [{ duracion_s: 1800 }], [{ duracion_s: 1500 }])
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [{ texto: '30 min (+5 min)', clase: 'mejor' }],
    })
    expect(comparar('cardio', [{ duracion_s: 1200 }], [{ duracion_s: 1500 }])?.clase).toBe('peor')
    expect(comparar('cardio', [{ duracion_s: 1500 }], [{ duracion_s: 1500 }])?.clase).toBe('igual')
  })

  test('sin_distancia_en_una_de_las_dos_decide_el_tiempo', () => {
    // Hoy con distancia (menos tiempo) y antes sin ella: no son comparables, manda el tiempo.
    const hoy = comparar(
      'cardio',
      [{ distancia_m: 5000, duracion_s: 1200 }],
      [{ duracion_s: 1500 }],
    )
    expect(hoy?.clase).toBe('peor')
    expect(hoy?.insignias.map((i) => i.texto)).toEqual(['5 km (+5)', '20 min (−5 min)'])

    // Y al revés: antes con distancia y hoy sin ella, con más tiempo.
    const antes = comparar(
      'cardio',
      [{ duracion_s: 1800 }],
      [{ distancia_m: 5000, duracion_s: 1500 }],
    )
    expect(antes?.clase).toBe('mejor')
    expect(antes?.insignias.map((i) => i.texto)).toEqual(['0 km (−5)', '30 min (+5 min)'])
  })

  test('en_millas_la_distancia_y_el_ritmo_salen_en_millas', () => {
    cambiarAjustes({ distancia: 'mi' })
    // 8047 m ≈ 5 mi en 40 min frente a 6437 m ≈ 4 mi en 34 min.
    const resultado = comparar(
      'cardio',
      [{ distancia_m: 8047, duracion_s: 2400 }],
      [{ distancia_m: 6437, duracion_s: 2040 }],
    )
    expect(resultado).toEqual({
      clase: 'mejor',
      insignias: [
        { texto: '5 mi (+1)', clase: 'mejor' },
        { texto: '40 min (+6 min)', clase: 'mejor' },
        { texto: '↑ Ritmo 8:00 min/mi (−0:30)', clase: 'mejor' },
      ],
    })
  })

  test('varias_series_suman_distancia_y_tiempo', () => {
    const resultado = comparar(
      'cardio',
      [
        { distancia_m: 2000, duracion_s: 600 },
        { distancia_m: 3000, duracion_s: 900 },
      ],
      [{ distancia_m: 5000, duracion_s: 1500 }],
    )
    expect(resultado?.clase).toBe('igual')
    expect(resultado?.insignias.map((i) => i.texto)).toEqual([
      '5 km (igual)',
      '25 min (igual)',
      'Ritmo 5:00 min/km (igual)',
    ])
  })
})

describe('volumenDe', () => {
  test('solo_cuentan_las_series_de_peso_y_repeticiones', () => {
    const series = [
      serie({ peso: '80.00', repeticiones: 8 }, 'peso_reps'),
      serie({ peso: '10.00', repeticiones: 10 }, 'corporal'),
      serie({ peso: '20.00', duracion_s: 30 }, 'tiempo'),
      serie({ distancia_m: 5000, duracion_s: 1500 }, 'cardio'),
    ]
    expect(volumenDe(series)).toBe(640)
  })

  test('el_peso_en_texto_se_multiplica_como_numero', () => {
    const series = [
      serie({ peso: '17.50', repeticiones: 10 }),
      serie({ peso: '80.00', repeticiones: 3 }),
    ]
    expect(volumenDe(series)).toBe(415)
  })

  test('las_series_sin_peso_o_sin_repeticiones_no_suman_ni_dan_nan', () => {
    const series = [
      serie({ peso: null, repeticiones: 10 }),
      serie({ peso: '50.00', repeticiones: null }),
      serie({ peso: '50.00', repeticiones: 2 }),
    ]
    expect(volumenDe(series)).toBe(100)
  })

  test('sin_series_el_volumen_es_cero', () => {
    expect(volumenDe([])).toBe(0)
  })
})
