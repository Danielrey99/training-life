// La pestaña Historial: el calendario y el día, en su propia pila.
import { Stack } from 'expo-router'

import { useColores } from '../../../tema'

// El calendario va siempre debajo: si se llega a un día desde otra pestaña (la última sesión
// de Entrenar, terminar una sesión), sin esto la pila sería solo ese día y la pestaña ya no
// volvería nunca al calendario. Solo se aplica si quien navega lo pide: `{ withAnchor: true }`.
export const unstable_settings = { anchor: 'index' }

export default function Historial() {
  const c = useColores()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
  )
}
