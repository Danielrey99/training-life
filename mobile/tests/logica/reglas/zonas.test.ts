/**
 * Las zonas horarias (`reglas/zonas.ts`). Propios del móvil. El backend acepta una zona
 * solo si está en `zoneinfo.available_timezones()` (distingue mayúsculas); lo esperado
 * sale de ahí.
 */
import { hoyEn, zonaValida } from '../../../src/logica/reglas/zonas'

test.each([
  ['Europe/Madrid', true],
  ['UTC', true],
  ['US/Eastern', true],
  ['Asia/Calcutta', true],
  ['Europe/Kiev', true],
  ['Etc/GMT+5', true],
  ['EST5EDT', true],
  ['Zulu', true],
  ['europe/madrid', false],
  ['Europe/MADRID', false],
  ['Europe', false],
  ['Marte/Base', false],
  ['utc', false],
  ['localtime', false],
  ['Etc/GMT+15', false],
  ['Europe\\Madrid', false],
  ['', false],
])('zona_valida_como_python (%j)', (zona, valida) => {
  expect(zonaValida(zona)).toBe(valida)
})

// Diferencia deliberada con el backend: un alias con otras mayúsculas (US/EASTERN), o un
// nombre que Intl entiende y Python no tiene en available_timezones() (Gmt, SystemV/AST4),
// se acepta. Sin la base de datos de zonas no se puede saber si un alias está bien escrito,
// y una zona que no se reconoce bloquearía la importación entera: mejor tolerante. El
// backend rechaza todos estos.
test.each([['US/EASTERN'], ['ASIA/KOLKATA'], ['Gmt'], ['SystemV/AST4']])(
  'zona_valida_acepta_alias_que_intl_entiende_aunque_python_no (%j)',
  (zona) => {
    expect(zonaValida(zona)).toBe(true)
  },
)

test('hoy_en_una_zona_adelantada_ya_es_manana', () => {
  // A las 11:00 UTC del 9, en Kiritimati (UTC+14) ya es el 10; a las 9:59, todavía el 9.
  expect(hoyEn('Pacific/Kiritimati', new Date('2026-11-09T11:00:00Z'))).toBe('2026-11-10')
  expect(hoyEn('Pacific/Kiritimati', new Date('2026-11-09T09:59:00Z'))).toBe('2026-11-09')
})

test('hoy_en_madrid_a_las_23_30_utc_es_el_dia_siguiente', () => {
  expect(hoyEn('Europe/Madrid', new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10')
  expect(hoyEn('Europe/Madrid', new Date('2026-11-09T22:59:00Z'))).toBe('2026-11-09')
})
