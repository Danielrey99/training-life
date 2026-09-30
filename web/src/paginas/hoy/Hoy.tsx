import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../../api/cliente'
import type {
  Entrenamiento,
  Hoy as ResumenDeHoy,
  Ofrecida,
  Programa,
  Recuperable,
  RutinaMinima,
} from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { MarcaDelDia } from '../../componentes/MarcaDelDia'
import { conArticulo, fechaEnFrase, fechaLarga, nombreDelDia, sumarDias } from '../../utiles/fechas'
import './hoy.css'

const INICIALES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

// Los rótulos de la lista de abajo, según qué ofrece.
const TITULO_DE_LA_LISTA: Record<Ofrecida['accion'], string> = {
  intercambiar: 'Otra rutina del programa',
  adelantar: 'Entrenar hoy de todas formas',
  sin_contar: 'Entrenar una rutina',
}

function contar(cuantos: number, singular: string, plural: string) {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

function mayuscula(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function hora(instante: string) {
  return new Date(instante).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

type Confirmacion = {
  titulo: string
  cuerpo: string
  confirmar: string
  cancelar?: string
  alConfirmar: () => Promise<void>
}

/**
 * E1 · Hoy: la pantalla de entrada. Qué toca hoy, la semana, lo que queda por
 * recuperar, la última sesión y qué más se puede entrenar hoy.
 *
 * Todo sale de una sola llamada (`GET /plan/hoy`): qué día cuenta cada sesión,
 * qué se puede recuperar y qué se ofrece lo decide el backend, para que la web y
 * el móvil digan siempre lo mismo. Esta pantalla solo lo pinta, y al pulsar un
 * botón manda qué día del plan va a contar la sesión (`cubre_fecha`).
 */
export function Hoy() {
  const navegar = useNavigate()
  const [resumen, setResumen] = useState<ResumenDeHoy | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [enCurso, setEnCurso] = useState<Entrenamiento | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<Confirmacion | null>(null)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const [leido, programas] = await Promise.all([api.hoy(), api.programas()])
        // De la sesión a medias hacen falta la hora y las series, que el resumen no trae.
        const abierta = leido.sesion?.en_curso
          ? await api.entrenamiento(leido.sesion.entrenamiento_id)
          : null
        if (!vigente) return
        setResumen(leido)
        setPrograma(programas.find((uno) => uno.activo) ?? null)
        setEnCurso(abierta)
      } catch (fallo) {
        if (vigente) setError((fallo as Error).message)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [])

  if (error) return <p className="aviso error">{error}</p>
  if (!resumen) return <p className="aviso">Cargando…</p>

  const hoy = resumen.fecha
  const dia = resumen.semana.find((uno) => uno.fecha === hoy)!
  const rutinaDeHoy = dia.descanso ? null : dia.rutina

  /** "5 ejercicios · última vez el miércoles 2". */
  function detalle(rutina: RutinaMinima) {
    const datos = resumen!.rutinas.find((una) => una.id === rutina.id)
    if (!datos) return ''
    const cuando = datos.ultima_vez ? `última vez ${conArticulo(datos.ultima_vez)}` : 'nunca hecha'
    return `${contar(datos.ejercicios, 'ejercicio', 'ejercicios')} · ${cuando}`
  }

  function ejercicios(rutina: RutinaMinima) {
    const datos = resumen!.rutinas.find((una) => una.id === rutina.id)
    return datos ? contar(datos.ejercicios, 'ejercicio', 'ejercicios') : ''
  }

  /** Crea la sesión que cuenta `cubre` (o ninguno) y abre E2. */
  async function empezar(rutinaId: number, cubre: string | null) {
    const creada = await api.crearEntrenamiento({
      rutina_id: rutinaId,
      fecha: hoy,
      notas: null,
      cubre_fecha: cubre,
    })
    navegar(`/sesion/${creada.id}`)
  }

  function pedirEmpezar(rutina: RutinaMinima, cubre: string | null) {
    setConfirmando({
      titulo: `¿Empezar ${rutina.nombre}?`,
      cuerpo: 'Podrás cancelarla desde la propia sesión.',
      confirmar: 'Empezar',
      alConfirmar: () => empezar(rutina.id, cubre),
    })
  }

  function pedirRecuperar(recuperable: Recuperable) {
    const { rutina, fecha } = recuperable
    const pierdeHoy = resumen!.situacion === 'entrenamiento' && rutinaDeHoy
    setConfirmando(
      pierdeHoy
        ? {
            titulo: `¿Recuperar hoy el ${rutina.nombre} del ${nombreDelDia(fecha)}?`,
            cuerpo:
              `Solo se hace una rutina al día: el ${rutinaDeHoy.nombre} de hoy quedará pendiente, ` +
              `y podrás recuperarlo hasta ${conArticulo(sumarDias(hoy, 6))}.`,
            confirmar: 'Recuperar',
            alConfirmar: () => empezar(rutina.id, fecha),
          }
        : {
            titulo: `¿Recuperar el ${rutina.nombre} del ${nombreDelDia(fecha)}?`,
            cuerpo: `Lo haces hoy y contará como el ${rutina.nombre} del ${fechaEnFrase(fecha)}. El plan no cambia.`,
            confirmar: 'Recuperar',
            alConfirmar: () => empezar(rutina.id, fecha),
          },
    )
  }

  function pedirOfrecida(ofrecida: Ofrecida) {
    const { rutina, fecha } = ofrecida
    if (ofrecida.accion === 'sin_contar' || fecha === null) {
      pedirEmpezar(rutina, null)
    } else if (ofrecida.accion === 'adelantar') {
      setConfirmando({
        titulo: `¿Adelantar el ${rutina.nombre} del ${nombreDelDia(fecha)}?`,
        cuerpo: `Lo haces hoy y el ${nombreDelDia(fecha)} queda libre.`,
        confirmar: 'Adelantar',
        alConfirmar: () => empezar(rutina.id, fecha),
      })
    } else {
      // La única pregunta con Sí / No, porque así lo eligió el autor. Sí cambia el
      // plan de los dos días y empieza la sesión de hoy, que ya toca esta rutina.
      setConfirmando({
        titulo: `¿Intercambiar con el ${nombreDelDia(fecha)}?`,
        cuerpo: `Hoy harías ${rutina.nombre} y el ${nombreDelDia(fecha)} pasaría a ser ${rutinaDeHoy?.nombre}.`,
        confirmar: 'Sí',
        cancelar: 'No',
        alConfirmar: async () => {
          await api.intercambiarDias(hoy, fecha)
          await empezar(rutina.id, hoy)
        },
      })
    }
  }

  const listaDeAbajo = resumen.ofrecidas
  const semanaHecha =
    ['descanso', 'movido'].includes(resumen.situacion) &&
    listaDeAbajo.length === 0 &&
    resumen.por_recuperar.length === 0

  return (
    <div className="hoy">
      <header className="hoy-cabecera">
        <p>{fechaLarga(hoy)}</p>
        <h1>Hoy</h1>
      </header>

      <div className="tira">
        {resumen.semana.map((uno, indice) => (
          <div key={uno.fecha} className={uno.fecha === hoy ? 'tira-dia es-hoy' : 'tira-dia'}>
            <span>{INICIALES[indice]}</span>
            <MarcaDelDia dia={uno} />
          </div>
        ))}
      </div>

      <Tarjeta
        resumen={resumen}
        programa={programa}
        enCurso={enCurso}
        detalle={detalle}
        ejercicios={ejercicios}
        alEmpezar={() => rutinaDeHoy && pedirEmpezar(rutinaDeHoy, hoy)}
        alContinuar={() => navegar(`/sesion/${resumen.sesion!.entrenamiento_id}`)}
      />

      {resumen.por_recuperar.length > 0 && (
        <section className="hoy-seccion">
          <h2 className="hoy-rotulo">Por recuperar</h2>
          <div className="recuperables">
            {resumen.por_recuperar.map((recuperable) => (
              <FilaRecuperable
                key={recuperable.fecha}
                recuperable={recuperable}
                hoy={hoy}
                ejercicios={ejercicios(recuperable.rutina)}
                alRecuperar={() => pedirRecuperar(recuperable)}
              />
            ))}
          </div>
        </section>
      )}

      {resumen.ultima_sesion && (
        <section className="hoy-seccion">
          <h2 className="hoy-rotulo">Última sesión hecha</h2>
          <UltimaSesion ultima={resumen.ultima_sesion} />
        </section>
      )}

      {listaDeAbajo.length > 0 && (
        <section className="hoy-seccion">
          <h2 className="hoy-rotulo">{TITULO_DE_LA_LISTA[listaDeAbajo[0].accion]}</h2>
          {listaDeAbajo.map((ofrecida) => (
            <button
              key={`${ofrecida.rutina.id}-${ofrecida.fecha}`}
              type="button"
              className="hoy-fila"
              onClick={() => pedirOfrecida(ofrecida)}
            >
              <span className="hoy-fila-texto">
                <strong>{ofrecida.rutina.nombre}</strong>
                <span>{detalle(ofrecida.rutina)}</span>
              </span>
              {ofrecida.fecha && (
                <span className="hoy-fila-dia">{mayuscula(nombreDelDia(ofrecida.fecha))}</span>
              )}
              <Icono nombre="abrir" pequeno />
            </button>
          ))}
        </section>
      )}

      <Pie resumen={resumen} semanaHecha={semanaHecha} />

      {confirmando && (
        <Dialogo
          titulo={confirmando.titulo}
          cuerpo={confirmando.cuerpo}
          confirmar={confirmando.confirmar}
          cancelar={confirmando.cancelar}
          alConfirmar={confirmando.alConfirmar}
          alCancelar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}

/** Cuándo toca algo, para una frase: "mañana", "el viernes", "el lunes 28". */
function cuandoToca(fecha: string, hoy: string) {
  if (fecha === sumarDias(hoy, 1)) return 'mañana'
  // A menos de una semana basta con el día: "el viernes", no "el viernes 18".
  if (fecha <= sumarDias(hoy, 6)) return `el ${nombreDelDia(fecha)}`
  return conArticulo(fecha)
}

type PropsTarjeta = {
  resumen: ResumenDeHoy
  programa: Programa | null
  enCurso: Entrenamiento | null
  detalle: (rutina: RutinaMinima) => string
  ejercicios: (rutina: RutinaMinima) => string
  alEmpezar: () => void
  alContinuar: () => void
}

/** La tarjeta grande: qué toca hoy, según la situación del día. */
function Tarjeta({
  resumen,
  programa,
  enCurso,
  detalle,
  ejercicios,
  alEmpezar,
  alContinuar,
}: PropsTarjeta) {
  const dia = resumen.semana.find((uno) => uno.fecha === resumen.fecha)!
  const rutina = dia.descanso ? null : dia.rutina
  const sesion = resumen.sesion
  const chip = programa && <span className="tarjeta-programa">Programa · {programa.nombre}</span>

  switch (resumen.situacion) {
    case 'primera_vez':
      return (
        <div className="tarjeta">
          <p className="tarjeta-antes">Primera vez</p>
          <p className="tarjeta-grande">Te damos la bienvenida</p>
          <p className="tarjeta-despues">
            1 · Tus rutinas: los ejercicios de cada día
            <br />2 · Un programa: qué rutina toca cada día
          </p>
          <Link to="/programas" className="boton boton-principal tarjeta-boton">
            Ir a Programas
          </Link>
        </div>
      )

    case 'sin_programa':
      return (
        <div className="tarjeta">
          <p className="tarjeta-antes">Hoy</p>
          <p className="tarjeta-grande">Sin programa</p>
          <p className="tarjeta-despues">
            Hoy y el calendario no proponen nada hasta que actives uno.
          </p>
          <Link to="/programas" className="boton tarjeta-boton-normal">
            Elegir un programa
          </Link>
        </div>
      )

    case 'en_curso': {
      const nombre = sesion?.rutina?.nombre ?? 'Entrenamiento libre'
      const series = enCurso ? ` · ${contar(enCurso.series.length, 'serie', 'series')}` : ''
      const loDeHoy = sesion?.cuenta && sesion.cubre_fecha === resumen.fecha
      return (
        <div className="tarjeta">
          {chip}
          <p className="tarjeta-antes con-chip">{loDeHoy ? 'Hoy toca' : 'Hoy'}</p>
          <p className="tarjeta-grande">{nombre}</p>
          <p className="tarjeta-despues">
            {enCurso ? `En curso desde las ${hora(enCurso.created_at)}${series}` : 'En curso'}
          </p>
          {sesion?.cubre_fecha && sesion.cubre_fecha !== resumen.fecha && (
            <p className="tarjeta-despues">
              {sesion.cubre_fecha < resumen.fecha ? 'Recuperando' : 'Adelantando'} el {nombre} del{' '}
              {nombreDelDia(sesion.cubre_fecha)}
            </p>
          )}
          <button
            type="button"
            className="boton boton-principal tarjeta-boton"
            onClick={alContinuar}
          >
            Continuar {sesion?.rutina?.nombre ?? 'la sesión'}
          </button>
        </div>
      )
    }

    case 'hecho': {
      // Lo grande es lo que tocaba; debajo, lo que se hizo, si fue otra cosa.
      let hecho = 'Hecho'
      if (sesion && sesion.cubre_fecha && sesion.cubre_fecha !== resumen.fecha && sesion.cuenta) {
        const verbo = sesion.cubre_fecha < resumen.fecha ? 'Recuperaste' : 'Adelantaste'
        hecho = `${verbo} el ${sesion.rutina?.nombre} del ${nombreDelDia(sesion.cubre_fecha)}`
      } else if (sesion && !sesion.cuenta) {
        hecho = sesion.rutina ? `Entrenaste ${sesion.rutina.nombre}` : 'Entrenamiento libre hecho'
      }
      return (
        <div className="tarjeta">
          {chip}
          <p className="tarjeta-antes con-chip">Hoy</p>
          <p className="tarjeta-grande">{rutina?.nombre ?? 'Descanso'}</p>
          <p className="tarjeta-despues tarjeta-hecho">
            <Icono nombre="hecho" pequeno />
            {hecho}
          </p>
        </div>
      )
    }

    case 'movido': {
      const cuando = dia.cubierto_por!.fecha
      const como = cuando < resumen.fecha ? 'Hecho por adelantado' : 'Recuperado'
      return (
        <div className="tarjeta">
          {chip}
          <p className="tarjeta-antes con-chip">Hoy tocaba</p>
          <p className="tarjeta-grande">{dia.rutina?.nombre}</p>
          <p className="tarjeta-despues tarjeta-hecho">
            <Icono nombre="hecho" pequeno />
            {como} {conArticulo(cuando)}
          </p>
        </div>
      )
    }

    case 'descanso': {
      const proximo = resumen.proximo
      return (
        <div className="tarjeta">
          {chip}
          <p className="tarjeta-antes con-chip">Hoy</p>
          <p className="tarjeta-grande">Descanso</p>
          {proximo?.rutina && (
            <p className="tarjeta-despues">
              {mayuscula(cuandoToca(proximo.fecha, resumen.fecha))} toca {proximo.rutina.nombre} ·{' '}
              {ejercicios(proximo.rutina)}
            </p>
          )}
        </div>
      )
    }

    case 'entrenamiento':
      return (
        <div className="tarjeta">
          {chip}
          <p className="tarjeta-antes con-chip">Hoy toca</p>
          <p className="tarjeta-grande">{rutina!.nombre}</p>
          <p className="tarjeta-despues">{detalle(rutina!)}</p>
          <button type="button" className="boton boton-principal tarjeta-boton" onClick={alEmpezar}>
            Empezar {rutina!.nombre}
          </button>
        </div>
      )
  }
}

type PropsRecuperable = {
  recuperable: Recuperable
  hoy: string
  ejercicios: string
  alRecuperar: () => void
}

/** Un día por recuperar: hasta cuándo se puede y, si hoy se puede, su botón. */
function FilaRecuperable({ recuperable, hoy, ejercicios, alRecuperar }: PropsRecuperable) {
  const { rutina, fecha, plazo, se_puede_hoy } = recuperable
  const caducaHoy = plazo === hoy
  let texto: string
  if (!se_puede_hoy) texto = `Recupéralo otro día, hasta ${conArticulo(plazo)}`
  else if (caducaHoy) texto = `${ejercicios} · hoy es el último día`
  else texto = `${ejercicios} · hasta ${conArticulo(plazo)}`
  if (!se_puede_hoy && caducaHoy) texto = 'Hoy era el último día para recuperarlo'

  return (
    <div className="recuperable">
      <div className="hoy-fila-texto">
        <strong>
          {rutina.nombre} del {fechaEnFrase(fecha)}
        </strong>
        <span className={caducaHoy && se_puede_hoy ? 'caduca' : undefined}>{texto}</span>
      </div>
      {/* Siempre en verde, también junto a Empezar: decisión expresa del autor. */}
      {se_puede_hoy && (
        <button
          type="button"
          className="boton boton-principal boton-recuperar"
          onClick={alRecuperar}
        >
          Recuperar
        </button>
      )}
    </div>
  )
}

/**
 * La última sesión hecha. De momento no lleva a ningún sitio: su destino es el día
 * en el historial (H2), que todavía no existe.
 */
function UltimaSesion({ ultima }: { ultima: NonNullable<ResumenDeHoy['ultima_sesion']> }) {
  const nombre = ultima.rutina?.nombre ?? 'Entrenamiento libre'
  let cifras = `${contar(ultima.series, 'serie', 'series')} · ${contar(ultima.ejercicios, 'ejercicio', 'ejercicios')}`
  if (ultima.cubre_fecha && ultima.cubre_fecha !== ultima.fecha) {
    const como = ultima.cubre_fecha < ultima.fecha ? 'Recuperado' : 'Adelantado'
    cifras = `${como} del ${nombreDelDia(ultima.cubre_fecha)} · ${contar(ultima.series, 'serie', 'series')}`
  }
  return (
    <div className="hoy-fila">
      <span className="hoy-fila-texto">
        <span className="ultima-titulo">
          <strong>
            {nombre} · {fechaEnFrase(ultima.fecha)}
          </strong>
          <Icono nombre="hecho" pequeno />
        </span>
        <span className="num">{cifras}</span>
      </span>
    </div>
  )
}

/** El texto del final, cuando no queda nada más que hacer hoy. */
function Pie({ resumen, semanaHecha }: { resumen: ResumenDeHoy; semanaHecha: boolean }) {
  if (resumen.situacion === 'primera_vez') {
    return (
      <p className="hoy-pie parrafo">
        También puedes entrenar sin programa: en cuanto tengas una rutina, podrás empezarla desde
        aquí, las veces que quieras.
      </p>
    )
  }
  if (resumen.situacion === 'hecho') {
    const proximo = resumen.proximo
    let siguiente = ''
    if (proximo?.rutina) {
      const manana = sumarDias(resumen.fecha, 1)
      siguiente =
        proximo.fecha === manana
          ? `Mañana toca ${proximo.rutina.nombre}.`
          : `Mañana descansas; ${cuandoToca(proximo.fecha, resumen.fecha)} toca ${proximo.rutina.nombre}.`
    }
    return (
      <p className="hoy-pie">
        Por hoy ya está.
        {siguiente && (
          <>
            <br />
            {siguiente}
          </>
        )}
      </p>
    )
  }
  if (semanaHecha) {
    return (
      <p className="hoy-pie">
        Esta semana ya está hecha.
        <br />
        No queda nada por adelantar ni por recuperar.
      </p>
    )
  }
  return null
}
