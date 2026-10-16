import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type {
  AvisoDeBorrarEjercicio,
  Ejercicio,
  GrupoMuscular,
  Nota,
  SesionHistorial,
  UsoEnRutina,
} from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { Ocultos } from '../../componentes/Ocultos'
import { conArticulo, diaDe, diaYMesConAnio } from '../../utiles/fechas'
import { pesoLegible, unidad } from '../../utiles/numeros'
import { valorDe } from '../../utiles/progresion'
import { useVolver } from '../../utiles/volver'
import { enumerar } from '../programas/textos'
import '../historial/historial.css'
import '../programas/programas.css'
import '../programas/semana.css'
import '../sesion/sesion.css'
import './ejercicios.css'

type Datos = {
  ejercicio: Ejercicio
  grupos: GrupoMuscular[]
  // De la más reciente a la más antigua, como las da la API.
  sesiones: SesionHistorial[]
  notas: Nota[]
  usos: UsoEnRutina[]
}

type Pregunta = 'ocultar' | 'mostrar' | 'borrar' | null

// La nota que se está escribiendo: una nueva, la de ese id o ninguna.
type Escribiendo = 'nueva' | number | null

/** "Push · ejercicio 1"; uno oculto en su rutina no tiene número. */
function queEjercicio(uso: UsoEnRutina) {
  const cual = uso.posicion === null ? 'ejercicio oculto' : `ejercicio ${uso.posicion}`
  return `${uso.rutina.nombre} · ${cual}`
}

/**
 * En qué programas está la rutina: el activo lo dice (solo puede haber uno) y los
 * demás van con su nombre a secas. Una rutina oculta lo dice primero.
 */
function dondeEsta(uso: UsoEnRutina) {
  const programas =
    uso.programas.length === 0
      ? 'sin programa'
      : enumerar(
          uso.programas.map((programa) =>
            programa.activo ? `${programa.nombre} · programa activo` : programa.nombre,
          ),
        )
  if (uso.rutina.oculto_desde) {
    return `Rutina oculta desde el ${diaYMesConAnio(uso.rutina.oculto_desde)} · ${programas}`
  }
  return programas
}

/**
 * Lo que dice el diálogo de borrar, con palabras de lo que pasa: «Se borrarán también
 * sus series de 11 sesiones, tus 2 notas y su ejercicio 1 en Push, y dejará de ser
 * alternativa en Full body A». Sin nada que perder, no lleva texto.
 */
function loQueSePierde(aviso: AvisoDeBorrarEjercicio, oculto: boolean) {
  const seBorra: string[] = []
  if (aviso.sesiones > 0) {
    seBorra.push(
      aviso.sesiones === 1 ? 'sus series de 1 sesión' : `sus series de ${aviso.sesiones} sesiones`,
    )
  }
  if (aviso.notas > 0) seBorra.push(aviso.notas === 1 ? 'tu nota' : `tus ${aviso.notas} notas`)
  // Las rutinas, sin decir en qué puesto ni si es principal o alternativa (decisión del
  // autor: «su ejercicio 1 en Push» sonaba raro); eso ya lo enseña la ficha, en «Rutinas
  // donde se usa».
  // Donde es el principal, el ejercicio de la rutina se va entero, con sus alternativas.
  const rutinas = new Set(aviso.huecos.map((uso) => uso.rutina.id)).size
  const conAlternativas = aviso.huecos.some((uso) => uso.rol === 'principal')
    ? ', con sus alternativas donde es el principal'
    : ''
  const deLasRutinas =
    rutinas === 0
      ? null
      : `se quitará de ${rutinas === 1 ? 'la rutina' : 'las rutinas'} donde se usa${conAlternativas}`

  const frases: string[] = []
  if (seBorra.length > 0 && deLasRutinas) {
    frases.push(`Se borrarán también ${enumerar(seBorra)}, y ${deLasRutinas}.`)
  } else if (seBorra.length > 0) {
    frases.push(`Se borrarán también ${enumerar(seBorra)}.`)
  } else if (deLasRutinas) {
    frases.push(`${deLasRutinas[0].toUpperCase()}${deLasRutinas.slice(1)}.`)
  }
  const vacias = aviso.sesiones_que_se_vacian.length
  if (vacias === 1) frases.push('Una sesión se quedará sin series y desaparecerá entera.')
  if (vacias > 1) frases.push(`${vacias} sesiones se quedarán sin series y desaparecerán enteras.`)
  if (frases.length > 0 && !oculto) frases.push('Si solo quieres que deje de salir, ocúltalo.')
  return frases.join(' ') || undefined
}

