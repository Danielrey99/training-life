/**
 * Puerto de `backend/tests/test_datos.py`: exportar, importar y borrar todos los datos
 * (`/datos`).
 *
 * Importar **sustituye todo** por lo del archivo, así que lo que más importa es que la copia sea
 * idéntica (nada se pierde por el camino, ni una fecha de creación, ni el orden de los
 * comodines), que un archivo malo no toque nada y que nada de esto alcance a los ejercicios
 * predefinidos, que vienen con la app y no son datos de nadie.
 *
 * Diferencias con el backend, por cómo es el móvil:
 * - Los instantes importados se guardan tal cual llegan (sin pasarlos a UTC), así que donde el
 *   backend compara `datetime` aquí se compara el instante (`enMicrosegundos`).
 * - Las columnas de las tablas se miran con `PRAGMA table_info` frente a las claves del archivo
 *   exportado (no hay modelos de Pydantic ni de SQLAlchemy).
 * - No se portan los que cuentan consultas SQL, los de cabeceras HTTP ni los de JSON mal
 *   formado (ver `no_aplica.ts`).
 */
import type { Bd } from '../../src/logica/bd/bd'
import { aCentesimas } from '../../src/logica/reglas/centesimas'
import { enMicrosegundos } from '../../src/logica/reglas/instantes'
import {
  crear_ejercicio,
  en_texto,
  entrenar,
  lista_de_predefinidos,
  objetivo,
  serie_en,
} from '../apoyo/ayudas'
import { AHORA } from '../apoyo/baseNueva'
import {
  ClienteDeTest,
  ZONA,
  crearCliente,
  type ClienteDeTest as Cliente,
  type Entorno,
  type RespuestaDeTest,
} from '../apoyo/cliente'
import { ejercicio_predefinido_id, grupo_muscular_id } from '../apoyo/conftest'
import { contar, insertar } from '../apoyo/filas'

const HOY = '2026-09-16'

const NO_ES_UNA_COPIA = 'Este archivo no es una copia de los datos de Training Life.'
const MAS_NUEVA = 'Este archivo es de una versión más nueva de la app. Actualízala para cargarlo.'
const ANTERIOR = 'Este archivo es de una versión anterior de la app y ya no se puede cargar.'
const DANADO = 'El archivo está dañado.'
const _AHORA = '2026-09-16T10:00:00+00:00'
const MARCA = { created_at: _AHORA, updated_at: _AHORA }
// Lo mínimo que es un archivo: sin ninguna lista, todas valen vacías.
const VACIO: Record<string, any> = { formato: 'training-life', version: 3, exportado_en: _AHORA }
const NO_SE_CAMBIA_NADA = 'No se puede cargar el archivo, así que no se ha cambiado nada.'
// Lo que dicen `GET /datos/resumen` y la comprobación de importar sin datos.
const CERO = {
  ejercicios: 0,
  notas: 0,
  rutinas: 0,
  programas: 0,
  sesiones: 0,
  series: 0,
  primera_sesion: null,
  ultima_sesion: null,
}

/** El instante como número, para comparar dos instantes con zonas distintas. */
function instante(texto: string): bigint {
  return enMicrosegundos(texto)
}

function clonar<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor))
}

// --- El escenario ------------------------------------------------------------

/** Predefinidos sembrados [id, nombre], sin la sentadilla de la fixture. */
function _predefinidos(bd: Bd, cuantos: number): [number, string][] {
  return bd
    .todas<{ id: number; nombre: string }>(
      `SELECT id, nombre FROM ejercicios
       WHERE es_predefinido = 1 AND nombre != 'Sentadilla con barra' ORDER BY id LIMIT ?`,
      cuantos,
    )
    .map((f) => [f.id, f.nombre])
}

type Medidas = Record<string, number | string | null>

function dia_de(fecha: string): number {
  return Number(fecha.slice(8))
}

/**
 * Todo lo que pueden tener los datos, directamente en la base y con cada campo opcional relleno
 * en algún sitio (si no, una ida y vuelta que perdiera ese campo pasaría igual): ejercicios
 * propios (uno oculto), notas (una de un predefinido que no se usa en nada más), una rutina
 * visible con un hueco oculto y comodines en un orden que no es el de sus ids y un tramo ya
 * cerrado en que estuvo oculta, una rutina oculta, un programa activo con un periodo cerrado y
 * un día cambiado de rutina (fila cerrada), otro programa oculto, excepciones (una de descanso),
 * sesiones terminadas, una cancelada y la de hoy en curso. Las marcas de tiempo llevan
 * microsegundos para ver que se conservan.
 *
 * Los predefinidos: la sentadilla es principal; `comodin` solo comodín; `de_nota` solo tiene una
 * nota; `de_serie` solo aparece en una serie (un comodín que se quitó) y `sin_usar` no lo usa
 * nada.
 *
 * En una sesión, cada hueco se hace con un solo ejercicio (si no, importar su propio archivo
 * daría 422): el press, el remo (comodín) y `de_serie` van cada uno en un hueco o una sesión
 * distintos.
 *
 * Todo es de peso y repeticiones y sin peso corporal, y cada comodín tiene el objetivo de su
 * principal: lo que solo existe con los tipos de ejercicio (otros tipos, el peso corporal, un
 * objetivo distinto por alternativa) está en `montar_datos_por_tipo`, que se monta encima.
 */
function montar_datos(bd: Bd, sentadilla_id: number, sesiones_extra = 0) {
  const [comodin, de_nota, de_serie, sin_usar] = _predefinidos(bd, 4)
  const { id: grupo_id, nombre: grupo } = bd.una<{ id: number; nombre: string }>(
    'SELECT id, nombre FROM grupos_musculares ORDER BY id LIMIT 1',
  )!

  const ejercicio = (nombre: string, campos: Record<string, any> = {}): number =>
    insertar(bd, 'ejercicios', {
      nombre,
      grupo_muscular_id: grupo_id,
      tipo_registro: 'peso_reps',
      created_at: '2026-08-01T09:15:00.123456+00:00',
      updated_at: '2026-08-02T10:20:30.654321+00:00',
      ...campos,
    })

  const press = ejercicio('Press inclinado con mancuernas', { descripcion: 'Banco a 30 grados' })
  const remo = ejercicio('Remo en máquina vieja', { oculto_desde: '2026-08-20' })

  insertar(bd, 'notas_ejercicio', {
    ejercicio_id: press,
    nota: 'El banco del fondo cojea',
    created_at: '2026-08-03T08:00:00.000001+00:00',
    updated_at: '2026-08-04T08:00:00.000002+00:00',
  })
  insertar(bd, 'notas_ejercicio', {
    ejercicio_id: de_nota[0],
    nota: 'Asiento en el 4',
    created_at: '2026-08-05T08:00:00+00:00',
    updated_at: '2026-08-05T08:00:00+00:00',
  })

  const rutina = (nombre: string, campos: Record<string, any> = {}): number =>
    insertar(bd, 'rutinas', {
      nombre,
      created_at: '2026-08-06T07:00:00.111111+00:00',
      updated_at: '2026-08-07T07:00:00.222222+00:00',
      ...campos,
    })

  const push = rutina('Push')
  const pull = rutina('Pull', { oculto_desde: '2026-09-14' })
  // Push estuvo oculta del lunes 3 al martes 4 de agosto (se mostró el 5): ese lunes le tocaba
  // con PPL y es descanso. Si la ida y vuelta perdiera el tramo, el seguimiento de
  // `lo_que_se_ve` lo daría por «sin hacer».
  insertar(bd, 'rutina_periodos_ocultos', {
    rutina_id: push,
    desde: '2026-08-03',
    hasta: '2026-08-05',
  })

  const hueco = (rutina_id: number, principal: number, orden: number, campos = {}): number =>
    insertar(bd, 'rutina_slots', {
      rutina_id,
      ejercicio_principal_id: principal,
      orden,
      series_objetivo: 4,
      reps_min: 6,
      reps_max: 10,
      created_at: '2026-08-08T06:00:00.333333+00:00',
      updated_at: '2026-08-09T06:00:00.444444+00:00',
      ...campos,
    })

  const h1 = hueco(push, press, 1)
  const h2 = hueco(push, sentadilla_id, 2)
  const h3 = hueco(push, remo, 3, { oculto_desde: '2026-09-01' })
  const h4 = hueco(pull, press, 1)
  // El remo (id alto, propio) antes que el predefinido (id bajo): el orden de los comodines es
  // el de sus filas, no el de los ids de sus ejercicios. Con el mismo objetivo que su principal
  // (uno distinto, en `montar_datos_por_tipo`).
  const objetivo_del_principal = { series_objetivo: 4, reps_min: 6, reps_max: 10 }
  insertar(bd, 'slot_alternativas', { slot_id: h1, ejercicio_id: remo, ...objetivo_del_principal })
  insertar(bd, 'slot_alternativas', {
    slot_id: h1,
    ejercicio_id: comodin[0],
    ...objetivo_del_principal,
  })

  const ppl = insertar(bd, 'programas', {
    nombre: 'PPL',
    created_at: '2026-07-30T12:00:00.5+00:00',
    updated_at: '2026-09-07T12:00:00.5+00:00',
  })
  const viejo = insertar(bd, 'programas', {
    nombre: 'Viejo',
    oculto_desde: '2026-09-01',
    created_at: '2026-07-01T12:00:00+00:00',
    updated_at: '2026-09-01T12:00:00+00:00',
  })
  const dia = (programa_id: number, dia_semana: number, rutina_id: number, campos = {}) =>
    insertar(bd, 'programa_dias', { programa_id, dia_semana, rutina_id, ...campos })
  dia(ppl, 1, push)
  dia(ppl, 3, pull, { hasta: '2026-09-07' })
  dia(ppl, 3, push, { desde: '2026-09-07' })
  dia(viejo, 5, pull)
  insertar(bd, 'programa_periodos', { programa_id: ppl, desde: '2026-08-01', hasta: '2026-08-15' })
  insertar(bd, 'programa_periodos', { programa_id: ppl, desde: '2026-08-31' })
  insertar(bd, 'programa_periodos', {
    programa_id: viejo,
    desde: '2026-08-15',
    hasta: '2026-08-31',
  })
  insertar(bd, 'excepciones_del_plan', {
    fecha: '2026-09-12',
    rutina_id: push,
    created_at: '2026-09-10T20:00:00.777777+00:00',
    updated_at: '2026-09-11T20:00:00.888888+00:00',
  })
  insertar(bd, 'excepciones_del_plan', {
    fecha: '2026-09-13',
    rutina_id: null,
    created_at: '2026-09-10T20:00:00+00:00',
    updated_at: '2026-09-10T20:00:00+00:00',
  })

  const sesion = (
    fecha: string,
    rutina_id: number,
    series: [number, number, number, string, number, Medidas?][] = [],
    campos: Record<string, any> = {},
  ): number => {
    const id = insertar(bd, 'entrenamientos', {
      rutina_id,
      fecha,
      created_at: `${fecha}T16:00:00.000001+00:00`,
      updated_at: `${fecha}T18:00:00.000002+00:00`,
      ...campos,
    })
    for (const [slot_id, ejercicio_id, numero, peso, reps, resto] of series) {
      insertar(bd, 'series', {
        entrenamiento_id: id,
        slot_id,
        ejercicio_id,
        numero_serie: numero,
        peso_centesimas: aCentesimas(peso),
        repeticiones: reps,
        created_at: '2026-09-07T17:01:02.030405+00:00',
        updated_at: '2026-09-07T17:05:06.070809+00:00',
        ...resto,
      })
    }
    return id
  }

  const terminada = '2026-09-07T18:30:12.345678+00:00'
  sesion(
    '2026-09-07',
    push,
    [
      [h1, press, 1, '60', 8, { variante: 'agarre cerrado' }],
      [h2, sentadilla_id, 1, '100', 5],
      // Un comodín que se quitó, en el hueco del remo (el oculto).
      [h3, de_serie[0], 1, '40', 12],
    ],
    { cubre_fecha: '2026-09-07', notas: 'Buen día', terminada_en: terminada },
  )
  sesion(
    '2026-09-09',
    push,
    // La sentadilla, la primera: los archivos malos de abajo estropean esa serie.
    [
      [h2, sentadilla_id, 1, '102.5', 5],
      [h1, remo, 1, '50', 10],
    ],
    { cubre_fecha: '2026-09-09', terminada_en: terminada },
  )
  // Cancelada: terminó sin series.
  sesion('2026-09-10', pull, [], { terminada_en: terminada })
  sesion('2026-09-11', pull, [[h4, press, 1, '62.5', 6]], { terminada_en: terminada })
  for (let extra = 0; extra < sesiones_extra; extra++) {
    sesion(`2026-06-${String(1 + extra).padStart(2, '0')}`, push, [[h2, sentadilla_id, 1, '90', 5]])
  }
  // La de hoy, en curso.
  sesion(HOY, push, [[h1, press, 1, '62', 8]], { cubre_fecha: HOY })

  return {
    push,
    pull,
    press,
    remo,
    huecos: [h1, h2, h3, h4],
    grupo,
    comodin,
    de_nota,
    de_serie,
    sin_usar,
    ppl,
    viejo,
  }
}

/**
 * Lo que solo existe con los tipos de ejercicio, para montar encima de `montar_datos` (o solo):
 * un ejercicio propio de cada tipo y una rutina «Core» con un hueco de cada uno, más uno de la
 * sentadilla (predefinido, de peso y repeticiones). El de la plancha, con su objetivo en
 * segundos y las dominadas de alternativa (otra familia, con objetivo de repeticiones); el del
 * remo, con la plancha de alternativa y un objetivo en segundos distinto del de su hueco. Dos
 * sesiones (el 2 y el 3 de septiembre, días que `montar_datos` no usa) con dominadas con ayuda y
 * con peso corporal, con lastre y sin carga, una plancha sin peso y otra con peso, y la
 * sentadilla. Y un ejercicio de cardio con su hueco (objetivo en segundos), con dos series el día
 * 3: una con distancia y otra sin ella.
 */
