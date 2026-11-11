/**
 * Tests de la siembra de los ejercicios predefinidos desde `shared/predefinidos.json`.
 * Sustituyen a los de las migraciones de siembra del backend.
 */
import type { Bd } from '../../src/logica/bd/bd'
import { aplicarMigraciones } from '../../src/logica/bd/migraciones'
import { sincronizarPredefinidos, type ListaDePredefinidos } from '../../src/logica/bd/siembra'
import { AHORA, baseNueva, predefinidos } from '../apoyo/baseNueva'
import { claveDeNombre } from '../../src/logica/reglas/nombres'
import { abrirBdNode } from '../apoyo/bdNode'
import {
  filaAlternativa,
  filaEjercicio,
  filaEntrenamiento,
  filaHueco,
  filaRutina,
  filaSerie,
} from '../apoyo/filas'

const LUEGO = '2026-10-01T10:00:00.000Z'

interface Fila {
  id: number
  nombre: string
  grupo: string
  tipo_registro: string
  descripcion: string | null
  es_predefinido: number
  created_at: string
  updated_at: string
}

function ejercicios(bd: Bd, donde = '1'): Fila[] {
  return bd.todas<Fila>(
    'SELECT e.id, e.nombre, g.nombre AS grupo, e.tipo_registro, e.descripcion,' +
      ' e.es_predefinido, e.created_at, e.updated_at' +
      ` FROM ejercicios e JOIN grupos_musculares g ON g.id = e.grupo_muscular_id WHERE ${donde}` +
      ' ORDER BY e.id',
  )
}

function porNombre(bd: Bd, nombre: string): Fila {
  const [fila, ...otras] = ejercicios(bd).filter((e) => e.nombre === nombre)
  expect(otras).toEqual([])
  return fila
}

function cambiosHechos(bd: Bd): number {
  return bd.una<{ n: number }>('SELECT total_changes() AS n')!.n
}

/** Un predefinido de la lista con el tipo pedido, para cambiarle cosas. */
function unoDeTipo(lista: ListaDePredefinidos, tipo: string) {
  return lista.ejercicios.find((e) => e.tipo_registro === tipo)!
}

test('la_siembra_coincide_con_la_lista_de_predefinidos', () => {
  const lista = predefinidos()
  const bd = abrirBdNode()
  aplicarMigraciones(bd)

  expect(sincronizarPredefinidos(bd, lista, AHORA)).toBe(true)

  const grupos = bd
    .todas<{ nombre: string }>('SELECT nombre FROM grupos_musculares ORDER BY id')
    .map((g) => g.nombre)
  expect(grupos).toEqual(lista.grupos)
  const enLaBase = ejercicios(bd)
  expect(enLaBase.map((e) => [e.nombre, e.grupo, e.tipo_registro, e.descripcion])).toEqual(
    lista.ejercicios.map((e) => [e.nombre, e.grupo, e.tipo_registro, e.descripcion ?? null]),
  )
  expect(enLaBase.filter((e) => e.es_predefinido !== 1)).toEqual([])
  expect(enLaBase.filter((e) => e.created_at !== AHORA || e.updated_at !== AHORA)).toEqual([])
})

test('todos_los_predefinidos_de_la_lista_tienen_descripcion', () => {
  expect(predefinidos().ejercicios.filter((e) => !e.descripcion)).toEqual([])
})

// Los mismos que en el backend: aquí se escriben a mano para no comprobar la lista con lo
// que dice el propio código.
const TIPOS_DE_REGISTRO = new Set(['peso_reps', 'corporal', 'tiempo', 'cardio'])
const LARGO_MINIMO_DE_DESCRIPCION = 60
const LARGO_MAXIMO_DE_DESCRIPCION = 320

