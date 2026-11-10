/**
 * Tests de qué día del plan cuenta cada sesión (`cubre_fecha`). Puerto de
 * `backend/tests/test_cubre_fecha.py`.
 *
 * Lo decide el botón que se pulsa: *Empezar* cuenta hoy, *Recuperar* un día pasado y
 * *Adelantar* uno de esta semana. Al crear la sesión se comprueba que ese día toque esa
 * rutina, que esté en plazo y que no lo cuente ya otra sesión. Al corregir su fecha, el día
 * que cuenta no cambia, así que solo se mueve dentro de su plazo.
 *
 * Todos parten de la semana de `apoyo/semana.ts`, con el reloj congelado para que el día de
 * la semana no dependa de cuándo se ejecuten.
 */
import {
  bajo_la_fecha,
  crear_programa,
  en_texto,
  esperar_estado,
  fuera_de_plazo,
  solo_puede_ir,
  todavia_no_ha_llegado,
} from '../apoyo/ayudas'
import { type ClienteDeTest as Cliente, crearCliente } from '../apoyo/cliente'
import { grupo_muscular_id, ppl } from '../apoyo/conftest'
import {
  DOMINGO_13,
  DOMINGO_20,
  HOY,
  JUEVES_17,
  LUNES_14,
  LUNES_21,
  LUNES_7,
  MARTES_15,
  MIERCOLES_23,
  VIERNES_18,
  con_una_serie,
  sesion,
} from '../apoyo/semana'

/** La semana de siempre: el cliente, el reloj, la base y las tres rutinas. */
function semana() {
  const entorno = crearCliente()
  const rutinas = ppl(entorno.cliente, entorno.reloj)
  return { ...entorno, ppl: rutinas }
}

// --- Empezar, recuperar y adelantar --------------------------------------

test('empezar_lo_que_toca_hoy_cuenta_hoy', () => {
  const { cliente, ppl } = semana()

  const respuesta = sesion(cliente, HOY, ppl.Pull, HOY)

  esperar_estado(respuesta, 201)
  expect(respuesta.json().cubre_fecha).toBe(HOY)
})

test('sin_cubre_fecha_la_sesion_no_cuenta_para_ningun_dia', () => {
  // Es entrenar una rutina «sin contar»: la sesión se guarda igual.
  const { cliente, ppl } = semana()

  const respuesta = sesion(cliente, HOY, ppl.Pull)

  expect(respuesta.status_code).toBe(201)
  expect(respuesta.json().cubre_fecha).toBeNull()
})

test('lo_del_lunes_se_recupera_hasta_el_domingo', () => {
  const { cliente, ppl } = semana()

  expect(sesion(cliente, DOMINGO_13, ppl.Push, LUNES_7).status_code).toBe(201)
})

