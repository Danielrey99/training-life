/**
 * Puerto de `backend/tests/test_borrados.py`: el borrado con historial (`?modo=ocultar` y
 * `?modo=definitivo`), lo oculto, los predefinidos y los avisos de borrado.
 *
 * Es la parte más delicada del backend y donde han aparecido la mayoría de los bugs reales del
 * proyecto (el `passive_deletes` que faltaba y el `flush()` olvidado, tres veces). En el móvil no
 * hay ORM, pero el orden de los DELETE y los RESTRICT siguen ahí: los mismos escenarios.
 *
 * No se porta `el_aviso_de_un_ejercicio_hace_las_mismas_consultas_con_poco_que_con_mucho`
 * (cuenta consultas SQL; ver `no_aplica.ts`).
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  PIDE_MODO,
  alternativa,
  cambiar_dias,
  crear_ejercicio,
  crear_hueco,
  crear_rutina,
  cuerpo_de_hueco,
  ejercicio_oculto,
  objetivo,
  poner_alternativas,
  sesiones_en_curso,
} from '../apoyo/ayudas'
import { crearCliente, type ClienteDeTest as Cliente, type RelojDeTest } from '../apoyo/cliente'
import { ejercicio_predefinido_id, grupo_muscular_id, ppl } from '../apoyo/conftest'
import { contar } from '../apoyo/filas'
import { HOY, JUEVES_17, LUNES_14, MARTES_15, VIERNES_18, hecha } from '../apoyo/semana'

const FECHA = '2026-09-04'

// --- Ayudantes para montar escenarios ------------------------------------

/** La rutina Push con un hueco de ese ejercicio en el orden 1: `[rutina, hueco]`. */
function crear_rutina_con_hueco(cliente: Cliente, ejercicio_id: number): [number, number] {
  const rutina_id = crear_rutina(cliente)
  return [rutina_id, crear_hueco(cliente, rutina_id, ejercicio_id, { orden: 1 })]
}

/** Un hueco en el orden 2, detrás del de `crear_rutina_con_hueco`. */
function segundo_hueco(cliente: Cliente, rutina_id: number, ejercicio_id: number): number {
  return crear_hueco(cliente, rutina_id, ejercicio_id, { orden: 2, series: 3, reps: [8, 12] })
}

function cuerpo_serie(
  ejercicio_id: number,
  slot_id: number,
  {
    numero = 1,
    peso = 60,
    repeticiones = 8,
  }: { numero?: number; peso?: number; repeticiones?: number } = {},
): Record<string, unknown> {
  return {
    ejercicio_id,
    slot_id,
    numero_serie: numero,
    peso,
    repeticiones,
  }
}

/**
 * Una sesión de la rutina con una serie (50 kg × 10) por cada `[slot_id, ejercicio_id]`,
 * numeradas desde 1. Devuelve su id.
 */
function sesion_con_series(
  cliente: Cliente,
  rutina_id: number,
  fecha: string,
  ...series: [number, number][]
): number {
  const respuesta = cliente.post('/entrenamientos', { json: { rutina_id, fecha } })
  expect(respuesta.status_code).toBe(201)
  const entrenamiento_id = respuesta.json().id
  series.forEach(([slot_id, ejercicio_id], i) => {
    const serie = cliente.post(`/entrenamientos/${entrenamiento_id}/series`, {
      json: cuerpo_serie(ejercicio_id, slot_id, { numero: i + 1, peso: 50, repeticiones: 10 }),
    })
    expect(serie.status_code).toBe(201)
  })
  return entrenamiento_id
}

/** Una sesión del día `FECHA` con una sola serie, en ese hueco. Devuelve su id. */
function registrar_serie(
  cliente: Cliente,
  rutina_id: number,
  slot_id: number,
  ejercicio_id: number,
): number {
  return sesion_con_series(cliente, rutina_id, FECHA, [slot_id, ejercicio_id])
}

/** Las series de la sesión, o `null` si ya no existe. */
function series_de(cliente: Cliente, entrenamiento_id: number): any[] | null {
  const respuesta = cliente.get(`/entrenamientos/${entrenamiento_id}`)
  if (respuesta.status_code === 404) return null
  expect(respuesta.status_code).toBe(200)
  return respuesta.json().series
}

function ocultar(cliente: Cliente, ruta: string): void {
  expect(cliente.delete(`${ruta}?modo=ocultar`).status_code).toBe(204)
}

function contar_donde(bd: Bd, tabla: string, columna: string, valor: number): number {
  return bd.una<{ n: number }>(`SELECT count(*) AS n FROM ${tabla} WHERE ${columna} = ?`, valor)!.n
}

// --- Ejercicio -----------------------------------------------------------

/** Lo que exportaría la API, sin la hora de exportar: si nada cambia, sale igual. */
function todos_los_datos(cliente: Cliente): any {
  const datos = cliente.get('/datos/exportar').json()
  delete datos.exportado_en
  return datos
}

test.each([['ejercicio'], ['rutina'], ['hueco'], ['programa']])(
  'el_delete_sin_modo_de_algo_con_historial_da_409_con_su_frase_y_no_borra_nada (%s)',
  (que) => {
    // El 409 es una frase fija que solo pide elegir `modo` (antes, en el ejercicio y el programa
    // era un objeto con lo que se perdería, que ya cuenta su aviso de borrado). Todo lo montado
    // es historial de las cuatro cosas a la vez.
    const { cliente, reloj } = crearCliente()
    const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
    const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
    reloj.fijar(LUNES_14)
    const programa = cliente.post('/programas', {
      json: {
        nombre: 'Push',
        activar: true,
        dias: [{ dia_semana: 1, rutina_id }],
      },
    })
    expect(programa.status_code).toBe(201)
    reloj.fijar(HOY)
    registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
    const ruta = {
      ejercicio: `/ejercicios/${ejercicio_id}`,
      rutina: `/rutinas/${rutina_id}`,
      hueco: `/rutinas/${rutina_id}/slots/${slot_id}`,
      programa: `/programas/${programa.json().id}`,
    }[que]!
    const antes = todos_los_datos(cliente)

    const respuesta = cliente.delete(ruta)

    expect(respuesta.status_code).toBe(409)
    const detalle = respuesta.json().detail
    expect(typeof detalle).toBe('string')
    expect(detalle).toBe((PIDE_MODO as Record<string, string>)[que])
    expect(todos_los_datos(cliente)).toEqual(antes)
  },
)

test('ocultar_guarda_desde_cuando_y_mostrar_lo_borra', () => {
  // La app enseña "oculto desde el …": esa fecha es la de hoy al ocultar, y vuelve a ser nula al
  // mostrar. Igual para ejercicios, rutinas y huecos. Mientras está oculto sale solo en el
  // listado de ocultos, y al mostrarlo vuelve al normal.
  const { cliente, reloj } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const rutas = [
    [`/ejercicios/${ejercicio_id}`, '/ejercicios', '/ejercicios?ocultos=true'],
    [`/rutinas/${rutina_id}`, '/rutinas', '/rutinas?ocultas=true'],
  ]

  const ids = (listado: string): number[] =>
    cliente
      .get(listado)
      .json()
      .map((x: any) => x.id)

  for (const [ruta, listado, listado_de_ocultos] of rutas) {
    const id_ = Number(ruta.split('/').at(-1))
    expect(cliente.delete(`${ruta}?modo=ocultar`).status_code).toBe(204)
    const ocultos = cliente.get(listado_de_ocultos).json()
    expect(ocultos).toHaveLength(1)
    expect([ocultos[0].id, ocultos[0].oculto_desde]).toEqual([id_, reloj.hoy()])
    expect(ids(listado)).not.toContain(id_)
    // Tiene su vista «está oculto»: se sigue pudiendo abrir.
    const abierto = cliente.get(ruta)
    expect([abierto.status_code, abierto.json().oculto_desde]).toEqual([200, reloj.hoy()])

    const mostrado = cliente.post(`${ruta}/mostrar`)
    expect(mostrado.status_code).toBe(200)
    expect(mostrado.json().oculto_desde).toBeNull()
    expect(ids(listado)).toContain(id_)
    expect(ids(listado_de_ocultos)).toEqual([])
  }

  const ruta_del_hueco = `/rutinas/${rutina_id}/slots/${slot_id}`
  expect(cliente.delete(`${ruta_del_hueco}?modo=ocultar`).status_code).toBe(204)
  const huecos = cliente.get(`/rutinas/${rutina_id}`).json().slots
  expect(huecos).toHaveLength(1)
  expect(huecos[0].oculto_desde).toBe(reloj.hoy())

  const mostrado = cliente.post(`${ruta_del_hueco}/mostrar`)
  expect(mostrado.status_code).toBe(200)
  expect(mostrado.json().oculto_desde).toBeNull()
})

