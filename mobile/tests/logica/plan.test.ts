/**
 * El plan: qué toca cada día según el programa activo en esa fecha (se mira en
 * `GET /plan/seguimiento`), y los días cambiados a mano. Puerto de
 * `backend/tests/test_plan.py`.
 *
 * La idea que más importa es que cada día se resuelve con el programa que estaba activo
 * **ese día**: un mes pasado se compara con el plan de entonces, no con el de hoy. Los
 * periodos que empiezan antes de hoy se insertan a mano, porque por la API todo empieza hoy.
 *
 * Todo el archivo congela el reloj en `HOY`.
 */
import { diaDeLaSemana, sumarDias } from '../../src/logica/reglas/dias'
import {
  crear_programa,
  crear_rutina,
  dejar_planificado,
  planificar,
  rango_invertido,
} from '../apoyo/ayudas'
import { AHORA } from '../apoyo/baseNueva'
import { crearCliente, type Entorno, type RespuestaDeTest } from '../apoyo/cliente'
import { insertar } from '../apoyo/filas'
import { HOY } from '../apoyo/semana'

let entorno: Entorno
let cliente: Entorno['cliente']

beforeEach(() => {
  entorno = crearCliente()
  cliente = entorno.cliente
  entorno.reloj.fijar(HOY)
})

function periodo(programa_id: number, desde: string, hasta: string | null = null): void {
  insertar(entorno.bd, 'programa_periodos', { programa_id, desde, hasta })
}

/** Qué toca cada día del rango, por fecha (lo que trae el seguimiento del plan). */
function plan(desde: string, hasta: string): Record<string, any> {
  const respuesta = cliente.get('/plan/seguimiento', { params: { desde, hasta } })
  expect([respuesta.status_code, respuesta.text]).toEqual([200, respuesta.text])
  return Object.fromEntries(respuesta.json().map((dia: any) => [dia.fecha, dia]))
}

function rutina_de(dia: any): string | null {
  return dia.rutina ? dia.rutina.nombre : null
}

const mas = (dias: number) => sumarDias(HOY, dias)

test('sin_programa_activo_no_toca_nada', () => {
  const dias = plan(HOY, mas(6))

  expect(Object.keys(dias)).toHaveLength(7)
  const distintos = new Set(
    Object.values(dias).map((d: any) => JSON.stringify([d.origen, d.rutina, d.descanso, d.estado])),
  )
  expect([...distintos]).toEqual([JSON.stringify(['sin_programa', null, true, 'descanso'])])
})

test('con_un_programa_activo_cada_dia_de_la_semana_toma_su_rutina', () => {
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')
  crear_programa(cliente, {
    nombre: 'PPL',
    dias: [
      [1, push],
      [3, pull],
    ],
    activar: true,
  })

  const dias = plan(HOY, mas(13))

  for (const [fecha_iso, dia] of Object.entries(dias)) {
    const esperado = ({ 1: 'Push', 3: 'Pull' } as Record<number, string>)[diaDeLaSemana(fecha_iso)]
    expect(rutina_de(dia)).toBe(esperado ?? null)
    expect(dia.descanso).toBe(esperado === undefined)
    expect(dia.origen).toBe('programa')
  }
})

test('un_dia_pasado_se_compara_con_el_programa_de_entonces', () => {
  // Hasta hace 10 días estaba activo el viejo (todo Push); desde entonces, el nuevo (todo
  // Pull). Antes de hace 20 días no había ninguno.
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')
  const todos = (rutina: number): [number, number][] =>
    [1, 2, 3, 4, 5, 6, 7].map((d) => [d, rutina])
  const viejo = crear_programa(cliente, { nombre: 'Viejo', dias: todos(push) }).id
  const nuevo = crear_programa(cliente, { nombre: 'Nuevo', dias: todos(pull) }).id
  periodo(viejo, mas(-20), mas(-10))
  periodo(nuevo, mas(-10))

  const dias = plan(mas(-25), mas(5))

  const en = (dias_atras: number) => dias[mas(-dias_atras)]
  expect(en(21).origen).toBe('sin_programa')
  expect(rutina_de(en(20))).toBe('Push')
  expect(rutina_de(en(11))).toBe('Push')
  // El periodo del viejo no incluye su `hasta`: ese día ya le toca al nuevo.
  expect(rutina_de(en(10))).toBe('Pull')
  expect(rutina_de(en(-5))).toBe('Pull')
})

