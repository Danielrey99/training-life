/**
 * H2 · Un día: cifras arriba y, por hueco, qué ejercicio se hizo, sus series, cómo le fue
 * comparado con la última vez y esa última vez en fichas. Puerto de
 * `web/src/paginas/historial/Dia.tsx` (la mejora está en `reglasDePantalla/mejora.ts`).
 *
 * Con *Editar*, la flecha de volver pasa a ser *Cancelar* y *Editar* pasa a ser *Guardar*. Lo
 * que se cambia (la fecha, las series, la nota) va a un borrador, y *Guardar* lo envía todo
 * de golpe; *Cancelar* lo descarta entero. Los formularios de una serie o de la nota dicen
 * *Añadir* o *Aplicar* y solo cambian el borrador. Las ediciones van de una en una.
 */
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Desplazable } from '../../componentes/Desplazable'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { NotaDeSesion } from '../../componentes/NotaDeSesion'
import type { Ejercicio, Entrenamiento, Rutina, Serie, SesionHistorial } from '../../logica/tipos'
import { api, esDelCampo, textoDelFallo } from '../../plataforma/api'
import { mejora, volumenDe } from '../../reglasDePantalla/mejora'
import { RADIO, RADIO_PEQUENO, useColores, type Colores } from '../../tema'
import { fechaCompleta, fechaEnFrase, fechaLarga, hoy, sumarDias } from '../../utiles/fechas'
import { kilos, kilosCorporales, serieLarga } from '../../utiles/medidas'
import { enUnidad, unidad } from '../../utiles/numeros'
import { seriesObjetivoDe } from '../../utiles/textos'
import type { DatosDeSerie } from '../sesion/FormularioDeSerie'
import { BloqueDelDia, type Abierta, type Bloque } from './BloqueDelDia'
import { HojaDeFecha } from './HojaDeFecha'

