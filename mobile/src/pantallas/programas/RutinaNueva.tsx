/**
 * P3 en estado nueva · Crear una rutina: el nombre y sus ejercicios. Puerto de
 * `web/src/paginas/programas/RutinaNueva.tsx`.
 *
 * Todo va a un borrador (también lo que se guarda en el formulario de cada ejercicio, que solo
 * lo apunta en la lista): nada llega a la lógica hasta el *Guardar* de esta pantalla, que crea
 * la rutina con todos sus ejercicios en una sola llamada. Salir sin guardar no deja nada.
 *
 * Si se llega desde la hoja de elegir rutina de un día (`?dia=4`, del programa nuevo o, con
 * `&programa=7`, de uno que se está editando), al guardarla vuelve allí con la rutina puesta
 * en ese día.
 */
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Cabecera } from '../../componentes/Cabecera'
import { CampoDeNombre } from '../../componentes/CampoDeNombre'
import { IconoEnTexto } from '../../componentes/IconoEnTexto'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import { esDelCampo, textoDelFallo } from '../../logica/api'
import type { DiaSemana } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, useColores, type Colores } from '../../tema'
import { lineaDeAlternativas, NOMBRES_DE_LOS_DIAS, objetivo } from '../../utiles/textos'
import {
  guardarBorrador,
  leerBorrador,
  PROGRAMA_NUEVO,
  RUTINA_NUEVA,
  semanaEnEdicion,
  useBorradorAjeno,
  useBorrador,
  type BorradorDeRutina,
  type DiasConNombre,
  type EjercicioDelBorrador,
} from './borradores'
import { ListaDeEjercicios } from './ListaDeEjercicios'

/**
 * Una clave fija para cada ejercicio del borrador, que no cambia al moverlo: con su posición,
 * la fila que se arrastra cambiaría de clave a mitad del gesto. Cambiarlo en su formulario
 * crea otro objeto y otra clave, pero eso no pasa mientras se arrastra.
 */
const claves = new WeakMap<EjercicioDelBorrador, number>()
let ultimaClave = 0
function claveDe(ejercicio: EjercicioDelBorrador) {
  if (!claves.has(ejercicio)) claves.set(ejercicio, ++ultimaClave)
  return claves.get(ejercicio)!
}

/** A la pantalla de la que se vino (la lista, el programa nuevo o la semana que se edita). */
function volver() {
  if (router.canGoBack()) router.back()
  else router.replace('/programas')
}