function montar_datos_por_tipo(bd: Bd, sentadilla_id: number) {
  const grupo_id = bd.una<{ id: number }>(
    'SELECT id FROM grupos_musculares ORDER BY id LIMIT 1',
  )!.id
  const marca = {
    created_at: '2026-08-20T09:00:00.000123+00:00',
    updated_at: '2026-08-21T09:00:00.000456+00:00',
  }

  const ejercicio = (nombre: string, tipo: string): number =>
    insertar(bd, 'ejercicios', {
      nombre,
      grupo_muscular_id: grupo_id,
      tipo_registro: tipo,
      ...marca,
    })

  const dominadas = ejercicio('Dominadas lastradas', 'corporal')
  const plancha = ejercicio('Plancha con disco', 'tiempo')
  const remo = ejercicio('Remo con barra', 'peso_reps')
  const cinta = ejercicio('Cinta con inclinación', 'cardio')
  const core = insertar(bd, 'rutinas', { nombre: 'Core', ...marca })
  const en_reps = { series_objetivo: 3, reps_min: 6, reps_max: 10 }
  const en_segundos = { series_objetivo: 3, duracion_min_s: 30, duracion_max_s: 60 }
  const huecos = new Map<number, number>()
  ;[dominadas, plancha, remo, sentadilla_id, cinta].forEach((principal, i) => {
    const id = insertar(bd, 'rutina_slots', {
      rutina_id: core,
      ejercicio_principal_id: principal,
      orden: i + 1,
      ...(principal === plancha || principal === cinta ? en_segundos : en_reps),
      ...marca,
    })
    huecos.set(principal, id)
  })
  insertar(bd, 'slot_alternativas', {
    slot_id: huecos.get(plancha)!,
    ejercicio_id: dominadas,
    series_objetivo: 2,
    reps_min: 5,
    reps_max: 8,
  })
  insertar(bd, 'slot_alternativas', {
    slot_id: huecos.get(remo)!,
    ejercicio_id: plancha,
    series_objetivo: 4,
    duracion_min_s: 20,
    duracion_max_s: 40,
  })

  const sesion = (dia: number, ...series: [number, Medidas][]) => {
    const id = insertar(bd, 'entrenamientos', {
      rutina_id: core,
      fecha: `2026-09-0${dia}`,
      terminada_en: `2026-09-0${dia}T19:00:00+00:00`,
      ...marca,
    })
    series.forEach(([ejercicio_id, medidas], i) => {
      insertar(bd, 'series', {
        entrenamiento_id: id,
        slot_id: huecos.get(ejercicio_id)!,
        ejercicio_id,
        numero_serie: i + 1,
        ...medidas,
        ...marca,
      })
    })
  }

  sesion(
    2,
    [dominadas, { peso_centesimas: -2000, repeticiones: 8, peso_corporal_centesimas: 7850 }],
    [dominadas, { peso_centesimas: 1000, repeticiones: 6 }],
    [plancha, { duracion_s: 45 }],
    [sentadilla_id, { peso_centesimas: 8000, repeticiones: 5 }],
  )
  sesion(
    3,
    [dominadas, { peso_centesimas: 0, repeticiones: 12, peso_corporal_centesimas: 7900 }],
    [plancha, { duracion_s: 90, peso_centesimas: 1000 }],
    [remo, { peso_centesimas: 7000, repeticiones: 8 }],
    [cinta, { duracion_s: 1800, distancia_m: 5200 }],
    [cinta, { duracion_s: 600 }],
  )
  return { core, dominadas, plancha, remo_con_barra: remo }
}

type Datos = ReturnType<typeof montar_datos>

/** La fixture `datos`: el escenario de siempre, con el reloj en `HOY`. */
function datos(): Entorno & Datos {
  const entorno = crearCliente()
  entorno.reloj.fijar(HOY)
  const sentadilla = ejercicio_predefinido_id(entorno.bd)
  return { ...entorno, ...montar_datos(entorno.bd, sentadilla) }
}

/** La fixture `datos_por_tipo`: todo, el escenario de siempre y, encima, el de los tipos. */
function datos_por_tipo(): Entorno & Datos & ReturnType<typeof montar_datos_por_tipo> {
  const e = datos()
  return { ...e, ...montar_datos_por_tipo(e.bd, ejercicio_predefinido_id(e.bd)) }
}

function exportado(cliente: Cliente): any {
  const respuesta = cliente.get('/datos/exportar')
  expect(respuesta.status_code).toBe(200)
  return respuesta.json()
}

/** El archivo sin `exportado_en`, que cambia en cada exportación. */
function sin_marca(archivo: Record<string, any>): Record<string, any> {
  const { exportado_en: _fuera, ...resto } = archivo
  return resto
}

function importar(
  cliente: Cliente,
  archivo: unknown,
  params: Record<string, boolean> = {},
): RespuestaDeTest {
  return cliente.post('/datos/importar', { json: archivo, params })
}

const TABLAS_DE_DATOS: [string, string][] = [
  ['ejercicios', 'ejercicios WHERE es_predefinido = 0'],
  ['notas', 'notas_ejercicio'],
  ['rutinas', 'rutinas'],
  ['tramos_ocultos', 'rutina_periodos_ocultos'],
  ['huecos', 'rutina_slots'],
  ['comodines', 'slot_alternativas'],
  ['programas', 'programas'],
  ['dias', 'programa_dias'],
  ['periodos', 'programa_periodos'],
  ['excepciones', 'excepciones_del_plan'],
  ['sesiones', 'entrenamientos'],
  ['series', 'series'],
]

/**
 * Cada fila de las 12 tablas de datos, enteras y con todas sus columnas. De los ejercicios, solo
 * los propios: los predefinidos no son datos de nadie.
 */
function _foto(bd: Bd): Record<string, unknown[]> {
  return Object.fromEntries(
    TABLAS_DE_DATOS.map(([clave, origen]) => [
      clave,
      bd.todas(`SELECT * FROM ${origen} ORDER BY id`),
    ]),
  )
}

function _nada(bd: Bd): boolean {
  return Object.values(_foto(bd)).every((filas) => filas.length === 0)
}

// --- Comparar sin los ids ----------------------------------------------------
//
// Importar asigna ids nuevos, así que dos exportaciones (o dos respuestas del plan) solo se
// comparan cambiando cada id por su orden de aparición, por separado para cada clase de cosa: así
// dos copias son iguales si y solo si enlazan lo mismo con lo mismo. Las claves se recorren en
// orden alfabético, para que el orden en que se escribió cada objeto no cambie la numeración.

const ESPACIO_DE_CLAVE: Record<string, string> = {
  ejercicio_id: 'ejercicio',
  ejercicio_principal_id: 'ejercicio',
  rutina_id: 'rutina',
  slot_id: 'hueco',
}
const ESPACIO_DEL_ID: Record<string, string> = {
  ejercicios: 'ejercicio',
  predefinidos: 'ejercicio',
  ejercicio: 'ejercicio',
  ejercicio_principal: 'ejercicio',
  rutinas: 'rutina',
  rutina: 'rutina',
  slots: 'hueco',
}

function sin_ids(datos_: unknown): any {
  const vistos = new Map<string, number>()

  const renumerar = (espacio: string, valor: unknown): unknown => {
    if (typeof valor !== 'number' || !Number.isInteger(valor)) return valor
    const clave = `${espacio}|${valor}`
    if (!vistos.has(clave)) vistos.set(clave, vistos.size)
    return vistos.get(clave)
  }

  const recorrer = (valor: unknown, padre: string | null): unknown => {
    if (Array.isArray(valor)) return valor.map((elemento) => recorrer(elemento, padre))
    if (valor === null || typeof valor !== 'object') return valor
    const resultado: Record<string, unknown> = {}
    for (const clave of Object.keys(valor).sort()) {
      const dentro = (valor as Record<string, unknown>)[clave]
      if (clave === 'exportado_en') continue
      if (clave === 'id') {
        resultado[clave] = renumerar(ESPACIO_DEL_ID[padre ?? ''] ?? padre ?? '', dentro)
      } else if (clave.endsWith('_id') || clave.endsWith('_ids')) {
        const espacio = ESPACIO_DE_CLAVE[clave] ?? clave.replace(/s$/, '').replace(/_id$/, '')
        resultado[clave] = Array.isArray(dentro)
          ? dentro.map((x) => renumerar(espacio, x))
          : renumerar(espacio, dentro)
      } else {
        resultado[clave] = recorrer(dentro, clave)
      }
    }
    return resultado
  }

  return recorrer(datos_, null)
}

/**
 * Lo que enseñan las pantallas que dependen de todo a la vez: el seguimiento del plan (qué toca
 * cada día y qué se hizo), la pantalla de hoy y el resumen del mes. El resumen del mes
 * (`/resumen`) se incluye en cuanto la ruta existe en el móvil.
 */
function lo_que_se_ve(cliente: Cliente): any {
  const rango = { desde: '2026-07-27', hasta: '2026-09-27' }
  const respuestas: Record<string, RespuestaDeTest> = {
    seguimiento: cliente.get('/plan/seguimiento', { params: rango }),
    resumen: cliente.get('/resumen', { params: { mes: '2026-09' } }),
    hoy: cliente.get('/plan/hoy'),
    rutinas: cliente.get('/rutinas'),
    rutinas_ocultas: cliente.get('/rutinas', { params: { ocultas: true } }),
    programas: cliente.get('/programas'),
    programas_ocultos: cliente.get('/programas', { params: { ocultos: true } }),
  }
  if (respuestas.resumen.status_code === 404) delete respuestas.resumen
  for (const [nombre, respuesta] of Object.entries(respuestas)) {
    if (respuesta.status_code !== 200) throw new Error(`${nombre}: ${respuesta.text}`)
  }
  return sin_ids(Object.fromEntries(Object.entries(respuestas).map(([n, r]) => [n, r.json()])))
}

// --- 1. Exportar sin datos -------------------------------------------------------

test('exportar_sin_datos_da_el_formato_con_las_listas_vacias', () => {
  // (El nombre del archivo, `training-life-2026-09-16.json`, lo pone la pantalla: aquí no hay
  // cabecera de descarga.)
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)

  const respuesta = cliente.get('/datos/exportar')

  expect(respuesta.status_code).toBe(200)
  const archivo = respuesta.json()
  expect(sin_marca(archivo)).toEqual({
    formato: 'training-life',
    version: 3,
    zona_horaria: 'Europe/Madrid',
    predefinidos: [],
    ejercicios: [],
    notas: [],
    rutinas: [],
    programas: [],
    excepciones: [],
    entrenamientos: [],
  })
  // Con zona: sin ella, al importar se rechazaría su propio archivo.
  expect(archivo.exportado_en).toMatch(/(Z|[+-]\d{2}:?\d{2})$/)
})

// --- 2. Exportar con datos ---------------------------------------------------

test('se_exporta_lo_oculto_lo_cancelado_y_lo_cerrado', () => {
  const e = datos()
  const archivo = exportado(e.cliente)

  const ejercicios: Record<string, any> = Object.fromEntries(
    archivo.ejercicios.map((x: any) => [x.nombre, x]),
  )
  expect(ejercicios['Remo en máquina vieja'].oculto_desde).toBe('2026-08-20')
  expect(ejercicios['Press inclinado con mancuernas'].descripcion).toBe('Banco a 30 grados')
  expect(ejercicios['Press inclinado con mancuernas'].grupo_muscular).toBe(e.grupo)

  const rutinas: Record<string, any> = Object.fromEntries(
    archivo.rutinas.map((r: any) => [r.nombre, r]),
  )
  expect(rutinas.Pull.oculto_desde).toBe('2026-09-14')
  // Los tramos ya cerrados en que estuvo oculta, dentro de su rutina.
  expect(rutinas.Push.periodos_ocultos).toEqual([{ desde: '2026-08-03', hasta: '2026-08-05' }])
  expect(rutinas.Pull.periodos_ocultos).toEqual([])
  expect(rutinas.Push.slots.map((h: any) => h.oculto_desde)).toEqual([null, null, '2026-09-01'])

  const programas: Record<string, any> = Object.fromEntries(
    archivo.programas.map((p: any) => [p.nombre, p]),
  )
  expect(programas.Viejo.oculto_desde).toBe('2026-09-01')
  expect(programas.PPL.periodos).toEqual([
    { desde: '2026-08-01', hasta: '2026-08-15' },
    { desde: '2026-08-31', hasta: null },
  ])
  expect(programas.PPL.dias).toContainEqual({
    dia_semana: 3,
    rutina_id: e.pull,
    desde: null,
    hasta: '2026-09-07',
  })

  expect(archivo.excepciones.map((x: any) => x.rutina_id)).toEqual([e.push, null])

  const sesiones: Record<string, any> = Object.fromEntries(
    archivo.entrenamientos.map((s: any) => [s.fecha, s]),
  )
  expect(sesiones['2026-09-10'].series).toEqual([])
  expect(instante(sesiones['2026-09-10'].terminada_en)).toBe(
    instante('2026-09-07T18:30:12.345678+00:00'),
  )
  expect(sesiones[HOY].terminada_en).toBeNull()
  expect(archivo.entrenamientos).toHaveLength(5)
})

test('las_marcas_de_tiempo_se_exportan_exactas_y_con_zona', () => {
  const { cliente } = datos()
  const archivo = exportado(cliente)

  const sesion = archivo.entrenamientos.find((s: any) => s.fecha === '2026-09-07')
  expect(instante(sesion.terminada_en)).toBe(instante('2026-09-07T18:30:12.345678+00:00'))
  expect(instante(sesion.created_at)).toBe(instante('2026-09-07T16:00:00.000001+00:00'))
  const serie = sesion.series[0]
  expect(instante(serie.created_at)).toBe(instante('2026-09-07T17:01:02.030405+00:00'))
  expect(instante(serie.updated_at)).toBe(instante('2026-09-07T17:05:06.070809+00:00'))
  const nota = archivo.notas[0]
  expect(instante(nota.updated_at)).toBe(instante('2026-08-04T08:00:00.000002+00:00'))
  for (const marca of [sesion.terminada_en, serie.created_at, nota.created_at]) {
    expect(marca).toMatch(/(Z|[+-]\d{2}:?\d{2})$/)
  }
})

test('se_exportan_solo_los_predefinidos_que_usa_algo', () => {
  // Principal, comodín, solo una serie y solo una nota cuentan; uno que no usa nada no se
  // exporta (viene con la app). De cada uno van su id y su nombre, nada más: su tipo y su grupo
  // son los de la instalación que importa.
  const e = datos()
  const archivo = exportado(e.cliente)

  const esperados = [
    [ejercicio_predefinido_id(e.bd), 'Sentadilla con barra'],
    e.comodin,
    e.de_nota,
    e.de_serie,
  ].sort((a: any, b: any) => a[0] - b[0])
  expect(archivo.predefinidos).toEqual(esperados.map(([id, nombre]) => ({ id, nombre })))
  expect(archivo.predefinidos.map((p: any) => p.id)).not.toContain(e.sin_usar[0])
})

