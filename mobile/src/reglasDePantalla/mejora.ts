/**
 * Cómo le fue a cada ejercicio de un día frente a la última vez, y el volumen del día.
 * Copia de las funciones de `web/src/paginas/historial/Dia.tsx` (si cambian allí, se cambian
 * aquí), aparte para poder probarlas sin pantallas.
 *
 * Si mejoró lo decide, en peso y repeticiones, el 1RM estimado; en peso corporal, la carga y
 * luego las reps; en tiempo, el peso y luego la duración; en cardio, la distancia y luego el
 * ritmo. Cada cosa que cambió lleva su insignia, verde si sube y gris si no.
 */
import type { Serie, SesionHistorial, TipoRegistro } from '../logica/tipos'
import { conPesoYReps, kilos } from '../utiles/medidas'
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
} from '../utiles/numeros'

export type Insignia = { texto: string; clase: 'mejor' | 'igual' | 'peor' }

// `clase`: si el ejercicio mejoró; `insignias`: qué cambió, una por cosa («+1 kg», «−3 reps»),
// y al final la del 1RM (o la del ritmo) con su flecha.
export type Mejora = { clase: Insignia['clase']; insignias: Insignia[] }

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
export function mejora(
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
export function volumenDe(series: Serie[]) {
  return conPesoYReps(
    series.filter((serie) => serie.ejercicio.tipo_registro === 'peso_reps'),
  ).reduce((total, serie) => total + Number(serie.peso) * serie.repeticiones, 0)
}