test('una_rutina_oculta_es_descanso_desde_que_se_oculto_pero_no_antes', () => {
  const push = crear_rutina(cliente, 'Push')
  const programa = crear_programa(cliente, {
    nombre: 'Todo Push',
    dias: [1, 2, 3, 4, 5, 6, 7].map((d): [number, number] => [d, push]),
  }).id
  periodo(programa, mas(-10))
  entorno.bd.ejecutar('UPDATE rutinas SET oculto_desde = ? WHERE id = ?', mas(-3), push)

  const dias = plan(mas(-5), HOY)
  const antes = dias[mas(-4)]
  const despues = dias[mas(-3)]

  expect([rutina_de(antes), antes.descanso]).toEqual(['Push', false])
  // La rutina viene igual, para pintarla en gris, pero ese día no se entrena.
  expect([rutina_de(despues), despues.descanso]).toEqual(['Push', true])
})

test('un_programa_oculto_sigue_contando_para_los_dias_en_que_estuvo_activo', () => {
  const push = crear_rutina(cliente, 'Push')
  const programa = crear_programa(cliente, {
    nombre: 'Viejo',
    dias: [1, 2, 3, 4, 5, 6, 7].map((d): [number, number] => [d, push]),
  }).id
  periodo(programa, mas(-10), mas(-5))
  entorno.bd.ejecutar('UPDATE programas SET oculto_desde = ? WHERE id = ?', HOY, programa)

  const dias = plan(mas(-7), mas(-7))

  expect(rutina_de(dias[mas(-7)])).toBe('Push')
})

// --- Excepciones: días cambiados a mano ----------------------------------

/** Para días ya pasados, que por la API no se pueden planificar. */
function excepcion_a_mano(fecha: string, rutina_id: number | null): void {
  insertar(entorno.bd, 'excepciones_del_plan', {
    fecha,
    rutina_id,
    created_at: AHORA,
    updated_at: AHORA,
  })
}

/** Un programa activo con Push todos los días, y una rutina Pull suelta. */
function semana_push() {
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')
  const programa = crear_programa(cliente, {
    nombre: 'Todo Push',
    dias: [1, 2, 3, 4, 5, 6, 7].map((d): [number, number] => [d, push]),
    activar: true,
  }).id
  return { push, pull, programa }
}

test('un_dia_cambiado_manda_sobre_el_programa', () => {
  const s = semana_push()
  const manana = mas(1)

  expect(planificar(cliente, manana, s.pull).status_code).toBe(200)
  const dias = plan(HOY, manana)

  expect(rutina_de(dias[HOY])).toBe('Push')
  const cambiado = dias[manana]
  expect([cambiado.origen, rutina_de(cambiado)]).toEqual(['excepcion', 'Pull'])
})

test('un_dia_se_puede_cambiar_a_descanso', () => {
  semana_push()
  dejar_planificado(cliente, HOY, null)

  const dia = plan(HOY, HOY)[HOY]

  expect([dia.origen, dia.rutina, dia.descanso]).toEqual(['excepcion', null, true])
})

test('cambiar_un_dia_otra_vez_lo_sustituye', () => {
  const s = semana_push()
  dejar_planificado(cliente, HOY, s.pull)
  dejar_planificado(cliente, HOY, null)

  const excepciones = cliente.get('/plan/excepciones').json()

  expect(excepciones).toHaveLength(1)
  expect([excepciones[0].fecha, excepciones[0].rutina]).toEqual([HOY, null])
})

test('elegir_a_mano_la_rutina_de_siempre_deja_el_dia_marcado', () => {
  // No es lo mismo que restablecerlo: queda como cambiado.
  const s = semana_push()
  dejar_planificado(cliente, HOY, s.push)

  expect(plan(HOY, HOY)[HOY].origen).toBe('excepcion')
})

