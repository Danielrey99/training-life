/**
 * Lo que vale en cada campo de Ajustes (`src/reglasDePantalla/ajustes.ts`, copia de las
 * comprobaciones de `web/src/paginas/ajustes/Preferencias.tsx`): el paso del peso, el paso del
 * tiempo y el objetivo con el que empieza un ejercicio nuevo.
 */
import {
  entero,
  falloDelObjetivo,
  MAXIMO_REPS,
  MAXIMO_SEGUNDOS,
  MAXIMO_SERIES,
  pasoDelPesoValido,
  pasoDelTiempoValido,
} from '../../src/reglasDePantalla/ajustes'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

describe('entero', () => {
  test.each([
    [null, false],
    [0, false],
    [1, true],
    [10, true],
    [11, false],
    [2.5, false],
    [-1, false],
  ])('entero(%p, 10) es %p', (valor, esperado) => {
    expect(entero(valor, 10)).toBe(esperado)
  })
})

describe('pasoDelPesoValido', () => {
  test.each([
    [null, false],
    [0, false],
    [-1, false],
    [0.5, true],
    [2.5, true],
    [100, true],
    [100.01, false],
  ])('pasoDelPesoValido(%p) es %p', (valor, esperado) => {
    expect(pasoDelPesoValido(valor)).toBe(esperado)
  })
})

describe('pasoDelTiempoValido', () => {
  test.each([
    [null, false],
    [0, false],
    [1, true],
    [59, true],
    [60, false],
    [1.5, false],
  ])('pasoDelTiempoValido(%p) es %p', (valor, esperado) => {
    expect(pasoDelTiempoValido(valor)).toBe(esperado)
  })
})

describe('falloDelObjetivo', () => {
  const bien = { series: '3', min: '8', max: '12' }
  const FALLO_SERIES = `Las series, un número entero del 1 al ${MAXIMO_SERIES}.`
  const FALLO_REPS = 'Las reps, números enteros mayores que 0.'
  const FALLO_DURACION = 'La duración, de 1 segundo a 24 horas.'

  test('un_objetivo_valido_no_tiene_fallo', () => {
    expect(falloDelObjetivo(bien, false)).toBeNull()
    expect(falloDelObjetivo({ series: '3', min: '30', max: '60' }, true)).toBeNull()
  })

  test.each(['', '0', '-1', '2,5', '51', 'abc'])('las_series_%p_no_valen', (series) => {
    expect(falloDelObjetivo({ ...bien, series }, false)).toBe(FALLO_SERIES)
    expect(falloDelObjetivo({ ...bien, series }, true)).toBe(FALLO_SERIES)
  })

  test('las_series_se_comprueban_antes_que_las_reps', () => {
    expect(falloDelObjetivo({ series: '0', min: '0', max: '0' }, false)).toBe(FALLO_SERIES)
  })

  test('50_series_valen', () => {
    expect(falloDelObjetivo({ ...bien, series: '50' }, false)).toBeNull()
  })

  test.each([
    ['', '12'],
    ['8', ''],
    ['0', '12'],
    ['8', '0'],
    ['-8', '12'],
    ['8,5', '12'],
    ['8', '12,5'],
    ['1001', '1001'],
  ])('las_reps_%p_a_%p_no_valen', (min, max) => {
    expect(falloDelObjetivo({ series: '3', min, max }, false)).toBe(FALLO_REPS)
  })

  test.each([
    ['', '60'],
    ['0', '60'],
    ['30', '90,5'],
    ['30', '86401'],
  ])('la_duracion_%p_a_%p_no_vale', (min, max) => {
    expect(falloDelObjetivo({ series: '3', min, max }, true)).toBe(FALLO_DURACION)
  })

  test('el_texto_del_fallo_depende_de_si_es_por_duracion', () => {
    const textos = { series: '3', min: '0', max: '5' }
    expect(falloDelObjetivo(textos, false)).toBe(FALLO_REPS)
    expect(falloDelObjetivo(textos, true)).toBe(FALLO_DURACION)
  })

  test('el_limite_de_reps_es_1000', () => {
    expect(falloDelObjetivo({ series: '3', min: '1', max: String(MAXIMO_REPS) }, false)).toBeNull()
    expect(falloDelObjetivo({ series: '3', min: '1', max: '1001' }, false)).toBe(FALLO_REPS)
  })

  test('el_limite_de_la_duracion_es_86400_segundos', () => {
    expect(
      falloDelObjetivo({ series: '3', min: '1', max: String(MAXIMO_SEGUNDOS) }, true),
    ).toBeNull()
    // 86400 segundos no valen como repeticiones.
    expect(falloDelObjetivo({ series: '3', min: '1', max: '86400' }, false)).toBe(FALLO_REPS)
  })

  test('el_maximo_menor_que_el_minimo_no_vale', () => {
    expect(falloDelObjetivo({ series: '3', min: '12', max: '8' }, false)).toBe(
      'Las reps máximas no pueden ser menos que las mínimas.',
    )
    expect(falloDelObjetivo({ series: '3', min: '90', max: '60' }, true)).toBe(
      'La duración máxima no puede ser menos que la mínima.',
    )
  })

  test('minimo_igual_al_maximo_vale', () => {
    expect(falloDelObjetivo({ series: '3', min: '10', max: '10' }, false)).toBeNull()
    expect(falloDelObjetivo({ series: '3', min: '60', max: '60' }, true)).toBeNull()
  })
})
