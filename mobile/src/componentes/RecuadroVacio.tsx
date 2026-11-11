/**
 * Un apartado vacío (`.recuadro-vacio` en la web): el recuadro a lo ancho y dentro la frase que
 * dice qué pasa, centrada con `TextoCentrado`. El recuadro es una vista aparte: si la frase no
 * cabe en una línea, `TextoCentrado` estrecha el texto a su bloque de 320 px, y con el borde
 * puesto en el propio texto el recuadro se estrechaba con él.
 */
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { RADIO, useColores } from '../tema'
import { TextoCentrado } from './TextoCentrado'

export function RecuadroVacio({ children }: { children: ReactNode }) {
  const c = useColores()
  return (
    <View style={[estilos.recuadro, { backgroundColor: c.superficie, borderColor: c.borde }]}>
      <TextoCentrado style={[estilos.texto, { color: c.textoTenue }]}>{children}</TextoCentrado>
    </View>
  )
}

const estilos = StyleSheet.create({
  recuadro: { paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderRadius: RADIO },
  texto: { fontSize: 14, lineHeight: 20 },
})
