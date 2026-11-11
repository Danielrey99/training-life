/**
 * La cabecera de una pantalla con título centrado (`.sesion-cabecera` en la web): a la
 * izquierda, la flecha de volver o un botón de texto (*Cancelar* mientras se edita); a la
 * derecha, un botón de texto (*Editar*, *Guardar*, *Crear*) o nada. Sin botón a un lado, ocupa
 * igual sus 44 px, para que el título siga centrado.
 */
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useColores } from '../tema'
import { Icono } from './Icono'

type Accion = { texto: string; alPulsar: () => void; desactivado?: boolean }

interface Props {
  titulo: string
  subtitulo?: ReactNode
  /** La flecha de volver; con `izquierda`, no sale. */
  alVolver?: () => void
  /** Un botón de texto en lugar de la flecha, en gris (*Cancelar*). */
  izquierda?: Accion
  /** El botón de texto de la derecha, en verde. */
  derecha?: Accion
}

export function Cabecera({ titulo, subtitulo, alVolver, izquierda, derecha }: Props) {
  const c = useColores()

  const botonDeTexto = (accion: Accion, color: string) => (
    <Pressable
      accessibilityRole="button"
      onPress={accion.alPulsar}
      disabled={accion.desactivado}
      style={[estilos.boton, accion.desactivado && { opacity: 0.35 }]}
    >
      <Text style={[estilos.botonTexto, { color }]}>{accion.texto}</Text>
    </Pressable>
  )

  return (
    <View style={estilos.cabecera}>
      {izquierda ? (
        botonDeTexto(izquierda, c.textoTenue)
      ) : alVolver ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={alVolver}
          style={estilos.volver}
        >
          <Icono nombre="volver" color={c.texto} />
        </Pressable>
      ) : (
        <View style={estilos.volver} />
      )}
      <View style={estilos.titulo}>
        <Text style={[estilos.tituloTexto, { color: c.texto }]} accessibilityRole="header">
          {titulo}
        </Text>
        {subtitulo ? (
          <Text style={[estilos.subtitulo, { color: c.textoTenue }]}>{subtitulo}</Text>
        ) : null}
      </View>
      {derecha ? botonDeTexto(derecha, c.acento) : <View style={estilos.volver} />}
    </View>
  )
}

const estilos = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  volver: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  boton: { minWidth: 44, height: 44, paddingHorizontal: 4, justifyContent: 'center' },
  botonTexto: { fontSize: 14, fontWeight: '600' },
  titulo: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tituloTexto: { fontSize: 20, fontWeight: '700', lineHeight: 24, textAlign: 'center' },
  subtitulo: { fontSize: 13, textAlign: 'center' },
})
