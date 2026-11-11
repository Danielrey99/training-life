// La pestaña Ejercicios: la biblioteca, la ficha de cada uno y su formulario, en su propia pila.
import { Stack } from 'expo-router'

import { useColores } from '../../../tema'

// La biblioteca va siempre debajo, como la lista en Programas. Solo se aplica si quien navega
// lo pide: `{ withAnchor: true }`.
export const unstable_settings = { anchor: 'index' }

export default function Ejercicios() {
  const c = useColores()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
  )
}
