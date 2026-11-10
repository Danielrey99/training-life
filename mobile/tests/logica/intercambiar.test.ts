/**
 * Intercambiar y empezar en una sola petición: `POST /entrenamientos` con
 * `intercambiar_con`. Puerto de `backend/tests/test_intercambiar.py`.
 *
 * En la pantalla de hoy, *Intercambiar* trae a hoy lo que toca otro día y empieza la
 * sesión. Antes eran dos llamadas (`POST /plan/intercambiar` y después crear la sesión): si
 * la segunda fallaba, el plan se quedaba cambiado sin sesión. Ahora es todo o nada, en una
 * transacción: lo que más importa aquí es que **ningún error deja el plan cambiado**.
 *
 * Orden de las comprobaciones: 422 fecha futura → 404 rutina → 422 del intercambio → 409 si
 * hoy ya hay sesión (antes de tocar el plan) → intercambio (puede dar el 409 de reubicar lo
 * adelantado) → el día que cuenta → 201.
 *
 * Todos parten de la semana de `apoyo/semana.ts`: hoy es el miércoles 16 de septiembre de
 * 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
 */
import { cuantas_filas, dejar_planificado, todavia_no_ha_llegado } from '../apoyo/ayudas'
import { crearCliente, type Entorno, type RespuestaDeTest } from '../apoyo/cliente'
import { grupo_muscular_id as grupoMuscular, ppl as montarPpl } from '../apoyo/conftest'
import {
  HOY,
  JUEVES_17,
  LUNES_14,
  LUNES_21,
  MARTES_15,
  SABADO_19,
  VIERNES_18,
  cubre,
  hecha as hechaEn,
  sin_dia_para_ella,
} from '../apoyo/semana'

let entorno: Entorno
let cliente: Entorno['cliente']
let ppl: Record<string, number>
let grupo_muscular_id: number

beforeEach(() => {
  entorno = crearCliente()
  cliente = entorno.cliente
  ppl = montarPpl(cliente, entorno.reloj)
  grupo_muscular_id = grupoMuscular(cliente)
})

function hecha(fecha: string, rutina_id: number, cubre_fecha?: string | null): number {
  return hechaEn(cliente, grupo_muscular_id, fecha, rutina_id, cubre_fecha)
}

// --- Ayudantes -----------------------------------------------------------

/**
 * POST /entrenamientos con `intercambiar_con`; devuelve la respuesta entera. Con
 * `cubre: null` se manda `cubre_fecha` nula.
 */
function empezar_intercambiando(
  rutina_id: number,
  otro: string,
  { fecha = HOY, cubre = HOY as string | null }: { fecha?: string; cubre?: string | null } = {},
): RespuestaDeTest {
  return cliente.post('/entrenamientos', {
    json: { rutina_id, fecha, cubre_fecha: cubre, intercambiar_con: otro },
  })
}

/** El día del seguimiento del plan: qué toca, de dónde sale y quién lo cuenta. */
function dia(fecha: string): any {
  const respuesta = cliente.get('/plan/seguimiento', { params: { desde: fecha, hasta: fecha } })
  expect(respuesta.status_code).toBe(200)
  return respuesta.json()[0]
}

/** `[origen, rutina o null, descanso]` de ese día. */
function lo_que_toca(fecha: string): [string, string | null, boolean] {
  const d = dia(fecha)
  return [d.origen, d.rutina ? d.rutina.nombre : null, d.descanso]
}

/** El Pull de hoy, empezado y terminado sin apuntar nada: una sesión cancelada. */
function cancelada_de_hoy(): number {
  const cancelada = cliente
    .post('/entrenamientos', {
      json: { rutina_id: ppl.Pull, fecha: HOY },
    })
    .json().id
  expect(cliente.post(`/entrenamientos/${cancelada}/terminar`).status_code).toBe(200)
  return cancelada
}

// --- Lo que hace ---------------------------------------------------------

test('intercambiar_y_empezar_trae_a_hoy_lo_de_ese_dia', () => {
  // Hoy Pull y el viernes Leg: se empieza Leg intercambiando con el viernes. Los dos días
  // quedan cambiados a mano, cada uno con lo del otro, y la sesión cuenta hoy.
  // `intercambiar_con` no se guarda: la sesión no lo devuelve.
  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18)

  expect(respuesta.status_code).toBe(201)
  const sesion = respuesta.json()
  expect([sesion.rutina_id, sesion.fecha, sesion.cubre_fecha]).toEqual([ppl.Leg, HOY, HOY])
  expect(sesion).not.toHaveProperty('intercambiar_con')
  expect(lo_que_toca(HOY)).toEqual(['excepcion', 'Leg', false])
  expect(lo_que_toca(VIERNES_18)).toEqual(['excepcion', 'Pull', false])
  expect(dia(HOY).cubierto_por.entrenamiento_id).toBe(sesion.id)
})

