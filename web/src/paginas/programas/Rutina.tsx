import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api, ErrorDeApi } from '../../api/cliente'
import type { AvisoDeBorrarRutina, HuecoDeRutina, Rutina as DatosRutina } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { diaYMesConAnio } from '../../utiles/fechas'
import { useVolver } from '../../utiles/volver'
import '../historial/historial.css'
import '../sesion/sesion.css'
import { ListaDeEjercicios, type FilaDeEjercicio } from './ListaDeEjercicios'
import './programas.css'
import './rutina.css'
import './semana.css'
import { enumerar, lineaDeAlternativas, objetivo } from './textos'

type Pregunta = 'ocultar' | 'mostrar' | 'borrar'

/** Los huecos visibles en su orden: su posición es el número que se enseña. */
function visiblesEnOrden(rutina: DatosRutina) {
  return rutina.slots
    .filter((hueco) => hueco.oculto_desde === null)
    .sort((uno, otro) => uno.orden - otro.orden)
}

function fila(hueco: HuecoDeRutina, enlace?: string, oculto = false): FilaDeEjercicio {
  const alternativas = lineaDeAlternativas(hueco.alternativas.length)
  const desde = oculto ? `oculto desde el ${diaYMesConAnio(hueco.oculto_desde!)}` : null
  return {
    clave: hueco.id,
    nombre: hueco.ejercicio_principal.nombre,
    objetivo: objetivo(hueco),
    detalle: [alternativas, desde].filter(Boolean).join(' · ') || null,
    principalOculto: !oculto && hueco.ejercicio_principal.oculto_desde !== null,
    enlace,
  }
}

/**
 * Qué se perdería al borrarla, con las cifras del aviso de la API. Sin historial, nada
 * que contar: la pregunta basta.
 */
function loQueSePierde(aviso: AvisoDeBorrarRutina, oculta: boolean) {
  const frases: string[] = []
  const cosas: string[] = []
  if (aviso.huecos > 0) {
    cosas.push(aviso.huecos === 1 ? 'su ejercicio' : `sus ${aviso.huecos} ejercicios`)
  }
  if (aviso.sesiones > 0) {
    cosas.push(
      aviso.sesiones === 1
        ? 'las series de su sesión'
        : `las series de sus ${aviso.sesiones} sesiones`,
    )
  }
  if (cosas.length > 0) frases.push(`Se borrarán también ${enumerar(cosas)}.`)
  if (aviso.dias_de_programa > 0) {
    frases.push('Los días de tus programas que la tienen pasarán a descanso.')
  }
  if (aviso.dias_planificados > 0) {
    frases.push('Los días en que la elegiste a mano volverán a lo que diga tu programa.')
  }
  if (aviso.toco_dias_pasados) {
    frases.push('El calendario dejará de saber qué tocaba los días pasados que la tenían.')
  }
  if (aviso.sesion_en_curso) frases.push('También se cancelará la sesión que tienes abierta hoy.')
  // Ocultarla como salida solo tiene sentido si aún se ve.
  if (aviso.con_historial && !oculta) frases.push('Si solo quieres que deje de salir, ocúltala.')
  return frases.length > 0 ? frases.join(' ') : undefined
}

/**
 * P3 · Una rutina: sus ejercicios en orden, cada uno con su objetivo y sus alternativas.
 *
 * Con *Editar*, el nombre y el orden van a un borrador que *Guardar* envía y *Cancelar*
 * descarta; ocultar y borrar la rutina están ahí. Ocultar o borrar un ejercicio se hace
 * dentro de él, donde se avisa de lo que se pierde. *Añadir ejercicio* y *Duplicar
 * rutina* no salen al editar: llevan a otra pantalla y el borrador se perdería.
 *
 * Una rutina oculta no se edita: su vista es de solo lectura, con *Duplicar* (no la
 * modifica), *Mostrar* y *Borrar*.
 */
