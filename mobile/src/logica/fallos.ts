/**
 * Lo que en el backend es una respuesta de error (404, 403, 409, 422) con su `detail`.
 *
 * La lógica lanza `FalloDeLaApp` con el mismo número y el mismo detalle que el endpoint
 * del backend, así las pantallas, copiadas de la web, lo tratan igual que tratan un error
 * de la API. Cualquier otro `Error` es un fallo de programación (lo que en el backend
 * sería un 500).
 */

/** Un error de validación con la forma de FastAPI: `loc` dice dónde y `msg` qué. */
export interface ErrorDeValidacion {
  type: string
  loc: (string | number)[]
  msg: string
}

export type DetalleDelFallo = string | Record<string, unknown> | ErrorDeValidacion[]

export class FalloDeLaApp extends Error {
  constructor(
    readonly estado: 403 | 404 | 409 | 422,
    readonly detalle: DetalleDelFallo,
  ) {
    super(typeof detalle === 'string' ? detalle : `Fallo ${estado}`)
    this.name = 'FalloDeLaApp'
  }
}

export function noEncontrado(detalle: DetalleDelFallo): FalloDeLaApp {
  return new FalloDeLaApp(404, detalle)
}

export function prohibido(detalle: DetalleDelFallo): FalloDeLaApp {
  return new FalloDeLaApp(403, detalle)
}

export function conflicto(detalle: DetalleDelFallo): FalloDeLaApp {
  return new FalloDeLaApp(409, detalle)
}

export function noValido(detalle: DetalleDelFallo): FalloDeLaApp {
  return new FalloDeLaApp(422, detalle)
}
