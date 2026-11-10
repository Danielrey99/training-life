/**
 * Los formateadores de fechas de `src/utiles/fechas.ts` (copia de los de la web, que no tenía
 * tests). La especificación son sus comentarios y la regla del autor: el año solo si no es el
 * de hoy, y nunca «hoy» ni «ayer» en un texto con fecha salvo `fechaEnFrase` con `relativa`.
 *
 * Reloj y zona: el módulo lee la hora del dispositivo con `new Date()` y el día con
 * `getDate()` y compañía, así que hacen falta las dos cosas fijas. La zona se pone en
 * `beforeAll` con `process.env.TZ` (Node la relee al asignarla; no vale ponerla antes de los
 * `import`, que Babel sube al principio) y el reloj, con `jest.useFakeTimers` y
 * `setSystemTime`. «Hoy» es el martes 10 de noviembre de 2026 a mediodía.
 */
import {
  conArticulo,
  diaDe,
  diaDeLaSemana,
  diasEntre,
  diaYMes,
  diaYMesConAnio,
  diaYMesCorto,
  fechaAbreviada,
  fechaCompleta,
  fechaCorta,
  fechaEnFrase,
  fechaLarga,
  fechaTitulo,
  finDeMes,
  hoy,
  inicioDeMes,
  mesConAnio,
  mesCorto,
  mesDeLaUrl,
  nombreDelDia,
  sumarDias,
  sumarMeses,
  tituloDeMes,
} from '../../src/utiles/fechas'

const zonaOriginal = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'Europe/Madrid'
})
afterAll(() => {
  if (zonaOriginal === undefined) delete process.env.TZ
  else process.env.TZ = zonaOriginal
})

function ponerHoy(anio: number, mes: number, dia: number, hora = 12, minuto = 0) {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(anio, mes - 1, dia, hora, minuto))
}

beforeEach(() => ponerHoy(2026, 11, 10))
afterEach(() => jest.useRealTimers())

describe('la zona de la prueba', () => {
  test('el_proceso_corre_en_hora_de_madrid', () => {
    // Si esto falla, el resto de los tests de fechas no dicen nada.
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120)
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60)
  })
})

describe('hoy y diaDe', () => {
  test('hoy_es_el_dia_local_aunque_en_utc_sea_el_anterior', () => {
    // 00:30 en Madrid son las 23:30 del día anterior en UTC: `toISOString` daría el 9.
    ponerHoy(2026, 11, 10, 0, 30)
    expect(hoy()).toBe('2026-11-10')
  })

  test('hoy_a_las_23_59_sigue_siendo_hoy', () => {
    ponerHoy(2026, 11, 10, 23, 59)
    expect(hoy()).toBe('2026-11-10')
  })

  test('diaDe_pasa_un_instante_con_microsegundos_y_zona_al_dia_local', () => {
    // 23:30 UTC del 1 en verano son la 01:30 del 2 en Madrid.
    expect(diaDe('2026-09-01T23:30:00.123456+00:00')).toBe('2026-09-02')
  })

  test.each([
    // [instante, día en Madrid]
    ['2026-09-01T21:59:59.999999Z', '2026-09-01'], // 23:59:59 en verano
    ['2026-09-01T22:00:00Z', '2026-09-02'], // 00:00 en verano
    ['2026-12-31T22:59:59Z', '2026-12-31'], // 23:59:59 en invierno
    ['2026-12-31T23:00:00Z', '2027-01-01'], // 00:00 en invierno
    ['2026-09-02T00:30:00+02:00', '2026-09-02'], // ya con la zona de Madrid
    ['2026-09-01T20:30:00-04:00', '2026-09-02'], // otra zona: 00:30 UTC, 02:30 en Madrid
    ['2026-09-01T10:00:00', '2026-09-01'], // sin zona se toma como UTC
    ['2026-09-01 10:00:00.5Z', '2026-09-01'], // con espacio y un decimal
  ])('diaDe_de_%s_es_%s', (instante, dia) => {
    expect(diaDe(instante)).toBe(dia)
  })

  test('diaDe_rechaza_lo_que_no_es_un_instante', () => {
    expect(() => diaDe('ayer')).toThrow()
  })
})

