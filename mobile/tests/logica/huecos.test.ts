/**
 * Un hueco suelto: dónde cae cuando no se dice su `orden` y cómo se sustituye su lista de
 * comodines de una vez.
 *
 * Puerto de `backend/tests/test_huecos.py`.
 *
 * El `orden` automático existe para que la web no calcule un dato que el backend tiene a mano
 * (y que exige mirar también los huecos ocultos). La lista de comodines en el PUT existe para
 * que *Guardar* en P4 sea una sola petición; su trampa es el `UNIQUE(slot_id, ejercicio_id)`:
 * si se reconstruye la lista entera en vez de conservar las filas que siguen, se inserta antes
 * de borrar y la base lo rechaza.
 *
 * El resto del CRUD de huecos está en `crud.test.ts`.
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  ELEGIDO_YA_NO_EXISTE,
  alternativa,
  crear_ejercicio,
  crear_rutina,
  cuantas_filas,
  ejercicio_oculto,
  entrenar,
  esperar_estado,
  ids_de_alternativas,
  objetivo,
  ocultar_ejercicio,
} from '../apoyo/ayudas'
import { crearCliente, hoy, type ClienteDeTest as Cliente } from '../apoyo/cliente'
import { ejercicio_predefinido_id, grupo_muscular_id } from '../apoyo/conftest'

let cliente: Cliente
let bd: Bd
let ejercicios: Record<string, number>
beforeEach(() => {
  ;({ cliente, bd } = crearCliente())
  // Cinco ejercicios propios, por nombre.
  ejercicios = {}
  for (const nombre of ['Press', 'Aperturas', 'Fondos', 'Cruces', 'Elevaciones']) {
    ejercicios[nombre] = crear_ejercicio(cliente, grupo_muscular_id(cliente), nombre)
  }
})

// --- Ayudantes -----------------------------------------------------------

type Campos = {
  series?: number
  reps?: [number, number]
  orden?: number
  alternativas?: (number | Record<string, unknown>)[] | null
}

/**
 * Sin `orden` ni `alternativas` salvo que vengan en `campos`. En `alternativas` vale poner solo
 * el id de cada ejercicio: va con un objetivo de repeticiones (`alternativa`), que es el de
 * todos los ejercicios de este archivo.
 */
function cuerpo_de_hueco(
  principal: number,
  { series = 4, reps = [6, 10], ...campos }: Campos = {},
) {
  const resto: Record<string, unknown> = { ...campos }
  if (campos.alternativas !== undefined && campos.alternativas !== null) {
    resto.alternativas = campos.alternativas.map((a) =>
      typeof a === 'number' ? alternativa(a) : a,
    )
  }
  return { ejercicio_principal_id: principal, ...objetivo(series, reps), ...resto }
}

/** POST del hueco; devuelve la respuesta entera, para mirar el código. */
function anadir_hueco(rutina_id: number, principal: number, campos: Campos = {}) {
  return cliente.post(`/rutinas/${rutina_id}/slots`, { json: cuerpo_de_hueco(principal, campos) })
}

function hueco_creado(rutina_id: number, principal: number, campos: Campos = {}): any {
  const respuesta = anadir_hueco(rutina_id, principal, campos)
  esperar_estado(respuesta, 201)
  return respuesta.json()
}

function editar_hueco(
  rutina_id: number,
  slot_id: number,
  principal: number,
  { orden = 1, ...campos }: Campos = {},
) {
  return cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, {
    json: cuerpo_de_hueco(principal, { orden, ...campos }),
  })
}

/** Los comodines del hueco, en el orden en que los devuelve la API. */
function comodines(rutina_id: number, slot_id: number): number[] {
  const hueco = cliente
    .get(`/rutinas/${rutina_id}`)
    .json()
    .slots.find((h: any) => h.id === slot_id)
  return ids_de_alternativas(hueco)
}

/**
 * `ejercicio_id → id de la fila` de los comodines del hueco, leídos de la base: para saber si
 * una fila se conservó o se borró y se volvió a crear.
 */
function filas_de_comodines(slot_id: number): Record<number, number> {
  return Object.fromEntries(
    bd
      .todas<{ ejercicio_id: number; id: number }>(
        'SELECT ejercicio_id, id FROM slot_alternativas WHERE slot_id = ?',
        slot_id,
      )
      .map((fila) => [fila.ejercicio_id, fila.id]),
  )
}

/** Cuántos huecos y cuántos comodines hay en toda la base, de cualquier rutina. */
function huecos_guardados(): number[] {
  return cuantas_filas(bd, 'rutina_slots', 'slot_alternativas')
}

