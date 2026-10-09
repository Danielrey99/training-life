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
import { leerNumero } from '../../utiles/numeros'
import { useVolver } from '../../utiles/volver'
import '../historial/historial.css'
import { CampoConPasos } from '../sesion/FormularioDeSerie'
import '../sesion/sesion.css'
import {
  guardarBorrador,
  leerBorrador,
  RUTINA_NUEVA,
  type BorradorDeRutina,
  type EjercicioDelBorrador,
} from './borradores'
import './ejercicio.css'
import { HojaDeEjercicios } from './HojaDeEjercicios'
import './semana.css'
import { deDonde } from './textos'

/**
 * De dónde sale lo que se edita: un ejercicio del borrador de la rutina nueva (nada
 * se guarda hasta el *Guardar* de esa rutina), uno nuevo de una rutina que ya existe,
 * o uno que ya existe.
 */
type Origen =
  | { tipo: 'borrador'; borrador: BorradorDeRutina; indice: number | null }
  | { tipo: 'nuevo'; rutina: Rutina }
  | { tipo: 'existente'; rutina: Rutina; hueco: HuecoDeRutina; posicion: number | null }

type Formulario = {
  principal: DatosEjercicio | null
  alternativas: DatosEjercicio[]
  series: string
  repsMin: string
  repsMax: string
}

type Datos = { origen: Origen; ejercicios: DatosEjercicio[]; grupos: GrupoMuscular[] }

type Pregunta = 'ocultar' | 'mostrar' | 'borrar' | 'quitar'

// Lo habitual en doble progresión: 3 series de 8 a 12.
const VACIO: Formulario = {
  principal: null,
  alternativas: [],
  series: '3',
  repsMin: '8',
  repsMax: '12',
}

function desdeBorrador(ejercicio: EjercicioDelBorrador): Formulario {
  return {
    principal: ejercicio.principal,
    alternativas: ejercicio.alternativas,
    series: String(ejercicio.series),
    repsMin: String(ejercicio.repsMin),
    repsMax: String(ejercicio.repsMax),
  }
}

function desdeHueco(hueco: HuecoDeRutina): Formulario {
  return {
    principal: hueco.ejercicio_principal,
    alternativas: hueco.alternativas,
    series: String(hueco.series_objetivo),
    repsMin: String(hueco.reps_min),
    repsMax: String(hueco.reps_max),
  }
}

/** Lo que no vale, dicho para quien lo rellena; nulo si todo está bien. */
function queFalta(formulario: Formulario) {
  const series = leerNumero(formulario.series)
  const min = leerNumero(formulario.repsMin)
  const max = leerNumero(formulario.repsMax)
  if (!formulario.principal) return 'Elige el ejercicio principal.'
  if (series === null || !Number.isInteger(series) || series < 1 || series > 50) {
    return 'Las series tienen que ser un número entero entre 1 y 50.'
  }
  if (min === null || max === null || !Number.isInteger(min) || !Number.isInteger(max)) {
    return 'Las repeticiones tienen que ser números enteros.'
  }
  if (min < 1 || max > 1000) return 'Las repeticiones tienen que estar entre 1 y 1000.'
  if (max < min) return 'Las repeticiones máximas no pueden ser menos que las mínimas.'
  return null
}