export function Rutina() {
  const { rutinaId } = useParams()
  const id = Number(rutinaId)
  const navegar = useNavigate()
  const volver = useVolver()
  const [busqueda, setBusqueda] = useSearchParams()
  const verOcultos = busqueda.get('ver') === 'ocultos'

  const [rutina, setRutina] = useState<DatosRutina | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [orden, setOrden] = useState<HuecoDeRutina[]>([])
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [aviso, setAviso] = useState<AvisoDeBorrarRutina | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    api
      .rutina(id)
      .then((leida) => {
        if (vigente) setRutina(leida)
      })
      .catch((fallo: Error) => {
        if (!vigente) return
        setError(
          fallo instanceof ErrorDeApi && fallo.estado === 404
            ? 'Esa rutina no existe.'
            : fallo.message,
        )
      })
    return () => {
      vigente = false
    }
  }, [id])

  async function cargar() {
    setRutina(await api.rutina(id))
  }

  if (error) return <p className="aviso error">{error}</p>
  if (!rutina) return <p className="aviso">Cargando…</p>

  const oculta = rutina.oculto_desde !== null
  const visibles = visiblesEnOrden(rutina)
  const ocultos = rutina.slots
    .filter((hueco) => hueco.oculto_desde !== null)
    .sort((uno, otro) => uno.orden - otro.orden)
  const enlace = (hueco: HuecoDeRutina) => `/programas/rutinas/${id}/ejercicios/${hueco.id}`

  function empezarAEditar() {
    setNombre(rutina!.nombre)
    setOrden(visibles)
    setFallo(null)
    setFalloNombre(null)
    setEditando(true)
  }

  function mover(desde: number, hasta: number) {
    setOrden((antes) => {
      const nuevo = [...antes]
      const [movido] = nuevo.splice(desde, 1)
      nuevo.splice(hasta, 0, movido)
      return nuevo
    })
  }

  /** *Guardar*: el nombre y el orden. Si el nombre falla, no se toca el orden. */
  async function guardar() {
    const limpio = nombre.trim()
    if (!limpio) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    setFalloNombre(null)
    try {
      if (limpio !== rutina!.nombre) await api.actualizarRutina(id, limpio)
    } catch (fallo) {
      setFalloNombre((fallo as Error).message)
      setGuardando(false)
      return
    }
    try {
      const nuevo = orden.map((hueco) => hueco.id)
      if (nuevo.some((huecoId, i) => huecoId !== visibles[i].id)) await api.ordenarHuecos(id, nuevo)
    } catch (fallo) {
      setFallo(`No se pudo guardar el orden. ${(fallo as Error).message}`)
    }
    await cargar().catch((fallo: Error) => setFallo(fallo.message))
    setEditando(false)
    setGuardando(false)
  }

  async function preguntarBorrar() {
    setFallo(null)
    try {
      setAviso(await api.avisoDeBorrarRutina(id))
      setPregunta('borrar')
    } catch (fallo) {
      setFallo((fallo as Error).message)
    }
  }

  async function duplicar() {
    setGuardando(true)
    setFallo(null)
    try {
      const copia = await api.duplicarRutina(id)
      navegar(`/programas/rutinas/${copia.id}`)
    } catch (fallo) {
      setFallo((fallo as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  function alternarOcultos() {
    const siguiente = new URLSearchParams(window.location.search)
    if (verOcultos) siguiente.delete('ver')
    else siguiente.set('ver', 'ocultos')
    setBusqueda(siguiente, { replace: true })
  }

  const filas = (editando ? orden : visibles).map((hueco) =>
    fila(hueco, editando ? undefined : enlace(hueco)),
  )

  return (
    <div className="rutina">
      <header className="sesion-cabecera">
        {editando ? (
          <button
            type="button"
            className="dia-cabecera-boton cancelar"
            onClick={() => setEditando(false)}
            disabled={guardando}
          >
            Cancelar
          </button>
        ) : (
          <button
            type="button"
            className="boton-icono"
            aria-label="Volver"
            onClick={() => volver('/programas')}
          >
            <Icono nombre="volver" />
          </button>
        )}
        <div className="sesion-titulo">
          <h1>{rutina.nombre}</h1>
        </div>
        {oculta ? (
          <span className="semana-hueco" />
        ) : (
          <button
            type="button"
            className="dia-cabecera-boton"
            onClick={() => (editando ? void guardar() : empezarAEditar())}
            disabled={guardando}
          >
            {editando ? 'Guardar' : 'Editar'}
          </button>
        )}
      </header>

      {fallo && <p className="aviso error">{fallo}</p>}

      {editando && (
        <label className="campo">
          <span className="campo-etiqueta">Nombre</span>
          <input
            className="campo-texto"
            value={nombre}
            maxLength={100}
            onChange={(evento) => {
              setNombre(evento.target.value)
              setFalloNombre(null)
            }}
          />
          {falloNombre && <span className="fallo">{falloNombre}</span>}
        </label>
      )}

      {oculta && (
        <div className="semana-oculto">
          <strong>Oculta desde el {diaYMesConAnio(rutina.oculto_desde!)}</strong>
          <span>No sale al elegir rutina ni al entrenar.</span>
          <span>Los días de tus programas que la tenían la conservan, como descanso.</span>
        </div>
      )}

      {filas.length === 0 ? (
        <p className="recuadro-vacio">
          Todavía no tiene ejercicios.
          {!oculta && (
            <>
              <br />
              Añade el primero para empezar.
            </>
          )}
        </p>
      ) : (
        <ListaDeEjercicios filas={filas} alMover={editando ? mover : undefined} />
      )}

      {!editando && !oculta && (
        <Link to={`/programas/rutinas/${id}/ejercicios/nuevo`} className="boton">
          Añadir ejercicio
        </Link>
      )}

      {!editando && (
        <button
          type="button"
          className="boton boton-texto"
          onClick={() => void duplicar()}
          disabled={guardando}
        >
          Duplicar rutina
        </button>
      )}

      {oculta && (
        <>
          <button
            type="button"
            className="boton boton-principal"
            onClick={() => setPregunta('mostrar')}
          >
            Mostrar rutina
          </button>
          <button
            type="button"
            className="boton boton-texto peligro"
            onClick={() => void preguntarBorrar()}
          >
            Borrar rutina
          </button>
        </>
      )}

      {!editando && ocultos.length > 0 && (
        <>
          <button
            type="button"
            className="boton boton-texto atajo programas-ver-ocultos"
            aria-expanded={verOcultos}
            onClick={alternarOcultos}
          >
            {verOcultos ? 'Esconder' : 'Ver'}{' '}
            {ocultos.length === 1 ? '1 ejercicio oculto' : `${ocultos.length} ejercicios ocultos`}
            <Icono nombre={verOcultos ? 'arriba' : 'abajo'} pequeno />
          </button>
          {verOcultos && (
            <ListaDeEjercicios
              filas={ocultos.map((hueco) => fila(hueco, enlace(hueco), true))}
              sinNumero
              oculta
            />
          )}
        </>
      )}

      {editando && (
        <>
          <div className="rutina-separador" />
          <div className="rutina-acciones">
            <button
              type="button"
              className="boton boton-texto"
              onClick={() => setPregunta('ocultar')}
              disabled={guardando}
            >
              Ocultar rutina
            </button>
            <button
              type="button"
              className="boton boton-texto peligro"
              onClick={() => void preguntarBorrar()}
              disabled={guardando}
            >
              Borrar rutina
            </button>
          </div>
          <p className="rutina-leyenda">
            {orden.length > 1 && (
              <>
                Arrastra <Icono nombre="asa" /> para cambiar el orden.
                <br />
              </>
            )}
            Para ocultar o borrar un ejercicio, sal de <em>Editar</em> y ábrelo.
          </p>
        </>
      )}

      {pregunta === 'ocultar' && (
        <Dialogo
          titulo={`¿Ocultar ${rutina.nombre}?`}
          cuerpo="Dejará de salir al elegir rutina y al entrenar. Los días de tus programas que la tienen la conservan, pero cuentan como descanso. Su historial sigue intacto."
          confirmar="Ocultar"
          alConfirmar={async () => {
            // Lo que hubiera en el borrador se descarta: lo oculto no se edita.
            await api.borrarRutina(id, 'ocultar')
            await cargar()
            setEditando(false)
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && (
        <Dialogo
          titulo={`¿Mostrar ${rutina.nombre}?`}
          cuerpo="Volverá a salir al elegir rutina y al entrenar, y los días de tus programas que la conservaban vuelven a tenerla."
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarRutina(id)
            await cargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && aviso && (
        <Dialogo
          titulo={`¿Borrar ${rutina.nombre}?`}
          cuerpo={loQueSePierde(aviso, oculta)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            // Siempre en definitivo: sin historial, ese modo borra directo igual.
            await api.borrarRutina(id, 'definitivo')
            navegar('/programas', { replace: true })
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
    </div>
  )
}
