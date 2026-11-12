import { File, Paths } from 'expo-file-system'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { autocomprobar } from '../logica/autocomprobacion'
import { compartirTusDatos, PREDEFINIDOS, rutaDeLaBase } from '../plataforma/arranque'
import { abrirBdExpo } from '../plataforma/bdExpo'
import { compartirCopia, copiasGuardadas, rutaDeArchivo } from '../plataforma/copias'

/** Las comprobaciones, con un archivo de prueba en la caché que se borra antes y después. */
function comprobarTodo() {
  const prueba = new File(Paths.cache, 'autocomprobacion.db')
  if (prueba.exists) prueba.delete()
  try {
    return autocomprobar(abrirBdExpo(':memory:'), PREDEFINIDOS, rutaDeArchivo(prueba.uri))
  } finally {
    if (prueba.exists) prueba.delete()
  }
}

// Pantalla oculta: repite en el teléfono, en una base en memoria, lo que los tests dan por
// hecho de SQLite y de JavaScript. Se llega tocando la versión en Ajustes. Es también la
// puerta, escondida a propósito, para mandar una copia de antes de poner al día los datos.
export default function Autocomprobacion() {
  const resultados = useMemo(() => comprobarTodo(), [])
  const fallos = resultados.filter((r) => !r.bien).length
  const ruta = rutaDeLaBase()
  const copias = useMemo(() => (ruta ? copiasGuardadas(ruta) : []), [ruta])
  const [aviso, setAviso] = useState<string | null>(null)

  async function compartir(accion: () => Promise<void>) {
    setAviso(null)
    try {
      await accion()
    } catch (error) {
      setAviso(`No se ha podido compartir: ${error instanceof Error ? error.message : error}`)
    }
  }

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

      <Text style={estilos.titulo}>Tus datos</Text>
      <Text selectable style={estilos.detalle}>
        {ruta ?? 'La base no está abierta'}
      </Text>
      <Pressable style={estilos.boton} onPress={() => compartir(compartirTusDatos)}>
        <Text style={estilos.nombre}>Compartir el archivo de tus datos</Text>
      </Pressable>
      {copias.length === 0 ? (
        <Text style={[estilos.detalle, estilos.vacio]}>
          No hay ninguna copia. La app guarda una cada vez que pone al día tus datos.
        </Text>
      ) : (
        copias.map((copia) => (
          <View key={copia.nombre} style={estilos.fila}>
            <View style={estilos.texto}>
              <Text style={estilos.nombre}>{copia.nombre}</Text>
              <Text style={estilos.detalle}>
                {Math.round(copia.tamano / 1024)} KB
                {copia.fecha ? ` · ${new Date(copia.fecha).toLocaleString('es-ES')}` : ''}
              </Text>
            </View>
            <Pressable
              style={estilos.boton}
              onPress={() => compartir(() => compartirCopia(ruta!, copia.nombre))}
            >
              <Text style={estilos.nombre}>Compartir</Text>
            </Pressable>
          </View>
        ))
      )}
      {aviso && <Text style={estilos.mal}>{aviso}</Text>}
    </ScrollView>
  )
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#14161a' },
  contenido: { padding: 16, paddingTop: 48, gap: 12 },
  titulo: { color: '#e8eaed', fontSize: 22, fontWeight: '700' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  texto: { flex: 1 },
  nombre: { color: '#e8eaed', fontSize: 16 },
  detalle: { color: '#9aa1ac', fontSize: 14 },
  bien: { color: '#4ade80', fontSize: 16 },
  mal: { color: '#f87171', fontSize: 16 },
  boton: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c313b',
    borderRadius: 6,
  },
  vacio: { borderWidth: 1, borderColor: '#2c313b', borderRadius: 6, padding: 12 },
})
