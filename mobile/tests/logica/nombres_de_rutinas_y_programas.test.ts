/**
 * Los nombres de rutinas y programas: no se repiten.
 *
 * Puerto de `backend/tests/test_nombres_de_rutinas_y_programas.py`.
 *
 * La API no deja crear ni renombrar una rutina con el nombre de otra, ni un programa con el
 * de otro, sin distinguir mayúsculas, tildes ni espacios. Las ocultas cuentan igual, con
 * otro mensaje que pide mostrarla. Cada tipo se compara solo con los suyos: una rutina y un
 * programa sí pueden llamarse igual. La base no lo impide, a propósito: un archivo importado
 * puede traer dos que ya convivían, y tiene que poder cargarse; esos se pueden seguir
 * editando y mostrando.
 *
 * Lo de duplicar una rutina (que nunca da 409: busca un nombre libre), en `rutinas.test.ts`.
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  esperar_estado,
  crear_ejercicio,
  crear_rutina,
  cuantas_filas,
  ejercicio_oculto,
  importar_rutinas_y_programas,
  nombre_repetido,
  objetivo,
} from '../apoyo/ayudas'
import { ejercicio_predefinido_id, grupo_muscular_id } from '../apoyo/conftest'
import { crearCliente, type ClienteDeTest as Cliente } from '../apoyo/cliente'

let cliente: Cliente
let bd: Bd
beforeEach(() => {
  ;({ cliente, bd } = crearCliente())
})

type Tipo = 'rutina' | 'programa'

// Lo que cambia entre rutinas y programas: la ruta, la tabla y los textos (rutina es
// femenino y programa masculino).
const TIPOS = {
  rutina: {
    ruta: '/rutinas',
    tabla: 'rutinas',
    visible: (n: string) => `Ya tienes una rutina que se llama «${n}». Elige otro nombre.`,
    oculto: (n: string) =>
      `Ya tienes una rutina oculta que se llama «${n}». Muéstrala desde la pestaña` +
      ' Programas o elige otro nombre.',
    editar_oculto: 'Esta rutina está oculta. Muéstrala antes de cambiarla.',
  },
  programa: {
    ruta: '/programas',
    tabla: 'programas',
    visible: (n: string) => `Ya tienes un programa que se llama «${n}». Elige otro nombre.`,
    oculto: (n: string) =>
      `Ya tienes un programa oculto que se llama «${n}». Muéstralo desde la pestaña` +
      ' Programas o elige otro nombre.',
    editar_oculto: 'Este programa está oculto. Muéstralo antes de cambiarlo.',
  },
}

const por_tipo = Object.keys(TIPOS) as Tipo[]

// --- Ayudas -------------------------------------------------------------------

function crear(tipo: Tipo, nombre: string) {
  return cliente.post(TIPOS[tipo].ruta, { json: { nombre } })
}

function creado(tipo: Tipo, nombre: string): number {
  const respuesta = crear(tipo, nombre)
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

function renombrar(tipo: Tipo, objeto_id: number, nombre: string) {
  return cliente.put(`${TIPOS[tipo].ruta}/${objeto_id}`, { json: { nombre } })
}

function ocultar(tipo: Tipo, objeto_id: number): void {
  const respuesta = cliente.delete(`${TIPOS[tipo].ruta}/${objeto_id}`, {
    params: { modo: 'ocultar' },
  })
  esperar_estado(respuesta, 204)
}

function mostrar(tipo: Tipo, objeto_id: number) {
  return cliente.post(`${TIPOS[tipo].ruta}/${objeto_id}/mostrar`)
}

/** Todos los nombres guardados de ese tipo, también los ocultos, por id. */
function nombres(tipo: Tipo): string[] {
  return bd
    .todas<{ nombre: string }>(`SELECT nombre FROM ${TIPOS[tipo].tabla} ORDER BY id`)
    .map((fila) => fila.nombre)
}

function choca(tipo: Tipo, nombre: string): Record<string, string> {
  return nombre_repetido(TIPOS[tipo].visible(nombre))
}

function choca_con_oculto(tipo: Tipo, nombre: string): Record<string, string> {
  return nombre_repetido(TIPOS[tipo].oculto(nombre))
}