function contar(cuantos: number, singular: string, plural: string) {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

/**
 * «12.345»: un entero con los puntos de miles también con cuatro cifras. La web lo hace con
 * `toLocaleString('es-ES', { useGrouping: 'always' })`; aquí a mano, porque el motor de
 * JavaScript del teléfono no garantiza esa opción.
 */
function conMiles(entero: number) {
  return String(Math.abs(Math.round(entero))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** «20 kg × 9 reps · sentado» (o en lb). */
function carga(serie: Serie) {
  const texto = serieLarga(serie.ejercicio.tipo_registro, serie)
  return serie.variante ? `${texto} · ${serie.variante}` : texto
}

/**
 * Agrupa las series del día: una por hueco, en el orden de la rutina. Los huecos visibles que
 * ese día se quedaron sin series también entran, para poder añadírselas al editar. Pide a la
 * vez la última vez de cada bloque, mirando hacia atrás desde este día.
 */
async function bloquesDelDia(sesion: Entrenamiento, rutina: Rutina): Promise<Bloque[]> {
  const bloques: Omit<Bloque, 'ultima'>[] = []
  const huecos = [...rutina.slots].sort((uno, otro) => uno.orden - otro.orden)
  for (const hueco of huecos) {
    const series = sesion.series.filter((serie) => serie.slot_id === hueco.id)
    if (series.length > 0) {
      bloques.push({ clave: `hueco-${hueco.id}`, hueco, ejercicio: series[0].ejercicio, series })
    } else if (!hueco.oculto_desde) {
      const elegible = [
        hueco.ejercicio_principal,
        ...hueco.alternativas.map((alternativa) => alternativa.ejercicio),
      ].find((ejercicio) => !ejercicio.oculto_desde)
      if (elegible) bloques.push({ clave: `hueco-${hueco.id}`, hueco, ejercicio: elegible, series })
    }
  }
  const ultimas = await Promise.all(bloques.map((bloque) => ultimaVezDe(bloque.ejercicio, sesion)))
  return bloques.map((bloque, indice) => ({ ...bloque, ultima: ultimas[indice] }))
}

/** La última vez que se hizo un ejercicio antes de este día, sin contar la propia sesión. */
function ultimaVezDe(ejercicio: Ejercicio, sesion: Entrenamiento) {
  return (
    api
      .historialDeEjercicio(ejercicio.id, { hasta: sesion.fecha, limite: 2 })
      .then((lista) => lista.find((otra) => otra.entrenamiento_id !== sesion.id) ?? null)
      // Sin última vez el día se puede ver igual: no merece un error en pantalla.
      .catch(() => null)
  )
}

/** Al calendario del mes de ese día: el de detrás si se vino de él, o uno nuevo. */
function alCalendario(fecha: string) {
  if (router.canGoBack()) router.back()
  else router.replace({ pathname: '/historial', params: { mes: fecha.slice(0, 7) } })
}

/**
 * La flecha: a la pantalla de la que se vino, como en la web. Desde Entrenar (la última
 * sesión, o al terminar la de hoy) vuelve a Entrenar; al salir de la pestaña, su pila vuelve
 * sola al calendario (`popToTopOnBlur`). Si no, al calendario.
 */
function volverDelDia(fecha: string, desde: string | undefined) {
  if (desde === 'entrenar') router.navigate('/')
  else alCalendario(fecha)
}

export function Dia() {
  const c = useColores()
  const e = useEstilos(c)
  const { fecha = '', desde } = useLocalSearchParams<{ fecha: string; desde?: string }>()

  const [sesion, setSesion] = useState<Entrenamiento | null | undefined>(undefined)
  const [rutina, setRutina] = useState<Rutina | null>(null)
  const [bloques, setBloques] = useState<Bloque[]>([])
  // La sesión anterior de la misma rutina con volumen, para su cambio; nula si no hay.
  const [anterior, setAnterior] = useState<Entrenamiento | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [editando, setEditando] = useState(false)
  const [abierta, setAbierta] = useState<Abierta | null>(null)
  // El borrador del modo editar: nada se guarda hasta pulsar Guardar. Las series nuevas
  // llevan un id negativo hasta crearse.
  const [fechaNueva, setFechaNueva] = useState(fecha)
  const [eligiendoFecha, setEligiendoFecha] = useState(false)
  const [notasNuevas, setNotasNuevas] = useState<string | null>(null)
  const [seriesNuevas, setSeriesNuevas] = useState<Serie[]>([])
  const [guardando, setGuardando] = useState(false)
  const [aBorrar, setABorrar] = useState<{ serie: Serie; numero: number } | null>(null)
  // Elegir otro ejercicio en un hueco que ya tiene series: se pregunta, porque cambiar quita
  // las series que había (al guardar).
  const [aCambiar, setACambiar] = useState<{ bloque: Bloque; ejercicio: Ejercicio } | null>(null)
  // Los ejercicios elegidos en el borrador para huecos sin series, y la última vez de cada
  // uno, para compararlo con la suya y no con la del ejercicio que tenía el hueco.
  const [ejerciciosNuevos, setEjerciciosNuevos] = useState<Record<number, Ejercicio>>({})
  const [ultimasElegidas, setUltimasElegidas] = useState<Record<number, SesionHistorial | null>>({})
  const [borrandoDia, setBorrandoDia] = useState(false)
  // Guardar sin ninguna serie borra el día entero, y pregunta antes (decisión del autor).
  const [guardandoVacio, setGuardandoVacio] = useState(false)
  const [falloFecha, setFalloFecha] = useState<string | null>(null)
  const [falloGuardar, setFalloGuardar] = useState<string | null>(null)

  // El atrás de Android hace lo mismo que la flecha (decisión del autor). Mientras se edita,
  // con algo cambiado, pregunta antes de descartarlo, porque ese gesto se hace sin querer.
  const [descartando, setDescartando] = useState(false)
  const hayCambios =
    editando &&
    !!sesion &&
    (fechaNueva !== sesion.fecha ||
      notasNuevas !== sesion.notas ||
      seriesNuevas !== sesion.series ||
      Object.keys(ejerciciosNuevos).length > 0 ||
      abierta !== null)
  useEffect(() => {
    // Sin cambios y viniendo del calendario, el atrás normal ya vuelve a él.
    if (!hayCambios && desde !== 'entrenar') return
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      if (hayCambios) setDescartando(true)
      else volverDelDia(fecha, desde)
      return true
    })
    return () => suscripcion.remove()
  }, [hayCambios, desde, fecha])

  // Cada cambio guardado sube la versión, y eso vuelve a leer el día.
  const [version, setVersion] = useState(0)
  const recargar = () => setVersion((actual) => actual + 1)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const [leida] = await api.entrenamientos({ desde: fecha, hasta: fecha })
        // La rutina se pide aunque esté oculta: el día se tiene que poder ver.
        const suRutina = leida ? await api.rutina(leida.rutina_id) : null
        const [suyos, previas] = await Promise.all([
          leida && suRutina ? bloquesDelDia(leida, suRutina) : [],
          // Para comparar el volumen: la sesión anterior de la misma rutina que lo tuvo, con
          // margen por si alguna no tuvo ninguna serie de peso y repeticiones.
          leida
            ? api.entrenamientos({
                rutina_id: leida.rutina_id,
                hasta: sumarDias(fecha, -1),
                limite: 20,
              })
            : [],
        ])
        if (!vigente) return
        setSesion(leida ?? null)
        setRutina(suRutina)
        setBloques(suyos)
        setAnterior(previas.find((otra) => volumenDe(otra.series) > 0) ?? null)
        setError(null)
      } catch (fallo) {
        if (vigente) setError(fallo)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [fecha, version])

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <FalloAlCargar fallo={error} alReintentar={recargar} />
      </SafeAreaView>
    )
  }
  if (sesion === undefined || (sesion && !rutina)) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }
  if (sesion === null) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <View style={e.contenido}>
          <Text style={e.aviso}>El {fechaEnFrase(fecha, false)} no tiene ninguna sesión.</Text>
          <Boton texto="Volver al calendario" alPulsar={() => alCalendario(fecha)} />
        </View>
      </SafeAreaView>
    )
  }

  const dia = sesion
  const suRutina = rutina!
  const huecosVisibles = suRutina.slots.filter((hueco) => !hueco.oculto_desde)
  // Editando, todo se pinta desde el borrador.
  const series = editando ? seriesNuevas : dia.series
  const volumen = enUnidad(volumenDe(series))
  // Frente a la sesión anterior de la rutina: cuánto trabajo, no fuerza (eso lo dice el 1RM).
  const cambioVolumen = anterior ? Math.round(volumen - enUnidad(volumenDe(anterior.series))) : null
  const actuales = bloques.map((bloque) => {
    const suyas = series.filter((serie) => serie.slot_id === bloque.hueco.id)
    const ejercicio = suyas[0]?.ejercicio ?? ejerciciosNuevos[bloque.hueco.id] ?? bloque.ejercicio
    // Mientras llega la del elegido, ninguna: mejor sin comparar que con la de otro.
    const ultima =
      ejercicio.id === bloque.ejercicio.id ? bloque.ultima : (ultimasElegidas[ejercicio.id] ?? null)
    return { ...bloque, series: suyas, ejercicio, ultima }
  })
  // Lo que pide la rutina ese día. Uno oculto en la rutina después cuenta si se hizo.
  const objetivo = actuales
    .filter((bloque) => !bloque.hueco.oculto_desde || bloque.series.length > 0)
    .reduce((total, bloque) => total + seriesObjetivoDe(bloque.hueco, bloque.ejercicio.id), 0)
  const hayVolumen = series.some((serie) => serie.ejercicio.tipo_registro === 'peso_reps')
  const mejoras = actuales.map((bloque) =>
    mejora(bloque.ejercicio.tipo_registro, bloque.series, bloque.ultima),
  )
  const mejorados = mejoras.filter((una) => una?.clase === 'mejor').length
  // Con un formulario abierto, el resto se queda en gris.
  const hayAbierta = abierta !== null

  // Lo que pasa con lo que contaba la sesión si se borra el día: uno que aún no ha pasado
  // sigue pendiente, no sin hacer.
  const comoQueda = dia.cubre_fecha && dia.cubre_fecha >= hoy() ? 'pendiente' : 'sin hacer'
  const queda =
    dia.cubre_fecha === dia.fecha
      ? `, y este día quedará ${comoQueda}`
      : dia.cubre_fecha
        ? `, y el ${fechaEnFrase(dia.cubre_fecha, false)} quedará ${comoQueda}`
        : ''

  let cuenta: string | null = null
  if (dia.cubre_fecha && dia.cubre_fecha !== dia.fecha) {
    cuenta = `${dia.cubre_fecha < dia.fecha ? 'Recuperado' : 'Adelantado'} del ${fechaCompleta(dia.cubre_fecha)}`
  }

  function empezarAEditar() {
    setFechaNueva(dia.fecha)
    setNotasNuevas(dia.notas)
    setSeriesNuevas(dia.series)
    setEjerciciosNuevos({})
    setFalloFecha(null)
    setFalloGuardar(null)
    setAbierta(null)
    setEditando(true)
  }

  /** *Cancelar*: sale del modo editar y descarta el borrador entero. */
  function cancelar() {
    setFalloFecha(null)
    setEjerciciosNuevos({})
    setEditando(false)
  }

  /**
   * *Guardar*: envía el borrador entero de golpe, y la lógica lo guarda todo o nada. Si algo
   * no vale, el modo editar sigue abierto, y el aviso va bajo la fecha si es de ella.
   */
  async function guardar() {
    const fechaFinal = fechaNueva || dia.fecha
    setGuardando(true)
    setFalloFecha(null)
    setFalloGuardar(null)
    try {
      await api.actualizarEntrenamiento(dia.id, {
        fecha: fechaFinal,
        notas: notasNuevas,
        series: seriesNuevas.map((serie) => ({
          // Las nuevas llevan un id negativo en el borrador.
          id: serie.id > 0 ? serie.id : null,
          ejercicio_id: serie.ejercicio_id,
          slot_id: serie.slot_id,
          numero_serie: serie.numero_serie,
          peso: kilos(serie),
          repeticiones: serie.repeticiones,
          duracion_s: serie.duracion_s,
          distancia_m: serie.distancia_m,
          peso_corporal: kilosCorporales(serie),
          variante: serie.variante,
        })),
      })
    } catch (fallo) {
      if (esDelCampo(fallo, 'fecha')) setFalloFecha(fallo.message)
      else setFalloGuardar(textoDelFallo(fallo))
      setGuardando(false)
      return
    }
    setGuardando(false)
    setEjerciciosNuevos({})
    setEditando(false)
    if (fechaFinal !== dia.fecha) {
      router.replace({ pathname: '/historial/[fecha]', params: { fecha: fechaFinal } })
    } else recargar()
  }

  function cambiarSerie(serie: Serie, datos: DatosDeSerie) {
    setSeriesNuevas((previas) =>
      previas.map((otra) =>
        otra.id === serie.id
          ? {
              ...otra,
              peso: datos.peso === null ? null : String(datos.peso),
              repeticiones: datos.repeticiones,
              duracion_s: datos.duracion_s,
              distancia_m: datos.distancia_m,
              peso_corporal: datos.peso_corporal === null ? null : String(datos.peso_corporal),
              variante: datos.variante,
            }
          : otra,
      ),
    )
    setAbierta(null)
  }

  /** Elige el ejercicio de un hueco en el borrador y pide su última vez si no la tiene. */
  function elegirEjercicio(bloque: Bloque, ejercicio: Ejercicio) {
    setEjerciciosNuevos((previos) => ({ ...previos, [bloque.hueco.id]: ejercicio }))
    const original = bloques.find((otro) => otro.clave === bloque.clave)
    if (ejercicio.id === original?.ejercicio.id || ejercicio.id in ultimasElegidas) return
    void ultimaVezDe(ejercicio, dia).then((ultima) =>
      setUltimasElegidas((previas) => ({ ...previas, [ejercicio.id]: ultima })),
    )
  }

  /** Confirmado el cambio: se quitan del borrador las series del hueco y se elige el nuevo. */
  function cambiarDeEjercicio(bloque: Bloque, ejercicio: Ejercicio) {
    setSeriesNuevas((previas) => previas.filter((serie) => serie.slot_id !== bloque.hueco.id))
    elegirEjercicio(bloque, ejercicio)
    setACambiar(null)
  }

  function anadirSerie(bloque: Bloque, ejercicio: Ejercicio, numero: number, datos: DatosDeSerie) {
    setSeriesNuevas((previas) => [
      ...previas,
      {
        // Por debajo del más bajo y no por cuántas hay: tras borrar una, contarlas repetiría
        // el id de otra nueva.
        id: Math.min(0, ...previas.map((serie) => serie.id)) - 1,
        entrenamiento_id: dia.id,
        ejercicio_id: ejercicio.id,
        ejercicio,
        slot_id: bloque.hueco.id,
        numero_serie: numero,
        peso: datos.peso === null ? null : String(datos.peso),
        repeticiones: datos.repeticiones,
        duracion_s: datos.duracion_s,
        distancia_m: datos.distancia_m,
        peso_corporal: datos.peso_corporal === null ? null : String(datos.peso_corporal),
        variante: datos.variante,
        created_at: '',
        updated_at: '',
      },
    ])
    setAbierta(null)
  }

  const botonCabecera = (
    texto: string,
    alPulsar: () => void,
    desactivado: boolean,
    color: string,
  ) => (
    <Pressable
      accessibilityRole="button"
      onPress={alPulsar}
      disabled={desactivado}
      style={[e.cabeceraBoton, desactivado && { opacity: 0.35 }]}
    >
      <Text style={[e.cabeceraBotonTexto, { color }]}>{texto}</Text>
    </Pressable>
  )

  async function borrarYSalir() {
    await api.borrarEntrenamiento(dia.id)
    alCalendario(dia.fecha)
  }

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <View style={e.cabecera}>
        {editando ? (
          // Mientras se edita no se sale de la pantalla: o se guarda o se cancela.
          botonCabecera('Cancelar', cancelar, hayAbierta || guardando, c.textoTenue)
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            onPress={() => volverDelDia(fecha, desde)}
            style={e.volver}
          >
            <Icono nombre="volver" color={c.texto} />
          </Pressable>
        )}
        <View style={e.titulo}>
          <Text style={e.tituloTexto} accessibilityRole="header">
            {suRutina.nombre}
          </Text>
          <Text style={e.subtitulo}>{fechaLarga(dia.fecha)}</Text>
          {cuenta && <Text style={[e.subtitulo, { color: c.acento }]}>{cuenta}</Text>}
        </View>
        {botonCabecera(
          editando ? 'Guardar' : 'Editar',
          () => {
            if (!editando) empezarAEditar()
            else if (seriesNuevas.length === 0) setGuardandoVacio(true)
            else void guardar()
          },
          editando && (hayAbierta || guardando),
          c.acento,
        )}
      </View>

      <Desplazable contentContainerStyle={e.contenido}>
        {editando && (
          <View style={e.campo}>
            <Text style={e.campoEtiqueta}>Fecha</Text>
            {/* No el selector del sistema: la hoja enseña el mes con sus marcas. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Fecha, ${fechaLarga(fechaNueva)}`}
              disabled={hayAbierta}
              onPress={() => setEligiendoFecha(true)}
              style={[
                e.fechaBoton,
                { borderColor: falloFecha ? c.error : c.borde },
                hayAbierta && { opacity: 0.45 },
              ]}
            >
              <Text style={e.fechaTexto}>{fechaLarga(fechaNueva)}</Text>
              <Icono nombre="historial" color={c.textoTenue} pequeno />
            </Pressable>
            {falloFecha && <Text style={e.fallo}>{falloFecha}</Text>}
          </View>
        )}

        {falloGuardar && <Text style={e.fallo}>{falloGuardar}</Text>}

        <View style={e.cifras}>
          <View style={e.cifra}>
            <Text style={[e.cifraValor, { color: c.acento }]}>
              {series.length}
              {objetivo > 0 && <Text style={e.cifraPequena}> / {objetivo}</Text>}
            </Text>
            <Text style={e.cifraTexto}>series</Text>
          </View>
          {/* Sin volumen (un día solo de peso corporal, tiempo…), son dos cifras y no tres. */}
          {hayVolumen && (
            <View style={e.cifra}>
              <Text style={e.cifraValor}>
                {conMiles(volumen)}
                <Text style={e.cifraPequena}> {unidad()}</Text>
              </Text>
              <Text style={e.cifraTexto}>volumen</Text>
              {cambioVolumen !== null && (
                <Text
                  style={[e.cifraTexto, e.cifraCambio, cambioVolumen > 0 && { color: c.acento }]}
                >
                  {cambioVolumen > 0 ? '↑ +' : cambioVolumen < 0 ? '↓ −' : ''}
                  {cambioVolumen === 0 ? 'igual' : `${conMiles(cambioVolumen)} ${unidad()}`}
                </Text>
              )}
            </View>
          )}
          <View style={e.cifra}>
            <Text style={e.cifraValor}>{mejorados}</Text>
            <Text style={e.cifraTexto}>
              {mejorados === 1 ? 'ejercicio mejorado' : 'ejercicios mejorados'}
            </Text>
          </View>
        </View>

        {actuales.map((bloque, indice) => {
          // Un hueco que ese día se quedó sin series solo sale al editar.
          if (bloque.series.length === 0 && !editando) return null
          // La posición entre los huecos visibles; uno oculto no lleva número.
          const numero = huecosVisibles.indexOf(bloque.hueco) + 1
          return (
            <BloqueDelDia
              key={`${bloque.clave}-${editando}-${bloque.series.length === 0 ? bloque.ejercicio.id : ''}`}
              bloque={bloque}
              numero={numero}
              mejora={mejoras[indice]}
              sesion={dia}
              editando={editando}
              abierta={abierta}
              alAbrir={setAbierta}
              alCerrar={() => setAbierta(null)}
              alBorrarSerie={(serie, numeroSerie) => setABorrar({ serie, numero: numeroSerie })}
              alElegir={(ejercicio) => elegirEjercicio(bloque, ejercicio)}
              alPedirCambiar={(ejercicio) => setACambiar({ bloque, ejercicio })}
              alCambiarSerie={cambiarSerie}
              alAnadirSerie={(ejercicio, numeroSerie, datos) =>
                anadirSerie(bloque, ejercicio, numeroSerie, datos)
              }
            />
          )
        })}

        {series.length === 0 && !editando && (
          <Text style={e.aviso}>Este día no tiene ninguna serie apuntada.</Text>
        )}

        <NotaDeSesion
          nota={editando ? notasNuevas : dia.notas}
          editable={editando}
          enBorrador
          abierta={abierta?.tipo === 'nota'}
          alAbrir={() => setAbierta({ tipo: 'nota' })}
          alCerrar={() => setAbierta(null)}
          bloqueada={hayAbierta}
          alGuardar={async (nota) => setNotasNuevas(nota)}
        />

        {/* Una sesión de un día pasado sin terminar se estaba apuntando desde el calendario:
            aquí está su «Continuar», como el de Entrenar para la de hoy. */}
        {!editando && dia.terminada_en === null && (
          <Boton
            texto="Seguir apuntando"
            alPulsar={() =>
              router.navigate(
                { pathname: '/sesion/[id]', params: { id: String(dia.id) } },
                { withAnchor: true },
              )
            }
          />
        )}

        {editando && (
          <View style={e.borrar}>
            <Boton
              texto="Borrar este día"
              variante="peligro"
              alPulsar={() => setBorrandoDia(true)}
              desactivado={hayAbierta}
            />
          </View>
        )}

        {series.length > 0 && (
          // Una lista, un tipo de ejercicio por línea: va siempre a la izquierda.
          <View style={e.leyenda}>
            <Text style={e.leyendaTexto}>
              {[
                'La mejora, frente a la última vez con ese ejercicio:',
                '- Peso y repeticiones, el 1RM.',
                '- Peso corporal, la carga y luego las reps.',
                '- Tiempo, el peso y luego la duración.',
                '- Cardio, la distancia y luego el ritmo.',
              ].join('\n')}
            </Text>
            {anterior && hayVolumen && (
              <Text style={e.leyendaTexto}>
                El volumen solo cuenta peso y repeticiones, frente a la sesión anterior de esta
                rutina.
              </Text>
            )}
          </View>
        )}
      </Desplazable>

      {eligiendoFecha && (
        <HojaDeFecha
          fecha={fechaNueva}
          alElegir={(elegida) => {
            setFechaNueva(elegida)
            setFalloFecha(null)
            setEligiendoFecha(false)
          }}
          alCerrar={() => setEligiendoFecha(false)}
        />
      )}

      {descartando && (
        <Dialogo
          titulo="¿Descartar los cambios?"
          cuerpo="Lo que has cambiado en este día no se guardará."
          confirmar="Descartar"
          cancelar="Seguir editando"
          peligro
          alConfirmar={async () => {
            setDescartando(false)
            cancelar()
            volverDelDia(fecha, desde)
          }}
          alCancelar={() => setDescartando(false)}
        />
      )}

      {aBorrar && (
        <Dialogo
          titulo={`¿Borrar la serie ${aBorrar.numero}?`}
          cuerpo={carga(aBorrar.serie)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            setSeriesNuevas((previas) => previas.filter((otra) => otra.id !== aBorrar.serie.id))
            setABorrar(null)
          }}
          alCancelar={() => setABorrar(null)}
        />
      )}

      {aCambiar && (
        <Dialogo
          titulo={`¿Cambiar a ${aCambiar.ejercicio.nombre}?`}
          cuerpo={`${
            aCambiar.bloque.series.length === 1
              ? 'Se borrará la serie'
              : `Se borrarán las ${aCambiar.bloque.series.length} series`
          } de ${aCambiar.bloque.ejercicio.nombre} de este día al guardar.`}
          confirmar="Cambiar"
          peligro
          alConfirmar={async () => cambiarDeEjercicio(aCambiar.bloque, aCambiar.ejercicio)}
          alCancelar={() => setACambiar(null)}
        />
      )}

      {borrandoDia && (
        <Dialogo
          titulo="¿Borrar este día?"
          cuerpo={
            // El día ya está en la cabecera: solo se nombra el que cuenta si es otro.
            (dia.series.length === 0
              ? 'Se borrará la sesión, que no tiene ninguna serie'
              : `Se borrarán la sesión y ${dia.series.length === 1 ? 'su serie' : `sus ${contar(dia.series.length, 'serie', 'series')}`}`) +
            `${queda}.`
          }
          confirmar="Borrar"
          peligro
          alConfirmar={borrarYSalir}
          alCancelar={() => setBorrandoDia(false)}
        />
      )}

      {guardandoVacio && (
        <Dialogo
          titulo="¿Borrar este día?"
          cuerpo={`No queda ninguna serie, así que al guardar se borrará la sesión entera${queda}.`}
          confirmar="Borrar"
          peligro
          alConfirmar={borrarYSalir}
          alCancelar={() => setGuardandoVacio(false)}
        />
      )}
    </SafeAreaView>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 10 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue, padding: 16 },
    cabecera: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
    volver: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    cabeceraBoton: { minWidth: 44, height: 44, paddingHorizontal: 4, justifyContent: 'center' },
    cabeceraBotonTexto: { fontSize: 14, fontWeight: '600' },
    titulo: { flex: 1, alignItems: 'center', paddingVertical: 6 },
    tituloTexto: {
      fontSize: 20,
      fontWeight: '700',
      lineHeight: 24,
      color: c.texto,
      textAlign: 'center',
    },
    subtitulo: { fontSize: 13, color: c.textoTenue, textAlign: 'center' },
    campo: { gap: 4 },
    campoEtiqueta: { fontSize: 12.5, color: c.textoTenue },
    fechaBoton: {
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderRadius: RADIO_PEQUENO,
      backgroundColor: c.fondo,
    },
    fechaTexto: { fontSize: 15, color: c.texto },
    fallo: { fontSize: 13, lineHeight: 19, color: c.error },
    cifras: { flexDirection: 'row', gap: 8, marginTop: 4 },
    cifra: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    cifraValor: { fontSize: 24, fontWeight: '700', lineHeight: 29, color: c.texto },
    cifraPequena: { fontSize: 14, fontWeight: '500', color: c.textoTenue },
    cifraTexto: { fontSize: 12.5, color: c.textoTenue, textAlign: 'center' },
    cifraCambio: { marginTop: 2 },
    borrar: { marginTop: 2 },
    // A la izquierda, en un bloque estrecho y centrado, como un texto explicativo que no
    // cabe en una línea.
    leyenda: { marginTop: 6, gap: 8, width: '100%', maxWidth: 320, alignSelf: 'center' },
    leyendaTexto: { fontSize: 12.5, lineHeight: 18, color: c.textoTenue },
  })
}
