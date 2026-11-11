/**
 * La confirmación antes de todo lo que empieza, termina o borra algo: título, qué pasará y
 * dos botones, el de confirmar con lo que hace («Exportar», «Sustituir»), nunca «Sí». Puerto
 * de `web/src/componentes/Dialogo.tsx`, con su variante de tres botones (`otra`).
 *
 * Espera a que termine la acción antes de cerrarse, y si falla enseña el motivo dentro del
 * propio diálogo: cerrarlo sin más haría creer que se hizo.
 */
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { textoDelFallo } from '../logica/api'
import { useColores } from '../tema'
import { Boton } from './Boton'

interface Props {
  titulo: string
  /** Qué pasará. Varios párrafos, separados por una línea en blanco. */
  cuerpo?: string
  confirmar: string
  cancelar?: string
  /** En rojo lo que no se puede deshacer; en verde lo demás. */
  peligro?: boolean
  alConfirmar: () => Promise<void>
  /**
   * Una segunda forma de seguir (con recuadro, entre las otras dos): los tres botones van
   * apilados. «Activar y quitarlos», junto a «Activar y dejarlos».
   */
  otra?: { texto: string; alElegir: () => Promise<void> }
  alCancelar: () => void
}

export function Dialogo({
  titulo,
  cuerpo,
  confirmar,
  cancelar = 'Cancelar',
  peligro = false,
  alConfirmar,
  otra,
  alCancelar,
}: Props) {
  const c = useColores()
  const [enCurso, setEnCurso] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  // Centrado bajo el título si cabe en una línea; si ocupa más, se lee mejor a la izquierda.
  const [unaLinea, setUnaLinea] = useState(true)
  const parrafos = cuerpo ? cuerpo.split('\n\n') : []

  async function aceptar(accion: () => Promise<void>) {
    setEnCurso(true)
    setFallo(null)
    try {
      await accion()
    } catch (error) {
      setFallo(textoDelFallo(error))
      setEnCurso(false)
    }
  }

  const cerrar = () => {
    if (!enCurso) alCancelar()
  }
  return (
    <Modal transparent animationType="fade" onRequestClose={cerrar}>
      <Pressable style={estilos.fondo} onPress={cerrar}>
        {/* Un Pressable vacío por dentro para que pulsar el diálogo no lo cierre. */}
        <Pressable
          style={[estilos.dialogo, { backgroundColor: c.superficie, borderColor: c.borde }]}
          onPress={() => {}}
        >
          <ScrollView contentContainerStyle={estilos.contenido}>
            <Text style={[estilos.titulo, { color: c.texto }]} accessibilityRole="header">
              {titulo}
            </Text>
            {parrafos.map((texto) => (
              <Text
                key={texto}
                onTextLayout={(e) =>
                  parrafos.length === 1 && setUnaLinea(e.nativeEvent.lines.length <= 1)
                }
                style={[
                  estilos.cuerpo,
                  { color: c.textoTenue },
                  parrafos.length === 1 && unaLinea && estilos.centrado,
                ]}
              >
                {texto}
              </Text>
            ))}
            {fallo && <Text style={[estilos.cuerpo, { color: c.error }]}>{fallo}</Text>}
            {otra ? (
              <View style={estilos.apilados}>
                <Boton
                  texto={confirmar}
                  alPulsar={() => void aceptar(alConfirmar)}
                  variante={peligro ? 'peligroRelleno' : 'principal'}
                  desactivado={enCurso}
                />
                <Boton
                  texto={otra.texto}
                  alPulsar={() => void aceptar(otra.alElegir)}
                  desactivado={enCurso}
                />
                <Boton texto={cancelar} alPulsar={alCancelar} desactivado={enCurso} />
              </View>
            ) : (
              <View style={estilos.botones}>
                <Boton texto={cancelar} alPulsar={alCancelar} desactivado={enCurso} estirar />
                <Boton
                  texto={confirmar}
                  alPulsar={() => void aceptar(alConfirmar)}
                  variante={peligro ? 'peligroRelleno' : 'principal'}
                  desactivado={enCurso}
                  estirar
                />
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fondo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  dialogo: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '100%',
    borderWidth: 1,
    borderRadius: 12,
  },
  contenido: { padding: 20, gap: 10 },
  titulo: { fontSize: 17, fontWeight: '700', textAlign: 'center', lineHeight: 21 },
  cuerpo: { fontSize: 14, lineHeight: 20 },
  centrado: { textAlign: 'center' },
  // 12 px entre los dos botones, como en la web.
  botones: { flexDirection: 'row', gap: 12, marginTop: 6 },
  apilados: { gap: 12, marginTop: 6 },
})
