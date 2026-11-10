/**
 * Lo que se hace con una rutina entera: crearla con sus huecos, duplicarla, reordenar sus
 * huecos y listarlas.
 *
 * Puerto de `backend/tests/test_rutinas.py`.
 *
 * Crearla de una vez existe porque la pantalla de rutina nueva no guarda nada hasta Guardar:
 * un fallo a medias no puede dejar una rutina a medias. Duplicar es la forma de que una
 * rutina diverja sin cambiar los programas donde está; reordenar existe porque con PUT
 * sueltos intercambiar dos huecos choca a medias con `UNIQUE(rutina_id, orden)`.
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  esperar_estado,
  ELEGIDO_YA_NO_EXISTE,
  alternativa,
  crear_ejercicio,
  crear_hueco,
  crear_rutina,
  cuantas_filas,
  ejercicio_oculto,
  entrenar,
  ids_de_alternativas,
  nombre_repetido,
  objetivo,
  ocultar_hueco,
  poner_alternativas,
} from '../apoyo/ayudas'
import { ejercicio_predefinido_id, grupo_muscular_id } from '../apoyo/conftest'
import { crearCliente, hoy, type ClienteDeTest as Cliente } from '../apoyo/cliente'

let cliente: Cliente
let bd: Bd
let grupo: number
beforeEach(() => {
  ;({ cliente, bd } = crearCliente())
  grupo = grupo_muscular_id(cliente)
})

// --- Ayudantes -----------------------------------------------------------

function duplicar(rutina_id: number) {
  return cliente.post(`/rutinas/${rutina_id}/duplicar`)
}

function nombre_de_la_copia(rutina_id: number): string {
  const respuesta = duplicar(rutina_id)
  esperar_estado(respuesta, 201)
  return respuesta.json().nombre
}

/**
 * El *Guardar* de la rutina con el orden de sus huecos: `PUT /rutinas/{id}` con el nombre (el
 * que tiene, si no se da otro) y los `slot_ids` en el orden nuevo.
 */
function ordenar(rutina_id: number, slot_ids: number[], nombre?: string) {
  if (nombre === undefined) nombre = cliente.get(`/rutinas/${rutina_id}`).json().nombre
  return cliente.put(`/rutinas/${rutina_id}`, { json: { nombre, slot_ids } })
}

/** El `orden` de cada hueco de la rutina, también de los ocultos. */
function ordenes(rutina_id: number): Record<number, number> {
  return Object.fromEntries(
    cliente
      .get(`/rutinas/${rutina_id}`)
      .json()
      .slots.map((h: any) => [h.id, h.orden]),
  )
}

/** Lo que se copia de cada hueco, sin ids: para comparar original y copia. */
function lo_que_tiene(rutina: any): unknown[][] {
  return rutina.slots.map((hueco: any) => [
    hueco.orden,
    hueco.ejercicio_principal.id,
    hueco.series_objetivo,
    hueco.reps_min,
    hueco.reps_max,
    ids_de_alternativas(hueco),
  ])
}

/**
 * Un hueco dentro del cuerpo de `POST /rutinas`: sin `orden`, que es su posición. Cada
 * comodín, un id (con objetivo de repeticiones) o el cuerpo de su alternativa.
 */
function hueco_nuevo(
  principal: number,
  comodines: (number | Record<string, unknown>)[] = [],
  {
    series = 4,
    reps = [6, 10] as [number, number],
    duracion,
  }: { series?: number; reps?: [number, number]; duracion?: [number, number] } = {},
) {
  return {
    ejercicio_principal_id: principal,
    alternativas: comodines.map((c) => (typeof c === 'number' ? alternativa(c) : c)),
    ...objetivo(series, duracion === undefined ? reps : { duracion }),
  }
}

/**
 * Cuántas rutinas, huecos y comodines hay en la base, también los ocultos: para ver que un
 * fallo no ha dejado nada a medias.
 */
function filas_guardadas(): number[] {
  return cuantas_filas(bd, 'rutinas', 'rutina_slots', 'slot_alternativas')
}