describe('aritmética de días y meses', () => {
  test.each([
    ['2026-11-10', '2026-11-10', 0],
    ['2026-11-10', '2026-11-11', 1],
    ['2026-11-10', '2026-11-09', -1],
    ['2026-02-28', '2026-03-01', 1],
    ['2028-02-28', '2028-03-01', 2], // bisiesto
    ['2025-12-31', '2026-01-01', 1],
    // Con el cambio de hora de por medio (23 o 25 horas), sigue siendo un día por fecha.
    ['2026-03-28', '2026-03-30', 2],
    ['2026-10-24', '2026-10-26', 2],
  ])('diasEntre_%s_y_%s_es_%i', (desde, hasta, dias) => {
    expect(diasEntre(desde, hasta)).toBe(dias)
  })

  test.each([
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-11-01', -1, '2026-10-31'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-03-28', 1, '2026-03-29'], // día del cambio a verano
    ['2026-03-29', 1, '2026-03-30'],
    ['2026-10-25', 1, '2026-10-26'], // día del cambio a invierno
    ['2026-11-10', 0, '2026-11-10'],
    ['2026-11-10', 365, '2027-11-10'],
  ])('sumarDias_a_%s_%i_da_%s', (iso, dias, esperado) => {
    expect(sumarDias(iso, dias)).toBe(esperado)
  })

  test.each([
    ['2026-11-10', 1, '2026-12-01'],
    ['2026-11-10', 2, '2027-01-01'],
    ['2026-11-30', 0, '2026-11-01'],
    ['2026-01-31', 1, '2026-02-01'], // no se desborda a marzo
    ['2026-03-31', -1, '2026-02-01'],
    ['2026-11-10', -11, '2025-12-01'],
    ['2026-11-10', -12, '2025-11-01'],
    ['2026-11-10', 14, '2028-01-01'],
  ])('sumarMeses_a_%s_%i_da_%s', (iso, meses, esperado) => {
    expect(sumarMeses(iso, meses)).toBe(esperado)
  })

  test.each([
    ['2026-11-10', '2026-11-30'],
    ['2026-02-10', '2026-02-28'],
    ['2028-02-10', '2028-02-29'],
    ['2100-02-10', '2100-02-28'], // 2100 no es bisiesto
    ['2026-12-31', '2026-12-31'],
    ['2026-01-01', '2026-01-31'],
  ])('finDeMes_de_%s_es_%s', (iso, fin) => {
    expect(finDeMes(iso)).toBe(fin)
  })

  test('inicioDeMes_es_el_dia_uno', () => {
    expect(inicioDeMes('2026-11-10')).toBe('2026-11-01')
    expect(inicioDeMes('2026-11-01')).toBe('2026-11-01')
  })

  test.each([
    ['2026-09', '2026-09-01'],
    ['2026-12', '2026-12-01'],
    ['2026-01', '2026-01-01'],
    [null, '2026-11-01'],
    ['', '2026-11-01'],
    ['2026-13', '2026-11-01'],
    ['2026-00', '2026-11-01'],
    ['2026-9', '2026-11-01'],
    ['septiembre', '2026-11-01'],
    ['2026-09-15', '2026-11-01'],
  ])('mesDeLaUrl_de_%s_es_%s', (valor, esperado) => {
    expect(mesDeLaUrl(valor, '2026-11-10')).toBe(esperado)
  })
})

describe('día de la semana', () => {
  test.each([
    ['2026-11-09', 1, 'lunes'],
    ['2026-11-10', 2, 'martes'],
    ['2026-11-11', 3, 'miércoles'],
    ['2026-11-12', 4, 'jueves'],
    ['2026-11-13', 5, 'viernes'],
    ['2026-11-14', 6, 'sábado'],
    ['2026-11-15', 7, 'domingo'],
  ])('%s_es_el_dia_%i_de_la_semana_y_se_llama_%s', (iso, numero, nombre) => {
    expect(diaDeLaSemana(iso)).toBe(numero)
    expect(nombreDelDia(iso)).toBe(nombre)
  })
})