test('un_dia_se_puede_cambiar_aunque_no_haya_programa', () => {
  const push = crear_rutina(cliente, 'Push')
  dejar_planificado(cliente, HOY, push)

  const dia = plan(HOY, HOY)[HOY]

  expect([dia.origen, rutina_de(dia)]).toEqual(['excepcion', 'Push'])
})

test('el_pasado_no_se_planifica', () => {
  // Ni cambiar un día pasado ni restablecerlo, aunque esté cambiado: 422 y no se toca.
  const s = semana_push()
  const ayer = mas(-1)
  excepcion_a_mano(ayer, s.pull)

  for (const respuesta of [
    planificar(cliente, ayer, null),
    cliente.delete(`/plan/excepciones/${ayer}`),
  ]) {
    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail).toBe(
      'El martes 15 de septiembre ya ha pasado. Solo se puede planificar de hoy en adelante.',
    )
  }
  const excepciones = cliente.get('/plan/excepciones').json()
  expect(excepciones).toHaveLength(1)
  expect([excepciones[0].fecha, excepciones[0].rutina.id]).toEqual([ayer, s.pull])
})

test('no_se_puede_planificar_una_rutina_oculta', () => {
  const s = semana_push()
  expect(cliente.delete(`/rutinas/${s.pull}?modo=ocultar`).status_code).toBe(204)

  const respuesta = planificar(cliente, HOY, s.pull)

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Esa rutina no existe o está oculta.')
  expect(cliente.get('/plan/excepciones').json()).toEqual([])
})

test('restablecer_un_dia_lo_devuelve_al_programa', () => {
  const s = semana_push()
  dejar_planificado(cliente, HOY, s.pull)
  const ruta = `/plan/excepciones/${HOY}`

  expect(cliente.delete(ruta).status_code).toBe(204)
  expect(plan(HOY, HOY)[HOY].origen).toBe('programa')
  // Ya no estaba cambiado: no hay nada que restablecer.
  const otra_vez = cliente.delete(ruta)
  expect([otra_vez.status_code, otra_vez.json().detail]).toEqual([
    404,
    'Ese día no estaba cambiado. Ya es lo que dice el programa.',
  ])
})

test('restablecer_la_semana_no_toca_los_dias_pasados', () => {
  const s = semana_push()
  const ayer = mas(-1)
  excepcion_a_mano(ayer, s.pull)
  for (const dias of [0, 1, 2]) dejar_planificado(cliente, mas(dias), s.pull)
  const fuera = mas(10)
  dejar_planificado(cliente, fuera, s.pull)

  const respuesta = cliente.delete('/plan/excepciones', { params: { desde: ayer, hasta: mas(6) } })

  expect(respuesta.status_code).toBe(204)
  const quedan = cliente
    .get('/plan/excepciones')
    .json()
    .map((e: any) => e.fecha)
  expect(quedan).toEqual([ayer, fuera])
})

test('restablecer_un_rango_invertido_da_422_y_no_borra_nada', () => {
  // Igual que en el resto de los rangos: un `desde` posterior a `hasta` solo puede ser un
  // error de quien llama, y aquí además un borrado silencioso.
  const s = semana_push()
  const manana = mas(1)
  dejar_planificado(cliente, manana, s.pull)

  const respuesta = cliente.delete('/plan/excepciones', { params: { desde: mas(6), hasta: HOY } })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(rango_invertido(mas(6), HOY))
  expect(
    cliente
      .get('/plan/excepciones')
      .json()
      .map((e: any) => e.fecha),
  ).toEqual([manana])
})

function fechas_cambiadas(): string[] {
  return cliente
    .get('/plan/excepciones')
    .json()
    .map((e: any) => e.fecha)
}

function nombres_de_programas(): string[] {
  return cliente
    .get('/programas')
    .json()
    .map((p: any) => p.nombre)
    .sort()
}

test('activar_otro_programa_quitando_lo_planificado_solo_borra_desde_hoy', () => {
  const s = semana_push()
  const ayer = mas(-1)
  excepcion_a_mano(ayer, s.pull)
  dejar_planificado(cliente, mas(3), s.pull)
  const otro = crear_programa(cliente, { nombre: 'Otro', dias: [] }).id

  const respuesta = cliente.post(`/programas/${otro}/activar`, {
    json: { quitar_excepciones: true },
  })

  expect([respuesta.status_code, respuesta.text]).toEqual([200, respuesta.text])
  expect(fechas_cambiadas()).toEqual([ayer])
})

