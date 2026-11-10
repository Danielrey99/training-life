/**
 * Puerto de `backend/tests/test_crud.py`: el camino feliz de cada CRUD, más las validaciones de
 * entrada que sí protegen algo.
 *
 * No se porta `cada_texto_que_llega_por_la_api_o_en_un_archivo_cabe_en_su_columna` (compara los
 * esquemas de Pydantic con las columnas de SQLAlchemy, que el móvil no tiene; ver
 * `no_aplica.ts`).
 */
import { comparar } from '../../src/logica/reglas/centesimas'
import {
  EJERCICIO_YA_NO_EXISTE,
  ELEGIDO_YA_NO_EXISTE,
  SERIE_DEL_DIA_YA_NO_EXISTE,
  SERIE_YA_NO_EXISTE,
  alternativa,
  crear_ejercicio,
  crear_rutina,
  cuerpo_de_hueco as _hueco,
  cuerpo_de_serie as _serie,
  ejercicio_oculto,
  entrenar,
  objetivo,
  serie_en,
} from '../apoyo/ayudas'
import { crearCliente, type ClienteDeTest as Cliente, type RespuestaDeTest } from '../apoyo/cliente'
import { grupo_muscular_id } from '../apoyo/conftest'
import { contar, filaSerie } from '../apoyo/filas'

const FECHA = '2026-09-04'

test('una_rutina_devuelve_sus_huecos_y_comodines_ya_resueltos', () => {
  // RutinaSlotOut trae los ejercicios completos, no solo sus ids: así el frontend no tiene que
  // cruzar datos contra /ejercicios.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const principal = crear_ejercicio(cliente, g, 'Press banca')
  const comodin = crear_ejercicio(cliente, g, 'Press en máquina')
  const rutina_id = crear_rutina(cliente)
  const respuesta = cliente.post(`/rutinas/${rutina_id}/slots`, {
    json: { ..._hueco(principal), alternativas: [alternativa(comodin, 2, [10, 15])] },
  })
  expect(respuesta.status_code).toBe(201)

  const rutina = cliente.get(`/rutinas/${rutina_id}`).json()
  const hueco = rutina.slots[0]

  expect(hueco.ejercicio_principal.nombre).toBe('Press banca')
  // Cada alternativa trae su ejercicio entero y su propio objetivo, no el del principal.
  expect(hueco.alternativas).toHaveLength(1)
  const resuelta = hueco.alternativas[0]
  expect(resuelta.ejercicio.nombre).toBe('Press en máquina')
  expect(resuelta.ejercicio.tipo_registro).toBe('peso_reps')
  const { ejercicio: _ejercicio, ...resto } = resuelta
  expect(resto).toEqual(objetivo(2, [10, 15]))
})

/** El 422 es justo por ese campo, no por otro del cuerpo. */
function _rechazado_por(respuesta: RespuestaDeTest, campo: string): boolean {
  return (
    respuesta.status_code === 422 &&
    JSON.stringify(respuesta.json().detail.map((e: any) => e.loc)) ===
      JSON.stringify([['body', campo]])
  )
}

