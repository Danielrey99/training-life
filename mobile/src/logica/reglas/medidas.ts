/**
 * Qué medidas lleva una serie según cómo se apunta su ejercicio. Copia de
 * `backend/app/medidas.py`, con los mismos textos.
 *
 * | tipo        | peso                              | repeticiones | duración    | distancia | peso corporal |
 * |-------------|-----------------------------------|--------------|-------------|-----------|---------------|
 * | `peso_reps` | obligatorio, 0 o más              | obligatorio  | no          | no        | no            |
 * | `corporal`  | obligatorio: 0 sin carga, + lastre, − ayuda | obligatorio | no     | no        | opcional      |
 * | `tiempo`    | opcional, 0 o más                 | no           | obligatoria | no        | no            |
 * | `cardio`    | no                                | no           | obligatoria | opcional  | no            |
 */
import { comparar } from './centesimas'

export type TipoRegistro = 'peso_reps' | 'corporal' | 'tiempo' | 'cardio'

export const TIPOS: TipoRegistro[] = ['peso_reps', 'corporal', 'tiempo', 'cardio']

/** Cómo se dice cada tipo en un mensaje: «Plancha se apunta por tiempo: …». */
export const COMO_SE_APUNTA: Record<TipoRegistro, string> = {
  peso_reps: 'con peso y repeticiones',
  corporal: 'con repeticiones y carga',
  tiempo: 'por tiempo',
  cardio: 'por tiempo y, si se quiere, distancia',
}

/** La familia decide en qué unidad va el objetivo del ejercicio en un hueco. */
export const FAMILIA: Record<TipoRegistro, 'repeticiones' | 'duracion'> = {
  peso_reps: 'repeticiones',
  corporal: 'repeticiones',
  tiempo: 'duracion',
  cardio: 'duracion',
}

type Campo = 'peso' | 'repeticiones' | 'duracion_s' | 'distancia_m'

/** Qué campos son obligatorios (true), opcionales (null) o no valen (false) en cada tipo. */
export const REGLA: Record<TipoRegistro, Record<Campo, boolean | null>> = {
  peso_reps: { peso: true, repeticiones: true, duracion_s: false, distancia_m: false },
  corporal: { peso: true, repeticiones: true, duracion_s: false, distancia_m: false },
  tiempo: { peso: null, repeticiones: false, duracion_s: true, distancia_m: false },
  cardio: { peso: false, repeticiones: false, duracion_s: true, distancia_m: null },
}

const PLURALES = new Set<Campo>(['repeticiones'])

const NOMBRE_DEL_CAMPO: Record<Campo, string> = {
  peso: 'el peso',
  repeticiones: 'las repeticiones',
  duracion_s: 'la duración',
  distancia_m: 'la distancia',
}

function unir(partes: string[]): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/** «falta la duración», «faltan las repeticiones», «faltan el peso y las repeticiones». */
function verbo(base: string, campos: Campo[]): string {
  return base + (campos.length > 1 || PLURALES.has(campos[0]) ? 'n' : '')
}

/** Los valores finales de una serie, como llegan de la API (el peso, número o texto). */
export interface MedidasDeSerie {
  peso?: number | string | null
  repeticiones?: number | null
  duracion_s?: number | null
  distancia_m?: number | null
  peso_corporal?: number | string | null
}

function presente(valor: unknown): boolean {
  return valor !== null && valor !== undefined
}

/**
 * El texto de un 422 si las medidas de la serie no cuadran con el tipo del ejercicio, o
 * `null` si valen.
 */
export function validarMedidas(
  nombre: string,
  tipo: TipoRegistro,
  datos: MedidasDeSerie,
): string | null {
  const regla = REGLA[tipo]
  const campos = Object.keys(regla) as Campo[]
  const faltan = campos.filter((c) => regla[c] === true && !presente(datos[c]))
  const sobran = campos.filter((c) => regla[c] === false && presente(datos[c]))
  if (faltan.length > 0 || sobran.length > 0) {
    const detalle: string[] = []
    if (faltan.length > 0) {
      detalle.push(`${verbo('falta', faltan)} ${unir(faltan.map((c) => NOMBRE_DEL_CAMPO[c]))}`)
    }
    if (sobran.length > 0) {
      detalle.push(`${verbo('sobra', sobran)} ${unir(sobran.map((c) => NOMBRE_DEL_CAMPO[c]))}`)
    }
    const frase = unir(detalle)
    return `«${nombre}» se apunta ${COMO_SE_APUNTA[tipo]}. ${frase[0].toUpperCase()}${frase.slice(1)}.`
  }
  const peso = datos.peso
  if (presente(peso) && comparar(peso as number | string, 0) < 0 && tipo !== 'corporal') {
    return 'El peso no puede ser negativo. Solo los ejercicios de peso corporal admiten ayuda.'
  }
  if (presente(datos.peso_corporal) && tipo !== 'corporal') {
    return (
      'El peso corporal solo se guarda en las series de ejercicios de peso corporal, ' +
      `y «${nombre}» no lo es.`
    )
  }
  return null
}

/**
 * El texto de un 422 si el objetivo de un ejercicio en un hueco no es de su familia
 * (repeticiones o duración), o `null` si vale.
 */
export function validarObjetivo(
  nombre: string,
  tipo: TipoRegistro,
  objetivo: { reps_min?: number | null },
): string | null {
  const conReps = presente(objetivo.reps_min)
  if (FAMILIA[tipo] === 'repeticiones' && !conReps) {
    return (
      `El objetivo de «${nombre}» va en repeticiones y no en tiempo, porque «${nombre}» ` +
      `se apunta ${COMO_SE_APUNTA[tipo]}.`
    )
  }
  if (FAMILIA[tipo] === 'duracion' && conReps) {
    return (
      `El objetivo de «${nombre}» va en tiempo y no en repeticiones, porque «${nombre}» ` +
      `se apunta ${COMO_SE_APUNTA[tipo]}.`
    )
  }
  return null
}