// --- POST: el orden automático ----------------------------------------------

test('sin_orden_el_primer_hueco_de_una_rutina_va_el_1', () => {
  const rutina = crear_rutina(cliente)

  const hueco = hueco_creado(rutina, ejercicios.Press)

  expect(hueco.orden).toBe(1)
})

test('sin_orden_el_hueco_va_detras_tambien_de_los_ocultos', () => {
  // Si contara solo los visibles, saldría el 3 y chocaría con el oculto (o, al mostrarlo,
  // habría dos en el mismo sitio).
  const rutina = crear_rutina(cliente)
  hueco_creado(rutina, ejercicios.Press, { orden: 1 })
  hueco_creado(rutina, ejercicios.Aperturas, { orden: 2 })
  const oculto = hueco_creado(rutina, ejercicios.Fondos, { orden: 3 }).id
  expect(cliente.delete(`/rutinas/${rutina}/slots/${oculto}?modo=ocultar`).status_code).toBe(204)

  const nuevo = hueco_creado(rutina, ejercicios.Cruces)

  expect(nuevo.orden).toBe(4)
  expect(cliente.post(`/rutinas/${rutina}/slots/${oculto}/mostrar`).status_code).toBe(200)
  expect(
    cliente
      .get(`/rutinas/${rutina}`)
      .json()
      .slots.map((h: any) => h.orden),
  ).toEqual([1, 2, 3, 4])
})

test('sin_orden_el_hueco_va_detras_del_mayor_aunque_haya_hueco_libre_antes', () => {
  const rutina = crear_rutina(cliente)
  hueco_creado(rutina, ejercicios.Press, { orden: 5 })

  expect(hueco_creado(rutina, ejercicios.Aperturas).orden).toBe(6)
})

test('con_orden_explicito_se_respeta_y_choca_tambien_con_un_oculto', () => {
  // `UNIQUE(rutina_id, orden)`: el endpoint lo comprueba antes y da un 409 legible, no el 500
  // de la base, con un hueco visible o con uno oculto, y no crea nada.
  const rutina = crear_rutina(cliente)
  const oculto = hueco_creado(rutina, ejercicios.Press, { orden: 7 }).id
  expect(cliente.delete(`/rutinas/${rutina}/slots/${oculto}?modo=ocultar`).status_code).toBe(204)

  expect(hueco_creado(rutina, ejercicios.Aperturas, { orden: 3 }).orden).toBe(3)
  const con_el_visible = anadir_hueco(rutina, ejercicios.Fondos, { orden: 3 })
  const con_el_oculto = anadir_hueco(rutina, ejercicios.Fondos, { orden: 7 })

  for (const [respuesta, orden] of [
    [con_el_visible, 3],
    [con_el_oculto, 7],
  ] as const) {
    esperar_estado(respuesta, 409)
    expect(respuesta.json().detail).toBe(
      `Ya hay otro ejercicio en la posición ${orden} de esta rutina.`,
    )
  }
  expect(huecos_guardados()).toEqual([2, 0])
})

test('sin_orden_con_el_100_ocupado_por_un_oculto_da_409_y_no_crea_nada', () => {
  // Si diera 101, ese hueco ya no se podría editar: el PUT exige `orden <= 100`. Con un hueco
  // visible, en `una_rutina_creada_con_100_huecos_no_admite_otro_sin_orden`.
  const rutina = crear_rutina(cliente)
  const ultimo = hueco_creado(rutina, ejercicios.Press, { orden: 100 }).id
  expect(cliente.delete(`/rutinas/${rutina}/slots/${ultimo}?modo=ocultar`).status_code).toBe(204)

  const respuesta = anadir_hueco(rutina, ejercicios.Aperturas, {
    alternativas: [ejercicios.Fondos],
  })

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe('Esta rutina no admite más ejercicios.')
  expect(huecos_guardados()).toEqual([1, 0])
})

test('una_rutina_creada_con_100_huecos_no_admite_otro_sin_orden', () => {
  // El tope de `POST /rutinas` y el del orden automático encajan: lleno es lleno.
  const predefinido = ejercicio_predefinido_id(bd)
  const hueco = cuerpo_de_hueco(predefinido)
  const rutina = cliente
    .post('/rutinas', { json: { nombre: 'Larga', slots: Array(100).fill(hueco) } })
    .json()

  const respuesta = anadir_hueco(rutina.id, predefinido)
  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    409,
    'Esta rutina no admite más ejercicios.',
  ])
  expect(huecos_guardados()).toEqual([100, 0])
})

