import type { SesionHistorial, TipoRegistro } from '../api/tipos'
import { ajustes } from './ajustes'
import { conPesoYReps, kilos } from './medidas'
import {
  duracionLegible,
  enUnidad,
  enUnidadDeDistancia,
  numeroLegible,
  ritmoEnTexto,
  unidad,
  unidadDeDistancia,
  unoRM,
} from './numeros'

/**
 * Una medida que se puede ver en la gráfica de un ejercicio (H3): qué es, cómo se
 * calcula con las series de una sesión y cómo se escribe. Cada tipo de ejercicio tiene
 * las suyas: lo que vale una sesión de dominadas no es lo mismo que una de press banca.
 */
export type Medida = {
  clave: string
  // En el selector.
  texto: string
  // Bajo el selector, qué es la cifra («Media por serie»).
  rotulo: string
  // El valor de una sesión, en kg, repeticiones o segundos (sin convertir de unidad).
  valor: (sesion: SesionHistorial) => number
  // Los kg se enseñan en la unidad elegida; las repeticiones y los segundos, tal cual.
  enPeso: boolean
  // Un valor, ya en la unidad que se enseña: «26,7 kg», «9 reps», «2 min 15 s».
  escribir: (valor: number) => string
  // Una diferencia entre dos valores, con su signo: «+15 s».
  cambio: (diferencia: number) => string
  // Lo que dice el globo del punto de una sesión, debajo de la fecha.
  globo: (sesion: SesionHistorial, valor: number) => string
  // Si la sesión cuenta en esta medida; sin esto, todas. La distancia y el ritmo, solo las
  // sesiones de cardio que la apuntaron.
  aplica?: (sesion: SesionHistorial) => boolean
  // Cómo se escribe un valor en el eje de la gráfica, si no es como un número.
  marca?: (valor: number) => string
}

/** «26,7 kg»: el valor, ya en la unidad elegida, con un decimal como mucho. */
export function enKilos(valor: number): string {
  const redondeado = Math.round(valor * 10) / 10
  return `${redondeado.toLocaleString('es-ES', { maximumFractionDigits: 1 })} ${unidad()}`
}

const conSigno = (diferencia: number, texto: string) =>
  `${diferencia > 0 ? '+' : diferencia < 0 ? '−' : ''}${texto}`

const reps = (cuantas: number) => `${numeroLegible(cuantas, 1)} ${cuantas === 1 ? 'rep' : 'reps'}`

const cambioDeKilos = (diferencia: number) => conSigno(diferencia, enKilos(Math.abs(diferencia)))
const cambioDeReps = (diferencia: number) => conSigno(diferencia, reps(Math.abs(diferencia)))
const cambioDeTiempo = (diferencia: number) =>
  conSigno(diferencia, duracionLegible(Math.round(Math.abs(diferencia))))

/** La carga más alta de una sesión (nulo = 0): sin carga 0, con lastre positiva, con ayuda negativa. */
const cargaMasAlta = (sesion: SesionHistorial) =>
  Math.max(...sesion.series.map((serie) => kilos(serie) ?? 0))

const mediaDeReps = (sesion: SesionHistorial) =>
  sesion.series.reduce((total, serie) => total + (serie.repeticiones ?? 0), 0) /
  sesion.series.length

const totalDeReps = (sesion: SesionHistorial) =>
  sesion.series.reduce((total, serie) => total + (serie.repeticiones ?? 0), 0)

const mediaDeTiempo = (sesion: SesionHistorial) =>
  sesion.series.reduce((total, serie) => total + (serie.duracion_s ?? 0), 0) / sesion.series.length

const totalDeTiempo = (sesion: SesionHistorial) =>
  sesion.series.reduce((total, serie) => total + (serie.duracion_s ?? 0), 0)

/** «10 kg de lastre», «20 kg de ayuda» o «sin carga». */
function cargaEnTexto(valor: number): string {
  if (valor === 0) return 'sin carga'
  return `${enKilos(Math.abs(valor))}${valor < 0 ? ' de ayuda' : ''}`
}

