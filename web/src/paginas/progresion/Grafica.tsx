import { useLayoutEffect, useRef, useState } from 'react'

import { diasEntre, diaYMesCorto, fechaAbreviada, hoy, mesCorto } from '../../utiles/fechas'

export type Punto = {
  id: number
  fecha: string
  valor: number
  // Lo que dice el globo debajo de la fecha: "20 kg", "720 kg en 4 series"…
  detalle: string
}

type Props = {
  // De la más antigua a la más reciente.
  puntos: Punto[]
  // Qué punto tiene el globo; sin elegir, el último.
  elegido: number | null
  alElegir: (id: number) => void
  // Cómo se escribe cada valor del eje; sin esto, como un número («5:26» para el ritmo).
  formatoDeMarca?: (valor: number) => string
  // Cuántos días caben a lo ancho. Con más, la gráfica se desplaza de lado (con «Todo»:
  // la misma escala que 6 meses, para que los puntos y los meses no se apilen).
  diasVisibles?: number
}

// En píxeles. El ancho no es fijo: es el de la tarjeta, medido (ver `useAncho`).
const ANCHO_INICIAL = 326
const ALTO = 176
const IZQUIERDA = 32
const ARRIBA = 20
const ABAJO = 150
// El alto del globo es fijo; el ancho se ajusta a lo que dice (`anchoDelGlobo`).
const GLOBO = { alto: 40, relleno: 10 }

let lienzoDeMedir: CanvasRenderingContext2D | null = null

/** Cuánto ocupa un texto con esa fuente, para que el globo no deje hueco de más. */
function anchoDeTexto(texto: string, fuente: string): number {
  lienzoDeMedir ??= document.createElement('canvas').getContext('2d')
  if (!lienzoDeMedir) return texto.length * 7
  lienzoDeMedir.font = fuente
  return lienzoDeMedir.measureText(texto).width
}

/**
 * El ancho real de la gráfica, siguiéndolo si cambia. Dibujar a ese ancho, y no
 * escalar un dibujo fijo, mantiene las letras a su tamaño: escalado, en el ancho de
 * escritorio salían casi al triple.
 */