test('activar_otro_programa_sin_pedirlo_conserva_lo_planificado', () => {
  const s = semana_push()
  dejar_planificado(cliente, mas(3), s.pull)
  const otro = crear_programa(cliente, { nombre: 'Otro', dias: [] }).id

  expect(cliente.post(`/programas/${otro}/activar`).status_code).toBe(200)

  expect(fechas_cambiadas()).toEqual([mas(3)])
})

// Lo mismo al crear un programa ya activado: `POST /programas` con `activar` acepta también
// `quitar_excepciones`, que hace lo mismo que al activar uno que ya existe.

/** POST /programas con `activar` y Pull todos los días; devuelve la respuesta. */
function crear_activado(rutina_id: number, extra: Record<string, unknown> = {}): RespuestaDeTest {
  return cliente.post('/programas', {
    json: {
      nombre: 'Nuevo',
      activar: true,
      dias: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia_semana: d, rutina_id })),
      ...extra,
    },
  })
}

test('crear_un_programa_activado_quitando_lo_planificado_solo_borra_desde_hoy', () => {
  // Los días se cambian por la API y luego pasa un día: el que ya ha pasado se queda; el de
  // hoy (incluido) y los siguientes desaparecen.
  const s = semana_push()
  for (const dias of [0, 1, 3]) {
    expect(planificar(cliente, mas(dias), s.pull).status_code).toBe(200)
  }
  entorno.reloj.fijar(mas(1))

  const respuesta = crear_activado(s.pull, { quitar_excepciones: true })

  expect([respuesta.status_code, respuesta.text]).toEqual([201, respuesta.text])
  expect(respuesta.json().activo).toBe(true)
  expect(cliente.get(`/programas/${s.programa}`).json().activo).toBe(false)
  expect(fechas_cambiadas()).toEqual([HOY])
  // Desde hoy, lo que toca es lo del programa nuevo, no lo cambiado a mano.
  const dia = plan(mas(3), mas(3))
  expect(Object.values(dia).map((d: any) => [d.origen, rutina_de(d)])).toEqual([
    ['programa', 'Pull'],
  ])
})

test('crear_un_programa_activado_sin_pedirlo_conserva_lo_planificado', () => {
  const s = semana_push()
  const ayer = mas(-1)
  excepcion_a_mano(ayer, s.pull)
  dejar_planificado(cliente, HOY, null)
  dejar_planificado(cliente, mas(3), s.pull)

  const respuesta = crear_activado(s.pull, { quitar_excepciones: false })

  expect([respuesta.status_code, respuesta.text]).toEqual([201, respuesta.text])
  expect(respuesta.json().activo).toBe(true)
  expect(fechas_cambiadas()).toEqual([ayer, HOY, mas(3)])
})

test('quitar_lo_planificado_sin_activar_da_422_y_no_crea_ni_borra_nada', () => {
  const s = semana_push()
  dejar_planificado(cliente, mas(3), s.pull)
  const cuerpo = {
    nombre: 'Nuevo',
    dias: [{ dia_semana: 1, rutina_id: s.pull }],
    quitar_excepciones: true,
  }

  const respuesta = cliente.post('/programas', { json: cuerpo })

  expect(respuesta.status_code).toBe(422)
  // Un `value_error`, que la web enseña tal cual: se fija el texto entero.
  expect(respuesta.json().detail.map((e: any) => e.msg)).toEqual([
    'Value error, Solo se quitan los días cambiados a mano al activar el programa.',
  ])
  expect(nombres_de_programas()).toEqual(['Todo Push'])
  expect(cliente.get(`/programas/${s.programa}`).json().activo).toBe(true)
  expect(fechas_cambiadas()).toEqual([mas(3)])
})