test('la_lista_de_predefinidos_es_coherente', () => {
  // Sin base de datos: la lista no se contradice a sí misma. Un nombre repetido (también
  // solo cambiando mayúsculas, tildes o espacios) chocaría al sembrar; un grupo o un tipo
  // que no existe no se podría sembrar; un grupo sin ejercicios no sirve de nada; y el
  // grupo Cardio es justo el de los ejercicios de cardio. Cada descripción es un texto de
  // una sola línea, sin espacios sobrantes, de largo razonable, distinto del nombre y que
  // no repite la de otro ejercicio. Ni el nombre ni la descripción llevan «;».
  const { grupos, ejercicios } = predefinidos()
  const minusculas = (texto: string) => texto.toLowerCase()

  expect(new Set(grupos.map(minusculas)).size).toBe(grupos.length)
  const nombres = ejercicios.map((e) => e.nombre)
  // Con la clave de los nombres: dos que solo cambien en tildes o espacios tampoco.
  expect(new Set(nombres.map(claveDeNombre)).size).toBe(nombres.length)

  const fallos: string[] = []
  for (const ejercicio of ejercicios) {
    const { nombre } = ejercicio
    const campos = Object.keys(ejercicio).sort()
    if (campos.join() !== 'descripcion,grupo,nombre,tipo_registro') {
      fallos.push(`${nombre}: lleva los campos ${campos.join(', ')}`)
    }
    if (typeof nombre !== 'string' || nombre.trim() !== nombre || nombre === '') {
      fallos.push(`«${nombre}»: el nombre está vacío o tiene espacios sobrantes`)
    }
    if (!grupos.includes(ejercicio.grupo)) fallos.push(`${nombre}: el grupo no existe`)
    if (!TIPOS_DE_REGISTRO.has(ejercicio.tipo_registro)) {
      fallos.push(`${nombre}: el tipo no existe`)
    }
    if ((ejercicio.grupo === 'Cardio') !== (ejercicio.tipo_registro === 'cardio')) {
      fallos.push(`${nombre}: el grupo Cardio y el tipo cardio no van juntos`)
    }
    const texto = ejercicio.descripcion
    if (typeof texto !== 'string') {
      fallos.push(`${nombre}: la descripción no es un texto`)
      continue
    }
    if (texto !== texto.trim()) fallos.push(`${nombre}: la descripción tiene espacios sobrantes`)
    // Por caracteres, como el len() de Python, y no por unidades de UTF-16.
    const largo = [...texto].length
    if (largo < LARGO_MINIMO_DE_DESCRIPCION || largo > LARGO_MAXIMO_DE_DESCRIPCION) {
      fallos.push(`${nombre}: la descripción mide ${largo} caracteres`)
    }
    if (/[\n\r]/.test(texto)) fallos.push(`${nombre}: la descripción tiene saltos`)
    if (minusculas(texto) === minusculas(nombre)) {
      fallos.push(`${nombre}: la descripción es su nombre`)
    }
    if (nombre.includes(';') || texto.includes(';')) {
      fallos.push(`${nombre}: lleva «;» en el nombre o la descripción`)
    }
  }
  expect(fallos).toEqual([])

  const descripciones = ejercicios.map((e) => minusculas(e.descripcion ?? ''))
  expect(new Set(descripciones).size).toBe(descripciones.length)
  expect(new Set(ejercicios.map((e) => e.grupo))).toEqual(new Set(grupos))
})

test('con_la_misma_lista_no_escribe_nada', () => {
  const bd = baseNueva()
  const antes = cambiosHechos(bd)

  expect(sincronizarPredefinidos(bd, predefinidos(), LUEGO)).toBe(false)

  expect(cambiosHechos(bd)).toBe(antes)
})

test('con_una_lista_cambiada_escribe_y_luego_ya_no', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  lista.ejercicios[0].descripcion = 'Otra descripción.'

  expect(sincronizarPredefinidos(bd, lista, LUEGO)).toBe(true)
  expect(sincronizarPredefinidos(bd, lista, LUEGO)).toBe(false)
})

