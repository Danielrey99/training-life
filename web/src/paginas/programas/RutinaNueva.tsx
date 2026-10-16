import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { DiaSemana } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { useVolver } from '../../utiles/volver'
import '../historial/historial.css'
import '../sesion/sesion.css'
import {
  guardarBorrador,
  leerBorrador,
  PROGRAMA_NUEVO,
  RUTINA_NUEVA,
  tirarBorrador,
  semanaEnEdicion,
  type BorradorDeRutina,
  type DiasConNombre,
} from './borradores'
import { ListaDeEjercicios } from './ListaDeEjercicios'
import './rutina.css'
import { lineaDeAlternativas, NOMBRES_DE_LOS_DIAS, objetivo } from './textos'

/**
 * P3 en estado nueva · Crear una rutina: el nombre y sus ejercicios.
 *
 * Todo va a un borrador (también lo que se guarda en el formulario de cada ejercicio,
 * que solo lo apunta en la lista): nada llega a la API hasta el *Guardar* de esta
 * pantalla, que crea la rutina con todos sus ejercicios en una sola petición. Salir sin
 * guardar no deja nada.
 *
 * Si se llega desde la hoja de elegir rutina de un día (`?dia=4`, del programa nuevo o,
 * con `&programa=7`, de uno que se está editando), al guardarla vuelve allí con la
 * rutina puesta en ese día.
 */
export function RutinaNueva() {
  const navegar = useNavigate()
  const volver = useVolver()
  const ubicacion = useLocation()
  const [busqueda] = useSearchParams()
  const dia = busqueda.get('dia') ? (Number(busqueda.get('dia')) as DiaSemana) : null
  // Con `programa`, se pidió desde la semana de un programa que se está editando; sin
  // él (y con `dia`), desde el programa nuevo.
  const programaId = busqueda.get('programa') ? Number(busqueda.get('programa')) : null
  const destino = programaId !== null ? semanaEnEdicion(programaId) : PROGRAMA_NUEVO
  // Quien abre la pantalla para empezar una rutina lo marca; volver de un ejercicio, no.
  const empezar = (ubicacion.state as { empezar?: boolean } | null)?.empezar === true

  const [borrador, setBorrador] = useState<BorradorDeRutina>(
    () =>
      (!empezar && leerBorrador<BorradorDeRutina>(RUTINA_NUEVA)) || { nombre: '', ejercicios: [] },
  )
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)

  // El borrador vive fuera de la pantalla: el formulario de cada ejercicio lo lee y lo cambia.
  useEffect(() => {
    guardarBorrador(RUTINA_NUEVA, borrador)
  }, [borrador])

  // La marca de empezar se quita de la entrada del historial: al volver aquí desde un
  // ejercicio, el borrador se tiene que conservar.
  useEffect(() => {
    if (empezar) {
      navegar(ubicacion.pathname + ubicacion.search, { replace: true, state: null })
    }
  }, [empezar, navegar, ubicacion.pathname, ubicacion.search])

  const programa = dia ? leerBorrador<DiasConNombre>(destino) : null
  const padre = !dia
    ? '/programas'
    : programaId !== null
      ? `/programas/${programaId}`
      : '/programas/nuevo'

  function salir() {
    tirarBorrador(RUTINA_NUEVA)
    volver(padre)
  }

  function mover(desde: number, hasta: number) {
    setBorrador((antes) => {
      const lista = [...antes.ejercicios]
      const [movido] = lista.splice(desde, 1)
      lista.splice(hasta, 0, movido)
      return { ...antes, ejercicios: lista }
    })
  }

  async function guardar() {
    const nombre = borrador.nombre.trim()
    if (!nombre) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      const rutina = await api.crearRutina({
        nombre,
        slots: borrador.ejercicios.map((ejercicio) => ({
          ejercicio_principal_id: ejercicio.principal.id,
          alternativa_ids: ejercicio.alternativas.map((otro) => otro.id),
          series_objetivo: ejercicio.series,
          reps_min: ejercicio.repsMin,
          reps_max: ejercicio.repsMax,
        })),
      })
      tirarBorrador(RUTINA_NUEVA)
      if (dia) {
        // De vuelta al programa, con la rutina ya en su día.
        const suPrograma = leerBorrador<DiasConNombre>(destino)
        if (suPrograma) {
          guardarBorrador(destino, {
            ...suPrograma,
            dias: {
              ...suPrograma.dias,
              [dia]: { id: rutina.id, nombre: rutina.nombre, oculto_desde: null },
            },
          })
        }
        volver(padre)
      } else {
        navegar(`/programas/rutinas/${rutina.id}`, { replace: true })
      }
    } catch (fallo) {
      setFallo((fallo as Error).message)
      setGuardando(false)
    }
  }

  const ejercicios = borrador.ejercicios
  const filas = ejercicios.map((ejercicio, indice) => ({
    clave: indice,
    nombre: ejercicio.principal.nombre,
    objetivo: objetivo({
      series_objetivo: ejercicio.series,
      reps_min: ejercicio.repsMin,
      reps_max: ejercicio.repsMax,
    }),
    detalle: lineaDeAlternativas(ejercicio.alternativas.map((otro) => otro.nombre)),
    enlace: `/programas/rutinas/nueva/ejercicios/${indice}`,
  }))

  return (
    <div className="rutina">
      <header className="sesion-cabecera">
        <button type="button" className="boton-icono" aria-label="Volver" onClick={salir}>
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>Nueva rutina</h1>
          {dia && (
            <p>
              Se pondrá el {NOMBRES_DE_LOS_DIAS[dia - 1]} de{' '}
              {programa?.nombre.trim() || 'tu programa nuevo'}
            </p>
          )}
        </div>
        <button
          type="button"
          className="dia-cabecera-boton"
          onClick={() => void guardar()}
          disabled={guardando}
        >
          Guardar
        </button>
      </header>

      {fallo && <p className="aviso error">{fallo}</p>}

      <label className="campo">
        <span className="campo-etiqueta">Nombre</span>
        <input
          className="campo-texto"
          value={borrador.nombre}
          maxLength={100}
          placeholder="Ej. Pierna"
          onChange={(evento) => {
            setBorrador({ ...borrador, nombre: evento.target.value })
            setFalloNombre(null)
          }}
        />
        {falloNombre && <span className="fallo">{falloNombre}</span>}
      </label>

      {ejercicios.length === 0 ? (
        <p className="rutina-vacio">
          Todavía no tiene ejercicios.
          <br />
          Añade el primero para empezar.
        </p>
      ) : (
        <ListaDeEjercicios filas={filas} alMover={ejercicios.length > 1 ? mover : undefined} />
      )}

      <Link to="/programas/rutinas/nueva/ejercicios/nuevo" className="boton">
        Añadir ejercicio
      </Link>

      {ejercicios.length > 0 && (
        <p className="rutina-leyenda">
          {ejercicios.length > 1 && (
            <>
              Arrastra <Icono nombre="asa" /> para cambiar el orden.
              <br />
            </>
          )}
          Pulsa un ejercicio para cambiarlo o quitarlo.
          <br />
          La rutina no existe hasta que pulses <em>Guardar</em> en esta pantalla.
        </p>
      )}
    </div>
  )
}