async function leer(rutinaId: number | null, clave: string): Promise<Datos | 'sin-borrador'> {
  const [ejercicios, grupos] = await Promise.all([api.ejercicios(), api.gruposMusculares()])
  if (rutinaId === null) {
    const borrador = leerBorrador<BorradorDeRutina>(RUTINA_NUEVA)
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
  const [formulario, setFormulario] = useState<Formulario>(VACIO)
  const [error, setError] = useState<string | null>(null)
  const [hoja, setHoja] = useState<'principal' | 'alternativa' | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [aviso, setAviso] = useState<AvisoDeBorrarHueco | null>(null)
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
  const nombreDeGrupo = new Map(grupos.map((uno) => [uno.id, uno.nombre]))
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
    titulo = 'Nuevo ejercicio'
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
      // Si era una alternativa, deja de serlo: no puede ser las dos cosas.
      cambiar({
        principal: ejercicio,
        alternativas: formulario.alternativas.filter((otro) => otro.id !== ejercicio.id),
      })
    } else {
      cambiar({ alternativas: [...formulario.alternativas, ejercicio] })
    }
    setHoja(null)
  }

  async function confirmar() {
    const motivo = queFalta(formulario)
    if (motivo) {
      setFallo(motivo)
      return
    }
    const series = Number(leerNumero(formulario.series))
    const repsMin = Number(leerNumero(formulario.repsMin))
    const repsMax = Number(leerNumero(formulario.repsMax))

    if (origen.tipo === 'borrador') {
      const ejercicio: EjercicioDelBorrador = {
        principal: formulario.principal!,
        alternativas: formulario.alternativas,
        series,
        repsMin,
        repsMax,
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
      alternativa_ids: formulario.alternativas.map((ejercicio) => ejercicio.id),
      series_objetivo: series,
      reps_min: repsMin,
      reps_max: repsMax,
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
          <strong>Oculto desde el {diaYMesConAnio(origen.hueco.oculto_desde!)}</strong>
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

      <div className="campo">
        <span className="campo-etiqueta">Ejercicio principal</span>
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
        {formulario.principal && (
          <span className="ejercicio-ayuda">{deDonde(formulario.principal, nombreDeGrupo)}</span>
        )}
      </div>

      <div className="campo">
        <span className="campo-etiqueta">Alternativas</span>
        {!soloLectura && (
          <span className="ejercicio-ayuda">
            Las que puedes hacer en su lugar, por ejemplo si la máquina está ocupada.
          </span>
        )}
        <div className="ejercicio-chips">
          {formulario.alternativas.map((ejercicio) => (
            <span key={ejercicio.id} className="ejercicio-chip">
              {ejercicio.nombre}
              {ejercicio.oculto_desde && <span className="etiqueta-chica">oculto</span>}
              {!soloLectura && (
                <button
                  type="button"
                  className="ejercicio-chip-quitar"
                  aria-label={`Quitar ${ejercicio.nombre}`}
                  onClick={() =>
                    cambiar({
                      alternativas: formulario.alternativas.filter((otro) => otro !== ejercicio),
                    })
                  }
                  disabled={guardando}
                >
                  <Icono nombre="quitar" pequeno />
                </button>
              )}
            </span>
          ))}
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

      {soloLectura ? (
        <>
          <div className="campo">
            <span className="campo-etiqueta">Series objetivo</span>
            <div className="ejercicio-caja num">{formulario.series}</div>
          </div>
          <div className="ejercicio-reps">
            <div className="campo">
              <span className="campo-etiqueta">Reps mínimas</span>
              <div className="ejercicio-caja num">{formulario.repsMin}</div>
            </div>
            <div className="campo">
              <span className="campo-etiqueta">Reps máximas</span>
              <div className="ejercicio-caja num">{formulario.repsMax}</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <CampoConPasos
            etiqueta="Series objetivo"
            valor={formulario.series}
            cambiar={(series) => cambiar({ series })}
            paso={1}
            minimo={1}
          />
          <div className="ejercicio-reps">
            <CampoConPasos
              etiqueta="Reps mínimas"
              valor={formulario.repsMin}
              cambiar={(repsMin) => cambiar({ repsMin })}
              paso={1}
              minimo={1}
            />
            <CampoConPasos
              etiqueta="Reps máximas"
              valor={formulario.repsMax}
              cambiar={(repsMax) => cambiar({ repsMax })}
              paso={1}
              minimo={1}
            />
          </div>
        </>
      )}

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
                Mostrar ejercicio
              </button>
            ) : (
              <button
                type="button"
                className="boton boton-texto"
                onClick={() => setPregunta('ocultar')}
                disabled={guardando}
              >
                Ocultar ejercicio
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
                  ...formulario.alternativas.map((ejercicio) => ejercicio.id),
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
          titulo={`¿Ocultar ${principalNombre}?`}
          cuerpo={`Dejará de salir en la rutina ${origen.rutina.nombre} y en tus próximas sesiones. Lo que hiciste con él sigue en tu historial, y podrás volver a mostrarlo desde la rutina.`}
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
          titulo={`¿Mostrar ${principalNombre}?`}
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
  // Ocultarlo como salida solo tiene sentido si aún se ve.
  const salida = oculto ? '' : ' Si solo quieres que deje de salir, ocúltalo.'
  return `Se borrarán también ${series}${desde}${sesiones}.${salida}`
}
