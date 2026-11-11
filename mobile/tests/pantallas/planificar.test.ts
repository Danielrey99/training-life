/**
 * Las reglas de H4 · Planificar de `src/reglasDePantalla/planificar.ts` (copia de las funciones
 * de la web, que no tenía tests): las semanas de la lista, el orden de las rutinas en la hoja de
 * un día y los textos de los 409. Los textos se comparan enteros.
 *
 * `conArticulo` y `fechaEnFrase` dependen de «hoy»: se fija el reloj en el martes 10 de
 * noviembre de 2026 (la zona, como en `fechas.test.ts`).
 */
import type { DiaSeguimiento, Programa, RutinaDeHoy } from '../../src/logica/tipos'
import {
  domingoDe,
  enSemanas,
  etiquetaDelDia,
  lunesDe,
  porQueNoSePuede,
  porQueNoSeRestablece,
  rutinasDeLaHoja,
} from '../../src/reglasDePantalla/planificar'

const zonaOriginal = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'Europe/Madrid'
})
afterAll(() => {
  if (zonaOriginal === undefined) delete process.env.TZ
  else process.env.TZ = zonaOriginal
})
beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 10, 10, 12, 0))
})
afterEach(() => jest.useRealTimers())

const dia = (fecha: string) => ({ fecha }) as unknown as DiaSeguimiento

describe('etiquetas y límites de la semana', () => {
  test.each([
    ['2026-11-10', 'Mar 10'],
    ['2026-11-15', 'Dom 15'],
    ['2026-11-09', 'Lun 9'],
    ['2026-12-02', 'Mié 2'],
    ['2026-11-07', 'Sáb 7'],
  ])('etiquetaDelDia_de_%s_es_%s', (fecha, texto) => {
    expect(etiquetaDelDia(fecha)).toBe(texto)
  })

  test.each([
    ['2026-11-09', '2026-11-09'], // un lunes es su propio lunes
    ['2026-11-10', '2026-11-09'],
    ['2026-11-15', '2026-11-09'], // el domingo cuenta con la semana que acaba
    ['2026-11-16', '2026-11-16'],
    ['2026-12-02', '2026-11-30'], // cruza de mes
    ['2027-01-01', '2026-12-28'], // cruza de año
  ])('lunesDe_%s_es_%s', (fecha, lunes) => {
    expect(lunesDe(fecha)).toBe(lunes)
  })

  test.each([
    ['2026-11-09', '2026-11-15'],
    ['2026-11-10', '2026-11-15'],
    ['2026-11-15', '2026-11-15'], // un domingo es su propio domingo
    ['2026-11-30', '2026-12-06'],
    ['2026-12-28', '2027-01-03'],
  ])('domingoDe_%s_es_%s', (fecha, domingo) => {
    expect(domingoDe(fecha)).toBe(domingo)
  })
})

describe('enSemanas', () => {
  test('sin_dias_no_hay_semanas', () => {
    expect(enSemanas([])).toEqual([])
  })

  test('la_primera_semana_empieza_el_primer_dia_dado_y_se_corta_en_cada_lunes', () => {
    const dias = [
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
    ].map(dia)
    const semanas = enSemanas(dias)
    expect(semanas).toHaveLength(2)
    // La primera semana solo trae desde el martes, pero su lunes y su domingo son los de siempre.
    expect(semanas[0].lunes).toBe('2026-11-09')
    expect(semanas[0].domingo).toBe('2026-11-15')
    expect(semanas[0].dias.map((d) => d.fecha)).toEqual(dias.slice(0, 6).map((d) => d.fecha))
    expect(semanas[1].lunes).toBe('2026-11-16')
    expect(semanas[1].domingo).toBe('2026-11-22')
    expect(semanas[1].dias.map((d) => d.fecha)).toEqual(['2026-11-16', '2026-11-17'])
  })

  test('un_domingo_y_el_lunes_siguiente_son_semanas_distintas', () => {
    const semanas = enSemanas([dia('2026-11-15'), dia('2026-11-16')])
    expect(semanas.map((s) => s.lunes)).toEqual(['2026-11-09', '2026-11-16'])
    expect(semanas.map((s) => s.dias.length)).toEqual([1, 1])
  })

  test('una_semana_completa_de_lunes_a_domingo_es_un_solo_grupo', () => {
    const fechas = [9, 10, 11, 12, 13, 14, 15].map((n) => `2026-11-${String(n).padStart(2, '0')}`)
    const semanas = enSemanas(fechas.map(dia))
    expect(semanas).toHaveLength(1)
    expect(semanas[0].dias).toHaveLength(7)
  })
})

