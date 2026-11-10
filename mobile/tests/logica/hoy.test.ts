/**
 * Lo que necesita la pantalla de hoy: `GET /plan/hoy`. Puerto de
 * `backend/tests/test_hoy.py`.
 *
 * En qué situación está el día, la semana, lo que se puede recuperar, lo que se ofrece
 * entrenar, el próximo entrenamiento y la última sesión. Con `fecha` (un día pasado) sirve
 * también para la hoja de registrar un día desde el calendario.
 *
 * Todos parten de la semana de `apoyo/semana.ts`: hoy es el miércoles 16 de septiembre de
 * 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
 */
import {
  crear_ejercicio,
  crear_hueco,
  crear_programa,
  crear_rutina,
  dejar_planificado,
  serie_en,
} from '../apoyo/ayudas'
import { crearCliente, type Entorno } from '../apoyo/cliente'
import { grupo_muscular_id as grupoMuscular, ppl as montarPpl } from '../apoyo/conftest'
import {
  DOMINGO_13,
  DOMINGO_20,
  HOY,
  JUEVES_10,
  LUNES_14,
  LUNES_21,
  LUNES_7,
  MARTES_15,
  MARTES_8,
  MIERCOLES_9,
  SABADO_19,
  VIERNES_11,
  VIERNES_18,
  VIERNES_4,
  hecha as hechaEn,
  sesion,
} from '../apoyo/semana'

let entorno: Entorno
let cliente: Entorno['cliente']
let hoy_es: (fecha: string) => void
let grupo_muscular_id: number

beforeEach(() => {
  entorno = crearCliente()
  cliente = entorno.cliente
  hoy_es = (fecha) => entorno.reloj.fijar(fecha)
  grupo_muscular_id = grupoMuscular(cliente)
})

/** La fixture `ppl`: la semana de ejemplo, con el reloj en el miércoles 16. */
function ppl(): Record<string, number> {
  return montarPpl(cliente, entorno.reloj)
}

function hecha(fecha: string, rutina_id: number, cubre_fecha?: string | null): number {
  return hechaEn(cliente, grupo_muscular_id, fecha, rutina_id, cubre_fecha)
}

function hoy(fecha?: string): any {
  const respuesta = cliente.get('/plan/hoy', { params: fecha ? { fecha } : {} })
  if (respuesta.status_code !== 200) throw new Error(respuesta.text)
  return respuesta.json()
}

function recuperables(resumen: any): [string, string, string, boolean][] {
  return resumen.por_recuperar.map((r: any) => [r.fecha, r.rutina.nombre, r.plazo, r.se_puede_hoy])
}

function ofrecidas(resumen: any): [string, string, string | null, boolean][] {
  return resumen.ofrecidas.map((o: any) => [o.accion, o.rutina.nombre, o.fecha, o.se_puede_hoy])
}

function terminada(entrenamiento_id: number): void {
  const respuesta = cliente.post(`/entrenamientos/${entrenamiento_id}/terminar`)
  if (respuesta.status_code !== 200) throw new Error(respuesta.text)
}

function desactivar_el_programa(): void {
  const programa = cliente.get('/programas').json()[0].id
  expect(cliente.post(`/programas/${programa}/desactivar`).status_code).toBe(200)
}

// --- Situaciones ---------------------------------------------------------

test('un_dia_de_entrenamiento', () => {
  // Toca Pull, y el viernes toca Leg. La semana pasada y el lunes no se entrenó nada: del
  // viernes 11 y del lunes 14 aún se está en plazo.
  ppl()

  const resumen = hoy()

  expect(resumen.fecha).toBe(HOY)
  expect(resumen.situacion).toBe('entrenamiento')
  expect(resumen.semana.map((dia: any) => dia.fecha)).toEqual(
    [14, 15, 16, 17, 18, 19, 20].map((n) => `2026-09-${n}`),
  )
  // En un día de entrenamiento también se recupera directamente.
  expect(recuperables(resumen)).toEqual([
    ['2026-09-11', 'Leg', '2026-09-17', true],
    ['2026-09-14', 'Push', '2026-09-20', true],
  ])
  // Intercambiar solo hasta el domingo: el Push del lunes 21 ya es otra semana.
  expect(ofrecidas(resumen)).toEqual([['intercambiar', 'Leg', '2026-09-18', true]])
  expect(resumen.proximo.fecha).toBe(VIERNES_18)
  expect(resumen.sesion).toBeNull()
})

