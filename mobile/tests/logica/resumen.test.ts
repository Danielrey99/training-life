/**
 * La pantalla de resumen: `GET /resumen?mes=AAAA-MM`. Puerto de `backend/tests/test_resumen.py`.
 *
 * Dos cosas que calcula: la gráfica de volumen, por semana y por mes, y la constancia del año
 * del mes pedido. Cada vista trae ocho barras terminadas (una semana o un mes a medias no se
 * compara con uno entero) y, si el periodo de hoy cae en la ventana del mes pedido, la barra en
 * curso con lo que va de él. Cada barra lleva su cambio sobre el último periodo anterior con
 * volumen, aunque quede fuera de la gráfica (`comparado_con`), y su desglose (volumen por
 * rutina y series por grupo muscular). No hay filtros de rutina.
 *
 * Casi todos congelan el reloj con `hoy_es`. Fechas de referencia: el 16 de septiembre de 2026
 * es miércoles; el 1 de octubre, jueves; el 6 de octubre, martes. Pidiendo septiembre el 6 de
 * octubre, las semanas van del lunes 10 de agosto al domingo 4 de octubre y los meses de
 * febrero a septiembre, sin barra en curso; pidiendo octubre ese día, las mismas barras
 * terminadas y, en curso, la semana del 5 al 11 de octubre y el mes de octubre.
 *
 * No se porta `siempre_hace_las_mismas_consultas` (va en `no_aplica.ts`: cuenta consultas de
 * SQLAlchemy). Al final, los tests propios del móvil: el redondeo del cambio (`cambioEnPorCiento`,
 * con enteros) y `sumarMeses`.
 */
import {
  diasDelMes,
  componer,
  partes,
  sumarDias,
  diaDeLaSemana,
} from '../../src/logica/reglas/dias'
import { cambioEnPorCiento, sumarMeses } from '../../src/logica/servicios/resumen'
import {
  crear_ejercicio,
  crear_hueco,
  crear_rutina,
  ejercicio_de_prueba,
  esperar_estado,
  ocultar_ejercicio,
  poner_alternativas,
  serie_en,
  sesiones_en_curso,
} from '../apoyo/ayudas'
import { crearCliente, type Entorno } from '../apoyo/cliente'
import { grupo_muscular_id as grupoMuscular, ppl as montarPpl } from '../apoyo/conftest'
import { HOY, LUNES_14, LUNES_7, MARTES_15, VIERNES_18 } from '../apoyo/semana'

const SEPTIEMBRE = '2026-09'
const OCTUBRE = '2026-10'
const MARTES_6_OCT = '2026-10-06'
// La primera semana de la gráfica pidiendo septiembre u octubre el 6 de octubre.
const LUNES_10_AGO = '2026-08-10'

type Par = [number | null, number | null]

let entorno: Entorno
let cliente: Entorno['cliente']
let grupo_muscular_id: number

beforeEach(() => {
  entorno = crearCliente()
  cliente = entorno.cliente
  grupo_muscular_id = grupoMuscular(cliente)
})

function hoy_es(fecha: string): void {
  entorno.reloj.fijar(fecha)
}

/** Un ejercicio de peso y repeticiones llamado «Press banca» (la fixture `ejercicio_id`). */
function ejercicio_id(): number {
  return ejercicio_de_prueba(cliente, grupo_muscular_id, 'Press banca')
}

function ppl(): Record<string, number> {
  return montarPpl(cliente, entorno.reloj)
}

// --- Ayudas -----------------------------------------------------------------

/** El resumen del mes (o el de hoy, sin `mes`); falla si no da 200. */
function pedir(mes?: string): any {
  const respuesta = cliente.get('/resumen', { params: mes ? { mes } : {} })
  esperar_estado(respuesta, 200)
  return respuesta.json()
}

/**
 * Una sesión con sus series, cada una `[peso, repeticiones]`. Devuelve su id. `campos` pasa a
 * cada serie (por ejemplo, `slot_id` para apuntarla a un comodín), salvo `cubre_fecha`, que es
 * de la sesión.
 */
function sesion_con_series(
  fecha: string,
  rutina_id: number,
  ejercicio: number,
  series: Par[],
  campos: Record<string, unknown> = {},
): number {
  const { cubre_fecha, ...de_serie } = campos
  const cuerpo: Record<string, unknown> = { rutina_id, fecha }
  if (cubre_fecha !== undefined && cubre_fecha !== null) cuerpo.cubre_fecha = cubre_fecha
  const respuesta = cliente.post('/entrenamientos', { json: cuerpo })
  esperar_estado(respuesta, 201)
  const entrenamiento_id = respuesta.json().id
  series.forEach(([peso, repeticiones], i) => {
    esperar_estado(
      serie_en(cliente, entrenamiento_id, ejercicio, {
        numero: i + 1,
        peso,
        repeticiones,
        ...de_serie,
      }),
      201,
    )
  })
  return entrenamiento_id
}

/** Los volúmenes de las barras terminadas (sin la en curso). */
function volumenes(evolucion: any): number[] {
  return evolucion.periodos.map((periodo: any) => Number(periodo.volumen))
}

/** El `desde` y el `hasta` de las barras terminadas (sin la en curso). */
function fechas(evolucion: any): [string, string][] {
  return evolucion.periodos.map((periodo: any) => [periodo.desde, periodo.hasta])
}

function todas_las_barras(evolucion: any): any[] {
  return evolucion.en_curso ? [...evolucion.periodos, evolucion.en_curso] : evolucion.periodos
}

/** La barra que empieza en `desde`, terminada o en curso. */
function barra(evolucion: any, desde: string): any {
  return todas_las_barras(evolucion).find((periodo) => periodo.desde === desde)
}

/** `[cambio, comparado_con]` de una barra. */
function cambio(periodo: any): [number | null, string | null] {
  return [periodo.cambio, periodo.comparado_con]
}

function por_rutina(periodo: any): [string, string][] {
  return periodo.volumen_por_rutina.map((fila: any) => [fila.rutina.nombre, fila.volumen])
}

function por_grupo(periodo: any): [number, number][] {
  return periodo.series_por_grupo.map((fila: any) => [fila.grupo_muscular.id, fila.series])
}

