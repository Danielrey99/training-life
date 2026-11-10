/**
 * El objetivo de cada ejercicio de un hueco: el principal y cada alternativa llevan el suyo,
 * en la unidad de su tipo.
 *
 * Puerto de `backend/tests/test_objetivos.py`.
 *
 * El objetivo son unas series y un par mínimo-máximo: de repeticiones (`reps_min` y
 * `reps_max`) para los ejercicios de peso y repeticiones o de peso corporal, o de duración en
 * segundos (`duracion_min_s` y `duracion_max_s`) para los de tiempo y los de cardio.
 * Exactamente un par, y completo (la validación da 422, y la base tiene un CHECK por si
 * acaso). Qué par toca lo decide el tipo del ejercicio: lo comprueba el endpoint, con un 422
 * que nombra el ejercicio, después de los 404 y antes de los 409.
 *
 * El objetivo de una alternativa vive en su fila de `slot_alternativas`: el PUT de un hueco la
 * actualiza en su sitio (si la borrara y la volviera a crear, el `UNIQUE(slot_id,
 * ejercicio_id)` daría un 500) y sin lista no la toca.
 *
 * Importar y exportar, en `datos.test.ts`.
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  CAMPOS_DEL_OBJETIVO,
  ELEGIDO_YA_NO_EXISTE,
  alternativa,
  crear_ejercicio,
  crear_rutina,
  cuantas_filas,
  entrenar,
  esperar_estado,
  objetivo,
  objetivo_de,
} from '../apoyo/ayudas'
import { crearCliente, hoy, type ClienteDeTest as Cliente } from '../apoyo/cliente'
import { grupo_muscular_id } from '../apoyo/conftest'
import { filaAlternativa, filaHueco, insertar } from '../apoyo/filas'

const UNO_DE_LOS_DOS =
  'El objetivo lleva repeticiones o tiempo, uno de los dos, con su mínimo y su máximo.'
const EN_SEGUNDOS =
  'El objetivo de «Plancha con lastre» va en tiempo y no en repeticiones, porque «Plancha con' +
  ' lastre» se apunta por tiempo.'
const EN_REPETICIONES =
  'El objetivo de «Dominadas en anillas» va en repeticiones y no en tiempo, porque «Dominadas en' +
  ' anillas» se apunta con repeticiones y carga.'
const EN_SEGUNDOS_CARDIO =
  'El objetivo de «Cinta» va en tiempo y no en repeticiones, porque «Cinta» se apunta por tiempo' +
  ' y, si se quiere, distancia.'
const EN_REPETICIONES_PRESS =
  'El objetivo de «Press banca» va en repeticiones y no en tiempo, porque «Press banca» se apunta' +
  ' con peso y repeticiones.'
const EN_SEGUNDOS_OBJ = objetivo(3, { duracion: [30, 60] })
const EN_REPS_OBJ = objetivo(3, [6, 10])

type Obj = Record<string, number | null>
type Alt = Record<string, unknown>

// --- Ayudantes -----------------------------------------------------------

let cliente: Cliente
let bd: Bd

/** Un ejercicio de cada tipo (y otro de peso y repeticiones) y una rutina vacía. */
let e: {
  press: number
  remo: number
  dominadas: number
  plancha: number
  cinta: number
  rutina: number
  existente: number
}

beforeEach(() => {
  ;({ cliente, bd } = crearCliente())
  const grupo = grupo_muscular_id(cliente)
  e = {
    press: crear_ejercicio(cliente, grupo, 'Press banca'),
    remo: crear_ejercicio(cliente, grupo, 'Remo'),
    dominadas: crear_ejercicio(cliente, grupo, 'Dominadas en anillas', { tipo: 'corporal' }),
    plancha: crear_ejercicio(cliente, grupo, 'Plancha con lastre', { tipo: 'tiempo' }),
    cinta: crear_ejercicio(cliente, grupo, 'Cinta', { tipo: 'cardio' }),
    rutina: crear_rutina(cliente, 'Mixta'),
    existente: 0,
  }
})

interface Opciones {
  principal: number
  obj?: Obj
  /** `undefined` no la manda; `null` la manda nula. */
  alternativas?: Alt[] | null
  orden?: number
}

