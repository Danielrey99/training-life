/**
 * Tests de la sesión en curso: `terminada_en`, `en_curso`, `POST .../terminar`, los filtros
 * del listado y la regla de una sesión por día. Puerto de `backend/tests/test_sesiones.py`.
 *
 * «En curso» depende de qué día es hoy, así que todo el archivo congela el reloj en `HOY`.
 */
import type { Contexto, Reloj } from '../../src/logica/contexto'
import { hoyEn } from '../../src/logica/reglas/zonas'
import {
  canceladaSql,
  enCurso,
  enCursoSql,
  estaCancelada,
  type FilaEntrenamiento,
} from '../../src/logica/servicios/seguimiento'
import {
  crear_ejercicio,
  crear_rutina,
  en_texto,
  esperar_estado,
  entrenar,
  rango_invertido,
  serie_en,
  todavia_no_ha_llegado,
} from '../apoyo/ayudas'
import { ClienteDeTest, ZONA, crearCliente } from '../apoyo/cliente'
import { ejercicio_predefinido_id, grupo_muscular_id } from '../apoyo/conftest'
import { HOY, con_una_serie } from '../apoyo/semana'

/** El día de `iso` desplazado `dias` (el `timedelta` de Python). */
function mas_dias(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10)
}

const AYER = mas_dias(HOY, -1)

/** Una instalación nueva con el reloj congelado en `HOY` (la fixture `reloj_congelado`). */
function entorno() {
  const e = crearCliente()
  e.reloj.fijar(HOY)
  return e
}

function empezar(cliente: ClienteDeTest, fecha: string = HOY): any {
  const respuesta = entrenar(cliente, fecha)
  esperar_estado(respuesta, 201)
  return respuesta.json()
}

function terminar(cliente: ClienteDeTest, entrenamiento_id: number): any {
  const respuesta = cliente.post(`/entrenamientos/${entrenamiento_id}/terminar`)
  esperar_estado(respuesta, 200)
  return respuesta.json()
}

// --- En curso y terminada ------------------------------------------------

test('terminar_la_saca_de_en_curso_y_terminar_dos_veces_conserva_la_primera_hora', () => {
  // `terminada_en` es un instante con su zona, el del reloj de la app. En el backend es el
  // real aunque el día esté congelado; en el móvil el reloj de los tests da los dos.
  const { cliente } = entorno()
  const empezada = empezar(cliente)
  expect([empezada.terminada_en, empezada.en_curso]).toEqual([null, true])

  const primera = terminar(cliente, empezada.id)
  const segunda = terminar(cliente, empezada.id)

  expect(primera.terminada_en).toMatch(/(Z|[+-]\d\d:\d\d)$/)
  expect(Number.isNaN(Date.parse(primera.terminada_en))).toBe(false)
  expect(hoyEn(ZONA, new Date(primera.terminada_en))).toBe(HOY)
  expect(primera.en_curso).toBe(false)
  expect(segunda.terminada_en).toBe(primera.terminada_en)
})

test('una_sesion_de_ayer_sin_terminar_no_esta_en_curso', () => {
  // Una sesión que se quedó abierta de un día para otro cuenta como terminada, sin que
  // nadie tenga que cerrarla.
  const { cliente } = entorno()

  const sesion = empezar(cliente, AYER)

  expect(sesion.terminada_en).toBeNull()
  expect(sesion.en_curso).toBe(false)
})

test('una_sesion_terminada_admite_mas_series', () => {
  // Terminada no es cerrada: corregir un día ya pasado añade o cambia series.
  const { cliente } = entorno()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const sesion_id = terminar(cliente, empezar(cliente).id).id

  const respuesta = serie_en(cliente, sesion_id, ejercicio_id)

  expect(respuesta.status_code).toBe(201)
})

// --- Una sesión por día --------------------------------------------------

test('con_una_sesion_en_curso_no_se_puede_empezar_otra_hoy', () => {
  const { cliente } = entorno()
  const abierta = empezar(cliente)

  const respuesta = entrenar(cliente, HOY)

  expect(respuesta.status_code).toBe(409)
  // Dice cuál es y que está en curso, para que la pantalla ofrezca continuarla.
  expect(respuesta.json().detail).toEqual({
    mensaje: 'Ya hay una sesión en curso hoy. Termínala o cancélala antes de empezar otra.',
    entrenamiento_id: abierta.id,
    en_curso: true,
  })
  expect(
    cliente
      .get('/entrenamientos')
      .json()
      .map((s: any) => s.id),
  ).toEqual([abierta.id])
})

