import { useEffect } from 'react'

import { Icono } from '../../componentes/Icono'
import { eleccionDelDia, PALETA, POR_DIA, resolverColor } from '../../utiles/colores'
import { NOMBRES_DE_LOS_DIAS } from '../programas/textos'
import '../historial/historial.css'

type Props = {
  diaSemana: number
  // Un id de la paleta o un color libre; `null` vuelve al de la app.
  alElegir: (eleccion: string | null) => void
  alCerrar: () => void
}

/**
 * La hoja del color de un día: los 24 de la paleta y, al final, *Otro color…* con el
 * selector del sistema. Un color de la paleta que ya tiene otro día no se puede elegir,
 * para que no haya dos días iguales; uno libre es cosa de quien lo elige.
 */
export function HojaDeColor({ diaSemana, alElegir, alCerrar }: Props) {
  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [alCerrar])

  const elegido = eleccionDelDia(diaSemana)
  // De quién es cada color de la paleta, para apagarlo y decirlo.
  const duenos = new Map<string, number>()
  for (let dia = 1; dia <= 7; dia++) {
    if (dia !== diaSemana) duenos.set(eleccionDelDia(dia), dia)
  }
  const nombre = NOMBRES_DE_LOS_DIAS[diaSemana - 1]
  const libre = elegido.startsWith('#')

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
        <h2 id="hoja-titulo">Color del {nombre}</h2>
        <p className="hoja-subtitulo">
          Lo verás en el calendario y en las rutinas que tocan ese día.
        </p>
        <div className="color-rejilla">
          {PALETA.map((opcion) => {
            const dueno = duenos.get(opcion.id)
            const esEste = opcion.id === elegido
            return (
              <button
                key={opcion.id}
                type="button"
                className={esEste ? 'color-opcion elegida' : 'color-opcion'}
                disabled={dueno !== undefined}
                aria-pressed={esEste}
                onClick={() => alElegir(opcion.id)}
              >
                <span className="color-muestra" style={{ background: resolverColor(opcion.id) }}>
                  {esEste && <Icono nombre="hecho" pequeno />}
                </span>
                <span className="color-nombre">{opcion.nombre}</span>
                {dueno !== undefined && (
                  <span className="color-dueno">{NOMBRES_DE_LOS_DIAS[dueno - 1]}</span>
                )}
              </button>
            )
          })}
        </div>
        {/* Un `label` que envuelve el selector: pulsarlo en cualquier sitio lo abre. */}
        <label className={libre ? 'color-otro elegido' : 'color-otro'}>
          <span
            className="color-muestra"
            style={libre ? { background: elegido } : { background: 'none' }}
          />
          Otro color…
          <input
            type="color"
            // El selector del sistema solo acepta hexadecimal, y `resolverColor` siempre lo da.
            value={resolverColor(elegido)}
            onChange={(evento) => alElegir(evento.target.value)}
          />
        </label>
        {elegido !== POR_DIA[diaSemana] && (
          <button
            type="button"
            className="boton boton-texto color-volver"
            onClick={() => alElegir(null)}
          >
            Usar el de la app
          </button>
        )}
      </div>
    </div>
  )
}
