/**
 * Los programas y sus días: `/programas`. Los días se cambian con el *Guardar* de la semana,
 * `PUT /programas/{id}` con la semana entera.
 *
 * Puerto de `backend/tests/test_programas.py`.
 *
 * Lo que más importa aquí es lo que el diseño decidió con cuidado: una rutina se reutiliza
 * en varios días y en varios programas (no pertenece a ninguno), un día tiene como mucho una
 * rutina, y ocultar una rutina no la quita de los días que ya la tenían.
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  PIDE_MODO,
  cambiar_dias,
  crear_programa,
  crear_rutina,
  nombre_repetido,
} from '../apoyo/ayudas'
import { crearCliente, hoy, type ClienteDeTest as Cliente, type Entorno } from '../apoyo/cliente'
import { contar, insertar } from '../apoyo/filas'
import { HOY } from '../apoyo/semana'

let cliente: Cliente
let reloj: Entorno['reloj']
let bd: Bd
beforeEach(() => {
  ;({ cliente, reloj, bd } = crearCliente())
})

// --- Ayudantes -----------------------------------------------------------

/** La fecha ISO `dias` días después (o antes, si es negativo). */
function sumar(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** El día de la semana de una fecha ISO, de 1 (lunes) a 7 (domingo): `isoweekday()`. */
function isoweekday(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() || 7
}

function rutinas_por_dia(programa: any): Record<number, string> {
  return Object.fromEntries(programa.dias.map((dia: any) => [dia.dia_semana, dia.rutina.nombre]))
}

function ocultar_programa(programa_id: number): void {
  expect(cliente.delete(`/programas/${programa_id}?modo=ocultar`).status_code).toBe(204)
}

const PROGRAMA_OCULTO = 'Este programa está oculto. Muéstralo antes de cambiarlo.'

// --- Crear ---------------------------------------------------------------

test('crear_un_programa_con_sus_dias', () => {
  const [push, pull, leg] = [
    crear_rutina(cliente, 'Push'),
    crear_rutina(cliente, 'Pull'),
    crear_rutina(cliente, 'Leg'),
  ]

  const programa = crear_programa(cliente, {
    dias: [
      [5, leg],
      [1, push],
      [3, pull],
    ],
  })

  expect(programa.nombre).toBe('Push Pull Leg')
  // Ordenados por día, aunque lleguen desordenados. Los que faltan son descanso.
  expect(rutinas_por_dia(programa)).toEqual({ 1: 'Push', 3: 'Pull', 5: 'Leg' })
  expect(programa.dias.map((d: any) => d.dia_semana)).toEqual([1, 3, 5])
  expect(programa.activo).toBe(false)
  expect(programa.ultimo_periodo).toBeNull()
  expect(programa.oculto_desde).toBeNull()
})

test('un_dia_no_puede_tener_dos_rutinas', () => {
  const [push, pull] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Pull')]

  const respuesta = cliente.post('/programas', {
    json: {
      nombre: 'Repetido',
      dias: [
        { dia_semana: 1, rutina_id: push },
        { dia_semana: 1, rutina_id: pull },
      ],
    },
  })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail[0].msg).toBe(
    'Value error, Hay días repetidos, y un día no puede tener dos rutinas.',
  )
  expect(cliente.get('/programas').json()).toEqual([])
})

test.each([0, 8])('el_dia_de_la_semana_va_de_1_a_7 (%i)', (dia) => {
  const push = crear_rutina(cliente)

  const respuesta = cliente.post('/programas', {
    json: { nombre: 'Mal', dias: [{ dia_semana: dia, rutina_id: push }] },
  })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((e: any) => e.loc)).toEqual([
    ['body', 'dias', 0, 'dia_semana'],
  ])
  expect(cliente.get('/programas').json()).toEqual([])
})

test('crear_con_una_rutina_oculta_falla_y_no_guarda_nada', () => {
  // Lo oculto deja de ofrecerse para elegir. Y crear es todo o nada: si una rutina falla, no
  // queda un programa a medias.
  const [push, pull] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Pull')]
  expect(cliente.delete(`/rutinas/${pull}?modo=ocultar`).status_code).toBe(204)

  const respuesta = cliente.post('/programas', {
    json: {
      nombre: 'PPL',
      dias: [
        { dia_semana: 1, rutina_id: push },
        { dia_semana: 3, rutina_id: pull },
      ],
    },
  })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Esa rutina no existe o está oculta.')
  expect(cliente.get('/programas').json()).toEqual([])
})

// --- Reutilizar rutinas --------------------------------------------------

test('una_rutina_puede_estar_en_varios_dias_y_en_varios_programas', () => {
  const full_body = crear_rutina(cliente, 'Full body')

  crear_programa(cliente, {
    nombre: 'Dos días',
    dias: [
      [2, full_body],
      [4, full_body],
    ],
  })
  crear_programa(cliente, { nombre: 'Tres días', dias: [[1, full_body]] })

  const [rutina] = cliente.get('/rutinas').json()
  expect(rutina.num_programas).toBe(2)
})

