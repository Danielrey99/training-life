import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type { TipoRegistro } from '../../api/tipos'
import { CampoDeDuracion } from '../../componentes/CampoDeDuracion'
import { Icono } from '../../componentes/Icono'
import { ajustes } from '../../utiles/ajustes'
import {
  aKilos,
  aMetros,
  enUnidad,
  enUnidadDeDistancia,
  leerNumero,
  numeroLegible,
  pesoLegible,
  unidad,
  unidadDeDistancia,
} from '../../utiles/numeros'

export type DatosDeSerie = {
  // En kg y en segundos, como lo guarda la API, aunque se apunte en lb. Solo van las
  // medidas del tipo del ejercicio; el resto, nulo.
  peso: number | null
  repeticiones: number | null
  duracion_s: number | null
  // En metros: solo en el cardio, y si se apunta.
  distancia_m: number | null
  peso_corporal: number | null
  variante: string | null
}

// Lo que vale un peso corporal, en kg (como en Ajustes).
const MINIMO_PESO_CORPORAL = 20
const MAXIMO_PESO_CORPORAL = 400

// Los topes de la API: pasarlos daría un 422 en inglés, así que se dicen antes.
const MAXIMO_PESO = 9999.99
const MAXIMO_REPS = 1000
const MAXIMO_SEGUNDOS = 86400
const MAXIMO_METROS = 1_000_000
const MAXIMO_NUMERO_DE_SERIE = 100

/** Qué tope de la API pasa la serie, dicho en la unidad elegida; nulo si ninguno. */
function topePasado(numero: number, medidas: Omit<DatosDeSerie, 'variante'>): string | null {
  if (numero > MAXIMO_NUMERO_DE_SERIE) {
    return `Un ejercicio no admite más de ${MAXIMO_NUMERO_DE_SERIE} series.`
  }
  if (medidas.peso !== null && Math.abs(medidas.peso) > MAXIMO_PESO) {
    return `El peso no puede pasar de ${numeroLegible(Math.floor(enUnidad(MAXIMO_PESO)))} ${unidad()}.`
  }
  if (medidas.repeticiones !== null && medidas.repeticiones > MAXIMO_REPS) {
    return `Las repeticiones no pueden pasar de ${MAXIMO_REPS}.`
  }
  if (medidas.duracion_s !== null && medidas.duracion_s > MAXIMO_SEGUNDOS) {
    return 'La duración no puede pasar de 24 horas.'
  }
  if (medidas.distancia_m !== null && medidas.distancia_m > MAXIMO_METROS) {
    return `La distancia no puede pasar de ${numeroLegible(Math.floor(enUnidadDeDistancia(MAXIMO_METROS)))} ${unidadDeDistancia()}.`
  }
  return null
}

type Props = {
  numero: number
  // Cómo se apunta el ejercicio: decide qué campos lleva el formulario.
  tipo: TipoRegistro
  // Con qué valores arranca: la serie anterior, la que se edita, o la última vez. Una
  // serie de hoy trae su peso corporal (aunque sea nulo); la última vez, no: entonces
  // arranca con el de Ajustes.
  semilla: {
    peso: string | number | null
    repeticiones: number | null
    duracion_s?: number | null
    distancia_m?: number | null
    peso_corporal?: string | number | null
    variante: string | null
  } | null
  editando: boolean
  // Guardar y Cancelar en la misma línea, en vez del botón grande: al editar una serie
  // siempre, y al añadir una en el día del historial. La serie nueva de la sesión sigue
  // con su botón grande, que es el que se pulsa sin parar mientras se entrena.
  enLinea?: boolean
  // El texto del botón de guardar, si no es el de siempre: en el modo editar del día
  // nada se guarda hasta pulsar Guardar arriba, así que ahí dice Añadir o Aplicar.
  textoGuardar?: string
  alGuardar: (datos: DatosDeSerie) => Promise<void>
  alCancelar: () => void
}

