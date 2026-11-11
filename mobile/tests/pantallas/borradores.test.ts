/**
 * Los borradores que cruzan pantallas en Programas (`src/pantallas/programas/borradores.ts`),
 * sin sus hooks: la semana vacía, la clave de la semana en edición de cada programa, y que lo
 * guardado se lea, se tire solo lo que se pide y, tras importar o borrar los datos, no quede
 * ninguno.
 */
import {
  guardarBorrador,
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
  test('los siete días de la semana, todos de descanso', () => {
    expect(sinDias()).toEqual({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null })
  })

  test('cada llamada da una semana nueva: cambiar una no toca la siguiente', () => {
    const una = sinDias()
    una[1] = rutina
    expect(sinDias()[1]).toBeNull()
  })
})

describe('semanaEnEdicion', () => {
  test('cada programa tiene su propia clave, distinta de las de lo nuevo', () => {
    const claves = [semanaEnEdicion(1), semanaEnEdicion(2), PROGRAMA_NUEVO, RUTINA_NUEVA]
    expect(new Set(claves).size).toBe(claves.length)
    expect(semanaEnEdicion(1)).toBe(semanaEnEdicion(1))
  })
})

describe('leer, guardar y tirar', () => {
  test('sin nada guardado, no hay borrador', () => {
    expect(leerBorrador(PROGRAMA_NUEVO)).toBeNull()
  })

  test('lo que se guarda se lee, y lo último guardado sustituye a lo anterior', () => {
    guardarBorrador(PROGRAMA_NUEVO, programa())
    expect(leerBorrador<BorradorDePrograma>(PROGRAMA_NUEVO)).toEqual(programa())

    const otro: BorradorDePrograma = { ...programa(), nombre: 'Torso-pierna', activar: false }
    guardarBorrador(PROGRAMA_NUEVO, otro)
    expect(leerBorrador<BorradorDePrograma>(PROGRAMA_NUEVO)).toEqual(otro)
  })

  test('tirar un borrador no toca los demás', () => {
    const rutinaNueva: BorradorDeRutina = { nombre: 'Pierna', ejercicios: [] }
    guardarBorrador(PROGRAMA_NUEVO, programa())
    guardarBorrador(RUTINA_NUEVA, rutinaNueva)
    guardarBorrador(semanaEnEdicion(3), sinDias())

    tirarBorrador(RUTINA_NUEVA)

    expect(leerBorrador(RUTINA_NUEVA)).toBeNull()
    expect(leerBorrador(PROGRAMA_NUEVO)).toEqual(programa())
    expect(leerBorrador(semanaEnEdicion(3))).toEqual(sinDias())
  })

  test('tirar uno que no existe no falla ni toca los demás', () => {
    guardarBorrador(PROGRAMA_NUEVO, programa())
    expect(() => tirarBorrador(semanaEnEdicion(99))).not.toThrow()
    expect(leerBorrador(PROGRAMA_NUEVO)).toEqual(programa())
  })

  test('tirar todos los deja vacíos', () => {
    guardarBorrador(PROGRAMA_NUEVO, programa())
    guardarBorrador(RUTINA_NUEVA, { nombre: 'Pierna', ejercicios: [] })
    guardarBorrador(semanaEnEdicion(3), sinDias())

    tirarTodosLosBorradores()

    expect(leerBorrador(PROGRAMA_NUEVO)).toBeNull()
    expect(leerBorrador(RUTINA_NUEVA)).toBeNull()
    expect(leerBorrador(semanaEnEdicion(3))).toBeNull()
  })
})