function ultimo_dia(primero: string): string {
  const { anio, mes } = partes(primero)!
  return componer(anio, mes, diasDelMes(anio, mes))
}

/** Lo mismo que `sorted(...)` de Python sobre `[id, series]`. */
function ordenados(pares: [number, number][]): [number, number][] {
  return [...pares].sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** Una suma de volúmenes sin la deriva de la coma flotante (a centésimas). */
function centesimas(n: number): number {
  return Math.round(n * 100)
}

// --- El parámetro `mes` -----------------------------------------------------

test.each(['2026-13', '2026-00', '2026-9', '1999-01', '2100-01', '2026-09-01'])(
  // El formato es `AAAA-MM`, con años de 2000 a 2099: más allá, restar meses para la
  // ventana se saldría del calendario.
  'un_mes_mal_escrito_da_422 (%s)',
  (mes) => {
    hoy_es(HOY)

    const respuesta = cliente.get(`/resumen?mes=${mes}`)

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail.map((e: any) => e.loc)).toEqual([['query', 'mes']])
  },
)

test.each([
  ['2026-10', 'Octubre de 2026'],
  ['2027-01', 'Enero de 2027'],
])('un_mes_que_no_ha_llegado_da_422_con_su_mensaje (%s)', (mes, nombre) => {
  hoy_es('2026-09-30')

  const respuesta = cliente.get('/resumen', { params: { mes } })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toBe(
    `${nombre} todavía no ha llegado. El resumen es de lo ya entrenado.`,
  )
})

test('el_primer_mes_admitido_no_se_sale_del_calendario', () => {
  // Enero de 2000 resta siete meses y llega a 1999 para la gráfica mensual.
  hoy_es(HOY)

  const datos = pedir('2000-01')

  expect(fechas(datos.por_mes)[0]).toEqual(['1999-06-01', '1999-06-30'])
})

test('sin_mes_es_el_de_hoy', () => {
  hoy_es(HOY)

  expect(pedir()).toEqual(pedir(SEPTIEMBRE))
  expect(pedir().mes).toBe('2026-09-01')
})

test('sin_datos_todo_sale_a_cero', () => {
  // El 16 de septiembre, pidiendo septiembre: hay barra en curso en las dos vistas, y sale
  // aunque esté vacía. Con solo periodos terminados, `completo` sobra (decisión del autor), y
  // sin filtros de rutina la evolución no lleva `rutina_id`: se fijan las claves de la vista y
  // de cada barra.
  hoy_es(HOY)

  const datos = pedir()

  expect(Object.keys(datos).sort()).toEqual(['constancia', 'mes', 'por_mes', 'por_semana'])
  const en_curso: Record<string, [string, string]> = {
    por_semana: ['2026-09-14', '2026-09-20'],
    por_mes: ['2026-09-01', '2026-09-30'],
  }
  for (const clave of Object.keys(en_curso)) {
    const vista = datos[clave]
    expect(Object.keys(vista).sort()).toEqual(['en_curso', 'periodos'])
    expect(vista.periodos).toHaveLength(8)
    expect([vista.en_curso.desde, vista.en_curso.hasta]).toEqual(en_curso[clave])
    for (const periodo of todas_las_barras(vista)) {
      expect(Object.keys(periodo).sort()).toEqual(
        [
          'desde',
          'hasta',
          'volumen',
          'cambio',
          'comparado_con',
          'volumen_por_rutina',
          'series_por_grupo',
        ].sort(),
      )
      expect(periodo.volumen).toBe('0.00')
      expect([periodo.cambio, periodo.comparado_con]).toEqual([null, null])
      expect(periodo.volumen_por_rutina).toEqual([])
      expect(periodo.series_por_grupo).toEqual([])
    }
  }
  const constancia = datos.constancia
  expect(constancia.meses.map((m: any) => m.mes)).toEqual(
    Array.from({ length: 12 }, (_, i) => componer(2026, i + 1, 1)),
  )
  expect(
    constancia.meses.every(
      (m: any) => m.entrenados === 0 && m.planificados === 0 && m.por_llegar === 0,
    ),
  ).toBe(true)
  expect([constancia.entrenados, constancia.planificados]).toEqual([0, 0])
})

// --- Las ventanas: ocho terminadas y la en curso ----------------------------

