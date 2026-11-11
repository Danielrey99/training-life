/**
 * Un icono dentro de una frase («Pulsa › para…»), en la línea del texto. Android coloca una
 * vista dentro de un `Text` por arriba, así que se baja a mano, como el `vertical-align` de la
 * web. Siempre pequeño y en el gris de los textos explicativos.
 */
import { View } from 'react-native'

import { useColores } from '../tema'
import { Icono, type NombreIcono } from './Icono'

export function IconoEnTexto({ nombre }: { nombre: NombreIcono }) {
  const c = useColores()
  return (
    <View style={{ transform: [{ translateY: 4 }], marginHorizontal: 2 }}>
      <Icono nombre={nombre} color={c.textoTenue} pequeno />
    </View>
  )
}