test('borrar_un_ejercicio_en_definitivo_arrastra_sus_huecos_y_sus_series', () => {
  // El 409 promete que `?modo=definitivo` lo borra «con todo lo que lo usa»: con series de por
  // medio tiene que terminar en 204, no en un error, y sin el hueco.
  //
  // Test de regresión: en el backend devolvía un 500 (`ForeignKeyViolation` de `series_slot_id_fkey`)
  // porque se borraba el hueco antes que las series; se arregló con un `db.flush()` entre los dos
  // bucles. En el móvil, el orden de los DELETE contra el RESTRICT de `series.slot_id`.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

  const respuesta = cliente.delete(`/ejercicios/${ejercicio_id}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  expect(cliente.get(`/ejercicios/${ejercicio_id}`).status_code).toBe(404)
  expect(cliente.get(`/rutinas/${rutina_id}`).json().slots).toEqual([])
  // Su única serie era de este ejercicio: sin ella estaría cancelada, así que se va con él.
  // Antes se quedaba vacía.
  expect(cliente.get(`/entrenamientos/${entrenamiento_id}`).status_code).toBe(404)
})

// --- Hueco (slot) --------------------------------------------------------

test('borrar_en_definitivo_un_hueco_con_series_borra_tambien_las_series', () => {
  // Test de regresión: sin un flush entre borrar las series y borrar el hueco, el backend
  // mandaba primero el DELETE del hueco y PostgreSQL lo rechazaba (500), igual que pasó con los
  // ejercicios.
  const { cliente, bd } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

  const respuesta = cliente.delete(`/rutinas/${rutina_id}/slots/${slot_id}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  expect(cliente.get(`/rutinas/${rutina_id}`).json().slots).toEqual([])
  expect(contar(bd, 'series')).toBe(0)
})

// --- Rutina: el caso que destapó el bug de passive_deletes ---------------

test('borrar_en_definitivo_una_rutina_con_entrenamientos_y_series', () => {
  // Test de regresión del bug de `passive_deletes`. Antes de arreglarlo, este mismo escenario
  // devolvía un 500 (`null value in column "entrenamiento_id"`): SQLAlchemy intentaba desvincular
  // las series poniendo su FK a NULL en vez de confiar en el ON DELETE CASCADE.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

  const respuesta = cliente.delete(`/rutinas/${rutina_id}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  expect(cliente.get(`/rutinas/${rutina_id}`).status_code).toBe(404)
  expect(cliente.get(`/entrenamientos/${entrenamiento_id}`).status_code).toBe(404)
  // El ejercicio NO se borra: no era suyo el historial, solo estaba referenciado
  expect(cliente.get(`/ejercicios/${ejercicio_id}`).status_code).toBe(200)
})

test('borrar_en_definitivo_una_rutina_usada_en_programa_y_plan_con_historial', () => {
  // El escenario completo: la rutina tiene huecos, series, está en el programa activo y en un
  // día planificado a mano. Todo se va, sin chocar con ningún RESTRICT, y los días vuelven a
  // descanso o al programa.
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
  const otra = crear_rutina(cliente, 'Pull')
  const programa = cliente
    .post('/programas', {
      json: {
        nombre: 'PPL',
        activar: true,
        dias: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia_semana: d, rutina_id })),
      },
    })
    .json().id
  const hoy_ = HOY
  const manana = JUEVES_17
  for (const [fecha, rutina] of [
    [hoy_, rutina_id],
    [manana, otra],
  ]) {
    const respuesta = cliente.put(`/plan/excepciones/${fecha}`, { json: { rutina_id: rutina } })
    expect(respuesta.status_code).toBe(200)
  }

  const respuesta = cliente.delete(`/rutinas/${rutina_id}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  expect(cliente.get(`/programas/${programa}`).json().dias).toEqual([])
  const dias = cliente.get('/plan/seguimiento', { params: { desde: hoy_, hasta: manana } }).json()
  expect(dias.map((d: any) => [d.origen, d.descanso])).toEqual([
    ['programa', true],
    ['excepcion', false],
  ])
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

// --- Notas: se van con el ejercicio, pero solo con el suyo ---------------

function crear_nota(cliente: Cliente, ejercicio_id: number, texto: string): number {
  const respuesta = cliente.post(`/ejercicios/${ejercicio_id}/notas`, { json: { nota: texto } })
  expect(respuesta.status_code).toBe(201)
  return respuesta.json().id
}

/**
 * Cuenta contra la base, no contra la API: tras borrar el ejercicio, sus notas ya no son
 * consultables aunque siguieran existiendo.
 */
function contar_notas(bd: Bd, ejercicio_id: number): number {
  return contar_donde(bd, 'notas_ejercicio', 'ejercicio_id', ejercicio_id)
}

test('borrar_en_definitivo_un_ejercicio_en_uso_se_lleva_tambien_sus_notas', () => {
  // El ejercicio se usa como principal en un hueco (lo que obliga a `?modo=definitivo`) y además
  // está anotado.
  //
  // Las notas no bloquean el borrado (su FK es CASCADE, no RESTRICT), pero tienen que
  // desaparecer con el ejercicio en vez de quedar huérfanas o hacer reventar el borrado.
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const ejercicio_id = crear_ejercicio(cliente, g)
  crear_rutina_con_hueco(cliente, ejercicio_id)
  crear_nota(cliente, ejercicio_id, 'El asiento va en el 4')
  crear_nota(cliente, ejercicio_id, 'Mejor con agarre cerrado')

  const otro_ejercicio_id = crear_ejercicio(cliente, g, 'Remo')
  crear_nota(cliente, otro_ejercicio_id, 'Nota que no debe tocarse')

  // El hueco sí lo bloquea: sin modo, 409. (Las notas por sí solas no bloquean nada: un ejercicio
  // que solo tiene notas se borra directo.)
  const sin_modo = cliente.delete(`/ejercicios/${ejercicio_id}`)
  expect([sin_modo.status_code, sin_modo.json().detail]).toEqual([409, PIDE_MODO.ejercicio])

  const respuesta = cliente.delete(`/ejercicios/${ejercicio_id}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  expect(contar_notas(bd, ejercicio_id)).toBe(0)
  // El radio del borrado no se pasa de largo: las notas de otro ejercicio siguen ahí
  expect(contar_notas(bd, otro_ejercicio_id)).toBe(1)
})

// --- Lo oculto: se puede abrir, borrar y mostrar, pero no editar ---------
//
// Cada cosa oculta tiene su vista "está oculta", con Mostrar y Borrar. Para eso tiene que poder
// abrirse (GET por id), borrarse y mostrarse; lo que no se puede es editarla sin mostrarla antes
// (409, no 404: el GET sí la devuelve). Elegirla en otro sitio (un ejercicio oculto para una
// serie nueva) es otra cosa: da 404, porque lo oculto deja de ofrecerse.

test('las_notas_de_un_ejercicio_oculto_se_pueden_leer_y_escribir', () => {
  // Las notas no usan el ejercicio: son de quien entrena, y un buen sitio para apuntar por qué
  // se ocultó.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const ruta = `/ejercicios/${ejercicio_id}/notas`
  const vieja_id = cliente.post(ruta, { json: { nota: 'Codos pegados' } }).json().id
  ocultar(cliente, `/ejercicios/${ejercicio_id}`)

  const nueva = cliente.post(ruta, { json: { nota: 'Oculto: me molesta el hombro' } })
  const editada = cliente.put(`${ruta}/${nueva.json().id}`, {
    json: { nota: 'Oculto por el hombro' },
  })
  const borrada = cliente.delete(`${ruta}/${vieja_id}`)

  expect([nueva.status_code, editada.status_code, borrada.status_code]).toEqual([201, 200, 204])
  expect(
    cliente
      .get(ruta)
      .json()
      .map((nota: any) => nota.nota),
  ).toEqual(['Oculto por el hombro'])
})

const EJERCICIO_OCULTO = 'Este ejercicio está oculto. Muéstralo antes de editarlo.'
const HUECO_OCULTO =
  'Este ejercicio está oculto en la rutina. Muéstralo en la rutina antes de cambiarlo.'
const RUTINA_OCULTA = 'Esta rutina está oculta. Muéstrala antes de cambiarla.'

test('editar_algo_oculto_da_409', () => {
  // Con su mensaje, y sin tocar nada. Al hueco se le manda su mismo principal, visible: el 409
  // solo puede ser por estar oculto.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const ejercicio_id = crear_ejercicio(cliente, g)
  const principal = crear_ejercicio(cliente, g, 'Remo')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, principal)
  const hueco = cuerpo_de_hueco(principal, { series: 3, reps: [8, 12] })
  ocultar(cliente, `/ejercicios/${ejercicio_id}`)
  ocultar(cliente, `/rutinas/${rutina_id}/slots/${slot_id}`)

  const editar_ejercicio = cliente.put(`/ejercicios/${ejercicio_id}`, {
    json: { nombre: 'Otro nombre', grupo_muscular_id: g },
  })
  const editar_hueco = cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, { json: hueco })

  expect([editar_ejercicio.status_code, editar_ejercicio.json().detail]).toEqual([
    409,
    EJERCICIO_OCULTO,
  ])
  expect([editar_hueco.status_code, editar_hueco.json().detail]).toEqual([409, HUECO_OCULTO])
  expect(cliente.get(`/ejercicios/${ejercicio_id}`).json().nombre).toBe('Press banca')
  const guardados = cliente.get(`/rutinas/${rutina_id}`).json().slots
  expect(guardados).toHaveLength(1)
  expect(guardados[0].series_objetivo).toBe(4)
})

test('editar_un_ejercicio_oculto_da_409_antes_de_mirar_el_grupo', () => {
  // El orden del PUT es 404 → 403 → 409 → grupo: un ejercicio oculto se tiene que mostrar antes
  // de nada, aunque el grupo que se manda tampoco exista.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  ocultar(cliente, `/ejercicios/${ejercicio_id}`)

  const respuesta = cliente.put(`/ejercicios/${ejercicio_id}`, {
    json: { nombre: 'Otro', grupo_muscular_id: 999_999 },
  })

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe(EJERCICIO_OCULTO)
})

test('en_una_rutina_oculta_no_se_puede_editar_nada', () => {
  // Ni ella ni sus huecos, aunque el hueco esté visible: 409 con el mensaje de la rutina, lo
  // primero que se mira, también si el PUT trae comodines o el orden. (Ocultar, mostrar y borrar
  // un hueco, en `un_hueco_de_una_rutina_oculta_no_se_oculta_muestra_ni_borra`.)
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  ocultar(cliente, `/rutinas/${rutina_id}`)
  const hueco = cuerpo_de_hueco(ejercicio_id, { orden: 2, series: 3, reps: [8, 12] })
  const antes = cliente.get(`/rutinas/${rutina_id}`).json()

  const respuestas = [
    cliente.put(`/rutinas/${rutina_id}`, { json: { nombre: 'Pull' } }),
    cliente.post(`/rutinas/${rutina_id}/slots`, { json: hueco }),
    cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, { json: hueco }),
  ]

  for (const respuesta of respuestas) {
    expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, RUTINA_OCULTA])
  }
  expect(cliente.get(`/rutinas/${rutina_id}`).json()).toEqual(antes)
})

test('algo_oculto_se_puede_borrar_en_definitivo', () => {
  // Es el Borrar de la vista "está oculto", cada cosa con su historial. El hueco oculto se borra
  // con su rutina visible: dentro de una rutina oculta no se puede (ver
  // `un_hueco_de_una_rutina_oculta_no_se_oculta_muestra_ni_borra`).
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const otro_slot = segundo_hueco(cliente, rutina_id, ejercicio_id)
  sesion_con_series(cliente, rutina_id, FECHA, [slot_id, ejercicio_id])
  sesion_con_series(cliente, rutina_id, '2026-09-05', [otro_slot, ejercicio_id])

  ocultar(cliente, `/rutinas/${rutina_id}/slots/${slot_id}`)
  // Ya oculto, el 409 sin modo sigue siendo el que pide elegir, no el de editar algo oculto.
  let sin_modo = cliente.delete(`/rutinas/${rutina_id}/slots/${slot_id}`)
  expect([sin_modo.status_code, sin_modo.json().detail]).toEqual([409, PIDE_MODO.hueco])
  const hueco = cliente.delete(`/rutinas/${rutina_id}/slots/${slot_id}?modo=definitivo`)
  ocultar(cliente, `/rutinas/${rutina_id}`)
  sin_modo = cliente.delete(`/rutinas/${rutina_id}`)
  expect([sin_modo.status_code, sin_modo.json().detail]).toEqual([409, PIDE_MODO.rutina])
  const rutina = cliente.delete(`/rutinas/${rutina_id}?modo=definitivo`)
  ocultar(cliente, `/ejercicios/${ejercicio_id}`)
  const ejercicio = cliente.delete(`/ejercicios/${ejercicio_id}?modo=definitivo`)

  expect([hueco.status_code, rutina.status_code, ejercicio.status_code]).toEqual([204, 204, 204])
  expect(cliente.get(`/rutinas/${rutina_id}`).status_code).toBe(404)
  expect(cliente.get(`/ejercicios/${ejercicio_id}`).status_code).toBe(404)
})

test('un_hueco_de_una_rutina_oculta_no_se_oculta_muestra_ni_borra', () => {
  // Cambiar lo de dentro de una rutina oculta no se permite: ocultar, mostrar o borrar uno de
  // sus huecos (con o sin `modo`) da 409 con el mensaje de la rutina, y el hueco no cambia.
  // Antes, `admitir_oculto` dejaba pasar también a la rutina oculta y las tres cosas se podían
  // hacer sin mostrarla.
  const { cliente, bd } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, visible] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const oculto = segundo_hueco(cliente, rutina_id, ejercicio_id)
  sesion_con_series(cliente, rutina_id, FECHA, [visible, ejercicio_id])
  ocultar(cliente, `/rutinas/${rutina_id}/slots/${oculto}`)
  ocultar(cliente, `/rutinas/${rutina_id}`)
  const ruta = `/rutinas/${rutina_id}/slots`
  const antes = cliente.get(`/rutinas/${rutina_id}`).json()

  const respuestas = [
    cliente.delete(`${ruta}/${visible}`),
    cliente.delete(`${ruta}/${visible}?modo=ocultar`),
    cliente.delete(`${ruta}/${visible}?modo=definitivo`),
    cliente.delete(`${ruta}/${oculto}`),
    cliente.delete(`${ruta}/${oculto}?modo=definitivo`),
    cliente.post(`${ruta}/${oculto}/mostrar`),
  ]

  for (const respuesta of respuestas) {
    expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, RUTINA_OCULTA])
  }
  expect(cliente.get(`/rutinas/${rutina_id}`).json()).toEqual(antes)
  expect(contar(bd, 'rutina_slots')).toBe(2)
  expect(contar(bd, 'series')).toBe(1)
})

test('un_hueco_de_una_rutina_oculta_se_muestra_tras_mostrar_la_rutina', () => {
  // El camino para recuperarlo: primero la rutina y después el hueco.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  ocultar(cliente, `/rutinas/${rutina_id}/slots/${slot_id}`)
  ocultar(cliente, `/rutinas/${rutina_id}`)

  const rutina = cliente.post(`/rutinas/${rutina_id}/mostrar`)
  const hueco = cliente.post(`/rutinas/${rutina_id}/slots/${slot_id}/mostrar`)

  expect([rutina.status_code, hueco.status_code]).toEqual([200, 200])
  expect(hueco.json().oculto_desde).toBeNull()
})

test('un_hueco_que_no_existe_da_404_aunque_su_rutina_este_oculta', () => {
  // Los 404 van antes que los 409: un hueco que no existe, o que es de otra rutina, da 404 por
  // mucho que la rutina de la ruta esté oculta.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const otra = crear_rutina(cliente, 'Pull')
  const de_otra = crear_hueco(cliente, otra, ejercicio_id)
  ocultar(cliente, `/rutinas/${rutina_id}`)
  const hueco = cuerpo_de_hueco(ejercicio_id, { series: 3, reps: [8, 12] })

  for (const slot_id of [999_999, de_otra]) {
    const ruta = `/rutinas/${rutina_id}/slots/${slot_id}`
    for (const respuesta of [
      cliente.delete(ruta),
      cliente.delete(`${ruta}?modo=definitivo`),
      cliente.post(`${ruta}/mostrar`),
      cliente.put(ruta, { json: hueco }),
    ]) {
      expect([respuesta.status_code, respuesta.json().detail]).toEqual([
        404,
        'Ese ejercicio no está en esta rutina.',
      ])
    }
  }
  expect(cliente.get(`/rutinas/${otra}`).json().slots).toHaveLength(1)
})

// --- Los predefinidos vienen con la app ----------------------------------

test('un_ejercicio_predefinido_no_se_puede_editar_ocultar_ni_borrar', () => {
  // Vienen con la app: los archivos de exportación los buscan por nombre, así que cambiarlos o
  // borrarlos rompería la importación. 403, porque la acción no está permitida sobre ese recurso
  // y ningún cambio de estado lo arregla. Tampoco se pueden "mostrar": nunca están ocultos. Cada
  // 403, con su mensaje (y no el de otra comprobación), y sin tocar nada.
  const { cliente, bd } = crearCliente()
  const predefinido = ejercicio_predefinido_id(bd)
  const ruta = `/ejercicios/${predefinido}`
  const antes = cliente.get(ruta).json()
  const no_se_borra = 'Los ejercicios predefinidos no se pueden ocultar ni borrar.'

  const editar = cliente.put(ruta, {
    json: { nombre: 'Otra cosa', grupo_muscular_id: grupo_muscular_id(cliente) },
  })

  expect(editar.status_code).toBe(403)
  expect(editar.json().detail).toBe('Los ejercicios predefinidos no se pueden editar.')
  for (const modo of [null, 'ocultar', 'definitivo']) {
    const respuesta = cliente.delete(ruta, { params: modo ? { modo } : undefined })
    expect([modo, respuesta.status_code]).toEqual([modo, 403])
    expect([modo, respuesta.json().detail]).toEqual([modo, no_se_borra])
  }
  const mostrar = cliente.post(`${ruta}/mostrar`)
  expect(mostrar.status_code).toBe(403)
  expect(mostrar.json().detail).toBe('Los ejercicios predefinidos no se ocultan.')
  expect(cliente.get(ruta).json()).toEqual(antes)
  const fila = bd.una<any>('SELECT * FROM ejercicios WHERE id = ?', predefinido)!
  expect([fila.nombre, fila.oculto_desde, fila.es_predefinido]).toEqual([
    'Sentadilla con barra',
    null,
    1,
  ])
})

test('editar_un_predefinido_da_403_antes_de_mirar_el_grupo', () => {
  // El orden del PUT es 404 → 403 → 409 → grupo: con un grupo que no existe, lo que se dice es
  // que el predefinido no se edita, no que falta el grupo.
  const { cliente, bd } = crearCliente()

  const respuesta = cliente.put(`/ejercicios/${ejercicio_predefinido_id(bd)}`, {
    json: { nombre: 'Otra cosa', grupo_muscular_id: 999_999 },
  })

  expect(respuesta.status_code).toBe(403)
  expect(respuesta.json().detail).toBe('Los ejercicios predefinidos no se pueden editar.')
})

test('el_cliente_no_puede_crear_ni_convertir_un_ejercicio_en_predefinido', () => {
  // `es_predefinido` es lo único que separa lo que viene con la app de lo propio. Si el cuerpo
  // pudiera ponerlo, saldría un ejercicio que no se edita ni se borra, que borrar todos los datos
  // no se lleva y que exportar no guarda. El backend lo ignora al crear y al editar, igual que
  // `oculto_desde`.
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const colado = { es_predefinido: true, oculto_desde: '2026-09-01' }
  const creado = cliente.post('/ejercicios', {
    json: { nombre: 'Press del autor', grupo_muscular_id: g, ...colado },
  })
  expect(creado.status_code).toBe(201)
  const ruta = `/ejercicios/${creado.json().id}`
  const editado = cliente.put(ruta, {
    json: { nombre: 'Press del autor', grupo_muscular_id: g, ...colado },
  })

  expect(editado.status_code).toBe(200)
  for (const respuesta of [creado, editado]) {
    expect([respuesta.json().es_predefinido, respuesta.json().oculto_desde]).toEqual([false, null])
  }
  const fila = bd.una<any>('SELECT * FROM ejercicios WHERE id = ?', creado.json().id)!
  expect([fila.es_predefinido, fila.oculto_desde]).toEqual([0, null])
  expect(cliente.get('/datos/resumen').json().ejercicios).toBe(1)
  expect(cliente.delete(ruta).status_code).toBe(204)
})

test('un_predefinido_en_uso_da_403_y_no_el_409_que_pide_modo', () => {
  // Con historial, el DELETE sin modo de un propio da 409 para que se elija `modo`; el de un
  // predefinido tiene que pararse antes, en el 403, y no borrar nada aunque venga con
  // `modo=definitivo`.
  const { cliente, bd } = crearCliente()
  const predefinido = ejercicio_predefinido_id(bd)
  const rutina_id = crear_rutina(cliente, 'Pierna')
  const slot_id = crear_hueco(cliente, rutina_id, predefinido)
  const sesion = sesion_con_series(cliente, rutina_id, '2026-09-01', [slot_id, predefinido])
  const ruta = `/ejercicios/${predefinido}`

  for (const params of [undefined, { modo: 'definitivo' }]) {
    const respuesta = cliente.delete(ruta, { params })
    expect(respuesta.status_code).toBe(403)
    expect(respuesta.json().detail).toBe(
      'Los ejercicios predefinidos no se pueden ocultar ni borrar.',
    )
  }
  expect(cliente.get(`/entrenamientos/${sesion}`).json().series).toHaveLength(1)
  expect(
    cliente
      .get(`/rutinas/${rutina_id}`)
      .json()
      .slots.map((h: any) => h.id),
  ).toEqual([slot_id])
  expect(cliente.get(`${ruta}/aviso-de-borrado`).status_code).toBe(404)
})

// --- Lo oculto y lo que ya se registró con ello ---------------------------
//
// Ocultar deja de ofrecer algo para lo nuevo, pero el historial se queda. Por eso usar algo
// oculto en una serie *nueva* se rechaza, pero corregir lo que ya se apuntó con ello (una serie
// vieja, las notas de un día pasado) no debería.

test('un_hueco_oculto_no_se_puede_usar_en_una_serie_nueva', () => {
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
  ocultar(cliente, `/rutinas/${rutina_id}/slots/${slot_id}`)

  const respuesta = cliente.post(`/entrenamientos/${entrenamiento_id}/series`, {
    json: cuerpo_serie(ejercicio_id, slot_id, { numero: 2 }),
  })

  // 404 y no 409: lo oculto deja de ofrecerse, así que para elegirlo es como si no existiera,
  // igual que un ejercicio oculto en una serie nueva.
  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Ese ejercicio no está en la rutina de esta sesión.')
  expect(cliente.get(`/entrenamientos/${entrenamiento_id}`).json().series).toHaveLength(1)
})

test('una_serie_no_se_puede_mover_a_otro_hueco_oculto', () => {
  // Corregir sí, elegir algo oculto no: el hueco oculto que la serie ya tenía no estorba, pero
  // moverla a otro que está oculto es elegirlo. 404, y la serie se queda donde estaba. El
  // ejercicio es el principal de los dos huecos: el 404 solo puede ser por el hueco de destino.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const oculto = segundo_hueco(cliente, rutina_id, ejercicio_id)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
  const [serie] = series_de(cliente, entrenamiento_id)!
  ocultar(cliente, `/rutinas/${rutina_id}/slots/${oculto}`)

  const respuesta = cliente.put(`/entrenamientos/${entrenamiento_id}/series/${serie.id}`, {
    json: cuerpo_serie(ejercicio_id, oculto),
  })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Ese ejercicio no está en la rutina de esta sesión.')
  expect(series_de(cliente, entrenamiento_id)).toEqual([serie])
})

test('una_serie_de_un_hueco_oculto_se_puede_corregir_sin_cambiarle_el_hueco', () => {
  // Corregir lo que ya se apuntó no es elegir nada nuevo: el hueco oculto que la serie ya tenía
  // no estorba.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
  const [serie] = cliente.get(`/entrenamientos/${entrenamiento_id}`).json().series
  ocultar(cliente, `/rutinas/${rutina_id}/slots/${slot_id}`)

  const respuesta = cliente.put(`/entrenamientos/${entrenamiento_id}/series/${serie.id}`, {
    json: cuerpo_serie(ejercicio_id, slot_id, { repeticiones: 6 }),
  })

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().repeticiones).toBe(6)
})

test('en_un_hueco_oculto_una_serie_se_corrige_a_su_comodin_pero_no_a_otro_ejercicio', () => {
  // El hueco no cambia, así que no se valida que esté oculto; el ejercicio sí cambia, y tiene
  // que seguir siendo del hueco (422 si no, sin tocar la serie). Es el despiste típico de un día
  // pasado: se apuntó el press y era la máquina.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const press = crear_ejercicio(cliente, g, 'Press banca')
  const maquina = crear_ejercicio(cliente, g, 'Press en máquina')
  const remo = crear_ejercicio(cliente, g, 'Remo')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, press)
  poner_alternativas(cliente, rutina_id, slot_id, [maquina])
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, press)
  const [serie] = series_de(cliente, entrenamiento_id)!
  ocultar(cliente, `/rutinas/${rutina_id}/slots/${slot_id}`)
  const ruta = `/entrenamientos/${entrenamiento_id}/series/${serie.id}`

  const ajena = cliente.put(ruta, {
    json: cuerpo_serie(remo, slot_id, { peso: 50, repeticiones: 10 }),
  })
  expect([ajena.status_code, ajena.json().detail]).toEqual([
    422,
    'Ese ejercicio no es ni el de la rutina ni una de sus alternativas.',
  ])
  expect(series_de(cliente, entrenamiento_id)).toEqual([serie])

  const corregida = cliente.put(ruta, {
    json: cuerpo_serie(maquina, slot_id, { peso: 50, repeticiones: 10 }),
  })
  expect(corregida.status_code).toBe(200)
  expect([corregida.json().ejercicio_id, corregida.json().slot_id]).toEqual([maquina, slot_id])
})

test('se_puede_corregir_una_serie_ya_registrada_de_un_ejercicio_oculto', () => {
  // El README promete que una sesión terminada admite series corregidas "para poder editar un
  // día ya pasado", y ocultar promete conservar el historial.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
  const [serie] = cliente.get(`/entrenamientos/${entrenamiento_id}`).json().series
  ocultar(cliente, `/ejercicios/${ejercicio_id}`)

  const respuesta = cliente.put(`/entrenamientos/${entrenamiento_id}/series/${serie.id}`, {
    json: cuerpo_serie(ejercicio_id, slot_id, { repeticiones: 12 }),
  })

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().repeticiones).toBe(12)
})

test('se_pueden_editar_las_notas_de_un_dia_cuya_rutina_se_oculto_despues', () => {
  // Corregir una sesión ya registrada no es elegir su rutina otra vez: el PUT ni siquiera la
  // recibe (se fija al crear la sesión), así que una rutina oculta después no estorba. Hubo un
  // tiempo en que el PUT revalidaba la rutina y esto daba 404.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
  ocultar(cliente, `/rutinas/${rutina_id}`)

  const respuesta = cliente.put(`/entrenamientos/${entrenamiento_id}`, {
    json: { fecha: FECHA, notas: 'Me dolía el hombro' },
  })

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().notas).toBe('Me dolía el hombro')
})

test('una_serie_no_se_puede_cambiar_a_otro_ejercicio_oculto', () => {
  // Corregir sí, elegir algo oculto no: cambiar el ejercicio de una serie es elegir uno, y lo
  // oculto no se ofrece.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const banca = crear_ejercicio(cliente, g, 'Press banca')
  const maquina = crear_ejercicio(cliente, g, 'Press en máquina')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, banca)
  const entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, banca)
  const [serie] = cliente.get(`/entrenamientos/${entrenamiento_id}`).json().series
  ocultar(cliente, `/ejercicios/${maquina}`)

  const respuesta = cliente.put(`/entrenamientos/${entrenamiento_id}/series/${serie.id}`, {
    json: cuerpo_serie(maquina, slot_id),
  })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe(ejercicio_oculto('Press en máquina'))
  expect(series_de(cliente, entrenamiento_id)).toEqual([serie])
})

// --- Lo que no bloquea el borrado, y lo que sí ----------------------------

test('un_ejercicio_que_solo_tiene_notas_se_borra_directo_y_se_las_lleva', () => {
  // Decisión del autor: las notas son un accesorio del ejercicio (su FK es CASCADE), no
  // historial. Un ejercicio que solo tiene notas se borra sin 409 ni `?modo`, y sus notas se van
  // con él.
  const { cliente, bd } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  crear_nota(cliente, ejercicio_id, 'El asiento va en el 4')

  expect(cliente.delete(`/ejercicios/${ejercicio_id}`).status_code).toBe(204)
  expect(contar_notas(bd, ejercicio_id)).toBe(0)
})

test('un_hueco_sin_series_se_borra_directo_y_sus_comodines_con_el', () => {
  // Sin series no hay nada que perder: sin `?modo`. Los comodines son accesorios del hueco
  // (CASCADE) y se van con él; los ejercicios, no.
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const principal = crear_ejercicio(cliente, g, 'Press banca')
  const comodin = crear_ejercicio(cliente, g, 'Press en máquina')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, principal)
  poner_alternativas(cliente, rutina_id, slot_id, [comodin])

  expect(cliente.delete(`/rutinas/${rutina_id}/slots/${slot_id}`).status_code).toBe(204)

  expect(cliente.get(`/rutinas/${rutina_id}`).json().slots).toEqual([])
  expect(contar(bd, 'slot_alternativas')).toBe(0)
  expect(cliente.get(`/ejercicios/${comodin}`).status_code).toBe(200)
})

test('una_rutina_con_solo_sesiones_canceladas_se_borra_directa_y_se_las_lleva', () => {
  // Una sesión vacía que ya no está en curso está cancelada (`esta_cancelada`): no se hizo nada
  // en ella y no es historial. Ni la de un día pasado que se quedó sin terminar ni la de hoy ya
  // terminada bloquean el borrado.
  //
  // Antes, cualquier sesión pedía `modo`. Y hay que llevárselas igualmente: con
  // `entrenamientos.rutina_id` en RESTRICT, si el camino directo no las borrara daría un 500.
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const rutina_id = crear_rutina(cliente, 'Brazos')
  const olvidada = cliente.post('/entrenamientos', { json: { rutina_id, fecha: FECHA } }).json().id
  const de_hoy = cliente.post('/entrenamientos', { json: { rutina_id, fecha: HOY } }).json().id
  expect(cliente.post(`/entrenamientos/${de_hoy}/terminar`).status_code).toBe(200)

  expect(aviso_de_rutina(cliente, rutina_id)).toEqual({
    con_historial: false,
    huecos: 0,
    sesiones: 0,
    dias_de_programa: 0,
    dias_planificados: 0,
    toco_dias_pasados: false,
    sesion_en_curso: false,
  })
  expect(cliente.delete(`/rutinas/${rutina_id}`).status_code).toBe(204)
  expect(cliente.get(`/rutinas/${rutina_id}`).status_code).toBe(404)
  expect(cliente.get(`/entrenamientos/${olvidada}`).status_code).toBe(404)
  expect(cliente.get(`/entrenamientos/${de_hoy}`).status_code).toBe(404)
})

test('una_rutina_con_huecos_y_una_sesion_cancelada_pide_modo_y_el_definitivo_se_lo_lleva_todo', () => {
  // La cancelada no bloquea, pero los huecos sí.
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const [rutina_id] = crear_rutina_con_hueco(
    cliente,
    crear_ejercicio(cliente, grupo_muscular_id(cliente)),
  )
  const cancelada = cliente.post('/entrenamientos', { json: { rutina_id, fecha: FECHA } }).json().id

  const respuesta = cliente.delete(`/rutinas/${rutina_id}`)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, PIDE_MODO.rutina])
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(200)
  expect(cliente.delete(`/rutinas/${rutina_id}?modo=definitivo`).status_code).toBe(204)
  expect(cliente.get(`/rutinas/${rutina_id}`).status_code).toBe(404)
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(404)
})

test('una_rutina_sin_huecos_con_una_sesion_vacia_abierta_hoy_pide_modo', () => {
  // La sesión de hoy recién empezada no está cancelada aunque no tenga series: se acaba de
  // empezar. Cuenta como historial, el aviso lo dice con `sesion_en_curso` (aunque `sesiones`,
  // que cuenta las que tienen series, dé 0) y `?modo=definitivo` se la lleva.
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const rutina_id = crear_rutina(cliente)
  const abierta = cliente.post('/entrenamientos', { json: { rutina_id, fecha: HOY } }).json().id

  const aviso = aviso_de_rutina(cliente, rutina_id)
  const respuesta = cliente.delete(`/rutinas/${rutina_id}`)

  expect([aviso.con_historial, aviso.sesion_en_curso, aviso.sesiones]).toEqual([true, true, 0])
  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, PIDE_MODO.rutina])
  expect(series_de(cliente, abierta)).toEqual([])
  expect(cliente.delete(`/rutinas/${rutina_id}?modo=definitivo`).status_code).toBe(204)
  expect(cliente.get(`/entrenamientos/${abierta}`).status_code).toBe(404)
})

test('borrar_en_definitivo_el_principal_de_un_hueco_con_series_del_comodin', () => {
  // El hueco se entrenó con el comodín, nunca con el principal. Borrar el principal en
  // definitivo se lleva el hueco entero (así lo anuncia el aviso), así que tiene que acabar en
  // 204, no en un error de la base de datos.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const principal = crear_ejercicio(cliente, g, 'Press banca')
  const comodin = crear_ejercicio(cliente, g, 'Press en máquina')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, principal)
  poner_alternativas(cliente, rutina_id, slot_id, [comodin])
  registrar_serie(cliente, rutina_id, slot_id, comodin)

  const sin_modo = cliente.delete(`/ejercicios/${principal}`)
  expect([sin_modo.status_code, sin_modo.json().detail]).toEqual([409, PIDE_MODO.ejercicio])
  const respuesta = cliente.delete(`/ejercicios/${principal}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  expect(cliente.get(`/rutinas/${rutina_id}`).json().slots).toEqual([])
})

// --- Más sobre lo oculto -------------------------------------------------

test.each([['ejercicio'], ['rutina'], ['hueco'], ['programa']])(
  'volver_a_ocultar_conserva_desde_cuando (%s)',
  (que) => {
    // La fecha es la de la primera vez: volver a ocultar no la mueve.
    const { cliente, bd } = crearCliente()
    const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
    const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, ejercicio_id)
    const programa_id = cliente.post('/programas', { json: { nombre: 'PPL' } }).json().id
    const [tabla, fila, ruta] = {
      ejercicio: ['ejercicios', ejercicio_id, `/ejercicios/${ejercicio_id}`],
      rutina: ['rutinas', rutina_id, `/rutinas/${rutina_id}`],
      hueco: ['rutina_slots', slot_id, `/rutinas/${rutina_id}/slots/${slot_id}`],
      programa: ['programas', programa_id, `/programas/${programa_id}`],
    }[que] as [string, number, string]
    ocultar(cliente, ruta)
    bd.ejecutar(`UPDATE ${tabla} SET oculto_desde = ? WHERE id = ?`, '2026-01-15', fila)

    ocultar(cliente, ruta)

    let leido: any
    if (que === 'hueco') {
      const huecos = cliente.get(`/rutinas/${rutina_id}`).json().slots
      expect(huecos).toHaveLength(1)
      leido = huecos[0]
    } else {
      leido = cliente.get(ruta).json()
    }
    expect(leido.oculto_desde).toBe('2026-01-15')
  },
)

test('un_hueco_no_puede_cambiar_su_principal_a_un_ejercicio_oculto', () => {
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const banca = crear_ejercicio(cliente, g, 'Press banca')
  const maquina = crear_ejercicio(cliente, g, 'Press en máquina')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, banca)
  ocultar(cliente, `/ejercicios/${maquina}`)

  const respuesta = cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, {
    json: cuerpo_de_hueco(maquina, { series: 5 }),
  })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe(ejercicio_oculto('Press en máquina'))
  const guardados = cliente.get(`/rutinas/${rutina_id}`).json().slots
  expect(guardados).toHaveLength(1)
  expect([guardados[0].ejercicio_principal.id, guardados[0].series_objetivo]).toEqual([banca, 4])
})

test('un_hueco_cuyo_principal_se_oculto_se_puede_editar_sin_cambiarlo', () => {
  // Ocultar el ejercicio no lo saca del hueco (el hueco lo enseña en gris). Si luego se quiere
  // cambiar el objetivo del hueco, mandar el mismo principal no es elegir nada nuevo: es la
  // regla "corregir sí, elegir algo oculto no" que ya siguen las series y los entrenamientos.
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, banca)
  ocultar(cliente, `/ejercicios/${banca}`)

  const respuesta = cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, {
    json: cuerpo_de_hueco(banca, { series: 5 }),
  })

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().series_objetivo).toBe(5)
})

