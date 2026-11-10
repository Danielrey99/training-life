/**
 * Qué toca cada día: el plan, calculado a partir de los programas, los días cambiados a
 * mano y los tramos en que una rutina estuvo oculta. Puerto de `backend/app/plan.py`.
 *
 * Cada día se resuelve con el programa que estaba activo **ese día**, no con el de hoy.
 */
import type { Contexto } from '../contexto'
import { noValido } from '../fallos'
import { aOrdinal, desdeOrdinal, diaDeLaSemana, diasEntre } from '../reglas/dias'
import { fechaEnTexto } from '../reglas/fechas'
import { porIds, type FilaRutina } from './salidas'

/** Lo que pide la pantalla de resumen: la constancia de un año entero. */
export const DIAS_MAXIMOS = 400

export type Origen = 'excepcion' | 'programa' | 'sin_programa'

export interface DiaPlan {
  fecha: string
  /** De un cambio hecho a mano, del programa activo ese día, o de ninguno. */
  origen: Origen
  /** El programa activo ese día, aunque lo que toque venga de una excepción. */
  programa_id: number | null
  rutina: FilaRutina | null
  /** Sin rutina, o con una que ese día estaba oculta (ahora o en un tramo cerrado). */
  descanso: boolean
}

/** «martes 15 de septiembre», con el año si no es el de hoy. */
export function enTexto(ctx: Contexto, fecha: string): string {
  return fechaEnTexto(fecha, ctx.reloj.hoy())
}

/** 422 si el rango está invertido: devolver una lista vacía lo disimularía. */
export function validarRango(ctx: Contexto, desde: string, hasta: string): void {
  if (desde > hasta) {
    throw noValido(
      `Las fechas están al revés. El ${enTexto(ctx, desde)} va después del` +
        ` ${enTexto(ctx, hasta)}.`,
    )
  }
}

/** Rango no invertido y de como mucho `DIAS_MAXIMOS` días. */
export function validarRangoDelPlan(ctx: Contexto, desde: string, hasta: string): void {
  validarRango(ctx, desde, hasta)
  if (diasEntre(desde, hasta) + 1 > DIAS_MAXIMOS) {
    throw noValido(`Como mucho se piden ${DIAS_MAXIMOS} días de una vez.`)
  }
}

/** Qué toca cada día de `desde` a `hasta`, los dos incluidos. */
export function diasDelPlan(ctx: Contexto, desde: string, hasta: string): DiaPlan[] {
  validarRangoDelPlan(ctx, desde, hasta)
  return resolverDias(ctx, desde, hasta)
}

/**
 * Como `diasDelPlan`, pero sin validar el rango: para quien necesita días de margen (el
 * seguimiento). Un número fijo de consultas, sea cual sea el rango.
 */
