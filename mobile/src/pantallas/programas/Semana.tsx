/**
 * P2 · La semana de un programa: qué rutina toca cada día. Puerto de
 * `web/src/paginas/programas/Semana.tsx`.
 *
 * El interruptor de *Programa activo* es lo único que cambia sin *Editar*: no toca el
 * programa, solo cuál se usa, y por eso pregunta y guarda al momento. Al editar desaparece,
 * para que dentro de *Editar* todo espere a *Guardar*: el nombre y los días van a un borrador
 * que *Guardar* envía de golpe y *Cancelar* descarta; ocultar y borrar el programa están ahí.
 *
 * Un programa oculto no se edita: su vista es de solo lectura, con *Mostrar* y *Borrar*.
 *
 * Diferencias con la web: la pantalla se queda montada debajo de la rutina que se abre, así
 * que relee al volver (sin perder lo que se está editando), y el atrás de Android hace lo
 * mismo que la flecha, preguntando antes de descartar lo que se ha cambiado.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Cabecera } from '../../componentes/Cabecera'
import { CampoDeNombre } from '../../componentes/CampoDeNombre'
import { Desplazable } from '../../componentes/Desplazable'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { IconoEnTexto } from '../../componentes/IconoEnTexto'
import { Interruptor } from '../../componentes/Interruptor'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import { esDelCampo, textoDelFallo } from '../../logica/api'
import type { DiaSemana, Programa, Rutina, RutinaMinima } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, useColores, type Colores } from '../../tema'
import { useAjustes } from '../../utiles/ajustes'
import { colorDelDia } from '../../utiles/colores'
import { diaYMesConAnio, fechaEnFrase, hoy } from '../../utiles/fechas'
import {
  cuantosDias,
  diasCambiadosAMano,
  ejercicios,
  enumerar,
  NOMBRES_DE_LOS_DIAS,
  nombreDelDiaSemana,
  QUE_HACER_CON_ELLOS,
} from '../../utiles/textos'
import {
  DIAS,
  guardarBorrador,
  leerBorrador,
  semanaEnEdicion,
  tirarBorrador,
  type DiasConNombre,
  type DiasDelBorrador,
} from './borradores'
import { DiasEditables } from './DiasEditables'
import { useEstilosDeSemana } from './estilosDeSemana'
import { HojaDeRutinas } from './HojaDeRutinas'

type Datos = {
  programa: Programa
  // El activo, sea este u otro: su nombre sale en el interruptor y sus días ordenan la hoja
  // de elegir rutina.
  activo: Programa | undefined
  // Las visibles, para el número de ejercicios de cada día y para la hoja de elegir.
  rutinas: Rutina[]
}

type Pregunta = 'activar' | 'desactivar' | 'ocultar' | 'mostrar' | 'borrar'

function diasDe(programa: Programa): DiasDelBorrador {
  const dias = {} as DiasDelBorrador
  for (const dia of DIAS) {
    dias[dia] = programa.dias.find((uno) => uno.dia_semana === dia)?.rutina ?? null
  }
  return dias
}

async function leer(id: number): Promise<Datos> {
  const [programa, programas, rutinas] = await Promise.all([
    api.programa(id),
    api.programas(),
    api.rutinas(),
  ])
  return { programa, activo: programas.find((uno) => uno.activo), rutinas }
}

/** A la lista de programas: la de debajo si se vino de ella, o una nueva. */
function aLaLista() {
  if (router.canGoBack()) router.back()
  else router.replace('/programas')
}