test.each([
  [
    'mes-actual:-la-ultima-semana-acabada-y-el-mes-anterior',
    HOY,
    SEPTIEMBRE,
    LUNES_7,
    '2026-01-01',
    '2026-08-01',
    LUNES_14,
    '2026-09-01',
  ],
  [
    'mes-pasado:-la-semana-de-su-ultimo-dia-aunque-cruce-de-mes',
    HOY,
    '2026-08',
    '2026-08-31',
    '2026-01-01',
    '2026-08-01',
    null,
    null,
  ],
  [
    'hoy-domingo:-su-semana-no-ha-acabado-y-es-la-en-curso',
    '2026-10-04',
    SEPTIEMBRE,
    '2026-09-21',
    '2026-02-01',
    '2026-09-01',
    '2026-09-28',
    null,
  ],
  [
    'hoy-lunes:-la-semana-acabo-ayer',
    '2026-10-05',
    SEPTIEMBRE,
    '2026-09-28',
    '2026-02-01',
    '2026-09-01',
    null,
    null,
  ],
  [
    'dia-1-del-mes-actual',
    '2026-10-01',
    OCTUBRE,
    '2026-09-21',
    '2026-02-01',
    '2026-09-01',
    '2026-09-28',
    '2026-10-01',
  ],
  [
    'enero-actual:-los-meses-acaban-en-diciembre-del-año-anterior',
    '2026-01-15',
    '2026-01',
    '2026-01-05',
    '2025-05-01',
    '2025-12-01',
    '2026-01-12',
    '2026-01-01',
  ],
])(
  'las_graficas_traen_periodos_terminados_y_el_en_curso (%s)',
  (_id, hoy, mes, ultima_semana, primer_mes, ultimo_mes, semana_en_curso, mes_en_curso) => {
    hoy_es(hoy)

    const datos = pedir(mes)

    const semanas = fechas(datos.por_semana)
    expect(semanas).toHaveLength(8)
    expect(semanas[semanas.length - 1]).toEqual([ultima_semana, sumarDias(ultima_semana, 6)])
    semanas.forEach(([desde, hasta], i) => {
      expect(diaDeLaSemana(desde)).toBe(1)
      expect(hasta).toBe(sumarDias(desde, 6))
      if (i + 1 < semanas.length) expect(semanas[i + 1][0]).toBe(sumarDias(hasta, 1))
    })
    expect(semanas[semanas.length - 1][1] < hoy).toBe(true)

    const meses = fechas(datos.por_mes)
    expect(meses).toHaveLength(8)
    expect(meses[0][0]).toBe(primer_mes)
    expect(meses[meses.length - 1][0]).toBe(ultimo_mes)
    meses.forEach(([desde, hasta], i) => {
      expect(desde.endsWith('-01')).toBe(true)
      expect(hasta).toBe(ultimo_dia(desde))
      if (i + 1 < meses.length) expect(meses[i + 1][0]).toBe(sumarDias(hasta, 1))
    })
    expect(meses[meses.length - 1][1] < hoy).toBe(true)

    let en_curso = datos.por_semana.en_curso
    if (semana_en_curso === null) {
      expect(en_curso).toBeNull()
    } else {
      const desde = en_curso.desde
      expect(desde).toBe(semana_en_curso)
      expect(en_curso.hasta).toBe(sumarDias(desde, 6))
      expect(desde <= hoy && hoy <= sumarDias(desde, 6)).toBe(true)
      // Va justo detrás de la última terminada.
      expect(desde).toBe(sumarDias(semanas[semanas.length - 1][1], 1))
    }

    en_curso = datos.por_mes.en_curso
    if (mes_en_curso === null) {
      expect(en_curso).toBeNull()
    } else {
      const desde = en_curso.desde
      expect(desde).toBe(mes_en_curso)
      expect(en_curso.hasta).toBe(ultimo_dia(desde))
      expect(desde).toBe(sumarDias(meses[meses.length - 1][1], 1))
    }
  },
)

test('septiembre_pedido_el_1_de_octubre_trae_la_semana_en_curso_y_no_el_mes', () => {
  // La semana del 28 de septiembre al 4 de octubre sigue en marcha y cae en la ventana de
  // septiembre: es su barra en curso, con lo de los dos meses. Septiembre ya acabó, así que
  // es su última barra terminada y no hay mes en curso.
  const ejercicio = ejercicio_id()
  hoy_es('2026-09-29')
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-09-29', push, ejercicio, [[100, 1]])
  hoy_es('2026-10-01')
  sesion_con_series('2026-10-01', push, ejercicio, [[50, 2]])

  const datos = pedir(SEPTIEMBRE)

  const semana = datos.por_semana.en_curso
  expect([semana.desde, semana.hasta]).toEqual(['2026-09-28', '2026-10-04'])
  expect(semana.volumen).toBe('200.00')
  expect(por_rutina(semana)).toEqual([['Push', '200.00']])
  expect(semana.series_por_grupo[0].series).toBe(2)
  expect(fechas(datos.por_semana).at(-1)).toEqual(['2026-09-21', '2026-09-27'])
  expect(datos.por_mes.en_curso).toBeNull()
  const septiembre = barra(datos.por_mes, '2026-09-01')
  expect(septiembre).toBe(datos.por_mes.periodos.at(-1))
  expect(septiembre.volumen).toBe('100.00')
})

test('la_constancia_es_del_año_del_mes_pedido', () => {
  hoy_es('2026-01-15')

  const datos = pedir('2025-11')

  expect(datos.constancia.meses[0].mes).toBe('2025-01-01')
  expect(datos.constancia.meses.at(-1).mes).toBe('2025-12-01')
})

// --- Volumen -----------------------------------------------------------------

test('el_volumen_es_la_suma_de_peso_por_repeticiones', () => {
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-09-22', push, ejercicio, [
    [22.5, 10],
    [20, 8],
  ])
  // Una serie sin peso cuenta como serie, pero no suma volumen.
  sesion_con_series('2026-09-24', push, ejercicio, [[0, 12]])

  const datos = pedir(SEPTIEMBRE)

  const semanas = datos.por_semana
  expect(fechas(semanas).at(-2)).toEqual(['2026-09-21', '2026-09-27'])
  expect(semanas.periodos.map((p: any) => p.volumen)).toEqual([
    ...Array(6).fill('0.00'),
    '385.00',
    '0.00',
  ])
  const semana = barra(semanas, '2026-09-21')
  expect(semana.volumen_por_rutina).toEqual([
    { rutina: { id: push, nombre: 'Push', oculto_desde: null }, volumen: '385.00' },
  ])
  expect(semana.series_por_grupo[0].series).toBe(3)
  expect(semanas.en_curso).toBeNull()
  expect(datos.por_mes.en_curso).toBeNull()
})

test('la_semana_que_cruza_de_mes_se_cuenta_entera', () => {
  // La última semana de septiembre va del 28 al 4 de octubre: suma lo de los dos meses,
  // mientras que la gráfica mensual separa cada mes.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-09-29', push, ejercicio, [[100, 1]])
  sesion_con_series('2026-10-02', push, ejercicio, [[50, 1]])

  const pasado = pedir(SEPTIEMBRE)
  const actual = pedir(OCTUBRE)

  for (const datos of [pasado, actual]) {
    expect(fechas(datos.por_semana).at(-1)).toEqual(['2026-09-28', '2026-10-04'])
    expect(volumenes(datos.por_semana).at(-1)).toBe(150)
    expect(por_rutina(datos.por_semana.periodos.at(-1))).toEqual([['Push', '150.00']])
    // Octubre no ha acabado: el último mes terminado de las dos es septiembre.
    expect(fechas(datos.por_mes).at(-1)).toEqual(['2026-09-01', '2026-09-30'])
    expect(volumenes(datos.por_mes).at(-1)).toBe(100)
    expect(por_rutina(datos.por_mes.periodos.at(-1))).toEqual([['Push', '100.00']])
  }
  const octubre = actual.por_mes.en_curso
  expect(octubre.volumen).toBe('50.00')
  expect(por_rutina(octubre)).toEqual([['Push', '50.00']])
  const semana = actual.por_semana.en_curso
  expect([semana.desde, semana.hasta]).toEqual(['2026-10-05', '2026-10-11'])
  expect(semana.volumen).toBe('0.00')
  expect(semana.volumen_por_rutina).toEqual([])
  expect(semana.series_por_grupo).toEqual([])
})

