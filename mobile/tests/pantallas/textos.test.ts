/**
 * Los textos de rutinas y programas de `src/utiles/textos.ts` (copia de
 * `web/src/paginas/programas/textos.ts`, que no tenía tests): el objetivo de cada ejercicio
 * («3 × 8-12», «3 × 30-45 s»), qué objetivo y cuántas series tocan con una alternativa, y las
 * cuentas y enumeraciones de las listas.
 */
import type { Ejercicio, HuecoDeRutina, Objetivo, Rutina } from '../../src/logica/tipos'
import {
  cuantosDias,
  deDonde,
  diasCambiadosAMano,
  ejercicios,
  enumerar,
  lineaDeAlternativas,
  nombreDelDiaSemana,
  objetivo,
  objetivoDelEjercicio,
  seriesObjetivoDe,
} from '../../src/utiles/textos'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

function reps(series: number, min: number, max: number): Objetivo {
  return {
    series_objetivo: series,
    reps_min: min,
    reps_max: max,
    duracion_min_s: null,
    duracion_max_s: null,
  }
}

function duracion(series: number, min: number, max: number): Objetivo {
  return {
    series_objetivo: series,
    reps_min: null,
    reps_max: null,
    duracion_min_s: min,
    duracion_max_s: max,
  }
}

function ejercicio(id: number): Ejercicio {
  return {
    id,
    nombre: `Ejercicio ${id}`,
    grupo_muscular_id: 1,
    descripcion: null,
    es_predefinido: false,
    tipo_registro: 'peso_reps',
    oculto_desde: null,
    created_at: '2026-01-01T10:00:00+00:00',
    updated_at: '2026-01-01T10:00:00+00:00',
  }
}

/** Un hueco con el principal 1 (4 × 6-10) y la alternativa 2 (3 × 30-45 s). */
function hueco(oculto_desde: string | null = null): HuecoDeRutina {
  return {
    id: 7,
    rutina_id: 1,
    ejercicio_principal_id: 1,
    orden: 1,
    ...reps(4, 6, 10),
    oculto_desde,
    created_at: '2026-01-01T10:00:00+00:00',
    updated_at: '2026-01-01T10:00:00+00:00',
    ejercicio_principal: ejercicio(1),
    alternativas: [{ ...duracion(3, 30, 45), ejercicio: ejercicio(2) }],
  }
}

describe('objetivo', () => {
  test.each<[string, Objetivo, string]>([
    ['repeticiones con rango', reps(4, 6, 10), '4 × 6-10'],
    ['repeticiones iguales', reps(3, 8, 8), '3 × 8'],
    ['segundos', duracion(3, 30, 45), '3 × 30-45 s'],
    ['minutos enteros', duracion(1, 1200, 1800), '1 × 20-30 min'],
    ['de segundos a minutos', duracion(3, 30, 60), '3 × 30 s-1 min'],
    ['minutos no enteros', duracion(1, 90, 150), '1 × 1 min 30 s-2 min 30 s'],
    ['de minutos enteros a no enteros', duracion(1, 60, 90), '1 × 1 min-1 min 30 s'],
    ['la misma duración', duracion(3, 60, 60), '3 × 1 min'],
    ['la misma duración en segundos', duracion(2, 45, 45), '2 × 45 s'],
  ])('el_objetivo_en_%s', (_, valor, texto) => {
    expect(objetivo(valor)).toBe(texto)
  })
})

describe('el objetivo de cada ejercicio del hueco', () => {
  test('sin_ejercicio_o_con_el_principal_es_el_del_principal', () => {
    expect(objetivoDelEjercicio(hueco(), undefined)).toBe('4 × 6-10')
    expect(objetivoDelEjercicio(hueco(), 1)).toBe('4 × 6-10')
    expect(seriesObjetivoDe(hueco(), undefined)).toBe(4)
    expect(seriesObjetivoDe(hueco(), 1)).toBe(4)
  })

  test('con_una_alternativa_es_el_suyo', () => {
    expect(objetivoDelEjercicio(hueco(), 2)).toBe('3 × 30-45 s')
    expect(seriesObjetivoDe(hueco(), 2)).toBe(3)
  })

  test('con_un_ejercicio_que_ya_no_es_del_hueco_no_hay_objetivo_y_las_series_son_las_del_principal', () => {
    // Se quitó del hueco después de hacerlo: lo hecho se sigue viendo, sin objetivo.
    expect(objetivoDelEjercicio(hueco(), 99)).toBeNull()
    expect(seriesObjetivoDe(hueco(), 99)).toBe(4)
  })
})

describe('cuentas y listas', () => {
  test('nombreDelDiaSemana_va_en_mayuscula_de_lunes_a_domingo', () => {
    expect([1, 3, 7].map(nombreDelDiaSemana)).toEqual(['Lunes', 'Miércoles', 'Domingo'])
  })

  test.each<[string[], string]>([
    [[], ''],
    [['lunes'], 'lunes'],
    [['lunes', 'viernes'], 'lunes y viernes'],
    [['lunes', 'miércoles', 'viernes'], 'lunes, miércoles y viernes'],
  ])('enumerar_%j', (partes, texto) => {
    expect(enumerar(partes)).toBe(texto)
  })

  test('cuantosDias_dice_sin_dias_uno_o_varios', () => {
    expect([0, 1, 5].map(cuantosDias)).toEqual(['Sin días de entreno', '1 día', '5 días'])
  })

  test('los_ejercicios_de_una_rutina_son_solo_sus_huecos_visibles', () => {
    const rutina = (...ocultos: (string | null)[]) =>
      ({ slots: ocultos.map((o) => hueco(o)) }) as unknown as Rutina

    expect(ejercicios(rutina())).toBe('Sin ejercicios')
    expect(ejercicios(rutina('2026-09-01'))).toBe('Sin ejercicios')
    expect(ejercicios(rutina(null, '2026-09-01'))).toBe('1 ejercicio')
    expect(ejercicios(rutina(null, null, '2026-09-01'))).toBe('2 ejercicios')
  })

  test('lineaDeAlternativas_solo_dice_cuantas_y_nada_sin_ninguna', () => {
    expect([0, 1, 3].map(lineaDeAlternativas)).toEqual([null, '1 alternativa', '3 alternativas'])
  })

  test('deDonde_dice_el_grupo_y_quien_lo_creo', () => {
    const grupos = new Map([[1, 'Pecho']])

    expect(deDonde({ grupo_muscular_id: 1, es_predefinido: true }, grupos)).toBe(
      'Pecho · predefinido',
    )
    expect(deDonde({ grupo_muscular_id: 1, es_predefinido: false }, grupos)).toBe('Pecho · mío')
    expect(deDonde({ grupo_muscular_id: 9, es_predefinido: false }, grupos)).toBe('Sin grupo · mío')
  })
})

describe('diasCambiadosAMano', () => {
  const enFrase = (iso: string) => `el día ${iso.slice(8)}`

  test('uno_solo_dice_cual', () => {
    expect(diasCambiadosAMano(['2026-09-20'], enFrase)).toBe(
      'Tienes 1 día cambiado a mano, el día 20.',
    )
  })

  test('varios_dicen_cuantos_y_entre_que_fechas_aunque_lleguen_desordenados', () => {
    const fechas = ['2026-09-25', '2026-09-18', '2026-09-30']

    expect(diasCambiadosAMano(fechas, enFrase)).toBe(
      'Tienes 3 días cambiados a mano, entre el día 18 y el día 30.',
    )
    // Sin tocar la lista que recibe.
    expect(fechas).toEqual(['2026-09-25', '2026-09-18', '2026-09-30'])
  })
})
