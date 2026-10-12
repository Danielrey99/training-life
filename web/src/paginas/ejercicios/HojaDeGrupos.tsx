import { useEffect } from 'react'

import type { GrupoMuscular } from '../../api/tipos'
import { TODOS_LOS_GRUPOS } from '../programas/DesplegableDeGrupo'
import '../historial/historial.css'
import './ejercicios.css'

type Props = {
  // Los que tienen algo que enseñar con el origen elegido, por orden alfabético.
  grupos: GrupoMuscular[]
  elegido: number | null
  alElegir: (grupo: number | null) => void
  alCerrar: () => void
}

/**
 * La hoja del filtro por grupo muscular de la biblioteca: *Todos los grupos musculares* y debajo
 * los grupos en dos columnas. Son 17: en una fila de píldoras no se veían, y envueltas
 * ocupaban media pantalla encima de la lista. Elegir uno filtra y cierra la hoja.
 */
export function HojaDeGrupos({ grupos, elegido, alElegir, alCerrar }: Props) {
  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [alCerrar])

  function boton(id: number | null, nombre: string) {
    return (
      <button
        key={id ?? 'todos'}
        type="button"
        className={elegido === id ? 'grupos-opcion elegida' : 'grupos-opcion'}
        aria-pressed={elegido === id}
        onClick={() => alElegir(id)}
      >
        {nombre}
      </button>
    )
  }

  return (
    <div className="hoja-fondo" onClick={alCerrar}>
      <div
        className="hoja"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoja-titulo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <span className="hoja-asa" />
        <h2 id="hoja-titulo">Grupo muscular</h2>
        <p className="hoja-subtitulo">Solo se verán los ejercicios de ese grupo.</p>
        <div className="grupos-rejilla">
          <div className="grupos-todos">{boton(null, TODOS_LOS_GRUPOS)}</div>
          {grupos.map((uno) => boton(uno.id, uno.nombre))}
        </div>
      </div>
    </div>
  )
}
