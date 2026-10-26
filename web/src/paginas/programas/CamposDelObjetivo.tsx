import { CampoDeDuracion } from '../../componentes/CampoDeDuracion'
import { ajustes } from '../../utiles/ajustes'
import { duracionLegible, leerNumero } from '../../utiles/numeros'
import { CampoConPasos } from '../sesion/FormularioDeSerie'
import type { Familia, ObjetivoEnTexto } from './objetivos'

type Props = {
  familia: Familia
  valor: ObjetivoEnTexto
  cambiar: (cambios: Partial<ObjetivoEnTexto>) => void
  // Solo se ve: cajas con los valores, sin − ni +.
  soloLectura?: boolean
}

/**
 * Los campos del objetivo de un ejercicio en un hueco: series y reps mínimas y máximas, o
 * series y duración mínima y máxima (una debajo de otra: a 390 px no caben dos en fila).
 */
export function CamposDelObjetivo({ familia, valor, cambiar, soloLectura = false }: Props) {
  const segundos = (texto: string) => Number(leerNumero(texto)) || 0

  if (soloLectura) {
    return (
      <>
        <div className="campo">
          <span className="campo-etiqueta">Series objetivo</span>
          <div className="ejercicio-caja num">{valor.series}</div>
        </div>
        {familia === 'duracion' ? (
          <>
            <div className="campo">
              <span className="campo-etiqueta">Duración mínima</span>
              <div className="ejercicio-caja num">{duracionLegible(segundos(valor.min))}</div>
            </div>
            <div className="campo">
              <span className="campo-etiqueta">Duración máxima</span>
              <div className="ejercicio-caja num">{duracionLegible(segundos(valor.max))}</div>
            </div>
          </>
        ) : (
          <div className="ejercicio-reps">
            <div className="campo">
              <span className="campo-etiqueta">Reps mínimas</span>
              <div className="ejercicio-caja num">{valor.min}</div>
            </div>
            <div className="campo">
              <span className="campo-etiqueta">Reps máximas</span>
              <div className="ejercicio-caja num">{valor.max}</div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <CampoConPasos
        etiqueta="Series objetivo"
        valor={valor.series}
        cambiar={(series) => cambiar({ series })}
        paso={1}
        minimo={1}
      />
      {familia === 'duracion' ? (
        <>
          <CampoDeDuracion
            etiqueta="Duración mínima"
            segundos={segundos(valor.min)}
            cambiar={(total) => cambiar({ min: String(total) })}
            paso={ajustes().pasoTiempo}
          />
          <CampoDeDuracion
            etiqueta="Duración máxima"
            segundos={segundos(valor.max)}
            cambiar={(total) => cambiar({ max: String(total) })}
            paso={ajustes().pasoTiempo}
          />
        </>
      ) : (
        <div className="ejercicio-reps">
          <CampoConPasos
            etiqueta="Reps mínimas"
            valor={valor.min}
            cambiar={(min) => cambiar({ min })}
            paso={1}
            minimo={1}
          />
          <CampoConPasos
            etiqueta="Reps máximas"
            valor={valor.max}
            cambiar={(max) => cambiar({ max })}
            paso={1}
            minimo={1}
          />
        </div>
      )}
    </>
  )
}