test('una_descripcion_cambiada_se_actualiza_y_no_toca_created_at', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  const cambiado = lista.ejercicios[3]
  cambiado.descripcion = 'Otra descripción.'

  sincronizarPredefinidos(bd, lista, LUEGO)

  const fila = porNombre(bd, cambiado.nombre)
  expect(fila.descripcion).toBe('Otra descripción.')
  expect(fila.created_at).toBe(AHORA)
  expect(fila.updated_at).not.toBe(AHORA)
  // Los demás, sin tocar.
  expect(ejercicios(bd).filter((e) => e.updated_at !== AHORA)).toHaveLength(1)
})

test('un_grupo_cambiado_se_actualiza', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  const cambiado = lista.ejercicios.find((e) => e.grupo !== 'Cuello')!
  cambiado.grupo = 'Cuello'

  sincronizarPredefinidos(bd, lista, LUEGO)

  expect(porNombre(bd, cambiado.nombre).grupo).toBe('Cuello')
})

test('un_nombre_que_solo_cambia_en_mayusculas_o_tildes_se_actualiza_en_el_mismo', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  const cambiado = lista.ejercicios[0]
  const { id } = porNombre(bd, cambiado.nombre)
  cambiado.nombre = cambiado.nombre.toUpperCase()

  sincronizarPredefinidos(bd, lista, LUEGO)

  expect(porNombre(bd, cambiado.nombre).id).toBe(id)
  expect(ejercicios(bd)).toHaveLength(predefinidos().ejercicios.length)
})

test('un_ejercicio_nuevo_en_la_lista_se_inserta_como_predefinido', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  lista.grupos.push('Grupo nuevo')
  lista.ejercicios.push({
    nombre: 'Ejercicio nuevo',
    grupo: 'Grupo nuevo',
    tipo_registro: 'tiempo',
    descripcion: 'Cómo se hace.',
  })

  sincronizarPredefinidos(bd, lista, LUEGO)

  expect(porNombre(bd, 'Ejercicio nuevo')).toMatchObject({
    grupo: 'Grupo nuevo',
    tipo_registro: 'tiempo',
    descripcion: 'Cómo se hace.',
    es_predefinido: 1,
    created_at: LUEGO,
    updated_at: LUEGO,
  })
  expect(ejercicios(bd)).toHaveLength(152)
})

test('un_propio_que_se_llama_como_un_predefinido_nuevo_convive_y_no_se_toca', () => {
  const bd = baseNueva()
  const propio = filaEjercicio(bd, { nombre: 'remo  JAPONES', descripcion: 'La mía.' })
  const antes = ejercicios(bd, `e.id = ${propio}`)
  const lista = predefinidos()
  lista.ejercicios.push({
    nombre: 'Remo japonés',
    grupo: lista.grupos[0],
    tipo_registro: 'corporal',
    descripcion: 'La de la lista.',
  })

  sincronizarPredefinidos(bd, lista, LUEGO)

  expect(ejercicios(bd, `e.id = ${propio}`)).toEqual(antes)
  expect(porNombre(bd, 'Remo japonés')).toMatchObject({
    es_predefinido: 1,
    tipo_registro: 'corporal',
  })
})

test('un_propio_que_se_llama_como_un_predefinido_que_cambia_no_se_toca', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  const cambiado = unoDeTipo(lista, 'peso_reps')
  const propio = filaEjercicio(bd, {
    nombre: cambiado.nombre.toLowerCase(),
    tipo_registro: 'peso_reps',
    descripcion: 'La mía.',
  })
  const antes = ejercicios(bd, `e.id = ${propio}`)
  cambiado.descripcion = 'Otra descripción.'
  cambiado.tipo_registro = 'tiempo'

  sincronizarPredefinidos(bd, lista, LUEGO)

  expect(ejercicios(bd, `e.id = ${propio}`)).toEqual(antes)
  expect(porNombre(bd, cambiado.nombre)).toMatchObject({
    descripcion: 'Otra descripción.',
    tipo_registro: 'tiempo',
  })
})

