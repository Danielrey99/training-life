/**
 * Los colores de la app: las variables de `web/src/index.css`, en oscuro y en claro. Por
 * ahora manda el tema del sistema; elegirlo en Ajustes llega con el resto de Ajustes.
 */
import { useColorScheme } from 'react-native'

export interface Colores {
  fondo: string
  superficie: string
  borde: string
  texto: string
  textoTenue: string
  acento: string
  error: string
  sobreAcento: string
}

const OSCURO: Colores = {
  fondo: '#14161a',
  superficie: '#1c1f26',
  borde: '#2c313b',
  texto: '#e8eaed',
  textoTenue: '#9aa1ac',
  acento: '#4ade80',
  error: '#f87171',
  sobreAcento: '#14161a',
}

const CLARO: Colores = {
  fondo: '#f4f5f7',
  superficie: '#ffffff',
  borde: '#d8dbe0',
  texto: '#1a1d23',
  textoTenue: '#5f6672',
  acento: '#16a34a',
  error: '#dc2626',
  sobreAcento: '#ffffff',
}

export const RADIO = 8
export const RADIO_PEQUENO = 6

export function useColores(): Colores {
  return useColorScheme() === 'light' ? CLARO : OSCURO
}
