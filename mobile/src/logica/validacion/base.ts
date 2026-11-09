/**
 * Las piezas para validar lo que entra en la api, como lo valida Pydantic en el backend
 * (`schemas.py`): mismos tipos aceptados, mismos topes y un 422 con la forma de FastAPI,
 * `[{ type, loc, msg }]`, con los textos de Pydantic. Los tests comparan `loc` y `msg`.
 *
 * Se acepta lo que exporta la web y lo que aceptaría Pydantic en modo laxo con JSON: un
 * entero puede llegar como `5`, `5.0` o `"5"`, pero `true` nunca cuenta como número.
 *
 * Cada esquema de entrada se escribe a mano con estas piezas en `validacion/*.ts`: lee un
 * objeto, va apuntando los errores en un `Validador` y, al final, `terminar()` lanza el 422
 * con todos si hubo alguno.
 */
import { noValido, type ErrorDeValidacion } from '../fallos'
import { comparar, valorExacto } from '../reglas/centesimas'
import { esFecha } from '../reglas/dias'
import { longitud, recortar, recortarComoPydantic } from '../reglas/textos'

export type Loc = (string | number)[]

export class Validador {
  readonly errores: ErrorDeValidacion[] = []

  error(type: string, loc: Loc, msg: string): undefined {
    this.errores.push({ type, loc, msg })
    return undefined
  }

  /** Un `model_validator` o un `field_validator` que lanza `ValueError`. */
  errorDeValor(loc: Loc, mensaje: string): undefined {
    return this.error('value_error', loc, `Value error, ${mensaje}`)
  }

  /** Lanza el 422 si se apuntó algún error. */
  terminar(): void {
    if (this.errores.length > 0) throw noValido(this.errores)
  }
}

const AUSENTE = Symbol('ausente')

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** El cuerpo tiene que ser un objeto JSON; si no, el error de Pydantic y `null`. */
export function objeto(v: Validador, valor: unknown, loc: Loc): Record<string, unknown> | null {
  if (esObjeto(valor)) return valor
  v.error(
    'model_attributes_type',
    loc,
    'Input should be a valid dictionary or object to extract fields from',
  )
  return null
}

function leer(datos: Record<string, unknown>, campo: string): unknown {
  return Object.prototype.hasOwnProperty.call(datos, campo) ? datos[campo] : AUSENTE
}

interface Opciones<T> {
  /** Si falta el campo, este valor; sin él, el campo es obligatorio. */
  porDefecto?: T
  /** Si admite `null`. */
  nulo?: boolean
}

/**
 * Lee un campo con `convertir` y apunta los errores. Devuelve el valor, o `undefined` si
 * hubo error (el que llama sigue para recoger todos los errores, como Pydantic).
 */
function campo<T>(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  opciones: Opciones<T>,
  convertir: (valor: unknown, loc: Loc) => T | undefined,
): T | null | undefined {
  const valor = leer(datos, nombre)
  const aqui = [...loc, nombre]
  if (valor === AUSENTE) {
    if ('porDefecto' in opciones) return opciones.porDefecto
    return v.error('missing', aqui, 'Field required')
  }
  if (valor === null && opciones.nulo) return null
  return convertir(valor, aqui)
}

// --- Enteros --------------------------------------------------------------------------

export interface Topes {
  gt?: number
  ge?: number
  lt?: number
  le?: number
}

function aplicarTopes(v: Validador, n: number | string, loc: Loc, topes: Topes): boolean {
  const c = (tope: number) => comparar(n, tope)
  if (topes.gt !== undefined && c(topes.gt) <= 0) {
    v.error('greater_than', loc, `Input should be greater than ${topes.gt}`)
    return false
  }
  if (topes.ge !== undefined && c(topes.ge) < 0) {
    v.error('greater_than_equal', loc, `Input should be greater than or equal to ${topes.ge}`)
    return false
  }
  if (topes.lt !== undefined && c(topes.lt) >= 0) {
    v.error('less_than', loc, `Input should be less than ${topes.lt}`)
    return false
  }
  if (topes.le !== undefined && c(topes.le) > 0) {
    v.error('less_than_equal', loc, `Input should be less than or equal to ${topes.le}`)
    return false
  }
  return true
}

