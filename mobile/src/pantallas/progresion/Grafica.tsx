/**
 * La gráfica de una serie de sesiones: una línea con un punto por sesión, repartidos en el
 * tiempo (dos sesiones muy separadas se ven separadas). El punto elegido lleva un globo con su
 * día y su valor; se elige tocando un punto. Puerto de `web/src/paginas/progresion/Grafica.tsx`
 * con react-native-svg.
 *
 * Diferencias con la web: el globo es una vista encima del dibujo (en el teléfono no hay un
 * lienzo con el que medir el texto antes de pintarlo: se mide al pintarlo, con `onLayout`), y
 * con «Todo» se desliza con un `ScrollView` horizontal.
 */
import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native'
import Svg, { Circle, G, Line, Polyline, Text as TextoSvg } from 'react-native-svg'

import { useColores } from '../../tema'
import { diasEntre, diaYMesCorto, fechaAbreviada, hoy, mesCorto } from '../../utiles/fechas'
import { numeroLegible } from '../../utiles/numeros'

export type Punto = {
  id: number
  fecha: string
  valor: number
  // Lo que dice el globo debajo de la fecha: "20 kg", "720 kg en 4 series"…
  detalle: string
}

type Props = {
  // De la más antigua a la más reciente.
  puntos: Punto[]
  // Qué punto tiene el globo; sin elegir, el último.
  elegido: number | null
  alElegir: (id: number) => void
  // Cómo se escribe cada valor del eje; sin esto, como un número («5:26» para el ritmo).
  formatoDeMarca?: (valor: number) => string
  // El eje, en otra unidad que los valores: los valores se dividen por esto (60, los
  // segundos en minutos). Las marcas se escriben en esa unidad.
  divisor?: number
  // Los pasos que valen entre dos marcas, en la unidad del eje (el ritmo: 1, 5, 15, 30 s…).
  pasos?: number[]
  // Cuántos días caben a lo ancho. Con más, la gráfica se desplaza de lado (con «Todo»:
  // la misma escala que 6 meses, para que los puntos y los meses no se apilen).
  diasVisibles?: number
}

// En píxeles. El ancho no es fijo: es el de la tarjeta, medido.
const ANCHO_INICIAL = 326
const ALTO = 176
const IZQUIERDA = 32
const ARRIBA = 20
const ABAJO = 150
const GLOBO = { alto: 40, relleno: 10 }

/**
 * Los valores redondos entre los que cabe la serie: unas cinco líneas de la cuadrícula con un
 * paso de 1, 2, 2,5 o 5 (por una potencia de diez), o de los `pasos` que se le den. Si todos
 * los puntos valen lo mismo se abre un margen, para que la línea no quede pegada al borde.
 */
export function escala(minimo: number, maximo: number, pasos?: number[]): number[] {
  const margen = maximo === minimo ? Math.max(maximo * 0.2, 1) : 0
  const bajo = minimo - margen
  const alto = maximo + margen
  const bruto = (alto - bajo) / 4
  const potencia = 10 ** Math.floor(Math.log10(bruto))
  const redondos = [1, 2, 2.5, 5, 10].map((m) => m * potencia)
  // Con `pasos`, el primero que llega; si ninguno llega, el mayor las veces que haga falta.
  const mayor = pasos?.[pasos.length - 1] ?? 1
  const paso = pasos
    ? (pasos.find((p) => p >= bruto) ?? mayor * Math.ceil(bruto / mayor))
    : (redondos.find((p) => p >= bruto) ?? bruto)
  const inicio = Math.floor(bajo / paso) * paso
  const marcas: number[] = []
  for (let valor = inicio; valor < alto + paso; valor += paso) {
    marcas.push(Math.round(valor * 100) / 100)
    if (valor >= alto) break
  }
  return marcas
}