/**
 * El formulario de una serie, con los campos del tipo de su ejercicio en − / + para
 * poder usarlo con una mano y sin teclado:
 *
 * - peso y repeticiones: Peso y Reps;
 * - peso corporal: Carga (con *Lastre* o *Ayuda*; 0 es sin carga), Reps y Peso corporal;
 * - tiempo: Tiempo (minutos y segundos) y Peso, que es opcional;
 * - cardio: Tiempo y Distancia, que es opcional.
 *
 * Arranca con los datos de la serie anterior porque en el gimnasio las series
 * de un hueco repiten ejercicio y peso: lo normal es cambiar solo las
 * repeticiones. Por lo mismo, no se vacía al guardar. Editar una serie usa este
 * mismo formulario con sus datos: no hay un modo de edición aparte.
 */
export function FormularioDeSerie({
  numero,
  tipo,
  semilla,
  editando,
  enLinea = false,
  textoGuardar,
  alGuardar,
  alCancelar,
}: Props) {
  const corporal = tipo === 'corporal'
  const sembrado = semilla?.peso != null ? Number(semilla.peso) : null
  // El peso corporal con el que arranca, en kg. Solo cuenta si el formulario es de
  // peso corporal.
  const inicialCorporal =
    semilla && 'peso_corporal' in semilla
      ? semilla.peso_corporal != null
        ? Number(semilla.peso_corporal)
        : null
      : ajustes().pesoCorporal

  const [peso, setPeso] = useState(
    corporal
      ? pesoLegible(Math.abs(sembrado ?? 0))
      : sembrado !== null
        ? pesoLegible(sembrado)
        : '',
  )
  // Con carga de ayuda, el peso guardado es negativo: aquí se escribe en positivo y el
  // conmutador dice si es ayuda.
  const [ayuda, setAyuda] = useState(corporal && sembrado !== null && sembrado < 0)
  const [repeticiones, setRepeticiones] = useState(
    semilla?.repeticiones != null ? String(semilla.repeticiones) : '',
  )
  const [segundos, setSegundos] = useState(semilla?.duracion_s ?? 0)
  // La distancia, tal y como se teclea: en la unidad elegida, vacía si no se apuntó.
  const [distancia, setDistancia] = useState(
    semilla?.distancia_m ? numeroLegible(enUnidadDeDistancia(semilla.distancia_m), 2) : '',
  )
  const [pesoCorporal, setPesoCorporal] = useState(
    inicialCorporal !== null ? pesoLegible(inicialCorporal) : '',
  )
  const [variante, setVariante] = useState(semilla?.variante ?? '')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  /** Las medidas de la serie según el tipo, o el aviso de lo que falta. */
  function leerMedidas(): Omit<DatosDeSerie, 'variante'> | string {
    if (tipo === 'cardio') {
      if (segundos < 1) return 'Pon cuánto duró.'
      const km = leerNumero(distancia)
      if (distancia.trim() !== '' && (km === null || aMetros(km) < 1)) {
        return 'Pon la distancia, o déjala vacía.'
      }
      return {
        peso: null,
        repeticiones: null,
        duracion_s: segundos,
        distancia_m: distancia.trim() === '' || km === null ? null : aMetros(km),
        peso_corporal: null,
      }
    }
    if (tipo === 'tiempo') {
      if (segundos < 1) return 'Pon cuánto duró.'
      const valor = leerNumero(peso)
      if (peso.trim() !== '' && (valor === null || valor < 0)) return 'Pon el peso, o déjalo vacío.'
      return {
        peso: peso.trim() === '' || valor === null ? null : aKilos(valor),
        repeticiones: null,
        duracion_s: segundos,
        distancia_m: null,
        peso_corporal: null,
      }
    }
    const valor = leerNumero(peso)
    const reps = leerNumero(repeticiones)
    if (valor === null || valor < 0 || reps === null || reps < 1 || !Number.isInteger(reps)) {
      return corporal ? 'Pon la carga y las repeticiones.' : 'Pon el peso y las repeticiones.'
    }
    if (!corporal) {
      return {
        peso: aKilos(valor),
        repeticiones: reps,
        duracion_s: null,
        distancia_m: null,
        peso_corporal: null,
      }
    }
    const carga = aKilos(valor)
    const corporalKg = leerNumero(pesoCorporal)
    if (pesoCorporal.trim() !== '' && corporalKg === null) return 'Pon tu peso corporal.'
    const textoInicial = inicialCorporal !== null ? pesoLegible(inicialCorporal) : ''
    const tocado = pesoCorporal.trim() !== textoInicial
    const nuevoCorporal = !tocado
      ? inicialCorporal
      : corporalKg === null
        ? null
        : aKilos(corporalKg)
    // Solo se comprueba el rango si se cambió: uno ya guardado fuera de él no impide
    // corregir otra cosa.
    if (
      tocado &&
      nuevoCorporal !== null &&
      (nuevoCorporal < MINIMO_PESO_CORPORAL || nuevoCorporal > MAXIMO_PESO_CORPORAL)
    ) {
      return `Pon un peso corporal de ${numeroLegible(Math.ceil(enUnidad(MINIMO_PESO_CORPORAL)))} a ${numeroLegible(Math.floor(enUnidad(MAXIMO_PESO_CORPORAL)))} ${unidad()}.`
    }
    return {
      peso: ayuda && carga > 0 ? -carga : carga,
      repeticiones: reps,
      duracion_s: null,
      distancia_m: null,
      // Si no se tocó, el valor guardado en kg tal cual: pasarlo por lb y de vuelta lo movería.
      peso_corporal: nuevoCorporal,
    }
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    const medidas = leerMedidas()
    if (typeof medidas === 'string') {
      setFallo(medidas)
      return
    }
    const tope = topePasado(numero, medidas)
    if (tope) {
      setFallo(tope)
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      await alGuardar({
        ...medidas,
        variante: variante.trim() === '' ? null : variante.trim(),
      })
    } catch (error) {
      setFallo((error as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  const campoDePeso = (etiqueta: string, extra?: ReactNode) => (
    <CampoConPasos
      etiqueta={etiqueta}
      extra={extra}
      valor={peso}
      cambiar={setPeso}
      // Lo que sube o baja con − / +, en Ajustes (por defecto, 1). Un peso que no
      // cae en el paso (17,5 con paso 1) se teclea en el propio campo, y a partir de
      // ahí − / + lo mueven de paso en paso (16,5, 18,5).
      paso={ajustes().pasoPeso}
      minimo={0}
      decimales
    />
  )

  return (
    <form className="formulario-serie" onSubmit={enviar}>
      {editando && <p className="editando-aviso">Editando la serie {numero}</p>}
      {tipo === 'peso_reps' && (
        <div className="campos-serie">
          {campoDePeso(`Peso (${unidad()})`)}
          <CampoConPasos
            etiqueta="Reps"
            valor={repeticiones}
            cambiar={setRepeticiones}
            paso={1}
            minimo={1}
          />
        </div>
      )}
      {corporal && (
        <>
          {campoDePeso(
            `Carga (${unidad()})`,
            <div className="carga-signo" role="group" aria-label="Tipo de carga">
              <button
                type="button"
                className={ayuda ? undefined : 'activa'}
                aria-pressed={!ayuda}
                onClick={() => setAyuda(false)}
              >
                Lastre
              </button>
              <button
                type="button"
                className={ayuda ? 'activa' : undefined}
                aria-pressed={ayuda}
                onClick={() => setAyuda(true)}
              >
                Ayuda
              </button>
            </div>,
          )}
          <div className="campos-serie">
            <CampoConPasos
              etiqueta="Reps"
              valor={repeticiones}
              cambiar={setRepeticiones}
              paso={1}
              minimo={1}
            />
            <CampoConPasos
              etiqueta={`Peso corporal (${unidad()})`}
              valor={pesoCorporal}
              cambiar={setPesoCorporal}
              paso={ajustes().pasoPeso}
              minimo={0}
              decimales
            />
          </div>
        </>
      )}
      {tipo === 'cardio' && (
        <>
          <CampoDeDuracion
            etiqueta="Tiempo"
            segundos={segundos}
            cambiar={setSegundos}
            paso={ajustes().pasoTiempo}
          />
          <CampoConPasos
            etiqueta={`Distancia (${unidadDeDistancia()}, opcional)`}
            valor={distancia}
            cambiar={setDistancia}
            paso={0.1}
            minimo={0}
            decimales
          />
        </>
      )}
      {tipo === 'tiempo' && (
        <>
          <CampoDeDuracion
            etiqueta="Tiempo"
            segundos={segundos}
            cambiar={setSegundos}
            paso={ajustes().pasoTiempo}
          />
          {campoDePeso(`Peso (${unidad()}, opcional)`)}
        </>
      )}
      <label className="campo">
        <span className="campo-etiqueta">Variante (opcional)</span>
        <input
          className="campo-texto"
          type="text"
          maxLength={100}
          value={variante}
          placeholder="agarre cerrado, sentado…"
          onChange={(evento) => setVariante(evento.target.value)}
        />
      </label>
      {editando || enLinea ? (
        <div className="botones-en-linea">
          <button
            type="button"
            className="boton boton-cancelar"
            onClick={alCancelar}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button type="submit" className="boton boton-principal" disabled={guardando}>
            {textoGuardar ?? (editando ? 'Guardar cambios' : `Guardar serie ${numero}`)}
          </button>
        </div>
      ) : (
        <button type="submit" className="boton boton-principal" disabled={guardando}>
          Guardar serie {numero}
        </button>
      )}
      {fallo && <p className="fallo">{fallo}</p>}
    </form>
  )
}

export function CampoConPasos({
  etiqueta,
  valor,
  cambiar,
  paso,
  minimo,
  decimales = false,
  extra,
}: {
  etiqueta: string
  valor: string
  cambiar: (valor: string) => void
  paso: number
  minimo: number
  decimales?: boolean
  // Algo a la derecha de la etiqueta (el conmutador Lastre / Ayuda de la carga).
  extra?: ReactNode
}) {
  function sumar(cuanto: number) {
    const actual = leerNumero(valor) ?? (cuanto > 0 ? minimo - cuanto : minimo)
    // Redondeado a centésimas solo para quitar el ruido de los decimales en coma
    // flotante (17,5 + 1 no debe quedar en 18,499999).
    const nuevo = Math.max(minimo, Math.round((actual + cuanto) * 100) / 100)
    cambiar(decimales ? numeroLegible(nuevo) : String(nuevo))
  }

  return (
    <div className="campo">
      {extra ? (
        <div className="campo-etiqueta-fila">
          <span className="campo-etiqueta">{etiqueta}</span>
          {extra}
        </div>
      ) : (
        <span className="campo-etiqueta">{etiqueta}</span>
      )}
      <div className="pasos">
        <button type="button" onClick={() => sumar(-paso)} aria-label={`Menos ${etiqueta}`}>
          <Icono nombre="menos" />
        </button>
        <input
          className="num"
          type="text"
          inputMode={decimales ? 'decimal' : 'numeric'}
          value={valor}
          aria-label={etiqueta}
          onChange={(evento) => cambiar(evento.target.value)}
          onFocus={(evento) => evento.target.select()}
        />
        <button type="button" onClick={() => sumar(paso)} aria-label={`Más ${etiqueta}`}>
          <Icono nombre="mas" />
        </button>
      </div>
    </div>
  )
}
