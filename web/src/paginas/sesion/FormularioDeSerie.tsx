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
export function FormularioDeSerie({ numero, semilla, editando, alGuardar, alCancelar }: Props) {
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
      <button type="submit" className="boton boton-principal" disabled={guardando}>
        {editando ? `Guardar cambios · serie ${numero}` : `Guardar serie ${numero}`}
      </button>
      {editando && (
        <button type="button" className="boton boton-texto" onClick={alCancelar}>
          Cancelar
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
