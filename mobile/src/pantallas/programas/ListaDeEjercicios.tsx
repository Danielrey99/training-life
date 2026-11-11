/**
 * Los ejercicios de una rutina, en tarjetas numeradas por posición (no por su `orden`
 * guardado, que puede tener saltos). Puerto de `web/src/paginas/programas/ListaDeEjercicios.tsx`.
 *
 * Con `alMover`, se reordenan arrastrando el asa: cuando el centro de la arrastrada pasa el de
 * su vecina se intercambian, y la arrastrada sigue al dedo. Diferencia con la web: aquí lo
 * hace `PanResponder` de React Native (sin teclado), y mientras se arrastra se para el
 * desplazamiento de la pantalla (`alArrastrar`), que si no se quedaría con el gesto.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'

import { Icono } from '../../componentes/Icono'
import { RADIO, useColores } from '../../tema'

export type FilaDeEjercicio = {
  clave: string | number
  nombre: string
  /** «4 × 6-10» */
  objetivo: string
  /** La línea de debajo: alternativas, «oculto desde…». */
  detalle: string | null
  /** El ejercicio principal está oculto: el nombre va en gris con su etiqueta. */
  principalOculto?: boolean
  /** Qué pasa al tocarla; sin él, la fila no se abre (editando). */
  alAbrir?: () => void
}

interface Props {
  filas: FilaDeEjercicio[]
  /** Con `alMover`, cada fila lleva el asa para arrastrarla. */
  alMover?: (desde: number, hasta: number) => void
  /** Avisa al empezar y al acabar de arrastrar, para parar el desplazamiento de la pantalla. */
  alArrastrar?: (arrastrando: boolean) => void
  /** Sin número delante: los ocultos no tienen posición en la rutina. */
  sinNumero?: boolean
  /** Tarjetas con borde discontinuo (los ocultos). */
  oculta?: boolean
}

// El hueco entre tarjetas (`gap` de la lista): al cruzar a otra, la arrastrada se desplaza su
// alto más este hueco.
const SEPARACION = 10

export function ListaDeEjercicios({ filas, alMover, alArrastrar, sinNumero, oculta }: Props) {
  const c = useColores()
  const [arrastre, setArrastre] = useState<{ clave: string | number; dy: number } | null>(null)
  const altos = useRef(new Map<string | number, number>())
  // Lo que ya se ha desplazado el origen por los intercambios hechos en este arrastre.
  const desplazado = useRef(0)
  // Lo último de cada render, para los manejadores del gesto, que se crean una vez por fila.
  const actual = useRef({ filas, alMover, alArrastrar })
  useLayoutEffect(() => {
    actual.current = { filas, alMover, alArrastrar }
  })

  // Creados una vez: las tarjetas guardan estos manejadores en su `PanResponder`.
  const [gesto] = useState<Gesto>(() => ({
    empezar(clave: string | number) {
      desplazado.current = 0
      setArrastre({ clave, dy: 0 })
      actual.current.alArrastrar?.(true)
    },
    mover(clave: string | number, dy: number) {
      const { filas: lista, alMover: mover } = actual.current
      const indice = lista.findIndex((fila) => fila.clave === clave)
      if (indice < 0 || !mover) return
      const alto = altos.current.get(clave) ?? 0
      const desplazamiento = dy - desplazado.current
      const siguiente = lista[indice + 1] && (altos.current.get(lista[indice + 1].clave) ?? 0)
      const anterior = lista[indice - 1] && (altos.current.get(lista[indice - 1].clave) ?? 0)
      if (siguiente && desplazamiento > (alto + siguiente) / 2 + SEPARACION) {
        mover(indice, indice + 1)
        desplazado.current += siguiente + SEPARACION
      } else if (anterior && desplazamiento < -((alto + anterior) / 2 + SEPARACION)) {
        mover(indice, indice - 1)
        desplazado.current -= anterior + SEPARACION
      }
      setArrastre({ clave, dy: dy - desplazado.current })
    },
    soltar() {
      setArrastre(null)
      actual.current.alArrastrar?.(false)
    },
    medir(clave: string | number, alto: number) {
      altos.current.set(clave, alto)
    },
  }))

  return (
    <View style={estilos.lista}>
      {filas.map((fila, indice) => (
        <Tarjeta
          key={fila.clave}
          fila={fila}
          numero={sinNumero ? null : indice + 1}
          conAsa={!!alMover}
          oculta={!!oculta}
          dy={arrastre?.clave === fila.clave ? arrastre.dy : null}
          gesto={gesto}
          colores={c}
        />
      ))}
    </View>
  )
}

