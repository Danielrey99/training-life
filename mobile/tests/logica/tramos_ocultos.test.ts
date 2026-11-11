/**
 * Los tramos en que una rutina estuvo oculta (`rutina_periodos_ocultos`). Puerto de
 * `backend/tests/test_tramos_ocultos.py`.
 *
 * Ocultar una rutina deja de ponerla en el plan desde ese día: sus días cuentan como
 * descanso. Mostrarla después no reescribe el pasado: los días que le tocaban mientras
 * estuvo oculta siguen siendo descanso, y para eso se guarda cada tramo ya cerrado
 * (`[desde, hasta)`, sin incluir el día en que se volvió a mostrar). Lo que ya contaba una
 * sesión de esa rutina antes de ocultarla (hecho ese día o adelantado) sigue contando,
 * oculta o no.
 *
 * Todos parten de la semana de `apoyo/semana.ts`: hoy es el miércoles 16 de septiembre de
 * 2026, con Push los lunes, Pull los miércoles y Leg los viernes, desde el lunes 31 de
 * agosto. Los saltos de reloj, con `hoy_es`.
 */
import { diasDelPlan } from '../../src/logica/servicios/plan'
import { dejar_planificado, en_texto, planificar } from '../apoyo/ayudas'
import { ZONA, crearCliente, type Entorno } from '../apoyo/cliente'
import { grupo_muscular_id as grupoMuscular, ppl as montarPpl } from '../apoyo/conftest'
import { contar } from '../apoyo/filas'
import {
  DOMINGO_20,
  DOMINGO_27,
  HOY,
  JUEVES_17,
  LUNES_14,
  LUNES_31,
  LUNES_7,
  MARTES_1,
  MARTES_15,
  MIERCOLES_2,
  MIERCOLES_9,
  SABADO_12,
  SABADO_19,
  SABADO_5,
  VIERNES_11,
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

function hoy_es(fecha: string): void {
  entorno.reloj.fijar(fecha)
}

function hecha(fecha: string, rutina_id: number, cubre_fecha?: string | null): number {
  return hechaEn(cliente, grupo_muscular_id, fecha, rutina_id, cubre_fecha)
}

// --- Ayudas -------------------------------------------------------------------

function ocultar(rutina_id: number): void {
  const respuesta = cliente.delete(`/rutinas/${rutina_id}`, { params: { modo: 'ocultar' } })
  expect([respuesta.status_code, respuesta.text]).toEqual([204, respuesta.text])
}

function mostrar(rutina_id: number): any {
  const respuesta = cliente.post(`/rutinas/${rutina_id}/mostrar`)
  expect([respuesta.status_code, respuesta.text]).toEqual([200, respuesta.text])
  return respuesta.json()
}

/**
 * Oculta la rutina el día `desde` y la vuelve a mostrar el día `hasta`, y deja el reloj otra
 * vez en el miércoles 16.
 */
function oculta_entre(rutina_id: number, desde: string, hasta: string): void {
  hoy_es(desde)
  ocultar(rutina_id)
  hoy_es(hasta)
  mostrar(rutina_id)
  hoy_es(HOY)
}

/** Entrenados, planificados y por llegar de septiembre en `GET /resumen`. */
function constancia_de_septiembre(): [number, number, number] {
  const respuesta = cliente.get('/resumen', { params: { mes: '2026-09' } })
  expect([respuesta.status_code, respuesta.text]).toEqual([200, respuesta.text])
  const mes = respuesta.json().constancia.meses[8]
  expect(mes.mes.startsWith('2026-09')).toBe(true)
  return [mes.entrenados, mes.planificados, mes.por_llegar]
}

/** Los tramos `[desde, hasta]` guardados, por fecha de inicio; los de una rutina si se dice. */
function tramos(rutina_id?: number): [string, string][] {
  const filas = entorno.bd.todas<{ desde: string; hasta: string }>(
    'SELECT desde, hasta FROM rutina_periodos_ocultos' +
      (rutina_id === undefined ? '' : ' WHERE rutina_id = ?') +
      ' ORDER BY desde',
    ...(rutina_id === undefined ? [] : [rutina_id]),
  )
  return filas.map((fila) => [fila.desde, fila.hasta])
}

function oculto_desde(rutina_id: number): string | null {
  return cliente.get(`/rutinas/${rutina_id}`).json().oculto_desde
}

/** El estado del día en el seguimiento y si es descanso. */
function estado(fecha: string): [string, boolean] {
  const dia = seguimiento(cliente, fecha)[fecha]
  return [dia.estado, dia.descanso]
}

/**
 * Lo que toca ese día según el plan (`diasDelPlan`, en el que se apoyan recuperar, adelantar
 * e intercambiar): la rutina y si es descanso. Es lo que toca, no lo que pasó.
 */
function del_plan(fecha: string): [string | null, boolean] {
  const [dia] = diasDelPlan(
    { bd: entorno.bd, reloj: entorno.reloj, zona: () => ZONA },
    fecha,
    fecha,
  )
  return [dia.rutina ? dia.rutina.nombre : null, dia.descanso]
}

function por_recuperar(): [string, string][] {
  const respuesta = cliente.get('/plan/hoy')
  expect([respuesta.status_code, respuesta.text]).toEqual([200, respuesta.text])
  return respuesta.json().por_recuperar.map((r: any) => [r.fecha, r.rutina.nombre])
}

function fechas_cambiadas(): string[] {
  return entorno.bd
    .todas<{ fecha: string }>('SELECT fecha FROM excepciones_del_plan ORDER BY fecha')
    .map((fila) => fila.fecha)
}

// --- Lo que guardan ocultar y mostrar ------------------------------------------

test('mostrar_guarda_el_tramo_en_que_estuvo_oculta', () => {
  hoy_es(MIERCOLES_2)
  ocultar(ppl.Push)
  expect(tramos()).toEqual([])
  hoy_es(SABADO_12)

  expect(mostrar(ppl.Push).oculto_desde).toBeNull()

  expect(tramos(ppl.Push)).toEqual([[MIERCOLES_2, SABADO_12]])
})

test('ocultar_y_mostrar_el_mismo_dia_no_guarda_nada', () => {
  // El tramo estaría vacío (el CHECK `hasta > desde` daría un 500), y nada cambia: el lunes
  // 14 sigue sin hacer.
  ocultar(ppl.Push)
  mostrar(ppl.Push)

  expect(tramos()).toEqual([])
  expect(estado(LUNES_14)).toEqual(['sin_hacer', false])
  expect(estado(HOY)).toEqual(['pendiente', false])
})

test('volver_a_ocultar_el_dia_en_que_se_mostro_reabre_el_tramo', () => {
  // Oculta el 1, mostrada el 5 y oculta otra vez el 5: un solo tramo abierto desde el 1
  // («Oculta desde el 1 de septiembre»), sin dejar dos tramos pegados. Mostrarla el 9 guarda
  // `[1, 9)`.
  hoy_es(MARTES_1)
  ocultar(ppl.Push)
  hoy_es(SABADO_5)
  mostrar(ppl.Push)
  expect(tramos()).toEqual([[MARTES_1, SABADO_5]])

  ocultar(ppl.Push)

  expect(oculto_desde(ppl.Push)).toBe(MARTES_1)
  expect(tramos()).toEqual([])
  hoy_es(MIERCOLES_9)
  mostrar(ppl.Push)
  expect(tramos()).toEqual([[MARTES_1, MIERCOLES_9]])
})

test('ocultar_otro_dia_o_una_ya_oculta_y_mostrar_una_visible_no_tocan_los_tramos', () => {
  // El tramo cerrado acaba antes del día en que se vuelve a ocultar: se queda como está, y
  // ocultarla otra vez no mueve el `oculto_desde` que ya tenía.
  oculta_entre(ppl.Push, MARTES_1, SABADO_5)
  hoy_es(MIERCOLES_9)
  ocultar(ppl.Push)
  hoy_es(SABADO_12)

  ocultar(ppl.Push)

  expect(oculto_desde(ppl.Push)).toBe(MIERCOLES_9)
  expect(tramos()).toEqual([[MARTES_1, SABADO_5]])
  // Pull no está oculta: mostrarla no guarda nada.
  mostrar(ppl.Pull)
  expect(tramos(ppl.Pull)).toEqual([])
})

test('mostrar_con_el_reloj_hacia_atras_no_guarda_nada_ni_da_500', () => {
  // Oculta el 16 y mostrada con el reloj en el 14: `[16, 14)` no es un tramo.
  ocultar(ppl.Push)
  hoy_es(LUNES_14)

  expect(mostrar(ppl.Push).oculto_desde).toBeNull()

  expect(tramos()).toEqual([])
})

test('ocultar_con_el_reloj_hacia_atras_reabre_el_tramo_que_acaba_despues', () => {
  // Un tramo `[1, 9)` y el reloj vuelve al 5: ocultar reabre ese tramo desde el 1 en vez de
  // dejar un tramo y un `oculto_desde` solapados.
  oculta_entre(ppl.Push, MARTES_1, MIERCOLES_9)
  hoy_es(SABADO_5)

  ocultar(ppl.Push)

  expect(oculto_desde(ppl.Push)).toBe(MARTES_1)
  expect(tramos()).toEqual([])
})

test('ocultar_una_rutina_no_reabre_el_tramo_que_otra_cerro_hoy', () => {
  // Pull se mostró hoy (tramo `[2, 16)`). Ocultar Push hoy solo reabre los tramos de Push: si
  // mirara los de cualquier rutina, se llevaría el de Pull y Push quedaría oculta desde el 2.
  oculta_entre(ppl.Pull, MIERCOLES_2, HOY)

  ocultar(ppl.Push)

  expect(oculto_desde(ppl.Push)).toBe(HOY)
  expect(oculto_desde(ppl.Pull)).toBeNull()
  expect(tramos(ppl.Pull)).toEqual([[MIERCOLES_2, HOY]])
})

// --- Los días del tramo en el plan -------------------------------------------

test('los_dias_en_que_estuvo_oculta_siguen_siendo_descanso_tras_mostrarla', () => {
  // Regresión del punto G1 del repaso: Push oculta del miércoles 2 al sábado 12. Antes, al
  // mostrarla se borraba `oculto_desde` sin guardar nada, y el lunes 7 volvía a ser un día
  // «sin hacer» que además se ofrecía para recuperar.
  hoy_es(MIERCOLES_2)
  ocultar(ppl.Push)
  hoy_es(SABADO_12)
  mostrar(ppl.Push)

  const lunes = seguimiento(cliente, LUNES_7)[LUNES_7]
  // La rutina sigue saliendo ese día (en gris), pero no se entrena.
  expect([lunes.estado, lunes.descanso, lunes.rutina.nombre]).toEqual(['descanso', true, 'Push'])
  // Del lunes 7 aún se estaría en plazo; del miércoles 9 y el viernes 11, también.
  expect(por_recuperar()).toEqual([
    ['2026-09-09', 'Pull'],
    ['2026-09-11', 'Leg'],
  ])
})

test('antes_del_tramo_y_desde_que_se_muestra_todo_sigue_igual', () => {
  // Oculta del lunes 7 al lunes 14: el lunes 31, antes, sigue sin hacer; el 7, el día en que
  // se ocultó, es descanso porque nada lo cuenta; el 14, el día en que se volvió a mostrar, ya
  // no es del tramo.
  oculta_entre(ppl.Push, LUNES_7, LUNES_14)

  expect(estado(LUNES_31)).toEqual(['sin_hacer', false])
  expect(estado(LUNES_7)).toEqual(['descanso', true])
  expect(estado(LUNES_14)).toEqual(['sin_hacer', false])
})

test('el_primer_y_el_ultimo_dia_del_tramo_son_descanso_pedidos_solos', () => {
  // Pedido un solo día, sin el margen del seguimiento: un tramo de un día (oculta el lunes 31,
  // mostrada el martes 1) cuenta ese lunes, que es a la vez su primer y su último día; el de
  // `[7, 14)` cuenta el 7 y no el 14. Es lo que usan recuperar, adelantar e intercambiar.
  oculta_entre(ppl.Push, LUNES_31, MARTES_1)
  oculta_entre(ppl.Push, LUNES_7, LUNES_14)

  expect(del_plan(LUNES_31)).toEqual(['Push', true])
  expect(del_plan(LUNES_7)).toEqual(['Push', true])
  expect(del_plan(LUNES_14)).toEqual(['Push', false])
})

test('el_tramo_de_una_rutina_no_toca_los_dias_de_las_demas', () => {
  // Pull oculta del lunes 7 al lunes 14: su miércoles 9 es descanso, pero el lunes 7 (Push) y
  // el viernes 11 (Leg) siguen sin hacer.
  oculta_entre(ppl.Pull, LUNES_7, LUNES_14)

  const dias = seguimiento(cliente, LUNES_7, VIERNES_11)

  expect([LUNES_7, MIERCOLES_9, VIERNES_11].map((d) => [dias[d].estado, dias[d].descanso])).toEqual(
    [
      ['sin_hacer', false],
      ['descanso', true],
      ['sin_hacer', false],
    ],
  )
  expect(del_plan(LUNES_7)).toEqual(['Push', false])
})

test('un_dia_puesto_a_mano_con_la_rutina_es_descanso_si_cae_en_el_tramo', () => {
  // El sábado 12 se planificó Push a mano antes de ocultarla (oculta del 7 al 14): también
  // ese día es descanso y no se ofrece para recuperar; el lunes 14, que ya no es del tramo, sí.
  hoy_es(MIERCOLES_2)
  dejar_planificado(cliente, SABADO_12, ppl.Push)
  oculta_entre(ppl.Push, LUNES_7, LUNES_14)

  const sabado = seguimiento(cliente, SABADO_12)[SABADO_12]

  expect([sabado.origen, sabado.estado, sabado.descanso]).toEqual(['excepcion', 'descanso', true])
  expect(por_recuperar()).not.toContainEqual(['2026-09-12', 'Push'])
  expect(por_recuperar()).toContainEqual(['2026-09-14', 'Push'])
})

test('entre_dos_tramos_los_dias_son_normales', () => {
  oculta_entre(ppl.Push, LUNES_31, MIERCOLES_2)
  oculta_entre(ppl.Push, LUNES_14, HOY)
  expect(tramos()).toEqual([
    [LUNES_31, MIERCOLES_2],
    [LUNES_14, HOY],
  ])

  expect(estado(LUNES_31)).toEqual(['descanso', true])
  expect(estado(LUNES_7)).toEqual(['sin_hacer', false])
  expect(estado(LUNES_14)).toEqual(['descanso', true])
})

test('no_se_recupera_un_dia_en_que_la_rutina_estuvo_oculta', () => {
  oculta_entre(ppl.Push, LUNES_14, MARTES_15)

  const respuesta = sesion(cliente, HOY, ppl.Push, LUNES_14)

  expect([respuesta.status_code, respuesta.text]).toEqual([422, respuesta.text])
  expect(respuesta.json().detail).toBe(`El ${en_texto(LUNES_14)} no toca esa rutina.`)
  expect(contar(entorno.bd, 'entrenamientos')).toBe(0)
})

test('la_constancia_no_cuenta_los_dias_del_tramo', () => {
  // Septiembre, con Push oculta del 7 al 14: el lunes 7 no está entre los planificados (sin el
  // tramo serían seis: lunes 7 y 14, miércoles 2 y 9, viernes 4 y 11). Por llegar: hoy, 18, 21,
  // 23, 25, 28 y 30.
  oculta_entre(ppl.Push, LUNES_7, LUNES_14)

  expect(constancia_de_septiembre()).toEqual([0, 5, 7])
})

test('borrar_la_rutina_en_definitivo_se_lleva_sus_tramos', () => {
  oculta_entre(ppl.Push, LUNES_7, LUNES_14)
  oculta_entre(ppl.Pull, MIERCOLES_2, MIERCOLES_9)

  const respuesta = cliente.delete(`/rutinas/${ppl.Push}`, { params: { modo: 'definitivo' } })

  expect([respuesta.status_code, respuesta.text]).toEqual([204, respuesta.text])
  expect(tramos()).toEqual([[MIERCOLES_2, MIERCOLES_9]])
})

// --- Lo que ya contaba sigue contando ----------------------------------------

test('lo_entrenado_el_dia_en_que_se_oculta_sigue_hecho', () => {
  // Push se entrena el lunes 14 y se oculta ese mismo día. Antes, el lunes pasaba a descanso
  // (y la sesión dejaba de contar): ocultar deshacía lo ya hecho. Ahora sigue hecho mientras
  // está oculta y después de mostrarla; el plan sigue diciendo lo que toca (descanso), no lo
  // que pasó.
  hoy_es(LUNES_14)
  const entrenada = hecha(LUNES_14, ppl.Push, LUNES_14)
  ocultar(ppl.Push)

  const oculta = seguimiento(cliente, LUNES_14)[LUNES_14]
  hoy_es(MARTES_15)
  mostrar(ppl.Push)
  hoy_es(HOY)
  const mostrada = seguimiento(cliente, LUNES_14)[LUNES_14]

  for (const dia of [oculta, mostrada]) {
    expect([dia.estado, dia.descanso]).toEqual(['hecho', false])
    expect(dia.cubierto_por).toEqual({ entrenamiento_id: entrenada, fecha: LUNES_14 })
  }
  expect(del_plan(LUNES_14)).toEqual(['Push', true])
})

test('la_pantalla_de_hoy_da_por_hecho_lo_entrenado_antes_de_ocultar', () => {
  hoy_es(LUNES_14)
  const entrenada = hecha(LUNES_14, ppl.Push, LUNES_14)
  expect(cliente.post(`/entrenamientos/${entrenada}/terminar`).status_code).toBe(200)
  ocultar(ppl.Push)

  expect(cliente.get('/plan/hoy').json().situacion).toBe('hecho')
  hoy_es(MARTES_15)
  expect(por_recuperar()).not.toContainEqual(['2026-09-14', 'Push'])
})

test('la_constancia_cuenta_lo_entrenado_antes_de_ocultar', () => {
  // Septiembre: el lunes 14, hecho, es entrenado y planificado; con el lunes 7, los miércoles
  // 2 y 9 y los viernes 4 y 11, sin hacer, son seis.
  hoy_es(LUNES_14)
  hecha(LUNES_14, ppl.Push, LUNES_14)
  ocultar(ppl.Push)
  hoy_es(MARTES_15)
  mostrar(ppl.Push)
  hoy_es(HOY)

  const [entrenados, planificados] = constancia_de_septiembre()

  expect([entrenados, planificados]).toEqual([1, 6])
})

test('una_sesion_cancelada_no_salva_el_dia_en_que_se_oculta', () => {
  // Sin series y ya fuera de su día, está cancelada: no cuenta, y el lunes 14 es descanso
  // como cualquier día de la rutina oculta.
  hoy_es(LUNES_14)
  expect(sesion(cliente, LUNES_14, ppl.Push, LUNES_14).status_code).toBe(201)
  ocultar(ppl.Push)
  hoy_es(MARTES_15)

  const dia = seguimiento(cliente, LUNES_14)[LUNES_14]

  expect([dia.estado, dia.descanso, dia.cubierto_por]).toEqual(['descanso', true, null])
})

test('lo_adelantado_antes_de_ocultar_sigue_contando_y_el_resto_del_tramo_no', () => {
  // El Leg del viernes 18 se hizo el martes 15; Leg se oculta el 16 y se vuelve a mostrar el
  // 27. El viernes 18 sigue movido (oculta y mostrada); el viernes 25, del tramo y sin sesión,
  // es descanso.
  const adelantada = hecha(MARTES_15, ppl.Leg, VIERNES_18)
  ocultar(ppl.Leg)
  expect(estado(VIERNES_18)).toEqual(['movido', false])

  hoy_es(DOMINGO_27)
  mostrar(ppl.Leg)
  const dias = seguimiento(cliente, VIERNES_18, VIERNES_25)

  expect([dias[VIERNES_18].estado, dias[VIERNES_18].descanso]).toEqual(['movido', false])
  expect(dias[VIERNES_18].cubierto_por.entrenamiento_id).toBe(adelantada)
  expect([dias[VIERNES_25].estado, dias[VIERNES_25].descanso]).toEqual(['descanso', true])
  expect(del_plan(VIERNES_18)).toEqual(['Leg', true])
})

test('replanificar_no_lleva_lo_adelantado_a_un_dia_de_la_rutina_oculta', () => {
  // Caso raro aceptado por el autor: el Leg del viernes se hizo el martes, el sábado también
  // toca Leg, y Leg se oculta. Dejar el viernes en descanso pediría llevar la sesión al
  // sábado, pero ese día Leg está oculta: 409 y nada cambia. El mensaje dice que es por estar
  // oculta y pide mostrarla, no «deja algún día con esa rutina», que no se puede mientras lo
  // esté.
  const adelantada = hecha(MARTES_15, ppl.Leg, VIERNES_18)
  expect(planificar(cliente, SABADO_19, ppl.Leg).status_code).toBe(200)
  ocultar(ppl.Leg)

  const respuesta = planificar(cliente, VIERNES_18, null)

  expect([respuesta.status_code, respuesta.text]).toEqual([409, respuesta.text])
  expect(respuesta.json().detail).toEqual(
    sin_dia_para_ella(MARTES_15, VIERNES_18, 'Leg', adelantada, true),
  )
  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
  expect(fechas_cambiadas()).toEqual([SABADO_19])
})

test('tras_mostrar_la_rutina_replanificar_lleva_lo_adelantado_al_otro_dia', () => {
  // Lo que pide el mensaje de oculta: mostrada Leg, la misma petición vale y la sesión del
  // martes pasa a contar el sábado.
  const adelantada = hecha(MARTES_15, ppl.Leg, VIERNES_18)
  expect(planificar(cliente, SABADO_19, ppl.Leg).status_code).toBe(200)
  ocultar(ppl.Leg)
  expect(planificar(cliente, VIERNES_18, null).status_code).toBe(409)

  mostrar(ppl.Leg)
  const respuesta = planificar(cliente, VIERNES_18, null)

  expect([respuesta.status_code, respuesta.text]).toEqual([200, respuesta.text])
  expect(cubre(cliente, adelantada)).toBe(SABADO_19)
})

function restablecer_la_semana() {
  return cliente.delete('/plan/excepciones', { params: { desde: HOY, hasta: DOMINGO_20 } })
}

test('restablecer_la_semana_con_la_rutina_oculta_da_409_de_oculta_y_no_cambia_nada', () => {
  // El jueves se cambió a Leg y se adelantó el martes; Leg se oculta. Restablecer la semana
  // deja el jueves sin Leg, y el viernes, su día del programa, es descanso mientras esté
  // oculta: 409 con el texto de oculta, y ni la sesión ni el plan cambian.
  expect(planificar(cliente, JUEVES_17, ppl.Leg).status_code).toBe(200)
  const adelantada = hecha(MARTES_15, ppl.Leg, JUEVES_17)
  ocultar(ppl.Leg)

  const respuesta = restablecer_la_semana()

  expect([respuesta.status_code, respuesta.text]).toEqual([409, respuesta.text])
  expect(respuesta.json().detail).toEqual(
    sin_dia_para_ella(MARTES_15, JUEVES_17, 'Leg', adelantada, true),
  )
  expect(cubre(cliente, adelantada)).toBe(JUEVES_17)
  expect(fechas_cambiadas()).toEqual([JUEVES_17])
})

test('tras_mostrar_la_rutina_restablecer_la_semana_lleva_lo_adelantado_a_su_dia', () => {
  expect(planificar(cliente, JUEVES_17, ppl.Leg).status_code).toBe(200)
  const adelantada = hecha(MARTES_15, ppl.Leg, JUEVES_17)
  ocultar(ppl.Leg)
  expect(restablecer_la_semana().status_code).toBe(409)

  mostrar(ppl.Leg)
  const respuesta = restablecer_la_semana()

  expect([respuesta.status_code, respuesta.text]).toEqual([204, respuesta.text])
  expect(cubre(cliente, adelantada)).toBe(VIERNES_18)
  expect(fechas_cambiadas()).toEqual([])
})
