/**
 * Una base como la de un teléfono recién instalado: en memoria, con las migraciones y la
 * siembra de los predefinidos ya aplicadas. Sustituye al `TRUNCATE` del backend: cada
 * test abre la suya.
 *
 * Se rehace entera cada vez y no se copia de una plantilla: en memoria tarda unos pocos
 * milisegundos, y así cada test pasa por el mismo camino que el arranque de la app.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Bd } from '../../src/logica/bd/bd'
import { aplicarMigraciones } from '../../src/logica/bd/migraciones'
import { sincronizarPredefinidos, type ListaDePredefinidos } from '../../src/logica/bd/siembra'
import { abrirBdNode } from './bdNode'

/** El instante con el que se siembran los predefinidos en los tests. */
export const AHORA = '2026-09-01T10:00:00.000Z'

/** `shared/predefinidos.json`, leído de nuevo en cada llamada (se puede modificar). */
export function predefinidos(): ListaDePredefinidos {
  const ruta = join(__dirname, '..', '..', '..', 'shared', 'predefinidos.json')
  return JSON.parse(readFileSync(ruta, 'utf8')) as ListaDePredefinidos
}

export function baseNueva(): Bd {
  const bd = abrirBdNode()
  aplicarMigraciones(bd)
  sincronizarPredefinidos(bd, predefinidos(), AHORA)
  return bd
}