// --- Crear una rutina con sus huecos ----------------------------------------

test('una_rutina_nueva_guarda_sus_huecos_en_el_orden_de_la_lista', () => {
  // El orden sale de la posición en la lista, no de los ids: los ejercicios se crean en un
  // orden y se mandan en otro, y los comodines igual.
  const [a, b, c, d, e, f] = ['Press', 'Aperturas', 'Fondos', 'Cruces', 'Elevaciones', 'Remo'].map(
    (nombre) => crear_ejercicio(cliente, grupo, nombre),
  )
  const cuerpo = {
    nombre: 'Push',
    slots: [
      hueco_nuevo(c, [f, d], { series: 5, reps: [3, 5] }),
      hueco_nuevo(a, [], { series: 3, reps: [8, 12] }),
      hueco_nuevo(b, [e], { series: 2, reps: [15, 20] }),
    ],
  }

  const respuesta = cliente.post('/rutinas', { json: cuerpo })

  esperar_estado(respuesta, 201)
  const rutina = respuesta.json()
  const esperado = [
    [1, c, 5, 3, 5, [f, d]],
    [2, a, 3, 8, 12, []],
    [3, b, 2, 15, 20, [e]],
  ]
  expect(lo_que_tiene(rutina)).toEqual(esperado)
  expect(rutina.num_programas).toBe(0)
  expect(rutina.oculto_desde).toBeNull()
  expect(rutina.slots.every((h: any) => h.oculto_desde === null && h.rutina_id === rutina.id)).toBe(
    true,
  )
  // Y se ha guardado así, no solo respondido.
  expect(lo_que_tiene(cliente.get(`/rutinas/${rutina.id}`).json())).toEqual(esperado)
})

test('una_rutina_nueva_admite_predefinidos_y_el_mismo_ejercicio_en_dos_huecos', () => {
  const predefinido = ejercicio_predefinido_id(bd)
  const propio = crear_ejercicio(cliente, grupo, 'Prensa')
  const cuerpo = {
    nombre: 'Leg',
    slots: [
      hueco_nuevo(predefinido, [propio]),
      hueco_nuevo(propio, [predefinido]),
      hueco_nuevo(predefinido),
    ],
  }

  const respuesta = cliente.post('/rutinas', { json: cuerpo })

  esperar_estado(respuesta, 201)
  expect(lo_que_tiene(respuesta.json())).toEqual([
    [1, predefinido, 4, 6, 10, [propio]],
    [2, propio, 4, 6, 10, [predefinido]],
    [3, predefinido, 4, 6, 10, []],
  ])
})

test('una_rutina_nueva_con_mas_de_100_huecos_da_422_y_no_crea_nada', () => {
  // El tope es de `POST /rutinas`. Cada hueco de la lista se valida con el mismo esquema que
  // uno suelto: sus datos incoherentes (objetivo, comodines), en `huecos.test.ts` y
  // `objetivos.test.ts`.
  const propio = crear_ejercicio(cliente, grupo, 'Prensa')
  const bien = hueco_nuevo(ejercicio_predefinido_id(bd), [propio])

  const respuesta = cliente.post('/rutinas', {
    json: { nombre: 'Push', slots: Array(101).fill(bien) },
  })

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail.map((e: any) => [e.loc, e.type])).toEqual([
    [['body', 'slots'], 'too_long'],
  ])
  expect(filas_guardadas()).toEqual([0, 0, 0])
})

test.each(['principal inexistente', 'comodín oculto en el último hueco'])(
  'una_rutina_nueva_con_un_ejercicio_que_no_vale_da_404_y_no_crea_nada (%s)',
  (caso) => {
    // La atomicidad: los huecos de antes del que falla eran válidos, y aun así no puede
    // quedar ni la rutina ni ninguno de ellos.
    const predefinido = ejercicio_predefinido_id(bd)
    const propio = crear_ejercicio(cliente, grupo, 'Prensa')
    const oculto = crear_ejercicio(cliente, grupo, 'Hack')
    expect(cliente.delete(`/ejercicios/${oculto}?modo=ocultar`).status_code).toBe(204)
    const bien = hueco_nuevo(predefinido, [propio])
    const [huecos, detalle] =
      caso === 'principal inexistente'
        ? [[hueco_nuevo(999_999), bien], ELEGIDO_YA_NO_EXISTE]
        : [[bien, bien, hueco_nuevo(propio, [predefinido, oculto])], ejercicio_oculto('Hack')]

    const respuesta = cliente.post('/rutinas', { json: { nombre: 'Leg', slots: huecos } })

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([404, detalle])
    expect(filas_guardadas()).toEqual([0, 0, 0])
    expect(cliente.get('/rutinas').json()).toEqual([])
  },
)