test('terminada_la_sesion_de_hoy_no_se_puede_empezar_otra', () => {
  // Se entrena una rutina al día: terminar la de hoy no deja el día libre.
  const { cliente } = entorno()
  const sesion = empezar(cliente)
  con_una_serie(cliente, grupo_muscular_id(cliente), sesion.id)
  terminar(cliente, sesion.id)

  const respuesta = entrenar(cliente, HOY)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual({
    mensaje:
      'Ese día ya tiene una sesión, y se entrena una rutina al día. Para usarlo,' +
      ' cambia antes la fecha de la otra desde su día en el historial.',
    entrenamiento_id: sesion.id,
    en_curso: false,
  })
  expect(
    cliente
      .get('/entrenamientos')
      .json()
      .map((s: any) => s.id),
  ).toEqual([sesion.id])
})

test('una_sesion_de_hoy_terminada_sin_series_no_ocupa_el_dia', () => {
  // Sin nada hecho cuenta como cancelada: el día queda libre y se borra al empezar otra.
  const { cliente } = entorno()
  const vacia = terminar(cliente, empezar(cliente).id)

  expect(entrenar(cliente, HOY).status_code).toBe(201)
  expect(cliente.get(`/entrenamientos/${vacia.id}`).status_code).toBe(404)
})

test('una_sesion_pasada_sin_series_no_ocupa_su_dia', () => {
  const { cliente } = entorno()
  const vacia = empezar(cliente, AYER)

  expect(entrenar(cliente, AYER).status_code).toBe(201)
  expect(cliente.get(`/entrenamientos/${vacia.id}`).status_code).toBe(404)
})

test('una_sesion_abierta_solo_ocupa_su_dia', () => {
  // Una de ayer sin terminar no impide empezar la de hoy, y con la de hoy en curso se
  // puede apuntar otro día pasado: registrar lo que se hizo no es empezar a entrenar.
  const { cliente } = entorno()
  empezar(cliente, AYER)

  expect(entrenar(cliente, HOY).status_code).toBe(201)
  expect(entrenar(cliente, mas_dias(AYER, -1)).status_code).toBe(201)
})

test('no_se_puede_mover_una_sesion_al_dia_de_una_en_curso', () => {
  // La de hoy está vacía, pero en curso: ocupa el día. El 409 dice cuál es. Con una que no
  // está en curso, en `con_el_dia_nuevo_ocupado_da_409_y_no_guarda_nada`.
  const { cliente } = entorno()
  const de_hoy = empezar(cliente)
  const de_ayer = empezar(cliente, AYER)
  con_una_serie(cliente, grupo_muscular_id(cliente), de_ayer.id)

  const respuesta = cliente.put(`/entrenamientos/${de_ayer.id}`, { json: { fecha: HOY } })

  expect(respuesta.status_code).toBe(409)
  // El aviso habla de la sesión que se mueve y va bajo la fecha.
  expect(respuesta.json().detail).toEqual({
    mensaje:
      `El ${en_texto(HOY)} ya tiene una sesión empezada, y solo se hace una por` +
      ' día. Termínala o cancélala desde la pestaña Entrenar antes de mover esta.',
    campo: 'fecha',
    entrenamiento_id: de_hoy.id,
    en_curso: true,
  })
  expect(cliente.get(`/entrenamientos/${de_ayer.id}`).json().fecha).toBe(AYER)
})

test('mover_una_sesion_al_dia_de_una_cancelada_borra_la_cancelada', () => {
  // Una sesión sin series de un día pasado está cancelada y no ocupa su fecha, tampoco al
  // corregir la fecha de otra: se borra para dejar sitio, como al crear una nueva (y no
  // sale el error de la restricción de la fecha única).
  const { cliente } = entorno()
  const cancelada = empezar(cliente, AYER)
  const otra = empezar(cliente, mas_dias(AYER, -1))
  con_una_serie(cliente, grupo_muscular_id(cliente), otra.id)

  const respuesta = cliente.put(`/entrenamientos/${otra.id}`, { json: { fecha: AYER } })

  esperar_estado(respuesta, 200)
  expect(respuesta.json().fecha).toBe(AYER)
  expect(respuesta.json().series).toHaveLength(1)
  expect(cliente.get(`/entrenamientos/${cancelada.id}`).status_code).toBe(404)
})

test('editar_la_propia_sesion_en_curso_no_choca_consigo_misma', () => {
  const { cliente } = entorno()
  const sesion = empezar(cliente)

  const respuesta = cliente.put(`/entrenamientos/${sesion.id}`, {
    json: { fecha: HOY, notas: 'Buen día' },
  })

  esperar_estado(respuesta, 200)
  expect(respuesta.json().notas).toBe('Buen día')
})