test('un_entrenamiento_no_se_admite_sin_rutina', () => {
  // Toda sesión es de una rutina: sin ella, el cuerpo ni siquiera es válido.
  const { cliente } = crearCliente()

  const respuesta = cliente.post('/entrenamientos', { json: { fecha: FECHA, rutina_id: null } })

  expect(_rechazado_por(respuesta, 'rutina_id')).toBe(true)
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

test.each([[false], [true]])(
  'el_put_corrige_fecha_y_notas_e_ignora_la_rutina (%j)',
  (con_series) => {
    // La rutina se fija al crear la sesión, como `cubre_fecha`: el PUT solo corrige la fecha y las
    // notas, y la `rutina_id` que traiga se ignora sin dar error (el esquema no la recibe, así que
    // da igual cuál sea).
    //
    // Tampoco en una sesión vacía: antes, sin series ni `cubre_fecha`, el PUT sí la cambiaba. Con
    // series, el historial de su ejercicio sigue igual (si cambiara, enseñaría la sesión con el
    // nombre de otra rutina).
    const { cliente } = crearCliente()
    const g = grupo_muscular_id(cliente)
    const entrenamiento = entrenar(cliente, FECHA).json()
    let historial = ''
    let historial_antes: any[] = []
    if (con_series) {
      const remo = crear_ejercicio(cliente, g, 'Remo')
      const serie = serie_en(cliente, entrenamiento.id, remo)
      expect(serie.status_code).toBe(201)
      historial = `/ejercicios/${remo}/historial`
      historial_antes = cliente.get(historial).json()
    }
    const otra = crear_rutina(cliente, 'Pull')

    const respuesta = cliente.put(`/entrenamientos/${entrenamiento.id}`, {
      json: { fecha: '2026-09-03', notas: 'Corregida', rutina_id: otra },
    })

    expect(respuesta.status_code).toBe(200)
    expect(respuesta.json().rutina_id).toBe(entrenamiento.rutina_id)
    const guardado = cliente.get(`/entrenamientos/${entrenamiento.id}`).json()
    expect([guardado.rutina_id, guardado.fecha, guardado.notas]).toEqual([
      entrenamiento.rutina_id,
      '2026-09-03',
      'Corregida',
    ])
    if (con_series) {
      // Lo único que cambia en el historial es la fecha corregida.
      const dias = cliente.get(historial).json()
      expect(dias).toHaveLength(1)
      expect({ ...dias[0], fecha: FECHA }).toEqual(historial_antes[0])
    }
  },
)

test('una_serie_no_se_admite_sin_hueco', () => {
  // Toda serie va en un hueco de la rutina de su sesión.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Curl')
  const entrenamiento_id = entrenar(cliente, FECHA).json().id

  const respuesta = cliente.post(`/entrenamientos/${entrenamiento_id}/series`, {
    json: {
      ejercicio_id,
      numero_serie: 1,
      peso: 20,
      repeticiones: 10,
      slot_id: null,
    },
  })

  expect(_rechazado_por(respuesta, 'slot_id')).toBe(true)
  expect(cliente.get(`/entrenamientos/${entrenamiento_id}`).json().series).toEqual([])
})

test('a_una_serie_no_se_le_puede_quitar_el_hueco', () => {
  // Corregir una serie sin hueco se rechaza y la deja como estaba.
  const { cliente } = crearCliente()
  const curl = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Curl')
  const entrenamiento_id = entrenar(cliente, FECHA).json().id
  const serie = serie_en(cliente, entrenamiento_id, curl).json()
  const cuerpo = { ..._serie(cliente, entrenamiento_id, curl, { peso: 80 }), slot_id: null }

  const respuesta = cliente.put(`/entrenamientos/${entrenamiento_id}/series/${serie.id}`, {
    json: cuerpo,
  })

  expect(_rechazado_por(respuesta, 'slot_id')).toBe(true)
  const series = cliente.get(`/entrenamientos/${entrenamiento_id}`).json().series
  expect(series).toHaveLength(1)
  expect([series[0].slot_id, series[0].peso]).toEqual([serie.slot_id, serie.peso])
})

test('no_se_puede_usar_un_grupo_muscular_inexistente', () => {
  // Al crear y al editar: 404 con su mensaje, y nada cambia. El nombre está repetido a propósito:
  // el 404 del grupo se dice antes que el 409 del nombre.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const cuerpo = { nombre: 'Sentadilla con barra', grupo_muscular_id: 9999 }
  const creado = cliente.post('/ejercicios', { json: cuerpo })
  const remo = crear_ejercicio(cliente, g, 'Remo')
  const editado = cliente.put(`/ejercicios/${remo}`, { json: cuerpo })

  for (const respuesta of [creado, editado]) {
    expect(respuesta.status_code).toBe(404)
    expect(respuesta.json().detail).toBe('Ese grupo muscular no existe.')
  }
  const guardado = cliente.get(`/ejercicios/${remo}`).json()
  expect([guardado.nombre, guardado.grupo_muscular_id]).toEqual(['Remo', g])
})

test('un_nombre_formado_solo_por_espacios_no_se_acepta', () => {
  // `min_length=1` mide sin recortar, así que "   " lo esquivaría y se guardaría un ejercicio (o
  // una rutina, o un programa) sin nombre visible.
  const { cliente } = crearCliente()
  const respuestas = [
    cliente.post('/ejercicios', {
      json: { nombre: '   ', grupo_muscular_id: grupo_muscular_id(cliente) },
    }),
    cliente.post('/rutinas', { json: { nombre: '  \n ' } }),
    cliente.post('/programas', { json: { nombre: '\t' } }),
  ]

  for (const respuesta of respuestas) {
    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail.map((error: any) => error.loc)).toEqual([['body', 'nombre']])
  }
})

// --- Notas sobre un ejercicio -------------------------------------------

test('se_pueden_acumular_varias_notas_sobre_el_mismo_ejercicio', () => {
  // No hay `UNIQUE` sobre el ejercicio a propósito: cada nota es una fila independiente, no se
  // sobreescriben entre ellas. Se listan de la más reciente a la más antigua, y las de otro
  // ejercicio no se mezclan.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const ejercicio_id = crear_ejercicio(cliente, g)
  const remo = crear_ejercicio(cliente, g, 'Remo')

  for (const texto of ['Primera', 'Segunda', 'Tercera']) {
    expect(
      cliente.post(`/ejercicios/${ejercicio_id}/notas`, { json: { nota: texto } }).status_code,
    ).toBe(201)
  }
  expect(
    cliente.post(`/ejercicios/${remo}/notas`, { json: { nota: 'Del remo' } }).status_code,
  ).toBe(201)

  const notas = cliente.get(`/ejercicios/${ejercicio_id}/notas`).json()
  expect(notas.map((nota: any) => nota.nota)).toEqual(['Tercera', 'Segunda', 'Primera'])
  expect(
    cliente
      .get(`/ejercicios/${remo}/notas`)
      .json()
      .map((n: any) => n.nota),
  ).toEqual(['Del remo'])
})

test('una_nota_en_blanco_no_se_acepta', () => {
  // Una nota vacía se rechaza por `min_length`, pero `"   "` lo esquivaría si el texto no se
  // recortara antes de medirlo. Al crearla y al editarla.
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))
  const ruta = `/ejercicios/${ejercicio_id}/notas`
  const nota_id = cliente.post(ruta, { json: { nota: 'Buena' } }).json().id

  const respuestas = [
    cliente.post(ruta, { json: { nota: '' } }),
    cliente.post(ruta, { json: { nota: '   ' } }),
    cliente.put(`${ruta}/${nota_id}`, { json: { nota: ' \n ' } }),
  ]

  for (const respuesta of respuestas) {
    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail.map((e: any) => e.loc)).toEqual([['body', 'nota']])
  }
  expect(
    cliente
      .get(ruta)
      .json()
      .map((n: any) => n.nota),
  ).toEqual(['Buena'])
})

test('editar_una_nota_no_la_cambia_de_ejercicio', () => {
  // `nota` es el único campo editable: un `ejercicio_id` en el cuerpo se ignora y la nota sigue
  // en el ejercicio de su ruta.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const remo = crear_ejercicio(cliente, g, 'Remo')
  const jalon = crear_ejercicio(cliente, g, 'Jalón')
  const nota_id = cliente
    .post(`/ejercicios/${remo}/notas`, { json: { nota: 'Original' } })
    .json().id

  const respuesta = cliente.put(`/ejercicios/${remo}/notas/${nota_id}`, {
    json: { nota: 'Editada', ejercicio_id: jalon },
  })

  expect(respuesta.status_code).toBe(200)
  expect([respuesta.json().nota, respuesta.json().ejercicio_id]).toEqual(['Editada', remo])
  expect(
    cliente
      .get(`/ejercicios/${remo}/notas`)
      .json()
      .map((n: any) => n.id),
  ).toEqual([nota_id])
  expect(cliente.get(`/ejercicios/${jalon}/notas`).json()).toEqual([])
})

// --- Editar y borrar: rutinas, huecos y comodines ------------------------

test('editar_un_hueco_cambia_su_ejercicio_y_su_objetivo', () => {
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const banca = crear_ejercicio(cliente, g, 'Press banca')
  const maquina = crear_ejercicio(cliente, g, 'Press en máquina')
  const rutina_id = crear_rutina(cliente)
  const slot_id = cliente.post(`/rutinas/${rutina_id}/slots`, { json: _hueco(banca) }).json().id

  // Mismo orden que ya tenía: no choca consigo mismo.
  const respuesta = cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, {
    json: _hueco(maquina, { series: 3, reps: [8, 12] }),
  })

  expect(respuesta.status_code).toBe(200)
  const hueco = respuesta.json()
  expect(hueco.ejercicio_principal.nombre).toBe('Press en máquina')
  expect([hueco.series_objetivo, hueco.reps_min, hueco.reps_max]).toEqual([3, 8, 12])
})

test('mover_un_hueco_al_orden_de_otro_da_409', () => {
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const rutina_id = crear_rutina(cliente)
  cliente.post(`/rutinas/${rutina_id}/slots`, { json: _hueco(banca, { orden: 1 }) })
  const segundo = cliente
    .post(`/rutinas/${rutina_id}/slots`, { json: _hueco(banca, { orden: 2 }) })
    .json()

  const respuesta = cliente.put(`/rutinas/${rutina_id}/slots/${segundo.id}`, {
    json: _hueco(banca, { orden: 1 }),
  })

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe('Ya hay otro ejercicio en la posición 1 de esta rutina.')
  expect(cliente.get(`/rutinas/${rutina_id}`).json().slots[1].orden).toBe(2)
})

