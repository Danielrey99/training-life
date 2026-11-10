/**
 * Tests del *Guardar* de un día del historial y de cambiar de ejercicio en la sesión.
 * Puerto de `backend/tests/test_guardar_un_dia.py`.
 *
 * «H2 · Un día» guarda la fecha, la nota y todas las series de una vez:
 * `PUT /entrenamientos/{id}` con `series`, que es el estado final completo (la guardada que
 * no llega se borra, la que llega sin `id` se crea). Todo se valida antes de escribir, así
 * que o se guarda todo o nada. Solo se valida lo que cambia: una serie que llega igual vale
 * aunque su ejercicio o su hueco ya no se pudieran elegir.
 *
 * Cambiar de ejercicio en la sesión en curso borra de una vez las series de ese hueco:
 * `DELETE /entrenamientos/{id}/series?slot_id=N`.
 *
 * El reloj está congelado en el miércoles 16 de septiembre de 2026 (`apoyo/semana.ts`) y la
 * rutina no está en ningún programa, así que las sesiones no cuentan ningún día (salvo las
 * que lo piden al moverse muy lejos) y la fecha solo choca con el futuro o con otra sesión.
 */
import { filaSerie } from '../apoyo/filas'
import {
  SERIE_DEL_DIA_YA_NO_EXISTE,
  bajo_la_fecha,
  crear_ejercicio,
  crear_hueco,
  crear_rutina,
  dejar_planificado,
  ejercicio_oculto,
  en_texto,
  esperar_estado,
  ocultar_ejercicio,
  ocultar_hueco,
  poner_alternativas,
  todavia_no_ha_llegado,
} from '../apoyo/ayudas'
import { type ClienteDeTest as Cliente, crearCliente } from '../apoyo/cliente'
import { grupo_muscular_id } from '../apoyo/conftest'
import { DOMINGO_13, HOY, JUEVES_17, LUNES_14, MARTES_15, sesion } from '../apoyo/semana'

const CAMPOS = [
  'ejercicio_id',
  'slot_id',
  'numero_serie',
  'peso',
  'repeticiones',
  'duracion_s',
  'distancia_m',
  'peso_corporal',
  'variante',
] as const

const PESO_NEGATIVO =
  'El peso no puede ser negativo. Solo los ejercicios de peso corporal admiten ayuda.'
const NO_ES_DEL_HUECO = 'Ese ejercicio no es ni el de la rutina ni una de sus alternativas.'
const NO_ESTA_EN_LA_RUTINA = 'Ese ejercicio no está en la rutina de esta sesión.'

// --- El escenario ----------------------------------------------------------------

interface Push {
  rutina: number
  press: number
  inclinado: number
  fondos: number
  a: number
  b: number
}

/**
 * La rutina Push: el hueco `a` (Press banca, con Press inclinado de alternativa) y el hueco
 * `b` (Fondos). Con el reloj en el miércoles 16.
 */
function escenario() {
  const entorno = crearCliente()
  const { cliente, reloj } = entorno
  reloj.fijar(HOY)
  const g = grupo_muscular_id(cliente)
  const [press, inclinado, fondos] = ['Press banca', 'Press inclinado', 'Fondos'].map((nombre) =>
    crear_ejercicio(cliente, g, nombre),
  )
  const rutina = crear_rutina(cliente, 'Push')
  const a = crear_hueco(cliente, rutina, press)
  poner_alternativas(cliente, rutina, a, [inclinado])
  const b = crear_hueco(cliente, rutina, fondos)
  const push: Push = { rutina, press, inclinado, fondos, a, b }
  return { ...entorno, push }
}

/** El cuerpo de una serie (sin `id`: nueva). */
function serie(
  ejercicio_id: number,
  slot_id: number,
  numero = 1,
  peso: number | string = 60,
  repeticiones = 8,
  campos: Record<string, unknown> = {},
): Record<string, any> {
  return {
    ejercicio_id,
    slot_id,
    numero_serie: numero,
    peso,
    repeticiones,
    ...campos,
  }
}

