/**
 * Un texto explicativo centrado (pies, leyendas, la tarjeta de Hoy), con la regla de la
 * app: **una frase corta va centrada; si alguna no cabe en una línea, el texto pasa a
 * párrafo alineado a la izquierda**, en un bloque más estrecho y centrado. Si no, una
 * frase partida queda con la segunda línea centrada y colgando. Lo que cabe depende del
 * ancho de la pantalla, así que se mide, como hace el diálogo con su texto. Es la misma
 * regla que `utiles/centrado.ts` de la web.
 *
 * No es para títulos: «Te damos la bienvenida» en dos líneas sigue centrado.
 */
import { Children, useState, type ReactNode } from 'react'
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'

type Props = {
  /** Una o varias frases, separadas por `\n`: cada una cuenta una línea. */
  children: ReactNode
  style?: StyleProp<TextStyle>
}

export function TextoCentrado({ children, style }: Props) {
  const texto = Children.toArray(children)
    .filter((hijo) => typeof hijo === 'string' || typeof hijo === 'number')
    .join('')
  // Lo medido va con su texto: si el texto cambia, se vuelve a medir centrado y a lo
  // ancho, que es como se vería si cabe (ya en párrafo, el bloque estrecho lo partiría).
  const [medido, setMedido] = useState<{ texto: string; enParrafo: boolean } | null>(null)
  const enParrafo = medido?.texto === texto && medido.enParrafo
  const frases = texto.split('\n').length

  return (
    <Text
      onTextLayout={(e) => {
        if (medido?.texto === texto) return
        setMedido({ texto, enParrafo: e.nativeEvent.lines.length > frases })
      }}
      style={[style, estilos.centrado, enParrafo && estilos.enParrafo]}
    >
      {children}
    </Text>
  )
}

const estilos = StyleSheet.create({
  centrado: { textAlign: 'center' },
  enParrafo: { textAlign: 'left', maxWidth: 320, alignSelf: 'center' },
})