test('un_ejercicio_oculto_no_se_puede_usar_en_un_hueco_nuevo', () => {
  // Ocultar significa que deja de ofrecerse para usarlo.
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  expect(cliente.delete(`/ejercicios/${banca}?modo=ocultar`).status_code).toBe(204)
  const rutina_id = crear_rutina(cliente)

  const respuesta = cliente.post(`/rutinas/${rutina_id}/slots`, { json: _hueco(banca) })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe(ejercicio_oculto('Press banca'))
  expect(cliente.get(`/rutinas/${rutina_id}`).json().slots).toEqual([])
})

// --- Editar y borrar: entrenamientos y series ----------------------------

test('borrar_una_serie_deja_las_demas', () => {
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const entrenamiento_id = entrenar(cliente, FECHA).json().id
  const ruta = `/entrenamientos/${entrenamiento_id}/series`
  const primera = cliente
    .post(ruta, { json: _serie(cliente, entrenamiento_id, banca, { numero: 1 }) })
    .json().id
  cliente.post(ruta, { json: _serie(cliente, entrenamiento_id, banca, { numero: 2 }) })

  expect(cliente.delete(`${ruta}/${primera}`).status_code).toBe(204)

  const series = cliente.get(`/entrenamientos/${entrenamiento_id}`).json().series
  expect(series.map((serie: any) => serie.numero_serie)).toEqual([2])
  const otra_vez = cliente.delete(`${ruta}/${primera}`)
  expect([otra_vez.status_code, otra_vez.json().detail]).toEqual([404, SERIE_YA_NO_EXISTE])
})

test('dos_series_con_el_mismo_numero_salen_por_orden_de_id', () => {
  // `numero_serie` no es único: al borrar una serie y apuntar otra, o al importar, dos de un
  // hueco pueden tener el mismo. Sale antes la primera que se apuntó, aunque se haya corregido
  // después (PostgreSQL la deja detrás en la tabla y, sin desempate, la daría la última).
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const sesion = entrenar(cliente, FECHA).json().id
  const ruta = `/entrenamientos/${sesion}/series`
  const primera = cliente.post(ruta, { json: _serie(cliente, sesion, banca) }).json()
  const segunda = cliente.post(ruta, { json: _serie(cliente, sesion, banca) }).json()
  const corregida = _serie(cliente, sesion, banca, { peso: 70 })
  expect(cliente.put(`${ruta}/${primera.id}`, { json: corregida }).status_code).toBe(200)

  const series = cliente.get(`/entrenamientos/${sesion}`).json().series

  expect(series.map((s: any) => [s.id, s.numero_serie])).toEqual([
    [primera.id, 1],
    [segunda.id, 1],
  ])
})

test('una_serie_no_se_alcanza_por_la_ruta_de_otro_entrenamiento', () => {
  // La serie tiene que ser de la sesión de la ruta: si no, da 404 en el PUT y en el DELETE y no
  // se toca. Las dos sesiones son de la misma rutina, así que el cuerpo del PUT sería válido en
  // cualquiera de ellas: el 404 solo puede ser por la ruta.
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const uno = entrenar(cliente, FECHA).json().id
  const otro = entrenar(cliente, '2026-09-05').json().id
  const serie = cliente
    .post(`/entrenamientos/${uno}/series`, { json: _serie(cliente, uno, banca) })
    .json()
  const cambiada = _serie(cliente, otro, banca, { peso: 90, slot_id: serie.slot_id })

  const editada = cliente.put(`/entrenamientos/${otro}/series/${serie.id}`, { json: cambiada })
  const borrada = cliente.delete(`/entrenamientos/${otro}/series/${serie.id}`)

  for (const respuesta of [editada, borrada]) {
    expect([respuesta.status_code, respuesta.json().detail]).toEqual([404, SERIE_YA_NO_EXISTE])
  }
  expect(cliente.get(`/entrenamientos/${uno}`).json().series).toEqual([serie])
  expect(cliente.get(`/entrenamientos/${otro}`).json().series).toEqual([])
})

test('cancelar_una_sesion_la_borra_con_sus_series', () => {
  // Es el Cancelar sesión del diseño: como si no se hubiera empezado.
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const entrenamiento_id = entrenar(cliente, FECHA).json().id
  cliente.post(`/entrenamientos/${entrenamiento_id}/series`, {
    json: _serie(cliente, entrenamiento_id, banca),
  })

  expect(cliente.delete(`/entrenamientos/${entrenamiento_id}`).status_code).toBe(204)

  expect(cliente.get(`/entrenamientos/${entrenamiento_id}`).status_code).toBe(404)
  expect(cliente.get(`/ejercicios/${banca}/historial`).json()).toEqual([])
})

test('corregir_una_serie_no_la_pasa_a_un_hueco_de_otra_rutina', () => {
  // El hueco de una serie tiene que ser de la rutina de su sesión (si no, la sesión tendría
  // series de un hueco que su rutina no tiene), también al corregirla y aunque el ejercicio sea
  // el principal de los dos huecos. 404 y la serie se queda donde estaba. Al apuntarla, en
  // `un_ejercicio_oculto_o_un_hueco_de_otra_rutina_dan_404_y_no_409`.
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const push = crear_rutina(cliente)
  const pull = crear_rutina(cliente, 'Pull')
  const hueco_de_pull = cliente.post(`/rutinas/${pull}/slots`, { json: _hueco(banca) }).json().id
  const sesion = cliente
    .post('/entrenamientos', { json: { rutina_id: push, fecha: FECHA } })
    .json().id
  const serie = serie_en(cliente, sesion, banca).json()

  const respuesta = cliente.put(`/entrenamientos/${sesion}/series/${serie.id}`, {
    json: _serie(cliente, sesion, banca, { peso: 90, slot_id: hueco_de_pull }),
  })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Ese ejercicio no está en la rutina de esta sesión.')
  expect(cliente.get(`/entrenamientos/${sesion}`).json().series).toEqual([serie])
})

test('un_entrenamiento_no_puede_ser_de_una_rutina_oculta', () => {
  const { cliente } = crearCliente()
  const push = crear_rutina(cliente)
  expect(cliente.delete(`/rutinas/${push}?modo=ocultar`).status_code).toBe(204)

  const respuesta = cliente.post('/entrenamientos', { json: { rutina_id: push, fecha: FECHA } })

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json().detail).toBe('Esa rutina no existe o está oculta.')
  expect(cliente.get('/entrenamientos').json()).toEqual([])
})

// --- Un solo ejercicio por hueco y sesión ---------------------------------
//
// En una sesión, todas las series de un hueco son del mismo ejercicio: apuntar o mover una de
// otro da 409 y no guarda nada. Push tiene dos huecos: el A, de Crunch en polea alta con Plancha
// con lastre de comodín, y el B, de Rueda abdominal de pie con Crunch en polea alta de comodín
// (para poder mover una serie de crunch de A a B). Ninguno se llama como un predefinido: la API
// no lo dejaría crear.