test('el_orden_automatico_no_cuenta_los_huecos_de_otra_rutina', () => {
  // Pull tiene un hueco en el 100: si contara, Push estaría «llena» y daría 409.
  const pull = crear_rutina(cliente, 'Pull')
  hueco_creado(pull, ejercicios.Press, { orden: 100 })
  const push = crear_rutina(cliente, 'Push')

  expect(hueco_creado(push, ejercicios.Aperturas).orden).toBe(1)
})

// --- La ruta tiene que cuadrar -------------------------------------------------

test('un_hueco_no_se_modifica_por_la_ruta_de_otra_rutina', () => {
  // El hueco es de Push: si la ruta no se comprobara, se podría editar o borrar "desde" Pull.
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')
  const hueco = hueco_creado(push, ejercicios.Press, { orden: 1 })

  const editado = editar_hueco(pull, hueco.id, ejercicios.Aperturas, { series: 2 })
  const borrado = cliente.delete(`/rutinas/${pull}/slots/${hueco.id}`)

  for (const respuesta of [editado, borrado]) {
    expect([respuesta.status_code, respuesta.json().detail]).toEqual([
      404,
      'Ese ejercicio no está en esta rutina.',
    ])
  }
  const [guardado] = cliente.get(`/rutinas/${push}`).json().slots
  expect([guardado.id, guardado.ejercicio_principal.id, guardado.series_objetivo]).toEqual([
    hueco.id,
    ejercicios.Press,
    4,
  ])
  expect(cliente.get(`/rutinas/${pull}`).json().slots).toEqual([])
})

test('un_hueco_no_se_muestra_ni_cambia_sus_comodines_por_la_ruta_de_otra_rutina', () => {
  // El resto de acciones sobre un hueco también comprueban que es de la rutina de la ruta:
  // mostrarlo y cambiar o vaciar su lista de comodines (el PUT con `alternativas`). Por la de
  // Pull, 404 y el hueco de Push no cambia.
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')
  const press = ejercicios.Press
  const hueco = hueco_creado(push, press, { orden: 1, alternativas: [ejercicios.Fondos] }).id
  const [por_push, por_pull] = [
    `/rutinas/${push}/slots/${hueco}`,
    `/rutinas/${pull}/slots/${hueco}`,
  ]

  // Mostrar, con el hueco oculto: si colara, lo dejaría visible.
  expect(cliente.delete(`${por_push}?modo=ocultar`).status_code).toBe(204)
  const mostrar = cliente.post(`${por_pull}/mostrar`)
  expect(cliente.get(`/rutinas/${push}`).json().slots[0].oculto_desde).toBe(hoy())
  // Los comodines, con el hueco visible: así el 404 no puede ser el 409 de lo oculto.
  expect(cliente.post(`${por_push}/mostrar`).status_code).toBe(200)
  const anadir = editar_hueco(pull, hueco, press, {
    alternativas: [ejercicios.Fondos, ejercicios.Cruces],
  })
  const quitar = editar_hueco(pull, hueco, press, { alternativas: [] })

  expect([mostrar, anadir, quitar].map((r) => r.status_code)).toEqual([404, 404, 404])
  expect(
    [mostrar, anadir, quitar].every(
      (r) => r.json().detail === 'Ese ejercicio no está en esta rutina.',
    ),
  ).toBe(true)
  expect(Object.keys(filas_de_comodines(hueco)).map(Number)).toEqual([ejercicios.Fondos])
})

// --- POST: con sus comodines --------------------------------------------------

test('un_hueco_nuevo_se_crea_con_sus_comodines_en_el_orden_enviado', () => {
  const rutina = crear_rutina(cliente)
  const lista = [ejercicios.Fondos, ejercicio_predefinido_id(bd), ejercicios.Aperturas]

  const hueco = hueco_creado(rutina, ejercicios.Press, { alternativas: lista })

  expect(ids_de_alternativas(hueco)).toEqual(lista)
  expect(comodines(rutina, hueco.id)).toEqual(lista)
})

test('un_hueco_nuevo_con_un_comodin_oculto_da_404_y_no_se_crea', () => {
  // Con uno que no existe, en `un_ejercicio_que_no_existe_da_404_antes_que_un_objetivo_equivocado`.
  const rutina = crear_rutina(cliente)
  const malo = ejercicios.Cruces
  ocultar_ejercicio(cliente, malo)

  const respuesta = anadir_hueco(rutina, ejercicios.Press, {
    alternativas: [ejercicios.Fondos, malo],
  })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe(ejercicio_oculto('Cruces'))
  expect(huecos_guardados()).toEqual([0, 0])
})