describe('fechaTitulo y fechaCorta', () => {
  test.each([
    ['2026-11-09', 'Lunes 9'], // de este mes: sin mes
    ['2026-11-10', 'Martes 10'],
    ['2026-11-30', 'Lunes 30'],
    ['2026-09-14', 'Lunes 14 de septiembre'], // de otro mes de este año
    ['2026-01-01', 'Jueves 1 de enero'],
    ['2025-10-01', 'Miércoles 1 de octubre de 2025'], // de otro año
    ['2025-11-10', 'Lunes 10 de noviembre de 2025'], // mismo mes, otro año: lleva mes y año
    ['2027-11-10', 'Miércoles 10 de noviembre de 2027'],
  ])('fechaTitulo_de_%s_es_%s', (iso, texto) => {
    expect(fechaTitulo(iso)).toBe(texto)
  })

  test.each([
    ['2026-11-10', 'martes 10'], // hoy: nunca «hoy»
    ['2026-11-09', 'lunes 9'],
    ['2026-11-04', 'miércoles 4'], // hace seis días: el de la semana
    ['2026-11-03', '3 de noviembre'], // hace siete: ya el mes
    ['2026-08-26', '26 de agosto'],
    ['2026-11-11', '11 de noviembre'], // el futuro no entra en «los últimos seis días»
    ['2025-08-26', '26 de agosto de 2025'],
  ])('fechaCorta_de_%s_es_%s', (iso, texto) => {
    expect(fechaCorta(iso)).toBe(texto)
  })

  test('fechaCorta_cruzando_el_año_usa_el_dia_de_la_semana_hasta_seis_dias_y_luego_el_año', () => {
    ponerHoy(2026, 1, 3)
    expect(fechaCorta('2025-12-30')).toBe('martes 30') // hace cuatro días, aún «semana»
    expect(fechaCorta('2025-12-20')).toBe('20 de diciembre de 2025')
  })
})

describe('fechaLarga, fechaCompleta y las de mes', () => {
  test.each([
    ['2026-09-14', 'lunes 14 de septiembre', 'Lunes 14 de septiembre'],
    ['2026-11-10', 'martes 10 de noviembre', 'Martes 10 de noviembre'],
    ['2025-10-01', 'miércoles 1 de octubre de 2025', 'Miércoles 1 de octubre de 2025'],
    ['2027-01-01', 'viernes 1 de enero de 2027', 'Viernes 1 de enero de 2027'],
  ])('fechaCompleta_y_fechaLarga_de_%s', (iso, completa, larga) => {
    expect(fechaCompleta(iso)).toBe(completa)
    expect(fechaLarga(iso)).toBe(larga)
  })

  test.each([
    ['2026-11-01', 'Noviembre 2026'],
    ['2026-01-31', 'Enero 2026'],
    ['2025-12-15', 'Diciembre 2025'], // aquí el año siempre sale
  ])('tituloDeMes_de_%s_es_%s', (iso, texto) => {
    expect(tituloDeMes(iso)).toBe(texto)
  })

  test.each([
    ['2026-09-15', '15 de septiembre', '15 de septiembre', 'septiembre'],
    ['2025-07-06', '6 de julio', '6 de julio de 2025', 'julio de 2025'],
    ['2027-01-01', '1 de enero', '1 de enero de 2027', 'enero de 2027'],
  ])('diaYMes_diaYMesConAnio_y_mesConAnio_de_%s', (iso, sinAnio, conAnio, mes) => {
    expect(diaYMes(iso)).toBe(sinAnio)
    expect(diaYMesConAnio(iso)).toBe(conAnio)
    expect(mesConAnio(iso)).toBe(mes)
  })

  test('mesCorto_y_diaYMesCorto_abrevian_a_tres_letras', () => {
    expect(mesCorto('2026-09-14')).toBe('sep')
    expect(mesCorto('2026-05-14')).toBe('may')
    expect(diaYMesCorto('2026-09-14')).toBe('14 sep')
    expect(diaYMesCorto('2026-12-01')).toBe('1 dic')
  })

  test.each([
    ['2026-09-14', 'Lun 14 sep'],
    ['2026-11-10', 'Mar 10 nov'],
    ['2026-11-11', 'Mié 11 nov'],
    ['2026-11-12', 'Jue 12 nov'],
    ['2026-11-13', 'Vie 13 nov'],
    ['2026-11-14', 'Sáb 14 nov'],
    ['2026-11-15', 'Dom 15 nov'],
    ['2025-10-01', 'Mié 1 oct 2025'],
  ])('fechaAbreviada_de_%s_es_%s', (iso, texto) => {
    expect(fechaAbreviada(iso)).toBe(texto)
  })
})

