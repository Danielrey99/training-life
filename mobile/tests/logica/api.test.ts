/**
 * La api que usan las pantallas (`src/logica/api.ts`): copia de los métodos de la web con
 * `peticion` cambiada por `despachar`. Propios del móvil. Lo que se comprueba es lo que solo
 * existe aquí: cómo sale cada fallo (`ErrorDeApi`, `textoDelFallo`, el rastro) y que cada
 * método, con sus parámetros, llega a la ruta y a los filtros que toca. Una errata en una URL
 * o en el nombre de un parámetro de la consulta solo se vería en el teléfono: una ruta que no
 * existe da 404 «Not Found», y un parámetro mal escrito se ignora sin dar error.
 */
import { crearApi, ErrorDeApi, esDelCampo, textoDelFallo, type Api } from '../../src/logica/api'
import type { Contexto } from '../../src/logica/contexto'
import { FalloDeLaApp, conflicto } from '../../src/logica/fallos'
import { cargarFallo, ultimoFallo } from '../../src/logica/rastro'
import type { NuevaSerie } from '../../src/logica/tipos'
import {
  EJERCICIO_YA_NO_EXISTE,
  crear_ejercicio,
  crear_rutina,
  dejar_planificado,
  entrenar,
  esperar_estado,
  objetivo,
  serie_en,
} from '../apoyo/ayudas'
import { baseNueva } from '../apoyo/baseNueva'
import { ClienteDeTest, RelojDeTest, ZONA, crearCliente } from '../apoyo/cliente'
import { grupo_muscular_id } from '../apoyo/conftest'

function nuevaApi() {
  const bd = baseNueva()
  const reloj = new RelojDeTest()
  const ctx: Contexto = { bd, reloj, zona: () => ZONA }
  return { api: crearApi(ctx), bd, ctx }
}

// --- Cómo sale cada fallo -----------------------------------------------------------------------