function useAncho() {
  const lienzo = useRef<HTMLDivElement>(null)
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
export function Grafica({ puntos, elegido, alElegir, diasVisibles, formatoDeMarca }: Props) {
  const [lienzo, visible] = useAncho()
  const desplazable = useRef<HTMLDivElement>(null)
  const marcas = escala(
    Math.min(...puntos.map((p) => p.valor)),
    Math.max(...puntos.map((p) => p.valor)),
  )
  const bajo = marcas[0]
  const alto = marcas[marcas.length - 1]
  const primero = puntos[0].fecha
  const ultimo = puntos[puntos.length - 1].fecha
  const total = diasEntre(primero, ultimo)
  // Con más días de los que caben, el dibujo se alarga a la misma escala: lo que se ve
  // de una vez son `diasVisibles` días.
  const seDesplaza = diasVisibles !== undefined && total > diasVisibles
  const ancho = seDesplaza
    ? Math.round(IZQUIERDA + ((visible - 8 - IZQUIERDA) * total) / diasVisibles + 8)
    : visible
  const derecha = ancho - 8

  // Al abrir (y al cambiar de rango), lo más reciente: el final.
  useLayoutEffect(() => {
    const elemento = desplazable.current
    if (elemento) elemento.scrollLeft = elemento.scrollWidth
  }, [ancho, puntos.length])

  const x = (fecha: string) =>
    total === 0
      ? (IZQUIERDA + derecha) / 2
      : IZQUIERDA + (diasEntre(primero, fecha) / total) * (derecha - IZQUIERDA)
  const y = (valor: number) => ABAJO - ((valor - bajo) / (alto - bajo)) * (ABAJO - ARRIBA)

  const activo = puntos.find((p) => p.id === elegido) ?? puntos[puntos.length - 1]
  const trazado = puntos.map((p) => `${x(p.fecha).toFixed(1)},${y(p.valor).toFixed(1)}`)

  // El eje de abajo, como en el boceto: el mes bajo el primer punto de cada mes, salvo
  // que pise al anterior. Lleva el año cuando cambia, y en el primero si no es el actual:
  // con el rango de un año o todo, "sep" sería ambiguo. Si todo cae en un mismo mes, un
  // solo "sep" no dice nada: el primer día y el último.
  const anioActual = hoy().slice(0, 4)
  const meses: { mes: string; texto: string; x: number }[] = []
  // Cada etiqueta va centrada en su punto: se pisan si la mitad de una más la mitad de la
  // otra no caben entre los dos. Se mide la anterior también, porque con el año es más
  // ancha («nov 2025» se comía a «dic»); a 11 px, unos 6,2 px por letra.
  const mitad = (texto: string) => (texto.length * 6.2) / 2
  for (const punto of puntos) {
    const anterior = meses.at(-1)
    const mes = punto.fecha.slice(0, 7)
    const anio = punto.fecha.slice(0, 4)
    const conAnio = anterior ? anterior.mes.slice(0, 4) !== anio : anio !== anioActual
    const texto = `${mesCorto(punto.fecha)}${conAnio ? ` ${anio}` : ''}`
    const cabe = !anterior || x(punto.fecha) - anterior.x > mitad(anterior.texto) + mitad(texto) + 6
    if (!anterior || (mes !== anterior.mes && cabe)) {
      meses.push({ mes, texto, x: x(punto.fecha) })
    }
  }
  const conAnio = (iso: string) =>
    iso.slice(0, 4) === anioActual ? diaYMesCorto(iso) : `${diaYMesCorto(iso)} ${iso.slice(0, 4)}`
  const etiquetas =
    meses.length > 1 || total === 0
      ? meses
      : [
          { texto: conAnio(primero), x: IZQUIERDA },
          { texto: conAnio(ultimo), x: derecha },
        ]

  // El globo dice la fecha y el valor: tan ancho como el más largo de los dos, con un margen.
  const titulo = fechaAbreviada(activo.fecha)
  const globoAncho = Math.ceil(
    Math.max(
      anchoDeTexto(titulo, '11px system-ui, sans-serif'),
      anchoDeTexto(activo.detalle, '600 12.5px system-ui, sans-serif'),
    ) +
      GLOBO.relleno * 2,
  )
  // El globo, a la izquierda del punto si no cabe a la derecha y debajo si no cabe encima.
  const globoX = Math.min(Math.max(x(activo.fecha) - globoAncho / 2, IZQUIERDA), ancho - globoAncho)
  const globoY =
    y(activo.valor) - GLOBO.alto - 12 >= 0
      ? y(activo.valor) - GLOBO.alto - 12
      : y(activo.valor) + 12

  return (
    <div ref={lienzo} className="progresion-grafica">
      <div ref={desplazable} className={seDesplaza ? 'progresion-desplazable' : undefined}>
        <svg
          width={ancho}
          height={ALTO}
          viewBox={`0 0 ${ancho} ${ALTO}`}
          role="group"
          aria-label="Gráfica de progresión"
        >
          <g stroke="var(--borde)" strokeWidth="1">
            {marcas.map((marca) => (
              <line key={marca} x1={IZQUIERDA} y1={y(marca)} x2={ancho} y2={y(marca)} />
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
              width={globoAncho}
              height={GLOBO.alto}
              rx="6"
              fill="var(--texto)"
            />
            <text x={globoX + 10} y={globoY + 16} fontSize="11" fill="var(--globo-tenue)">
              {titulo}
            </text>
            <text
              x={globoX + 10}
              y={globoY + 32}
              fontSize="12.5"
              fontWeight="600"
              fill="var(--fondo)"
            >
              {activo.detalle}
            </text>
          </g>
        </svg>
      </div>
      {/* Los valores, fijos a la izquierda: al desplazar la gráfica no se van. Solo hasta la
          línea de abajo, para no tapar los meses. */}
      <svg className="progresion-valores" width={IZQUIERDA} height={ABAJO + 8} aria-hidden>
        <g fill="var(--texto-tenue)" fontSize="11" textAnchor="end">
          {marcas.map((marca) => (
            <text key={marca} x={IZQUIERDA - 8} y={y(marca) + 4}>
              {formatoDeMarca ? formatoDeMarca(marca) : marca.toLocaleString('es-ES')}
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}
