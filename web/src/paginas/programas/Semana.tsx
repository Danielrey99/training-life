import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, ErrorDeApi } from '../../api/cliente'
import type { DiaSemana, Programa, Rutina, RutinaMinima } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { Interruptor } from '../../componentes/Interruptor'
import { colorDelDia } from '../../utiles/colores'
import { diaYMesConAnio } from '../../utiles/fechas'
import { useVolver } from '../../utiles/volver'
import '../historial/historial.css'
import '../sesion/sesion.css'
import {
  DIAS,
  guardarBorrador,
  leerBorrador,
  semanaEnEdicion,
  tirarBorrador,
  type DiasConNombre,
  type DiasDelBorrador,
} from './borradores'
import { DiasEditables } from './DiasEditables'
import { HojaDeRutinas } from './HojaDeRutinas'
import './programas.css'
import {
  cuantosDias,
  ejercicios,
  enumerar,
  NOMBRES_DE_LOS_DIAS,
  nombreDelDiaSemana,
} from './textos'
import './semana.css'

type Datos = {
  programa: Programa
  // El activo, sea este u otro: su nombre sale en el interruptor y sus días ordenan la hoja
  // de elegir rutina.
  activo: Programa | undefined
  // Las visibles, para el número de ejercicios de cada día y para la hoja de elegir.
  rutinas: Rutina[]
}

type Pregunta = 'activar' | 'desactivar' | 'ocultar' | 'mostrar' | 'borrar'

function diasDe(programa: Programa): DiasDelBorrador {
  const dias = {} as DiasDelBorrador
  for (const dia of DIAS) {
    dias[dia] = programa.dias.find((uno) => uno.dia_semana === dia)?.rutina ?? null
  }
  return dias
}

/** "El sábado tiene una rutina oculta…": por qué ese día cuenta como descanso y qué hacer. */
function avisoDeOcultas(dias: DiaSemana[]) {
  const cuales = enumerar(dias.map((dia) => `el ${NOMBRES_DE_LOS_DIAS[dia - 1]}`))
  const frase = cuales[0].toUpperCase() + cuales.slice(1)
  const una = dias.length === 1
  return (
    <>
      {una
        ? `${frase} tiene una rutina oculta: sigue asignada, pero cuenta como descanso. `
        : `${frase} tienen una rutina oculta: siguen asignadas, pero cuentan como descanso. `}
      Pulsa <Icono nombre="abrir" pequeno /> para entrar en {una ? 'ella' : 'ellas'} y volver a
      {una ? ' mostrarla' : ' mostrarlas'}, o <em>Editar</em> para poner {una ? 'otra' : 'otras'} en
      su lugar.
    </>
  )
}

async function leer(id: number): Promise<Datos> {
  const [programa, programas, rutinas] = await Promise.all([
    api.programa(id),
    api.programas(),
    api.rutinas(),
  ])
  return { programa, activo: programas.find((uno) => uno.activo), rutinas }
}

/**
 * P2 · La semana de un programa: qué rutina toca cada día.
 *
 * El interruptor de *Programa activo* es lo único que cambia sin *Editar*: no toca
 * el programa, solo cuál se usa, y por eso pregunta y guarda al momento. Al editar
 * desaparece, para que dentro de *Editar* todo espere a *Guardar*: el nombre y los
 * días van a un borrador que *Guardar* envía de golpe y *Cancelar* descarta; ocultar y
 * borrar el programa están ahí.
 *
 * Un programa oculto no se edita: su vista es de solo lectura, con *Mostrar* y *Borrar*.
 */
