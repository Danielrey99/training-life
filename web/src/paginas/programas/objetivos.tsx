import type { Ejercicio, Objetivo } from '../../api/tipos'
import { CampoDeDuracion } from '../../componentes/CampoDeDuracion'
import { ajustes } from '../../utiles/ajustes'
import { duracionLegible, leerNumero } from '../../utiles/numeros'
import { CampoConPasos } from '../sesion/FormularioDeSerie'
import { objetivo as objetivoEnTexto } from './textos'

/**
 * En qué unidad va el objetivo de un ejercicio: repeticiones (peso y repeticiones, peso
 * corporal) o duración (tiempo). Lo decide cómo se apunta el ejercicio.
 */
export type Familia = 'repeticiones' | 'duracion'

export const familiaDe = (ejercicio: Pick<Ejercicio, 'tipo_registro'>): Familia =>
  ejercicio.tipo_registro === 'tiempo' || ejercicio.tipo_registro === 'cardio'
    ? 'duracion'
    : 'repeticiones'

/** El objetivo de un ejercicio en su formulario, tal y como se teclea: mínimo y máximo son reps o segundos. */
export type ObjetivoEnTexto = { series: string; min: string; max: string }

const MAXIMO_SERIES = 50
const MAXIMO_REPS = 1000
const MAXIMO_SEGUNDOS = 86400

/** Un objetivo que ya existe, para el formulario. */
export function enTexto(objetivo: Objetivo): ObjetivoEnTexto {
  const porDuracion = objetivo.duracion_min_s !== null
  return {
    series: String(objetivo.series_objetivo),
    min: String(porDuracion ? objetivo.duracion_min_s : (objetivo.reps_min ?? '')),
    max: String(porDuracion ? objetivo.duracion_max_s : (objetivo.reps_max ?? '')),
  }
}

/** Con lo que empieza un ejercicio nuevo, según cómo se apunta: el ajuste de ese tipo. */
export function deAjustes(ejercicio: Pick<Ejercicio, 'tipo_registro'>): ObjetivoEnTexto {
  const { series, min, max } = ajustes().objetivoNuevo[ejercicio.tipo_registro]
  return { series: String(series), min: String(min), max: String(max) }
}

/** Lo tecleado, como el objetivo de la API: un par completo y el otro nulo. */
export function aObjetivo(familia: Familia, texto: ObjetivoEnTexto): Objetivo {
  const min = Number(leerNumero(texto.min))
  const max = Number(leerNumero(texto.max))
  const porDuracion = familia === 'duracion'
  return {
    series_objetivo: Number(leerNumero(texto.series)),
    reps_min: porDuracion ? null : min,
    reps_max: porDuracion ? null : max,
    duracion_min_s: porDuracion ? min : null,
    duracion_max_s: porDuracion ? max : null,
  }
}

/** Lo que no vale del objetivo de un ejercicio, dicho con su nombre; nulo si todo está bien. */
export function queFaltaDelObjetivo(
  nombre: string,
  familia: Familia,
  texto: ObjetivoEnTexto,
): string | null {
  const series = leerNumero(texto.series)
  const min = leerNumero(texto.min)
  const max = leerNumero(texto.max)
  const delObjetivo = `El objetivo de ${nombre}:`
  if (series === null || !Number.isInteger(series) || series < 1 || series > MAXIMO_SERIES) {
    return `${delObjetivo} las series tienen que ser un número entero entre 1 y ${MAXIMO_SERIES}.`
  }
  const tope = familia === 'duracion' ? MAXIMO_SEGUNDOS : MAXIMO_REPS
  const entero = (valor: number | null): valor is number =>
    valor !== null && Number.isInteger(valor) && valor >= 1 && valor <= tope
  if (!entero(min) || !entero(max)) {
    return familia === 'duracion'
      ? `${delObjetivo} la duración tiene que ir de 1 segundo a 24 horas.`
      : `${delObjetivo} las repeticiones tienen que ser números enteros entre 1 y ${MAXIMO_REPS}.`
  }
  if (max < min) {
    return familia === 'duracion'
      ? `${delObjetivo} la duración máxima no puede ser menos que la mínima.`
      : `${delObjetivo} las repeticiones máximas no pueden ser menos que las mínimas.`
  }
  return null
}

/** «3 × 30-45 s» de lo que hay en el formulario; «—» si todavía no vale. */
export function resumenDelObjetivo(ejercicio: Ejercicio, texto: ObjetivoEnTexto): string {
  const familia = familiaDe(ejercicio)
  return queFaltaDelObjetivo(ejercicio.nombre, familia, texto) === null
    ? objetivoEnTexto(aObjetivo(familia, texto))
    : '—'
}

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
