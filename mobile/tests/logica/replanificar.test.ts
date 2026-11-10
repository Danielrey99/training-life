/**
 * Replanificar con días ya hechos por adelantado. Puerto de
 * `backend/tests/test_replanificar.py`.
 *
 * Si el Leg del viernes se hizo el martes y en Planificar se mueve el Leg al sábado, la
 * sesión del martes pasa a contar el sábado: lo hecho sigue a su rutina. Si el cambio la
 * dejara sin ningún día de esta semana con su rutina, no se permite (409) y no se guarda
 * nada. Al editar el programa, en cambio, el día ya hecho se queda como estaba y el cambio
 * empieza la semana siguiente.
 *
 * Todos parten de la semana de `apoyo/semana.ts`: hoy es el miércoles 16 de septiembre de
 * 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
 */
import { cambiar_dias, planificar } from '../apoyo/ayudas'
import { crearCliente, type Entorno } from '../apoyo/cliente'
import { grupo_muscular_id as grupoMuscular, ppl as montarPpl } from '../apoyo/conftest'
import { insertar } from '../apoyo/filas'
import {
  DOMINGO_20,
  HOY,
  JUEVES_17,
  LUNES_14,
  MARTES_15,
  SABADO_19,
  VIERNES_18,
  VIERNES_25,
  cubre,
  hecha as hechaEn,
  seguimiento,
  sesion,
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

/** El Leg del viernes, hecho el martes. */
function leg_adelantado(): number {
  return hecha(MARTES_15, ppl.Leg, VIERNES_18)
}

// --- Lo hecho sigue a su rutina ------------------------------------------

test('al_mover_la_rutina_a_otro_dia_la_sesion_la_sigue', () => {
  const adelantada = leg_adelantado()

  expect(planificar(cliente, SABADO_19, ppl.Leg).status_code).toBe(200)
  // El sábado ya toca Leg, pero la sesión sigue contando el viernes.
  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
  expect(planificar(cliente, VIERNES_18, null).status_code).toBe(200)

  expect(cubre(cliente, adelantada)).toBe(SABADO_19)
  expect(seguimiento(cliente, SABADO_19)[SABADO_19].estado).toBe('movido')
})

test('si_la_rutina_se_queda_sin_dia_no_se_guarda_nada', () => {
  const adelantada = leg_adelantado()

  const respuesta = planificar(cliente, VIERNES_18, null)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(
    sin_dia_para_ella(MARTES_15, VIERNES_18, 'Leg', adelantada),
  )
  // Ni la sesión ni el plan cambiaron.
  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
  expect(cliente.get('/plan/excepciones').json()).toEqual([])
})

test('planificar_hoy_despues_de_entrenar_lleva_la_sesion_a_otro_dia', () => {
  // Se empezó el Pull de hoy y después se replanifica hoy como Leg, con otro Pull el sábado:
  // la sesión pasa a contar el sábado. Cambiar el programa, en cambio, la deja donde está
  // (`cambiar_en_el_programa_el_dia_de_hoy_despues_de_entrenar_lo_deja_como_estaba`).
  const empezada = sesion(cliente, HOY, ppl.Pull, HOY).json().id
  expect(planificar(cliente, SABADO_19, ppl.Pull).status_code).toBe(200)

  expect(planificar(cliente, HOY, ppl.Leg).status_code).toBe(200)

  expect(cubre(cliente, empezada)).toBe(SABADO_19)
})

test('restablecer_un_dia_reubica_lo_que_contaba', () => {
  // El jueves se cambió a Leg y se adelantó; al restablecerlo, el Leg vuelve a ser solo el
  // del viernes, y la sesión pasa a contarlo.
  expect(planificar(cliente, JUEVES_17, ppl.Leg).status_code).toBe(200)
  const adelantada = hecha(MARTES_15, ppl.Leg, JUEVES_17)

  expect(cliente.delete(`/plan/excepciones/${JUEVES_17}`).status_code).toBe(204)

  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
})

test('dos_adelantos_que_se_cruzan_el_dia_al_restablecer_la_semana', () => {
  // Hoy se cambió a Leg y el viernes a Pull; el Leg de hoy se hizo el lunes y el Pull del
  // viernes el martes. Al restablecer la semana, hoy vuelve a Pull y el viernes a Leg: cada
  // sesión pasa al día de la otra. Asignarlas de una vez chocaría a mitad de camino con la
  // unicidad de `cubre_fecha` (por eso se reubican en dos fases). Antes se probaba con
  // `POST /plan/intercambiar`, que ya no existe; el intercambio de la pantalla de hoy, en
  // `intercambiar.test.ts`.
  expect(planificar(cliente, HOY, ppl.Leg).status_code).toBe(200)
  expect(planificar(cliente, VIERNES_18, ppl.Pull).status_code).toBe(200)
  const leg = hecha(LUNES_14, ppl.Leg, HOY)
  const pull = hecha(MARTES_15, ppl.Pull, VIERNES_18)

  const respuesta = cliente.delete('/plan/excepciones', {
    params: { desde: HOY, hasta: VIERNES_18 },
  })

  expect(respuesta.status_code).toBe(204)
  expect(cubre(cliente, leg)).toBe(VIERNES_18)
  expect(cubre(cliente, pull)).toBe(HOY)
})

test('cambiar_un_dia_que_ya_estaba_cambiado_a_mano', () => {
  // El jueves se cambió a Leg y se adelantó; cambiarlo ahora a Push deja el Leg solo en el
  // viernes, y la sesión pasa a contarlo.
  expect(planificar(cliente, JUEVES_17, ppl.Leg).status_code).toBe(200)
  const adelantada = hecha(MARTES_15, ppl.Leg, JUEVES_17)

  expect(planificar(cliente, JUEVES_17, ppl.Push).status_code).toBe(200)

  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
})

test('no_va_a_un_dia_que_ya_cuenta_otra_sesion', () => {
  // Leg el viernes, el sábado y el domingo, y los dos primeros ya adelantados: al quitar el
  // del viernes, su sesión pasa al domingo, no al sábado.
  for (const dia of [SABADO_19, DOMINGO_20]) {
    expect(planificar(cliente, dia, ppl.Leg).status_code).toBe(200)
  }
  const viernes = leg_adelantado()
  const sabado = hecha(LUNES_14, ppl.Leg, SABADO_19)

  expect(planificar(cliente, VIERNES_18, null).status_code).toBe(200)

  expect(cubre(cliente, viernes)).toBe(DOMINGO_20)
  expect(cubre(cliente, sabado)).toBe(SABADO_19)
})

// --- Editar el programa ---------------------------------------------------
//
// Cambiar la rutina de un día de la semana en el programa no mueve lo hecho por adelantado:
// ese día se queda como estaba, y el cambio empieza al día siguiente.

function programa_id(): number {
  return cliente.get('/programas').json()[0].id
}

/** La fila de ese día de la semana que vale ahora en el programa. */
function fila_vigente(programa: number, dia_semana: number) {
  return entorno.bd.una<{ rutina_id: number; desde: string | null }>(
    'SELECT rutina_id, desde FROM programa_dias WHERE programa_id = ? AND dia_semana = ?' +
      ' AND hasta IS NULL',
    programa,
    dia_semana,
  )!
}

function rutinas_del_plan(desde: string, hasta: string): Record<string, [string | null, string]> {
  const dias: any[] = cliente.get('/plan/seguimiento', { params: { desde, hasta } }).json()
  return Object.fromEntries(
    dias.map((dia) => [dia.fecha, [dia.rutina ? dia.rutina.nombre : null, dia.estado]]),
  )
}

test('cambiar_un_dia_del_programa_ya_adelantado_empieza_la_semana_siguiente', () => {
  leg_adelantado()

  const respuesta = cambiar_dias(cliente, programa_id(), { 5: ppl.Push })

  expect(respuesta.status_code).toBe(200)
  const plan = rutinas_del_plan(VIERNES_18, VIERNES_25)
  expect(plan['2026-09-18']).toEqual(['Leg', 'movido'])
  expect(plan['2026-09-25']).toEqual(['Push', 'proximo'])
})

test('guardar_dos_dias_a_la_vez_respeta_el_adelantado_solo_en_el_suyo', () => {
  // El *Guardar* de la semana cambia el miércoles y el viernes en una sola petición. El
  // viernes ya está hecho (adelantado el martes): cambia desde el sábado 19, el día siguiente
  // al contado. El miércoles no tiene nada hecho: cambia desde hoy.
  leg_adelantado()
  const id_ = programa_id()

  const respuesta = cambiar_dias(cliente, id_, { 3: ppl.Leg, 5: ppl.Push })

  expect(respuesta.status_code).toBe(200)
  const filas = entorno.bd.todas<{ dia_semana: number; rutina_id: number; desde: string | null }>(
    'SELECT dia_semana, rutina_id, desde FROM programa_dias WHERE programa_id = ?' +
      ' AND hasta IS NULL',
    id_,
  )
  const vigentes = Object.fromEntries(filas.map((f) => [f.dia_semana, [f.rutina_id, f.desde]]))
  expect(vigentes).toEqual({
    1: [ppl.Push, null],
    3: [ppl.Leg, HOY],
    5: [ppl.Push, SABADO_19],
  })
  const plan = rutinas_del_plan(VIERNES_18, VIERNES_25)
  expect([plan['2026-09-18'], plan['2026-09-25']]).toEqual([
    ['Leg', 'movido'],
    ['Push', 'proximo'],
  ])
})

test('sin_nada_adelantado_el_cambio_empieza_hoy_mismo', () => {
  expect(cambiar_dias(cliente, programa_id(), { 5: ppl.Push }).status_code).toBe(200)

  expect(rutinas_del_plan(VIERNES_18, VIERNES_18)['2026-09-18']).toEqual(['Push', 'proximo'])
})

test('dejar_en_descanso_un_dia_ya_adelantado_tambien_lo_respeta', () => {
  leg_adelantado()

  const respuesta = cambiar_dias(cliente, programa_id(), { 5: null })

  expect(respuesta.status_code).toBe(200)
  const plan = rutinas_del_plan(VIERNES_18, VIERNES_25)
  expect(plan['2026-09-18']).toEqual(['Leg', 'movido'])
  expect(plan['2026-09-25']).toEqual([null, 'descanso'])
})

test('cambiar_en_el_programa_el_dia_de_hoy_despues_de_entrenar_lo_deja_como_estaba', () => {
  // Hoy se empezó el Pull; pasar los miércoles a Leg empieza el miércoles 23.
  sesion(cliente, HOY, ppl.Pull, HOY)

  expect(cambiar_dias(cliente, programa_id(), { 3: ppl.Leg }).status_code).toBe(200)

  const plan = rutinas_del_plan(HOY, '2026-09-23')
  expect(plan['2026-09-16']).toEqual(['Pull', 'hecho'])
  expect(plan['2026-09-23']).toEqual(['Leg', 'proximo'])
})

test('con_el_dia_cambiado_a_mano_el_programa_cambia_desde_hoy', () => {
  // El viernes lo decide una excepción de Planificar, no el programa: cambiar el programa no
  // le afecta, así que no hay por qué esperar al viernes siguiente. El plan que se ve es el
  // mismo; lo que cambia es desde cuándo vale la fila nueva.
  expect(planificar(cliente, VIERNES_18, ppl.Leg).status_code).toBe(200)
  leg_adelantado()
  const id_ = programa_id()

  expect(cambiar_dias(cliente, id_, { 5: ppl.Push }).status_code).toBe(200)

  expect(rutinas_del_plan(VIERNES_18, VIERNES_18)['2026-09-18']).toEqual(['Leg', 'movido'])
  const vigente = fila_vigente(id_, 5)
  expect([vigente.rutina_id, vigente.desde]).toEqual([ppl.Push, HOY])
})

test('editar_otro_programa_no_mira_lo_adelantado_del_activo', () => {
  // El viernes adelantado es del programa activo: editar otro, que estuvo activo en agosto,
  // cambia desde hoy.
  leg_adelantado()
  const otro = cliente
    .post('/programas', {
      json: { nombre: 'Viejo', dias: [{ dia_semana: 5, rutina_id: ppl.Leg }] },
    })
    .json().id
  insertar(entorno.bd, 'programa_periodos', {
    programa_id: otro,
    desde: '2026-08-01',
    hasta: '2026-08-31',
  })

  expect(cambiar_dias(cliente, otro, { 5: ppl.Push }).status_code).toBe(200)

  const vigente = fila_vigente(otro, 5)
  expect([vigente.rutina_id, vigente.desde]).toEqual([ppl.Push, HOY])
})

// --- Lo que no se reubica ------------------------------------------------

test('una_sesion_que_ya_no_contaba_no_se_mueve', () => {
  // Un Push que dice contar el viernes (Leg) no lo contaba: dejar el viernes en descanso no
  // le afecta, ni da 409.
  const push = hecha(MARTES_15, ppl.Push)
  entorno.bd.ejecutar('UPDATE entrenamientos SET cubre_fecha = ? WHERE id = ?', VIERNES_18, push)

  expect(planificar(cliente, VIERNES_18, null).status_code).toBe(200)
  expect(cubre(cliente, push)).toBe(VIERNES_18)
})

test('una_sesion_cancelada_ni_se_mueve_ni_estorba', () => {
  // La cancelada del lunes retenía el sábado: se borra cuando el sábado le hace falta a la
  // que sí contaba. Y la que no cuenta nada no da 409.
  const adelantada = leg_adelantado()
  const cancelada = sesion(cliente, LUNES_14, ppl.Leg).json().id
  entorno.bd.ejecutar(
    'UPDATE entrenamientos SET cubre_fecha = ? WHERE id = ?',
    SABADO_19,
    cancelada,
  )
  expect(planificar(cliente, SABADO_19, ppl.Leg).status_code).toBe(200)

  expect(planificar(cliente, VIERNES_18, null).status_code).toBe(200)

  expect(cubre(cliente, adelantada)).toBe(SABADO_19)
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(404)
})

test('una_sesion_de_otra_rutina_que_retenia_el_destino_lo_suelta_y_se_queda', () => {
  // El Push hecho el lunes dice contar el sábado, pero el sábado es de Leg: no lo cuenta,
  // solo lo retiene. Cuando el Leg adelantado tiene que irse al sábado, el Push lo suelta (se
  // queda sin día) y sigue con sus series, como al crear una sesión. Sin soltarlo, la
  // unicidad de `cubre_fecha` daría un 500.
  const adelantada = leg_adelantado()
  const push = hecha(LUNES_14, ppl.Push)
  entorno.bd.ejecutar('UPDATE entrenamientos SET cubre_fecha = ? WHERE id = ?', SABADO_19, push)
  expect(planificar(cliente, SABADO_19, ppl.Leg).status_code).toBe(200)

  const respuesta = planificar(cliente, VIERNES_18, null)

  expect(respuesta.status_code).toBe(200)
  expect(cubre(cliente, adelantada)).toBe(SABADO_19)
  const retenida = cliente.get(`/entrenamientos/${push}`).json()
  expect(retenida.cubre_fecha).toBeNull()
  expect(retenida.series).toHaveLength(1)
})
