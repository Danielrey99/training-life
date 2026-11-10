/**
 * El estado de cada día del plan: `GET /plan/seguimiento`. Puerto de
 * `backend/tests/test_seguimiento.py`.
 *
 * Cada día dice qué tocaba y qué pasó: hecho, movido a otro día, sin hacer, pendiente (hoy)
 * o próximo, qué sesión lo cuenta y qué se hizo ese día. De ahí salen las marcas del
 * calendario, también las combinadas.
 *
 * Todos parten de la semana de `apoyo/semana.ts`: hoy es el miércoles 16 de septiembre de
 * 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
 *
 * No se porta `siempre_hace_las_mismas_consultas`: cuenta consultas de SQLAlchemy (apuntado
 * en `no_aplica.ts`).
 */
import { sumarDias } from '../../src/logica/reglas/dias'
import { rango_invertido } from '../apoyo/ayudas'
import { AHORA } from '../apoyo/baseNueva'
import { crearCliente, type Entorno } from '../apoyo/cliente'
import { grupo_muscular_id as grupoMuscular, ppl as montarPpl } from '../apoyo/conftest'
import { insertar } from '../apoyo/filas'
import {
  HOY,
  JUEVES_10,
  LUNES_14,
  LUNES_7,
  MARTES_15,
  MARTES_8,
  MIERCOLES_9,
  VIERNES_11,
  VIERNES_18,
  hecha as hechaEn,
  seguimiento,
  sesion,
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

// --- Los estados ---------------------------------------------------------

test('cada_dia_tiene_el_estado_de_lo_que_tocaba', () => {
  hecha(LUNES_7, ppl.Push, LUNES_7)
  const recuperada = hecha(JUEVES_10, ppl.Pull, MIERCOLES_9)

  const dias = seguimiento(cliente, LUNES_7, VIERNES_18)

  const estados = Object.fromEntries(
    Object.entries(dias)
      .filter(([, dia]) => !dia.descanso)
      .map(([fecha, dia]) => [fecha, dia.estado]),
  )
  expect(estados).toEqual({
    [LUNES_7]: 'hecho',
    [MIERCOLES_9]: 'movido',
    [VIERNES_11]: 'sin_hacer',
    [LUNES_14]: 'sin_hacer',
    [HOY]: 'pendiente',
    [VIERNES_18]: 'proximo',
  })
  expect(dias[MARTES_8].estado).toBe('descanso')
  expect(dias[MIERCOLES_9].cubierto_por).toEqual({
    entrenamiento_id: recuperada,
    fecha: JUEVES_10,
  })
  // El jueves no tocaba nada, pero ese día se entrenó: lo dice `sesion`.
  expect(dias[JUEVES_10].estado).toBe('descanso')
  expect(dias[JUEVES_10].sesion.cubre_fecha).toBe(MIERCOLES_9)
  expect(dias[JUEVES_10].sesion.cuenta).toBe(true)
})

// --- Sesiones vacías ------------------------------------------------------

test('una_sesion_cancelada_no_cuenta_ni_sale', () => {
  // Sin series y ya fuera de curso: no se hizo nada.
  sesion(cliente, MARTES_15, ppl.Push, LUNES_14)

  const dias = seguimiento(cliente, LUNES_14, MARTES_15)

  expect(dias[LUNES_14].estado).toBe('sin_hacer')
  expect(dias[LUNES_14].cubierto_por).toBeNull()
  expect(dias[MARTES_15].sesion).toBeNull()
})

test('la_sesion_en_curso_cuenta_aunque_este_vacia', () => {
  const empezada = sesion(cliente, HOY, ppl.Pull, HOY).json().id

  const dia = seguimiento(cliente, HOY)[HOY]

  expect(dia.estado).toBe('hecho')
  expect(dia.sesion).toEqual({
    entrenamiento_id: empezada,
    rutina: { id: ppl.Pull, nombre: 'Pull', oculto_desde: null },
    en_curso: true,
    cubre_fecha: HOY,
    cuenta: true,
  })
})

// --- Lo que se hizo frente a lo que tocaba --------------------------------

test('otra_rutina_el_dia_que_tocaba_una_que_sigue_sin_hacer', () => {
  // La marca ●○: el lunes se hizo Leg sin contar ningún día, y el Push del lunes sigue sin hacer.
  hecha(LUNES_14, ppl.Leg)

  const dia = seguimiento(cliente, LUNES_14)[LUNES_14]

  expect(dia.estado).toBe('sin_hacer')
  expect(dia.sesion.rutina.nombre).toBe('Leg')
  expect(dia.sesion.cuenta).toBe(false)
})

test('otra_rutina_el_dia_que_tocaba_una_hecha_otro_dia', () => {
  // La marca ←● / ●→: el lunes se adelantó el Leg del viernes, y el Push del lunes se
  // recuperó el martes.
  hecha(LUNES_14, ppl.Leg, VIERNES_18)
  const recuperada = hecha(MARTES_15, ppl.Push, LUNES_14)

  const dia = seguimiento(cliente, LUNES_14)[LUNES_14]

  expect(dia.estado).toBe('movido')
  expect(dia.cubierto_por.entrenamiento_id).toBe(recuperada)
  expect(dia.sesion.rutina.nombre).toBe('Leg')
  expect(dia.sesion.cubre_fecha).toBe(VIERNES_18)
  expect(dia.sesion.cuenta).toBe(true)
})

test('una_sesion_sin_cubrir_ningun_dia_sale_como_sesion_sin_contar', () => {
  const suelta = hecha(MARTES_15, ppl.Leg)

  const dia = seguimiento(cliente, MARTES_15)[MARTES_15]

  expect(dia.estado).toBe('descanso')
  expect(dia.sesion.entrenamiento_id).toBe(suelta)
  expect(dia.sesion.rutina.id).toBe(ppl.Leg)
  expect(dia.sesion.cuenta).toBe(false)
})

test('una_sesion_de_una_rutina_que_ese_dia_ya_no_toca_no_lo_cuenta', () => {
  // Se monta en la base: con la API, el plan de un día pasado ya no cambia.
  const antigua = hecha(MARTES_15, ppl.Leg)
  entorno.bd.ejecutar('UPDATE entrenamientos SET cubre_fecha = ? WHERE id = ?', LUNES_14, antigua)

  const dias = seguimiento(cliente, LUNES_14, MARTES_15)

  expect(dias[LUNES_14].estado).toBe('sin_hacer')
  expect(dias[MARTES_15].sesion.cubre_fecha).toBe(LUNES_14)
  expect(dias[MARTES_15].sesion.cuenta).toBe(false)
})

test('un_dia_sale_igual_lo_pida_solo_o_dentro_de_un_rango', () => {
  // Saber si la sesión del jueves cuenta pide el plan del miércoles, que queda fuera si se
  // pide solo el jueves: el seguimiento resuelve unos días de margen.
  hecha(JUEVES_10, ppl.Pull, MIERCOLES_9)
  hecha(VIERNES_11, ppl.Leg, VIERNES_11)

  const en_rango = seguimiento(cliente, LUNES_7, VIERNES_18)

  for (const fecha of [MIERCOLES_9, JUEVES_10, VIERNES_11]) {
    expect(seguimiento(cliente, fecha)[fecha]).toEqual(en_rango[fecha])
  }
  expect(seguimiento(cliente, JUEVES_10)[JUEVES_10].sesion.cuenta).toBe(true)
})

// --- Rango y consultas ---------------------------------------------------

test.each([
  ['invertido', HOY, LUNES_14, () => rango_invertido(HOY, LUNES_14)],
  ['mas-de-400-dias', HOY, sumarDias(HOY, 400), () => 'Como mucho se piden 400 días de una vez.'],
])('un_rango_invalido_da_422 (%s)', (_id, desde, hasta, lo_que_dice) => {
  const respuesta = cliente.get('/plan/seguimiento', { params: { desde, hasta } })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(lo_que_dice())
})

test('un_rango_de_justo_400_dias_vale', () => {
  // El borde del anterior: el tope incluye el día 400.
  const respuesta = cliente.get('/plan/seguimiento', {
    params: { desde: HOY, hasta: sumarDias(HOY, 399) },
  })

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json()).toHaveLength(400)
})