function cuerpo({ principal, obj = EN_REPS_OBJ, alternativas, ...campos }: Opciones) {
  const resultado: Record<string, unknown> = {
    ejercicio_principal_id: principal,
    ...obj,
    ...campos,
  }
  if (alternativas !== undefined) resultado.alternativas = alternativas
  return resultado
}

function anadir(rutina: number, opciones: Opciones) {
  return cliente.post(`/rutinas/${rutina}/slots`, { json: cuerpo(opciones) })
}

function anadido(rutina: number, opciones: Opciones): any {
  const respuesta = anadir(rutina, opciones)
  esperar_estado(respuesta, 201)
  return respuesta.json()
}

function editar(rutina: number, slot: number, { orden = 1, ...opciones }: Opciones) {
  return cliente.put(`/rutinas/${rutina}/slots/${slot}`, {
    json: cuerpo({ ...opciones, orden }),
  })
}

function hueco_guardado(rutina: number, slot: number): any {
  return cliente
    .get(`/rutinas/${rutina}`)
    .json()
    .slots.find((h: any) => h.id === slot)
}

/** (ejercicio, objetivo) de cada alternativa de un hueco de la API, en su orden. */
function alternativas_de(hueco: any): [number, Obj][] {
  return hueco.alternativas.map((a: any) => [a.ejercicio.id, objetivo_de(a)])
}

/**
 * `ejercicio_id → [id de la fila, objetivo]` de las alternativas del hueco, leídas de la base:
 * para ver si una fila se conservó o se volvió a crear.
 */
function filas(slot_id: number): Record<number, [number, (number | null)[]]> {
  return Object.fromEntries(
    bd
      .todas<Record<string, number | null>>(
        `SELECT id, ejercicio_id, ${CAMPOS_DEL_OBJETIVO.join(', ')} FROM slot_alternativas WHERE slot_id = ?`,
        slot_id,
      )
      .map((fila) => [
        fila.ejercicio_id,
        [fila.id as number, CAMPOS_DEL_OBJETIVO.map((c) => fila[c])],
      ]),
  )
}

/** Cuántos huecos y cuántas alternativas hay en toda la base. */
function cuantos(): number[] {
  return cuantas_filas(bd, 'rutina_slots', 'slot_alternativas')
}

// --- El esquema: un par, y completo -------------------------------------------

const SIN_PAR = { series_objetivo: 3 }
const LOS_DOS_PARES = {
  ...SIN_PAR,
  reps_min: 6,
  reps_max: 10,
  duracion_min_s: 30,
  duracion_max_s: 60,
}
const MAL_FORMADOS: [string, Record<string, number>, string][] = [
  ['sin-par', SIN_PAR, UNO_DE_LOS_DOS],
  ['los-dos-pares', LOS_DOS_PARES, UNO_DE_LOS_DOS],
  ['reps-sin-maximo', { ...SIN_PAR, reps_min: 6 }, UNO_DE_LOS_DOS],
  ['duracion-sin-minimo', { ...SIN_PAR, duracion_max_s: 60 }, UNO_DE_LOS_DOS],
  [
    'reps-al-reves',
    { ...SIN_PAR, reps_min: 10, reps_max: 6 },
    'El máximo de repeticiones no puede ser menor que el mínimo.',
  ],
  [
    'duracion-al-reves',
    { ...SIN_PAR, duracion_min_s: 60, duracion_max_s: 30 },
    'El tiempo máximo no puede ser menor que el mínimo.',
  ],
  [
    'duracion-0',
    { ...SIN_PAR, duracion_min_s: 0, duracion_max_s: 30 },
    'Input should be greater than 0',
  ],
  [
    'duracion-de-mas-de-un-dia',
    { ...SIN_PAR, duracion_min_s: 30, duracion_max_s: 86_401 },
    'Input should be less than or equal to 86400',
  ],
]
// Las series objetivo a 0, en `crud.test.ts` (`un_hueco_con_un_cero_da_422`).

