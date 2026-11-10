// La pestaña Entrenar: la pantalla de hoy, la sesión y los ajustes (el engranaje de arriba),
// que marcan esta pestaña aunque no sean su pantalla principal.
import { Stack } from 'expo-router'

import { useColores } from '../../../tema'

export default function Entrenar() {
  const c = useColores()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
  )
}