test('cada_lista_va_por_id_tambien_dentro_de_cada_padre', () => {
  const e = datos()
  const archivo = exportado(e.cliente)

  for (const lista of ['predefinidos', 'ejercicios', 'rutinas']) {
    const ids = archivo[lista].map((x: any) => x.id)
    expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b))
  }
  const huecos = archivo.rutinas.flatMap((r: any) => r.slots.map((h: any) => h.id))
  expect(huecos).toEqual([...huecos].sort((a: number, b: number) => a - b))
  const push = archivo.rutinas.find((r: any) => r.nombre === 'Push')
  // Los comodines, en el orden de sus filas: el remo se añadió antes.
  expect(push.slots[0].alternativas.map((a: any) => a.ejercicio_id)).toEqual([e.remo, e.comodin[0]])
})

// --- 3. Ida y vuelta ---------------------------------------------------------

test('el_escenario_rellena_cada_campo_del_formato', () => {
  // Si un campo saliera siempre nulo o vacío, la ida y vuelta no vería que se pierde. Esto obliga
  // a que el escenario (con los tipos) lo rellene en algún sitio.
  const { cliente } = datos_por_tipo()
  const archivo = exportado(cliente)
  const rellenos = new Map<string, boolean>()

  const mirar = (valor: unknown, ruta: string): void => {
    if (Array.isArray(valor)) {
      if (!rellenos.has(ruta)) rellenos.set(ruta, false)
      if (valor.length > 0) rellenos.set(ruta, true)
      for (const dentro of valor) mirar(dentro, ruta)
    } else if (valor !== null && typeof valor === 'object') {
      for (const [clave, dentro] of Object.entries(valor)) mirar(dentro, `${ruta}.${clave}`)
    } else {
      rellenos.set(ruta, (rellenos.get(ruta) ?? false) || valor !== null)
    }
  }

  mirar(archivo, '')

  expect([...rellenos].filter(([, relleno]) => !relleno).map(([ruta]) => ruta)).toEqual([])
})

function _sesion(archivo: any, fecha: string): any {
  return archivo.entrenamientos.find((s: any) => s.fecha === fecha)
}

function _rutina(archivo: any, nombre: string): any {
  return archivo.rutinas.find((r: any) => r.nombre === nombre)
}

function _programa(archivo: any, nombre: string): any {
  return archivo.programas.find((p: any) => p.nombre === nombre)
}

test('exportar_escribe_la_version_3_con_el_tipo_y_las_medidas_de_cada_serie', () => {
  const { cliente } = datos_por_tipo()
  const archivo = exportado(cliente)

  expect(archivo.version).toBe(3)
  const tipos = Object.fromEntries(archivo.ejercicios.map((x: any) => [x.nombre, x.tipo_registro]))
  expect(tipos).toEqual({
    'Press inclinado con mancuernas': 'peso_reps',
    'Remo en máquina vieja': 'peso_reps',
    'Dominadas lastradas': 'corporal',
    'Plancha con disco': 'tiempo',
    'Remo con barra': 'peso_reps',
    'Cinta con inclinación': 'cardio',
  })
  const medidas = _sesion(archivo, '2026-09-02').series.map((s: any) => [
    s.peso,
    s.repeticiones,
    s.duracion_s,
    s.peso_corporal,
  ])
  expect(medidas).toEqual([
    ['-20.00', 8, null, '78.50'],
    ['10.00', 6, null, null],
    [null, null, 45, null],
    ['80.00', 5, null, null],
  ])
})

test('exportar_importar_y_exportar_da_el_mismo_archivo', () => {
  // Con todo lo que pueden tener los datos (también los tipos y las medidas), el segundo archivo
  // es igual que el primero salvo los ids. Como se lee de la base, eso ya dice que se guardaron
  // igual el orden de los comodines, las marcas de tiempo, la distancia o la sesión de hoy sin
  // terminar. Las series se miran además columna a columna en la base.
  const { cliente, bd } = datos_por_tipo()
  const antes = exportado(cliente)

  const respuesta = importar(cliente, antes)

  expect(respuesta.status_code).toBe(200)
  const despues = exportado(cliente)
  expect(sin_ids(despues)).toEqual(sin_ids(antes))
  // Los ids sí cambian: si no, la comparación de arriba no probaría nada.
  const ids_antes = new Set(antes.rutinas.map((r: any) => r.id))
  expect(despues.rutinas.filter((r: any) => ids_antes.has(r.id))).toEqual([])
  const series = bd
    .todas<any>(
      `SELECT e.nombre, e.tipo_registro, s.peso_centesimas, s.repeticiones, s.duracion_s,
              s.peso_corporal_centesimas
       FROM series s JOIN ejercicios e ON e.id = s.ejercicio_id
       WHERE e.nombre IN ('Dominadas lastradas', 'Plancha con disco') ORDER BY s.id`,
    )
    .map((s) => [
      s.nombre,
      s.tipo_registro,
      s.peso_centesimas,
      s.repeticiones,
      s.duracion_s,
      s.peso_corporal_centesimas,
    ])
  expect(series).toEqual([
    ['Dominadas lastradas', 'corporal', -2000, 8, null, 7850],
    ['Dominadas lastradas', 'corporal', 1000, 6, null, null],
    ['Plancha con disco', 'tiempo', null, null, 45, null],
    ['Dominadas lastradas', 'corporal', 0, 12, null, 7900],
    ['Plancha con disco', 'tiempo', 1000, null, 90, null],
  ])
})

test('la_ida_y_vuelta_no_cambia_el_plan_el_calendario_ni_el_resumen', () => {
  // El resumen, sobre todo: si un ejercicio volviera con otro tipo, su volumen contaría (o
  // dejaría de contar) y la gráfica cambiaría.
  const { cliente } = datos_por_tipo()
  const antes = lo_que_se_ve(cliente)
  // Que la comparación no sea entre dos listas de descansos: hay de todo.
  const origenes = new Set(antes.seguimiento.map((dia: any) => dia.origen))
  expect(origenes).toEqual(new Set(['excepcion', 'programa', 'sin_programa']))
  const estados = new Set(antes.seguimiento.map((dia: any) => dia.estado))
  for (const estado of ['hecho', 'sin_hacer', 'descanso', 'proximo']) {
    expect(estados).toContain(estado)
  }

  expect(importar(cliente, exportado(cliente)).status_code).toBe(200)

  expect(lo_que_se_ve(cliente)).toEqual(antes)
})

test('importar_acepta_horas_con_otra_zona_y_guarda_el_mismo_instante', () => {
  const { cliente, reloj, bd } = crearCliente()
  reloj.fijar(HOY)
  const archivo = {
    ...VACIO,
    rutinas: [
      {
        id: 7,
        nombre: 'Push',
        created_at: '2026-09-01T20:00:00.5+02:00',
        updated_at: '2026-09-01T18:00:00.5Z',
      },
    ],
  }

  expect(importar(cliente, archivo).status_code).toBe(200)

  const rutina = bd.una<any>('SELECT * FROM rutinas')!
  expect(instante(rutina.created_at)).toBe(instante(rutina.updated_at))
  expect(instante(rutina.created_at)).toBe(instante('2026-09-01T18:00:00.5+00:00'))
})

// --- 4. Importar sustituye ---------------------------------------------------

function _archivo_pequeno(predefinido_id: number, predefinido_nombre: string, grupo: string): any {
  return {
    ...VACIO,
    predefinidos: [{ id: predefinido_id, nombre: predefinido_nombre }],
    ejercicios: [
      {
        id: 500,
        nombre: 'Fondos lastrados',
        grupo_muscular: grupo,
        tipo_registro: 'corporal',
        ...MARCA,
      },
    ],
    notas: [{ ejercicio_id: 500, nota: 'Con cinturón', ...MARCA }],
    rutinas: [
      {
        id: 1,
        nombre: 'Torso',
        ...MARCA,
        slots: [
          {
            id: 10,
            ejercicio_principal_id: 500,
            orden: 1,
            series_objetivo: 3,
            reps_min: 5,
            reps_max: 8,
            alternativas: [
              { ejercicio_id: predefinido_id, series_objetivo: 3, reps_min: 5, reps_max: 8 },
            ],
            ...MARCA,
          },
        ],
      },
    ],
    entrenamientos: [
      {
        rutina_id: 1,
        fecha: '2026-09-14',
        terminada_en: _AHORA,
        ...MARCA,
        series: [
          {
            ejercicio_id: 500,
            slot_id: 10,
            numero_serie: 1,
            peso: '20.00',
            repeticiones: 8,
            ...MARCA,
          },
        ],
      },
    ],
  }
}

function resumen(cliente: Cliente): any {
  const respuesta = cliente.get('/datos/resumen')
  expect(respuesta.status_code).toBe(200)
  return respuesta.json()
}

test('importar_sustituye_todo_lo_que_habia', () => {
  const e = datos()
  const [comodin_id, comodin_nombre] = e.comodin
  const archivo = _archivo_pequeno(comodin_id, comodin_nombre, e.grupo)

  const respuesta = importar(e.cliente, archivo)

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json()).toEqual({
    ejercicios: 1,
    notas: 1,
    rutinas: 1,
    programas: 0,
    sesiones: 1,
    series: 1,
    primera_sesion: '2026-09-14',
    ultima_sesion: '2026-09-14',
  })
  expect(resumen(e.cliente)).toEqual(respuesta.json())
  // El archivo con sus valores por defecto (lo que el formato rellena si falta) y la zona de esta
  // instalación, que al exportar se escribe siempre.
  const normalizado = {
    ...clonar(archivo),
    zona_horaria: 'Europe/Madrid',
    programas: [],
    excepciones: [],
  }
  normalizado.ejercicios[0] = {
    ...normalizado.ejercicios[0],
    descripcion: null,
    oculto_desde: null,
  }
  const hueco = normalizado.rutinas[0].slots[0]
  normalizado.rutinas[0] = {
    ...normalizado.rutinas[0],
    oculto_desde: null,
    periodos_ocultos: [],
    slots: [
      {
        ...hueco,
        duracion_min_s: null,
        duracion_max_s: null,
        oculto_desde: null,
        alternativas: hueco.alternativas.map((a: any) => ({
          ...a,
          duracion_min_s: null,
          duracion_max_s: null,
        })),
      },
    ],
  }
  const sesion = normalizado.entrenamientos[0]
  normalizado.entrenamientos[0] = {
    ...sesion,
    cubre_fecha: null,
    notas: null,
    series: sesion.series.map((s: any) => ({
      ...s,
      duracion_s: null,
      distancia_m: null,
      peso_corporal: null,
      variante: null,
    })),
  }
  expect(sin_ids(exportado(e.cliente))).toEqual(sin_ids(normalizado))
  // Nada de lo de antes, tampoco la nota del predefinido que no se usaba en nada (no se iría con
  // ningún ejercicio).
  expect(
    e.cliente
      .get('/rutinas')
      .json()
      .map((r: any) => r.nombre),
  ).toEqual(['Torso'])
  expect(e.cliente.get('/rutinas', { params: { ocultas: true } }).json()).toEqual([])
  expect(e.cliente.get('/programas', { params: { ocultos: true } }).json()).toEqual([])
  expect(e.cliente.get(`/ejercicios/${e.de_nota[0]}/notas`).json()).toEqual([])
  expect(
    e.cliente
      .get('/plan/excepciones', { params: { desde: '2026-09-01', hasta: '2026-09-30' } })
      .json(),
  ).toEqual([])
})

test('importar_un_archivo_vacio_lo_deja_todo_vacio', () => {
  const { cliente, bd } = datos()

  const respuesta = importar(cliente, VACIO)

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().rutinas).toBe(0)
  expect(respuesta.json().series).toBe(0)
  expect(sin_marca(exportado(cliente))).toEqual({
    ...sin_marca(VACIO),
    zona_horaria: 'Europe/Madrid',
    predefinidos: [],
    ejercicios: [],
    notas: [],
    rutinas: [],
    programas: [],
    excepciones: [],
    entrenamientos: [],
  })
  expect(_nada(bd)).toBe(true)
})

// --- Campos que el formato no conoce -----------------------------------------
//
// Ningún modelo del formato lleva `extra="forbid"`: lo que sobre en un archivo no impide
// cargarlo.

test('un_campo_que_el_formato_no_conoce_se_descarta_sin_perder_nada_mas', () => {
  // Un `esfuerzo` en cada serie (con un número, uno fuera de cualquier escala o nulo) se
  // descarta, al importar y al comprobar, y el resto de cada serie queda tal cual. Lo que se
  // exporta después ya no lo lleva.
  const e = datos()
  const archivo = _archivo_pequeno(e.comodin[0], e.comodin[1], e.grupo)
  const serie = { ejercicio_id: 500, slot_id: 10, ...MARCA }
  archivo.entrenamientos[0].series = [
    {
      ...serie,
      numero_serie: 1,
      peso: '20.50',
      repeticiones: 8,
      esfuerzo: 8.5,
      variante: 'agarre cerrado',
    },
    { ...serie, numero_serie: 2, peso: '22.50', repeticiones: 6, esfuerzo: null },
    { ...serie, numero_serie: 3, peso: '25.00', repeticiones: 4, esfuerzo: 11 },
  ]

  const comprobado = importar(e.cliente, archivo, { comprobar: true })
  expect(comprobado.status_code).toBe(200)
  expect(comprobado.json().archivo.series).toBe(3)

  const respuesta = importar(e.cliente, archivo)
  expect(respuesta.status_code).toBe(200)

  const series = exportado(e.cliente).entrenamientos.flatMap((s: any) => s.series)
  expect(series.map((s: any) => [s.numero_serie, s.peso, s.repeticiones, s.variante])).toEqual([
    [1, '20.50', 8, 'agarre cerrado'],
    [2, '22.50', 6, null],
    [3, '25.00', 4, null],
  ])
  expect(series.some((s: any) => 'esfuerzo' in s)).toBe(false)
})

// --- 5. Un archivo malo no toca nada -----------------------------------------

type Estropear = (a: any) => any

