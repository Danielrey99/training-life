/**
 * El despachador de rutas (`src/logica/rutas.ts`). La api que lo usa, en `api.test.ts`.
 * Propios del móvil: en el backend lo hace FastAPI, que no tiene tests aquí. La
 * especificación es su comportamiento: 404 y 405 de rutas, el 422 de la ruta, la consulta y
 * el cuerpo (en ese orden, todos juntos) y una petición que o se hace entera o no se hace.
 */
import type { Contexto } from '../../src/logica/contexto'
import { conflicto } from '../../src/logica/fallos'
import { despachar } from '../../src/logica/rutas'
import { EJERCICIO_YA_NO_EXISTE, cuantas_filas, objetivo } from '../apoyo/ayudas'
import { grupo_muscular_id } from '../apoyo/conftest'
import { RelojDeTest, ZONA, crearCliente } from '../apoyo/cliente'
import { baseNueva } from '../apoyo/baseNueva'

const ENTERO_NO_VALIDO = 'Input should be a valid integer, unable to parse string as an integer'

// --- Rutas que no existen -------------------------------------------------

test('una_ruta_que_no_existe_da_404_not_found', () => {
  const { cliente } = crearCliente()

  for (const url of ['/nada', '/ejercicios/1/otra', '/ejercicios/1/notas/2/mas', '/']) {
    const respuesta = cliente.get(url)

    expect(respuesta.status_code).toBe(404)
    expect(respuesta.json()).toEqual({ detail: 'Not Found' })
  }
})

test.each([
  ['DELETE', '/grupos-musculares'],
  ['PUT', '/ejercicios'],
  ['POST', '/ejercicios/1'],
  ['PUT', '/rutinas'],
  ['GET', '/rutinas/1/duplicar'],
  ['PUT', '/ejercicios/1/mostrar'],
] as const)('una_ruta_con_otro_metodo_da_405 (%s %s)', (metodo, url) => {
  const { cliente } = crearCliente()

  const respuesta =
    metodo === 'GET'
      ? cliente.get(url)
      : metodo === 'POST'
        ? cliente.post(url)
        : metodo === 'PUT'
          ? cliente.put(url)
          : cliente.delete(url)

  expect(respuesta.status_code).toBe(405)
  expect(respuesta.json()).toEqual({ detail: 'Method Not Allowed' })
})

test('el_405_sale_antes_que_validar_la_ruta', () => {
  // `POST /ejercicios/abc` no es una ruta: no se mira si «abc» es un entero.
  const { cliente } = crearCliente()

  expect(cliente.post('/ejercicios/abc').status_code).toBe(405)
})

test('el_404_de_una_ruta_que_no_existe_sale_antes_que_validar_nada', () => {
  const { cliente } = crearCliente()

  const respuesta = cliente.get('/ejercicios/abc/otra?limite=0')

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json()).toEqual({ detail: 'Not Found' })
})

// --- Códigos de lo que va bien ----------------------------------------------

test('crear_da_201_leer_da_200_y_borrar_da_204_sin_cuerpo', () => {
  const { cliente } = crearCliente()
  const grupo = grupo_muscular_id(cliente)

  const creado = cliente.post('/ejercicios', { json: { nombre: 'Remo', grupo_muscular_id: grupo } })
  const id = creado.json().id
  const leido = cliente.get(`/ejercicios/${id}`)
  const borrado = cliente.delete(`/ejercicios/${id}`)

  expect(creado.status_code).toBe(201)
  expect(leido.status_code).toBe(200)
  expect(leido.json().nombre).toBe('Remo')
  expect(borrado.status_code).toBe(204)
  expect(borrado.json()).toBeNull()
  expect(cliente.get(`/ejercicios/${id}`).status_code).toBe(404)
})

test('lo_que_se_devuelve_viaja_por_json_y_no_comparte_objetos_con_la_logica', () => {
  const { cliente } = crearCliente()

  const primera = cliente.get('/grupos-musculares').json()
  primera.pop()
  const segunda = cliente.get('/grupos-musculares').json()

  expect(segunda.length).toBe(primera.length + 1)
  expect(JSON.stringify(segunda)).not.toContain('undefined')
})

// --- 422 de la ruta ----------------------------------------------------------