/**
 * X2 · La ficha de un ejercicio: descripción, progresión, tus notas y las rutinas
 * donde se usa. Desde aquí se edita (X3), se oculta, se muestra y se borra.
 *
 * Un predefinido no se edita, oculta ni borra (es de todos), pero sus notas son tuyas.
 * Uno oculto es de solo lectura, con *Mostrar* y *Borrar*; sus notas sí se cambian,
 * cada una con su propio formulario. Un bloque vacío no se enseña.
 */
export function Ficha() {
  const { ejercicioId } = useParams()
  const id = Number(ejercicioId)
  const volver = useVolver()
  const navegar = useNavigate()
  const [busqueda, setBusqueda] = useSearchParams()
  const verOcultos = busqueda.get('ver') === 'ocultos'
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta>(null)
  const [aviso, setAviso] = useState<AvisoDeBorrarEjercicio | null>(null)
  const [escribiendo, setEscribiendo] = useState<Escribiendo>(null)
  const [notaABorrar, setNotaABorrar] = useState<Nota | null>(null)

  const leer = useCallback(async (): Promise<Datos> => {
    const [ejercicio, grupos, sesiones, notas, usos] = await Promise.all([
      api.ejercicio(id),
      api.gruposMusculares(),
      api.historialDeEjercicio(id, { limite: 1 }),
      api.notas(id),
      api.dondeSeUsa(id),
    ])
    // Las más recientes arriba.
    notas.sort((una, otra) => otra.created_at.localeCompare(una.created_at))
    return { ejercicio, grupos, sesiones, notas, usos }
  }, [id])

  useEffect(() => {
    let vigente = true
    leer()
      .then((leidos) => {
        if (vigente) setDatos(leidos)
      })
      .catch((problema: Error) => {
        if (vigente) setError(problema.message)
      })
    return () => {
      vigente = false
    }
  }, [leer])

  /** Tras un cambio, todo de nuevo: el aviso de oculto, las notas y los botones cambian. */
  async function recargar() {
    setDatos(await leer())
  }

  function alternarOcultos() {
    // Sobre la URL del momento, como en Programas.
    const siguiente = new URLSearchParams(window.location.search)
    if (verOcultos) siguiente.delete('ver')
    else siguiente.set('ver', 'ocultos')
    setBusqueda(siguiente, { replace: true })
  }

  if (error) return <p className="aviso error">{error}</p>
  if (!datos) return <p className="aviso">Cargando…</p>

  const { ejercicio, notas, usos } = datos
  const oculto = ejercicio.oculto_desde !== null
  const propio = !ejercicio.es_predefinido
  const grupo =
    datos.grupos.find((uno) => uno.id === ejercicio.grupo_muscular_id)?.nombre ?? 'Sin grupo'
  const ultima = datos.sesiones[0]
  const usosVisibles = usos.filter((uso) => !uso.oculto)
  const usosOcultos = usos.filter((uso) => uso.oculto)
  const ocupado = escribiendo !== null

  async function preguntarBorrar() {
    setFallo(null)
    try {
      setAviso(await api.avisoDeBorrarEjercicio(id))
      setPregunta('borrar')
    } catch (problema) {
      setFallo((problema as Error).message)
    }
  }

  async function guardarNota(nota: Nota | null, texto: string) {
    if (nota) await api.actualizarNota(id, nota.id, texto)
    else await api.crearNota(id, texto)
    await recargar()
    setEscribiendo(null)
  }

  return (
    <div className="detalle">
      <header className="sesion-cabecera">
        <button
          type="button"
          className="boton-icono"
          aria-label="Volver"
          onClick={() => volver('/ejercicios')}
        >
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>{ejercicio.nombre}</h1>
          <p>{propio ? grupo : `${grupo} · predefinido`}</p>
        </div>
        {propio && !oculto ? (
          <button
            type="button"
            className="dia-cabecera-boton"
            onClick={() => navegar(`/ejercicios/${id}/editar`)}
            disabled={ocupado}
          >
            Editar
          </button>
        ) : (
          <span className="semana-hueco" />
        )}
      </header>

      {fallo && <p className="aviso error">{fallo}</p>}

      {oculto && (
        <div className="semana-oculto">
          <strong>Oculto desde el {diaYMesConAnio(ejercicio.oculto_desde!)}</strong>
          <span>No sale en las listas de ejercicios.</span>
          <span>Las rutinas que lo usan lo conservan, en gris.</span>
        </div>
      )}

      {ejercicio.descripcion && (
        <section className="detalle-bloque">
          <h2 className="rotulo">Descripción</h2>
          <p className="detalle-tarjeta detalle-descripcion">{ejercicio.descripcion}</p>
        </section>
      )}

      {ultima && (
        <section className="detalle-bloque">
          <h2 className="rotulo">Progresión</h2>
          <Link to={`/progresion/${id}`} className="detalle-tarjeta detalle-progresion">
            <span className="detalle-progresion-texto">
              <span className="detalle-peso num">
                {pesoLegible(valorDe(ultima, 'peso'))} {unidad()}
              </span>
              <span>Última vez {conArticulo(ultima.fecha)}</span>
            </span>
            <Icono nombre="abrir" pequeno />
          </Link>
        </section>
      )}

      <section className="detalle-bloque">
        <h2 className="rotulo">Mis notas</h2>
        {notas.length > 0 && (
          <div className="detalle-tarjeta detalle-notas">
            {notas.map((nota) =>
              escribiendo === nota.id ? (
                <FormularioDeNota
                  key={nota.id}
                  inicial={nota.nota}
                  alGuardar={(texto) => guardarNota(nota, texto)}
                  alCancelar={() => setEscribiendo(null)}
                />
              ) : (
                <div key={nota.id} className="detalle-nota">
                  <span className="detalle-nota-texto">
                    <span>{nota.nota}</span>
                    <span className="detalle-nota-fecha">
                      {diaYMesConAnio(diaDe(nota.created_at))}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="boton-icono"
                    aria-label="Cambiar la nota"
                    onClick={() => setEscribiendo(nota.id)}
                    disabled={ocupado}
                  >
                    <Icono nombre="editar" pequeno />
                  </button>
                  <button
                    type="button"
                    className="boton-icono quitar"
                    aria-label="Borrar la nota"
                    onClick={() => setNotaABorrar(nota)}
                    disabled={ocupado}
                  >
                    <Icono nombre="quitar" pequeno />
                  </button>
                </div>
              ),
            )}
          </div>
        )}
        {escribiendo === 'nueva' ? (
          <div className="detalle-tarjeta detalle-notas">
            <FormularioDeNota
              titulo="Nota nueva"
              alGuardar={(texto) => guardarNota(null, texto)}
              alCancelar={() => setEscribiendo(null)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="boton"
            onClick={() => setEscribiendo('nueva')}
            disabled={ocupado}
          >
            Añadir nota
          </button>
        )}
      </section>

      {usos.length > 0 && (
        <section className="detalle-bloque">
          <h2 className="rotulo">Rutinas donde se usa</h2>
          {usosVisibles.length > 0 && (
            <div className="programas-rutinas">
              {usosVisibles.map((uso) => (
                <FilaDeUso key={`${uso.rol}-${uso.slot_id}`} uso={uso} />
              ))}
            </div>
          )}
          <Ocultos
            cuantos={usosOcultos.length}
            singular="rutina oculta"
            plural="rutinas ocultas"
            abierto={verOcultos}
            alAlternar={alternarOcultos}
          />
          {verOcultos && usosOcultos.length > 0 && (
            <div className="programas-rutinas oculta">
              {usosOcultos.map((uso) => (
                <FilaDeUso key={`${uso.rol}-${uso.slot_id}`} uso={uso} />
              ))}
            </div>
          )}
        </section>
      )}

      {propio ? (
        <div className="detalle-acciones">
          {oculto ? (
            <button
              type="button"
              className="boton boton-principal"
              onClick={() => setPregunta('mostrar')}
              disabled={ocupado}
            >
              Mostrar ejercicio
            </button>
          ) : (
            <button
              type="button"
              className="boton boton-texto"
              onClick={() => setPregunta('ocultar')}
              disabled={ocupado}
            >
              Ocultar ejercicio
            </button>
          )}
          <button
            type="button"
            className="boton boton-texto peligro"
            onClick={() => void preguntarBorrar()}
            disabled={ocupado}
          >
            Borrar ejercicio
          </button>
        </div>
      ) : (
        <p className="programas-pie">Los predefinidos no se pueden editar, ocultar ni borrar.</p>
      )}

      {pregunta === 'ocultar' && (
        <Dialogo
          titulo={`¿Ocultar ${ejercicio.nombre}?`}
          cuerpo="Dejará de salir en las listas de ejercicios. Las rutinas que lo usan lo conservan en gris, y su historial y tus notas siguen intactos."
          confirmar="Ocultar"
          alConfirmar={async () => {
            await api.borrarEjercicio(id, 'ocultar')
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && (
        <Dialogo
          titulo={`¿Mostrar ${ejercicio.nombre}?`}
          cuerpo="Volverá a salir en las listas de ejercicios."
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarEjercicio(id)
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && aviso && (
        <Dialogo
          titulo={`¿Borrar ${ejercicio.nombre}?`}
          cuerpo={loQueSePierde(aviso, oculto)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await api.borrarEjercicio(id, 'definitivo')
            // Con replace: volver no debe llevar a la ficha de algo que ya no existe.
            navegar('/ejercicios', { replace: true })
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {notaABorrar && (
        <Dialogo
          titulo="¿Borrar la nota?"
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await api.borrarNota(id, notaABorrar.id)
            await recargar()
            setNotaABorrar(null)
          }}
          alCancelar={() => setNotaABorrar(null)}
        />
      )}
    </div>
  )
}

/** Sin punto de color, como en Programas: una rutina solo lo tiene puesta en un día. */
function FilaDeUso({ uso }: { uso: UsoEnRutina }) {
  return (
    <Link to={`/programas/rutinas/${uso.rutina.id}`} className="programas-rutina detalle-uso">
      <span className="programas-rutina-texto">
        <strong>{queEjercicio(uso)}</strong>
        <span>{dondeEsta(uso)}</span>
      </span>
      <span className="etiqueta-chica">
        {uso.rol === 'principal' ? 'principal' : 'alternativa'}
      </span>
      <Icono nombre="abrir" pequeno />
    </Link>
  )
}

/** El campo de una nota, nueva o existente, con su propio Cancelar y Guardar. */
function FormularioDeNota({
  titulo = 'Nota',
  inicial = '',
  alGuardar,
  alCancelar,
}: {
  titulo?: string
  inicial?: string
  alGuardar: (texto: string) => Promise<void>
  alCancelar: () => void
}) {
  const [texto, setTexto] = useState(inicial)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    if (texto.trim() === '') {
      setFallo('Escribe algo en la nota, o pulsa Cancelar.')
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      await alGuardar(texto.trim())
    } catch (problema) {
      setFallo((problema as Error).message)
      setGuardando(false)
    }
  }

  return (
    <form className="detalle-formulario" onSubmit={enviar}>
      <label className="campo">
        <span className="campo-etiqueta">{titulo}</span>
        <textarea
          className="campo-texto detalle-campo"
          rows={3}
          maxLength={1000}
          value={texto}
          placeholder="Un ajuste de la máquina, cómo te sale mejor…"
          onChange={(evento) => setTexto(evento.target.value)}
          autoFocus
        />
      </label>
      <div className="botones-en-linea">
        <button
          type="button"
          className="boton boton-cancelar"
          onClick={alCancelar}
          disabled={guardando}
        >
          Cancelar
        </button>
        <button type="submit" className="boton boton-principal" disabled={guardando}>
          Guardar
        </button>
      </div>
      {fallo && <p className="fallo">{fallo}</p>}
    </form>
  )
}