test('lo_de_la_semana_y_el_mes_en_curso_sale_solo_en_la_barra_en_curso', () => {
  // También la sesión de hoy, que sigue abierta.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-10-05', push, ejercicio, [[100, 1]])
  sesion_con_series(MARTES_6_OCT, push, ejercicio, [[100, 1]])
  expect(sesiones_en_curso(cliente).map((s) => s.fecha)).toEqual([MARTES_6_OCT])

  const datos = pedir(OCTUBRE)

  for (const [vista, desde] of [
    [datos.por_semana, '2026-10-05'],
    [datos.por_mes, '2026-10-01'],
  ]) {
    expect(volumenes(vista).reduce((a, b) => a + b, 0)).toBe(0)
    const en_curso = vista.en_curso
    expect(en_curso.desde).toBe(desde)
    expect(en_curso.volumen).toBe('200.00')
    expect(por_rutina(en_curso)).toEqual([['Push', '200.00']])
    expect(en_curso.series_por_grupo[0].series).toBe(2)
    expect(cambio(en_curso)).toEqual([null, null])
  }
})

test('los_meses_de_la_grafica_cruzan_de_año', () => {
  const ejercicio = ejercicio_id()
  hoy_es(HOY)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2025-07-01', push, ejercicio, [[10, 1]])
  sesion_con_series('2025-12-31', push, ejercicio, [[20, 1]])
  sesion_con_series('2026-02-28', push, ejercicio, [[30, 1]])
  // Justo fuera de la ventana: no suma en ninguna barra, pero es con lo que se compara la
  // primera.
  sesion_con_series('2025-06-30', push, ejercicio, [[1000, 1]])

  const meses = pedir('2026-02').por_mes

  expect(volumenes(meses)).toEqual([10, 0, 0, 0, 0, 20, 0, 30])
  expect(cambio(meses.periodos[0])).toEqual([-99.0, '2025-06-01'])
  expect(cambio(meses.periodos[5])).toEqual([100.0, '2025-07-01'])
  expect(cambio(meses.periodos[7])).toEqual([50.0, '2025-12-01'])
})

test('el_mismo_volumen_que_el_periodo_anterior_es_un_cambio_de_cero', () => {
  // Un 0 %, que no es lo mismo que no tener cambio. Subir y bajar, con su signo, en
  // `el_cambio_redondea_las_medias_decimas_hacia_fuera`; sin nada con qué comparar o sin
  // volumen, en `el_cambio_salta_las_barras_vacias`.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  // Las dos últimas semanas: la del 21 y la del 28 de septiembre.
  sesion_con_series('2026-09-22', push, ejercicio, [[100, 1]])
  sesion_con_series('2026-09-29', push, ejercicio, [[100, 1]])

  const semanas = pedir(SEPTIEMBRE).por_semana

  expect(volumenes(semanas).slice(-2)).toEqual([100, 100])
  expect(cambio(semanas.periodos.at(-1))).toEqual([0.0, '2026-09-21'])
})

test.each([
  ['sube-6,25', 160, 170, 6.3],
  ['baja-6,25', 160, 150, -6.3],
])(
  // De 160 a 170 kg es un 6,25 % exacto: sale 6,3, el redondeo de siempre. Antes se
  // redondeaba con `round(float(...), 1)`, que en los empates va al par, y salía 6,2 (y −6,2
  // al bajar).
  'el_cambio_redondea_las_medias_decimas_hacia_fuera (%s)',
  (_id, anterior, ultimo, esperado) => {
    const ejercicio = ejercicio_id()
    hoy_es(MARTES_6_OCT)
    const push = crear_rutina(cliente, 'Push')
    sesion_con_series('2026-09-22', push, ejercicio, [[anterior, 1]])
    sesion_con_series('2026-09-29', push, ejercicio, [[ultimo, 1]])

    const semanas = pedir(SEPTIEMBRE).por_semana

    expect(cambio(semanas.periodos.at(-1))).toEqual([esperado, '2026-09-21'])
  },
)

test('el_cambio_mensual_usa_los_dos_ultimos_meses_terminados', () => {
  // En el mes actual, el último mes terminado es el anterior: lo de octubre va en la barra en
  // curso, que se compara con septiembre.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-08-03', push, ejercicio, [[200, 1]])
  sesion_con_series('2026-09-07', push, ejercicio, [[300, 1]])
  sesion_con_series('2026-10-01', push, ejercicio, [[1000, 1]])

  const octubre = pedir(OCTUBRE).por_mes
  const septiembre = pedir(SEPTIEMBRE).por_mes

  expect(cambio(octubre.periodos.at(-1))).toEqual([50.0, '2026-08-01'])
  expect(octubre.en_curso.volumen).toBe('1000.00')
  expect(cambio(octubre.en_curso)).toEqual([233.3, '2026-09-01'])
  expect(cambio(septiembre.periodos.at(-1))).toEqual([50.0, '2026-08-01'])
  expect(septiembre.en_curso).toBeNull()
})

test('el_cambio_salta_las_barras_vacias', () => {
  // Volumen solo en la segunda y la quinta semana: la quinta se compara con la segunda, y las
  // vacías no tienen cambio.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-08-18', push, ejercicio, [[100, 1]])
  sesion_con_series('2026-09-08', push, ejercicio, [[150, 1]])

  const semanas = pedir(SEPTIEMBRE).por_semana

  expect(fechas(semanas)[1][0]).toBe('2026-08-17')
  expect(fechas(semanas)[4][0]).toBe('2026-09-07')
  expect(semanas.periodos.map(cambio)).toEqual([
    [null, null],
    [null, null], // la segunda: no hay nada antes
    [null, null],
    [null, null],
    [50.0, '2026-08-17'],
    [null, null],
    [null, null],
    [null, null],
  ])
})