test.each([
  ...MAL_FORMADOS.map(([id, obj, lo_que_dice]) => [
    `${id}-principal`,
    obj,
    lo_que_dice,
    'principal',
  ]),
  // La alternativa usa el mismo esquema del objetivo: con un caso se ve que lo usa.
  ['sin-par-alternativa', SIN_PAR, UNO_DE_LOS_DOS, 'alternativa'],
] as [string, Record<string, number>, string, string][])(
  'un_objetivo_mal_formado_da_422_del_esquema_y_no_crea_nada (%s)',
  (_id, obj, lo_que_dice, donde) => {
    // El 422 es el del esquema (una lista de errores de Pydantic) y por lo que se prueba: así
    // no se confunde con el de la familia, que daría la Plancha con lastre con reps.
    const respuesta =
      donde === 'principal'
        ? anadir(e.rutina, { principal: e.plancha, obj })
        : anadir(e.rutina, {
            principal: e.press,
            alternativas: [{ ejercicio_id: e.plancha, ...obj }],
          })

    esperar_estado(respuesta, 422)
    // Un solo error, y entero: los `value_error` son los que la web enseña tal cual.
    expect(respuesta.json().detail.map((x: any) => x.msg.replace(/^Value error, /, ''))).toEqual([
      lo_que_dice,
    ])
    expect(cuantos()).toEqual([0, 0])
  },
)

test.each([
  [1, 1],
  [86_400, 86_400],
] as [number, number][])(
  'la_duracion_del_objetivo_va_de_un_segundo_a_un_dia (%i, %i)',
  (...duracion) => {
    const hueco = anadido(e.rutina, {
      principal: e.plancha,
      obj: objetivo(1, { duracion }),
      alternativas: [alternativa(e.press)],
    })

    expect(objetivo_de(hueco)).toEqual(objetivo(1, { duracion }))
  },
)

// --- La familia del ejercicio decide el par -------------------------------------

type Via = (principal: number, obj: Obj, alternativas: Alt[]) => ReturnType<Cliente['get']>

const _por_post_de_rutina: Via = (principal, obj, alternativas) =>
  cliente.post('/rutinas', {
    json: {
      nombre: 'Otra',
      // El primer hueco está bien: el fallo del segundo no puede dejarlo creado.
      slots: [cuerpo({ principal: e.press }), cuerpo({ principal, obj, alternativas })],
    },
  })

const _por_post_de_hueco: Via = (principal, obj, alternativas) =>
  anadir(e.rutina, { principal, obj, alternativas })

const _por_put_de_hueco: Via = (principal, obj, alternativas) =>
  editar(e.rutina, e.existente, { principal, obj, alternativas })

/** (principal, objetivo, alternativas, mensaje) de cada forma de equivocarse. */
function _equivocados(): Record<string, [number, Obj, Alt[], string]> {
  return {
    'principal-de-tiempo-en-reps': [e.plancha, EN_REPS_OBJ, [], EN_SEGUNDOS],
    'principal-corporal-en-segundos': [e.dominadas, EN_SEGUNDOS_OBJ, [], EN_REPETICIONES],
    'alternativa-de-tiempo-en-reps': [
      e.press,
      EN_REPS_OBJ,
      [alternativa(e.remo), alternativa(e.plancha)],
      EN_SEGUNDOS,
    ],
    'alternativa-corporal-en-segundos': [
      e.plancha,
      EN_SEGUNDOS_OBJ,
      [alternativa(e.dominadas, 3, { duracion: [30, 60] })],
      EN_REPETICIONES,
    ],
    'principal-de-cardio-en-reps': [e.cinta, EN_REPS_OBJ, [], EN_SEGUNDOS_CARDIO],
    'alternativa-de-cardio-en-reps': [
      e.press,
      EN_REPS_OBJ,
      [alternativa(e.cinta)],
      EN_SEGUNDOS_CARDIO,
    ],
    // Peso y repeticiones tiene su propia entrada en `FAMILIA`: no basta con que el corporal
    // esté bien.
    'principal-de-peso-y-reps-en-segundos': [e.press, EN_SEGUNDOS_OBJ, [], EN_REPETICIONES_PRESS],
  }
}

// Las tres vías llaman a la misma comprobación, que recorre igual el principal y las
// alternativas. Lo que no se repite es cada tipo (su familia y cómo se dice en el mensaje), y
// que cada vía la use con un principal y con una alternativa.
const CASOS_POR_VIA: [string, Via, string][] = [
  ['POST-slots-tiempo', _por_post_de_hueco, 'principal-de-tiempo-en-reps'],
  ['POST-slots-peso-y-reps', _por_post_de_hueco, 'principal-de-peso-y-reps-en-segundos'],
  ['POST-slots-alternativa', _por_post_de_hueco, 'alternativa-de-tiempo-en-reps'],
  ['POST-rutinas-principal', _por_post_de_rutina, 'principal-corporal-en-segundos'],
  ['POST-rutinas-alternativa', _por_post_de_rutina, 'alternativa-de-cardio-en-reps'],
  ['PUT-slots-principal', _por_put_de_hueco, 'principal-de-cardio-en-reps'],
  ['PUT-slots-alternativa', _por_put_de_hueco, 'alternativa-corporal-en-segundos'],
]