/**
 * Una sesión de Push en esa fecha con sus series (por defecto, dos de Press banca en `a` y
 * una de Fondos en `b`), apuntadas una a una. Devuelve su id.
 */
function dia_con(
  cliente: Cliente,
  push: Push,
  fecha: string = MARTES_15,
  series: Record<string, any>[] | null = null,
  cubre_fecha: string | null = null,
): number {
  const respuesta = sesion(cliente, fecha, push.rutina, cubre_fecha)
  esperar_estado(respuesta, 201)
  const sesion_id = respuesta.json().id
  const aPoner = series ?? [
    serie(push.press, push.a, 1, 60),
    serie(push.press, push.a, 2, '62.5'),
    serie(push.fondos, push.b, 1, 10, 10),
  ]
  for (const cuerpo of aPoner) {
    const creada = cliente.post(`/entrenamientos/${sesion_id}/series`, { json: cuerpo })
    esperar_estado(creada, 201)
  }
  return sesion_id
}

function leer(cliente: Cliente, sesion_id: number): any {
  const respuesta = cliente.get(`/entrenamientos/${sesion_id}`)
  esperar_estado(respuesta, 200)
  return respuesta.json()
}

/**
 * Las series guardadas tal y como las manda la web al guardar: con su `id`. Por hueco y
 * número (la API las da solo por número): `a` va antes que `b`.
 */
function como_van(cliente: Cliente, sesion_id: number): Record<string, any>[] {
  return leer(cliente, sesion_id)
    .series.map((s: any) => ({
      id: s.id,
      ...Object.fromEntries(CAMPOS.map((campo) => [campo, s[campo]])),
    }))
    .sort((x: any, y: any) => x.slot_id - y.slot_id || x.numero_serie - y.numero_serie)
}

/** Todo lo que el *Guardar* puede cambiar, para comprobar que no cambió nada. */
function foto(cliente: Cliente, sesion_id: number): unknown {
  const dia = leer(cliente, sesion_id)
  return [
    dia.fecha,
    dia.notas,
    dia.series
      .map((s: any) => [s.id, s.ejercicio_id, s.slot_id, s.numero_serie, s.peso, s.updated_at])
      .sort((x: any[], y: any[]) => x[0] - y[0]),
  ]
}

/** El PUT de «H2 · Un día»; sin `fecha`, la que ya tiene. */
function guardar(
  cliente: Cliente,
  sesion_id: number,
  series: Record<string, any>[],
  fecha: string | null = null,
  notas: string | null = null,
) {
  return cliente.put(`/entrenamientos/${sesion_id}`, {
    json: { fecha: fecha ?? leer(cliente, sesion_id).fecha, notas, series },
  })
}

// --- Guardar todo de una vez -----------------------------------------------------

test('guardar_cambia_la_fecha_la_nota_y_las_series_en_una_peticion', () => {
  // Una borrada, una cambiada, una nueva y otra que llega igual, con la fecha y la nota
  // nuevas.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const [primera, segunda, fondos] = como_van(cliente, dia)
  segunda.repeticiones = 6

  const respuesta = guardar(
    cliente,
    dia,
    [primera, segunda, serie(push.press, push.a, 3, 65, 5)],
    LUNES_14,
    'Hombro cargado',
  )

  esperar_estado(respuesta, 200)
  const guardado = leer(cliente, dia)
  expect([guardado.fecha, guardado.notas]).toEqual([LUNES_14, 'Hombro cargado'])
  expect(
    guardado.series
      .map((s: any) => [s.slot_id, s.numero_serie, s.peso, s.repeticiones])
      .sort((x: number[], y: number[]) => x[1] - y[1]),
  ).toEqual([
    [push.a, 1, '60.00', 8],
    [push.a, 2, '62.50', 6],
    [push.a, 3, '65.00', 5],
  ])
  // La que llegó igual y la cambiada conservan su id; la de Fondos ya no está.
  const ids = new Set(guardado.series.map((s: any) => s.id))
  expect(ids.has(primera.id) && ids.has(segunda.id)).toBe(true)
  expect(ids.has(fondos.id)).toBe(false)
  // Lo devuelto es lo guardado: la web lo pinta sin volver a pedirlo.
  expect(respuesta.json()).toEqual(guardado)
})

