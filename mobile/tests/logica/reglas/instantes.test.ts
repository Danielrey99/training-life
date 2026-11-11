/**
 * Comparar instantes con zona (`reglas/instantes.ts`). Propios del móvil: en el backend lo
 * hace PostgreSQL con `timestamptz`, que ordena por el instante real y guarda microsegundos;
 * aquí los instantes son texto en SQLite y hay que compararlos a mano.
 */
import { compararInstantes, enMicrosegundos } from '../../../src/logica/reglas/instantes'

test('el_mismo_instante_en_zonas_distintas_es_igual', () => {
  expect(compararInstantes('2026-09-01T10:00:00+02:00', '2026-09-01T08:00:00Z')).toBe(0)
  expect(compararInstantes('2026-09-01T10:00:00+02:00', '2026-09-01T04:00:00-04:00')).toBe(0)
})

test('las_10_con_02_00_son_antes_que_las_09_zulu', () => {
  // Como texto «10:00…» va después de «09:00…», pero el primero son las 08:00 UTC.
  expect('2026-09-01T10:00:00+02:00' > '2026-09-01T09:00:00Z').toBe(true)
  expect(compararInstantes('2026-09-01T10:00:00+02:00', '2026-09-01T09:00:00Z')).toBeLessThan(0)
  expect(compararInstantes('2026-09-01T09:00:00Z', '2026-09-01T10:00:00+02:00')).toBeGreaterThan(0)
})

test('una_zona_puede_cambiar_el_dia', () => {
  // 00:30 en +02:00 es todavía el día anterior en UTC.
  expect(enMicrosegundos('2026-09-01T00:30:00+02:00')).toBe(enMicrosegundos('2026-08-31T22:30:00Z'))
  expect(compararInstantes('2026-09-01T00:30:00+02:00', '2026-09-01T00:00:00Z')).toBeLessThan(0)
})

test('los_microsegundos_desempatan', () => {
  expect(compararInstantes('2026-09-01T10:00:00.123456Z', '2026-09-01T10:00:00.123457Z')).toBe(-1)
  expect(compararInstantes('2026-09-01T10:00:00.123457Z', '2026-09-01T10:00:00.123456Z')).toBe(1)
  // Con `Date.parse` los dos serían el mismo milisegundo.
  expect(Date.parse('2026-09-01T10:00:00.123456Z')).toBe(Date.parse('2026-09-01T10:00:00.123457Z'))
  expect(compararInstantes('2026-09-01T10:00:00.123456Z', '2026-09-01T10:00:00.123456Z')).toBe(0)
})

test.each([
  ['2026-09-01T10:00:00.1Z', 100_000n],
  ['2026-09-01T10:00:00.12Z', 120_000n],
  ['2026-09-01T10:00:00.123Z', 123_000n],
  ['2026-09-01T10:00:00.123456Z', 123_456n],
  ['2026-09-01T10:00:00.000001Z', 1n],
  ['2026-09-01T10:00:00Z', 0n],
])('los_decimales_se_leen_como_fraccion_de_segundo (%s)', (instante, micros) => {
  // La fracción cuenta como decimales de segundo, no como un entero: «.1» es una décima.
  const segundos = BigInt(Date.parse('2026-09-01T10:00:00Z') / 1000)
  expect(enMicrosegundos(instante)).toBe(segundos * 1_000_000n + micros)
})

test('milisegundos_y_microsegundos_del_mismo_instante_son_iguales', () => {
  expect(compararInstantes('2026-09-01T10:00:00.123Z', '2026-09-01T10:00:00.123000Z')).toBe(0)
  expect(compararInstantes('2026-09-01T10:00:00.5Z', '2026-09-01T10:00:00.500000Z')).toBe(0)
})

test('sin_fraccion_es_igual_a_fraccion_cero', () => {
  expect(compararInstantes('2026-09-01T10:00:00Z', '2026-09-01T10:00:00.000000Z')).toBe(0)
  expect(compararInstantes('2026-09-01T10:00:00Z', '2026-09-01T10:00:00.000001Z')).toBe(-1)
})

