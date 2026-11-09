/**
 * Los pesos exactos (`reglas/centesimas.ts`). Propios del móvil: el backend los tiene en
 * `Decimal` y PostgreSQL los redondea al guardarlos en NUMERIC(n, 2) alejándose del cero en
 * la mitad. Aquí se comprueba que nunca se pasa por una multiplicación de coma flotante
 * (22,505 × 100 = 2250,4999… redondearía a 2250).
 */
import { aCentesimas, aTexto, comparar } from '../../../src/logica/reglas/centesimas'

test.each<[number | string, number]>([
  ['80.00', 8000],
  [80.5, 8050],
  [22.505, 2251],
  [-22.505, -2251],
  ['22.505', 2251],
  [9999.994, 999999],
  [9999.995, 1000000],
  [0.005, 1],
  [0.004, 0],
  ['1e2', 10000],
  ['.5', 50],
  ['5.', 500],
  [' 80 ', 8000],
  [1e-7, 0],
])('a_centesimas_redondea_como_postgres (%j)', (valor, centesimas) => {
  expect(aCentesimas(valor)).toBe(centesimas)
})

test('el_cero_negativo_es_cero', () => {
  // `toBe` usa Object.is: un -0 no pasaría.
  expect(aCentesimas(-0)).toBe(0)
  expect(aCentesimas('-0.001')).toBe(0)
})

test.each<[number | string]>([['abc'], [Number.NaN], [Number.POSITIVE_INFINITY], [''], ['1,5']])(
  'lo_que_no_es_un_numero_da_null (%j)',
  (valor) => {
    expect(aCentesimas(valor)).toBeNull()
  },
)

test('a_texto_lleva_siempre_dos_decimales', () => {
  expect(aTexto(8000)).toBe('80.00')
  expect(aTexto(5)).toBe('0.05')
  expect(aTexto(-5)).toBe('-0.05')
  expect(aTexto(0)).toBe('0.00')
  expect(aTexto(-2251)).toBe('-22.51')
})

test('comparar_es_exacto_entre_texto_y_numero', () => {
  expect(comparar('0.1', 0.1)).toBe(0)
  expect(comparar('9999.99', 9999.99)).toBe(0)
  expect(comparar(-0.001, 0)).toBe(-1)
  expect(comparar('500.001', 500)).toBe(1)
  expect(comparar('62.5', '62.50')).toBe(0)
})