test('num_programas_no_cuenta_los_programas_ocultos', () => {
  const push = crear_rutina(cliente)
  crear_programa(cliente, { nombre: 'Visible', dias: [[1, push]] })
  const oculto = crear_programa(cliente, { nombre: 'Oculto', dias: [[1, push]] })
  ocultar_programa(oculto.id)

  expect(cliente.get(`/rutinas/${push}`).json().num_programas).toBe(1)
})

// --- Leer, editar y los días ---------------------------------------------

test('listar_separa_los_programas_visibles_de_los_ocultos', () => {
  crear_programa(cliente, { nombre: 'Visible' })
  const oculto = crear_programa(cliente, { nombre: 'Oculto' })
  ocultar_programa(oculto.id)

  const visibles = cliente
    .get('/programas')
    .json()
    .map((p: any) => p.nombre)
  const ocultos = cliente
    .get('/programas?ocultos=true')
    .json()
    .map((p: any) => p.nombre)

  expect(visibles).toEqual(['Visible'])
  expect(ocultos).toEqual(['Oculto'])
  // Oculto se puede abrir igual: tiene su propia vista.
  expect(cliente.get(`/programas/${oculto.id}`).status_code).toBe(200)
})

test('un_programa_oculto_no_se_puede_editar', () => {
  const push = crear_rutina(cliente)
  const programa = crear_programa(cliente, { dias: [[1, push]] })
  ocultar_programa(programa.id)
  const ruta = `/programas/${programa.id}`

  const respuestas = [
    cliente.put(ruta, { json: { nombre: 'Otro' } }),
    cliente.put(ruta, {
      json: {
        nombre: 'Push Pull Leg',
        dias: [1, 2].map((dia) => ({ dia_semana: dia, rutina_id: push })),
      },
    }),
    // Dejar un día en descanso también es editar.
    cliente.put(ruta, { json: { nombre: 'Push Pull Leg', dias: [] } }),
  ]

  for (const respuesta of respuestas) {
    expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, PROGRAMA_OCULTO])
  }
  const guardado = cliente.get(ruta).json()
  expect([guardado.nombre, rutinas_por_dia(guardado)]).toEqual(['Push Pull Leg', { 1: 'Push' }])
})

test('asignar_otra_rutina_a_un_dia_con_una_rutina_oculta_la_sustituye', () => {
  // Un día, una rutina: la nueva sustituye a la oculta, que sigue en la biblioteca (oculta)
  // pero pierde ese día.
  const [push, pull] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Pull')]
  const programa = crear_programa(cliente, { dias: [[6, push]] })
  expect(cliente.delete(`/rutinas/${push}?modo=ocultar`).status_code).toBe(204)

  const respuesta = cambiar_dias(cliente, programa.id, { 6: pull })

  expect(respuesta.status_code).toBe(200)
  expect(rutinas_por_dia(respuesta.json())).toEqual({ 6: 'Pull' })
  expect(cliente.get(`/rutinas/${push}`).json().oculto_desde).toBe(hoy())
})

// --- Guardar la semana de una vez ------------------------------------------
//
// El *Guardar* de la semana manda el nombre y los siete días en una sola petición
// (`PUT /programas/{id}` con `dias`): todo se valida antes de escribir, así que o se guarda
// todo o nada. Solo se valida lo que cambia.

const NO_SE_PUEDE_ELEGIR = 'Esa rutina no existe o está oculta.'

/** El PUT con el nombre y la semana entera, cada día `[dia_semana, rutina_id]`. */
function guardar_semana(programa_id: number, nombre: string, dias: [number, number][]) {
  return cliente.put(`/programas/${programa_id}`, {
    json: { nombre, dias: dias.map(([dia, rutina]) => ({ dia_semana: dia, rutina_id: rutina })) },
  })
}

function como_esta(programa_id: number): [string, Record<number, string>] {
  const programa = cliente.get(`/programas/${programa_id}`).json()
  return [programa.nombre, rutinas_por_dia(programa)]
}

test('guardar_el_nombre_y_varios_dias_de_una_vez', () => {
  const [push, pull, leg] = ['Push', 'Pull', 'Leg'].map((nombre) => crear_rutina(cliente, nombre))
  const programa = crear_programa(cliente, {
    dias: [
      [1, push],
      [3, pull],
    ],
  }).id

  // El lunes cambia, el miércoles pasa a descanso y el viernes se estrena.
  const respuesta = guardar_semana(programa, 'PPL nuevo', [
    [1, pull],
    [5, leg],
  ])

  expect(respuesta.status_code).toBe(200)
  expect([respuesta.json().nombre, rutinas_por_dia(respuesta.json())]).toEqual([
    'PPL nuevo',
    { 1: 'Pull', 5: 'Leg' },
  ])
  expect(como_esta(programa)).toEqual(['PPL nuevo', { 1: 'Pull', 5: 'Leg' }])
})