test('una_serie_que_llega_igual_no_se_toca', () => {
  // El peso llega como número (62.5) y está guardado como 62,50: es el mismo, y la serie no
  // se reescribe (su `updated_at` no cambia).
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  const series = como_van(cliente, dia)
  for (const cuerpo of series) cuerpo.peso = Number(cuerpo.peso)

  const respuesta = guardar(cliente, dia, series)

  esperar_estado(respuesta, 200)
  expect(foto(cliente, dia)).toEqual(antes)
})

test('sin_series_no_se_tocan_y_con_la_lista_vacia_se_borran_todas', () => {
  // Quitar todas las series no borra la sesión: la web, para guardar un día sin series,
  // borra la sesión con su `DELETE`.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)

  const solo_la_nota = cliente.put(`/entrenamientos/${dia}`, {
    json: { fecha: MARTES_15, notas: 'Bien' },
  })
  esperar_estado(solo_la_nota, 200)
  expect(leer(cliente, dia).series).toHaveLength(3)

  const respuesta = guardar(cliente, dia, [], null, 'Bien')

  esperar_estado(respuesta, 200)
  expect([leer(cliente, dia).series, leer(cliente, dia).notas]).toEqual([[], 'Bien'])
})

// --- Todo o nada -------------------------------------------------------------------

test.each(['nueva', 'cambiada'])(
  'una_serie_con_medidas_malas_da_422_y_no_guarda_nada (%s)',
  (cual) => {
    // La serie mala va la última: la fecha, la nota, la borrada y la cambiada que van antes
    // tampoco se guardan. Una guardada que se corrige se valida igual que una nueva.
    const { cliente, push } = escenario()
    const dia = dia_con(cliente, push)
    const antes = foto(cliente, dia)
    const [primera, segunda] = como_van(cliente, dia)
    primera.peso = 70
    const mala = cual === 'nueva' ? serie(push.press, push.a, 3, -5) : { ...segunda, peso: -5 }

    const respuesta = guardar(cliente, dia, [primera, mala], LUNES_14, 'Hombro cargado')

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([422, PESO_NEGATIVO])
    expect(foto(cliente, dia)).toEqual(antes)
  },
)

test('con_el_dia_nuevo_ocupado_da_409_y_no_guarda_nada', () => {
  // El 409 del día ocupado es lo último que se mira, después de todas las series.
  const { cliente, push } = escenario()
  const ocupado = dia_con(cliente, push, LUNES_14)
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  const [primera, , fondos] = como_van(cliente, dia)

  const respuesta = guardar(
    cliente,
    dia,
    [primera, fondos, serie(push.press, push.a, 2, 70)],
    LUNES_14,
    'Hombro cargado',
  )

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual({
    mensaje:
      `El ${en_texto(LUNES_14)} ya tiene una sesión, y solo se hace una por día.` +
      ' Para usar ese día, cambia antes la fecha de esa sesión desde su día en la pestaña' +
      ' Historial.',
    campo: 'fecha',
    entrenamiento_id: ocupado,
    en_curso: false,
  })
  expect(foto(cliente, dia)).toEqual(antes)
})