// --- Coherencia entre huecos, comodines y series -------------------------

/** Un hueco con Press banca de principal y Press en máquina de comodín. */
function con_comodin(
  cliente: Cliente,
  g: number,
): [principal: number, comodin: number, rutina_id: number, slot_id: number] {
  const principal = crear_ejercicio(cliente, g, 'Press banca')
  const comodin = crear_ejercicio(cliente, g, 'Press en máquina')
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, principal)
  poner_alternativas(cliente, rutina_id, slot_id, [comodin])
  return [principal, comodin, rutina_id, slot_id]
}

test('un_comodin_no_puede_pasar_a_principal_de_su_mismo_hueco', () => {
  // Acabaría siendo las dos cosas a la vez. (Con la lista de comodines en el mismo PUT sí vale:
  // ver `objetivos.test.ts`.)
  const { cliente } = crearCliente()
  const [principal, comodin, rutina_id, slot_id] = con_comodin(cliente, grupo_muscular_id(cliente))

  const respuesta = cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, {
    json: cuerpo_de_hueco(comodin),
  })

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe(
    'Ese ejercicio ya es una alternativa de este. Quítalo de las alternativas antes' +
      ' de hacerlo el principal.',
  )
  const huecos = cliente.get(`/rutinas/${rutina_id}`).json().slots
  expect(huecos).toHaveLength(1)
  expect(huecos[0].ejercicio_principal.id).toBe(principal)
})

