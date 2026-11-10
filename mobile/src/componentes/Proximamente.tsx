/** Una pestaña que aún no está hecha en el móvil: lo dice, y lo que ya se puede hacer. */
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useColores } from '../tema'
import { TextoCentrado } from './TextoCentrado'

export function Proximamente({ titulo, texto }: { titulo: string; texto: string }) {
  const c = useColores()
  return (
    <SafeAreaView edges={['top']} style={[estilos.pantalla, { backgroundColor: c.fondo }]}>
      <View style={estilos.caja}>
        <Text style={[estilos.titulo, { color: c.texto }]} accessibilityRole="header">
          {titulo}
        </Text>
        <TextoCentrado style={[estilos.texto, { color: c.textoTenue }]}>{texto}</TextoCentrado>
      </View>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  caja: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  titulo: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  texto: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
})
