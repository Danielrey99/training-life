/**
 * P5 · Programa nuevo: el nombre, si se activa al crearlo y la rutina de cada día. Puerto de
 * `web/src/paginas/programas/ProgramaNuevo.tsx`.
 *
 * Nada se guarda hasta *Crear*, que lo manda todo en una sola llamada. El borrador sobrevive a
 * ir a crear una rutina nueva desde la hoja de un día y volver: esa rutina vuelve puesta en el
 * día desde el que se pidió (la rutina nueva la escribe en el borrador, y esta pantalla, que
 * sigue montada debajo, se entera sola).
 */
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Cabecera } from '../../componentes/Cabecera'
import { CampoDeNombre } from '../../componentes/CampoDeNombre'
import { Desplazable } from '../../componentes/Desplazable'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { IconoEnTexto } from '../../componentes/IconoEnTexto'
import { Interruptor } from '../../componentes/Interruptor'
import { esDelCampo, textoDelFallo } from '../../logica/api'
import type { DiaSemana, Programa, Rutina } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { useColores, type Colores } from '../../tema'
import { fechaEnFrase, hoy } from '../../utiles/fechas'
import { diasCambiadosAMano, QUE_HACER_CON_ELLOS } from '../../utiles/textos'
import { DIAS, PROGRAMA_NUEVO, sinDias, useBorrador, type BorradorDePrograma } from './borradores'
import { DiasEditables } from './DiasEditables'
import { HojaDeRutinas } from './HojaDeRutinas'

type Datos = { activo: Programa | undefined; rutinas: Rutina[] }

/** Lo justo para pintar el día. */
function minima(rutina: Rutina) {
  return { id: rutina.id, nombre: rutina.nombre, oculto_desde: rutina.oculto_desde }
}

/** Fuera de la pantalla: a la lista de programas, la de debajo si se vino de ella. */
function salir() {
  if (router.canGoBack()) router.back()
  else router.replace('/programas')
}

