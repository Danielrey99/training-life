import { useEffect, useRef, useState } from 'react'

import type { GrupoMuscular } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import './ejercicio.css'

type Props = {
  // Los que tienen algo que elegir, por orden alfabético.
  grupos: GrupoMuscular[]
  elegido: number | null
  alElegir: (grupo: number | null) => void
}

export const TODOS_LOS_GRUPOS = 'Todos los grupos musculares'

/**
 * El filtro por grupo muscular de la hoja de elegir ejercicio: un campo que despliega
 * la lista justo debajo, del mismo ancho, con barra de desplazamiento si no cabe.
 *
 * Hecho a mano y no con un `<select>`: la lista del sistema la coloca y la mide el
 * navegador (salía más ancha que el campo, hacia arriba y con el color del campo), y
 * abrir otra hoja encima de esta hoja no era opción.
 */
export function DesplegableDeGrupo({ grupos, elegido, alElegir }: Props) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    // Tocar fuera lo cierra, como la lista del sistema.
    function alTocar(evento: PointerEvent) {
      if (!caja.current?.contains(evento.target as Node)) setAbierto(false)
    }
    document.addEventListener('pointerdown', alTocar)
    return () => document.removeEventListener('pointerdown', alTocar)
  }, [abierto])

  function elegir(grupo: number | null) {
    alElegir(grupo)
    setAbierto(false)
  }

  const nombre = grupos.find((uno) => uno.id === elegido)?.nombre ?? TODOS_LOS_GRUPOS
  const opcion = (id: number | null, texto: string) => (
    <button
      key={id ?? 'todos'}
      type="button"
      role="option"
      aria-selected={elegido === id}
      className={elegido === id ? 'desplegable-opcion elegida' : 'desplegable-opcion'}
      onClick={() => elegir(id)}
    >
      {texto}
    </button>
  )

  return (
    <div
      ref={caja}
      className="ejercicio-filtro"
      onKeyDown={(evento) => {
        // Escape cierra la lista y no la hoja de debajo.
        if (evento.key === 'Escape' && abierto) {
          evento.stopPropagation()
          setAbierto(false)
        }
      }}
    >
      <button
        type="button"
        className={`ejercicio-filtro-campo${elegido === null ? '' : ' elegido'}`}
        aria-label="Grupo muscular"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => setAbierto(!abierto)}
      >
        {nombre}
      </button>
      <Icono nombre={abierto ? 'arriba' : 'abajo'} pequeno />
      {abierto && (
        <div className="desplegable-lista" role="listbox" aria-label="Grupo muscular">
          {opcion(null, TODOS_LOS_GRUPOS)}
          {grupos.map((uno) => opcion(uno.id, uno.nombre))}
        </div>
      )}
    </div>
  )
}
