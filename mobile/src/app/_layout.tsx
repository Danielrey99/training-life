// Antes que nada: los ajustes se guardan en el `localStorage` que instala expo-sqlite.
import 'expo-sqlite/localStorage/install'

import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { useAjustes } from '../utiles/ajustes'
import { useColores } from '../tema'

export default function Layout() {
  const c = useColores()
  const { tema } = useAjustes()
  return (
    <>
      {/* La hora y los iconos de arriba, oscuros en tema claro y claros en oscuro. */}
      <StatusBar style={tema === 'sistema' ? 'auto' : tema === 'claro' ? 'dark' : 'light'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
    </>
  )
}
