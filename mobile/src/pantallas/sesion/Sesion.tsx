/**
 * E2 · La sesión: se registra serie a serie, hueco a hueco. Puerto de
 * `web/src/paginas/sesion/Sesion.tsx`: mismo estado, mismas llamadas y mismos textos.
 *
 * Cada serie se guarda en cuanto se apunta, en vez de acumularlas para el final: una sesión
 * dura más de una hora, y cerrar la app sin querer no puede llevarse el entrenamiento. Se
 * puede salir a otras pantallas o cerrar la app, y todo sigue ahí hasta Terminar o Cancelar.
 *
 * Como en la web: terminar lleva al día en el historial; cancelar, a Entrenar o, si la sesión
 * es de un día pasado, a su mes del calendario; y la flecha, a la pantalla de la que cuelga.
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
import { Ocultos } from '../../componentes/Ocultos'
import type { Ejercicio, Entrenamiento, HuecoDeRutina, Rutina, Serie } from '../../logica/tipos'
import { api, ErrorDeApi } from '../../plataforma/api'
import { useColores } from '../../tema'
import { fechaCompleta, fechaTitulo, hoy } from '../../utiles/fechas'
import { serieLarga } from '../../utiles/medidas'
import { seriesObjetivoDe } from '../../utiles/textos'
import { cuentaDeEjercicios, cuentaDeSeries, ejercicioInicial } from '../../reglasDePantalla/sesion'
import { BloqueDeHueco, type SerieAGuardar } from './BloqueDeHueco'

/** Vuelve a Entrenar: la pantalla de la que cuelga la sesión de hoy. */
function aEntrenar() {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

/** Al calendario, en el mes de esa fecha. */
function alMes(fecha: string) {
  router.navigate({ pathname: '/historial', params: { mes: fecha.slice(0, 7) } })
}

/**
 * Al día del historial de esa fecha. `desdeEntrenar`, si la sesión era la de hoy: la flecha
 * del día vuelve entonces a Entrenar, como en la web, que vuelve a la pantalla de antes.
 */
function alDia(fecha: string, desdeEntrenar = false) {
  router.navigate(
    {
      pathname: '/historial/[fecha]',
      params: desdeEntrenar ? { fecha, desde: 'entrenar' } : { fecha },
    },
    { withAnchor: true },
  )
}

export function Sesion() {
  const c = useColores()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [sesion, setSesion] = useState<Entrenamiento | null>(null)
  const [rutina, setRutina] = useState<Rutina | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [lectura, setLectura] = useState(0)

  const [abierto, setAbierto] = useState<number | null>(null)
  const [elegidos, setElegidos] = useState<Record<number, Ejercicio | null>>({})
  const [aBorrar, setABorrar] = useState<{ serie: Serie; numero: number } | null>(null)
  // Elegir otro ejercicio en un hueco que ya tiene series: se pregunta, porque en cada hueco
  // se hace un solo ejercicio por sesión y cambiar borra las series que había. `de` es el
  // ejercicio de esas series, guardado al preguntar.
  const [aCambiar, setACambiar] = useState<{
    hueco: HuecoDeRutina
    ejercicio: Ejercicio
    de: string
  } | null>(null)
  const [confirmando, setConfirmando] = useState<'terminar' | 'cancelar' | null>(null)
  // Las ediciones van de una en una: una serie o la nota, y mientras tanto el resto se
  // queda en gris.
  const [editandoSerie, setEditandoSerie] = useState<number | null>(null)
  const [notaAbierta, setNotaAbierta] = useState(false)
  const [verOcultos, setVerOcultos] = useState(false)
  const hayAbierta = editandoSerie !== null || notaAbierta

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const leida = await api.entrenamiento(Number(id))
        // La rutina se pide aunque esté oculta: la sesión se tiene que poder terminar.
        const suRutina = await api.rutina(leida.rutina_id)
        if (!vigente) return

        const huecos = suRutina.slots
        const iniciales: Record<number, Ejercicio | null> = {}
        for (const hueco of huecos) iniciales[hueco.id] = ejercicioInicial(hueco, leida.series)

        // Se abre el primer hueco sin terminar: es por donde se va.
        const pendiente = huecos
          .filter((hueco) => !hueco.oculto_desde)
          .sort((uno, otro) => uno.orden - otro.orden)
          .find(
            (hueco) =>
              leida.series.filter((s) => s.slot_id === hueco.id).length <
              seriesObjetivoDe(hueco, iniciales[hueco.id]?.id),
          )

        setSesion(leida)
        setRutina(suRutina)
        setElegidos(iniciales)
        setAbierto(pendiente?.id ?? null)
        setError(null)
      } catch (fallo) {
        if (!vigente) return
        // Una sesión que ya no existe (se canceló) no puede dejar la pantalla en blanco.
        if (fallo instanceof ErrorDeApi && fallo.estado === 404) router.replace('/')
        else setError(fallo)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [id, lectura])

  // El atrás de Android, en una sesión de un día pasado, hace lo mismo que la flecha (decisión
  // del autor): al día o al mes, y no a Entrenar, que es la pila en la que vive la sesión.
  const fechaPasada = sesion && sesion.fecha < hoy() ? sesion.fecha : null
  const conSeries = (sesion?.series.length ?? 0) > 0
  useEffect(() => {
    if (!fechaPasada) return
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      if (conSeries) alDia(fechaPasada)
      else alMes(fechaPasada)
      return true
    })
    return () => suscripcion.remove()
  }, [fechaPasada, conSeries])

  const fondo = { flex: 1, backgroundColor: c.fondo }
  if (error) {
    return (
      <SafeAreaView edges={['top']} style={fondo}>
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!sesion || !rutina) {
    return (
      <SafeAreaView edges={['top']} style={fondo}>
        <Text style={[estilos.cargando, { color: c.textoTenue }]}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const activa = sesion

  // Un hueco oculto no se ofrece, pero si ya tiene series de esta sesión se sigue
  // enseñando: si no, desaparecerían sin explicación.
  const huecos = rutina.slots
    .filter(
      (hueco) => !hueco.oculto_desde || activa.series.some((serie) => serie.slot_id === hueco.id),
    )
    .sort((uno, otro) => uno.orden - otro.orden)

  const deHueco = (hueco: HuecoDeRutina) =>
    activa.series
      .filter((serie) => serie.slot_id === hueco.id)
      .sort((una, otra) => una.numero_serie - otra.numero_serie)
  const visibles = huecos.filter((hueco) => !hueco.oculto_desde)
  const ocultosConSeries = huecos.filter((hueco) => hueco.oculto_desde)
  const hechos = visibles.filter((hueco) => deHueco(hueco).length > 0).length
  const objetivo = visibles.reduce(
    (suma, hueco) => suma + seriesObjetivoDe(hueco, elegidos[hueco.id]?.id),
    0,
  )
  const textoDeSeries = cuentaDeSeries(activa.series.length, objetivo)
  const textoDeEjercicios = cuentaDeEjercicios(hechos, visibles.length)

  // La pantalla de la que cuelga, para la flecha y para cancelar. Una sesión de un día pasado
  // se apunta desde el calendario: la flecha va a su día (o al mes, si aún no tiene series y
  // no hay día que ver), y cancelarla, al mes.
  const deOtroDia = activa.fecha < hoy()
  const volver = () =>
    !deOtroDia ? aEntrenar() : activa.series.length > 0 ? alDia(activa.fecha) : alMes(activa.fecha)
  const alCancelar = () => (deOtroDia ? alMes(activa.fecha) : aEntrenar())
  const cifras = `${textoDeSeries} · ${textoDeEjercicios}`

  async function guardar(huecoId: number, datos: SerieAGuardar, serieId?: number) {
    const cuerpo = { ...datos, slot_id: huecoId }
    const guardada = serieId
      ? await api.actualizarSerie(activa.id, serieId, cuerpo)
      : await api.crearSerie(activa.id, cuerpo)
    // Sobre el estado más reciente y no sobre `activa`: quien llama viene de un await.
    setSesion(
      (previa) =>
        previa && {
          ...previa,
          series: serieId
            ? previa.series.map((serie) => (serie.id === serieId ? guardada : serie))
            : [...previa.series, guardada],
        },
    )
  }

  async function borrar(serie: Serie) {
    await api.borrarSerie(activa.id, serie.id)
    setSesion(
      (previa) => previa && { ...previa, series: previa.series.filter((s) => s.id !== serie.id) },
    )
    setABorrar(null)
  }

  function elegirEjercicio(hueco: HuecoDeRutina, ejercicio: Ejercicio) {
    setElegidos((previos) => ({ ...previos, [hueco.id]: ejercicio }))
  }

  function pedirElegir(hueco: HuecoDeRutina, ejercicio: Ejercicio) {
    if (elegidos[hueco.id]?.id === ejercicio.id) return
    // Sin series no hay nada que perder: se cambia sin preguntar.
    if (deHueco(hueco).length === 0) elegirEjercicio(hueco, ejercicio)
    else setACambiar({ hueco, ejercicio, de: deHueco(hueco)[0].ejercicio.nombre })
  }

  /**
   * Borra de una vez las series que había en el hueco y pasa al ejercicio elegido. Si falla,
   * no se ha borrado ninguna: el diálogo lo dice y todo sigue como estaba.
   */
  async function cambiarDeEjercicio(hueco: HuecoDeRutina, ejercicio: Ejercicio) {
    await api.borrarSeriesDelHueco(activa.id, hueco.id)
    setSesion(
      (previa) =>
        previa && { ...previa, series: previa.series.filter((s) => s.slot_id !== hueco.id) },
    )
    elegirEjercicio(hueco, ejercicio)
    setACambiar(null)
  }

  function bloque(hueco: HuecoDeRutina) {
    const clave = hueco.id
    const elegido = elegidos[clave] ?? null
    // La posición entre los visibles: uno oculto que ya tiene series sale sin número.
    const posicion = visibles.indexOf(hueco) + 1
    const nombre = elegido?.nombre ?? hueco.ejercicio_principal.nombre
    const titulo = posicion > 0 ? `${posicion} · ${nombre}` : nombre
    return (
      <BloqueDeHueco
        key={clave}
        hueco={hueco}
        titulo={titulo}
        series={deHueco(hueco)}
        elegido={elegido}
        elegir={(ejercicio) => pedirElegir(hueco, ejercicio)}
        abierto={abierto === clave}
        abrir={() => setAbierto(clave)}
        editandoId={editandoSerie}
        alEditar={setEditandoSerie}
        bloqueado={hayAbierta}
        sesion={activa}
        guardar={(datos, serieId) => guardar(hueco.id, datos, serieId)}
        pedirBorrar={(serie, numero) => setABorrar({ serie, numero })}
      />
    )
  }

  const tenue = { color: c.textoTenue }
  return (
    <SafeAreaView edges={['top']} style={fondo}>
      <View style={estilos.cabecera}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={volver}
          style={estilos.volver}
        >
          <Icono nombre="volver" color={c.texto} />
        </Pressable>
        <View style={estilos.titulo}>
          <Text style={[estilos.tituloTexto, { color: c.texto }]} accessibilityRole="header">
            {rutina.nombre}
          </Text>
          {/* La fecha de un día pasado es larga y no cabe con las cifras: va en su línea. */}
          {deOtroDia ? (
            <>
              <Text style={[estilos.subtitulo, tenue]}>{fechaTitulo(activa.fecha)}</Text>
              <Text style={[estilos.subtitulo, tenue]}>{cifras}</Text>
            </>
          ) : (
            <Text style={[estilos.subtitulo, tenue]}>
              {fechaTitulo(activa.fecha)} · {cifras}
            </Text>
          )}
          {/* Si la sesión cuenta otro día, que se note: es «el Push del lunes». */}
          {activa.cubre_fecha && activa.cubre_fecha !== activa.fecha && (
            <Text style={[estilos.subtitulo, { color: c.acento }]}>
              {activa.cubre_fecha < activa.fecha ? 'Recuperado' : 'Adelantado'} del{' '}
              {fechaCompleta(activa.cubre_fecha)}
            </Text>
          )}
        </View>
        {/* Del ancho de la flecha de volver, para que el título quede centrado. */}
        <View style={estilos.volver} />
      </View>

      <Desplazable contentContainerStyle={estilos.contenido}>
        <View style={estilos.huecos}>{visibles.map((hueco) => bloque(hueco))}</View>

        {/* Los ocultos en la rutina con series de hoy, al final y plegados. */}
        <Ocultos
          cuantos={ocultosConSeries.length}
          singular="ejercicio oculto en la rutina"
          plural="ejercicios ocultos en la rutina"
          abierto={verOcultos}
          alAlternar={() => setVerOcultos(!verOcultos)}
        />
        {verOcultos && ocultosConSeries.length > 0 && (
          <View style={estilos.huecos}>{ocultosConSeries.map((hueco) => bloque(hueco))}</View>
        )}

        {/* La nota se puede escribir en cualquier momento, no solo al terminar. */}
        <NotaDeSesion
          nota={activa.notas}
          editable
          abierta={notaAbierta}
          alAbrir={() => setNotaAbierta(true)}
          alCerrar={() => setNotaAbierta(false)}
          bloqueada={hayAbierta}
          alGuardar={async (nota) => {
            const guardada = await api.actualizarEntrenamiento(activa.id, {
              fecha: activa.fecha,
              notas: nota,
            })
            setSesion(guardada)
          }}
        />

        {/* Una sesión terminada se corrige desde el historial: aquí no se termina ni se cancela. */}
        {activa.terminada_en === null && (
          <View style={estilos.pie}>
            <Boton
              texto="Terminar sesión"
              alPulsar={() => setConfirmando('terminar')}
              desactivado={hayAbierta}
            />
            <Boton
              texto="Cancelar sesión"
              variante="peligro"
              alPulsar={() => setConfirmando('cancelar')}
              desactivado={hayAbierta}
            />
          </View>
        )}
      </Desplazable>

      {aBorrar && (
        <Dialogo
          titulo={`¿Borrar la serie ${aBorrar.numero}?`}
          cuerpo={`${serieLarga(aBorrar.serie.ejercicio.tipo_registro, aBorrar.serie)}${
            aBorrar.serie.variante ? ` · ${aBorrar.serie.variante}` : ''
          }`}
          confirmar="Borrar"
          peligro
          alConfirmar={() => borrar(aBorrar.serie)}
          alCancelar={() => setABorrar(null)}
        />
      )}

      {aCambiar && (
        <Dialogo
          titulo={`¿Cambiar a ${aCambiar.ejercicio.nombre}?`}
          cuerpo={(() => {
            const series = deHueco(aCambiar.hueco)
            const cuantas =
              series.length === 1
                ? 'Se borrará la serie'
                : `Se borrarán las ${series.length} series`
            return `${cuantas} de ${aCambiar.de} de ${deOtroDia ? 'este día' : 'hoy'}.`
          })()}
          confirmar="Cambiar"
          peligro
          alConfirmar={() => cambiarDeEjercicio(aCambiar.hueco, aCambiar.ejercicio)}
          alCancelar={() => setACambiar(null)}
        />
      )}

      {confirmando === 'terminar' && activa.series.length === 0 && (
        // Una sesión sin series no se hizo: se cancela en vez de quedar como un día vacío en
        // el historial, y el diálogo lo avisa (decisión del autor).
        <Dialogo
          titulo="¿Terminar la sesión?"
          cuerpo="No has apuntado ninguna serie, así que la sesión se cancelará, como si no la hubieras empezado."
          confirmar="Terminar"
          alConfirmar={async () => {
            await api.borrarEntrenamiento(activa.id)
            setConfirmando(null)
            alCancelar()
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}

      {confirmando === 'terminar' && activa.series.length > 0 && (
        <Dialogo
          titulo="¿Terminar la sesión?"
          cuerpo={`Llevas ${textoDeSeries} en ${textoDeEjercicios}. Podrás revisarla y corregirla después en la pestaña Historial.`}
          confirmar="Terminar"
          alConfirmar={async () => {
            await api.terminarEntrenamiento(activa.id)
            setConfirmando(null)
            alDia(activa.fecha, !deOtroDia)
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}

      {confirmando === 'cancelar' && (
        <Dialogo
          titulo="¿Cancelar la sesión?"
          cuerpo={
            activa.series.length === 0
              ? 'Se borrará la sesión, como si no la hubieras empezado.'
              : `${
                  activa.series.length === 1
                    ? 'Se borrará la serie'
                    : `Se borrarán las ${activa.series.length} series`
                } que llevas, como si no la hubieras empezado.`
          }
          confirmar="Cancelar sesión"
          // No «Cancelar»: junto a «Cancelar sesión» no se sabría cuál cancela qué.
          cancelar="Seguir"
          peligro
          alConfirmar={async () => {
            await api.borrarEntrenamiento(activa.id)
            setConfirmando(null)
            alCancelar()
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  cargando: { fontSize: 14, padding: 16 },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  volver: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titulo: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tituloTexto: { fontSize: 20, fontWeight: '700', lineHeight: 24, textAlign: 'center' },
  subtitulo: { fontSize: 13, textAlign: 'center' },
  contenido: { padding: 16, paddingTop: 8, gap: 12 },
  huecos: { gap: 10 },
  pie: { gap: 12, marginTop: 6 },
})
