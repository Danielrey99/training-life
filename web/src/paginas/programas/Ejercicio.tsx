import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, ErrorDeApi } from '../../api/cliente'
import type {
  AvisoDeBorrarHueco,
  Ejercicio as DatosEjercicio,
  GrupoMuscular,
  HuecoDeRutina,
  Rutina,
} from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { diaYMesConAnio } from '../../utiles/fechas'
import { useVolver } from '../../utiles/volver'
import '../historial/historial.css'
import '../sesion/sesion.css'
import {
  guardarBorrador,
  leerBorradorDeRutina,
  RUTINA_NUEVA,
  type BorradorDeRutina,
  type EjercicioDelBorrador,
} from './borradores'
import './ejercicio.css'
import { CamposDelObjetivo } from './CamposDelObjetivo'
import { HojaDeEjercicios } from './HojaDeEjercicios'
import {
  aObjetivo,
  deAjustes,
  enTexto,
  familiaDe,
  queFaltaDelObjetivo,
  resumenDelObjetivo,
  type ObjetivoEnTexto,
} from './objetivos'
import './semana.css'

/**
 * De dónde sale lo que se edita: un ejercicio del borrador de la rutina nueva (nada
 * se guarda hasta el *Guardar* de esa rutina), uno nuevo de una rutina que ya existe,
 * o uno que ya existe.
 */
type Origen =
  | { tipo: 'borrador'; borrador: BorradorDeRutina; indice: number | null }
  | { tipo: 'nuevo'; rutina: Rutina }
  | { tipo: 'existente'; rutina: Rutina; hueco: HuecoDeRutina; posicion: number | null }

/** Una alternativa en el formulario, con su objetivo tecleado. */
type AlternativaEnFormulario = { ejercicio: DatosEjercicio; objetivo: ObjetivoEnTexto }

type Formulario = {
  principal: DatosEjercicio | null
  objetivo: ObjetivoEnTexto
  alternativas: AlternativaEnFormulario[]
}

type Datos = { origen: Origen; ejercicios: DatosEjercicio[]; grupos: GrupoMuscular[] }

type Pregunta = 'ocultar' | 'mostrar' | 'borrar' | 'quitar'

/** Un ejercicio nuevo: sin elegir, con el objetivo de peso y repeticiones de Ajustes. */
function vacio(): Formulario {
  return { principal: null, objetivo: deAjustes({ tipo_registro: 'peso_reps' }), alternativas: [] }
}

function desdeBorrador(ejercicio: EjercicioDelBorrador): Formulario {
  return {
    principal: ejercicio.principal,
    objetivo: enTexto(ejercicio.objetivo),
    alternativas: ejercicio.alternativas.map((alternativa) => ({
      ejercicio: alternativa.ejercicio,
      objetivo: enTexto(alternativa.objetivo),
    })),
  }
}

function desdeHueco(hueco: HuecoDeRutina): Formulario {
  return {
    principal: hueco.ejercicio_principal,
    objetivo: enTexto(hueco),
    alternativas: hueco.alternativas.map((alternativa) => ({
      ejercicio: alternativa.ejercicio,
      objetivo: enTexto(alternativa),
    })),
  }
}

/** Lo que no vale, dicho para quien lo rellena; nulo si todo está bien. */
function queFalta(formulario: Formulario) {
  if (!formulario.principal) return 'Elige el ejercicio principal.'
  const delPrincipal = queFaltaDelObjetivo(
    formulario.principal.nombre,
    familiaDe(formulario.principal),
    formulario.objetivo,
  )
  if (delPrincipal) return delPrincipal
  for (const alternativa of formulario.alternativas) {
    const falta = queFaltaDelObjetivo(
      alternativa.ejercicio.nombre,
      familiaDe(alternativa.ejercicio),
      alternativa.objetivo,
    )
    if (falta) return falta
  }
  return null
}