test('la_primera_barra_se_compara_con_una_semana_de_hace_un_año', () => {
  // Sin límite de antigüedad: lo último entrenado antes de la gráfica fue el martes 12 de
  // agosto de 2025; `comparado_con` es el lunes de esa semana.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2025-08-12', push, ejercicio, [[100, 1]])
  sesion_con_series(LUNES_10_AGO, push, ejercicio, [[120, 1]])

  const semanas = pedir(SEPTIEMBRE).por_semana

  expect(fechas(semanas)[0][0]).toBe(LUNES_10_AGO)
  expect(cambio(semanas.periodos[0])).toEqual([20.0, '2025-08-11'])
})

test('la_referencia_anterior_suma_la_semana_entera', () => {
  // Dos sesiones de rutinas distintas en la semana del 3 de agosto, antes de la gráfica: la
  // referencia es su suma (200), no una de ellas.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  const pull = crear_rutina(cliente, 'Pull')
  sesion_con_series('2026-08-04', push, ejercicio, [[100, 1]])
  sesion_con_series('2026-08-06', pull, ejercicio, [[50, 2]])
  sesion_con_series(LUNES_10_AGO, push, ejercicio, [[300, 1]])

  const semanas = pedir(SEPTIEMBRE).por_semana

  expect(cambio(semanas.periodos[0])).toEqual([50.0, '2026-08-03'])
})

test('la_referencia_anterior_respeta_los_limites_de_semana_y_de_mes', () => {
  // El domingo 9 de agosto es de la semana del lunes 3, no de la del 10 (la semana empieza en
  // lunes, como la de la gráfica). El 31 de enero es de enero, no de febrero, primer mes de
  // la gráfica.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-01-31', push, ejercicio, [[100, 1]])
  sesion_con_series('2026-02-01', push, ejercicio, [[150, 1]])
  sesion_con_series('2026-08-09', push, ejercicio, [[100, 1]])
  sesion_con_series(LUNES_10_AGO, push, ejercicio, [[200, 1]])

  const datos = pedir(SEPTIEMBRE)

  const { por_semana: semanas, por_mes: meses } = datos
  expect(volumenes(semanas)[0]).toBe(200)
  expect(cambio(semanas.periodos[0])).toEqual([100.0, '2026-08-03'])
  expect(fechas(meses)[0][0]).toBe('2026-02-01')
  expect(volumenes(meses)[0]).toBe(150)
  expect(cambio(meses.periodos[0])).toEqual([50.0, '2026-01-01'])
})

test('una_barra_solo_con_series_sin_peso', () => {
  // Sus series cuentan, pero no tiene cambio ni sirve de referencia: la siguiente se compara
  // con una anterior a ella. Su rutina no sale en el volumen por rutina: una rutina sin
  // volumen esa semana no tiene nada que enseñar ahí (antes salía con 0 kg; cambió con los
  // tipos de ejercicio, que dejan semanas enteras sin volumen).
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-08-18', push, ejercicio, [[100, 1]])
  sesion_con_series('2026-09-01', push, ejercicio, [
    [0, 10],
    [0, 10],
  ])
  sesion_con_series('2026-09-08', push, ejercicio, [[150, 1]])

  const semanas = pedir(SEPTIEMBRE).por_semana

  const vacia = barra(semanas, '2026-08-31')
  expect(vacia.volumen).toBe('0.00')
  expect(cambio(vacia)).toEqual([null, null])
  expect(por_rutina(vacia)).toEqual([])
  expect(por_grupo(vacia)).toEqual([[grupo_muscular_id, 2]])
  expect(cambio(barra(semanas, '2026-09-07'))).toEqual([50.0, '2026-08-17'])
})

test('la_referencia_anterior_salta_los_periodos_solo_con_series_sin_peso', () => {
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_series('2026-07-21', push, ejercicio, [[100, 1]])
  sesion_con_series('2026-08-04', push, ejercicio, [[0, 10]])
  sesion_con_series(LUNES_10_AGO, push, ejercicio, [[150, 1]])

  const semanas = pedir(SEPTIEMBRE).por_semana

  expect(cambio(semanas.periodos[0])).toEqual([50.0, '2026-07-20'])
})

test('una_sesion_de_rutina_y_ejercicio_ocultos_sirve_de_referencia', () => {
  hoy_es(MARTES_6_OCT)
  const antigua = crear_rutina(cliente, 'Antigua')
  const push = crear_rutina(cliente, 'Push')
  const retirado = ejercicio_de_prueba(cliente, grupo_muscular_id, 'Ejercicio retirado')
  const press = ejercicio_de_prueba(cliente, grupo_muscular_id, 'Press banca')
  sesion_con_series('2026-08-04', antigua, retirado, [[100, 1]])
  sesion_con_series(LUNES_10_AGO, push, press, [[150, 1]])
  ocultar_ejercicio(cliente, retirado)
  expect(cliente.delete(`/rutinas/${antigua}?modo=ocultar`).status_code).toBe(204)

  const semanas = pedir(SEPTIEMBRE).por_semana

  expect(cambio(semanas.periodos[0])).toEqual([50.0, '2026-08-03'])
})

test.each([
  [
    'con-la-ultima-terminada-con-volumen',
    [
      ['2026-09-15', 100],
      [MARTES_6_OCT, 150],
    ],
    [50.0, '2026-09-14'],
  ],
  [
    'con-las-ocho-vacias,-con-la-anterior-a-la-grafica',
    [
      ['2026-08-04', 100],
      [MARTES_6_OCT, 120],
    ],
    [20.0, '2026-08-03'],
  ],
  ['en-curso-vacia', [['2026-09-15', 100]], [null, null]],
] as const)('el_cambio_de_la_barra_en_curso (%s)', (_id, sesiones, esperado) => {
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  for (const [fecha, peso] of sesiones) {
    sesion_con_series(fecha, push, ejercicio, [[peso, 1]])
  }

  const semanas = pedir(OCTUBRE).por_semana

  expect(semanas.en_curso.desde).toBe('2026-10-05')
  expect(cambio(semanas.en_curso)).toEqual(esperado)
})