/** Sustituye los datos por un archivo con estas filas del tipo; devuelve sus ids. */
function importar(tipo: Tipo, ...filas: (string | [string, string | null])[]): number[] {
  if (tipo === 'rutina') return importar_rutinas_y_programas(cliente, filas)[0]
  return importar_rutinas_y_programas(cliente, [], filas)[1]
}

// --- Crear ----------------------------------------------------------------------

test.each(por_tipo)(
  'no_se_crea_con_el_nombre_de_otro_sin_distinguir_mayusculas_tildes_ni_espacios (%s)',
  (tipo) => {
    // El mensaje nombra el otro tal como está guardado, no como se ha escrito. Cada forma de
    // escribirlo, en `la_clave_de_un_nombre_ignora_mayusculas_tildes_y_espacios`.
    creado(tipo, 'Glúteos y femoral')

    const respuesta = crear(tipo, '  GLUTEOS   y  femoral ')

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([
      409,
      choca(tipo, 'Glúteos y femoral'),
    ])
    expect(nombres(tipo)).toEqual(['Glúteos y femoral'])
  },
)

test.each(por_tipo)(
  'no_se_crea_con_el_nombre_de_uno_oculto_y_el_mensaje_pide_mostrarlo (%s)',
  (tipo) => {
    ocultar(tipo, creado(tipo, 'Torso'))

    const respuesta = crear(tipo, 'torso')

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([
      409,
      choca_con_oculto(tipo, 'Torso'),
    ])
    expect(nombres(tipo)).toEqual(['Torso'])
  },
)

test('una_rutina_y_un_programa_pueden_llamarse_igual', () => {
  // Un programa de una sola rutina se llama como ella con naturalidad, y nunca salen en el
  // mismo selector: cada tipo se compara solo con los suyos.
  expect(crear('rutina', 'Full body').status_code).toBe(201)
  expect(crear('programa', 'FULL BODY').status_code).toBe(201)
  const programa = creado('programa', 'Otro')
  const choque = renombrar('programa', programa, 'full body ')
  expect([choque.status_code, choque.json().detail]).toEqual([409, choca('programa', 'FULL BODY')])
  expect(renombrar('programa', programa, 'Otro programa').status_code).toBe(200)
  expect(nombres('rutina')).toEqual(['Full body'])
  expect(nombres('programa')).toEqual(['FULL BODY', 'Otro programa'])
})

// --- Crear una rutina con sus huecos: el orden de los fallos ---------------------

function hueco(ejercicio_id: number, objetivo_del_hueco?: Record<string, number | null>) {
  return {
    ejercicio_principal_id: ejercicio_id,
    alternativas: [],
    ...(objetivo_del_hueco ?? objetivo()),
  }
}

function filas_guardadas(): number[] {
  return cuantas_filas(bd, 'rutinas', 'rutina_slots')
}

test('una_rutina_con_huecos_y_nombre_repetido_da_409_y_no_crea_nada', () => {
  crear_rutina(cliente, 'Pierna')

  const respuesta = cliente.post('/rutinas', {
    json: { nombre: 'PIERNA', slots: [hueco(ejercicio_predefinido_id(bd))] },
  })

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, choca('rutina', 'Pierna')])
  expect(filas_guardadas()).toEqual([1, 0])
})

test('con_un_ejercicio_oculto_y_nombre_repetido_gana_el_404_del_ejercicio', () => {
  // Orden del plan: 422 de forma, 404 de los ejercicios, 422 de los objetivos y, por último,
  // el 409 del nombre.
  crear_rutina(cliente, 'Pierna')
  const oculto = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Ejercicio oculto de prueba')
  expect(cliente.delete(`/ejercicios/${oculto}`, { params: { modo: 'ocultar' } }).status_code).toBe(
    204,
  )

  const respuesta = cliente.post('/rutinas', { json: { nombre: 'Pierna', slots: [hueco(oculto)] } })

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    404,
    ejercicio_oculto('Ejercicio oculto de prueba'),
  ])
  expect(filas_guardadas()).toEqual([1, 0])
})

