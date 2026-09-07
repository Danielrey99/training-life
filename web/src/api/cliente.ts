/**
 * Único punto por el que la web habla con la API.
 *
 * Todas las llamadas pasan por aquí para que las pantallas no repartan URLs ni
 * manejo de errores por su cuenta: si cambia la forma de un endpoint, se toca
 * un archivo. También es lo que permitiría cambiar `fetch` por otra cosa —o
 * añadir el token cuando exista JWT— sin recorrer toda la aplicación.
 */

import type { Ejercicio, Entrenamiento, GrupoMuscular, Rutina } from './tipos'

// Configurable por si la web se abre desde otro dispositivo de la red de casa,
// donde "localhost" ya no es el PC que sirve la API.
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/**
 * Falla con un mensaje legible en vez de dejar que la pantalla se encuentre un
 * JSON inesperado: `fetch` solo lanza si la red se cae, no si la API responde
 * 404 o 500.
 */
async function pedir<T>(ruta: string): Promise<T> {
  const respuesta = await fetch(`${BASE}${ruta}`)
  if (!respuesta.ok) {
    throw new Error(`La API respondió ${respuesta.status} al pedir ${ruta}`)
  }
  return (await respuesta.json()) as T
}

export const api = {
  gruposMusculares: () => pedir<GrupoMuscular[]>('/grupos-musculares'),
  ejercicios: () => pedir<Ejercicio[]>('/ejercicios'),
  rutinas: () => pedir<Rutina[]>('/rutinas'),
  entrenamientos: () => pedir<Entrenamiento[]>('/entrenamientos'),
}
