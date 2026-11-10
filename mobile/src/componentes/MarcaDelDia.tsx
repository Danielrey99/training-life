/**
 * La marca de un día, la misma en la tira de Entrenar y en el calendario. Puerto de
 * `web/src/componentes/MarcaDelDia.tsx`.
 *
 * Junta lo que se hizo ese día (un punto lleno del color del día que contó) y lo que
 * tocaba, del color de su propio día: un aro si sigue sin hacer, una flecha si se hizo otro
 * día (→ después, ← antes) y un punto apagado si aún no ha llegado.
 */
import { StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import type { DiaSeguimiento } from '../logica/tipos'
import { useAjustes } from '../utiles/ajustes'
import { colorDelDia, colorDeRutina } from '../utiles/colores'
import { diaDeLaSemana } from '../utiles/fechas'

/** La flecha de un día movido: → se hizo después, ← se hizo antes. */
function Flecha({ color, haciaAtras }: { color: string; haciaAtras: boolean }) {
  return (
    <Svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={haciaAtras ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </Svg>
  )
}

function Punto({ color, apagado = false }: { color: string; apagado?: boolean }) {
  return <View style={[estilos.punto, { backgroundColor: color }, apagado && estilos.apagado]} />
}

function Aro({ color }: { color: string }) {
  return <View style={[estilos.punto, { borderWidth: 1.5, borderColor: color }]} />
}

export function MarcaDelDia({
  dia,
  diasDelPrograma,
}: {
  dia: DiaSeguimiento
  /** Los del programa activo, para dar color a lo que se hizo sin contar para ningún día. */
  diasDelPrograma?: { dia_semana: number; rutina: { id: number } }[]
}) {
  // Los colores dependen de los ajustes (los de cada día y el tema): se vuelve a pintar al
  // cambiarlos.
  useAjustes()
  const propio = colorDelDia(diaDeLaSemana(dia.fecha))
  const sesion = dia.sesion

  // Lo que se hizo: del color del día que cuenta; si no cuenta ninguno, del día de su
  // rutina en el programa, o neutro si tampoco está en él.
  let hecho: string | null = null
  if (sesion) {
    hecho =
      sesion.cuenta && sesion.cubre_fecha
        ? colorDelDia(diaDeLaSemana(sesion.cubre_fecha))
        : colorDeRutina(diasDelPrograma, sesion.rutina.id)
  }

  let tocaba = null
  if (dia.estado === 'movido' && dia.cubierto_por) {
    const antes = dia.cubierto_por.fecha < dia.fecha
    const flecha = <Flecha color={propio} haciaAtras={antes} />
    // Adelantado: la flecha va delante (del punto de lo hecho ese día, o del aro).
    if (antes) {
      return (
        <View style={estilos.marca}>
          {flecha}
          {hecho ? <Punto color={hecho} /> : <Aro color={propio} />}
        </View>
      )
    }
    tocaba = hecho ? (
      flecha
    ) : (
      <>
        <Aro color={propio} />
        {flecha}
      </>
    )
  } else if (dia.estado === 'sin_hacer' || dia.estado === 'pendiente') {
    tocaba = <Aro color={propio} />
  } else if (dia.estado === 'proximo') {
    tocaba = <Punto color={propio} apagado />
  }

  return (
    <View style={estilos.marca}>
      {hecho && <Punto color={hecho} />}
      {tocaba}
    </View>
  )
}

const estilos = StyleSheet.create({
  marca: { height: 10, flexDirection: 'row', alignItems: 'center', gap: 2 },
  punto: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  // Un día que aún no ha llegado.
  apagado: { opacity: 0.35 },
})
