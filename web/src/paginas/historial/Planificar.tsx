import { useCallback, useEffect, useRef, useState } from 'react'

import { api, ErrorDeApi } from '../../api/cliente'
import type { DiaSeguimiento, Hoy, Programa, RutinaDeHoy } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { colorDeRutina, SIN_DIA } from '../../utiles/colores'
import { diaDeLaSemana, fechaLarga, nombreDelDia, sumarDias } from '../../utiles/fechas'
import { useVolver } from '../../utiles/volver'
import './planificar.css'

// Las semanas que se piden de una vez, y el máximo de días que admite el backend por llamada
// (400) con un margen.
const SEMANAS_POR_TANDA = 4
const DIAS_POR_LLAMADA = 392

function contar(cuantos: number) {
  return cuantos === 1 ? '1 ejercicio' : `${cuantos} ejercicios`
}

function mayuscula(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** "Mar 15": el día de la semana en tres letras y el número. */
function etiquetaDelDia(fecha: string) {
  return `${mayuscula(nombreDelDia(fecha).slice(0, 3))} ${Number(fecha.slice(8))}`
}

function lunesDe(fecha: string) {
  return sumarDias(fecha, 1 - diaDeLaSemana(fecha))
}

/** El domingo de la semana de `fecha`. */
function domingoDe(fecha: string) {
  return sumarDias(fecha, 7 - diaDeLaSemana(fecha))
}

/** Los días de `desde` a `hasta`, en las llamadas que haga falta. */
async function leerDias(desde: string, hasta: string) {
  const dias: DiaSeguimiento[] = []
  for (let inicio = desde; inicio <= hasta; inicio = sumarDias(inicio, DIAS_POR_LLAMADA)) {
    const fin = sumarDias(inicio, DIAS_POR_LLAMADA - 1)
    dias.push(...(await api.seguimiento(inicio, fin < hasta ? fin : hasta)))
  }
  return dias
}

type Semana = { lunes: string; domingo: string; dias: DiaSeguimiento[] }

type Confirmacion = {
  titulo: string
  cuerpo: string
  alConfirmar: () => Promise<void>
}

/**
 * H4 · Planificar: qué toca cada día de hoy en adelante, por semanas y sin límite.
 *
 * Cambiar un día sustituye lo que tocaba (no lo intercambia con otro) y se guarda
 * al tocar. El backend decide qué día cuenta cada sesión y si un cambio deja sin
 * día a lo que ya se hizo por adelantado (409); esta pantalla solo lo pinta y
 * explica por qué no se puede. El pasado no se planifica: la lista empieza hoy.
 */
export function Planificar() {
  const volver = useVolver()
  const [resumen, setResumen] = useState<Hoy | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [dias, setDias] = useState<DiaSeguimiento[]>([])
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<DiaSeguimiento | null>(null)
  const [confirmando, setConfirmando] = useState<Confirmacion | null>(null)
  const cargandoMas = useRef(false)
  const final = useRef<HTMLDivElement>(null)
  const ultimo = dias.length > 0 ? dias[dias.length - 1].fecha : null

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const [leido, programas] = await Promise.all([api.hoy(), api.programas()])
        const lista = await leerDias(
          leido.fecha,
          sumarDias(domingoDe(leido.fecha), 7 * (SEMANAS_POR_TANDA - 1)),
        )
        if (!vigente) return
        setResumen(leido)
        setPrograma(programas.find((uno) => uno.activo) ?? null)
        setDias(lista)
      } catch (fallo) {
        if (vigente) setError((fallo as Error).message)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [])

  /** Vuelve a leer todo lo cargado: un cambio puede mover lo que se hizo por adelantado. */
  const recargar = useCallback(async () => {
    if (!resumen || !ultimo) return
    const lista = await leerDias(resumen.fecha, ultimo)
    // Las semanas que llegaron mientras tanto (al bajar) se conservan.
    setDias((antes) => [...lista, ...antes.filter((dia) => dia.fecha > ultimo)])
  }, [resumen, ultimo])

  const cargarMas = useCallback(async () => {
    if (cargandoMas.current || !ultimo) return
    cargandoMas.current = true
    try {
      const mas = await leerDias(sumarDias(ultimo, 1), sumarDias(ultimo, 7 * SEMANAS_POR_TANDA))
      setDias((antes) => [...antes, ...mas])
    } catch (fallo) {
      setError((fallo as Error).message)
    } finally {
      cargandoMas.current = false
    }
  }, [ultimo])

  // Al llegar al final de la lista se piden más semanas.
  useEffect(() => {
    const elemento = final.current
    if (!elemento) return
    const vigilante = new IntersectionObserver(
      (entradas) => entradas.some((una) => una.isIntersecting) && void cargarMas(),
      { rootMargin: '200px' },
    )
    vigilante.observe(elemento)
    return () => vigilante.disconnect()
  }, [cargarMas, resumen])

  if (error) return <p className="aviso error">{error}</p>
  if (!resumen) return <p className="aviso">Cargando…</p>

  const hoy = resumen.fecha

  // Una semana por grupo, de lunes a domingo; la primera empieza hoy.
  const semanas: Semana[] = []
  for (const dia of dias) {
    const lunes = lunesDe(dia.fecha)
    const ultima = semanas[semanas.length - 1]
    if (ultima && ultima.lunes === lunes) ultima.dias.push(dia)
    else semanas.push({ lunes, domingo: sumarDias(lunes, 6), dias: [dia] })
  }

  function ejercicios(rutinaId: number) {
    const datos = resumen!.rutinas.find((una) => una.id === rutinaId)
    return datos ? contar(datos.ejercicios) : ''
  }

  function pedirRestablecerSemana(semana: Semana) {
    const cambiados = semana.dias.filter((dia) => dia.origen === 'excepcion').length
    const esta = semana.lunes === lunesDe(hoy)
    setConfirmando({
      titulo: esta
        ? '¿Restablecer esta semana?'
        : `¿Restablecer la semana del ${Number(semana.lunes.slice(8))}?`,
      cuerpo:
        cambiados === 1
          ? 'El día que cambiaste volverá a lo que dice el programa.'
          : `Los ${cambiados} días que cambiaste volverán a lo que dice el programa.`,
      alConfirmar: async () => {
        await api.restablecerRango(semana.dias[0].fecha, semana.domingo)
        await recargar()
        setConfirmando(null)
      },
    })
  }

  return (
    <div className="planificar">
      <header className="sesion-cabecera">
        <button
          type="button"
          className="boton-icono"
          aria-label="Volver"
          onClick={() => volver('/historial')}
        >
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>Planificar</h1>
          {programa && <p>{programa.nombre}</p>}
        </div>
        <span className="planificar-hueco" />
      </header>

      <p className="planificar-ayuda">Cambia qué toca cada día.</p>

      {semanas.map((semana) => {
        const esta = semana.lunes === lunesDe(hoy)
        const hayCambios = semana.dias.some((dia) => dia.origen === 'excepcion')
        return (
          <section key={semana.lunes} className="planificar-seccion">
            <div className="planificar-semana">
              <h2 className="rotulo">
                {esta ? 'Esta semana' : `Semana del ${Number(semana.lunes.slice(8))}`}
              </h2>
              {hayCambios && (
                <button
                  type="button"
                  className="planificar-restablecer"
                  onClick={() => pedirRestablecerSemana(semana)}
                >
                  Restablecer {esta ? 'esta semana' : 'la semana'}
                </button>
              )}
            </div>
            <div className="planificar-dias">
              {semana.dias.map((dia) => (
                <FilaDelDia
                  key={dia.fecha}
                  dia={dia}
                  hoy={hoy}
                  programa={programa}
                  ejercicios={ejercicios}
                  alTocar={() => setAbierto(dia)}
                />
              ))}
            </div>
          </section>
        )
      })}

      <div ref={final} className="planificar-final">
        Sigue bajando para más semanas
      </div>

      {abierto && (
        <HojaDelDia
          dia={abierto}
          programa={programa}
          resumen={resumen}
          ejercicios={ejercicios}
          alCambiar={recargar}
          alCerrar={() => setAbierto(null)}
        />
      )}

      {confirmando && (
        <Dialogo
          titulo={confirmando.titulo}
          cuerpo={confirmando.cuerpo}
          confirmar="Restablecer"
          alConfirmar={confirmando.alConfirmar}
          alCancelar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}

type PropsFila = {
  dia: DiaSeguimiento
  hoy: string
  programa: Programa | null
  ejercicios: (rutinaId: number) => string
  alTocar: () => void
}

/** Un día de la lista: qué toca, y si ya se hizo por adelantado o se cambió a mano. */
function FilaDelDia({ dia, hoy, programa, ejercicios, alTocar }: PropsFila) {
  const rutina = dia.descanso ? null : dia.rutina
  // Una rutina oculta sigue en su día, en gris, pero cuenta como descanso.
  const oculta = dia.rutina?.oculto_desde ? dia.rutina : null
  const hecho = dia.cubierto_por
  const adelantado = hecho && hecho.fecha !== dia.fecha
  return (
    <button type="button" className="planificar-dia" onClick={alTocar}>
      <span className={dia.fecha === hoy ? 'planificar-fecha es-hoy' : 'planificar-fecha'}>
        {etiquetaDelDia(dia.fecha)}
      </span>
      {rutina ? (
        <>
          <span
            className="marca-punto"
            style={{ background: colorDeRutina(programa?.dias, rutina.id) }}
          />
          <strong>{rutina.nombre}</strong>
          {!hecho && <span className="planificar-detalle">{ejercicios(rutina.id)}</span>}
        </>
      ) : oculta ? (
        <>
          <span className="marca-punto" style={{ background: SIN_DIA }} />
          <span className="planificar-oculta">{oculta.nombre}</span>
        </>
      ) : (
        <>
          <span className="planificar-espacio" />
          <span className="planificar-descanso">Descanso</span>
        </>
      )}
      <span className="planificar-relleno" />
      {hecho && (
        <span className="etiqueta-chica planificar-hecho">
          {adelantado ? `hecho el ${nombreDelDia(hecho.fecha)}` : 'hecho'}
        </span>
      )}
      {oculta && <span className="etiqueta-chica">oculta</span>}
      {dia.origen === 'excepcion' && <span className="etiqueta-chica">cambiado</span>}
      <Icono nombre="abrir" pequeno />
    </button>
  )
}

/** El porqué del 409, con las palabras del boceto. */
function porQueNoSePuede(rutina: string, fecha: string, hechoEl: string) {
  const suDia = nombreDelDia(fecha)
  // Hecho ese mismo día: solo puede ser hoy (el pasado no se planifica).
  if (hechoEl === fecha) {
    return (
      `El ${rutina} de hoy ya lo hiciste. Si hoy deja de tener ${rutina} y no lo pones en ` +
      `otro día de esta semana, lo que entrenaste no contaría para ningún día. Pon antes el ` +
      `${rutina} en otro día, y después cambia hoy.`
    )
  }
  const hecho = nombreDelDia(hechoEl)
  return (
    `El ${rutina} del ${suDia} ya lo hiciste el ${hecho}. Si el ${suDia} deja de tener ` +
    `${rutina} y no lo pones en otro día de esta semana, lo que entrenaste el ${hecho} no ` +
    `contaría para ningún día. Pon antes el ${rutina} en otro día, y después cambia el ${suDia}.`
  )
}

type PropsHoja = {
  dia: DiaSeguimiento
  programa: Programa | null
  resumen: Hoy
  ejercicios: (rutinaId: number) => string
  alCambiar: () => Promise<void>
  alCerrar: () => void
}

/** La hoja de un día: se elige qué toca y se guarda en el momento. */
function HojaDelDia({ dia, programa, resumen, ejercicios, alCambiar, alCerrar }: PropsHoja) {
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ titulo: string; cuerpo: string } | null>(null)

  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape' && !guardando && !aviso) alCerrar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [guardando, aviso, alCerrar])

  // Con una rutina oculta no hay nada elegido: ese día cuenta como descanso, pero elegir
  // *Descanso* sí cambia algo, porque lo deja así aunque la rutina se vuelva a mostrar.
  const oculta = dia.rutina?.oculto_desde ? dia.rutina : null
  const actual = oculta ? undefined : dia.descanso ? null : (dia.rutina?.id ?? null)
  const cambiado = dia.origen === 'excepcion'
  const delPrograma = programa?.dias.find((uno) => uno.dia_semana === diaDeLaSemana(dia.fecha))

  // Primero las del programa, en el orden de la semana (cada una una vez, aunque toque
  // dos días); debajo, las demás, por orden alfabético. Sin programa, todas en orden
  // alfabético. Solo las visibles: lo oculto deja de ofrecerse.
  const visibles = new Map(resumen.rutinas.map((rutina) => [rutina.id, rutina]))
  const delProgramaEnOrden: RutinaDeHoy[] = []
  for (const uno of [...(programa?.dias ?? [])].sort((a, b) => a.dia_semana - b.dia_semana)) {
    const rutina = visibles.get(uno.rutina.id)
    if (rutina && !delProgramaEnOrden.includes(rutina)) delProgramaEnOrden.push(rutina)
  }
  const enElPrograma = new Set(delProgramaEnOrden.map((rutina) => rutina.id))
  const otras = [...resumen.rutinas]
    .filter((rutina) => !enElPrograma.has(rutina.id))
    .sort((una, otra) => una.nombre.localeCompare(otra.nombre, 'es'))

  /** Lo que haya cambiado, guardado; los errores de lo hecho por adelantado se explican. */
  async function guardar(accion: () => Promise<unknown>) {
    setGuardando(true)
    setFallo(null)
    try {
      await accion()
      await alCambiar()
      alCerrar()
    } catch (error) {
      setGuardando(false)
      // El único 409 de cambiar un día: dejaría sin día lo que ya se entrenó para él.
      if (error instanceof ErrorDeApi && error.estado === 409 && dia.cubierto_por && dia.rutina) {
        setAviso({
          titulo: `No puedes quitar este ${dia.rutina.nombre}`,
          cuerpo: porQueNoSePuede(dia.rutina.nombre, dia.fecha, dia.cubierto_por.fecha),
        })
      } else {
        setFallo((error as Error).message)
      }
    }
  }

  function FilaDeRutina({ rutina }: { rutina: RutinaDeHoy }) {
    return (
      <button
        type="button"
        className="hoja-fila"
        onClick={() => elegir(rutina.id)}
        disabled={guardando}
      >
        <span
          className="marca-punto"
          style={{ background: colorDeRutina(programa?.dias, rutina.id) }}
        />
        <span className="hoja-fila-texto">
          <strong>{rutina.nombre}</strong>
        </span>
        <span className="hoja-fila-extra">{ejercicios(rutina.id)}</span>
        {actual === rutina.id && <Icono nombre="elegido" pequeno />}
      </button>
    )
  }

  function elegir(rutinaId: number | null) {
    // Elegir lo que ya toca no cambia nada: se cierra sin marcar el día como cambiado.
    if (rutinaId === actual) return alCerrar()
    void guardar(() => api.planificarDia(dia.fecha, rutinaId))
  }

  return (
    <div className="hoja-fondo" onClick={() => !guardando && !aviso && alCerrar()}>
      <div
        className="hoja"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoja-titulo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <span className="hoja-asa" />
        <h2 id="hoja-titulo">{fechaLarga(dia.fecha)}</h2>
        <p className="hoja-subtitulo">
          {oculta
            ? `${oculta.nombre} está oculta: este día cuenta como descanso`
            : !cambiado
              ? 'Elige qué toca este día'
              : !programa
                ? 'Sin programa activo sería descanso'
                : delPrograma
                  ? `Según el programa toca ${delPrograma.rutina.nombre}`
                  : 'Según el programa es descanso'}
        </p>

        {fallo && <p className="aviso error">{fallo}</p>}

        {delProgramaEnOrden.map((rutina) => (
          <FilaDeRutina key={rutina.id} rutina={rutina} />
        ))}
        {/* Sin programa no hay "otras": todas lo son, y van sin rótulo. */}
        {!programa && otras.map((rutina) => <FilaDeRutina key={rutina.id} rutina={rutina} />)}
        <button
          type="button"
          className="hoja-fila"
          onClick={() => elegir(null)}
          disabled={guardando}
        >
          <span className="planificar-espacio" />
          <span className="hoja-fila-texto">
            <strong className="planificar-descanso">Descanso</strong>
          </span>
          {actual === null && <Icono nombre="elegido" pequeno />}
        </button>
        {/* Elegida aquí, también cuenta para ese día: es lo que toca, aunque no esté en el
            programa. Por eso el rótulo no dice que no contará, como en la hoja de H1b. */}
        {programa && otras.length > 0 && (
          <>
            <p className="hoja-rotulo">Otras rutinas</p>
            {otras.map((rutina) => (
              <FilaDeRutina key={rutina.id} rutina={rutina} />
            ))}
          </>
        )}

        {cambiado && (
          <button
            type="button"
            className="planificar-restablecer-dia"
            onClick={() => void guardar(() => api.restablecerDia(dia.fecha))}
            disabled={guardando}
          >
            Restablecer este día
          </button>
        )}
      </div>

      {aviso && (
        <Dialogo
          titulo={aviso.titulo}
          cuerpo={aviso.cuerpo}
          soloAviso="Entendido"
          alCancelar={() => setAviso(null)}
        />
      )}
    </div>
  )
}