export function Semana() {
  const { programaId } = useParams()
  const id = Number(programaId)
  const navegar = useNavigate()
  const volver = useVolver()

  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [dias, setDias] = useState<DiasDelBorrador | null>(null)
  const [hojaDe, setHojaDe] = useState<DiaSemana | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    leer(id)
      .then((leidos) => {
        if (!vigente) return
        setDatos(leidos)
        // De vuelta de crear una rutina para un día: se sigue editando donde se dejó, ya
        // con la rutina puesta en ese día.
        const pendiente = leerBorrador<DiasConNombre>(semanaEnEdicion(id))
        if (pendiente) {
          tirarBorrador(semanaEnEdicion(id))
          setNombre(pendiente.nombre)
          setDias(pendiente.dias)
          setEditando(true)
        }
      })
      .catch((fallo: Error) => {
        if (!vigente) return
        setError(
          fallo instanceof ErrorDeApi && fallo.estado === 404
            ? 'Ese programa no existe.'
            : fallo.message,
        )
      })
    return () => {
      vigente = false
    }
  }, [id])

  /** Vuelve a leerlo todo tras un cambio: el activo, los días, si está oculto. */
  async function cargar() {
    setDatos(await leer(id))
  }

  const cerrarHoja = useCallback(() => setHojaDe(null), [])

  if (error) return <p className="aviso error">{error}</p>
  if (!datos) return <p className="aviso">Cargando…</p>

  const { programa, activo, rutinas } = datos
  const oculto = programa.oculto_desde !== null
  const delDia = editando && dias ? dias : diasDe(programa)
  const ejerciciosDe = new Map(rutinas.map((rutina) => [rutina.id, ejercicios(rutina)]))
  const visibles = DIAS.filter((dia) => delDia[dia] && delDia[dia].oculto_desde === null)
  const conOculta = DIAS.filter((dia) => delDia[dia]?.oculto_desde)

  function empezarAEditar() {
    setNombre(programa.nombre)
    setDias(diasDe(programa))
    setFallo(null)
    setFalloNombre(null)
    setEditando(true)
  }

  function cancelar() {
    setEditando(false)
    setFallo(null)
    setFalloNombre(null)
  }

  /**
   * *Guardar*: el nombre primero, que es lo único que puede no valer; después, cada día
   * que cambió. No es atómico (no hay un endpoint para todo a la vez): si algo falla a
   * medias, lo dice y vuelve a leer el programa para enseñar lo que quedó guardado.
   */
  async function guardar() {
    if (!dias) return
    const limpio = nombre.trim()
    if (!limpio) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    setFalloNombre(null)
    try {
      if (limpio !== programa.nombre) await api.actualizarPrograma(id, limpio)
    } catch (fallo) {
      setFalloNombre((fallo as Error).message)
      setGuardando(false)
      return
    }
    const antes = diasDe(programa)
    try {
      for (const dia of DIAS) {
        const ahora = dias[dia]
        if (ahora?.id === antes[dia]?.id) continue
        if (ahora) await api.ponerRutinaEnDia(id, dia, ahora.id)
        else await api.quitarRutinaDeDia(id, dia)
      }
    } catch (fallo) {
      setFallo(`No se pudo guardar todo: ${(fallo as Error).message}`)
    }
    await cargar().catch((fallo: Error) => setFallo(fallo.message))
    setEditando(false)
    setGuardando(false)
  }

  function elegir(dia: DiaSemana, rutina: RutinaMinima | null) {
    setDias((antes) => (antes ? { ...antes, [dia]: rutina } : antes))
    setHojaDe(null)
  }

  const subtitulo = `${cuantosDias(visibles.length)}${oculto ? ' · oculto' : ''}`

  return (
    <div className="semana">
      <header className="sesion-cabecera">
        {editando ? (
          // Mientras se edita no se sale de la pantalla: o se guarda o se cancela.
          <button
            type="button"
            className="dia-cabecera-boton cancelar"
            onClick={cancelar}
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
          <h1>{programa.nombre}</h1>
          <p>{subtitulo}</p>
        </div>
        {oculto ? (
          // Sin botón a la derecha: el hueco mantiene el título centrado.
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

      {oculto ? (
        <div className="semana-oculto">
          <strong>Oculto desde el {diaYMesConAnio(programa.oculto_desde!)}</strong>
          <span>No sale en tu lista de programas.</span>
          <span>Sus rutinas y su historial siguen intactos.</span>
        </div>
      ) : (
        // Fuera de Editar: no cambia el programa, solo cuál se usa, y al editar todo
        // espera a Guardar. Así cada cosa tiene un único momento en que se guarda.
        !editando && (
          <Interruptor
            titulo="Programa activo"
            ayuda={
              programa.activo
                ? 'Marca qué rutina toca cada día'
                : activo
                  ? `Al activarlo, ${activo.nombre} dejará de estar activo`
                  : 'Ningún programa marca ahora qué rutina toca cada día'
            }
            encendido={programa.activo}
            alCambiar={() => setPregunta(programa.activo ? 'desactivar' : 'activar')}
            desactivado={guardando}
          />
        )
      )}

      {editando && <h2 className="semana-rotulo">Días</h2>}

      {editando && dias ? (
        <DiasEditables
          dias={dias}
          alAbrir={setHojaDe}
          alQuitar={(dia) => elegir(dia, null)}
          desactivado={guardando}
        />
      ) : (
        <div className="semana-dias">
          {DIAS.map((dia) => {
            const rutina = delDia[dia]
            const nombreDelDia = (
              <span className="semana-dia-nombre">{nombreDelDiaSemana(dia)}</span>
            )
            if (!rutina) {
              return (
                <div key={dia} className="semana-dia">
                  {nombreDelDia}
                  <span className="semana-dia-rutina descanso">Descanso</span>
                </div>
              )
            }
            const oculta = rutina.oculto_desde !== null
            // El color del día, esté activo o no el programa (decisión del autor: una rutina
            // solo tiene color puesta en un día, y es el de ese día).
            const color = oculta ? undefined : colorDelDia(dia)
            return (
              <Link key={dia} to={`/programas/rutinas/${rutina.id}`} className="semana-dia">
                {nombreDelDia}
                <span className="semana-dia-rutina">
                  <span
                    className="programas-punto"
                    style={color ? { background: color } : undefined}
                  />
                  <strong className={oculta ? 'oculta' : undefined}>{rutina.nombre}</strong>
                  {oculta ? (
                    <span className="etiqueta-chica">oculta</span>
                  ) : (
                    <span>{ejerciciosDe.get(rutina.id)}</span>
                  )}
                </span>
                <Icono nombre="abrir" pequeno />
              </Link>
            )
          })}
        </div>
      )}

      {!editando && !oculto && conOculta.length > 0 && (
        <p className="semana-parrafo">{avisoDeOcultas(conOculta)}</p>
      )}

      {oculto && (
        <>
          <button
            type="button"
            className="boton boton-principal"
            onClick={() => setPregunta('mostrar')}
          >
            Mostrar programa
          </button>
          <button
            type="button"
            className="boton boton-texto peligro"
            onClick={() => setPregunta('borrar')}
          >
            Borrar programa
          </button>
        </>
      )}

      {editando && (
        <>
          <div className="semana-acciones">
            <button
              type="button"
              className="boton boton-texto"
              onClick={() => setPregunta('ocultar')}
              disabled={guardando}
            >
              Ocultar programa
            </button>
            <button
              type="button"
              className="boton boton-texto peligro"
              onClick={() => setPregunta('borrar')}
              disabled={guardando}
            >
              Borrar programa
            </button>
          </div>
          <p className="semana-leyenda">
            Pulsa <Icono nombre="abrir" pequeno /> para cambiar la rutina de un día.
            <br />
            Pulsa <Icono nombre="quitar" pequeno /> para dejarlo en descanso.
          </p>
        </>
      )}

      {hojaDe !== null && dias && (
        <HojaDeRutinas
          diaSemana={hojaDe}
          rutinas={rutinas}
          diasDelActivo={activo?.dias}
          elegida={dias[hojaDe]?.id ?? null}
          alElegir={(rutina) =>
            elegir(hojaDe, { id: rutina.id, nombre: rutina.nombre, oculto_desde: null })
          }
          alCerrar={cerrarHoja}
          alCrearNueva={() => {
            // Lo editado hasta ahora espera aquí mientras se crea la rutina.
            guardarBorrador(semanaEnEdicion(id), { nombre, dias })
            navegar(`/programas/rutinas/nueva?dia=${hojaDe}&programa=${id}`, {
              state: { empezar: true },
            })
          }}
        />
      )}

      {pregunta === 'activar' && (
        <Dialogo
          titulo={`¿Activar ${programa.nombre}?`}
          cuerpo={
            activo
              ? `${activo.nombre} dejará de estar activo.`
              : 'Cada día, Entrenar te dirá qué rutina toca, y el calendario marcará qué días entrenaste y cuáles te saltaste.'
          }
          confirmar="Activar"
          alConfirmar={async () => {
            await api.activarPrograma(id)
            await cargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'desactivar' && (
        <Dialogo
          titulo={`¿Desactivar ${programa.nombre}?`}
          cuerpo="Entrenar dejará de decirte qué rutina toca y el calendario no marcará los días que te saltes. Podrás seguir entrenando cualquier rutina."
          confirmar="Desactivar"
          alConfirmar={async () => {
            await api.desactivarPrograma(id)
            await cargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'ocultar' && (
        <Dialogo
          titulo={`¿Ocultar ${programa.nombre}?`}
          cuerpo={
            programa.activo
              ? 'Dejará de salir en tu lista de programas y, como es el que usas ahora, dejará de estar activo. Sus rutinas no se tocan.'
              : 'Dejará de salir en tu lista de programas. Sus rutinas no se tocan.'
          }
          confirmar="Ocultar"
          alConfirmar={async () => {
            // Lo que hubiera en el borrador se descarta: lo oculto no se edita.
            await api.borrarPrograma(id, 'ocultar')
            await cargar()
            setEditando(false)
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && (
        <Dialogo
          titulo={`¿Mostrar ${programa.nombre}?`}
          cuerpo="Volverá a tu lista de programas, sin activar."
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarPrograma(id)
            await cargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && (
        <Dialogo
          titulo={`¿Borrar ${programa.nombre}?`}
          // Si nunca estuvo activo no hay nada que perder más que el propio programa.
          cuerpo={
            programa.ultimo_periodo
              ? 'Tus rutinas y tus sesiones se quedan, pero el calendario dejará de saber qué rutina tocaba cada día mientras lo usaste.'
              : undefined
          }
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await api.borrarPrograma(id, 'definitivo')
            navegar('/programas', { replace: true })
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
    </div>
  )
}
