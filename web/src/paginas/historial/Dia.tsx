import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, ErrorDeApi } from '../../api/cliente'
import type {
  Ejercicio,
  Entrenamiento,
  Rutina,
  Serie,
  SesionHistorial,
  TipoRegistro,
} from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { NotaDeSesion } from '../../componentes/NotaDeSesion'
import { Icono } from '../../componentes/Icono'
import {
  diaDeLaSemana,
  fechaCompleta,
  fechaEnFrase,
  fechaLarga,
  hoy,
  sumarDias,
} from '../../utiles/fechas'
import { conPesoYReps, kilos, serieLarga } from '../../utiles/medidas'
import {
  distanciaLegible,
  duracionLegible,
  enUnidad,
  enUnidadDeDistancia,
  numeroLegible,
  pesoLegible,
  ritmoEnTexto,
  unidad,
  unoRM,
} from '../../utiles/numeros'
import { seriesObjetivoDe } from '../programas/textos'
import { useVolver } from '../../utiles/volver'
import { type DatosDeSerie } from '../sesion/FormularioDeSerie'
import { BloqueDelDia, type Bloque, type Insignia, type Mejora } from './BloqueDelDia'
import { HojaDeFecha } from './HojaDeFecha'
import '../sesion/sesion.css'
import './historial.css'

/** "56,7": un 1RM en kg, en la unidad elegida y con un decimal como mucho. */
function conDecimal(kilos: number) {
  return numeroLegible(Math.round(enUnidad(kilos) * 10) / 10, 1)
}

/** "+2,5 kg" en verde si sube, "−3 reps" en gris si baja. */
function cambioDe(diferencia: number, texto: string): Insignia {
  return {
    texto: `${diferencia > 0 ? '+' : '−'}${texto}`,
    clase: diferencia > 0 ? 'mejor' : 'peor',
  }
}

/**
 * Cómo le fue al ejercicio comparado con la última vez que se hizo, en la rutina que fuera.
 *
 * Una insignia por cosa que cambió: el peso más alto y el total de repeticiones (que ya
 * refleja si se hicieron más o menos series). Si
 * mejoró o empeoró lo decide el 1RM estimado (por defecto, el medio de las series), que va en su
 * propia insignia con la flecha: así subir peso y bajar reps (o al revés) se compensa
 * con una sola medida. Con la media cuenta cualquier serie que mejore, no solo la mejor;
 * en Ajustes se puede elegir la mejor serie (`unoRM`).
 */
function mejoraDePesoYReps(series: Serie[], ultima: SesionHistorial): Mejora {
  const rmHoy = unoRM(series)

  const insignias: Insignia[] = []
  const pesoHoy = Math.max(...conPesoYReps(series).map((serie) => Number(serie.peso)))
  const pesoAntes = Math.max(...conPesoYReps(ultima.series).map((serie) => Number(serie.peso)))
  if (Number.isFinite(pesoHoy) && Number.isFinite(pesoAntes) && pesoHoy !== pesoAntes) {
    const peso = `${pesoLegible(Math.abs(pesoHoy - pesoAntes))} ${unidad()}`
    insignias.push(cambioDe(pesoHoy - pesoAntes, peso))
  }
  const reps = (lista: { repeticiones: number | null }[]) =>
    lista.reduce((total, serie) => total + (serie.repeticiones ?? 0), 0)
  const diferencia = reps(series) - reps(ultima.series)
  if (diferencia !== 0) {
    const unidad = Math.abs(diferencia) === 1 ? 'rep' : 'reps'
    insignias.push(cambioDe(diferencia, `${Math.abs(diferencia)} ${unidad}`))
  }
  if (insignias.length === 0) insignias.push({ texto: 'igual', clase: 'igual' })

  // Con un decimal y en la unidad elegida: lo que no se ve en el número no puede
  // decidir si mejoró.
  const cambio = Math.round(enUnidad(rmHoy - unoRM(ultima.series)) * 10) / 10
  const clase = cambio > 0 ? 'mejor' : cambio < 0 ? 'peor' : 'igual'
  const flecha = clase === 'mejor' ? '↑ ' : clase === 'peor' ? '↓ ' : ''
  const diferenciaRM =
    cambio === 0 ? 'igual' : `${cambio > 0 ? '+' : '−'}${numeroLegible(Math.abs(cambio), 1)}`
  insignias.push({
    texto: `${flecha}1RM ${conDecimal(rmHoy)} ${unidad()} (${diferenciaRM})`,
    clase,
  })
  return { clase, insignias }
}

