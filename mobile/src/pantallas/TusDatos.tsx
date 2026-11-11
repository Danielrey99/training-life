/**
 * Tus datos: exportar, importar y borrar todo. Puerto de la parte «Tus datos» de
 * `web/src/paginas/ajustes/Ajustes.tsx`; el resto de Ajustes llega después.
 *
 * En el teléfono no hay otra copia: *Exportar* crea el archivo y abre el menú de compartir
 * para guardarlo en Drive, mandarlo por correo o a WhatsApp. *Importar* carga uno y
 * **sustituye todo**: antes, el diálogo dice qué se sustituye por qué, con lo que cuenta la
 * lógica sin escribir nada.
 */
import Constants from 'expo-constants'
import { Link, router } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../componentes/Boton'
import { Dialogo } from '../componentes/Dialogo'
import { Icono } from '../componentes/Icono'
import type { ComprobacionDeImportar, ResumenDeDatos } from '../logica/tipos'
import { api, ErrorDeApi, textoDelFallo } from '../plataforma/api'
import { compartirArchivo, elegirArchivo } from '../plataforma/archivos'
import { RADIO, useColores } from '../tema'
import { diaDe, diaYMesConAnio, hoy } from '../utiles/fechas'
import { enumerar } from '../utiles/textos'

type Pendiente = { archivo: unknown; comprobacion: ComprobacionDeImportar }

const NO_ES_UNA_COPIA = 'Ese archivo no es una copia de los datos de Training Life.'

