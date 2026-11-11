/**
 * El contenido de una pantalla con campos de texto: un `ScrollView` que deja sitio al teclado.
 *
 * En Android, con la app de borde a borde, la ventana no se encoge al abrir el teclado: se pone
 * encima, y lo que queda debajo del campo (*Guardar serie*, el *Guardar* de una nota) no se
 * alcanzaba ni desplazando. `automaticallyAdjustKeyboardInsets` no sirve: solo funciona en iOS.
 * Con `KeyboardAvoidingView`, el hueco del teclado se resta de la pantalla y se llega a todo
 * desplazando.
 */
import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

interface Props {
  contentContainerStyle?: StyleProp<ViewStyle>
  /** Para parar el desplazamiento mientras se arrastra una tarjeta. */
  scrollEnabled?: boolean
  children: ReactNode
}

export function Desplazable({ contentContainerStyle, scrollEnabled, children }: Props) {
  return (
    <KeyboardAvoidingView behavior="padding" style={estilos.flex}>
      <ScrollView
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const estilos = StyleSheet.create({ flex: { flex: 1 } })