// --- Duplicar: el nombre --------------------------------------------------

test('duplicar_numera_las_copias_como_windows', () => {
  const push = crear_rutina(cliente, 'Push')

  const nombres = [0, 1, 2].map(() => nombre_de_la_copia(push))

  expect(nombres).toEqual(['Push - copia', 'Push - copia (2)', 'Push - copia (3)'])
})

test('duplicar_una_copia_le_anade_otro_sufijo', () => {
  const copia = duplicar(crear_rutina(cliente, 'Push')).json().id

  expect(nombre_de_la_copia(copia)).toBe('Push - copia - copia')
})

test('el_nombre_de_la_copia_no_repite_el_de_una_rutina_oculta', () => {
  // Si no, al volver a mostrar la oculta habría dos rutinas con el mismo nombre.
  const push = crear_rutina(cliente, 'Push')
  const oculta = crear_rutina(cliente, 'Push - copia')
  expect(cliente.delete(`/rutinas/${oculta}?modo=ocultar`).status_code).toBe(204)

  expect(nombre_de_la_copia(push)).toBe('Push - copia (2)')
})

test('el_nombre_de_la_copia_no_distingue_tildes', () => {
  // Duplicar nunca da 409: compara por la misma clave que crear (las mayúsculas y los
  // espacios, en `la_clave_de_un_nombre_ignora_mayusculas_tildes_y_espacios`). Antes solo
  // miraba mayúsculas, y la copia de «Glúteos» se llamaba como «Gluteos - copia».
  const gluteos = crear_rutina(cliente, 'Glúteos')
  crear_rutina(cliente, 'Gluteos - copia')

  expect(nombre_de_la_copia(gluteos)).toBe('Glúteos - copia (2)')
})

test('un_nombre_de_100_caracteres_se_recorta_y_conserva_el_sufijo', () => {
  const larga = crear_rutina(cliente, 'a'.repeat(100))

  const [primera, segunda] = [nombre_de_la_copia(larga), nombre_de_la_copia(larga)]

  expect(primera).toBe('a'.repeat(92) + ' - copia')
  expect(segunda).toBe('a'.repeat(88) + ' - copia (2)')
  expect(primera).toHaveLength(100)
  expect(segunda).toHaveLength(100)
})

test('al_recortar_el_nombre_no_queda_un_espacio_antes_del_sufijo', () => {
  // El corte cae justo detrás de un espacio: sin el `rstrip` saldría «aaa  - copia», con dos
  // espacios.
  const rutina = crear_rutina(cliente, 'a'.repeat(91) + ' ' + 'b'.repeat(8))

  expect(nombre_de_la_copia(rutina)).toBe('a'.repeat(91) + ' - copia')
})

// --- Duplicar: qué se copia -------------------------------------------------

