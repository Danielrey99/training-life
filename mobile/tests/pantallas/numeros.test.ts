/**
 * Pesos, duraciones, distancias, ritmo y lectura de números de `src/utiles/numeros.ts` (copia
 * de la web, que no tenía tests). La API y la base van siempre en kg, segundos y metros: aquí
 * se comprueba lo que se enseña y lo que se teclea según los ajustes del dispositivo.
 *
 * `ajustes.ts` importa `Appearance` de `react-native` (no existe en Node) y usa `localStorage`
 * (tampoco, pero va en `try/catch`): se sustituye `react-native` por un mínimo.
 */
import { cambiarAjustes } from '../../src/utiles/ajustes'
import {
  aKilos,
  aMetros,
  distanciaLegible,
  duracionLegible,
  enUnidad,
  enUnidadDeDistancia,
  leerNumero,
  numeroLegible,
  pesoLegible,
  ritmoEnTexto,
  ritmoLegible,
  unidad,
  unidadDeDistancia,
  unoRM,
} from '../../src/utiles/numeros'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

beforeEach(() => {
  cambiarAjustes({ unidad: 'kg', distancia: 'km', unoRM: 'media' })
})

describe('pesos', () => {
  test('las_unidades_salen_de_los_ajustes', () => {
    expect(unidad()).toBe('kg')
    expect(unidadDeDistancia()).toBe('km')
    cambiarAjustes({ unidad: 'lb', distancia: 'mi' })
    expect(unidad()).toBe('lb')
    expect(unidadDeDistancia()).toBe('mi')
  })

  test('enUnidad_deja_los_kilos_igual_y_pasa_a_libras_si_se_elige', () => {
    expect(enUnidad('80.00')).toBe(80)
    expect(enUnidad(17.5)).toBe(17.5)
    expect(enUnidad('-20.00')).toBe(-20)
    cambiarAjustes({ unidad: 'lb' })
    expect(enUnidad(100)).toBeCloseTo(220.462, 3)
    expect(enUnidad('0.00')).toBe(0)
    expect(enUnidad('-20.00')).toBeCloseTo(-44.0924, 4)
  })

  test('aKilos_redondea_a_dos_decimales', () => {
    expect(aKilos(82.5)).toBe(82.5)
    expect(aKilos(17.555)).toBe(17.56)
    expect(aKilos(-20)).toBe(-20)
    cambiarAjustes({ unidad: 'lb' })
    expect(aKilos(135)).toBe(61.24)
    expect(aKilos(0)).toBe(0)
    expect(aKilos(-44.1)).toBe(-20)
  })

  test('apuntar_en_libras_y_volver_a_leer_da_el_mismo_peso_legible', () => {
    // Guardado en kg con dos decimales, un peso en libras no vuelve exacto (135 lb son 61,24 kg,
    // que vuelven como 135,01): con un decimal en libras se ve lo que se apuntó.
    cambiarAjustes({ unidad: 'lb' })
    expect(pesoLegible(aKilos(135))).toBe('135')
    expect(pesoLegible(aKilos(225.5))).toBe('225,5')
  })

  test.each([
    ['17.50', '17,5'],
    ['80.00', '80'],
    [80, '80'],
    ['0.00', '0'],
    [0, '0'],
    ['-20.00', '-20'],
    ['2.25', '2,25'],
    ['1234.00', '1234'], // en español, sin punto de miles hasta las cinco cifras
    ['12345.50', '12.345,5'],
    ['0.01', '0,01'],
  ])('pesoLegible_de_%s_en_kg_es_%s', (kilos, texto) => {
    expect(pesoLegible(kilos)).toBe(texto)
  })

  test.each([
    ['100.00', '220,5'], // 220,462 con un decimal
    ['60.00', '132,3'],
    [0, '0'],
    ['-20.00', '-44,1'],
    ['0.10', '0,2'],
  ])('pesoLegible_de_%s_en_lb_es_%s', (kilos, texto) => {
    cambiarAjustes({ unidad: 'lb' })
    expect(pesoLegible(kilos)).toBe(texto)
  })

  test('numeroLegible_usa_coma_decimal_y_recorta_ceros', () => {
    expect(numeroLegible(17.5)).toBe('17,5')
    expect(numeroLegible(3)).toBe('3')
    expect(numeroLegible(3.14159)).toBe('3,14')
    expect(numeroLegible(3.14159, 3)).toBe('3,142')
    expect(numeroLegible(3.5, 0)).toBe('4')
    expect(numeroLegible(-1.5)).toBe('-1,5')
  })
})

describe('duraciones', () => {
  test.each([
    [0, '0 s'],
    [1, '1 s'],
    [45, '45 s'],
    [59, '59 s'],
    [60, '1 min'],
    [90, '1 min 30 s'],
    [1695, '28 min 15 s'],
    [3599, '59 min 59 s'],
    [3600, '1 h'],
    [3605, '1 h 5 s'],
    [3900, '1 h 5 min'],
    [3965, '1 h 6 min 5 s'],
    [7200, '2 h'],
    [90000, '25 h'],
  ])('duracionLegible_de_%i_s_es_%s', (segundos, texto) => {
    expect(duracionLegible(segundos)).toBe(texto)
  })
})