test('una_serie_se_puede_corregir_aunque_su_ejercicio_ya_no_sea_comodin', () => {
  // Corregir lo que ya se apuntó no es elegir nada nuevo. Pero cambiarla a un ejercicio que no es
  // del hueco sigue sin valer.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const [, comodin, rutina_id, slot_id] = con_comodin(cliente, g)
  const otro = crear_ejercicio(cliente, g, 'Curl')
  const entrenamiento_id = cliente
    .post('/entrenamientos', { json: { rutina_id, fecha: FECHA } })
    .json().id
  const ruta = `/entrenamientos/${entrenamiento_id}/series`
  const serie_id = cliente.post(ruta, { json: cuerpo_serie(comodin, slot_id) }).json().id
  poner_alternativas(cliente, rutina_id, slot_id, [])

  const corregida = cliente.put(`${ruta}/${serie_id}`, {
    json: cuerpo_serie(comodin, slot_id, { peso: 65 }),
  })
  const cambiada = cliente.put(`${ruta}/${serie_id}`, { json: cuerpo_serie(otro, slot_id) })

  expect(corregida.status_code).toBe(200)
  expect(corregida.json().peso).toBe('65.00')
  expect(cambiada.status_code).toBe(422)
  expect(cambiada.json().detail).toBe(
    'Ese ejercicio no es ni el de la rutina ni una de sus alternativas.',
  )
})

