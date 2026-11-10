/**
 * Los cuerpos de las rutinas y sus huecos: `RutinaCreate`, `RutinaUpdate`,
 * `RutinaSlotCreate`, `RutinaSlotUpdate` y `AlternativaDeHueco` de `backend/app/schemas.py`.
 *
 * Como en Pydantic, los campos de un modelo se leen en el orden en que se declaran (los de
 * la clase madre primero) y sus `model_validator` solo corren si todos sus campos valen:
 * primero el del objetivo (`ObjetivoBase`) y luego el de las alternativas.
 */
import type { FilaObjetivo } from '../servicios/salidas'
import {
  entero,
  lista,
  aEntero,
  submodelo,
  textoObligatorio,
  type Loc,
  type Validador,
} from './base'

export interface AlternativaPedida extends FilaObjetivo {
  ejercicio_id: number
}

export interface HuecoPedido extends FilaObjetivo {
  ejercicio_principal_id: number
  /** En un PUT, nula si no llegó: las alternativas no se tocan. */
  alternativas: AlternativaPedida[] | null
  /** Al crear, nulo si no llegó: el hueco va al final. */
  orden: number | null
}

export interface RutinaNueva {
  nombre: string
  slots: HuecoPedido[]
}

export interface CambiosDeRutina {
  nombre: string
  slot_ids: number[] | null
}

/** Los cinco campos de `ObjetivoBase`, con sus topes. */
function camposDelObjetivo(v: Validador, d: Record<string, unknown>, loc: Loc): FilaObjetivo {
  const opcional = { porDefecto: null, nulo: true }
  return {
    series_objetivo: entero(v, d, 'series_objetivo', loc, { gt: 0, le: 50 }) as number,
    reps_min: entero(v, d, 'reps_min', loc, { gt: 0, le: 1000 }, opcional) as number | null,
    reps_max: entero(v, d, 'reps_max', loc, { gt: 0, le: 1000 }, opcional) as number | null,
    duracion_min_s: entero(v, d, 'duracion_min_s', loc, { gt: 0, le: 86400 }, opcional) as
      number | null,
    duracion_max_s: entero(v, d, 'duracion_max_s', loc, { gt: 0, le: 86400 }, opcional) as
      number | null,
  }
}

/** `ObjetivoBase._validar_objetivo`: un par completo, y el máximo no menor que el mínimo. */
function validarObjetivo(v: Validador, o: FilaObjetivo, loc: Loc): boolean {
  const conReps = [o.reps_min !== null, o.reps_max !== null]
  const conDuracion = [o.duracion_min_s !== null, o.duracion_max_s !== null]
  if (
    conReps[0] !== conReps[1] ||
    conDuracion[0] !== conDuracion[1] ||
    conReps[0] === conDuracion[0]
  ) {
    v.errorDeValor(
      loc,
      'El objetivo lleva repeticiones o tiempo, uno de los dos, con su mínimo y su máximo.',
    )
    return false
  }
  if (conReps[0] && o.reps_max! < o.reps_min!) {
    v.errorDeValor(loc, 'El máximo de repeticiones no puede ser menor que el mínimo.')
    return false
  }
  if (conDuracion[0] && o.duracion_max_s! < o.duracion_min_s!) {
    v.errorDeValor(loc, 'El tiempo máximo no puede ser menor que el mínimo.')
    return false
  }
  return true
}

/** `_validar_comodines`: ni el principal entre las alternativas ni alternativas repetidas. */
function validarComodines(
  v: Validador,
  principal: number,
  alternativas: AlternativaPedida[] | null,
  loc: Loc,
): boolean {
  if (alternativas === null) return true
  const ids = alternativas.map((a) => a.ejercicio_id)
  if (ids.includes(principal)) {
    v.errorDeValor(loc, 'Una alternativa no puede ser el mismo ejercicio que el principal.')
    return false
  }
  if (new Set(ids).size !== ids.length) {
    v.errorDeValor(loc, 'Hay alternativas repetidas.')
    return false
  }
  return true
}

