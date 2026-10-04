import { useEffect, useRef, useState } from 'react'

import type { SerieHistorial } from '../../api/tipos'
import { pesoLegible } from '../../utiles/numeros'

/**
 * La última vez en fichas, una por serie: cada una con su peso, porque las
 * series de un mismo día pueden ir a pesos distintos.
 *
 * La variante no se escribe en la ficha, que no cabría: las que la tienen llevan
 * un punto, y al tocarlas (o con el ratón encima) sale un globo por encima, donde
 * el dedo no lo tapa. Se cierra tocando otra vez o en cualquier otro sitio. Antes
 * era mantener pulsado, pero un gesto así no lo descubre nadie y en el móvil choca
 * con seleccionar texto.
 */
export function FichasUltimaVez({ series }: { series: SerieHistorial[] }) {
  const [abierta, setAbierta] = useState<number | null>(null)
  const fichas = useRef<HTMLDivElement>(null)

  // Con un globo abierto, tocar fuera de las fichas lo cierra.
  useEffect(() => {
    if (abierta === null) return
    function alTocarFuera(evento: PointerEvent) {
      if (!fichas.current?.contains(evento.target as Node)) setAbierta(null)
    }
    document.addEventListener('pointerdown', alTocarFuera)
    return () => document.removeEventListener('pointerdown', alTocarFuera)
  }, [abierta])

  return (
    <div className="fichas" ref={fichas}>
      {series.map((serie) => {
        const conVariante = Boolean(serie.variante)
        return (
          <span
            key={serie.id}
            className={abierta === serie.id ? 'ficha num pulsada' : 'ficha num'}
            role={conVariante ? 'button' : undefined}
            tabIndex={conVariante ? 0 : undefined}
            aria-expanded={conVariante ? abierta === serie.id : undefined}
            // Con el dedo, cada toque abre o cierra; con el ratón basta pasar por encima.
            onPointerUp={(evento) => {
              if (conVariante && evento.pointerType !== 'mouse') {
                setAbierta(abierta === serie.id ? null : serie.id)
              }
            }}
            onPointerEnter={(evento) => {
              if (conVariante && evento.pointerType === 'mouse') setAbierta(serie.id)
            }}
            onPointerLeave={(evento) => {
              if (evento.pointerType === 'mouse') setAbierta(null)
            }}
            onKeyDown={(evento) => {
              if (conVariante && (evento.key === 'Enter' || evento.key === ' ')) {
                evento.preventDefault()
                setAbierta(abierta === serie.id ? null : serie.id)
              }
            }}
          >
            <span className="ficha-numero">{serie.numero_serie}</span>
            {pesoLegible(serie.peso)} × {serie.repeticiones}
            {serie.variante && <span className="ficha-punto" aria-label={serie.variante} />}
            {abierta === serie.id && <span className="globo">{serie.variante}</span>}
          </span>
        )
      })}
    </div>
  )
}
