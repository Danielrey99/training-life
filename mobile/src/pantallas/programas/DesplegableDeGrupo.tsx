/**
 * El filtro por grupo muscular de la hoja de elegir ejercicio: un campo que despliega la
 * lista justo debajo, del mismo ancho, con desplazamiento si no cabe. Puerto de
 * `web/src/paginas/programas/DesplegableDeGrupo.tsx`.
 *
 * Una lista debajo y no otra hoja: abrir una hoja encima de esta hoja no era opción
 * (decisión del autor). Diferencia con la web: la lista no flota por encima de la de
 * ejercicios, sino que la empuja hacia abajo (dentro de una hoja que se desplaza, flotar daría
 * problemas de toques), y se cierra eligiendo o con el mismo campo.
 */
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Icono } from '../../componentes/Icono'
import type { GrupoMuscular } from '../../logica/tipos'
import { RADIO_PEQUENO, useColores } from '../../tema'

interface Props {
  /** Los que tienen algo que elegir, por orden alfabético. */
  grupos: GrupoMuscular[]
  elegido: number | null
  alElegir: (grupo: number | null) => void
}

export const TODOS_LOS_GRUPOS = 'Todos los grupos musculares'

export function DesplegableDeGrupo({ grupos, elegido, alElegir }: Props) {
  const c = useColores()
  const [abierto, setAbierto] = useState(false)

  function elegir(grupo: number | null) {
    alElegir(grupo)
    setAbierto(false)
  }

  const nombre = grupos.find((uno) => uno.id === elegido)?.nombre ?? TODOS_LOS_GRUPOS
  const opcion = (id: number | null, texto: string) => (
    <Pressable
      key={id ?? 'todos'}
      accessibilityRole="button"
      accessibilityState={{ selected: elegido === id }}
      onPress={() => elegir(id)}
      style={({ pressed }) => [estilos.opcion, pressed && { backgroundColor: c.superficie }]}
    >
      <Text style={[estilos.opcionTexto, { color: elegido === id ? c.acento : c.texto }]}>
        {texto}
      </Text>
    </Pressable>
  )

  return (
    <View style={estilos.filtro}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Grupo muscular"
        accessibilityState={{ expanded: abierto }}
        onPress={() => setAbierto(!abierto)}
        style={[
          estilos.campo,
          { backgroundColor: c.fondo, borderColor: elegido === null ? c.borde : c.acento },
        ]}
      >
        <Text
          style={[estilos.campoTexto, { color: elegido === null ? c.texto : c.acento }]}
          numberOfLines={1}
        >
          {nombre}
        </Text>
        <Icono nombre={abierto ? 'arriba' : 'abajo'} color={c.textoTenue} pequeno />
      </Pressable>
      {abierto && (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={[estilos.lista, { backgroundColor: c.fondo, borderColor: c.borde }]}
        >
          {opcion(null, TODOS_LOS_GRUPOS)}
          {grupos.map((uno) => opcion(uno.id, uno.nombre))}
        </ScrollView>
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  filtro: { gap: 4, marginBottom: 10 },
  campo: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  campoTexto: { flex: 1, fontSize: 15 },
  lista: { maxHeight: 320, padding: 4, borderWidth: 1, borderRadius: RADIO_PEQUENO },
  opcion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 4 },
  opcionTexto: { fontSize: 15 },
})
