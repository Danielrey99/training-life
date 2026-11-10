/**
 * Tests de las medidas de una serie según el tipo de su ejercicio
 * (`src/logica/reglas/medidas.ts`). Puerto de `backend/tests/test_medidas.py`.
 *
 * Cada ejercicio dice cómo se apunta, y eso decide qué medidas lleva cada serie suya:
 *
 * - peso y repeticiones (`peso_reps`): peso (0 o más) y repeticiones;
 * - peso corporal (`corporal`): repeticiones y carga (0 sin carga, positiva de lastre,
 *   negativa de ayuda), y si se quiere el peso corporal de quien la hizo;
 * - tiempo (`tiempo`): duración y, si se quiere, peso (0 o más);
 * - cardio (`cardio`): duración y, si se quiere, distancia en metros (sin peso, repeticiones
 *   ni peso corporal).
 *
 * Lo que falta o sobra da 422 con el nombre del ejercicio, al apuntar y al corregir (con el
 * ejercicio final: cambiar a una alternativa de otro tipo exige sus medidas). La base de
 * datos solo comprueba la forma de la serie, con sus CHECK.
 *
 * El escenario: la rutina tiene un hueco A de Press banca con Dominadas en anillas y Plancha
 * con lastre de alternativas (tres de los cuatro tipos en un hueco), un hueco B de Dominadas
 * en anillas y un C de Plancha con lastre.
 */
import type { Valor } from '../../src/logica/bd/bd'
import {
  crear_ejercicio,
  crear_rutina,
  ejercicio_oculto,
  esperar_estado,
  objetivo,
} from '../apoyo/ayudas'
import { type ClienteDeTest as Cliente, crearCliente } from '../apoyo/cliente'
import { grupo_muscular_id } from '../apoyo/conftest'
import { filaEjercicio, filaSerie, insertar, unGrupo } from '../apoyo/filas'
import { AHORA } from '../apoyo/baseNueva'

const FECHA = '2026-09-04'
const NEGATIVO =
  'El peso no puede ser negativo. Solo los ejercicios de peso corporal admiten ayuda.'
const PLANCHA_CON_REPS =
  '«Plancha con lastre» se apunta por tiempo. Falta la duración y sobran las repeticiones.'
const MEDIDAS = ['peso', 'repeticiones', 'duracion_s', 'distancia_m', 'peso_corporal'] as const
// Todas nulas: lo que se espera de una serie se escribe encima, solo con lo que lleva.
const SIN_MEDIDAS: Record<string, unknown> = Object.fromEntries(MEDIDAS.map((m) => [m, null]))

function peso_corporal_de_otro_tipo(nombre: string): string {
  return (
    'El peso corporal solo se guarda en las series de ejercicios de peso corporal, ' +
    `y «${nombre}» no lo es.`
  )
}

interface Escenario {
  ids: Record<string, number>
  rutina: number
  a: number
  b: number
  c: number
  sesion: number
  // El hueco donde cada uno es el principal.
  hueco_de: Record<string, number>
}

function escenario() {
  const entorno = crearCliente()
  const { cliente } = entorno
  const g = grupo_muscular_id(cliente)
  const ids: Record<string, number> = {
    press: crear_ejercicio(cliente, g, 'Press banca'),
    dominadas: crear_ejercicio(cliente, g, 'Dominadas en anillas', { tipo: 'corporal' }),
    plancha: crear_ejercicio(cliente, g, 'Plancha con lastre', { tipo: 'tiempo' }),
  }
  const rutina = crear_rutina(cliente, 'Mixta')

  // Plancha con lastre es de tiempo: su objetivo va en segundos; el de los demás, en reps.
  const objetivo_de = (nombre: string) =>
    nombre === 'plancha' ? objetivo(3, { duracion: [30, 60] }) : objetivo(3, [6, 10])

  const hueco = (principal: string, orden: number, ...alternativas: string[]): number => {
    const respuesta = cliente.post(`/rutinas/${rutina}/slots`, {
      json: {
        ejercicio_principal_id: ids[principal],
        orden,
        ...objetivo_de(principal),
        alternativas: alternativas.map((a) => ({ ejercicio_id: ids[a], ...objetivo_de(a) })),
      },
    })
    esperar_estado(respuesta, 201)
    return respuesta.json().id
  }

  const a = hueco('press', 1, 'dominadas', 'plancha')
  const b = hueco('dominadas', 2)
  const c = hueco('plancha', 3)
  const sesion = cliente.post('/entrenamientos', { json: { rutina_id: rutina, fecha: FECHA } })
  esperar_estado(sesion, 201)
  const e: Escenario = {
    ids,
    rutina,
    a,
    b,
    c,
    sesion: sesion.json().id,
    hueco_de: { press: a, dominadas: b, plancha: c },
  }
  return { ...entorno, e }
}