const _sin_formato: Estropear = (a) => {
  delete a.formato
}
const _otro_formato: Estropear = (a) => {
  a.formato = 'otra-app'
}
const _version_4: Estropear = (a) => {
  a.version = 4
}
/** La de antes de los tipos de ejercicio: no se convierte (decisión del autor). */
const _version_1: Estropear = (a) => {
  a.version = 1
}
const _version_texto: Estropear = (a) => {
  a.version = '3'
}
/** Antes, `True == 1` hacía que dijera «versión anterior» en vez de «no es una copia». */
const _version_verdadero: Estropear = (a) => {
  a.version = true
}
const _sin_version: Estropear = (a) => {
  delete a.version
}
const _peso_roto: Estropear = (a) => {
  _sesion(a, '2026-09-07').series[0].peso = 'mucho'
}
const _ejercicio_sin_tipo: Estropear = (a) => {
  delete a.ejercicios[0].tipo_registro
}
const _ejercicio_de_un_tipo_que_no_existe: Estropear = (a) => {
  a.ejercicios[0].tipo_registro = 'natación'
}
const _serie_por_tiempo_de_un_predefinido: Estropear = (a) => {
  // La primera del 9 es de la sentadilla: su tipo es el de esta instalación.
  _sesion(a, '2026-09-09').series[0].duracion_s = 30
}

const MAL_APUNTADA = (fecha: string) => `La sesión del ${fecha} tiene una serie mal apuntada. `

const _hora_sin_zona: Estropear = (a) => {
  _rutina(a, 'Push').created_at = '2026-08-06T07:00:00'
}
const _nombre_vacio: Estropear = (a) => {
  _rutina(a, 'Push').nombre = '   '
}
const _rutina_con_id_repetido: Estropear = (a) => {
  _rutina(a, 'Pull').id = _rutina(a, 'Push').id
}
const _ejercicio_con_el_id_de_un_predefinido: Estropear = (a) => {
  a.ejercicios[0].id = a.predefinidos[0].id
}
const _hueco_con_id_repetido: Estropear = (a) => {
  _rutina(a, 'Pull').slots[0].id = _rutina(a, 'Push').slots[0].id
}
const _nota_de_un_ejercicio_que_no_esta: Estropear = (a) => {
  a.notas[0].ejercicio_id = 999_999
}
const _principal_que_no_esta: Estropear = (a) => {
  _rutina(a, 'Push').slots[1].ejercicio_principal_id = 999_999
}
const _comodin_que_no_esta: Estropear = (a) => {
  const hueco = _rutina(a, 'Push').slots[0]
  hueco.alternativas.push({ ...hueco.alternativas[0], ejercicio_id: 999_999 })
}
const _dia_de_una_rutina_que_no_esta: Estropear = (a) => {
  _programa(a, 'PPL').dias[0].rutina_id = 999_999
}
const _excepcion_de_una_rutina_que_no_esta: Estropear = (a) => {
  a.excepciones[0].rutina_id = 999_999
}
const _sesion_de_una_rutina_que_no_esta: Estropear = (a) => {
  _sesion(a, '2026-09-10').rutina_id = 999_999
}
const _serie_de_un_ejercicio_que_no_esta: Estropear = (a) => {
  _sesion(a, '2026-09-09').series[0].ejercicio_id = 999_999
}
const _serie_en_un_hueco_de_otra_rutina: Estropear = (a) => {
  // La sesión es de Push; el hueco, de Pull.
  _sesion(a, '2026-09-09').series[0].slot_id = _rutina(a, 'Pull').slots[0].id
}
const _serie_en_un_hueco_que_no_esta: Estropear = (a) => {
  _sesion(a, '2026-09-09').series[0].slot_id = 999_999
}
const _dos_ejercicios_en_un_hueco: Estropear = (a) => {
  // La del 9 tiene la sentadilla en su hueco y el remo en el del press: la sentadilla pasa al
  // del remo.
  const [sentadilla, remo] = _sesion(a, '2026-09-09').series
  sentadilla.slot_id = remo.slot_id
  sentadilla.numero_serie = 2
}
const _grupo_que_no_existe: Estropear = (a) => {
  a.ejercicios[0].grupo_muscular = 'Orejas'
}
const _sesiones_el_mismo_dia: Estropear = (a) => {
  _sesion(a, '2026-09-11').fecha = '2026-09-10'
}
const _cubre_fecha_repetida: Estropear = (a) => {
  _sesion(a, '2026-09-11').cubre_fecha = '2026-09-07'
}
const _excepcion_repetida: Estropear = (a) => {
  a.excepciones[1].fecha = a.excepciones[0].fecha
}
const _dos_periodos_abiertos_en_dos_programas: Estropear = (a) => {
  _programa(a, 'Viejo').periodos[0].hasta = null
}
const _dos_periodos_abiertos_en_un_programa: Estropear = (a) => {
  _programa(a, 'PPL').periodos[0].hasta = null
}
const _dos_filas_vigentes_el_mismo_dia: Estropear = (a) => {
  _programa(a, 'PPL').dias[1].hasta = null
}
const _orden_repetido: Estropear = (a) => {
  _rutina(a, 'Push').slots[2].orden = 1
}
const _comodin_repetido: Estropear = (a) => {
  const hueco = _rutina(a, 'Push').slots[0]
  hueco.alternativas.push(clonar(hueco.alternativas[0]))
}
const _dia_con_vigencia_invertida: Estropear = (a) => {
  const dia = _programa(a, 'PPL').dias[1]
  dia.desde = '2026-09-07'
  dia.hasta = '2026-09-07'
}
const _periodo_invertido: Estropear = (a) => {
  _programa(a, 'PPL').periodos[0].hasta = '2026-07-01'
}
const _dia_semana_8: Estropear = (a) => {
  _programa(a, 'PPL').dias[0].dia_semana = 8
}
const _reps_al_reves: Estropear = (a) => {
  const hueco = _rutina(a, 'Push').slots[0]
  hueco.reps_min = 12
  hueco.reps_max = 6
}
const _comodin_con_el_objetivo_a_medias: Estropear = (a) => {
  _rutina(a, 'Push').slots[0].alternativas[0].reps_max = null
}

function _periodo_abierto(a: any): any {
  return _programa(a, 'PPL').periodos.find((p: any) => p.hasta === null)
}

const _programa_que_se_deja_de_usar_despues_de_hoy: Estropear = (a) => {
  _programa(a, 'Viejo').periodos[0].hasta = '2026-09-20'
}

function _tramo_oculto(a: any): any {
  const tramos = _rutina(a, 'Push').periodos_ocultos
  expect(tramos).toHaveLength(1)
  return tramos[0]
}

const _tramo_oculto_vacio: Estropear = (a) => {
  const tramo = _tramo_oculto(a)
  tramo.hasta = tramo.desde
}
const _rutina_mostrada_despues_de_hoy: Estropear = (a) => {
  _tramo_oculto(a).hasta = '2026-09-17'
}
const _periodo_cerrado_entero_en_el_futuro: Estropear = (a) => {
  const periodo = _programa(a, 'Viejo').periodos[0]
  periodo.desde = '2026-09-20'
  periodo.hasta = '2026-09-25'
}
const _zona_vacia: Estropear = (a) => {
  a.zona_horaria = ''
}
const _zona_de_65_caracteres: Estropear = (a) => {
  a.zona_horaria = 'A'.repeat(65)
}
const _cuenta_un_dia_antes_de_su_plazo: Estropear = (a) => {
  // Lo del lunes 14 se puede hacer del 14 al 20: el lunes 7 es antes.
  _sesion(a, '2026-09-07').cubre_fecha = '2026-09-14'
}
const _cuenta_un_dia_despues_de_su_plazo: Estropear = (a) => {
  // Lo del miércoles 2 se puede hacer del lunes 31 de agosto al martes 8: el 9 es después.
  _sesion(a, '2026-09-09').cubre_fecha = '2026-09-02'
}
/**
 * Antes daba 500: el plazo de lo del 9999-12-31 acababa seis días después, una fecha que no
 * existe (`OverflowError` en `plazo()`).
 */
const _cuenta_el_ultimo_dia_que_existe: Estropear = (a) => {
  _sesion(a, '2026-09-07').cubre_fecha = '9999-12-31'
}

/**
 * Añade al archivo otra entrada, con otro id, de un predefinido que ya está, y devuelve su
 * nombre. Las dos entradas son el mismo ejercicio de esta instalación. `como` dice para qué se
 * usa la copia:
 *
 * - `dos-alternativas`: de alternativa en el hueco donde ya lo es la original. Antes daba 500:
 *   chocaban con `UNIQUE(slot_id, ejercicio_id)`.
 * - `alternativa-de-si-mismo`: de alternativa en el hueco donde la original es el principal, que
 *   sería su propia alternativa.
 * - `sin-usar`: para nada; el archivo sigue sin ser uno que la app pueda hacer.
 */
function _predefinido_dos_veces(a: any, como: string): string {
  const ids_predefinidos = new Set(a.predefinidos.map((p: any) => p.id))
  const [primero, segundo] = _rutina(a, 'Push').slots
  let original_id: number
  if (como === 'alternativa-de-si-mismo') {
    original_id = segundo.ejercicio_principal_id
  } else {
    original_id = primero.alternativas.find((c: any) =>
      ids_predefinidos.has(c.ejercicio_id),
    ).ejercicio_id
  }
  expect(ids_predefinidos.has(original_id)).toBe(true)
  const nombre = a.predefinidos.find((p: any) => p.id === original_id).nombre
  a.predefinidos.push({ id: 999_999, nombre })
  const copia = { ...primero.alternativas[0], ejercicio_id: 999_999 }
  if (como === 'dos-alternativas') primero.alternativas.push(copia)
  else if (como === 'alternativa-de-si-mismo') segundo.alternativas.push(copia)
  return nombre
}

const ZONA_CON_BARRA_DE_WINDOWS = 'Europe\\Madrid'

/**
 * En Windows, `ZoneInfo` abría `Europe\Madrid` como si fuera `Europe/Madrid`: el mismo archivo
 * valía en un ordenador y no en otro. Ahora solo valen los nombres de la lista de zonas.
 */
const _zona_con_la_barra_de_windows: Estropear = (a) => {
  a.zona_horaria = ZONA_CON_BARRA_DE_WINDOWS
}
/**
 * Antes daba 500: `ZoneInfo("Europe")` intenta abrir una carpeta y lanza un `OSError`
 * (`PermissionError` en Windows, `IsADirectoryError` en Linux).
 */
const _zona_que_es_una_carpeta: Estropear = (a) => {
  a.zona_horaria = 'Europe'
}

const EN_EL_FUTURO =
  ', un día que todavía no ha llegado. Comprueba la fecha del teléfono o del' +
  ' ordenador que hizo la copia.'
const SESION_EN_EL_FUTURO =
  ' es de un día que todavía no ha llegado. Comprueba la fecha del teléfono o del' +
  ' ordenador que hizo la copia.'
const ZONA_DESCONOCIDA = (zona: string) =>
  `La zona horaria del archivo («${zona}») no la conoce esta versión de la app.`

const USA_UN_EJERCICIO = 'La rutina «Push» usa un ejercicio que no está en el archivo.'