const conDistancia = (sesion: SesionHistorial) =>
  sesion.series.some((serie) => (serie.distancia_m ?? 0) > 0)

/** La distancia de la sesión, ya en la unidad elegida. */
const distanciaTotal = (sesion: SesionHistorial) =>
  enUnidadDeDistancia(sesion.series.reduce((total, serie) => total + (serie.distancia_m ?? 0), 0))

/** Lo que se tarda en recorrer un kilómetro (o una milla), solo con las series que llevan distancia. */
function ritmoDeLaSesion(sesion: SesionHistorial): number {
  const con = sesion.series.filter((serie) => (serie.distancia_m ?? 0) > 0)
  const segundos = con.reduce((total, serie) => total + (serie.duracion_s ?? 0), 0)
  const metros = con.reduce((total, serie) => total + (serie.distancia_m ?? 0), 0)
  return segundos / enUnidadDeDistancia(metros)
}

const escribirDistancia = (valor: number) => `${numeroLegible(valor, 2)} ${unidadDeDistancia()}`

const MEDIDAS: Record<TipoRegistro, Medida[]> = {
  peso_reps: [
    {
      clave: 'peso',
      texto: 'Peso',
      rotulo: 'El más alto de la sesión',
      valor: (sesion) => Math.max(...conPesoYReps(sesion.series).map((s) => Number(s.peso))),
      enPeso: true,
      escribir: enKilos,
      cambio: cambioDeKilos,
      globo: (sesion, valor) => `${enKilos(valor)} × ${repsDeLaMasPesada(sesion)}`,
    },
    {
      clave: 'volumen',
      texto: 'Volumen',
      rotulo: 'Suma de peso × reps',
      valor: (sesion) =>
        conPesoYReps(sesion.series).reduce(
          (total, serie) => total + Number(serie.peso) * serie.repeticiones,
          0,
        ),
      enPeso: true,
      escribir: enKilos,
      cambio: cambioDeKilos,
      globo: (_, valor) => enKilos(valor),
    },
    {
      clave: 'rm',
      texto: '1RM',
      // Lo que se calcula depende del ajuste: la media de las series o la mejor.
      get rotulo() {
        return ajustes().unoRM === 'media' ? 'Media de las series' : 'La mejor serie'
      },
      valor: (sesion) => unoRM(sesion.series),
      enPeso: true,
      escribir: enKilos,
      cambio: cambioDeKilos,
      globo: (_, valor) => enKilos(valor),
    },
  ],
  corporal: [
    {
      clave: 'reps',
      texto: 'Reps',
      rotulo: 'Media por serie',
      valor: mediaDeReps,
      enPeso: false,
      escribir: reps,
      cambio: cambioDeReps,
      globo: (_, valor) => reps(valor),
    },
    {
      clave: 'total',
      texto: 'Reps totales',
      rotulo: 'Suma de las series',
      valor: totalDeReps,
      enPeso: false,
      escribir: reps,
      cambio: cambioDeReps,
      globo: (_, valor) => reps(valor),
    },
    {
      clave: 'carga',
      texto: 'Carga',
      rotulo: 'La más alta de la sesión',
      valor: cargaMasAlta,
      enPeso: true,
      escribir: cargaEnTexto,
      cambio: cambioDeKilos,
      globo: (_, valor) => cargaEnTexto(valor),
    },
  ],
  tiempo: [
    {
      clave: 'tiempo',
      texto: 'Tiempo',
      rotulo: 'Media por serie',
      valor: mediaDeTiempo,
      enPeso: false,
      escribir: (valor) => duracionLegible(Math.round(valor)),
      cambio: cambioDeTiempo,
      globo: (_, valor) => duracionLegible(Math.round(valor)),
    },
    {
      clave: 'total',
      texto: 'Tiempo total',
      rotulo: 'Suma de las series',
      valor: totalDeTiempo,
      enPeso: false,
      escribir: (valor) => duracionLegible(Math.round(valor)),
      cambio: cambioDeTiempo,
      globo: (_, valor) => duracionLegible(Math.round(valor)),
    },
    {
      clave: 'peso',
      texto: 'Peso',
      rotulo: 'El más alto de la sesión',
      valor: cargaMasAlta,
      enPeso: true,
      escribir: enKilos,
      cambio: cambioDeKilos,
      globo: (_, valor) => enKilos(valor),
    },
  ],
  cardio: [
    {
      clave: 'distancia',
      texto: 'Distancia',
      rotulo: 'Suma de la sesión',
      valor: distanciaTotal,
      enPeso: false,
      aplica: conDistancia,
      escribir: escribirDistancia,
      cambio: (diferencia) => conSigno(diferencia, escribirDistancia(Math.abs(diferencia))),
      globo: (_, valor) => escribirDistancia(valor),
    },
    {
      clave: 'tiempo',
      texto: 'Tiempo',
      rotulo: 'Suma de la sesión',
      valor: totalDeTiempo,
      enPeso: false,
      escribir: (valor) => duracionLegible(Math.round(valor)),
      cambio: cambioDeTiempo,
      globo: (_, valor) => duracionLegible(Math.round(valor)),
    },
    {
      clave: 'ritmo',
      texto: 'Ritmo',
      rotulo: 'Media de la sesión',
      valor: ritmoDeLaSesion,
      enPeso: false,
      aplica: conDistancia,
      escribir: ritmoEnTexto,
      // El eje, sin la unidad: «5:26».
      marca: (valor) => ritmoEnTexto(valor).split(' ')[0],
      // Un ritmo más bajo es mejor: el signo es el de la diferencia, tal cual.
      cambio: (diferencia) => conSigno(diferencia, ritmoEnTexto(Math.abs(diferencia))),
      globo: (_, valor) => ritmoEnTexto(valor),
    },
  ],
}