test('con_la_sesion_en_curso_lo_que_queda_de_semana_sale_sin_boton', () => {
  const rutinas = ppl()
  const empezada = sesion(cliente, HOY, rutinas.Pull, HOY).json().id

  const resumen = hoy()

  expect(resumen.situacion).toBe('en_curso')
  expect(resumen.sesion.entrenamiento_id).toBe(empezada)
  // Como recordatorio: siempre adelantar (intercambiar tocaría el plan de hoy).
  expect(ofrecidas(resumen)).toEqual([['adelantar', 'Leg', '2026-09-18', false]])
  // La lista de lo pendiente se enseña, pero sin botón.
  expect(recuperables(resumen)).toEqual([
    ['2026-09-11', 'Leg', '2026-09-17', false],
    ['2026-09-14', 'Push', '2026-09-20', false],
  ])
})

test('ya_entrenado_hoy_con_otra_rutina_lo_de_hoy_queda_por_recuperar', () => {
  const rutinas = ppl()
  terminada(hecha(HOY, rutinas.Push, LUNES_14))

  const resumen = hoy()

  expect(resumen.situacion).toBe('hecho')
  expect(recuperables(resumen)).toEqual([
    ['2026-09-11', 'Leg', '2026-09-17', false],
    ['2026-09-16', 'Pull', '2026-09-22', false],
  ])
  expect(ofrecidas(resumen)).toEqual([['adelantar', 'Leg', '2026-09-18', false]])
})

test('un_dia_de_descanso_ofrece_adelantar_lo_que_queda_de_semana', () => {
  ppl()
  hoy_es(MARTES_15)

  const resumen = hoy()

  expect(resumen.situacion).toBe('descanso')
  expect(ofrecidas(resumen)).toEqual([
    ['adelantar', 'Pull', '2026-09-16', true],
    ['adelantar', 'Leg', '2026-09-18', true],
  ])
  // El Pull del miércoles 9 se recupera hasta hoy mismo.
  expect(recuperables(resumen)).toEqual([
    ['2026-09-09', 'Pull', '2026-09-15', true],
    ['2026-09-11', 'Leg', '2026-09-17', true],
    ['2026-09-14', 'Push', '2026-09-20', true],
  ])
})

test('lo_ya_hecho_esta_semana_no_se_ofrece', () => {
  // El lunes se adelantó el Leg del viernes: el martes solo queda el Pull.
  const rutinas = ppl()
  hoy_es(LUNES_14)
  hecha(LUNES_14, rutinas.Leg, VIERNES_18)
  hoy_es(MARTES_15)

  expect(ofrecidas(hoy())).toEqual([['adelantar', 'Pull', '2026-09-16', true]])
})

test('un_dia_hecho_por_adelantado_se_comporta_como_un_descanso', () => {
  const rutinas = ppl()
  hoy_es(MARTES_15)
  const adelantada = hecha(MARTES_15, rutinas.Leg, VIERNES_18)
  hoy_es(VIERNES_18)

  const resumen = hoy()

  expect(resumen.situacion).toBe('movido')
  const viernes = resumen.semana[4]
  expect(viernes.cubierto_por).toEqual({ entrenamiento_id: adelantada, fecha: MARTES_15 })
  // Nada más que adelantar esta semana; el Push y el Pull, por recuperar.
  expect(resumen.ofrecidas).toEqual([])
  expect(recuperables(resumen).map((r) => r.slice(0, 2))).toEqual([
    ['2026-09-14', 'Push'],
    ['2026-09-16', 'Pull'],
  ])
})

test('una_rutina_que_toca_dos_dias_se_ofrece_una_vez_el_primero', () => {
  // El sábado también es Leg (planificado a mano): ofrecer dos veces la misma rutina no
  // aporta nada, ni al adelantar ni al intercambiar.
  const rutinas = ppl()
  hoy_es(MARTES_15)
  dejar_planificado(cliente, SABADO_19, rutinas.Leg)

  const adelantar = ofrecidas(hoy())
  hoy_es(HOY)
  const intercambiar = ofrecidas(hoy())

  expect(adelantar).toEqual([
    ['adelantar', 'Pull', '2026-09-16', true],
    ['adelantar', 'Leg', '2026-09-18', true],
  ])
  expect(intercambiar).toEqual([['intercambiar', 'Leg', '2026-09-18', true]])
})