const MALOS: [string, Estropear, string, string | null][] = [
  ['sin_formato', _sin_formato, NO_ES_UNA_COPIA, null],
  ['otro_formato', _otro_formato, NO_ES_UNA_COPIA, null],
  ['version_4', _version_4, MAS_NUEVA, null],
  ['version_1', _version_1, ANTERIOR, null],
  ['version_texto', _version_texto, NO_ES_UNA_COPIA, null],
  ['version_verdadero', _version_verdadero, NO_ES_UNA_COPIA, null],
  ['sin_version', _sin_version, NO_ES_UNA_COPIA, null],
  // La serie del archivo hereda los topes de la de la API (probados uno a uno en `crud.test.ts`
  // y `medidas.test.ts`): con uno basta para ver que los hereda.
  ['peso_roto', _peso_roto, DANADO, 'entrenamientos.0.series.0.peso'],
  ['ejercicio_sin_tipo', _ejercicio_sin_tipo, DANADO, 'ejercicios.0.tipo_registro'],
  [
    'ejercicio_de_un_tipo_que_no_existe',
    _ejercicio_de_un_tipo_que_no_existe,
    DANADO,
    'ejercicios.0.tipo_registro',
  ],
  // Las medidas de cada tipo, en `medidas.test.ts`; aquí, lo propio de importar (el tipo de un
  // predefinido es el de esta instalación; el de un propio, el del archivo, en
  // `una_serie_que_no_cuadra_con_el_tipo_de_su_ejercicio_no_se_importa`).
  [
    'serie_por_tiempo_de_un_predefinido',
    _serie_por_tiempo_de_un_predefinido,
    NO_SE_CAMBIA_NADA,
    MAL_APUNTADA('miércoles 9 de septiembre') +
      '«Sentadilla con barra» se apunta con peso y repeticiones. Sobra la duración.',
  ],
  ['hora_sin_zona', _hora_sin_zona, DANADO, 'rutinas.0.created_at'],
  ['nombre_vacio', _nombre_vacio, DANADO, 'rutinas.0.nombre'],
  [
    'rutina_con_id_repetido',
    _rutina_con_id_repetido,
    NO_SE_CAMBIA_NADA,
    'Hay dos rutinas con el mismo identificador.',
  ],
  [
    'ejercicio_con_el_id_de_un_predefinido',
    _ejercicio_con_el_id_de_un_predefinido,
    NO_SE_CAMBIA_NADA,
    'Hay dos ejercicios con el mismo identificador.',
  ],
  [
    'hueco_con_id_repetido',
    _hueco_con_id_repetido,
    NO_SE_CAMBIA_NADA,
    'Hay dos ejercicios de una rutina con el mismo identificador.',
  ],
  [
    'nota_de_un_ejercicio_que_no_esta',
    _nota_de_un_ejercicio_que_no_esta,
    NO_SE_CAMBIA_NADA,
    'Una nota es de un ejercicio que no está en el archivo.',
  ],
  ['principal_que_no_esta', _principal_que_no_esta, NO_SE_CAMBIA_NADA, USA_UN_EJERCICIO],
  ['comodin_que_no_esta', _comodin_que_no_esta, NO_SE_CAMBIA_NADA, USA_UN_EJERCICIO],
  [
    'dia_de_una_rutina_que_no_esta',
    _dia_de_una_rutina_que_no_esta,
    NO_SE_CAMBIA_NADA,
    'El programa «PPL» usa una rutina que no está en el archivo.',
  ],
  [
    'excepcion_de_una_rutina_que_no_esta',
    _excepcion_de_una_rutina_que_no_esta,
    NO_SE_CAMBIA_NADA,
    'El sábado 12 de septiembre tiene una rutina que no está en el archivo.',
  ],
  [
    'sesion_de_una_rutina_que_no_esta',
    _sesion_de_una_rutina_que_no_esta,
    NO_SE_CAMBIA_NADA,
    'La sesión del jueves 10 de septiembre es de una rutina que no está en el archivo.',
  ],
  [
    'serie_de_un_ejercicio_que_no_esta',
    _serie_de_un_ejercicio_que_no_esta,
    NO_SE_CAMBIA_NADA,
    'La sesión del miércoles 9 de septiembre tiene una serie de un ejercicio que no está' +
      ' en el archivo.',
  ],
  [
    'serie_en_un_hueco_de_otra_rutina',
    _serie_en_un_hueco_de_otra_rutina,
    NO_SE_CAMBIA_NADA,
    'La sesión del miércoles 9 de septiembre tiene una serie fuera de los ejercicios de «Push».',
  ],
  [
    'serie_en_un_hueco_que_no_esta',
    _serie_en_un_hueco_que_no_esta,
    NO_SE_CAMBIA_NADA,
    'La sesión del miércoles 9 de septiembre tiene una serie fuera de los ejercicios de «Push».',
  ],
  // Dos ejercicios en un hueco de una sesión: en sus propios tests, con la frase entera. Un
  // predefinido que aquí no existe, en su propio test (con series y en un hueco).
  [
    'grupo_que_no_existe',
    _grupo_que_no_existe,
    NO_SE_CAMBIA_NADA,
    'El grupo muscular «Orejas» del ejercicio «Press inclinado con mancuernas» no existe en' +
      ' esta versión de la app.',
  ],
  [
    'sesiones_el_mismo_dia',
    _sesiones_el_mismo_dia,
    NO_SE_CAMBIA_NADA,
    'Hay dos sesiones el jueves 10 de septiembre.',
  ],
  [
    'cubre_fecha_repetida',
    _cubre_fecha_repetida,
    NO_SE_CAMBIA_NADA,
    'Hay dos sesiones que cuentan como la del lunes 7 de septiembre.',
  ],
  [
    'excepcion_repetida',
    _excepcion_repetida,
    NO_SE_CAMBIA_NADA,
    'El sábado 12 de septiembre está planificado dos veces.',
  ],
  [
    'dos_periodos_abiertos_en_dos_programas',
    _dos_periodos_abiertos_en_dos_programas,
    NO_SE_CAMBIA_NADA,
    'Hay más de un programa activo a la vez.',
  ],
  [
    'dos_periodos_abiertos_en_un_programa',
    _dos_periodos_abiertos_en_un_programa,
    NO_SE_CAMBIA_NADA,
    'Hay más de un programa activo a la vez.',
  ],
  [
    'dos_filas_vigentes_el_mismo_dia',
    _dos_filas_vigentes_el_mismo_dia,
    NO_SE_CAMBIA_NADA,
    'El programa «PPL» tiene dos rutinas a la vez los miércoles.',
  ],
  [
    'orden_repetido',
    _orden_repetido,
    NO_SE_CAMBIA_NADA,
    'La rutina «Push» tiene dos ejercicios en la posición 1.',
  ],
  // El resto de comodines incoherentes y de objetivos mal formados, en `huecos.test.ts` y
  // `objetivos.test.ts`: el archivo usa las mismas comprobaciones.
  ['comodin_repetido', _comodin_repetido, DANADO, 'rutinas.0.slots.0'],
  ['dia_con_vigencia_invertida', _dia_con_vigencia_invertida, DANADO, 'programas.0.dias.1'],
  ['periodo_invertido', _periodo_invertido, DANADO, 'programas.0.periodos.0'],
  ['dia_semana_8', _dia_semana_8, DANADO, 'programas.0.dias.0.dia_semana'],
  ['reps_al_reves', _reps_al_reves, DANADO, 'rutinas.0.slots.0'],
  [
    'comodin_con_el_objetivo_a_medias',
    _comodin_con_el_objetivo_a_medias,
    DANADO,
    'rutinas.0.slots.0.alternativas.0',
  ],
  ['tramo_oculto_vacio', _tramo_oculto_vacio, DANADO, 'rutinas.0.periodos_ocultos.0'],
  // Un programa abierto, una sesión o una rutina mostrada después de hoy, en los tests de la
  // zona horaria, que dicen desde qué «hoy» se mide.
  [
    'programa_que_se_deja_de_usar_despues_de_hoy',
    _programa_que_se_deja_de_usar_despues_de_hoy,
    NO_SE_CAMBIA_NADA,
    'El programa «Viejo» se dejó de usar el domingo 20 de septiembre' + EN_EL_FUTURO,
  ],
  [
    'periodo_cerrado_entero_en_el_futuro',
    _periodo_cerrado_entero_en_el_futuro,
    NO_SE_CAMBIA_NADA,
    'El programa «Viejo» se empezó a usar el domingo 20 de septiembre' + EN_EL_FUTURO,
  ],
  // Una zona que no existe, en el test de la zona desconocida, más abajo.
  ['zona_vacia', _zona_vacia, NO_SE_CAMBIA_NADA, ZONA_DESCONOCIDA('')],
  ['zona_de_65_caracteres', _zona_de_65_caracteres, DANADO, 'zona_horaria'],
  [
    'cuenta_un_dia_antes_de_su_plazo',
    _cuenta_un_dia_antes_de_su_plazo,
    NO_SE_CAMBIA_NADA,
    'La sesión del lunes 7 de septiembre cuenta como la del lunes 14 de septiembre, fuera de' +
      ' su plazo, que va del lunes 14 de septiembre al domingo 20 de septiembre.',
  ],
  [
    'cuenta_un_dia_despues_de_su_plazo',
    _cuenta_un_dia_despues_de_su_plazo,
    NO_SE_CAMBIA_NADA,
    'La sesión del miércoles 9 de septiembre cuenta como la del miércoles 2 de septiembre,' +
      ' fuera de su plazo, que va del lunes 31 de agosto al martes 8 de septiembre.',
  ],
  [
    'cuenta_el_ultimo_dia_que_existe',
    _cuenta_el_ultimo_dia_que_existe,
    NO_SE_CAMBIA_NADA,
    'La sesión del lunes 7 de septiembre cuenta como la del viernes 31 de diciembre de 9999,' +
      ' fuera de su plazo, que va del lunes 27 de diciembre de 9999 al viernes 31 de diciembre' +
      ' de 9999.',
  ],
  // Un predefinido dos veces con distinto id: su nombre depende de la siembra, así que va en su
  // propio test, con la frase entera.
  [
    'zona_que_es_una_carpeta',
    _zona_que_es_una_carpeta,
    NO_SE_CAMBIA_NADA,
    ZONA_DESCONOCIDA('Europe'),
  ],
  [
    'zona_con_la_barra_de_windows',
    _zona_con_la_barra_de_windows,
    NO_SE_CAMBIA_NADA,
    ZONA_DESCONOCIDA(ZONA_CON_BARRA_DE_WINDOWS),
  ],
]

// Con `comprobar=true`, importar hace lo mismo hasta que el archivo vale, y es la última fase la
// que lo demuestra: estos dos llegan hasta ella, y daban 500 también al comprobar.
const COMPROBADOS = new Set<Estropear>([_cuenta_el_ultimo_dia_que_existe, _zona_que_es_una_carpeta])

// Los que, además de su error, dejan referencias sin su destino.
const IDS_REPETIDOS = new Set<Estropear>([
  _rutina_con_id_repetido,
  _ejercicio_con_el_id_de_un_predefinido,
  _hueco_con_id_repetido,
])

/** Cada caso al importar y, los de `COMPROBADOS`, también al comprobar. */
const CASOS_MALOS: [string, Estropear, string, string | null, boolean][] = MALOS.flatMap(
  ([nombre, estropear, mensaje, error]) =>
    (
      [
        [false, 'importar'],
        [true, 'comprobar'],
      ] as const
    )
      .filter(([comprobar]) => !comprobar || COMPROBADOS.has(estropear))
      .map(([comprobar, como]): [string, Estropear, string, string | null, boolean] => [
        `${nombre}-${como}`,
        estropear,
        mensaje,
        error,
        comprobar,
      ]),
)

test.each(CASOS_MALOS)(
  'un_archivo_malo_da_422_en_espanol_y_no_cambia_nada (%s)',
  (_id, estropear, mensaje, error, comprobar) => {
    const { cliente } = datos()
    const antes = exportado(cliente)
    const archivo = clonar(antes)
    estropear(archivo)

    const respuesta = importar(cliente, archivo, { comprobar })

    expect(respuesta.status_code).toBe(422)
    const detalle = respuesta.json().detail
    expect(detalle.mensaje).toBe(mensaje)
    if (error === null) {
      expect(detalle).not.toHaveProperty('errores')
    } else if (mensaje === DANADO) {
      // Los errores de Pydantic son técnicos (la web no los enseña): basta con que señalen el
      // sitio.
      expect(detalle.errores.some((e: string) => e.includes(error))).toBe(true)
    } else if (IDS_REPETIDOS.has(estropear)) {
      // Un id repetido rompe además lo que lo referencia: va el primero.
      expect(detalle.errores[0]).toBe(error)
    } else {
      // Lo que no cuadra se le enseña a quien importa: la frase entera, y sola.
      expect(detalle.errores).toEqual([error])
    }
    expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
  },
)

const PREDEFINIDO_DOS_VECES: [string, boolean][] = [
  ['dos-alternativas', false],
  ['dos-alternativas', true],
  ['alternativa-de-si-mismo', false],
  ['sin-usar', false],
]

test.each(PREDEFINIDO_DOS_VECES)(
  'un_predefinido_dos_veces_con_distinto_id_da_422_y_no_cambia_nada (%s comprobar=%s)',
  (como, comprobar) => {
    // Antes, comprobar lo daba por bueno en los tres casos; al importar, con las dos alternativas
    // en el mismo hueco daba 500, y los otros dos se cargaban (uno, con un hueco cuyo principal
    // era también su alternativa). Lo que se rechaza es el nombre repetido, se use como se use la
    // copia, y es el único error.
    const { cliente } = datos()
    const antes = exportado(cliente)
    const archivo = clonar(antes)
    const nombre = _predefinido_dos_veces(archivo, como)

    const respuesta = importar(cliente, archivo, { comprobar })

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail).toEqual({
      mensaje: NO_SE_CAMBIA_NADA,
      errores: [`El ejercicio predefinido «${nombre}» está dos veces en el archivo.`],
    })
    expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
  },
)

