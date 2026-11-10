// Copia de `web/src/utiles/ajustes.ts`. Diferencias: se guardan en el `localStorage` de
// expo-sqlite (instalado en `app/_layout.tsx`), y el tema del sistema se lee con
// `Appearance` en vez de `matchMedia`. Si cambia allí, se cambia aquí.
import { useSyncExternalStore } from 'react'
import { Appearance } from 'react-native'

import type { TipoRegistro } from '../logica/tipos'

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
  // En qué se enseñan y se apuntan las distancias del cardio.
  distancia: 'km' | 'mi'
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
  distancia: 'km',
  pasoPeso: 1,
  pasoTiempo: 1,
  pesoCorporal: null,
  objetivoNuevo: {
    peso_reps: { series: 3, min: 8, max: 12 },
    corporal: { series: 3, min: 6, max: 10 },
    tiempo: { series: 3, min: 30, max: 60 },
    // 1 × 20-30 min, en segundos.
    cardio: { series: 1, min: 1200, max: 1800 },
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

/** El tema que se ve: el elegido o, con «Como el sistema», el del sistema. */
export function temaVisible(): 'oscuro' | 'claro' {
  const { tema } = actuales
  if (tema !== 'sistema') return tema
  return Appearance.getColorScheme() === 'light' ? 'claro' : 'oscuro'
}

// Cuando cambia el tema del sistema, se avisa a todos: con «Como el sistema», los colores
// de la app y los de los días dependen de él. Con un objeto nuevo, para que `useAjustes`
// vea el cambio y vuelva a pintar.
Appearance.addChangeListener(() => {
  actuales = { ...actuales }
  avisar.forEach((funcion) => funcion())
})