test('la_primera_vez_sin_rutinas', () => {
  hoy_es(HOY)

  const resumen = hoy()

  expect(resumen.situacion).toBe('primera_vez')
  expect(resumen.ofrecidas).toEqual([])
  expect(resumen.proximo).toBeNull()
  expect(resumen.ultima_sesion).toBeNull()
})

test('sin_programa_se_ofrecen_todas_las_rutinas_sin_contar', () => {
  hoy_es(HOY)
  for (const nombre of ['Push', 'Leg']) crear_rutina(cliente, nombre)

  const resumen = hoy()

  expect(resumen.situacion).toBe('sin_programa')
  expect(ofrecidas(resumen)).toEqual([
    ['sin_contar', 'Leg', null, true],
    ['sin_contar', 'Push', null, true],
  ])
})

test('sin_programa_un_descanso_planificado_a_mano_no_cuenta_como_descanso', () => {
  // Se planificó hoy como descanso y después se desactivó el programa sin quitar lo
  // planificado: sin programa no hay semana que seguir, así que se ofrece todo.
  ppl()
  dejar_planificado(cliente, HOY, null)
  desactivar_el_programa()

  const resumen = hoy()

  expect(resumen.situacion).toBe('sin_programa')
  expect(ofrecidas(resumen).map((o) => o[0])).toEqual(['sin_contar', 'sin_contar', 'sin_contar'])
})

test('sin_programa_una_rutina_planificada_a_mano_si_se_entrena', () => {
  const rutinas = ppl()
  dejar_planificado(cliente, HOY, rutinas.Leg)
  desactivar_el_programa()

  const resumen = hoy()

  expect(resumen.situacion).toBe('entrenamiento')
  expect(sesion(cliente, HOY, rutinas.Leg, HOY).status_code).toBe(201)
})

// --- Lo que queda de semana, con sesión hoy ------------------------------

test('un_descanso_en_que_se_adelanto_solo_recuerda_lo_que_falta', () => {
  // El martes se adelantó el Pull del miércoles: el propio Pull ya no sale.
  const rutinas = ppl()
  hoy_es(MARTES_15)
  const adelantada = hecha(MARTES_15, rutinas.Pull, HOY)
  terminada(adelantada)

  const resumen = hoy()

  expect(resumen.situacion).toBe('hecho')
  expect(ofrecidas(resumen)).toEqual([['adelantar', 'Leg', '2026-09-18', false]])
})

test('la_rutina_de_hoy_sigue_pendiente_si_vuelve_a_tocar_esta_semana', () => {
  // El sábado también es Pull (planificado a mano). Sin sesión, intercambiar quita la rutina
  // de hoy; el recordatorio no, porque el Pull del sábado sigue sin hacer.
  const rutinas = ppl()
  dejar_planificado(cliente, SABADO_19, rutinas.Pull)
  terminada(hecha(HOY, rutinas.Pull, HOY))

  expect(ofrecidas(hoy())).toEqual([
    ['adelantar', 'Leg', '2026-09-18', false],
    ['adelantar', 'Pull', '2026-09-19', false],
  ])
})

test('un_dia_movido_en_que_se_entreno_recuerda_lo_que_queda', () => {
  // El Pull de hoy se adelantó al martes, y hoy se recupera el Push del lunes.
  const rutinas = ppl()
  hoy_es(MARTES_15)
  terminada(hecha(MARTES_15, rutinas.Pull, HOY))
  hoy_es(HOY)
  expect(hoy().situacion).toBe('movido')
  hecha(HOY, rutinas.Push, LUNES_14)

  const resumen = hoy()

  expect(resumen.situacion).toBe('en_curso')
  expect(ofrecidas(resumen)).toEqual([['adelantar', 'Leg', '2026-09-18', false]])
})

test('el_domingo_con_sesion_no_queda_nada_de_semana', () => {
  const rutinas = ppl()
  hoy_es(DOMINGO_20)
  hecha(DOMINGO_20, rutinas.Push, LUNES_14)

  const resumen = hoy()

  expect(resumen.situacion).toBe('en_curso')
  expect(resumen.ofrecidas).toEqual([])
})