/** El signo de una diferencia como la clase de una insignia. */
function claseDe(diferencia: number): Insignia['clase'] {
  return diferencia > 0 ? 'mejor' : diferencia < 0 ? 'peor' : 'igual'
}

/** La carga más alta de un día (nula = 0): sin carga 0, con lastre positiva, con ayuda negativa. */
const cargaMasAlta = (lista: { peso: string | number | null }[]) =>
  Math.max(...lista.map((serie) => kilos(serie) ?? 0))

/** Lo que media de repeticiones por serie, redondeado a centésimas para comparar. */
const mediaDeReps = (lista: { repeticiones: number | null }[]) =>
  Math.round(
    (lista.reduce((total, serie) => total + (serie.repeticiones ?? 0), 0) / lista.length) * 100,
  )

/**
 * La mejora de un ejercicio de peso corporal: primero la carga (la más alta del día)
 * y, con la misma, la media de repeticiones por serie. El peso corporal no cuenta.
 */
function mejoraCorporal(series: Serie[], ultima: SesionHistorial): Mejora {
  const cargaHoy = cargaMasAlta(series)
  const insignias: Insignia[] = []
  const cargaAntes = cargaMasAlta(ultima.series)
  if (cargaHoy !== cargaAntes) {
    const peso = `${pesoLegible(Math.abs(cargaHoy - cargaAntes))} ${unidad()}`
    insignias.push(cambioDe(cargaHoy - cargaAntes, peso))
  }
  const reps = (lista: { repeticiones: number | null }[]) =>
    lista.reduce((total, serie) => total + (serie.repeticiones ?? 0), 0)
  const diferencia = reps(series) - reps(ultima.series)
  if (diferencia !== 0) {
    const unidadReps = Math.abs(diferencia) === 1 ? 'rep' : 'reps'
    insignias.push(cambioDe(diferencia, `${Math.abs(diferencia)} ${unidadReps}`))
  }
  if (insignias.length === 0) insignias.push({ texto: 'igual', clase: 'igual' })
  const clase = claseDe(
    cargaHoy !== cargaAntes
      ? cargaHoy - cargaAntes
      : mediaDeReps(series) - mediaDeReps(ultima.series),
  )
  return { clase, insignias }
}

/** La duración media de las series de un día, en segundos. */
const duracionMedia = (lista: { duracion_s: number | null }[]) =>
  lista.reduce((total, serie) => total + (serie.duracion_s ?? 0), 0) / lista.length

/**
 * La mejora de un ejercicio de tiempo: si lleva peso, primero el más alto (nulo = 0)
 * y, con el mismo, la duración media por serie.
 */
function mejoraDeTiempo(series: Serie[], ultima: SesionHistorial): Mejora {
  const pesoHoy = cargaMasAlta(series)
  const insignias: Insignia[] = []
  const pesoAntes = cargaMasAlta(ultima.series)
  if (pesoHoy !== pesoAntes) {
    const peso = `${pesoLegible(Math.abs(pesoHoy - pesoAntes))} ${unidad()}`
    insignias.push(cambioDe(pesoHoy - pesoAntes, peso))
  }
  const cambio = Math.round(duracionMedia(series) - duracionMedia(ultima.series))
  if (cambio !== 0) insignias.push(cambioDe(cambio, duracionLegible(Math.abs(cambio))))
  if (insignias.length === 0) insignias.push({ texto: 'igual', clase: 'igual' })
  return { clase: claseDe(pesoHoy !== pesoAntes ? pesoHoy - pesoAntes : cambio), insignias }
}

