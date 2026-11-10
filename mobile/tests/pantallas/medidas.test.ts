/**
 * Las medidas de una serie de `src/utiles/medidas.ts` (copia de la web, que no tenía tests):
 * cómo se escribe cada tipo de ejercicio en una ficha (`serieCorta`) y en una línea
 * (`serieLarga`), y `kilos`/`kilosCorporales`, que es de donde el formulario de una serie
 * toma su semilla (el peso llega como texto «80.00» y nunca puede convertirse en 0 si es nulo).
 */
import { cambiarAjustes } from '../../src/utiles/ajustes'
import {
  conPesoYReps,
  kilos,
  kilosCorporales,
  pesoCorporalLegible,
  ritmoDeLaSerie,
  serieCorta,
  serieLarga,
  type Medidas,
} from '../../src/utiles/medidas'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

beforeEach(() => {
  cambiarAjustes({ unidad: 'kg', distancia: 'km' })
})

function serie(medidas: Partial<Medidas>): Medidas {
  return { peso: null, repeticiones: null, duracion_s: null, ...medidas }
}

describe('kilos y kilosCorporales', () => {
  test('kilos_lee_el_peso_en_texto_y_en_numero', () => {
    expect(kilos({ peso: '80.00' })).toBe(80)
    expect(kilos({ peso: 80 })).toBe(80)
    expect(kilos({ peso: '17.50' })).toBe(17.5)
    expect(kilos({ peso: '-20.00' })).toBe(-20)
  })

  test('kilos_de_un_cero_es_cero_y_de_nulo_es_nulo', () => {
    // `Number(null)` es 0: sin esta distinción, una serie sin peso se leería como de 0 kg.
    expect(kilos({ peso: '0.00' })).toBe(0)
    expect(kilos({ peso: 0 })).toBe(0)
    expect(kilos({ peso: null })).toBeNull()
  })

  test('kilosCorporales_lee_texto_y_numero_y_es_nulo_sin_peso_corporal', () => {
    expect(kilosCorporales({ peso_corporal: '78.50' })).toBe(78.5)
    expect(kilosCorporales({ peso_corporal: 78 })).toBe(78)
    expect(kilosCorporales({ peso_corporal: '0.00' })).toBe(0)
    expect(kilosCorporales({ peso_corporal: null })).toBeNull()
    expect(kilosCorporales({})).toBeNull()
  })
})

describe('conPesoYReps', () => {
  test('deja_solo_las_series_con_peso_y_repeticiones', () => {
    const series = [
      serie({ peso: '40.00', repeticiones: 10 }),
      serie({ peso: null, repeticiones: 10 }),
      serie({ peso: '40.00', repeticiones: null }),
      serie({ duracion_s: 45 }),
      serie({ peso: '0.00', repeticiones: 12 }), // un cero es un peso
      serie({ peso: 20, repeticiones: 0 }), // y cero repeticiones, una cifra
    ]
    expect(conPesoYReps(series)).toEqual([series[0], series[4], series[5]])
  })

  test('sin_series_da_una_lista_vacia', () => {
    expect(conPesoYReps([])).toEqual([])
  })
})

describe('serieLarga', () => {
  test.each([
    [serie({ peso: '40.00', repeticiones: 12 }), '40 kg × 12 reps'],
    [serie({ peso: '17.50', repeticiones: 8 }), '17,5 kg × 8 reps'],
    [serie({ peso: '0.00', repeticiones: 5 }), '0 kg × 5 reps'],
    [serie({ peso: 80, repeticiones: 1 }), '80 kg × 1 reps'],
  ])('peso_reps_%#', (s, texto) => {
    expect(serieLarga('peso_reps', s)).toBe(texto)
  })

  test.each([
    [serie({ repeticiones: 8 }), '8 reps'],
    [serie({ repeticiones: 8, peso: '0.00' }), '8 reps'], // 0 es «sin carga»
    [serie({ repeticiones: 8, peso: '10.00' }), '10 kg de lastre × 8 reps'],
    [serie({ repeticiones: 8, peso: '-20.00' }), '20 kg de ayuda × 8 reps'],
    [serie({ repeticiones: 8, peso: '2.50' }), '2,5 kg de lastre × 8 reps'],
  ])('corporal_%#', (s, texto) => {
    expect(serieLarga('corporal', s)).toBe(texto)
  })

  test.each([
    [serie({ duracion_s: 45 }), '45 s'],
    [serie({ duracion_s: 90 }), '1 min 30 s'],
    [serie({ duracion_s: 40, peso: '5.00' }), '40 s con 5 kg'],
    [serie({ duracion_s: 40, peso: '0.00' }), '40 s'],
    [serie({ duracion_s: null }), '0 s'],
  ])('tiempo_%#', (s, texto) => {
    expect(serieLarga('tiempo', s)).toBe(texto)
  })

  test.each([
    [serie({ duracion_s: 1695, distancia_m: 5200 }), '28 min 15 s · 5,2 km'],
    [serie({ duracion_s: 1695 }), '28 min 15 s'],
    [serie({ duracion_s: 1695, distancia_m: null }), '28 min 15 s'],
    [serie({ duracion_s: 1695, distancia_m: 0 }), '28 min 15 s'],
    [serie({ duracion_s: 3900, distancia_m: 10000 }), '1 h 5 min · 10 km'],
  ])('cardio_%#', (s, texto) => {
    expect(serieLarga('cardio', s)).toBe(texto)
  })

  test('en_libras_y_millas_convierte_cada_medida', () => {
    cambiarAjustes({ unidad: 'lb', distancia: 'mi' })
    expect(serieLarga('peso_reps', serie({ peso: '40.00', repeticiones: 12 }))).toBe(
      '88,2 lb × 12 reps',
    )
    expect(serieLarga('corporal', serie({ repeticiones: 8, peso: '-20.00' }))).toBe(
      '44,1 lb de ayuda × 8 reps',
    )
    expect(serieLarga('corporal', serie({ repeticiones: 8, peso: '10.00' }))).toBe(
      '22 lb de lastre × 8 reps',
    )
    expect(serieLarga('tiempo', serie({ duracion_s: 40, peso: '5.00' }))).toBe('40 s con 11 lb')
    expect(serieLarga('cardio', serie({ duracion_s: 1695, distancia_m: 5200 }))).toBe(
      '28 min 15 s · 3,23 mi',
    )
  })
})

