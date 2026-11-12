/**
 * Un selector de opciones en una barra (`.progresion-rangos` y `.progresion-selector` en la
 * web). Tiene dos tamaños (decisión del autor): los filtros de arriba de una pantalla, de
 * 38 px con letra de 14, y los de dentro de una tarjeta, de 36 con letra de 13,5.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { RADIO, RADIO_PEQUENO, useColores } from '../tema'

interface Props<T extends string> {
  opciones: readonly { clave: T; texto: string }[]
  elegida: T
  alElegir: (clave: T) => void
  etiqueta: string
  /** El de dentro de una tarjeta: más bajo, y solo tan ancho como sus opciones. */
  pequeno?: boolean
  /** El pequeño, pero a todo lo ancho y con las opciones iguales (los de Ajustes). */
  aLoAncho?: boolean
}

export function Selector<T extends string>({
  opciones,
  elegida,
  alElegir,
  etiqueta,
  pequeno = false,
  aLoAncho = false,
}: Props<T>) {
  const c = useColores()
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={etiqueta}
      style={[
        estilos.barra,
        pequeno ? estilos.barraPequena : estilos.barraGrande,
        aLoAncho && estilos.barraALoAncho,
        { backgroundColor: c.fondo, borderColor: c.borde },
      ]}
    >
      {opciones.map((opcion) => {
        const activa = opcion.clave === elegida
        return (
          <Pressable
            key={opcion.clave}
            accessibilityRole="radio"
            accessibilityState={{ selected: activa }}
            onPress={() => alElegir(opcion.clave)}
            style={[
              estilos.opcion,
              pequeno ? estilos.opcionPequena : estilos.opcionGrande,
              aLoAncho && estilos.opcionALoAncho,
              activa && { backgroundColor: c.superficie, borderColor: c.borde },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                estilos.texto,
                { fontSize: pequeno ? 13.5 : 14, color: activa ? c.acento : c.textoTenue },
              ]}
            >
              {opcion.texto}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const estilos = StyleSheet.create({
  barra: { flexDirection: 'row', gap: 3, borderWidth: 1 },
  barraGrande: { padding: 3, borderRadius: RADIO },
  barraPequena: { padding: 2, borderRadius: RADIO_PEQUENO, alignSelf: 'center' },
  opcion: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  opcionGrande: { flex: 1, minHeight: 38, paddingHorizontal: 6, borderRadius: RADIO_PEQUENO },
  // En la web, tres columnas iguales: aquí, cada una a lo ancho de la más larga.
  opcionPequena: { minWidth: 92, minHeight: 36, paddingHorizontal: 8, borderRadius: 4 },
  // En Ajustes, como en la web: columnas iguales a todo el ancho de la tarjeta.
  barraALoAncho: { alignSelf: 'stretch' },
  opcionALoAncho: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  texto: { fontWeight: '600' },
})
