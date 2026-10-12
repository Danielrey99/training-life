import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { GrupoMuscular } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { useVolver } from '../../utiles/volver'
import '../historial/historial.css'
import '../sesion/sesion.css'
import './ejercicios.css'

type Falta = { nombre?: string; grupo?: string }

/**
 * X3 · Ejercicio nuevo o editar uno tuyo: nombre, grupo muscular y una descripción
 * opcional. Lo que es de cada uno (un ajuste, cómo le sale mejor) va en las notas de
 * la ficha, no aquí: la descripción es del ejercicio.
 *
 * Nada se guarda hasta pulsar *Guardar*. Un predefinido o uno oculto no se editan:
 * si se llega a su dirección, se vuelve a la ficha, que explica por qué.
 */
export function Formulario() {
  const { ejercicioId } = useParams()
  const id = ejercicioId === undefined ? null : Number(ejercicioId)
  const navegar = useNavigate()
  const volver = useVolver()
  const [grupos, setGrupos] = useState<GrupoMuscular[] | null>(null)
  const [nombre, setNombre] = useState('')
  const [grupo, setGrupo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [falta, setFalta] = useState<Falta>({})
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const padre = id === null ? '/ejercicios' : `/ejercicios/${id}`

  useEffect(() => {
    let vigente = true
    Promise.all([api.gruposMusculares(), id === null ? null : api.ejercicio(id)])
      .then(([todos, ejercicio]) => {
        if (!vigente) return
        if (ejercicio && (ejercicio.es_predefinido || ejercicio.oculto_desde !== null)) {
          navegar(`/ejercicios/${ejercicio.id}`, { replace: true })
          return
        }
        if (ejercicio) {
          setNombre(ejercicio.nombre)
          setGrupo(String(ejercicio.grupo_muscular_id))
          setDescripcion(ejercicio.descripcion ?? '')
        }
        setGrupos(todos.sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es')))
      })
      .catch((problema: Error) => {
        if (vigente) setError(problema.message)
      })
    return () => {
      vigente = false
    }
  }, [id, navegar])

  /** Lo que falta, con un mensaje legible: mejor que el 422 de la API. */
  function queFalta(): Falta {
    const pendiente: Falta = {}
    if (nombre.trim() === '') pendiente.nombre = 'Escribe cómo se llama.'
    if (grupo === '') pendiente.grupo = 'Elige el grupo muscular que trabaja.'
    return pendiente
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const pendiente = queFalta()
    setFalta(pendiente)
    if (pendiente.nombre || pendiente.grupo) return

    setGuardando(true)
    setFallo(null)
    const datos = {
      nombre: nombre.trim(),
      grupo_muscular_id: Number(grupo),
      descripcion: descripcion.trim() === '' ? null : descripcion.trim(),
    }
    try {
      if (id === null) {
        const creado = await api.crearEjercicio(datos)
        // Con replace: volver desde la ficha lleva a la biblioteca, no al formulario.
        navegar(`/ejercicios/${creado.id}`, { replace: true })
      } else {
        await api.actualizarEjercicio(id, datos)
        volver(padre)
      }
    } catch (problema) {
      setFallo((problema as Error).message)
      setGuardando(false)
    }
  }

  if (error) return <p className="aviso error">{error}</p>
  if (!grupos) return <p className="aviso">Cargando…</p>

  return (
    <form className="formulario-ejercicio" onSubmit={guardar} noValidate>
      <header className="sesion-cabecera">
        <button
          type="button"
          className="boton-icono"
          aria-label="Volver"
          onClick={() => volver(padre)}
          disabled={guardando}
        >
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>{id === null ? 'Nuevo ejercicio' : 'Editar ejercicio'}</h1>
        </div>
        <button type="submit" className="dia-cabecera-boton" disabled={guardando}>
          Guardar
        </button>
      </header>

      {fallo && <p className="aviso error">{fallo}</p>}

      <label className="campo">
        <span className="campo-etiqueta">Nombre</span>
        <input
          className="campo-texto"
          value={nombre}
          maxLength={100}
          placeholder="Ej. Jalón en polea"
          onChange={(evento) => {
            setNombre(evento.target.value)
            setFalta((antes) => ({ ...antes, nombre: undefined }))
          }}
        />
        {falta.nombre && <span className="fallo">{falta.nombre}</span>}
      </label>

      <label className="campo">
        <span className="campo-etiqueta">Grupo muscular</span>
        <select
          className="campo-texto"
          value={grupo}
          onChange={(evento) => {
            setGrupo(evento.target.value)
            setFalta((antes) => ({ ...antes, grupo: undefined }))
          }}
        >
          <option value="" disabled>
            Elige uno
          </option>
          {grupos.map((uno) => (
            <option key={uno.id} value={uno.id}>
              {uno.nombre}
            </option>
          ))}
        </select>
        {falta.grupo && <span className="fallo">{falta.grupo}</span>}
      </label>

      <label className="campo">
        <span className="campo-etiqueta">Descripción (opcional)</span>
        <textarea
          className="campo-texto detalle-campo"
          rows={4}
          maxLength={500}
          value={descripcion}
          placeholder="Cómo se ejecuta, qué máquina hace falta…"
          onChange={(evento) => setDescripcion(evento.target.value)}
        />
      </label>
    </form>
  )
}
