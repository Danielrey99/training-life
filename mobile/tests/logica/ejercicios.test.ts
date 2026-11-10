/**
 * Puerto de `backend/tests/test_ejercicios.py`: la ficha de un ejercicio («dónde se usa»), que
 * una nota solo se alcanza por la ruta de su ejercicio, su tipo de registro, que dos ejercicios
 * no se llamen igual y el orden de dos con el mismo nombre en los listados.
 *
 * Los de `clave_de_nombre` están en `reglas/nombres.test.ts`; el que cuenta consultas SQL no
 * aplica (`no_aplica.ts`).
 */
import type { Bd } from '../../src/logica/bd/bd'
import {
  alternativa,
  crear_ejercicio,
  crear_programa,
  importar_rutinas_y_programas,
  nombre_repetido,
  objetivo,
  ocultar_hueco,
} from '../apoyo/ayudas'
import { crearCliente, type ClienteDeTest as Cliente } from '../apoyo/cliente'
import { ejercicio_predefinido_id, grupo_muscular_id } from '../apoyo/conftest'
import { HOY } from '../apoyo/semana'

// --- Ayudantes ---------------------------------------------------------------

/**
 * Un hueco de repeticiones. Cada comodín, un id (con objetivo de repeticiones) o el cuerpo
 * entero de su alternativa (`alternativa(...)`).
 */
function hueco(principal: number, ...comodines: (number | Record<string, unknown>)[]) {
  return {
    ejercicio_principal_id: principal,
    ...objetivo(3, [6, 10]),
    alternativas: comodines.map((c) => (typeof c === 'number' ? alternativa(c) : c)),
  }
}

/** La rutina con sus huecos, en ese orden; devuelve su id y los de los huecos. */
function rutina_con_huecos(
  cliente: Cliente,
  nombre: string,
  ...huecos: Record<string, unknown>[]
): [number, number[]] {
  const respuesta = cliente.post('/rutinas', { json: { nombre, slots: huecos } })
  expect(respuesta.status_code).toBe(201)
  const rutina = respuesta.json()
  const ordenados: any[] = [...rutina.slots].sort((a: any, b: any) => a.orden - b.orden)
  return [rutina.id, ordenados.map((slot) => slot.id)]
}

function donde_se_usa(cliente: Cliente, ejercicio_id: number): any[] {
  const respuesta = cliente.get(`/ejercicios/${ejercicio_id}/donde-se-usa`)
  expect(respuesta.status_code).toBe(200)
  return respuesta.json()
}

/** Los cuatro ejercicios de la fixture `ejercicios`. */
function crear_ejercicios(cliente: Cliente): Record<string, number> {
  const g = grupo_muscular_id(cliente)
  const ids: Record<string, number> = {}
  for (const nombre of ['Press banca', 'Press en máquina', 'Fondos', 'Remo']) {
    ids[nombre] = crear_ejercicio(cliente, g, nombre)
  }
  return ids
}

// --- La ficha: donde-se-usa ----------------------------------------------------

test('sale_cada_hueco_donde_es_principal_o_alternativa_ordenado_por_rutina', () => {
  // Push se crea antes que Pull para que el orden por nombre no salga gratis del de los ids.
  const { cliente } = crearCliente()
  const ejercicios = crear_ejercicios(cliente)
  const press = ejercicios['Press banca']
  const maquina = ejercicios['Press en máquina']
  const remo = ejercicios['Remo']
  const [push, [hueco_push]] = rutina_con_huecos(cliente, 'Push', hueco(press, maquina))
  const [pull, [hueco_pull]] = rutina_con_huecos(cliente, 'Pull', hueco(remo, press))

  const usos = donde_se_usa(cliente, press)

  expect(usos).toEqual([
    {
      rutina: { id: pull, nombre: 'Pull', oculto_desde: null },
      slot_id: hueco_pull,
      rol: 'comodin',
      posicion: 1,
      oculto: false,
      programas: [],
    },
    {
      rutina: { id: push, nombre: 'Push', oculto_desde: null },
      slot_id: hueco_push,
      rol: 'principal',
      posicion: 1,
      oculto: false,
      programas: [],
    },
  ])
  expect(donde_se_usa(cliente, maquina).map((uso) => uso.rol)).toEqual(['comodin'])
})