function cuerpo(
  e: Escenario,
  ejercicio: string,
  numero = 1,
  slot_id: number | null = null,
  medidas: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ejercicio_id: e.ids[ejercicio],
    slot_id: slot_id ?? e.hueco_de[ejercicio],
    numero_serie: numero,
    ...medidas,
  }
}

/** POST de una serie; `numero` y `slot_id` van en el último objeto (por nombre en Python). */
function apuntar(
  cliente: Cliente,
  e: Escenario,
  ejercicio: string,
  medidas: Record<string, unknown> = {},
  { numero = 1, slot_id = null }: { numero?: number; slot_id?: number | null } = {},
) {
  return cliente.post(`/entrenamientos/${e.sesion}/series`, {
    json: cuerpo(e, ejercicio, numero, slot_id, medidas),
  })
}

function apuntada(
  cliente: Cliente,
  e: Escenario,
  ejercicio: string,
  medidas: Record<string, unknown> = {},
  opciones: { numero?: number; slot_id?: number | null } = {},
): any {
  const respuesta = apuntar(cliente, e, ejercicio, medidas, opciones)
  esperar_estado(respuesta, 201)
  return respuesta.json()
}

/**
 * PUT de la serie con ese ejercicio y esas medidas (y nada más: lo que no se mande queda
 * nulo, como la variante).
 */
function corregir(
  cliente: Cliente,
  e: Escenario,
  serie: any,
  ejercicio: string,
  medidas: Record<string, unknown> = {},
  slot_id: number | null = null,
) {
  return cliente.put(`/entrenamientos/${e.sesion}/series/${serie.id}`, {
    json: cuerpo(e, ejercicio, serie.numero_serie, slot_id ?? serie.slot_id, medidas),
  })
}

function series_de(cliente: Cliente, e: Escenario): any[] {
  return cliente.get(`/entrenamientos/${e.sesion}`).json().series
}

function medidas_de(serie: any): Record<string, unknown> {
  return Object.fromEntries(MEDIDAS.map((campo) => [campo, serie[campo]]))
}

/** El 422 es el del esquema y justo por ese campo, no el de las medidas. */
function es_de_pydantic_por(respuesta: { json(): any }, campo: string): boolean {
  const detalle = respuesta.json().detail
  return (
    Array.isArray(detalle) &&
    JSON.stringify(detalle.map((error: any) => error.loc)) === JSON.stringify([['body', campo]])
  )
}

// --- Una serie válida de cada tipo ----------------------------------------------

test.each([
  [
    'peso-y-repeticiones',
    'press',
    { peso: 60, repeticiones: 8 },
    { peso: '60.00', repeticiones: 8, duracion_s: null, peso_corporal: null },
  ],
  [
    'peso-y-repeticiones-con-0-kg',
    'press',
    { peso: 0, repeticiones: 12 },
    { peso: '0.00', repeticiones: 12, duracion_s: null, peso_corporal: null },
  ],
  [
    'corporal-sin-carga',
    'dominadas',
    { peso: 0, repeticiones: 10 },
    { peso: '0.00', repeticiones: 10, duracion_s: null, peso_corporal: null },
  ],
  [
    'corporal-con-lastre-y-peso-corporal',
    'dominadas',
    { peso: 15, repeticiones: 6, peso_corporal: '78.5' },
    { peso: '15.00', repeticiones: 6, duracion_s: null, peso_corporal: '78.50' },
  ],
  [
    'corporal-con-ayuda-y-peso-corporal',
    'dominadas',
    { peso: -20, repeticiones: 8, peso_corporal: 70 },
    { peso: '-20.00', repeticiones: 8, duracion_s: null, peso_corporal: '70.00' },
  ],
  [
    'tiempo-sin-peso',
    'plancha',
    { duracion_s: 45 },
    { peso: null, repeticiones: null, duracion_s: 45, peso_corporal: null },
  ],
  [
    'tiempo-con-peso',
    'plancha',
    { duracion_s: 60, peso: 10 },
    { peso: '10.00', repeticiones: null, duracion_s: 60, peso_corporal: null },
  ],
])(
  'una_serie_con_las_medidas_de_su_tipo_se_guarda_tal_cual (%s)',
  (_, ejercicio, medidas, guardado) => {
    const { cliente, e } = escenario()

    const respuesta = apuntar(cliente, e, ejercicio, medidas)

    esperar_estado(respuesta, 201)
    expect(medidas_de(respuesta.json())).toEqual({ ...SIN_MEDIDAS, ...guardado })
    const [leida] = series_de(cliente, e)
    expect(medidas_de(leida)).toEqual({ ...SIN_MEDIDAS, ...guardado })
  },
)

