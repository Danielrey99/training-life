/**
 * Único punto por el que la web habla con la API.
 *
 * Todas las llamadas pasan por aquí para que las pantallas no repartan URLs ni
 * manejo de errores por su cuenta: si cambia la forma de un endpoint, se toca
 * un archivo. También es lo que permitiría cambiar `fetch` por otra cosa —o
 * añadir el token cuando exista JWT— sin recorrer toda la aplicación.
 */

import type {
  Ejercicio,
  Entrenamiento,
  GrupoMuscular,
  NuevaSerie,
  NuevoEntrenamiento,
  Rutina,
  Serie,
} from './tipos'

// Configurable por si la web se abre desde otro dispositivo de la red de casa,
// donde "localhost" ya no es el PC que sirve la API.
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/**
 * Saca del cuerpo de la respuesta el motivo real del fallo.
 *
 * FastAPI lo manda en `detail`, y no siempre como texto: un 422 de validación
 * trae una lista de fallos y algún 409 trae un objeto con datos de más. Sin
 * esto la pantalla solo sabría decir "la API respondió 409", que es justo lo
 * que no ayuda cuando estás en el gimnasio con el móvil en la mano.
 */
async function motivoDelFallo(respuesta: Response): Promise<string | null> {
  try {
    const { detail } = (await respuesta.json()) as { detail?: unknown }
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail.map((fallo: { msg?: string }) => fallo.msg).join('. ')
    }
    if (detail && typeof detail === 'object' && 'mensaje' in detail) {
      return String(detail.mensaje)
    }
    return null
  } catch {
    return null // la respuesta no traía JSON
  }
}

/**
 * Falla con un mensaje legible en vez de dejar que la pantalla se encuentre un
 * JSON inesperado: `fetch` solo lanza si la red se cae, no si la API responde
 * 404 o 500.
 */
async function peticion<T>(ruta: string, opciones?: RequestInit): Promise<T> {
  const respuesta = await fetch(`${BASE}${ruta}`, opciones)
  if (!respuesta.ok) {
    throw new Error((await motivoDelFallo(respuesta)) ?? `La API respondió ${respuesta.status}`)
  }
  // Los DELETE contestan 204, sin cuerpo: pedirles el JSON reventaría.
  if (respuesta.status === 204) return undefined as T
  return (await respuesta.json()) as T
}

/** Sin la cabecera `Content-Type`, FastAPI no lee el cuerpo como JSON. */
function conCuerpo(metodo: 'POST' | 'PUT', datos: unknown): RequestInit {
  return {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  }
}

export const api = {
  gruposMusculares: () => peticion<GrupoMuscular[]>('/grupos-musculares'),
  ejercicios: () => peticion<Ejercicio[]>('/ejercicios'),
  rutinas: () => peticion<Rutina[]>('/rutinas'),
  entrenamientos: () => peticion<Entrenamiento[]>('/entrenamientos'),

  crearEntrenamiento: (datos: NuevoEntrenamiento) =>
    peticion<Entrenamiento>('/entrenamientos', conCuerpo('POST', datos)),

  crearSerie: (entrenamientoId: number, datos: NuevaSerie) =>
    peticion<Serie>(`/entrenamientos/${entrenamientoId}/series`, conCuerpo('POST', datos)),

  borrarSerie: (entrenamientoId: number, serieId: number) =>
    peticion<void>(`/entrenamientos/${entrenamientoId}/series/${serieId}`, { method: 'DELETE' }),
}
