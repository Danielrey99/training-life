import type { DiaSeguimiento, Programa } from '../../api/tipos'
import { MarcaDelDia } from '../../componentes/MarcaDelDia'
import { diaDeLaSemana } from '../../utiles/fechas'

const INICIALES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

type Props = {
  // El día 1 del mes, en ISO.
  mes: string
  // Los días del mes, o `null` mientras se cargan (sale la cuadrícula vacía).
  dias: DiaSeguimiento[] | null
  hoy: string
  programa: Programa | null
  // La fecha marcada como elegida (en la hoja de cambiar la fecha de una sesión).
  elegida?: string
  alTocar: (dia: DiaSeguimiento) => void
}

/**
 * Un mes con las marcas de cada día: la cuadrícula del calendario del historial. La
 * usan el calendario y la hoja de cambiar la fecha de una sesión, para que se vean
 * igual: los días futuros, apagados y sin poder tocarlos (salvo que tengan sesión).
 */
export function MesConMarcas({ mes, dias, hoy, programa, elegida, alTocar }: Props) {
  // Huecos antes del día 1, para que cada columna sea un día de la semana.
  const vacios = diaDeLaSemana(mes) - 1
  return (
    <div className="calendario">
      {INICIALES.map((inicial) => (
        <span key={inicial} className="calendario-cabecera">
          {inicial}
        </span>
      ))}
      {Array.from({ length: vacios }, (_, indice) => (
        <span key={`vacio-${indice}`} />
      ))}
      {dias?.map((dia) => {
        const clases = ['calendario-dia']
        if (dia.fecha === hoy) clases.push('es-hoy')
        else if (dia.fecha > hoy) clases.push('futuro')
        if (dia.fecha === elegida) clases.push('elegida')
        const tocable = Boolean(dia.sesion) || dia.fecha <= hoy
        return (
          <button
            key={dia.fecha}
            type="button"
            className={clases.join(' ')}
            onClick={() => alTocar(dia)}
            disabled={!tocable}
            aria-pressed={elegida === undefined ? undefined : dia.fecha === elegida}
          >
            <span className="num">{Number(dia.fecha.slice(8))}</span>
            <MarcaDelDia dia={dia} diasDelPrograma={programa?.dias} />
          </button>
        )
      })}
    </div>
  )
}
