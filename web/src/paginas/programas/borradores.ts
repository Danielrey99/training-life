import type { DiaSemana, Ejercicio, RutinaMinima } from '../../api/tipos'

/**
 * Los borradores que viven entre varias pantallas: el programa nuevo (P5) y la rutina
 * nueva (P3 en estado nueva) siguen ahí al ir a elegir o crear algo y volver.
 *
 * Nada de esto llega a la API hasta *Crear* o *Guardar*. Se guardan en memoria y,
 * además, en `sessionStorage`, para que una recarga no los pierda; si el navegador no
 * deja usarlo (modo privado, datos bloqueados), basta con la memoria.
 */

export const DIAS: DiaSemana[] = [1, 2, 3, 4, 5, 6, 7]

/** Qué rutina tiene cada día en un borrador; nula, descanso. */
export type DiasDelBorrador = Record<DiaSemana, RutinaMinima | null>

export function sinDias(): DiasDelBorrador {
  return { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null }
}

/** Lo que una rutina nueva necesita del programa al que vuelve: su nombre y sus días. */
export type DiasConNombre = {
  nombre: string
  dias: DiasDelBorrador
}

export type BorradorDePrograma = DiasConNombre & { activar: boolean }

/** Un ejercicio de la rutina nueva, tal y como lo deja su formulario. */
export type EjercicioDelBorrador = {
  principal: Ejercicio
  alternativas: Ejercicio[]
  series: number
  repsMin: number
  repsMax: number
}

export type BorradorDeRutina = {
  nombre: string
  ejercicios: EjercicioDelBorrador[]
}

export const PROGRAMA_NUEVO = 'borrador-programa-nuevo'
export const RUTINA_NUEVA = 'borrador-rutina-nueva'

/** El modo editar de la semana de un programa, mientras se crea una rutina para un día. */
export function semanaEnEdicion(programaId: number) {
  return `borrador-semana-${programaId}`
}

const enMemoria = new Map<string, unknown>()

export function leerBorrador<T>(clave: string): T | null {
  if (enMemoria.has(clave)) return enMemoria.get(clave) as T
  try {
    const texto = sessionStorage.getItem(clave)
    if (texto === null) return null
    const valor = JSON.parse(texto) as T
    enMemoria.set(clave, valor)
    return valor
  } catch {
    return null
  }
}

export function guardarBorrador(clave: string, valor: unknown) {
  enMemoria.set(clave, valor)
  try {
    sessionStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    // Sin almacenamiento, el borrador vive solo en memoria: se pierde al recargar.
  }
}

/**
 * Todos los borradores fuera: tras importar datos, los ids que guardan (de rutinas y
 * ejercicios) ya no existen.
 */
export function tirarTodosLosBorradores() {
  enMemoria.clear()
  try {
    for (const clave of Object.keys(sessionStorage)) {
      if (clave.startsWith('borrador-')) sessionStorage.removeItem(clave)
    }
  } catch {
    // Sin almacenamiento no había nada guardado.
  }
}

export function tirarBorrador(clave: string) {
  enMemoria.delete(clave)
  try {
    sessionStorage.removeItem(clave)
  } catch {
    // Nada que borrar si no se pudo guardar.
  }
}
