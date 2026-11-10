/**
 * Una duración con dos campos, minutos y segundos, cada uno con su − y su +. Puerto de
 * `web/src/componentes/CampoDeDuracion.tsx`: trabaja sobre los segundos totales (con + en
 * los segundos, 0:59 pasa a 1:00), y un valor de 60 o más segundos que se escriba pasa a
 * minutos. Son dos campos porque el teclado numérico no tiene los dos puntos.
 */
import { StyleSheet, View } from 'react-native'

import { Pasos, Rotulo } from './CampoConPasos'

/** Un número entero de un campo de texto; lo que no lo es, 0. */
function entero(texto: string): number {
  const numero = Math.floor(Number(texto.replace(/\D/g, '')))
  return Number.isFinite(numero) ? numero : 0
}

interface Props {
  etiqueta: string
  /** La duración en segundos, que es como la guarda la api. */
  segundos: number
  cambiar: (segundos: number) => void
  /** Lo que suben o bajan los botones de los segundos (el ajuste del paso del tiempo). */
  paso: number
  /** Al apuntar una serie no hay rótulo encima de «Minutos» y «Segundos»: ya se sabe qué es. */
  sinTitulo?: boolean
}

export function CampoDeDuracion({ etiqueta, segundos, cambiar, paso, sinTitulo }: Props) {
  const minutos = Math.floor(segundos / 60)
  const resto = segundos % 60

  function sumar(cuanto: number) {
    cambiar(Math.max(0, segundos + cuanto))
  }

  const campos = (
    <View style={estilos.fila}>
      <View style={estilos.campo}>
        <Rotulo>Minutos</Rotulo>
        <Pasos
          nombre={`Minutos de ${etiqueta}`}
          valor={String(minutos)}
          escribir={(texto) => cambiar(entero(texto) * 60 + resto)}
          menos={() => sumar(-60)}
          mas={() => sumar(60)}
        />
      </View>
      <View style={estilos.campo}>
        <Rotulo>Segundos</Rotulo>
        <Pasos
          nombre={`Segundos de ${etiqueta}`}
          valor={String(resto)}
          escribir={(texto) => cambiar(minutos * 60 + entero(texto))}
          menos={() => sumar(-paso)}
          mas={() => sumar(paso)}
        />
      </View>
    </View>
  )

  if (sinTitulo) return campos
  return (
    <View style={estilos.campo}>
      <Rotulo>{etiqueta}</Rotulo>
      {campos}
    </View>
  )
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 8 },
  campo: { flex: 1, gap: 4 },
})