describe('serieCorta', () => {
  test.each([
    [serie({ peso: '40.00', repeticiones: 12 }), '40 × 12'],
    [serie({ peso: '17.50', repeticiones: 8 }), '17,5 × 8'],
    [serie({ peso: '0.00', repeticiones: 5 }), '0 × 5'],
    [serie({ peso: null, repeticiones: 5 }), '0 × 5'],
  ])('peso_reps_%#', (s, texto) => {
    expect(serieCorta('peso_reps', s)).toBe(texto)
  })

  test.each([
    [serie({ repeticiones: 12 }), '12'],
    [serie({ repeticiones: 12, peso: '0.00' }), '12'],
    [serie({ repeticiones: 8, peso: '10.00' }), '10 × 8'],
    [serie({ repeticiones: 8, peso: '-20.00' }), '−20 × 8'], // con el signo menos de verdad
    [serie({ repeticiones: 8, peso: '2.50' }), '2,5 × 8'],
  ])('corporal_%#', (s, texto) => {
    expect(serieCorta('corporal', s)).toBe(texto)
  })

  test.each([
    [serie({ duracion_s: 45 }), '45 s'],
    [serie({ duracion_s: 38, peso: '5.00' }), '38 s con 5 kg'],
    [serie({ duracion_s: 38, peso: '0.00' }), '38 s'],
  ])('tiempo_%#', (s, texto) => {
    expect(serieCorta('tiempo', s)).toBe(texto)
  })

  test.each([
    [serie({ duracion_s: 1695, distancia_m: 5200 }), '28 min 15 s · 5,2 km'],
    [serie({ duracion_s: 600 }), '10 min'],
  ])('cardio_%#', (s, texto) => {
    expect(serieCorta('cardio', s)).toBe(texto)
  })

  test('en_libras_convierte_el_peso_el_lastre_va_sin_signo_y_la_ayuda_con_signo_menos', () => {
    cambiarAjustes({ unidad: 'lb' })
    expect(serieCorta('peso_reps', serie({ peso: '40.00', repeticiones: 12 }))).toBe('88,2 × 12')
    expect(serieCorta('corporal', serie({ repeticiones: 8, peso: '-20.00' }))).toBe('−44,1 × 8')
    expect(serieCorta('corporal', serie({ repeticiones: 8, peso: '10.00' }))).toBe('22 × 8')
    expect(serieCorta('tiempo', serie({ duracion_s: 38, peso: '5.00' }))).toBe('38 s con 11 lb')
  })
})

describe('ritmo y peso corporal de una serie', () => {
  test('ritmoDeLaSerie_de_cardio_con_distancia', () => {
    expect(ritmoDeLaSerie(serie({ duracion_s: 1695, distancia_m: 5200 }))).toBe('Ritmo 5:26 min/km')
  })

  test('ritmoDeLaSerie_en_millas', () => {
    cambiarAjustes({ distancia: 'mi' })
    expect(ritmoDeLaSerie(serie({ duracion_s: 1800, distancia_m: 3219 }))).toBe(
      'Ritmo 15:00 min/mi',
    )
  })

  test.each([
    [serie({ duracion_s: 1695 })],
    [serie({ duracion_s: 1695, distancia_m: null })],
    [serie({ duracion_s: 1695, distancia_m: 0 })],
    [serie({ distancia_m: 5000 })],
    [serie({ duracion_s: 0, distancia_m: 5000 })],
  ])('ritmoDeLaSerie_sin_tiempo_o_sin_distancia_es_nulo_%#', (s) => {
    expect(ritmoDeLaSerie(s)).toBeNull()
  })

  test('pesoCorporalLegible_dice_el_peso_o_es_nulo', () => {
    expect(pesoCorporalLegible({ peso_corporal: '78.00' })).toBe('Peso corporal 78 kg')
    expect(pesoCorporalLegible({ peso_corporal: '78.50' })).toBe('Peso corporal 78,5 kg')
    expect(pesoCorporalLegible({ peso_corporal: null })).toBeNull()
    cambiarAjustes({ unidad: 'lb' })
    expect(pesoCorporalLegible({ peso_corporal: '80.00' })).toBe('Peso corporal 176,4 lb')
  })
})
