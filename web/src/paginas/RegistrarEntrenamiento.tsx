import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, ErrorDeApi } from '../api/cliente'
import type { Entrenamiento, Rutina } from '../api/tipos'
import { hoy } from '../utiles/fechas'

const SESIONES_RECIENTES = 5

/**
 * Punto de entrada provisional a la sesión, mientras no exista la pantalla de
 * Hoy: se elige la fecha y la rutina y se empieza, o se retoma una sesión ya
 * empezada. La sesión en sí es otra pantalla (`/sesion/{id}`).
 */
export function RegistrarEntrenamiento() {
  const [rutinas, setRutinas] = useState<Rutina[]>([])
  const [sesiones, setSesiones] = useState<Entrenamiento[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navegar = useNavigate()

  useEffect(() => {
    Promise.all([api.rutinas(), api.entrenamientos()])
      .then(([listaRutinas, listaSesiones]) => {
        setRutinas(listaRutinas)
        setSesiones(listaSesiones)
      })
      .catch((error: Error) => setError(error.message))
      .finally(() => setCargando(false))
  }, [])

  async function empezar(fecha: string, rutinaId: number | null) {
    try {
      const sesion = await api.crearEntrenamiento({
        rutina_id: rutinaId,
        fecha,
        notas: null,
      })
      navegar(`/sesion/${sesion.id}`)
    } catch (fallo) {
      // Con otra sesión en curso hoy, el backend dice cuál: se continúa esa en
      // vez de dejar al usuario atascado con un error.
      const detalle = fallo instanceof ErrorDeApi && fallo.estado === 409 ? fallo.detalle : null
      if (detalle && typeof detalle === 'object' && 'entrenamiento_id' in detalle) {
        navegar(`/sesion/${detalle.entrenamiento_id}`)
        return
      }
      throw fallo
    }
  }

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

  return (
    <ElegirSesion
      rutinas={rutinas}
      sesiones={sesiones}
      empezar={empezar}
      continuar={(sesion) => navegar(`/sesion/${sesion.id}`)}
    />
  )
}

/** Paso previo: empezar una sesión nueva o retomar una que quedó a medias. */
function ElegirSesion({
  rutinas,
  sesiones,
  empezar,
  continuar,
}: {
  rutinas: Rutina[]
  sesiones: Entrenamiento[]
  empezar: (fecha: string, rutinaId: number | null) => Promise<void>
  continuar: (sesion: Entrenamiento) => void
}) {
  const [fecha, setFecha] = useState(hoy())
  const [rutinaId, setRutinaId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const nombreDeRutina = new Map(rutinas.map((rutina) => [rutina.id, rutina.nombre]))

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setFallo(null)
    try {
      await empezar(fecha, rutinaId === '' ? null : Number(rutinaId))
    } catch (error) {
      setFallo((error as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <h2>Registrar entrenamiento</h2>

      <form className="tarjeta formulario" onSubmit={enviar}>
        <div className="campos">
          <label>
            Fecha
            <input
              type="date"
              value={fecha}
              required
              onChange={(evento) => setFecha(evento.target.value)}
            />
          </label>
          <label className="ancho">
            Rutina
            <select value={rutinaId} onChange={(evento) => setRutinaId(evento.target.value)}>
              <option value="">Entrenamiento libre (sin rutina)</option>
              {rutinas.map((rutina) => (
                <option key={rutina.id} value={rutina.id}>
                  {rutina.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={guardando}>
          {guardando ? 'Empezando…' : 'Empezar sesión'}
        </button>
        {fallo && <p className="aviso error">{fallo}</p>}
      </form>

      {rutinas.length === 0 && (
        <p className="aviso">
          Todavía no hay rutinas. Se crean con <code>POST /rutinas</code> mientras la pantalla para
          gestionarlas no exista; sin rutina, la sesión se registra como entrenamiento libre.
        </p>
      )}

      {sesiones.length > 0 && (
        <>
          <h3>O continúa una sesión ya empezada</h3>
          <ul className="tarjetas">
            {sesiones.slice(0, SESIONES_RECIENTES).map((sesion) => (
              <li key={sesion.id} className="tarjeta">
                <strong>{sesion.fecha}</strong>
                <span className="etiqueta">
                  {sesion.rutina_id === null
                    ? 'Libre'
                    : (nombreDeRutina.get(sesion.rutina_id) ?? 'Rutina oculta')}
                </span>
                <p className="descripcion">
                  {sesion.series.length === 1 ? '1 serie' : `${sesion.series.length} series`}
                </p>
                <button type="button" className="secundario" onClick={() => continuar(sesion)}>
                  Continuar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