export function Semana() {
  const c = useColores()
  const e = useEstilos(c)
  const s = useEstilosDeSemana(c)
  // Los colores de los días dependen de los ajustes: se vuelve a pintar al cambiarlos.
  useAjustes()
  const { id: idDeLaRuta = '' } = useLocalSearchParams<{ id: string }>()
  const id = Number(idDeLaRuta)

  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [dias, setDias] = useState<DiasDelBorrador | null>(null)
  const [hojaDe, setHojaDe] = useState<DiaSemana | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  // Los días cambiados a mano de hoy en adelante, que se preguntan al activar otro programa.
  const [cambiados, setCambiados] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)
  const [descartando, setDescartando] = useState(false)
  const [lectura, setLectura] = useState(0)

  // Al abrirla y al volver a ella (de una rutina que se puede haber cambiado, o de crear una
  // para un día): se lee todo de nuevo. Lo que se estaba editando se conserva, y si vuelve de
  // crear una rutina, su borrador trae ya la rutina puesta en su día.
  useFocusEffect(
    useCallback(() => {
      let vigente = true
      leer(id)
        .then((leidos) => {
          if (!vigente) return
          setDatos(leidos)
          setError(null)
          const pendiente = leerBorrador<DiasConNombre>(semanaEnEdicion(id))
          if (pendiente) {
            tirarBorrador(semanaEnEdicion(id))
            setNombre(pendiente.nombre)
            setDias(pendiente.dias)
            setEditando(true)
          }
        })
        .catch((fallo: unknown) => {
          if (vigente) setError(fallo)
        })
      return () => {
        vigente = false
      }
      // `lectura` solo sirve para que Reintentar vuelva a pedirlo.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, lectura]),
  )

  // Si se sale sin volver (cambiando de pestaña), lo que esperaba a la rutina nueva se tira.
  useEffect(() => () => tirarBorrador(semanaEnEdicion(id)), [id])

  const programa = datos?.programa
  const hayCambios =
    editando &&
    !!programa &&
    !!dias &&
    (nombre !== programa.nombre ||
      DIAS.some((dia) => (dias[dia]?.id ?? null) !== (diasDe(programa)[dia]?.id ?? null)))

  // El atrás de Android hace lo mismo que la flecha (decisión del autor). Mientras se edita,
  // con algo cambiado, pregunta antes de descartarlo, porque ese gesto se hace sin querer.
  useEffect(() => {
    if (!hayCambios) return
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      setDescartando(true)
      return true
    })
    return () => suscripcion.remove()
  }, [hayCambios])

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="" alVolver={aLaLista} />
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!datos || !programa) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const { activo, rutinas } = datos
  const oculto = programa.oculto_desde !== null
  const delDia = editando && dias ? dias : diasDe(programa)
  const ejerciciosDe = new Map(rutinas.map((rutina) => [rutina.id, ejercicios(rutina)]))
  const visibles = DIAS.filter((dia) => delDia[dia] && delDia[dia].oculto_desde === null)
  const conOculta = DIAS.filter((dia) => delDia[dia]?.oculto_desde)

  /** Vuelve a leerlo todo tras un cambio: el activo, los días, si está oculto. */
  async function cargar() {
    setDatos(await leer(id))
  }

  /** Antes de preguntar, mira si hay días cambiados a mano de hoy en adelante. */
  async function pedirActivar() {
    try {
      const lista = await api.excepciones({ desde: hoy() })
      setCambiados(lista.map((una) => una.fecha))
    } catch {
      // Sin la lista se activa como antes: los días cambiados se quedan como están.
      setCambiados([])
    }
    setPregunta('activar')
  }

  function empezarAEditar() {
    setNombre(programa!.nombre)
    setDias(diasDe(programa!))
    setFallo(null)
    setFalloNombre(null)
    setEditando(true)
  }

  function cancelar() {
    setEditando(false)
    setFallo(null)
    setFalloNombre(null)
  }

  /**
   * *Guardar*: el nombre y la semana entera en una sola llamada, que la lógica guarda toda o
   * nada. Si falla, sigue editando con el aviso (el del nombre, bajo el nombre).
   */
  async function guardar() {
    if (!dias) return
    const limpio = nombre.trim()
    if (!limpio) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    setFalloNombre(null)
    try {
      const guardado = await api.actualizarPrograma(
        id,
        limpio,
        DIAS.flatMap((dia) => {
          const rutina = dias[dia]
          return rutina ? [{ dia_semana: dia, rutina_id: rutina.id }] : []
        }),
      )
      setDatos({
        ...datos!,
        programa: guardado,
        activo: guardado.activo ? guardado : datos!.activo,
      })
      setEditando(false)
    } catch (fallo) {
      // No se guardó nada: se sigue editando, con lo que había. El nombre repetido va bajo
      // el nombre.
      if (esDelCampo(fallo, 'nombre')) setFalloNombre(fallo.message)
      else setFallo(textoDelFallo(fallo))
    }
    setGuardando(false)
  }

  function elegir(dia: DiaSemana, rutina: RutinaMinima | null) {
    setDias((antes) => (antes ? { ...antes, [dia]: rutina } : antes))
    setHojaDe(null)
  }

  /** «El sábado tiene una rutina oculta…»: por qué ese día cuenta como descanso y qué hacer. */
  function avisoDeOcultas(cuales: DiaSemana[]) {
    const lista = enumerar(cuales.map((dia) => `el ${NOMBRES_DE_LOS_DIAS[dia - 1]}`))
    const frase = lista[0].toUpperCase() + lista.slice(1)
    const una = cuales.length === 1
    return (
      <Text style={e.parrafo}>
        {una
          ? `${frase} tiene una rutina oculta. Sigue asignada, pero cuenta como descanso. `
          : `${frase} tienen una rutina oculta. Siguen asignadas, pero cuentan como descanso. `}
        Pulsa <IconoEnTexto nombre="abrir" /> para entrar en {una ? 'ella' : 'ellas'} y volver a{' '}
        {una ? 'mostrarla' : 'mostrarlas'}, o <Text style={e.cursiva}>Editar</Text> para poner{' '}
        {una ? 'otra' : 'otras'} en su lugar.
      </Text>
    )
  }

  const subtitulo = `${cuantosDias(visibles.length)}${oculto ? ' · oculto' : ''}`

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo={programa.nombre}
        subtitulo={subtitulo}
        alVolver={aLaLista}
        // Mientras se edita no se sale de la pantalla: o se guarda o se cancela.
        izquierda={
          editando ? { texto: 'Cancelar', alPulsar: cancelar, desactivado: guardando } : undefined
        }
        // Un programa oculto no se edita: sin botón a la derecha.
        derecha={
          oculto
            ? undefined
            : {
                texto: editando ? 'Guardar' : 'Editar',
                alPulsar: () => (editando ? void guardar() : empezarAEditar()),
                desactivado: guardando,
              }
        }
      />

      <Desplazable contentContainerStyle={e.contenido}>
        {fallo && <Text style={e.fallo}>{fallo}</Text>}

        {editando && (
          <CampoDeNombre
            valor={nombre}
            alCambiar={(valor) => {
              setNombre(valor)
              setFalloNombre(null)
            }}
            fallo={falloNombre}
            desactivado={guardando}
          />
        )}

        {oculto ? (
          <View style={e.oculto}>
            <Text style={e.ocultoTitulo}>
              Oculto desde el {diaYMesConAnio(programa.oculto_desde!)}
            </Text>
            <Text style={e.ocultoTexto}>No sale en tu lista de programas.</Text>
            <Text style={e.ocultoTexto}>Sus rutinas y su historial siguen intactos.</Text>
          </View>
        ) : (
          // Fuera de Editar: no cambia el programa, solo cuál se usa, y al editar todo espera
          // a Guardar. Así cada cosa tiene un único momento en que se guarda.
          !editando && (
            <Interruptor
              titulo="Programa activo"
              ayuda={
                programa.activo
                  ? 'Marca qué rutina toca cada día'
                  : activo
                    ? `Al activarlo, ${activo.nombre} dejará de estar activo`
                    : 'Ningún programa marca ahora qué rutina toca cada día'
              }
              encendido={programa.activo}
              alCambiar={() => (programa.activo ? setPregunta('desactivar') : void pedirActivar())}
              desactivado={guardando}
            />
          )
        )}

        {editando && <Text style={e.rotulo}>Días</Text>}

        {editando && dias ? (
          <DiasEditables
            dias={dias}
            alAbrir={setHojaDe}
            alQuitar={(dia) => elegir(dia, null)}
            desactivado={guardando}
          />
        ) : (
          <View style={s.dias}>
            {DIAS.map((dia, indice) => {
              const rutina = delDia[dia]
              const borde = indice > 0 && { borderTopWidth: 1, borderTopColor: c.borde }
              const nombreDelDia = <Text style={s.diaNombre}>{nombreDelDiaSemana(dia)}</Text>
              if (!rutina) {
                return (
                  <View key={dia} style={[s.dia, borde]}>
                    {nombreDelDia}
                    <Text style={[s.diaRutina, s.descanso]}>Descanso</Text>
                  </View>
                )
              }
              const oculta = rutina.oculto_desde !== null
              return (
                <Pressable
                  key={dia}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/programas/rutinas/[id]',
                      params: { id: String(rutina.id) },
                    })
                  }
                  style={({ pressed }) => [s.dia, borde, pressed && { opacity: 0.7 }]}
                >
                  {nombreDelDia}
                  <View style={s.diaRutina}>
                    {/* El color del día, esté activo o no el programa (decisión del autor). */}
                    <View style={[s.punto, !oculta && { backgroundColor: colorDelDia(dia) }]} />
                    <Text style={[s.nombre, oculta && { color: c.textoTenue }]} numberOfLines={1}>
                      {rutina.nombre}
                    </Text>
                    {oculta ? (
                      <Text style={s.etiquetaChica}>oculta</Text>
                    ) : (
                      <Text style={s.extra}>{ejerciciosDe.get(rutina.id)}</Text>
                    )}
                  </View>
                  <Icono nombre="abrir" color={c.textoTenue} pequeno />
                </Pressable>
              )
            })}
          </View>
        )}

        {!editando && !oculto && conOculta.length > 0 && avisoDeOcultas(conOculta)}

        {oculto && (
          <View style={e.acciones}>
            <Boton
              texto="Mostrar programa"
              variante="principal"
              alPulsar={() => setPregunta('mostrar')}
            />
            <Boton
              texto="Borrar programa"
              variante="peligro"
              alPulsar={() => setPregunta('borrar')}
            />
          </View>
        )}

        {editando && (
          <>
            <View style={[e.acciones, { marginTop: 8 }]}>
              <Boton
                texto="Ocultar programa"
                variante="secundaria"
                alPulsar={() => setPregunta('ocultar')}
                desactivado={guardando}
              />
              <Boton
                texto="Borrar programa"
                variante="peligro"
                alPulsar={() => setPregunta('borrar')}
                desactivado={guardando}
              />
            </View>
            <TextoCentrado style={e.leyenda}>
              Pulsa <IconoEnTexto nombre="abrir" /> para cambiar la rutina de un día.{'\n'}Pulsa{' '}
              <IconoEnTexto nombre="quitar" /> para dejarlo en descanso.
            </TextoCentrado>
          </>
        )}
      </Desplazable>

      {hojaDe !== null && dias && (
        <HojaDeRutinas
          diaSemana={hojaDe}
          rutinas={rutinas}
          diasDelActivo={activo?.dias}
          elegida={dias[hojaDe]?.id ?? null}
          alElegir={(rutina) =>
            elegir(hojaDe, { id: rutina.id, nombre: rutina.nombre, oculto_desde: null })
          }
          alCerrar={() => setHojaDe(null)}
          alCrearNueva={() => {
            // Lo editado hasta ahora espera aquí mientras se crea la rutina.
            guardarBorrador(semanaEnEdicion(id), { nombre, dias })
            setHojaDe(null)
            router.push({
              pathname: '/programas/rutinas/nueva',
              params: { dia: String(hojaDe), programa: String(id) },
            })
          }}
        />
      )}

      {descartando && (
        <Dialogo
          titulo="¿Descartar los cambios?"
          cuerpo="Lo que has cambiado en este programa no se guardará."
          confirmar="Descartar"
          cancelar="Seguir editando"
          peligro
          alConfirmar={async () => {
            setDescartando(false)
            cancelar()
            aLaLista()
          }}
          alCancelar={() => setDescartando(false)}
        />
      )}

      {pregunta === 'activar' && (
        <Dialogo
          titulo={`¿Activar ${programa.nombre}?`}
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
          confirmar={cambiados.length > 0 ? 'Activar y dejarlos' : 'Activar'}
          alConfirmar={async () => {
            await api.activarPrograma(id)
            await cargar()
            setPregunta(null)
          }}
          otra={
            cambiados.length > 0
              ? {
                  texto: 'Activar y quitarlos',
                  alElegir: async () => {
                    await api.activarPrograma(id, true)
                    await cargar()
                    setPregunta(null)
                  },
                }
              : undefined
          }
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'desactivar' && (
        <Dialogo
          titulo={`¿Desactivar ${programa.nombre}?`}
          cuerpo="Entrenar dejará de decirte qué rutina toca y el calendario no marcará los días que te saltes. Podrás seguir entrenando cualquier rutina."
          confirmar="Desactivar"
          alConfirmar={async () => {
            await api.desactivarPrograma(id)
            await cargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'ocultar' && (
        <Dialogo
          titulo={`¿Ocultar ${programa.nombre}?`}
          cuerpo={
            programa.activo
              ? 'Dejará de salir en tu lista de programas y, como es el que usas ahora, dejará de estar activo. Sus rutinas no se tocan.'
              : 'Dejará de salir en tu lista de programas. Sus rutinas no se tocan.'
          }
          confirmar="Ocultar"
          alConfirmar={async () => {
            // Lo que hubiera en el borrador se descarta: lo oculto no se edita.
            await api.borrarPrograma(id, 'ocultar')
            await cargar()
            setEditando(false)
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && (
        <Dialogo
          titulo={`¿Mostrar ${programa.nombre}?`}
          cuerpo="Volverá a tu lista de programas, sin activar."
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarPrograma(id)
            await cargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && (
        <Dialogo
          titulo={`¿Borrar ${programa.nombre}?`}
          // Si nunca estuvo activo no hay nada que perder más que el propio programa.
          cuerpo={
            programa.ultimo_periodo
              ? 'Tus rutinas y tus sesiones se quedan, pero el calendario dejará de saber qué rutina tocaba cada día mientras lo usaste.'
              : undefined
          }
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await api.borrarPrograma(id, 'definitivo')
            setPregunta(null)
            aLaLista()
          }}
          alCancelar={() => setPregunta(null)}
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
    oculto: {
      alignItems: 'center',
      gap: 2,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    ocultoTitulo: { fontSize: 14, fontWeight: '700', color: c.textoTenue, textAlign: 'center' },
    ocultoTexto: { fontSize: 13, color: c.textoTenue, textAlign: 'center' },
    // Un párrafo explicativo: a la izquierda, en un bloque estrecho y centrado.
    parrafo: {
      width: '100%',
      maxWidth: 320,
      alignSelf: 'center',
      fontSize: 13,
      lineHeight: 19,
      color: c.textoTenue,
    },
    cursiva: { fontStyle: 'italic' },
    // 12 px entre los botones apilados del pie, el mismo en todas las pantallas.
    acciones: { gap: 12 },
    leyenda: { marginTop: 4, fontSize: 13, lineHeight: 19, color: c.textoTenue },
  })
}
