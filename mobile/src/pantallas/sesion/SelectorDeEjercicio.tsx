/**
 * La flecha que cambia el ejercicio de un hueco por uno de sus comodines, y su desplegable.
 * Puerto de `web/src/paginas/sesion/SelectorDeEjercicio.tsx`.
 *
 * Solo la flecha abre el desplegable; el nombre no hace nada. La flecha va en su propio
 * botón, con recuadro y en verde, porque suelta y gris pasaba por alto. El desplegable cuelga
 * de la cabecera del hueco, por encima de lo de debajo; se cierra eligiendo o con la flecha.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Icono } from '../../componentes/Icono'
import type { Ejercicio } from '../../logica/tipos'
import { RADIO, RADIO_PEQUENO, useColores } from '../../tema'
import { fechaCorta } from '../../utiles/fechas'
import { serieCorta } from '../../utiles/medidas'
import { useUltimaVez } from './ultimaVez'

export function FlechaDeComodin({ abierto, alPulsar }: { abierto: boolean; alPulsar: () => void }) {
  const c = useColores()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cambiar de ejercicio"
      accessibilityState={{ expanded: abierto }}
      onPress={alPulsar}
      hitSlop={6}
      style={[
        estilos.flecha,
        { backgroundColor: c.fondo, borderColor: abierto ? c.acento : c.borde },
      ]}
    >
      <Icono nombre={abierto ? 'arriba' : 'abajo'} color={c.acento} pequeno />
    </Pressable>
  )
}

interface Props {
  principal: Ejercicio
  comodines: Ejercicio[]
  elegido: Ejercicio
  sesion: { id: number; fecha: string }
  elegir: (ejercicio: Ejercicio) => void
}

/** El desplegable, para colocarlo bajo la cabecera del hueco. */
export function DesplegableDeEjercicios({ principal, comodines, elegido, sesion, elegir }: Props) {
  const c = useColores()
  const opciones = [
    { ejercicio: principal, rol: 'principal' },
    ...comodines.map((ejercicio) => ({ ejercicio, rol: 'alternativa' })),
  ]
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="Ejercicio de hoy"
      style={[estilos.desplegable, { backgroundColor: c.superficie, borderColor: c.borde }]}
    >
      {opciones.map(({ ejercicio, rol }, indice) => (
        <Opcion
          key={ejercicio.id}
          ejercicio={ejercicio}
          rol={rol}
          primera={indice === 0}
          marcado={ejercicio.id === elegido.id}
          sesion={sesion}
          elegir={() => elegir(ejercicio)}
        />
      ))}
    </View>
  )
}

/** Una opción del desplegable, con su propia última vez. */
function Opcion({
  ejercicio,
  rol,
  primera,
  marcado,
  sesion,
  elegir,
}: {
  ejercicio: Ejercicio
  rol: string
  primera: boolean
  marcado: boolean
  sesion: { id: number; fecha: string }
  elegir: () => void
}) {
  const c = useColores()
  const vez = useUltimaVez(ejercicio.id, sesion)
  // Un ejercicio oculto se enseña, para que se entienda qué pasó con él, pero ya no se
  // ofrece: para volver a usarlo hay que mostrarlo antes.
  const oculto = ejercicio.oculto_desde !== null
  const primeraSerie = vez?.series[0]

  let detalle = ' '
  if (oculto) detalle = 'Oculto'
  else if (vez === null) detalle = 'Todavía no lo has hecho'
  else if (vez && primeraSerie) {
    detalle = `Última vez · ${serieCorta(ejercicio.tipo_registro, primeraSerie)} · ${fechaCorta(vez.fecha)}`
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: marcado, disabled: oculto }}
      onPress={elegir}
      disabled={oculto}
      style={({ pressed }) => [
        estilos.opcion,
        !primera && { borderTopWidth: 1, borderTopColor: c.borde },
        pressed && { backgroundColor: c.fondo },
        oculto && estilos.apagada,
      ]}
    >
      <View style={estilos.opcionTexto}>
        <View style={estilos.opcionNombre}>
          <Text style={[estilos.nombre, { color: c.texto }]}>{ejercicio.nombre}</Text>
          <Text style={[estilos.etiqueta, { color: c.textoTenue, borderColor: c.borde }]}>
            {rol}
          </Text>
        </View>
        <Text style={[estilos.detalle, { color: c.textoTenue }]}>{detalle}</Text>
      </View>
      {marcado ? (
        <Icono nombre="elegido" color={c.acento} pequeno />
      ) : (
        <View style={estilos.hueco} />
      )}
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  flecha: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  desplegable: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    zIndex: 10,
    elevation: 12,
    borderWidth: 1,
    borderRadius: RADIO,
    overflow: 'hidden',
  },
  opcion: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  apagada: { opacity: 0.5 },
  opcionTexto: { flex: 1, gap: 2 },
  opcionNombre: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  nombre: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  etiqueta: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 7,
  },
  detalle: { fontSize: 13, fontVariant: ['tabular-nums'] },
  hueco: { width: 18 },
})