test('dos_huecos_en_una_rutina_son_dos_filas_y_la_posicion_solo_cuenta_los_visibles', () => {
  // Push: Remo (oculto), Press, Fondos, Press y Press (oculto). El número de cada hueco es su
  // sitio entre los visibles (1 y 3), no su `orden` (2 y 4); el oculto no tiene número y va
  // plegado.
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const ejercicios = crear_ejercicios(cliente)
  const press = ejercicios['Press banca']
  const fondos = ejercicios['Fondos']
  const remo = ejercicios['Remo']
  const [push, huecos] = rutina_con_huecos(
    cliente,
    'Push',
    hueco(remo),
    hueco(press),
    hueco(fondos),
    hueco(press),
    hueco(press),
  )
  ocultar_hueco(cliente, push, huecos[0])
  ocultar_hueco(cliente, push, huecos[4])

  const usos = donde_se_usa(cliente, press)

  expect(usos.map((uso) => [uso.slot_id, uso.posicion, uso.oculto])).toEqual([
    [huecos[1], 1, false],
    [huecos[3], 3, false],
    [huecos[4], null, true],
  ])
})

test('un_hueco_de_una_rutina_oculta_va_plegado_pero_conserva_su_numero', () => {
  const { cliente, reloj } = crearCliente()
  reloj.fijar(HOY)
  const ejercicios = crear_ejercicios(cliente)
  const press = ejercicios['Press banca']
  const fondos = ejercicios['Fondos']
  const [push] = rutina_con_huecos(cliente, 'Push', hueco(fondos), hueco(press))
  expect(cliente.delete(`/rutinas/${push}?modo=ocultar`).status_code).toBe(204)

  const usos = donde_se_usa(cliente, press)

  expect(usos).toHaveLength(1)
  expect(usos[0].rutina.oculto_desde).toBe('2026-09-16')
  expect([usos[0].posicion, usos[0].oculto]).toEqual([2, true])
})

test('cada_uso_dice_en_que_programas_esta_su_rutina', () => {
  // Salen los programas visibles con algún día vigente de la rutina, por nombre, una vez cada
  // uno aunque la tenga en varios días, y si es el activo. No salen uno oculto, ni uno donde la
  // rutina solo estuvo (fila cerrada), ni uno con otra rutina.
  const { cliente, reloj, bd } = crearCliente()
  reloj.fijar(HOY)
  const ejercicios = crear_ejercicios(cliente)
  const press = ejercicios['Press banca']
  const remo = ejercicios['Remo']
  const [push] = rutina_con_huecos(cliente, 'Push', hueco(press))
  const [pull] = rutina_con_huecos(cliente, 'Pull', hueco(remo))
  const activo = crear_programa(cliente, {
    nombre: 'B activo',
    dias: [
      [5, push],
      [1, push],
      [3, pull],
    ],
    activar: true,
  }).id
  const sin_activar = crear_programa(cliente, { nombre: 'A sin activar', dias: [[2, push]] }).id
  const oculto = crear_programa(cliente, { nombre: 'C oculto', dias: [[4, push]] }).id
  expect(cliente.delete(`/programas/${oculto}?modo=ocultar`).status_code).toBe(204)
  crear_programa(cliente, { nombre: 'D solo Pull', dias: [[6, pull]] })
  const ya_no = crear_programa(cliente, { nombre: 'E ya no', dias: [[6, pull]] }).id
  bd.ejecutar(
    'INSERT INTO programa_dias (programa_id, dia_semana, rutina_id, hasta) VALUES (?, ?, ?, ?)',
    ya_no,
    2,
    push,
    '2026-09-01',
  )

  const usos = donde_se_usa(cliente, press)

  expect(usos).toHaveLength(1)
  expect(usos[0].programas).toEqual([
    { id: sin_activar, nombre: 'A sin activar', activo: false },
    { id: activo, nombre: 'B activo', activo: true },
  ])
})