describe('rutinasDeLaHoja', () => {
  const rutina = (id: number, nombre: string): RutinaDeHoy => ({
    id,
    nombre,
    ejercicios: 3,
    ultima_vez: null,
  })
  const programaCon = (dias: [number, number, string][]) =>
    ({
      dias: dias.map(([dia_semana, id, nombre]) => ({ dia_semana, rutina: { id, nombre } })),
    }) as unknown as Programa

  const push = rutina(1, 'Push')
  const pull = rutina(2, 'Pull')
  const piernas = rutina(3, 'Piernas')
  const abdomen = rutina(4, 'Abdomen')
  const ñu = rutina(5, 'Ñandú')
  const zeta = rutina(6, 'Zancadas')

  test('las_del_programa_van_en_el_orden_de_la_semana_y_no_el_de_la_lista', () => {
    const programa = programaCon([
      [5, 3, 'Piernas'],
      [1, 1, 'Push'],
      [3, 2, 'Pull'],
    ])
    const { delPrograma, otras } = rutinasDeLaHoja([pull, piernas, push], programa)
    expect(delPrograma.map((r) => r.nombre)).toEqual(['Push', 'Pull', 'Piernas'])
    expect(otras).toEqual([])
  })

  test('una_rutina_que_toca_dos_dias_sale_una_sola_vez', () => {
    const programa = programaCon([
      [1, 1, 'Push'],
      [2, 2, 'Pull'],
      [4, 1, 'Push'],
    ])
    const { delPrograma } = rutinasDeLaHoja([push, pull], programa)
    expect(delPrograma.map((r) => r.nombre)).toEqual(['Push', 'Pull'])
  })

  test('las_demas_van_por_orden_alfabetico_en_espanol', () => {
    const programa = programaCon([[1, 1, 'Push']])
    const { delPrograma, otras } = rutinasDeLaHoja([zeta, ñu, push, abdomen, piernas], programa)
    expect(delPrograma.map((r) => r.nombre)).toEqual(['Push'])
    // En español la Ñ va entre la N y la O, no después de la Z.
    expect(otras.map((r) => r.nombre)).toEqual(['Abdomen', 'Ñandú', 'Piernas', 'Zancadas'])
  })

  test('sin_programa_todas_son_otras', () => {
    const { delPrograma, otras } = rutinasDeLaHoja([pull, push, abdomen], null)
    expect(delPrograma).toEqual([])
    expect(otras.map((r) => r.nombre)).toEqual(['Abdomen', 'Pull', 'Push'])
  })

  test('un_programa_sin_dias_deja_todas_como_otras', () => {
    const { delPrograma, otras } = rutinasDeLaHoja([pull, push], programaCon([]))
    expect(delPrograma).toEqual([])
    expect(otras.map((r) => r.nombre)).toEqual(['Pull', 'Push'])
  })

  test('una_rutina_del_programa_que_no_esta_en_las_visibles_no_sale', () => {
    // «Pull» está en el programa pero oculta: no viene en la lista de visibles.
    const programa = programaCon([
      [1, 1, 'Push'],
      [3, 2, 'Pull'],
    ])
    const { delPrograma, otras } = rutinasDeLaHoja([push, abdomen], programa)
    expect(delPrograma.map((r) => r.nombre)).toEqual(['Push'])
    expect(otras.map((r) => r.nombre)).toEqual(['Abdomen'])
  })

  test('no_cambia_la_lista_ni_el_programa_que_recibe', () => {
    const programa = programaCon([
      [5, 3, 'Piernas'],
      [1, 1, 'Push'],
    ])
    const lista = [zeta, piernas, push, abdomen]
    rutinasDeLaHoja(lista, programa)
    expect(lista.map((r) => r.nombre)).toEqual(['Zancadas', 'Piernas', 'Push', 'Abdomen'])
    expect(programa.dias.map((d) => d.dia_semana)).toEqual([5, 1])
  })
})