test('un_422_de_una_serie_no_borra_la_cancelada_del_dia_nuevo', () => {
  // Mirar si el día nuevo está libre borra la sesión cancelada (sin series) que lo ocupa:
  // un 422 posterior no puede dejarla borrada.
  const { cliente, push } = escenario()
  const cancelada = dia_con(cliente, push, LUNES_14, [])
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)

  const respuesta = guardar(
    cliente,
    dia,
    [...como_van(cliente, dia), serie(push.press, push.a, 3, -5)],
    LUNES_14,
  )

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([422, PESO_NEGATIVO])
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(200)
  expect(foto(cliente, dia)).toEqual(antes)
})

test('con_el_dia_ocupado_y_una_serie_mala_gana_el_422_de_la_serie', () => {
  // El día libre es lo último que se mira: el aviso que sale es el de la serie.
  const { cliente, push } = escenario()
  dia_con(cliente, push, LUNES_14)
  const dia = dia_con(cliente, push)

  const respuesta = guardar(
    cliente,
    dia,
    [...como_van(cliente, dia), serie(push.press, push.a, 3, -5)],
    LUNES_14,
  )

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([422, PESO_NEGATIVO])
})

test('mover_al_dia_de_una_cancelada_con_series_nuevas_la_borra', () => {
  // El camino bueno del anterior: la cancelada deja sitio y todo se guarda.
  const { cliente, push } = escenario()
  const cancelada = dia_con(cliente, push, LUNES_14, [])
  const dia = dia_con(cliente, push)

  const respuesta = guardar(
    cliente,
    dia,
    [...como_van(cliente, dia), serie(push.press, push.a, 3, 65)],
    LUNES_14,
  )

  esperar_estado(respuesta, 200)
  expect(cliente.get(`/entrenamientos/${cancelada}`).status_code).toBe(404)
  expect([leer(cliente, dia).fecha, leer(cliente, dia).series.length]).toEqual([LUNES_14, 4])
})

test('la_fecha_se_valida_antes_que_las_series', () => {
  // Una fecha futura y una serie de otra sesión: el aviso es el de la fecha, y la sesión no
  // se mueve al futuro.
  const { cliente, push } = escenario()
  const otra = dia_con(cliente, push, LUNES_14)
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  const ajena = { ...como_van(cliente, otra)[0] }

  const respuesta = guardar(cliente, dia, [ajena], JUEVES_17)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual(bajo_la_fecha(todavia_no_ha_llegado(JUEVES_17)))
  expect(foto(cliente, dia)).toEqual(antes)
})

// --- Mover la fecha muy lejos ------------------------------------------------------
//
// El plan se pide como mucho de 400 días. Una fecha fuera del plazo ya no lo necesita:
// antes se pedía igual, y mover una sesión tan lejos daba el 422 del tope del plan, que
// hablaba de otra cosa, en vez de decir hasta dónde puede ir.

const HACE_MAS_DE_400_DIAS = '2025-03-03' // lunes

test('una_sesion_que_cuenta_un_dia_no_se_mueve_a_mas_de_400_dias_atras', () => {
  // Cuenta el miércoles 16 porque ese día se planificó Push a mano.
  const { cliente, push } = escenario()
  dejar_planificado(cliente, HOY, push.rutina)
  const dia = dia_con(cliente, push, HOY, null, HOY)
  const antes = foto(cliente, dia)

  const respuesta = guardar(cliente, dia, como_van(cliente, dia), HACE_MAS_DE_400_DIAS)

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toEqual({
    mensaje:
      'Este Push cuenta como el del miércoles 16 de septiembre, así que solo puede' +
      ' ir desde el lunes 14 de septiembre.',
    campo: 'fecha',
  })
  expect(foto(cliente, dia)).toEqual(antes)
})