/** La suma de una medida de las series de un día. */
const suma = (
  lista: { distancia_m?: number | null; duracion_s: number | null }[],
  campo: 'distancia_m' | 'duracion_s',
) => lista.reduce((total, serie) => total + (serie[campo] ?? 0), 0)

/** El ritmo de las series de un día que llevan distancia: segundos por kilómetro (o milla); nulo sin distancia. */
function ritmoDelDia(lista: { distancia_m?: number | null; duracion_s: number | null }[]) {
  const con = lista.filter((serie) => (serie.distancia_m ?? 0) > 0)
  const metros = suma(con, 'distancia_m')
  return metros > 0 ? suma(con, 'duracion_s') / enUnidadDeDistancia(metros) : null
}

/** «0:07», sin unidad: lo que cambió un ritmo. */
function minutosYSegundos(segundos: number) {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
}

/**
 * La mejora de un ejercicio de cardio, con el mismo criterio que los demás: cada insignia
 * dice lo de hoy con lo que cambió y va en verde si mejoró y en gris si no. Lo que decide si
 * el ejercicio mejoró, por orden: la distancia (más lejos es mejor); con la misma, el ritmo
 * (más rápido es mejor); y sin distancia en alguna de las dos veces, el tiempo (más es
 * mejor). El ritmo lleva su propia insignia con la flecha, como el 1RM.
 * «5,2 km (+0,4)», «28 min 15 s (+1 min 35 s)», «↑ Ritmo 5:26 min/km (−0:07)».
 */
function mejoraDeCardio(series: Serie[], ultima: SesionHistorial): Mejora {
  const distanciaHoy = suma(series, 'distancia_m')
  const tiempoHoy = suma(series, 'duracion_s')
  const ritmoHoy = ritmoDelDia(series)
  const diferencia = (valor: number, texto: (positivo: number) => string) =>
    valor === 0 ? 'igual' : `${valor > 0 ? '+' : '−'}${texto(Math.abs(valor))}`
  // Verde si subió, gris si no (igual o menos): como el resto de insignias de cambio.
  const segunElCambio = (texto: string, cambio: number): Insignia => ({
    texto,
    clase: cambio > 0 ? 'mejor' : 'igual',
  })
  const insignias: Insignia[] = []
  const distanciaAntes = suma(ultima.series, 'distancia_m')
  if (distanciaHoy > 0 || distanciaAntes > 0) {
    // Con la distancia en la unidad elegida y dos decimales, como se escribe.
    const cambio = enUnidadDeDistancia(distanciaHoy) - enUnidadDeDistancia(distanciaAntes)
    const redondeado = Math.round(cambio * 100) / 100
    insignias.push(
      segunElCambio(
        `${distanciaLegible(distanciaHoy)} (${diferencia(redondeado, (n) => numeroLegible(n, 2))})`,
        redondeado,
      ),
    )
  }
  const tiempoAntes = suma(ultima.series, 'duracion_s')
  const cambioDeTiempo = tiempoHoy - tiempoAntes
  insignias.push(
    segunElCambio(
      `${duracionLegible(tiempoHoy)} (${diferencia(cambioDeTiempo, duracionLegible)})`,
      cambioDeTiempo,
    ),
  )
  // El ritmo, solo si las dos veces llevan distancia: un ritmo más bajo es mejor.
  const ritmoAntes = ritmoDelDia(ultima.series)
  let cambioDeRitmo = 0
  if (ritmoHoy !== null && ritmoAntes !== null) {
    cambioDeRitmo = Math.round(ritmoHoy) - Math.round(ritmoAntes)
    const clase = claseDe(-cambioDeRitmo)
    const flecha = clase === 'mejor' ? '↑ ' : clase === 'peor' ? '↓ ' : ''
    const dif = diferencia(cambioDeRitmo, minutosYSegundos)
    insignias.push({ texto: `${flecha}Ritmo ${ritmoEnTexto(ritmoHoy)} (${dif})`, clase })
  }
  // Lo que decide, por orden: la distancia, el ritmo y, sin distancia en las dos, el tiempo.
  const comparable = distanciaHoy > 0 && distanciaAntes > 0
  const clase = comparable
    ? claseDe(distanciaHoy !== distanciaAntes ? distanciaHoy - distanciaAntes : -cambioDeRitmo)
    : claseDe(cambioDeTiempo)
  return { clase, insignias }
}