test.each([
  [
    'seguimiento-primeros-dias',
    '/plan/seguimiento',
    { desde: '0001-01-01', hasta: '0001-01-02' },
    ['0001-01-01', '0001-01-02'],
  ],
  [
    'seguimiento-ultimos-dias',
    '/plan/seguimiento',
    { desde: '9999-12-30', hasta: '9999-12-31' },
    ['9999-12-30', '9999-12-31'],
  ],
  ['hoja-de-un-dia', '/plan/hoy', { fecha: '0001-01-08' }, ['0001-01-08']],
])('los_dias_del_borde_del_calendario_no_dan_500 (%s)', (_id, ruta, params, fechas) => {
  // El rango es válido (no invertido, de menos de 400 días, y la hoja de un día pasado), así
  // que se responde. Antes daba 500 (OverflowError): el seguimiento y /plan/hoy sumaban y
  // restaban su margen sin acotarlo al calendario.
  const respuesta = cliente.get(ruta, { params })

  expect(respuesta.status_code).toBe(200)
  const cuerpo = respuesta.json()
  const dias = ruta === '/plan/seguimiento' ? cuerpo : [cuerpo]
  expect(dias.map((dia: any) => dia.fecha)).toEqual(fechas)
})

test('junto_a_los_bordes_del_calendario_lo_hecho_cuenta_y_se_planifica', () => {
  // El anterior, con algo dentro: lo del 1-1-0001, recuperado el día 3, cuenta y lo ven el
  // seguimiento y la hoja de ese día; el 31-12-9999 se planifica, sale en el seguimiento y se
  // restablece. Antes del arreglo, el margen de seis días a cada lado se salía del calendario
  // (500).
  const primero = '0001-01-01'
  const tercero = '0001-01-03'
  const ultimo = '9999-12-31'
  // El pasado no se planifica por la API: el día cambiado se mete en la base.
  insertar(entorno.bd, 'excepciones_del_plan', {
    fecha: primero,
    rutina_id: ppl.Push,
    created_at: AHORA,
    updated_at: AHORA,
  })
  const recuperada = hecha(tercero, ppl.Push, primero)

  const principio = seguimiento(cliente, primero, '0001-01-07')
  const hoja = cliente.get('/plan/hoy', { params: { fecha: tercero } })
  expect(
    cliente.put(`/plan/excepciones/${ultimo}`, { json: { rutina_id: ppl.Leg } }).json(),
  ).toEqual({
    fecha: ultimo,
    rutina: { id: ppl.Leg, nombre: 'Leg', oculto_desde: null },
  })
  const final = seguimiento(cliente, '9999-12-25', ultimo)
  const restablecer = cliente.delete('/plan/excepciones', { params: { desde: HOY, hasta: ultimo } })

  expect(principio[primero].estado).toBe('movido')
  expect(principio[primero].cubierto_por).toEqual({ entrenamiento_id: recuperada, fecha: tercero })
  expect(principio[tercero].sesion.entrenamiento_id).toBe(recuperada)
  expect(hoja.status_code).toBe(200)
  expect(hoja.json().semana[2].sesion.entrenamiento_id).toBe(recuperada)
  expect([final[ultimo].origen, final[ultimo].rutina.id]).toEqual(['excepcion', ppl.Leg])
  expect(final[ultimo].estado).toBe('proximo')
  expect(restablecer.status_code).toBe(204)
  expect(cliente.get('/plan/excepciones').json()).toEqual([
    { fecha: primero, rutina: { id: ppl.Push, nombre: 'Push', oculto_desde: null } },
  ])
})