test('sin_programa_con_sesion_hoy_no_se_recuerda_nada', () => {
  // Sin programa no hay semana que seguir, aunque quede una rutina planificada a mano el
  // viernes (que sin sesión tampoco se ofrecería para adelantar).
  const rutinas = ppl()
  dejar_planificado(cliente, VIERNES_18, rutinas.Leg)
  desactivar_el_programa()
  hecha(HOY, rutinas.Push)

  const resumen = hoy()

  expect(resumen.situacion).toBe('en_curso')
  expect(resumen.ofrecidas).toEqual([])
})

test('la_sesion_de_hoy_cancelada_no_cuenta_y_se_puede_intercambiar', () => {
  // Terminada sin series es una sesión cancelada: el día vuelve a estar por hacer y la lista
  // vuelve a tener botón.
  const rutinas = ppl()
  const cancelada = sesion(cliente, HOY, rutinas.Pull, HOY).json().id
  terminada(cancelada)

  const resumen = hoy()

  expect(resumen.situacion).toBe('entrenamiento')
  expect(ofrecidas(resumen)).toEqual([['intercambiar', 'Leg', '2026-09-18', true]])
})

// --- Por recuperar -------------------------------------------------------

test('el_ultimo_dia_de_plazo_se_ofrece_y_al_siguiente_ya_no', () => {
  // El domingo caduca lo del lunes (la web lo pinta en ámbar cuando `plazo` es hoy); el
  // lunes siguiente ya no se ofrece.
  ppl()
  hoy_es(DOMINGO_20)
  expect(recuperables(hoy())[0]).toEqual(['2026-09-14', 'Push', '2026-09-20', true])

  hoy_es(LUNES_21)
  expect(recuperables(hoy()).map((r) => r[0])).not.toContain('2026-09-14')
})

test('lo_ya_recuperado_no_se_ofrece', () => {
  const rutinas = ppl()
  hoy_es(MARTES_15)
  hecha(MARTES_15, rutinas.Push, LUNES_14)
  hoy_es(HOY)

  expect(recuperables(hoy()).map((r) => r.slice(0, 2))).toEqual([['2026-09-11', 'Leg']])
})

test('una_rutina_oculta_no_se_ofrece_para_recuperar', () => {
  const rutinas = ppl()
  expect(cliente.delete(`/rutinas/${rutinas.Push}?modo=ocultar`).status_code).toBe(204)

  expect(recuperables(hoy()).map((r) => r.slice(0, 2))).toEqual([['2026-09-11', 'Leg']])
})

test('lo_que_tocaba_con_el_programa_anterior_no_se_ofrece', () => {
  const rutinas = ppl()
  crear_programa(cliente, { nombre: 'Otro', dias: [[1, rutinas.Push]], activar: true })

  expect(recuperables(hoy())).toEqual([])
})

// --- Última sesión -------------------------------------------------------

test('la_ultima_sesion_es_la_anterior_con_algo_apuntado', () => {
  const rutinas = ppl()
  const anterior = hecha(LUNES_7, rutinas.Push, LUNES_7)
  // Cancelada: sin series y de un día pasado.
  sesion(cliente, JUEVES_10, rutinas.Pull)

  const ultima = hoy().ultima_sesion

  expect(ultima.entrenamiento_id).toBe(anterior)
  expect(ultima.fecha).toBe(LUNES_7)
  expect(ultima.rutina.nombre).toBe('Push')
})

test('la_ultima_sesion_trae_sus_cifras_y_el_dia_que_recuperaba', () => {
  const rutinas = ppl()
  const recuperada = hecha(MARTES_15, rutinas.Push, LUNES_14)
  const otro = crear_ejercicio(cliente, grupo_muscular_id, 'Fondos')
  for (const numero of [2, 3]) {
    expect(serie_en(cliente, recuperada, otro, { numero, peso: 20 }).status_code).toBe(201)
  }

  const ultima = hoy().ultima_sesion

  expect([ultima.series, ultima.ejercicios]).toEqual([3, 2])
  expect(ultima.cubre_fecha).toBe(LUNES_14)
})

test('la_de_hoy_es_la_ultima_cuando_ya_esta_terminada', () => {
  // A medias sale la anterior; terminada, la de hoy (la pantalla de "ya entrenado").
  const rutinas = ppl()
  const anterior = hecha(LUNES_7, rutinas.Push, LUNES_7)
  const de_hoy = hecha(HOY, rutinas.Pull, HOY)

  expect(hoy().ultima_sesion.entrenamiento_id).toBe(anterior)

  terminada(de_hoy)

  expect(hoy().ultima_sesion.entrenamiento_id).toBe(de_hoy)
})