test('la_copia_lleva_los_huecos_visibles_con_sus_comodines', () => {
  // Los ocultos no se copian. Un ejercicio oculto (de principal o de comodín) sí: la copia
  // es fiel a lo que se ve (decisión del autor).
  const ejercicio: Record<string, number> = {}
  for (const nombre of ['Press', 'Aperturas', 'Fondos', 'Cruces', 'Elevaciones']) {
    ejercicio[nombre] = crear_ejercicio(cliente, grupo, nombre)
  }
  const push = crear_rutina(cliente, 'Push')
  const primero = crear_hueco(cliente, push, ejercicio.Press, { orden: 1, series: 5, reps: [3, 5] })
  poner_alternativas(cliente, push, primero, [ejercicio.Aperturas])
  const oculto = crear_hueco(cliente, push, ejercicio.Fondos, { orden: 2 })
  poner_alternativas(cliente, push, oculto, [ejercicio.Aperturas])
  ocultar_hueco(cliente, push, oculto)
  const tercero = crear_hueco(cliente, push, ejercicio.Cruces, {
    orden: 3,
    series: 3,
    reps: [12, 15],
  })
  poner_alternativas(cliente, push, tercero, [ejercicio.Elevaciones, ejercicio.Aperturas])
  for (const nombre of ['Cruces', 'Elevaciones']) {
    expect(cliente.delete(`/ejercicios/${ejercicio[nombre]}?modo=ocultar`).status_code).toBe(204)
  }

  const respuesta = duplicar(push)

  esperar_estado(respuesta, 201)
  const copia = respuesta.json()
  expect(lo_que_tiene(copia)).toEqual([
    [1, ejercicio.Press, 5, 3, 5, [ejercicio.Aperturas]],
    [3, ejercicio.Cruces, 3, 12, 15, [ejercicio.Elevaciones, ejercicio.Aperturas]],
  ])
  expect(copia.slots.every((hueco: any) => hueco.oculto_desde === null)).toBe(true)
  const ids_copia = copia.slots.map((h: any) => h.id)
  for (const original of [primero, oculto, tercero]) expect(ids_copia).not.toContain(original)
  // El original, intacto: con su hueco oculto.
  expect(cliente.get(`/rutinas/${push}`).json().slots).toHaveLength(3)
})

test('la_copia_sale_sin_usar', () => {
  // Ni en los días del programa, ni con las sesiones ni los días planificados del original.
  const press = crear_ejercicio(cliente, grupo, 'Press')
  const push = crear_rutina(cliente, 'Push')
  const hueco = crear_hueco(cliente, push, press, { orden: 1 })
  const programa = cliente
    .post('/programas', {
      json: { nombre: 'PPL', dias: [{ dia_semana: 1, rutina_id: push }] },
    })
    .json()
  const sesion = entrenar(cliente, hoy(), push).json().id
  const serie = {
    ejercicio_id: press,
    slot_id: hueco,
    numero_serie: 1,
    peso: 60,
    repeticiones: 8,
  }
  expect(cliente.post(`/entrenamientos/${sesion}/series`, { json: serie }).status_code).toBe(201)

  const copia = duplicar(push).json()

  expect(copia.num_programas).toBe(0)
  expect(copia.oculto_desde).toBeNull()
  expect(cliente.get('/entrenamientos', { params: { rutina_id: copia.id } }).json()).toEqual([])
  expect(
    cliente
      .get(`/programas/${programa.id}`)
      .json()
      .dias.map((d: any) => d.rutina.id),
  ).toEqual([push])
  expect(cliente.get(`/rutinas/${push}`).json().num_programas).toBe(1)
  const aviso = cliente.get(`/rutinas/${copia.id}/aviso-de-borrado`).json()
  expect([aviso.sesiones, aviso.dias_de_programa, aviso.toco_dias_pasados]).toEqual([0, 0, false])
})

test('editar_la_copia_no_cambia_el_original', () => {
  const press = crear_ejercicio(cliente, grupo, 'Press')
  const aperturas = crear_ejercicio(cliente, grupo, 'Aperturas')
  const fondos = crear_ejercicio(cliente, grupo, 'Fondos')
  const push = crear_rutina(cliente, 'Push')
  const hueco = crear_hueco(cliente, push, press, { orden: 1 })
  poner_alternativas(cliente, push, hueco, [aperturas])
  const antes = cliente.get(`/rutinas/${push}`).json()
  const copia = duplicar(push).json()
  const ruta = `/rutinas/${copia.id}`
  const hueco_copia = copia.slots[0].id

  expect(cliente.put(ruta, { json: { nombre: 'Push B' } }).status_code).toBe(200)
  expect(
    cliente.put(`${ruta}/slots/${hueco_copia}`, {
      json: {
        ejercicio_principal_id: fondos,
        orden: 2,
        series_objetivo: 2,
        reps_min: 1,
        reps_max: 2,
      },
    }).status_code,
  ).toBe(200)
  expect(poner_alternativas(cliente, copia.id, hueco_copia, []).alternativas).toEqual([])
  crear_hueco(cliente, copia.id, press, { orden: 1 })

  const despues = cliente.get(`/rutinas/${push}`).json()
  expect([despues.nombre, lo_que_tiene(despues)]).toEqual([antes.nombre, lo_que_tiene(antes)])
})