export function Grafica({
  puntos,
  elegido,
  alElegir,
  diasVisibles,
  formatoDeMarca,
  divisor = 1,
  pasos,
}: Props) {
  const c = useColores()
  const desplazable = useRef<ScrollViewInstance>(null)
  const [visible, setVisible] = useState(ANCHO_INICIAL)
  // Lo que mide el globo, una vez pintado; hasta entonces, una cuenta aproximada.
  const [globoMedido, setGloboMedido] = useState<number | null>(null)

  // En la unidad del eje.
  const marcas = escala(
    Math.min(...puntos.map((p) => p.valor)) / divisor,
    Math.max(...puntos.map((p) => p.valor)) / divisor,
    pasos,
  )
  const bajo = marcas[0]
  const alto = marcas[marcas.length - 1]
  const primero = puntos[0].fecha
  const ultimo = puntos[puntos.length - 1].fecha
  const total = diasEntre(primero, ultimo)
  // Con más días de los que caben, el dibujo se alarga a la misma escala: lo que se ve de una
  // vez son `diasVisibles` días.
  const seDesplaza = diasVisibles !== undefined && total > diasVisibles
  const ancho = seDesplaza
    ? Math.round(IZQUIERDA + ((visible - 8 - IZQUIERDA) * total) / diasVisibles + 8)
    : visible
  const derecha = ancho - 8

  const x = (fecha: string) =>
    total === 0
      ? (IZQUIERDA + derecha) / 2
      : IZQUIERDA + (diasEntre(primero, fecha) / total) * (derecha - IZQUIERDA)
  // Un valor sin convertir (`valor`, de un punto) o una marca, ya en la unidad del eje.
  const enEje = (marca: number) => ABAJO - ((marca - bajo) / (alto - bajo)) * (ABAJO - ARRIBA)
  const y = (valor: number) => enEje(valor / divisor)

  const activo = puntos.find((p) => p.id === elegido) ?? puntos[puntos.length - 1]
  const trazado = puntos.map((p) => `${x(p.fecha).toFixed(1)},${y(p.valor).toFixed(1)}`)

  // El eje de abajo: el mes bajo el primer punto de cada mes, salvo que pise al anterior.
  // Lleva el año cuando cambia, y en el primero si no es el actual. Si todo cae en un mismo
  // mes, el primer día y el último.
  const anioActual = hoy().slice(0, 4)
  const meses: { mes: string; texto: string; x: number }[] = []
  // A 11 px, unos 6,2 px por letra: se pisan si la mitad de una más la mitad de la otra no
  // caben entre los dos.
  const mitad = (texto: string) => (texto.length * 6.2) / 2
  for (const punto of puntos) {
    const anterior = meses.at(-1)
    const mes = punto.fecha.slice(0, 7)
    const anio = punto.fecha.slice(0, 4)
    const conAnio = anterior ? anterior.mes.slice(0, 4) !== anio : anio !== anioActual
    const texto = `${mesCorto(punto.fecha)}${conAnio ? ` ${anio}` : ''}`
    const cabe = !anterior || x(punto.fecha) - anterior.x > mitad(anterior.texto) + mitad(texto) + 6
    if (!anterior || (mes !== anterior.mes && cabe)) {
      meses.push({ mes, texto, x: x(punto.fecha) })
    }
  }
  const conAnio = (iso: string) =>
    iso.slice(0, 4) === anioActual ? diaYMesCorto(iso) : `${diaYMesCorto(iso)} ${iso.slice(0, 4)}`
  const etiquetas =
    meses.length > 1 || total === 0
      ? meses
      : [
          { texto: conAnio(primero), x: IZQUIERDA },
          { texto: conAnio(ultimo), x: derecha },
        ]

  const titulo = fechaAbreviada(activo.fecha)
  const globoAncho =
    globoMedido ??
    Math.ceil(Math.max(titulo.length * 6, activo.detalle.length * 7.2) + GLOBO.relleno * 2)
  // El globo, a la izquierda del punto si no cabe a la derecha y debajo si no cabe encima.
  const globoX = Math.min(Math.max(x(activo.fecha) - globoAncho / 2, IZQUIERDA), ancho - globoAncho)
  const globoY =
    y(activo.valor) - GLOBO.alto - 12 >= 0
      ? y(activo.valor) - GLOBO.alto - 12
      : y(activo.valor) + 12

  const dibujo = (
    <View style={{ width: ancho, height: ALTO }}>
      <Svg width={ancho} height={ALTO}>
        <G stroke={c.borde} strokeWidth={1}>
          {marcas.map((marca) => (
            <Line key={marca} x1={IZQUIERDA} y1={enEje(marca)} x2={ancho} y2={enEje(marca)} />
          ))}
        </G>
        <G fill={c.textoTenue} fontSize={11} textAnchor="middle">
          {etiquetas.map((etiqueta) => (
            // Por la posición: con más de un año, "sep" puede salir dos veces.
            <TextoSvg key={etiqueta.x} x={etiqueta.x} y={ALTO - 6}>
              {etiqueta.texto}
            </TextoSvg>
          ))}
        </G>
        <Line
          x1={x(activo.fecha)}
          y1={ARRIBA}
          x2={x(activo.fecha)}
          y2={ABAJO}
          stroke={c.textoTenue}
          strokeDasharray="3 3"
        />
        <Polyline
          points={trazado.join(' ')}
          fill="none"
          stroke={c.acento}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {puntos.map((punto) => (
          <G key={punto.id}>
            <Circle
              cx={x(punto.fecha)}
              cy={y(punto.valor)}
              r={punto.id === activo.id ? 6 : 4}
              fill={c.acento}
              stroke={c.superficie}
              strokeWidth={2}
            />
            {/* Más grande que el punto, para poder acertar con el dedo. */}
            <Circle
              cx={x(punto.fecha)}
              cy={y(punto.valor)}
              r={16}
              fill="transparent"
              onPress={() => alElegir(punto.id)}
            />
          </G>
        ))}
      </Svg>
      <View
        pointerEvents="none"
        onLayout={(evento) => {
          const medido = Math.ceil(evento.nativeEvent.layout.width)
          if (medido !== globoMedido) setGloboMedido(medido)
        }}
        style={[
          estilos.globo,
          { left: globoX, top: globoY, backgroundColor: c.texto },
          // Sin medir aún, invisible: así no salta de sitio al medirlo.
          globoMedido === null && { opacity: 0 },
        ]}
      >
        <Text numberOfLines={1} style={[estilos.globoTitulo, { color: c.globoTenue }]}>
          {titulo}
        </Text>
        <Text numberOfLines={1} style={[estilos.globoDetalle, { color: c.fondo }]}>
          {activo.detalle}
        </Text>
      </View>
    </View>
  )

  return (
    <View
      accessibilityLabel="Gráfica de progresión"
      onLayout={(evento) => setVisible(Math.round(evento.nativeEvent.layout.width))}
    >
      {seDesplaza ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          ref={desplazable}
          // Al abrir (y si cambia el ancho), lo más reciente: el final. No al elegir un punto,
          // que el dibujo no cambia de tamaño y se perdería lo que se estaba mirando.
          onContentSizeChange={() => desplazable.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={{ paddingBottom: 6 }}
        >
          {dibujo}
        </ScrollView>
      ) : (
        dibujo
      )}
      {/* Los valores, fijos a la izquierda: al desplazar la gráfica no se van. Solo hasta la
          línea de abajo, para no tapar los meses. */}
      <View
        pointerEvents="none"
        style={[estilos.valores, { width: IZQUIERDA, backgroundColor: c.superficie }]}
      >
        <Svg width={IZQUIERDA} height={ABAJO + 8}>
          <G fill={c.textoTenue} fontSize={11} textAnchor="end">
            {marcas.map((marca) => (
              <TextoSvg key={marca} x={IZQUIERDA - 8} y={enEje(marca) + 4}>
                {formatoDeMarca ? formatoDeMarca(marca * divisor) : numeroLegible(marca)}
              </TextoSvg>
            ))}
          </G>
        </Svg>
      </View>
    </View>
  )
}

const estilos = StyleSheet.create({
  globo: {
    position: 'absolute',
    height: GLOBO.alto,
    paddingHorizontal: GLOBO.relleno,
    justifyContent: 'center',
    borderRadius: 6,
  },
  globoTitulo: { fontSize: 11, lineHeight: 14 },
  globoDetalle: { fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  valores: { position: 'absolute', top: 0, left: 0, height: ABAJO + 8 },
})