/**
 * Las medidas de un ejercicio. La carga o el peso de los de peso corporal y de tiempo
 * solo salen si alguna vez los hubo: sin ellos la gráfica sería una línea en 0.
 */
export function medidasDe(tipo: TipoRegistro, sesiones: SesionHistorial[]): Medida[] {
  const todas = MEDIDAS[tipo]
  if (tipo === 'peso_reps') return todas
  // Sin distancia en ninguna sesión, el cardio solo tiene el tiempo.
  if (tipo === 'cardio')
    return todas.filter((medida) => !medida.aplica || sesiones.some(medida.aplica))
  const hubo = sesiones.some((sesion) => sesion.series.some((serie) => (kilos(serie) ?? 0) !== 0))
  return todas.filter((medida) => medida.clave !== (tipo === 'corporal' ? 'carga' : 'peso') || hubo)
}

/** El valor que se enseña (y se dibuja): los kg, en la unidad elegida. */
export function valorEnPantalla(medida: Medida, sesion: SesionHistorial): number {
  const valor = medida.valor(sesion)
  return medida.enPeso ? enUnidad(valor) : valor
}

/**
 * «10 reps»: las de la serie más pesada del día, la del punto de la gráfica de peso; con
 * varias de ese mismo peso, la de más repeticiones (decisión del autor: el globo dice qué se
 * consiguió con ese peso, y así se ve si se subió peso o se hicieron más reps con el mismo).
 */
function repsDeLaMasPesada(sesion: SesionHistorial): string {
  const conPeso = conPesoYReps(sesion.series)
  if (conPeso.length === 0) return ''
  const masPesada = conPeso.reduce((mejor, serie) =>
    Number(serie.peso) > Number(mejor.peso) ||
    (Number(serie.peso) === Number(mejor.peso) && serie.repeticiones > mejor.repeticiones)
      ? serie
      : mejor,
  )
  return masPesada.repeticiones === 1 ? '1 rep' : `${masPesada.repeticiones} reps`
}