type Gesto = {
  empezar: (clave: string | number) => void
  mover: (clave: string | number, dy: number) => void
  soltar: () => void
  medir: (clave: string | number, alto: number) => void
}

function Tarjeta({
  fila,
  numero,
  conAsa,
  oculta,
  dy,
  gesto,
  colores: c,
}: {
  fila: FilaDeEjercicio
  numero: number | null
  conAsa: boolean
  oculta: boolean
  /** Cuánto se ha desplazado si es la que se arrastra; nulo si no. */
  dy: number | null
  gesto: Gesto
  colores: ReturnType<typeof useColores>
}) {
  // La clave de la fila no cambia mientras vive la tarjeta (es su `key`).
  const clave = fila.clave
  const [asa] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Una vez cogida, el desplazamiento de la pantalla no se la queda.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => gesto.empezar(clave),
      onPanResponderMove: (_, estado) => gesto.mover(clave, estado.dy),
      onPanResponderRelease: () => gesto.soltar(),
      onPanResponderTerminate: () => gesto.soltar(),
    }),
  )

  const arrastrada = dy !== null
  const cuerpo = (
    <>
      <View style={estilos.texto}>
        <View style={estilos.nombreFila}>
          <Text
            style={[
              estilos.nombre,
              { color: oculta || fila.principalOculto ? c.textoTenue : c.texto },
            ]}
          >
            {numero === null ? fila.nombre : `${numero} · ${fila.nombre}`}
          </Text>
          {fila.principalOculto && (
            <Text style={[estilos.etiquetaChica, { color: c.textoTenue, borderColor: c.borde }]}>
              oculto
            </Text>
          )}
        </View>
        {fila.detalle && (
          <Text style={[estilos.detalle, { color: c.textoTenue }]}>{fila.detalle}</Text>
        )}
      </View>
      <Text
        style={[
          estilos.objetivo,
          { color: oculta ? c.textoTenue : c.acento, borderColor: c.borde },
        ]}
      >
        {fila.objetivo}
      </Text>
      {fila.alAbrir && <Icono nombre="abrir" color={c.textoTenue} pequeno />}
    </>
  )

  return (
    <View
      onLayout={(evento) => gesto.medir(clave, evento.nativeEvent.layout.height)}
      style={[
        estilos.tarjeta,
        { backgroundColor: c.superficie, borderColor: c.borde },
        oculta && estilos.discontinuo,
        // La que se arrastra flota por encima de las demás y sigue al dedo.
        arrastrada && {
          zIndex: 1,
          elevation: 6,
          borderColor: c.acento,
          transform: [{ translateY: dy }],
        },
      ]}
    >
      {conAsa && (
        <View {...asa.panHandlers} accessibilityLabel={`Mover ${fila.nombre}`} style={estilos.asa}>
          <Icono nombre="asa" color={c.textoTenue} />
        </View>
      )}
      {fila.alAbrir ? (
        <Pressable
          accessibilityRole="button"
          onPress={fila.alAbrir}
          style={({ pressed }) => [
            estilos.cuerpo,
            conAsa && estilos.cuerpoConAsa,
            pressed && { opacity: 0.7 },
          ]}
        >
          {cuerpo}
        </Pressable>
      ) : (
        <View style={[estilos.cuerpo, conAsa && estilos.cuerpoConAsa]}>{cuerpo}</View>
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  lista: { gap: SEPARACION },
  tarjeta: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIO },
  discontinuo: { borderStyle: 'dashed' },
  // Todo menos el asa: lo que abre el ejercicio ocupa la tarjeta entera.
  cuerpo: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingRight: 12,
    paddingLeft: 16,
  },
  cuerpoConAsa: { paddingLeft: 0 },
  asa: {
    width: 44,
    height: 44,
    marginLeft: 4,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { flex: 1, minWidth: 0, gap: 2 },
  nombreFila: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nombre: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  etiquetaChica: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 7,
  },
  detalle: { fontSize: 13 },
  objetivo: {
    flexShrink: 0,
    fontSize: 13,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
    fontVariant: ['tabular-nums'],
  },
})