/** Un entero como lo lee Pydantic de un JSON: `5`, `5.0` y `"5"` valen; `true` y `5.5`, no. */
export function aEntero(
  v: Validador,
  valor: unknown,
  loc: Loc,
  topes: Topes = {},
): number | undefined {
  let n: number
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor))
      return v.error('finite_number', loc, 'Input should be a finite number')
    if (!Number.isInteger(valor)) {
      return v.error(
        'int_from_float',
        loc,
        'Input should be a valid integer, got a number with a fractional part',
      )
    }
    n = valor
  } else if (typeof valor === 'string') {
    const texto = recortar(valor)
    // Pydantic también lee «5.0» como 5: decimales, solo si son ceros.
    if (!/^[+-]?\d+(\.0*)?$/.test(texto)) {
      return v.error(
        'int_parsing',
        loc,
        'Input should be a valid integer, unable to parse string as an integer',
      )
    }
    n = Number(texto)
  } else {
    return v.error('int_type', loc, 'Input should be a valid integer')
  }
  return aplicarTopes(v, n, loc, topes) ? n : undefined
}

export function entero(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  topes: Topes = {},
  opciones: Opciones<number | null> = {},
): number | null | undefined {
  return campo(v, datos, nombre, loc, opciones, (valor, aqui) => aEntero(v, valor, aqui, topes))
}

// --- Decimales (los pesos) ---------------------------------------------------------------

/**
 * Un `Decimal` como lo lee Pydantic de un JSON: número o texto, sin redondear. Se devuelve
 * tal cual llegó (número o texto) para que `aCentesimas` lo redondee al guardarlo.
 */
export function aDecimal(
  v: Validador,
  valor: unknown,
  loc: Loc,
  topes: Topes = {},
): number | string | undefined {
  if (typeof valor === 'boolean' || (typeof valor !== 'number' && typeof valor !== 'string')) {
    return v.error(
      'decimal_type',
      loc,
      'Decimal input should be an integer, float, string or Decimal object',
    )
  }
  if (typeof valor === 'number' && !Number.isFinite(valor)) {
    return v.error('finite_number', loc, 'Input should be a finite number')
  }
  const texto = typeof valor === 'string' ? recortar(valor) : valor
  if (valorExacto(texto) === null)
    return v.error('decimal_parsing', loc, 'Input should be a valid decimal')
  return aplicarTopes(v, texto, loc, topes) ? texto : undefined
}

export function decimal(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  topes: Topes = {},
  opciones: Opciones<number | string | null> = {},
): number | string | null | undefined {
  return campo(v, datos, nombre, loc, opciones, (valor, aqui) => aDecimal(v, valor, aqui, topes))
}

// --- Textos ------------------------------------------------------------------------------

function aTexto(v: Validador, valor: unknown, loc: Loc): string | undefined {
  if (typeof valor !== 'string')
    return v.error('string_type', loc, 'Input should be a valid string')
  return valor
}

function aplicarLongitud(v: Validador, texto: string, loc: Loc, min: number, max: number): boolean {
  const n = longitud(texto)
  if (n < min) {
    v.error(
      'string_too_short',
      loc,
      `String should have at least ${min} character${min === 1 ? '' : 's'}`,
    )
    return false
  }
  if (n > max) {
    v.error(
      'string_too_long',
      loc,
      `String should have at most ${max} character${max === 1 ? '' : 's'}`,
    )
    return false
  }
  return true
}

/** `Nombre` y `TextoNota`: recortado, y que diga algo (entre 1 y `max` caracteres). */
export function textoObligatorio(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  max: number,
): string | null | undefined {
  return campo(v, datos, nombre, loc, {}, (valor, aqui) => {
    const texto = aTexto(v, valor, aqui)
    if (texto === undefined) return undefined
    // `strip_whitespace` de Pydantic, que no recorta lo mismo que `str.strip()`.
    const recortado = recortarComoPydantic(texto)
    return aplicarLongitud(v, recortado, aqui, 1, max) ? recortado : undefined
  })
}

/** `TextoOpcional`: recortado y, si no queda nada, `null`. Si falta, `null`. */
export function textoOpcional(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  max: number,
): string | null | undefined {
  return campo(v, datos, nombre, loc, { porDefecto: null, nulo: true }, (valor, aqui) => {
    const texto = aTexto(v, valor, aqui)
    if (texto === undefined) return undefined
    const recortado = recortar(texto)
    if (recortado === '') return null
    return aplicarLongitud(v, recortado, aqui, 0, max) ? recortado : undefined
  })
}

