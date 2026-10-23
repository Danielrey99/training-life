import { useSyncExternalStore } from 'react'

import type { TipoRegistro } from '../api/tipos'

/**
 * Los ajustes de la app. No están en la base de datos ni viajan en el archivo de
 * exportación: son de cada dispositivo y se guardan en el navegador. Sin nada
 * guardado (o si el navegador no deja guardar), valen los de por defecto.
 */
/** Con lo que empieza un ejercicio nuevo de una rutina: series y, de repeticiones o de segundos. */
export type ObjetivoNuevo = { series: number; min: number; max: number }

export type Ajustes = {
  // Cómo se calcula el 1RM de un día: la media de las series o la mejor.
  unoRM: 'media' | 'mejor'
  unidad: 'kg' | 'lb'
  // Lo que suben o bajan los botones − / + del peso, en la unidad elegida.
  pasoPeso: number
  // Lo que suben o bajan los botones − / + de los segundos de una duración.
  pasoTiempo: number
  // Cuánto pesa la persona, en kg: con lo que arranca cada serie de peso corporal.
  pesoCorporal: number | null
  // Con lo que empieza un ejercicio nuevo de una rutina, según cómo se apunta: reps
  // (3 × 8-12) o segundos (3 × 30-60 s).
  objetivoNuevo: Record<TipoRegistro, ObjetivoNuevo>
  tema: 'sistema' | 'oscuro' | 'claro'
  // Los días con un color que no es el de la app (1 = lunes … 7 = domingo): el id
  // de un color de la paleta.
  colores: Partial<Record<number, string>>
}

export const POR_DEFECTO: Ajustes = {
  unoRM: 'media',
  unidad: 'kg',
  pasoPeso: 1,
  pasoTiempo: 1,
  pesoCorporal: null,
  objetivoNuevo: {
    peso_reps: { series: 3, min: 8, max: 12 },
    corporal: { series: 3, min: 6, max: 10 },
    tiempo: { series: 3, min: 30, max: 60 },
  },
  tema: 'sistema',
  colores: {},
}

const CLAVE = 'training-life.ajustes'

function leer(): Ajustes {
  try {
    const guardado = localStorage.getItem(CLAVE)
    if (!guardado) return POR_DEFECTO
    const leidos = JSON.parse(guardado) as Partial<Ajustes> & {
      objetivo?: { series: number; repsMin: number; repsMax: number }
    }
    // El objetivo de antes de los tipos era el de peso y repeticiones.
    const { objetivo, ...resto } = leidos
    const antiguo = objetivo
      ? { peso_reps: { series: objetivo.series, min: objetivo.repsMin, max: objetivo.repsMax } }
      : {}
    // Con lo de por defecto debajo: un ajuste nuevo no está en lo guardado antes, y el
    // objetivo de cada tipo nuevo tampoco, aunque ya hubiera otros guardados.
    return {
      ...POR_DEFECTO,
      ...resto,
      objetivoNuevo: { ...POR_DEFECTO.objetivoNuevo, ...antiguo, ...resto.objetivoNuevo },
    }
  } catch {
    return POR_DEFECTO
  }
}

let actuales = leer()
const avisar = new Set<() => void>()

/** Los ajustes de ahora, para leerlos fuera de un componente (al formatear un peso). */
export function ajustes(): Ajustes {
  return actuales
}

/** Cambia uno o varios ajustes y lo guarda. */
export function cambiarAjustes(cambios: Partial<Ajustes>) {
  actuales = { ...actuales, ...cambios }
  try {
    localStorage.setItem(CLAVE, JSON.stringify(actuales))
  } catch {
    // Sin poder guardar, el cambio vale hasta que se cierre la pestaña.
  }
  avisar.forEach((funcion) => funcion())
}

function suscribir(funcion: () => void) {
  avisar.add(funcion)
  return () => avisar.delete(funcion)
}

/** Los ajustes, volviendo a pintar el componente cuando cambian. */
export function useAjustes(): Ajustes {
  return useSyncExternalStore(suscribir, ajustes)
}

const SISTEMA_CLARO = '(prefers-color-scheme: light)'

/** El tema que se ve: el elegido o, con «Como el sistema», el del sistema. */
export function temaVisible(): 'oscuro' | 'claro' {
  const { tema } = actuales
  if (tema !== 'sistema') return tema
  return window.matchMedia(SISTEMA_CLARO).matches ? 'claro' : 'oscuro'
}

/**
 * Pone el tema en `<html data-tema>` y lo mantiene al día: cuando cambia el ajuste
 * y, con «Como el sistema», cuando cambia el del sistema. Se llama una vez, al
 * arrancar.
 */
export function aplicarTema() {
  const poner = () => {
    document.documentElement.dataset.tema = temaVisible()
  }
  poner()
  suscribir(poner)
  // Avisa a todos, `poner` incluido: los colores de los días también dependen del tema.
  // Con un objeto nuevo, para que `useAjustes` vea el cambio y vuelva a pintar.
  window.matchMedia(SISTEMA_CLARO).addEventListener('change', () => {
    actuales = { ...actuales }
    avisar.forEach((funcion) => funcion())
  })
}