test('una_serie_trae_todas_sus_medidas_y_su_ejercicio_con_el_tipo', () => {
  // El contrato de `SerieOut`: las cinco medidas siempre (nulas si no van) y el ejercicio
  // entero, con su tipo.
  const { cliente, e } = escenario()

  const serie = apuntada(cliente, e, 'plancha', { duracion_s: 30 })

  expect(Object.keys(serie).sort()).toEqual(
    [
      'id',
      'entrenamiento_id',
      'ejercicio_id',
      'slot_id',
      'numero_serie',
      ...MEDIDAS,
      'variante',
      'created_at',
      'updated_at',
      'ejercicio',
    ].sort(),
  )
  expect(serie.ejercicio.tipo_registro).toBe('tiempo')
})

// --- Lo que falta o sobra -------------------------------------------------------

test.each([
  [
    'peso-y-repeticiones-por-tiempo',
    'press',
    { duracion_s: 30 },
    '«Press banca» se apunta con peso y repeticiones. Faltan el peso y las repeticiones' +
      ' y sobra la duración.',
  ],
  [
    'corporal-sin-carga-nula',
    'dominadas',
    { repeticiones: 8 },
    '«Dominadas en anillas» se apunta con repeticiones y carga. Falta el peso.',
  ],
  [
    'corporal-con-duracion',
    'dominadas',
    { peso: 0, repeticiones: 8, duracion_s: 20 },
    '«Dominadas en anillas» se apunta con repeticiones y carga. Sobra la duración.',
  ],
])(
  'una_medida_que_falta_o_sobra_da_422_con_el_nombre_del_ejercicio (%s)',
  (_, ejercicio, medidas, mensaje) => {
    const { cliente, e } = escenario()

    const respuesta = apuntar(cliente, e, ejercicio, medidas)

    esperar_estado(respuesta, 422)
    expect(respuesta.json().detail).toBe(mensaje)
    expect(series_de(cliente, e)).toEqual([])
  },
)

test.each([
  [
    'tiempo-por-repeticiones',
    'plancha',
    { peso: 0, repeticiones: 8 },
    '«Plancha con lastre» se apunta por tiempo. Falta la duración y sobran las repeticiones.',
  ],
  [
    'corporal-sin-repeticiones',
    'dominadas',
    { peso: 0 },
    '«Dominadas en anillas» se apunta con repeticiones y carga. Faltan las repeticiones.',
  ],
])(
  'las_repeticiones_que_faltan_o_sobran_se_dicen_en_plural (%s)',
  (_, ejercicio, medidas, mensaje) => {
    // El verbo concuerda con el campo, no con cuántos son: «faltan las repeticiones» aunque
    // sea solo una cosa. El primer caso es, palabra por palabra, el ejemplo del plan de los
    // tipos.
    //
    // Bug real: decía «falta las repeticiones» y «sobra las repeticiones».
    const { cliente, e } = escenario()

    const respuesta = apuntar(cliente, e, ejercicio, medidas)

    esperar_estado(respuesta, 422)
    expect(respuesta.json().detail).toBe(mensaje)
  },
)

test('un_peso_negativo_solo_vale_en_peso_corporal', () => {
  // La ayuda (carga negativa) solo existe en los ejercicios de peso corporal; en ellos se
  // apunta bien (en el test de las series válidas). Antes del peso corporal lo rechazaba el
  // esquema (`ge=0`); ahora el esquema admite negativos y el 422 es el de las medidas del
  // tipo. Con un ejercicio de peso y repeticiones, en
  // `la_ayuda_se_valida_con_el_ejercicio_final_y_no_con_el_de_antes`.
  const { cliente, e } = escenario()

  const respuesta = apuntar(cliente, e, 'plancha', { duracion_s: 30, peso: -5 })

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toBe(NEGATIVO)
  expect(series_de(cliente, e)).toEqual([])
})

test('la_ayuda_admite_hasta_lo_que_cabe_en_la_columna_y_no_mas', () => {
  // El peso va de −9999,99 a 9999,99 (NUMERIC(6,2)): uno más llegaría a la base y sería un
  // 500.
  const { cliente, e } = escenario()

  const justo = apuntar(cliente, e, 'dominadas', { peso: '-9999.99', repeticiones: 1 })
  const pasado = apuntar(
    cliente,
    e,
    'dominadas',
    { peso: '-10000', repeticiones: 1 },
    { numero: 2 },
  )

  esperar_estado(justo, 201)
  expect(justo.json().peso).toBe('-9999.99')
  expect(pasado.status_code).toBe(422)
  expect(es_de_pydantic_por(pasado, 'peso')).toBe(true)
  expect(series_de(cliente, e)).toEqual([justo.json()])
})

test.each([
  [1, 201],
  [86400, 201],
  [86401, 422],
  [0, 422],
])('la_duracion_va_de_un_segundo_a_un_dia (%i, %i)', (duracion, codigo) => {
  const { cliente, e } = escenario()

  const respuesta = apuntar(cliente, e, 'plancha', { duracion_s: duracion })

  esperar_estado(respuesta, codigo)
  if (codigo === 422) {
    expect(es_de_pydantic_por(respuesta, 'duracion_s')).toBe(true)
    expect(series_de(cliente, e)).toEqual([])
  }
})

