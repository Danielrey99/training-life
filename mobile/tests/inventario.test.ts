/**
 * Inventario de los tests del backend: cada `def test_*` de backend/tests/test_*.py tiene
 * que estar portado a un test del móvil con el mismo nombre (sin «test_»), o apuntado en
 * no_aplica.ts (con su motivo) o en pendientes.ts (con su hito). Así no se pierde ningún
 * escenario del backend al portar la lógica.
 *
 * Se busca por texto, sin importar los archivos de test. Un nombre que está en dos archivos
 * del backend se apunta con el archivo delante («resumen:siempre_hace_las_mismas_consultas»)
 * y solo cuenta como portado en el archivo del móvil que se llama igual (resumen.test.ts).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { nombresDeTests } from './apoyo/reconocedor'
import { noAplica } from './no_aplica'
import { pendientes } from './pendientes'

const TESTS_DEL_BACKEND = join(__dirname, '..', '..', 'backend', 'tests')
const TESTS_DEL_MOVIL = __dirname

interface TestDelBackend {
  /** El archivo sin «test_» ni «.py»: «sesiones». */
  archivo: string
  /** El nombre sin «test_». */
  nombre: string
  /** Como se apunta en no_aplica.ts y pendientes.ts. */
  clave: string
}

function testsDelBackend(): TestDelBackend[] {
  const encontrados: { archivo: string; nombre: string }[] = []
  for (const fichero of readdirSync(TESTS_DEL_BACKEND).sort()) {
    if (!/^test_\w+\.py$/.test(fichero)) continue
    const texto = readFileSync(join(TESTS_DEL_BACKEND, fichero), 'utf8')
    const archivo = fichero.slice('test_'.length, -'.py'.length)
    for (const m of texto.matchAll(/^(?:async )?def test_([\p{L}\p{N}_]+)/gmu)) {
      encontrados.push({ archivo, nombre: m[1] })
    }
  }
  const veces = new Map<string, number>()
  for (const { nombre } of encontrados) veces.set(nombre, (veces.get(nombre) ?? 0) + 1)
  return encontrados.map((t) => ({
    ...t,
    clave: veces.get(t.nombre)! > 1 ? `${t.archivo}:${t.nombre}` : t.nombre,
  }))
}

function archivosDeTestDelMovil(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name)
    if (entrada.isDirectory()) return archivosDeTestDelMovil(ruta)
    return entrada.name.endsWith('.test.ts') && ruta !== __filename ? [ruta] : []
  })
}

/** De cada nombre de test del móvil, en qué archivos está (por su nombre: «sesiones.test.ts»). */
function testsDelMovil(): Map<string, Set<string>> {
  const donde = new Map<string, Set<string>>()
  for (const ruta of archivosDeTestDelMovil(TESTS_DEL_MOVIL)) {
    // Sin las líneas comentadas: un test comentado no está portado.
    const texto = readFileSync(ruta, 'utf8')
      .split('\n')
      .filter((linea) => !/^\s*\/\//.test(linea))
      .join('\n')
    for (const nombre of nombresDeTests(texto)) {
      if (!donde.has(nombre)) donde.set(nombre, new Set())
      donde.get(nombre)!.add(basename(ruta))
    }
  }
  return donde
}

const backend = testsDelBackend()
const movil = testsDelMovil()
const claves = new Set(backend.map((t) => t.clave))

function estaPortado(t: TestDelBackend): boolean {
  const archivos = movil.get(t.nombre)
  if (!archivos) return false
  // Repetido en el backend: solo cuenta en su archivo del móvil.
  return t.clave === t.nombre || archivos.has(`${t.archivo}.test.ts`)
}

function enLista(clave: string): boolean {
  return Object.hasOwn(noAplica, clave) || Object.hasOwn(pendientes, clave)
}

test('se_leen_los_tests_del_backend', () => {
  // Si la ruta o la expresión dejan de encontrarlos, el resto pasaría sin mirar nada.
  expect(backend.length).toBeGreaterThan(500)
  expect(movil.size).toBeGreaterThan(0)
})

test('cada_test_del_backend_esta_portado_o_apuntado', () => {
  const faltan = backend
    .filter((t) => !estaPortado(t) && !enLista(t.clave))
    .map((t) => `test_${t.archivo}.py: ${t.clave}`)

  expect(faltan).toEqual([])
})

test('ninguno_de_no_aplica_ni_de_pendientes_esta_ya_portado', () => {
  const portados = backend
    .filter((t) => enLista(t.clave) && estaPortado(t))
    .map((t) => `${t.clave} (${Object.hasOwn(noAplica, t.clave) ? 'no_aplica' : 'pendientes'})`)

  expect(portados).toEqual([])
})

test('todos_los_de_no_aplica_y_pendientes_existen_en_el_backend', () => {
  const viejos = [...Object.keys(noAplica), ...Object.keys(pendientes)].filter(
    (clave) => !claves.has(clave),
  )

  expect(viejos).toEqual([])
})

test('ninguno_esta_a_la_vez_en_no_aplica_y_en_pendientes', () => {
  expect(Object.keys(noAplica).filter((clave) => Object.hasOwn(pendientes, clave))).toEqual([])
})

test('cada_uno_de_no_aplica_dice_su_motivo', () => {
  expect(Object.keys(noAplica).filter((clave) => noAplica[clave].trim() === '')).toEqual([])
})

describe('el_reconocedor_de_tests_del_movil', () => {
  test('reconoce_test_each_con_as_const_y_los_test_que_le_siguen', () => {
    const texto = [
      "test.each([['a', 1], ['b', 2]] as const)('primero_con_tabla (%s)', () => {})",
      "test('segundo_normal', () => {})",
      "it('tercero_con_it', () => {})",
    ].join('\n')

    expect(nombresDeTests(texto)).toEqual(['primero_con_tabla', 'segundo_normal', 'tercero_con_it'])
  })

  test('no_se_come_tests_por_un_cierre_dentro_de_una_cadena', () => {
    const texto = [
      "test.each(['a])', \"b)(\", `c])`])('con_cierres_en_cadenas (%s)', () => {})",
      "test('despues_del_each', () => {})",
    ].join('\n')

    expect(nombresDeTests(texto)).toEqual(['con_cierres_en_cadenas', 'despues_del_each'])
  })

  test('reconoce_modificadores_variables_y_plantillas', () => {
    const texto = [
      "test.skip('saltado', () => {})",
      "test.failing('fallo_conocido', () => {})",
      "test.only.each(CASOS)('con_variable (%s)', () => {})",
      "test.each`\n a | b\n ${1} | ${2}\n`('con_plantilla', () => {})",
      "test.each(lista.map((x) => [x]))('con_llamadas_dentro', () => {})",
    ].join('\n')

    expect(nombresDeTests(texto)).toEqual([
      'saltado',
      'fallo_conocido',
      'con_variable',
      'con_plantilla',
      'con_llamadas_dentro',
    ])
  })

  test('ignora_lo_que_no_es_una_declaracion_de_test', () => {
    const texto = [
      "const x = latest('no_es_test')",
      'test.each([1])',
      "expect(it).toBe('tampoco')",
    ].join('\n')

    expect(nombresDeTests(texto)).toEqual([])
  })
})
