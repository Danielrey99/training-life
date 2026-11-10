/**
 * La última vez en fichas, una por serie: cada una con su peso, porque las series de un mismo
 * día pueden ir a pesos distintos. Puerto de `web/src/paginas/sesion/FichasUltimaVez.tsx`.
 *
 * La variante no se escribe en la ficha, que no cabría: las que la tienen llevan un punto, y
 * al tocarlas sale un globo por encima, donde el dedo no lo tapa. Se cierra tocando otra vez.
 */
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutRectangle } from 'react-native'

import type { SerieHistorial, TipoRegistro } from '../../logica/tipos'
import { RADIO_PEQUENO, useColores } from '../../tema'
import { serieCorta } from '../../utiles/medidas'

// Lo que el globo puede salirse de la caja de las fichas: van dentro de la tarjeta (16 px)
// en la pantalla (16 px), y el globo se queda a 8 px del borde, como en la web.
const SALIDA = 24

export function FichasUltimaVez({
  tipo,
  series,
}: {
  /** El tipo del ejercicio de las series: decide cómo se escribe cada ficha. */
  tipo: TipoRegistro
  series: SerieHistorial[]
}) {
  const c = useColores()
  const [abierta, setAbierta] = useState<number | null>(null)
  // Dónde está cada ficha y cuánto mide el globo, para centrarlo sobre la suya sin que se
  // salga por los lados (en la web, `--mover`).
  const [cajas, setCajas] = useState<Record<number, LayoutRectangle>>({})
  const [ancho, setAncho] = useState(0)
  const [globo, setGlobo] = useState<{ width: number; height: number } | null>(null)

  const serieAbierta = series.find((serie) => serie.id === abierta)
  const caja = abierta !== null ? cajas[abierta] : undefined
  let izquierda = 0
  let flecha = 0
  if (caja && globo) {
    const centro = caja.x + caja.width / 2
    izquierda = Math.min(Math.max(centro - globo.width / 2, -SALIDA), ancho - globo.width + SALIDA)
    flecha = centro - izquierda - 6
  }

  return (
    <View style={estilos.fichas} onLayout={(e) => setAncho(e.nativeEvent.layout.width)}>
      {series.map((serie, indice) => {
        const conVariante = Boolean(serie.variante)
        const pulsada = abierta === serie.id
        return (
          <Pressable
            key={serie.id}
            disabled={!conVariante}
            accessibilityRole={conVariante ? 'button' : undefined}
            accessibilityHint={conVariante ? serie.variante! : undefined}
            accessibilityState={conVariante ? { expanded: pulsada } : undefined}
            onPress={() => {
              setGlobo(null)
              setAbierta(pulsada ? null : serie.id)
            }}
            onLayout={(e) => {
              const medida = e.nativeEvent.layout
              setCajas((antes) => ({ ...antes, [serie.id]: medida }))
            }}
            style={[
              estilos.ficha,
              { backgroundColor: c.fondo, borderColor: c.borde },
              pulsada && { backgroundColor: c.superficie, borderColor: c.acento },
            ]}
          >
            <Text style={[estilos.numero, { color: c.textoTenue }]}>{indice + 1}</Text>
            <Text style={[estilos.texto, { color: c.texto }]}>{serieCorta(tipo, serie)}</Text>
            {conVariante && <View style={[estilos.punto, { backgroundColor: c.acento }]} />}
          </Pressable>
        )
      })}
      {serieAbierta && caja && (
        <View
          pointerEvents="none"
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout
            if (!globo || globo.width !== width || globo.height !== height) {
              setGlobo({ width, height })
            }
          }}
          style={[
            estilos.globo,
            {
              backgroundColor: c.texto,
              left: izquierda,
              top: caja.y - (globo?.height ?? 0) - 10,
              // Hasta medirlo, invisible: si no, se vería un instante fuera de su sitio.
              opacity: globo ? 1 : 0,
            },
          ]}
        >
          <Text style={[estilos.globoTexto, { color: c.fondo }]}>{serieAbierta.variante}</Text>
          <View style={[estilos.globoFlecha, { left: flecha, borderTopColor: c.texto }]} />
        </View>
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  fichas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ficha: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  numero: { fontSize: 11 },
  texto: { fontSize: 14, fontVariant: ['tabular-nums'] },
  punto: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 4,
    height: 4,
    borderRadius: 999,
    opacity: 0.7,
  },
  globo: {
    position: 'absolute',
    zIndex: 5,
    maxWidth: 260,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: RADIO_PEQUENO,
    elevation: 6,
  },
  globoTexto: { fontSize: 13, fontWeight: '600', fontStyle: 'italic', textAlign: 'center' },
  globoFlecha: {
    position: 'absolute',
    top: '100%',
    width: 0,
    height: 0,
    borderWidth: 6,
    borderColor: 'transparent',
  },
})