async function leer(rutinaId: number | null, clave: string): Promise<Datos | 'sin-borrador'> {
  const [ejercicios, grupos] = await Promise.all([api.ejercicios(), api.gruposMusculares()])
  if (rutinaId === null) {
    const borrador = leerBorradorDeRutina()
    if (!borrador) return 'sin-borrador'
    const indice = clave === 'nuevo' ? null : Number(clave)
    if (indice !== null && !borrador.ejercicios[indice]) return 'sin-borrador'
    return { origen: { tipo: 'borrador', borrador, indice }, ejercicios, grupos }
  }
  const rutina = await api.rutina(rutinaId)
  if (clave === 'nuevo') return { origen: { tipo: 'nuevo', rutina }, ejercicios, grupos }
  const hueco = rutina.slots.find((uno) => uno.id === Number(clave))
  if (!hueco) throw new ErrorDeApi('Ese ejercicio no existe en esta rutina.', 404, null)
  const visibles = rutina.slots
    .filter((uno) => uno.oculto_desde === null)
    .sort((uno, otro) => uno.orden - otro.orden)
  const posicion = hueco.oculto_desde === null ? visibles.indexOf(hueco) + 1 : null
  return { origen: { tipo: 'existente', rutina, hueco, posicion }, ejercicios, grupos }
}

/**
 * P4 · Un ejercicio de una rutina: el principal, sus alternativas (las que se pueden
 * hacer en su lugar) y el objetivo de series y repeticiones.
 *
 * En la rutina nueva, *Guardar* solo cambia su borrador:
 * lo que guarda de verdad es el *Guardar* de la rutina. En una rutina que ya existe,
 * *Guardar* guarda al momento. Un ejercicio oculto, o uno de una rutina oculta, se ve
 * sin poder cambiarlo.
 */
