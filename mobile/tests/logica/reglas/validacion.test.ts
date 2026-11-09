/**
 * Las piezas de validación (`validacion/base.ts`), que imitan a Pydantic v2 en modo JSON.
 * Propios del móvil: los `type` y los `msg` esperados se han comprobado con el Pydantic del
 * backend (`model_validate_json`).
 */
import {
  aEntero,
  aFecha,
  aInstanteConZona,
  entero,
  textoObligatorio,
  textoOpcional,
  Validador,
} from '../../../src/logica/validacion/base'
import { FalloDeLaApp } from '../../../src/logica/fallos'

const NO_ENTERO_EN_TEXTO = 'Input should be a valid integer, unable to parse string as an integer'

function entra(valor: unknown, topes = {}) {
  const v = new Validador()
  const n = aEntero(v, valor, ['body', 'n'], topes)
  return { n, errores: v.errores }
}

// --- Enteros ---------------------------------------------------------------------

test.each<[unknown, number]>([
  [5, 5],
  [5.0, 5],
  ['5', 5],
  [' 5 ', 5],
  ['+5', 5],
])('un_entero_vale_como_numero_o_como_texto (%j)', (valor, n) => {
  expect(entra(valor)).toEqual({ n, errores: [] })
})

test.each<[unknown, string, string]>([
  [5.5, 'int_from_float', 'Input should be a valid integer, got a number with a fractional part'],
  ['5.5', 'int_parsing', NO_ENTERO_EN_TEXTO],
  ['x', 'int_parsing', NO_ENTERO_EN_TEXTO],
  ['٥', 'int_parsing', NO_ENTERO_EN_TEXTO],
])('lo_que_no_es_un_entero_da_el_error_de_pydantic (%j)', (valor, type, msg) => {
  expect(entra(valor)).toEqual({ n: undefined, errores: [{ type, loc: ['body', 'n'], msg }] })
})

test('true_no_cuenta_como_entero', () => {
  // Decisión del móvil (trampa 22 del plan): Pydantic en modo JSON lee `true` como 1, pero
  // aquí nunca cuenta como número.
  expect(entra(true)).toEqual({
    n: undefined,
    errores: [{ type: 'int_type', loc: ['body', 'n'], msg: 'Input should be a valid integer' }],
  })
})

// Regresión: Pydantic acepta "5.0" (texto) como el entero 5, igual que acepta 5.0 (número),
// y aEntero lo rechazaba con int_parsing.
test('un_entero_en_texto_con_decimales_a_cero_vale_como_en_pydantic', () => {
  expect(entra('5.0')).toEqual({ n: 5, errores: [] })
})

test('los_topes_dan_los_mensajes_de_pydantic', () => {
  const topes = { gt: 0, le: 50 }

  expect(entra(0, topes).errores).toEqual([
    { type: 'greater_than', loc: ['body', 'n'], msg: 'Input should be greater than 0' },
  ])
  expect(entra(51, topes).errores).toEqual([
    {
      type: 'less_than_equal',
      loc: ['body', 'n'],
      msg: 'Input should be less than or equal to 50',
    },
  ])
  expect(entra(1, topes)).toEqual({ n: 1, errores: [] })
  expect(entra(50, topes)).toEqual({ n: 50, errores: [] })
})

test('un_campo_obligatorio_que_falta_da_field_required_con_su_nombre_al_final', () => {
  const v = new Validador()

  expect(entero(v, {}, 'repeticiones', ['body', 'series', 0])).toBeUndefined()
  expect(v.errores).toEqual([
    { type: 'missing', loc: ['body', 'series', 0, 'repeticiones'], msg: 'Field required' },
  ])
})

test('terminar_lanza_un_422_con_todos_los_errores', () => {
  const v = new Validador()
  entero(v, {}, 'a', ['body'])
  entero(v, { b: 'x' }, 'b', ['body'])

  let fallo: unknown
  try {
    v.terminar()
  } catch (e) {
    fallo = e
  }
  expect(fallo).toBeInstanceOf(FalloDeLaApp)
  expect((fallo as FalloDeLaApp).estado).toBe(422)
  expect((fallo as FalloDeLaApp).detalle).toHaveLength(2)
})

