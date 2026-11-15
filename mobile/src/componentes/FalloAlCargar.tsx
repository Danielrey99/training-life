/**
 * Lo que sale cuando una pantalla no ha podido leer sus datos: el motivo y un botón para
 * volver a pedirlos. Lo que no existe no se reintenta: un 404 enseña la frase de la app.
 * Puerto de `FalloAlCargar` de `web/src/componentes/Proteccion.tsx`.
 */
import { StyleSheet, Text, View } from 'react-native'

import { ErrorDeApi, textoDelFallo } from '../logica/api'
import { useColores } from '../tema'
import { Boton } from './Boton'

export function FalloAlCargar({
  fallo,
  alReintentar,
}: {
  fallo: unknown
  alReintentar: () => void
}) {
  const c = useColores()
  const aviso = [estilos.aviso, { color: c.error }]
  if (fallo instanceof ErrorDeApi && fallo.estado === 404) {
    return <Text style={aviso}>{textoDelFallo(fallo)}</Text>
  }
  // Un dato que no vale viene de la ruta: o no tiene la forma que toca, o la lógica lo
  // explica con una frase («Diciembre de 2026 todavía no ha llegado…»), que se enseña tal cual.
  if (fallo instanceof ErrorDeApi && fallo.estado === 422) {
    return (
      <Text style={aviso}>
        {typeof fallo.detalle === 'string' ? fallo.message : 'Esa página no existe.'}
      </Text>
    )
  }
  return (
    <View style={estilos.caja}>
      <Text style={aviso}>{textoDelFallo(fallo)}</Text>
      <Boton texto="Reintentar" alPulsar={alReintentar} />
    </View>
  )
}

const estilos = StyleSheet.create({
  caja: { gap: 12 },
  aviso: { fontSize: 14, lineHeight: 20, padding: 16 },
})