test.each(['oculta', 'inexistente'])(
  'una_rutina_que_no_se_puede_elegir_da_404_y_no_guarda_nada (%s)',
  (cual) => {
    // Los días buenos que van antes que el malo tampoco se guardan, ni el nombre.
    const [push, pull] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Pull')]
    const programa = crear_programa(cliente, { dias: [[1, push]] }).id
    let mala: number
    if (cual === 'oculta') {
      mala = crear_rutina(cliente, 'Leg')
      expect(cliente.delete(`/rutinas/${mala}?modo=ocultar`).status_code).toBe(204)
    } else {
      mala = 999_999
    }

    const respuesta = guardar_semana(programa, 'Otro', [
      [1, pull],
      [2, push],
      [3, mala],
    ])

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([404, NO_SE_PUEDE_ELEGIR])
    expect(como_esta(programa)).toEqual(['Push Pull Leg', { 1: 'Push' }])
  },
)

test('un_nombre_repetido_da_409_y_no_cambia_los_dias', () => {
  crear_programa(cliente, { nombre: 'Torso pierna' })
  const [push, pull] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Pull')]
  const programa = crear_programa(cliente, { dias: [[1, push]] }).id

  const respuesta = guardar_semana(programa, 'TORSO PIERNA', [
    [1, pull],
    [4, push],
  ])

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    409,
    nombre_repetido('Ya tienes un programa que se llama «Torso pierna». Elige otro nombre.'),
  ])
  expect(como_esta(programa)).toEqual(['Push Pull Leg', { 1: 'Push' }])
})

test('con_una_rutina_oculta_y_el_nombre_repetido_gana_el_404_de_la_rutina', () => {
  // El 409 del nombre va el último, como al crear el programa.
  crear_programa(cliente, { nombre: 'Torso pierna' })
  const [push, oculta] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  expect(cliente.delete(`/rutinas/${oculta}?modo=ocultar`).status_code).toBe(204)
  const programa = crear_programa(cliente, { dias: [[1, push]] }).id

  const respuesta = guardar_semana(programa, 'Torso pierna', [[1, oculta]])

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([404, NO_SE_PUEDE_ELEGIR])
  expect(como_esta(programa)).toEqual(['Push Pull Leg', { 1: 'Push' }])
})

test('un_dia_que_no_cambia_vale_aunque_su_rutina_este_oculta', () => {
  // La web manda la semana entera: si un día con una rutina oculta bloqueara el guardado, no
  // se podría cambiar ningún otro día sin perder ese.
  const [push, pull, leg] = ['Push', 'Pull', 'Leg'].map((nombre) => crear_rutina(cliente, nombre))
  const programa = crear_programa(cliente, {
    dias: [
      [1, push],
      [3, pull],
    ],
  }).id
  expect(cliente.delete(`/rutinas/${push}?modo=ocultar`).status_code).toBe(204)

  const respuesta = guardar_semana(programa, 'Push Pull Leg', [
    [1, push],
    [3, leg],
  ])

  expect(respuesta.status_code).toBe(200)
  expect(rutinas_por_dia(respuesta.json())).toEqual({ 1: 'Push', 3: 'Leg' })
})

test('dias_repetidos_al_guardar_dan_422_y_no_cambian_nada', () => {
  const [push, pull] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Pull')]
  const programa = crear_programa(cliente, { dias: [[1, push]] }).id

  const respuesta = guardar_semana(programa, 'Otro', [
    [2, push],
    [2, pull],
  ])

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((e: any) => e.msg)).toEqual([
    'Value error, Hay días repetidos, y un día no puede tener dos rutinas.',
  ])
  expect(como_esta(programa)).toEqual(['Push Pull Leg', { 1: 'Push' }])
})

test('sin_dias_solo_cambia_el_nombre', () => {
  // Sin `dias` no se tocan; con `dias: []`, la semana entera pasa a descanso.
  const push = crear_rutina(cliente, 'Push')
  const programa = crear_programa(cliente, {
    dias: [
      [1, push],
      [4, push],
    ],
  }).id

  const respuesta = cliente.put(`/programas/${programa}`, { json: { nombre: 'Otro', dias: null } })

  expect(respuesta.status_code).toBe(200)
  expect(como_esta(programa)).toEqual(['Otro', { 1: 'Push', 4: 'Push' }])
  expect(guardar_semana(programa, 'Otro', []).status_code).toBe(200)
  expect(como_esta(programa)).toEqual(['Otro', {}])
})

test('guardar_varios_dias_de_un_programa_que_nunca_estuvo_activo_no_cierra_filas', () => {
  // Sin pasado que conservar, cada día que cambia sustituye su fila o la quita.
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const programa = crear_programa(cliente, {
    dias: [
      [1, push],
      [3, push],
    ],
  }).id

  const respuesta = guardar_semana(programa, 'Push Pull Leg', [
    [1, leg],
    [5, leg],
  ])

  expect(respuesta.status_code).toBe(200)
  expect(Object.fromEntries([1, 3, 5].map((dia) => [dia, filas_del_dia(programa, dia)]))).toEqual({
    1: [[leg, null, null]],
    3: [],
    5: [[leg, null, null]],
  })
})