test('el_lunes_siguiente_ya_no_se_recupera_lo_del_lunes_anterior', () => {
  const { cliente, ppl } = semana()

  const respuesta = sesion(cliente, LUNES_14, ppl.Push, LUNES_7)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(fuera_de_plazo(LUNES_7, LUNES_7, DOMINGO_13))
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

test('se_adelanta_desde_el_lunes_de_la_misma_semana', () => {
  // El lunes 14 ya es pasado: la hoja de registrar un día pasado no ofrece adelantar, pero
  // el POST se sigue aceptando. El backend valida que los datos sean coherentes, no qué
  // botones enseña cada pantalla, y una sesión pasada que cuenta un día posterior se
  // produce por otros caminos (un adelanto de hoy es mañana una sesión pasada; un PUT que
  // la mueve atrás; el importador).
  const { cliente, ppl } = semana()

  expect(sesion(cliente, LUNES_14, ppl.Leg, VIERNES_18).status_code).toBe(201)
})

test('no_se_adelanta_lo_de_la_semana_siguiente', () => {
  const { cliente, ppl } = semana()

  const respuesta = sesion(cliente, HOY, ppl.Push, LUNES_21)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(fuera_de_plazo('2026-09-21', '2026-09-21', '2026-09-27'))
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

test('lo_del_ultimo_dia_que_existe_da_422_por_el_plazo', () => {
  // Antes daba 500: el plazo acababa seis días después del 9999-12-31, una fecha que no
  // existe (`OverflowError` en `plazo()`). Su plazo acaba en ese mismo día.
  const { cliente, ppl } = semana()

  const respuesta = sesion(cliente, HOY, ppl.Push, '9999-12-31')

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toBe(fuera_de_plazo('9999-12-31', '9999-12-27', '9999-12-31'))
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

test('un_dia_cambiado_a_mano_se_adelanta_con_su_rutina_nueva', () => {
  // Las excepciones de Planificar cuentan como días planificados.
  const { cliente, ppl } = semana()
  const respuesta = cliente.put(`/plan/excepciones/${JUEVES_17}`, { json: { rutina_id: ppl.Push } })
  esperar_estado(respuesta, 200)

  expect(sesion(cliente, HOY, ppl.Push, JUEVES_17).status_code).toBe(201)
})

// --- Días que no se pueden contar ----------------------------------------

test.each([
  ['Push', MARTES_15], // descanso
  ['Pull', LUNES_14], // toca otra rutina
  ['Push', '2026-08-30'], // sin programa
])('un_dia_que_no_toca_esa_rutina_no_se_cuenta (%s, %s)', (rutina, dia) => {
  const { cliente, ppl } = semana()

  const respuesta = sesion(cliente, dia, ppl[rutina], dia)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(`El ${en_texto(dia)} no toca esa rutina.`)
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

test('lo_que_tocaba_con_el_programa_anterior_no_se_recupera', () => {
  // Se activa hoy otro programa con el mismo Push los lunes: el del lunes 14 lo planificaba
  // el anterior, y lo faltado con él ya no se ofrece.
  const { cliente, ppl } = semana()
  activar_otro_programa(cliente, ppl)

  const respuesta = sesion(cliente, HOY, ppl.Push, LUNES_14)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(
    'El lunes 14 de septiembre lo planificaba otro programa, y lo que tocaba con un' +
      ' programa que ya no está activo no se recupera.',
  )
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

test('una_fecha_futura_se_rechaza_antes_que_el_dia_que_cuenta', () => {
  const { cliente, ppl } = semana()

  const respuesta = sesion(cliente, JUEVES_17, ppl.Pull, MARTES_15)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(todavia_no_ha_llegado(JUEVES_17))
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

test('un_dia_que_no_se_puede_contar_da_422_aunque_la_fecha_este_ocupada', () => {
  // El error de la petición va antes que el choque con otra sesión.
  const { cliente, ppl } = semana()
  const ocupada = sesion(cliente, MARTES_15, ppl.Push).json().id
  con_una_serie(cliente, grupo_muscular_id(cliente), ocupada)

  const respuesta = sesion(cliente, MARTES_15, ppl.Push, MARTES_15)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    422,
    'El martes 15 de septiembre no toca esa rutina.',
  ])
  expect(cliente.get(`/entrenamientos/${ocupada}`).json().series).not.toEqual([])
})

test('una_peticion_mal_hecha_no_borra_la_cancelada_que_ocupaba_la_fecha', () => {
  // El POST valida en dos fases para que una petición que no vale nunca borre nada: los 422
  // van antes de mirar la fecha, que es lo que borra una cancelada. El martes es descanso,
  // así que no se puede contar. (Que el error deshaga la transacción también la salvaría:
  // este test solo cae si fallan las dos cosas.)
  const { cliente, ppl } = semana()
  const cancelada = sesion(cliente, MARTES_15, ppl.Push).json().id

  const respuesta = sesion(cliente, MARTES_15, ppl.Push, MARTES_15)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    422,
    'El martes 15 de septiembre no toca esa rutina.',
  ])
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(200)
})

test('un_409_por_el_dia_que_cuenta_no_borra_la_cancelada_que_ocupaba_la_fecha', () => {
  // Aquí el orden no basta: la fecha ocupada por una cancelada se mira (y la cancelada se
  // borra) antes de saber que el día ya lo cuenta otra sesión. Lo que la salva es que el
  // 409 deshace la transacción entera.
  const { cliente, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  con_una_serie(cliente, grupo_muscular_id(cliente), recuperada)
  // La del propio lunes, vacía y de un día pasado: cancelada.
  const cancelada = sesion(cliente, LUNES_14, ppl.Push).json().id

  const respuesta = sesion(cliente, LUNES_14, ppl.Push, LUNES_14)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(ya_hecho(LUNES_14, MARTES_15, recuperada))
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(200)
})

// --- Un día lo cuenta una sesión como mucho ------------------------------

/** El 409 de un día que ya cuenta otra sesión: dice cuál, para poder abrirla. */
function ya_hecho(cubre: string, fecha_de_la_otra: string, otra_id: number) {
  return {
    mensaje: `Lo del ${en_texto(cubre)} ya está hecho. Lo cuenta la sesión del ${en_texto(fecha_de_la_otra)}.`,
    entrenamiento_id: otra_id,
  }
}

test('un_dia_ya_recuperado_no_se_recupera_otra_vez', () => {
  const { cliente, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  con_una_serie(cliente, grupo_muscular_id(cliente), recuperada)

  const respuesta = sesion(cliente, HOY, ppl.Push, LUNES_14)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(ya_hecho(LUNES_14, MARTES_15, recuperada))
  expect(
    cliente
      .get('/entrenamientos')
      .json()
      .map((s: any) => s.id),
  ).toEqual([recuperada])
})

test('la_sesion_en_curso_cuenta_su_dia_aunque_este_vacia', () => {
  // Se acaba de empezar: no está cancelada.
  const { cliente, ppl } = semana()
  const en_curso = sesion(cliente, HOY, ppl.Push, LUNES_14).json()
  expect(en_curso.en_curso).toBe(true)

  const respuesta = sesion(cliente, MARTES_15, ppl.Push, LUNES_14)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(ya_hecho(LUNES_14, HOY, en_curso.id))
})

test('una_sesion_cancelada_suelta_su_dia_y_se_borra', () => {
  // Sin series y ya fuera de curso: no se hizo nada, así que lo del lunes sigue sin hacer y
  // se puede recuperar. La cancelada desaparece.
  const { cliente, ppl } = semana()
  const cancelada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id

  const respuesta = sesion(cliente, HOY, ppl.Push, LUNES_14)

  esperar_estado(respuesta, 201)
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(404)
})

test('una_sesion_de_otra_rutina_suelta_el_dia_pero_se_queda_en_el_historial', () => {
  // Una sesión que retiene un día cuyo plan ya es otra rutina no lo cuenta. Se monta
  // directamente en la base: con la API, el plan de un día pasado ya no cambia.
  const { cliente, ppl, bd } = semana()
  const antigua = sesion(cliente, MARTES_15, ppl.Leg).json().id
  con_una_serie(cliente, grupo_muscular_id(cliente), antigua)
  bd.ejecutar('UPDATE entrenamientos SET cubre_fecha = ? WHERE id = ?', LUNES_14, antigua)

  const respuesta = sesion(cliente, HOY, ppl.Push, LUNES_14)

  esperar_estado(respuesta, 201)
  const leida = cliente.get(`/entrenamientos/${antigua}`).json()
  expect(leida.cubre_fecha).toBeNull()
  expect(leida.series).toHaveLength(1)
})

// --- Corregir la fecha (PUT) ---------------------------------------------
//
// La sesión sigue contando el mismo día aunque cambie su fecha, así que solo se mueve dentro
// del plazo de ese día. Estos tests pasan una semana, al miércoles 23, para tener días
// pasados a los dos lados del plazo.

/**
 * PUT /entrenamientos/{id} sin `series`: solo la fecha y las notas. La rutina y el día que
 * cuenta no se corrigen: se fijan al crear la sesión.
 */
function corregir(
  cliente: Cliente,
  entrenamiento_id: number,
  fecha: string,
  notas: string | null = null,
) {
  return cliente.put(`/entrenamientos/${entrenamiento_id}`, { json: { fecha, notas } })
}

test('una_sesion_recuperada_se_mueve_hasta_el_ultimo_dia_de_su_plazo', () => {
  const { cliente, reloj, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  reloj.fijar(MIERCOLES_23)

  const respuesta = corregir(cliente, recuperada, DOMINGO_20)

  esperar_estado(respuesta, 200)
  expect(respuesta.json().fecha).toBe(DOMINGO_20)
  expect(respuesta.json().cubre_fecha).toBe(LUNES_14)
})

test('no_se_mueve_mas_alla_del_plazo_de_su_dia', () => {
  const { cliente, reloj, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  reloj.fijar(MIERCOLES_23)

  const respuesta = corregir(cliente, recuperada, LUNES_21)

  expect(respuesta.status_code).toBe(422)
  // El texto dice hasta dónde se puede mover, con las palabras de la app y literal: el móvil
  // copia los textos de estos tests.
  expect(respuesta.json().detail).toEqual({
    mensaje:
      'Este Push cuenta como el del lunes 14 de septiembre, así que solo puede ir' +
      ' hasta el domingo 20 de septiembre.',
    campo: 'fecha',
  })
  expect(fecha_guardada(cliente, recuperada)).toBe(MARTES_15)
})

test('una_sesion_adelantada_se_mueve_hasta_el_lunes_de_su_semana', () => {
  const { cliente, reloj, ppl } = semana()
  const adelantada = sesion(cliente, HOY, ppl.Leg, VIERNES_18).json().id
  reloj.fijar(MIERCOLES_23)

  expect(corregir(cliente, adelantada, LUNES_14).status_code).toBe(200)
  const al_domingo = corregir(cliente, adelantada, DOMINGO_13)
  expect(al_domingo.status_code).toBe(422)
  expect(al_domingo.json().detail).toEqual(
    bajo_la_fecha(solo_puede_ir('Leg', VIERNES_18, 'desde', LUNES_14)),
  )
  expect(fecha_guardada(cliente, adelantada)).toBe(LUNES_14)
})

test('una_fecha_futura_se_rechaza_antes_que_el_plazo', () => {
  // El 17 está dentro del plazo del lunes 14, pero todavía no ha llegado.
  const { cliente, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id

  const respuesta = corregir(cliente, recuperada, JUEVES_17)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual(bajo_la_fecha(todavia_no_ha_llegado(JUEVES_17)))
  expect(fecha_guardada(cliente, recuperada)).toBe(MARTES_15)
})

test('corregir_solo_las_notas_no_mira_el_plazo', () => {
  // Aunque hoy ya no se pudiera recuperar lo del lunes, la sesión sigue en su fecha, que es
  // la que tenía.
  const { cliente, reloj, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  reloj.fijar('2026-10-15')

  const respuesta = corregir(cliente, recuperada, MARTES_15, 'Hombro cargado')

  esperar_estado(respuesta, 200)
  expect(respuesta.json().notas).toBe('Hombro cargado')
})

// --- Corregir la fecha entre programas (PUT) -----------------------------
//
// Como al crearla, la fecha de la sesión y el día que cuenta tienen que caer en el mismo
// programa. En estos tests el programa viejo (`ppl`) llega hasta el martes 15 y desde hoy,
// miércoles 16, manda otro.

const AVISO_OTRO_PROGRAMA = bajo_la_fecha(
  'Este Push cuenta como el del lunes 14 de septiembre, y el miércoles 16 de septiembre no' +
    ' seguías el mismo programa que ese día. Solo se puede mover a un día en que lo siguieras.',
)

/**
 * Activa hoy un programa nuevo con el mismo Push los lunes: lo anterior al 16 queda en el
 * programa viejo y lo posterior, en este.
 */
function activar_otro_programa(cliente: Cliente, ppl: Record<string, number>): void {
  crear_programa(cliente, { nombre: 'Otro', dias: [[1, ppl.Push]], activar: true })
}

function fecha_guardada(cliente: Cliente, entrenamiento_id: number): string {
  return cliente.get(`/entrenamientos/${entrenamiento_id}`).json().fecha
}

test('no_se_mueve_a_un_dia_de_otro_programa_el_dia_que_se_recuperaba', () => {
  // Sin esta comprobación, el PUT dejaba mover a hoy (programa nuevo) una sesión que cuenta
  // el lunes del programa viejo, algo que el POST rechaza.
  const { cliente, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  activar_otro_programa(cliente, ppl)

  const respuesta = corregir(cliente, recuperada, HOY)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual(AVISO_OTRO_PROGRAMA)
  expect(fecha_guardada(cliente, recuperada)).toBe(MARTES_15)
})

test('se_mueve_dentro_del_mismo_programa_aunque_haya_otro_activo', () => {
  const { cliente, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  activar_otro_programa(cliente, ppl)

  const respuesta = corregir(cliente, recuperada, LUNES_14)

  esperar_estado(respuesta, 200)
  expect(respuesta.json().fecha).toBe(LUNES_14)
})

test('una_sesion_sin_dia_que_contar_se_mueve_de_un_programa_a_otro', () => {
  const { cliente, ppl } = semana()
  const suelta = sesion(cliente, MARTES_15, ppl.Push).json().id
  activar_otro_programa(cliente, ppl)

  const respuesta = corregir(cliente, suelta, HOY)

  esperar_estado(respuesta, 200)
  expect(respuesta.json().fecha).toBe(HOY)
})

test('no_se_mueve_a_un_dia_sin_programa_lo_que_contaba_el_programa_desactivado', () => {
  const { cliente, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  const programa = cliente.get('/programas').json()[0].id
  expect(cliente.post(`/programas/${programa}/desactivar`).status_code).toBe(200)

  const respuesta = corregir(cliente, recuperada, HOY)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual(AVISO_OTRO_PROGRAMA)
  expect(fecha_guardada(cliente, recuperada)).toBe(MARTES_15)
})

test('una_sesion_que_ya_cruzaba_programas_se_sigue_pudiendo_mover', () => {
  // Un adelanto del viernes 18 apuntado el martes 15, y después se activa otro programa: la
  // fecha (15) es del viejo y el día que cuenta (18), del nuevo. Moverla entre dos días del
  // viejo dentro del plazo no empeora nada, así que se permite.
  const { cliente, ppl } = semana()
  const adelantada = sesion(cliente, MARTES_15, ppl.Leg, VIERNES_18).json().id
  activar_otro_programa(cliente, ppl)

  const respuesta = corregir(cliente, adelantada, LUNES_14)

  esperar_estado(respuesta, 200)
  expect(respuesta.json().fecha).toBe(LUNES_14)
  expect(respuesta.json().cubre_fecha).toBe(VIERNES_18)
})

test('fuera_de_plazo_y_de_otro_programa_el_aviso_es_el_del_plazo', () => {
  const { cliente, reloj, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  activar_otro_programa(cliente, ppl)
  reloj.fijar(MIERCOLES_23)

  const respuesta = corregir(cliente, recuperada, LUNES_21)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual(
    bajo_la_fecha(solo_puede_ir('Push', LUNES_14, 'hasta', DOMINGO_20)),
  )
  expect(fecha_guardada(cliente, recuperada)).toBe(MARTES_15)
})

test('de_otro_programa_y_con_el_dia_ocupado_es_422_y_no_toca_la_otra_sesion', () => {
  // El programa se mira antes que el día libre: un 409 invitaría a hacer sitio en un día al
  // que la sesión no puede ir de todas formas.
  const { cliente, ppl } = semana()
  const recuperada = sesion(cliente, MARTES_15, ppl.Push, LUNES_14).json().id
  activar_otro_programa(cliente, ppl)
  const ocupante = sesion(cliente, HOY, ppl.Pull).json().id

  const respuesta = corregir(cliente, recuperada, HOY)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual(AVISO_OTRO_PROGRAMA)
  expect(fecha_guardada(cliente, recuperada)).toBe(MARTES_15)
  const ocupante_ahora = cliente.get(`/entrenamientos/${ocupante}`).json()
  expect(ocupante_ahora.fecha).toBe(HOY)
  expect(ocupante_ahora.rutina_id).toBe(ppl.Pull)
})
