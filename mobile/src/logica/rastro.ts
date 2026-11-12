/**
 * El rastro de los fallos que no son de la app: un error de programación sale en pantalla
 * como «Algo ha fallado», y sin esto no quedaría en ningún sitio qué pasó. Se guarda el
 * último, con su hora y su pila, para verlo en la autocomprobación.
 *
 * Sin Expo: la plataforma decide dónde se guarda (`alApuntar`) y de dónde se lee al abrir.
 */
import { detalleDe } from './bd/abrir'

export interface Fallo {
  /** Cuándo pasó, en ISO. */
  cuando: string
  /** El nombre y el mensaje del error, como en la pantalla de arranque fallido. */
  detalle: string
  /** La pila, si la trae (recortada: solo hace falta el principio). */
  pila: string | null
}

const LARGO_DE_LA_PILA = 2000

let ultimo: Fallo | null = null
// El error de `ultimo`, para no apuntar dos veces el mismo.
let apuntado: unknown = undefined
let guardar: ((fallo: Fallo) => void) | null = null

/** Lo que hace la plataforma con cada fallo apuntado (guardarlo en un archivo). */
export function alApuntar(accion: ((fallo: Fallo) => void) | null): void {
  guardar = accion
}

/** El último que se apuntó o se cargó, o `null`. */
export function ultimoFallo(): Fallo | null {
  return ultimo
}

/** Deja como último uno guardado de otra vez (al abrir la app), sin volver a guardarlo. */
export function cargarFallo(fallo: Fallo | null): void {
  ultimo = fallo
}

/**
 * Apunta un fallo. Si es el mismo objeto que el último, no hace nada: una pantalla puede
 * pedir su texto en cada pintado. Nunca lanza: apuntar no puede romper lo que lo llama.
 */
export function apuntarFallo(error: unknown, cuando: string = new Date().toISOString()): void {
  if (error === apuntado) return
  apuntado = error
  const pila = error instanceof Error && error.stack ? error.stack.slice(0, LARGO_DE_LA_PILA) : null
  ultimo = { cuando, detalle: detalleDe(error), pila }
  try {
    guardar?.(ultimo)
  } catch {
    // Si no se puede guardar, al menos queda en memoria hasta cerrar la app.
  }
}
