/**
 * Los endpoints del plan: el seguimiento, la pantalla de hoy y los días cambiados a mano.
 * Puerto de `backend/app/routers/plan.py` (la lógica está en `plan.ts` y `seguimiento.ts`,
 * como en el backend en `app/plan.py` y `app/seguimiento.py`).
 */
import type { Contexto } from '../contexto'
import { noEncontrado, noValido } from '../fallos'
import { mayor } from '../reglas/dias'
import type { DiaSeguimiento as DiaSeguimientoOut, Excepcion, Hoy, SesionDelDia } from '../tipos'
import { buscarExcepcion, enTexto, ponerExcepcion, validarRango } from './plan'
import { obtenerRutinaVisible } from './rutinas'
import { porIds, rutinaMinima, type FilaRutina } from './salidas'
import {
  coberturasEnJuego,
  resumenDeHoy,
  reubicarCoberturas,
  seguimiento,
  type DiaSeguimiento,
  type SesionDelDia as SesionDelDiaInterna,
} from './seguimiento'

// --- Salidas -------------------------------------------------------------------------------

function sesionDelDiaOut(s: SesionDelDiaInterna | null): SesionDelDia | null {
  return s === null
    ? null
    : {
        entrenamiento_id: s.entrenamiento_id,
        rutina: rutinaMinima(s.rutina),
        en_curso: s.en_curso,
        cubre_fecha: s.cubre_fecha,
        cuenta: s.cuenta,
      }
}

/** Un día del seguimiento como lo da la API: sin `programa_id`, con la rutina mínima. */
export function diaSeguimientoOut(d: DiaSeguimiento): DiaSeguimientoOut {
  return {
    fecha: d.fecha,
    origen: d.origen,
    rutina: d.rutina === null ? null : rutinaMinima(d.rutina),
    descanso: d.descanso,
    estado: d.estado,
    cubierto_por: d.cubierto_por,
    sesion: sesionDelDiaOut(d.sesion),
  }
}

// --- Endpoints -----------------------------------------------------------------------------

/** El pasado no se planifica: lo que pasó se registra, no se cambia. */
function exigirHoyODespues(ctx: Contexto, fecha: string): void {
  if (fecha < ctx.reloj.hoy()) {
    throw noValido(
      `El ${enTexto(ctx, fecha)} ya ha pasado. Solo se puede planificar de hoy` + ' en adelante.',
    )
  }
}

/** Qué tocaba cada día y qué pasó. Como mucho, 400 días de una vez. */
export function obtenerSeguimiento(
  ctx: Contexto,
  desde: string,
  hasta: string,
): DiaSeguimientoOut[] {
  return seguimiento(ctx, desde, hasta).map(diaSeguimientoOut)
}

/**
 * Lo que necesita la pantalla de hoy; con una fecha pasada, la hoja de registrar ese día.
 * Una fecha futura da 422: el futuro se planifica, no se registra.
 */
export function obtenerHoy(ctx: Contexto, fecha: string | null): Hoy {
  const dia = fecha ?? ctx.reloj.hoy()
  if (dia > ctx.reloj.hoy()) {
    throw noValido(
      `El ${enTexto(ctx, dia)} todavía no ha llegado. Solo se apuntan días de` +
        ' hoy hacia atrás.',
    )
  }
  const r = resumenDeHoy(ctx, dia)
  return {
    fecha: r.fecha,
    situacion: r.situacion,
    semana: r.semana.map(diaSeguimientoOut),
    sesion: sesionDelDiaOut(r.sesion),
    proximo: r.proximo === null ? null : diaSeguimientoOut(r.proximo),
    por_recuperar: r.por_recuperar.map((x) => ({
      fecha: x.fecha,
      rutina: rutinaMinima(x.rutina),
      plazo: x.plazo,
      se_puede_hoy: x.se_puede_hoy,
    })),
    ofrecidas: r.ofrecidas.map((x) => ({
      accion: x.accion,
      rutina: rutinaMinima(x.rutina),
      fecha: x.fecha,
      se_puede_hoy: x.se_puede_hoy,
    })),
    ultima_sesion:
      r.ultima_sesion === null
        ? null
        : {
            entrenamiento_id: r.ultima_sesion.entrenamiento_id,
            fecha: r.ultima_sesion.fecha,
            rutina: rutinaMinima(r.ultima_sesion.rutina),
            cubre_fecha: r.ultima_sesion.cubre_fecha,
            series: r.ultima_sesion.series,
            ejercicios: r.ultima_sesion.ejercicios,
          },
    rutinas: r.rutinas,
  }
}

