/**
 * Los campos del objetivo de un ejercicio en un hueco: series y reps mínimas y máximas, o
 * series y duración mínima y máxima (una debajo de otra: a 390 px no caben dos en fila).
 * Puerto de `web/src/paginas/programas/CamposDelObjetivo.tsx`.
 */
import { StyleSheet, Text, View } from 'react-native'

import { CampoConPasos, Rotulo } from '../../componentes/CampoConPasos'
import { CampoDeDuracion } from '../../componentes/CampoDeDuracion'
import type { Familia, ObjetivoEnTexto } from '../../reglasDePantalla/objetivos'
import { RADIO_PEQUENO, useColores } from '../../tema'
import { ajustes } from '../../utiles/ajustes'
import { duracionLegible, leerNumero } from '../../utiles/numeros'

interface Props {
  familia: Familia
  valor: ObjetivoEnTexto
  cambiar: (cambios: Partial<ObjetivoEnTexto>) => void
  /** Solo se ve: cajas con los valores, sin − ni +. */
  soloLectura?: boolean
}

export function CamposDelObjetivo({ familia, valor, cambiar, soloLectura = false }: Props) {
  const c = useColores()
  const segundos = (texto: string) => Number(leerNumero(texto)) || 0

  if (soloLectura) {
    // Centradas, como el número entre − y + de la versión que se edita (decisión del autor).
    const caja = (etiqueta: string, texto: string) => (
      <View style={estilos.campo}>
        <Rotulo>{etiqueta}</Rotulo>
        <Text
          style={[estilos.caja, { color: c.texto, backgroundColor: c.fondo, borderColor: c.borde }]}
        >
          {texto}
        </Text>
      </View>
    )
    return (
      <>
        <View style={estilos.fila}>{caja('Series objetivo', valor.series)}</View>
        {familia === 'duracion' ? (
          <>
            <View style={estilos.fila}>
              {caja('Duración mínima', duracionLegible(segundos(valor.min)))}
            </View>
            <View style={estilos.fila}>
              {caja('Duración máxima', duracionLegible(segundos(valor.max)))}
            </View>
          </>
        ) : (
          <View style={estilos.fila}>
            {caja('Reps mínimas', valor.min)}
            {caja('Reps máximas', valor.max)}
          </View>
        )}
      </>
    )
  }

  // Cada control va en su fila: crecen a lo ancho (`flex: 1`), no a lo alto.
  return (
    <>
      <View style={estilos.fila}>
        <CampoConPasos
          etiqueta="Series objetivo"
          valor={valor.series}
          cambiar={(series) => cambiar({ series })}
          paso={1}
          minimo={1}
        />
      </View>
      {familia === 'duracion' ? (
        <>
          <View style={estilos.fila}>
            <CampoDeDuracion
              etiqueta="Duración mínima"
              segundos={segundos(valor.min)}
              cambiar={(total) => cambiar({ min: String(total) })}
              paso={ajustes().pasoTiempo}
            />
          </View>
          <View style={estilos.fila}>
            <CampoDeDuracion
              etiqueta="Duración máxima"
              segundos={segundos(valor.max)}
              cambiar={(total) => cambiar({ max: String(total) })}
              paso={ajustes().pasoTiempo}
            />
          </View>
        </>
      ) : (
        <View style={estilos.fila}>
          <CampoConPasos
            etiqueta="Reps mínimas"
            valor={valor.min}
            cambiar={(min) => cambiar({ min })}
            paso={1}
            minimo={1}
          />
          <CampoConPasos
            etiqueta="Reps máximas"
            valor={valor.max}
            cambiar={(max) => cambiar({ max })}
            paso={1}
            minimo={1}
          />
        </View>
      )}
    </>
  )
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 8 },
  campo: { flex: 1, gap: 4 },
  caja: {
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 10,
    fontSize: 15,
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
    fontVariant: ['tabular-nums'],
  },
})
