/**
 * Un mes con las marcas de cada día: la cuadrícula del calendario del historial. Puerto de
 * `web/src/paginas/historial/MesConMarcas.tsx`. La usan el calendario y la hoja de cambiar la
 * fecha de una sesión, para que se vean igual: los días futuros, apagados y sin poder
 * tocarlos (salvo que tengan sesión).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { DiaSeguimiento, Programa } from '../logica/tipos'
import { RADIO, useColores } from '../tema'
import { diaDeLaSemana } from '../utiles/fechas'
import { MarcaDelDia } from './MarcaDelDia'

const INICIALES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

interface Props {
  /** El día 1 del mes, en ISO. */
  mes: string
  /** Los días del mes, o `null` mientras se cargan (sale la cuadrícula vacía). */
  dias: DiaSeguimiento[] | null
  hoy: string
  programa: Programa | null
  /** La fecha marcada como elegida (en la hoja de cambiar la fecha de una sesión). */
  elegida?: string
  /** El día que se tocó para registrarlo, enmarcado detrás de su hoja. */
  tocado?: string
  alTocar: (dia: DiaSeguimiento) => void
}

export function MesConMarcas({ mes, dias, hoy, programa, elegida, tocado, alTocar }: Props) {
  const c = useColores()
  // Huecos antes del día 1, para que cada columna sea un día de la semana.
  const vacios = diaDeLaSemana(mes) - 1
  const celdas: (DiaSeguimiento | null)[] = [...Array<null>(vacios).fill(null), ...(dias ?? [])]
  // Filas de siete; la última se completa con huecos para que las columnas no se estiren.
  while (celdas.length % 7 !== 0) celdas.push(null)
  const filas = Array.from({ length: celdas.length / 7 }, (_, i) => celdas.slice(i * 7, i * 7 + 7))

  return (
    <View style={estilos.calendario}>
      <View style={estilos.fila}>
        {INICIALES.map((inicial) => (
          <Text key={inicial} style={[estilos.cabecera, { color: c.textoTenue }]}>
            {inicial}
          </Text>
        ))}
      </View>
      {filas.map((fila, i) => (
        <View key={i} style={estilos.fila}>
          {fila.map((dia, j) => {
            if (!dia) return <View key={`vacio-${j}`} style={estilos.celda} />
            const esHoy = dia.fecha === hoy
            const futuro = dia.fecha > hoy
            const esElegida = dia.fecha === elegida
            const tocable = Boolean(dia.sesion) || dia.fecha <= hoy
            return (
              <Pressable
                key={dia.fecha}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !tocable,
                  selected: elegida === undefined ? undefined : esElegida,
                }}
                onPress={() => alTocar(dia)}
                disabled={!tocable}
                style={({ pressed }) => [
                  estilos.celda,
                  estilos.dia,
                  pressed && { backgroundColor: c.superficie },
                  dia.fecha === tocado && { borderColor: c.textoTenue },
                  esElegida && { backgroundColor: c.superficie, borderColor: c.texto },
                  esHoy && { borderColor: c.acento },
                ]}
              >
                <Text
                  style={[
                    estilos.numero,
                    { color: esHoy ? c.acento : futuro ? c.textoTenue : c.texto },
                    (esHoy || esElegida) && estilos.fuerte,
                  ]}
                >
                  {Number(dia.fecha.slice(8))}
                </Text>
                <MarcaDelDia dia={dia} diasDelPrograma={programa?.dias} />
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const estilos = StyleSheet.create({
  calendario: { gap: 4 },
  fila: { flexDirection: 'row', gap: 4 },
  cabecera: { flex: 1, textAlign: 'center', fontSize: 12.5, marginBottom: 4 },
  celda: { flex: 1 },
  dia: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: RADIO,
  },
  numero: { fontSize: 14, fontVariant: ['tabular-nums'] },
  fuerte: { fontWeight: '700' },
})