test.each(['abc', '1.5', '1e2', 'uno'])(
  'un_id_de_la_ruta_que_no_es_entero_da_422_con_su_loc (%j)',
  (id) => {
    const { cliente } = crearCliente()

    const respuesta = cliente.get(`/ejercicios/${id}`)

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail).toEqual([
      { type: 'int_parsing', loc: ['path', 'ejercicio_id'], msg: ENTERO_NO_VALIDO },
    ])
  },
)

test('un_id_inexistente_pero_entero_no_es_422_sino_404_de_la_app', () => {
  const { cliente } = crearCliente()

  const respuesta = cliente.get('/ejercicios/999999')

  expect(respuesta.status_code).toBe(404)
  expect(respuesta.json()).toEqual({ detail: EJERCICIO_YA_NO_EXISTE })
})

test('cada_id_de_una_ruta_con_dos_ids_se_valida_con_su_nombre', () => {
  const { cliente } = crearCliente()

  const respuesta = cliente.put('/ejercicios/x/notas/y', { json: { nota: 'hola' } })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual([
    { type: 'int_parsing', loc: ['path', 'ejercicio_id'], msg: ENTERO_NO_VALIDO },
    { type: 'int_parsing', loc: ['path', 'nota_id'], msg: ENTERO_NO_VALIDO },
  ])
})

// --- 422 de la consulta ------------------------------------------------------

test('un_limite_cero_en_el_historial_da_422_en_la_consulta', () => {
  const { cliente } = crearCliente()
  const id = cliente.get('/ejercicios').json()[0].id

  const respuesta = cliente.get(`/ejercicios/${id}/historial`, { params: { limite: 0 } })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual([
    { type: 'greater_than', loc: ['query', 'limite'], msg: 'Input should be greater than 0' },
  ])
})

test('un_limite_pasado_de_500_da_422_y_uno_de_500_vale', () => {
  const { cliente } = crearCliente()
  const id = cliente.get('/ejercicios').json()[0].id

  const alto = cliente.get(`/ejercicios/${id}/historial`, { params: { limite: 501 } })
  const justo = cliente.get(`/ejercicios/${id}/historial`, { params: { limite: 500 } })

  expect(alto.json().detail).toEqual([
    {
      type: 'less_than_equal',
      loc: ['query', 'limite'],
      msg: 'Input should be less than or equal to 500',
    },
  ])
  expect(justo.status_code).toBe(200)
})

test('un_limite_que_no_es_un_numero_da_422', () => {
  const { cliente } = crearCliente()
  const id = cliente.get('/ejercicios').json()[0].id

  const respuesta = cliente.get(`/ejercicios/${id}/historial`, { params: { limite: 'muchos' } })

  expect(respuesta.json().detail).toEqual([
    { type: 'int_parsing', loc: ['query', 'limite'], msg: ENTERO_NO_VALIDO },
  ])
})

test('una_fecha_hasta_que_no_existe_da_422_en_la_consulta', () => {
  const { cliente } = crearCliente()
  const id = cliente.get('/ejercicios').json()[0].id

  const respuesta = cliente.get(`/ejercicios/${id}/historial`, { params: { hasta: '2026-02-30' } })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual([
    {
      type: 'date_from_datetime_parsing',
      loc: ['query', 'hasta'],
      msg: 'Input should be a valid date or datetime, day value is outside expected range',
    },
  ])
})

test('varios_fallos_de_la_consulta_salen_juntos_en_el_orden_de_los_parametros', () => {
  const { cliente } = crearCliente()
  const id = cliente.get('/ejercicios').json()[0].id

  // `limite` va antes en la URL, pero `hasta` se declara primero.
  const respuesta = cliente.get(`/ejercicios/${id}/historial?limite=0&hasta=ayer`)

  expect(respuesta.json().detail.map((e: any) => e.loc)).toEqual([
    ['query', 'hasta'],
    ['query', 'limite'],
  ])
})

test('un_modo_de_borrado_que_no_es_ocultar_ni_definitivo_da_422', () => {
  const { cliente } = crearCliente()

  for (const modo of ['otro', '', 'OCULTAR']) {
    const respuesta = cliente.delete('/ejercicios/1', { params: { modo } })

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail).toEqual([
      {
        type: 'literal_error',
        loc: ['query', 'modo'],
        msg: "Input should be 'ocultar' or 'definitivo'",
      },
    ])
  }
})