test('un_ejercicio_oculto_y_uno_predefinido_tienen_ficha', () => {
  const { cliente, bd } = crearCliente()
  const predefinido = ejercicio_predefinido_id(bd)
  const press = crear_ejercicios(cliente)['Press banca']
  const [, [hueco_propio]] = rutina_con_huecos(cliente, 'Push', hueco(press))
  const [, [hueco_predefinido]] = rutina_con_huecos(cliente, 'Leg', hueco(predefinido))
  expect(cliente.delete(`/ejercicios/${press}?modo=ocultar`).status_code).toBe(204)

  expect(donde_se_usa(cliente, press).map((uso) => uso.slot_id)).toEqual([hueco_propio])
  const usos_predefinido = donde_se_usa(cliente, predefinido)
  expect(usos_predefinido.map((uso) => uso.slot_id)).toEqual([hueco_predefinido])
})

test('un_ejercicio_sin_usar_no_sale_en_ninguna_rutina', () => {
  const { cliente } = crearCliente()
  const ejercicios = crear_ejercicios(cliente)
  rutina_con_huecos(cliente, 'Push', hueco(ejercicios['Press banca'], ejercicios['Fondos']))

  expect(donde_se_usa(cliente, ejercicios['Remo'])).toEqual([])
})

// --- Notas: la ruta tiene que cuadrar ------------------------------------------

test('una_nota_de_otro_ejercicio_no_se_alcanza_por_la_ruta_de_este', () => {
  // La ruta lleva el ejercicio y la nota: si no cuadran entre sí, da 404 y la nota no se toca,
  // aunque los dos ejercicios existan y se puedan anotar.
  const { cliente } = crearCliente()
  const ejercicios = crear_ejercicios(cliente)
  const press = ejercicios['Press banca']
  const remo = ejercicios['Remo']
  const nota = cliente
    .post(`/ejercicios/${press}/notas`, { json: { nota: 'Agarre cerrado' } })
    .json()

  const editada = cliente.put(`/ejercicios/${remo}/notas/${nota.id}`, {
    json: { nota: 'Cambiada' },
  })
  const borrada = cliente.delete(`/ejercicios/${remo}/notas/${nota.id}`)

  for (const respuesta of [editada, borrada]) {
    expect([respuesta.status_code, respuesta.json().detail]).toEqual([
      404,
      'Esa nota ya no existe. Puede que la hayas borrado.',
    ])
  }
  expect(cliente.get(`/ejercicios/${press}/notas`).json()).toEqual([nota])
  expect(cliente.get(`/ejercicios/${remo}/notas`).json()).toEqual([])
})

// --- El tipo de registro ---------------------------------------------------------
//
// Cada ejercicio dice cómo se apuntan sus series: peso y repeticiones, peso corporal, tiempo o
// cardio. Se elige al crearlo y no cambia (una serie ya apuntada no se puede reinterpretar): el
// PUT no lo toca aunque llegue en el cuerpo.

test('un_ejercicio_se_crea_con_su_tipo_y_lo_dice_en_la_ficha_y_en_la_lista', () => {
  // Los cuatro tipos se crean y se usan en `medidas.test.ts`.
  const { cliente } = crearCliente()
  const tipo = 'cardio'
  const creado = cliente.post('/ejercicios', {
    json: {
      nombre: 'Ejercicio',
      grupo_muscular_id: grupo_muscular_id(cliente),
      tipo_registro: tipo,
    },
  })

  expect(creado.status_code).toBe(201)
  expect(creado.json().tipo_registro).toBe(tipo)
  // Lo decide el backend, no el cliente: nace propio y visible.
  expect([creado.json().es_predefinido, creado.json().oculto_desde]).toEqual([false, null])
  const ejercicio_id = creado.json().id
  expect(cliente.get(`/ejercicios/${ejercicio_id}`).json().tipo_registro).toBe(tipo)
  const en_la_lista = cliente
    .get('/ejercicios')
    .json()
    .filter((e: any) => e.id === ejercicio_id)
  expect(en_la_lista).toHaveLength(1)
  expect(en_la_lista[0].tipo_registro).toBe(tipo)
})