test('el_volumen_cuenta_lo_oculto_y_lo_sin_terminar', () => {
  // Volumen es historial: cuentan las sesiones sin terminar, las que no cuentan para ningún
  // día y las de rutinas o ejercicios ya ocultos. La rutina oculta sale en el desglose con su
  // `oculto_desde`.
  hoy_es(MARTES_6_OCT)
  const antigua = crear_rutina(cliente, 'Antigua')
  const push = crear_rutina(cliente, 'Push')
  const retirado = ejercicio_de_prueba(cliente, grupo_muscular_id, 'Ejercicio retirado')
  const press = ejercicio_de_prueba(cliente, grupo_muscular_id, 'Press banca')
  sesion_con_series('2026-08-12', antigua, retirado, [[50, 10]])
  sesion_con_series('2026-09-23', antigua, retirado, [
    [40, 10],
    [40, 8],
  ])
  sesion_con_series('2026-09-30', push, press, [[60, 5]])
  const terminada = sesion_con_series('2026-10-02', push, press, [[70, 5]])
  expect(cliente.post(`/entrenamientos/${terminada}/terminar`).status_code).toBe(200)
  ocultar_ejercicio(cliente, retirado)
  expect(cliente.delete(`/rutinas/${antigua}?modo=ocultar`).status_code).toBe(204)

  const datos = pedir(SEPTIEMBRE)

  expect(volumenes(datos.por_semana).slice(-2)).toEqual([720, 650])
  expect(volumenes(datos.por_mes).slice(-2)).toEqual([500, 1020])
  for (const vista of [datos.por_semana, datos.por_mes]) {
    for (const periodo of todas_las_barras(vista)) {
      const suma = periodo.volumen_por_rutina.reduce(
        (total: number, fila: any) => total + centesimas(Number(fila.volumen)),
        0,
      )
      expect(suma).toBe(centesimas(Number(periodo.volumen)))
    }
  }
  const septiembre = barra(datos.por_mes, '2026-09-01')
  expect(septiembre.volumen_por_rutina).toEqual([
    {
      rutina: { id: antigua, nombre: 'Antigua', oculto_desde: MARTES_6_OCT },
      volumen: '720.00',
    },
    { rutina: { id: push, nombre: 'Push', oculto_desde: null }, volumen: '300.00' },
  ])
})

test('el_volumen_va_por_la_fecha_real_y_la_constancia_por_el_dia_que_cuenta', () => {
  // El miércoles 30 de septiembre se adelanta el Leg del viernes 2 de octubre: su volumen y
  // sus series son de septiembre, pero el día entrenado es de octubre.
  const rutinas = ppl()
  hoy_es('2026-09-30')
  const press = ejercicio_de_prueba(cliente, grupo_muscular_id, 'Press banca')
  sesion_con_series('2026-09-30', rutinas.Leg, press, [[100, 5]], { cubre_fecha: '2026-10-02' })
  hoy_es(MARTES_6_OCT)

  const septiembre = pedir(SEPTIEMBRE)
  const octubre = pedir(OCTUBRE)

  const mes = barra(septiembre.por_mes, '2026-09-01')
  expect(por_rutina(mes)).toEqual([['Leg', '500.00']])
  expect(mes.series_por_grupo[0].series).toBe(1)
  expect(octubre.por_mes.en_curso.volumen_por_rutina).toEqual([])
  expect(octubre.por_mes.en_curso.series_por_grupo).toEqual([])
  const meses = septiembre.constancia.meses
  expect(meses[9].entrenados).toBe(1) // octubre
  // El 30 tocaba Pull y no se hizo: falta en septiembre.
  expect(meses[8].entrenados).toBe(0)
})

// --- Desglose de cada barra --------------------------------------------------

test('el_volumen_por_rutina_es_de_la_barra_y_de_mayor_a_menor', () => {
  // Empates por nombre sin mirar mayúsculas.
  const ejercicio = ejercicio_id()
  hoy_es(MARTES_6_OCT)
  const ids: Record<string, number> = {}
  for (const nombre of ['Push', 'Pull', 'Leg', 'Core', 'Abs']) {
    ids[nombre] = crear_rutina(cliente, nombre)
  }
  for (const [fecha, nombre, peso] of [
    ['2026-08-31', 'Leg', 5000], // Agosto, aunque cae en la semana del 31.
    ['2026-09-01', 'Push', 100],
    ['2026-09-02', 'Pull', 150],
    ['2026-09-03', 'Pull', 150],
    ['2026-09-04', 'Core', 100],
    ['2026-09-05', 'Abs', 100],
    ['2026-10-01', 'Push', 5000],
  ] as const) {
    sesion_con_series(fecha, ids[nombre], ejercicio, [[peso, 1]])
  }

  const datos = pedir(SEPTIEMBRE)

  expect(por_rutina(barra(datos.por_mes, '2026-09-01'))).toEqual([
    ['Pull', '300.00'],
    ['Abs', '100.00'],
    ['Core', '100.00'],
    ['Push', '100.00'],
  ])
  expect(por_rutina(barra(datos.por_semana, '2026-08-31'))).toEqual([
    ['Leg', '5000.00'],
    ['Pull', '300.00'],
    ['Abs', '100.00'],
    ['Core', '100.00'],
    ['Push', '100.00'],
  ])
  expect(por_rutina(barra(datos.por_semana, '2026-09-28'))).toEqual([['Push', '5000.00']])
})

test('las_series_van_al_grupo_del_ejercicio_que_se_hizo', () => {
  // Un comodín de otro grupo trabaja el suyo, no el del principal del hueco.
  hoy_es(MARTES_6_OCT)
  const grupos: any[] = cliente.get('/grupos-musculares').json()
  const [pecho, espalda] = [grupos[0], grupos[1]]
  const principal = ejercicio_de_prueba(cliente, pecho.id, 'Press banca')
  const comodin = ejercicio_de_prueba(cliente, espalda.id, 'Remo')
  const push = crear_rutina(cliente, 'Push')
  const hueco = crear_hueco(cliente, push, principal)
  poner_alternativas(cliente, push, hueco, [comodin])
  sesion_con_series(
    '2026-09-01',
    push,
    principal,
    [
      [60, 8],
      [0, 8],
    ],
    { slot_id: hueco },
  )
  sesion_con_series(
    '2026-09-02',
    push,
    comodin,
    [
      [50, 8],
      [50, 8],
      [50, 8],
    ],
    { slot_id: hueco },
  )
  // Agosto, pero de la semana del 31.
  sesion_con_series('2026-08-31', push, principal, Array(5).fill([60, 8]), { slot_id: hueco })

  const datos = pedir(SEPTIEMBRE)

  const septiembre = barra(datos.por_mes, '2026-09-01')
  expect(por_grupo(septiembre)).toEqual([
    [espalda.id, 3],
    [pecho.id, 2],
  ])
  expect(septiembre.series_por_grupo[0].grupo_muscular).toEqual(espalda)
  const semana = barra(datos.por_semana, '2026-08-31')
  expect(por_grupo(semana)).toEqual([
    [pecho.id, 7],
    [espalda.id, 3],
  ])
})