export function ProgramaNuevo() {
  const c = useColores()
  const e = useEstilos(c)
  const [datos, setDatos] = useState<Datos | null>(null)
  // Nace sin activar (decisión del autor): activarlo es algo que se elige a propósito.
  const [borrador, setBorrador] = useBorrador<BorradorDePrograma>(PROGRAMA_NUEVO, () => ({
    nombre: '',
    activar: false,
    dias: sinDias(),
  }))
  const [error, setError] = useState<unknown>(null)
  const [hojaDe, setHojaDe] = useState<DiaSemana | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)
  // Crear un programa que se activa pregunta antes, como activar uno desde su semana.
  const [confirmando, setConfirmando] = useState(false)
  // Los días cambiados a mano de hoy en adelante, que se preguntan al activar el programa.
  const [cambiados, setCambiados] = useState<string[]>([])
  const [lectura, setLectura] = useState(0)

  // También al volver de crear una rutina, para que salga en la hoja de los demás días.
  useFocusEffect(
    useCallback(() => {
      let vigente = true
      Promise.all([api.programas(), api.rutinas()])
        .then(([programas, rutinas]) => {
          if (!vigente) return
          setDatos({ activo: programas.find((uno) => uno.activo), rutinas })
          setError(null)
        })
        .catch((fallo: unknown) => {
          if (vigente) setError(fallo)
        })
      return () => {
        vigente = false
      }
      // `lectura` solo sirve para que Reintentar vuelva a pedirlo.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lectura]),
  )

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="Nuevo programa" alVolver={salir} />
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!datos) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const { activo, rutinas } = datos

  function cambiar(cambios: Partial<BorradorDePrograma>) {
    setBorrador((antes) => ({ ...antes, ...cambios }))
  }

  /**
   * Con «Activarlo al crearlo» encendido, *Crear* pregunta antes (decisión del autor): activa
   * el programa en lugar del que hubiera, y activar siempre pide confirmación. Apagado, no
   * cambia nada de lo que ya hay y crea directamente.
   */
  async function pedirCrear() {
    if (!borrador.nombre.trim()) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    if (!borrador.activar) {
      void crear()
      return
    }
    try {
      const lista = await api.excepciones({ desde: hoy() })
      setCambiados(lista.map((una) => una.fecha))
    } catch {
      // Sin la lista se crea como antes: los días cambiados se quedan como están.
      setCambiados([])
    }
    setConfirmando(true)
  }

  async function crear(quitarExcepciones = false) {
    const nombre = borrador.nombre.trim()
    if (!nombre) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    setFalloNombre(null)
    try {
      const programa = await api.crearPrograma({
        nombre,
        activar: borrador.activar,
        quitar_excepciones: quitarExcepciones,
        dias: DIAS.flatMap((dia) => {
          const rutina = borrador.dias[dia]
          return rutina ? [{ dia_semana: dia, rutina_id: rutina.id }] : []
        }),
      })
      // En su lugar, la semana del programa recién creado; el borrador se tira al cerrarse.
      router.replace({ pathname: '/programas/[id]', params: { id: String(programa.id) } })
    } catch (fallo) {
      // El nombre repetido va bajo el nombre, como al editarlo.
      if (esDelCampo(fallo, 'nombre')) setFalloNombre(fallo.message)
      else setFallo(textoDelFallo(fallo))
      setGuardando(false)
    }
  }

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo="Nuevo programa"
        alVolver={salir}
        derecha={{ texto: 'Crear', alPulsar: () => void pedirCrear(), desactivado: guardando }}
      />

      <Desplazable contentContainerStyle={e.contenido}>
        {fallo && <Text style={e.fallo}>{fallo}</Text>}

        <CampoDeNombre
          valor={borrador.nombre}
          alCambiar={(valor) => {
            cambiar({ nombre: valor })
            setFalloNombre(null)
          }}
          fallo={falloNombre}
          ejemplo="Ej. PPL de 5 días"
          desactivado={guardando}
        />

        <Interruptor
          titulo="Activarlo al crearlo"
          // Sin decir cuál deja de estar activo: lo dice la confirmación de Crear (decisión
          // del autor).
          ayuda="Marcará qué rutina toca cada día"
          encendido={borrador.activar}
          alCambiar={() => cambiar({ activar: !borrador.activar })}
          desactivado={guardando}
        />

        <Text style={e.rotulo}>Días</Text>
        <DiasEditables
          dias={borrador.dias}
          alAbrir={setHojaDe}
          alQuitar={(dia) => cambiar({ dias: { ...borrador.dias, [dia]: null } })}
          desactivado={guardando}
        />

        <Text style={e.parrafo}>
          Pulsa <IconoEnTexto nombre="mas" /> en un día para asignarle una rutina, nueva o de las
          que ya tienes. Los días vacíos son descanso.
        </Text>
      </Desplazable>

      {hojaDe !== null && (
        <HojaDeRutinas
          diaSemana={hojaDe}
          rutinas={rutinas}
          diasDelActivo={activo?.dias}
          elegida={borrador.dias[hojaDe]?.id ?? null}
          alElegir={(rutina) => {
            cambiar({ dias: { ...borrador.dias, [hojaDe]: minima(rutina) } })
            setHojaDe(null)
          }}
          alCerrar={() => setHojaDe(null)}
          alCrearNueva={() => {
            setHojaDe(null)
            router.push({ pathname: '/programas/rutinas/nueva', params: { dia: String(hojaDe) } })
          }}
        />
      )}

      {confirmando && (
        <Dialogo
          titulo={`¿Crear y activar ${borrador.nombre.trim()}?`}
          cuerpo={[
            activo
              ? `${activo.nombre} dejará de estar activo.`
              : 'Cada día, Entrenar te dirá qué rutina toca, y el calendario marcará qué días entrenaste y cuáles te saltaste.',
            ...(cambiados.length > 0
              ? [
                  `${diasCambiadosAMano(cambiados, (iso) => fechaEnFrase(iso, false))} ${QUE_HACER_CON_ELLOS}`,
                ]
              : []),
          ].join('\n\n')}
          confirmar={cambiados.length > 0 ? 'Crear y dejarlos' : 'Crear'}
          alConfirmar={async () => {
            setConfirmando(false)
            await crear()
          }}
          otra={
            cambiados.length > 0
              ? {
                  texto: 'Crear y quitarlos',
                  alElegir: async () => {
                    setConfirmando(false)
                    await crear(true)
                  },
                }
              : undefined
          }
          alCancelar={() => setConfirmando(false)}
        />
      )}
    </SafeAreaView>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 12 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue, padding: 16 },
    fallo: { fontSize: 14, lineHeight: 20, color: c.error },
    rotulo: { marginTop: 4, marginBottom: -4, fontSize: 13, color: c.textoTenue },
    parrafo: {
      width: '100%',
      maxWidth: 320,
      alignSelf: 'center',
      fontSize: 13,
      lineHeight: 19,
      color: c.textoTenue,
    },
  })
}
