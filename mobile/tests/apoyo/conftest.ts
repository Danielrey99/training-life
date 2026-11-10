/**
 * Las fixtures de `backend/tests/conftest.py` que siguen haciendo falta en el móvil, como
 * funciones que se llaman al principio del test (o de un `beforeEach`). Las demás no se
 * portan: `limpiar_tablas` (cada test abre su base nueva, `baseNueva.ts`), `sesion_bd` (la
 * base es `bd`, del cliente) y `hoy_es` (`reloj.fijar(iso)`).
 *
 * ```ts
 * const { cliente, reloj, bd } = crearCliente()
 * const rutinas = ppl(cliente, reloj)
 * ```
 */
import type { Bd } from '../../src/logica/bd/bd'
import { esperar_estado } from './ayudas'
import type { ClienteDeTest as Cliente, RelojDeTest } from './cliente'

/** Un grupo muscular cualquiera de los sembrados. */
export function grupo_muscular_id(cliente: Cliente): number {
  return cliente.get('/grupos-musculares').json()[0].id
}

/**
 * Uno de los ejercicios predefinidos que siembra la app (el mismo que en el backend).
 *
 * Los tests no crean predefinidos: usan los sembrados.
 */
export function ejercicio_predefinido_id(bd: Bd): number {
  const fila = bd.una<{ id: number }>(
    'SELECT id FROM ejercicios WHERE es_predefinido = 1 AND nombre = ?',
    'Sentadilla con barra',
  )
  if (fila === undefined) throw new Error('Falta el predefinido «Sentadilla con barra».')
  return fila.id
}

/**
 * La semana de `semana.ts`: las tres rutinas (por nombre), con su programa activado el 31 de
 * agosto y el reloj ya en el miércoles 16.
 */
export function ppl(cliente: Cliente, reloj: RelojDeTest): Record<string, number> {
  const rutinas: Record<string, number> = {}
  for (const nombre of ['Push', 'Pull', 'Leg']) {
    rutinas[nombre] = cliente.post('/rutinas', { json: { nombre } }).json().id
  }
  reloj.fijar('2026-08-31')
  const respuesta = cliente.post('/programas', {
    json: {
      nombre: 'Push Pull Leg',
      activar: true,
      dias: [
        { dia_semana: 1, rutina_id: rutinas.Push },
        { dia_semana: 3, rutina_id: rutinas.Pull },
        { dia_semana: 5, rutina_id: rutinas.Leg },
      ],
    },
  })
  esperar_estado(respuesta, 201)
  reloj.fijar('2026-09-16')
  return rutinas
}