describe('api', () => {
  test('un_404_sale_como_error_de_api_con_el_texto_del_servidor', async () => {
    const { api } = nuevaApi()

    const fallo = await api.ejercicio(999999).catch((e) => e)

    expect(fallo).toBeInstanceOf(ErrorDeApi)
    expect(fallo.estado).toBe(404)
    expect(fallo.message).toBe(EJERCICIO_YA_NO_EXISTE)
    expect(fallo.detalle).toBe(EJERCICIO_YA_NO_EXISTE)
  })

  test('un_detail_con_mensaje_se_enseña_por_su_mensaje_y_conserva_el_campo', async () => {
    const { api, ctx } = nuevaApi()
    const grupo = grupo_muscular_id(new ClienteDeTest(ctx))
    await api.crearEjercicio({ nombre: 'Remo', grupo_muscular_id: grupo } as any)

    const fallo = await api
      .crearEjercicio({ nombre: 'remo', grupo_muscular_id: grupo } as any)
      .catch((e) => e)

    expect(fallo).toBeInstanceOf(ErrorDeApi)
    expect(fallo.estado).toBe(409)
    expect(fallo.detalle).toEqual({ mensaje: fallo.message, campo: 'nombre' })
    expect(fallo.message).toBe('Ya tienes un ejercicio que se llama «Remo». Elige otro nombre.')
    expect(esDelCampo(fallo, 'nombre')).toBe(true)
    expect(esDelCampo(fallo, 'fecha')).toBe(false)
    expect(textoDelFallo(fallo)).toBe(fallo.message)
  })

  test('un_422_de_una_comprobacion_de_la_app_enseña_su_frase_sin_el_value_error', async () => {
    const { api, bd } = nuevaApi()
    const ejercicio = bd.una<{ id: number }>('SELECT id FROM ejercicios LIMIT 1')!.id

    const fallo = await api
      .crearRutina({
        nombre: 'Push',
        slots: [
          {
            ejercicio_principal_id: ejercicio,
            ...objetivo(3, [10, 6]),
          },
        ],
      } as any)
      .catch((e) => e)

    expect(fallo).toBeInstanceOf(ErrorDeApi)
    expect(fallo.estado).toBe(422)
    expect(fallo.detalle[0].type).toBe('value_error')
    expect(fallo.message).toBe('El máximo de repeticiones no puede ser menor que el mínimo.')
  })

  test('un_422_de_validacion_se_dice_con_palabras_de_la_app_una_sola_vez', async () => {
    const { api } = nuevaApi()

    // Faltan dos campos: dos errores en inglés, una sola frase.
    const fallo = await api.crearEjercicio({} as any).catch((e) => e)

    expect(fallo.estado).toBe(422)
    expect(fallo.detalle.length).toBe(2)
    expect(fallo.message).toBe('Algún dato no es válido. Revísalo e inténtalo de nuevo.')
  })

  test('un_422_mezcla_las_frases_de_la_app_con_la_generica', async () => {
    const { api, bd } = nuevaApi()
    const ejercicio = bd.una<{ id: number }>('SELECT id FROM ejercicios LIMIT 1')!.id

    // Un hueco con el objetivo al revés y otro sin ejercicio ni objetivo.
    const fallo = await api
      .crearRutina({
        nombre: 'Push',
        slots: [{ ejercicio_principal_id: ejercicio, ...objetivo(3, [10, 6]) }, {}],
      } as any)
      .catch((e) => e)

    expect(fallo.estado).toBe(422)
    expect(fallo.message).toBe(
      'El máximo de repeticiones no puede ser menor que el mínimo. ' +
        'Algún dato no es válido. Revísalo e inténtalo de nuevo.',
    )
  })

  test('un_fallo_de_la_consulta_llega_como_422', async () => {
    const { api } = nuevaApi()
    const ejercicio = (await api.ejercicios())[0]

    const fallo = await api.historialDeEjercicio(ejercicio.id, { limite: 0 }).catch((e) => e)
    const bien = await api.historialDeEjercicio(ejercicio.id, { limite: 5 })

    expect(fallo).toBeInstanceOf(ErrorDeApi)
    expect(fallo.estado).toBe(422)
    expect(fallo.detalle[0].loc).toEqual(['query', 'limite'])
    expect(bien).toEqual([])
  })

  test('borrar_devuelve_null_y_crear_devuelve_el_objeto', async () => {
    const { api } = nuevaApi()
    const grupo = (await api.gruposMusculares())[0]

    const creado = await api.crearEjercicio({ nombre: 'Remo', grupo_muscular_id: grupo.id } as any)
    const borrado = await api.borrarEjercicio(creado.id)

    expect(creado.nombre).toBe('Remo')
    expect(borrado).toBeNull()
    await expect(api.ejercicio(creado.id)).rejects.toBeInstanceOf(ErrorDeApi)
  })

  test('un_error_que_no_es_de_la_app_sale_tal_cual_y_no_como_error_de_api', async () => {
    const { ctx } = nuevaApi()
    const roto: Contexto = {
      ...ctx,
      bd: Object.assign(Object.create(ctx.bd), {
        todas: () => {
          throw new Error('fallo de programación')
        },
      }),
    }

    const fallo = await crearApi(roto)
      .gruposMusculares()
      .catch((e) => e)

    expect(fallo).not.toBeInstanceOf(ErrorDeApi)
    expect(fallo).not.toBeInstanceOf(FalloDeLaApp)
    expect(fallo.message).toBe('fallo de programación')
    expect(textoDelFallo(fallo)).toBe('Algo ha fallado. Inténtalo de nuevo.')
    expect(ultimoFallo()?.detalle).toBe('Error: fallo de programación')
  })

  test('un_error_de_la_api_no_se_apunta_en_el_rastro', () => {
    cargarFallo(null)

    textoDelFallo(new ErrorDeApi('Ya existe', 409, 'Ya existe'))

    expect(ultimoFallo()).toBeNull()
  })

  test('un_detail_sin_forma_conocida_cae_en_el_texto_generico', async () => {
    // Un 409 con un `detail` que no es texto, lista ni lleva `mensaje` (el de «sin día para
    // ella» sí lleva `mensaje`; este no): el texto genérico, y el detalle intacto.
    const { ctx } = nuevaApi()
    const roto: Contexto = {
      ...ctx,
      bd: Object.assign(Object.create(ctx.bd), {
        todas: () => {
          throw conflicto({ otra_cosa: 1 })
        },
      }),
    }

    const fallo = await crearApi(roto)
      .gruposMusculares()
      .catch((e) => e)

    expect(fallo).toBeInstanceOf(ErrorDeApi)
    expect(fallo.estado).toBe(409)
    expect(fallo.message).toBe('Algo ha fallado. Inténtalo de nuevo.')
    expect(fallo.detalle).toEqual({ otra_cosa: 1 })
  })

  test('el_cuerpo_pasa_por_json_y_un_undefined_no_llega', async () => {
    const { api } = nuevaApi()
    const grupo = (await api.gruposMusculares())[0]

    // `descripcion: undefined` no viaja, como en `fetch(JSON.stringify(...))`.
    const creado = await api.crearEjercicio({
      nombre: 'Remo',
      grupo_muscular_id: grupo.id,
      descripcion: undefined,
    } as any)

    expect(creado.nombre).toBe('Remo')
  })

  test('crear_ejercicio_de_las_ayudas_y_de_la_api_llegan_al_mismo_sitio', async () => {
    const { api, ctx } = nuevaApi()
    const id = crear_ejercicio(
      new ClienteDeTest(ctx),
      grupo_muscular_id(new ClienteDeTest(ctx)),
      'Remo',
    )

    expect((await api.ejercicio(id)).nombre).toBe('Remo')
  })
})