// --- El orden de las comprobaciones -----------------------------------------------
//
// 404 (sesión, ejercicio oculto) → 404/422 del hueco → 422 de las medidas → 409 de mezclar
// ejercicios en un hueco: una petición mal hecha nunca choca con el estado.

test('unas_medidas_mal_puestas_dan_su_422_antes_que_el_409_de_mezclar', () => {
  // El hueco A ya tiene press en esta sesión: la plancha mal apuntada da el 422 de sus
  // medidas (no se arregla borrando nada), y bien apuntada, el 409.
  const { cliente, e } = escenario()
  const press = apuntada(cliente, e, 'press', { peso: 60, repeticiones: 8 })

  const mal = apuntar(
    cliente,
    e,
    'plancha',
    { peso: 60, repeticiones: 8 },
    { numero: 2, slot_id: e.a },
  )
  const bien = apuntar(cliente, e, 'plancha', { duracion_s: 30 }, { numero: 2, slot_id: e.a })

  esperar_estado(mal, 422)
  expect(mal.json().detail).toBe(PLANCHA_CON_REPS)
  esperar_estado(bien, 409)
  expect(bien.json().detail).toBe(
    'Esta sesión ya tiene la serie de «Press banca» en ese ejercicio de la rutina, y en cada' +
      ' uno se hace un solo ejercicio por sesión. Borra antes esa serie para apuntar «Plancha' +
      ' con lastre».',
  )
  expect(series_de(cliente, e)).toEqual([press])
})

test('un_ejercicio_que_no_es_del_hueco_se_dice_antes_que_sus_medidas', () => {
  // La plancha no está en el hueco B: 422 del hueco, aunque sus medidas tampoco cuadren.
  const { cliente, e } = escenario()

  const respuesta = apuntar(cliente, e, 'plancha', { peso: 60, repeticiones: 8 }, { slot_id: e.b })

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toBe(
    'Ese ejercicio no es ni el de la rutina ni una de sus alternativas.',
  )
})

test('un_ejercicio_oculto_da_404_antes_que_sus_medidas', () => {
  const { cliente, e } = escenario()
  expect(cliente.delete(`/ejercicios/${e.ids.plancha}?modo=ocultar`).status_code).toBe(204)

  const respuesta = apuntar(cliente, e, 'plancha', { peso: 60, repeticiones: 8 })

  esperar_estado(respuesta, 404)
  expect(respuesta.json().detail).toBe(ejercicio_oculto('Plancha con lastre'))
})

// --- Corregir una serie ---------------------------------------------------------

test('cambiar_a_una_alternativa_de_otro_tipo_exige_sus_medidas', () => {
  // La única serie del hueco A es de press. Pasarla a plancha con peso y reps da el 422 de
  // la plancha y la serie no cambia; con su duración, vale, y el peso y las repeticiones
  // quedan nulos.
  const { cliente, e } = escenario()
  const serie = apuntada(cliente, e, 'press', { peso: 60, repeticiones: 8 })

  const mal = corregir(cliente, e, serie, 'plancha', { peso: 60, repeticiones: 8 })
  esperar_estado(mal, 422)
  expect(mal.json().detail).toBe(PLANCHA_CON_REPS)
  expect(series_de(cliente, e)).toEqual([serie])

  const bien = corregir(cliente, e, serie, 'plancha', { duracion_s: 40 })
  esperar_estado(bien, 200)
  expect(bien.json().ejercicio_id).toBe(e.ids.plancha)
  expect(medidas_de(bien.json())).toEqual({ ...SIN_MEDIDAS, duracion_s: 40 })
})

test('la_ayuda_se_valida_con_el_ejercicio_final_y_no_con_el_de_antes', () => {
  // De press (donde no vale) a dominadas (donde sí): lo que cuenta es el ejercicio al que
  // pasa la serie. Y al revés: de vuelta a press con la ayuda, 422.
  const { cliente, e } = escenario()
  const serie = apuntada(cliente, e, 'press', { peso: 60, repeticiones: 8 })

  const a_dominadas = corregir(cliente, e, serie, 'dominadas', { peso: -10, repeticiones: 6 })
  esperar_estado(a_dominadas, 200)
  expect(a_dominadas.json().peso).toBe('-10.00')

  const a_press = corregir(cliente, e, serie, 'press', { peso: -10, repeticiones: 6 })
  esperar_estado(a_press, 422)
  expect(a_press.json().detail).toBe(NEGATIVO)
  expect(series_de(cliente, e)[0].ejercicio_id).toBe(e.ids.dominadas)
})

