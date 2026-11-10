/**
 * Los botones de los principios de diseño (`.boton` y compañía en la web):
 * - `principal`: verde relleno, la acción principal (una por pantalla);
 * - `normal`: con recuadro y fondo;
 * - `secundaria` y `peligro`: con recuadro y sin fondo, en gris o en rojo;
 * - `peligroRelleno`: rojo relleno, la confirmación de lo que no se deshace (en un diálogo).
 * Como mínimo, 44 px de alto.
 */
import { Pressable, StyleSheet, Text } from 'react-native'

import { RADIO_PEQUENO, useColores } from '../tema'

export type Variante = 'principal' | 'normal' | 'secundaria' | 'peligro' | 'peligroRelleno'

interface Props {
  texto: string
  alPulsar: () => void
  variante?: Variante
  desactivado?: boolean
  /** Ocupa lo que le dé su fila (los dos botones de un diálogo, a partes iguales). */
  estirar?: boolean
}

export function Boton({ texto, alPulsar, variante = 'normal', desactivado, estirar }: Props) {
  const c = useColores()
  const aspecto = {
    principal: { fondo: c.acento, borde: c.acento, letra: c.sobreAcento },
    normal: { fondo: c.superficie, borde: c.borde, letra: c.texto },
    secundaria: { fondo: 'transparent', borde: c.borde, letra: c.textoTenue },
    peligro: { fondo: 'transparent', borde: c.error, letra: c.error },
    peligroRelleno: { fondo: c.error, borde: c.error, letra: c.sobreAcento },
  }[variante]
  const pequeno = variante === 'secundaria' || variante === 'peligro'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={alPulsar}
      disabled={desactivado}
      style={({ pressed }) => [
        estilos.boton,
        {
          minHeight: variante === 'principal' ? 52 : pequeno ? 44 : 48,
          backgroundColor: aspecto.fondo,
          borderColor: aspecto.borde,
          opacity: desactivado ? 0.6 : pressed ? 0.8 : 1,
        },
        estirar && estilos.estirar,
      ]}
    >
      <Text
        style={[
          estilos.texto,
          { color: aspecto.letra, fontSize: variante === 'principal' ? 16 : pequeno ? 14 : 15 },
        ]}
      >
        {texto}
      </Text>
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  boton: {
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  estirar: { flex: 1 },
  texto: { fontWeight: '600', textAlign: 'center' },
})
