/**
 * La hoja del filtro por grupo muscular de la biblioteca: *Todos los grupos musculares* y debajo
 * los grupos en dos columnas. Puerto de `web/src/paginas/ejercicios/HojaDeGrupos.tsx`. Son
 * muchos: en una fila de píldoras no se veían, y envueltas ocupaban media pantalla encima de la
 * lista. Elegir uno filtra y cierra la hoja.
 *
 * Sirve también para elegir el grupo de un ejercicio nuevo o editado (`paraElegir`), sin
 * *Todos*: en la web es un `<select>`, que aquí no existe.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Hoja } from '../../componentes/Hoja'
import type { GrupoMuscular } from '../../logica/tipos'
import { RADIO_PEQUENO, useColores } from '../../tema'
import { TODOS_LOS_GRUPOS } from '../programas/DesplegableDeGrupo'

interface Props {
  /** Los que tienen algo que enseñar con el origen elegido, por orden alfabético. */
  grupos: GrupoMuscular[]
  elegido: number | null
  alElegir: (grupo: number | null) => void
  alCerrar: () => void
  /** Para elegir el grupo de un ejercicio: sin *Todos* y sin el subtítulo del filtro. */
  paraElegir?: boolean
}

export function HojaDeGrupos({ grupos, elegido, alElegir, alCerrar, paraElegir = false }: Props) {
  const c = useColores()

  const boton = (id: number | null, nombre: string, entero = false) => (
    <Pressable
      key={id ?? 'todos'}
      accessibilityRole="button"
      accessibilityState={{ selected: elegido === id }}
      onPress={() => alElegir(id)}
      style={({ pressed }) => [
        estilos.opcion,
        entero ? estilos.entera : estilos.mitad,
        { backgroundColor: c.fondo, borderColor: elegido === id ? c.acento : c.borde },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[estilos.texto, { color: elegido === id ? c.acento : c.texto }]}>{nombre}</Text>
    </Pressable>
  )

  return (
    <Hoja
      titulo="Grupo muscular"
      subtitulo={paraElegir ? undefined : 'Solo se verán los ejercicios de ese grupo.'}
      alCerrar={alCerrar}
    >
      <View style={[estilos.rejilla, paraElegir && estilos.sinSubtitulo]}>
        {!paraElegir && boton(null, TODOS_LOS_GRUPOS, true)}
        {grupos.map((uno) => boton(uno.id, uno.nombre))}
      </View>
    </Hoja>
  )
}

const estilos = StyleSheet.create({
  // Dos columnas a 8 px: cada una algo menos de la mitad, y el sobrante repartido en medio.
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  opcion: {
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  sinSubtitulo: { marginTop: 12 },
  entera: { width: '100%' },
  mitad: { width: '48.5%' },
  texto: { fontSize: 14, textAlign: 'center' },
})
