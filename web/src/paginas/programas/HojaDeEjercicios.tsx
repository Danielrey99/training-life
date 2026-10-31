import { useEffect, useState } from 'react'

import type { Ejercicio, GrupoMuscular } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import '../historial/historial.css'
import { DesplegableDeGrupo } from './DesplegableDeGrupo'
import './ejercicio.css'
import { deDonde } from './textos'

type Props = {
  titulo: string
  subtitulo: string
  // Los visibles: lo oculto deja de ofrecerse.
  ejercicios: Ejercicio[]
  grupos: GrupoMuscular[]
  // Los que no se pueden elegir aquí (el principal, al elegir una alternativa).
  excluir: number[]
  elegido: number | null
  alElegir: (ejercicio: Ejercicio) => void
  alCerrar: () => void
}

/** Sin mayúsculas ni tildes, para que "presion" encuentre "Press inclinado" y "jalón". */
function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * La hoja de elegir ejercicio de P4: un buscador, el filtro por grupo muscular (un
 * desplegable con solo los grupos que tienen algo que elegir) y la lista, por nombre. Elegir no guarda
 * nada: rellena el formulario.
 */
export function HojaDeEjercicios({
  titulo,
  subtitulo,
  ejercicios,
  grupos,
  excluir,
  elegido,
  alElegir,
  alCerrar,
}: Props) {
  const [texto, setTexto] = useState('')
  const [grupo, setGrupo] = useState<number | null>(null)

  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [alCerrar])

  const nombreDeGrupo = new Map(grupos.map((uno) => [uno.id, uno.nombre]))
  const elegibles = ejercicios
    .filter((ejercicio) => !excluir.includes(ejercicio.id))
    .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'))
  const conEjercicios = grupos
    .filter((uno) => elegibles.some((ejercicio) => ejercicio.grupo_muscular_id === uno.id))
    .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'))
  const buscado = normalizar(texto.trim())
  const lista = elegibles.filter(
    (ejercicio) =>
      (grupo === null || ejercicio.grupo_muscular_id === grupo) &&
      normalizar(ejercicio.nombre).includes(buscado),
  )

  return (
    <div className="hoja-fondo" onClick={alCerrar}>
      <div
        className="hoja ejercicio-hoja"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoja-titulo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <span className="hoja-asa" />
        <h2 id="hoja-titulo">{titulo}</h2>
        <p className="hoja-subtitulo">{subtitulo}</p>

        <label className="ejercicio-buscador">
          <Icono nombre="buscar" pequeno />
          <input
            type="search"
            placeholder="Buscar ejercicio"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
          />
        </label>

        {/* Un desplegable y no otra hoja: esta ya es una hoja. */}
        <DesplegableDeGrupo grupos={conEjercicios} elegido={grupo} alElegir={setGrupo} />

        {lista.length === 0 && (
          <p className="hoja-vacia">
            {elegibles.length === 0
              ? 'No hay más ejercicios para elegir.'
              : 'Ningún ejercicio se llama así.'}
          </p>
        )}
        {lista.map((ejercicio) => (
          <button
            key={ejercicio.id}
            type="button"
            className="hoja-fila"
            onClick={() => alElegir(ejercicio)}
          >
            <span className="hoja-fila-texto">
              <strong>{ejercicio.nombre}</strong>
              <span>{deDonde(ejercicio, nombreDeGrupo)}</span>
            </span>
            {elegido === ejercicio.id && <Icono nombre="elegido" pequeno />}
          </button>
        ))}

        <p className="ejercicio-hoja-pie">
          Los ejercicios ocultos no salen. Puedes volver a mostrarlos en la pestaña Ejercicios.
        </p>
      </div>
    </div>
  )
}