describe('fechaEnFrase y conArticulo', () => {
  test('con_relativa_dice_hoy_ayer_y_manana', () => {
    expect(fechaEnFrase('2026-11-10')).toBe('hoy')
    expect(fechaEnFrase('2026-11-09')).toBe('ayer')
    expect(fechaEnFrase('2026-11-11')).toBe('mañana')
  })

  test('sin_relativa_nunca_dice_hoy_ayer_ni_manana', () => {
    expect(fechaEnFrase('2026-11-10', false)).toBe('martes 10')
    expect(fechaEnFrase('2026-11-09', false)).toBe('lunes 9')
    expect(fechaEnFrase('2026-11-11', false)).toBe('miércoles 11')
  })

  test.each([
    ['2026-11-04', 'miércoles 4'], // hace seis días
    ['2026-11-03', 'martes 3'], // hace siete, mismo mes: sin mes
    ['2026-10-28', 'miércoles 28 de octubre'], // hace trece, otro mes: con mes
    ['2026-10-27', '27 de octubre'], // hace catorce: ya el día y el mes
    ['2026-11-16', 'lunes 16'], // dentro de seis días
    ['2026-11-23', 'lunes 23'], // dentro de trece, mismo mes
    ['2026-11-24', '24 de noviembre'], // dentro de catorce
    ['2026-12-05', '5 de diciembre'],
    ['2025-11-10', '10 de noviembre de 2025'], // otro año: con año
    ['2027-03-01', '1 de marzo de 2027'],
  ])('fechaEnFrase_de_%s_es_%s', (iso, texto) => {
    expect(fechaEnFrase(iso)).toBe(texto)
    // Sin relativa dan lo mismo: ninguna de estas es hoy, ayer ni mañana.
    expect(fechaEnFrase(iso, false)).toBe(texto)
  })

  test('a_menos_de_dos_semanas_en_otro_mes_lleva_el_mes_pero_no_el_año', () => {
    // Decisión del código: a diez días vista el año se sobreentiende.
    ponerHoy(2026, 1, 3)
    expect(fechaEnFrase('2025-12-24')).toBe('miércoles 24 de diciembre')
  })

  test('a_dos_semanas_o_mas_en_otro_año_lleva_el_año', () => {
    ponerHoy(2026, 1, 3)
    expect(fechaEnFrase('2025-12-19')).toBe('19 de diciembre de 2025')
  })

  test('conArticulo_nunca_usa_hoy_ayer_ni_manana', () => {
    expect(conArticulo('2026-11-10')).toBe('el martes 10')
    expect(conArticulo('2026-11-09')).toBe('el lunes 9')
    expect(conArticulo('2026-11-11')).toBe('el miércoles 11')
    expect(conArticulo('2026-06-26')).toBe('el 26 de junio')
    expect(conArticulo('2025-06-26')).toBe('el 26 de junio de 2025')
  })
})

describe('los extremos del calendario', () => {
  test('el_ultimo_dia_del_calendario_se_escribe_entero', () => {
    expect(fechaTitulo('9999-12-31')).toBe('Viernes 31 de diciembre de 9999')
    expect(fechaCompleta('9999-12-31')).toBe('viernes 31 de diciembre de 9999')
    expect(fechaCorta('9999-12-31')).toBe('31 de diciembre de 9999')
    expect(fechaEnFrase('9999-12-31')).toBe('31 de diciembre de 9999')
    expect(diaDeLaSemana('9999-12-31')).toBe(5)
    expect(finDeMes('9999-12-31')).toBe('9999-12-31')
    expect(tituloDeMes('9999-12-31')).toBe('Diciembre 9999')
  })

  // Los años 0 a 99 no se leen como 1900 a 1999 (`aFecha`, `finDeMes` y `sumarMeses` usan
  // `setFullYear`) y `aIso` rellena el año a cuatro cifras.
  test('el_primer_dia_del_calendario_se_escribe_con_su_año', () => {
    expect(fechaCompleta('0001-01-01')).toBe('lunes 1 de enero de 1')
  })

  test('el_primer_dia_del_calendario_se_conserva_al_sumar_y_al_acabar_el_mes', () => {
    expect(sumarDias('0001-01-01', 1)).toBe('0001-01-02')
    expect(sumarDias('0001-01-02', -1)).toBe('0001-01-01')
    expect(finDeMes('0001-01-15')).toBe('0001-01-31')
    expect(sumarMeses('0001-01-15', 1)).toBe('0001-02-01')
  })

  test('el_primer_dia_del_calendario_es_lunes', () => {
    // 0001-01-01 fue lunes en el calendario gregoriano proléptico (1901-01-01 fue martes).
    expect(diaDeLaSemana('0001-01-01')).toBe(1)
  })
})