export function RutinaNueva() {
  const c = useColores()
  const e = useEstilos(c)
  const parametros = useLocalSearchParams<{ dia?: string; programa?: string }>()
  const dia = parametros.dia ? (Number(parametros.dia) as DiaSemana) : null
  // Con `programa`, se pidió desde la semana de un programa que se está editando; sin él (y
  // con `dia`), desde el programa nuevo.
  const programaId = parametros.programa ? Number(parametros.programa) : null
  const destino = programaId !== null ? semanaEnEdicion(programaId) : PROGRAMA_NUEVO

  const [borrador, setBorrador] = useBorrador<BorradorDeRutina>(RUTINA_NUEVA, () => ({
    nombre: '',
    ejercicios: [],
  }))
  const programa = useBorradorAjeno<DiasConNombre>(dia ? destino : null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)

  function mover(desde: number, hasta: number) {
    setBorrador((antes) => {
      const lista = [...antes.ejercicios]
      const [movido] = lista.splice(desde, 1)
      lista.splice(hasta, 0, movido)
      return { ...antes, ejercicios: lista }
    })
  }

  async function guardar() {
    const nombre = borrador.nombre.trim()
    if (!nombre) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    setFalloNombre(null)
    try {
      const rutina = await api.crearRutina({
        nombre,
        slots: borrador.ejercicios.map((ejercicio) => ({
          ejercicio_principal_id: ejercicio.principal.id,
          ...ejercicio.objetivo,
          alternativas: ejercicio.alternativas.map((otra) => ({
            ejercicio_id: otra.ejercicio.id,
            ...otra.objetivo,
          })),
        })),
      })
      if (dia) {
        // De vuelta al programa, con la rutina ya en su día.
        const suPrograma = leerBorrador<DiasConNombre>(destino)
        if (suPrograma) {
          guardarBorrador(destino, {
            ...suPrograma,
            dias: {
              ...suPrograma.dias,
              [dia]: { id: rutina.id, nombre: rutina.nombre, oculto_desde: null },
            },
          })
        }
        volver()
      } else {
        // En su lugar, la rutina recién creada; el borrador se tira al cerrarse esta.
        router.replace({ pathname: '/programas/rutinas/[id]', params: { id: String(rutina.id) } })
      }
    } catch (fallo) {
      // El nombre repetido va bajo el nombre, como al editarlo.
      if (esDelCampo(fallo, 'nombre')) setFalloNombre(fallo.message)
      else setFallo(textoDelFallo(fallo))
      setGuardando(false)
    }
  }

  const ejercicios = borrador.ejercicios
  const filas = ejercicios.map((ejercicio, indice) => ({
    clave: claveDe(ejercicio),
    nombre: ejercicio.principal.nombre,
    objetivo: objetivo(ejercicio.objetivo),
    detalle: lineaDeAlternativas(ejercicio.alternativas.length),
    alAbrir: () =>
      router.push({
        pathname: '/programas/rutinas/nueva/ejercicios/[indice]',
        params: { indice: String(indice) },
      }),
  }))

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo="Nueva rutina"
        subtitulo={
          dia
            ? `Se pondrá el ${NOMBRES_DE_LOS_DIAS[dia - 1]} de ${programa?.nombre.trim() || 'tu programa nuevo'}`
            : undefined
        }
        alVolver={volver}
        derecha={{ texto: 'Guardar', alPulsar: () => void guardar(), desactivado: guardando }}
      />

      <ScrollView
        contentContainerStyle={e.contenido}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        scrollEnabled={!arrastrando}
      >
        {fallo && <Text style={e.fallo}>{fallo}</Text>}

        <CampoDeNombre
          valor={borrador.nombre}
          alCambiar={(valor) => {
            setBorrador((antes) => ({ ...antes, nombre: valor }))
            setFalloNombre(null)
          }}
          fallo={falloNombre}
          ejemplo="Ej. Pierna"
          desactivado={guardando}
        />

        {ejercicios.length === 0 ? (
          <TextoCentrado style={e.recuadroVacio}>
            {'Todavía no tiene ejercicios.\nAñade el primero para empezar.'}
          </TextoCentrado>
        ) : (
          <ListaDeEjercicios
            filas={filas}
            alMover={ejercicios.length > 1 ? mover : undefined}
            alArrastrar={setArrastrando}
          />
        )}

        <Boton
          texto="Añadir ejercicio"
          alPulsar={() =>
            router.push({
              pathname: '/programas/rutinas/nueva/ejercicios/[indice]',
              params: { indice: 'nuevo' },
            })
          }
          desactivado={guardando}
        />

        {ejercicios.length > 0 && (
          <TextoCentrado style={e.leyenda}>
            {/* Sueltos y no en un fragmento: `TextoCentrado` cuenta las frases por sus `\n`. */}
            {ejercicios.length > 1 && 'Arrastra '}
            {ejercicios.length > 1 && <IconoEnTexto nombre="asa" />}
            {ejercicios.length > 1 && ' para cambiar el orden.\n'}
            Pulsa un ejercicio para cambiarlo o quitarlo.
          </TextoCentrado>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 12 },
    fallo: { fontSize: 14, lineHeight: 20, color: c.error },
    recuadroVacio: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
      fontSize: 14,
      lineHeight: 20,
      color: c.textoTenue,
    },
    leyenda: { marginTop: 4, fontSize: 13, lineHeight: 19, color: c.textoTenue },
  })
}
