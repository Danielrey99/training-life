import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { SerieHistorial, TipoRegistro } from '../../api/tipos'
import { serieCorta } from '../../utiles/medidas'

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
export function FichasUltimaVez({
  tipo,
  series,
}: {
  // El tipo del ejercicio de las series: decide cómo se escribe cada ficha.
  tipo: TipoRegistro
  series: SerieHistorial[]
}) {
  const [abierta, setAbierta] = useState<number | null>(null)
  const fichas = useRef<HTMLDivElement>(null)
  const globo = useRef<HTMLSpanElement>(null)

  // El globo va centrado sobre su ficha; si así se sale por un lado (una ficha cerca del
  // borde con una variante larga), se mueve hacia dentro y la flecha sigue en la ficha.
  useLayoutEffect(() => {
    const elemento = globo.current
    if (!elemento) return
    elemento.style.setProperty('--mover', '0px')
    const { left, right } = elemento.getBoundingClientRect()
    const margen = 8
    let mover = 0
    if (left < margen) mover = margen - left
    else if (right > window.innerWidth - margen) mover = window.innerWidth - margen - right
    elemento.style.setProperty('--mover', `${mover}px`)
  }, [abierta])

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
            {serieCorta(tipo, serie)}
            {serie.variante && <span className="ficha-punto" aria-label={serie.variante} />}
            {abierta === serie.id && (
              <span className="globo" ref={globo}>
                {serie.variante}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