test('en_una_sesion_de_una_rutina_ya_oculta_se_pueden_seguir_apuntando_series', () => {
  // La sesión ya estaba empezada: completarla es corregir, no elegir la rutina oculta de nuevo
  // (decisión del autor).
  const { cliente } = crearCliente()
  const [principal, , rutina_id, slot_id] = con_comodin(cliente, grupo_muscular_id(cliente))
  const entrenamiento_id = cliente
    .post('/entrenamientos', { json: { rutina_id, fecha: FECHA } })
    .json().id
  ocultar(cliente, `/rutinas/${rutina_id}`)

  const respuesta = cliente.post(`/entrenamientos/${entrenamiento_id}/series`, {
    json: cuerpo_serie(principal, slot_id),
  })

  expect(respuesta.status_code).toBe(201)
})

// --- Una rutina que ya estuvo en el plan -----------------------------------
//
// Borrarla se lleva en cascada sus días de programa y sus días planificados, también los
// pasados, y el calendario los pintaría como descanso. Por eso pide `modo` aunque no tenga huecos
// ni sesiones. Parten de la semana de `apoyo/semana.ts` (hoy, miércoles 16; Push/Pull/Leg activo
// desde el 31 de agosto).

function plan_del_dia(cliente: Cliente, fecha: string): any {
  return cliente.get('/plan/seguimiento', { params: { desde: fecha, hasta: fecha } }).json()[0]
}

test('borrarla_en_definitivo_deja_esos_dias_en_descanso', () => {
  const { cliente, reloj } = crearCliente()
  const rutinas = ppl(cliente, reloj)

  expect(cliente.delete(`/rutinas/${rutinas.Push}?modo=definitivo`).status_code).toBe(204)

  expect(plan_del_dia(cliente, LUNES_14).descanso).toBe(true)
})

test('una_rutina_quitada_del_programa_tambien_cuenta', () => {
  // Su fila del programa está cerrada, pero valió para los viernes pasados.
  const { cliente, reloj } = crearCliente()
  const rutinas = ppl(cliente, reloj)
  const programa = cliente.get('/programas').json()[0].id
  expect(cambiar_dias(cliente, programa, { 5: null }).status_code).toBe(200)

  const respuesta = cliente.delete(`/rutinas/${rutinas.Leg}`)
  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, PIDE_MODO.rutina])
  // El motivo son los días pasados, no otra cosa: no tiene huecos ni sesiones.
  expect(aviso_de_rutina(cliente, rutinas.Leg).toco_dias_pasados).toBe(true)
  expect(cliente.get(`/rutinas/${rutinas.Leg}`).status_code).toBe(200)
})

test('una_rutina_planificada_a_mano_para_un_dia_pasado_tambien_cuenta', () => {
  const { cliente, reloj } = crearCliente()
  ppl(cliente, reloj)
  const brazos = crear_rutina(cliente, 'Brazos')
  reloj.fijar(MARTES_15)
  expect(
    cliente.put(`/plan/excepciones/${MARTES_15}`, { json: { rutina_id: brazos } }).status_code,
  ).toBe(200)
  reloj.fijar(HOY)

  const respuesta = cliente.delete(`/rutinas/${brazos}`)
  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, PIDE_MODO.rutina])
  // El motivo son los días pasados, no otra cosa: no tiene huecos ni sesiones.
  expect(aviso_de_rutina(cliente, brazos).toco_dias_pasados).toBe(true)
  expect(cliente.get(`/rutinas/${brazos}`).status_code).toBe(200)
})

test('si_su_dia_aun_no_ha_llegado_con_el_programa_activo_se_borra_directa', () => {
  // El programa se activó ayer, martes: el Push de los lunes nunca tocó un día pasado con él
  // activo, y el Pull de los martes sí.
  const { cliente, reloj } = crearCliente()
  const push = crear_rutina(cliente)
  const pull = crear_rutina(cliente, 'Pull')
  reloj.fijar(MARTES_15)
  cliente.post('/programas', {
    json: {
      nombre: 'Dos días',
      activar: true,
      dias: [
        { dia_semana: 1, rutina_id: push },
        { dia_semana: 2, rutina_id: pull },
      ],
    },
  })
  reloj.fijar(HOY)

  expect(cliente.delete(`/rutinas/${push}`).status_code).toBe(204)
  const respuesta = cliente.delete(`/rutinas/${pull}`)
  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, PIDE_MODO.rutina])
  // El motivo son los días pasados, no otra cosa: no tiene huecos ni sesiones.
  expect(aviso_de_rutina(cliente, pull).toco_dias_pasados).toBe(true)
  expect(cliente.get(`/rutinas/${pull}`).status_code).toBe(200)
})

test('una_rutina_que_entra_hoy_en_el_programa_activo_se_borra_directa', () => {
  // El martes del PPL pasa hoy a ser Brazos: su única fila de programa empieza hoy y no tiene
  // nada en común con el pasado. Sin huecos ni sesiones, el DELETE sin modo la borra y el martes
  // vuelve a descanso.
  const { cliente, reloj } = crearCliente()
  ppl(cliente, reloj)
  const brazos = crear_rutina(cliente, 'Brazos')
  const programa = cliente.get('/programas').json()[0].id
  const respuesta = cambiar_dias(cliente, programa, { 2: brazos })
  expect(respuesta.status_code).toBe(200)

  const aviso = aviso_de_rutina(cliente, brazos)
  const borrada = cliente.delete(`/rutinas/${brazos}`)

  expect([aviso.con_historial, aviso.toco_dias_pasados]).toEqual([false, false])
  expect(aviso.dias_de_programa).toBe(1)
  expect(borrada.status_code).toBe(204)
  expect(cliente.get(`/rutinas/${brazos}`).status_code).toBe(404)
  expect(plan_del_dia(cliente, '2026-09-22').descanso).toBe(true)
})

