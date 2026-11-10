// La pestaña Historial: el calendario y el día, en su propia pila.
import { Stack } from 'expo-router'

import { useColores } from '../../../tema'

export default function Historial() {
  const c = useColores()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
  )
}
