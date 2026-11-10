/**
 * El historial de progresión de un ejercicio: las últimas sesiones en que se hizo, con sus
 * series agrupadas por día. Puerto de `backend/app/historial.py`.
 */
import type { Contexto } from '../contexto'
import type { SesionHistorial } from '../tipos'
import type { Condicion } from './comun'
import { agrupar, marcas, serieHistorial, type FilaSerie } from './salidas'

export const SESIONES_POR_DEFECTO = 50

/**
 * Las últimas sesiones con series que cumplan `filtro` (una condición sobre `series`), de
 * la más reciente a la más antigua y con esas series dentro.
 *
 * El límite cuenta sesiones, no series: cortar por series partiría un día por la mitad.
 */
export function sesionesConSeries(
  ctx: Contexto,
  filtro: Condicion,
  hasta: string | null = null,
  limite: number = SESIONES_POR_DEFECTO,
): SesionHistorial[] {
  const hastaSql = hasta === null ? '' : ' AND entrenamientos.fecha <= ?'
  const filas = ctx.bd.todas<{ id: number; fecha: string; rutina: string }>(
    'SELECT DISTINCT entrenamientos.id, entrenamientos.fecha, rutinas.nombre AS rutina' +
      ' FROM entrenamientos' +
      ' JOIN series ON series.entrenamiento_id = entrenamientos.id' +
      ' JOIN rutinas ON rutinas.id = entrenamientos.rutina_id' +
      ` WHERE (${filtro.sql})${hastaSql}` +
      ' ORDER BY entrenamientos.fecha DESC, entrenamientos.id DESC LIMIT ?',
    ...filtro.params,
    ...(hasta === null ? [] : [hasta]),
    limite,
  )
  if (filas.length === 0) return []

  const ids = filas.map((f) => f.id)
  // El id desempata: si un ejercicio ocupa dos huecos de la misma rutina, el mismo día
  // trae dos series con el mismo numero_serie.
  const series = ctx.bd.todas<FilaSerie>(
    `SELECT * FROM series WHERE entrenamiento_id IN ${marcas(ids)} AND (${filtro.sql})` +
      ' ORDER BY numero_serie, id',
    ...ids,
    ...filtro.params,
  )
  const porSesion = agrupar(series, (s) => s.entrenamiento_id)
  return filas.map((f) => ({
    entrenamiento_id: f.id,
    fecha: f.fecha,
    rutina: f.rutina,
    series: (porSesion.get(f.id) ?? []).map(serieHistorial),
  }))
}