// --- Tipos de ejercicio ------------------------------------------------------
//
// El volumen solo cuenta los ejercicios de peso y repeticiones: peso por segundos o la carga
// de unas dominadas no son kilos levantados comparables (el cardio, igual: es la misma
// condición sobre el tipo). Las series de todos los tipos cuentan en «Series por grupo
// muscular».

/**
 * Una sesión con una serie por cada `[ejercicio_id, medidas]`, en el hueco de su ejercicio (lo
 * crea si no está). Devuelve su id.
 */
function sesion_con_medidas(
  fecha: string,
  rutina_id: number,
  ...series: [number, Record<string, unknown>][]
): number {
  const respuesta = cliente.post('/entrenamientos', { json: { rutina_id, fecha } })
  esperar_estado(respuesta, 201)
  const entrenamiento_id = respuesta.json().id
  series.forEach(([ejercicio, medidas], i) => {
    // Sin peso ni repeticiones si no se dicen: `serie_en` pone unos por defecto.
    const campos = { peso: null, repeticiones: null, ...medidas }
    esperar_estado(
      serie_en(cliente, entrenamiento_id, ejercicio, { numero: i + 1, ...campos }),
      201,
    )
  })
  return entrenamiento_id
}

/** Un ejercicio de cada tipo, cada uno en un grupo muscular distinto. */
function tres_tipos() {
  const grupos: number[] = cliente
    .get('/grupos-musculares')
    .json()
    .slice(0, 3)
    .map((g: any) => g.id)
  return {
    press: crear_ejercicio(cliente, grupos[0], 'Press banca'),
    dominadas: crear_ejercicio(cliente, grupos[1], 'Dominadas en anillas', { tipo: 'corporal' }),
    plancha: crear_ejercicio(cliente, grupos[2], 'Plancha con lastre', { tipo: 'tiempo' }),
    grupos,
  }
}

test('una_semana_solo_de_series_por_tiempo_tiene_volumen_cero_y_no_da_un_500', () => {
  // Regresión: la suma del volumen de una barra sin ninguna serie de peso y repeticiones es
  // nula en SQL, no 0, y sumarla a la barra daba un 500. Aunque una de las planchas lleve
  // peso. La semana anterior tiene volumen: la de las planchas no tiene cambio frente a ella,
  // ni rutina en el volumen por rutina.
  const tipos = tres_tipos()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_medidas('2026-09-15', push, [tipos.press, { peso: 100, repeticiones: 1 }])
  sesion_con_medidas(
    '2026-09-22',
    push,
    [tipos.plancha, { duracion_s: 45 }],
    [tipos.plancha, { duracion_s: 60, peso: 10 }],
  )

  const datos = pedir(SEPTIEMBRE)

  const semana = barra(datos.por_semana, '2026-09-21')
  expect(semana.volumen).toBe('0.00')
  expect(cambio(semana)).toEqual([null, null])
  expect(por_rutina(semana)).toEqual([])
  expect(por_grupo(semana)).toEqual([[tipos.grupos[2], 2]])
  expect(barra(datos.por_mes, '2026-09-01').volumen).toBe('100.00')
})

test('el_peso_corporal_y_el_tiempo_no_suman_volumen_pero_sus_series_cuentan', () => {
  // En la misma sesión: press 60 × 10 (600), dominadas con 20 kg de lastre y con 10 de ayuda
  // (160 y −80 si contaran), una con su peso corporal, y una plancha con 10 kg durante 60 s.
  // El volumen es solo el del press; las cinco series cuentan, cada una en el grupo de su
  // ejercicio. El peso corporal no cambia nada.
  const tipos = tres_tipos()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_medidas(
    '2026-09-22',
    push,
    [tipos.press, { peso: 60, repeticiones: 10 }],
    [tipos.dominadas, { peso: 20, repeticiones: 8, peso_corporal: 80 }],
    [tipos.dominadas, { peso: -10, repeticiones: 8 }],
    [tipos.plancha, { duracion_s: 60, peso: 10 }],
    [tipos.plancha, { duracion_s: 45 }],
  )

  const datos = pedir(SEPTIEMBRE)

  const [del_press, de_dominadas, de_plancha] = tipos.grupos
  for (const periodo of [
    barra(datos.por_semana, '2026-09-21'),
    barra(datos.por_mes, '2026-09-01'),
  ]) {
    expect(periodo.volumen).toBe('600.00')
    expect(por_rutina(periodo)).toEqual([['Push', '600.00']])
    expect(ordenados(por_grupo(periodo))).toEqual(
      ordenados([
        [del_press, 1],
        [de_dominadas, 2],
        [de_plancha, 2],
      ]),
    )
  }
})

test('la_referencia_anterior_solo_mira_el_volumen_de_peso_y_repeticiones', () => {
  // Antes de la gráfica: press el 21 de julio (100) y dominadas con 50 kg de lastre el 4 de
  // agosto (500 si contaran). La primera barra (150) se compara con la semana del press, no
  // con la de las dominadas.
  const tipos = tres_tipos()
  hoy_es(MARTES_6_OCT)
  const push = crear_rutina(cliente, 'Push')
  sesion_con_medidas('2026-07-21', push, [tipos.press, { peso: 100, repeticiones: 1 }])
  sesion_con_medidas('2026-08-04', push, [tipos.dominadas, { peso: 50, repeticiones: 10 }])
  sesion_con_medidas(LUNES_10_AGO, push, [tipos.press, { peso: 150, repeticiones: 1 }])

  const semanas = pedir(SEPTIEMBRE).por_semana

  expect(cambio(semanas.periodos[0])).toEqual([50.0, '2026-07-20'])
})