test('varios_ids_repetidos_se_dicen_una_sola_vez', () => {
  // La frase ya no dice el id, así que dos ids repetidos distintos darían dos frases iguales:
  // sale una vez por clase de cosa (ejercicios, rutinas y ejercicios de una rutina).
  const { cliente } = datos()
  const antes = exportado(cliente)
  const archivo = clonar(antes)
  for (const n of [0, 1]) archivo.ejercicios[n].id = archivo.predefinidos[n].id
  const push = _rutina(archivo, 'Push')
  const pull = _rutina(archivo, 'Pull')
  pull.id = push.id
  push.slots[1].id = push.slots[0].id
  pull.slots[0].id = push.slots[2].id

  const respuesta = importar(cliente, archivo, { comprobar: true })

  expect(respuesta.status_code).toBe(422)
  const errores: string[] = respuesta.json().detail.errores
  for (const frase of [
    'Hay dos ejercicios con el mismo identificador.',
    'Hay dos rutinas con el mismo identificador.',
    'Hay dos ejercicios de una rutina con el mismo identificador.',
  ]) {
    expect(errores.filter((e) => e === frase)).toHaveLength(1)
  }
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

test('dos_rutinas_a_la_vez_el_mismo_dia_lo_dice_en_plural', () => {
  // «Los miércoles» (en la tabla de archivos malos), pero «los sábados»: el día de la semana en
  // plural, sin el número.
  const { cliente } = datos()
  const archivo = exportado(cliente)
  const dias = _programa(archivo, 'PPL').dias
  for (let i = 0; i < 2; i++) dias.push({ ...clonar(dias[0]), dia_semana: 6, hasta: null })

  const respuesta = importar(cliente, archivo, { comprobar: true })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.errores).toEqual([
    'El programa «PPL» tiene dos rutinas a la vez los sábados.',
  ])
})

const _programa_que_empezo_hoy: Estropear = (a) => {
  _periodo_abierto(a).desde = HOY
}
const _programa_que_se_dejo_de_usar_hoy: Estropear = (a) => {
  _periodo_abierto(a).hasta = HOY
}
const _adelantada_dentro_de_su_plazo: Estropear = (a) => {
  // Lo del domingo 13 se hace desde el lunes 7.
  _sesion(a, '2026-09-07').cubre_fecha = '2026-09-13'
}
const _recuperada_el_ultimo_dia_de_su_plazo: Estropear = (a) => {
  // Lo del jueves 3 se recupera hasta el miércoles 9.
  _sesion(a, '2026-09-09').cubre_fecha = '2026-09-03'
}
/**
 * La app las crea ella misma: cambiar un día que ya está hecho esta semana deja el cambio para la
 * semana siguiente (`desde` hasta hoy + 7).
 */
const _dia_de_programa_que_empieza_dentro_de_tres_dias: Estropear = (a) => {
  _programa(a, 'PPL').dias.push({
    dia_semana: 5,
    rutina_id: _rutina(a, 'Push').id,
    desde: '2026-09-19',
    hasta: null,
  })
}
const _rutina_mostrada_hoy: Estropear = (a) => {
  _tramo_oculto(a).hasta = HOY
}
const _rutina_oculta_hoy: Estropear = (a) => {
  _rutina(a, 'Pull').oculto_desde = HOY
}

const BUENOS: [string, Estropear][] = [
  ['rutina_mostrada_hoy', _rutina_mostrada_hoy],
  ['rutina_oculta_hoy', _rutina_oculta_hoy],
  ['programa_que_empezo_hoy', _programa_que_empezo_hoy],
  ['programa_que_se_dejo_de_usar_hoy', _programa_que_se_dejo_de_usar_hoy],
  ['adelantada_dentro_de_su_plazo', _adelantada_dentro_de_su_plazo],
  ['recuperada_el_ultimo_dia_de_su_plazo', _recuperada_el_ultimo_dia_de_su_plazo],
  [
    'dia_de_programa_que_empieza_dentro_de_tres_dias',
    _dia_de_programa_que_empieza_dentro_de_tres_dias,
  ],
]

test.each(BUENOS)('las_fechas_que_la_app_si_crea_se_importan (%s)', (_id, arreglar) => {
  // El borde de las fechas que no han llegado y del plazo de `cubre_fecha`: hoy vale (también una
  // sesión de hoy: la tiene el escenario), y lo de un día dentro de su plazo también. La copia
  // queda tal cual.
  const { cliente } = datos()
  const archivo = exportado(cliente)
  arreglar(archivo)

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(200)
  expect(sin_ids(sin_marca(exportado(cliente)))).toEqual(sin_ids(sin_marca(archivo)))
})

test('los_errores_se_dicen_todos_de_una_vez', () => {
  const { cliente } = datos()
  const archivo = exportado(cliente)
  _grupo_que_no_existe(archivo)
  _sesiones_el_mismo_dia(archivo)
  _orden_repetido(archivo)

  const detalle = importar(cliente, archivo).json().detail

  expect(detalle.errores).toEqual([
    'El grupo muscular «Orejas» del ejercicio «Press inclinado con mancuernas» no existe en' +
      ' esta versión de la app.',
    'La rutina «Push» tiene dos ejercicios en la posición 1.',
    'Hay dos sesiones el jueves 10 de septiembre.',
  ])
})

test('una_sesion_con_dos_ejercicios_en_un_hueco_no_se_importa', () => {
  // En una sesión, cada hueco se hace con un solo ejercicio, también en un archivo: 422 y no se
  // cambia nada. La frase nombra los dos ejercicios (aquí uno propio y uno predefinido), en el
  // orden de sus series, y la rutina.
  const { cliente } = datos()
  const antes = exportado(cliente)
  const archivo = clonar(antes)
  _dos_ejercicios_en_un_hueco(archivo)

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual({
    mensaje: NO_SE_CAMBIA_NADA,
    errores: [
      'La sesión del miércoles 9 de septiembre tiene series de «Sentadilla con barra» y' +
        ' de «Remo en máquina vieja» en el mismo ejercicio de «Push». En una sesión, cada' +
        ' uno se hace con un solo ejercicio.',
    ],
  })
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

test('una_sesion_con_tres_ejercicios_en_un_hueco_los_nombra_con_comas', () => {
  // Con tres o más ejercicios en el mismo hueco, la frase los separa con comas y pone «y» solo
  // antes del último, cada uno con su «de», en el orden de sus series.
  const e = datos()
  const archivo = exportado(e.cliente)
  _dos_ejercicios_en_un_hueco(archivo)
  const series = _sesion(archivo, '2026-09-09').series
  const press = clonar(series[1])
  press.ejercicio_id = e.press
  press.numero_serie = 3
  series.push(press)

  const respuesta = importar(e.cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.errores).toEqual([
    'La sesión del miércoles 9 de septiembre tiene series de «Sentadilla con barra», de' +
      ' «Remo en máquina vieja» y de «Press inclinado con mancuernas» en el mismo ejercicio' +
      ' de «Push». En una sesión, cada uno se hace con un solo ejercicio.',
  ])
})

test('el_mismo_hueco_con_otro_ejercicio_en_otra_sesion_si_se_importa', () => {
  // El otro lado del anterior: el hueco del press se hizo con press el 7 y con el remo el 9 (y en
  // la del 7, cada hueco con el suyo). El escenario ya lo tiene, y esto lo fija para que nadie lo
  // «arregle» juntándolos.
  const e = datos()
  const archivo = exportado(e.cliente)
  const hueco_del_press = _rutina(archivo, 'Push').slots[0].id

  const ejercicios_en = (fecha: string) =>
    new Set(
      _sesion(archivo, fecha)
        .series.filter((s: any) => s.slot_id === hueco_del_press)
        .map((s: any) => s.ejercicio_id),
    )

  expect(ejercicios_en('2026-09-07')).toEqual(new Set([e.press]))
  expect(ejercicios_en('2026-09-09')).toEqual(new Set([e.remo]))
  expect(importar(e.cliente, archivo).status_code).toBe(200)
})

function _de(archivo: any, nombre: string): any {
  return archivo.ejercicios.find((x: any) => x.nombre === nombre)
}

const _dominadas_por_tiempo: Estropear = (a) => {
  _de(a, 'Dominadas lastradas').tipo_registro = 'tiempo'
}
const _distancia_en_una_serie_de_peso_y_repeticiones: Estropear = (a) => {
  _sesion(a, '2026-09-03').series[2].distancia_m = 100
}

// Las medidas de cada tipo, una a una, en `medidas.test.ts` (importar usa la misma regla). Aquí,
// lo propio de importar: el tipo de un propio es el del archivo, y la distancia viaja en él.
const MAL_POR_TIPO: [string, Estropear, string][] = [
  [
    'distancia_en_una_serie_de_peso_y_repeticiones',
    _distancia_en_una_serie_de_peso_y_repeticiones,
    MAL_APUNTADA('jueves 3 de septiembre') +
      '«Remo con barra» se apunta con peso y repeticiones. Sobra la distancia.',
  ],
  // El tipo del archivo manda: las series de un ejercicio se miran con el suyo.
  [
    'dominadas_por_tiempo',
    _dominadas_por_tiempo,
    MAL_APUNTADA('miércoles 2 de septiembre') +
      '«Dominadas lastradas» se apunta por tiempo. Falta la duración y sobran las' +
      ' repeticiones.',
  ],
]

/**
 * Con el archivo estropeado, 422 con esa frase, y no se cambia nada. Cambiar el tipo de un
 * ejercicio descuadra también sus otras series o su objetivo: la frase, entera, entre los
 * errores.
 */
function _no_se_importa_por(cliente: Cliente, estropear: Estropear, error: string): void {
  const antes = exportado(cliente)
  const archivo = clonar(antes)
  estropear(archivo)

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  const detalle = respuesta.json().detail
  expect(detalle.mensaje).toBe(NO_SE_CAMBIA_NADA)
  expect(detalle.errores).toContain(error)
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
}

test.each(MAL_POR_TIPO)(
  'una_serie_que_no_cuadra_con_el_tipo_de_su_ejercicio_no_se_importa (%s)',
  (_id, estropear, error) => {
    _no_se_importa_por(datos_por_tipo().cliente, estropear, error)
  },
)

function _hueco_de(archivo: any, rutina: string, principal: string): any {
  return _rutina(archivo, rutina).slots.find(
    (h: any) => h.ejercicio_principal_id === _de(archivo, principal).id,
  )
}

function _en_reps(objetivo_: any): void {
  Object.assign(objetivo_, {
    reps_min: 6,
    reps_max: 10,
    duracion_min_s: null,
    duracion_max_s: null,
  })
}

function _en_segundos(objetivo_: any): void {
  Object.assign(objetivo_, {
    reps_min: null,
    reps_max: null,
    duracion_min_s: 30,
    duracion_max_s: 60,
  })
}

function _hueco_de_predefinido(archivo: any, rutina: string, nombre: string): any {
  const predefinido = archivo.predefinidos.find((p: any) => p.nombre === nombre)
  return _rutina(archivo, rutina).slots.find(
    (h: any) => h.ejercicio_principal_id === predefinido.id,
  )
}

const _plancha_de_principal_en_reps: Estropear = (a) => {
  _en_reps(_hueco_de(a, 'Core', 'Plancha con disco'))
}
const _dominadas_de_alternativa_en_segundos: Estropear = (a) => {
  const alternativas = _hueco_de(a, 'Core', 'Plancha con disco').alternativas
  expect(alternativas).toHaveLength(1)
  _en_segundos(alternativas[0])
}
/**
 * Un predefinido va por nombre y su tipo es el de esta instalación (peso y repeticiones), no uno
 * que diga el archivo.
 */
const _sentadilla_de_principal_en_segundos: Estropear = (a) => {
  _en_segundos(_hueco_de_predefinido(a, 'Core', 'Sentadilla con barra'))
}
/**
 * El tipo del archivo manda también para el objetivo. Sus series se quedan sin repeticiones, que
 * es otro error: se mira solo el del objetivo.
 */
const _plancha_que_pasa_a_corporal_sin_tocar_su_objetivo: Estropear = (a) => {
  _de(a, 'Plancha con disco').tipo_registro = 'corporal'
}

const MAL_OBJETIVO = 'La rutina «Core» tiene un objetivo mal puesto. '
const EN_SEGUNDOS =
  'El objetivo de «Plancha con disco» va en tiempo y no en repeticiones, porque «Plancha con' +
  ' disco» se apunta por tiempo.'
const OBJETIVOS_QUE_NO_CUADRAN: [string, Estropear, string][] = [
  ['plancha_de_principal_en_reps', _plancha_de_principal_en_reps, MAL_OBJETIVO + EN_SEGUNDOS],
  [
    'dominadas_de_alternativa_en_segundos',
    _dominadas_de_alternativa_en_segundos,
    MAL_OBJETIVO +
      'El objetivo de «Dominadas lastradas» va en repeticiones y no en tiempo,' +
      ' porque «Dominadas lastradas» se apunta con repeticiones y carga.',
  ],
  [
    'sentadilla_de_principal_en_segundos',
    _sentadilla_de_principal_en_segundos,
    MAL_OBJETIVO +
      'El objetivo de «Sentadilla con barra» va en repeticiones y no en tiempo,' +
      ' porque «Sentadilla con barra» se apunta con peso y repeticiones.',
  ],
  [
    'plancha_que_pasa_a_corporal_sin_tocar_su_objetivo',
    _plancha_que_pasa_a_corporal_sin_tocar_su_objetivo,
    MAL_OBJETIVO +
      'El objetivo de «Plancha con disco» va en repeticiones y no en tiempo,' +
      ' porque «Plancha con disco» se apunta con repeticiones y carga.',
  ],
]

test.each(OBJETIVOS_QUE_NO_CUADRAN)(
  'un_objetivo_que_no_cuadra_con_el_tipo_de_su_ejercicio_no_se_importa (%s)',
  (_id, estropear, error) => {
    // El objetivo del principal y el de cada alternativa, cada uno con el tipo de su ejercicio (no
    // con el del principal): 422 que nombra la rutina y el ejercicio, y no se cambia nada. Cada
    // familia, una a una, en `objetivos.test.ts`: importar usa la misma regla.
    _no_se_importa_por(datos_por_tipo().cliente, estropear, error)
  },
)

test('exportar_escribe_el_objetivo_de_cada_alternativa', () => {
  const { cliente } = datos_por_tipo()
  const archivo = exportado(cliente)

  const alternativas = (principal: string) =>
    _hueco_de(archivo, 'Core', principal).alternativas.map((a: any) => {
      const { ejercicio_id: _ejercicio, ...resto } = a
      return resto
    })

  expect(alternativas('Plancha con disco')).toEqual([
    {
      series_objetivo: 2,
      reps_min: 5,
      reps_max: 8,
      duracion_min_s: null,
      duracion_max_s: null,
    },
  ])
  expect(alternativas('Remo con barra')).toEqual([
    {
      series_objetivo: 4,
      reps_min: null,
      reps_max: null,
      duracion_min_s: 20,
      duracion_max_s: 40,
    },
  ])
})

test('un_predefinido_que_no_existe_aqui_con_series_da_422_y_no_un_500', () => {
  // Regresión del plan: el tipo de un predefinido sale de esta instalación, y uno que aquí no
  // existe no tiene tipo. Buscarlo para mirar sus series era un `KeyError` (un 500) en vez del
  // 422 que dice que no existe. La sentadilla es principal de un hueco y tiene series en dos
  // sesiones.
  const { cliente } = datos()
  const antes = exportado(cliente)
  const archivo = clonar(antes)
  const sentadilla = archivo.predefinidos.find((p: any) => p.nombre === 'Sentadilla con barra')
  sentadilla.nombre = 'Sentadilla de cristal'
  expect(
    archivo.entrenamientos.some((x: any) =>
      x.series.some((s: any) => s.ejercicio_id === sentadilla.id),
    ),
  ).toBe(true)

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual({
    mensaje: NO_SE_CAMBIA_NADA,
    errores: [
      'El ejercicio predefinido «Sentadilla de cristal» no existe en esta versión de la app.',
    ],
  })
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

test('como_mucho_se_dicen_veinte_errores', () => {
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const archivo = {
    ...VACIO,
    // Treinta errores distintos: treinta notas de ejercicios que no están darían un solo error,
    // porque la frase ya no dice el id y no se repite.
    excepciones: Array.from({ length: 30 }, (_, n) => ({
      fecha: new Date(Date.UTC(2026, 8, 16 - n)).toISOString().slice(0, 10),
      rutina_id: 1000 + n,
      ...MARCA,
    })),
  }

  const detalle = importar(cliente, archivo).json().detail

  expect(detalle.mensaje).toBe(NO_SE_CAMBIA_NADA)
  expect(detalle.errores).toHaveLength(20)
})

test('un_archivo_que_no_es_un_objeto_da_el_mismo_422_en_espanol', () => {
  // Quien elige un .json cualquiera puede mandar una lista.
  //
  // Bug real: el cuerpo se declaraba `dict = Body(...)` y FastAPI lo rechazaba antes de llegar al
  // endpoint, con su 422 en inglés y `detail` como lista.
  const { cliente } = crearCliente()

  const respuesta = cliente.post('/datos/importar', { json: [] })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual({ mensaje: NO_ES_UNA_COPIA })
})

// --- La zona horaria del archivo ---------------------------------------------
//
// A las 17:30 del miércoles 16 en Madrid (15:30 en UTC) ya son las 00:30 del jueves 17 en Tokio:
// quien exportó allí pudo entrenar "hoy" el 17. Las fechas del futuro se miden con el mayor de
// los dos "hoy", y siempre con el reloj de ahora.

/** El mismo cliente y la misma base, pero con el reloj parado a las 17:30 del 16 en Madrid. */
function reloj_a_las_17_30_del_16_en_madrid(e: Entorno): Cliente {
  const reloj = { hoy: () => '2026-09-16', ahora: () => '2026-09-16T15:30:00.000Z' }
  return new ClienteDeTest({ bd: e.bd, reloj, zona: () => ZONA })
}

function _con_una_sesion_y_un_periodo_del(archivo: any, dia: string, zona: string | null): any {
  if (zona !== null) archivo.zona_horaria = zona
  else delete archivo.zona_horaria
  _sesion(archivo, '2026-09-11').fecha = dia
  _periodo_abierto(archivo).desde = dia
  return archivo
}

function _errores_del_futuro(dia: string): string[] {
  return [
    `El programa «PPL» se empezó a usar el ${en_texto(dia)}` + EN_EL_FUTURO,
    `La sesión del ${en_texto(dia)}` + SESION_EN_EL_FUTURO,
  ]
}

test('lo_de_hoy_en_la_zona_del_archivo_se_importa_aunque_aqui_sea_manana', () => {
  // Con el reloj de antes (`hoy()` a secas, el 16 en Madrid), la sesión y el periodo del 17 daban
  // 422; en Tokio ya es el 17, así que valen. Comprobar dice lo mismo que importar, y la copia
  // queda tal cual (salvo la zona, que al exportar es siempre la de aquí).
  const cliente = reloj_a_las_17_30_del_16_en_madrid(datos())
  const antes = exportado(cliente)
  const archivo = _con_una_sesion_y_un_periodo_del(clonar(antes), '2026-09-17', 'Asia/Tokyo')

  const comprobado = importar(cliente, archivo, { comprobar: true })
  expect(comprobado.status_code).toBe(200)
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(200)
  const despues = exportado(cliente)
  expect(despues.zona_horaria).toBe('Europe/Madrid')
  expect(sin_ids(sin_marca(despues))).toEqual(
    sin_ids(sin_marca({ ...archivo, zona_horaria: 'Europe/Madrid' })),
  )
})

test.each([[null], ['America/New_York']])(
  'sin_zona_o_con_una_que_no_va_por_delante_mañana_sigue_sin_valer (%s)',
  (zona) => {
    // En Nueva York son las 11:30 del 16: no adelanta nada a Madrid (con la de Madrid sería lo
    // mismo: el mayor de los dos "hoy" sigue siendo el 16).
    const cliente = reloj_a_las_17_30_del_16_en_madrid(datos())
    const antes = exportado(cliente)
    const archivo = _con_una_sesion_y_un_periodo_del(clonar(antes), '2026-09-17', zona)

    const respuesta = importar(cliente, archivo)

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail.errores).toEqual(_errores_del_futuro('2026-09-17'))
    expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
  },
)

test('con_la_zona_de_tokio_pasado_mañana_sigue_sin_valer', () => {
  const cliente = reloj_a_las_17_30_del_16_en_madrid(datos())
  const antes = exportado(cliente)
  const archivo = _con_una_sesion_y_un_periodo_del(clonar(antes), '2026-09-18', 'Asia/Tokyo')

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.errores).toEqual(_errores_del_futuro('2026-09-18'))
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

function _ocultar_ejercicio(a: any, dia: string): string {
  a.ejercicios.find((x: any) => x.nombre === 'Remo en máquina vieja').oculto_desde = dia
  return 'El ejercicio «Remo en máquina vieja»'
}

function _ocultar_rutina(a: any, dia: string): string {
  _rutina(a, 'Pull').oculto_desde = dia
  return 'La rutina «Pull»'
}

function _ocultar_hueco(a: any, dia: string): string {
  const hueco = _rutina(a, 'Push').slots[2]
  const nombre = a.ejercicios.find((x: any) => x.id === hueco.ejercicio_principal_id).nombre
  expect(nombre).toBe('Remo en máquina vieja')
  hueco.oculto_desde = dia
  return 'El ejercicio «Remo en máquina vieja» de la rutina «Push»'
}

function _ocultar_programa(a: any, dia: string): string {
  _programa(a, 'Viejo').oculto_desde = dia
  return 'El programa «Viejo»'
}

const OCULTAR: [string, (a: any, dia: string) => string][] = [
  ['ocultar_ejercicio', _ocultar_ejercicio],
  ['ocultar_rutina', _ocultar_rutina],
  ['ocultar_hueco', _ocultar_hueco],
  ['ocultar_programa', _ocultar_programa],
]

test.each(OCULTAR)(
  'algo_oculto_desde_un_dia_que_no_ha_llegado_no_se_importa (%s)',
  (_id, ocultar) => {
    // La app nunca oculta con fecha futura: viene de un reloj mal puesto y dejaría el ejercicio,
    // la rutina o el programa visibles y ocultos a la vez según el día.
    const { cliente } = datos()
    const antes = exportado(cliente)
    const archivo = clonar(antes)
    const quien = ocultar(archivo, '2026-09-17')

    const respuesta = importar(cliente, archivo)

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail.errores).toEqual([
      `${quien} se ocultó el ${en_texto('2026-09-17')}` + EN_EL_FUTURO,
    ])
    expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
  },
)

test('lo_oculto_en_el_hoy_de_la_zona_del_archivo_se_importa', () => {
  // Con el mismo «hoy» que los periodos: en Tokio ya es el 17, aquí aún el 16.
  const cliente = reloj_a_las_17_30_del_16_en_madrid(datos())
  const archivo = clonar(exportado(cliente))
  archivo.zona_horaria = 'Asia/Tokyo'
  _ocultar_rutina(archivo, '2026-09-17')

  expect(importar(cliente, archivo).status_code).toBe(200)

  archivo.zona_horaria = 'America/New_York'
  const antes = exportado(cliente)
  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.errores).toEqual([
    `La rutina «Pull» se ocultó el ${en_texto('2026-09-17')}` + EN_EL_FUTURO,
  ])
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

test('una_rutina_mostrada_en_el_hoy_de_la_zona_del_archivo_se_importa', () => {
  const cliente = reloj_a_las_17_30_del_16_en_madrid(datos())
  const archivo = clonar(exportado(cliente))
  archivo.zona_horaria = 'Asia/Tokyo'
  _rutina_mostrada_despues_de_hoy(archivo)

  expect(importar(cliente, archivo).status_code).toBe(200)

  archivo.zona_horaria = 'America/New_York'
  const antes = exportado(cliente)
  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.errores).toEqual([
    `La rutina «Push» se volvió a mostrar el ${en_texto('2026-09-17')}` + EN_EL_FUTURO,
  ])
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

test('un_archivo_de_la_version_2_se_sigue_cargando_sin_tramos_ocultos', () => {
  // La versión 2 no guardaba los tramos en que una rutina estuvo oculta: se carga igual, sin
  // ellos, y lo siguiente que se exporta ya es de la versión 3.
  const { cliente, bd } = datos()
  const archivo = exportado(cliente)
  archivo.version = 2
  for (const rutina of archivo.rutinas) delete rutina.periodos_ocultos

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(200)
  expect(_foto(bd).tramos_ocultos).toEqual([])
  const de_nuevo = exportado(cliente)
  expect(de_nuevo.version).toBe(3)
  expect(de_nuevo.rutinas.map((r: any) => r.periodos_ocultos)).toEqual([[], []])
  // Sin el tramo, el lunes 3 de agosto vuelve a ser un día de Push sin hacer.
  const lunes = cliente
    .get('/plan/seguimiento', { params: { desde: '2026-08-03', hasta: '2026-08-03' } })
    .json()
  expect(lunes).toHaveLength(1)
  expect([lunes[0].estado, lunes[0].descanso]).toEqual(['sin_hacer', false])
})

test('un_exportado_en_del_futuro_no_relaja_las_fechas', () => {
  // `exportado_en` lo escribió el mismo reloj que puede estar mal: no cuenta como "hoy" de quien
  // exportó, en ninguna zona.
  const cliente = reloj_a_las_17_30_del_16_en_madrid(datos())
  const antes = exportado(cliente)
  const archivo = _con_una_sesion_y_un_periodo_del(clonar(antes), '2026-09-17', null)
  archivo.exportado_en = '2026-09-30T12:00:00+00:00'

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.errores).toEqual(_errores_del_futuro('2026-09-17'))
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

test('con_una_zona_desconocida_el_resto_se_mide_con_el_hoy_de_aqui', () => {
  // La zona que no se conoce es un error más de la lista, y las fechas se siguen comprobando con
  // el "hoy" de Madrid: el 17 no vale.
  const cliente = reloj_a_las_17_30_del_16_en_madrid(datos())
  const antes = exportado(cliente)
  const archivo = _con_una_sesion_y_un_periodo_del(clonar(antes), '2026-09-17', 'Marte/Olympus')

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.errores).toEqual([
    ZONA_DESCONOCIDA('Marte/Olympus'),
    ..._errores_del_futuro('2026-09-17'),
  ])
  expect(sin_marca(exportado(cliente))).toEqual(sin_marca(antes))
})

// --- 6. Comprobar ------------------------------------------------------------

test('comprobar_dice_que_hay_en_el_archivo_y_que_hay_ahora_sin_cambiar_nada', () => {
  const e = datos()
  const antes = exportado(e.cliente)
  const archivo = _archivo_pequeno(e.comodin[0], e.comodin[1], e.grupo)

  const respuesta = importar(e.cliente, archivo, { comprobar: true })

  expect(respuesta.status_code).toBe(200)
  const { exportado_en, ...resto } = respuesta.json()
  expect(instante(exportado_en)).toBe(instante('2026-09-16T10:00:00Z'))
  expect(resto).toEqual({
    archivo: {
      ejercicios: 1,
      notas: 1,
      rutinas: 1,
      programas: 0,
      sesiones: 1,
      series: 1,
      primera_sesion: '2026-09-14',
      ultima_sesion: '2026-09-14',
    },
    // Las sesiones son las que tienen series: la cancelada del 10 no cuenta, la de hoy en curso
    // sí.
    actual: {
      ejercicios: 2,
      notas: 2,
      rutinas: 2,
      programas: 2,
      sesiones: 4,
      series: 7,
      primera_sesion: '2026-09-07',
      ultima_sesion: HOY,
    },
  })
  expect(sin_marca(exportado(e.cliente))).toEqual(sin_marca(antes))
})

test('comprobar_sin_datos_da_ceros_y_fechas_nulas', () => {
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const respuesta = importar(cliente, VACIO, { comprobar: true }).json()

  expect(respuesta.archivo).toEqual(CERO)
  expect(respuesta.actual).toEqual(CERO)
})

// --- 7. El resumen antes de exportar -----------------------------------------
//
// `GET /datos/resumen` es lo que dice el diálogo de exportar: tiene que dar las mismas cifras que
// `actual` en la comprobación de importar, y contar lo que de verdad se guarda (lo oculto sí; los
// predefinidos no, que vienen con la app; una sesión sin series tampoco, ni sus fechas).

test('el_resumen_coincide_con_la_comprobacion_de_importar_su_propio_archivo', () => {
  const { cliente } = datos()
  const comprobacion = importar(cliente, exportado(cliente), { comprobar: true }).json()

  const propio = resumen(cliente)

  expect(propio).toEqual(comprobacion.actual)
  expect(propio).toEqual(comprobacion.archivo)
  // Que no coincidan por estar todo a cero.
  expect([propio.sesiones, propio.series]).toEqual([4, 7])
})

test('el_resumen_cuenta_lo_oculto_y_no_los_predefinidos_ni_las_sesiones_sin_series', () => {
  // Las sesiones sin series (canceladas o vacías) quedan antes y después de las que tienen
  // series: si contaran para las fechas, la primera y la última se moverían. La de hoy, en curso
  // y vacía, tampoco cuenta.
  const { cliente, reloj, bd } = crearCliente()
  reloj.fijar(HOY)
  const predefinido = ejercicio_predefinido_id(bd)
  const g = grupo_muscular_id(cliente)
  const marca = { created_at: AHORA, updated_at: AHORA }
  const oculto = insertar(bd, 'ejercicios', {
    nombre: 'Remo viejo',
    grupo_muscular_id: g,
    tipo_registro: 'peso_reps',
    oculto_desde: '2026-09-01',
    ...marca,
  })
  const rutina = insertar(bd, 'rutinas', { nombre: 'Pull', oculto_desde: '2026-09-14', ...marca })
  insertar(bd, 'programas', { nombre: 'Viejo', oculto_desde: '2026-09-01', ...marca })
  insertar(bd, 'notas_ejercicio', { ejercicio_id: predefinido, nota: 'Asiento en el 4', ...marca })
  // El predefinido es principal de un hueco y tiene series: aun así no se cuenta.
  const hueco = (ejercicio_id: number, orden: number): number =>
    insertar(bd, 'rutina_slots', {
      rutina_id: rutina,
      ejercicio_principal_id: ejercicio_id,
      orden,
      series_objetivo: 3,
      reps_min: 5,
      reps_max: 8,
      ...marca,
    })
  const del_predefinido = hueco(predefinido, 1)
  const del_oculto = hueco(oculto, 2)
  const terminada = '2026-09-01T18:00:00+00:00'

  const sesion = (dia: number, series: [number, number][] = [], campos = {}) => {
    const id = insertar(bd, 'entrenamientos', {
      rutina_id: rutina,
      fecha: `2026-09-${String(dia).padStart(2, '0')}`,
      ...marca,
      ...campos,
    })
    series.forEach(([slot_id, ejercicio_id], i) => {
      insertar(bd, 'series', {
        entrenamiento_id: id,
        slot_id,
        ejercicio_id,
        numero_serie: i + 1,
        peso_centesimas: 6000,
        repeticiones: 8,
        ...marca,
      })
    })
  }

  sesion(1, [], { terminada_en: terminada }) // cancelada, antes
  sesion(2) // vacía sin terminar, antes
  sesion(
    5,
    [
      [del_predefinido, predefinido],
      [del_oculto, oculto],
    ],
    { terminada_en: terminada },
  )
  sesion(8, [[del_oculto, oculto]], { terminada_en: terminada })
  sesion(12, [], { terminada_en: terminada }) // cancelada, después
  sesion(14) // vacía sin terminar, después
  sesion(dia_de(HOY)) // la de hoy, en curso y vacía

  expect(resumen(cliente)).toEqual({
    ejercicios: 1,
    notas: 1,
    rutinas: 1,
    programas: 1,
    sesiones: 2,
    series: 3,
    primera_sesion: '2026-09-05',
    ultima_sesion: '2026-09-08',
  })
})

// --- 8. Predefinidos ---------------------------------------------------------

function _predefinidos_en_bd(bd: Bd): unknown[] {
  return bd.todas(
    `SELECT id, nombre, grupo_muscular_id, descripcion, oculto_desde, updated_at
     FROM ejercicios WHERE es_predefinido = 1 ORDER BY id`,
  )
}

test('importar_no_toca_los_predefinidos', () => {
  // Con los que usa el archivo. Sin ninguno, es `borrar_no_toca_los_predefinidos`.
  const { cliente, bd } = datos()
  const antes = _predefinidos_en_bd(bd)

  expect(importar(cliente, exportado(cliente)).status_code).toBe(200)

  const despues = _predefinidos_en_bd(bd)
  expect(despues).toHaveLength(lista_de_predefinidos().ejercicios.length)
  expect(despues).toEqual(antes)
})

test('los_predefinidos_del_archivo_van_por_nombre_y_no_por_id', () => {
  // El archivo puede venir de otra instalación, donde el mismo predefinido tiene otro id: se
  // busca por nombre y no se crea ninguno.
  const { cliente, reloj, bd } = crearCliente()
  reloj.fijar(HOY)
  const predefinido = ejercicio_predefinido_id(bd)
  const archivo = {
    ...VACIO,
    predefinidos: [{ id: 4242, nombre: 'Sentadilla con barra' }],
    notas: [{ ejercicio_id: 4242, nota: 'Barra baja', ...MARCA }],
    rutinas: [
      {
        id: 1,
        nombre: 'Pierna',
        ...MARCA,
        slots: [
          {
            id: 1,
            ejercicio_principal_id: 4242,
            orden: 1,
            series_objetivo: 5,
            reps_min: 5,
            reps_max: 5,
            ...MARCA,
          },
        ],
      },
    ],
  }
  const antes = _predefinidos_en_bd(bd)

  expect(importar(cliente, archivo).status_code).toBe(200)

  const rutina = cliente.get('/rutinas').json()[0]
  expect(rutina.slots[0].ejercicio_principal.id).toBe(predefinido)
  const notas = cliente.get(`/ejercicios/${predefinido}/notas`).json()
  expect(notas.map((n: any) => n.nota)).toEqual(['Barra baja'])
  expect(_predefinidos_en_bd(bd)).toEqual(antes)
})

test('la_lista_de_ejercicios_del_archivo_solo_trae_los_propios', () => {
  // Los predefinidos van aparte, en `predefinidos`, y solo los que se usan. Si salieran en
  // `ejercicios`, importar el archivo los duplicaría como propios.
  const { cliente, bd } = datos()
  const archivo = exportado(cliente)

  expect(archivo.ejercicios.map((x: any) => x.nombre)).toEqual([
    'Press inclinado con mancuernas',
    'Remo en máquina vieja',
  ])
  const predefinidos = new Set((_predefinidos_en_bd(bd) as any[]).map((fila) => fila.id))
  expect(archivo.ejercicios.filter((x: any) => predefinidos.has(x.id))).toEqual([])
})

test('un_predefinido_del_archivo_no_se_confunde_con_un_propio_del_mismo_nombre', () => {
  // Un predefinido del archivo se busca por nombre solo entre los predefinidos. Si se buscara
  // entre todos, encontraría el propio que importar va a borrar, y la carga apuntaría a un
  // ejercicio que ya no existe (un 500 en vez del 422).
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const propio = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press del autor')
  const archivo = {
    ...VACIO,
    predefinidos: [{ id: 7, nombre: 'Press del autor' }],
    notas: [{ ejercicio_id: 7, nota: 'Con pausa', ...MARCA }],
  }

  const respuesta = importar(cliente, archivo)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual({
    mensaje: NO_SE_CAMBIA_NADA,
    errores: ['El ejercicio predefinido «Press del autor» no existe en esta versión de la app.'],
  })
  expect(cliente.get(`/ejercicios/${propio}`).status_code).toBe(200)
  expect(cliente.get(`/ejercicios/${propio}/notas`).json()).toEqual([])
})

test('con_dos_predefinidos_del_mismo_nombre_el_archivo_va_al_mas_antiguo', () => {
  // Ninguna siembra repite un nombre, pero importar no se fía: si hubiera dos predefinidos con el
  // nombre del archivo, usa el de id más bajo, con su tipo (aquí el repetido es de tiempo: si
  // contara él, el objetivo en repeticiones daría 422).
  const { cliente, reloj, bd } = crearCliente()
  reloj.fijar(HOY)
  const predefinido = ejercicio_predefinido_id(bd)
  const original = bd.una<any>('SELECT * FROM ejercicios WHERE id = ?', predefinido)!
  const repetido = insertar(bd, 'ejercicios', {
    nombre: original.nombre,
    grupo_muscular_id: original.grupo_muscular_id,
    es_predefinido: 1,
    tipo_registro: 'tiempo',
    created_at: AHORA,
    updated_at: AHORA,
  })
  expect(repetido).toBeGreaterThan(predefinido)
  const respuesta = cliente.post('/rutinas', {
    json: { nombre: 'Leg', slots: [{ ejercicio_principal_id: predefinido, ...objetivo() }] },
  })
  expect(respuesta.status_code).toBe(201)

  const importada = importar(cliente, exportado(cliente))

  expect(importada.status_code).toBe(200)
  const rutinas = cliente.get('/rutinas').json()
  expect(rutinas).toHaveLength(1)
  expect(rutinas[0].slots[0].ejercicio_principal.id).toBe(predefinido)
})

// --- 9. Guarda de columnas ---------------------------------------------------
//
// Si se añade una columna a una tabla que se exporta y no se lleva al archivo, la copia la
// perdería en silencio. Cada columna tiene que estar en el objeto del formato o en la lista de lo
// que no se exporta a propósito (y entonces se piensa). Las claves del formato salen del archivo
// que exporta el escenario completo, que rellena todas (`el_escenario_rellena_cada_campo_del_formato`).

interface Formato {
  tabla: string
  /** Las claves del objeto del archivo para esta tabla. */
  claves: (archivo: any) => string[]
  /** Columna → clave con la que va en el archivo, si no se llama igual. */
  renombradas?: Record<string, string>
  /** Columna → por qué no está en el formato. */
  no_se_exporta?: Record<string, string>
}

const claves_de = (lista: (a: any) => any[]) => (a: any) => Object.keys(lista(a)[0])

const FORMATO: Formato[] = [
  {
    tabla: 'ejercicios',
    claves: claves_de((a) => a.ejercicios),
    renombradas: { grupo_muscular_id: 'grupo_muscular' },
    no_se_exporta: {
      es_predefinido: 'los propios nunca lo son; los predefinidos van aparte',
    },
  },
  {
    tabla: 'notas_ejercicio',
    claves: claves_de((a) => a.notas),
    no_se_exporta: { id: 'nada la referencia' },
  },
  { tabla: 'rutinas', claves: claves_de((a) => a.rutinas) },
  {
    tabla: 'rutina_periodos_ocultos',
    claves: claves_de((a) => a.rutinas.flatMap((r: any) => r.periodos_ocultos)),
    no_se_exporta: { id: 'nada la referencia', rutina_id: 'va dentro de su rutina' },
  },
  {
    tabla: 'rutina_slots',
    claves: claves_de((a) => a.rutinas.flatMap((r: any) => r.slots)),
    no_se_exporta: { rutina_id: 'va dentro de su rutina' },
  },
  {
    tabla: 'slot_alternativas',
    claves: claves_de((a) =>
      a.rutinas.flatMap((r: any) => r.slots.flatMap((h: any) => h.alternativas)),
    ),
    // Cada comodín va en `alternativas` de su hueco, con su ejercicio y su objetivo.
    no_se_exporta: { id: 'nada la referencia', slot_id: 'va dentro de su hueco' },
  },
  {
    tabla: 'programas',
    claves: claves_de((a) => a.programas),
    no_se_exporta: { id: 'nada la referencia' },
  },
  {
    tabla: 'programa_dias',
    claves: claves_de((a) => a.programas.flatMap((p: any) => p.dias)),
    no_se_exporta: { id: 'nada la referencia', programa_id: 'va dentro de su programa' },
  },
  {
    tabla: 'programa_periodos',
    claves: claves_de((a) => a.programas.flatMap((p: any) => p.periodos)),
    no_se_exporta: { id: 'nada la referencia', programa_id: 'va dentro de su programa' },
  },
  {
    tabla: 'excepciones_del_plan',
    claves: claves_de((a) => a.excepciones),
    no_se_exporta: { id: 'nada la referencia' },
  },
  {
    tabla: 'entrenamientos',
    claves: claves_de((a) => a.entrenamientos),
    no_se_exporta: { id: 'nada la referencia' },
  },
  {
    tabla: 'series',
    // Los pesos van en kilos con dos decimales, no en centésimas (así los guarda el móvil).
    claves: claves_de((a) => a.entrenamientos.flatMap((s: any) => s.series)),
    renombradas: {
      peso_centesimas: 'peso',
      peso_corporal_centesimas: 'peso_corporal',
    },
    no_se_exporta: { id: 'nada la referencia', entrenamiento_id: 'va dentro de su sesión' },
  },
]

// Tablas que no se exportan enteras (`meta` es la versión del esquema del móvil).
const TABLAS_FUERA = new Set(['grupos_musculares', 'meta', 'sqlite_sequence'])

test.each(FORMATO.map((f) => [f.tabla] as [string]))(
  'cada_columna_de_una_tabla_exportada_esta_en_el_formato_o_excluida (%s)',
  (tabla) => {
    const { cliente, bd } = datos_por_tipo()
    const formato = FORMATO.find((f) => f.tabla === tabla)!
    const columnas = new Set(
      bd.todas<{ name: string }>(`PRAGMA table_info(${tabla})`).map((c) => c.name),
    )
    const en_formato = new Set(formato.claves(exportado(cliente)))
    const renombradas = formato.renombradas ?? {}
    const excluidas = new Set(Object.keys(formato.no_se_exporta ?? {}))

    const sin_sitio = [...columnas].filter(
      (c) => !en_formato.has(renombradas[c] ?? c) && !excluidas.has(c),
    )
    expect(sin_sitio).toEqual([])
    // Una exclusión que ya está en el formato (o que ya no es columna) sobra.
    expect([...excluidas].filter((c) => en_formato.has(c))).toEqual([])
    expect([...excluidas].filter((c) => !columnas.has(c))).toEqual([])
    // Y cada clave del formato viene de una columna (o de las renombradas).
    const origen = new Set([...columnas].map((c) => renombradas[c] ?? c))
    expect([...en_formato].filter((k) => !origen.has(k) && !FORMATO_ANIDADO.has(k))).toEqual([])
  },
)

// Claves del formato que no son columnas: listas que cuelgan de su padre.
const FORMATO_ANIDADO = new Set([
  'slots',
  'alternativas',
  'periodos_ocultos',
  'dias',
  'periodos',
  'series',
])

test('cada_tabla_esta_en_el_formato_o_fuera_a_proposito', () => {
  const { bd } = crearCliente()
  const exportadas = new Set(FORMATO.map((f) => f.tabla))

  const tablas = bd
    .todas<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .map((t) => t.name)

  expect(tablas.filter((t) => !exportadas.has(t) && !TABLAS_FUERA.has(t))).toEqual([])
})

// --- 10. Borrar todo (`DELETE /datos`) ----------------------------------------
//
// Usa el mismo `borrar_todo` que importar, con sentencias directas y sin ids concretos: un
// `WHERE` mal puesto en los ejercicios se llevaría los predefinidos, y uno de menos dejaría algo
// colgado. Tras borrar se tiene que poder empezar de cero sin chocar con nada que quedara (un
// periodo abierto, la sesión de hoy, un nombre de rutina).

function borrar(cliente: Cliente): void {
  const respuesta = cliente.delete('/datos')
  expect(respuesta.status_code).toBe(204)
  expect(respuesta.json()).toBeNull()
}

test('borrar_no_deja_ninguna_fila_ni_hijos_sueltos', () => {
  // Se mira cada tabla entera, no a través de su padre: un hijo que se quedara sin él (un hueco,
  // un comodín, un día, una serie) también saldría.
  const { cliente, bd } = datos()
  const antes = _foto(bd)
  // Que no pase por estar ya vacío: el escenario llena las 12 tablas.
  expect(Object.entries(antes).filter(([, filas]) => filas.length === 0)).toEqual([])

  borrar(cliente)

  expect(_foto(bd)).toEqual(Object.fromEntries(Object.keys(antes).map((tabla) => [tabla, []])))
})

test('borrar_no_toca_los_predefinidos', () => {
  const { cliente, bd } = datos()
  const antes = _predefinidos_en_bd(bd)

  borrar(cliente)

  const despues = _predefinidos_en_bd(bd)
  expect(despues).toHaveLength(lista_de_predefinidos().ejercicios.length)
  expect(despues).toEqual(antes)
})

test('tras_borrar_se_puede_empezar_de_cero', () => {
  // El escenario tenía una rutina «Push», un periodo abierto y la sesión de hoy en curso: si algo
  // de eso quedara, crear la rutina, activar un programa o empezar hoy chocaría con sus
  // restricciones.
  const { cliente, bd } = datos()
  borrar(cliente)

  const rutina = cliente.post('/rutinas', { json: { nombre: 'Push' } })
  expect(rutina.status_code).toBe(201)
  const rutina_id = rutina.json().id
  const programa = cliente.post('/programas', {
    json: {
      nombre: 'PPL',
      activar: true,
      // El 16 de septiembre de 2026 es miércoles.
      dias: [{ dia_semana: 3, rutina_id }],
    },
  })
  expect(programa.status_code).toBe(201)
  const hoy = cliente.get('/plan/hoy').json()
  expect(hoy.sesion).toBeNull()
  expect(hoy.situacion).not.toBe('sin_programa')

  const sesion = entrenar(cliente, HOY, rutina_id)
  expect(sesion.status_code).toBe(201)
  const serie = serie_en(cliente, sesion.json().id, ejercicio_predefinido_id(bd))
  expect(serie.status_code).toBe(201)

  expect(resumen(cliente)).toEqual({
    ...CERO,
    rutinas: 1,
    programas: 1,
    sesiones: 1,
    series: 1,
    primera_sesion: HOY,
    ultima_sesion: HOY,
  })
})

// Para que el compilador no se queje de lo que solo usan algunos escenarios.
void contar