// --- Cada método llega a su ruta ----------------------------------------------------------------
// Con ids que no existen y cuerpos que valen: cada llamada tiene que llegar al servicio, que da
// su propio 404 («Este ejercicio ya no existe…») o sale bien. Un 404 «Not Found» o un 405 serían
// una URL o un método mal copiados de la web; un 422, un cuerpo o una consulta con otra forma.

const NO_EXISTE = 999999
const FUTURO = '2026-09-20'
const OBJETIVO = {
  series_objetivo: 3,
  reps_min: 8,
  reps_max: 12,
  duracion_min_s: null,
  duracion_max_s: null,
}
const SERIE: NuevaSerie = {
  ejercicio_id: NO_EXISTE,
  slot_id: NO_EXISTE,
  numero_serie: 1,
  peso: 60,
  repeticiones: 8,
  duracion_s: null,
  distancia_m: null,
  peso_corporal: null,
  variante: null,
}
const HUECO = { ejercicio_principal_id: NO_EXISTE, alternativas: [], ...OBJETIVO }

type Llamada = (api: Api, grupo: number) => Promise<unknown>

// Un `Record` con todas las claves de `Api`: un método nuevo sin su llamada no compila.
const LLAMADAS: Record<keyof Api, [Llamada, 'bien' | 404]> = {
  resumenDeDatos: [(api) => api.resumenDeDatos(), 'bien'],
  exportarDatos: [(api) => api.exportarDatos(), 'bien'],
  comprobarImportar: [async (api) => api.comprobarImportar(await api.exportarDatos()), 'bien'],
  importarDatos: [async (api) => api.importarDatos(await api.exportarDatos()), 'bien'],
  borrarDatos: [(api) => api.borrarDatos(), 'bien'],
  gruposMusculares: [(api) => api.gruposMusculares(), 'bien'],
  ejercicios: [(api) => api.ejercicios({ ocultos: true }), 'bien'],
  ejercicio: [(api) => api.ejercicio(NO_EXISTE), 404],
  crearEjercicio: [
    (api, grupo) =>
      api.crearEjercicio({ nombre: 'Remo', grupo_muscular_id: grupo, descripcion: null }),
    'bien',
  ],
  actualizarEjercicio: [
    (api, grupo) =>
      api.actualizarEjercicio(NO_EXISTE, {
        nombre: 'Remo',
        grupo_muscular_id: grupo,
        descripcion: null,
      }),
    404,
  ],
  dondeSeUsa: [(api) => api.dondeSeUsa(NO_EXISTE), 404],
  avisoDeBorrarEjercicio: [(api) => api.avisoDeBorrarEjercicio(NO_EXISTE), 404],
  borrarEjercicio: [(api) => api.borrarEjercicio(NO_EXISTE, 'definitivo'), 404],
  mostrarEjercicio: [(api) => api.mostrarEjercicio(NO_EXISTE), 404],
  historialDeEjercicio: [
    (api) => api.historialDeEjercicio(NO_EXISTE, { hasta: FUTURO, limite: 5 }),
    404,
  ],
  notas: [(api) => api.notas(NO_EXISTE), 404],
  crearNota: [(api) => api.crearNota(NO_EXISTE, 'Agarre cerrado'), 404],
  actualizarNota: [(api) => api.actualizarNota(NO_EXISTE, NO_EXISTE, 'Agarre abierto'), 404],
  borrarNota: [(api) => api.borrarNota(NO_EXISTE, NO_EXISTE), 404],
  rutinas: [(api) => api.rutinas({ ocultas: true }), 'bien'],
  rutina: [(api) => api.rutina(NO_EXISTE), 404],
  crearRutina: [(api) => api.crearRutina({ nombre: 'Push' }), 'bien'],
  actualizarRutina: [(api) => api.actualizarRutina(NO_EXISTE, 'Push', [NO_EXISTE]), 404],
  borrarRutina: [(api) => api.borrarRutina(NO_EXISTE, 'ocultar'), 404],
  mostrarRutina: [(api) => api.mostrarRutina(NO_EXISTE), 404],
  duplicarRutina: [(api) => api.duplicarRutina(NO_EXISTE), 404],
  avisoDeBorrarRutina: [(api) => api.avisoDeBorrarRutina(NO_EXISTE), 404],
  crearHueco: [(api) => api.crearHueco(NO_EXISTE, HUECO), 404],
  actualizarHueco: [
    (api) => api.actualizarHueco(NO_EXISTE, NO_EXISTE, { ...HUECO, orden: 1 }),
    404,
  ],
  borrarHueco: [(api) => api.borrarHueco(NO_EXISTE, NO_EXISTE, 'definitivo'), 404],
  avisoDeBorrarHueco: [(api) => api.avisoDeBorrarHueco(NO_EXISTE, NO_EXISTE), 404],
  mostrarHueco: [(api) => api.mostrarHueco(NO_EXISTE, NO_EXISTE), 404],
  entrenamientos: [
    (api) =>
      api.entrenamientos({
        desde: '2026-09-01',
        hasta: FUTURO,
        sin_terminar: true,
        rutina_id: NO_EXISTE,
        limite: 5,
      }),
    'bien',
  ],
  entrenamiento: [(api) => api.entrenamiento(NO_EXISTE), 404],
  crearEntrenamiento: [
    (api) => api.crearEntrenamiento({ rutina_id: NO_EXISTE, fecha: '2026-09-16', notas: null }),
    404,
  ],
  actualizarEntrenamiento: [
    (api) =>
      api.actualizarEntrenamiento(NO_EXISTE, { fecha: '2026-09-16', notas: null, series: [] }),
    404,
  ],
  terminarEntrenamiento: [(api) => api.terminarEntrenamiento(NO_EXISTE), 404],
  borrarEntrenamiento: [(api) => api.borrarEntrenamiento(NO_EXISTE), 404],
  crearSerie: [(api) => api.crearSerie(NO_EXISTE, SERIE), 404],
  actualizarSerie: [(api) => api.actualizarSerie(NO_EXISTE, NO_EXISTE, SERIE), 404],
  borrarSerie: [(api) => api.borrarSerie(NO_EXISTE, NO_EXISTE), 404],
  borrarSeriesDelHueco: [(api) => api.borrarSeriesDelHueco(NO_EXISTE, NO_EXISTE), 404],
  programas: [(api) => api.programas({ ocultos: true }), 'bien'],
  programa: [(api) => api.programa(NO_EXISTE), 404],
  crearPrograma: [(api) => api.crearPrograma({ nombre: 'PPL', dias: [], activar: false }), 'bien'],
  actualizarPrograma: [
    (api) => api.actualizarPrograma(NO_EXISTE, 'PPL', [{ dia_semana: 1, rutina_id: NO_EXISTE }]),
    404,
  ],
  activarPrograma: [(api) => api.activarPrograma(NO_EXISTE, true), 404],
  desactivarPrograma: [(api) => api.desactivarPrograma(NO_EXISTE), 404],
  mostrarPrograma: [(api) => api.mostrarPrograma(NO_EXISTE), 404],
  borrarPrograma: [(api) => api.borrarPrograma(NO_EXISTE, 'ocultar'), 404],
  seguimiento: [(api) => api.seguimiento('2026-09-01', FUTURO), 'bien'],
  hoy: [(api) => api.hoy('2026-09-14'), 'bien'],
  excepciones: [(api) => api.excepciones({ desde: '2026-09-01', hasta: FUTURO }), 'bien'],
  planificarDia: [(api) => api.planificarDia(FUTURO, null), 'bien'],
  // Sin nada planificado ese día, el 404 de la app («Ese día no estaba cambiado…»).
  restablecerDia: [(api) => api.restablecerDia(FUTURO), 404],
  restablecerRango: [(api) => api.restablecerRango('2026-09-16', FUTURO), 'bien'],
  resumen: [(api) => api.resumen('2026-08'), 'bien'],
}