test.each(CASOS_POR_VIA)(
  'un_objetivo_de_otra_familia_da_422_que_nombra_el_ejercicio_y_no_cambia_nada (%s)',
  (_id, via, caso) => {
    // El hueco que edita el PUT: Remo con Press de alternativa, en repeticiones.
    e.existente = anadido(e.rutina, {
      principal: e.remo,
      alternativas: [alternativa(e.press)],
      orden: 1,
    }).id
    const antes = cliente.get('/rutinas', { params: { ocultas: true } }).json()
    const [principal, obj, alternativas, mensaje] = _equivocados()[caso]

    const respuesta = via(principal, obj, alternativas)

    esperar_estado(respuesta, 422)
    expect(respuesta.json().detail).toBe(mensaje)
    expect(cliente.get('/rutinas', { params: { ocultas: true } }).json()).toEqual(antes)
  },
)

test.each(['principal', 'alternativa'])(
  'un_objetivo_en_segundos_vale_para_un_ejercicio_de_cardio_y_se_guarda (%s)',
  (rol) => {
    // Cardio es de la familia de la duración, como tiempo: su objetivo va en segundos, de
    // principal (con una alternativa de peso y repeticiones) y de alternativa (de un hueco de
    // peso y repeticiones).
    let principal: number, obj: Obj, alternativas: Alt[], esperadas: [number, Obj][]
    if (rol === 'principal') {
      principal = e.cinta
      obj = objetivo(1, { duracion: [900, 1800] })
      alternativas = [alternativa(e.press)]
      esperadas = [[e.press, objetivo(3, [6, 10])]]
    } else {
      principal = e.press
      obj = objetivo(3, [6, 10])
      alternativas = [alternativa(e.cinta, 1, { duracion: [600, 1200] })]
      esperadas = [[e.cinta, objetivo(1, { duracion: [600, 1200] })]]
    }

    const creado = anadido(e.rutina, { principal, obj, alternativas })

    const hueco = hueco_guardado(e.rutina, creado.id)
    expect(objetivo_de(hueco)).toEqual(obj)
    expect(alternativas_de(hueco)).toEqual(esperadas)
    const tipos = [
      hueco.ejercicio_principal.tipo_registro,
      ...hueco.alternativas.map((a: any) => a.ejercicio.tipo_registro),
    ]
    expect(tipos).toContain('cardio')
  },
)

test('una_alternativa_de_otra_familia_con_su_propio_objetivo_se_crea', () => {
  // Un hueco de tiempo con alternativas de repeticiones, y uno de repeticiones con una de
  // tiempo: cada una con el suyo, que no es el del principal.
  const plancha = anadido(e.rutina, {
    principal: e.plancha,
    obj: objetivo(3, { duracion: [30, 45] }),
    alternativas: [alternativa(e.dominadas, 2, [5, 8]), alternativa(e.press, 4, [10, 12])],
  })
  const press = anadido(e.rutina, {
    principal: e.press,
    obj: objetivo(5, [3, 5]),
    alternativas: [alternativa(e.plancha, 2, { duracion: [60, 90] })],
  })

  for (const creado of [plancha, press]) {
    expect(hueco_guardado(e.rutina, creado.id)).toEqual(creado)
  }
  expect(objetivo_de(plancha)).toEqual(objetivo(3, { duracion: [30, 45] }))
  expect(alternativas_de(plancha)).toEqual([
    [e.dominadas, objetivo(2, [5, 8])],
    [e.press, objetivo(4, [10, 12])],
  ])
  expect(objetivo_de(press)).toEqual(objetivo(5, [3, 5]))
  expect(alternativas_de(press)).toEqual([[e.plancha, objetivo(2, { duracion: [60, 90] })]])
  // Cada alternativa trae su ejercicio entero, con su tipo.
  expect(plancha.alternativas.map((a: any) => a.ejercicio.tipo_registro)).toEqual([
    'corporal',
    'peso_reps',
  ])
})

