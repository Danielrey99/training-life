/**
 * Los borradores que cruzan pantallas en Programas (`src/pantallas/programas/borradores.ts`),
 * sin sus hooks: la semana vacía, la clave de la semana en edición de cada programa, y que lo
 * guardado se lea, se tire solo lo que se pide y, tras importar o borrar los datos, no quede
 * ninguno.
 */
import {
  guardarBorrador,
  hayAlgoEnElPrograma,
  hayAlgoEnLaRutina,
  leerBorrador,
  PROGRAMA_NUEVO,
  RUTINA_NUEVA,
  semanaEnEdicion,
  sinDias,
  tirarBorrador,
  tirarTodosLosBorradores,
  type BorradorDePrograma,
  type BorradorDeRutina,
} from '../../src/pantallas/programas/borradores'

beforeEach(() => {
  tirarTodosLosBorradores()
})

const rutina = { id: 7, nombre: 'Push', oculto_desde: null }

function programa(): BorradorDePrograma {
  return { nombre: 'PPL', dias: { ...sinDias(), 1: rutina }, activar: true }
}

describe('sinDias', () => {
  test('los_siete_dias_de_la_semana_todos_de_descanso', () => {
    expect(sinDias()).toEqual({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null })
  })

  test('cada_llamada_da_una_semana_nueva_cambiar_una_no_toca_la_siguiente', () => {
    const una = sinDias()
    una[1] = rutina
    expect(sinDias()[1]).toBeNull()
  })
})

describe('semanaEnEdicion', () => {
  test('cada_programa_tiene_su_propia_clave_distinta_de_las_de_lo_nuevo', () => {
    const claves = [semanaEnEdicion(1), semanaEnEdicion(2), PROGRAMA_NUEVO, RUTINA_NUEVA]
    expect(new Set(claves).size).toBe(claves.length)
    expect(semanaEnEdicion(1)).toBe(semanaEnEdicion(1))
  })
})

describe('leer, guardar y tirar', () => {
  test('sin_nada_guardado_no_hay_borrador', () => {
    expect(leerBorrador(PROGRAMA_NUEVO)).toBeNull()
  })

  test('lo_que_se_guarda_se_lee_y_lo_ultimo_guardado_sustituye_a_lo_anterior', () => {
    guardarBorrador(PROGRAMA_NUEVO, programa())
    expect(leerBorrador<BorradorDePrograma>(PROGRAMA_NUEVO)).toEqual(programa())

    const otro: BorradorDePrograma = { ...programa(), nombre: 'Torso-pierna', activar: false }
    guardarBorrador(PROGRAMA_NUEVO, otro)
    expect(leerBorrador<BorradorDePrograma>(PROGRAMA_NUEVO)).toEqual(otro)
  })

  test('tirar_un_borrador_no_toca_los_demas', () => {
    const rutinaNueva: BorradorDeRutina = { nombre: 'Pierna', ejercicios: [] }
    guardarBorrador(PROGRAMA_NUEVO, programa())
    guardarBorrador(RUTINA_NUEVA, rutinaNueva)
    guardarBorrador(semanaEnEdicion(3), sinDias())

    tirarBorrador(RUTINA_NUEVA)

    expect(leerBorrador(RUTINA_NUEVA)).toBeNull()
    expect(leerBorrador(PROGRAMA_NUEVO)).toEqual(programa())
    expect(leerBorrador(semanaEnEdicion(3))).toEqual(sinDias())
  })

  test('tirar_uno_que_no_existe_no_falla_ni_toca_los_demas', () => {
    guardarBorrador(PROGRAMA_NUEVO, programa())
    expect(() => tirarBorrador(semanaEnEdicion(99))).not.toThrow()
    expect(leerBorrador(PROGRAMA_NUEVO)).toEqual(programa())
  })

  test('tirar_todos_los_deja_vacios', () => {
    guardarBorrador(PROGRAMA_NUEVO, programa())
    guardarBorrador(RUTINA_NUEVA, { nombre: 'Pierna', ejercicios: [] })
    guardarBorrador(semanaEnEdicion(3), sinDias())

    tirarTodosLosBorradores()

    expect(leerBorrador(PROGRAMA_NUEVO)).toBeNull()
    expect(leerBorrador(RUTINA_NUEVA)).toBeNull()
    expect(leerBorrador(semanaEnEdicion(3))).toBeNull()
  })
})

describe('si hay algo escrito', () => {
  const programa = (cambios: Partial<BorradorDePrograma> = {}): BorradorDePrograma => ({
    nombre: '',
    activar: false,
    dias: sinDias(),
    ...cambios,
  })

  test('hayAlgoEnElPrograma_cuenta_el_nombre_activar_o_un_dia_con_rutina_pero_no_espacios', () => {
    expect(hayAlgoEnElPrograma(programa())).toBe(false)
    expect(hayAlgoEnElPrograma(programa({ nombre: '   ' }))).toBe(false)
    expect(hayAlgoEnElPrograma(programa({ nombre: ' PPL ' }))).toBe(true)
    expect(hayAlgoEnElPrograma(programa({ activar: true }))).toBe(true)
    const dias = { ...sinDias(), 3: { id: 1, nombre: 'Push', oculto_desde: null } }
    expect(hayAlgoEnElPrograma(programa({ dias }))).toBe(true)
  })

  test('hayAlgoEnLaRutina_cuenta_el_nombre_o_un_ejercicio_pero_no_espacios', () => {
    const vacia: BorradorDeRutina = { nombre: '', ejercicios: [] }
    expect(hayAlgoEnLaRutina(vacia)).toBe(false)
    expect(hayAlgoEnLaRutina({ ...vacia, nombre: '  ' })).toBe(false)
    expect(hayAlgoEnLaRutina({ ...vacia, nombre: 'Pull' })).toBe(true)
    const ejercicios = [{}] as unknown as BorradorDeRutina['ejercicios']
    expect(hayAlgoEnLaRutina({ ...vacia, ejercicios })).toBe(true)
  })
})
