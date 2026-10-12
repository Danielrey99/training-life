import type { SesionHistorial } from '../api/tipos'
import { unoRM } from './numeros'

/**
 * Lo que vale una sesión en cada medida: el peso más alto, el volumen total o el 1RM
 * medio (el mismo de las insignias de H2, para que un día dé igual en las dos
 * pantallas). Lo usan la gráfica de H3 y la ficha del ejercicio, que tienen que dar
 * el mismo peso para la misma sesión.
 */
export function valorDe(sesion: SesionHistorial, medida: 'peso' | 'volumen' | 'rm'): number {
  const { series } = sesion
  if (medida === 'peso') return Math.max(...series.map((serie) => Number(serie.peso)))
  if (medida === 'volumen') {
    return series.reduce((total, serie) => total + Number(serie.peso) * serie.repeticiones, 0)
  }
  return unoRM(series)
}