test('una_sesion_antigua_que_cuenta_un_dia_no_se_mueve_a_hoy', () => {
  // Más de 400 días hacia delante, y el texto lleva el año del día que cuenta.
  const { cliente, reloj, push } = escenario()
  reloj.fijar(HACE_MAS_DE_400_DIAS)
  dejar_planificado(cliente, HACE_MAS_DE_400_DIAS, push.rutina)
  const dia = dia_con(cliente, push, HACE_MAS_DE_400_DIAS, null, HACE_MAS_DE_400_DIAS)
  reloj.fijar(HOY)
  const antes = foto(cliente, dia)

  const respuesta = guardar(cliente, dia, como_van(cliente, dia), HOY)

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toEqual({
    mensaje:
      'Este Push cuenta como el del lunes 3 de marzo de 2025, así que solo puede' +
      ' ir hasta el domingo 9 de marzo de 2025.',
    campo: 'fecha',
  })
  expect(foto(cliente, dia)).toEqual(antes)
})

test('una_sesion_que_no_cuenta_ningun_dia_se_mueve_a_cualquier_fecha', () => {
  // Sin día que contar no hay plazo: la fecha solo choca con el futuro o con otra.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push, HOY)

  const respuesta = guardar(cliente, dia, como_van(cliente, dia), HACE_MAS_DE_400_DIAS)

  esperar_estado(respuesta, 200)
  expect(leer(cliente, dia).fecha).toBe(HACE_MAS_DE_400_DIAS)
})

// --- Ids de series que no son de este día ----------------------------------------

test('una_serie_de_otra_sesion_da_404_y_no_toca_ninguna_de_las_dos', () => {
  // Con su id, la serie de otro día se cambiaría (o se movería a este) por la ruta de una
  // sesión que no es la suya.
  const { cliente, push } = escenario()
  const otra = dia_con(cliente, push, LUNES_14)
  const dia = dia_con(cliente, push)
  const antes = [foto(cliente, dia), foto(cliente, otra)]
  const ajena = como_van(cliente, otra)[0]
  ajena.peso = 100

  const respuesta = guardar(cliente, dia, [...como_van(cliente, dia), ajena])

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    404,
    SERIE_DEL_DIA_YA_NO_EXISTE,
  ])
  expect([foto(cliente, dia), foto(cliente, otra)]).toEqual(antes)
})

test('una_serie_repetida_da_422', () => {
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  const [primera, segunda] = como_van(cliente, dia)

  const respuesta = guardar(cliente, dia, [primera, segunda, { ...primera, peso: 90 }])

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((e: any) => e.msg)).toEqual([
    'Value error, Hay series repetidas.',
  ])
  expect(foto(cliente, dia)).toEqual(antes)
})

test('varias_series_nuevas_sin_id_no_son_repetidas', () => {
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push, MARTES_15, [])

  const respuesta = guardar(cliente, dia, [
    ...[1, 2].map((n) => serie(push.press, push.a, n, 60)),
    { ...serie(push.fondos, push.b), id: null },
  ])

  esperar_estado(respuesta, 200)
  expect(leer(cliente, dia).series).toHaveLength(3)
})

// --- Un ejercicio por hueco --------------------------------------------------------

const mezcla = (uno: string, otro: string): string =>
  `En un mismo ejercicio de la rutina hay series de «${uno}» y de «${otro}», y en cada uno se hace` +
  ' un solo ejercicio por sesión. Deja solo las de uno.'

test('cambiar_de_ejercicio_un_hueco_en_una_sola_peticion_vale', () => {
  // Quitar las de Press banca y poner las de Press inclinado a la vez: con series sueltas,
  // la primera nueva chocaría con las viejas (409).
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const fondos = como_van(cliente, dia).at(-1)!

  const respuesta = guardar(cliente, dia, [
    fondos,
    ...[1, 2].map((n) => serie(push.inclinado, push.a, n, 50)),
  ])

  esperar_estado(respuesta, 200)
  expect(
    leer(cliente, dia)
      .series.map((s: any) => [s.slot_id, s.ejercicio_id])
      .sort((x: number[], y: number[]) => x[0] - y[0] || x[1] - y[1]),
  ).toEqual([
    [push.a, push.inclinado],
    [push.a, push.inclinado],
    [push.b, push.fondos],
  ])
})