test('una_rutina_nueva_guarda_el_objetivo_de_cada_alternativa', () => {
  const respuesta = cliente.post('/rutinas', {
    json: {
      nombre: 'Core',
      slots: [
        cuerpo({
          principal: e.plancha,
          obj: objetivo(3, { duracion: [30, 45] }),
          alternativas: [alternativa(e.dominadas, 2, [5, 8])],
        }),
        cuerpo({
          principal: e.press,
          obj: objetivo(4, [6, 10]),
          alternativas: [alternativa(e.plancha, 3, { duracion: [20, 40] })],
        }),
      ],
    },
  })

  esperar_estado(respuesta, 201)
  const [uno, dos] = cliente.get(`/rutinas/${respuesta.json().id}`).json().slots
  expect([objetivo_de(uno), alternativas_de(uno)]).toEqual([
    objetivo(3, { duracion: [30, 45] }),
    [[e.dominadas, objetivo(2, [5, 8])]],
  ])
  expect([objetivo_de(dos), alternativas_de(dos)]).toEqual([
    objetivo(4, [6, 10]),
    [[e.plancha, objetivo(3, { duracion: [20, 40] })]],
  ])
})

// --- El orden de los errores: 404, luego 422 de objetivo, luego 409 ------------

test.each(['POST', 'PUT'])(
  'un_ejercicio_que_no_existe_da_404_antes_que_un_objetivo_equivocado (%s)',
  (via) => {
    const slot = anadido(e.rutina, { principal: e.press, orden: 1 }).id
    const antes = cuantos()
    const malas = [alternativa(e.plancha), alternativa(999_999)]

    const respuesta =
      via === 'POST'
        ? anadir(e.rutina, { principal: e.remo, alternativas: malas })
        : editar(e.rutina, slot, { principal: e.press, alternativas: malas })

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([404, ELEGIDO_YA_NO_EXISTE])
    expect(cuantos()).toEqual(antes)
  },
)

test.each(['POST', 'PUT'])(
  'un_objetivo_equivocado_da_422_antes_que_el_409_del_orden (%s)',
  (via) => {
    // El orden 2 ya está ocupado: aun así, lo primero que se dice es el objetivo.
    const slot = anadido(e.rutina, { principal: e.press, orden: 1 }).id
    anadido(e.rutina, { principal: e.remo, orden: 2 })
    const antes = cuantos()

    const respuesta =
      via === 'POST'
        ? anadir(e.rutina, { principal: e.plancha, orden: 2 })
        : editar(e.rutina, slot, { orden: 2, principal: e.plancha })

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([422, EN_SEGUNDOS])
    expect(cuantos()).toEqual(antes)
  },
)

test('un_objetivo_equivocado_da_422_antes_que_el_409_de_ya_es_comodin', () => {
  // Sin lista, pasar a principal un comodín es un 409; si además su objetivo no es de su
  // familia, lo primero es el 422.
  const slot = anadido(e.rutina, {
    principal: e.press,
    alternativas: [alternativa(e.plancha, 3, { duracion: [30, 60] })],
  }).id

  const con_reps = editar(e.rutina, slot, { principal: e.plancha })
  const en_segundos = editar(e.rutina, slot, { principal: e.plancha, obj: EN_SEGUNDOS_OBJ })

  expect([con_reps.status_code, con_reps.json().detail]).toEqual([422, EN_SEGUNDOS])
  expect(en_segundos.status_code).toBe(409)
  expect(en_segundos.json().detail).toBe(
    'Ese ejercicio ya es una alternativa de este. Quítalo de las alternativas antes' +
      ' de hacerlo el principal.',
  )
})

// --- PUT con lista: se actualiza en su sitio ------------------------------------