test('sin_tipo_un_ejercicio_es_de_peso_y_repeticiones', () => {
  const { cliente } = crearCliente()
  const ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id(cliente))

  expect(cliente.get(`/ejercicios/${ejercicio_id}`).json().tipo_registro).toBe('peso_reps')
})

test.each([['Cardio'], [null]])('un_tipo_que_no_existe_da_422_y_no_crea_nada (%j)', (tipo) => {
  // Solo valen los cuatro tipos, tal cual (ni «Cardio» con mayúscula), y un nulo no es «el de
  // por defecto»: el campo se omite o trae uno de los tipos.
  const { cliente } = crearCliente()

  const respuesta = cliente.post('/ejercicios', {
    json: { nombre: 'Cinta', grupo_muscular_id: grupo_muscular_id(cliente), tipo_registro: tipo },
  })

  expect(respuesta.status_code).toBe(422)
  expect(respuesta.json().detail.map((error: any) => error.loc)).toEqual([
    ['body', 'tipo_registro'],
  ])
  expect(
    cliente
      .get('/ejercicios')
      .json()
      .filter((e: any) => !e.es_predefinido),
  ).toEqual([])
})

test('editar_un_ejercicio_no_cambia_su_tipo_aunque_lo_traiga_el_cuerpo', () => {
  // El PUT da 200 y cambia el nombre, pero el tipo se ignora: el campo no es del PUT.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const ejercicio_id = crear_ejercicio(cliente, g, 'Dominadas en anillas', { tipo: 'corporal' })

  const respuesta = cliente.put(`/ejercicios/${ejercicio_id}`, {
    json: {
      nombre: 'Dominadas en anillas lastradas',
      grupo_muscular_id: g,
      tipo_registro: 'tiempo',
    },
  })

  expect(respuesta.status_code).toBe(200)
  expect(respuesta.json().tipo_registro).toBe('corporal')
  const guardado = cliente.get(`/ejercicios/${ejercicio_id}`).json()
  expect([guardado.nombre, guardado.tipo_registro]).toEqual([
    'Dominadas en anillas lastradas',
    'corporal',
  ])
})

// --- Nombres que no se repiten ---------------------------------------------------
//
// Un ejercicio nuevo o renombrado no puede llamarse como otro (predefinido, propio o propio
// oculto), sin distinguir mayúsculas, tildes ni espacios. Solo lo comprueba la API: la base no
// lo impide, y un archivo importado puede traer dos que se llamen igual.

const MARCA = { created_at: '2026-09-01T10:00:00+00:00', updated_at: '2026-09-01T10:00:00+00:00' }

function choca_con_predefinido(nombre: string) {
  return nombre_repetido(
    `Ya hay un ejercicio predefinido que se llama «${nombre}». Búscalo en la pestaña` +
      ' Ejercicios o elige otro nombre.',
  )
}

function choca_con_propio(nombre: string) {
  return nombre_repetido(`Ya tienes un ejercicio que se llama «${nombre}». Elige otro nombre.`)
}

function choca_con_oculto(nombre: string) {
  return nombre_repetido(
    `Ya tienes un ejercicio oculto que se llama «${nombre}». Muéstralo desde la pestaña` +
      ' Ejercicios o elige otro nombre.',
  )
}

function nuevo(cliente: Cliente, nombre: string, grupo: number) {
  return cliente.post('/ejercicios', { json: { nombre, grupo_muscular_id: grupo } })
}

function editado(
  cliente: Cliente,
  ejercicio_id: number,
  nombre: string,
  grupo: number,
  descripcion: string | null = null,
) {
  return cliente.put(`/ejercicios/${ejercicio_id}`, {
    json: { nombre, grupo_muscular_id: grupo, descripcion },
  })
}

function todos_los_ejercicios(cliente: Cliente): any[] {
  return [...cliente.get('/ejercicios').json(), ...cliente.get('/ejercicios?ocultos=true').json()]
}

/** Los propios, visibles y ocultos, como [nombre, id]. */
function propios(cliente: Cliente): [string, number][] {
  return todos_los_ejercicios(cliente)
    .filter((e) => !e.es_predefinido)
    .map((e): [string, number] => [e.nombre, e.id])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]))
}