test('un_booleano_de_la_consulta_que_no_se_entiende_da_422', () => {
  const { cliente } = crearCliente()

  const respuesta = cliente.get('/ejercicios?ocultos=quizas')

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual([
    {
      type: 'bool_parsing',
      loc: ['query', 'ocultos'],
      msg: 'Input should be a valid boolean, unable to interpret input',
    },
  ])
})

test.each([
  ['true', true],
  ['1', true],
  ['yes', true],
  ['false', false],
  ['0', false],
])('un_booleano_de_la_consulta_se_lee_como_pydantic (ocultos=%s)', (valor, ocultos) => {
  const { cliente } = crearCliente()
  const esperado = cliente.get('/ejercicios', { params: { ocultos } })

  const respuesta = cliente.get(`/ejercicios?ocultos=${valor}`)

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json()).toEqual(esperado.json())
})

test('un_parametro_null_de_la_consulta_no_viaja', () => {
  const { cliente } = crearCliente()

  // `modo: null` no viaja: un borrado sin modo, no un literal_error.
  const respuesta = cliente.delete('/ejercicios/999999', { params: { modo: null } })

  expect(respuesta.status_code).toBe(404)
})

// --- 422 del cuerpo ----------------------------------------------------------

test.each([
  ['POST', '/ejercicios'],
  ['POST', '/rutinas'],
  // Importar acepta cualquier JSON sin validarlo (`Any = Body(...)`), pero tiene que llegar.
  ['POST', '/datos/importar'],
])('sin_cuerpo_da_422_field_required_en_body (%s %s)', (_metodo, url) => {
  const { cliente } = crearCliente()

  const respuesta = cliente.post(url)

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual([
    { type: 'missing', loc: ['body'], msg: 'Field required' },
  ])
})

test('un_cuerpo_null_cuenta_como_ausente', () => {
  const { cliente } = crearCliente()

  const respuesta = cliente.post('/ejercicios', { json: null })

  expect(respuesta.json().detail).toEqual([
    { type: 'missing', loc: ['body'], msg: 'Field required' },
  ])
})

test('un_cuerpo_que_no_es_un_objeto_da_422', () => {
  const { cliente } = crearCliente()

  for (const json of [[], 'texto', 5, true]) {
    const respuesta = cliente.post('/ejercicios', { json })

    expect(respuesta.status_code).toBe(422)
    expect(respuesta.json().detail).toEqual([
      {
        type: 'model_attributes_type',
        loc: ['body'],
        msg: 'Input should be a valid dictionary or object to extract fields from',
      },
    ])
  }
})

test('los_campos_que_faltan_en_el_cuerpo_salen_todos_con_su_loc', () => {
  const { cliente } = crearCliente()

  const respuesta = cliente.post('/ejercicios', { json: {} })

  expect(respuesta.status_code).toBe(422)
  const locs = respuesta.json().detail.map((e: any) => e.loc)
  expect(locs).toContainEqual(['body', 'nombre'])
  expect(locs).toContainEqual(['body', 'grupo_muscular_id'])
  for (const error of respuesta.json().detail) {
    expect(error.type).toBe('missing')
    expect(error.msg).toBe('Field required')
  }
})

// --- Ruta, consulta y cuerpo, juntos y en ese orden ---------------------------

test('los_errores_de_ruta_y_de_cuerpo_salen_juntos_primero_la_ruta', () => {
  const { cliente } = crearCliente()

  const respuesta = cliente.put('/ejercicios/abc')

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail).toEqual([
    { type: 'int_parsing', loc: ['path', 'ejercicio_id'], msg: ENTERO_NO_VALIDO },
    { type: 'missing', loc: ['body'], msg: 'Field required' },
  ])
})

test('los_errores_de_ruta_consulta_y_cuerpo_salen_en_ese_orden', () => {
  const { cliente } = crearCliente()

  // Ruta y consulta con un DELETE; ruta y cuerpo (con campos malos) con un PUT.
  const borrar = cliente.delete('/ejercicios/abc?modo=otro')
  const poner = cliente.put('/ejercicios/abc', { json: { nombre: 5 } })

  expect(borrar.json().detail.map((e: any) => e.loc)).toEqual([
    ['path', 'ejercicio_id'],
    ['query', 'modo'],
  ])
  expect(poner.json().detail.map((e: any) => e.loc)).toEqual([
    ['path', 'ejercicio_id'],
    ['body', 'nombre'],
    ['body', 'grupo_muscular_id'],
  ])
})