test.each([
  ['igual al principal', 'Una alternativa no puede ser el mismo ejercicio que el principal.'],
  ['repetido', 'Hay alternativas repetidas.'],
])('un_hueco_nuevo_con_comodines_incoherentes_da_422 (%s)', (caso, lo_que_dice) => {
  const rutina = crear_rutina(cliente)
  const [press, fondos] = [ejercicios.Press, ejercicios.Fondos]
  const lista = { 'igual al principal': [fondos, press], repetido: [fondos, fondos] }[caso]!

  const respuesta = anadir_hueco(rutina, press, { alternativas: lista })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((e: any) => e.msg)).toEqual([`Value error, ${lo_que_dice}`])
  expect(huecos_guardados()).toEqual([0, 0])
})

// --- PUT: con lista de comodines ----------------------------------------------
//
// Sin lista (o con ella nula) no se tocan, en
// `editar_un_hueco_sin_lista_no_toca_las_alternativas_ni_sus_objetivos`. Con la lista, un
// comodín pasa a principal en la misma petición, en
// `una_lista_quita_anade_e_intercambia_principal_y_alternativa_a_la_vez`.

test('con_la_lista_nula_sigue_sin_poder_pasar_un_comodin_a_principal', () => {
  // Sin lista nueva, el comodín seguiría ahí: acabaría siendo las dos cosas. (Sin el campo lo
  // cubre `un_comodin_no_puede_pasar_a_principal_de_su_mismo_hueco`.)
  const rutina = crear_rutina(cliente)
  const fondos = ejercicios.Fondos
  const slot = hueco_creado(rutina, ejercicios.Press, { alternativas: [fondos] }).id

  const respuesta = editar_hueco(rutina, slot, fondos, { alternativas: null })

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe(
    'Ese ejercicio ya es una alternativa de este. Quítalo de las alternativas antes' +
      ' de hacerlo el principal.',
  )
  expect(comodines(rutina, slot)).toEqual([fondos])
})

test('la_lista_quita_conserva_y_anade_comodines', () => {
  // Salen en orden de alta: primero el conservado y después el nuevo, aunque la lista los
  // mande al revés.
  const rutina = crear_rutina(cliente)
  const [aperturas, fondos, cruces] = [ejercicios.Aperturas, ejercicios.Fondos, ejercicios.Cruces]
  const slot = hueco_creado(rutina, ejercicios.Press, { alternativas: [aperturas, fondos] }).id
  const fila_de_fondos = filas_de_comodines(slot)[fondos]

  const respuesta = editar_hueco(rutina, slot, ejercicios.Press, { alternativas: [cruces, fondos] })

  esperar_estado(respuesta, 200)
  expect(ids_de_alternativas(respuesta.json())).toEqual([fondos, cruces])
  expect(comodines(rutina, slot)).toEqual([fondos, cruces])
  const filas = filas_de_comodines(slot)
  expect(new Set(Object.keys(filas).map(Number))).toEqual(new Set([fondos, cruces]))
  expect(filas[fondos]).toBe(fila_de_fondos)
})

test('la_lista_vacia_quita_todos_los_comodines', () => {
  const rutina = crear_rutina(cliente)
  const lista = [ejercicios.Aperturas, ejercicios.Fondos]
  const slot = hueco_creado(rutina, ejercicios.Press, { alternativas: lista }).id

  const respuesta = editar_hueco(rutina, slot, ejercicios.Press, { alternativas: [] })

  esperar_estado(respuesta, 200)
  expect(respuesta.json().alternativas).toEqual([])
  expect(filas_de_comodines(slot)).toEqual({})
})

test('mandar_los_mismos_comodines_conserva_sus_filas', () => {
  // La trampa del `UNIQUE(slot_id, ejercicio_id)`: si el endpoint reconstruyera la lista, se
  // insertarían las filas nuevas antes de borrar las viejas y la base daría un 500. Y si
  // alguien lo arreglara reconstruyéndola con un borrado en medio, ya no habría 500, pero las
  // filas cambiarían de id: lo caza la última comprobación.
  const rutina = crear_rutina(cliente)
  const lista = [ejercicios.Aperturas, ejercicios.Fondos, ejercicios.Cruces]
  const slot = hueco_creado(rutina, ejercicios.Press, { alternativas: lista }).id
  const filas = filas_de_comodines(slot)

  const respuesta = editar_hueco(rutina, slot, ejercicios.Press, {
    series: 5,
    alternativas: [...lista].reverse(),
  })

  esperar_estado(respuesta, 200)
  // El orden de la lista no reordena los que ya estaban.
  expect(ids_de_alternativas(respuesta.json())).toEqual(lista)
  expect(respuesta.json().series_objetivo).toBe(5)
  expect(filas_de_comodines(slot)).toEqual(filas)
})

