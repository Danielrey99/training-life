/**
 * Las cuentas de la sesión que no dependen de la pantalla (`src/reglasDePantalla/sesion.ts`):
 * la frase de cuántos ejercicios se han completado y con qué ejercicio arranca cada hueco.
 */
import { completados, ejercicioInicial } from '../../src/reglasDePantalla/sesion'
import type { Ejercicio, HuecoDeRutina, Serie } from '../../src/logica/tipos'

function ejercicio(id: number, oculto = false): Ejercicio {
  return {
    id,
    nombre: `Ejercicio ${id}`,
    grupo_muscular_id: 1,
    descripcion: null,
    es_predefinido: false,
    tipo_registro: 'peso_reps',
    oculto_desde: oculto ? '2026-11-01T10:00:00+00:00' : null,
    created_at: '2026-01-01T10:00:00+00:00',
    updated_at: '2026-01-01T10:00:00+00:00',
  }
}

/** Un hueco con el principal y los comodines que se pidan. */
function hueco(principal: Ejercicio, ...comodines: Ejercicio[]): HuecoDeRutina {
  const objetivo = {
    series_objetivo: 3,
    reps_min: 8,
    reps_max: 12,
    duracion_min_s: null,
    duracion_max_s: null,
  }
  return {
    id: 7,
    rutina_id: 1,
    ejercicio_principal_id: principal.id,
    orden: 1,
    ...objetivo,
    oculto_desde: null,
    created_at: '2026-01-01T10:00:00+00:00',
    updated_at: '2026-01-01T10:00:00+00:00',
    ejercicio_principal: principal,
    alternativas: comodines.map((c) => ({ ...objetivo, ejercicio: c })),
  }
}

/** Una serie de `ejercicio` apuntada en el hueco `slot`. */
function serie(ejercicioId: number, slot = 7): Serie {
  return {
    id: Math.floor(Math.random() * 1e9),
    entrenamiento_id: 1,
    ejercicio_id: ejercicioId,
    slot_id: slot,
    numero_serie: 1,
    peso: '40.00',
    repeticiones: 10,
    duracion_s: null,
    distancia_m: null,
    peso_corporal: null,
    variante: null,
    created_at: '2026-11-10T10:00:00+00:00',
    updated_at: '2026-11-10T10:00:00+00:00',
    ejercicio: ejercicio(ejercicioId),
  }
}

describe('completados', () => {
  test('con_un_solo_ejercicio_no_dice_cuantos', () => {
    expect(completados(0, 1)).toBe('aún no has completado el ejercicio')
    expect(completados(1, 1)).toBe('has completado el ejercicio')
  })

  test.each([
    [0, 4, 'has completado 0 de los 4 ejercicios'],
    [1, 4, 'has completado 1 de los 4 ejercicios'],
    [3, 4, 'has completado 3 de los 4 ejercicios'],
    [4, 4, 'has completado 4 de los 4 ejercicios'],
    [0, 2, 'has completado 0 de los 2 ejercicios'],
    [12, 12, 'has completado 12 de los 12 ejercicios'],
  ])('completados_de_%i_entre_%i', (hechos, total, texto) => {
    expect(completados(hechos, total)).toBe(texto)
  })
})

describe('ejercicioInicial', () => {
  const principal = ejercicio(1)
  const comodin = ejercicio(2)
  const otroComodin = ejercicio(3)

  test('sin_series_arranca_el_principal', () => {
    expect(ejercicioInicial(hueco(principal, comodin), [])).toBe(principal)
  })

  test('un_hueco_sin_comodines_y_sin_series_arranca_el_principal', () => {
    expect(ejercicioInicial(hueco(principal), [])).toBe(principal)
  })

  test('con_series_de_hoy_del_comodin_sigue_con_el_comodin', () => {
    expect(ejercicioInicial(hueco(principal, comodin), [serie(2)])).toBe(comodin)
  })

  test('manda_la_ultima_serie_de_hoy', () => {
    const h = hueco(principal, comodin, otroComodin)
    expect(ejercicioInicial(h, [serie(1), serie(2)])).toBe(comodin)
    expect(ejercicioInicial(h, [serie(2), serie(1)])).toBe(principal)
    expect(ejercicioInicial(h, [serie(1), serie(2), serie(3)])).toBe(otroComodin)
  })

  test('las_series_de_otro_hueco_no_cuentan', () => {
    expect(ejercicioInicial(hueco(principal, comodin), [serie(2, 99)])).toBe(principal)
    // Ni siquiera si la última de todas es de otro hueco.
    expect(ejercicioInicial(hueco(principal, comodin), [serie(2), serie(1, 99)])).toBe(comodin)
  })

  test('una_serie_de_un_ejercicio_que_ya_no_esta_en_el_hueco_se_ignora', () => {
    expect(ejercicioInicial(hueco(principal, comodin), [serie(42)])).toBe(principal)
  })

  test('con_el_principal_oculto_y_sin_series_arranca_el_primer_comodin_visible', () => {
    const oculto = ejercicio(1, true)
    expect(ejercicioInicial(hueco(oculto, comodin, otroComodin), [])).toBe(comodin)
  })

  test('se_salta_los_comodines_ocultos', () => {
    const oculto = ejercicio(1, true)
    const comodinOculto = ejercicio(2, true)
    expect(ejercicioInicial(hueco(oculto, comodinOculto, otroComodin), [])).toBe(otroComodin)
  })

  test('con_el_principal_visible_y_un_comodin_oculto_arranca_el_principal', () => {
    expect(ejercicioInicial(hueco(principal, ejercicio(2, true)), [])).toBe(principal)
  })

  test('con_todo_oculto_no_hay_ejercicio', () => {
    const h = hueco(ejercicio(1, true), ejercicio(2, true), ejercicio(3, true))
    expect(ejercicioInicial(h, [])).toBeNull()
  })

  test('un_hueco_con_solo_el_principal_oculto_no_tiene_ejercicio', () => {
    expect(ejercicioInicial(hueco(ejercicio(1, true)), [])).toBeNull()
  })

  test('lo_ya_apuntado_hoy_con_un_ejercicio_oculto_se_sigue_corrigiendo_con_el', () => {
    // «Corregir sí, elegir algo oculto no»: si hoy ya hay series con el principal y luego se
    // ocultó, la sesión sigue abriéndose con él y no salta a un comodín.
    const oculto = ejercicio(1, true)
    expect(ejercicioInicial(hueco(oculto, comodin), [serie(1)])).toBe(oculto)
  })

  test('devuelve_el_objeto_del_hueco_y_no_el_de_la_serie', () => {
    const resultado = ejercicioInicial(hueco(principal, comodin), [serie(2)])
    expect(resultado).toBe(comodin)
  })
})