test('corregir_una_serie_sin_sus_medidas_da_422_y_no_la_toca', () => {
  const { cliente, e } = escenario()
  const serie = apuntada(cliente, e, 'press', { peso: 60, repeticiones: 8 })

  const respuesta = corregir(cliente, e, serie, 'press', { peso: 62.5 })

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toBe(
    '«Press banca» se apunta con peso y repeticiones. Faltan las repeticiones.',
  )
  expect(series_de(cliente, e)).toEqual([serie])
})

// --- Peso corporal --------------------------------------------------------------
//
// Cuánto pesaba quien hizo una serie de peso corporal. Es un dato de la serie, como la
// variante: opcional, y el PUT copia el cuerpo entero (si no llega, queda nulo).

test('el_peso_corporal_en_otro_tipo_da_422', () => {
  const { cliente, e } = escenario()

  const respuesta = apuntar(cliente, e, 'press', { peso: 60, repeticiones: 8, peso_corporal: 80 })

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toBe(peso_corporal_de_otro_tipo('Press banca'))
  expect(series_de(cliente, e)).toEqual([])
})

test.each([
  ['0.01', '0.01'],
  ['500', '500.00'],
])('el_peso_corporal_va_de_un_centimo_a_500_kg (%s, %s)', (valor, guardado) => {
  const { cliente, e } = escenario()

  const serie = apuntada(cliente, e, 'dominadas', {
    peso: 0,
    repeticiones: 10,
    peso_corporal: valor,
  })

  expect(serie.peso_corporal).toBe(guardado)
})

test.each(['0.001', '500.01'])('un_peso_corporal_fuera_de_rango_da_422 (%s)', (valor) => {
  // 0,001 tiene que fallar aquí: redondeado a dos decimales sería 0,00, el CHECK de la base
  // lo rechazaría y sería un 500. (Un cero o un negativo los para el mismo mínimo, y corregir
  // usa el mismo esquema que apuntar.)
  const { cliente, e } = escenario()

  const respuesta = apuntar(cliente, e, 'dominadas', {
    peso: 0,
    repeticiones: 10,
    peso_corporal: valor,
  })

  esperar_estado(respuesta, 422)
  expect(es_de_pydantic_por(respuesta, 'peso_corporal')).toBe(true)
  expect(series_de(cliente, e)).toEqual([])
})

test.each([
  ['ausente-lo-deja-nulo', {}, null],
  ['con-valor-lo-cambia', { peso_corporal: 81 }, '81.00'],
])(
  'corregir_una_serie_copia_el_peso_corporal_del_cuerpo_como_la_variante (%s)',
  (_, en_el_cuerpo, queda) => {
    // El contrato del plan: el PUT copia el cuerpo entero. Un peso corporal que no llega no
    // se conserva: queda nulo, igual que una variante que no llega (la web lo manda siempre
    // en las series de peso corporal).
    const { cliente, e } = escenario()
    const serie = apuntada(cliente, e, 'dominadas', {
      peso: 0,
      repeticiones: 10,
      peso_corporal: 80,
      variante: 'pronas',
    })

    const respuesta = corregir(cliente, e, serie, 'dominadas', {
      peso: 0,
      repeticiones: 12,
      ...en_el_cuerpo,
    })

    esperar_estado(respuesta, 200)
    expect([respuesta.json().peso_corporal, respuesta.json().variante]).toEqual([queda, null])
    expect(series_de(cliente, e)[0].peso_corporal).toBe(queda)
  },
)

test('pasar_a_una_alternativa_de_otro_tipo_con_peso_corporal_da_422_y_no_cambia_nada', () => {
  // Dominadas en anillas en el hueco A (alternativa) con su peso corporal; pasarla a plancha
  // con su duración pero conservando el peso corporal: 422 que nombra la plancha.
  const { cliente, e } = escenario()
  const serie = apuntada(
    cliente,
    e,
    'dominadas',
    { peso: 0, repeticiones: 10, peso_corporal: 80 },
    { slot_id: e.a },
  )

  const respuesta = corregir(cliente, e, serie, 'plancha', { duracion_s: 30, peso_corporal: 80 })

  esperar_estado(respuesta, 422)
  expect(respuesta.json().detail).toBe(peso_corporal_de_otro_tipo('Plancha con lastre'))
  expect(series_de(cliente, e)).toEqual([serie])
})

// --- Historial ------------------------------------------------------------------

