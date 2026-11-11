/**
 * La hoja que sube al pulsar › o *Añadir rutina* en un día de la semana del programa: tus
 * rutinas para elegir una. Puerto de `web/src/paginas/programas/HojaDeRutinas.tsx`. Elegir no
 * guarda nada: cambia el borrador de quien la abre, que lo guarda con *Guardar* o *Crear*.
 *
 * Primero las del programa activo, en el orden de su semana (cada una una vez), y luego las
 * demás por orden alfabético: así las de siempre salen arriba. Sin color: una rutina solo lo
 * tiene puesta en un día, y es el de ese día (decisión del autor).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Hoja } from '../../componentes/Hoja'
import { Icono } from '../../componentes/Icono'
import type { ProgramaDia, Rutina } from '../../logica/tipos'
import { useColores } from '../../tema'
import { ejercicios, nombreDelDiaSemana } from '../../utiles/textos'

interface Props {
  diaSemana: number
  /** Las visibles: lo oculto deja de ofrecerse. */
  rutinas: Rutina[]
  /** Los días del programa activo, para el orden. */
  diasDelActivo: ProgramaDia[] | undefined
  /** La que ya tiene el día, con su marca; nula si es descanso. */
  elegida: number | null
  alElegir: (rutina: Rutina) => void
  alCerrar: () => void
  /** Si se pasa, la hoja ofrece *+ Nueva rutina* al final. */
  alCrearNueva?: () => void
}

export function HojaDeRutinas({
  diaSemana,
  rutinas,
  diasDelActivo,
  elegida,
  alElegir,
  alCerrar,
  alCrearNueva,
}: Props) {
  const c = useColores()
  const porId = new Map(rutinas.map((rutina) => [rutina.id, rutina]))
  const primero: Rutina[] = []
  for (const dia of [...(diasDelActivo ?? [])].sort((a, b) => a.dia_semana - b.dia_semana)) {
    const rutina = porId.get(dia.rutina.id)
    if (rutina && !primero.includes(rutina)) primero.push(rutina)
  }
  // `localeCompare` con 'es', como la web: Hermes trae `Intl` completo.
  const resto = rutinas
    .filter((rutina) => !primero.includes(rutina))
    .sort((una, otra) => una.nombre.localeCompare(otra.nombre, 'es'))

  return (
    <Hoja
      titulo={nombreDelDiaSemana(diaSemana)}
      subtitulo={
        alCrearNueva ? 'Elige una de tus rutinas o crea una nueva' : 'Elige una de tus rutinas'
      }
      alCerrar={alCerrar}
    >
      {rutinas.length === 0 && (
        <Text style={[estilos.vacia, { color: c.textoTenue, borderTopColor: c.borde }]}>
          Todavía no tienes rutinas.
        </Text>
      )}
      {[...primero, ...resto].map((rutina) => (
        <Pressable
          key={rutina.id}
          accessibilityRole="button"
          accessibilityState={{ selected: elegida === rutina.id }}
          onPress={() => alElegir(rutina)}
          style={({ pressed }) => [
            estilos.fila,
            { borderTopColor: c.borde },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[estilos.nombre, { color: c.texto }]}>{rutina.nombre}</Text>
          <Text style={[estilos.extra, { color: c.textoTenue }]}>{ejercicios(rutina)}</Text>
          <View style={estilos.marca}>
            {elegida === rutina.id && <Icono nombre="elegido" color={c.acento} pequeno />}
          </View>
        </Pressable>
      ))}
      {alCrearNueva && (
        <Pressable
          accessibilityRole="button"
          onPress={alCrearNueva}
          style={({ pressed }) => [
            estilos.fila,
            estilos.nueva,
            { borderTopColor: c.borde },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[estilos.nuevaTexto, { color: c.texto }]}>+ Nueva rutina</Text>
        </Pressable>
      )}
    </Hoja>
  )
}

const estilos = StyleSheet.create({
  fila: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  nombre: { flex: 1, fontSize: 15, fontWeight: '600' },
  // Una etiqueta corta junto a un nombre: no se encoge por mucho que mida el nombre.
  extra: { fontSize: 13, flexShrink: 0 },
  marca: { width: 18, alignItems: 'center' },
  vacia: { fontSize: 14, textAlign: 'center', paddingVertical: 14, borderTopWidth: 1 },
  nueva: { justifyContent: 'center' },
  nuevaTexto: { fontSize: 14, fontWeight: '600' },
})
