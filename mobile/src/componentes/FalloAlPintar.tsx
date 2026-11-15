/**
 * Lo que sale si algo falla al pintar una pantalla: sin esto, la app se cerraría, también a
 * mitad de sesión. Un aviso y la salida a Entrenar, con la barra de pestañas a mano. Puerto
 * de `Proteccion` de `web/src/componentes/Proteccion.tsx`.
 *
 * Lo exporta como `ErrorBoundary` cada pila de pestaña (`app/(pestanas)/*\/_layout.tsx`):
 * expo-router lo pone alrededor de la pila, así que las pestañas siguen ahí. Si lo que falla
 * es la propia Entrenar, ir a ella no la volvería a montar: el botón la reintenta.
 */
import { router, type ErrorBoundaryProps } from 'expo-router'
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { apuntarFallo } from '../logica/rastro'
import { useColores } from '../tema'
import { Boton } from './Boton'

export function FalloAlPintar({
  error,
  retry,
  enEntrenar = false,
}: ErrorBoundaryProps & { enEntrenar?: boolean }) {
  const c = useColores()
  // Un fallo atrapado aquí no llega al manejador global: se apunta a mano, para la
  // autocomprobación.
  useEffect(() => apuntarFallo(error), [error])
  return (
    <SafeAreaView edges={['top']} style={[estilos.pantalla, { backgroundColor: c.fondo }]}>
      <View style={estilos.caja}>
        <Text style={[estilos.aviso, { color: c.error }]}>
          Algo ha fallado al enseñar esta pantalla. Lo que ya habías guardado sigue guardado.
        </Text>
        {enEntrenar ? (
          <Boton texto="Reintentar" alPulsar={() => void retry()} />
        ) : (
          <Boton
            texto="Ir a Entrenar"
            alPulsar={() => {
              void retry()
              router.navigate('/')
            }}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  caja: { gap: 12, padding: 16 },
  aviso: { fontSize: 14, lineHeight: 20 },
})
