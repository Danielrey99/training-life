/**
 * Un número con − y + a los lados, para apuntar con una mano y sin teclado. Puerto de
 * `CampoConPasos` de `web/src/paginas/sesion/FormularioDeSerie.tsx` y de `Pasos` de
 * `CampoDeDuracion.tsx`, que son el mismo control.
 */
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { RADIO_PEQUENO, useColores } from '../tema'
import { leerNumero, numeroLegible } from '../utiles/numeros'
import { Icono } from './Icono'

/** El recuadro con − / campo / +, sin rótulo. */
export function Pasos({
  nombre,
  valor,
  escribir,
  menos,
  mas,
  decimales = false,
}: {
  /** Lo que lee un lector de pantalla en cada control. */
  nombre: string
  valor: string
  escribir: (texto: string) => void
  menos: () => void
  mas: () => void
  decimales?: boolean
}) {
  const c = useColores()
  const boton = (icono: 'menos' | 'mas', alPulsar: () => void, etiqueta: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      onPress={alPulsar}
      style={({ pressed }) => [
        estilos.boton,
        icono === 'menos'
          ? { borderRightWidth: 1, borderRightColor: c.borde }
          : { borderLeftWidth: 1, borderLeftColor: c.borde },
        pressed && { backgroundColor: c.superficie },
      ]}
    >
      <Icono nombre={icono} color={c.texto} />
    </Pressable>
  )
  return (
    <View style={[estilos.pasos, { backgroundColor: c.fondo, borderColor: c.borde }]}>
      {boton('menos', menos, `Menos ${nombre.toLowerCase()}`)}
      <TextInput
        style={[estilos.campo, { color: c.texto }]}
        value={valor}
        onChangeText={escribir}
        // El teclado de números del teléfono; con decimales, con su coma (`leerNumero`
        // acepta coma o punto).
        keyboardType={decimales ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        accessibilityLabel={nombre}
      />
      {boton('mas', mas, `Más ${nombre.toLowerCase()}`)}
    </View>
  )
}

export function Rotulo({ children }: { children: ReactNode }) {
  const c = useColores()
  return <Text style={[estilos.rotulo, { color: c.textoTenue }]}>{children}</Text>
}

export function CampoConPasos({
  etiqueta,
  valor,
  cambiar,
  paso,
  minimo,
  decimales = false,
  extra,
}: {
  etiqueta: string
  valor: string
  cambiar: (valor: string) => void
  paso: number
  minimo: number
  decimales?: boolean
  /** Algo a la derecha de la etiqueta (el conmutador Lastre / Ayuda de la carga). */
  extra?: ReactNode
}) {
  function sumar(cuanto: number) {
    const actual = leerNumero(valor) ?? (cuanto > 0 ? minimo - cuanto : minimo)
    // Redondeado a centésimas solo para quitar el ruido de los decimales en coma flotante
    // (17,5 + 1 no debe quedar en 18,499999).
    const nuevo = Math.max(minimo, Math.round((actual + cuanto) * 100) / 100)
    cambiar(decimales ? numeroLegible(nuevo) : String(nuevo))
  }

  return (
    <View style={estilos.envoltorio}>
      {extra ? (
        <View style={estilos.etiquetaFila}>
          <Rotulo>{etiqueta}</Rotulo>
          {extra}
        </View>
      ) : (
        <Rotulo>{etiqueta}</Rotulo>
      )}
      <Pasos
        nombre={etiqueta}
        valor={valor}
        escribir={cambiar}
        menos={() => sumar(-paso)}
        mas={() => sumar(paso)}
        decimales={decimales}
      />
    </View>
  )
}

const estilos = StyleSheet.create({
  envoltorio: { flex: 1, gap: 4 },
  etiquetaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rotulo: { fontSize: 12.5 },
  pasos: {
    height: 48,
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
    overflow: 'hidden',
  },
  boton: { width: 48, alignItems: 'center', justifyContent: 'center' },
  campo: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
})
