import { Icono } from './Icono'
import './CampoDeDuracion.css'

type Props = {
  etiqueta: string
  // La duración en segundos, que es como la guarda la API.
  segundos: number
  cambiar: (segundos: number) => void
  // Lo que suben o bajan los botones de los segundos (el ajuste «Botones − y + del tiempo»).
  paso: number
  // Al apuntar una serie no hay rótulo encima de «Minutos» y «Segundos»: ya se sabe qué
  // es. En el objetivo y en Ajustes sí («Duración mínima»), porque hay dos duraciones.
  sinTitulo?: boolean
}

/** Un número entero de un campo de texto; lo que no lo es, 0. */
function entero(texto: string): number {
  const numero = Math.floor(Number(texto.replace(/\D/g, '')))
  return Number.isFinite(numero) ? numero : 0
}

type PropsDeLosPasos = {
  rotulo: string
  // «Minutos de Tiempo»: lo que lee un lector de pantalla en cada control.
  nombre: string
  valor: number
  menos: () => void
  mas: () => void
  escribir: (valor: number) => void
}

/** Uno de los dos campos, con su rótulo encima y su − y su +. */
function Pasos({ rotulo, nombre, valor, menos, mas, escribir }: PropsDeLosPasos) {
  return (
    <div className="campo">
      <span className="campo-etiqueta">{rotulo}</span>
      <div className="pasos">
        <button type="button" onClick={menos} aria-label={`Menos ${nombre.toLowerCase()}`}>
          <Icono nombre="menos" />
        </button>
        <input
          className="num"
          type="text"
          inputMode="numeric"
          value={valor}
          aria-label={nombre}
          onChange={(evento) => escribir(entero(evento.target.value))}
          onFocus={(evento) => evento.target.select()}
        />
        <button type="button" onClick={mas} aria-label={`Más ${nombre.toLowerCase()}`}>
          <Icono nombre="mas" />
        </button>
      </div>
    </div>
  )
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
export function CampoDeDuracion({ etiqueta, segundos, cambiar, paso, sinTitulo }: Props) {
  const minutos = Math.floor(segundos / 60)
  const resto = segundos % 60

  function sumar(cuanto: number) {
    cambiar(Math.max(0, segundos + cuanto))
  }

  const campos = (
    <div className="duracion-campos">
      <Pasos
        rotulo="Minutos"
        nombre={`Minutos de ${etiqueta}`}
        valor={minutos}
        menos={() => sumar(-60)}
        mas={() => sumar(60)}
        escribir={(valor) => cambiar(valor * 60 + resto)}
      />
      <Pasos
        rotulo="Segundos"
        nombre={`Segundos de ${etiqueta}`}
        valor={resto}
        menos={() => sumar(-paso)}
        mas={() => sumar(paso)}
        escribir={(valor) => cambiar(minutos * 60 + valor)}
      />
    </div>
  )

  if (sinTitulo) return campos
  return (
    <div className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
      {campos}
    </div>
  )
}
