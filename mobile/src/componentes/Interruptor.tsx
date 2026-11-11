/**
 * Una tarjeta con un título, su ayuda y un interruptor a la derecha: «Programa activo» en la
 * semana de un programa y «Activarlo al crearlo» en el programa nuevo. Puerto de
 * `web/src/componentes/Interruptor.tsx`. Toda la tarjeta es el control, para acertar con el
 * dedo; qué pasa al pulsarlo (preguntar, guardar) lo decide quien lo usa.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { RADIO, useColores } from '../tema'

interface Props {
  titulo: string
  /** La línea de debajo: qué significa encenderlo o apagarlo. */
  ayuda: string
  encendido: boolean
  alCambiar: () => void
  desactivado?: boolean
}

export function Interruptor({ titulo, ayuda, encendido, alCambiar, desactivado }: Props) {
  const c = useColores()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: encendido, disabled: desactivado }}
      onPress={alCambiar}
      disabled={desactivado}
      style={[
        estilos.tarjeta,
        { backgroundColor: c.superficie, borderColor: c.borde },
        desactivado && { opacity: 0.35 },
      ]}
    >
      <View style={estilos.texto}>
        <Text style={[estilos.titulo, { color: c.texto }]}>{titulo}</Text>
        <Text style={[estilos.ayuda, { color: c.textoTenue }]}>{ayuda}</Text>
      </View>
      <View style={[estilos.pista, { backgroundColor: encendido ? c.acento : c.borde }]}>
        <View
          style={[
            estilos.bola,
            encendido
              ? { backgroundColor: c.fondo, transform: [{ translateX: 18 }] }
              : { backgroundColor: c.textoTenue },
          ]}
        />
      </View>
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  tarjeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: RADIO,
  },
  texto: { flex: 1, minWidth: 0 },
  titulo: { fontSize: 15, fontWeight: '600' },
  ayuda: { fontSize: 13 },
  pista: {
    width: 44,
    height: 26,
    flexShrink: 0,
    justifyContent: 'center',
    padding: 3,
    borderRadius: 999,
  },
  bola: { width: 20, height: 20, borderRadius: 999 },
})