test('la_tabla_de_llamadas_tiene_todos_los_metodos_de_la_api', () => {
  const { api } = nuevaApi()

  expect(Object.keys(LLAMADAS).sort()).toEqual(Object.keys(api).sort())
})

test.each(Object.entries(LLAMADAS))(
  'cada_metodo_llega_a_su_ruta (%s)',
  async (_, [llamar, sale]) => {
    const { cliente, reloj, bd } = crearCliente()
    reloj.fijar('2026-09-16')
    const api = crearApi({ bd, reloj, zona: () => ZONA })

    const fallo = await llamar(api, grupo_muscular_id(cliente)).then(
      () => null,
      (e: unknown) => e,
    )

    if (sale === 'bien') {
      expect(fallo).toBeNull()
    } else {
      expect(fallo).toBeInstanceOf(ErrorDeApi)
      expect((fallo as ErrorDeApi).estado).toBe(404)
      expect((fallo as ErrorDeApi).detalle).not.toBe('Not Found')
    }
  },
)

// --- Los parámetros de la consulta llegan con su nombre -----------------------------------------
// Cada filtro de la api, frente a la misma consulta escrita a mano con los nombres del backend,
// y frente a no filtrar: si el nombre no llegara, se ignoraría y saldría lo de sin filtro.

/** Dos rutinas con sesiones en tres días, la vieja y su ejercicio ocultos, y dos días planificados. */
function conHistorial() {
  const { cliente, reloj, bd } = crearCliente()
  const api = crearApi({ bd, reloj, zona: () => ZONA })
  reloj.fijar('2026-09-16')
  const grupo = grupo_muscular_id(cliente)
  const press = crear_ejercicio(cliente, grupo, 'Press banca')
  const remo = crear_ejercicio(cliente, grupo, 'Remo')
  const push = crear_rutina(cliente, 'Push')
  const vieja = crear_rutina(cliente, 'Vieja')
  const sesiones: Record<string, number> = {}
  for (const [fecha, rutina, ejercicio] of [
    ['2026-09-07', push, press],
    ['2026-09-09', vieja, remo],
    ['2026-09-14', push, press],
  ] as const) {
    const sesion = entrenar(cliente, fecha, rutina)
    esperar_estado(sesion, 201)
    sesiones[fecha] = sesion.json().id
    esperar_estado(serie_en(cliente, sesiones[fecha], ejercicio), 201)
  }
  esperar_estado(cliente.post(`/entrenamientos/${sesiones['2026-09-07']}/terminar`), 200)
  esperar_estado(cliente.delete(`/ejercicios/${remo}?modo=ocultar`), 204)
  esperar_estado(cliente.delete(`/rutinas/${vieja}?modo=ocultar`), 204)
  dejar_planificado(cliente, '2026-09-18', push)
  dejar_planificado(cliente, '2026-09-25', push)
  return { cliente, api, bd, press, push, sesiones }
}