test('el_tipo_de_un_predefinido_sin_uso_cambia', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  const cambiado = unoDeTipo(lista, 'peso_reps')
  cambiado.tipo_registro = 'corporal'

  sincronizarPredefinidos(bd, lista, LUEGO)

  expect(porNombre(bd, cambiado.nombre).tipo_registro).toBe('corporal')
})

describe.each([
  [
    'con una serie',
    (bd: Bd, id: number) => {
      // El hueco es de un propio: lo que usa al predefinido es solo la serie.
      const rutina = filaRutina(bd)
      const hueco = filaHueco(bd, rutina, filaEjercicio(bd, { nombre: 'Propio' }))
      filaSerie(bd, filaEntrenamiento(bd, rutina), hueco, id)
    },
  ],
  ['en un hueco', (bd: Bd, id: number) => filaHueco(bd, filaRutina(bd), id)],
  [
    'en una alternativa',
    (bd: Bd, id: number) => {
      const hueco = filaHueco(bd, filaRutina(bd), filaEjercicio(bd, { nombre: 'Propio' }))
      filaAlternativa(bd, hueco, id)
    },
  ],
])('un predefinido usado %s', (_, usar) => {
  test('no_cambia_de_tipo_pero_si_de_descripcion', () => {
    const bd = baseNueva()
    const lista = predefinidos()
    const cambiado = unoDeTipo(lista, 'peso_reps')
    usar(bd, porNombre(bd, cambiado.nombre).id)
    cambiado.tipo_registro = 'tiempo'
    cambiado.descripcion = 'Otra descripción.'

    expect(sincronizarPredefinidos(bd, lista, LUEGO)).toBe(true)

    expect(porNombre(bd, cambiado.nombre)).toMatchObject({
      tipo_registro: 'peso_reps',
      descripcion: 'Otra descripción.',
    })
  })
})

test('un_predefinido_que_desaparece_de_la_lista_se_queda_como_estaba', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  const [quitado] = lista.ejercicios.splice(5, 1)
  const antes = porNombre(bd, quitado.nombre)

  expect(sincronizarPredefinidos(bd, lista, LUEGO)).toBe(true)

  expect(porNombre(bd, quitado.nombre)).toEqual(antes)
  expect(ejercicios(bd)).toHaveLength(predefinidos().ejercicios.length)
})

test('un_grupo_que_desaparece_de_la_lista_se_queda', () => {
  const bd = baseNueva()
  const lista = predefinidos()
  const cuello = 'Cuello'
  lista.grupos = lista.grupos.filter((g) => g !== cuello)
  lista.ejercicios = lista.ejercicios.filter((e) => e.grupo !== cuello)

  sincronizarPredefinidos(bd, lista, LUEGO)

  expect(bd.una('SELECT 1 AS si FROM grupos_musculares WHERE nombre = ?', cuello)).toEqual({
    si: 1,
  })
})

test('una_lista_con_un_grupo_que_no_esta_lanza_y_no_escribe_nada', () => {
  const bd = baseNueva()
  const antes = ejercicios(bd)
  const lista = predefinidos()
  lista.ejercicios[0].descripcion = 'Otra descripción.'
  lista.ejercicios.push({
    nombre: 'Huérfano',
    grupo: 'No existe',
    tipo_registro: 'peso_reps',
    descripcion: null,
  })

  expect(() => sincronizarPredefinidos(bd, lista, LUEGO)).toThrow(/No existe/)

  expect(ejercicios(bd)).toEqual(antes)
  // Y la próxima vez lo vuelve a intentar con la lista buena.
  expect(sincronizarPredefinidos(bd, predefinidos(), LUEGO)).toBe(false)
  lista.ejercicios.pop()
  expect(sincronizarPredefinidos(bd, lista, LUEGO)).toBe(true)
})
