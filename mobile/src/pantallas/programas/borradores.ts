/**
 * Los borradores que viven entre varias pantallas: el programa nuevo (P5), la rutina nueva
 * (P3 en estado nueva) y el modo editar de la semana de un programa mientras se crea una
 * rutina para uno de sus días. Puerto de `web/src/paginas/programas/borradores.ts`.
 *
 * Diferencia con la web: aquí viven solo en memoria y mientras esté abierta la pantalla que
 * los empieza (`useBorrador` lo tira al cerrarla). En la web van también a `sessionStorage`
 * para sobrevivir a una recarga, y una marca `empezar` evita que reaparezca uno viejo; en el
 * teléfono no hay recarga, y al cambiar de pestaña la pila de Programas vuelve a su lista y
 * cierra esas pantallas. Además se avisa a quien escucha: la pantalla de debajo (el programa
 * que espera su rutina nueva) se entera sola de lo que cambia la de encima.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import type { DiaSemana, Ejercicio, Objetivo, RutinaMinima } from '../../logica/tipos'

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
  // Su objetivo, de su familia (reps o duración).
  objetivo: Objetivo
  // Cada alternativa con el suyo.
  alternativas: { ejercicio: Ejercicio; objetivo: Objetivo }[]
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
const oyentes = new Set<() => void>()

function avisar() {
  for (const oyente of oyentes) oyente()
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

export function leerBorrador<T>(clave: string): T | null {
  return enMemoria.has(clave) ? (enMemoria.get(clave) as T) : null
}

export function guardarBorrador(clave: string, valor: unknown) {
  enMemoria.set(clave, valor)
  avisar()
}

export function tirarBorrador(clave: string) {
  if (!enMemoria.delete(clave)) return
  avisar()
}

/**
 * Todos los borradores fuera: tras importar o borrar los datos, los ids que guardan (de
 * rutinas y ejercicios) ya no existen.
 */
export function tirarTodosLosBorradores() {
  if (enMemoria.size === 0) return
  enMemoria.clear()
  avisar()
}

/**
 * El borrador de `clave`, para la pantalla que lo empieza: nace con `inicial` al abrirla y se
 * tira al cerrarla. Las pantallas que lo cambian desde encima (el formulario de un ejercicio,
 * la rutina nueva de un día) usan `guardarBorrador`, y esta se vuelve a pintar sola.
 */
export function useBorrador<T>(
  clave: string,
  inicial: () => T,
): [T, (cambio: T | ((antes: T) => T)) => void] {
  // Creado al pintar por primera vez, para que el primer render ya lo tenga.
  if (!enMemoria.has(clave)) enMemoria.set(clave, inicial())
  const primero = useRef(enMemoria.get(clave) as T)
  const valor = useSyncExternalStore(suscribir, () =>
    enMemoria.has(clave) ? (enMemoria.get(clave) as T) : primero.current,
  )

  useEffect(() => {
    // Si React desmonta y vuelve a montar los efectos (en desarrollo), se recupera.
    if (!enMemoria.has(clave)) guardarBorrador(clave, primero.current)
    return () => tirarBorrador(clave)
  }, [clave])

  const cambiar = useCallback(
    (cambio: T | ((antes: T) => T)) => {
      const antes = enMemoria.get(clave) as T
      guardarBorrador(
        clave,
        typeof cambio === 'function' ? (cambio as (antes: T) => T)(antes) : cambio,
      )
    },
    [clave],
  )
  return [valor, cambiar]
}

/** Lee un borrador ajeno y se vuelve a pintar cuando cambia (el programa de una rutina nueva). */
export function useBorradorAjeno<T>(clave: string | null): T | null {
  return useSyncExternalStore(suscribir, () => (clave ? leerBorrador<T>(clave) : null))
}