test('se_puede_duplicar_una_rutina_oculta_y_la_copia_sale_visible', () => {
  const push = crear_rutina(cliente, 'Push')
  crear_hueco(cliente, push, crear_ejercicio(cliente, grupo, 'Press'), { orden: 1 })
  expect(cliente.delete(`/rutinas/${push}?modo=ocultar`).status_code).toBe(204)

  const respuesta = duplicar(push)

  esperar_estado(respuesta, 201)
  expect(respuesta.json().oculto_desde).toBeNull()
  expect(respuesta.json().slots).toHaveLength(1)
  expect(
    cliente
      .get('/rutinas')
      .json()
      .map((r: any) => r.nombre),
  ).toEqual(['Push - copia'])
  expect(cliente.get(`/rutinas/${push}`).json().oculto_desde).toBe(hoy())
})

// --- Reordenar los huecos ---------------------------------------------------

/** Una rutina con tres huecos visibles, de orden 1, 2 y 3. */
function tres_huecos(): [number, [number, number, number]] {
  const rutina = crear_rutina(cliente, 'Push')
  const huecos = ['Press', 'Aperturas', 'Fondos'].map((nombre, i) =>
    crear_hueco(cliente, rutina, crear_ejercicio(cliente, grupo, nombre), { orden: i + 1 }),
  )
  return [rutina, huecos as [number, number, number]]
}

test('reordenar_con_huecos_ocultos_los_deja_en_su_sitio', () => {
  // Los visibles se reparten los `orden` que ya tenían; el oculto conserva el suyo, así que
  // al mostrarlo no choca con nadie.
  const rutina = crear_rutina(cliente, 'Push')
  const [a, oculto, b, c] = (
    [
      [1, 'Press'],
      [2, 'Fondos'],
      [5, 'Aperturas'],
      [7, 'Cruces'],
    ] as const
  ).map(([orden, nombre]) =>
    crear_hueco(cliente, rutina, crear_ejercicio(cliente, grupo, nombre), { orden }),
  )
  ocultar_hueco(cliente, rutina, oculto)

  const respuesta = ordenar(rutina, [c, b, a])

  esperar_estado(respuesta, 200)
  expect(ordenes(rutina)).toEqual({ [c]: 1, [oculto]: 2, [b]: 5, [a]: 7 })
  expect(cliente.post(`/rutinas/${rutina}/slots/${oculto}/mostrar`).status_code).toBe(200)
  expect(
    cliente
      .get(`/rutinas/${rutina}`)
      .json()
      .slots.map((h: any) => h.id),
  ).toEqual([c, oculto, b, a])
})

test('reordenar_una_rutina_sin_huecos_no_hace_nada', () => {
  const rutina = crear_rutina(cliente)

  const respuesta = ordenar(rutina, [])

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().slots).toEqual([])
})

const MENSAJE_DE_ORDEN =
  'Para ordenar la rutina hacen falta todos sus ejercicios a la vista, cada uno una vez.'