test('los_filtros_de_ocultos_llegan_con_su_nombre', async () => {
  const { cliente, api, bd } = conHistorial()
  // Un programa oculto, puesto a mano: ocultarlo por la api pide que haya estado activo.
  bd.ejecutar(
    'INSERT INTO programas (nombre, oculto_desde, created_at, updated_at) VALUES (?, ?, ?, ?)',
    'Viejo',
    '2026-09-01',
    '2026-09-01T10:00:00Z',
    '2026-09-01T10:00:00Z',
  )

  const casos: [unknown, unknown, string][] = [
    [await api.ejercicios({ ocultos: true }), await api.ejercicios(), '/ejercicios?ocultos=true'],
    [await api.rutinas({ ocultas: true }), await api.rutinas(), '/rutinas?ocultas=true'],
    [await api.programas({ ocultos: true }), await api.programas(), '/programas?ocultos=true'],
  ]
  for (const [ocultos, visibles, aMano] of casos) {
    expect(ocultos).toEqual(cliente.get(aMano).json())
    expect(ocultos).not.toEqual(visibles)
  }
})

test('los_filtros_de_las_sesiones_y_del_historial_llegan_con_su_nombre', async () => {
  const { cliente, api, push, press } = conHistorial()
  const todas = await api.entrenamientos()

  const casos: [unknown, string][] = [
    [
      await api.entrenamientos({ desde: '2026-09-08', hasta: '2026-09-13' }),
      '/entrenamientos?desde=2026-09-08&hasta=2026-09-13',
    ],
    [await api.entrenamientos({ sin_terminar: true }), '/entrenamientos?sin_terminar=true'],
    [
      await api.entrenamientos({ rutina_id: push, limite: 1 }),
      `/entrenamientos?rutina_id=${push}&limite=1`,
    ],
  ]
  for (const [filtrado, aMano] of casos) {
    expect(filtrado).toEqual(cliente.get(aMano).json())
    expect(filtrado).not.toEqual(todas)
  }

  // Dos sesiones con el press: `hasta` deja la primera y `limite`, la última.
  const hasta = await api.historialDeEjercicio(press, { hasta: '2026-09-10' })
  const limite = await api.historialDeEjercicio(press, { limite: 1 })
  expect(hasta).toEqual(cliente.get(`/ejercicios/${press}/historial?hasta=2026-09-10`).json())
  expect(limite).toEqual(cliente.get(`/ejercicios/${press}/historial?limite=1`).json())
  expect([hasta, limite].map((h) => h.map((s) => s.fecha))).toEqual([
    ['2026-09-07'],
    ['2026-09-14'],
  ])
})

