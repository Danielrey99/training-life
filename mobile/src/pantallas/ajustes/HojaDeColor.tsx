/**
 * La hoja del color de un día: los 24 de la paleta, en cuatro columnas. Puerto de
 * `web/src/paginas/ajustes/HojaDeColor.tsx`. Un color que ya tiene otro día no se puede
 * elegir, para que no haya dos días iguales. No hay color libre (decisión del autor): la
 * paleta basta, y así cada color tiene su versión para el tema claro.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Boton } from '../../componentes/Boton'
import { Hoja } from '../../componentes/Hoja'
import { Icono } from '../../componentes/Icono'
import { RADIO, useColores } from '../../tema'
import { useAjustes } from '../../utiles/ajustes'
import { eleccionDelDia, PALETA, POR_DIA, resolverColor } from '../../utiles/colores'
import { NOMBRES_DE_LOS_DIAS } from '../../utiles/textos'

interface Props {
  diaSemana: number
  /** Un id de la paleta; `null` vuelve al de la app. */
  alElegir: (eleccion: string | null) => void
  alCerrar: () => void
}

export function HojaDeColor({ diaSemana, alElegir, alCerrar }: Props) {
  const c = useColores()
  // Con el React Compiler, los colores se piden con los ajustes del componente (ver
  // `utiles/colores.ts`).
  const actuales = useAjustes()
  const elegido = eleccionDelDia(diaSemana, actuales)
  // De quién es cada color de la paleta, para apagarlo y decirlo.
  const duenos = new Map<string, number>()
  for (let dia = 1; dia <= 7; dia++) {
    if (dia !== diaSemana) duenos.set(eleccionDelDia(dia, actuales), dia)
  }

  return (
    <Hoja
      titulo={`Color del ${NOMBRES_DE_LOS_DIAS[diaSemana - 1]}`}
      subtitulo="Lo verás en el calendario y en las rutinas que tocan ese día."
      alCerrar={alCerrar}
    >
      <View style={estilos.rejilla}>
        {PALETA.map((opcion) => {
          const dueno = duenos.get(opcion.id)
          const esEste = opcion.id === elegido
          return (
            <Pressable
              key={opcion.id}
              accessibilityRole="button"
              accessibilityLabel={opcion.nombre}
              accessibilityState={{ disabled: dueno !== undefined, selected: esEste }}
              disabled={dueno !== undefined}
              onPress={() => alElegir(opcion.id)}
              style={[
                estilos.opcion,
                { backgroundColor: c.fondo, borderColor: esEste ? c.acento : c.borde },
                dueno !== undefined && estilos.apagada,
              ]}
            >
              <View
                style={[estilos.muestra, { backgroundColor: resolverColor(opcion.id, actuales) }]}
              >
                {esEste && <Icono nombre="hecho" pequeno color={c.sobreAcento} />}
              </View>
              <Text style={[estilos.nombre, { color: c.texto }]}>{opcion.nombre}</Text>
              {dueno !== undefined && (
                <Text style={[estilos.dueno, { color: c.textoTenue }]}>
                  {NOMBRES_DE_LOS_DIAS[dueno - 1]}
                </Text>
              )}
            </Pressable>
          )
        })}
      </View>
      {elegido !== POR_DIA[diaSemana] && (
        <View style={estilos.volver}>
          <Boton variante="secundaria" texto="Usar el de la app" alPulsar={() => alElegir(null)} />
        </View>
      )}
    </Hoja>
  )
}

const estilos = StyleSheet.create({
  // Cuatro columnas (en tres no cabían en la pantalla): cada opción, un cuarto menos los huecos.
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  opcion: {
    width: '23.5%',
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderWidth: 1,
    borderRadius: RADIO,
  },
  apagada: { opacity: 0.4 },
  muestra: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nombre: { fontSize: 12, lineHeight: 14, textAlign: 'center' },
  dueno: { fontSize: 11, lineHeight: 13 },
  volver: { marginTop: 8 },
})
