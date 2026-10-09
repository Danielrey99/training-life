import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { DiaSemana, Programa, Rutina } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { Interruptor } from '../../componentes/Interruptor'
import { useVolver } from '../../utiles/volver'
import '../historial/historial.css'
import '../sesion/sesion.css'
import {
  DIAS,
  guardarBorrador,
  leerBorrador,
  PROGRAMA_NUEVO,
  sinDias,
  tirarBorrador,
  type BorradorDePrograma,
} from './borradores'
import { DiasEditables } from './DiasEditables'
import { HojaDeRutinas } from './HojaDeRutinas'
import './semana.css'

type Datos = { activo: Programa | undefined; rutinas: Rutina[] }

/** Lo justo para pintar el día: el borrador se guarda entero en el navegador. */
function minima(rutina: Rutina) {
  return { id: rutina.id, nombre: rutina.nombre, oculto_desde: rutina.oculto_desde }
}

/**
 * P5 · Programa nuevo: el nombre, si se activa al crearlo y la rutina de cada día.
 *
 * Nada se guarda hasta *Crear*, que lo manda todo en una sola petición. El borrador
 * sobrevive a ir a crear una rutina nueva desde la hoja de un día y volver: esa
 * rutina vuelve puesta en el día desde el que se pidió.
 */
export function ProgramaNuevo() {
  const navegar = useNavigate()
  const volver = useVolver()
  const ubicacion = useLocation()
  const empezar = (ubicacion.state as { empezar?: boolean } | null)?.empezar === true

  const [datos, setDatos] = useState<Datos | null>(null)
  const [borrador, setBorrador] = useState<BorradorDePrograma | null>(() =>
    empezar ? null : leerBorrador<BorradorDePrograma>(PROGRAMA_NUEVO),
  )
  const [error, setError] = useState<string | null>(null)
  const [hojaDe, setHojaDe] = useState<DiaSemana | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    Promise.all([api.programas(), api.rutinas()])
      .then(([programas, rutinas]) => {
        if (!vigente) return
        const activo = programas.find((uno) => uno.activo)
        setDatos({ activo, rutinas })
        // Nace sin activar (decisión del autor): activarlo es algo que se elige a propósito.
        setBorrador((antes) => antes ?? { nombre: '', activar: false, dias: sinDias() })
      })
      .catch((fallo: Error) => {
        if (vigente) setError(fallo.message)
      })
    return () => {
      vigente = false
    }
  }, [])

  useEffect(() => {
    if (borrador) guardarBorrador(PROGRAMA_NUEVO, borrador)
  }, [borrador])

  // La marca de empezar se quita de la entrada del historial: al volver aquí de crear
  // una rutina, el borrador se tiene que conservar.
  useEffect(() => {
    if (empezar) navegar(ubicacion.pathname, { replace: true, state: null })
  }, [empezar, navegar, ubicacion.pathname])

  const cerrarHoja = useCallback(() => setHojaDe(null), [])

  if (error) return <p className="aviso error">{error}</p>
  if (!datos || !borrador) return <p className="aviso">Cargando…</p>

  const { activo, rutinas } = datos

  function cambiar(cambios: Partial<BorradorDePrograma>) {
    setBorrador((antes) => (antes ? { ...antes, ...cambios } : antes))
  }

  function salir() {
    tirarBorrador(PROGRAMA_NUEVO)
    volver('/programas')
  }

  async function crear() {
    const nombre = borrador!.nombre.trim()
    if (!nombre) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      const programa = await api.crearPrograma({
        nombre,
        activar: borrador!.activar,
        dias: DIAS.flatMap((dia) => {
          const rutina = borrador!.dias[dia]
          return rutina ? [{ dia_semana: dia, rutina_id: rutina.id }] : []
        }),
      })
      tirarBorrador(PROGRAMA_NUEVO)
      navegar(`/programas/${programa.id}`, { replace: true })
    } catch (fallo) {
      setFallo((fallo as Error).message)
      setGuardando(false)
    }
  }

  return (
    <div className="semana">
      <header className="sesion-cabecera">
        <button type="button" className="boton-icono" aria-label="Volver" onClick={salir}>
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>Nuevo programa</h1>
        </div>
        <button
          type="button"
          className="dia-cabecera-boton"
          onClick={() => void crear()}
          disabled={guardando}
        >
          Crear
        </button>
      </header>

      {fallo && <p className="aviso error">{fallo}</p>}

      <label className="campo">
        <span className="campo-etiqueta">Nombre</span>
        <input
          className="campo-texto"
          value={borrador.nombre}
          maxLength={100}
          placeholder="Ej. PPL de 5 días"
          onChange={(evento) => {
            cambiar({ nombre: evento.target.value })
            setFalloNombre(null)
          }}
        />
        {falloNombre && <span className="fallo">{falloNombre}</span>}
      </label>

      <Interruptor
        titulo="Activarlo al crearlo"
        ayuda={
          activo
            ? `Marcará qué rutina toca cada día, en lugar de ${activo.nombre}`
            : 'Marcará qué rutina toca cada día'
        }
        encendido={borrador.activar}
        alCambiar={() => cambiar({ activar: !borrador.activar })}
        desactivado={guardando}
      />

      <h2 className="semana-rotulo">Días</h2>
      <DiasEditables
        dias={borrador.dias}
        diasDelActivo={activo?.dias}
        alAbrir={setHojaDe}
        alQuitar={(dia) => cambiar({ dias: { ...borrador.dias, [dia]: null } })}
        desactivado={guardando}
      />

      <p className="semana-parrafo">
        Pulsa <Icono nombre="mas" pequeno /> en un día para asignarle una rutina, nueva o de las que
        ya tienes. Los días vacíos son descanso.
      </p>

      {hojaDe !== null && (
        <HojaDeRutinas
          diaSemana={hojaDe}
          rutinas={rutinas}
          diasDelActivo={activo?.dias}
          elegida={borrador.dias[hojaDe]?.id ?? null}
          alElegir={(rutina) => {
            cambiar({ dias: { ...borrador.dias, [hojaDe]: minima(rutina) } })
            setHojaDe(null)
          }}
          alCerrar={cerrarHoja}
          alCrearNueva={() =>
            navegar(`/programas/rutinas/nueva?dia=${hojaDe}`, { state: { empezar: true } })
          }
        />
      )}
    </div>
  )
}