// --- El aviso de borrar un hueco ---------------------------------------------
//
// `GET /rutinas/{id}/slots/{slot_id}/aviso-de-borrado`: lo que el diálogo de confirmar cuenta
// antes de borrar. Las fechas son de la semana de `apoyo/semana.ts`; hoy es el miércoles 16.

const PRIMERO_DE_SEPTIEMBRE = '2026-09-01'
const CUATRO_DE_SEPTIEMBRE = '2026-09-04'
const OCHO_DE_SEPTIEMBRE = '2026-09-08'
const DIEZ_DE_SEPTIEMBRE = '2026-09-10'

function aviso_de_hueco(cliente: Cliente, rutina_id: number, slot_id: number) {
  return cliente.get(`/rutinas/${rutina_id}/slots/${slot_id}/aviso-de-borrado`)
}

/**
 * Push con el hueco del press (A) y el de fondos (B), y cuatro sesiones:
 *
 * - la del 10, solo con dos series de A (se crea la primera, para que el orden por fecha no
 *   salga gratis del orden de los ids);
 * - la del 1, solo con una de A;
 * - la del 4, con una de A y una de B;
 * - la del 8, solo con una de B.
 *
 * Ninguna está terminada, y todas son de días pasados (hoy es el 16).
 */
function push_con_dos_huecos(cliente: Cliente, reloj: RelojDeTest): Record<string, number> {
  reloj.fijar(HOY)
  const g = grupo_muscular_id(cliente)
  const press = crear_ejercicio(cliente, g, 'Press banca')
  const fondos = crear_ejercicio(cliente, g, 'Fondos')
  const [rutina_id, a] = crear_rutina_con_hueco(cliente, press)
  const b = segundo_hueco(cliente, rutina_id, fondos)
  const sesiones = {
    dia_10: sesion_con_series(cliente, rutina_id, DIEZ_DE_SEPTIEMBRE, [a, press], [a, press]),
    dia_1: sesion_con_series(cliente, rutina_id, PRIMERO_DE_SEPTIEMBRE, [a, press]),
    dia_4: sesion_con_series(cliente, rutina_id, CUATRO_DE_SEPTIEMBRE, [a, press], [b, fondos]),
    dia_8: sesion_con_series(cliente, rutina_id, OCHO_DE_SEPTIEMBRE, [b, fondos]),
  }
  return { rutina_id, a, b, press, ...sesiones }
}

test('el_aviso_de_un_hueco_cuenta_sus_series_desde_cuando_y_las_sesiones_que_vacia', () => {
  // Solo se vacían las sesiones sin series en otro hueco: la del 4 tiene series en los dos, y
  // borrar uno no la deja vacía.
  const { cliente, reloj } = crearCliente()
  const escenario = push_con_dos_huecos(cliente, reloj)
  const rutina_id = escenario.rutina_id

  const aviso = aviso_de_hueco(cliente, rutina_id, escenario.a)
  const del_b = aviso_de_hueco(cliente, rutina_id, escenario.b).json().sesiones_que_se_vacian

  expect(aviso.status_code).toBe(200)
  expect([aviso.json().series, aviso.json().desde]).toEqual([4, '2026-09-01'])
  expect(aviso.json().sesiones_que_se_vacian).toEqual([
    { entrenamiento_id: escenario.dia_1, fecha: '2026-09-01', cubre_fecha: null },
    { entrenamiento_id: escenario.dia_10, fecha: '2026-09-10', cubre_fecha: null },
  ])
  expect(del_b.map((s: any) => s.entrenamiento_id)).toEqual([escenario.dia_8])
})

test('una_sesion_que_se_vacia_dice_que_dia_del_plan_contaba', () => {
  // Es lo que la web enseña: ese día pasaría a sin hacer.
  const { cliente, reloj } = crearCliente()
  const rutinas = ppl(cliente, reloj)
  const sesion = hecha(cliente, grupo_muscular_id(cliente), LUNES_14, rutinas.Push, LUNES_14)
  const hueco = cliente.get(`/rutinas/${rutinas.Push}`).json().slots[0].id

  const aviso = aviso_de_hueco(cliente, rutinas.Push, hueco).json()

  expect(aviso.sesiones_que_se_vacian).toEqual([
    { entrenamiento_id: sesion, fecha: '2026-09-14', cubre_fecha: '2026-09-14' },
  ])
})

test('el_aviso_de_un_hueco_sin_series_va_vacio', () => {
  const { cliente } = crearCliente()
  const [rutina_id, slot_id] = crear_rutina_con_hueco(
    cliente,
    crear_ejercicio(cliente, grupo_muscular_id(cliente)),
  )

  const aviso = aviso_de_hueco(cliente, rutina_id, slot_id)

  expect(aviso.status_code).toBe(200)
  expect(aviso.json()).toEqual({ series: 0, desde: null, sesiones_que_se_vacian: [] })
})

test('el_aviso_de_un_hueco_oculto_se_puede_leer', () => {
  // P4 oculto ofrece Borrar: el diálogo tiene que poder contar lo que se pierde, también con la
  // rutina oculta.
  const { cliente, reloj } = crearCliente()
  const escenario = push_con_dos_huecos(cliente, reloj)
  const { rutina_id, a } = escenario
  expect(cliente.delete(`/rutinas/${rutina_id}/slots/${a}?modo=ocultar`).status_code).toBe(204)
  expect(cliente.delete(`/rutinas/${rutina_id}?modo=ocultar`).status_code).toBe(204)

  const aviso = aviso_de_hueco(cliente, rutina_id, a)

  expect(aviso.status_code).toBe(200)
  expect(aviso.json().series).toBe(4)
  expect(aviso.json().sesiones_que_se_vacian).toHaveLength(2)
})

test('el_aviso_de_un_hueco_no_se_alcanza_por_la_ruta_de_otra_rutina', () => {
  // Los dos existen, pero el hueco no es de Pull. (Un hueco o una rutina que no existen, en la
  // tabla de `crud.test.ts`.)
  const { cliente, reloj } = crearCliente()
  const escenario = push_con_dos_huecos(cliente, reloj)
  const otra = crear_rutina(cliente, 'Pull')

  const respuesta = aviso_de_hueco(cliente, otra, escenario.a)

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Ese ejercicio no está en esta rutina.')
})

test('la_sesion_abierta_hoy_no_se_borra_con_el_hueco_aunque_se_quede_vacia', () => {
  // No está cancelada aunque se quede sin series, y puede estar abierta en E2: borrarla daría un
  // 404 a mitad de entrenamiento. El aviso no la cuenta; sigue abierta, vacía y en curso.
  const { cliente, reloj } = crearCliente()
  const escenario = push_con_dos_huecos(cliente, reloj)
  const { rutina_id, a } = escenario
  const abierta = sesion_con_series(cliente, rutina_id, HOY, [a, escenario.press])

  const aviso = aviso_de_hueco(cliente, rutina_id, a).json()
  const borrado = cliente.delete(`/rutinas/${rutina_id}/slots/${a}?modo=definitivo`)

  expect(aviso.series).toBe(5)
  expect(aviso.sesiones_que_se_vacian.map((s: any) => s.entrenamiento_id)).toEqual([
    escenario.dia_1,
    escenario.dia_10,
  ])
  expect(borrado.status_code).toBe(204)
  expect(series_de(cliente, abierta)).toEqual([])
  expect(sesiones_en_curso(cliente).map((s) => s.id)).toEqual([abierta])
})

test('la_sesion_de_hoy_ya_terminada_si_se_borra_con_el_hueco', () => {
  // Ya no está en curso: sin series se quedaría cancelada, como las de días pasados.
  const { cliente, reloj } = crearCliente()
  const escenario = push_con_dos_huecos(cliente, reloj)
  const { rutina_id, a } = escenario
  const terminada = sesion_con_series(cliente, rutina_id, HOY, [a, escenario.press])
  expect(cliente.post(`/entrenamientos/${terminada}/terminar`).status_code).toBe(200)

  const aviso = aviso_de_hueco(cliente, rutina_id, a).json().sesiones_que_se_vacian
  const borrado = cliente.delete(`/rutinas/${rutina_id}/slots/${a}?modo=definitivo`)

  expect(aviso.map((s: any) => s.entrenamiento_id)).toEqual([
    escenario.dia_1,
    escenario.dia_10,
    terminada,
  ])
  expect(borrado.status_code).toBe(204)
  expect(series_de(cliente, terminada)).toBeNull()
})