function excepcionesOut(
  ctx: Contexto,
  filas: readonly { fecha: string; rutina_id: number | null }[],
): Excepcion[] {
  const rutinas = porIds<FilaRutina>(
    ctx.bd,
    'rutinas',
    filas.map((f) => f.rutina_id).filter((id): id is number => id !== null),
  )
  return filas.map((f) => ({
    fecha: f.fecha,
    rutina: f.rutina_id === null ? null : rutinaMinima(rutinas.get(f.rutina_id)!),
  }))
}

/** Los días cambiados a mano, del más cercano al más lejano. */
export function listarExcepciones(
  ctx: Contexto,
  desde: string | null,
  hasta: string | null,
): Excepcion[] {
  if (desde !== null && hasta !== null) validarRango(ctx, desde, hasta)
  const condiciones: string[] = []
  const params: string[] = []
  if (desde !== null) {
    condiciones.push('fecha >= ?')
    params.push(desde)
  }
  if (hasta !== null) {
    condiciones.push('fecha <= ?')
    params.push(hasta)
  }
  const where = condiciones.length > 0 ? ` WHERE ${condiciones.join(' AND ')}` : ''
  return excepcionesOut(
    ctx,
    ctx.bd.todas(
      `SELECT fecha, rutina_id FROM excepciones_del_plan${where} ORDER BY fecha`,
      ...params,
    ),
  )
}

/**
 * Cambia lo que toca un día: otra rutina, o descanso con `rutina_id` nulo. Lo hecho por
 * adelantado sigue a su rutina a otro día de esta semana; si no le queda ninguno, 409.
 */
export function planificarDia(ctx: Contexto, fecha: string, rutinaId: number | null): Excepcion {
  exigirHoyODespues(ctx, fecha)
  if (rutinaId !== null) obtenerRutinaVisible(ctx, rutinaId)
  const contaban = coberturasEnJuego(ctx)
  ponerExcepcion(ctx, fecha, rutinaId)
  reubicarCoberturas(ctx, contaban)
  return excepcionesOut(ctx, [buscarExcepcion(ctx, fecha)!])[0]
}

/** *Restablecer este día*: vuelve a lo que diga el programa. */
export function restablecerDia(ctx: Contexto, fecha: string): void {
  exigirHoyODespues(ctx, fecha)
  const excepcion = buscarExcepcion(ctx, fecha)
  if (excepcion === undefined) {
    throw noEncontrado('Ese día no estaba cambiado. Ya es lo que dice el programa.')
  }
  const contaban = coberturasEnJuego(ctx)
  ctx.bd.ejecutar('DELETE FROM excepciones_del_plan WHERE id = ?', excepcion.id)
  reubicarCoberturas(ctx, contaban)
}

/** *Restablecer la semana*: los días del rango de hoy en adelante; el pasado no se toca. */
export function restablecerRango(ctx: Contexto, desde: string, hasta: string): void {
  validarRango(ctx, desde, hasta)
  const contaban = coberturasEnJuego(ctx)
  ctx.bd.ejecutar(
    'DELETE FROM excepciones_del_plan WHERE fecha >= ? AND fecha <= ?',
    mayor(desde, ctx.reloj.hoy()),
    hasta,
  )
  reubicarCoberturas(ctx, contaban)
}
