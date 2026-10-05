import { useLayoutEffect, useRef, useState } from 'react'

import { diasEntre, diaYMesCorto, fechaAbreviada, mesCorto } from '../../utiles/fechas'

export type Punto = {
  id: number
  fecha: string
  valor: number
  // Lo que dice el globo debajo de la fecha: "20 kg", "720 kg en 4 series"…
  detalle: string
  rutina: string | null
}

type Props = {
  // De la más antigua a la más reciente.
  puntos: Punto[]
  // Qué punto tiene el globo; sin elegir, el último.
  elegido: number | null
  alElegir: (id: number) => void
}

// En píxeles. El ancho no es fijo: es el de la tarjeta, medido (ver `useAncho`).
const ANCHO_INICIAL = 326
const ALTO = 176
const IZQUIERDA = 32
const ARRIBA = 20
const ABAJO = 150
const GLOBO = { ancho: 132, alto: 40 }

/**
 * El ancho real de la gráfica, siguiéndolo si cambia. Dibujar a ese ancho, y no
 * escalar un dibujo fijo, mantiene las letras a su tamaño: escalado, en el ancho de
 * escritorio salían casi al triple.
 */
function useAncho() {
  const lienzo = useRef<SVGSVGElement>(null)
  const [ancho, setAncho] = useState(ANCHO_INICIAL)
  useLayoutEffect(() => {
    const elemento = lienzo.current
    if (!elemento) return
    const observador = new ResizeObserver(([entrada]) =>
      setAncho(Math.round(entrada.contentRect.width)),
    )
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [])
  return [lienzo, ancho] as const
}

/**
 * Los valores redondos entre los que cabe la serie: unas cinco líneas de la
 * cuadrícula con un paso de 1, 2, 2,5 o 5 (por una potencia de diez). Si todos los
 * puntos valen lo mismo se abre un margen, para que la línea no quede pegada al borde.
 */
function escala(minimo: number, maximo: number): number[] {
  const margen = maximo === minimo ? Math.max(maximo * 0.2, 1) : 0
  const bajo = minimo - margen
  const alto = maximo + margen
  const bruto = (alto - bajo) / 4
  const potencia = 10 ** Math.floor(Math.log10(bruto))
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) ?? bruto
  const inicio = Math.floor(bajo / paso) * paso
  const marcas: number[] = []
  for (let valor = inicio; valor < alto + paso; valor += paso) {
    marcas.push(Math.round(valor * 100) / 100)
    if (valor >= alto) break
  }
  return marcas
}

/**
 * La gráfica de una serie de sesiones: una línea con un punto por sesión, repartidos
 * en el tiempo (dos sesiones muy separadas se ven separadas). El punto elegido lleva
 * un globo con su día y su valor; se elige tocando un punto.
 */
