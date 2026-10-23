import { Icono } from './Icono'
import './CampoDeDuracion.css'

type Props = {
  etiqueta: string
  // La duración en segundos, que es como la guarda la API.
  segundos: number
  cambiar: (segundos: number) => void
  // Lo que suben o bajan los botones de los segundos (el ajuste «Botones − y + del tiempo»).
  paso: number
}

/** Un número entero de un campo de texto; lo que no lo es, 0. */
function entero(texto: string): number {
  const numero = Math.floor(Number(texto.replace(/\D/g, '')))
  return Number.isFinite(numero) ? numero : 0
}

/**
 * Una duración con dos campos, minutos y segundos, cada uno con su − y su +. Trabaja
 * sobre los segundos totales: con + en los segundos, 0:59 pasa a 1:00; con −, 1:00
 * pasa a 0:59; los minutos suman o restan 60. Un valor de 60 o más segundos que se
 * escriba pasa a minutos (90 s = 1 min 30 s).
 *
 * Son dos campos y no uno de «m:ss» porque el teclado numérico del móvil no tiene los
 * dos puntos.
 */
export function CampoDeDuracion({ etiqueta, segundos, cambiar, paso }: Props) {
  const minutos = Math.floor(segundos / 60)
  const resto = segundos % 60

  function sumar(cuanto: number) {
    cambiar(Math.max(0, segundos + cuanto))
  }

  return (
    <div className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
      <div className="duracion-campos">
        <div className="pasos">
          <button
            type="button"
            onClick={() => sumar(-60)}
            aria-label={`Menos minutos de ${etiqueta}`}
          >
            <Icono nombre="menos" />
          </button>
          <span className="duracion-valor">
            <input
              className="num"
              type="text"
              inputMode="numeric"
              value={minutos}
              aria-label={`Minutos de ${etiqueta}`}
              onChange={(evento) => cambiar(entero(evento.target.value) * 60 + resto)}
              onFocus={(evento) => evento.target.select()}
            />
            min
          </span>
          <button type="button" onClick={() => sumar(60)} aria-label={`Más minutos de ${etiqueta}`}>
            <Icono nombre="mas" />
          </button>
        </div>
        <div className="pasos">
          <button
            type="button"
            onClick={() => sumar(-paso)}
            aria-label={`Menos segundos de ${etiqueta}`}
          >
            <Icono nombre="menos" />
          </button>
          <span className="duracion-valor">
            <input
              className="num"
              type="text"
              inputMode="numeric"
              value={resto}
              aria-label={`Segundos de ${etiqueta}`}
              onChange={(evento) => cambiar(minutos * 60 + entero(evento.target.value))}
              onFocus={(evento) => evento.target.select()}
            />
            s
          </span>
          <button
            type="button"
            onClick={() => sumar(paso)}
            aria-label={`Más segundos de ${etiqueta}`}
          >
            <Icono nombre="mas" />
          </button>
        </div>
      </div>
    </div>
  )
}