/** Cómo le fue al ejercicio, según cómo se apunta: cada tipo se mide con lo suyo. */
function mejora(
  tipo: TipoRegistro,
  series: Serie[],
  ultima: SesionHistorial | null,
): Mejora | null {
  if (series.length === 0) return null
  // Sin una vez anterior no hay con qué comparar: solo «nuevo», sin insignias de cambio ni
  // de mejora. Lo apuntado ya se ve en sus series.
  if (!ultima || ultima.series.length === 0) {
    return { clase: 'igual', insignias: [{ texto: 'nuevo', clase: 'igual' }] }
  }
  if (tipo === 'corporal') return mejoraCorporal(series, ultima)
  if (tipo === 'tiempo') return mejoraDeTiempo(series, ultima)
  if (tipo === 'cardio') return mejoraDeCardio(series, ultima)
  return mejoraDePesoYReps(series, ultima)
}

/** Peso × reps de las series de peso y repeticiones: las demás no entran en el volumen. */
function volumenDe(series: Serie[]) {
  return conPesoYReps(
    series.filter((serie) => serie.ejercicio.tipo_registro === 'peso_reps'),
  ).reduce((total, serie) => total + Number(serie.peso) * serie.repeticiones, 0)
}

function contar(cuantos: number, singular: string, plural: string) {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

/** "20 kg × 9 reps · sentado" (o en lb). */
function carga(serie: Serie) {
  const texto = serieLarga(serie.ejercicio.tipo_registro, serie)
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
      const elegible = [
        hueco.ejercicio_principal,
        ...hueco.alternativas.map((alternativa) => alternativa.ejercicio),
      ].find((ejercicio) => !ejercicio.oculto_desde)
      if (elegible) bloques.push({ clave: `hueco-${hueco.id}`, hueco, ejercicio: elegible, series })
    }
  }
  const ultimas = await Promise.all(bloques.map((bloque) => ultimaVezDe(bloque.ejercicio, sesion)))
  return bloques.map((bloque, indice) => ({ ...bloque, ultima: ultimas[indice] }))
}