test('cambiar_el_ejercicio_de_todas_las_series_de_un_hueco_vale', () => {
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const [primera, segunda, fondos] = como_van(cliente, dia)

  const respuesta = guardar(cliente, dia, [
    { ...primera, ejercicio_id: push.inclinado },
    { ...segunda, ejercicio_id: push.inclinado },
    fondos,
  ])

  esperar_estado(respuesta, 200)
  expect(como_van(cliente, dia).map((s) => [s.id, s.ejercicio_id])).toEqual([
    [primera.id, push.inclinado],
    [segunda.id, push.inclinado],
    [fondos.id, push.fondos],
  ])
})

test.each(['serie nueva', 'serie cambiada'])(
  'mezclar_dos_ejercicios_en_un_hueco_da_422_y_no_guarda_nada (%s)',
  (como) => {
    // 422 y no el 409 de apuntar una serie suelta: el choque está dentro de lo que se manda,
    // no con lo guardado.
    const { cliente, push } = escenario()
    const dia = dia_con(cliente, push)
    const antes = foto(cliente, dia)
    const [primera, segunda, fondos] = como_van(cliente, dia)
    const series =
      como === 'serie nueva'
        ? [primera, segunda, fondos, serie(push.inclinado, push.a, 3, 50)]
        : [primera, { ...segunda, ejercicio_id: push.inclinado }, fondos]

    const respuesta = guardar(cliente, dia, series)

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail).toBe(mezcla('Press banca', 'Press inclinado'))
    expect(foto(cliente, dia)).toEqual(antes)
  },
)

test('una_sesion_ya_mezclada_se_corrige_si_no_se_toca_el_hueco', () => {
  // Una sesión de antes del blindaje (o importada) con dos ejercicios en un hueco: corregir
  // un peso no la bloquea; añadir una serie a ese hueco, sí.
  const { cliente, bd, push } = escenario()
  const dia = dia_con(cliente, push)
  filaSerie(bd, dia, push.a, push.inclinado, {
    numero_serie: 3,
    peso_centesimas: 5000,
    repeticiones: 8,
  })
  const series = como_van(cliente, dia)
  series[0].peso = 61

  const corregida = guardar(cliente, dia, series)
  const con_otra = guardar(cliente, dia, [...series, serie(push.press, push.a, 4, 60)])

  esperar_estado(corregida, 200)
  expect(con_otra.status_code).toBe(422)
  expect(con_otra.json().detail).toBe(mezcla('Press banca', 'Press inclinado'))
})

test('mover_una_serie_a_un_hueco_con_otro_ejercicio_da_422_y_no_guarda_nada', () => {
  // Press banca es también alternativa de `b`, así que la serie puede ir allí; pero `b` ya
  // tiene la de Fondos. El hueco al que llega cuenta como tocado, no solo el que deja.
  const { cliente, push } = escenario()
  poner_alternativas(cliente, push.rutina, push.b, [push.press])
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  const [primera, segunda, fondos] = como_van(cliente, dia)

  const respuesta = guardar(cliente, dia, [primera, { ...segunda, slot_id: push.b }, fondos])

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    422,
    mezcla('Fondos', 'Press banca'),
  ])
  expect(foto(cliente, dia)).toEqual(antes)
})

// --- Corregir sí, elegir algo oculto no --------------------------------------------

