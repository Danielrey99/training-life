/**
 * «Ver 2 ejercicios ocultos ⌄» / «Esconder…», al pie de una lista con ocultos: solo si hay
 * alguno. Puerto de `web/src/componentes/Ocultos.tsx`. Es un atajo, solo texto: se entiende
 * por su flecha.
 */
import { Pressable, StyleSheet, Text } from 'react-native'

import { useColores } from '../tema'
import { Icono } from './Icono'

interface Props {
  cuantos: number
  singular: string
  plural: string
  abierto: boolean
  alAlternar: () => void
}

export function Ocultos({ cuantos, singular, plural, abierto, alAlternar }: Props) {
  const c = useColores()
  if (cuantos === 0) return null
  const que = cuantos === 1 ? `1 ${singular}` : `${cuantos} ${plural}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: abierto }}
      onPress={alAlternar}
      style={estilos.boton}
    >
      <Text style={[estilos.texto, { color: c.textoTenue }]}>
        {abierto ? 'Esconder' : 'Ver'} {que}
      </Text>
      <Icono nombre={abierto ? 'arriba' : 'abajo'} color={c.textoTenue} pequeno />
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  boton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  texto: { fontSize: 14, fontWeight: '600' },
})