test('cambiar_el_objetivo_de_una_alternativa_conserva_su_fila', () => {
  // La trampa del `UNIQUE(slot_id, ejercicio_id)`: con el objetivo dentro de la fila, la
  // tentación es borrarla y volverla a crear con el nuevo, e insertar antes de borrar daría
  // un 500. La fila sigue siendo la misma, con el id de antes y el objetivo nuevo, y la otra
  // alternativa no cambia.
  const slot = anadido(e.rutina, {
    principal: e.press,
    alternativas: [
      alternativa(e.remo, 3, [8, 12]),
      alternativa(e.plancha, 3, { duracion: [30, 45] }),
    ],
  }).id
  const antes = filas(slot)

  const respuesta = editar(e.rutina, slot, {
    principal: e.press,
    alternativas: [
      alternativa(e.remo, 3, [8, 12]),
      alternativa(e.plancha, 5, { duracion: [60, 90] }),
    ],
  })

  esperar_estado(respuesta, 200)
  expect(alternativas_de(respuesta.json())).toEqual([
    [e.remo, objetivo(3, [8, 12])],
    [e.plancha, objetivo(5, { duracion: [60, 90] })],
  ])
  const despues = filas(slot)
  const ids = (f: typeof antes) =>
    Object.fromEntries(Object.entries(f).map(([k, [fila_id]]) => [k, fila_id]))
  expect(ids(despues)).toEqual(ids(antes))
  expect(despues[e.remo]).toEqual(antes[e.remo])
  expect(hueco_guardado(e.rutina, slot)).toEqual(respuesta.json())
})

test('una_lista_quita_anade_e_intercambia_principal_y_alternativa_a_la_vez', () => {
  // Press (reps) con Plancha con lastre (segundos) y Dominadas en anillas de alternativas
  // pasa a Plancha con lastre de principal, con Press de alternativa y Remo nuevo: Dominadas
  // en anillas se va, Plancha con lastre deja de ser alternativa y Press lo pasa a ser, cada
  // uno con el objetivo que se manda (no el que tenía en su otro papel).
  const slot = anadido(e.rutina, {
    principal: e.press,
    obj: objetivo(4, [6, 8]),
    alternativas: [alternativa(e.plancha, 3, { duracion: [30, 45] }), alternativa(e.dominadas)],
  }).id

  const respuesta = editar(e.rutina, slot, {
    principal: e.plancha,
    obj: objetivo(3, { duracion: [45, 60] }),
    alternativas: [alternativa(e.press, 2, [10, 12]), alternativa(e.remo, 3, [8, 10])],
  })

  esperar_estado(respuesta, 200)
  const hueco = respuesta.json()
  expect(hueco.ejercicio_principal.id).toBe(e.plancha)
  expect(objetivo_de(hueco)).toEqual(objetivo(3, { duracion: [45, 60] }))
  expect(alternativas_de(hueco)).toEqual([
    [e.press, objetivo(2, [10, 12])],
    [e.remo, objetivo(3, [8, 10])],
  ])
  expect(new Set(Object.keys(filas(slot)).map(Number))).toEqual(new Set([e.press, e.remo]))
  expect(hueco_guardado(e.rutina, slot)).toEqual(hueco)
})

test('el_objetivo_de_una_alternativa_que_se_conserva_tambien_se_valida', () => {
  // Su objetivo viene en el cuerpo, así que se mira aunque no se añada: mandarla con el par
  // de otra familia da 422 y no cambia nada, ni lo bueno de la petición.
  const slot = anadido(e.rutina, {
    principal: e.press,
    alternativas: [alternativa(e.plancha, 3, { duracion: [30, 45] })],
  }).id
  const antes = filas(slot)

  const respuesta = editar(e.rutina, slot, {
    principal: e.press,
    obj: objetivo(9, [1, 2]),
    alternativas: [alternativa(e.plancha), alternativa(e.remo)],
  })

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([422, EN_SEGUNDOS])
  expect(filas(slot)).toEqual(antes)
  expect(objetivo_de(hueco_guardado(e.rutina, slot))).toEqual(objetivo(3, [6, 10]))
})

test('se_puede_cambiar_el_objetivo_de_una_alternativa_ya_oculta', () => {
  // Conservarla no es elegirla («corregir sí, elegir algo oculto no»): su objetivo se puede
  // corregir.
  const slot = anadido(e.rutina, { principal: e.press, alternativas: [alternativa(e.remo)] }).id
  expect(cliente.delete(`/ejercicios/${e.remo}?modo=ocultar`).status_code).toBe(204)
  const [fila_antes] = Object.values(filas(slot)).map(([fila_id]) => fila_id)

  const respuesta = editar(e.rutina, slot, {
    principal: e.press,
    alternativas: [alternativa(e.remo, 5, [1, 3])],
  })

  esperar_estado(respuesta, 200)
  expect(alternativas_de(respuesta.json())).toEqual([[e.remo, objetivo(5, [1, 3])]])
  expect(filas(slot)).toEqual({ [e.remo]: [fila_antes, Object.values(objetivo(5, [1, 3]))] })
})

