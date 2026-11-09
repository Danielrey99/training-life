/**
 * Las cuentas con fechas sin `Date` (`reglas/dias.ts`). Propios del móvil: el backend usa
 * `date` de Python, y estos tests comprueban que la copia da lo mismo. Los valores
 * esperados salen de Python (`date.toordinal()` e `isoweekday()`).
 */
import {
  aOrdinal,
  desdeOrdinal,
  diaDeLaSemana,
  lunesDe,
  partes,
  sumarDias,
  sumarDiasSinSalirse,
} from '../../../src/logica/reglas/dias'

// [fecha, toordinal(), isoweekday()] calculados con Python.
const DE_PYTHON: [string, number, number][] = [
  ['0001-01-01', 1, 1],
  ['0001-01-03', 3, 3],
  ['1900-02-28', 693654, 3],
  ['1900-03-01', 693655, 4],
  ['2000-02-29', 730179, 2],
  ['2024-12-31', 739251, 2],
  ['2026-11-09', 739929, 1],
  ['9999-12-31', 3652059, 5],
  // Al azar (random.seed(7)), para no probar solo los bordes.
  ['0555-07-03', 202528, 4],
  ['0667-01-15', 243266, 2],
  ['0832-10-30', 303820, 6],
  ['1081-12-15', 394811, 4],
  ['1733-04-18', 632708, 6],
  ['3719-10-10', 1358254, 2],
  ['4200-06-07', 1533811, 6],
  ['4535-01-01', 1656010, 6],
  ['6154-11-12', 2247653, 2],
  ['6693-07-07', 2444391, 5],
  ['7476-01-31', 2730218, 1],
  ['9432-03-14', 3444675, 3],
]

test.each(DE_PYTHON)('el_ordinal_de_%s_es_el_de_python', (fecha, ordinal, diaSemana) => {
  expect(aOrdinal(fecha)).toBe(ordinal)
  expect(desdeOrdinal(ordinal)).toBe(fecha)
  expect(diaDeLaSemana(fecha)).toBe(diaSemana)
})

function bisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0
}

// Regresión: desdeOrdinal daba mal el último día de cada bloque de 400 años (el 31 de
// diciembre de 400, 800, …, 2000, 2400): salía el año 304 del bloque («2304-12-31» en vez de
// «2400-12-31»). Se arregló copiando `_ord2ymd` de CPython.
test.each([
  ['2000-12-31', 730485],
  ['2400-12-31', 876582],
])('el_ultimo_dia_de_un_bloque_de_400_anios_vuelve_de_su_ordinal (%s)', (fecha, ordinal) => {
  expect(desdeOrdinal(ordinal)).toBe(fecha)
})

test('sumar_un_dia_al_30_de_diciembre_de_2000_da_el_31', () => {
  expect(sumarDias('2000-12-30', 1)).toBe('2000-12-31')
})

test('el_ultimo_dia_de_un_bloque_de_400_anios_tiene_el_ordinal_de_python', () => {
  // aOrdinal sí está bien: el fallo es solo de vuelta.
  expect(aOrdinal('2000-12-31')).toBe(730485)
  expect(aOrdinal('2400-12-31')).toBe(876582)
  expect(diaDeLaSemana('2400-12-31')).toBe(7)
})

test('todo_el_calendario_va_de_un_dia_al_siguiente_sin_saltos', () => {
  // Recorre los 3.652.059 días contando a mano (día, mes, año) y compara con desdeOrdinal y
  // aOrdinal: cualquier error en un fin de mes, de año, de siglo o de bloque de 400 años
  // saldría aquí.
  const largo = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let [anio, mes, dia] = [1, 1, 1]
  const mal: string[] = []
  for (let n = 1; n <= 3652059; n++) {
    const esperada = `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    if (desdeOrdinal(n) !== esperada || aOrdinal(esperada) !== n) {
      mal.push(`${n} ${esperada}`)
      if (mal.length > 5) break
    }
    dia++
    const fin = mes === 2 && bisiesto(anio) ? 29 : largo[mes]
    if (dia > fin) {
      dia = 1
      mes++
      if (mes > 12) {
        mes = 1
        anio++
      }
    }
  }
  expect(mal).toEqual([])
})

test('el_9_de_noviembre_de_2026_es_lunes', () => {
  expect(diaDeLaSemana('2026-11-09')).toBe(1)
  expect(diaDeLaSemana('2026-11-15')).toBe(7)
})

test.each([
  ['0001-01-01', -1],
  ['9999-12-31', 1],
  ['2026-11-09', -739929],
  ['2026-11-09', 3000000],
])('sumar_dias_fuera_del_calendario_lanza_range_error (%s %i)', (fecha, dias) => {
  expect(() => sumarDias(fecha, dias)).toThrow(RangeError)
})

test('sumar_dias_dentro_del_calendario_llega_a_los_bordes', () => {
  expect(sumarDias('0001-01-02', -1)).toBe('0001-01-01')
  expect(sumarDias('9999-12-30', 1)).toBe('9999-12-31')
  expect(sumarDias('2024-02-28', 1)).toBe('2024-02-29')
  expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28')
})

test('sumar_dias_sin_salirse_se_queda_en_el_borde', () => {
  expect(sumarDiasSinSalirse('0001-01-05', -100)).toBe('0001-01-01')
  expect(sumarDiasSinSalirse('9999-12-30', 5)).toBe('9999-12-31')
  expect(sumarDiasSinSalirse('2026-11-09', 1)).toBe('2026-11-10')
})

test('el_lunes_de_una_fecha_no_sale_del_calendario', () => {
  // El 1-1-0001 fue lunes: la primera semana empieza justo en el borde.
  expect(lunesDe('0001-01-03')).toBe('0001-01-01')
  expect(lunesDe('0001-01-01')).toBe('0001-01-01')
  expect(lunesDe('9999-12-31')).toBe('9999-12-27')
  expect(lunesDe('2026-11-15')).toBe('2026-11-09')
})

test.each([
  '2026-02-29',
  '2026-13-01',
  '2026-00-10',
  '2026-04-31',
  '0000-01-01',
  '2026-1-1',
  '10000-01-01',
  ' 2026-01-01',
  '2026-01-01T00:00',
  '',
])('partes_rechaza_lo_que_no_es_una_fecha (%j)', (texto) => {
  expect(partes(texto)).toBeNull()
})

test('partes_acepta_un_29_de_febrero_bisiesto', () => {
  expect(partes('2024-02-29')).toEqual({ anio: 2024, mes: 2, dia: 29 })
  expect(partes('2000-02-29')).toEqual({ anio: 2000, mes: 2, dia: 29 })
  expect(partes('1900-02-29')).toBeNull()
})