test('el_historial_trae_la_duracion_y_no_el_peso_corporal', () => {
  // Las series del historial de un ejercicio traen el peso y las repeticiones nulos de una
  // serie por tiempo sin peso, y su duración; las de uno corporal, su lastre. El peso
  // corporal no va: ninguna pantalla que lee el historial lo enseña.
  const { cliente, e } = escenario()
  apuntada(cliente, e, 'plancha', { duracion_s: 45 }, { slot_id: e.a })
  const otra = cliente.post('/entrenamientos', {
    json: { rutina_id: e.rutina, fecha: '2026-09-05' },
  })
  esperar_estado(
    cliente.post(`/entrenamientos/${otra.json().id}/series`, {
      json: cuerpo(e, 'dominadas', 1, e.a, { peso: -10, repeticiones: 8, peso_corporal: 80 }),
    }),
    201,
  )

  const de_la_plancha = cliente.get(`/ejercicios/${e.ids.plancha}/historial`).json()
  const de_las_dominadas = cliente.get(`/ejercicios/${e.ids.dominadas}/historial`).json()

  const series_plancha = de_la_plancha.map((dia: any) => dia.series)
  expect(series_plancha).toHaveLength(1)
  expect(series_plancha[0]).toHaveLength(1)
  const de_plancha = series_plancha[0][0]
  expect([de_plancha.peso, de_plancha.repeticiones, de_plancha.duracion_s]).toEqual([
    null,
    null,
    45,
  ])
  expect(de_las_dominadas.map((dia: any) => dia.fecha)).toEqual(['2026-09-05'])
  const series_dominadas = de_las_dominadas.map((dia: any) => dia.series)
  expect(series_dominadas).toHaveLength(1)
  expect(series_dominadas[0]).toHaveLength(1)
  const de_dominadas = series_dominadas[0][0]
  expect([de_dominadas.peso, de_dominadas.repeticiones, de_dominadas.duracion_s]).toEqual([
    '-10.00',
    8,
    null,
  ])
  for (const serie of [de_plancha, de_dominadas]) {
    expect(serie).not.toHaveProperty('peso_corporal')
  }
})

// --- Las restricciones de la base -------------------------------------------------
//
// Solo comprueban la forma de una serie (la regla por tipo está en otra tabla y la pone el
// endpoint). Cada caso rompe una sola condición, para ver que salta la que toca: si faltara,
// una serie así se colaría desde cualquier camino que no fuera la API. El test que compara
// el esquema con los modelos solo mira sus nombres, no lo que dicen. Que la base admite lo
// válido lo prueba cada serie que la API guarda.
//
// En el móvil las medidas van en centésimas (`peso_centesimas`, `peso_corporal_centesimas`).

test.each([
  ['ni-repeticiones-ni-duracion', { peso_centesimas: 1000 }, 'series_medidas_check'],
  ['repeticiones-sin-peso', { repeticiones: 8 }, 'series_medidas_check'],
  [
    'repeticiones-y-duracion',
    { peso_centesimas: 0, repeticiones: 8, duracion_s: 30 },
    'series_medidas_check',
  ],
  ['carga-negativa-sin-reps', { peso_centesimas: -500, duracion_s: 30 }, 'series_peso_check'],
  ['duracion-cero', { duracion_s: 0 }, 'series_duracion_check'],
  [
    'peso-corporal-sin-repeticiones',
    { duracion_s: 30, peso_corporal_centesimas: 7000 },
    'series_peso_corporal_check',
  ],
  [
    'peso-corporal-cero',
    { peso_centesimas: 0, repeticiones: 8, peso_corporal_centesimas: 0 },
    'series_peso_corporal_check',
  ],
  [
    'duracion-con-peso-y-distancia-a-la-vez',
    { duracion_s: 600, peso_centesimas: 500, distancia_m: 1000 },
    'series_medidas_check',
  ],
  [
    'repeticiones-con-distancia',
    { peso_centesimas: 1000, repeticiones: 8, distancia_m: 1000 },
    'series_medidas_check',
  ],
  ['distancia-cero', { duracion_s: 600, distancia_m: 0 }, 'series_distancia_check'],
] as [string, Record<string, Valor>, string][])(
  'la_base_rechaza_una_serie_con_una_forma_imposible (%s)',
  (_, medidas, restriccion) => {
    const { bd, e } = escenario()
    const sin = { peso_centesimas: null, repeticiones: null, duracion_s: null, distancia_m: null }

    expect(() => filaSerie(bd, e.sesion, e.a, e.ids.press, { ...sin, ...medidas })).toThrow(
      `CHECK constraint failed: ${restriccion}`,
    )
  },
)

test('la_base_rechaza_un_tipo_de_ejercicio_que_no_existe', () => {
  const { bd } = escenario()

  expect(() => filaEjercicio(bd, { nombre: 'Cinta', tipo_registro: 'natación' })).toThrow(
    'CHECK constraint failed: ejercicios_tipo_registro_check',
  )
})

test('un_ejercicio_creado_en_la_base_sin_tipo_es_de_peso_y_repeticiones', () => {
  // El valor por defecto también está en la base: un INSERT que no lo nombre, como haría la
  // app móvil al copiar el esquema, no falla.
  const { bd } = escenario()

  const id = insertar(bd, 'ejercicios', {
    nombre: 'Remo',
    grupo_muscular_id: unGrupo(bd),
    es_predefinido: 0,
    created_at: AHORA,
    updated_at: AHORA,
  })

  expect(
    bd.una<{ tipo_registro: string }>('SELECT tipo_registro FROM ejercicios WHERE id = ?', id),
  ).toEqual({ tipo_registro: 'peso_reps' })
})