interface Abdominales {
  cliente: Cliente
  bd: ReturnType<typeof crearCliente>['bd']
  crunch: number
  plancha: number
  rueda: number
  push: number
  a: number
  b: number
  sesion: (fecha?: string) => number
}

function abdominales(): Abdominales {
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const crunch = crear_ejercicio(cliente, g, 'Crunch en polea alta')
  const plancha = crear_ejercicio(cliente, g, 'Plancha con lastre')
  const rueda = crear_ejercicio(cliente, g, 'Rueda abdominal de pie')
  const push = crear_rutina(cliente)
  const a = cliente
    .post(`/rutinas/${push}/slots`, {
      json: { ..._hueco(crunch, { orden: 1 }), alternativas: [alternativa(plancha)] },
    })
    .json().id
  const b = cliente
    .post(`/rutinas/${push}/slots`, {
      json: { ..._hueco(rueda, { orden: 2 }), alternativas: [alternativa(crunch)] },
    })
    .json().id

  const sesion = (fecha = FECHA): number => {
    const respuesta = cliente.post('/entrenamientos', { json: { rutina_id: push, fecha } })
    expect(respuesta.status_code).toBe(201)
    return respuesta.json().id
  }

  return { cliente, bd, crunch, plancha, rueda, push, a, b, sesion }
}

function _apuntar(
  cliente: Cliente,
  sesion: number,
  ejercicio_id: number,
  slot_id: number,
  numero = 1,
  peso = 20,
): RespuestaDeTest {
  return cliente.post(`/entrenamientos/${sesion}/series`, {
    json: _serie(cliente, sesion, ejercicio_id, { numero, peso, slot_id }),
  })
}

function _apuntadas(
  cliente: Cliente,
  sesion: number,
  ejercicio_id: number,
  slot_id: number,
  cuantas: number,
): any[] {
  const series: any[] = []
  for (let numero = 1; numero <= cuantas; numero++) {
    const respuesta = _apuntar(cliente, sesion, ejercicio_id, slot_id, numero)
    expect(respuesta.status_code).toBe(201)
    series.push(respuesta.json())
  }
  return series
}

function _series_de(cliente: Cliente, sesion: number): any[] {
  return cliente.get(`/entrenamientos/${sesion}`).json().series
}

/**
 * El 409 de mezclar, para los tests que no fijan el texto (lo fijan, literal, los dos primeros
 * de abajo).
 */
function _mezcla(cuantas: number, anterior: string, nuevo: string): string {
  const [las, esas] =
    cuantas === 1 ? ['la serie', 'esa serie'] : [`las ${cuantas} series`, 'esas series']
  return (
    `Esta sesión ya tiene ${las} de «${anterior}» en ese ejercicio de la rutina, y en cada` +
    ` uno se hace un solo ejercicio por sesión. Borra antes ${esas} para apuntar «${nuevo}».`
  )
}

test('no_se_apunta_una_serie_de_otro_ejercicio_en_un_hueco_que_ya_tiene_series', () => {
  // Con la serie del crunch apuntada, la plancha (comodín del mismo hueco) ya no cabe en esa
  // sesión: 409 con el texto que enseña la web, y no se guarda.
  const e = abdominales()
  const sesion = e.sesion()
  const [crunch] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 1)

  const respuesta = _apuntar(e.cliente, sesion, e.plancha, e.a, 2)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe(
    'Esta sesión ya tiene la serie de «Crunch en polea alta» en ese ejercicio de la rutina,' +
      ' y en cada uno se hace un solo ejercicio por sesión. Borra antes esa serie para' +
      ' apuntar «Plancha con lastre».',
  )
  expect(_series_de(e.cliente, sesion)).toEqual([crunch])
})

test('el_409_de_mezclar_cuenta_las_series_en_plural', () => {
  const e = abdominales()
  const sesion = e.sesion()
  _apuntadas(e.cliente, sesion, e.crunch, e.a, 3)

  const respuesta = _apuntar(e.cliente, sesion, e.plancha, e.a, 4)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe(
    'Esta sesión ya tiene las 3 series de «Crunch en polea alta» en ese ejercicio de la rutina,' +
      ' y en cada uno se hace un solo ejercicio por sesión. Borra antes esas series para' +
      ' apuntar «Plancha con lastre».',
  )
  expect(_series_de(e.cliente, sesion)).toHaveLength(3)
})

test('el_mismo_hueco_admite_otro_ejercicio_en_otra_sesion', () => {
  // La regla es por sesión, y mira la de la ruta: el 5 se hace con plancha aunque el 4 se
  // hiciera con crunch, y después el crunch ya no cabe en la del 5 aunque sí estuviera en la del
  // 4.
  const e = abdominales()
  const dia_4 = e.sesion('2026-09-04')
  const dia_5 = e.sesion('2026-09-05')
  _apuntadas(e.cliente, dia_4, e.crunch, e.a, 2)

  const con_plancha = _apuntar(e.cliente, dia_5, e.plancha, e.a)
  const con_crunch = _apuntar(e.cliente, dia_5, e.crunch, e.a, 2)

  expect(con_plancha.status_code).toBe(201)
  expect([con_crunch.status_code, con_crunch.json().detail]).toEqual([
    409,
    _mezcla(1, 'Plancha con lastre', 'Crunch en polea alta'),
  ])
  expect(_series_de(e.cliente, dia_5).map((s) => s.ejercicio_id)).toEqual([e.plancha])
})

test('otro_hueco_de_la_misma_sesion_admite_otro_ejercicio', () => {
  // La regla es por hueco: el crunch en A y la rueda en B conviven.
  const e = abdominales()
  const sesion = e.sesion()
  _apuntadas(e.cliente, sesion, e.crunch, e.a, 1)

  const respuesta = _apuntar(e.cliente, sesion, e.rueda, e.b)

  expect(respuesta.status_code).toBe(201)
})

test('cambiar_el_ejercicio_de_la_unica_serie_del_hueco_si_se_puede', () => {
  // No mezcla nada: la propia serie no cuenta. Después, el hueco es de plancha en esa sesión, y
  // el crunch ya no cabe.
  const e = abdominales()
  const sesion = e.sesion()
  const [serie] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 1)

  const respuesta = e.cliente.put(`/entrenamientos/${sesion}/series/${serie.id}`, {
    json: _serie(e.cliente, sesion, e.plancha, { slot_id: e.a }),
  })

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().ejercicio_id).toBe(e.plancha)
  const despues = _apuntar(e.cliente, sesion, e.crunch, e.a, 2)
  expect([despues.status_code, despues.json().detail]).toEqual([
    409,
    _mezcla(1, 'Plancha con lastre', 'Crunch en polea alta'),
  ])
})