test('intercambiar_con_un_dia_ya_cambiado_a_mano', () => {
  // El sábado (descanso en el programa) se planificó Push: al intercambiarlo, hoy pasa a Push
  // y el sábado a Pull, lo de hoy salga del programa o de una excepción.
  dejar_planificado(cliente, SABADO_19, ppl.Push)

  const respuesta = empezar_intercambiando(ppl.Push, SABADO_19)

  expect(respuesta.status_code).toBe(201)
  expect(lo_que_toca(HOY)).toEqual(['excepcion', 'Push', false])
  expect(lo_que_toca(SABADO_19)).toEqual(['excepcion', 'Pull', false])
})

test('un_descanso_de_hoy_se_lleva_al_otro_dia', () => {
  // Hoy se cambió a descanso: al traer el Leg del viernes, el viernes se queda en descanso.
  dejar_planificado(cliente, HOY, null)

  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18)

  expect(respuesta.status_code).toBe(201)
  expect(lo_que_toca(HOY)).toEqual(['excepcion', 'Leg', false])
  expect(lo_que_toca(VIERNES_18)).toEqual(['excepcion', null, true])
})

test('una_rutina_oculta_de_hoy_se_lleva_como_descanso', () => {
  // Hoy toca Pull, pero está oculta: cuenta como descanso, y así se lleva al viernes. Lo
  // oculto no se vuelve a planificar.
  expect(cliente.delete(`/rutinas/${ppl.Pull}?modo=ocultar`).status_code).toBe(204)

  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18)

  expect(respuesta.status_code).toBe(201)
  expect(lo_que_toca(HOY)).toEqual(['excepcion', 'Leg', false])
  expect(lo_que_toca(VIERNES_18)).toEqual(['excepcion', null, true])
})

test('lo_de_hoy_hecho_por_adelantado_se_va_con_su_rutina', () => {
  // El Pull de hoy se hizo el lunes. Al traer el Leg del viernes, el Pull pasa al viernes y
  // la sesión del lunes con él; la nueva cuenta hoy.
  const adelantada = hecha(LUNES_14, ppl.Pull, HOY)

  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18)

  expect(respuesta.status_code).toBe(201)
  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
  expect(respuesta.json().cubre_fecha).toBe(HOY)
})

test('una_sesion_cancelada_de_hoy_se_borra_y_se_crea_la_nueva', () => {
  // Se empezó el Pull de hoy y se terminó sin apuntar nada: está cancelada, no ocupa el día.
  const cancelada = cancelada_de_hoy()

  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18)

  expect(respuesta.status_code).toBe(201)
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(404)
  expect(lo_que_toca(HOY)).toEqual(['excepcion', 'Leg', false])
})

// --- Errores de la petición: 422 y 404, sin tocar nada ---------------------

test.each([
  [
    'un-dia-pasado',
    'Leg',
    VIERNES_18,
    MARTES_15,
    MARTES_15,
    'Solo se intercambia al empezar la sesión de hoy.',
  ],
  ['el-mismo-dia', 'Pull', HOY, HOY, HOY, 'Para intercambiar hacen falta dos días distintos.'],
  [
    'con-un-dia-pasado',
    'Push',
    LUNES_14,
    HOY,
    HOY,
    'El lunes 14 de septiembre ya ha pasado. Solo se puede intercambiar con un' +
      ' día de hoy en adelante.',
  ],
  [
    'cuenta-otro-dia',
    'Leg',
    VIERNES_18,
    HOY,
    VIERNES_18,
    'Al intercambiar, la sesión cuenta como lo que toca hoy.',
  ],
  [
    'sin-cubre-fecha',
    'Leg',
    VIERNES_18,
    HOY,
    null,
    'Al intercambiar, la sesión cuenta como lo que toca hoy.',
  ],
  [
    'otra-rutina',
    'Push',
    VIERNES_18,
    HOY,
    HOY,
    'El viernes 18 de septiembre no toca esa rutina. Intercambiar trae a hoy lo que' +
      ' toca ese día.',
  ],
  [
    'un-descanso',
    'Leg',
    JUEVES_17,
    HOY,
    HOY,
    'El jueves 17 de septiembre no toca esa rutina. Intercambiar trae a hoy lo que' +
      ' toca ese día.',
  ],
] as const)(
  'un_intercambio_mal_pedido_da_422_y_no_cambia_nada (%s)',
  (_id, rutina, otro, fecha, cubre_, mensaje) => {
    const respuesta = empezar_intercambiando(ppl[rutina], otro, { fecha, cubre: cubre_ })

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail).toBe(mensaje)
    expect(cuantas_filas(entorno.bd, 'excepciones_del_plan', 'entrenamientos')).toEqual([0, 0])
  },
)

