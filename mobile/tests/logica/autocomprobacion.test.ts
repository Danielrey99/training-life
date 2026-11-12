/**
 * La autocomprobación que enseña la pantalla oculta del teléfono, pasada en Node: las
 * mismas comprobaciones tienen que salir bien aquí, donde corren los tests, y allí. Si una
 * falla solo en el teléfono, la diferencia está en su SQLite o en su motor de JavaScript.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { autocomprobar } from '../../src/logica/autocomprobacion'
import { predefinidos } from '../apoyo/baseNueva'
import { abrirBdNode } from '../apoyo/bdNode'

let carpeta: string

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), 'training-life-autocomprobacion-'))
})

afterEach(() => {
  rmSync(carpeta, { recursive: true, force: true })
})

/** Las de poner la base al día, que van al final (añadidas con las migraciones seguras). */
const DE_LAS_MIGRACIONES = [
  'Copia de la base (VACUUM INTO)',
  'Las claves ajenas no se apagan dentro de una transacción',
  'Rehacer una tabla con hijos los conserva',
  'Un paso que borra hijos sin decirlo se para',
  'La secuencia de ids se conserva al rehacer',
]

test('todas_las_comprobaciones_salen_bien_en_node', () => {
  // La ruta no existe: VACUUM INTO no escribe encima de un archivo.
  const ruta = join(carpeta, 'prueba.db')

  const resultados = autocomprobar(abrirBdNode(), predefinidos(), ruta)

  expect(resultados.length).toBeGreaterThanOrEqual(20)
  expect(resultados.filter((r) => !r.bien)).toEqual([])
  // Cada una con su nombre, para que en la pantalla se sepa cuál ha fallado.
  expect(new Set(resultados.map((r) => r.nombre)).size).toBe(resultados.length)
  expect(resultados.slice(-DE_LAS_MIGRACIONES.length).map((r) => r.nombre)).toEqual(
    DE_LAS_MIGRACIONES,
  )
  // La copia se ha hecho de verdad.
  expect(existsSync(ruta)).toBe(true)
})

test('si_la_ruta_de_prueba_ya_existe_la_copia_sale_mal_y_las_demas_siguen', () => {
  // Quien llama tiene que borrarla antes: si no, la comprobación lo dice, sin tumbar las demás.
  const ruta = join(carpeta, 'prueba.db')
  autocomprobar(abrirBdNode(), predefinidos(), ruta)

  const resultados = autocomprobar(abrirBdNode(), predefinidos(), ruta)

  expect(resultados.filter((r) => !r.bien).map((r) => r.nombre)).toEqual([
    'Copia de la base (VACUUM INTO)',
  ])
})