/** Un texto de una lista cerrada (`Literal[...]`). */
export function literal<T extends string>(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  valores: readonly T[],
  opciones: Opciones<T> = {},
): T | null | undefined {
  return campo(v, datos, nombre, loc, opciones, (valor, aqui) => {
    if (typeof valor === 'string' && (valores as readonly string[]).includes(valor))
      return valor as T
    const lista = valores.map((x) => `'${x}'`)
    const texto =
      lista.length <= 1
        ? lista.join('')
        : `${lista.slice(0, -1).join(', ')} or ${lista[lista.length - 1]}`
    return v.error('literal_error', aqui, `Input should be ${texto}`)
  })
}

// --- Booleanos ---------------------------------------------------------------------------

/** Un `bool` como lo lee Pydantic de un JSON: `true`, `false`, 0, 1 y sus textos. */
export function aBooleano(v: Validador, valor: unknown, loc: Loc): boolean | undefined {
  if (typeof valor === 'boolean') return valor
  if (valor === 0 || valor === 1) return valor === 1
  if (typeof valor === 'string') {
    const t = valor.toLowerCase()
    if (['true', '1', 'yes', 'on', 't', 'y'].includes(t)) return true
    if (['false', '0', 'no', 'off', 'f', 'n'].includes(t)) return false
    return v.error(
      'bool_parsing',
      loc,
      'Input should be a valid boolean, unable to interpret input',
    )
  }
  return v.error('bool_type', loc, 'Input should be a valid boolean')
}

export function booleano(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  opciones: Opciones<boolean> = {},
): boolean | null | undefined {
  return campo(v, datos, nombre, loc, opciones, (valor, aqui) => aBooleano(v, valor, aqui))
}

// --- Fechas ------------------------------------------------------------------------------

/** Una `date`: 'YYYY-MM-DD' de un día que exista. */
export function aFecha(v: Validador, valor: unknown, loc: Loc): string | undefined {
  if (typeof valor !== 'string') return v.error('date_type', loc, 'Input should be a valid date')
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor) && !esFecha(valor)) {
    return v.error(
      'date_from_datetime_parsing',
      loc,
      'Input should be a valid date or datetime, day value is outside expected range',
    )
  }
  if (!esFecha(valor)) {
    return v.error(
      'date_from_datetime_parsing',
      loc,
      'Input should be a valid date or datetime, invalid character in year',
    )
  }
  return valor
}

export function fecha(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  opciones: Opciones<string | null> = {},
): string | null | undefined {
  return campo(v, datos, nombre, loc, opciones, (valor, aqui) => aFecha(v, valor, aqui))
}

const INSTANTE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/

/** Un `AwareDatetime`: un instante ISO que diga su zona. Se guarda tal cual llega. */
export function aInstanteConZona(v: Validador, valor: unknown, loc: Loc): string | undefined {
  if (typeof valor !== 'string')
    return v.error('datetime_type', loc, 'Input should be a valid datetime')
  const m = INSTANTE.exec(valor)
  if (!m || !esFecha(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59) {
    return v.error(
      'datetime_from_date_parsing',
      loc,
      'Input should be a valid datetime or date, invalid character in year',
    )
  }
  if (!m[5]) return v.error('timezone_aware', loc, 'Input should have timezone info')
  return valor
}

export function instanteConZona(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  opciones: Opciones<string | null> = {},
): string | null | undefined {
  return campo(v, datos, nombre, loc, opciones, (valor, aqui) => aInstanteConZona(v, valor, aqui))
}

// --- Listas ------------------------------------------------------------------------------

/** Una lista, con un tope de elementos si se da. Cada elemento lo lee quien llama. */
export function lista(
  v: Validador,
  datos: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  max?: number,
  opciones: Opciones<unknown[] | null> = {},
): unknown[] | null | undefined {
  return campo(v, datos, nombre, loc, opciones, (valor, aqui) => {
    if (!Array.isArray(valor)) return v.error('list_type', aqui, 'Input should be a valid list')
    if (max !== undefined && valor.length > max) {
      return v.error(
        'too_long',
        aqui,
        `List should have at most ${max} item${max === 1 ? '' : 's'} after validation, not ${valor.length}`,
      )
    }
    return valor
  })
}