test('cambiar_el_ejercicio_de_una_serie_con_mas_del_anterior_da_409', () => {
  // Quedarían las otras dos de crunch con una de plancha: 409, que cuenta las que quedan (no la
  // que se cambia), y la serie se relee igual.
  const e = abdominales()
  const sesion = e.sesion()
  const [primera] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 3)

  const respuesta = e.cliente.put(`/entrenamientos/${sesion}/series/${primera.id}`, {
    json: _serie(e.cliente, sesion, e.plancha, { peso: 99, slot_id: e.a }),
  })

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe(_mezcla(2, 'Crunch en polea alta', 'Plancha con lastre'))
  expect(_series_de(e.cliente, sesion)[0]).toEqual(primera)
})

test('mover_una_serie_a_un_hueco_con_series_de_otro_ejercicio_da_409', () => {
  // El crunch es comodín de B, así que el hueco vale (no es un 422), pero B ya tiene la rueda en
  // esa sesión. Se mira el hueco de destino, no el de origen.
  const e = abdominales()
  const sesion = e.sesion()
  const [crunch] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 1)
  _apuntadas(e.cliente, sesion, e.rueda, e.b, 1)

  const respuesta = e.cliente.put(`/entrenamientos/${sesion}/series/${crunch.id}`, {
    json: _serie(e.cliente, sesion, e.crunch, { slot_id: e.b }),
  })

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toBe(_mezcla(1, 'Rueda abdominal de pie', 'Crunch en polea alta'))
  expect(_series_de(e.cliente, sesion)[0]).toEqual(crunch)
})

test('mover_una_serie_a_un_hueco_vacio_o_con_su_ejercicio_si_se_puede', () => {
  // El otro lado del anterior: en B solo hay crunch (o nada), así que mover una serie de crunch
  // de A a B no mezcla nada, aunque A siga teniendo más crunch.
  const e = abdominales()
  const sesion = e.sesion()
  const [primera, segunda] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 2)
  const ruta = `/entrenamientos/${sesion}/series`

  const a_vacio = e.cliente.put(`${ruta}/${primera.id}`, {
    json: _serie(e.cliente, sesion, e.crunch, { slot_id: e.b }),
  })
  const con_crunch = e.cliente.put(`${ruta}/${segunda.id}`, {
    json: _serie(e.cliente, sesion, e.crunch, { numero: 2, slot_id: e.b }),
  })

  expect(a_vacio.status_code).toBe(200)
  expect(con_crunch.status_code).toBe(200)
  expect(new Set(_series_de(e.cliente, sesion).map((s) => s.slot_id))).toEqual(new Set([e.b]))
})

test('corregir_peso_reps_o_variante_de_una_serie_no_mira_el_hueco', () => {
  const e = abdominales()
  const sesion = e.sesion()
  const [primera] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 2)
  _apuntadas(e.cliente, sesion, e.rueda, e.b, 1)

  const respuesta = e.cliente.put(`/entrenamientos/${sesion}/series/${primera.id}`, {
    json: {
      ..._serie(e.cliente, sesion, e.crunch, { peso: 25, repeticiones: 15, slot_id: e.a }),
      variante: 'con cuerda',
    },
  })

  expect(respuesta.status_code).toBe(200)
  const corregida = respuesta.json()
  expect(comparar(corregida.peso, '25')).toBe(0)
  expect([corregida.repeticiones, corregida.variante]).toEqual([15, 'con cuerda'])
})

test('una_sesion_mezclada_de_antes_del_blindaje_se_sigue_pudiendo_corregir', () => {
  // Datos de antes de la regla (la API ya no deja montarlos, así que van a mano en la base):
  // corregir el peso de una serie sin cambiar su hueco ni su ejercicio no es mezclar nada nuevo,
  // así que no da 409. Es lo único que distingue que el PUT solo mire la regla cuando cambia el
  // par (hueco, ejercicio).
  const e = abdominales()
  const sesion = e.sesion()
  const [crunch] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 1)
  filaSerie(e.bd, sesion, e.a, e.plancha, {
    numero_serie: 2,
    peso_centesimas: 0,
    repeticiones: 30,
  })

  const respuesta = e.cliente.put(`/entrenamientos/${sesion}/series/${crunch.id}`, {
    json: _serie(e.cliente, sesion, e.crunch, { peso: 22.5, slot_id: e.a }),
  })

  expect(respuesta.status_code).toBe(200)
  expect(comparar(respuesta.json().peso, '22.5')).toBe(0)
})

test('un_ejercicio_que_no_es_del_hueco_da_422_y_no_409', () => {
  // El orden de las comprobaciones: que el ejercicio no sea del hueco se dice antes que la
  // mezcla, al apuntar y al corregir. Si no, la web enseñaría «borra antes esas series» para
  // algo que no se arregla borrando nada.
  const e = abdominales()
  const curl = crear_ejercicio(e.cliente, grupo_muscular_id(e.cliente), 'Curl')
  const sesion = e.sesion()
  const [crunch] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 1)
  _apuntadas(e.cliente, sesion, e.rueda, e.b, 1)

  const al_apuntar = _apuntar(e.cliente, sesion, curl, e.a, 2)
  // La rueda no es del hueco A (que tiene crunch): 422, no el 409 de la mezcla.
  const al_corregir = e.cliente.put(`/entrenamientos/${sesion}/series/${crunch.id}`, {
    json: _serie(e.cliente, sesion, e.rueda, { slot_id: e.a }),
  })

  for (const respuesta of [al_apuntar, al_corregir]) {
    expect([respuesta.status_code, respuesta.json().detail]).toEqual([
      422,
      'Ese ejercicio no es ni el de la rutina ni una de sus alternativas.',
    ])
  }
  expect(_series_de(e.cliente, sesion)[0]).toEqual(crunch)
})

test('un_ejercicio_oculto_o_un_hueco_de_otra_rutina_dan_404_y_no_409', () => {
  // Una serie nueva no puede ir en un hueco de otra rutina (la sesión tendría series de un hueco
  // que su rutina no tiene) ni ser de un ejercicio oculto (lo oculto deja de ofrecerse): 404,
  // también cuando además mezclaría ejercicios en un hueco, porque lo que no se puede elegir se
  // dice antes que la mezcla.
  const e = abdominales()
  const sesion = e.sesion()
  const [crunch] = _apuntadas(e.cliente, sesion, e.crunch, e.a, 1)
  const pull = crear_rutina(e.cliente, 'Pull')
  const hueco_de_pull = e.cliente
    .post(`/rutinas/${pull}/slots`, { json: _hueco(e.plancha) })
    .json().id

  const de_otra_rutina = _apuntar(e.cliente, sesion, e.plancha, hueco_de_pull, 2)
  expect(e.cliente.delete(`/ejercicios/${e.plancha}?modo=ocultar`).status_code).toBe(204)
  const oculto = _apuntar(e.cliente, sesion, e.plancha, e.a, 2)

  expect(de_otra_rutina.status_code).toBe(404)
  expect(de_otra_rutina.json().detail).toBe('Ese ejercicio no está en la rutina de esta sesión.')
  expect(oculto.status_code).toBe(404)
  expect(oculto.json().detail).toBe(ejercicio_oculto('Plancha con lastre'))
  expect(_series_de(e.cliente, sesion)).toEqual([crunch])
})