describe('porQueNoSePuede', () => {
  test('hecho_el_mismo_dia_con_la_rutina_visible', () => {
    expect(porQueNoSePuede('Push', '2026-11-10', '2026-11-10', false)).toBe(
      'El Push de hoy ya lo hiciste. Si hoy deja de tener Push y no lo pones en otro día de ' +
        'esta semana, lo que entrenaste no contaría para ningún día. Pon antes el Push en otro ' +
        'día, y después cambia hoy.',
    )
  })

  test('hecho_el_mismo_dia_con_la_rutina_oculta', () => {
    expect(porQueNoSePuede('Push', '2026-11-10', '2026-11-10', true)).toBe(
      'El Push de hoy ya lo hiciste. Si hoy deja de tener Push, lo que entrenaste no contaría ' +
        'para ningún día, y Push está oculta, así que no puede ir a otro día. Muestra Push ' +
        'desde la pestaña Programas o borra la sesión de hoy, y después cambia hoy.',
    )
  })

  test('hecho_otro_dia_con_la_rutina_visible', () => {
    expect(porQueNoSePuede('Push', '2026-11-12', '2026-11-10', false)).toBe(
      'El Push del jueves ya lo hiciste el martes. Si el jueves deja de tener Push y no lo ' +
        'pones en otro día de esta semana, lo que entrenaste el martes no contaría para ningún ' +
        'día. Pon antes el Push en otro día, y después cambia el jueves.',
    )
  })

  test('hecho_otro_dia_con_la_rutina_oculta', () => {
    expect(porQueNoSePuede('Push', '2026-11-12', '2026-11-10', true)).toBe(
      'El Push del jueves ya lo hiciste el martes. Si el jueves deja de tener Push, lo que ' +
        'entrenaste el martes no contaría para ningún día, y Push está oculta, así que no puede ' +
        'ir a otro día. Muestra Push desde la pestaña Programas o borra la sesión del martes, y ' +
        'después cambia el jueves.',
    )
  })
})

describe('porQueNoSeRestablece', () => {
  test('con_la_rutina_visible_manda_a_restablecer_dia_a_dia', () => {
    expect(porQueNoSeRestablece('Push', '2026-11-10', false)).toBe(
      'El Push que hiciste el martes 10 se quedaría sin ningún día de esta semana en el que ' +
        'contar. Restablece los días uno a uno, dejando algún día con Push.',
    )
  })

  test('con_la_rutina_oculta_manda_a_mostrarla_o_borrar_la_sesion', () => {
    expect(porQueNoSeRestablece('Push', '2026-11-10', true)).toBe(
      'El Push que hiciste el martes 10 se quedaría sin ningún día de esta semana en el que ' +
        'contar, y Push está oculta, así que no puede ir a otro día. Muestra Push desde la ' +
        'pestaña Programas o borra la sesión del martes 10, y después restablece la semana.',
    )
  })

  test('el_texto_nunca_dice_hoy_ni_ayer_aunque_la_sesion_sea_de_hoy', () => {
    // Regla del autor: en un texto con fecha, el día con su número.
    expect(porQueNoSeRestablece('Pull', '2026-11-10', false)).not.toMatch(/\b(hoy|ayer|mañana)\b/)
    expect(porQueNoSeRestablece('Pull', '2026-11-09', true)).not.toMatch(/\b(hoy|ayer|mañana)\b/)
  })
})