test('un_comodin_ya_oculto_se_conserva_pero_no_se_puede_volver_a_poner', () => {
  // "Corregir sí, elegir algo oculto no": conservarlo no es elegirlo, pero volver a ponerlo
  // después de quitarlo sí.
  const rutina = crear_rutina(cliente)
  const [press, fondos, cruces] = [ejercicios.Press, ejercicios.Fondos, ejercicios.Cruces]
  const slot = hueco_creado(rutina, press, { alternativas: [fondos] }).id
  ocultar_ejercicio(cliente, fondos)

  const conservado = editar_hueco(rutina, slot, press, { alternativas: [fondos, cruces] })
  esperar_estado(conservado, 200)
  expect(ids_de_alternativas(conservado.json())).toEqual([fondos, cruces])

  const quitado = editar_hueco(rutina, slot, press, { alternativas: [cruces] })
  esperar_estado(quitado, 200)

  const repuesto = editar_hueco(rutina, slot, press, { alternativas: [cruces, fondos] })
  expect(repuesto.status_code).toBe(404)
  expect(repuesto.json().detail).toBe(ejercicio_oculto('Fondos'))
  expect(comodines(rutina, slot)).toEqual([cruces])
})

test('con_el_principal_oculto_se_le_puede_anadir_un_comodin', () => {
  const rutina = crear_rutina(cliente)
  const press = ejercicios.Press
  const slot = hueco_creado(rutina, press).id
  ocultar_ejercicio(cliente, press)

  const respuesta = editar_hueco(rutina, slot, press, { alternativas: [ejercicios.Fondos] })

  esperar_estado(respuesta, 200)
  expect(ids_de_alternativas(respuesta.json())).toEqual([ejercicios.Fondos])
})

test('quitar_un_comodin_con_series_no_borra_las_series', () => {
  // Las series apuntan al ejercicio y al hueco, no a la fila del comodín.
  const rutina = crear_rutina(cliente)
  const [press, fondos] = [ejercicios.Press, ejercicios.Fondos]
  const slot = hueco_creado(rutina, press, { alternativas: [fondos] }).id
  const sesion = entrenar(cliente, hoy(), rutina).json().id
  const serie = { ejercicio_id: fondos, slot_id: slot, numero_serie: 1, peso: 40 }
  let respuesta = cliente.post(`/entrenamientos/${sesion}/series`, {
    json: { ...serie, repeticiones: 10 },
  })
  esperar_estado(respuesta, 201)
  const serie_id = respuesta.json().id

  respuesta = editar_hueco(rutina, slot, press, { alternativas: [] })

  esperar_estado(respuesta, 200)
  const guardada = bd.una<{ slot_id: number; ejercicio_id: number }>(
    'SELECT slot_id, ejercicio_id FROM series WHERE id = ?',
    serie_id,
  )!
  expect([guardada.slot_id, guardada.ejercicio_id]).toEqual([slot, fondos])
  expect(cliente.get(`/entrenamientos/${sesion}`).json().series).toHaveLength(1)
})

test('editar_con_comodines_incoherentes_da_422', () => {
  // Los dos esquemas llaman a la misma comprobación: cada motivo, al crear.
  const rutina = crear_rutina(cliente)
  const [press, fondos] = [ejercicios.Press, ejercicios.Fondos]
  const slot = hueco_creado(rutina, press, { alternativas: [fondos] }).id
  const filas = filas_de_comodines(slot)

  const respuesta = editar_hueco(rutina, slot, press, { alternativas: [fondos, fondos] })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((e: any) => e.msg)).toEqual([
    'Value error, Hay alternativas repetidas.',
  ])
  expect(filas_de_comodines(slot)).toEqual(filas)
})

test('un_comodin_que_no_vale_en_la_lista_no_cambia_nada_del_hueco', () => {
  // Ni los comodines buenos de la misma lista ni el resto de campos: el 404 tiene que llegar
  // antes de tocar nada.
  const rutina = crear_rutina(cliente)
  const [press, fondos] = [ejercicios.Press, ejercicios.Fondos]
  const slot = hueco_creado(rutina, press, { alternativas: [fondos] }).id
  const filas = filas_de_comodines(slot)

  const respuesta = editar_hueco(rutina, slot, press, {
    series: 9,
    alternativas: [ejercicios.Cruces, 999_999],
  })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe(ELEGIDO_YA_NO_EXISTE)
  expect(filas_de_comodines(slot)).toEqual(filas)
  expect(cliente.get(`/rutinas/${rutina}`).json().slots[0].series_objetivo).toBe(4)
})
