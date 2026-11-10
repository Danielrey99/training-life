/**
 * Los cuerpos de las sesiones y sus series: `EntrenamientoCreate`, `EntrenamientoUpdate`,
 * `SerieCreate`/`SerieUpdate` y `SerieDelDia` de `backend/app/schemas.py`, con los campos
 * en el orden de Pydantic.
 */
import {
  decimal,
  entero,
  fecha,
  lista,
  submodelo,
  textoOpcional,
  type Loc,
  type Validador,
} from './base'

/** Una serie como llega: el peso, tal cual (número o texto), para redondearlo al guardar. */
export interface SeriePedida {
  ejercicio_id: number
  slot_id: number
  numero_serie: number
  peso: number | string | null
  repeticiones: number | null
  duracion_s: number | null
  distancia_m: number | null
  peso_corporal: number | string | null
  variante: string | null
}

export interface SerieDelDiaPedida extends SeriePedida {
  id: number | null
}

export interface EntrenamientoNuevo {
  fecha: string
  notas: string | null
  rutina_id: number
  cubre_fecha: string | null
  intercambiar_con: string | null
}

export interface CambiosDeEntrenamiento {
  fecha: string
  notas: string | null
  series: SerieDelDiaPedida[] | null
}

const OPCIONAL = { porDefecto: null, nulo: true }

/** Los campos de `SerieBase`, con sus topes. */
export function camposDeSerie(v: Validador, d: Record<string, unknown>, loc: Loc): SeriePedida {
  return {
    ejercicio_id: entero(v, d, 'ejercicio_id', loc) as number,
    slot_id: entero(v, d, 'slot_id', loc) as number,
    numero_serie: entero(v, d, 'numero_serie', loc, { gt: 0, le: 100 }) as number,
    // 9999,99 es lo que cabe en la columna; el peso puede ser negativo (la ayuda de las
    // dominadas).
    peso: decimal(v, d, 'peso', loc, { ge: -9999.99, le: 9999.99 }, OPCIONAL) as
      number | string | null,
    repeticiones: entero(v, d, 'repeticiones', loc, { gt: 0, le: 1000 }, OPCIONAL) as number | null,
    duracion_s: entero(v, d, 'duracion_s', loc, { gt: 0, le: 86400 }, OPCIONAL) as number | null,
    distancia_m: entero(v, d, 'distancia_m', loc, { gt: 0, le: 1_000_000 }, OPCIONAL) as
      number | null,
    // `ge` y no `gt`: con 0,001 pasaría y la columna lo redondearía a 0,00.
    peso_corporal: decimal(v, d, 'peso_corporal', loc, { ge: 0.01, le: 500 }, OPCIONAL) as
      number | string | null,
    variante: textoOpcional(v, d, 'variante', loc, 100) as string | null,
  }
}

/** `SerieCreate` y `SerieUpdate`. */
export function serie(v: Validador, d: Record<string, unknown>, loc: Loc): SeriePedida {
  return camposDeSerie(v, d, loc)
}

/** `EntrenamientoCreate`. */
export function entrenamientoNuevo(
  v: Validador,
  d: Record<string, unknown>,
  loc: Loc,
): EntrenamientoNuevo {
  return {
    fecha: fecha(v, d, 'fecha', loc) as string,
    notas: textoOpcional(v, d, 'notas', loc, 1000) as string | null,
    rutina_id: entero(v, d, 'rutina_id', loc) as number,
    cubre_fecha: fecha(v, d, 'cubre_fecha', loc, OPCIONAL) as string | null,
    intercambiar_con: fecha(v, d, 'intercambiar_con', loc, OPCIONAL) as string | null,
  }
}

function serieDelDia(v: Validador, valor: unknown, loc: Loc): SerieDelDiaPedida | undefined {
  const d = submodelo(v, valor, loc, 'SerieDelDia')
  if (d === null) return undefined
  const campos = camposDeSerie(v, d, loc)
  const id = entero(v, d, 'id', loc, {}, OPCIONAL) as number | null
  return { ...campos, id }
}

/** `EntrenamientoUpdate`: la fecha, la nota y, si llegan, todas las series del día. */
export function cambiosDeEntrenamiento(
  v: Validador,
  d: Record<string, unknown>,
  loc: Loc,
): CambiosDeEntrenamiento {
  const antes = v.errores.length
  const nuevaFecha = fecha(v, d, 'fecha', loc) as string
  const notas = textoOpcional(v, d, 'notas', loc, 1000) as string | null
  const crudas = lista(v, d, 'series', loc, undefined, OPCIONAL)
  let series: SerieDelDiaPedida[] | null = null
  if (crudas) {
    series = crudas.map((x, i) => serieDelDia(v, x, [...loc, 'series', i])) as SerieDelDiaPedida[]
  }
  if (v.errores.length === antes && series !== null) {
    const ids = series.map((s) => s.id).filter((id) => id !== null)
    if (new Set(ids).size !== ids.length) v.errorDeValor(loc, 'Hay series repetidas.')
  }
  return { fecha: nuevaFecha, notas, series }
}
