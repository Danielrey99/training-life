// La pestaña Programas: la lista, la semana de un programa, el programa nuevo, la rutina y sus
// ejercicios, en su propia pila.
import { Stack } from 'expo-router'

import { FalloAlPintar } from '../../../componentes/FalloAlPintar'
import { useColores } from '../../../tema'

// La lista va siempre debajo, como el calendario en Historial: si se llegara a una de sus
// pantallas desde otra pestaña, la pila no se quedaría solo con ella. Solo se aplica si quien
// navega lo pide: `{ withAnchor: true }`.
export const unstable_settings = { anchor: 'index' }

export default function Programas() {
  const c = useColores()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
  )
}

// Si algo falla al pintar una pantalla de la pestaña, un aviso en su lugar (como la web), y
// no la app cerrada.
export { FalloAlPintar as ErrorBoundary }
