import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, ErrorDeApi } from '../../api/cliente'
import type { Ejercicio, Entrenamiento, Rutina, Serie, SesionHistorial } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { NotaDeSesion } from '../../componentes/NotaDeSesion'
import { Icono } from '../../componentes/Icono'
import { diaDeLaSemana, fechaEnFrase, fechaLarga, hoy, sumarDias } from '../../utiles/fechas'
import { pesoLegible, unoRM } from '../../utiles/numeros'
import { useVolver } from '../../utiles/volver'
import { type DatosDeSerie } from '../sesion/FormularioDeSerie'
import { BloqueDelDia, type Bloque, type Insignia, type Mejora } from './BloqueDelDia'
import '../sesion/sesion.css'
import './historial.css'

type ConCarga = { peso: string | number; repeticiones: number }

/** "56,7": el 1RM con un decimal como mucho. */
function kilos(valor: number) {
  return (Math.round(valor * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 })
}

/** "+2,5 kg" en verde si sube, "−3 reps" en gris si baja. */
function cambioDe(diferencia: number, texto: string): Insignia {
  return {
    texto: `${diferencia > 0 ? '+' : '−'}${texto}`,
    clase: diferencia > 0 ? 'mejor' : 'peor',
  }
}

/**
 * Cómo le fue al ejercicio comparado con la última vez que se hizo en ese hueco.
 *
 * Una insignia por cosa que cambió: el peso más alto y el total de repeticiones (que ya
 * refleja si se hicieron más o menos series). Si
 * mejoró o empeoró lo decide el 1RM estimado medio de las series, que va en su propia
 * insignia con la flecha: así subir peso y bajar reps (o al revés) se compensa con una
 * sola medida, y cuenta cualquier serie que mejore, no solo la mejor.
 */
function mejora(series: Serie[], ultima: SesionHistorial | null): Mejora | null {
  if (series.length === 0) return null
  const rmHoy = unoRM(series)
  if (!ultima || ultima.series.length === 0) {
    return {
      clase: 'igual',
      insignias: [
        { texto: 'nuevo', clase: 'igual' },
        { texto: `1RM ${kilos(rmHoy)} kg`, clase: 'igual' },
      ],
    }
  }

  const insignias: Insignia[] = []
  const pesoHoy = Math.max(...series.map((serie) => Number(serie.peso)))
  const pesoAntes = Math.max(...ultima.series.map((serie) => Number(serie.peso)))
  if (pesoHoy !== pesoAntes) {
    const kg = `${pesoLegible(Math.abs(pesoHoy - pesoAntes))} kg`
    insignias.push(cambioDe(pesoHoy - pesoAntes, kg))
  }
  const reps = (lista: ConCarga[]) => lista.reduce((total, serie) => total + serie.repeticiones, 0)
  const diferencia = reps(series) - reps(ultima.series)
  if (diferencia !== 0) {
    const unidad = Math.abs(diferencia) === 1 ? 'rep' : 'reps'
    insignias.push(cambioDe(diferencia, `${Math.abs(diferencia)} ${unidad}`))
  }
  if (insignias.length === 0) insignias.push({ texto: 'igual', clase: 'igual' })

  // Con un decimal: lo que no se ve en el número no puede decidir si mejoró.
  const cambio = Math.round((rmHoy - unoRM(ultima.series)) * 10) / 10
  const clase = cambio > 0 ? 'mejor' : cambio < 0 ? 'peor' : 'igual'
  const flecha = clase === 'mejor' ? '↑ ' : clase === 'peor' ? '↓ ' : ''
  const diferenciaRM =
    cambio === 0 ? 'igual' : `${cambio > 0 ? '+' : '−'}${kilos(Math.abs(cambio))}`
  insignias.push({ texto: `${flecha}1RM ${kilos(rmHoy)} kg (${diferenciaRM})`, clase })
  return { clase, insignias }
}