/** La última vez que se hizo un ejercicio antes de este día, sin contar la propia sesión. */
function ultimaVezDe(ejercicio: Ejercicio, sesion: Entrenamiento) {
  return (
    api
      .historialDeEjercicio(ejercicio.id, { hasta: sesion.fecha, limite: 2 })
      .then((lista) => lista.find((otra) => otra.entrenamiento_id !== sesion.id) ?? null)
      // Sin última vez el día se puede ver igual: no merece un error en pantalla.
      .catch(() => null)
  )
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
  // La sesión anterior de la misma rutina con volumen, para su cambio; nula si no hay.
  const [anterior, setAnterior] = useState<Entrenamiento | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [abierta, setAbierta] = useState<Abierta | null>(null)
  // El borrador del modo editar: nada llega a la API hasta pulsar Guardar. Las series
  // nuevas llevan un id negativo hasta crearse.
  const [fechaNueva, setFechaNueva] = useState(fecha)
  const [eligiendoFecha, setEligiendoFecha] = useState(false)
  const [notasNuevas, setNotasNuevas] = useState<string | null>(null)
  const [seriesNuevas, setSeriesNuevas] = useState<Serie[]>([])
  const [guardando, setGuardando] = useState(false)
  const [aBorrar, setABorrar] = useState<Serie | null>(null)
  // Elegir otro ejercicio en un hueco que ya tiene series: se pregunta, porque en cada hueco
  // se hace un solo ejercicio por día y cambiar quita las series que había (al guardar).
  const [aCambiar, setACambiar] = useState<{ bloque: Bloque; ejercicio: Ejercicio } | null>(null)
  // Los ejercicios elegidos en el borrador para huecos sin series (o que se quedaron sin
  // ellas al cambiar), y la última vez de cada uno, por id de ejercicio, para compararlo con
  // la suya y no con la del ejercicio que tenía el hueco.
  const [ejerciciosNuevos, setEjerciciosNuevos] = useState<Record<number, Ejercicio>>({})
  const [ultimasElegidas, setUltimasElegidas] = useState<Record<number, SesionHistorial | null>>({})
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
          // Para comparar el volumen: la sesión anterior de la misma rutina que lo tuvo.
          // Con margen por si alguna se quedó vacía o solo fue de cardio, tiempo o peso
          // corporal: comparar con 0 kg daría una subida que no es tal.
          leida
            ? api.entrenamientos({
                rutina_id: leida.rutina_id,
                hasta: sumarDias(fecha, -1),
                limite: 20,
              })
            : [],
        ])
        if (!vigente) return
        setSesion(leida ?? null)
        setRutina(suRutina)
        setBloques(suyos)
        setAnterior(previas.find((otra) => volumenDe(otra.series) > 0) ?? null)
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
  // Editando, todo se pinta desde el borrador: las cifras y los bloques ya con los cambios.
  const series = editando ? seriesNuevas : dia.series
  const volumen = enUnidad(volumenDe(series))
  // Frente a la sesión anterior de la rutina: un dato de cuánto trabajo, no de fuerza
  // (eso lo dice el 1RM de cada ejercicio), así que se salta un ejercicio y baja.
  const cambioVolumen = anterior ? Math.round(volumen - enUnidad(volumenDe(anterior.series))) : null
  const actuales = bloques.map((bloque) => {
    const suyas = series.filter((serie) => serie.slot_id === bloque.hueco.id)
    const ejercicio = suyas[0]?.ejercicio ?? ejerciciosNuevos[bloque.hueco.id] ?? bloque.ejercicio
    // Mientras llega la del elegido, ninguna: mejor sin comparar que con la de otro.
    const ultima =
      ejercicio.id === bloque.ejercicio.id ? bloque.ultima : (ultimasElegidas[ejercicio.id] ?? null)
    return { ...bloque, series: suyas, ejercicio, ultima }
  })
  // Lo que pide la rutina ese día: las series del ejercicio que se hizo en cada hueco
  // visible (o del que se ofrece, si no tiene series).
  const objetivo = actuales
    .filter((bloque) => !bloque.hueco.oculto_desde)
    .reduce((total, bloque) => total + seriesObjetivoDe(bloque.hueco, bloque.ejercicio.id), 0)
  const hayVolumen = series.some((serie) => serie.ejercicio.tipo_registro === 'peso_reps')
  const mejoras = actuales.map((bloque) =>
    mejora(bloque.ejercicio.tipo_registro, bloque.series, bloque.ultima),
  )
  const mejorados = mejoras.filter((una) => una?.clase === 'mejor').length
  // Con un formulario abierto, el resto se queda en gris: primero se guarda o se cancela.
  const hayAbierta = abierta !== null

  let cuenta: string | null = null
  if (dia.cubre_fecha && dia.cubre_fecha !== dia.fecha) {
    cuenta = `${dia.cubre_fecha < dia.fecha ? 'Recuperado' : 'Adelantado'} del ${fechaCompleta(dia.cubre_fecha)}`
  }

  function empezarAEditar() {
    setFechaNueva(dia.fecha)
    setNotasNuevas(dia.notas)
    setSeriesNuevas(dia.series)
    setEjerciciosNuevos({})
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
          peso: kilos(serie),
          repeticiones: serie.repeticiones,
          duracion_s: serie.duracion_s,
          distancia_m: serie.distancia_m,
          peso_corporal: serie.peso_corporal === null ? null : Number(serie.peso_corporal),
          variante: serie.variante,
        }
        const antes = dia.series.find((otra) => otra.id === serie.id)
        if (!antes) await api.crearSerie(dia.id, datos)
        else if (
          kilos(antes) !== datos.peso ||
          antes.repeticiones !== datos.repeticiones ||
          antes.duracion_s !== datos.duracion_s ||
          antes.distancia_m !== datos.distancia_m ||
          (antes.peso_corporal === null ? null : Number(antes.peso_corporal)) !==
            datos.peso_corporal ||
          antes.variante !== datos.variante
        ) {
          await api.actualizarSerie(dia.id, serie.id, datos)
        }
      }
    } catch (fallo) {
      // Lo que ya se envió queda guardado: se vuelve a leer el día para enseñar cómo quedó.
      setFalloGuardar(`No se pudo guardar todo. ${(fallo as Error).message}`)
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
        `Para usar ese día, cambia antes la fecha de esa sesión desde su día en la pestaña Historial.`
      )
    }
    if (fallo instanceof ErrorDeApi && fallo.estado === 422 && dia.cubre_fecha && nueva <= hoy()) {
      const contado = dia.cubre_fecha
      const lunes = sumarDias(contado, 1 - diaDeLaSemana(contado))
      const ultimo = sumarDias(contado, 6)
      // Dentro del plazo, el 422 solo puede ser el del programa.
      if (nueva >= lunes && nueva <= ultimo) {
        return `Este ${nombre} cuenta como el del ${fechaEnFrase(contado, false)}, y el ${fechaEnFrase(nueva, false)} no seguías el mismo programa que ese día. Solo se puede mover a un día en que lo siguieras.`
      }
      const limite = nueva > contado ? ultimo : lunes
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
              peso: datos.peso === null ? null : String(datos.peso),
              repeticiones: datos.repeticiones,
              duracion_s: datos.duracion_s,
              distancia_m: datos.distancia_m,
              peso_corporal: datos.peso_corporal === null ? null : String(datos.peso_corporal),
              variante: datos.variante,
            }
          : otra,
      ),
    )
    setAbierta(null)
  }

  /** Elige el ejercicio de un hueco en el borrador y pide su última vez si no la tiene. */
  function elegirEjercicio(bloque: Bloque, ejercicio: Ejercicio) {
    setEjerciciosNuevos((previos) => ({ ...previos, [bloque.hueco.id]: ejercicio }))
    const original = bloques.find((otro) => otro.clave === bloque.clave)
    if (ejercicio.id === original?.ejercicio.id || ejercicio.id in ultimasElegidas) return
    void ultimaVezDe(ejercicio, dia).then((ultima) =>
      setUltimasElegidas((previas) => ({ ...previas, [ejercicio.id]: ultima })),
    )
  }

  /** Confirmado el cambio: se quitan del borrador las series del hueco y se elige el nuevo. */
  function cambiarDeEjercicio(bloque: Bloque, ejercicio: Ejercicio) {
    setSeriesNuevas((previas) => previas.filter((serie) => serie.slot_id !== bloque.hueco.id))
    elegirEjercicio(bloque, ejercicio)
    setACambiar(null)
  }

  function anadirSerie(bloque: Bloque, ejercicio: Ejercicio, numero: number, datos: DatosDeSerie) {
    setSeriesNuevas((previas) => [
      ...previas,
      {
        // Por debajo del más bajo y no por cuántas hay: tras borrar una, contarlas
        // repetiría el id de otra nueva, y borrar o editar una tocaría las dos.
        id: Math.min(0, ...previas.map((serie) => serie.id)) - 1,
        entrenamiento_id: dia.id,
        ejercicio_id: ejercicio.id,
        ejercicio,
        slot_id: bloque.hueco.id,
        numero_serie: numero,
        peso: datos.peso === null ? null : String(datos.peso),
        repeticiones: datos.repeticiones,
        duracion_s: datos.duracion_s,
        distancia_m: datos.distancia_m,
        peso_corporal: datos.peso_corporal === null ? null : String(datos.peso_corporal),
        variante: datos.variante,
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
        <div className="campo dia-fecha">
          <span className="campo-etiqueta" id="dia-fecha-etiqueta">
            Fecha
          </span>
          {/* No el selector del sistema: la hoja enseña el mes con sus marcas. */}
          <button
            type="button"
            className="campo-texto dia-fecha-boton"
            aria-labelledby="dia-fecha-etiqueta"
            disabled={hayAbierta}
            onClick={() => setEligiendoFecha(true)}
          >
            {fechaLarga(fechaNueva)}
            <Icono nombre="historial" pequeno />
          </button>
          {falloFecha && <span className="fallo">{falloFecha}</span>}
        </div>
      )}

      {eligiendoFecha && (
        <HojaDeFecha
          fecha={fechaNueva}
          alElegir={(elegida) => {
            setFechaNueva(elegida)
            setFalloFecha(null)
            setEligiendoFecha(false)
          }}
          alCerrar={() => setEligiendoFecha(false)}
        />
      )}

      {falloGuardar && <p className="aviso error">{falloGuardar}</p>}

      <div
        className="cifras"
        // Sin volumen (un día solo de peso corporal, tiempo…), son dos cifras y no tres.
        style={hayVolumen ? undefined : { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
      >
        <div className="cifra">
          <span className="num cifra-valor destacada">
            {series.length}
            {objetivo > 0 && <small> / {objetivo}</small>}
          </span>
          <span>series</span>
        </div>
        {hayVolumen && (
          <div className="cifra">
            <span className="num cifra-valor">
              {volumen.toLocaleString('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' })}
              <small> {unidad()}</small>
            </span>
            <span>volumen</span>
            {cambioVolumen !== null && (
              <span
                className={`num cifra-cambio ${cambioVolumen > 0 ? 'mejor' : cambioVolumen < 0 ? 'peor' : ''}`}
              >
                {cambioVolumen > 0 ? '↑ +' : cambioVolumen < 0 ? '↓ −' : ''}
                {cambioVolumen === 0
                  ? 'igual'
                  : `${Math.abs(cambioVolumen).toLocaleString('es-ES', { useGrouping: 'always' })} ${unidad()}`}
              </span>
            )}
          </div>
        )}
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
            key={`${bloque.clave}-${editando}-${bloque.series.length === 0 ? bloque.ejercicio.id : ''}`}
            bloque={bloque}
            numero={numero}
            mejora={mejoras[indice]}
            sesion={dia}
            editando={editando}
            abierta={abierta}
            alAbrir={setAbierta}
            alCerrar={() => setAbierta(null)}
            alBorrarSerie={setABorrar}
            alElegir={(ejercicio) => elegirEjercicio(bloque, ejercicio)}
            alPedirCambiar={(ejercicio) => setACambiar({ bloque, ejercicio })}
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
          className="boton boton-texto peligro dia-borrar"
          onClick={() => setBorrandoDia(true)}
          disabled={hayAbierta}
        >
          Borrar este día
        </button>
      )}

      {series.length > 0 && (
        <p className="dia-leyenda">
          La mejora, frente a la última vez con ese ejercicio: en peso y repeticiones, el 1RM; en
          peso corporal, la carga y luego las reps; en tiempo, el peso y luego la duración; en
          cardio, la distancia y luego el ritmo.
          {anterior && hayVolumen && (
            <>
              <br />
              El volumen solo cuenta peso y repeticiones, frente a la sesión anterior de esta
              rutina.
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

      {aCambiar && (
        <Dialogo
          titulo={`¿Cambiar a ${aCambiar.ejercicio.nombre}?`}
          cuerpo={`Se borrarán ${
            aCambiar.bloque.series.length === 1
              ? 'la serie'
              : `las ${aCambiar.bloque.series.length} series`
          } de ${aCambiar.bloque.ejercicio.nombre} de este día al guardar.`}
          confirmar="Cambiar"
          peligro
          alConfirmar={async () => cambiarDeEjercicio(aCambiar.bloque, aCambiar.ejercicio)}
          alCancelar={() => setACambiar(null)}
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
