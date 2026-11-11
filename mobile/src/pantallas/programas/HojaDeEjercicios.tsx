/**
 * La hoja de elegir ejercicio del formulario de un ejercicio de la rutina: un buscador, el
 * filtro por grupo muscular (un desplegable con solo los grupos que tienen algo que elegir) y
 * la lista, por nombre. Puerto de `web/src/paginas/programas/HojaDeEjercicios.tsx`. Elegir no
 * guarda nada: rellena el formulario.
 */
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { Hoja } from '../../componentes/Hoja'
import { Icono } from '../../componentes/Icono'
import type { Ejercicio, GrupoMuscular } from '../../logica/tipos'
import { RADIO_PEQUENO, useColores } from '../../tema'
import { deDonde } from '../../utiles/textos'
import { DesplegableDeGrupo } from './DesplegableDeGrupo'

interface Props {
  titulo: string
  subtitulo: string
  /** Los visibles: lo oculto deja de ofrecerse. */
  ejercicios: Ejercicio[]
  grupos: GrupoMuscular[]
  /** Los que no se pueden elegir aquí (el principal, al elegir una alternativa). */
  excluir: number[]
  elegido: number | null
  alElegir: (ejercicio: Ejercicio) => void
  alCerrar: () => void
}

/** Sin mayúsculas ni tildes, para que «presion» encuentre «Press inclinado» y «jalón». */
function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function HojaDeEjercicios({
  titulo,
  subtitulo,
  ejercicios,
  grupos,
  excluir,
  elegido,
  alElegir,
  alCerrar,
}: Props) {
  const c = useColores()
  const [texto, setTexto] = useState('')
  const [grupo, setGrupo] = useState<number | null>(null)

  const nombreDeGrupo = new Map(grupos.map((uno) => [uno.id, uno.nombre]))
  const elegibles = ejercicios
    .filter((ejercicio) => !excluir.includes(ejercicio.id))
    .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'))
  const conEjercicios = grupos
    .filter((uno) => elegibles.some((ejercicio) => ejercicio.grupo_muscular_id === uno.id))
    .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'))
  const buscado = normalizar(texto.trim())
  const lista = elegibles.filter(
    (ejercicio) =>
      (grupo === null || ejercicio.grupo_muscular_id === grupo) &&
      normalizar(ejercicio.nombre).includes(buscado),
  )

  return (
    <Hoja titulo={titulo} subtitulo={subtitulo} alCerrar={alCerrar} llena>
      <View style={[estilos.buscador, { backgroundColor: c.fondo, borderColor: c.borde }]}>
        <Icono nombre="buscar" color={c.textoTenue} pequeno />
        <TextInput
          accessibilityLabel="Buscar ejercicio"
          placeholder="Buscar ejercicio"
          placeholderTextColor={c.textoTenue}
          value={texto}
          onChangeText={setTexto}
          style={[estilos.buscadorTexto, { color: c.texto }]}
        />
      </View>

      <DesplegableDeGrupo grupos={conEjercicios} elegido={grupo} alElegir={setGrupo} />

      {lista.length === 0 && (
        <Text style={[estilos.vacia, { color: c.textoTenue }]}>
          {elegibles.length === 0
            ? 'No hay más ejercicios para elegir.'
            : 'Ningún ejercicio se llama así.'}
        </Text>
      )}
      {lista.map((ejercicio) => (
        <Pressable
          key={ejercicio.id}
          accessibilityRole="button"
          accessibilityState={{ selected: elegido === ejercicio.id }}
          onPress={() => alElegir(ejercicio)}
          style={({ pressed }) => [
            estilos.fila,
            { borderTopColor: c.borde },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={estilos.filaTexto}>
            <Text style={[estilos.nombre, { color: c.texto }]}>{ejercicio.nombre}</Text>
            <Text style={[estilos.deDonde, { color: c.textoTenue }]}>
              {deDonde(ejercicio, nombreDeGrupo)}
            </Text>
          </View>
          {elegido === ejercicio.id && <Icono nombre="elegido" color={c.acento} pequeno />}
        </Pressable>
      ))}

      <Text style={[estilos.pie, { color: c.textoTenue, borderTopColor: c.borde }]}>
        Los ejercicios ocultos no salen. Puedes volver a mostrarlos en la pestaña Ejercicios.
      </Text>
    </Hoja>
  )
}

const estilos = StyleSheet.create({
  buscador: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  buscadorTexto: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 0 },
  vacia: { fontSize: 14, textAlign: 'center', paddingVertical: 14 },
  fila: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  filaTexto: { flex: 1, minWidth: 0 },
  nombre: { fontSize: 15, fontWeight: '600' },
  deDonde: { fontSize: 13 },
  pie: { paddingTop: 12, borderTopWidth: 1, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
})
