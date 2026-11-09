/**
 * Las fechas en los mensajes, como las escribe el backend. Copia de `backend/app/fechas.py`.
 *
 * El backend saca «hoy» de un reloj global; aquí se pasa: lo pone el contexto, que en el
 * teléfono es su reloj y en los tests uno que se puede fijar.
 */
import { anioDe, diaDeLaSemana, partes } from './dias'

export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** «lunes» para el 1 y «domingo» para el 7, como `dia_semana` en la API. */
export function nombreDelDia(diaSemana: number): string {
  return DIAS[diaSemana - 1]
}

/**
 * Una fecha para leerla en un mensaje: «martes 27 de octubre», y con el año si no es el
 * de `hoy` («jueves 1 de octubre de 2025»).
 */
export function fechaEnTexto(fecha: string, hoy: string): string {
  const p = partes(fecha)
  if (!p) throw new Error(`No es una fecha: ${fecha}`)
  const texto = `${DIAS[diaDeLaSemana(fecha) - 1]} ${p.dia} de ${MESES[p.mes - 1]}`
  return p.anio === anioDe(hoy) ? texto : `${texto} de ${p.anio}`
}
