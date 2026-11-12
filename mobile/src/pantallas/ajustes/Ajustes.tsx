/**
 * Ajustes: cómo se entrena y cómo se ve la app (`Preferencias`, que se guardan en el
 * teléfono) y tus datos. Puerto de `web/src/paginas/ajustes/Ajustes.tsx`.
 *
 * En el teléfono no hay otra copia: *Exportar* crea el archivo y abre el menú de compartir
 * para guardarlo en Drive, mandarlo por correo o a WhatsApp. *Importar* carga uno y
 * **sustituye todo**: antes, el diálogo dice qué se sustituye por qué, con lo que cuenta la
 * lógica sin escribir nada. *Borrar todos tus datos* deja la app vacía para empezar de cero.
 * Los ajustes no van en el archivo, y ni importar ni borrar los tocan.
 */
import Constants from 'expo-constants'
import { Link, router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Desplazable } from '../../componentes/Desplazable'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import type { ComprobacionDeImportar, ResumenDeDatos } from '../../logica/tipos'
import { api, ErrorDeApi, textoDelFallo } from '../../plataforma/api'
import { compartirArchivo, elegirArchivo } from '../../plataforma/archivos'
import { useColores } from '../../tema'
import { diaDe, diaYMesConAnio, hoy } from '../../utiles/fechas'
import { enumerar } from '../../utiles/textos'
import { tirarTodosLosBorradores } from '../programas/borradores'
import { Apartado, Parrafo, Preferencias, Tarjeta } from './Preferencias'

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

export function Ajustes() {
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

      <Desplazable contentContainerStyle={estilos.contenido}>
        <Preferencias />

        <Apartado>Tus datos</Apartado>
        <Tarjeta>
          <Parrafo>
            Guarda en un archivo todo lo que has apuntado, con tus rutinas, programas, sesiones y
            notas. Sirve para pasarlo a otro dispositivo o para tener una copia. Los ajustes de esta
            pantalla no van en el archivo.
          </Parrafo>
          <Boton
            texto="Exportar datos"
            alPulsar={() => void preguntar(setPorExportar)}
            desactivado={ocupado}
          />
        </Tarjeta>
        <Tarjeta>
          <Parrafo>
            Carga un archivo exportado.{' '}
            <Text style={[estilos.fuerte, { color: c.texto }]}>
              Sustituye todo lo que tienes ahora
            </Text>{' '}
            por lo del archivo. Antes te dirá qué hay en cada sitio.
          </Parrafo>
          <Boton texto="Importar datos" alPulsar={() => void importar()} desactivado={ocupado} />
        </Tarjeta>
        <Tarjeta>
          <Parrafo>
            Borra todo lo que has apuntado para empezar de cero. Los ejercicios que trae la app y
            los ajustes se quedan.
          </Parrafo>
          {/* Sin mirar si hay algo: aunque no quede nada que contar, puede quedar algo que
              borrar (una sesión vacía, un descanso planificado). */}
          <Boton
            texto="Borrar todos tus datos"
            variante="peligro"
            alPulsar={() => void preguntar(setPorBorrar)}
            desactivado={ocupado}
          />
        </Tarjeta>

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
      </Desplazable>

      {porExportar && (
        <Dialogo
          titulo="¿Exportar tus datos?"
          cuerpo={
            describir(porExportar) === 'nada'
              ? 'Todavía no tienes nada apuntado, así que el archivo se guardará vacío.'
              : `Se ${esUnaSola(porExportar) ? 'guardará' : 'guardarán'} en un archivo ${describir(porExportar)}. ` +
                'Después elige dónde guardarlo o a quién mandarlo. Los ajustes no van en el archivo.'
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
            'Los ejercicios que trae la app y los ajustes se quedan. ' +
            'Si quieres conservarlo, expórtalo antes.'
          }
          confirmar="Borrar todo"
          peligro
          alConfirmar={async () => {
            await api.borrarDatos()
            // Los ids que guardan los borradores ya no existen.
            tirarTodosLosBorradores()
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
            tirarTodosLosBorradores()
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
  version: { fontSize: 13, textAlign: 'center', padding: 12 },
  titulo: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  contenido: { padding: 16, gap: 12 },
  fuerte: { fontWeight: '700' },
  aviso: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 13, lineHeight: 19, marginTop: 4 },
})