// --- Las rutinas ---------------------------------------------------------

test('cada_rutina_dice_sus_ejercicios_y_cuando_se_hizo_por_ultima_vez', () => {
  // Los huecos ocultos no cuentan, ni las sesiones canceladas ni las de hoy.
  const rutinas = ppl()
  const ejercicio = crear_ejercicio(cliente, grupo_muscular_id, 'Remo')
  const huecos = [0, 1, 2].map(() => crear_hueco(cliente, rutinas.Pull, ejercicio))
  expect(
    cliente.delete(`/rutinas/${rutinas.Pull}/slots/${huecos[2]}?modo=ocultar`).status_code,
  ).toBe(204)
  hecha(MIERCOLES_9, rutinas.Pull, MIERCOLES_9)
  sesion(cliente, VIERNES_11, rutinas.Pull) // cancelada
  hecha(HOY, rutinas.Pull, HOY)

  const lista: any[] = hoy().rutinas
  const por_nombre = Object.fromEntries(lista.map((r) => [r.nombre, r]))

  expect(Object.keys(por_nombre)).toEqual(['Leg', 'Pull', 'Push'])
  expect([por_nombre.Pull.ejercicios, por_nombre.Pull.ultima_vez]).toEqual([2, MIERCOLES_9])
  expect([por_nombre.Push.ejercicios, por_nombre.Push.ultima_vez]).toEqual([0, null])
})

test('una_rutina_oculta_no_sale_entre_las_rutinas', () => {
  const rutinas = ppl()
  expect(cliente.delete(`/rutinas/${rutinas.Leg}?modo=ocultar`).status_code).toBe(204)

  expect(hoy().rutinas.map((r: any) => r.nombre)).toEqual(['Pull', 'Push'])
})

// --- Registrar un día pasado ---------------------------------------------

test('un_descanso_pasado_ofrece_recuperar_y_todas_las_rutinas_sin_contar', () => {
  // La hoja de registrar un día pasado es para apuntar de ese día hacia atrás: ofrece
  // recuperar lo que estaba en plazo y, sin contar, todas las rutinas, también las que se
  // recuperan (decisión del autor del 2-11-2026: antes solo salía el resto). Antes aún
  // ofrecía adelantar el Pull del miércoles y el Leg del viernes, como la pantalla de
  // Entrenar; adelantar queda solo para hoy.
  ppl()
  crear_rutina(cliente, 'Brazos')

  const resumen = hoy(MARTES_15)

  expect(resumen.situacion).toBe('descanso')
  expect(recuperables(resumen).map((r) => r.slice(0, 2))).toEqual([
    ['2026-09-09', 'Pull'],
    ['2026-09-11', 'Leg'],
    ['2026-09-14', 'Push'],
  ])
  expect(ofrecidas(resumen)).toEqual([
    ['sin_contar', 'Brazos', null, true],
    ['sin_contar', 'Leg', null, true],
    ['sin_contar', 'Pull', null, true],
    ['sin_contar', 'Push', null, true],
  ])
})

test('un_descanso_pasado_sin_nada_por_recuperar_no_adelanta_lo_que_queda', () => {
  // Todo lo anterior al martes 15 está hecho, y quedan el Pull del miércoles y el Leg del
  // viernes. Antes salían para adelantar; ahora salen sin contar, como cualquier otra rutina.
  const rutinas = ppl()
  for (const [fecha, rutina] of [
    [MIERCOLES_9, 'Pull'],
    [VIERNES_11, 'Leg'],
    [LUNES_14, 'Push'],
  ]) {
    hecha(fecha, rutinas[rutina], fecha)
  }

  const resumen = hoy(MARTES_15)

  expect(resumen.situacion).toBe('descanso')
  expect(recuperables(resumen)).toEqual([])
  expect(ofrecidas(resumen)).toEqual([
    ['sin_contar', 'Leg', null, true],
    ['sin_contar', 'Pull', null, true],
    ['sin_contar', 'Push', null, true],
  ])
})

