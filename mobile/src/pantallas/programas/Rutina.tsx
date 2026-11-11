/**
 * P3 · Una rutina: sus ejercicios en orden, cada uno con su objetivo y sus alternativas.
 * Puerto de `web/src/paginas/programas/Rutina.tsx`.
 *
 * Con *Editar*, el nombre y el orden van a un borrador que *Guardar* envía y *Cancelar*
 * descarta; ocultar y borrar la rutina están ahí. Ocultar o borrar un ejercicio se hace dentro
 * de él, donde se avisa de lo que se pierde. *Añadir ejercicio* y *Duplicar rutina* no salen
 * al editar: llevan a otra pantalla y el borrador se perdería.
 *
 * Una rutina oculta no se edita: su vista es de solo lectura, con *Duplicar* (no la modifica),
 * *Mostrar* y *Borrar*.
 *
 * Diferencias con la web: relee al volver de uno de sus ejercicios (aquí se queda montada
 * debajo), los ocultos abiertos no van en la ruta, y el atrás de Android hace lo mismo que la
 * flecha, preguntando antes de descartar lo que se ha cambiado.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { BackHandler, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Cabecera } from '../../componentes/Cabecera'
import { CampoDeNombre } from '../../componentes/CampoDeNombre'
import { Desplazable } from '../../componentes/Desplazable'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { IconoEnTexto } from '../../componentes/IconoEnTexto'
import { Ocultos } from '../../componentes/Ocultos'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import { esDelCampo, textoDelFallo } from '../../logica/api'
import type { AvisoDeBorrarRutina, HuecoDeRutina, Rutina as DatosRutina } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { loQueSePierdeDeLaRutina } from '../../reglasDePantalla/loQueSePierde'
import { RADIO, useColores, type Colores } from '../../tema'
import { diaYMesConAnio } from '../../utiles/fechas'
import { lineaDeAlternativas, objetivo } from '../../utiles/textos'
import { ListaDeEjercicios, type FilaDeEjercicio } from './ListaDeEjercicios'

type Pregunta = 'ocultar' | 'mostrar' | 'borrar'

/** Los huecos visibles en su orden: su posición es el número que se enseña. */
function visiblesEnOrden(rutina: DatosRutina) {
  return rutina.slots
    .filter((hueco) => hueco.oculto_desde === null)
    .sort((uno, otro) => uno.orden - otro.orden)
}

function fila(hueco: HuecoDeRutina, alAbrir?: () => void, oculto = false): FilaDeEjercicio {
  const alternativas = lineaDeAlternativas(hueco.alternativas.length)
  const desde = oculto ? `oculto desde el ${diaYMesConAnio(hueco.oculto_desde!)}` : null
  return {
    clave: hueco.id,
    nombre: hueco.ejercicio_principal.nombre,
    objetivo: objetivo(hueco),
    detalle: [alternativas, desde].filter(Boolean).join(' · ') || null,
    principalOculto: !oculto && hueco.ejercicio_principal.oculto_desde !== null,
    alAbrir,
  }
}

/** A la pantalla de la que se vino (la lista o la semana de un programa), o a la lista. */
function volver() {
  if (router.canGoBack()) router.back()
  else router.replace('/programas')
}

