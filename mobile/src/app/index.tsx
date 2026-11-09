import Constants from 'expo-constants'
import { StyleSheet, Text, View } from 'react-native'

import predefinidos from '../../../shared/predefinidos.json'

// Pantalla provisional: comprueba que el APK se instala, abre y lleva dentro shared/.
export default function Inicio() {
  return (
    <View style={estilos.fondo}>
      <Text style={estilos.titulo}>Training Life</Text>
      <Text style={estilos.texto}>{predefinidos.ejercicios.length} ejercicios predefinidos</Text>
      <Text style={estilos.version}>Versión {Constants.expoConfig?.version}</Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  fondo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#14161a',
  },
  titulo: { color: '#e8eaed', fontSize: 28, fontWeight: '700' },
  texto: { color: '#4ade80', fontSize: 18 },
  version: { color: '#9aa1ac', fontSize: 14 },
})