function contar(cuantos: number, singular: string, plural: string) {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

/** «3 rutinas, 1 programa y 12 sesiones (del 2 de septiembre al 1 de octubre)». */
function describir(resumen: ResumenDeDatos) {
  const partes: string[] = []
  if (resumen.rutinas) partes.push(contar(resumen.rutinas, 'rutina', 'rutinas'))
  if (resumen.programas) partes.push(contar(resumen.programas, 'programa', 'programas'))
  if (resumen.ejercicios)
    partes.push(contar(resumen.ejercicios, 'ejercicio tuyo', 'ejercicios tuyos'))
  if (resumen.notas) partes.push(contar(resumen.notas, 'nota', 'notas'))
  if (resumen.sesiones && resumen.primera_sesion && resumen.ultima_sesion) {
    const desde = diaYMesConAnio(resumen.primera_sesion)
    const hasta = diaYMesConAnio(resumen.ultima_sesion)
    const cuando = desde === hasta ? `del ${desde}` : `del ${desde} al ${hasta}`
    partes.push(`${contar(resumen.sesiones, 'sesión', 'sesiones')} (${cuando})`)
  }
  return partes.length === 0 ? 'nada' : enumerar(partes)
}

/** Si lo que cuenta `describir` es una sola cosa: «se borrará 1 rutina», no «se borrarán». */
function esUnaSola(resumen: ResumenDeDatos) {
  const { rutinas, programas, ejercicios, notas, sesiones } = resumen
  return rutinas + programas + ejercicios + notas + sesiones === 1
}

export function TusDatos() {
  const c = useColores()
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<{ mensaje: string; errores: string[] } | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [porExportar, setPorExportar] = useState<ResumenDeDatos | null>(null)
  const [porBorrar, setPorBorrar] = useState<ResumenDeDatos | null>(null)

  function fallar(error: unknown) {
    if (error instanceof ErrorDeApi) {
      const detalle = error.detalle as { errores?: string[] } | null
      // Los errores de un archivo dañado son los del validador, en inglés: no ayudan.
      const errores = error.message === 'El archivo está dañado.' ? [] : (detalle?.errores ?? [])
      setFallo({ mensaje: error.message, errores })
    } else {
      setFallo({ mensaje: textoDelFallo(error), errores: [] })
    }
  }

  /** Antes de exportar o borrar, cuánto hay: el diálogo dice qué se guarda o se pierde. */
  async function preguntar(abrir: (resumen: ResumenDeDatos) => void) {
    setOcupado(true)
    setFallo(null)
    setHecho(null)
    try {
      abrir(await api.resumenDeDatos())
    } catch (error) {
      fallar(error)
    } finally {
      setOcupado(false)
    }
  }

  /** Crea el archivo y abre el menú de compartir. Si falla, el diálogo lo dice. */
  async function exportar() {
    const datos = await api.exportarDatos()
    setPorExportar(null)
    // El diálogo ya se ha cerrado: si compartir falla, se dice en la pantalla.
    try {
      await compartirArchivo(`training-life-${hoy()}.json`, JSON.stringify(datos, null, 2))
    } catch (error) {
      fallar(error)
      return
    }
    setHecho(
      'Se ha creado el archivo con tus datos. Guárdalo donde puedas encontrarlo, como Drive o ' +
        'tu correo, porque fuera del teléfono no hay otra copia.',
    )
  }

  async function importar() {
    setFallo(null)
    setHecho(null)
    let texto: string | null
    try {
      texto = await elegirArchivo()
    } catch (error) {
      fallar(error)
      return
    }
    if (texto === null) return
    setOcupado(true)
    try {
      let archivo: unknown
      try {
        archivo = JSON.parse(texto)
      } catch {
        setFallo({ mensaje: NO_ES_UNA_COPIA, errores: [] })
        return
      }
      setPendiente({ archivo, comprobacion: await api.comprobarImportar(archivo) })
    } catch (error) {
      fallar(error)
    } finally {
      setOcupado(false)
    }
  }

  const tarjeta = [estilos.tarjeta, { backgroundColor: c.superficie, borderColor: c.borde }]
  const parrafo = [estilos.parrafo, { color: c.textoTenue }]
  return (
    <SafeAreaView edges={['top']} style={[estilos.pantalla, { backgroundColor: c.fondo }]}>
      <View style={estilos.cabecera}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.back()}
          style={estilos.volver}
        >
          <Icono nombre="volver" color={c.texto} />
        </Pressable>
        <Text style={[estilos.titulo, { color: c.texto }]} accessibilityRole="header">
          Ajustes
        </Text>
        <View style={estilos.volver} />
      </View>

      <ScrollView contentContainerStyle={estilos.contenido}>
        {/* Centrado y a 15 px, como los apartados de Ajustes en la web (decisión del autor). */}
        <Text style={[estilos.rotulo, { color: c.texto }]} accessibilityRole="header">
          Tus datos
        </Text>
        <View style={tarjeta}>
          <Text style={parrafo}>
            Guarda en un archivo todo lo que has apuntado, con tus rutinas, programas, sesiones y
            notas. Sirve para pasarlo a otro dispositivo o para tener una copia.
          </Text>
          <Boton
            texto="Exportar datos"
            alPulsar={() => void preguntar(setPorExportar)}
            desactivado={ocupado}
          />
        </View>
        <View style={tarjeta}>
          <Text style={parrafo}>
            Carga un archivo exportado.{' '}
            <Text style={[estilos.fuerte, { color: c.texto }]}>
              Sustituye todo lo que tienes ahora
            </Text>{' '}
            por lo del archivo. Antes te dirá qué hay en cada sitio.
          </Text>
          <Boton texto="Importar datos" alPulsar={() => void importar()} desactivado={ocupado} />
        </View>
        <View style={tarjeta}>
          <Text style={parrafo}>
            Borra todo lo que has apuntado para empezar de cero. Los ejercicios que trae la app se
            quedan.
          </Text>
          {/* Sin mirar si hay algo: aunque no quede nada que contar, puede quedar algo que
              borrar (una sesión vacía, un descanso planificado). */}
          <Boton
            texto="Borrar todos tus datos"
            variante="peligro"
            alPulsar={() => void preguntar(setPorBorrar)}
            desactivado={ocupado}
          />
        </View>

        {hecho && <Text style={[estilos.aviso, { color: c.texto }]}>{hecho}</Text>}
        {fallo && (
          <View>
            <Text style={[estilos.aviso, { color: c.error }]}>{fallo.mensaje}</Text>
            {fallo.errores.map((error) => (
              <Text key={error} style={[estilos.error, { color: c.error }]}>
                • {error}
              </Text>
            ))}
          </View>
        )}

        {/* Tocar la versión lleva a la comprobación de la base del teléfono (oculta a
            propósito: es para diagnosticar, no para el día a día). */}
        <Link href="/autocomprobacion" style={[estilos.version, { color: c.textoTenue }]}>
          Versión {Constants.expoConfig?.version}
        </Link>
      </ScrollView>

      {porExportar && (
        <Dialogo
          titulo="¿Exportar tus datos?"
          cuerpo={
            describir(porExportar) === 'nada'
              ? 'Todavía no tienes nada apuntado, así que el archivo se guardará vacío.'
              : `Se ${esUnaSola(porExportar) ? 'guardará' : 'guardarán'} en un archivo ${describir(porExportar)}. ` +
                'Después elige dónde guardarlo o a quién mandarlo.'
          }
          confirmar="Exportar"
          alConfirmar={exportar}
          alCancelar={() => setPorExportar(null)}
        />
      )}
      {porBorrar && (
        <Dialogo
          titulo="¿Borrar todos tus datos?"
          cuerpo={
            (describir(porBorrar) === 'nada'
              ? 'No tienes nada apuntado. Se borrará lo poco que quede, como los descansos planificados. '
              : `Se ${esUnaSola(porBorrar) ? 'borrará' : 'borrarán'} ${describir(porBorrar)}. `) +
            'Los ejercicios que trae la app se quedan. ' +
            'Si quieres conservarlo, expórtalo antes.'
          }
          confirmar="Borrar todo"
          peligro
          alConfirmar={async () => {
            await api.borrarDatos()
            setPorBorrar(null)
            setHecho('Se han borrado todos tus datos. Puedes empezar de cero.')
          }}
          alCancelar={() => setPorBorrar(null)}
        />
      )}
      {pendiente && (
        <Dialogo
          titulo="¿Sustituir tus datos?"
          cuerpo={
            (describir(pendiente.comprobacion.actual) === 'nada'
              ? 'Ahora no tienes nada apuntado. '
              : `Ahora tienes ${describir(pendiente.comprobacion.actual)}. `) +
            `El archivo, exportado el ${diaYMesConAnio(diaDe(pendiente.comprobacion.exportado_en))}, ` +
            `tiene ${describir(pendiente.comprobacion.archivo)}. ` +
            'Todo lo de ahora se sustituirá por lo del archivo. ' +
            'Si quieres conservarlo, expórtalo antes.'
          }
          confirmar="Sustituir"
          peligro
          alConfirmar={async () => {
            const cargado = await api.importarDatos(pendiente.archivo)
            setPendiente(null)
            setHecho(
              describir(cargado) === 'nada'
                ? 'Datos cargados. El archivo no tenía nada apuntado.'
                : `Datos cargados. Ahora tienes ${describir(cargado)}.`,
            )
          }}
          alCancelar={() => setPendiente(null)}
        />
      )}
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  cabecera: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 56 },
  volver: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  rotulo: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  version: { fontSize: 13, textAlign: 'center', padding: 12 },
  titulo: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  contenido: { padding: 16, gap: 12 },
  tarjeta: { padding: 16, gap: 12, borderWidth: 1, borderRadius: RADIO },
  parrafo: { fontSize: 14, lineHeight: 20 },
  fuerte: { fontWeight: '700' },
  aviso: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 13, lineHeight: 19, marginTop: 4 },
})