test('sin_segundos_valen_cero_segundos', () => {
  expect(compararInstantes('2026-09-01T10:00Z', '2026-09-01T10:00:00Z')).toBe(0)
})

test('la_zona_se_escribe_con_z_o_con_desfase_con_o_sin_dos_puntos', () => {
  const referencia = enMicrosegundos('2026-09-01T10:00:00Z')

  expect(enMicrosegundos('2026-09-01T12:00:00+02:00')).toBe(referencia)
  expect(enMicrosegundos('2026-09-01T12:00:00+0200')).toBe(referencia)
  expect(enMicrosegundos('2026-09-01T10:00:00+00:00')).toBe(referencia)
  expect(enMicrosegundos('2026-09-01T10:00:00-00:00')).toBe(referencia)
  // Un desfase con minutos (India, +05:30; Terranova, -03:30).
  expect(enMicrosegundos('2026-09-01T15:30:00+05:30')).toBe(referencia)
  expect(enMicrosegundos('2026-09-01T06:30:00-03:30')).toBe(referencia)
})

test('sin_zona_se_toma_como_utc', () => {
  expect(enMicrosegundos('2026-09-01T10:00:00')).toBe(enMicrosegundos('2026-09-01T10:00:00Z'))
})

test('la_t_puede_ser_un_espacio', () => {
  expect(enMicrosegundos('2026-09-01 10:00:00+00:00')).toBe(enMicrosegundos('2026-09-01T10:00:00Z'))
})

test('el_origen_es_el_1_de_enero_de_1970_utc', () => {
  expect(enMicrosegundos('1970-01-01T00:00:00Z')).toBe(0n)
  expect(enMicrosegundos('1970-01-01T00:00:00.000001Z')).toBe(1n)
  expect(enMicrosegundos('1969-12-31T23:59:59Z')).toBe(-1_000_000n)
  expect(enMicrosegundos('1970-01-01T01:00:00+01:00')).toBe(0n)
})

test('coincide_con_date_parse_hasta_el_milisegundo', () => {
  // Días bisiestos y cambios de año incluidos.
  for (const instante of [
    '2024-02-29T23:59:59.999Z',
    '2026-12-31T23:59:59.001Z',
    '2027-01-01T00:00:00.000Z',
    '2000-03-01T12:00:00.500Z',
    '2100-03-01T00:00:00.000Z',
  ]) {
    expect(enMicrosegundos(instante)).toBe(BigInt(Date.parse(instante)) * 1000n)
  }
})

test('ordenar_una_lista_mezclada_de_zonas_da_el_orden_real', () => {
  const desordenada = [
    '2026-09-01T10:00:00+02:00', // 08:00 UTC
    '2026-09-01T09:00:00Z',
    '2026-09-01T08:00:00.000001Z',
    '2026-09-01T03:30:00-05:00', // 08:30 UTC
  ]

  expect([...desordenada].sort(compararInstantes)).toEqual([
    '2026-09-01T10:00:00+02:00',
    '2026-09-01T08:00:00.000001Z',
    '2026-09-01T03:30:00-05:00',
    '2026-09-01T09:00:00Z',
  ])
})

test.each([
  ['', 'No es un instante: '],
  ['ayer', 'No es un instante: ayer'],
  ['2026-09-01', 'No es un instante: 2026-09-01'],
  ['10:00:00', 'No es un instante: 10:00:00'],
  ['2026-09-01T25:00:00X', 'No es un instante: 2026-09-01T25:00:00X'],
  // Con la forma de un instante pero un mes 13: lo rechaza la fecha.
  ['2026-13-01T10:00:00Z', 'No es una fecha: 2026-13-01'],
])('lo_que_no_es_un_instante_lanza_error (%j)', (texto, mensaje) => {
  expect(() => enMicrosegundos(texto)).toThrow(mensaje)
})