test.each(['ejercicio oculto', 'hueco oculto', 'ya no es alternativa'])(
  'una_serie_guardada_se_sigue_guardando_aunque_ya_no_se_pudiera_elegir (%s)',
  (que) => {
    // Las series de Press inclinado en `a`, y después el ejercicio se oculta, el hueco se
    // oculta o deja de ser alternativa. Guardar el día con ellas (una con otro peso y otra
    // igual) vale: no se elige nada nuevo.
    const { cliente, push } = escenario()
    const dia = dia_con(cliente, push, MARTES_15, [
      ...[1, 2].map((n) => serie(push.inclinado, push.a, n, 50)),
      serie(push.fondos, push.b, 1, 10, 10),
    ])
    if (que === 'ejercicio oculto') ocultar_ejercicio(cliente, push.inclinado)
    else if (que === 'hueco oculto') ocultar_hueco(cliente, push.rutina, push.a)
    else poner_alternativas(cliente, push.rutina, push.a, [])
    const series = como_van(cliente, dia)
    series[0].peso = 55

    const respuesta = guardar(cliente, dia, series, null, 'Corregido')

    esperar_estado(respuesta, 200)
    expect(
      como_van(cliente, dia)
        .slice(0, 2)
        .map((s) => s.peso),
    ).toEqual(['55.00', '50.00'])
  },
)

test.each([
  ['ejercicio oculto', [404, ejercicio_oculto('Press inclinado')]],
  ['hueco oculto', [404, NO_ESTA_EN_LA_RUTINA]],
  ['hueco de otra rutina', [404, NO_ESTA_EN_LA_RUTINA]],
  ['ejercicio que no es del hueco', [422, NO_ES_DEL_HUECO]],
] as const)('una_serie_nueva_valida_como_al_apuntarla_suelta (%s)', (que, esperado) => {
  // Usa las mismas comprobaciones: un ejercicio o un hueco que no existen, en
  // `elegir_algo_que_no_existe_da_404_y_no_guarda_nada`.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  let nueva = serie(push.inclinado, push.a, 3, 50)
  if (que === 'ejercicio oculto') {
    ocultar_ejercicio(cliente, push.inclinado)
  } else if (que === 'hueco oculto') {
    ocultar_hueco(cliente, push.rutina, push.b)
    nueva = serie(push.fondos, push.b, 2, 10, 10)
  } else if (que === 'hueco de otra rutina') {
    const otra = crear_rutina(cliente, 'Pull')
    nueva = serie(push.fondos, crear_hueco(cliente, otra, push.fondos), 2, 10, 10)
  } else {
    nueva = serie(push.fondos, push.a, 3, 10, 10)
  }
  // Sin las series que ya había en ese hueco: el fallo no puede ser el de mezclar.
  const series = como_van(cliente, dia).filter((s) => s.slot_id !== nueva.slot_id)

  const respuesta = guardar(cliente, dia, [...series, nueva])

  expect([respuesta.status_code, respuesta.json().detail]).toEqual(esperado)
  expect(foto(cliente, dia)).toEqual(antes)
})

test('el_dia_de_una_rutina_oculta_se_sigue_guardando_con_series_nuevas', () => {
  // Corregir sí: la sesión ya era de esa rutina, y sus huecos siguen a la vista. Es lo que
  // hace la edición de un día pasado de una rutina que después se ocultó.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  esperar_estado(cliente.delete(`/rutinas/${push.rutina}`, { params: { modo: 'ocultar' } }), 204)

  const respuesta = guardar(cliente, dia, [
    ...como_van(cliente, dia),
    serie(push.press, push.a, 3, 65),
  ])

  esperar_estado(respuesta, 200)
  expect(leer(cliente, dia).series).toHaveLength(4)
})

test('una_serie_cambiada_a_otro_ejercicio_oculto_da_404', () => {
  // Cambiar el ejercicio de una serie sí es elegir: el nuevo tiene que estar a la vista.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  ocultar_ejercicio(cliente, push.inclinado)
  const [primera, segunda, fondos] = como_van(cliente, dia)

  const respuesta = guardar(cliente, dia, [
    { ...primera, ejercicio_id: push.inclinado },
    { ...segunda, ejercicio_id: push.inclinado },
    fondos,
  ])

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    404,
    ejercicio_oculto('Press inclinado'),
  ])
  expect(foto(cliente, dia)).toEqual(antes)
})

// --- Cambiar de ejercicio en la sesión: DELETE de las series de un hueco ----------

