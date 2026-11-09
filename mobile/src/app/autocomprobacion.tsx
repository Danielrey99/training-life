import { useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { autocomprobar } from '../logica/autocomprobacion'
import { PREDEFINIDOS } from '../plataforma/arranque'
import { abrirBdExpo } from '../plataforma/bdExpo'

// Pantalla oculta: repite en el teléfono, en una base en memoria, lo que los tests dan por
// hecho de SQLite y de JavaScript. Se llega tocando la versión en la pantalla de inicio.
export default function Autocomprobacion() {
  const resultados = useMemo(() => autocomprobar(abrirBdExpo(':memory:'), PREDEFINIDOS), [])
  const fallos = resultados.filter((r) => !r.bien).length
  return (
    <ScrollView style={estilos.fondo} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>Autocomprobación</Text>
      <Text style={fallos ? estilos.mal : estilos.bien}>
        {fallos ? `${fallos} de ${resultados.length} fallan` : `Las ${resultados.length} van bien`}
      </Text>
      {resultados.map((r) => (
        <View key={r.nombre} style={estilos.fila}>
          <Text style={r.bien ? estilos.bien : estilos.mal}>{r.bien ? '✓' : '✕'}</Text>
          <View style={estilos.texto}>
            <Text style={estilos.nombre}>{r.nombre}</Text>
            {!r.bien && <Text style={estilos.detalle}>{r.detalle}</Text>}
          </View>
        </View>
      ))}
    </ScrollView>
  )
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#14161a' },
  contenido: { padding: 16, paddingTop: 48, gap: 12 },
  titulo: { color: '#e8eaed', fontSize: 22, fontWeight: '700' },
  fila: { flexDirection: 'row', gap: 12 },
  texto: { flex: 1 },
  nombre: { color: '#e8eaed', fontSize: 16 },
  detalle: { color: '#9aa1ac', fontSize: 14 },
  bien: { color: '#4ade80', fontSize: 16 },
  mal: { color: '#f87171', fontSize: 16 },
})