function alternativa(v: Validador, valor: unknown, loc: Loc): AlternativaPedida | undefined {
  const d = submodelo(v, valor, loc, 'AlternativaDeHueco')
  if (d === null) return undefined
  const antes = v.errores.length
  const objetivo = camposDelObjetivo(v, d, loc)
  const ejercicioId = entero(v, d, 'ejercicio_id', loc) as number
  if (v.errores.length > antes || !validarObjetivo(v, objetivo, loc)) return undefined
  return { ...objetivo, ejercicio_id: ejercicioId }
}

function alternativas(
  v: Validador,
  d: Record<string, unknown>,
  loc: Loc,
  nula: boolean,
): AlternativaPedida[] | null | undefined {
  const opciones = nula ? { porDefecto: null, nulo: true } : { porDefecto: [] }
  const crudas = lista(v, d, 'alternativas', loc, undefined, opciones)
  if (crudas === undefined || crudas === null) return crudas
  const leidas = crudas.map((x, i) => alternativa(v, x, [...loc, 'alternativas', i]))
  return leidas.every((a) => a !== undefined) ? (leidas as AlternativaPedida[]) : undefined
}

type Modelo = 'SlotDeRutinaNueva' | 'RutinaSlotCreate' | 'RutinaSlotUpdate'

/**
 * Un hueco: el de una rutina nueva (sin `orden`: su orden es su posición), el de crear
 * (`orden` opcional) o el de editar (`orden` obligatorio y `alternativas` que pueden
 * faltar). Los campos van en el orden de cada modelo.
 */
export function hueco(
  v: Validador,
  valor: unknown,
  loc: Loc,
  modelo: Modelo,
): HuecoPedido | undefined {
  const d = submodelo(v, valor, loc, modelo)
  if (d === null) return undefined
  const antes = v.errores.length
  const objetivo = camposDelObjetivo(v, d, loc)
  const principal = entero(v, d, 'ejercicio_principal_id', loc) as number
  let orden: number | null | undefined = null
  let alts: AlternativaPedida[] | null | undefined
  if (modelo === 'RutinaSlotUpdate') {
    orden = entero(v, d, 'orden', loc, { gt: 0, le: 100 })
    alts = alternativas(v, d, loc, true)
  } else {
    alts = alternativas(v, d, loc, false)
    if (modelo === 'RutinaSlotCreate') {
      orden = entero(v, d, 'orden', loc, { gt: 0, le: 100 }, { porDefecto: null, nulo: true })
    }
  }
  if (v.errores.length > antes) return undefined
  if (!validarObjetivo(v, objetivo, loc)) return undefined
  if (!validarComodines(v, principal, alts!, loc)) return undefined
  return { ...objetivo, ejercicio_principal_id: principal, alternativas: alts!, orden: orden! }
}

/** `RutinaCreate`: el nombre y, si llegan, sus huecos (hasta 100). */
export function rutinaNueva(v: Validador, d: Record<string, unknown>, loc: Loc): RutinaNueva {
  const nombre = textoObligatorio(v, d, 'nombre', loc, 100) as string
  const crudos = lista(v, d, 'slots', loc, 100, { porDefecto: [] })
  const slots = (crudos ?? []).map((x, i) => hueco(v, x, [...loc, 'slots', i], 'SlotDeRutinaNueva'))
  return { nombre, slots: slots as HuecoPedido[] }
}

/** `RutinaUpdate`: el nombre y, si llega, el orden de los huecos visibles. */
export function cambiosDeRutina(
  v: Validador,
  d: Record<string, unknown>,
  loc: Loc,
): CambiosDeRutina {
  const antes = v.errores.length
  const nombre = textoObligatorio(v, d, 'nombre', loc, 100) as string
  const crudos = lista(v, d, 'slot_ids', loc, undefined, { porDefecto: null, nulo: true })
  let slotIds: number[] | null = null
  if (crudos) {
    slotIds = crudos.map((x, i) => aEntero(v, x, [...loc, 'slot_ids', i]) as number)
  }
  if (v.errores.length === antes && slotIds !== null && new Set(slotIds).size !== slotIds.length) {
    v.errorDeValor(loc, 'Hay ejercicios repetidos.')
  }
  return { nombre, slot_ids: slotIds }
}