function ocultar_en_la_base(bd: Bd, ejercicio_id: number): void {
  bd.ejecutar('UPDATE ejercicios SET oculto_desde = ? WHERE id = ?', '2026-09-01', ejercicio_id)
}

/**
 * Sustituye los datos por un archivo con estos propios, cada uno un nombre o un
 * `[nombre, oculto_desde]`. Devuelve sus ids nuevos, en el orden del archivo.
 */
function importar_propios(
  cliente: Cliente,
  grupo: number,
  ...ejercicios: (string | [string, string | null])[]
): number[] {
  const grupos = new Map<number, string>(
    cliente
      .get('/grupos-musculares')
      .json()
      .map((g: any) => [g.id, g.nombre]),
  )
  const filas = ejercicios.map((e): [string, string | null] => (Array.isArray(e) ? e : [e, null]))
  const archivo = {
    formato: 'training-life',
    version: 3,
    exportado_en: MARCA.created_at,
    ejercicios: filas.map(([nombre, oculto], n) => ({
      id: n + 1,
      nombre,
      grupo_muscular: grupos.get(grupo),
      tipo_registro: 'peso_reps',
      oculto_desde: oculto,
      // Para encontrar cada uno después, aunque se llamen igual.
      descripcion: `fila ${n}`,
      ...MARCA,
    })),
  }
  const respuesta = cliente.post('/datos/importar', { json: archivo })
  expect(respuesta.status_code).toBe(200)
  const por_fila = new Map<string, number>(
    todos_los_ejercicios(cliente)
      .filter((e) => !e.es_predefinido)
      .map((e) => [e.descripcion, e.id]),
  )
  return filas.map((_, n) => por_fila.get(`fila ${n}`)!)
}

test('no_se_crea_un_ejercicio_con_el_nombre_de_un_predefinido', () => {
  // En mayúsculas, con espacios dobles o sin tildes sigue siendo el mismo nombre. El mensaje lo
  // nombra como está guardado.
  const { cliente } = crearCliente()

  const respuesta = nuevo(cliente, 'PRESS  banca en maquina', grupo_muscular_id(cliente))

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(choca_con_predefinido('Press banca en máquina'))
  expect(propios(cliente)).toEqual([])
})

test('no_se_crea_un_ejercicio_con_el_nombre_de_uno_propio', () => {
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const existente = crear_ejercicio(cliente, g, 'Curl con cuerda')

  const respuesta = nuevo(cliente, 'curl  con CUERDA', g)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(choca_con_propio('Curl con cuerda'))
  expect(propios(cliente)).toEqual([['Curl con cuerda', existente]])
})

test('no_se_crea_un_ejercicio_con_el_nombre_de_uno_oculto', () => {
  // Uno oculto no se ve en la lista, así que el mensaje dice dónde está.
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const existente = crear_ejercicio(cliente, g, 'Curl con cuerda')
  ocultar_en_la_base(bd, existente)

  const respuesta = nuevo(cliente, 'Curl con cuerda', g)

  expect(respuesta.status_code).toBe(409)
  expect(respuesta.json().detail).toEqual(choca_con_oculto('Curl con cuerda'))
  expect(propios(cliente)).toEqual([['Curl con cuerda', existente]])
})

test('cambiar_solo_mayusculas_o_tildes_del_nombre_se_guarda', () => {
  // Es el mismo nombre: no choca consigo mismo, y queda la forma nueva.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const ejercicio = crear_ejercicio(cliente, g, 'elevacion frontal con disco')

  for (const nombre of ['Elevación frontal con disco', 'ELEVACIÓN FRONTAL CON DISCO']) {
    const respuesta = editado(cliente, ejercicio, nombre, g)

    expect(respuesta.status_code).toBe(200)
    expect(cliente.get(`/ejercicios/${ejercicio}`).json().nombre).toBe(nombre)
  }
})

