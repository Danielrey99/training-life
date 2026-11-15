// La pestaña Entrenar: la pantalla de hoy, la sesión y los ajustes (el engranaje de arriba),
// que marcan esta pestaña aunque no sean su pantalla principal.
import { Stack, type ErrorBoundaryProps } from 'expo-router'

import { FalloAlPintar } from '../../../componentes/FalloAlPintar'
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

// Si algo falla al pintar una pantalla de la pestaña, un aviso en su lugar (como la web), y
// no la app cerrada. En Entrenar, el botón reintenta: ir a ella no la volvería a montar.
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <FalloAlPintar {...props} enEntrenar />
}
