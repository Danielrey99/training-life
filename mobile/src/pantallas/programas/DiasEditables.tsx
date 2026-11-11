/**
 * Los siete días de un programa que se está escribiendo: en la semana con *Editar* y en el
 * programa nuevo. Puerto de `web/src/paginas/programas/DiasEditables.tsx`. Un día con rutina
 * lleva ✕ (descanso) y › (cambiarla); uno de descanso, *Añadir rutina*. Nada se guarda aquí:
 * cada toque cambia el borrador de quien la usa.
 */
import { Pressable, Text, View } from 'react-native'

import { Icono } from '../../componentes/Icono'
import type { DiaSemana } from '../../logica/tipos'
import { useColores } from '../../tema'
import { useAjustes } from '../../utiles/ajustes'
import { colorDelDia } from '../../utiles/colores'
import { NOMBRES_DE_LOS_DIAS, nombreDelDiaSemana } from '../../utiles/textos'
import { DIAS, type DiasDelBorrador } from './borradores'
import { useEstilosDeSemana } from './estilosDeSemana'

interface Props {
  dias: DiasDelBorrador
  alAbrir: (dia: DiaSemana) => void
  alQuitar: (dia: DiaSemana) => void
  desactivado?: boolean
}

export function DiasEditables({ dias, alAbrir, alQuitar, desactivado }: Props) {
  const c = useColores()
  const e = useEstilosDeSemana(c)
  // Los colores de los días dependen de los ajustes: se vuelve a pintar al cambiarlos.
  useAjustes()

  return (
    <View style={e.dias}>
      {DIAS.map((dia, indice) => {
        const rutina = dias[dia]
        const borde = indice > 0 && { borderTopWidth: 1, borderTopColor: c.borde }
        const nombreDelDia = <Text style={e.diaNombre}>{nombreDelDiaSemana(dia)}</Text>
        if (!rutina) {
          return (
            <Pressable
              key={dia}
              accessibilityRole="button"
              onPress={() => alAbrir(dia)}
              disabled={desactivado}
              style={({ pressed }) => [e.dia, borde, pressed && { opacity: 0.7 }]}
            >
              {nombreDelDia}
              <Text style={[e.diaRutina, e.vacia]}>Añadir rutina</Text>
              <Icono nombre="mas" color={c.textoTenue} pequeno />
            </Pressable>
          )
        }
        const oculta = rutina.oculto_desde !== null
        return (
          <View key={dia} style={[e.dia, borde]}>
            {nombreDelDia}
            <View style={e.diaRutina}>
              {/* El color del día, no de la rutina (decisión del autor). */}
              <View style={[e.punto, !oculta && { backgroundColor: colorDelDia(dia) }]} />
              <Text style={[e.nombre, oculta && { color: c.textoTenue }]} numberOfLines={1}>
                {rutina.nombre}
              </Text>
              {oculta && <Text style={e.etiquetaChica}>oculta</Text>}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Dejar el ${NOMBRES_DE_LOS_DIAS[dia - 1]} en descanso`}
              onPress={() => alQuitar(dia)}
              disabled={desactivado}
              style={e.icono}
            >
              <Icono nombre="quitar" color={c.textoTenue} pequeno />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cambiar la rutina del ${NOMBRES_DE_LOS_DIAS[dia - 1]}`}
              onPress={() => alAbrir(dia)}
              disabled={desactivado}
              style={[e.icono, e.iconoUltimo]}
            >
              <Icono nombre="abrir" color={c.textoTenue} pequeno />
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}