export function resolverDias(ctx: Contexto, desde: string, hasta: string): DiaPlan[] {
  const { bd } = ctx
  const periodos = bd.todas<{ programa_id: number; desde: string; hasta: string | null }>(
    'SELECT programa_id, desde, hasta FROM programa_periodos' +
      ' WHERE desde <= ? AND (hasta IS NULL OR hasta > ?)',
    hasta,
    desde,
  )
  const programaIds = [...new Set(periodos.map((p) => p.programa_id))]
  const filasDias =
    programaIds.length === 0
      ? []
      : bd.todas<{
          programa_id: number
          dia_semana: number
          rutina_id: number
          desde: string | null
          hasta: string | null
        }>(
          'SELECT programa_id, dia_semana, rutina_id, desde, hasta FROM programa_dias' +
            ` WHERE programa_id IN (${programaIds.map(() => '?').join(', ')})` +
            ' ORDER BY dia_semana, id',
          ...programaIds,
        )
  const excepciones = new Map(
    bd
      .todas<{ fecha: string; rutina_id: number | null }>(
        'SELECT fecha, rutina_id FROM excepciones_del_plan WHERE fecha >= ? AND fecha <= ?',
        desde,
        hasta,
      )
      .map((e) => [e.fecha, e.rutina_id] as [string, number | null]),
  )
  const rutinas = porIds<FilaRutina>(bd, 'rutinas', [
    ...filasDias.map((d) => d.rutina_id),
    ...[...excepciones.values()].filter((id): id is number => id !== null),
  ])
  const tramos = new Map<number, [string, string][]>()
  for (const t of bd.todas<{ rutina_id: number; desde: string; hasta: string }>(
    'SELECT rutina_id, desde, hasta FROM rutina_periodos_ocultos WHERE desde <= ? AND hasta > ?',
    hasta,
    desde,
  )) {
    const lista = tramos.get(t.rutina_id) ?? []
    lista.push([t.desde, t.hasta])
    tramos.set(t.rutina_id, lista)
  }

  /** Si la rutina estaba oculta ese día: ahora desde antes, o en un tramo cerrado. */
  const ocultaEseDia = (rutina: FilaRutina, fecha: string) =>
    (rutina.oculto_desde !== null && rutina.oculto_desde <= fecha) ||
    (tramos.get(rutina.id) ?? []).some(([d, h]) => d <= fecha && fecha < h)

  const plan: DiaPlan[] = []
  // Contando días y no sumando hasta pasarse: después del 31-12-9999 no hay fecha.
  const primero = aOrdinal(desde)
  for (let n = primero; n <= aOrdinal(hasta); n++) {
    const fecha = desdeOrdinal(n)
    // El periodo cubre de `desde` a `hasta` sin incluir `hasta`.
    const periodo = periodos.find((p) => p.desde <= fecha && (p.hasta === null || fecha < p.hasta))
    const programaId = periodo ? periodo.programa_id : null
    let rutina: FilaRutina | null
    let origen: Origen
    if (excepciones.has(fecha)) {
      // Lo que se cambió a mano para ese día manda sobre el programa.
      const rutinaId = excepciones.get(fecha)!
      rutina = rutinaId === null ? null : rutinas.get(rutinaId)!
      origen = 'excepcion'
    } else if (periodo) {
      // La fila vigente ESE día, no la de hoy: editar el programa no cambia el pasado.
      const semana = diaDeLaSemana(fecha)
      const dia = filasDias.find(
        (d) =>
          d.programa_id === periodo.programa_id &&
          d.dia_semana === semana &&
          (d.desde === null || d.desde <= fecha) &&
          (d.hasta === null || fecha < d.hasta),
      )
      rutina = dia ? rutinas.get(dia.rutina_id)! : null
      origen = 'programa'
    } else {
      rutina = null
      origen = 'sin_programa'
    }
    plan.push({
      fecha,
      origen,
      programa_id: programaId,
      rutina,
      descanso: rutina === null || ocultaEseDia(rutina, fecha),
    })
  }
  return plan
}

export function buscarExcepcion(
  ctx: Contexto,
  fecha: string,
): { id: number; fecha: string; rutina_id: number | null } | undefined {
  return ctx.bd.una('SELECT id, fecha, rutina_id FROM excepciones_del_plan WHERE fecha = ?', fecha)
}

/** Cambia a mano lo que toca un día: lo actualiza si ya estaba cambiado. */
export function ponerExcepcion(ctx: Contexto, fecha: string, rutinaId: number | null): void {
  const excepcion = buscarExcepcion(ctx, fecha)
  if (excepcion === undefined) {
    const ahora = ctx.reloj.ahora()
    ctx.bd.ejecutar(
      'INSERT INTO excepciones_del_plan (fecha, rutina_id, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?)',
      fecha,
      rutinaId,
      ahora,
      ahora,
    )
  } else if (excepcion.rutina_id !== rutinaId) {
    ctx.bd.ejecutar(
      'UPDATE excepciones_del_plan SET rutina_id = ? WHERE id = ?',
      rutinaId,
      excepcion.id,
    )
  }
}
