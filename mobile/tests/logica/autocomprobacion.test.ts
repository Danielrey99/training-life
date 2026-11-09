/**
 * La autocomprobación que enseña la pantalla oculta del teléfono, pasada en Node: las
 * mismas comprobaciones tienen que salir bien aquí, donde corren los tests, y allí. Si una
 * falla solo en el teléfono, la diferencia está en su SQLite o en su motor de JavaScript.
 */
import { autocomprobar } from '../../src/logica/autocomprobacion'
import { predefinidos } from '../apoyo/baseNueva'
import { abrirBdNode } from '../apoyo/bdNode'

test('todas_las_comprobaciones_salen_bien_en_node', () => {
  const resultados = autocomprobar(abrirBdNode(), predefinidos())

  expect(resultados.length).toBeGreaterThanOrEqual(15)
  expect(resultados.filter((r) => !r.bien)).toEqual([])
  // Cada una con su nombre, para que en la pantalla se sepa cuál ha fallado.
  expect(new Set(resultados.map((r) => r.nombre)).size).toBe(resultados.length)
})