// --- PUT sin lista: las alternativas no se tocan --------------------------------

test.each(['sin-el-campo', 'nula'])(
  'editar_un_hueco_sin_lista_no_toca_las_alternativas_ni_sus_objetivos (%s)',
  (lista) => {
    // Regresión de G1 (hallazgo del repaso): el PUT copia el cuerpo al hueco campo a campo, y
    // con el `exclude` del nombre viejo de la lista (`alternativa_ids`) copiaba también
    // `alternativas` encima de la propiedad de solo lectura del modelo: un `AttributeError`,
    // un 500, en todos los PUT de un hueco, con lista o sin ella.
    //
    // Aquí cambian el principal y su objetivo, y las alternativas siguen igual, en su orden
    // (no se les copia el objetivo del principal), en las mismas filas.
    //
    // Ojo: el test del backend no llega a mandar `alternativas: null` en el caso «nula» (su
    // ayudante `cuerpo` lo toma por «sin lista» y lo omite); aquí sí se manda el nulo.
    const slot = anadido(e.rutina, {
      principal: e.press,
      alternativas: [
        alternativa(e.remo, 2, [12, 15]),
        alternativa(e.plancha, 3, { duracion: [30, 45] }),
      ],
    }).id
    const antes = filas(slot)

    const respuesta = editar(e.rutina, slot, {
      principal: e.dominadas,
      obj: objetivo(5, [3, 5]),
      ...(lista === 'nula' ? { alternativas: null } : {}),
    })

    esperar_estado(respuesta, 200)
    expect(respuesta.json().ejercicio_principal.id).toBe(e.dominadas)
    expect(objetivo_de(respuesta.json())).toEqual(objetivo(5, [3, 5]))
    expect(alternativas_de(respuesta.json())).toEqual([
      [e.remo, objetivo(2, [12, 15])],
      [e.plancha, objetivo(3, { duracion: [30, 45] })],
    ])
    expect(filas(slot)).toEqual(antes)
  },
)

test('cambiar_el_principal_por_uno_de_otra_familia_pide_su_par_y_borra_el_otro', () => {
  // El PUT es completo: el par que no llega queda nulo. Con el par de antes (reps para la
  // Plancha con lastre) es un 422 y no cambia nada.
  const slot = anadido(e.rutina, { principal: e.press, alternativas: [alternativa(e.remo)] }).id

  const con_reps = editar(e.rutina, slot, { principal: e.plancha })
  expect([con_reps.status_code, con_reps.json().detail]).toEqual([422, EN_SEGUNDOS])
  expect(hueco_guardado(e.rutina, slot).ejercicio_principal.id).toBe(e.press)

  const respuesta = editar(e.rutina, slot, {
    principal: e.plancha,
    obj: objetivo(2, { duracion: [20, 30] }),
  })

  esperar_estado(respuesta, 200)
  expect(objetivo_de(respuesta.json())).toEqual(objetivo(2, { duracion: [20, 30] }))
  const guardado = bd.una<{ reps_min: number | null; reps_max: number | null }>(
    'SELECT reps_min, reps_max FROM rutina_slots WHERE id = ?',
    slot,
  )!
  expect([guardado.reps_min, guardado.reps_max]).toEqual([null, null])
  expect(alternativas_de(respuesta.json())).toEqual([[e.remo, objetivo(3, [6, 10])]])
})

// --- La trampa de la propiedad `alternativas` -------------------------------