export function Grafica({ puntos, elegido, alElegir }: Props) {
  const [lienzo, ancho] = useAncho()
  const derecha = ancho - 8
  const marcas = escala(
    Math.min(...puntos.map((p) => p.valor)),
    Math.max(...puntos.map((p) => p.valor)),
  )
  const bajo = marcas[0]
  const alto = marcas[marcas.length - 1]
  const primero = puntos[0].fecha
  const ultimo = puntos[puntos.length - 1].fecha
  const total = diasEntre(primero, ultimo)

  const x = (fecha: string) =>
    total === 0
      ? (IZQUIERDA + derecha) / 2
      : IZQUIERDA + (diasEntre(primero, fecha) / total) * (derecha - IZQUIERDA)
  const y = (valor: number) => ABAJO - ((valor - bajo) / (alto - bajo)) * (ABAJO - ARRIBA)

  const activo = puntos.find((p) => p.id === elegido) ?? puntos[puntos.length - 1]
  const trazado = puntos.map((p) => `${x(p.fecha).toFixed(1)},${y(p.valor).toFixed(1)}`)

  // El eje de abajo, como en el boceto: el mes bajo el primer punto de cada mes, salvo
  // que quede a menos de 30 unidades del anterior y se pisen. Si todo cae en un mismo
  // mes, un solo "sep" no dice nada: se nombran el primer día y el último.
  const meses: { texto: string; x: number }[] = [{ texto: mesCorto(primero), x: x(primero) }]
  for (const punto of puntos) {
    const anterior = meses[meses.length - 1]
    if (mesCorto(punto.fecha) !== anterior.texto && x(punto.fecha) - anterior.x > 30) {
      meses.push({ texto: mesCorto(punto.fecha), x: x(punto.fecha) })
    }
  }
  const etiquetas =
    meses.length > 1 || total === 0
      ? meses
      : [
          { texto: diaYMesCorto(primero), x: IZQUIERDA },
          { texto: diaYMesCorto(ultimo), x: derecha },
        ]

  // El globo, a la izquierda del punto si no cabe a la derecha y debajo si no cabe encima.
  const globoX = Math.min(
    Math.max(x(activo.fecha) - GLOBO.ancho / 2, IZQUIERDA),
    ancho - GLOBO.ancho,
  )
  const globoY =
    y(activo.valor) - GLOBO.alto - 12 >= 0
      ? y(activo.valor) - GLOBO.alto - 12
      : y(activo.valor) + 12
  const titulo = `${fechaAbreviada(activo.fecha)}${activo.rutina ? ` · ${activo.rutina}` : ''}`

  return (
    <svg
      ref={lienzo}
      className="progresion-grafica"
      viewBox={`0 0 ${ancho} ${ALTO}`}
      role="group"
      aria-label="Gráfica de progresión"
    >
      <g stroke="var(--borde)" strokeWidth="1">
        {marcas.map((marca) => (
          <line key={marca} x1={IZQUIERDA} y1={y(marca)} x2={ancho} y2={y(marca)} />
        ))}
      </g>
      <g fill="var(--texto-tenue)" fontSize="11" textAnchor="end">
        {marcas.map((marca) => (
          <text key={marca} x={IZQUIERDA - 8} y={y(marca) + 4}>
            {marca.toLocaleString('es-ES')}
          </text>
        ))}
      </g>
      <g fill="var(--texto-tenue)" fontSize="11" textAnchor="middle">
        {etiquetas.map((etiqueta) => (
          // Por la posición: con más de un año, "sep" puede salir dos veces.
          <text key={etiqueta.x} x={etiqueta.x} y={ALTO - 6}>
            {etiqueta.texto}
          </text>
        ))}
      </g>

      <line
        x1={x(activo.fecha)}
        y1={ARRIBA}
        x2={x(activo.fecha)}
        y2={ABAJO}
        stroke="var(--texto-tenue)"
        strokeDasharray="3 3"
      />
      <polyline
        points={trazado.join(' ')}
        fill="none"
        stroke="var(--acento)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {puntos.map((punto) => (
        <g key={punto.id}>
          <circle
            cx={x(punto.fecha)}
            cy={y(punto.valor)}
            r={punto.id === activo.id ? 6 : 4}
            fill="var(--acento)"
            stroke="var(--superficie)"
            strokeWidth="2"
          />
          {/* Más grande que el punto, para poder acertar con el dedo. */}
          <circle
            className="progresion-toque"
            cx={x(punto.fecha)}
            cy={y(punto.valor)}
            r="14"
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-label={`${fechaAbreviada(punto.fecha)}: ${punto.detalle}`}
            onClick={() => alElegir(punto.id)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter' || evento.key === ' ') {
                evento.preventDefault()
                alElegir(punto.id)
              }
            }}
          />
        </g>
      ))}

      <g pointerEvents="none">
        <rect
          x={globoX}
          y={globoY}
          width={GLOBO.ancho}
          height={GLOBO.alto}
          rx="6"
          fill="var(--texto)"
        />
        <text x={globoX + 10} y={globoY + 16} fontSize="11" fill="#5b6270">
          {titulo.length > 22 ? `${titulo.slice(0, 21)}…` : titulo}
        </text>
        <text x={globoX + 10} y={globoY + 32} fontSize="12.5" fontWeight="600" fill="var(--fondo)">
          {activo.detalle}
        </text>
      </g>
    </svg>
  )
}
