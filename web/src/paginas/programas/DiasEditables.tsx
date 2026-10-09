import type { DiaSemana, ProgramaDia } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { colorDeRutina } from '../../utiles/colores'
import { DIAS, type DiasDelBorrador } from './borradores'
import './programas.css'
import './semana.css'
import { NOMBRES_DE_LOS_DIAS, nombreDelDiaSemana } from './textos'

type Props = {
  dias: DiasDelBorrador
  // Los días del programa activo, para el color de cada rutina.
  diasDelActivo: ProgramaDia[] | undefined
  alAbrir: (dia: DiaSemana) => void
  alQuitar: (dia: DiaSemana) => void
  desactivado?: boolean
}

/**
 * Los siete días de un programa que se está escribiendo: en P2 con *Editar* y en P5.
 * Un día con rutina lleva ✕ (descanso) y › (cambiarla); uno de descanso, *Añadir
 * rutina*. Nada se guarda aquí: cada toque cambia el borrador de quien la usa.
 */
export function DiasEditables({ dias, diasDelActivo, alAbrir, alQuitar, desactivado }: Props) {
  return (
    <div className="semana-dias">
      {DIAS.map((dia) => {
        const rutina = dias[dia]
        const nombreDelDia = <span className="semana-dia-nombre">{nombreDelDiaSemana(dia)}</span>
        if (!rutina) {
          return (
            <button
              key={dia}
              type="button"
              className="semana-dia"
              onClick={() => alAbrir(dia)}
              disabled={desactivado}
            >
              {nombreDelDia}
              <span className="semana-dia-rutina vacia">Añadir rutina</span>
              <Icono nombre="mas" pequeno />
            </button>
          )
        }
        const oculta = rutina.oculto_desde !== null
        const color = oculta ? undefined : colorDeRutina(diasDelActivo, rutina.id)
        return (
          <div key={dia} className="semana-dia">
            {nombreDelDia}
            <span className="semana-dia-rutina">
              <span className="programas-punto" style={color ? { background: color } : undefined} />
              <strong className={oculta ? 'oculta' : undefined}>{rutina.nombre}</strong>
              {oculta && <span className="etiqueta-chica">oculta</span>}
            </span>
            <button
              type="button"
              className="boton-icono"
              aria-label={`Dejar el ${NOMBRES_DE_LOS_DIAS[dia - 1]} en descanso`}
              onClick={() => alQuitar(dia)}
              disabled={desactivado}
            >
              <Icono nombre="quitar" pequeno />
            </button>
            <button
              type="button"
              className="boton-icono"
              aria-label={`Cambiar la rutina del ${NOMBRES_DE_LOS_DIAS[dia - 1]}`}
              onClick={() => alAbrir(dia)}
              disabled={desactivado}
            >
              <Icono nombre="abrir" pequeno />
            </button>
          </div>
        )
      })}
    </div>
  )
}
