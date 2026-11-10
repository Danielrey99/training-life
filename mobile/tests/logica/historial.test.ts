/**
 * Tests del historial de progresión de un ejercicio: `/ejercicios/{id}/historial`. Puerto de
 * `backend/tests/test_historial.py`.
 *
 * Lo que se prueba es la consulta de `servicios/historial.ts`: que la agrupación por sesión
 * no mezcla días ni entrenamientos, que `?limite=` recorta sesiones enteras (nunca series
 * sueltas), que `?hasta=` incluye ese día, que cruza rutinas y papeles (principal o comodín)
 * y que ocultar algo no esconde lo que se hizo.
 */
import {
  crear_ejercicio,
  crear_hueco,
  crear_rutina,
  entrenar as entrenar_en,
  esperar_estado,
  poner_alternativas,
  serie_en,
} from '../apoyo/ayudas'
import { type ClienteDeTest as Cliente, crearCliente } from '../apoyo/cliente'
import { grupo_muscular_id } from '../apoyo/conftest'

// --- Ayudantes para montar escenarios ------------------------------------

/** De la rutina que se diga o, si no, de una rutina de prueba. */
function crear_entrenamiento(cliente: Cliente, fecha: string, rutina_id?: number): number {
  const respuesta = entrenar_en(cliente, fecha, rutina_id)
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

function registrar_serie(
  cliente: Cliente,
  entrenamiento_id: number,
  ejercicio_id: number,
  numero_serie = 1,
  peso = 60,
  slot_id?: number,
): number {
  // Sin hueco que se diga, en uno de la rutina de la sesión con ese ejercicio.
  const campos = slot_id === undefined ? {} : { slot_id }
  const respuesta = serie_en(cliente, entrenamiento_id, ejercicio_id, {
    numero: numero_serie,
    peso,
    ...campos,
  })
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

/** Un día completo: la sesión y sus series, todas del mismo ejercicio/hueco. */
function entrenar(
  cliente: Cliente,
  fecha: string,
  ejercicio_id: number,
  rutina_id?: number,
  slot_id?: number,
  series = 1,
): number {
  const entrenamiento_id = crear_entrenamiento(cliente, fecha, rutina_id)
  for (let numero = 1; numero <= series; numero++) {
    registrar_serie(cliente, entrenamiento_id, ejercicio_id, numero, 60, slot_id)
  }
  return entrenamiento_id
}

/** Lo mínimo para tener historial: un ejercicio, una rutina y un hueco suyo. */
function escenario() {
  const entorno = crearCliente()
  const { cliente } = entorno
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const rutina_id = crear_rutina(cliente)
  const slot_id = crear_hueco(cliente, rutina_id, ejercicio_id)
  return { ...entorno, esc: { ejercicio_id, rutina_id, slot_id } }
}

function historial_de_ejercicio(
  cliente: Cliente,
  ejercicio_id: number,
  filtros: Record<string, number | string> = {},
): any[] {
  const respuesta = cliente.get(`/ejercicios/${ejercicio_id}/historial`, { params: filtros })
  esperar_estado(respuesta, 200)
  return respuesta.json()
}

// --- Agrupación por sesión -----------------------------------------------

test('las_series_de_cada_dia_salen_ordenadas_por_numero_de_serie', () => {
  // Se registran desordenadas a propósito: el orden lo pone la consulta, no el orden de
  // inserción.
  const { cliente, esc } = escenario()
  const entrenamiento_id = crear_entrenamiento(cliente, '2026-09-05', esc.rutina_id)
  for (const numero of [3, 1, 2]) {
    registrar_serie(cliente, entrenamiento_id, esc.ejercicio_id, numero, 60, esc.slot_id)
  }

  const historial = historial_de_ejercicio(cliente, esc.ejercicio_id)

  expect(historial[0].series.map((serie: any) => serie.numero_serie)).toEqual([1, 2, 3])
})

test('una_sesion_solo_trae_las_series_de_ese_ejercicio_no_el_entrenamiento_entero', () => {
  // El mismo día se hicieron dos ejercicios: el historial de uno no puede arrastrar las
  // series del otro.
  const { cliente, esc } = escenario()
  const otro_ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Fondos')
  const entrenamiento_id = crear_entrenamiento(cliente, '2026-09-05', esc.rutina_id)
  registrar_serie(cliente, entrenamiento_id, esc.ejercicio_id, 1, 60, esc.slot_id)
  registrar_serie(cliente, entrenamiento_id, otro_ejercicio_id, 2)

  const historial = historial_de_ejercicio(cliente, esc.ejercicio_id)

  expect(historial).toHaveLength(1)
  expect(historial[0].series.map((serie: any) => serie.numero_serie)).toEqual([1])
})

test('el_mismo_ejercicio_en_dos_huecos_junta_en_su_historial_las_series_de_ambos', () => {
  // Un ejercicio puede ocupar dos huecos de la misma rutina. Su historial junta las series
  // de ambos, y cada una dice de qué hueco es.
  const { cliente, esc } = escenario()
  const segundo_slot_id = crear_hueco(cliente, esc.rutina_id, esc.ejercicio_id, { orden: 2 })
  const entrenamiento_id = crear_entrenamiento(cliente, '2026-09-05', esc.rutina_id)
  registrar_serie(cliente, entrenamiento_id, esc.ejercicio_id, 1, 60, esc.slot_id)
  registrar_serie(cliente, entrenamiento_id, esc.ejercicio_id, 1, 25, segundo_slot_id)

  const del_ejercicio = historial_de_ejercicio(cliente, esc.ejercicio_id)

  expect(del_ejercicio).toHaveLength(1)
  expect(
    del_ejercicio[0].series
      .map((serie: any) => Number(serie.peso))
      .sort((a: number, b: number) => a - b),
  ).toEqual([25.0, 60.0])

  // Las dos series numeran desde 1, así que sin el slot_id no habría forma de saber cuál
  // pertenece a cada hueco.
  const por_hueco = Object.fromEntries(
    del_ejercicio[0].series.map((serie: any) => [serie.slot_id, Number(serie.peso)]),
  )
  expect(por_hueco).toEqual({ [esc.slot_id]: 60.0, [segundo_slot_id]: 25.0 })
})

// --- La "última vez" de un ejercicio -------------------------------------
//
// Al entrenar se compara con la última vez que se hizo ESE ejercicio, no con la última
// sesión del hueco: si la semana pasada tocó el comodín, sus pesos no sirven de referencia
// para el principal.

/**
 * El escenario de siempre, con un comodín en el hueco y tres días: el principal el 1, el
 * comodín el 8 y otra vez el principal el 15.
 */
function hueco_con_comodin() {
  const entorno = escenario()
  const { cliente, esc } = entorno
  const comodin_id = crear_ejercicio(
    cliente,
    grupo_muscular_id(cliente),
    'Press banca en máquina convergente',
  )
  poner_alternativas(cliente, esc.rutina_id, esc.slot_id, [comodin_id])
  for (const [fecha, ejercicio_id] of [
    ['2026-09-01', esc.ejercicio_id],
    ['2026-09-08', comodin_id],
    ['2026-09-15', esc.ejercicio_id],
  ] as const) {
    entrenar(cliente, fecha, ejercicio_id, esc.rutina_id, esc.slot_id)
  }
  return { ...entorno, esc: { ...esc, comodin_id } }
}

test('la_ultima_vez_de_un_ejercicio_cruza_rutinas_y_papeles', () => {
  // La consulta con la que la sesión compara cada ejercicio: su historial hasta el día de la
  // sesión, dos días (uno puede ser la propia sesión), en la rutina que fuera y fuera
  // principal o alternativa.
  //
  // El press del escenario es principal en Push y alternativa en Pull; se hizo en Pull el 10
  // y hoy, el 15, otra vez en Push. La última vez antes de hoy es la de Pull, aunque en Push
  // la última fuera el 1 (el 8 tocó el comodín).
  const { cliente, esc } = hueco_con_comodin()
  const press = esc.ejercicio_id
  const pull = crear_rutina(cliente, 'Pull')
  const remo = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Remo')
  const hueco_de_pull = crear_hueco(cliente, pull, remo)
  poner_alternativas(cliente, pull, hueco_de_pull, [press])
  const en_pull = entrenar(cliente, '2026-09-10', press, pull, hueco_de_pull)
  const hoy_en_push = historial_de_ejercicio(cliente, press, { hasta: '2026-09-15', limite: 1 })[0]

  const ultima_vez = historial_de_ejercicio(cliente, press, { hasta: '2026-09-15', limite: 2 })

  expect(ultima_vez.map((s) => [s.entrenamiento_id, s.fecha, s.rutina])).toEqual([
    [hoy_en_push.entrenamiento_id, '2026-09-15', 'Push'],
    [en_pull, '2026-09-10', 'Pull'],
  ])
  expect(ultima_vez[1].series.map((serie: any) => serie.slot_id)).toEqual([hueco_de_pull])
  // Con `hasta` en el día de Pull, ese día sale: `hasta` incluye su día.
  expect(
    historial_de_ejercicio(cliente, press, { hasta: '2026-09-10' }).map((s) => s.fecha),
  ).toEqual(['2026-09-10', '2026-09-01'])
})

// --- El límite cuenta sesiones, no series --------------------------------

test('el_limite_devuelve_sesiones_completas_no_series_sueltas', () => {
  // `?limite=2` con días de 3 y 2 series debe dar 2 días enteros (5 series), no las 2 series
  // más recientes: cortar por series partiría un día por la mitad. Cada día es una entrada,
  // con sus series y su rutina, del más reciente al más antiguo.
  const { cliente, esc } = escenario()
  for (const [fecha, series] of [
    ['2026-09-01', 3],
    ['2026-09-03', 2],
    ['2026-09-05', 3],
  ] as const) {
    entrenar(cliente, fecha, esc.ejercicio_id, esc.rutina_id, esc.slot_id, series)
  }

  const historial = historial_de_ejercicio(cliente, esc.ejercicio_id, { limite: 2 })

  expect(historial.map((sesion) => sesion.fecha)).toEqual(['2026-09-05', '2026-09-03'])
  expect(historial.map((sesion) => sesion.series.length)).toEqual([3, 2])
  expect(historial.map((sesion) => sesion.rutina)).toEqual(['Push', 'Push'])
})

test('el_limite_recorta_despues_de_filtrar_por_fecha_no_antes', () => {
  // Con `hasta=` puesto, `limite=1` debe dar la sesión más reciente *hasta ese día,
  // incluido*, no la más reciente de todas descartada luego por la fecha. (El historial no
  // tiene `desde`: las pantallas solo piden hasta un día.)
  const { cliente, esc } = escenario()
  for (const fecha of ['2026-09-01', '2026-09-03', '2026-09-05']) {
    entrenar(cliente, fecha, esc.ejercicio_id, esc.rutina_id, esc.slot_id, 1)
  }

  const historial = historial_de_ejercicio(cliente, esc.ejercicio_id, {
    hasta: '2026-09-03',
    limite: 1,
  })

  expect(historial.map((sesion) => sesion.fecha)).toEqual(['2026-09-03'])
})

// --- Historial de lo que se ha ocultado ----------------------------------
//
// `?modo=ocultar` existe precisamente para conservar el historial («deja de aparecer para
// entrenamientos nuevos, pero el historial existente queda intacto»). Si al ocultar algo su
// historial deja de poder consultarse, ese historial se conserva en la base pero es
// inalcanzable por la API: el mismo agujero que ya obligó a añadir `?ocultos=true` y
// `POST /{id}/mostrar`.

test('ocultar_el_ejercicio_su_hueco_y_su_rutina_no_esconde_su_historial', () => {
  // Ocultar un ejercicio es lo que se hace con la máquina que ya no se usa, y retirar un
  // hueco o la rutina entera (`Push v1`), el caso más habitual de ocultar: justo cuando más
  // interesa mirar atrás lo que se levantó. El día sigue saliendo, con sus series y el
  // nombre de su rutina.
  const { cliente, esc } = escenario()
  entrenar(cliente, '2026-09-05', esc.ejercicio_id, esc.rutina_id, esc.slot_id, 2)
  const ruta_del_hueco = `/rutinas/${esc.rutina_id}/slots/${esc.slot_id}`
  for (const ruta of [
    `/ejercicios/${esc.ejercicio_id}`,
    ruta_del_hueco,
    `/rutinas/${esc.rutina_id}`,
  ]) {
    expect(cliente.delete(`${ruta}?modo=ocultar`).status_code).toBe(204)
  }

  const historial = historial_de_ejercicio(cliente, esc.ejercicio_id)

  expect(historial.map((sesion) => [sesion.fecha, sesion.rutina])).toEqual([['2026-09-05', 'Push']])
  expect(historial[0].series).toHaveLength(2)
})

// --- Los valores admitidos de `?limite=` ---------------------------------

test.each([
  [0, 422],
  [1, 200],
  [500, 200],
  [501, 422],
])('el_limite_va_de_1_a_500_sesiones (%i, %i)', (limite, codigo) => {
  const { cliente, esc } = escenario()

  const respuesta = cliente.get(`/ejercicios/${esc.ejercicio_id}/historial`, {
    params: { limite },
  })

  expect(respuesta.status_code).toBe(codigo)
  if (codigo === 422) {
    expect(respuesta.json().detail.map((e: any) => e.loc)).toEqual([['query', 'limite']])
  }
})