/** Peso × reps de todas las series. */
function volumenDe(series: ConCarga[]) {
  return series.reduce((total, serie) => total + Number(serie.peso) * serie.repeticiones, 0)
}

function contar(cuantos: number, singular: string, plural: string) {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

/** "20 kg × 9 reps · sentado". */
function carga(serie: Serie) {
  const texto = `${pesoLegible(serie.peso)} kg × ${serie.repeticiones} reps`
  return serie.variante ? `${texto} · ${serie.variante}` : texto
}

/**
 * Agrupa las series del día: una por hueco, en el orden de la rutina. Los huecos
 * visibles que ese día se quedaron sin series también entran, para poder añadírselas
 * al editar. Pide a la vez la última vez de cada bloque, mirando hacia atrás desde
 * este día y saltándose la propia sesión.
 */
async function bloquesDelDia(sesion: Entrenamiento, rutina: Rutina): Promise<Bloque[]> {
  const bloques: Omit<Bloque, 'ultima'>[] = []
  const huecos = [...rutina.slots].sort((uno, otro) => uno.orden - otro.orden)
  for (const hueco of huecos) {
    const series = sesion.series.filter((serie) => serie.slot_id === hueco.id)
    if (series.length > 0) {
      bloques.push({ clave: `hueco-${hueco.id}`, hueco, ejercicio: series[0].ejercicio, series })
    } else if (!hueco.oculto_desde) {
      const elegible = [hueco.ejercicio_principal, ...hueco.alternativas].find(
        (ejercicio) => !ejercicio.oculto_desde,
      )
      if (elegible) bloques.push({ clave: `hueco-${hueco.id}`, hueco, ejercicio: elegible, series })
    }
  }
  const filtro = { hasta: sesion.fecha, limite: 2 }
  const ultimas = await Promise.all(
    bloques.map((bloque) =>
      api
        .historialDeHueco(rutina.id, bloque.hueco.id, {
          ...filtro,
          ejercicio_id: bloque.ejercicio.id,
        })
        .then((lista) => lista.find((otra) => otra.entrenamiento_id !== sesion.id) ?? null)
        // Sin última vez el día se puede ver igual: no merece un error en pantalla.
        .catch(() => null),
    ),
  )
  return bloques.map((bloque, indice) => ({ ...bloque, ultima: ultimas[indice] }))
}

/** Lo que hay abierto en el modo editar: una sola cosa a la vez. */
export type Abierta =
  { tipo: 'serie'; id: number } | { tipo: 'anadir'; clave: string } | { tipo: 'nota' }

/**
 * H2 · Un día: la única pantalla de ver un día. Cifras arriba y, por hueco, qué
 * ejercicio se hizo, sus series, cómo le fue comparado con la última vez y esa
 * última vez en fichas.
 *
 * Con *Editar*, la flecha de volver pasa a ser *Cancelar* y *Editar* pasa a ser
 * *Guardar*. Lo que se cambia (la fecha, las series, la nota) va a un borrador, y
 * *Guardar* lo envía todo de golpe; *Cancelar* lo descarta entero. Los formularios de
 * una serie o de la nota no guardan nada: dicen *Añadir* o *Aplicar* y solo cambian el
 * borrador. Las ediciones van de una en una: con un formulario abierto, todo lo demás
 * (también *Cancelar* y *Guardar*) se queda en gris hasta aplicarlo o cancelarlo.
 */
export function Dia() {
  const { fecha = '' } = useParams()
  const navegar = useNavigate()

  const [sesion, setSesion] = useState<Entrenamiento | null | undefined>(undefined)
  const [rutina, setRutina] = useState<Rutina | null>(null)
  const [bloques, setBloques] = useState<Bloque[]>([])
  // La sesión anterior de la misma rutina, para el cambio de volumen; nula si no hay.
  const [anterior, setAnterior] = useState<Entrenamiento | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [abierta, setAbierta] = useState<Abierta | null>(null)
  // El borrador del modo editar: nada llega a la API hasta pulsar Guardar. Las series
  // nuevas llevan un id negativo hasta crearse.
  const [fechaNueva, setFechaNueva] = useState(fecha)
  const [notasNuevas, setNotasNuevas] = useState<string | null>(null)
  const [seriesNuevas, setSeriesNuevas] = useState<Serie[]>([])
  const [guardando, setGuardando] = useState(false)
  const [aBorrar, setABorrar] = useState<Serie | null>(null)
  const [borrandoDia, setBorrandoDia] = useState(false)
  const [falloFecha, setFalloFecha] = useState<string | null>(null)
  const [falloGuardar, setFalloGuardar] = useState<string | null>(null)

  // El calendario de su mes: adónde va la flecha si no hay pantalla anterior.
  const volver = `/historial?mes=${fecha.slice(0, 7)}`
  const volverAtras = useVolver()

  // Cada cambio guardado sube la versión, y eso vuelve a leer el día.
  const [version, setVersion] = useState(0)
  const recargar = () => setVersion((actual) => actual + 1)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const [leida] = await api.entrenamientos({ desde: fecha, hasta: fecha })
        // La rutina se pide aunque esté oculta: el día se tiene que poder ver.
        const suRutina = leida ? await api.rutina(leida.rutina_id) : null
        const [suyos, previas] = await Promise.all([
          leida && suRutina ? bloquesDelDia(leida, suRutina) : [],
          // Para comparar el volumen: la sesión anterior de la misma rutina con algo
          // apuntado. Unas pocas de margen por si alguna se quedó vacía.
          leida
            ? api.entrenamientos({
                rutina_id: leida.rutina_id,
                hasta: sumarDias(fecha, -1),
                limite: 5,
              })
            : [],
        ])
        if (!vigente) return
        setSesion(leida ?? null)
        setRutina(suRutina)
        setBloques(suyos)
        setAnterior(previas.find((otra) => otra.series.length > 0) ?? null)
      } catch (fallo) {
        if (vigente) setError((fallo as Error).message)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [fecha, version])

  if (error) return <p className="aviso error">{error}</p>
  if (sesion === undefined) return <p className="aviso">Cargando…</p>
  if (sesion === null) {
    return (
      <p className="aviso">
        El {fechaEnFrase(fecha, false)} no tiene ninguna sesión.{' '}
        <Link to={volver}>Volver al calendario</Link>
      </p>
    )
  }

  // La rutina llega junto con la sesión.
  if (!rutina) return <p className="aviso">Cargando…</p>

  const dia = sesion
  const nombre = rutina.nombre
  const huecosVisibles = rutina.slots.filter((hueco) => !hueco.oculto_desde)
  const objetivo = huecosVisibles.reduce((total, hueco) => total + hueco.series_objetivo, 0)
  // Editando, todo se pinta desde el borrador: las cifras y los bloques ya con los cambios.
  const series = editando ? seriesNuevas : dia.series
  const volumen = volumenDe(series)
  // Frente a la sesión anterior de la rutina: un dato de cuánto trabajo, no de fuerza
  // (eso lo dice el 1RM de cada ejercicio), así que se salta un ejercicio y baja.
  const cambioVolumen = anterior ? Math.round(volumen - volumenDe(anterior.series)) : null
  const actuales = bloques.map((bloque) => {
    const suyas = series.filter((serie) => serie.slot_id === bloque.hueco.id)
    return { ...bloque, series: suyas, ejercicio: suyas[0]?.ejercicio ?? bloque.ejercicio }
  })
  const mejoras = actuales.map((bloque) => mejora(bloque.series, bloque.ultima))
  const mejorados = mejoras.filter((una) => una?.clase === 'mejor').length
  // Con un formulario abierto, el resto se queda en gris: primero se guarda o se cancela.
  const hayAbierta = abierta !== null

  let cuenta: string | null = null
  if (dia.cubre_fecha && dia.cubre_fecha !== dia.fecha) {
    cuenta = `${dia.cubre_fecha < dia.fecha ? 'Recuperado' : 'Adelantado'} del ${fechaEnFrase(dia.cubre_fecha, false)}`
  }

  function empezarAEditar() {
    setFechaNueva(dia.fecha)
    setNotasNuevas(dia.notas)
    setSeriesNuevas(dia.series)
    setFalloFecha(null)
    setFalloGuardar(null)
    setAbierta(null)
    setEditando(true)
  }

  /** *Cancelar*: sale del modo editar y descarta el borrador entero. */
  function cancelar() {
    setFalloFecha(null)
    setEditando(false)
  }

  /**
   * *Guardar*: envía el borrador. Primero la fecha y la nota, que son las que pueden no
   * valer (la fecha ocupada o fuera de plazo): si fallan, no se toca nada más y el modo
   * editar sigue abierto. Después las series: las borradas, las cambiadas y las nuevas.
   */
  async function guardar() {
    const fechaFinal = fechaNueva || dia.fecha
    setGuardando(true)
    setFalloFecha(null)
    setFalloGuardar(null)
    try {
      if (fechaFinal !== dia.fecha || notasNuevas !== dia.notas) {
        await api.actualizarEntrenamiento(dia.id, {
          fecha: fechaFinal,
          notas: notasNuevas,
        })
      }
    } catch (fallo) {
      const motivo = motivoDeLaFecha(fallo, fechaFinal)
      if (fechaFinal !== dia.fecha) setFalloFecha(motivo)
      else setFalloGuardar(motivo)
      setGuardando(false)
      return
    }
    try {
      const quedan = new Set(seriesNuevas.map((serie) => serie.id))
      for (const serie of dia.series) {
        if (!quedan.has(serie.id)) await api.borrarSerie(dia.id, serie.id)
      }
      for (const serie of seriesNuevas) {
        const datos = {
          ejercicio_id: serie.ejercicio_id,
          slot_id: serie.slot_id,
          numero_serie: serie.numero_serie,
          peso: Number(serie.peso),
          repeticiones: serie.repeticiones,
          variante: serie.variante,
          rpe: null,
        }
        const antes = dia.series.find((otra) => otra.id === serie.id)
        if (!antes) await api.crearSerie(dia.id, datos)
        else if (
          Number(antes.peso) !== datos.peso ||
          antes.repeticiones !== datos.repeticiones ||
          antes.variante !== datos.variante
        ) {
          await api.actualizarSerie(dia.id, serie.id, datos)
        }
      }
    } catch (fallo) {
      // Lo que ya se envió queda guardado: se vuelve a leer el día para enseñar cómo quedó.
      setFalloGuardar(`No se pudo guardar todo: ${(fallo as Error).message}`)
    }
    setGuardando(false)
    setEditando(false)
    if (fechaFinal !== dia.fecha) navegar(`/historial/${fechaFinal}`, { replace: true })
    else recargar()
  }

  /** Por qué no se pudo mover: con las palabras del boceto, no con las de la API. */
  function motivoDeLaFecha(fallo: unknown, nueva: string) {
    if (fallo instanceof ErrorDeApi && fallo.estado === 409) {
      return (
        `El ${fechaEnFrase(nueva, false)} ya tiene una sesión, y solo se hace una por día. ` +
        `Para usar ese día, cambia antes la fecha de esa sesión desde su día en el Historial.`
      )
    }
    if (fallo instanceof ErrorDeApi && fallo.estado === 422 && dia.cubre_fecha && nueva <= hoy()) {
      const contado = dia.cubre_fecha
      const lunes = sumarDias(contado, 1 - diaDeLaSemana(contado))
      const limite = nueva > contado ? sumarDias(contado, 6) : lunes
      const hacia = nueva > contado ? 'hasta' : 'desde'
      return `Este ${nombre} cuenta como el del ${fechaEnFrase(contado, false)}, así que solo puede ir ${hacia} el ${fechaEnFrase(limite, false)}.`
    }
    return (fallo as Error).message
  }

  function cambiarSerie(serie: Serie, datos: DatosDeSerie) {
    setSeriesNuevas((previas) =>
      previas.map((otra) =>
        otra.id === serie.id
          ? {
              ...otra,
              peso: String(datos.peso),
              repeticiones: datos.repeticiones,
              variante: datos.variante,
            }
          : otra,
      ),
    )
    setAbierta(null)
  }

  function anadirSerie(bloque: Bloque, ejercicio: Ejercicio, numero: number, datos: DatosDeSerie) {
    setSeriesNuevas((previas) => [
      ...previas,
      {
        id: -(previas.length + 1),
        entrenamiento_id: dia.id,
        ejercicio_id: ejercicio.id,
        ejercicio,
        slot_id: bloque.hueco.id,
        numero_serie: numero,
        peso: String(datos.peso),
        repeticiones: datos.repeticiones,
        variante: datos.variante,
        rpe: null,
        created_at: '',
        updated_at: '',
      },
    ])
    setAbierta(null)
  }

  return (
    <div className="dia">
      <header className="sesion-cabecera">
        {editando ? (
          // Mientras se edita no se sale de la pantalla: o se guarda o se cancela.
          <button
            type="button"
            className="dia-cabecera-boton cancelar"
            onClick={cancelar}
            disabled={hayAbierta || guardando}
          >
            Cancelar
          </button>
        ) : (
          <button
            type="button"
            className="boton-icono"
            aria-label="Volver"
            onClick={() => volverAtras(volver)}
          >
            <Icono nombre="volver" />
          </button>
        )}
        <div className="sesion-titulo">
          <h1>{nombre}</h1>
          <p>{fechaLarga(dia.fecha)}</p>
          {cuenta && <p className="dia-cuenta">{cuenta}</p>}
        </div>
        <button
          type="button"
          className="dia-cabecera-boton"
          onClick={() => (editando ? void guardar() : empezarAEditar())}
          disabled={editando && (hayAbierta || guardando)}
        >
          {editando ? 'Guardar' : 'Editar'}
        </button>
      </header>

      {editando && (
        <label className="campo dia-fecha">
          <span className="campo-etiqueta">Fecha</span>
          <input
            className="campo-texto"
            type="date"
            value={fechaNueva}
            max={hoy()}
            disabled={hayAbierta}
            onChange={(evento) => {
              setFechaNueva(evento.target.value)
              setFalloFecha(null)
            }}
          />
          {falloFecha && <span className="fallo">{falloFecha}</span>}
        </label>
      )}

      {falloGuardar && <p className="aviso error">{falloGuardar}</p>}

      <div className="cifras">
        <div className="cifra">
          <span className="num cifra-valor destacada">
            {series.length}
            {objetivo > 0 && <small> / {objetivo}</small>}
          </span>
          <span>series</span>
        </div>
        <div className="cifra">
          <span className="num cifra-valor">
            {volumen.toLocaleString('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' })}
            <small> kg</small>
          </span>
          <span>volumen</span>
          {cambioVolumen !== null && (
            <span
              className={`num cifra-cambio ${cambioVolumen > 0 ? 'mejor' : cambioVolumen < 0 ? 'peor' : ''}`}
            >
              {cambioVolumen > 0 ? '↑ +' : cambioVolumen < 0 ? '↓ −' : ''}
              {cambioVolumen === 0
                ? 'igual'
                : `${Math.abs(cambioVolumen).toLocaleString('es-ES', { useGrouping: 'always' })} kg`}
            </span>
          )}
        </div>
        <div className="cifra">
          <span className="num cifra-valor">{mejorados}</span>
          <span>{mejorados === 1 ? 'ejercicio mejorado' : 'ejercicios mejorados'}</span>
        </div>
      </div>

      {actuales.map((bloque, indice) => {
        // Un hueco que ese día se quedó sin series solo sale al editar, para añadírselas.
        if (bloque.series.length === 0 && !editando) return null
        // La posición entre los huecos visibles, como en la sesión; uno oculto no lleva número.
        const numero = bloque.hueco ? huecosVisibles.indexOf(bloque.hueco) + 1 : 0
        return (
          <BloqueDelDia
            key={`${bloque.clave}-${editando}`}
            bloque={bloque}
            numero={numero}
            mejora={mejoras[indice]}
            rutinaId={rutina.id}
            sesion={dia}
            editando={editando}
            abierta={abierta}
            alAbrir={setAbierta}
            alCerrar={() => setAbierta(null)}
            alBorrarSerie={setABorrar}
            alCambiarSerie={cambiarSerie}
            alAnadirSerie={(ejercicio, numeroSerie, datos) =>
              anadirSerie(bloque, ejercicio, numeroSerie, datos)
            }
          />
        )
      })}

      {series.length === 0 && !editando && (
        <p className="aviso">Este día no tiene ninguna serie apuntada.</p>
      )}

      <NotaDeSesion
        nota={editando ? notasNuevas : dia.notas}
        editable={editando}
        enBorrador
        abierta={abierta?.tipo === 'nota'}
        alAbrir={() => setAbierta({ tipo: 'nota' })}
        alCerrar={() => setAbierta(null)}
        bloqueada={hayAbierta}
        alGuardar={async (nota) => setNotasNuevas(nota)}
      />

      {/* Una sesión de un día pasado sin terminar es una que se estaba apuntando desde el
          calendario: aquí está su "Continuar", como el de Hoy para la de hoy. */}
      {!editando && dia.terminada_en === null && (
        <Link to={`/sesion/${dia.id}`} state={{ desdeSuDia: true }} className="boton">
          Seguir apuntando
        </Link>
      )}

      {editando && (
        <button
          type="button"
          className="boton boton-texto peligro"
          onClick={() => setBorrandoDia(true)}
          disabled={hayAbierta}
        >
          Borrar este día
        </button>
      )}

      {series.length > 0 && (
        <p className="dia-leyenda">
          La mejora se mide con el 1RM, frente a la última vez con ese ejercicio.
          {anterior && (
            <>
              <br />
              El volumen, frente a la sesión anterior de esta rutina.
            </>
          )}
        </p>
      )}

      {aBorrar && (
        <Dialogo
          titulo={`¿Borrar la serie ${aBorrar.numero_serie}?`}
          cuerpo={carga(aBorrar)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            setSeriesNuevas((previas) => previas.filter((otra) => otra.id !== aBorrar.id))
            setABorrar(null)
          }}
          alCancelar={() => setABorrar(null)}
        />
      )}

      {borrandoDia && (
        <Dialogo
          titulo="¿Borrar este día?"
          cuerpo={
            // El día ya está en la cabecera: solo se nombra el que cuenta si es otro.
            `Se borrarán la sesión y ` +
            `${dia.series.length === 1 ? 'su serie' : `sus ${contar(dia.series.length, 'serie', 'series')}`}` +
            (dia.cubre_fecha === dia.fecha
              ? ', y este día quedará sin hacer'
              : dia.cubre_fecha
                ? `, y el ${fechaEnFrase(dia.cubre_fecha, false)} quedará sin hacer`
                : '') +
            '.'
          }
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await api.borrarEntrenamiento(dia.id)
            // En lugar del día borrado, para que volver no lleve a él.
            navegar(volver, { replace: true })
          }}
          alCancelar={() => setBorrandoDia(false)}
        />
      )}
    </div>
  )
}