// --- Cardio: duración y, si se quiere, distancia -----------------------------------
//
// Un hueco D de Cinta (cardio) con su objetivo en segundos, en la rutina del escenario.

const COMO_CARDIO = '«Cinta» se apunta por tiempo y, si se quiere, distancia'

/** El escenario de siempre con un ejercicio de cardio, «Cinta», y su hueco D. */
function escenario_con_cardio() {
  const entorno = escenario()
  const { cliente, e } = entorno
  const cinta = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Cinta', { tipo: 'cardio' })
  const respuesta = cliente.post(`/rutinas/${e.rutina}/slots`, {
    json: { ejercicio_principal_id: cinta, orden: 4, ...objetivo(1, { duracion: [900, 1800] }) },
  })
  esperar_estado(respuesta, 201)
  e.ids.cinta = cinta
  e.hueco_de.cinta = respuesta.json().id
  return entorno
}

test.each([
  [
    'con-distancia',
    { duracion_s: 1800, distancia_m: 5200 },
    { duracion_s: 1800, distancia_m: 5200 },
  ],
  ['sin-ella', { duracion_s: 600 }, { duracion_s: 600, distancia_m: null }],
])(
  'una_serie_de_cardio_lleva_la_duracion_y_si_se_quiere_la_distancia (%s)',
  (_, medidas, guardado) => {
    const { cliente, e } = escenario_con_cardio()

    const respuesta = apuntar(cliente, e, 'cinta', medidas)

    esperar_estado(respuesta, 201)
    expect(medidas_de(respuesta.json())).toEqual({ ...SIN_MEDIDAS, ...guardado })
    const [leida] = series_de(cliente, e)
    expect(medidas_de(leida)).toEqual({ ...SIN_MEDIDAS, ...guardado })
    expect(leida.ejercicio.tipo_registro).toBe('cardio')
  },
)

test.each([
  ['sin-nada', {}, `${COMO_CARDIO}. Falta la duración.`],
  // No es el 422 de la ayuda: en cardio sobra cualquier peso, también uno negativo.
  ['con-ayuda', { duracion_s: 600, peso: -10 }, `${COMO_CARDIO}. Sobra el peso.`],
  [
    'con-repeticiones',
    { duracion_s: 600, repeticiones: 8 },
    `${COMO_CARDIO}. Sobran las repeticiones.`,
  ],
  // Lo que falta y lo que sobra a la vez, en
  // `pasar_una_serie_a_una_alternativa_de_cardio_y_volver_exige_las_medidas_de_cada_uno`.
])(
  'en_cardio_una_medida_que_falta_o_sobra_da_422_con_el_nombre_del_ejercicio (%s)',
  (_, medidas, mensaje) => {
    const { cliente, e } = escenario_con_cardio()

    const respuesta = apuntar(cliente, e, 'cinta', medidas)

    esperar_estado(respuesta, 422)
    expect(respuesta.json().detail).toBe(mensaje)
    expect(series_de(cliente, e)).toEqual([])
  },
)

test.each([
  [
    'peso-y-repeticiones',
    'press',
    { peso: 60, repeticiones: 8, distancia_m: 100 },
    '«Press banca» se apunta con peso y repeticiones. Sobra la distancia.',
  ],
  [
    'corporal',
    'dominadas',
    { peso: 0, repeticiones: 8, distancia_m: 100 },
    '«Dominadas en anillas» se apunta con repeticiones y carga. Sobra la distancia.',
  ],
  [
    'tiempo',
    'plancha',
    { duracion_s: 60, distancia_m: 100 },
    '«Plancha con lastre» se apunta por tiempo. Sobra la distancia.',
  ],
])(
  'la_distancia_en_un_ejercicio_que_no_es_de_cardio_da_422 (%s)',
  (_, ejercicio, medidas, mensaje) => {
    const { cliente, e } = escenario_con_cardio()

    const respuesta = apuntar(cliente, e, ejercicio, medidas)

    esperar_estado(respuesta, 422)
    expect(respuesta.json().detail).toBe(mensaje)
    expect(series_de(cliente, e)).toEqual([])
  },
)

test.each([
  [1, 201],
  [1_000_000, 201],
  [1_000_001, 422],
  [0, 422],
])('la_distancia_va_de_un_metro_a_mil_kilometros (%i, %i)', (distancia, codigo) => {
  const { cliente, e } = escenario_con_cardio()

  const respuesta = apuntar(cliente, e, 'cinta', { duracion_s: 600, distancia_m: distancia })

  esperar_estado(respuesta, codigo)
  if (codigo === 422) {
    expect(es_de_pydantic_por(respuesta, 'distancia_m')).toBe(true)
    expect(series_de(cliente, e)).toEqual([])
  }
})

