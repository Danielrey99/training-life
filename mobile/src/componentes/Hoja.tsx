/**
 * Una hoja que sube desde abajo (`.hoja` en la web): registrar un día, elegir la fecha.
 * Tapa la barra de pestañas a propósito, como los diálogos (decisión del autor): pide una
 * decisión antes de seguir. Se cierra tocando fuera o con el atrás del sistema.
 */
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useColores } from '../tema'
import { TextoCentrado } from './TextoCentrado'

interface Props {
  titulo: string
  subtitulo?: ReactNode
  alCerrar: () => void
  children: ReactNode
}

export function Hoja({ titulo, subtitulo, alCerrar, children }: Props) {
  const c = useColores()
  const margenes = useSafeAreaInsets()
  return (
    <Modal transparent animationType="slide" onRequestClose={alCerrar}>
      <Pressable style={estilos.fondo} onPress={alCerrar}>
        <Pressable
          onPress={() => {}}
          style={[
            estilos.hoja,
            {
              backgroundColor: c.superficie,
              borderTopColor: c.borde,
              paddingBottom: 20 + margenes.bottom,
            },
          ]}
        >
          <View style={[estilos.asa, { backgroundColor: c.borde }]} />
          <Text style={[estilos.titulo, { color: c.texto }]} accessibilityRole="header">
            {titulo}
          </Text>
          {subtitulo && (
            <TextoCentrado style={[estilos.subtitulo, { color: c.textoTenue }]}>
              {subtitulo}
            </TextoCentrado>
          )}
          <ScrollView>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  hoja: {
    maxHeight: '85%',
    paddingTop: 10,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  asa: { width: 40, height: 4, marginBottom: 12, alignSelf: 'center', borderRadius: 999 },
  titulo: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  subtitulo: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 10 },
})
