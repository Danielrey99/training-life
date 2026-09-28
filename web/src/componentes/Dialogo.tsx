import { useEffect, useState } from 'react'

import './Dialogo.css'

type Props = {
  titulo: string
  cuerpo: string
  // El botón dice lo que hace ("Borrar", "Terminar"), nunca "Sí".
  confirmar: string
  cancelar?: string
  // En rojo lo que no se puede deshacer; en verde lo demás.
  peligro?: boolean
  alConfirmar: () => Promise<void>
  alCancelar: () => void
}

/**
 * La confirmación que piden los bocetos antes de todo lo que empieza, termina o
 * borra algo: título, qué se pierde y qué no, y los dos botones.
 *
 * Espera a que termine la acción antes de cerrarse, y si falla enseña el motivo
 * dentro del propio diálogo: cerrarlo sin más haría creer que se hizo.
 */
export function Dialogo({
  titulo,
  cuerpo,
  confirmar,
  cancelar = 'Cancelar',
  peligro = false,
  alConfirmar,
  alCancelar,
}: Props) {
  const [enCurso, setEnCurso] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape' && !enCurso) alCancelar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [enCurso, alCancelar])

  async function aceptar() {
    setEnCurso(true)
    setFallo(null)
    try {
      await alConfirmar()
    } catch (error) {
      setFallo((error as Error).message)
      setEnCurso(false)
    }
  }

  return (
    <div className="dialogo-fondo" onClick={() => !enCurso && alCancelar()}>
      <div
        className="dialogo"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialogo-titulo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <h2 id="dialogo-titulo">{titulo}</h2>
        <p>{cuerpo}</p>
        {fallo && <p className="dialogo-fallo">{fallo}</p>}
        <div className="dialogo-botones">
          <button type="button" className="boton" onClick={alCancelar} disabled={enCurso}>
            {cancelar}
          </button>
          <button
            type="button"
            className={peligro ? 'boton boton-peligro' : 'boton boton-principal'}
            onClick={() => void aceptar()}
            disabled={enCurso}
            autoFocus
          >
            {confirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
