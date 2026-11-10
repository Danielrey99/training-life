/**
 * La semana de ejemplo que comparten los tests del seguimiento del plan. Puerto de
 * `backend/tests/semana.py`.
 *
 * Hoy es el **miércoles 16 de septiembre de 2026**, y el programa Push (lunes), Pull
 * (miércoles) y Leg (viernes) está activo desde el lunes 31 de agosto. La fixture `ppl` de
 * `conftest.ts` lo monta y congela el reloj en ese día.
 *
 * Las fechas son textos ISO, no `date`: `LUNES_31.isoformat()` es `LUNES_31`.
 */
import { en_texto, ejercicio_de_prueba, esperar_estado, serie_en } from './ayudas'
import type { ClienteDeTest as Cliente, RespuestaDeTest } from './cliente'

// Los días de alrededor, con su día de la semana para leer los tests de un vistazo.
export const LUNES_31 = '2026-08-31'
export const MARTES_1 = '2026-09-01'
export const MIERCOLES_2 = '2026-09-02'
export const VIERNES_4 = '2026-09-04'
export const SABADO_5 = '2026-09-05'
export const LUNES_7 = '2026-09-07'
export const MARTES_8 = '2026-09-08'
export const MIERCOLES_9 = '2026-09-09'
export const JUEVES_10 = '2026-09-10'
export const VIERNES_11 = '2026-09-11'
export const SABADO_12 = '2026-09-12'
export const DOMINGO_13 = '2026-09-13'
export const LUNES_14 = '2026-09-14'
export const MARTES_15 = '2026-09-15'
export const HOY = '2026-09-16' // miércoles
export const JUEVES_17 = '2026-09-17'
export const VIERNES_18 = '2026-09-18'
export const SABADO_19 = '2026-09-19'
export const DOMINGO_20 = '2026-09-20'
export const LUNES_21 = '2026-09-21'
export const MIERCOLES_23 = '2026-09-23'
export const VIERNES_25 = '2026-09-25'
export const DOMINGO_27 = '2026-09-27'

/** POST /entrenamientos; devuelve la respuesta entera, para mirar el código. */
export function sesion(
  cliente: Cliente,
  fecha: string,
  rutina_id: number,
  cubre_fecha?: string | null,
): RespuestaDeTest {
  const cuerpo: Record<string, unknown> = { fecha, rutina_id }
  if (cubre_fecha !== undefined && cubre_fecha !== null) cuerpo.cubre_fecha = cubre_fecha
  return cliente.post('/entrenamientos', { json: cuerpo })
}

/** `GET /plan/seguimiento` de los días pedidos (uno solo, sin `hasta`), por fecha. */
export function seguimiento(cliente: Cliente, desde: string, hasta?: string): Record<string, any> {
  const respuesta = cliente.get('/plan/seguimiento', {
    params: { desde, hasta: hasta ?? desde },
  })
  esperar_estado(respuesta, 200)
  return Object.fromEntries(respuesta.json().map((dia: any) => [dia.fecha, dia]))
}

/** El día que cuenta la sesión (`cubre_fecha`), o `null` si no cuenta ninguno. */
export function cubre(cliente: Cliente, entrenamiento_id: number): string | null {
  return cliente.get(`/entrenamientos/${entrenamiento_id}`).json().cubre_fecha
}

/**
 * Una sesión sin series que ya no está en curso cuenta como cancelada: para que cuente, tiene
 * que tener algo apuntado.
 */
export function con_una_serie(
  cliente: Cliente,
  grupo_muscular_id: number,
  entrenamiento_id: number,
): void {
  // En un hueco que la rutina ya tenga, para no cambiarle los ejercicios; si no tiene ninguno,
  // se le añade uno.
  const rutina_id = cliente.get(`/entrenamientos/${entrenamiento_id}`).json().rutina_id
  const visibles: any[] = cliente
    .get(`/rutinas/${rutina_id}`)
    .json()
    .slots.filter((hueco: any) => hueco.oculto_desde === null)
  // Reutilizado si ya existe: con dos rutinas sin huecos en el mismo test, las dos usan el
  // mismo ejercicio en vez de crear otro igual.
  const ejercicio =
    visibles.length > 0
      ? visibles[0].ejercicio_principal.id
      : ejercicio_de_prueba(cliente, grupo_muscular_id, 'Press banca')
  esperar_estado(serie_en(cliente, entrenamiento_id, ejercicio, { repeticiones: 10 }), 201)
}

/**
 * Una sesión con una serie apuntada: sin series, ya fuera de curso, sería una sesión
 * cancelada. Devuelve su id.
 */
export function hecha(
  cliente: Cliente,
  grupo_muscular_id: number,
  fecha: string,
  rutina_id: number,
  cubre_fecha?: string | null,
): number {
  const respuesta = sesion(cliente, fecha, rutina_id, cubre_fecha)
  esperar_estado(respuesta, 201)
  const entrenamiento_id = respuesta.json().id
  con_una_serie(cliente, grupo_muscular_id, entrenamiento_id)
  return entrenamiento_id
}

/**
 * El 409 de replanificar cuando lo hecho por adelantado se queda sin ningún día de esta
 * semana con su rutina: dice qué sesión es, para poder abrirla. Si la rutina está oculta, lo
 * dice y pide mostrarla: ningún día puede tenerla mientras lo esté.
 */
export function sin_dia_para_ella(
  fecha: string,
  cubre_fecha: string,
  rutina: string,
  entrenamiento_id: number,
  oculta = false,
): Record<string, unknown> {
  const sin_dia =
    `La sesión del ${en_texto(fecha)} cuenta como lo del` +
    ` ${en_texto(cubre_fecha)}, y con este cambio ya no queda ningún día de esta` +
    ` semana con «${rutina}» para ella`
  const mensaje = oculta
    ? `${sin_dia}, porque «${rutina}» está oculta. Muestra «${rutina}» desde la pestaña` +
      ' Programas o borra antes esa sesión.'
    : `${sin_dia}. Deja algún día con esa rutina o borra antes esa sesión.`
  return { mensaje, entrenamiento_id, fecha }
}