test('guardar_varios_dias_de_un_programa_activo_los_cambia_desde_hoy', () => {
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const programa = crear_programa(cliente, {
    dias: [
      [1, push],
      [3, push],
    ],
  }).id
  activo_desde_hace(programa, 14)

  const respuesta = guardar_semana(programa, 'Push Pull Leg', [
    [1, leg],
    [5, leg],
  ])

  expect(respuesta.status_code).toBe(200)
  expect(Object.fromEntries([1, 3, 5].map((dia) => [dia, filas_del_dia(programa, dia)]))).toEqual({
    1: [
      [push, null, hoy()],
      [leg, hoy(), null],
    ],
    3: [[push, null, hoy()]],
    5: [[leg, hoy(), null]],
  })
})

// --- Las rutinas ocultas o borradas y sus días ---------------------------

test('ocultar_una_rutina_no_la_quita_de_los_dias_que_la_tienen', () => {
  // Así ocultar sigue siendo reversible: al volver a mostrarla, el día está como estaba. El
  // día la enseña con su fecha de oculta, para pintarla en gris.
  const push = crear_rutina(cliente)
  const programa = crear_programa(cliente, { dias: [[1, push]] })

  expect(cliente.delete(`/rutinas/${push}?modo=ocultar`).status_code).toBe(204)

  const [dia] = cliente.get(`/programas/${programa.id}`).json().dias
  expect(dia.rutina.id).toBe(push)
  expect(dia.rutina.oculto_desde).toBe(hoy())
})

test('borrar_una_rutina_sin_historial_la_quita_de_sus_dias', () => {
  // Estar en un programa no bloquea el borrado: el día pasa a descanso.
  const push = crear_rutina(cliente)
  const programa = crear_programa(cliente, {
    dias: [
      [1, push],
      [4, push],
    ],
  })

  expect(cliente.delete(`/rutinas/${push}`).status_code).toBe(204)

  expect(cliente.get(`/programas/${programa.id}`).json().dias).toEqual([])
})

// --- Activar y desactivar ------------------------------------------------
//
// Qué programa está activo se guarda en periodos de `desde` a `hasta` (sin incluirlo). Los
// escenarios con un periodo que empezó hace días se montan insertándolo a mano, porque por
// la API todo empieza hoy.

function activo_desde_hace(programa_id: number, dias: number): void {
  insertar(bd, 'programa_periodos', { programa_id, desde: sumar(hoy(), -dias), hasta: null })
}

function periodos(programa_id: number): [string, string | null][] {
  return bd
    .todas<{ desde: string; hasta: string | null }>(
      'SELECT desde, hasta FROM programa_periodos WHERE programa_id = ? ORDER BY desde',
      programa_id,
    )
    .map((p) => [p.desde, p.hasta])
}

test('crear_un_programa_activo', () => {
  const respuesta = cliente.post('/programas', { json: { nombre: 'PPL', activar: true } })

  expect(respuesta.json().activo).toBe(true)
  expect(respuesta.json().ultimo_periodo).toEqual({ desde: hoy(), hasta: null })
})

test('activar_otro_programa_cierra_hoy_el_periodo_del_anterior', () => {
  const anterior = crear_programa(cliente, { nombre: 'Anterior' })
  activo_desde_hace(anterior.id, 30)
  const nuevo = crear_programa(cliente, { nombre: 'Nuevo' })

  const respuesta = cliente.post(`/programas/${nuevo.id}/activar`)

  expect(respuesta.json().ultimo_periodo).toEqual({ desde: hoy(), hasta: null })
  expect(cliente.get(`/programas/${anterior.id}`).json().activo).toBe(false)
  // Hoy ya le toca al nuevo: el anterior cubre hasta ayer.
  expect(periodos(anterior.id)).toEqual([[sumar(hoy(), -30), hoy()]])
})

test('nunca_hay_dos_programas_activos', () => {
  for (const nombre of ['A', 'B', 'C']) {
    cliente.post('/programas', { json: { nombre, activar: true } })
  }

  const activos = cliente
    .get('/programas')
    .json()
    .filter((p: any) => p.activo)
    .map((p: any) => p.nombre)

  expect(activos).toEqual(['C'])
})

test('volver_a_activar_el_mismo_dia_reabre_el_periodo', () => {
  // Desactivar por error y corregirlo no parte el periodo en dos: se reabre, en la base y en
  // lo que responde cada paso.
  const programa = crear_programa(cliente)
  activo_desde_hace(programa.id, 10)

  const desactivado = cliente.post(`/programas/${programa.id}/desactivar`).json()
  const reactivado = cliente.post(`/programas/${programa.id}/activar`).json()

  expect(desactivado.ultimo_periodo).toEqual(periodo(10, 0))
  expect(reactivado.ultimo_periodo).toEqual(periodo(10))
  expect(periodos(programa.id)).toEqual([[sumar(hoy(), -10), null]])
})