// --- Constancia --------------------------------------------------------------

test('la_constancia_cuenta_cada_dia_en_el_mes_que_tocaba', () => {
  // Hoy es el miércoles 16 de septiembre; Push lunes, Pull miércoles, Leg viernes desde el
  // lunes 31 de agosto.
  //
  // - El Push del 31 de agosto se recupera el 1 de septiembre: cuenta en agosto.
  // - Pull del 2 y Push del 7, hechos; el Leg del 18 se adelanta al 15.
  // - El 4, 9, 11 y 14 se faltan. El Pull de hoy aún no es falta: está por llegar.
  // - Una sesión el jueves 10 sin contar ningún día no entra.
  const rutinas = ppl()
  const ejercicio = ejercicio_id()
  hoy_es('2026-09-01')
  sesion_con_series('2026-09-01', rutinas.Push, ejercicio, [[50, 5]], { cubre_fecha: '2026-08-31' })
  hoy_es(HOY)
  for (const [fecha, nombre, cubre] of [
    ['2026-09-02', 'Pull', '2026-09-02'],
    [LUNES_7, 'Push', LUNES_7],
    ['2026-09-10', 'Leg', null],
    [MARTES_15, 'Leg', VIERNES_18],
  ] as const) {
    sesion_con_series(fecha, rutinas[nombre], ejercicio, [[50, 5]], { cubre_fecha: cubre })
  }

  const constancia = pedir(SEPTIEMBRE).constancia

  const cifras = constancia.meses.map((m: any) => [m.entrenados, m.planificados, m.por_llegar])
  expect(cifras).toEqual([
    ...Array(7).fill([0, 0, 0]),
    [1, 1, 0], // agosto
    [3, 7, 6], // septiembre: 2, 7, 18 entrenados; 4, 9, 11, 14 faltados; 16 y 5 más
    [0, 0, 13], // octubre
    [0, 0, 13], // noviembre
    [0, 0, 13], // diciembre
  ])
  expect([constancia.entrenados, constancia.planificados]).toEqual([4, 8])
})

test('hoy_hecho_cuenta_como_entrenado', () => {
  const rutinas = ppl()
  const ejercicio = ejercicio_id()
  sesion_con_series(HOY, rutinas.Pull, ejercicio, [[50, 5]], { cubre_fecha: HOY })

  const septiembre = pedir(SEPTIEMBRE).constancia.meses[8]

  // Faltados el 2, 4, 7, 9, 11 y 14; por llegar del 18 al 30.
  expect([septiembre.entrenados, septiembre.planificados]).toEqual([1, 1 + 6])
  expect(septiembre.por_llegar).toBe(6)
})

test('los_dias_de_una_rutina_oculta_no_cuentan', () => {
  // Leg se oculta hoy: los viernes que quedan pasan a descanso, y los que ya pasaron siguen
  // contando como faltados.
  const rutinas = ppl()
  const ejercicio = ejercicio_id()
  sesion_con_series(MARTES_15, rutinas.Leg, ejercicio, [[50, 5]])
  expect(cliente.delete(`/rutinas/${rutinas.Leg}?modo=ocultar`).status_code).toBe(204)

  const meses = pedir(SEPTIEMBRE).constancia.meses

  // Septiembre: lunes 7 y 14, miércoles 2 y 9, viernes 4 y 11 faltados; hoy, 21, 23, 28 y 30
  // por llegar; los viernes 18 y 25 ya no cuentan.
  expect([meses[8].entrenados, meses[8].planificados, meses[8].por_llegar]).toEqual([0, 6, 5])
  expect(meses[9].por_llegar).toBe(8) // octubre, sin sus cinco viernes
})

test('en_un_año_pasado_no_hay_nada_por_llegar', () => {
  ppl()
  hoy_es('2027-01-10')

  const constancia = pedir('2026-12').constancia

  expect(constancia.meses.every((m: any) => m.por_llegar === 0)).toBe(true)
  // 31 de agosto, y trece días de septiembre a diciembre, todos faltados.
  expect(constancia.planificados).toBe(1 + 13 * 4)
  expect(constancia.entrenados).toBe(0)
})

// --- Propios del móvil -------------------------------------------------------
//
// El backend redondea el cambio con `Decimal` y `ROUND_HALF_UP`; el móvil, con enteros
// (`cambioEnPorCiento`, en centésimas de kg). Y `date_trunc` de Postgres es aquí `sumarMeses`
// y compañía, que se prueban a mano.

test.each([
  ['sube-6,25', 17000, 16000, 6.3],
  ['baja-6,25', 15000, 16000, -6.3],
  ['sin-redondeo', 21000, 20000, 5],
  ['sin-cambio', 20000, 20000, 0],
  ['baja-a-la-mitad-justa', 10000, 20000, -50],
  ['redondea-hacia-abajo', 10001, 10000, 0],
  ['tercio-hacia-arriba', 40000, 30000, 33.3],
  ['dos-tercios-negativos', 10000, 30000, -66.7],
])(
  'el_cambio_en_por_ciento_redondea_la_mitad_lejos_del_cero (%s)',
  (_id, volumen, anterior, esperado) => {
    expect(cambioEnPorCiento(volumen, anterior)).toBe(esperado)
  },
)

test.each([
  ['hacia-atras-cruzando-de-año', '2026-01-01', -1, '2025-12-01'],
  ['hacia-delante-cruzando-de-año', '2026-12-01', 1, '2027-01-01'],
  ['varios-años-hacia-atras', '2026-01-01', -13, '2024-12-01'],
  ['varios-años-hacia-delante', '2026-12-01', 25, '2029-01-01'],
  ['doce-meses-es-el-mismo-mes-del-año-anterior', '2026-03-01', -12, '2025-03-01'],
  ['cero-en-diciembre', '2026-12-01', 0, '2026-12-01'],
  ['atras-hasta-diciembre-desde-marzo', '2026-03-01', -3, '2025-12-01'],
])('sumar_meses_cruza_de_año (%s)', (_id, primero, n, esperado) => {
  expect(sumarMeses(primero, n)).toBe(esperado)
})