test('un_dia_pasado_movido_no_adelanta_y_ofrece_todas_sin_contar', () => {
  // El Pull del miércoles 9 se adelantó al martes 8, y el viernes 11 tocaba Leg. Antes, la
  // hoja del miércoles 9 ofrecía adelantar ese Leg; ahora sale sin contar, con todas las
  // demás: el Pull y también el Push del lunes 7, que sigue para recuperar.
  const rutinas = ppl()
  // El Leg del viernes 4 hecho, para que no salga entre lo que se recupera.
  hecha(VIERNES_4, rutinas.Leg, VIERNES_4)
  hecha(MARTES_8, rutinas.Pull, MIERCOLES_9)

  const resumen = hoy(MIERCOLES_9)

  expect(resumen.situacion).toBe('movido')
  expect(recuperables(resumen).map((r) => r.slice(0, 2))).toEqual([['2026-09-07', 'Push']])
  expect(ofrecidas(resumen)).toEqual([
    ['sin_contar', 'Leg', null, true],
    ['sin_contar', 'Pull', null, true],
    ['sin_contar', 'Push', null, true],
  ])
})

test('un_dia_de_entrenamiento_pasado_no_ofrece_intercambiar', () => {
  // Intercambiar cambia el plan, y el pasado no se planifica. Sin contar salen todas, también
  // la que tocaba (el Push del lunes 14): apuntarla así crea una sesión que no cuenta, y el
  // día sigue sin hacer.
  ppl()
  crear_rutina(cliente, 'Brazos')

  const resumen = hoy(LUNES_14)

  expect(resumen.situacion).toBe('entrenamiento')
  expect(recuperables(resumen).map((r) => r.slice(0, 2))).toEqual([
    ['2026-09-09', 'Pull'],
    ['2026-09-11', 'Leg'],
  ])
  expect(ofrecidas(resumen)).toEqual([
    ['sin_contar', 'Brazos', null, true],
    ['sin_contar', 'Leg', null, true],
    ['sin_contar', 'Pull', null, true],
    ['sin_contar', 'Push', null, true],
  ])
})

/**
 * Sin programa, con Push y Leg, y el Leg puesto a mano el lunes 14 sin hacer. Hoy es el
 * miércoles 16: ese Leg sigue en plazo (hasta el domingo 20).
 */
function leg_planificado_el_lunes_sin_programa(): void {
  const rutinas = Object.fromEntries(['Push', 'Leg'].map((n) => [n, crear_rutina(cliente, n)]))
  hoy_es(LUNES_14)
  dejar_planificado(cliente, LUNES_14, rutinas.Leg)
  hoy_es(HOY)
}

test('hoy_sin_programa_lo_que_se_recupera_no_se_repite_sin_contar', () => {
  // En Entrenar, una rutina no sale dos veces: el Leg del lunes, por recuperar, no vuelve a
  // salir en «Entrenar una rutina». En un día pasado sí (test siguiente).
  leg_planificado_el_lunes_sin_programa()

  const resumen = hoy()

  expect(resumen.situacion).toBe('sin_programa')
  expect(recuperables(resumen).map((r) => r.slice(0, 2))).toEqual([['2026-09-14', 'Leg']])
  expect(ofrecidas(resumen)).toEqual([['sin_contar', 'Push', null, true]])
})

test('un_dia_pasado_sin_programa_ofrece_todas_sin_contar', () => {
  // La hoja del martes 15: el Leg del lunes se recupera, y además sale sin contar con las
  // demás, como en un día pasado con programa.
  leg_planificado_el_lunes_sin_programa()

  const resumen = hoy(MARTES_15)

  expect(resumen.situacion).toBe('sin_programa')
  expect(recuperables(resumen).map((r) => r.slice(0, 2))).toEqual([['2026-09-14', 'Leg']])
  expect(ofrecidas(resumen)).toEqual([
    ['sin_contar', 'Leg', null, true],
    ['sin_contar', 'Push', null, true],
  ])
})

test('un_dia_pasado_con_sesion', () => {
  const rutinas = ppl()
  hecha(DOMINGO_13, rutinas.Leg)

  const resumen = hoy(DOMINGO_13)

  expect(resumen.situacion).toBe('hecho')
  expect(resumen.ofrecidas).toEqual([])
})

test('una_fecha_futura_da_422', () => {
  ppl()

  const respuesta = cliente.get('/plan/hoy', { params: { fecha: '2026-09-17' } })

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    422,
    'El jueves 17 de septiembre todavía no ha llegado. Solo se apuntan días de hoy hacia atrás.',
  ])
})