test('un_fallo_de_validacion_no_toca_la_base_ni_llega_al_servicio', () => {
  const { cliente, bd } = crearCliente()
  const antes = cuantas_filas(bd, 'ejercicios', 'rutinas')

  cliente.post('/ejercicios', { json: { nombre: 'Sin grupo' } })
  cliente.post('/rutinas', { json: { nombre: '' } })

  expect(cuantas_filas(bd, 'ejercicios', 'rutinas')).toEqual(antes)
})

// --- Una petición se hace entera o no se hace ----------------------------------

/** El contexto de un cliente, con una base cuyos INSERT en `tabla` fallan con `fallo()`. */
function contextoQueFallaAl(tabla: string, fallo: () => Error) {
  const bd = baseNueva()
  const roto = Object.create(bd)
  roto.ejecutar = (sql: string, ...params: any[]) => {
    if (sql.includes(`INTO ${tabla}`)) throw fallo()
    return bd.ejecutar(sql, ...params)
  }
  const ctx: Contexto = { bd: roto, reloj: new RelojDeTest(), zona: () => ZONA }
  return { ctx, bd }
}

const rutinaConUnHueco = (ejercicio_id: number) => ({
  nombre: 'Push',
  slots: [{ ejercicio_principal_id: ejercicio_id, ...objetivo(3, [6, 10]) }],
})

test('crear_una_rutina_con_un_hueco_de_un_ejercicio_que_no_existe_no_deja_la_rutina', () => {
  const { cliente, bd } = crearCliente()

  const respuesta = cliente.post('/rutinas', { json: rutinaConUnHueco(999999) })

  expect(respuesta.status_code).toBe(404)
  expect(cuantas_filas(bd, 'rutinas', 'rutina_slots')).toEqual([0, 0])
})

test('un_fallo_de_la_app_a_mitad_deshace_lo_ya_escrito', () => {
  // La rutina ya está insertada cuando salta el 409 al insertar su hueco: no puede quedar.
  const { ctx, bd } = contextoQueFallaAl('rutina_slots', () => conflicto('Se ha roto a mitad.'))
  const ejercicio = bd.una<{ id: number }>('SELECT id FROM ejercicios LIMIT 1')!.id

  const respuesta = despachar(ctx, 'POST', '/rutinas', rutinaConUnHueco(ejercicio))

  expect(respuesta.estado).toBe(409)
  expect(respuesta.cuerpo).toEqual({ detail: 'Se ha roto a mitad.' })
  expect(cuantas_filas(bd, 'rutinas', 'rutina_slots')).toEqual([0, 0])
  expect(bd.enTransaccion).toBe(false)
})

test('un_error_que_no_es_de_la_app_se_propaga_y_tambien_deshace_lo_escrito', () => {
  // Es el 500: no se convierte en una respuesta, hace fallar a quien llama.
  const { ctx, bd } = contextoQueFallaAl('rutina_slots', () => new Error('CHECK constraint failed'))
  const ejercicio = bd.una<{ id: number }>('SELECT id FROM ejercicios LIMIT 1')!.id

  expect(() => despachar(ctx, 'POST', '/rutinas', rutinaConUnHueco(ejercicio))).toThrow(
    'CHECK constraint failed',
  )
  expect(cuantas_filas(bd, 'rutinas', 'rutina_slots')).toEqual([0, 0])
  expect(bd.enTransaccion).toBe(false)
})

test('despues_de_un_fallo_la_siguiente_peticion_funciona', () => {
  const { ctx, bd } = contextoQueFallaAl('rutina_slots', () => conflicto('Se ha roto a mitad.'))
  const ejercicio = bd.una<{ id: number }>('SELECT id FROM ejercicios LIMIT 1')!.id
  despachar(ctx, 'POST', '/rutinas', rutinaConUnHueco(ejercicio))

  const sinHuecos = despachar(ctx, 'POST', '/rutinas', { nombre: 'Push' })

  expect(sinHuecos.estado).toBe(201)
  expect(cuantas_filas(bd, 'rutinas')).toEqual([1])
})

test('una_peticion_buena_se_confirma_en_la_base', () => {
  const { cliente, bd } = crearCliente()

  cliente.post('/rutinas', { json: { nombre: 'Push' } })

  expect(cuantas_filas(bd, 'rutinas')).toEqual([1])
  expect(bd.enTransaccion).toBe(false)
})