test('activar_el_que_ya_esta_activo_no_hace_nada', () => {
  const programa = crear_programa(cliente)
  activo_desde_hace(programa.id, 5)

  cliente.post(`/programas/${programa.id}/activar`)

  expect(periodos(programa.id)).toEqual([[sumar(hoy(), -5), null]])
})

test('desactivar_uno_que_no_esta_activo_no_hace_nada', () => {
  // Ni en él ni en el que sí está activo: cerrar "el periodo abierto" sin mirar de qué
  // programa es desactivaría el otro.
  const activo = crear_programa(cliente, { nombre: 'Activo' })
  activo_desde_hace(activo.id, 5)
  const programa = crear_programa(cliente, { nombre: 'Inactivo' })

  const respuesta = cliente.post(`/programas/${programa.id}/desactivar`)

  expect(respuesta.status_code).toBe(200)
  expect(periodos(programa.id)).toEqual([])
  expect(periodos(activo.id)).toEqual([[sumar(hoy(), -5), null]])
})

test('un_programa_oculto_no_se_puede_activar', () => {
  const programa = crear_programa(cliente)
  ocultar_programa(programa.id)

  const respuesta = cliente.post(`/programas/${programa.id}/activar`)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, PROGRAMA_OCULTO])
  expect(periodos(programa.id)).toEqual([])
})

test.each(['desactivarlo', 'activar otro', 'ocultarlo'])(
  'un_programa_activo_que_empieza_despues_de_hoy_se_puede_sacar_de_uso (%s)',
  (accion) => {
    // Un periodo abierto con `desde` posterior a hoy ya no entra por importar (422), pero
    // puede salir de un reloj que va hacia atrás (en el móvil, al cambiar la fecha del
    // teléfono): se mete directamente en la base. Desactivar, activar otro u ocultar cierran
    // el periodo, y cerrarlo hoy dejaría `hasta < desde`, que viola
    // `programa_periodos_rango_check`: antes daba un 500. Como no llegó a cubrir ningún día,
    // se borra, igual que uno que empezó hoy.
    reloj.fijar(HOY)
    const ids: Record<string, number> = {}
    for (const nombre of ['PPL', 'Otro']) {
      ids[nombre] = cliente.post('/programas', { json: { nombre } }).json().id
    }
    insertar(bd, 'programa_periodos', { programa_id: ids.PPL, desde: '2026-09-20', hasta: null })
    const ruta = `/programas/${ids.PPL}`
    expect(cliente.get(ruta).json().activo).toBe(true)

    const [peticion, codigo] = {
      desactivarlo: [() => cliente.post(`${ruta}/desactivar`), 200],
      'activar otro': [() => cliente.post(`/programas/${ids.Otro}/activar`), 200],
      ocultarlo: [() => cliente.delete(`${ruta}?modo=ocultar`), 204],
    }[accion] as [() => ReturnType<Cliente['get']>, number]

    const respuesta = peticion()

    expect(respuesta.status_code).toBe(codigo)
    expect(cliente.get(ruta).json().activo).toBe(false)
    const filas = bd
      .todas<{ programa_id: number; desde: string; hasta: string | null }>(
        'SELECT programa_id, desde, hasta FROM programa_periodos',
      )
      .map((p) => [p.programa_id, p.desde, p.hasta])
    const esperado = accion === 'activar otro' ? [[ids.Otro, HOY, null]] : []
    expect(filas).toEqual(esperado)
  },
)

test('la_base_de_datos_no_admite_dos_periodos_abiertos', () => {
  // La red por debajo de la comprobación del endpoint: el índice único parcial
  // `ix_programa_periodos_abierto`, sobre la expresión `(hasta IS NULL)`. Es su única red:
  // ningún endpoint deja llegar a dos abiertos.
  const [uno, otro] = [
    crear_programa(cliente, { nombre: 'Uno' }),
    crear_programa(cliente, { nombre: 'Otro' }),
  ]
  activo_desde_hace(uno.id, 3)

  expect(() =>
    insertar(bd, 'programa_periodos', { programa_id: otro.id, desde: hoy(), hasta: null }),
  ).toThrow('ix_programa_periodos_abierto')
})

// --- Ocultar, mostrar y borrar -------------------------------------------

test('ocultar_el_programa_activo_lo_desactiva_y_mostrarlo_no_lo_reactiva', () => {
  const programa = cliente.post('/programas', { json: { nombre: 'PPL', activar: true } }).json()
  const ruta = `/programas/${programa.id}`

  expect(cliente.delete(`${ruta}?modo=ocultar`).status_code).toBe(204)
  const oculto = cliente.get(ruta).json()
  const mostrado = cliente.post(`${ruta}/mostrar`).json()

  expect([oculto.activo, oculto.oculto_desde]).toEqual([false, hoy()])
  expect([mostrado.activo, mostrado.oculto_desde]).toEqual([false, null])
})

