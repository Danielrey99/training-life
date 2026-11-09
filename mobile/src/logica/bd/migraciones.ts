/**
 * Las versiones del esquema de la base del teléfono, como las migraciones de Alembic.
 *
 * La versión guardada es `PRAGMA user_version` (0 en una base recién creada). Al abrir
 * la app se aplican, en una sola transacción, los pasos que van detrás de ella.
 *
 * Un paso ya publicado en un APK no se edita nunca: los teléfonos que ya lo aplicaron no
 * lo volverían a aplicar. Un cambio va siempre en un paso nuevo, al final de la lista.
 */
import type { Bd } from './bd'
import { ESQUEMA_V1 } from './esquema'

export interface Migracion {
  version: number
  sql: string
}

export const MIGRACIONES: Migracion[] = [{ version: 1, sql: ESQUEMA_V1 }]

export const VERSION_ACTUAL = MIGRACIONES[MIGRACIONES.length - 1].version

/** La base es de una versión de la app más nueva que esta (se instaló un APK más viejo encima). */
export class BaseMasNueva extends Error {
  constructor(
    readonly versionDeLaBase: number,
    readonly versionDeLaApp: number,
  ) {
    super(
      'Tus datos son de una versión más nueva de la app. Instala la última versión para abrirlos.',
    )
    this.name = 'BaseMasNueva'
  }
}

export function versionDeLaBase(bd: Bd): number {
  return bd.una<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0
}

/** Deja la base en la última versión. Devuelve los pasos que ha aplicado. */
export function aplicarMigraciones(bd: Bd, migraciones: Migracion[] = MIGRACIONES): number[] {
  const ultima = migraciones[migraciones.length - 1].version
  const guardada = versionDeLaBase(bd)
  if (guardada > ultima) throw new BaseMasNueva(guardada, ultima)
  const pendientes = migraciones.filter((m) => m.version > guardada)
  if (pendientes.length === 0) return []
  bd.transaccion(() => {
    for (const paso of pendientes) {
      bd.ejecutarVarias(paso.sql)
      // PRAGMA no admite parámetros; la versión es un número de esta lista, no un dato de fuera.
      bd.ejecutarVarias(`PRAGMA user_version = ${Math.trunc(paso.version)}`)
    }
  })
  return pendientes.map((m) => m.version)
}
