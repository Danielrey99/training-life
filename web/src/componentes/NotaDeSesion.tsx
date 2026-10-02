import { useState } from 'react'
import type { FormEvent } from 'react'

import { Dialogo } from './Dialogo'
import { Icono } from './Icono'

import './NotaDeSesion.css'

type Props = {
  nota: string | null
  // Si se puede añadir, cambiar o borrar: siempre en la sesión, y en un día del
  // historial solo con Editar.
  editable: boolean
  // Si el campo está abierto. Lo lleva la pantalla, porque las ediciones van de una en
  // una: mientras haya otra abierta (una serie), esta no se puede abrir.
  abierta: boolean
  alAbrir: () => void
  alCerrar: () => void
  // Otra edición está abierta: el lápiz, la ✕ y Añadir nota se quedan en gris.
  bloqueada?: boolean
  // En el modo editar del día nada se guarda hasta pulsar Guardar arriba: el botón dice
  // Añadir o Aplicar, y borrarla se puede deshacer con Cancelar.
  enBorrador?: boolean
  // Guarda la nota nueva, o la borra con null.
  alGuardar: (nota: string | null) => Promise<void>
}

/**
 * La nota de una sesión, igual en la sesión en curso y en el día del historial.
 *
 * En la sesión se puede escribir en cualquier momento, no solo al terminar: lo que
 * se quiere apuntar ("el banco de barra estaba ocupado") se olvida si hay que
 * esperar al final. Se maneja como una serie más: lápiz para cambiarla y ✕ para
 * borrarla (que pregunta antes), y el campo se guarda con su propio Guardar.
 */
export function NotaDeSesion({
  nota,
  editable,
  abierta,
  alAbrir,
  alCerrar,
  bloqueada = false,
  enBorrador = false,
  alGuardar,
}: Props) {
  const [texto, setTexto] = useState(nota ?? '')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [borrando, setBorrando] = useState(false)

  function abrir() {
    setTexto(nota ?? '')
    setFallo(null)
    alAbrir()
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setFallo(null)
    try {
      await alGuardar(texto.trim() === '' ? null : texto.trim())
      alCerrar()
    } catch (error) {
      setFallo((error as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  if (abierta && editable) {
    return (
      <form className="nota-sesion" onSubmit={enviar}>
        <label className="campo">
          <span className="campo-etiqueta">Nota</span>
          <textarea
            className="campo-texto"
            rows={3}
            maxLength={1000}
            value={texto}
            placeholder="Cómo va, qué cambiar la próxima vez…"
            onChange={(evento) => setTexto(evento.target.value)}
            autoFocus
          />
        </label>
        <div className="botones-en-linea">
          <button
            type="button"
            className="boton boton-cancelar"
            onClick={alCerrar}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button type="submit" className="boton boton-principal" disabled={guardando}>
            {enBorrador ? (nota ? 'Aplicar' : 'Añadir') : 'Guardar'}
          </button>
        </div>
        {fallo && <p className="fallo">{fallo}</p>}
      </form>
    )
  }

  if (!nota) {
    return editable ? (
      <button
        type="button"
        className="boton boton-texto nota-sesion-anadir"
        onClick={abrir}
        disabled={bloqueada}
      >
        <Icono nombre="editar" pequeno />
        Añadir nota
      </button>
    ) : null
  }

  return (
    <section className="nota-sesion">
      <div className="nota-sesion-cabecera">
        <span className="rotulo">Nota</span>
        {editable && (
          <>
            <button
              type="button"
              className="boton-icono"
              aria-label="Cambiar la nota"
              onClick={abrir}
              disabled={bloqueada}
            >
              <Icono nombre="editar" pequeno />
            </button>
            <button
              type="button"
              className="boton-icono quitar"
              aria-label="Borrar la nota"
              onClick={() => setBorrando(true)}
              disabled={bloqueada}
            >
              <Icono nombre="quitar" pequeno />
            </button>
          </>
        )}
      </div>
      <p>{nota}</p>
      {borrando && (
        <Dialogo
          titulo="¿Borrar la nota?"
          cuerpo={enBorrador ? 'Se borrará al pulsar Guardar.' : 'No se puede deshacer.'}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await alGuardar(null)
            setBorrando(false)
          }}
          alCancelar={() => setBorrando(false)}
        />
      )}
    </section>
  )
}
