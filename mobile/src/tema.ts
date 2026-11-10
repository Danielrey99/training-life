/**
 * Los colores de la app: las variables de `web/src/index.css`, en oscuro y en claro, según
 * el tema de Ajustes (por defecto, el del sistema).
 */
import { useColorScheme } from 'react-native'

import { useAjustes } from './utiles/ajustes'

export interface Colores {
  fondo: string
  superficie: string
  borde: string
  texto: string
  textoTenue: string
  acento: string
  error: string
  sobreAcento: string
  /** Lo que caduca hoy (el último día para recuperar). */
  ambar: string
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
  ambar: '#ecb432',
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
  ambar: '#b45309',
}

export const RADIO = 8
export const RADIO_PEQUENO = 6

export function useColores(): Colores {
  const { tema } = useAjustes()
  const sistema = useColorScheme()
  const claro = tema === 'claro' || (tema === 'sistema' && sistema === 'light')
  return claro ? CLARO : OSCURO
}
