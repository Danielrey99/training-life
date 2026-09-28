import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'

import type { SerieHistorial } from '../../api/tipos'
import { pesoLegible } from '../../utiles/numeros'

// Lo que tarda en contar como "mantener pulsado" y no como un toque.
const PULSACION_LARGA_MS = 350

/**
 * La última vez en fichas, una por serie: cada una con su peso, porque las
 * series de un mismo día pueden ir a pesos distintos.
 *
 * La variante no se escribe en la ficha, que no cabría: las que la tienen llevan
 * un punto, y al mantenerlas pulsadas (o con el ratón encima) sale un globo por
 * encima, donde el dedo no lo tapa. Es el único gesto oculto de la app.
 */
export function FichasUltimaVez({ series }: { series: SerieHistorial[] }) {
  const [abierta, setAbierta] = useState<number | null>(null)
  const temporizador = useRef<number | undefined>(undefined)

  function soltar() {
    window.clearTimeout(temporizador.current)
    setAbierta(null)
  }

  function alPulsar(evento: PointerEvent, serie: SerieHistorial) {
    if (!serie.variante || evento.pointerType === 'mouse') return
    temporizador.current = window.setTimeout(() => setAbierta(serie.id), PULSACION_LARGA_MS)
  }

  return (
    <div className="fichas">
      {series.map((serie) => (
        <span
          key={serie.id}
          className={abierta === serie.id ? 'ficha num pulsada' : 'ficha num'}
          onPointerDown={(evento) => alPulsar(evento, serie)}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          onPointerLeave={soltar}
          onPointerEnter={(evento) => {
            if (serie.variante && evento.pointerType === 'mouse') setAbierta(serie.id)
          }}
          // Sin esto, mantener pulsado en el móvil abre el menú del navegador.
          onContextMenu={(evento) => serie.variante && evento.preventDefault()}
        >
          <span className="ficha-numero">{serie.numero_serie}</span>
          {pesoLegible(serie.peso)} × {serie.repeticiones}
          {serie.variante && <span className="ficha-punto" aria-label={serie.variante} />}
          {abierta === serie.id && <span className="globo">{serie.variante}</span>}
        </span>
      ))}
    </div>
  )
}