export function Rutina() {
  const c = useColores()
  const e = useEstilos(c)
  const { id: idDeLaRuta = '' } = useLocalSearchParams<{ id: string }>()
  const id = Number(idDeLaRuta)

  const [rutina, setRutina] = useState<DatosRutina | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [orden, setOrden] = useState<HuecoDeRutina[]>([])
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [aviso, setAviso] = useState<AvisoDeBorrarRutina | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [falloNombre, setFalloNombre] = useState<string | null>(null)
  const [verOcultos, setVerOcultos] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [lectura, setLectura] = useState(0)

  // Al abrirla y al volver de uno de sus ejercicios, que se puede haber cambiado.
  useFocusEffect(
    useCallback(() => {
      let vigente = true
      api
        .rutina(id)
        .then((leida) => {
          if (!vigente) return
          setRutina(leida)
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
    }, [id, lectura]),
  )

  const hayCambios =
    editando &&
    !!rutina &&
    (nombre !== rutina.nombre ||
      orden.some((hueco, indice) => hueco.id !== visiblesEnOrden(rutina)[indice]?.id))

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
        <Cabecera titulo="" alVolver={volver} />
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!rutina) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const oculta = rutina.oculto_desde !== null
  const visibles = visiblesEnOrden(rutina)
  const ocultos = rutina.slots
    .filter((hueco) => hueco.oculto_desde !== null)
    .sort((uno, otro) => uno.orden - otro.orden)
  const abrir = (hueco: HuecoDeRutina) => () =>
    router.push({
      pathname: '/programas/rutinas/[id]/ejercicios/[hueco]',
      params: { id: String(id), hueco: String(hueco.id) },
    })

  async function cargar() {
    setRutina(await api.rutina(id))
  }

  function empezarAEditar() {
    setNombre(rutina!.nombre)
    setOrden(visibles)
    setFallo(null)
    setFalloNombre(null)
    setEditando(true)
  }

  function cancelar() {
    setEditando(false)
    setFallo(null)
    setFalloNombre(null)
  }

  function mover(desde: number, hasta: number) {
    setOrden((antes) => {
      const nuevo = [...antes]
      const [movido] = nuevo.splice(desde, 1)
      nuevo.splice(hasta, 0, movido)
      return nuevo
    })
  }

  /** *Guardar*: el nombre y el orden, de golpe. Si algo falla, no se guarda nada. */
  async function guardar() {
    const limpio = nombre.trim()
    if (!limpio) {
      setFalloNombre('Ponle un nombre.')
      return
    }
    setGuardando(true)
    setFallo(null)
    setFalloNombre(null)
    try {
      setRutina(
        await api.actualizarRutina(
          id,
          limpio,
          orden.map((hueco) => hueco.id),
        ),
      )
      setEditando(false)
    } catch (fallo) {
      // Se sigue editando, con lo que había. El nombre repetido va bajo el nombre.
      if (esDelCampo(fallo, 'nombre')) setFalloNombre(fallo.message)
      else setFallo(textoDelFallo(fallo))
    }
    setGuardando(false)
  }

  async function preguntarBorrar() {
    setFallo(null)
    try {
      setAviso(await api.avisoDeBorrarRutina(id))
      setPregunta('borrar')
    } catch (fallo) {
      setFallo(textoDelFallo(fallo))
    }
  }

  async function duplicar() {
    setGuardando(true)
    setFallo(null)
    try {
      const copia = await api.duplicarRutina(id)
      router.push({ pathname: '/programas/rutinas/[id]', params: { id: String(copia.id) } })
    } catch (fallo) {
      setFallo(textoDelFallo(fallo))
    } finally {
      setGuardando(false)
    }
  }

  const filas = (editando ? orden : visibles).map((hueco) =>
    fila(hueco, editando ? undefined : abrir(hueco)),
  )

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo={rutina.nombre}
        alVolver={volver}
        // Mientras se edita no se sale de la pantalla: o se guarda o se cancela.
        izquierda={
          editando ? { texto: 'Cancelar', alPulsar: cancelar, desactivado: guardando } : undefined
        }
        // Una rutina oculta no se edita: sin botón a la derecha.
        derecha={
          oculta
            ? undefined
            : {
                texto: editando ? 'Guardar' : 'Editar',
                alPulsar: () => (editando ? void guardar() : empezarAEditar()),
                desactivado: guardando,
              }
        }
      />

      <Desplazable contentContainerStyle={e.contenido} scrollEnabled={!arrastrando}>
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

        {oculta && (
          <View style={e.oculto}>
            <Text style={e.ocultoTitulo}>
              Oculta desde el {diaYMesConAnio(rutina.oculto_desde!)}
            </Text>
            <Text style={e.ocultoTexto}>No sale al elegir rutina ni al entrenar.</Text>
            <Text style={e.ocultoTexto}>
              Los días de tus programas que la tenían la conservan, como descanso.
            </Text>
          </View>
        )}

        {filas.length === 0 ? (
          <TextoCentrado style={e.recuadroVacio}>
            {oculta
              ? 'Todavía no tiene ejercicios.'
              : 'Todavía no tiene ejercicios.\nAñade el primero para empezar.'}
          </TextoCentrado>
        ) : (
          <ListaDeEjercicios
            filas={filas}
            alMover={editando ? mover : undefined}
            alArrastrar={setArrastrando}
          />
        )}

        {!editando && !oculta && (
          <Boton
            texto="Añadir ejercicio"
            alPulsar={() =>
              router.push({
                pathname: '/programas/rutinas/[id]/ejercicios/[hueco]',
                params: { id: String(id), hueco: 'nuevo' },
              })
            }
          />
        )}

        {!editando && (
          <Boton
            texto="Duplicar rutina"
            variante="secundaria"
            alPulsar={() => void duplicar()}
            desactivado={guardando}
          />
        )}

        {oculta && (
          <>
            <Boton
              texto="Mostrar rutina"
              variante="principal"
              alPulsar={() => setPregunta('mostrar')}
            />
            <Boton
              texto="Borrar rutina"
              variante="peligro"
              alPulsar={() => void preguntarBorrar()}
            />
          </>
        )}

        {!editando && ocultos.length > 0 && (
          <>
            <Ocultos
              cuantos={ocultos.length}
              singular="ejercicio oculto"
              plural="ejercicios ocultos"
              abierto={verOcultos}
              alAlternar={() => setVerOcultos(!verOcultos)}
            />
            {verOcultos && (
              <ListaDeEjercicios
                filas={ocultos.map((hueco) => fila(hueco, abrir(hueco), true))}
                sinNumero
                oculta
              />
            )}
          </>
        )}

        {editando && (
          <>
            <View style={e.separador} />
            <View style={e.acciones}>
              <Boton
                texto="Ocultar rutina"
                variante="secundaria"
                alPulsar={() => setPregunta('ocultar')}
                desactivado={guardando}
              />
              <Boton
                texto="Borrar rutina"
                variante="peligro"
                alPulsar={() => void preguntarBorrar()}
                desactivado={guardando}
              />
            </View>
            <TextoCentrado style={e.leyenda}>
              {/* Sueltos y no en un fragmento: `TextoCentrado` cuenta las frases por sus `\n`. */}
              {orden.length > 1 && 'Arrastra '}
              {orden.length > 1 && <IconoEnTexto nombre="asa" />}
              {orden.length > 1 && ' para cambiar el orden.\n'}
              Para ocultar o borrar un ejercicio, sal de <Text style={e.cursiva}>Editar</Text> y
              ábrelo.
            </TextoCentrado>
          </>
        )}
      </Desplazable>

      {descartando && (
        <Dialogo
          titulo="¿Descartar los cambios?"
          cuerpo="Lo que has cambiado en esta rutina no se guardará."
          confirmar="Descartar"
          cancelar="Seguir editando"
          peligro
          alConfirmar={async () => {
            setDescartando(false)
            cancelar()
            volver()
          }}
          alCancelar={() => setDescartando(false)}
        />
      )}
      {pregunta === 'ocultar' && (
        <Dialogo
          titulo={`¿Ocultar ${rutina.nombre}?`}
          cuerpo="Dejará de salir al elegir rutina y al entrenar. Los días de tus programas que la tienen la conservan, pero cuentan como descanso, salvo los que ya hayas entrenado. Si la vuelves a mostrar, los días en que estuvo oculta seguirán como descanso. Su historial sigue intacto."
          confirmar="Ocultar"
          alConfirmar={async () => {
            // Lo que hubiera en el borrador se descarta: lo oculto no se edita.
            await api.borrarRutina(id, 'ocultar')
            await cargar()
            setEditando(false)
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && (
        <Dialogo
          titulo={`¿Mostrar ${rutina.nombre}?`}
          cuerpo="Volverá a salir al elegir rutina y al entrenar, y los días de tus programas que la conservaban vuelven a tenerla."
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarRutina(id)
            await cargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && aviso && (
        <Dialogo
          titulo={`¿Borrar ${rutina.nombre}?`}
          cuerpo={loQueSePierdeDeLaRutina(aviso, oculta)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            // Siempre en definitivo: sin historial, ese modo borra directo igual.
            await api.borrarRutina(id, 'definitivo')
            setPregunta(null)
            // A la lista de programas, como la web, aunque se viniera de un programa.
            router.dismissTo('/programas')
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
    separador: { height: 1, marginVertical: 4, backgroundColor: c.borde },
    acciones: { gap: 12 },
    leyenda: { marginTop: 4, fontSize: 13, lineHeight: 19, color: c.textoTenue },
    cursiva: { fontStyle: 'italic' },
  })
}
