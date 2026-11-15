/**
 * Los ajustes guardados en el teléfono (`src/utiles/ajustes.ts`, en el `localStorage` de
 * expo-sqlite): qué se lee al abrir la app con lo que guardó una versión anterior, con algo
 * roto o sin poder guardar, y que un cambio se guarda para la próxima vez. Unos ajustes mal
 * leídos no rompen nada a la vista, pero cambian en silencio las unidades de cada peso.
 *
 * Cada test carga el módulo de nuevo (`cargar`), como al abrir la app: lee en la primera
 * llamada y se queda con lo leído.
 */
import type * as ModuloDeAjustes from '../../src/utiles/ajustes'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

const CLAVE = 'training-life.ajustes'

/** Un `localStorage` en memoria, con lo guardado a la vista. */
function almacen(inicial: Record<string, string> = {}) {
  const guardado = new Map(Object.entries(inicial))
  return {
    guardado,
    getItem: (clave: string) => guardado.get(clave) ?? null,
    setItem: (clave: string, valor: string) => {
      guardado.set(clave, valor)
    },
  }
}

type ReactNativeFalso = { Appearance: { getColorScheme: () => string } }

/** El módulo recién cargado sobre ese `localStorage` (o sin él), con su `react-native` falso. */
function cargar(storage: unknown): typeof ModuloDeAjustes & { reactNative: ReactNativeFalso } {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  let modulo!: typeof ModuloDeAjustes
  let reactNative!: ReactNativeFalso
  jest.isolateModules(() => {
    modulo = jest.requireActual('../../src/utiles/ajustes')
    reactNative = jest.requireMock('react-native')
  })
  return { ...modulo, reactNative }
}

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
})

test('sin_nada_guardado_valen_los_de_por_defecto', () => {
  const { ajustes, POR_DEFECTO } = cargar(almacen())

  expect(ajustes()).toEqual(POR_DEFECTO)
})

test('lo_que_no_estaba_guardado_sale_de_los_de_por_defecto', () => {
  // Lo de una versión anterior: sin los ajustes que llegaron después y con el objetivo de un
  // solo tipo.
  const guardado = {
    unidad: 'lb',
    pasoPeso: 2.5,
    objetivoNuevo: { tiempo: { series: 4, min: 20, max: 40 } },
  }
  const { ajustes, POR_DEFECTO } = cargar(almacen({ [CLAVE]: JSON.stringify(guardado) }))

  expect(ajustes()).toEqual({
    ...POR_DEFECTO,
    unidad: 'lb',
    pasoPeso: 2.5,
    objetivoNuevo: { ...POR_DEFECTO.objetivoNuevo, tiempo: { series: 4, min: 20, max: 40 } },
  })
})

test('el_objetivo_de_antes_de_los_tipos_pasa_a_ser_el_de_peso_y_repeticiones', () => {
  const guardado = { objetivo: { series: 4, repsMin: 6, repsMax: 10 } }
  const { ajustes, POR_DEFECTO } = cargar(almacen({ [CLAVE]: JSON.stringify(guardado) }))

  expect(ajustes()).toEqual({
    ...POR_DEFECTO,
    objetivoNuevo: { ...POR_DEFECTO.objetivoNuevo, peso_reps: { series: 4, min: 6, max: 10 } },
  })
  expect(ajustes()).not.toHaveProperty('objetivo')
})

test('el_objetivo_nuevo_de_peso_y_repeticiones_manda_sobre_el_de_antes', () => {
  const guardado = {
    objetivo: { series: 4, repsMin: 6, repsMax: 10 },
    objetivoNuevo: { peso_reps: { series: 5, min: 3, max: 5 } },
  }
  const { ajustes } = cargar(almacen({ [CLAVE]: JSON.stringify(guardado) }))

  expect(ajustes().objetivoNuevo.peso_reps).toEqual({ series: 5, min: 3, max: 5 })
})

test.each([
  ['un texto que no es JSON', '{unidad: lb'],
  ['un JSON nulo', 'null'],
])('con_%s_guardado_valen_los_de_por_defecto', (_, texto) => {
  const { ajustes, POR_DEFECTO } = cargar(almacen({ [CLAVE]: texto }))

  expect(ajustes()).toEqual(POR_DEFECTO)
})

test('un_cambio_se_guarda_y_se_lee_al_volver_a_abrir', () => {
  const storage = almacen()
  const primera = cargar(storage)

  primera.cambiarAjustes({ unidad: 'lb', colores: { 1: 'rojo' } })

  expect(JSON.parse(storage.guardado.get(CLAVE)!)).toMatchObject({
    unidad: 'lb',
    colores: { 1: 'rojo' },
  })
  const segunda = cargar(storage)
  expect(segunda.ajustes()).toEqual({
    ...segunda.POR_DEFECTO,
    unidad: 'lb',
    colores: { 1: 'rojo' },
  })
})

test('sin_poder_leer_ni_guardar_valen_los_de_por_defecto_y_los_cambios_duran_en_memoria', () => {
  const roto = {
    getItem: () => {
      throw new Error('sin almacenamiento')
    },
    setItem: () => {
      throw new Error('sin almacenamiento')
    },
  }
  const { ajustes, cambiarAjustes, POR_DEFECTO } = cargar(roto)

  expect(ajustes()).toEqual(POR_DEFECTO)
  expect(() => cambiarAjustes({ unidad: 'lb' })).not.toThrow()
  expect(ajustes().unidad).toBe('lb')
})

test('el_tema_del_sistema_sigue_al_del_dispositivo', () => {
  const { temaVisible, POR_DEFECTO, reactNative } = cargar(almacen())
  const original = reactNative.Appearance.getColorScheme

  try {
    reactNative.Appearance.getColorScheme = () => 'light'
    expect(temaVisible({ ...POR_DEFECTO, tema: 'sistema' })).toBe('claro')
    reactNative.Appearance.getColorScheme = () => 'dark'
    expect(temaVisible({ ...POR_DEFECTO, tema: 'sistema' })).toBe('oscuro')
    // Elegido a mano, manda lo elegido.
    expect(temaVisible({ ...POR_DEFECTO, tema: 'claro' })).toBe('claro')
  } finally {
    reactNative.Appearance.getColorScheme = original
  }
})