// --- Límites de los números ----------------------------------------------
//
// La base de datos tiene sus propios máximos (`peso` es NUMERIC(6, 2), hasta 9999.99; los
// enteros son INTEGER, hasta 2**31 - 1), y un número que no cabía llegaba hasta PostgreSQL y
// reventaba con un 500. Ahora los esquemas ponen topes por debajo: el peso, lo que cabe en la
// columna; el resto, de sentido común (repeticiones y reps ≤ 1000, número de serie y orden ≤ 100,
// series objetivo ≤ 50). Cada tope se prueba en su borde (el justo vale, uno más da 422), y eso
// para también cualquier número que no cupiera en la columna.

test.each([
  ['numero_serie', '100', '101'],
  ['repeticiones', '1000', '1001'],
  ['peso', '9999.99', '10000.00'],
])('una_serie_admite_su_tope_justo_y_no_uno_mas (%s)', (campo, tope, pasado_de_tope) => {
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const entrenamiento_id = entrenar(cliente, FECHA).json().id
  const ruta = `/entrenamientos/${entrenamiento_id}/series`

  const justo = cliente.post(ruta, {
    json: { ..._serie(cliente, entrenamiento_id, banca), [campo]: tope },
  })
  const pasado = cliente.post(ruta, {
    json: { ..._serie(cliente, entrenamiento_id, banca), [campo]: pasado_de_tope },
  })

  expect([justo.status_code, pasado.status_code]).toEqual([201, 422])
  expect(pasado.json().detail.map((error: any) => error.loc)).toEqual([['body', campo]])
})

test.each([
  ['orden', 100],
  ['series_objetivo', 50],
  ['reps_max', 1000],
])('un_hueco_admite_su_tope_justo_y_no_uno_mas (%s)', (campo, tope) => {
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const rutina_id = crear_rutina(cliente)
  const ruta = `/rutinas/${rutina_id}/slots`

  const pasado = cliente.post(ruta, { json: { ..._hueco(banca), [campo]: tope + 1 } })
  const justo = cliente.post(ruta, { json: { ..._hueco(banca), [campo]: tope } })

  expect([justo.status_code, pasado.status_code]).toEqual([201, 422])
  expect(pasado.json().detail.map((error: any) => error.loc)).toEqual([['body', campo]])
  expect(justo.json()[campo]).toBe(tope)
})

test('reps_min_tambien_tiene_tope', () => {
  // No se puede probar con el código solo: un `reps_min` de más de 1000 obliga a un `reps_max`
  // igual de alto (o salta el rango), y ese ya da 422 por su cuenta. Se mira que el error nombre
  // también a `reps_min`.
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const rutina_id = crear_rutina(cliente)

  const respuesta = cliente.post(`/rutinas/${rutina_id}/slots`, {
    json: _hueco(banca, { reps: [1001, 1001] }),
  })

  expect(respuesta.status_code).toBe(422)
  const campos = new Set(respuesta.json().detail.map((error: any) => error.loc.at(-1)))
  expect(campos).toEqual(new Set(['reps_min', 'reps_max']))
})

test.each([
  ['repeticiones', 0],
  ['numero_serie', 0],
])('una_serie_con_un_numero_sin_sentido_da_422 (%s)', (campo, valor) => {
  const { cliente } = crearCliente()
  const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const entrenamiento_id = entrenar(cliente, FECHA).json().id

  const respuesta = cliente.post(`/entrenamientos/${entrenamiento_id}/series`, {
    json: { ..._serie(cliente, entrenamiento_id, banca), [campo]: valor },
  })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((error: any) => error.loc)).toEqual([['body', campo]])
})

test.each([['orden'], ['series_objetivo'], ['reps_min']])(
  'un_hueco_con_un_cero_da_422 (%s)',
  (campo) => {
    const { cliente } = crearCliente()
    const banca = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
    const rutina_id = crear_rutina(cliente)

    const respuesta = cliente.post(`/rutinas/${rutina_id}/slots`, {
      json: { ..._hueco(banca), [campo]: 0 },
    })

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail.map((error: any) => error.loc)).toEqual([['body', campo]])
    expect(cliente.get(`/rutinas/${rutina_id}`).json().slots).toEqual([])
  },
)

// --- Textos que no caben en su columna -----------------------------------
//
// Mismo riesgo que con los números: cada texto tiene su longitud máxima en la base de datos, y
// si el esquema no la repite, uno más largo llega a la base y la respuesta es un 500 en vez de un
// 422.

test('ningun_texto_mas_largo_que_su_columna_llega_a_la_base', () => {
  const { cliente } = crearCliente()
  const grupo = grupo_muscular_id(cliente)
  const banca = crear_ejercicio(cliente, grupo, 'Press banca')
  const rutina_id = crear_rutina(cliente)
  const programa_id = cliente.post('/programas', { json: { nombre: 'PPL' } }).json().id
  const entrenamiento_id = entrenar(cliente, FECHA).json().id

  const peticiones: [string, string, Record<string, unknown>][] = [
    ['post', '/ejercicios', { nombre: 'x'.repeat(101), grupo_muscular_id: grupo }],
    ['put', `/ejercicios/${banca}`, { nombre: 'x'.repeat(101), grupo_muscular_id: grupo }],
    [
      'post',
      '/ejercicios',
      { nombre: 'Remo', grupo_muscular_id: grupo, descripcion: 'x'.repeat(501) },
    ],
    ['post', `/ejercicios/${banca}/notas`, { nota: 'x'.repeat(1001) }],
    ['post', '/rutinas', { nombre: 'x'.repeat(101) }],
    ['put', `/rutinas/${rutina_id}`, { nombre: 'x'.repeat(101) }],
    ['post', '/programas', { nombre: 'x'.repeat(101) }],
    ['put', `/programas/${programa_id}`, { nombre: 'x'.repeat(101) }],
    ['post', '/entrenamientos', { rutina_id, fecha: '2026-09-01', notas: 'x'.repeat(1001) }],
    ['put', `/entrenamientos/${entrenamiento_id}`, { fecha: FECHA, notas: 'x'.repeat(1001) }],
    [
      'post',
      `/entrenamientos/${entrenamiento_id}/series`,
      { ..._serie(cliente, entrenamiento_id, banca), variante: 'x'.repeat(101) },
    ],
  ]

  for (const [metodo, ruta, cuerpo] of peticiones) {
    const respuesta = (cliente as any)[metodo](ruta, { json: cuerpo }) as RespuestaDeTest
    expect([`${metodo.toUpperCase()} ${ruta}`, respuesta.status_code]).toEqual([
      `${metodo.toUpperCase()} ${ruta}`,
      422,
    ])
    // El 422 tiene que ser por el texto largo, no por un campo obligatorio que le falte al
    // cuerpo: así pasaba antes con los entrenamientos sin rutina_id.
    const tipos = new Set(respuesta.json().detail.map((error: any) => error.type))
    expect([`${metodo.toUpperCase()} ${ruta}`, tipos]).toEqual([
      `${metodo.toUpperCase()} ${ruta}`,
      new Set(['string_too_long']),
    ])
  }
})

