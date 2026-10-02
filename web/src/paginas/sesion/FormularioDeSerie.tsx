import { useState } from 'react'
import type { FormEvent } from 'react'

import { Icono } from '../../componentes/Icono'
import { leerNumero, pesoLegible } from '../../utiles/numeros'

// Lo que sube o baja el peso con − / +. Un peso con decimales (17,5) se teclea en
// el propio campo, y a partir de ahí − / + lo mueven de uno en uno (16,5, 18,5).
const PASO_PESO = 1

export type DatosDeSerie = {
  peso: number
  repeticiones: number
  variante: string | null
}

type Props = {
  numero: number
  // Con qué valores arranca: la serie anterior, la que se edita, o la última vez.
  semilla: {
    peso: string | number
    repeticiones: number
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
 * El formulario de una serie, con peso y repeticiones en − / + para poder
 * usarlo con una mano y sin teclado.
 *
 * Arranca con los datos de la serie anterior porque en el gimnasio las series
 * de un hueco repiten ejercicio y peso: lo normal es cambiar solo las
 * repeticiones. Por lo mismo, no se vacía al guardar. Editar una serie usa este
 * mismo formulario con sus datos: no hay un modo de edición aparte.
 */
export function FormularioDeSerie({
  numero,
  semilla,
  editando,
  enLinea = false,
  textoGuardar,
  alGuardar,
  alCancelar,
}: Props) {
  const [peso, setPeso] = useState(semilla ? pesoLegible(semilla.peso) : '')
  const [repeticiones, setRepeticiones] = useState(semilla ? String(semilla.repeticiones) : '')
  const [variante, setVariante] = useState(semilla?.variante ?? '')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    const kilos = leerNumero(peso)
    const reps = leerNumero(repeticiones)
    if (kilos === null || kilos < 0 || reps === null || reps < 1 || !Number.isInteger(reps)) {
      setFallo('Pon el peso y las repeticiones.')
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      await alGuardar({
        peso: kilos,
        repeticiones: reps,
        variante: variante.trim() === '' ? null : variante.trim(),
      })
    } catch (error) {
      setFallo((error as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form className="formulario-serie" onSubmit={enviar}>
      {editando && <p className="editando-aviso">Editando la serie {numero}</p>}
      <div className="campos-serie">
        <CampoConPasos
          etiqueta="Peso (kg)"
          valor={peso}
          cambiar={setPeso}
          paso={PASO_PESO}
          minimo={0}
          decimales
        />
        <CampoConPasos
          etiqueta="Reps"
          valor={repeticiones}
          cambiar={setRepeticiones}
          paso={1}
          minimo={1}
        />
      </div>
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

function CampoConPasos({
  etiqueta,
  valor,
  cambiar,
  paso,
  minimo,
  decimales = false,
}: {
  etiqueta: string
  valor: string
  cambiar: (valor: string) => void
  paso: number
  minimo: number
  decimales?: boolean
}) {
  function sumar(cuanto: number) {
    const actual = leerNumero(valor) ?? (cuanto > 0 ? minimo - cuanto : minimo)
    // Redondeado a centésimas solo para quitar el ruido de los decimales en coma
    // flotante (17,5 + 1 no debe quedar en 18,499999).
    const nuevo = Math.max(minimo, Math.round((actual + cuanto) * 100) / 100)
    cambiar(decimales ? pesoLegible(nuevo) : String(nuevo))
  }

  return (
    <div className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
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