// --- Filtros del listado -------------------------------------------------

test('el_listado_sin_terminar_da_las_de_dias_pasados_abiertas_con_series_o_vacias', () => {
  // Las de un día pasado que se quedaron sin terminar: las que tienen algo apuntado (quizá
  // se dejaron a medias) y también las vacías (quizá se abrieron para apuntar un día pasado
  // y se olvidaron; E1 las marca como *vacía*). Antes las vacías no salían. Ni la de hoy
  // (sigue en curso) ni las terminadas. De la más reciente a la más antigua.
  const { cliente, bd } = entorno()
  const ejercicio_predefinido = ejercicio_predefinido_id(bd)

  const con_serie = (sesion: any) => {
    serie_en(cliente, sesion.id, ejercicio_predefinido, { peso: 40, repeticiones: 10 })
    return sesion
  }

  const a_medias = con_serie(empezar(cliente, AYER))
  terminar(cliente, con_serie(empezar(cliente, mas_dias(HOY, -2))).id)
  const vacia = empezar(cliente, mas_dias(HOY, -3))
  con_serie(empezar(cliente))

  const respuesta = cliente.get('/entrenamientos', { params: { sin_terminar: true } })

  expect(respuesta.json().map((sesion: any) => sesion.id)).toEqual([a_medias.id, vacia.id])
  expect(respuesta.json()[1].series).toEqual([])
})

test('el_listado_sin_terminar_no_da_la_vacia_terminada_ni_la_vacia_de_hoy', () => {
  const { cliente } = entorno()
  terminar(cliente, empezar(cliente, AYER).id)
  empezar(cliente)

  expect(cliente.get('/entrenamientos', { params: { sin_terminar: true } }).json()).toEqual([])
})

test('cancelada_y_en_curso_dicen_lo_mismo_en_sql_que_en_python', () => {
  // `canceladaSql` y `enCursoSql` (para un WHERE) van en pareja con `estaCancelada` y
  // `enCurso`. Si una regla cambia y la otra no, borrar una rutina, el aviso y el
  // seguimiento dirían cosas distintas de la misma sesión. Se comparan con todos los casos:
  // con y sin series, de hoy y de días pasados, terminadas y sin terminar.
  //
  // Son seis, pero la de hoy abierta y vacía y la de hoy terminada y vacía no caben a la vez
  // (una sesión al día): se compara con la de hoy abierta, se termina y se vuelve a comparar.
  const { cliente, reloj, bd } = entorno()
  const ctx: Contexto = { bd, reloj, zona: () => ZONA }
  const ejercicio_predefinido = ejercicio_predefinido_id(bd)

  const ids_donde = (c: { sql: string; params: any[] }): Set<number> =>
    new Set(
      bd
        .todas<{ id: number }>(`SELECT id FROM entrenamientos WHERE ${c.sql}`, ...c.params)
        .map((f) => f.id),
    )

  const comparar = (): [Set<number>, Set<number>] => {
    const sesiones = bd.todas<FilaEntrenamiento>('SELECT * FROM entrenamientos')
    const canceladas = ids_donde(canceladaSql(ctx))
    const en_curso = ids_donde(enCursoSql(ctx))
    expect(sesiones).toHaveLength(5)
    expect(canceladas).toEqual(
      new Set(sesiones.filter((s) => estaCancelada(ctx, s)).map((s) => s.id)),
    )
    expect(en_curso).toEqual(new Set(sesiones.filter((s) => enCurso(ctx, s)).map((s) => s.id)))
    // Que la comparación no sea trivial: hay sesiones de las dos clases.
    expect(canceladas.size).toBeGreaterThan(0)
    expect(canceladas.size).toBeLessThan(sesiones.length)
    return [canceladas, en_curso]
  }

  const ids: Record<number, number> = {}
  for (const [dias_atras, series, terminada] of [
    [0, false, false],
    [1, false, false],
    [2, false, true],
    [3, true, false],
    [4, true, true],
  ] as const) {
    const sesion = empezar(cliente, mas_dias(HOY, -dias_atras))
    ids[dias_atras] = sesion.id
    if (series) serie_en(cliente, sesion.id, ejercicio_predefinido)
    if (terminada) terminar(cliente, sesion.id)
  }

  // Con la de hoy abierta y vacía: en curso, no cancelada.
  const antes = comparar()
  expect(antes[1]).toEqual(new Set([ids[0]]))
  expect(antes[0].has(ids[0])).toBe(false)

  // Con la de hoy terminada y vacía: ya no está en curso, así que es cancelada.
  terminar(cliente, ids[0])
  const despues = comparar()
  expect(despues[1]).toEqual(new Set())
  expect(despues[0].has(ids[0])).toBe(true)
})