test('un_nombre_se_guarda_sin_los_espacios_de_los_lados', () => {
  const { cliente } = crearCliente()
  const creado = cliente
    .post('/ejercicios', {
      json: { nombre: '  Press banca  ', grupo_muscular_id: grupo_muscular_id(cliente) },
    })
    .json()

  expect(creado.nombre).toBe('Press banca')
})

// --- Textos opcionales ---------------------------------------------------

test('los_textos_opcionales_en_blanco_se_guardan_como_nulos', () => {
  // "Sin descripción" o "sin variante" es siempre null, nunca "" ni unos espacios que no dicen
  // nada. Lo que sí dice algo se guarda recortado.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const en_blanco = cliente
    .post('/ejercicios', { json: { nombre: 'Curl', grupo_muscular_id: g, descripcion: '   ' } })
    .json()
  const con_texto = cliente
    .post('/ejercicios', {
      json: { nombre: 'Remo', grupo_muscular_id: g, descripcion: '  Con barra  ' },
    })
    .json()
  const entrenamiento = entrenar(cliente, FECHA, null, { notas: '' }).json()
  const serie = serie_en(cliente, entrenamiento.id, en_blanco.id, {
    peso: 20,
    variante: '  ',
  }).json()

  expect(en_blanco.descripcion).toBeNull()
  expect(con_texto.descripcion).toBe('Con barra')
  expect(entrenamiento.notas).toBeNull()
  expect(serie.variante).toBeNull()
})

// --- Los listados ----------------------------------------------------------

test('rutinas_programas_y_ejercicios_se_listan_por_nombre', () => {
  // Por orden alfabético (decisión del autor), no por orden de creación: se crean en otro orden
  // para que el de los ids no lo dé hecho. También los ocultos.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  for (const nombre of ['Push', 'Leg', 'Pull']) {
    crear_rutina(cliente, nombre)
    cliente.post('/programas', { json: { nombre: `${nombre} semanal` } })
  }
  for (const nombre of ['Zancada búlgara propia', 'Abdominal propio', 'Máquina propia']) {
    crear_ejercicio(cliente, g, nombre)
  }
  for (const nombre of ['Torso', 'Brazos']) {
    const rutina = crear_rutina(cliente, nombre)
    expect(cliente.delete(`/rutinas/${rutina}?modo=ocultar`).status_code).toBe(204)
  }

  const nombres = (ruta: string, params: Record<string, boolean> = {}): string[] =>
    cliente
      .get(ruta, { params })
      .json()
      .map((x: any) => x.nombre)

  expect(nombres('/rutinas')).toEqual(['Leg', 'Pull', 'Push'])
  expect(nombres('/rutinas', { ocultas: true })).toEqual(['Brazos', 'Torso'])
  expect(nombres('/programas')).toEqual(['Leg semanal', 'Pull semanal', 'Push semanal'])
  const propios = nombres('/ejercicios').filter((n) => n.endsWith('propia') || n.endsWith('propio'))
  expect(propios).toEqual(['Abdominal propio', 'Máquina propia', 'Zancada búlgara propia'])
})

// --- Lo que no existe ----------------------------------------------------
//
// Leer o escribir sobre un id que no existe da 404 (el 403 es solo para los predefinidos). Se
// mira también el texto: un 404 de una ruta mal escrita diría "Not Found".

const INEXISTENTE = 999_999

/**
 * Un ejercicio, una rutina con su hueco y una sesión de esa rutina: los padres que sí existen
 * cuando lo que falta es el hijo.
 */
function lo_que_existe(cliente: Cliente): Record<string, number> {
  const ejercicio = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Press banca')
  const rutina = crear_rutina(cliente)
  const hueco = cliente.post(`/rutinas/${rutina}/slots`, { json: _hueco(ejercicio) }).json().id
  const sesion = cliente
    .post('/entrenamientos', { json: { rutina_id: rutina, fecha: FECHA } })
    .json()
  return { ejercicio, rutina, hueco, sesion: sesion.id }
}

const NO_HAY_NOTA = 'Esa nota ya no existe. Puede que la hayas borrado.'
const NO_HAY_PROGRAMA = 'Este programa ya no existe. Puede que lo hayas borrado.'
const NO_HAY_RUTINA = 'Esta rutina ya no existe. Puede que la hayas borrado.'
const NO_HAY_HUECO = 'Ese ejercicio no está en esta rutina.'
const NO_HAY_SESION = 'Esta sesión ya no existe. Puede que la hayas cancelado o borrado.'
const NO_HAY_HUECO_DE_LA_SESION = 'Ese ejercicio no está en la rutina de esta sesión.'

