import { useEffect, useRef, useState } from 'react'

import type { Ejercicio } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { fechaCorta } from '../../utiles/fechas'
import { pesoLegible } from '../../utiles/numeros'
import { useUltimaVez } from './ultimaVez'

type Props = {
  rutinaId: number
  huecoId: number
  principal: Ejercicio
  comodines: Ejercicio[]
  elegido: Ejercicio
  sesion: { id: number; fecha: string }
  elegir: (ejercicio: Ejercicio) => void
}

/**
 * La flecha que cambia el ejercicio de un hueco por uno de sus comodines.
 *
 * Solo la flecha abre el desplegable; el nombre no hace nada. La flecha va en su
 * propio botón, con recuadro y en verde, porque suelta y gris pasaba por alto.
 * El desplegable cuelga de la cabecera del hueco (la fila que contiene este
 * componente tiene que ser `position: relative`).
 */
export function SelectorDeEjercicio({
  rutinaId,
  huecoId,
  principal,
  comodines,
  elegido,
  sesion,
  elegir,
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const zona = useRef<HTMLDivElement>(null)

  // Se cierra al tocar fuera o con Escape, como cualquier desplegable.
  useEffect(() => {
    if (!abierto) return
    function alTocar(evento: globalThis.PointerEvent) {
      if (!zona.current?.contains(evento.target as Node)) setAbierto(false)
    }
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('pointerdown', alTocar)
    document.addEventListener('keydown', alPulsarTecla)
    return () => {
      document.removeEventListener('pointerdown', alTocar)
      document.removeEventListener('keydown', alPulsarTecla)
    }
  }, [abierto])

  const opciones = [
    { ejercicio: principal, rol: 'principal' },
    ...comodines.map((ejercicio) => ({ ejercicio, rol: 'comodín' })),
  ]

  return (
    // `display: contents`: el desplegable se coloca respecto a la cabecera del
    // hueco, no respecto a este envoltorio, que solo sirve para saber qué es "fuera".
    <div ref={zona} style={{ display: 'contents' }}>
      <button
        type="button"
        className={abierto ? 'flecha-comodin abierta' : 'flecha-comodin'}
        aria-expanded={abierto}
        aria-label="Cambiar de ejercicio"
        onClick={() => setAbierto(!abierto)}
      >
        <Icono nombre={abierto ? 'arriba' : 'abajo'} pequeno />
      </button>

      {abierto && (
        <ul className="desplegable" role="listbox" aria-label="Ejercicio de hoy">
          {opciones.map(({ ejercicio, rol }) => (
            <Opcion
              key={ejercicio.id}
              ejercicio={ejercicio}
              rol={rol}
              marcado={ejercicio.id === elegido.id}
              ultima={{ rutinaId, huecoId, sesion }}
              elegir={() => {
                elegir(ejercicio)
                setAbierto(false)
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Una opción del desplegable, con su propia última vez en este hueco. */
function Opcion({
  ejercicio,
  rol,
  marcado,
  ultima,
  elegir,
}: {
  ejercicio: Ejercicio
  rol: string
  marcado: boolean
  ultima: {
    rutinaId: number
    huecoId: number
    sesion: { id: number; fecha: string }
  }
  elegir: () => void
}) {
  const vez = useUltimaVez(ultima.rutinaId, ultima.huecoId, ejercicio.id, ultima.sesion)
  // Un ejercicio oculto se enseña, para que se entienda qué pasó con él, pero ya
  // no se ofrece: para volver a usarlo hay que mostrarlo antes.
  const oculto = ejercicio.oculto_desde !== null
  const primera = vez?.series[0]

  let detalle = ' '
  if (oculto) detalle = 'Oculto'
  else if (vez === null) detalle = 'Todavía no lo has hecho en este hueco'
  else if (vez && primera) {
    detalle = `Última vez · ${pesoLegible(primera.peso)} × ${primera.repeticiones} · ${fechaCorta(vez.fecha)}`
  }

  return (
    <li role="option" aria-selected={marcado} aria-disabled={oculto}>
      <button type="button" className="opcion" onClick={elegir} disabled={oculto}>
        <span className="opcion-texto">
          <span className="opcion-nombre">
            <span>{ejercicio.nombre}</span>
            <span className="etiqueta-chica">{rol}</span>
          </span>
          <span className="opcion-detalle num">{detalle}</span>
        </span>
        {marcado ? <Icono nombre="elegido" pequeno /> : <span className="opcion-hueco" />}
      </button>
    </li>
  )
}