test('una_fecha_futura_da_su_422_antes_que_el_del_intercambio', () => {
  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18, {
    fecha: JUEVES_17,
    cubre: JUEVES_17,
  })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(todavia_no_ha_llegado(JUEVES_17))
  expect(cuantas_filas(entorno.bd, 'excepciones_del_plan')).toEqual([0])
})

test('una_rutina_oculta_da_404_antes_que_nada_y_no_cambia_el_plan', () => {
  // El 404 de la rutina va antes que los 422 del intercambio: el mismo día dos veces sería
  // un 422, y sale el 404.
  expect(cliente.delete(`/rutinas/${ppl.Leg}?modo=ocultar`).status_code).toBe(204)

  const respuesta = empezar_intercambiando(ppl.Leg, HOY)

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Esa rutina no existe o está oculta.')
  expect(cuantas_filas(entorno.bd, 'excepciones_del_plan')).toEqual([0])
})

test('un_422_del_intercambio_no_borra_la_cancelada_de_hoy', () => {
  // Los errores de la petición van antes que liberar el día.
  const cancelada = cancelada_de_hoy()

  const respuesta = empezar_intercambiando(ppl.Push, VIERNES_18)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    422,
    'El viernes 18 de septiembre no toca esa rutina. Intercambiar trae a hoy lo que' +
      ' toca ese día.',
  ])
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(200)
})

// --- Choques con lo que ya hay: 409, y el plan como estaba ---------------------

test.each([
  ['en-curso', false],
  ['terminada-con-series', true],
])('si_hoy_ya_hay_sesion_da_409_y_el_plan_no_cambia (%s)', (_id, terminada) => {
  // Se entrena una rutina al día: con una sesión de hoy (en curso, o terminada con algo
  // apuntado), 409 con su id, y el intercambio no se hace.
  const hoy_id = hecha(HOY, ppl.Pull, HOY)
  if (terminada) {
    expect(cliente.post(`/entrenamientos/${hoy_id}/terminar`).status_code).toBe(200)
  }

  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18)

  expect(respuesta.status_code).toBe(409)
  const detalle = respuesta.json().detail
  expect([detalle.entrenamiento_id, detalle.en_curso]).toEqual([hoy_id, !terminada])
  expect(cuantas_filas(entorno.bd, 'excepciones_del_plan', 'entrenamientos')).toEqual([0, 1])
  expect(lo_que_toca(HOY)).toEqual(['programa', 'Pull', false])
})

test('si_lo_adelantado_se_queda_sin_dia_da_409_y_no_se_crea_nada', () => {
  // El Pull de hoy se hizo el lunes, y se trae el Push del lunes que viene: el Pull se iría
  // a la semana siguiente, y en esta no queda ningún otro día con Pull para la sesión del
  // lunes. Es el 409 de reubicar lo adelantado: ni la sesión nueva ni los días cambiados.
  const adelantada = hecha(LUNES_14, ppl.Pull, HOY)

  const respuesta = empezar_intercambiando(ppl.Push, LUNES_21)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(sin_dia_para_ella(LUNES_14, HOY, 'Pull', adelantada))
  expect(cuantas_filas(entorno.bd, 'excepciones_del_plan', 'entrenamientos')).toEqual([0, 1])
  expect(cubre(cliente, adelantada)).toBe(HOY)
})

test('si_lo_del_otro_dia_ya_se_hizo_da_409_y_lo_deshace_todo', () => {
  // El Leg del viernes se hizo el martes, y se intenta traerlo a hoy. El intercambio lleva
  // esa sesión a hoy (sigue a su rutina), y entonces hoy ya está hecho: 409 cuando el plan
  // ya se ha cambiado y la cancelada de hoy ya se ha borrado. La transacción tiene que
  // deshacerlo todo: ni días cambiados, ni la sesión del martes movida, ni la cancelada
  // borrada, ni sesión nueva.
  const adelantada = hecha(MARTES_15, ppl.Leg, VIERNES_18)
  const cancelada = cancelada_de_hoy()

  const respuesta = empezar_intercambiando(ppl.Leg, VIERNES_18)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual({
    mensaje:
      'Lo del miércoles 16 de septiembre ya está hecho. Lo cuenta la sesión del martes' +
      ' 15 de septiembre.',
    entrenamiento_id: adelantada,
  })
  expect(cuantas_filas(entorno.bd, 'excepciones_del_plan', 'entrenamientos')).toEqual([0, 2])
  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(200)
  expect(lo_que_toca(HOY)).toEqual(['programa', 'Pull', false])
  expect(lo_que_toca(VIERNES_18)).toEqual(['programa', 'Leg', false])
})