test('el_listado_por_rutina_con_limite_da_sus_ultimas_sesiones', () => {
  // Lo que usa el día del historial para comparar su volumen con la sesión anterior de la
  // misma rutina, sin pedir todo el historial.
  const { cliente } = entorno()
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')

  const sesion = (rutina_id: number, dias_atras: number): number => {
    const fecha = mas_dias(HOY, -dias_atras)
    const respuesta = cliente.post('/entrenamientos', { json: { fecha, rutina_id } })
    esperar_estado(respuesta, 201)
    return respuesta.json().id
  }

  const antigua = sesion(push, 9)
  sesion(pull, 5)
  const reciente = sesion(push, 2)

  const todas = cliente.get('/entrenamientos', { params: { rutina_id: push } }).json()
  const una = cliente.get('/entrenamientos', { params: { rutina_id: push, limite: 1 } }).json()

  expect(todas.map((s: any) => s.id)).toEqual([reciente, antigua])
  expect(una.map((s: any) => s.id)).toEqual([reciente])
})

test('el_listado_filtra_por_rango_de_fechas_incluidos_los_extremos', () => {
  const { cliente } = entorno()
  for (const dias of [0, 1, 2, 3]) empezar(cliente, mas_dias(HOY, -(dias + 10)))

  const respuesta = cliente.get('/entrenamientos', {
    params: { desde: mas_dias(HOY, -12), hasta: mas_dias(HOY, -11) },
  })

  const fechas = respuesta.json().map((sesion: any) => sesion.fecha)
  expect(fechas).toEqual([mas_dias(HOY, -11), mas_dias(HOY, -12)])
})

test('el_listado_con_el_rango_invertido_da_422', () => {
  const { cliente } = entorno()

  const respuesta = cliente.get('/entrenamientos', { params: { desde: HOY, hasta: AYER } })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(rango_invertido(HOY, AYER))
})

// --- El futuro no se registra --------------------------------------------

test('no_se_puede_apuntar_un_entrenamiento_en_el_futuro', () => {
  // El futuro se planifica, no se apunta. Y una sesión de mañana sin terminar pasaría sola
  // a estar en curso al llegar el día, sin que nadie la empezara.
  const { cliente } = entorno()
  const manana = mas_dias(HOY, 1)

  const respuesta = entrenar(cliente, manana)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(todavia_no_ha_llegado(manana))
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

// --- "Hoy" es el de Madrid, no el del servidor ----------------------------
//
// Entre medianoche y la 1 o las 2 de la madrugada (según el horario de verano), en España
// ya es el día siguiente y en UTC todavía no: si «hoy» saliera de la fecha en UTC, la
// sesión de las 00:30 quedaría en el día anterior o se rechazaría por «futura». Se usa un
// reloj parado en uno de esos instantes, que saca «hoy» como lo hace el del teléfono.

// 30 de junio de 2025, 22:30 en UTC = 1 de julio, 00:30 en Madrid (CEST, UTC+2). Lejos de la
// fecha real a propósito: si «hoy» dejara de pasar por la zona de Madrid, estos tests no
// podrían acertar por casualidad.
const INSTANTE_UTC = new Date(Date.UTC(2025, 5, 30, 22, 30))

class RelojDeLaMadrugada implements Reloj {
  hoy(): string {
    return hoyEn(ZONA, INSTANTE_UTC)
  }

  ahora(): string {
    return INSTANTE_UTC.toISOString()
  }
}

test('a_las_00_30_en_espana_se_empieza_la_sesion_del_dia_nuevo', () => {
  // Ni «futura» (422) ni en el día anterior: es la sesión en curso de hoy.
  const { bd } = crearCliente()
  const cliente = new ClienteDeTest({ bd, reloj: new RelojDeLaMadrugada(), zona: () => ZONA })

  const respuesta = entrenar(cliente, '2025-07-01')

  expect(respuesta.status_code).toBe(201)
  expect(respuesta.json().en_curso).toBe(true)
  const manana = entrenar(cliente, '2025-07-02')
  expect(manana.status_code).toBe(422)
  // Sin año: «hoy» es de 2025, el año que manda es el de «hoy» y no el del reloj real.
  expect(manana.json().detail).toBe(
    'El miércoles 2 de julio todavía no ha llegado. Solo se apuntan días de hoy hacia atrás.',
  )
})
