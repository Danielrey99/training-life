/**
 * El campo «Nombre» de un programa o una rutina (`.campo` con `.campo-texto` en la web): la
 * etiqueta encima, el texto y, si no vale (vacío o repetido), el borde rojo y el motivo
 * debajo. Hasta 100 caracteres, como en la base.
 */
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { RADIO_PEQUENO, useColores } from '../tema'

interface Props {
  valor: string
  alCambiar: (valor: string) => void
  fallo: string | null
  ejemplo?: string
  desactivado?: boolean
}

export function CampoDeNombre({ valor, alCambiar, fallo, ejemplo, desactivado }: Props) {
  const c = useColores()
  return (
    <View style={estilos.campo}>
      <Text style={[estilos.etiqueta, { color: c.textoTenue }]}>Nombre</Text>
      <TextInput
        accessibilityLabel="Nombre"
        value={valor}
        onChangeText={alCambiar}
        maxLength={100}
        placeholder={ejemplo}
        placeholderTextColor={c.textoTenue}
        editable={!desactivado}
        style={[
          estilos.texto,
          { color: c.texto, backgroundColor: c.fondo, borderColor: fallo ? c.error : c.borde },
        ]}
      />
      {fallo && <Text style={[estilos.fallo, { color: c.error }]}>{fallo}</Text>}
    </View>
  )
}

const estilos = StyleSheet.create({
  campo: { gap: 4 },
  etiqueta: { fontSize: 12.5 },
  texto: {
    minHeight: 44,
    paddingHorizontal: 10,
    fontSize: 15,
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  fallo: { fontSize: 14, lineHeight: 20 },
})