test('con_un_objetivo_mal_puesto_y_nombre_repetido_gana_el_422_del_objetivo', () => {
  crear_rutina(cliente, 'Pierna')
  // De peso y repeticiones, con el objetivo en segundos.
  const ejercicio = crear_ejercicio(cliente, grupo_muscular_id(cliente), 'Ejercicio de prueba')
  const mal = hueco(ejercicio, objetivo(4, { duracion: [30, 60] }))

  const respuesta = cliente.post('/rutinas', { json: { nombre: 'Pierna', slots: [mal] } })

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    422,
    'El objetivo de «Ejercicio de prueba» va en repeticiones y no en tiempo, porque' +
      ' «Ejercicio de prueba» se apunta con peso y repeticiones.',
  ])
  expect(filas_guardadas()).toEqual([1, 0])
})

test('un_programa_con_una_rutina_oculta_y_nombre_repetido_da_el_404_de_la_rutina', () => {
  creado('programa', 'Torso pierna')
  const oculta = crear_rutina(cliente, 'Torso')
  ocultar('rutina', oculta)

  const respuesta = cliente.post('/programas', {
    json: { nombre: 'Torso pierna', dias: [{ dia_semana: 1, rutina_id: oculta }] },
  })

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    404,
    'Esa rutina no existe o está oculta.',
  ])
  expect(nombres('programa')).toEqual(['Torso pierna'])
})

// --- Renombrar -------------------------------------------------------------------
//
// Con el nombre de otro visible: `un_nombre_repetido_da_409_y_no_cambia_los_dias`
// (`programas.test.ts`) y `un_nombre_repetido_al_guardar_da_409_y_el_orden_no_cambia`
// (`rutinas.test.ts`).

test.each(por_tipo)('renombrar_cambiando_solo_mayusculas_tildes_o_espacios_vale (%s)', (tipo) => {
  // El nombre no cambia de clave: no choca consigo mismo, y queda la forma nueva.
  const objeto = creado(tipo, 'Glúteos')

  const respuesta = renombrar(tipo, objeto, ' GLUTEOS ')

  esperar_estado(respuesta, 200)
  expect(nombres(tipo)).toEqual(['GLUTEOS'])
})

test.each(por_tipo)('renombrar_con_el_nombre_de_uno_oculto_da_el_409_de_oculto (%s)', (tipo) => {
  ocultar(tipo, creado(tipo, 'Torso'))
  const pierna = creado(tipo, 'Pierna')

  const respuesta = renombrar(tipo, pierna, 'torso')

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    409,
    choca_con_oculto(tipo, 'Torso'),
  ])
  expect(nombres(tipo)).toEqual(['Torso', 'Pierna'])
})

test.each(por_tipo)(
  'renombrar_uno_oculto_con_nombre_repetido_da_el_409_de_que_esta_oculto (%s)',
  (tipo) => {
    // Primero se mira que se pueda editar: el nombre, después. Por eso es un texto sin más,
    // sin `campo`: no es un fallo del nombre.
    creado(tipo, 'Torso')
    const pierna = creado(tipo, 'Pierna')
    ocultar(tipo, pierna)

    const respuesta = renombrar(tipo, pierna, 'Torso')

    expect([respuesta.status_code, respuesta.json().detail]).toEqual([
      409,
      TIPOS[tipo].editar_oculto,
    ])
  },
)

// --- Los que ya convivían, importados ----------------------------------------------

test.each(por_tipo)('con_dos_iguales_importados_el_mensaje_nombra_el_visible (%s)', (tipo) => {
  // El oculto va primero en el archivo: aun así, se nombra el visible, que es el que se
  // encuentra en la lista.
  importar(tipo, ['Push', '2026-09-01'], 'PUSH')

  const respuesta = crear(tipo, 'push')

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([409, choca(tipo, 'PUSH')])
})

test.each(por_tipo)('dos_iguales_importados_se_pueden_seguir_editando_y_mostrando (%s)', (tipo) => {
  // Importar no mira los nombres: la copia de esta instalación siempre se carga, y lo
  // cargado no se queda bloqueado.
  const [oculto, visible] = importar(tipo, ['Push', '2026-09-01'], 'Push')

  const renombrado = renombrar(tipo, visible, 'PUSH')
  const mostrado = mostrar(tipo, oculto)

  esperar_estado(renombrado, 200)
  esperar_estado(mostrado, 200)
  expect(nombres(tipo)).toEqual(['Push', 'PUSH'])
  const ids = cliente
    .get(TIPOS[tipo].ruta)
    .json()
    .map((x: any) => x.id)
  expect([...ids].sort((a, b) => a - b)).toEqual([oculto, visible].sort((a, b) => a - b))
})
