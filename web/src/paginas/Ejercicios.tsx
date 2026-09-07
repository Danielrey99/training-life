import { useEffect, useState } from 'react'

import { api } from '../api/cliente'
import type { Ejercicio, GrupoMuscular } from '../api/tipos'

/**
 * La biblioteca de ejercicios: los predefinidos más los del usuario.
 *
 * Pide también los grupos musculares porque la API devuelve `grupo_muscular_id`
 * y no su nombre, así que hay que cruzarlos aquí.
 */
export function Ejercicios() {
  const [ejercicios, setEjercicios] = useState<Ejercicio[]>([])
  const [grupos, setGrupos] = useState<GrupoMuscular[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    Promise.all([api.ejercicios(), api.gruposMusculares()])
      .then(([listaEjercicios, listaGrupos]) => {
        setEjercicios(listaEjercicios)
        setGrupos(listaGrupos)
      })
      .catch((fallo: Error) => setError(fallo.message))
      .finally(() => setCargando(false))
  }, [])

  const nombreDelGrupo = new Map(grupos.map((grupo) => [grupo.id, grupo.nombre]))

  if (cargando) return <p className="aviso">Cargando…</p>
  if (error) {
    return (
      <p className="aviso error">
        {error}
        <br />
        <small>¿Está levantado el backend? `docker compose up -d` en la raíz del repo.</small>
      </p>
    )
  }
  if (ejercicios.length === 0) {
    return (
      <p className="aviso">
        Todavía no hay ejercicios. Se crean con <code>POST /ejercicios</code> mientras la pantalla
        para añadirlos no exista.
      </p>
    )
  }

  return (
    <>
      <h2>Ejercicios ({ejercicios.length})</h2>
      <ul className="tarjetas">
        {ejercicios.map((ejercicio) => (
          <li key={ejercicio.id} className="tarjeta">
            <strong>{ejercicio.nombre}</strong>
            <span className="etiqueta">
              {nombreDelGrupo.get(ejercicio.grupo_muscular_id) ?? 'Sin grupo'}
            </span>
            {ejercicio.descripcion && <p className="descripcion">{ejercicio.descripcion}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}
