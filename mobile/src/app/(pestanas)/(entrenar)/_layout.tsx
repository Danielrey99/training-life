// La pestaña Entrenar: la pantalla de hoy, la sesión y los ajustes (el engranaje de arriba),
// que marcan esta pestaña aunque no sean su pantalla principal.
import { Stack } from 'expo-router'

import { useColores } from '../../../tema'

// Hoy va siempre debajo: si se llega a una sesión desde otra pestaña («Seguir apuntando» del
// historial), la flecha y el atrás de Android vuelven a Hoy en lugar de salir de la pila. Solo
// se aplica si quien navega lo pide: `{ withAnchor: true }`.
export const unstable_settings = { anchor: 'index' }

export default function Entrenar() {
  const c = useColores()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
  )
}