test('ocultar_un_programa_que_no_esta_activo_no_desactiva_el_activo', () => {
  // Ocultar el activo lo desactiva; ocultar otro no toca al activo.
  const activo = crear_programa(cliente, { nombre: 'Activo' })
  activo_desde_hace(activo.id, 5)
  const otro = crear_programa(cliente, { nombre: 'Otro' })

  ocultar_programa(otro.id)

  expect(cliente.get(`/programas/${activo.id}`).json().activo).toBe(true)
  expect(periodos(activo.id)).toEqual([[sumar(hoy(), -5), null]])
})

test('un_programa_que_nunca_estuvo_activo_se_borra_directo', () => {
  const programa = crear_programa(cliente, { dias: [[1, crear_rutina(cliente)]] })

  expect(cliente.delete(`/programas/${programa.id}`).status_code).toBe(204)
  expect(cliente.get(`/programas/${programa.id}`).status_code).toBe(404)
})

test('borrar_en_definitivo_un_programa_se_lleva_sus_dias_y_periodos', () => {
  // Test de regresión: daba un 500 (`NotNullViolation` en `programa_periodos.programa_id`).
  // El endpoint lee `programa.periodos` para decidir si pedir `modo`, y con esa lista ya
  // cargada `passive_deletes=True` no basta: SQLAlchemy intentaba poner a NULL la FK de los
  // periodos en vez de borrarlos. Se arregló con `cascade="all, delete-orphan"` en las dos
  // relaciones.
  //
  // El lunes cambia de rutina antes de borrar: también se van las filas ya cerradas.
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const programa = crear_programa(cliente, { dias: [[1, push]] })
  activo_desde_hace(programa.id, 20)
  expect(cambiar_dias(cliente, programa.id, { 1: leg }).status_code).toBe(200)
  expect(filas_del_dia(programa.id, 1)).toHaveLength(2)

  const respuesta = cliente.delete(`/programas/${programa.id}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  for (const tabla of ['programa_dias', 'programa_periodos']) {
    expect(contar(bd, tabla)).toBe(0)
  }
})

test('un_programa_oculto_se_puede_borrar', () => {
  const programa = crear_programa(cliente)
  ocultar_programa(programa.id)

  expect(cliente.delete(`/programas/${programa.id}`).status_code).toBe(204)
  expect(cliente.get(`/programas/${programa.id}`).status_code).toBe(404)
})

test('un_programa_oculto_que_estuvo_activo_sigue_pidiendo_modo_para_borrarlo', () => {
  // Estar oculto no quita el historial: sus periodos siguen protegidos.
  const programa = crear_programa(cliente)
  activo_desde_hace(programa.id, 20)
  ocultar_programa(programa.id)
  const ruta = `/programas/${programa.id}`

  const sin_modo = cliente.delete(ruta)
  expect([sin_modo.status_code, sin_modo.json().detail]).toEqual([409, PIDE_MODO.programa])
  expect(cliente.delete(`${ruta}?modo=definitivo`).status_code).toBe(204)
  expect(cliente.get(ruta).status_code).toBe(404)
})

// --- Editar un programa no cambia el pasado ------------------------------
//
// Cada día de programa tiene vigencia: cambiarlo cierra la fila de antes y abre otra desde
// hoy. Se comprueba mirando lo que devuelve /plan/seguimiento para los días pasados, que es
// lo que pinta el calendario.

function rutina_del_dia(fecha: string): string | null {
  const dia = cliente.get('/plan/seguimiento', { params: { desde: fecha, hasta: fecha } }).json()[0]
  return dia.rutina ? dia.rutina.nombre : null
}

/** Hace una semana: el mismo día de la semana que hoy, ya en el pasado. */
function mismo_dia_de_la_semana_pasada(): string {
  return sumar(hoy(), -7)
}

/** Las filas de ese día de la semana, por orden de creación: `[rutina_id, desde, hasta]`. */
function filas_del_dia(
  programa_id: number,
  dia_semana: number,
): [number, string | null, string | null][] {
  return bd
    .todas<{ rutina_id: number; desde: string | null; hasta: string | null }>(
      'SELECT rutina_id, desde, hasta FROM programa_dias WHERE programa_id = ? AND dia_semana = ? ORDER BY id',
      programa_id,
      dia_semana,
    )
    .map((f) => [f.rutina_id, f.desde, f.hasta])
}

test('cambiar_un_dia_de_un_programa_activo_no_cambia_los_dias_pasados', () => {
  // El que caza que el plan se resuelva con la plantilla de hoy en vez de con la fila vigente
  // cada día.
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const dia = isoweekday(hoy())
  const programa = crear_programa(cliente, { dias: [[dia, push]] })
  activo_desde_hace(programa.id, 14)

  expect(cambiar_dias(cliente, programa.id, { [dia]: leg }).status_code).toBe(200)

  expect(rutina_del_dia(mismo_dia_de_la_semana_pasada())).toBe('Push')
  expect(rutina_del_dia(hoy())).toBe('Leg')
  expect(rutina_del_dia(sumar(hoy(), 7))).toBe('Leg')
})

test('dejar_en_descanso_un_dia_no_cambia_los_dias_pasados', () => {
  const push = crear_rutina(cliente, 'Push')
  const dia = isoweekday(hoy())
  const programa = crear_programa(cliente, { dias: [[dia, push]] })
  activo_desde_hace(programa.id, 14)

  expect(cambiar_dias(cliente, programa.id, { [dia]: null }).status_code).toBe(200)

  expect(rutina_del_dia(mismo_dia_de_la_semana_pasada())).toBe('Push')
  expect(rutina_del_dia(hoy())).toBeNull()
  // Ya es descanso: quitarlo otra vez no cambia nada, aunque quede su fila cerrada.
  expect(cambiar_dias(cliente, programa.id, { [dia]: null }).status_code).toBe(200)
  expect(filas_del_dia(programa.id, dia)).toEqual([[push, null, hoy()]])
})

test('anadir_un_dia_no_cambia_los_dias_pasados', () => {
  const push = crear_rutina(cliente, 'Push')
  const dia = isoweekday(hoy())
  const programa = crear_programa(cliente)
  activo_desde_hace(programa.id, 14)

  expect(cambiar_dias(cliente, programa.id, { [dia]: push }).status_code).toBe(200)

  expect(rutina_del_dia(mismo_dia_de_la_semana_pasada())).toBeNull()
  expect(rutina_del_dia(hoy())).toBe('Push')
})

test('un_programa_que_ya_no_esta_activo_conserva_su_pasado_al_editarlo', () => {
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const dia = isoweekday(hoy())
  const programa = crear_programa(cliente, { dias: [[dia, push]] })
  insertar(bd, 'programa_periodos', {
    programa_id: programa.id,
    desde: sumar(hoy(), -14),
    hasta: sumar(hoy(), -3),
  })

  expect(cambiar_dias(cliente, programa.id, { [dia]: leg }).status_code).toBe(200)

  expect(rutina_del_dia(mismo_dia_de_la_semana_pasada())).toBe('Push')
})

test('cambiar_dos_veces_el_mismo_dia_hoy_no_deja_filas_vacias', () => {
  // La fila abierta hoy no llegó a valer para ningún día: se sustituye, no se cierra en el
  // mismo día que empezó.
  const [push, pull, leg] = ['Push', 'Pull', 'Leg'].map((nombre) => crear_rutina(cliente, nombre))
  const programa = crear_programa(cliente, { dias: [[1, push]] })
  activo_desde_hace(programa.id, 14)

  expect(cambiar_dias(cliente, programa.id, { 1: pull }).status_code).toBe(200)
  expect(cambiar_dias(cliente, programa.id, { 1: leg }).status_code).toBe(200)

  expect(filas_del_dia(programa.id, 1)).toEqual([
    [push, null, hoy()],
    [leg, hoy(), null],
  ])
})

test.each([
  [1, 'la misma rutina'],
  [3, 'otra vez descanso'],
])('un_dia_que_llega_igual_no_parte_el_dia (%i, %s)', (dia) => {
  // El lunes con Push y el miércoles de descanso llegan como estaban: no se abre ni se
  // cierra ninguna fila (antes, quitar otra vez un día de descanso daba 404).
  const push = crear_rutina(cliente, 'Push')
  const programa = crear_programa(cliente, { dias: [[1, push]] })
  activo_desde_hace(programa.id, 14)

  const respuesta = cambiar_dias(cliente, programa.id, { [dia]: dia === 1 ? push : null })

  expect(respuesta.status_code).toBe(200)
  expect({ 1: filas_del_dia(programa.id, 1), 3: filas_del_dia(programa.id, 3) }).toEqual({
    1: [[push, null, null]],
    3: [],
  })
})

test('el_programa_solo_ensena_sus_dias_vigentes', () => {
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const programa = crear_programa(cliente, {
    dias: [
      [1, push],
      [3, push],
    ],
  })
  activo_desde_hace(programa.id, 14)

  expect(cambiar_dias(cliente, programa.id, { 1: leg }).status_code).toBe(200)
  expect(cambiar_dias(cliente, programa.id, { 3: null }).status_code).toBe(200)

  expect(rutinas_por_dia(cliente.get(`/programas/${programa.id}`).json())).toEqual({ 1: 'Leg' })
})

test('num_programas_solo_cuenta_dias_vigentes', () => {
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const programa = crear_programa(cliente, { dias: [[1, push]] })
  activo_desde_hace(programa.id, 14)

  expect(cambiar_dias(cliente, programa.id, { 1: leg }).status_code).toBe(200)

  expect(cliente.get(`/rutinas/${push}`).json().num_programas).toBe(0)
  expect(cliente.get(`/rutinas/${leg}`).json().num_programas).toBe(1)
})

test('la_base_no_admite_dos_filas_vigentes_del_mismo_dia', () => {
  // Las cerradas sí conviven; dos abiertas del mismo día, no.
  const [push, leg] = [crear_rutina(cliente, 'Push'), crear_rutina(cliente, 'Leg')]
  const programa = crear_programa(cliente, { dias: [[1, push]] })

  expect(() =>
    insertar(bd, 'programa_dias', {
      programa_id: programa.id,
      dia_semana: 1,
      rutina_id: leg,
      desde: sumar(hoy(), -30),
      hasta: sumar(hoy(), -20),
    }),
  ).not.toThrow()
  // Que salte el índice que se prueba y no otra restricción: en SQLite el error de un índice
  // parcial nombra las columnas, no el índice.
  expect(() =>
    insertar(bd, 'programa_dias', { programa_id: programa.id, dia_semana: 1, rutina_id: leg }),
  ).toThrow('UNIQUE constraint failed: programa_dias.programa_id, programa_dias.dia_semana')
})

// --- El último periodo de uso (lo que pinta la lista de programas) ---------
//
// `ultimo_periodo` es el abierto si está activo; si no, el último que se cerró; nulo si
// nunca se usó. Además de la fecha, le dice a la pantalla del programa qué diálogo de borrar
// enseñar (nulo = se borra directo).

/** El periodo como sale en la API, con las fechas contadas en días hacia atrás. */
function periodo(desde_hace: number, hasta_hace: number | null = null) {
  const hasta = hasta_hace === null ? null : sumar(hoy(), -hasta_hace)
  return { desde: sumar(hoy(), -desde_hace), hasta }
}

function periodo_cerrado(programa_id: number, desde_hace: number, hasta_hace: number): void {
  insertar(bd, 'programa_periodos', {
    programa_id,
    desde: sumar(hoy(), -desde_hace),
    hasta: sumar(hoy(), -hasta_hace),
  })
}

test('con_dos_periodos_cerrados_el_ultimo_es_el_mas_reciente', () => {
  // El más reciente se inserta primero, con el id más bajo: el último es el de `desde`
  // mayor, no el último que se guardó.
  const programa = crear_programa(cliente)
  periodo_cerrado(programa.id, 30, 10)
  periodo_cerrado(programa.id, 90, 60)

  const respuesta = cliente.get(`/programas/${programa.id}`).json()

  expect(respuesta.activo).toBe(false)
  expect(respuesta.ultimo_periodo).toEqual(periodo(30, 10))
})

test('activar_y_desactivar_el_mismo_dia_no_deja_rastro', () => {
  // El periodo que no llegó a cubrir ningún día se borra en vez de cerrarse: también tiene
  // que desaparecer de la respuesta del propio desactivar, no solo al volver a leerlo.
  const programa = crear_programa(cliente)
  const activado = cliente.post(`/programas/${programa.id}/activar`).json()

  const desactivado = cliente.post(`/programas/${programa.id}/desactivar`).json()

  expect(activado.ultimo_periodo).toEqual(periodo(0))
  expect([desactivado.activo, desactivado.ultimo_periodo]).toEqual([false, null])
  expect(cliente.get(`/programas/${programa.id}`).json().ultimo_periodo).toBeNull()
  expect(periodos(programa.id)).toEqual([])
})

test('ocultar_el_activo_cierra_su_ultimo_periodo_el_dia_en_que_se_oculta', () => {
  const programa = crear_programa(cliente)
  activo_desde_hace(programa.id, 10)

  ocultar_programa(programa.id)

  expect(cliente.get(`/programas/${programa.id}`).json().ultimo_periodo).toEqual(periodo(10, 0))
})

test('el_ultimo_periodo_sale_en_los_listados_y_en_el_detalle', () => {
  // Cada programa con el suyo, y no el de otro: el listado los carga todos de una vez y se
  // podrían cruzar.
  const activo = cliente.post('/programas', { json: { nombre: 'A activo', activar: true } }).json()
  const usado = crear_programa(cliente, { nombre: 'B usado' })
  periodo_cerrado(usado.id, 40, 20)
  crear_programa(cliente, { nombre: 'C sin usar' })
  const oculto = crear_programa(cliente, { nombre: 'D oculto' })
  periodo_cerrado(oculto.id, 80, 50)
  ocultar_programa(oculto.id)

  const visibles = Object.fromEntries(
    cliente
      .get('/programas')
      .json()
      .map((p: any) => [p.nombre, p.ultimo_periodo]),
  )
  const ocultos = cliente.get('/programas', { params: { ocultos: true } }).json()

  expect(visibles).toEqual({
    'A activo': periodo(0),
    'B usado': periodo(40, 20),
    'C sin usar': null,
  })
  expect(ocultos.map((p: any) => [p.nombre, p.ultimo_periodo])).toEqual([
    ['D oculto', periodo(80, 50)],
  ])
  for (const [programa, esperado] of [
    [activo, periodo(0)],
    [usado, periodo(40, 20)],
  ] as const) {
    expect(cliente.get(`/programas/${programa.id}`).json().ultimo_periodo).toEqual(esperado)
  }
})