test('una_distancia_que_no_es_un_entero_de_metros_da_422', () => {
  const { cliente, e } = escenario_con_cardio()

  const respuesta = apuntar(cliente, e, 'cinta', { duracion_s: 600, distancia_m: 5.5 })

  esperar_estado(respuesta, 422)
  expect(es_de_pydantic_por(respuesta, 'distancia_m')).toBe(true)
  expect(series_de(cliente, e)).toEqual([])
})

test('corregir_una_serie_de_cardio_cambia_la_distancia_y_la_quita_si_no_se_manda', () => {
  const { cliente, e } = escenario_con_cardio()
  const serie = apuntada(cliente, e, 'cinta', { duracion_s: 1200, distancia_m: 3000 })

  const cambiada = corregir(cliente, e, serie, 'cinta', { duracion_s: 1500, distancia_m: 4000 })

  esperar_estado(cambiada, 200)
  expect([cambiada.json().duracion_s, cambiada.json().distancia_m]).toEqual([1500, 4000])
  // El PUT es completo: sin distancia, queda nula.
  const sin = corregir(cliente, e, serie, 'cinta', { duracion_s: 1500 })
  esperar_estado(sin, 200)
  expect(sin.json().distancia_m).toBeNull()
  const [leida] = series_de(cliente, e)
  expect([leida.duracion_s, leida.distancia_m]).toEqual([1500, null])
})

test('pasar_una_serie_a_una_alternativa_de_cardio_y_volver_exige_las_medidas_de_cada_uno', () => {
  // Un hueco E de Press banca con Cinta de alternativa (cada uno con su objetivo). La serie
  // de press pasa a cinta: con peso y repeticiones, 422 de la cinta; con duración y
  // distancia, vale y el peso y las repeticiones quedan nulos. De vuelta a press con las
  // medidas de la cinta, 422 que dice todo lo que falta y todo lo que sobra.
  const { cliente, e } = escenario_con_cardio()
  const respuesta = cliente.post(`/rutinas/${e.rutina}/slots`, {
    json: {
      ejercicio_principal_id: e.ids.press,
      orden: 5,
      ...objetivo(3, [6, 10]),
      alternativas: [{ ejercicio_id: e.ids.cinta, ...objetivo(1, { duracion: [600, 900] }) }],
    },
  })
  esperar_estado(respuesta, 201)
  const hueco_e = respuesta.json().id
  const serie = apuntada(cliente, e, 'press', { peso: 60, repeticiones: 8 }, { slot_id: hueco_e })

  const con_reps = corregir(cliente, e, serie, 'cinta', { peso: 60, repeticiones: 8 })
  expect([con_reps.status_code, con_reps.json().detail]).toEqual([
    422,
    `${COMO_CARDIO}. Falta la duración y sobran el peso y las repeticiones.`,
  ])
  expect(series_de(cliente, e)).toEqual([serie])

  const a_cinta = corregir(cliente, e, serie, 'cinta', { duracion_s: 720, distancia_m: 2000 })
  esperar_estado(a_cinta, 200)
  expect(a_cinta.json().ejercicio_id).toBe(e.ids.cinta)
  expect(medidas_de(a_cinta.json())).toEqual({
    ...SIN_MEDIDAS,
    duracion_s: 720,
    distancia_m: 2000,
  })

  const a_press = corregir(cliente, e, a_cinta.json(), 'press', {
    duracion_s: 720,
    distancia_m: 2000,
  })
  expect([a_press.status_code, a_press.json().detail]).toEqual([
    422,
    '«Press banca» se apunta con peso y repeticiones. Faltan el peso y las repeticiones' +
      ' y sobran la duración y la distancia.',
  ])
  const [leida] = series_de(cliente, e)
  expect([leida.ejercicio_id, medidas_de(leida)]).toEqual([e.ids.cinta, medidas_de(a_cinta.json())])
})

test('el_historial_trae_la_distancia_de_una_serie_de_cardio', () => {
  const { cliente, e } = escenario_con_cardio()
  apuntada(cliente, e, 'cinta', { duracion_s: 1800, distancia_m: 5200 })
  apuntada(cliente, e, 'cinta', { duracion_s: 600 }, { numero: 2 })

  const respuesta = cliente.get(`/ejercicios/${e.ids.cinta}/historial`)

  esperar_estado(respuesta, 200)
  expect(respuesta.json()).toHaveLength(1)
  const [dia] = respuesta.json()
  expect(dia.series.map((s: any) => [s.duracion_s, s.distancia_m])).toEqual([
    [1800, 5200],
    [600, null],
  ])
  expect(dia.series.every((s: any) => s.peso === null && s.repeticiones === null)).toBe(true)
})
