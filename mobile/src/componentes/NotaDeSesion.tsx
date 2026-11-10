/**
 * La nota de una sesión, igual en la sesión en curso y en el día del historial. Puerto de
 * `web/src/componentes/NotaDeSesion.tsx`.
 *
 * En la sesión se puede escribir en cualquier momento, no solo al terminar: lo que se quiere
 * apuntar se olvida si hay que esperar al final. Se maneja como una serie más: lápiz para
 * cambiarla y ✕ para borrarla (que pregunta antes).
 */
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { textoDelFallo } from '../logica/api'
import { RADIO, RADIO_PEQUENO, useColores } from '../tema'
import { Boton } from './Boton'
import { Dialogo } from './Dialogo'
import { Icono } from './Icono'

interface Props {
  nota: string | null
  /** Si se puede añadir, cambiar o borrar. */
  editable: boolean
  /** Si el campo está abierto. Lo lleva la pantalla: las ediciones van de una en una. */
  abierta: boolean
  alAbrir: () => void
  alCerrar: () => void
  /** Otra edición está abierta: el lápiz, la ✕ y Añadir nota se quedan en gris. */
  bloqueada?: boolean
  /** En el modo editar del día nada se guarda hasta Guardar arriba: Añadir o Aplicar. */
  enBorrador?: boolean
  /** Guarda la nota nueva, o la borra con null. */
  alGuardar: (nota: string | null) => Promise<void>
}

export function NotaDeSesion({
  nota,
  editable,
  abierta,
  alAbrir,
  alCerrar,
  bloqueada = false,
  enBorrador = false,
  alGuardar,
}: Props) {
  const c = useColores()
  const [texto, setTexto] = useState(nota ?? '')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [borrando, setBorrando] = useState(false)

  function abrir() {
    setTexto(nota ?? '')
    setFallo(null)
    alAbrir()
  }

  async function enviar() {
    // Vaciar el campo y guardar es borrarla: pregunta igual que la ✕.
    if (texto.trim() === '' && nota) {
      setBorrando(true)
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      await alGuardar(texto.trim() === '' ? null : texto.trim())
      alCerrar()
    } catch (error) {
      setFallo(textoDelFallo(error))
    } finally {
      setGuardando(false)
    }
  }

  const dialogo = borrando && (
    <Dialogo
      titulo="¿Borrar la nota?"
      confirmar="Borrar"
      peligro
      alConfirmar={async () => {
        await alGuardar(null)
        setBorrando(false)
        alCerrar()
      }}
      alCancelar={() => setBorrando(false)}
    />
  )

  const caja = [estilos.caja, { backgroundColor: c.superficie, borderColor: c.borde }]

  if (abierta && editable) {
    return (
      <>
        <View style={caja}>
          <Text style={[estilos.rotulo, { color: c.textoTenue }]}>Nota</Text>
          <TextInput
            style={[
              estilos.campo,
              { color: c.texto, backgroundColor: c.fondo, borderColor: c.borde },
            ]}
            multiline
            numberOfLines={3}
            maxLength={1000}
            value={texto}
            placeholder="Cómo va, qué cambiar la próxima vez…"
            placeholderTextColor={c.textoTenue}
            onChangeText={setTexto}
            autoFocus
          />
          <View style={estilos.botones}>
            <Boton
              texto="Cancelar"
              variante="peligro"
              alPulsar={alCerrar}
              desactivado={guardando}
              estirar
            />
            <Boton
              texto={enBorrador ? (nota ? 'Aplicar' : 'Añadir') : 'Guardar'}
              variante="principal"
              alPulsar={() => void enviar()}
              desactivado={guardando}
              estirar
            />
          </View>
          {fallo && <Text style={[estilos.fallo, { color: c.error }]}>{fallo}</Text>}
        </View>
        {dialogo}
      </>
    )
  }

  if (!nota) {
    return editable ? (
      <Pressable
        accessibilityRole="button"
        onPress={abrir}
        disabled={bloqueada}
        style={[estilos.anadir, { borderColor: c.borde }, bloqueada && estilos.gris]}
      >
        <Icono nombre="editar" color={c.textoTenue} pequeno />
        <Text style={[estilos.anadirTexto, { color: c.textoTenue }]}>Añadir nota</Text>
      </Pressable>
    ) : null
  }

  return (
    <>
      <View style={caja}>
        <View style={estilos.cabecera}>
          <Text style={[estilos.rotulo, estilos.crece, { color: c.textoTenue }]}>Nota</Text>
          {editable && (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cambiar la nota"
                onPress={abrir}
                disabled={bloqueada}
                style={[estilos.icono, bloqueada && estilos.gris]}
              >
                <Icono nombre="editar" color={c.textoTenue} pequeno />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Borrar la nota"
                onPress={() => setBorrando(true)}
                disabled={bloqueada}
                style={[estilos.icono, bloqueada && estilos.gris]}
              >
                <Icono nombre="quitar" color={c.error} pequeno />
              </Pressable>
            </>
          )}
        </View>
        <Text style={[estilos.texto, { color: c.texto }]}>{nota}</Text>
      </View>
      {dialogo}
    </>
  )
}

const estilos = StyleSheet.create({
  caja: { gap: 8, padding: 14, borderWidth: 1, borderRadius: RADIO },
  cabecera: { flexDirection: 'row', alignItems: 'center' },
  crece: { flex: 1 },
  rotulo: { fontSize: 12.5 },
  texto: { fontSize: 14, lineHeight: 20 },
  icono: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  campo: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
    padding: 10,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  botones: { flexDirection: 'row', gap: 12 },
  fallo: { fontSize: 13 },
  anadir: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
  },
  anadirTexto: { fontSize: 14, fontWeight: '600' },
  gris: { opacity: 0.45 },
})