describe('distancias', () => {
  test.each([
    [0, '0 km'],
    [5000, '5 km'],
    [5200, '5,2 km'],
    [5234, '5,23 km'],
    [5236, '5,24 km'],
    [999, '1 km'], // 0,999 con dos decimales
    [42195, '42,2 km'],
  ])('distanciaLegible_de_%i_m_en_km_es_%s', (metros, texto) => {
    expect(distanciaLegible(metros)).toBe(texto)
  })

  test.each([
    [1609, '1 mi'],
    [5200, '3,23 mi'],
    [804, '0,5 mi'],
    [0, '0 mi'],
  ])('distanciaLegible_de_%i_m_en_mi_es_%s', (metros, texto) => {
    cambiarAjustes({ distancia: 'mi' })
    expect(distanciaLegible(metros)).toBe(texto)
  })

  test('enUnidadDeDistancia_pasa_de_metros_a_km_o_millas', () => {
    expect(enUnidadDeDistancia(2500)).toBe(2.5)
    cambiarAjustes({ distancia: 'mi' })
    expect(enUnidadDeDistancia(1609.344)).toBeCloseTo(1, 10)
  })

  test('aMetros_redondea_a_metros_enteros', () => {
    expect(aMetros(5.2)).toBe(5200)
    expect(aMetros(0)).toBe(0)
    expect(aMetros(5.2345)).toBe(5235)
    expect(aMetros(0.0004)).toBe(0)
    cambiarAjustes({ distancia: 'mi' })
    expect(aMetros(1)).toBe(1609)
    expect(aMetros(0.5)).toBe(805)
    expect(aMetros(26.2)).toBe(42165)
  })

  test('apuntar_una_distancia_y_volver_a_leerla_da_lo_mismo', () => {
    expect(distanciaLegible(aMetros(5.2))).toBe('5,2 km')
    cambiarAjustes({ distancia: 'mi' })
    expect(distanciaLegible(aMetros(3.1))).toBe('3,1 mi')
  })
})

describe('ritmo', () => {
  test('el_ritmo_de_28_min_15_s_en_5200_m_es_5_26_por_km', () => {
    expect(ritmoLegible(1695, 5200)).toBe('5:26 min/km')
  })

  test('el_ritmo_en_millas_usa_la_milla', () => {
    cambiarAjustes({ distancia: 'mi' })
    // 2 millas en 30 minutos: 15 minutos por milla.
    expect(ritmoLegible(1800, 3218.688)).toBe('15:00 min/mi')
  })

  test('sin_distancia_no_hay_ritmo', () => {
    expect(ritmoLegible(1695, null)).toBeNull()
    expect(ritmoLegible(1695, 0)).toBeNull()
  })

  test.each([
    [0, '0:00 min/km'],
    [59, '0:59 min/km'],
    [59.6, '1:00 min/km'], // redondea antes de partir: nunca «0:60»
    [300, '5:00 min/km'],
    [305, '5:05 min/km'],
    [359.6, '6:00 min/km'], // nunca «5:60»
    [3600, '60:00 min/km'],
  ])('ritmoEnTexto_de_%d_s_es_%s', (segundos, texto) => {
    expect(ritmoEnTexto(segundos)).toBe(texto)
  })
})

describe('1RM', () => {
  const series = [
    { peso: '100.00', repeticiones: 5, duracion_s: null },
    { peso: '80.00', repeticiones: 10, duracion_s: null },
  ]

  test('por_defecto_es_la_media_de_las_series_con_epley', () => {
    // 100 × (1 + 5/30) = 116,67 y 80 × (1 + 10/30) = 106,67.
    expect(unoRM(series)).toBeCloseTo(111.667, 3)
  })

  test('con_la_opcion_mejor_es_la_mejor_serie', () => {
    cambiarAjustes({ unoRM: 'mejor' })
    expect(unoRM(series)).toBeCloseTo(116.667, 3)
  })

  test('las_series_sin_peso_o_sin_repeticiones_no_cuentan', () => {
    const mezcla = [
      ...series,
      { peso: null, repeticiones: 12, duracion_s: null },
      { peso: '20.00', repeticiones: null, duracion_s: null },
      { peso: null, repeticiones: null, duracion_s: 45 },
    ]
    expect(unoRM(mezcla)).toBeCloseTo(111.667, 3)
  })

  test('una_serie_de_peso_cero_cuenta_como_cero', () => {
    expect(unoRM([{ peso: '0.00', repeticiones: 10, duracion_s: null }])).toBe(0)
  })
})

describe('leerNumero', () => {
  test.each([
    ['17,5', 17.5],
    ['17.5', 17.5],
    [' 80 ', 80],
    ['0', 0],
    ['0,5', 0.5],
    ['.5', 0.5],
    ['-20', -20],
    ['-2,5', -2.5],
    // Tres decimales con punto tras una o dos cifras: decimales, no miles.
    ['2.500', 2.5],
    ['0.800', 0.8],
    ['22.5', 22.5],
    // Con tres cifras tras el punto y dos o tres delante: separador de miles de `numeroLegible`.
    ['22.045', 22045],
    ['12.345,5', 12345.5],
    ['-22.045', -22045],
    ['12.345.678', 12345678],
  ])('leerNumero_de_%s_es_%d', (texto, numero) => {
    expect(leerNumero(texto)).toBe(numero)
  })

  test.each([
    [''],
    ['   '],
    ['abc'],
    ['1,5,2'],
    ['--5'],
    ['5 kg'],
    ['1 000'],
    ['Infinity'],
    ['NaN'],
  ])('leerNumero_de_%j_no_es_un_numero', (texto) => {
    expect(leerNumero(texto)).toBeNull()
  })

  test('lo_que_enseña_numeroLegible_se_vuelve_a_leer_igual', () => {
    for (const valor of [0, 17.5, 80, 2.25, 22045, 12345.5, 134.9]) {
      expect(leerNumero(numeroLegible(valor))).toBe(valor)
    }
  })
})