test('crear_un_programa_con_una_rutina_inexistente_no_quita_lo_planificado', () => {
  // El 404 de la rutina llega antes de activar nada: ni se crea el programa, ni deja de estar
  // activo el anterior, ni se borra ningún día cambiado. Una rutina oculta da el mismo 404, por
  // el mismo camino (`crear_con_una_rutina_oculta_falla…`).
  const s = semana_push()
  dejar_planificado(cliente, HOY, s.pull)
  dejar_planificado(cliente, mas(3), s.pull)

  const respuesta = crear_activado(999_999, { quitar_excepciones: true })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Esa rutina no existe o está oculta.')
  expect(nombres_de_programas()).toEqual(['Todo Push'])
  expect(cliente.get(`/programas/${s.programa}`).json().activo).toBe(true)
  expect(fechas_cambiadas()).toEqual([HOY, mas(3)])
})

test('borrar_una_rutina_devuelve_sus_dias_planificados_al_programa', () => {
  const s = semana_push()
  dejar_planificado(cliente, HOY, s.pull)

  expect(cliente.delete(`/rutinas/${s.pull}`).status_code).toBe(204)

  const dia = plan(HOY, HOY)[HOY]
  expect([dia.origen, rutina_de(dia)]).toEqual(['programa', 'Push'])
})

test('los_dias_planificados_se_pueden_filtrar_por_fechas', () => {
  // Con `desde` = hoy son los que se perderían al activar otro programa.
  const s = semana_push()
  for (const dias of [0, 2, 5]) dejar_planificado(cliente, mas(dias), s.pull)

  const fechas = (filtros: Record<string, string>) =>
    cliente
      .get('/plan/excepciones', { params: filtros })
      .json()
      .map((e: any) => e.fecha)

  expect(fechas({ desde: mas(1), hasta: mas(4) })).toEqual([mas(2)])
  expect(fechas({ desde: mas(1) })).toHaveLength(2)
  expect(fechas({ hasta: mas(2) })).toHaveLength(2)
  const respuesta = cliente.get('/plan/excepciones', { params: { desde: HOY, hasta: mas(-1) } })
  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(rango_invertido(HOY, mas(-1)))
})

// --- Bordes y combinaciones con lo oculto --------------------------------

test('un_periodo_cubre_su_ultimo_dia_aunque_el_rango_empiece_justo_ahi', () => {
  // Un rango de un solo día en el último día de un periodo, y otro en su `hasta`: el primero
  // es del programa viejo, el segundo ya del nuevo. Así se comprueba también el filtro de la
  // consulta, no solo el recorrido día a día.
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')
  const todos = (rutina: number): [number, number][] =>
    [1, 2, 3, 4, 5, 6, 7].map((d) => [d, rutina])
  const viejo = crear_programa(cliente, { nombre: 'Viejo', dias: todos(pull) }).id
  const nuevo = crear_programa(cliente, { nombre: 'Nuevo', dias: todos(push) }).id
  const cambio = mas(-5)
  periodo(viejo, mas(-10), cambio)
  periodo(nuevo, cambio)

  const ultimo_del_viejo = sumarDias(cambio, -1)
  const dia_viejo = plan(ultimo_del_viejo, ultimo_del_viejo)[ultimo_del_viejo]
  const dia_nuevo = plan(cambio, cambio)[cambio]
  const antes_de_todo = mas(-11)

  expect([dia_viejo.origen, rutina_de(dia_viejo)]).toEqual(['programa', 'Pull'])
  expect([dia_nuevo.origen, rutina_de(dia_nuevo)]).toEqual(['programa', 'Push'])
  expect(plan(antes_de_todo, antes_de_todo)[antes_de_todo].origen).toBe('sin_programa')
})

test('ocultar_el_programa_activo_deja_hoy_sin_programa_pero_respeta_lo_planificado', () => {
  // Las excepciones no son del programa: sobreviven a que el programa deje de estar activo.
  const s = semana_push()
  const manana = mas(1)
  dejar_planificado(cliente, manana, s.pull)

  expect(cliente.delete(`/programas/${s.programa}?modo=ocultar`).status_code).toBe(204)
  const dias = plan(HOY, manana)

  expect(dias[HOY].origen).toBe('sin_programa')
  expect([dias[manana].origen, rutina_de(dias[manana])]).toEqual(['excepcion', 'Pull'])
})
