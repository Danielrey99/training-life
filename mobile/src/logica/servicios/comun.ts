/**
 * Lo que comparten los servicios: las condiciones de SQL que se pasan de uno a otro (lo
 * que en el backend son expresiones de SQLAlchemy) y `exigirVisible`, de `app/ocultos.py`.
 */
import type { Valor } from '../bd/bd'
import { conflicto } from '../fallos'

/**
 * Un trozo de WHERE con sus parámetros, para pasarlo a otra consulta: «las series de este
 * hueco», «las de este ejercicio». Va entre paréntesis al usarlo, y los parámetros, en el
 * orden de sus `?`.
 */
export interface Condicion {
  sql: string
  params: Valor[]
}

/** La negación de una condición. Las columnas que se miran no son nulas: NOT basta. */
export function no(c: Condicion): Condicion {
  return { sql: `NOT (${c.sql})`, params: c.params }
}

/** Las dos condiciones a la vez. */
export function y(a: Condicion, b: Condicion): Condicion {
  return { sql: `(${a.sql}) AND (${b.sql})`, params: [...a.params, ...b.params] }
}

/**
 * Qué se puede hacer con algo oculto (`app/ocultos.py`): leerlo, borrarlo o mostrarlo, sí;
 * editarlo, no, y eso es un 409. Elegirlo en otro sitio es un 404, y lo decide el
 * `obtener…Visible` de cada servicio.
 */
export function exigirVisible(fila: { oculto_desde: string | null }, mensaje: string): void {
  if (fila.oculto_desde !== null) throw conflicto(mensaje)
}