test('terminar_sin_errores_no_lanza', () => {
  expect(() => new Validador().terminar()).not.toThrow()
})

// --- Textos ----------------------------------------------------------------------

test('un_texto_obligatorio_se_recorta', () => {
  const v = new Validador()

  expect(textoObligatorio(v, { nombre: '  Press banca  ' }, 'nombre', ['body'], 100)).toBe(
    'Press banca',
  )
  expect(v.errores).toEqual([])
})

test('un_texto_obligatorio_de_solo_espacios_es_demasiado_corto', () => {
  const v = new Validador()

  expect(textoObligatorio(v, { nombre: '   ' }, 'nombre', ['body'], 100)).toBeUndefined()
  expect(v.errores).toEqual([
    {
      type: 'string_too_short',
      loc: ['body', 'nombre'],
      msg: 'String should have at least 1 character',
    },
  ])
})

test('el_tope_de_un_texto_cuenta_los_emojis_como_python', () => {
  const v = new Validador()

  expect(textoObligatorio(v, { nombre: '💪'.repeat(100) }, 'nombre', ['body'], 100)).toBe(
    '💪'.repeat(100),
  )
  expect(v.errores).toEqual([])
  expect(textoObligatorio(v, { nombre: '💪'.repeat(101) }, 'nombre', ['body'], 100)).toBe(undefined)
  expect(v.errores).toEqual([
    {
      type: 'string_too_long',
      loc: ['body', 'nombre'],
      msg: 'String should have at most 100 characters',
    },
  ])
})

// Regresión: `Nombre` recorta con `strip_whitespace` de Pydantic (el `trim` de Rust), que NO
// quita \x1c-\x1f, y textoObligatorio recortaba con `str.strip()` de Python, que sí: con
// Pydantic, "\x1c" es un nombre de un carácter, y aquí salía string_too_short.
test('un_texto_obligatorio_recorta_como_strip_whitespace_de_pydantic', () => {
  const v = new Validador()

  expect(textoObligatorio(v, { nombre: '\x1c' }, 'nombre', ['body'], 100)).toBe('\x1c')
  expect(v.errores).toEqual([])
})

test.each<[Record<string, unknown>]>([[{ variante: '  ' }], [{}], [{ variante: null }]])(
  'un_texto_opcional_vacio_o_ausente_es_null (%j)',
  (datos) => {
    const v = new Validador()

    expect(textoOpcional(v, datos, 'variante', ['body'], 100)).toBeNull()
    expect(v.errores).toEqual([])
  },
)

test('un_texto_opcional_se_recorta', () => {
  const v = new Validador()

  expect(textoOpcional(v, { variante: ' Agarre cerrado ' }, 'variante', ['body'], 100)).toBe(
    'Agarre cerrado',
  )
})

// --- Fechas e instantes ----------------------------------------------------------

test.each(['2026-02-30', '2026-02-29'])('un_dia_que_no_existe_no_es_una_fecha (%s)', (fecha) => {
  const v = new Validador()

  expect(aFecha(v, fecha, ['body', 'fecha'])).toBeUndefined()
  expect(v.errores).toEqual([
    {
      type: 'date_from_datetime_parsing',
      loc: ['body', 'fecha'],
      msg: 'Input should be a valid date or datetime, day value is outside expected range',
    },
  ])
})

test('un_29_de_febrero_bisiesto_es_una_fecha', () => {
  const v = new Validador()

  expect(aFecha(v, '2024-02-29', ['body', 'fecha'])).toBe('2024-02-29')
  expect(v.errores).toEqual([])
})

test('un_instante_sin_zona_da_timezone_aware', () => {
  const v = new Validador()

  expect(aInstanteConZona(v, '2026-11-09T10:00:00', ['body', 'i'])).toBeUndefined()
  expect(v.errores).toEqual([
    { type: 'timezone_aware', loc: ['body', 'i'], msg: 'Input should have timezone info' },
  ])
})

test.each(['2026-11-09T10:00:00Z', '2026-11-09T10:00:00.123+01:00'])(
  'un_instante_con_zona_se_guarda_tal_cual (%s)',
  (instante) => {
    const v = new Validador()

    expect(aInstanteConZona(v, instante, ['body', 'i'])).toBe(instante)
    expect(v.errores).toEqual([])
  },
)