const NO_EXISTE: [string, string, string | null, string][] = [
  ['get', '/ejercicios/{X}', null, EJERCICIO_YA_NO_EXISTE],
  ['put', '/ejercicios/{X}', 'ejercicio', EJERCICIO_YA_NO_EXISTE],
  ['delete', '/ejercicios/{X}', null, EJERCICIO_YA_NO_EXISTE],
  ['post', '/ejercicios/{X}/mostrar', null, EJERCICIO_YA_NO_EXISTE],
  ['get', '/ejercicios/{X}/historial', null, EJERCICIO_YA_NO_EXISTE],
  ['get', '/ejercicios/{X}/donde-se-usa', null, EJERCICIO_YA_NO_EXISTE],
  ['get', '/ejercicios/{X}/aviso-de-borrado', null, EJERCICIO_YA_NO_EXISTE],
  ['get', '/ejercicios/{X}/notas', null, EJERCICIO_YA_NO_EXISTE],
  ['post', '/ejercicios/{X}/notas', 'nota', EJERCICIO_YA_NO_EXISTE],
  ['put', '/ejercicios/{X}/notas/1', 'nota', EJERCICIO_YA_NO_EXISTE],
  ['delete', '/ejercicios/{X}/notas/1', null, EJERCICIO_YA_NO_EXISTE],
  ['put', '/ejercicios/{ejercicio}/notas/{X}', 'nota', NO_HAY_NOTA],
  ['delete', '/ejercicios/{ejercicio}/notas/{X}', null, NO_HAY_NOTA],
  ['get', '/rutinas/{X}', null, NO_HAY_RUTINA],
  ['get', '/rutinas/{X}/aviso-de-borrado', null, NO_HAY_RUTINA],
  ['put', '/rutinas/{X}', 'rutina', NO_HAY_RUTINA],
  ['delete', '/rutinas/{X}', null, NO_HAY_RUTINA],
  ['post', '/rutinas/{X}/mostrar', null, NO_HAY_RUTINA],
  ['post', '/rutinas/{X}/duplicar', null, NO_HAY_RUTINA],
  ['post', '/rutinas/{X}/slots', 'hueco', NO_HAY_RUTINA],
  ['put', '/rutinas/{X}/slots/{hueco}', 'hueco', NO_HAY_RUTINA],
  ['delete', '/rutinas/{X}/slots/{hueco}', null, NO_HAY_RUTINA],
  ['post', '/rutinas/{X}/slots/{hueco}/mostrar', null, NO_HAY_RUTINA],
  ['get', '/rutinas/{X}/slots/{hueco}/aviso-de-borrado', null, NO_HAY_RUTINA],
  ['put', '/rutinas/{rutina}/slots/{X}', 'hueco', NO_HAY_HUECO],
  ['delete', '/rutinas/{rutina}/slots/{X}', null, NO_HAY_HUECO],
  ['post', '/rutinas/{rutina}/slots/{X}/mostrar', null, NO_HAY_HUECO],
  ['get', '/rutinas/{rutina}/slots/{X}/aviso-de-borrado', null, NO_HAY_HUECO],
  ['get', '/programas/{X}', null, NO_HAY_PROGRAMA],
  ['put', '/programas/{X}', 'programa', NO_HAY_PROGRAMA],
  ['delete', '/programas/{X}', null, NO_HAY_PROGRAMA],
  ['post', '/programas/{X}/activar', null, NO_HAY_PROGRAMA],
  ['post', '/programas/{X}/desactivar', null, NO_HAY_PROGRAMA],
  ['post', '/programas/{X}/mostrar', null, NO_HAY_PROGRAMA],
  ['get', '/entrenamientos/{X}', null, NO_HAY_SESION],
  ['put', '/entrenamientos/{X}', 'sesion', NO_HAY_SESION],
  ['put', '/entrenamientos/{sesion}', 'serie del dia', SERIE_DEL_DIA_YA_NO_EXISTE],
  ['delete', '/entrenamientos/{X}/series?slot_id={hueco}', null, NO_HAY_SESION],
  ['delete', '/entrenamientos/{sesion}/series?slot_id={X}', null, NO_HAY_HUECO_DE_LA_SESION],
  ['delete', '/entrenamientos/{X}', null, NO_HAY_SESION],
  ['post', '/entrenamientos/{X}/terminar', null, NO_HAY_SESION],
  ['post', '/entrenamientos/{X}/series', 'serie', NO_HAY_SESION],
  ['put', '/entrenamientos/{X}/series/1', 'serie', NO_HAY_SESION],
  ['delete', '/entrenamientos/{X}/series/1', null, NO_HAY_SESION],
  ['put', '/entrenamientos/{sesion}/series/{X}', 'serie', SERIE_YA_NO_EXISTE],
  ['delete', '/entrenamientos/{sesion}/series/{X}', null, SERIE_YA_NO_EXISTE],
]

test.each(NO_EXISTE)(
  'leer_o_modificar_algo_que_no_existe_da_404_con_su_mensaje (%s %s %s)',
  (metodo, ruta, cuerpo, detalle) => {
    // Cada ruta con id, una a una: si se olvidara la comprobación en una, daría otra cosa. Con
    // el padre inexistente, el 404 es el del padre; con el padre bien y el hijo inexistente, el
    // del hijo. El cuerpo es válido, para que el 404 no pueda ser un 422 de otra cosa. Un PUT se
    // prueba una vez aunque admita más campos: el 404 va antes de mirarlos. Un hijo que existe
    // pero es de otro padre, en el test de cada recurso (busca «la ruta de»).
    const { cliente } = crearCliente()
    const hay = lo_que_existe(cliente)
    const serie = {
      ejercicio_id: hay.ejercicio,
      slot_id: hay.hueco,
      numero_serie: 1,
      peso: 60,
      repeticiones: 8,
    }
    const cuerpos: Record<string, unknown> = {
      ejercicio: { nombre: 'Remo', grupo_muscular_id: grupo_muscular_id(cliente) },
      programa: { nombre: 'PPL' },
      nota: { nota: 'Agarre cerrado' },
      rutina: { nombre: 'Empuje' },
      hueco: _hueco(hay.ejercicio, { orden: 2 }),
      sesion: { fecha: FECHA },
      'serie del dia': { fecha: FECHA, series: [{ id: INEXISTENTE, ...serie }] },
      serie,
    }
    const argumentos = cuerpo === null ? {} : { json: cuerpos[cuerpo] }
    const url = ruta
      .replace(/\{X\}/g, String(INEXISTENTE))
      .replace(/\{(\w+)\}/g, (_, clave: string) => String(hay[clave]))

    const respuesta = (cliente as any)[metodo](url, argumentos) as RespuestaDeTest

    expect(respuesta.status_code).toBe(404)
    expect(respuesta.json().detail).toBe(detalle)
  },
)

test.each([['sesion'], ['dia planificado'], ['serie'], ['hueco de la serie']])(
  'elegir_algo_que_no_existe_da_404_y_no_guarda_nada (%s)',
  (donde) => {
    // Un id que llega en el cuerpo y no existe se trata como uno oculto: 404, porque no se puede
    // elegir, y nada se queda a medias. El de un día del programa, en `programas.test.ts` (con el
    // todo o nada de la semana entera).
    const { cliente, reloj, bd } = crearCliente()
    const hay = lo_que_existe(cliente)
    let respuesta: RespuestaDeTest
    let tabla: string
    let cuantas: number
    if (donde === 'sesion') {
      respuesta = cliente.post('/entrenamientos', {
        json: { rutina_id: INEXISTENTE, fecha: '2026-09-05' },
      })
      tabla = 'entrenamientos'
      cuantas = 1
    } else if (donde === 'dia planificado') {
      respuesta = cliente.put(`/plan/excepciones/${reloj.hoy()}`, {
        json: { rutina_id: INEXISTENTE },
      })
      tabla = 'excepciones_del_plan'
      cuantas = 0
    } else {
      respuesta = cliente.post(`/entrenamientos/${hay.sesion}/series`, {
        json: {
          ejercicio_id: donde === 'serie' ? INEXISTENTE : hay.ejercicio,
          slot_id: donde === 'hueco de la serie' ? INEXISTENTE : hay.hueco,
          numero_serie: 1,
          peso: 60,
          repeticiones: 8,
        },
      })
      tabla = 'series'
      cuantas = 0
    }

    expect(respuesta.status_code).toBe(404)
    const esperado =
      donde === 'serie'
        ? ELEGIDO_YA_NO_EXISTE
        : donde === 'hueco de la serie'
          ? 'Ese ejercicio no está en la rutina de esta sesión.'
          : 'Esa rutina no existe o está oculta.'
    expect(respuesta.json().detail).toBe(esperado)
    expect(contar(bd, tabla)).toBe(cuantas)
  },
)