test('renombrar_un_ejercicio_con_el_nombre_de_otro_da_409_y_no_cambia_nada', () => {
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const curl = crear_ejercicio(cliente, g, 'Curl con cuerda')
  const remo = crear_ejercicio(cliente, g, 'Remo con cuerda')

  const contra_propio = editado(cliente, remo, 'CURL con cuerda', g, 'x')
  const contra_predefinido = editado(cliente, remo, 'sentadilla con barra', g, 'x')

  expect([contra_propio.status_code, contra_propio.json().detail]).toEqual([
    409,
    choca_con_propio('Curl con cuerda'),
  ])
  expect([contra_predefinido.status_code, contra_predefinido.json().detail]).toEqual([
    409,
    choca_con_predefinido('Sentadilla con barra'),
  ])
  const guardado = cliente.get(`/ejercicios/${remo}`).json()
  expect([guardado.nombre, guardado.descripcion]).toEqual(['Remo con cuerda', null])
  expect(propios(cliente)).toEqual([
    ['Curl con cuerda', curl],
    ['Remo con cuerda', remo],
  ])
})

test('un_propio_que_ya_se_llama_como_un_predefinido_se_sigue_pudiendo_editar', () => {
  // Un archivo importado (o un predefinido que llegó después) puede dejar un propio que se llama
  // como un predefinido. Solo se valida lo que cambia: su descripción y las mayúsculas de su
  // nombre se cambian sin un 409.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const [propio] = importar_propios(cliente, g, 'Sentadilla con barra')

  const con_descripcion = editado(cliente, propio, 'Sentadilla con barra', g, 'Con barra baja')
  const con_mayusculas = editado(cliente, propio, 'SENTADILLA con barra', g)

  expect(con_descripcion.status_code).toBe(200)
  expect(con_mayusculas.status_code).toBe(200)
  expect(cliente.get(`/ejercicios/${propio}`).json().nombre).toBe('SENTADILLA con barra')
})

test('al_editar_un_oculto_con_nombre_repetido_manda_el_409_de_oculto', () => {
  // Un texto sin más, sin `campo`: no es un fallo del nombre.
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  crear_ejercicio(cliente, g, 'Curl con cuerda')
  const oculto = crear_ejercicio(cliente, g, 'Remo con cuerda')
  ocultar_en_la_base(bd, oculto)

  const respuesta = editado(cliente, oculto, 'Curl con cuerda', g)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    409,
    'Este ejercicio está oculto. Muéstralo antes de editarlo.',
  ])
})

test('al_editar_un_predefinido_con_nombre_repetido_manda_el_403', () => {
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const predefinido = ejercicio_predefinido_id(bd)
  crear_ejercicio(cliente, g, 'Curl con cuerda')

  const respuesta = editado(cliente, predefinido, 'Curl con cuerda', g)

  expect(respuesta.status_code).toBe(403)
  const guardado = cliente.get(`/ejercicios/${predefinido}`).json()
  expect(guardado.nombre).toBe('Sentadilla con barra')
})

test('si_varios_se_llaman_igual_el_mensaje_nombra_el_predefinido', () => {
  // Un propio importado con el nombre de un predefinido: conviven, y al crear otro igual se
  // nombra el predefinido, que es el que hay que buscar.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  importar_propios(cliente, g, 'sentadilla CON barra')

  const respuesta = nuevo(cliente, 'Sentadilla con barra', g)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    409,
    choca_con_predefinido('Sentadilla con barra'),
  ])
})

test('si_varios_propios_se_llaman_igual_el_mensaje_nombra_el_visible', () => {
  // Uno oculto y uno visible importados con el mismo nombre: el visible es el que se encuentra
  // en la lista, así que es el que se nombra, aunque el oculto vaya antes.
  const { cliente } = crearCliente()
  const g = grupo_muscular_id(cliente)
  importar_propios(cliente, g, ['CURL con cuerda', '2026-08-01'], 'Curl con cuerda')

  const respuesta = nuevo(cliente, 'curl con cuerda', g)

  expect([respuesta.status_code, respuesta.json().detail]).toEqual([
    409,
    choca_con_propio('Curl con cuerda'),
  ])
})

