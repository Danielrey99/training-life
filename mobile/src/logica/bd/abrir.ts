/**
 * Lo que decide el arranque: poner la base al día (copiándola antes), sincronizar los
 * predefinidos y limpiar las copias viejas. Sin Expo, para poder probarlo en Node.
 *
 * No lanza: devuelve si la base está lista o por qué no. Con un fallo, la app enseña la
 * pantalla de arranque fallido (dejar compartir el archivo, volver a intentarlo) en vez de
 * un «Algo ha fallado» en cada pantalla.
 */
import type { Bd } from './bd'
import { SinCopia } from './copias'
import { aplicarMigraciones, BaseMasNueva, MIGRACIONES, type Migracion } from './migraciones'
import { sincronizarPredefinidos, type ListaDePredefinidos } from './siembra'

export type MotivoDelFallo = 'base_mas_nueva' | 'sin_copia' | 'al_poner_al_dia' | 'otro'

export type EstadoDelArranque =
  { tipo: 'lista' } | { tipo: 'fallida'; motivo: MotivoDelFallo; detalle: string }

/** El aviso técnico que sale al pie de la pantalla: para quien tenga que revisarlo. */
export function detalleDe(error: unknown): string {
  const texto = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return texto.slice(0, 500)
}

export function fallida(motivo: MotivoDelFallo, error: unknown): EstadoDelArranque {
  return { tipo: 'fallida', motivo, detalle: detalleDe(error) }
}

export interface PrepararBase {
  /** Copia la base antes de ponerla al día; si lanza, no se pone al día. */
  copiar: (desde: number, hasta: number) => void
  /** Borra las copias que sobran. Solo tras un arranque correcto; si falla, da igual. */
  limpiarCopias: () => void
  predefinidos: ListaDePredefinidos
  /** El instante de ahora, para `created_at` de los predefinidos nuevos. */
  ahora: string
  migraciones?: Migracion[]
}

export function prepararBase(
  bd: Bd,
  { copiar, limpiarCopias, predefinidos, ahora, migraciones = MIGRACIONES }: PrepararBase,
): EstadoDelArranque {
  try {
    aplicarMigraciones(bd, migraciones, { antesDeMigrar: copiar })
  } catch (error) {
    if (error instanceof BaseMasNueva) return fallida('base_mas_nueva', error)
    if (error instanceof SinCopia) return fallida('sin_copia', error)
    return fallida('al_poner_al_dia', error)
  }
  try {
    sincronizarPredefinidos(bd, predefinidos, ahora)
  } catch (error) {
    return fallida('otro', error)
  }
  try {
    limpiarCopias()
  } catch {
    // Que sobre una copia vieja no impide usar la app: se limpiará en el próximo arranque.
  }
  return { tipo: 'lista' }
}