function borrar_del_hueco(cliente: Cliente, sesion_id: number, slot_id: number) {
  return cliente.delete(`/entrenamientos/${sesion_id}/series`, { params: { slot_id } })
}

test('borrar_las_series_de_un_hueco_deja_las_de_los_demas', () => {
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const fondos = como_van(cliente, dia).at(-1)!

  const respuesta = borrar_del_hueco(cliente, dia, push.a)

  esperar_estado(respuesta, 204)
  expect(como_van(cliente, dia).map((s) => s.id)).toEqual([fondos.id])
})

test('borrar_las_de_un_hueco_no_toca_las_de_otra_sesion_en_ese_hueco', () => {
  const { cliente, push } = escenario()
  const otra = dia_con(cliente, push, LUNES_14)
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, otra)

  expect(borrar_del_hueco(cliente, dia, push.a).status_code).toBe(204)

  expect(foto(cliente, otra)).toEqual(antes)
})

test('borrar_las_de_un_hueco_de_otra_rutina_da_404_y_no_borra_nada', () => {
  // El hueco existe, pero no es de la rutina de esta sesión: por la ruta de otro padre, 404.
  // Tiene una serie en otra sesión, que tampoco se toca. Un hueco que no existe, en
  // `crud.test.ts`.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)
  const otra = crear_rutina(cliente, 'Pull')
  const hueco = crear_hueco(cliente, otra, push.press)
  const otra_sesion = dia_con(cliente, { ...push, rutina: otra }, DOMINGO_13, [
    serie(push.press, hueco),
  ])
  const antes_otra = foto(cliente, otra_sesion)

  const respuesta = borrar_del_hueco(cliente, dia, hueco)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([404, NO_ESTA_EN_LA_RUTINA])
  expect([foto(cliente, dia), foto(cliente, otra_sesion)]).toEqual([antes, antes_otra])
})

test('borrar_las_de_un_hueco_sin_decir_cual_da_422_y_no_borra_nada', () => {
  // Sin `slot_id` borraría todas las series del día.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  const antes = foto(cliente, dia)

  const respuesta = cliente.delete(`/entrenamientos/${dia}/series`)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((e: any) => e.loc)).toEqual([['query', 'slot_id']])
  expect(foto(cliente, dia)).toEqual(antes)
})

test('borrar_las_de_un_hueco_oculto_vale', () => {
  // Quitar lo apuntado no es elegir nada.
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push)
  ocultar_hueco(cliente, push.rutina, push.b)

  expect(borrar_del_hueco(cliente, dia, push.b).status_code).toBe(204)
  expect(new Set(leer(cliente, dia).series.map((s: any) => s.slot_id))).toEqual(new Set([push.a]))
})

test('borrar_las_de_un_hueco_sin_series_da_204', () => {
  const { cliente, push } = escenario()
  const dia = dia_con(cliente, push, MARTES_15, [serie(push.press, push.a)])
  const antes = foto(cliente, dia)

  expect(borrar_del_hueco(cliente, dia, push.b).status_code).toBe(204)
  expect(foto(cliente, dia)).toEqual(antes)
})

test.each(['hoy, en curso', 'un día pasado'])(
  'borrar_las_unicas_series_deja_la_sesion_vacia_sin_borrarla (%s)',
  (cuando) => {
    // Cambiar de ejercicio en la sesión borra las del hueco y enseguida se apuntan las del
    // otro: si la sesión se borrara al quedarse vacía, la siguiente serie no tendría dónde ir.
    const { cliente, push } = escenario()
    const fecha = cuando === 'hoy, en curso' ? HOY : MARTES_15
    const dia = dia_con(cliente, push, fecha, [serie(push.press, push.a)])

    expect(borrar_del_hueco(cliente, dia, push.a).status_code).toBe(204)

    const guardado = leer(cliente, dia)
    expect([guardado.fecha, guardado.series]).toEqual([fecha, []])
    expect(guardado.en_curso).toBe(cuando === 'hoy, en curso')
  },
)