test('mostrar_un_oculto_no_mira_el_nombre_y_conviven_los_dos', () => {
  // Decisión del autor: mostrar solo deshace el ocultar. Uno oculto que se llama como uno propio
  // visible, o como un predefinido, vuelve a la lista sin un 409 y conviven.
  const { cliente, bd } = crearCliente()
  const g = grupo_muscular_id(cliente)
  const predefinido = ejercicio_predefinido_id(bd)
  const [oculto_propio, visible, oculto_como_predefinido] = importar_propios(
    cliente,
    g,
    ['CURL con cuerda', '2026-08-01'],
    'Curl con cuerda',
    ['sentadilla con barra', '2026-08-01'],
  )

  for (const ejercicio of [oculto_propio, oculto_como_predefinido]) {
    const respuesta = cliente.post(`/ejercicios/${ejercicio}/mostrar`)
    expect(respuesta.status_code).toBe(200)
    expect(respuesta.json().oculto_desde).toBeNull()
  }

  const visibles = new Map<number, string>(
    cliente
      .get('/ejercicios')
      .json()
      .map((e: any) => [e.id, e.nombre]),
  )
  expect(visibles.get(oculto_propio)).toBe('CURL con cuerda')
  expect(visibles.get(visible)).toBe('Curl con cuerda')
  expect(visibles.get(oculto_como_predefinido)).toBe('sentadilla con barra')
  expect(visibles.get(predefinido)).toBe('Sentadilla con barra')
})

test('importar_no_mira_los_nombres_y_la_copia_se_vuelve_a_cargar', () => {
  // Dos propios con el mismo nombre en el archivo se cargan los dos, y la copia de esa
  // instalación vuelve a cargarse: una copia propia nunca puede quedar rechazada.
  const { cliente } = crearCliente()
  const ids = importar_propios(
    cliente,
    grupo_muscular_id(cliente),
    'Curl con cuerda',
    'curl  con CUERDA',
  )
  expect(new Set(ids).size).toBe(2)

  const copia = cliente.get('/datos/exportar').json()
  const respuesta = cliente.post('/datos/importar', { json: copia })

  expect(respuesta.status_code).toBe(200)
  expect(propios(cliente).map(([nombre]) => nombre)).toEqual([
    'Curl con cuerda',
    'curl  con CUERDA',
  ])
})

// --- Dos con el mismo nombre salen siempre en el mismo orden ---------------------

/**
 * Reescribe la fila sin cambiar nada. En PostgreSQL pasa al final de la tabla, así que sin
 * desempate por id podría salir detrás de la otra.
 */
function tocar(bd: Bd, tabla: string, fila_id: number): void {
  bd.ejecutar(`UPDATE ${tabla} SET nombre = nombre WHERE id = ?`, fila_id)
}

test('dos_ejercicios_con_el_mismo_nombre_salen_por_id', () => {
  const { cliente, bd } = crearCliente()
  const ids = importar_propios(
    cliente,
    grupo_muscular_id(cliente),
    'Curl con cuerda',
    'Curl con cuerda',
  )
  tocar(bd, 'ejercicios', Math.min(...ids))

  const lista = cliente.get('/ejercicios').json()

  expect(lista.filter((e: any) => e.nombre === 'Curl con cuerda').map((e: any) => e.id)).toEqual(
    [...ids].sort((a, b) => a - b),
  )
})

test.each([
  ['/rutinas', 'rutinas'],
  ['/programas', 'programas'],
])('dos_rutinas_o_programas_con_el_mismo_nombre_salen_por_id (%s)', (ruta, tabla) => {
  // Dos que se llaman igual ya solo llegan importando: la API no deja crearlos.
  const { cliente, bd } = crearCliente()
  const [rutinas, programas] = importar_rutinas_y_programas(
    cliente,
    ['Igual', 'Igual'],
    ['Igual', 'Igual'],
  )
  const ids = tabla === 'rutinas' ? rutinas : programas
  tocar(bd, tabla, ids[0])

  const lista = cliente.get(ruta).json()

  expect(lista.filter((x: any) => x.nombre === 'Igual').map((x: any) => x.id)).toEqual(
    [...ids].sort((a, b) => a - b),
  )
})