export function Ejercicio() {
  const { rutinaId, huecoId, indice } = useParams()
  const enBorrador = rutinaId === undefined
  const idRutina = enBorrador ? null : Number(rutinaId)
  const clave = (enBorrador ? indice : huecoId) ?? 'nuevo'
  const navegar = useNavigate()
  const volver = useVolver()
  const padre = enBorrador ? '/programas/rutinas/nueva' : `/programas/rutinas/${rutinaId}`

  const [datos, setDatos] = useState<Datos | null>(null)
  const [formulario, setFormulario] = useState<Formulario>(vacio)
  const [error, setError] = useState<string | null>(null)
  const [hoja, setHoja] = useState<'principal' | 'alternativa' | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [aviso, setAviso] = useState<AvisoDeBorrarHueco | null>(null)
  // La alternativa con su objetivo a la vista: una sola a la vez.
  const [abierta, setAbierta] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const aplicar = useCallback((leidos: Datos) => {
    setDatos(leidos)
    const { origen } = leidos
    if (origen.tipo === 'borrador' && origen.indice !== null) {
      setFormulario(desdeBorrador(origen.borrador.ejercicios[origen.indice]))
    } else if (origen.tipo === 'existente') {
      setFormulario(desdeHueco(origen.hueco))
    }
  }, [])

  useEffect(() => {
    let vigente = true
    leer(idRutina, clave)
      .then((leidos) => {
        if (!vigente) return
        // Sin borrador (se recargó tras guardarlo, o el enlace es viejo) no hay nada que
        // editar: a la rutina nueva, que empieza otro.
        if (leidos === 'sin-borrador') navegar('/programas/rutinas/nueva', { replace: true })
        else aplicar(leidos)
      })
      .catch((fallo: Error) => {
        if (!vigente) return
        setError(
          fallo instanceof ErrorDeApi && fallo.estado === 404
            ? 'Ese ejercicio no existe.'
            : fallo.message,
        )
      })
    return () => {
      vigente = false
    }
  }, [idRutina, clave, navegar, aplicar])

  const cerrarHoja = useCallback(() => setHoja(null), [])

  if (error) return <p className="aviso error">{error}</p>
  if (!datos) return <p className="aviso">Cargando…</p>

  const { origen, ejercicios, grupos } = datos
  // El grupo del principal, a la derecha de su etiqueta (decisión del autor): suelto debajo
  // se confundía con la etiqueta de un campo, y dentro del recuadro no convencía. Que sea
  // predefinido o tuyo no se dice: aquí no cambia nada; se ve al elegirlo.
  const suGrupo = grupos.find((uno) => uno.id === formulario.principal?.grupo_muscular_id)
  const grupo = suGrupo && <span className="ejercicio-grupo">{suGrupo.nombre}</span>
  const huecoOculto = origen.tipo === 'existente' && origen.hueco.oculto_desde !== null
  const rutinaOculta = origen.tipo !== 'borrador' && origen.rutina.oculto_desde !== null
  const soloLectura = huecoOculto || rutinaOculta
  const nombreDeRutina =
    origen.tipo === 'borrador'
      ? origen.borrador.nombre.trim() || 'Rutina nueva'
      : origen.rutina.nombre

  let titulo: string
  let subtitulo = nombreDeRutina
  if (origen.tipo === 'borrador' && origen.indice !== null) {
    titulo = `Ejercicio ${origen.indice + 1}`
  } else if (origen.tipo === 'existente') {
    titulo = origen.posicion === null ? 'Ejercicio oculto' : `Ejercicio ${origen.posicion}`
  } else {
    titulo = 'Añadir ejercicio'
    const cuantos =
      origen.tipo === 'borrador'
        ? origen.borrador.ejercicios.length
        : origen.rutina.slots.filter((uno) => uno.oculto_desde === null).length
    subtitulo = `${nombreDeRutina} · será el ejercicio ${cuantos + 1}`
  }
  const principalNombre = formulario.principal?.nombre ?? 'el ejercicio'

  function cambiar(cambios: Partial<Formulario>) {
    setFormulario((antes) => ({ ...antes, ...cambios }))
    setFallo(null)
  }

  function elegir(ejercicio: DatosEjercicio) {
    if (hoja === 'principal') {
      // Si era una alternativa, deja de serlo (no puede ser las dos cosas) y se lleva su
      // objetivo. Si no, con la misma unidad que el principal de antes se conserva el
      // objetivo; con otra, toma el de su tipo en Ajustes.
      const eraAlternativa = formulario.alternativas.find(
        (otra) => otra.ejercicio.id === ejercicio.id,
      )
      const mismaUnidad =
        formulario.principal !== null && familiaDe(formulario.principal) === familiaDe(ejercicio)
      cambiar({
        principal: ejercicio,
        objetivo:
          eraAlternativa?.objetivo ?? (mismaUnidad ? formulario.objetivo : deAjustes(ejercicio)),
        alternativas: formulario.alternativas.filter((otra) => otra.ejercicio.id !== ejercicio.id),
      })
      setAbierta(null)
    } else {
      // Una alternativa nueva nace con el objetivo de su tipo, no con el del principal.
      cambiar({
        alternativas: [...formulario.alternativas, { ejercicio, objetivo: deAjustes(ejercicio) }],
      })
      setAbierta(formulario.alternativas.length)
    }
    setHoja(null)
  }

  async function confirmar() {
    const motivo = queFalta(formulario)
    if (motivo) {
      setFallo(motivo)
      return
    }
    const objetivoDelPrincipal = aObjetivo(familiaDe(formulario.principal!), formulario.objetivo)
    const alternativas = formulario.alternativas.map((alternativa) => ({
      ejercicio: alternativa.ejercicio,
      objetivo: aObjetivo(familiaDe(alternativa.ejercicio), alternativa.objetivo),
    }))

    if (origen.tipo === 'borrador') {
      const ejercicio: EjercicioDelBorrador = {
        principal: formulario.principal!,
        objetivo: objetivoDelPrincipal,
        alternativas,
      }
      const lista = [...origen.borrador.ejercicios]
      if (origen.indice === null) lista.push(ejercicio)
      else lista[origen.indice] = ejercicio
      guardarBorrador(RUTINA_NUEVA, { ...origen.borrador, ejercicios: lista })
      volver(padre)
      return
    }

    const cuerpo = {
      ejercicio_principal_id: formulario.principal!.id,
      ...objetivoDelPrincipal,
      alternativas: alternativas.map((alternativa) => ({
        ejercicio_id: alternativa.ejercicio.id,
        ...alternativa.objetivo,
      })),
    }
    setGuardando(true)
    try {
      if (origen.tipo === 'nuevo') await api.crearHueco(origen.rutina.id, cuerpo)
      else
        await api.actualizarHueco(origen.rutina.id, origen.hueco.id, {
          ...cuerpo,
          orden: origen.hueco.orden,
        })
      volver(padre)
    } catch (fallo) {
      setFallo((fallo as Error).message)
      setGuardando(false)
    }
  }

  async function preguntarBorrar() {
    if (origen.tipo !== 'existente') return
    setFallo(null)
    try {
      setAviso(await api.avisoDeBorrarHueco(origen.rutina.id, origen.hueco.id))
      setPregunta('borrar')
    } catch (fallo) {
      setFallo((fallo as Error).message)
    }
  }

  async function recargar() {
    const leidos = await leer(idRutina, clave)
    if (leidos !== 'sin-borrador') aplicar(leidos)
  }

  return (
    <div className="ejercicio">
      <header className="sesion-cabecera">
        <button
          type="button"
          className="boton-icono"
          aria-label="Volver"
          onClick={() => volver(padre)}
        >
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>{titulo}</h1>
          <p>{subtitulo}</p>
        </div>
        {soloLectura ? (
          <span className="semana-hueco" />
        ) : (
          <button
            type="button"
            className="dia-cabecera-boton"
            onClick={() => void confirmar()}
            disabled={guardando}
          >
            Guardar
          </button>
        )}
      </header>

      {huecoOculto && origen.tipo === 'existente' && (
        <div className="semana-oculto">
          <strong>
            Oculto en esta rutina desde el {diaYMesConAnio(origen.hueco.oculto_desde!)}
          </strong>
          <span>No sale en la rutina ni al entrenar.</span>
          <span>Su historial sigue intacto.</span>
        </div>
      )}
      {rutinaOculta && !huecoOculto && (
        <div className="semana-oculto">
          <strong>{nombreDeRutina} está oculta</strong>
          <span>Para cambiar sus ejercicios, muéstrala antes.</span>
        </div>
      )}

      {fallo && <p className="aviso error">{fallo}</p>}

      <section className="ejercicio-tarjeta">
        <div className="campo">
          <div className="ejercicio-cabecera-campo">
            <span className="ejercicio-tarjeta-titulo">Ejercicio principal</span>
            {grupo}
          </div>
          {soloLectura ? (
            <div className="ejercicio-caja">{formulario.principal?.nombre}</div>
          ) : (
            <button
              type="button"
              className="ejercicio-caja"
              onClick={() => setHoja('principal')}
              disabled={guardando}
            >
              <span className={formulario.principal ? undefined : 'ejercicio-sin-elegir'}>
                {formulario.principal?.nombre ?? 'Elige un ejercicio'}
              </span>
              {formulario.principal?.oculto_desde && <span className="etiqueta-chica">oculto</span>}
              <Icono nombre="abajo" pequeno />
            </button>
          )}
        </div>
        {/* Para que nadie oculte o borre un ejercicio de la rutina solo para hacer otro: basta
            con cambiarlo, y su historial no se toca. */}
        {origen.tipo === 'existente' && !soloLectura && (
          <p className="ejercicio-ayuda">Puedes cambiarlo por otro sin perder lo que ya hiciste.</p>
        )}

        {formulario.principal && (
          <CamposDelObjetivo
            familia={familiaDe(formulario.principal)}
            valor={formulario.objetivo}
            cambiar={(cambios) => cambiar({ objetivo: { ...formulario.objetivo, ...cambios } })}
            soloLectura={soloLectura}
          />
        )}
      </section>

      <section className="ejercicio-tarjeta">
        <div className="campo">
          <span className="ejercicio-tarjeta-titulo">Alternativas</span>
          {formulario.alternativas.length > 0 && (
            <p className="ejercicio-ayuda">
              Cada una tiene su propio objetivo.
              {!soloLectura && ' Toca una para verlo o cambiarlo.'}
            </p>
          )}
          <div className="ejercicio-alternativas">
            {formulario.alternativas.map((alternativa, posicion) => {
              const { ejercicio } = alternativa
              const desplegada = !soloLectura && abierta === posicion
              return (
                <div
                  key={ejercicio.id}
                  className={desplegada ? 'ejercicio-alternativa abierta' : 'ejercicio-alternativa'}
                >
                  <div className="ejercicio-alternativa-fila">
                    <button
                      type="button"
                      className="ejercicio-alternativa-cuerpo"
                      aria-expanded={desplegada}
                      onClick={() => setAbierta(desplegada ? null : posicion)}
                      disabled={soloLectura || guardando}
                    >
                      <span className="ejercicio-alternativa-nombre">{ejercicio.nombre}</span>
                      {ejercicio.oculto_desde && <span className="etiqueta-chica">oculto</span>}
                      <span className="rutina-objetivo num">
                        {resumenDelObjetivo(ejercicio, alternativa.objetivo)}
                      </span>
                    </button>
                    {!soloLectura && (
                      <button
                        type="button"
                        className="ejercicio-chip-quitar"
                        aria-label={`Quitar ${ejercicio.nombre}`}
                        onClick={() => {
                          cambiar({
                            alternativas: formulario.alternativas.filter((_, i) => i !== posicion),
                          })
                          setAbierta(null)
                        }}
                        disabled={guardando}
                      >
                        <Icono nombre="quitar" pequeno />
                      </button>
                    )}
                  </div>
                  {desplegada && (
                    <div className="ejercicio-alternativa-campos">
                      <CamposDelObjetivo
                        familia={familiaDe(ejercicio)}
                        valor={alternativa.objetivo}
                        cambiar={(cambios) =>
                          cambiar({
                            alternativas: formulario.alternativas.map((otra, i) =>
                              i === posicion
                                ? { ...otra, objetivo: { ...otra.objetivo, ...cambios } }
                                : otra,
                            ),
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              )
            })}
            {!soloLectura && (
              <button
                type="button"
                className="ejercicio-chip nueva"
                onClick={() => setHoja('alternativa')}
                disabled={guardando}
              >
                + Añadir alternativa
              </button>
            )}
            {soloLectura && formulario.alternativas.length === 0 && (
              <span className="ejercicio-ayuda">Ninguna</span>
            )}
          </div>
        </div>
      </section>

      <div className="ejercicio-acciones">
        {origen.tipo === 'borrador' && origen.indice !== null && (
          <button
            type="button"
            className="boton boton-texto peligro"
            onClick={() => setPregunta('quitar')}
          >
            Quitar de la rutina
          </button>
        )}
        {(origen.tipo === 'nuevo' || (origen.tipo === 'borrador' && origen.indice === null)) && (
          <button type="button" className="boton boton-texto" onClick={() => volver(padre)}>
            Cancelar
          </button>
        )}
        {origen.tipo === 'existente' && !rutinaOculta && (
          <>
            {huecoOculto ? (
              <button
                type="button"
                className="boton boton-principal"
                onClick={() => setPregunta('mostrar')}
              >
                Mostrar en esta rutina
              </button>
            ) : (
              <button
                type="button"
                className="boton boton-texto"
                onClick={() => setPregunta('ocultar')}
                disabled={guardando}
              >
                Ocultar en esta rutina
              </button>
            )}
            <button
              type="button"
              className="boton boton-texto peligro"
              onClick={() => void preguntarBorrar()}
              disabled={guardando}
            >
              Borrar ejercicio
            </button>
          </>
        )}
      </div>

      {hoja && (
        <HojaDeEjercicios
          titulo={hoja === 'principal' ? 'Ejercicio principal' : 'Alternativa'}
          subtitulo={`${titulo} · ${nombreDeRutina}`}
          ejercicios={ejercicios}
          grupos={grupos}
          excluir={
            hoja === 'principal'
              ? []
              : [
                  ...(formulario.principal ? [formulario.principal.id] : []),
                  ...formulario.alternativas.map((alternativa) => alternativa.ejercicio.id),
                ]
          }
          elegido={hoja === 'principal' ? (formulario.principal?.id ?? null) : null}
          alElegir={elegir}
          alCerrar={cerrarHoja}
        />
      )}

      {pregunta === 'quitar' && origen.tipo === 'borrador' && origen.indice !== null && (
        <Dialogo
          titulo={`¿Quitar ${principalNombre}?`}
          confirmar="Quitar"
          peligro
          alConfirmar={async () => {
            const lista = origen.borrador.ejercicios.filter((_, i) => i !== origen.indice)
            guardarBorrador(RUTINA_NUEVA, { ...origen.borrador, ejercicios: lista })
            volver(padre)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'ocultar' && origen.tipo === 'existente' && (
        <Dialogo
          titulo={`¿Ocultar ${principalNombre} en ${origen.rutina.nombre}?`}
          cuerpo={`Dejará de salir en esta rutina y en tus próximas sesiones. Lo que hiciste con él sigue en tu historial, y podrás volver a mostrarlo desde la rutina. ${CAMBIARLO}`}
          confirmar="Ocultar"
          alConfirmar={async () => {
            await api.borrarHueco(origen.rutina.id, origen.hueco.id, 'ocultar')
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && origen.tipo === 'existente' && (
        <Dialogo
          titulo={`¿Mostrar ${principalNombre} en ${origen.rutina.nombre}?`}
          cuerpo={`Volverá a salir en la rutina ${origen.rutina.nombre} y en tus próximas sesiones.`}
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarHueco(origen.rutina.id, origen.hueco.id)
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && origen.tipo === 'existente' && aviso && (
        <Dialogo
          titulo={`¿Borrar ${principalNombre}?`}
          cuerpo={loQueSePierde(aviso, huecoOculto)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            // Siempre en definitivo: sin historial, ese modo borra directo igual.
            await api.borrarHueco(origen.rutina.id, origen.hueco.id, 'definitivo')
            volver(padre)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
    </div>
  )
}

/** Que no hace falta ocultar ni borrar para hacer otro ejercicio en su lugar. */
const CAMBIARLO =
  'Si quieres hacer otro ejercicio en su lugar, cambia el ejercicio principal o las alternativas y lo que ya hiciste se conservará.'

/** "Se borrarán también sus 47 series, apuntadas desde el 6 de julio…"; sin series, nada. */
function loQueSePierde(aviso: AvisoDeBorrarHueco, oculto: boolean) {
  if (aviso.series === 0) return undefined
  const series = aviso.series === 1 ? 'su serie' : `sus ${aviso.series} series`
  const desde = aviso.desde ? `, apuntadas desde el ${diaYMesConAnio(aviso.desde)}` : ''
  const vacias = aviso.sesiones_que_se_vacian.length
  const sesiones =
    vacias === 0
      ? ''
      : vacias === 1
        ? ', y 1 sesión que solo tenía series de este ejercicio'
        : `, y ${vacias} sesiones que solo tenían series de este ejercicio`
  // Ocultarlo en la rutina como salida solo tiene sentido si aún se ve en ella.
  const salida = oculto
    ? ''
    : ` Si solo quieres que deje de salir, ocúltalo en esta rutina y su historial se conservará. ${CAMBIARLO}`
  return `Se borrarán también ${series}${desde}${sesiones}.${salida}`
}