test('borrar_un_hueco_en_definitivo_se_lleva_justo_las_sesiones_del_aviso', () => {
  // Regresión del orden en `borrar_slot`: la lista de las sesiones que se vacían se calcula antes
  // de borrar las series del hueco. Calculada después, el «tiene series en este hueco» ya no se
  // cumple, sale vacía y el borrado deja esas sesiones canceladas sin dar ningún error.
  //
  // En una sola petición, con sesiones que se van y otras que se quedan (la del 4 conserva la
  // serie del otro hueco, la del 8 ni lo usaba, una ya vacía y la abierta hoy): se borran
  // exactamente las del aviso. Antes, las que se vaciaban se quedaban vacías.
  const { cliente, reloj } = crearCliente()
  const escenario = push_con_dos_huecos(cliente, reloj)
  const { rutina_id, a } = escenario
  const ya_vacia = sesion_con_series(cliente, rutina_id, '2026-09-12')
  const abierta = sesion_con_series(cliente, rutina_id, HOY, [a, escenario.press])
  const todas = ['dia_1', 'dia_4', 'dia_8', 'dia_10'].map((dia) => escenario[dia])
  todas.push(ya_vacia, abierta)

  const anunciadas = new Set<number>(
    aviso_de_hueco(cliente, rutina_id, a)
      .json()
      .sesiones_que_se_vacian.map((s: any) => s.entrenamiento_id),
  )
  const respuesta = cliente.delete(`/rutinas/${rutina_id}/slots/${a}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  const borradas = new Set(todas.filter((sesion) => series_de(cliente, sesion) === null))
  expect(borradas).toEqual(anunciadas)
  expect(borradas).toEqual(new Set([escenario.dia_1, escenario.dia_10]))
  expect(series_de(cliente, escenario.dia_4)!.map((s) => s.slot_id)).toEqual([escenario.b])
  expect(series_de(cliente, escenario.dia_8)!.map((s) => s.slot_id)).toEqual([escenario.b])
})

// --- El aviso de borrar una rutina -------------------------------------------
//
// `GET /rutinas/{id}/aviso-de-borrado`. `con_historial` tiene que coincidir con que el DELETE sin
// `modo` dé 409: si no, la web enseñaría un diálogo y el DELETE haría otra cosa.

function aviso_de_rutina(cliente: Cliente, rutina_id: number): any {
  const respuesta = cliente.get(`/rutinas/${rutina_id}/aviso-de-borrado`)
  expect(respuesta.status_code).toBe(200)
  return respuesta.json()
}

type Montar = (cliente: Cliente, reloj: RelojDeTest, g: number) => number

const _rutina_vacia: Montar = (cliente) => crear_rutina(cliente, 'Brazos')

const _rutina_con_un_hueco: Montar = (cliente, _reloj, g) =>
  crear_rutina_con_hueco(cliente, crear_ejercicio(cliente, g))[0]

const _rutina_que_solo_toco_dias_pasados: Montar = (cliente, reloj) => ppl(cliente, reloj).Push

const _rutina_en_un_programa_sin_activar: Montar = (cliente, reloj, g) => {
  const rutina_id = _rutina_vacia(cliente, reloj, g)
  cliente.post('/programas', {
    json: { nombre: 'Sin usar', dias: [{ dia_semana: 1, rutina_id }] },
  })
  return rutina_id
}

const CON_HISTORIAL_DE_RUTINA: [string, Montar, boolean][] = [
  ['vacia', _rutina_vacia, false],
  ['con-un-hueco', _rutina_con_un_hueco, true],
  ['solo-dias-pasados', _rutina_que_solo_toco_dias_pasados, true],
  ['programa-sin-activar', _rutina_en_un_programa_sin_activar, false],
]

test.each(CON_HISTORIAL_DE_RUTINA)(
  'con_historial_coincide_con_que_el_delete_pida_modo (%s)',
  (_id, montar, con_historial) => {
    // Con una sesión cancelada o en curso, en sus propios tests: cuentan más cosas.
    const { cliente, reloj } = crearCliente()
    const rutina_id = montar(cliente, reloj, grupo_muscular_id(cliente))

    const aviso = aviso_de_rutina(cliente, rutina_id)
    const borrado = cliente.delete(`/rutinas/${rutina_id}`)

    expect(aviso.con_historial).toBe(con_historial)
    if (con_historial) {
      expect([borrado.status_code, borrado.json().detail]).toEqual([409, PIDE_MODO.rutina])
      expect(cliente.get(`/rutinas/${rutina_id}`).json().oculto_desde).toBeNull()
    } else {
      expect(borrado.status_code).toBe(204)
      expect(cliente.get(`/rutinas/${rutina_id}`).status_code).toBe(404)
    }
  },
)

test('el_aviso_dice_que_la_rutina_toco_dias_pasados', () => {
  // El caso que el diálogo de P3 no reflejaba: sin huecos ni sesiones, pero con días pasados en
  // el plan.
  const { cliente, reloj } = crearCliente()
  const rutinas = ppl(cliente, reloj)

  const aviso = aviso_de_rutina(cliente, rutinas.Push)

  expect(aviso).toEqual({
    con_historial: true,
    huecos: 0,
    sesiones: 0,
    dias_de_programa: 1,
    dias_planificados: 0,
    toco_dias_pasados: true,
    sesion_en_curso: false,
  })
})

test('el_aviso_de_una_rutina_no_cuenta_las_sesiones_vacias', () => {
  // Una sesión sin series ya fuera de curso está cancelada: no es algo que se pierda.
  const { cliente } = crearCliente()
  const press = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const [rutina_id, slot_id] = crear_rutina_con_hueco(cliente, press)
  sesion_con_series(cliente, rutina_id, PRIMERO_DE_SEPTIEMBRE, [slot_id, press])
  sesion_con_series(cliente, rutina_id, CUATRO_DE_SEPTIEMBRE, [slot_id, press], [slot_id, press])
  sesion_con_series(cliente, rutina_id, OCHO_DE_SEPTIEMBRE)

  const aviso = aviso_de_rutina(cliente, rutina_id)

  expect([aviso.sesiones, aviso.huecos]).toEqual([2, 1])
})

// Cada uno monta una sesión en la rutina Push (o en Pull, la otra) a partir del hueco del press.
// Hoy es el miércoles 16.

type MontarSesion = (
  cliente: Cliente,
  push: number,
  pull: number,
  slot_id: number,
  press: number,
) => void

const _abierta_hoy_con_series: MontarSesion = (cliente, push, _pull, slot_id, press) => {
  sesion_con_series(cliente, push, HOY, [slot_id, press])
}

/** La que crea H1b al apuntar un día pasado: vacía y sin terminar. */
const _de_ayer_sin_terminar: MontarSesion = (cliente, push) => {
  sesion_con_series(cliente, push, MARTES_15)
}

const _de_hoy_ya_terminada: MontarSesion = (cliente, push, _pull, slot_id, press) => {
  const sesion = sesion_con_series(cliente, push, HOY, [slot_id, press])
  expect(cliente.post(`/entrenamientos/${sesion}/terminar`).status_code).toBe(200)
}

const _abierta_hoy_de_otra_rutina: MontarSesion = (cliente, _push, pull) => {
  sesion_con_series(cliente, pull, HOY)
}

const SESION_ABIERTA_HOY: [string, MontarSesion, boolean][] = [
  ['abierta-hoy-con-series', _abierta_hoy_con_series, true],
  ['de-ayer-sin-terminar', _de_ayer_sin_terminar, false],
  ['de-hoy-ya-terminada', _de_hoy_ya_terminada, false],
  ['abierta-hoy-de-otra-rutina', _abierta_hoy_de_otra_rutina, false],
]

test.each(SESION_ABIERTA_HOY)(
  'el_aviso_de_una_rutina_dice_si_hay_una_sesion_suya_abierta_hoy (%s)',
  (_id, montar, en_curso) => {
    // Es lo que hace que P3 diga «También se cancelará la sesión que tienes abierta hoy». Una
    // sesión de un día pasado sin terminar no está en curso. Y si hay una abierta,
    // `con_historial` también es verdadero: la frase solo sale en el diálogo completo.
    const { cliente, reloj } = crearCliente()
    reloj.fijar(HOY)
    const press = crear_ejercicio(cliente, grupo_muscular_id(cliente))
    const [push, slot_id] = crear_rutina_con_hueco(cliente, press)
    const pull = crear_rutina(cliente, 'Pull')
    montar(cliente, push, pull, slot_id, press)

    const aviso = aviso_de_rutina(cliente, push)

    expect(aviso.sesion_en_curso).toBe(en_curso)
    if (en_curso) expect(aviso.con_historial).toBe(true)
  },
)

test('el_aviso_de_una_rutina_cuenta_los_huecos_ocultos', () => {
  // Borrarla en definitivo también se los lleva. Se puede leer con la rutina oculta.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const [rutina_id, oculto] = crear_rutina_con_hueco(cliente, crear_ejercicio(cliente, g))
  segundo_hueco(cliente, rutina_id, crear_ejercicio(cliente, g, 'Fondos'))
  expect(cliente.delete(`/rutinas/${rutina_id}/slots/${oculto}?modo=ocultar`).status_code).toBe(204)
  expect(cliente.delete(`/rutinas/${rutina_id}?modo=ocultar`).status_code).toBe(204)

  expect(aviso_de_rutina(cliente, rutina_id).huecos).toBe(2)
})

test('el_aviso_de_una_rutina_cuenta_sus_dias_vigentes_y_planificados', () => {
  // El lunes del PPL deja de ser Push (su fila se cierra y ya no cuenta), el martes pasa a
  // serlo, y está en otro programa sin activar en dos días: 3 días de programa. Más dos días
  // planificados a mano.
  const { cliente, reloj } = crearCliente()
  const rutinas = ppl(cliente, reloj)
  const programa = cliente.get('/programas').json()[0].id
  for (const [dia, rutina] of [
    [1, 'Leg'],
    [2, 'Push'],
  ] as const) {
    const respuesta = cambiar_dias(cliente, programa, { [dia]: rutinas[rutina] })
    expect(respuesta.status_code).toBe(200)
  }
  cliente.post('/programas', {
    json: {
      nombre: 'Otro',
      dias: [4, 6].map((dia) => ({ dia_semana: dia, rutina_id: rutinas.Push })),
    },
  })
  for (const fecha of [JUEVES_17, VIERNES_18]) {
    const respuesta = cliente.put(`/plan/excepciones/${fecha}`, {
      json: { rutina_id: rutinas.Push },
    })
    expect(respuesta.status_code).toBe(200)
  }

  const aviso = aviso_de_rutina(cliente, rutinas.Push)

  expect([aviso.dias_de_programa, aviso.dias_planificados]).toEqual([3, 2])
  expect(aviso.toco_dias_pasados).toBe(true)
})

// --- El aviso de borrar un ejercicio, y lo que el definitivo se lleva --------
//
// `GET /ejercicios/{id}/aviso-de-borrado` cuenta lo que se perdería; el DELETE con
// `?modo=definitivo` tiene que llevarse justo eso, también las sesiones que se quedan sin
// ninguna serie. Hoy es el miércoles 16 de `apoyo/semana.ts`.

const ONCE_DE_SEPTIEMBRE = '2026-09-11'
const DOCE_DE_SEPTIEMBRE = '2026-09-12'

function aviso_de_ejercicio(cliente: Cliente, ejercicio_id: number): any {
  const respuesta = cliente.get(`/ejercicios/${ejercicio_id}/aviso-de-borrado`)
  expect(respuesta.status_code).toBe(200)
  return respuesta.json()
}

function ids_que_se_vacian(aviso: any): number[] {
  return aviso.sesiones_que_se_vacian.map((sesion: any) => sesion.entrenamiento_id)
}

/**
 * Press banca es el principal del hueco A de Push (con Press en máquina de alternativa; Fondos
 * va en el B) y la alternativa del hueco C de Pull, cuyo principal es Remo; Pull tiene además
 * el hueco D, de Jalón. Push se crea antes, para que el orden por nombre no salga del de los
 * ids. Sesiones, todas de días pasados y sin terminar:
 *
 * - la del 11, solo con press en C (se crea la primera, para que el orden por fecha no salga
 *   del de los ids);
 * - la del 1, solo con press en A;
 * - la del 4, solo con la máquina en A: una serie de alternativa en un hueco que se borra
 *   entero con press;
 * - la del 8, con press en A y fondos en B;
 * - la del 10, solo con fondos en B;
 * - la del 12, con press en C y jalón en D (en una sesión, cada hueco se hace con un solo
 *   ejercicio: press y remo no pueden ir juntos en C).
 *
 * Con press se van 5 series (1 de la máquina) de 5 sesiones, y se vacían la del 1, la del 4 y
 * la del 11.
 */
function press_en_dos_rutinas(cliente: Cliente, reloj: RelojDeTest): Record<string, number> {
  reloj.fijar(HOY)
  const g = grupo_muscular_id(cliente)
  const press = crear_ejercicio(cliente, g, 'Press banca')
  const maquina = crear_ejercicio(cliente, g, 'Press en máquina')
  const fondos = crear_ejercicio(cliente, g, 'Fondos')
  const remo = crear_ejercicio(cliente, g, 'Remo')
  const [push, a] = crear_rutina_con_hueco(cliente, press)
  poner_alternativas(cliente, push, a, [maquina])
  const b = segundo_hueco(cliente, push, fondos)
  const pull = crear_rutina(cliente, 'Pull')
  const respuesta = cliente.post(`/rutinas/${pull}/slots`, {
    json: {
      ejercicio_principal_id: remo,
      ...objetivo(3, [8, 12]),
      alternativas: [alternativa(press, 3, [8, 12])],
    },
  })
  expect(respuesta.status_code).toBe(201)
  const c = respuesta.json().id
  const jalon = crear_ejercicio(cliente, g, 'Jalón')
  const d = segundo_hueco(cliente, pull, jalon)
  const sesiones = {
    dia_11: sesion_con_series(cliente, pull, ONCE_DE_SEPTIEMBRE, [c, press]),
    dia_1: sesion_con_series(cliente, push, PRIMERO_DE_SEPTIEMBRE, [a, press]),
    dia_4: sesion_con_series(cliente, push, CUATRO_DE_SEPTIEMBRE, [a, maquina]),
    dia_8: sesion_con_series(cliente, push, OCHO_DE_SEPTIEMBRE, [a, press], [b, fondos]),
    dia_10: sesion_con_series(cliente, push, DIEZ_DE_SEPTIEMBRE, [b, fondos]),
    dia_12: sesion_con_series(cliente, pull, DOCE_DE_SEPTIEMBRE, [c, press], [d, jalon]),
  }
  return { press, push, pull, a, b, c, d, ...sesiones }
}

test('el_aviso_de_un_ejercicio_cuenta_lo_que_se_perderia', () => {
  const { cliente, reloj } = crearCliente()
  const e = press_en_dos_rutinas(cliente, reloj)
  crear_nota(cliente, e.press, 'El asiento va en el 4')

  const aviso = aviso_de_ejercicio(cliente, e.press)

  const { huecos, ...sin_huecos } = aviso
  expect(sin_huecos).toEqual({
    con_historial: true,
    series: 5,
    sesiones: 5,
    desde: '2026-09-01',
    notas: 1,
    sesiones_que_se_vacian: [
      { entrenamiento_id: e.dia_1, fecha: '2026-09-01', cubre_fecha: null },
      { entrenamiento_id: e.dia_4, fecha: '2026-09-04', cubre_fecha: null },
      { entrenamiento_id: e.dia_11, fecha: '2026-09-11', cubre_fecha: null },
    ],
  })
  expect(huecos.map((h: any) => [h.rutina.nombre, h.slot_id, h.rol])).toEqual([
    ['Pull', e.c, 'comodin'],
    ['Push', e.a, 'principal'],
  ])
})

test('el_aviso_de_un_ejercicio_sin_nada_va_vacio', () => {
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))

  expect(aviso_de_ejercicio(cliente, ejercicio_id)).toEqual({
    con_historial: false,
    series: 0,
    sesiones: 0,
    desde: null,
    notas: 0,
    huecos: [],
    sesiones_que_se_vacian: [],
  })
})

type MontarEjercicio = (cliente: Cliente, g: number) => number

const _ejercicio_sin_usar: MontarEjercicio = (cliente, g) => crear_ejercicio(cliente, g, 'Curl')

const _ejercicio_con_solo_notas: MontarEjercicio = (cliente, g) => {
  const ejercicio_id = _ejercicio_sin_usar(cliente, g)
  crear_nota(cliente, ejercicio_id, 'Codos pegados')
  return ejercicio_id
}

const _ejercicio_que_solo_es_alternativa: MontarEjercicio = (cliente, g) => {
  const [, comodin] = con_comodin(cliente, g)
  return comodin
}

const _ejercicio_principal_sin_series: MontarEjercicio = (cliente, g) => {
  const [principal] = con_comodin(cliente, g)
  return principal
}

/**
 * Fue alternativa, se apuntó una serie con él y luego se quitó del hueco: ya no está en ninguna
 * rutina, pero su serie sigue (quitar un comodín no la borra).
 */
const _ejercicio_con_series_que_ya_no_esta_en_ningun_hueco: MontarEjercicio = (cliente, g) => {
  const [, comodin, rutina_id, slot_id] = con_comodin(cliente, g)
  registrar_serie(cliente, rutina_id, slot_id, comodin)
  poner_alternativas(cliente, rutina_id, slot_id, [])
  return comodin
}

const CON_HISTORIAL_DE_EJERCICIO: [string, MontarEjercicio, boolean][] = [
  ['sin-usar', _ejercicio_sin_usar, false],
  ['solo-notas', _ejercicio_con_solo_notas, false],
  ['solo-alternativa', _ejercicio_que_solo_es_alternativa, true],
  ['principal-sin-series', _ejercicio_principal_sin_series, true],
  ['solo-series', _ejercicio_con_series_que_ya_no_esta_en_ningun_hueco, true],
]

test.each(CON_HISTORIAL_DE_EJERCICIO)(
  'con_historial_del_ejercicio_coincide_con_que_el_delete_pida_modo (%s)',
  (_id, montar, con_historial) => {
    // Si no coincidieran, la web enseñaría un diálogo y el DELETE haría otra cosa (o borraría sin
    // preguntar lo que el diálogo no avisó).
    const { cliente } = crearCliente()
    const ejercicio_id = montar(cliente, grupo_muscular_id(cliente))

    const aviso = aviso_de_ejercicio(cliente, ejercicio_id)
    const borrado = cliente.delete(`/ejercicios/${ejercicio_id}`)

    expect(aviso.con_historial).toBe(con_historial)
    if (con_historial) {
      expect([borrado.status_code, borrado.json().detail]).toEqual([409, PIDE_MODO.ejercicio])
      expect(cliente.get(`/ejercicios/${ejercicio_id}`).json().oculto_desde).toBeNull()
    } else {
      expect(borrado.status_code).toBe(204)
      expect(cliente.get(`/ejercicios/${ejercicio_id}`).status_code).toBe(404)
    }
  },
)

test('el_aviso_de_un_ejercicio_no_cuenta_la_sesion_abierta_hoy', () => {
  // Se quedaría vacía, pero no está cancelada y puede estar abierta en E2: ni se anuncia ni se
  // borra, y sigue en curso sin series.
  const { cliente, reloj } = crearCliente()
  const e = press_en_dos_rutinas(cliente, reloj)
  const abierta = sesion_con_series(cliente, e.push, HOY, [e.a, e.press])

  const aviso = aviso_de_ejercicio(cliente, e.press)
  const borrado = cliente.delete(`/ejercicios/${e.press}?modo=definitivo`)

  expect(aviso.series).toBe(6)
  expect(ids_que_se_vacian(aviso)).toEqual([e.dia_1, e.dia_4, e.dia_11])
  expect(borrado.status_code).toBe(204)
  expect(series_de(cliente, abierta)).toEqual([])
  expect(sesiones_en_curso(cliente).map((s) => s.id)).toEqual([abierta])
})

test('el_aviso_de_un_ejercicio_oculto_se_puede_leer', () => {
  // X2 de un ejercicio oculto ofrece Borrar: el diálogo tiene que poder contarlo.
  const { cliente, reloj } = crearCliente()
  const e = press_en_dos_rutinas(cliente, reloj)
  expect(cliente.delete(`/ejercicios/${e.press}?modo=ocultar`).status_code).toBe(204)

  const aviso = aviso_de_ejercicio(cliente, e.press)

  expect([aviso.series, aviso.sesiones_que_se_vacian.length]).toEqual([5, 3])
})

test('el_aviso_de_un_ejercicio_predefinido_da_404', () => {
  // Un predefinido no se puede borrar: su aviso no existe (404 y no 403, es un GET). El de uno
  // que no existe, en la tabla de `crud.test.ts`.
  const { cliente, bd } = crearCliente()

  const respuesta = cliente.get(`/ejercicios/${ejercicio_predefinido_id(bd)}/aviso-de-borrado`)

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe(
    'Los ejercicios predefinidos no se pueden ocultar ni borrar.',
  )
})

test('borrar_un_ejercicio_en_definitivo_se_lleva_justo_las_sesiones_del_aviso', () => {
  // Regresión del orden en `borrar_ejercicio`: las sesiones que se vacían se calculan antes de
  // borrar las series. Calculadas después, ya no tienen ninguna serie del ejercicio, la lista
  // sale vacía y el borrado las deja canceladas sin dar ningún error.
  //
  // En una sola petición, con sesiones que se van (la del 1; la del 4, que solo tenía la
  // alternativa en un hueco de press; y la del 11, donde press era la alternativa) y otras que se
  // quedan (la del 8 y la del 12 con otro hueco, la del 10 sin nada de press, una ya vacía y la
  // abierta hoy).
  const { cliente, reloj } = crearCliente()
  const e = press_en_dos_rutinas(cliente, reloj)
  const ya_vacia = sesion_con_series(cliente, e.push, '2026-09-13')
  const abierta = sesion_con_series(cliente, e.push, HOY, [e.a, e.press])
  const todas = ['dia_1', 'dia_4', 'dia_8', 'dia_10', 'dia_11', 'dia_12'].map((dia) => e[dia])
  todas.push(ya_vacia, abierta)

  const anunciadas = new Set(ids_que_se_vacian(aviso_de_ejercicio(cliente, e.press)))
  const respuesta = cliente.delete(`/ejercicios/${e.press}?modo=definitivo`)

  expect(respuesta.status_code).toBe(204)
  const borradas = new Set(todas.filter((sesion) => series_de(cliente, sesion) === null))
  expect(borradas).toEqual(anunciadas)
  expect(borradas).toEqual(new Set([e.dia_1, e.dia_4, e.dia_11]))
  expect(series_de(cliente, e.dia_8)!.map((s) => s.slot_id)).toEqual([e.b])
  expect(series_de(cliente, e.dia_12)!.map((s) => s.slot_id)).toEqual([e.d])
  expect(series_de(cliente, e.dia_10)).toHaveLength(1)
  // El hueco A se va entero; el C se queda con su principal y sin la alternativa.
  expect(
    cliente
      .get(`/rutinas/${e.push}`)
      .json()
      .slots.map((h: any) => h.id),
  ).toEqual([e.b])
  const [hueco_c, hueco_d] = cliente.get(`/rutinas/${e.pull}`).json().slots
  expect([hueco_c.id, hueco_d.id]).toEqual([e.c, e.d])
  expect(hueco_c.alternativas).toEqual([])
})
