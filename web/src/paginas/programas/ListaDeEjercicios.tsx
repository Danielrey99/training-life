import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'

import { Icono } from '../../componentes/Icono'
import './rutina.css'

export type FilaDeEjercicio = {
  clave: string | number
  nombre: string
  // "4 × 6-10"
  objetivo: string
  // La línea de debajo: alternativas, "oculto desde…".
  detalle: string | null
  // El ejercicio principal está oculto: el nombre va en gris con su etiqueta.
  principalOculto?: boolean
  // A dónde lleva tocarla; sin enlace, la fila no se abre (editando).
  enlace?: string
}

type Props = {
  filas: FilaDeEjercicio[]
  // Con `alMover`, cada fila lleva el asa para arrastrarla.
  alMover?: (desde: number, hasta: number) => void
  // Sin número delante: los ocultos no tienen posición en la rutina.
  sinNumero?: boolean
  // Tarjetas con borde discontinuo (los ocultos).
  oculta?: boolean
}

// El hueco entre tarjetas de `.rutina-lista` en rutina.css: al cruzar a otra, la
// arrastrada se desplaza su alto más este hueco.
const SEPARACION = 10

/**
 * Los ejercicios de una rutina, en tarjetas numeradas por posición (no por su
 * `orden` guardado, que puede tener saltos).
 *
 * Con `alMover`, se reordenan arrastrando el asa: al pasar el dedo por la mitad de
 * la tarjeta vecina se intercambian, y la arrastrada sigue al dedo. Con el teclado,
 * las flechas arriba y abajo sobre el asa hacen lo mismo.
 */
export function ListaDeEjercicios({ filas, alMover, sinNumero, oculta }: Props) {
  const tarjetas = useRef<(HTMLElement | null)[]>([])
  const [arrastre, setArrastre] = useState<{ indice: number; origen: number; dy: number } | null>(
    null,
  )

  function empezar(evento: PointerEvent<HTMLButtonElement>, indice: number) {
    evento.currentTarget.setPointerCapture(evento.pointerId)
    setArrastre({ indice, origen: evento.clientY, dy: 0 })
  }

  function mover(evento: PointerEvent<HTMLButtonElement>) {
    if (!arrastre || !alMover) return
    let { indice, origen } = arrastre
    const y = evento.clientY
    const siguiente = tarjetas.current[indice + 1]?.getBoundingClientRect()
    const anterior = tarjetas.current[indice - 1]?.getBoundingClientRect()
    if (siguiente && y > siguiente.top + siguiente.height / 2) {
      alMover(indice, indice + 1)
      origen += siguiente.height + SEPARACION
      indice += 1
    } else if (anterior && y < anterior.top + anterior.height / 2) {
      alMover(indice, indice - 1)
      origen -= anterior.height + SEPARACION
      indice -= 1
    }
    setArrastre({ indice, origen, dy: y - origen })
  }

  function conTeclado(evento: KeyboardEvent, indice: number) {
    if (!alMover) return
    if (evento.key === 'ArrowUp' && indice > 0) {
      evento.preventDefault()
      alMover(indice, indice - 1)
    } else if (evento.key === 'ArrowDown' && indice < filas.length - 1) {
      evento.preventDefault()
      alMover(indice, indice + 1)
    }
  }

  return (
    <div className="rutina-lista">
      {filas.map((fila, indice) => {
        const arrastrada = arrastre?.indice === indice
        const cuerpo = (
          <>
            <span className="rutina-tarjeta-texto">
              <span className="rutina-tarjeta-nombre">
                <strong className={fila.principalOculto ? 'oculto' : undefined}>
                  {sinNumero ? fila.nombre : `${indice + 1} · ${fila.nombre}`}
                </strong>
                {fila.principalOculto && <span className="etiqueta-chica">oculto</span>}
              </span>
              {fila.detalle && <span className="rutina-tarjeta-detalle">{fila.detalle}</span>}
            </span>
            <span className="rutina-objetivo num">{fila.objetivo}</span>
            {fila.enlace && <Icono nombre="abrir" pequeno />}
          </>
        )
        const clase = `rutina-tarjeta${oculta ? ' oculta' : ''}${arrastrada ? ' arrastrada' : ''}`
        return (
          <div
            key={fila.clave}
            ref={(elemento) => {
              tarjetas.current[indice] = elemento
            }}
            className={clase}
            style={arrastrada ? { transform: `translateY(${arrastre.dy}px)` } : undefined}
          >
            {/* El asa va fuera del enlace: un botón dentro de un enlace no es válido, y
                arrastrar no debe abrir el ejercicio. */}
            {alMover && (
              <button
                type="button"
                className="rutina-asa"
                aria-label={`Mover ${fila.nombre}: flechas arriba y abajo`}
                onPointerDown={(evento) => empezar(evento, indice)}
                onPointerMove={mover}
                onPointerUp={() => setArrastre(null)}
                onPointerCancel={() => setArrastre(null)}
                onKeyDown={(evento) => conTeclado(evento, indice)}
              >
                <Icono nombre="asa" />
              </button>
            )}
            {fila.enlace ? (
              <Link to={fila.enlace} className="rutina-tarjeta-cuerpo">
                {cuerpo}
              </Link>
            ) : (
              <span className="rutina-tarjeta-cuerpo">{cuerpo}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
