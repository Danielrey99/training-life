/**
 * A0 · Al abrir la app: lo que sale, en lugar de toda la app, si no se pueden abrir los datos
 * del teléfono. Sin pestañas: sin datos no hay nada que enseñar. Lo importante es que nadie
 * desinstale (se borrarían los datos) y que se pueda mandar el archivo a quien lo revise.
 *
 * Compartir no pide confirmación (decisión del autor): no cambia nada y el menú de Android
 * ya se puede cerrar sin hacer nada.
 */
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../componentes/Boton'
import type { EstadoDelArranque } from '../logica/bd/abrir'
import { compartirTusDatos } from '../plataforma/arranque'
import {
  ANTES_DEL_DETALLE,
  FALLO_AL_COMPARTIR,
  textosDelArranqueFallido,
} from '../reglasDePantalla/arranque'
import { RADIO_PEQUENO, useColores } from '../tema'

interface Props {
  estado: Extract<EstadoDelArranque, { tipo: 'fallida' }>
  alReintentar: () => void
}

export function ArranqueFallido({ estado, alReintentar }: Props) {
  const c = useColores()
  const textos = textosDelArranqueFallido(estado.motivo)
  const [compartiendo, setCompartiendo] = useState(false)
  const [fallo, setFallo] = useState(false)

  async function compartir() {
    setFallo(false)
    setCompartiendo(true)
    try {
      await compartirTusDatos()
    } catch {
      setFallo(true)
    } finally {
      setCompartiendo(false)
    }
  }

  return (
    <SafeAreaView style={[estilos.pantalla, { backgroundColor: c.fondo }]}>
      <ScrollView contentContainerStyle={estilos.contenido}>
        <Text style={[estilos.titulo, { color: c.texto }]}>{textos.titulo}</Text>
        {textos.parrafos.map((parrafo) => (
          <Text key={parrafo} style={[estilos.parrafo, { color: c.texto }]}>
            {parrafo}
          </Text>
        ))}
        <View style={estilos.botones}>
          {textos.botones.map((boton) => (
            <Boton
              key={boton.accion}
              texto={boton.texto}
              variante={boton.variante}
              desactivado={boton.accion === 'compartir' && compartiendo}
              alPulsar={boton.accion === 'compartir' ? compartir : alReintentar}
            />
          ))}
        </View>
        {fallo && <Text style={[estilos.parrafo, { color: c.error }]}>{FALLO_AL_COMPARTIR}</Text>}
        <View style={estilos.pie}>
          <Text style={[estilos.pieTexto, { color: c.textoTenue }]}>{ANTES_DEL_DETALLE}</Text>
          <Text
            selectable
            style={[
              estilos.detalle,
              { color: c.textoTenue, backgroundColor: c.superficie, borderColor: c.borde },
            ]}
          >
            {estado.detalle}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  contenido: { gap: 16, paddingTop: 48, paddingHorizontal: 16, paddingBottom: 24 },
  titulo: { fontSize: 21, fontWeight: '700', textAlign: 'center', lineHeight: 27 },
  parrafo: { fontSize: 15, lineHeight: 22 },
  botones: { gap: 12, marginTop: 8 },
  pie: { gap: 6, marginTop: 16 },
  pieTexto: { fontSize: 13 },
  detalle: {
    fontSize: 12,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
})
