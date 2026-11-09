/**
 * Cómo se escriben las fechas y los días en los mensajes. Puerto de
 * `backend/tests/test_fechas.py`: el backend saca «hoy» de un reloj global (`hoy_es`); aquí
 * `fechaEnTexto` lo recibe.
 */
import { fechaEnTexto, nombreDelDia } from '../../../src/logica/reglas/fechas'

test('una_fecha_de_otro_anio_lleva_el_anio', () => {
  const hoy = '2026-10-27'

  expect(fechaEnTexto('2025-10-01', hoy)).toBe('miércoles 1 de octubre de 2025')
  expect(fechaEnTexto('2027-01-04', hoy)).toBe('lunes 4 de enero de 2027')
})

test('el_anio_que_manda_es_el_de_hoy_y_no_el_del_reloj_real', () => {
  // Con «hoy» en 2025, una fecha de 2025 va sin año y una de 2026 lo lleva.
  const hoy = '2025-12-31'

  expect(fechaEnTexto('2025-12-31', hoy)).toBe('miércoles 31 de diciembre')
  expect(fechaEnTexto('2026-01-01', hoy)).toBe('jueves 1 de enero de 2026')
})

test('los_bordes_del_calendario_no_dan_error', () => {
  // No suma días: el primero y el último día que existen se escriben sin más.
  const hoy = '2026-10-27'

  expect(fechaEnTexto('0001-01-01', hoy)).toBe('lunes 1 de enero de 1')
  expect(fechaEnTexto('9999-12-31', hoy)).toBe('viernes 31 de diciembre de 9999')
})

test.each([
  [1, 'lunes'],
  [3, 'miércoles'],
  [6, 'sábado'],
  [7, 'domingo'],
])('el_dia_de_la_semana_va_del_lunes_al_domingo (%i)', (diaSemana, nombre) => {
  // Del 1 al 7, como `dia_semana` en la API: el 1 es el lunes y el 7 el domingo.
  expect(nombreDelDia(diaSemana)).toBe(nombre)
})
