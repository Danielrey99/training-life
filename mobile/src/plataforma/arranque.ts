/**
 * Lo que hace la app al abrirse antes de enseñar nada: abrir la base del teléfono, ponerla
 * en la última versión del esquema y al día con los ejercicios predefinidos.
 */
import predefinidos from '../../../shared/predefinidos.json'
import type { Bd } from '../logica/bd/bd'
import { aplicarMigraciones } from '../logica/bd/migraciones'
import { sincronizarPredefinidos, type ListaDePredefinidos } from '../logica/bd/siembra'
import { abrirBdExpo } from './bdExpo'
import { relojDelTelefono } from './reloj'

export const PREDEFINIDOS = predefinidos as ListaDePredefinidos

let abierta: Bd | null = null

/** La base del teléfono, abierta y al día. La primera llamada la prepara; las demás la reutilizan. */
export function baseDelTelefono(): Bd {
  if (abierta) return abierta
  const bd = abrirBdExpo()
  aplicarMigraciones(bd)
  sincronizarPredefinidos(bd, PREDEFINIDOS, relojDelTelefono.ahora())
  abierta = bd
  return bd
}