test('los_parametros_del_plan_y_del_resumen_llegan_con_su_nombre', async () => {
  const { cliente, api } = conHistorial()

  expect(await api.hoy('2026-09-14')).toEqual(cliente.get('/plan/hoy?fecha=2026-09-14').json())
  expect(await api.hoy('2026-09-14')).not.toEqual(await api.hoy())
  const delRango = await api.excepciones({ desde: '2026-09-20', hasta: '2026-09-30' })
  expect(delRango).toEqual(
    cliente.get('/plan/excepciones?desde=2026-09-20&hasta=2026-09-30').json(),
  )
  expect(delRango).not.toEqual(await api.excepciones())
  expect(await api.seguimiento('2026-09-07', '2026-09-13')).toEqual(
    cliente.get('/plan/seguimiento?desde=2026-09-07&hasta=2026-09-13').json(),
  )
  expect(await api.resumen('2026-08')).toEqual(cliente.get('/resumen?mes=2026-08').json())
  expect(await api.resumen('2026-08')).not.toEqual(await api.resumen())
})

test('restablecer_la_semana_solo_quita_los_dias_del_rango', async () => {
  const { api } = conHistorial()

  await api.restablecerRango('2026-09-16', '2026-09-20')

  expect((await api.excepciones()).map((e) => e.fecha)).toEqual(['2026-09-25'])
})

test('borrar_con_modo_ocultar_oculta_en_vez_de_pedir_el_modo', async () => {
  const { api, press, push } = conHistorial()

  // Sin el modo, con historial, es un 409 que pide elegir.
  await expect(api.borrarEjercicio(press)).rejects.toMatchObject({ estado: 409 })
  await api.borrarEjercicio(press, 'ocultar')
  await api.borrarRutina(push, 'ocultar')

  expect((await api.ejercicio(press)).oculto_desde).not.toBeNull()
  expect((await api.rutina(push)).oculto_desde).not.toBeNull()
})

test('borrar_las_series_de_un_hueco_solo_se_lleva_las_de_ese_hueco', async () => {
  const { cliente, api, sesiones, push } = conHistorial()
  const sesion = sesiones['2026-09-14']
  const otro = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Curl de prueba')
  esperar_estado(serie_en(cliente, sesion, otro), 201)
  const huecos = (await api.rutina(push)).slots.map((h) => h.id)

  await api.borrarSeriesDelHueco(sesion, huecos[0])

  expect((await api.entrenamiento(sesion)).series.map((s) => s.slot_id)).toEqual([huecos[1]])
})