test.each(['falta uno', 'sobra uno de otra rutina', 'uno oculto'])(
  'reordenar_sin_mandar_exactamente_los_visibles_da_422_y_no_cambia_nada (%s)',
  (caso) => {
    const rutina = crear_rutina(cliente, 'Push')
    const [a, b, oculto] = (
      [
        [1, 'Press'],
        [2, 'Aperturas'],
        [3, 'Fondos'],
      ] as const
    ).map(([orden, nombre]) =>
      crear_hueco(cliente, rutina, crear_ejercicio(cliente, grupo, nombre), { orden }),
    )
    ocultar_hueco(cliente, rutina, oculto)
    const otra = crear_rutina(cliente, 'Pull')
    const de_otra = crear_hueco(cliente, otra, crear_ejercicio(cliente, grupo, 'Remo'), {
      orden: 1,
    })
    const slot_ids = {
      'falta uno': [b],
      'sobra uno de otra rutina': [b, a, de_otra],
      'uno oculto': [b, a, oculto],
    }[caso]!
    const antes = ordenes(rutina)

    // Con un nombre nuevo: tampoco se guarda, todo o nada.
    const respuesta = ordenar(rutina, slot_ids, 'Empuje')

    expect(respuesta.status_code).toBe(422)
    // El 422 del endpoint, no uno de validación del body.
    expect(respuesta.json().detail).toBe(MENSAJE_DE_ORDEN)
    expect(ordenes(rutina)).toEqual(antes)
    expect(cliente.get(`/rutinas/${rutina}`).json().nombre).toBe('Push')
    expect(ordenes(otra)).toEqual({ [de_otra]: 1 })
  },
)

test('reordenar_con_un_hueco_repetido_da_422', () => {
  // Lo para el body: con el conjunto de ids no se notaría la repetición.
  const [rutina, [a, b, c]] = tres_huecos()

  const respuesta = ordenar(rutina, [a, b, c, a])

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((e: any) => e.msg)).toEqual([
    'Value error, Hay ejercicios repetidos.',
  ])
  expect(ordenes(rutina)).toEqual({ [a]: 1, [b]: 2, [c]: 3 })
})

test('guardar_el_nombre_y_el_orden_de_una_vez', () => {
  // El *Guardar* de la rutina: una sola petición, y la respuesta ya viene en el orden nuevo
  // (la web la pinta tal cual, sin volver a pedirla). Cada hueco toma un `orden` que otro
  // tenía: con PUT sueltos, el primero chocaría con `UNIQUE(rutina_id, orden)`.
  const [rutina, [a, b, c]] = tres_huecos()

  const respuesta = ordenar(rutina, [c, a, b], 'Empuje')

  esperar_estado(respuesta, 200)
  expect(respuesta.json().nombre).toBe('Empuje')
  expect(respuesta.json().slots.map((h: any) => [h.id, h.orden])).toEqual([
    [c, 1],
    [a, 2],
    [b, 3],
  ])
  expect(ordenes(rutina)).toEqual({ [c]: 1, [a]: 2, [b]: 3 })
})

test('guardar_sin_slot_ids_solo_cambia_el_nombre', () => {
  const [rutina, [a, b, c]] = tres_huecos()

  const respuesta = cliente.put(`/rutinas/${rutina}`, {
    json: { nombre: 'Empuje', slot_ids: null },
  })

  esperar_estado(respuesta, 200)
  expect(respuesta.json().nombre).toBe('Empuje')
  expect(ordenes(rutina)).toEqual({ [a]: 1, [b]: 2, [c]: 3 })
})

test('un_nombre_repetido_al_guardar_da_409_y_el_orden_no_cambia', () => {
  const [rutina, [a, b, c]] = tres_huecos()
  crear_rutina(cliente, 'Pull')

  const respuesta = ordenar(rutina, [c, b, a], 'pull')

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    409,
    nombre_repetido('Ya tienes una rutina que se llama «Pull». Elige otro nombre.'),
  ])
  expect(ordenes(rutina)).toEqual({ [a]: 1, [b]: 2, [c]: 3 })
  expect(cliente.get(`/rutinas/${rutina}`).json().nombre).toBe('Push')
})

test('con_el_orden_mal_y_el_nombre_repetido_gana_el_422_del_orden', () => {
  // El 409 del nombre va el último.
  const [rutina, [a, b]] = tres_huecos()
  crear_rutina(cliente, 'Pull')

  const respuesta = ordenar(rutina, [b, a], 'Pull')

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([422, MENSAJE_DE_ORDEN])
})
