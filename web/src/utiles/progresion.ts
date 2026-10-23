import type { SesionHistorial, TipoRegistro } from '../api/tipos'
import { ajustes } from './ajustes'
import { conPesoYReps, kilos } from './medidas'
import { duracionLegible, enUnidad, numeroLegible, unidad, unoRM } from './numeros'

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
}

/** «26,7 kg»: el valor, ya en la unidad elegida, con un decimal como mucho. */
export function enKilos(valor: number): string {
  const redondeado = Math.round(valor * 10) / 10
  return `${redondeado.toLocaleString('es-ES', { maximumFractionDigits: 1 })} ${unidad()}`
}

const conSigno = (diferencia: number, texto: string) =>
  `${diferencia > 0 ? '+' : diferencia < 0 ? '−' : ''}${texto}`

const series = (sesion: SesionHistorial) =>
  `${sesion.series.length} ${sesion.series.length === 1 ? 'serie' : 'series'}`

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

const MEDIDAS: Record<TipoRegistro, Medida[]> = {
  peso_reps: [
    {
      clave: 'peso',
      texto: 'Peso',
      rotulo: 'Por sesión',
      valor: (sesion) => Math.max(...conPesoYReps(sesion.series).map((s) => Number(s.peso))),
      enPeso: true,
      escribir: enKilos,
      cambio: cambioDeKilos,
      globo: (sesion, valor) => `${enKilos(valor)} × ${repsDeLaMasPesada(sesion)}`,
    },
    {
      clave: 'volumen',
      texto: 'Volumen',
      rotulo: 'Por sesión',
      valor: (sesion) =>
        conPesoYReps(sesion.series).reduce(
          (total, serie) => total + Number(serie.peso) * serie.repeticiones,
          0,
        ),
      enPeso: true,
      escribir: enKilos,
      cambio: cambioDeKilos,
      globo: (sesion, valor) => `${enKilos(valor)} en ${series(sesion)}`,
    },
    {
      clave: 'rm',
      texto: '1RM',
      rotulo: 'Por sesión',
      valor: (sesion) => unoRM(sesion.series),
      enPeso: true,
      escribir: enKilos,
      cambio: cambioDeKilos,
      // «de media» solo con la media: «en la mejor serie» no cabe en el globo.
      globo: (_, valor) => `${enKilos(valor)}${ajustes().unoRM === 'media' ? ' de media' : ''}`,
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
      globo: (_, valor) => `${reps(valor)} de media`,
    },
    {
      clave: 'total',
      texto: 'Reps totales',
      rotulo: 'Suma por sesión',
      valor: totalDeReps,
      enPeso: false,
      escribir: reps,
      cambio: cambioDeReps,
      globo: (sesion, valor) => `${reps(valor)} en ${series(sesion)}`,
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
      globo: (_, valor) => `${duracionLegible(Math.round(valor))} de media`,
    },
    {
      clave: 'total',
      texto: 'Tiempo total',
      rotulo: 'Suma por sesión',
      valor: totalDeTiempo,
      enPeso: false,
      escribir: (valor) => duracionLegible(Math.round(valor)),
      cambio: cambioDeTiempo,
      globo: (sesion, valor) => `${duracionLegible(Math.round(valor))} en ${series(sesion)}`,
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
}

/**
 * Las medidas de un ejercicio. La carga o el peso de los de peso corporal y de tiempo
 * solo salen si alguna vez los hubo: sin ellos la gráfica sería una línea en 0.
 */
export function medidasDe(tipo: TipoRegistro, sesiones: SesionHistorial[]): Medida[] {
  const todas = MEDIDAS[tipo]
  if (tipo === 'peso_reps') return todas
  const hubo = sesiones.some((sesion) => sesion.series.some((serie) => (kilos(serie) ?? 0) !== 0))
  return todas.filter((medida) => medida.clave !== (tipo === 'corporal' ? 'carga' : 'peso') || hubo)
}

/** El valor de una sesión en esa medida, sin convertir de unidad (kg, reps o segundos). */
export function valorDe(tipo: TipoRegistro, sesion: SesionHistorial, clave: string): number {
  const medida = MEDIDAS[tipo].find((otra) => otra.clave === clave) ?? MEDIDAS[tipo][0]
  return medida.valor(sesion)
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
