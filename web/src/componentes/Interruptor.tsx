import './Interruptor.css'

type Props = {
  titulo: string
  // La línea de debajo: qué significa encenderlo o apagarlo.
  ayuda: string
  encendido: boolean
  alCambiar: () => void
  desactivado?: boolean
}

/**
 * Una tarjeta con un título, su ayuda y un interruptor a la derecha: "Programa
 * activo" en P2 y "Activarlo al crearlo" en P5. Toda la tarjeta es el control, para
 * acertar con el dedo; qué pasa al pulsarlo (preguntar, guardar) lo decide quien lo usa.
 */
export function Interruptor({ titulo, ayuda, encendido, alCambiar, desactivado }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={encendido}
      className="interruptor"
      onClick={alCambiar}
      disabled={desactivado}
    >
      <span className="interruptor-texto">
        <strong>{titulo}</strong>
        <span>{ayuda}</span>
      </span>
      <span className={encendido ? 'interruptor-pista encendido' : 'interruptor-pista'}>
        <span className="interruptor-bola" />
      </span>
    </button>
  )
}
