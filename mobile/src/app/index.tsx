import Constants from 'expo-constants'
import { Link } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { baseDelTelefono } from '../plataforma/arranque'

// Pantalla provisional hasta que esté Entrenar: comprueba que la base del teléfono abre,
// con su esquema y sus predefinidos.
export default function Inicio() {
  const predefinidos = useMemo(
    () =>
      baseDelTelefono().una<{ n: number }>(
        'SELECT count(*) AS n FROM ejercicios WHERE es_predefinido = 1',
      )?.n ?? 0,
    [],
  )
  return (
    <View style={estilos.fondo}>
      <Text style={estilos.titulo}>Training Life</Text>
      <Text style={estilos.texto}>{predefinidos} ejercicios predefinidos</Text>
      <Link href="/autocomprobacion" style={estilos.version}>
        Versión {Constants.expoConfig?.version}
      </Link>
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
  version: { color: '#9aa1ac', fontSize: 14, padding: 12 },
})