test('una_serie_con_una_alternativa_se_valida_por_el_ejercicio_y_no_por_la_fila', () => {
  // Regresión de la trampa del plan: `_validar_slot` mira los ejercicios del hueco con la
  // propiedad `RutinaSlot.alternativas`, que devuelve ejercicios. Si pasara a devolver filas
  // de `slot_alternativas` (que ahora tienen su objetivo, y la tentación es grande),
  // compararía ids de fila con ids de ejercicio sin dar ningún error.
  //
  // Para que se note, la fila de la alternativa (Remo) lleva a propósito el id de otro
  // ejercicio (Dominadas en anillas) que no está en el hueco: con ids de fila, Remo daría 422
  // y Dominadas en anillas colaría.
  const slot = anadido(e.rutina, { principal: e.press }).id
  insertar(bd, 'slot_alternativas', {
    id: e.dominadas,
    slot_id: slot,
    ejercicio_id: e.remo,
    ...objetivo(3, [6, 10]),
  })
  expect(e.dominadas).not.toBe(e.remo)
  const sesion = entrenar(cliente, hoy(), e.rutina).json().id
  const ruta = `/entrenamientos/${sesion}/series`
  const base = { slot_id: slot, numero_serie: 1, peso: 0, repeticiones: 8 }

  const intrusa = cliente.post(ruta, { json: { ...base, ejercicio_id: e.dominadas } })
  const con_la_alternativa = cliente.post(ruta, {
    json: { ...base, ejercicio_id: e.remo, peso: 40 },
  })

  esperar_estado(intrusa, 422)
  expect(intrusa.json().detail).toBe(
    'Ese ejercicio no es ni el de la rutina ni una de sus alternativas.',
  )
  esperar_estado(con_la_alternativa, 201)
})

// --- Duplicar -----------------------------------------------------------------

test('duplicar_copia_el_objetivo_del_principal_y_de_cada_alternativa', () => {
  anadido(e.rutina, {
    principal: e.plancha,
    obj: objetivo(3, { duracion: [30, 45] }),
    alternativas: [alternativa(e.dominadas, 2, [5, 8]), alternativa(e.press, 4, [10, 12])],
  })
  anadido(e.rutina, {
    principal: e.press,
    obj: objetivo(5, [3, 5]),
    alternativas: [alternativa(e.plancha, 1, { duracion: [60, 120] })],
  })
  const original = cliente.get(`/rutinas/${e.rutina}`).json()

  const respuesta = cliente.post(`/rutinas/${e.rutina}/duplicar`)

  esperar_estado(respuesta, 201)

  const lo_que_tiene = (rutina: any) =>
    rutina.slots.map((h: any) => [
      h.orden,
      h.ejercicio_principal.id,
      objetivo_de(h),
      alternativas_de(h),
    ])

  expect(lo_que_tiene(respuesta.json())).toEqual(lo_que_tiene(original))
  // Filas nuevas, no las del original.
  const copia: number[] = respuesta.json().slots.map((h: any) => h.id)
  const ids_de_filas = bd.todas<{ slot_id: number }>(
    `SELECT slot_id FROM slot_alternativas WHERE slot_id IN (${copia.map(() => '?').join(', ')})`,
    ...copia,
  )
  expect(ids_de_filas).toHaveLength(3)
})

// --- Los CHECK de la base -------------------------------------------------------

test.each([
  ['sin-par', 'rutina_slots', SIN_PAR],
  ['los-dos-pares', 'rutina_slots', LOS_DOS_PARES],
  ['reps-sin-maximo', 'rutina_slots', { ...SIN_PAR, reps_min: 6 }],
  ['duracion-sin-maximo', 'rutina_slots', { ...SIN_PAR, duracion_min_s: 30 }],
  ['alternativa-sin-par', 'slot_alternativas', SIN_PAR],
] as [string, string, Record<string, number>][])(
  'la_base_rechaza_un_objetivo_sin_exactamente_un_par_completo (%s)',
  (_id, tabla, obj) => {
    // Lo que la API ya no deja pasar, metido a mano: el CHECK de cada tabla lo para. El test
    // que compara el esquema con los modelos solo mira su nombre, no lo que dice. Que la base
    // admite un par completo de cada clase lo prueba cada hueco que la API guarda.
    const slot = anadido(e.rutina, { principal: e.press, orden: 1 }).id
    // Lo que no se dice queda nulo, como en el modelo.
    const completo = {
      reps_min: null,
      reps_max: null,
      duracion_min_s: null,
      duracion_max_s: null,
      ...obj,
    }

    expect(() =>
      tabla === 'rutina_slots'
        ? filaHueco(bd, e.rutina, e.remo, { orden: 2, ...completo })
        : filaAlternativa(bd, slot, e.remo, completo),
    ).toThrow(`${tabla}_objetivo_check`)
  },
)
