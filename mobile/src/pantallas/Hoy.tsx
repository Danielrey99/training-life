/**
 * E1 · Hoy: la pantalla de entrada. Qué toca hoy, la semana, lo que queda por recuperar,
 * la última sesión y qué más se puede entrenar hoy. Puerto de `web/src/paginas/hoy/Hoy.tsx`:
 * mismo estado, mismas llamadas y mismos textos.
 *
 * Todo sale de una sola llamada (`api.hoy()`): qué día cuenta cada sesión, qué se puede
 * recuperar y qué se ofrece lo decide la lógica. Esta pantalla solo lo pinta, y al pulsar un
 * botón manda qué día del plan va a contar la sesión (`cubre_fecha`).
 */
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../componentes/Boton'
import { Dialogo } from '../componentes/Dialogo'
import { FalloAlCargar } from '../componentes/FalloAlCargar'
import { Icono } from '../componentes/Icono'
import { MarcaDelDia } from '../componentes/MarcaDelDia'
import { enMicrosegundos } from '../logica/reglas/instantes'
import type {
  Entrenamiento,
  Hoy as ResumenDeHoy,
  Ofrecida,
  Programa,
  Recuperable,
  RutinaMinima,
} from '../logica/tipos'
import { api } from '../plataforma/api'
import { RADIO, useColores, type Colores } from '../tema'
import { conArticulo, fechaEnFrase, fechaLarga, nombreDelDia, sumarDias } from '../utiles/fechas'

const INICIALES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

// Los rótulos de la lista de abajo, según qué ofrece. Intercambiar y adelantar ofrecen lo
// mismo (los días de esta semana que aún no se han hecho) y se llaman igual.
const TITULO_DE_LA_LISTA: Record<Ofrecida['accion'], string> = {
  intercambiar: 'Lo que queda esta semana',
  adelantar: 'Lo que queda esta semana',
  sin_contar: 'Entrenar una rutina',
}

function contar(cuantos: number, singular: string, plural: string) {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

function mayuscula(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** «18:05», en la hora del teléfono. */
function hora(instante: string) {
  const fecha = new Date(Number(enMicrosegundos(instante) / 1000n))
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
}

type Confirmacion = {
  titulo: string
  cuerpo: string
  confirmar: string
  cancelar?: string
  alConfirmar: () => Promise<void>
}

export function Hoy() {
  const c = useColores()
  const e = useEstilos(c)
  const [resumen, setResumen] = useState<ResumenDeHoy | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [enCurso, setEnCurso] = useState<Entrenamiento | null>(null)
  const [sinTerminar, setSinTerminar] = useState<Entrenamiento[]>([])
  const [error, setError] = useState<unknown>(null)
  const [confirmando, setConfirmando] = useState<Confirmacion | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Cada vez que cambia, se vuelve a leer todo (al volver a la pantalla o a la app).
  const [lectura, setLectura] = useState(0)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const [leido, programas, aMedias] = await Promise.all([
          api.hoy(),
          api.programas(),
          api.entrenamientos({ sin_terminar: true }),
        ])
        // De la sesión a medias hacen falta la hora y las series, que el resumen no trae.
        const abierta = leido.sesion?.en_curso
          ? await api.entrenamiento(leido.sesion.entrenamiento_id)
          : null
        if (!vigente) return
        setResumen(leido)
        setPrograma(programas.find((uno) => uno.activo) ?? null)
        setEnCurso(abierta)
        setSinTerminar(aMedias)
        setError(null)
      } catch (fallo) {
        if (vigente) setError(fallo)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [lectura])

  // Al volver a esta pantalla (de la sesión, de otra pestaña) se lee de nuevo: en la web la
  // pantalla se vuelve a montar; aquí se queda montada debajo.
  useFocusEffect(
    useCallback(() => {
      setLectura((n) => n + 1)
    }, []),
  )

  // Con la app abierta de un día para otro, lo que se ve ya no es lo de hoy: al volver a la
  // app se lee de nuevo (en la web, `visibilitychange`).
  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') setLectura((n) => n + 1)
    })
    return () => suscripcion.remove()
  }, [])

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!resumen) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const hoy = resumen.fecha
  const dia = resumen.semana.find((uno) => uno.fecha === hoy)!
  const rutinaDeHoy = dia.descanso ? null : dia.rutina

  /** «5 ejercicios · última vez el miércoles 2». */
  function detalle(rutina: RutinaMinima) {
    const datos = resumen!.rutinas.find((una) => una.id === rutina.id)
    if (!datos) return ''
    const cuando = datos.ultima_vez ? `última vez ${conArticulo(datos.ultima_vez)}` : 'nunca hecha'
    return `${contar(datos.ejercicios, 'ejercicio', 'ejercicios')} · ${cuando}`
  }

  /** El nombre para una sesión sin terminar; una rutina oculta no está en el resumen. */
  function nombreDeRutina(rutinaId: number) {
    return resumen!.rutinas.find((una) => una.id === rutinaId)?.nombre ?? 'Sesión'
  }

  function ejercicios(rutina: RutinaMinima) {
    const datos = resumen!.rutinas.find((una) => una.id === rutina.id)
    return datos ? contar(datos.ejercicios, 'ejercicio', 'ejercicios') : ''
  }

  function abrirSesion(id: number) {
    router.push({ pathname: '/sesion/[id]', params: { id: String(id) } })
  }

  /** Crea la sesión que cuenta `cubre` (o ninguno) y abre E2. */
  async function empezar(rutinaId: number, cubre: string | null, intercambiarCon?: string) {
    // Por si la pantalla se quedó abierta pasada la medianoche: si ya es otro día, no se
    // crea nada con la fecha vieja; se lee de nuevo y se avisa.
    if ((await api.hoy()).fecha !== hoy) {
      setAviso('Ha empezado otro día. Esto es lo que toca ahora.')
      setConfirmando(null)
      setLectura((n) => n + 1)
      return
    }
    setAviso(null)
    const creada = await api.crearEntrenamiento({
      rutina_id: rutinaId,
      fecha: hoy,
      notas: null,
      cubre_fecha: cubre,
      intercambiar_con: intercambiarCon ?? null,
    })
    setConfirmando(null)
    abrirSesion(creada.id)
  }

  function pedirEmpezar(rutina: RutinaMinima, cubre: string | null) {
    setConfirmando({
      titulo: `¿Empezar ${rutina.nombre}?`,
      cuerpo: 'Podrás cancelarla desde la propia sesión.',
      confirmar: 'Empezar',
      alConfirmar: () => empezar(rutina.id, cubre),
    })
  }

  function pedirRecuperar(recuperable: Recuperable) {
    const { rutina, fecha } = recuperable
    const pierdeHoy = resumen!.situacion === 'entrenamiento' && rutinaDeHoy
    setConfirmando(
      pierdeHoy
        ? {
            titulo: `¿Recuperar hoy el ${rutina.nombre} del ${nombreDelDia(fecha)}?`,
            cuerpo:
              `Solo se hace una rutina al día. El ${rutinaDeHoy.nombre} de hoy quedará pendiente, ` +
              `y podrás recuperarlo hasta ${conArticulo(sumarDias(hoy, 6))}.`,
            confirmar: 'Recuperar',
            alConfirmar: () => empezar(rutina.id, fecha),
          }
        : {
            titulo: `¿Recuperar hoy el ${rutina.nombre} del ${nombreDelDia(fecha)}?`,
            cuerpo: `Entrenas hoy la rutina del ${fechaEnFrase(fecha, false)}.`,
            confirmar: 'Recuperar',
            alConfirmar: () => empezar(rutina.id, fecha),
          },
    )
  }

  function pedirOfrecida(ofrecida: Ofrecida) {
    const { rutina, fecha } = ofrecida
    if (ofrecida.accion === 'sin_contar' || fecha === null) {
      pedirEmpezar(rutina, null)
    } else if (ofrecida.accion === 'adelantar') {
      setConfirmando({
        titulo: `¿Adelantar el ${rutina.nombre} del ${nombreDelDia(fecha)}?`,
        cuerpo: `Entrenas hoy la rutina del ${fechaEnFrase(fecha, false)}, y ese día queda libre.`,
        confirmar: 'Adelantar',
        alConfirmar: () => empezar(rutina.id, fecha),
      })
    } else {
      // Intercambiar cambia el plan de los dos días y empieza la sesión de hoy, todo de una
      // vez: si algo falla, no deja los días cambiados.
      setConfirmando({
        titulo: `¿Intercambiar con el ${nombreDelDia(fecha)}?`,
        cuerpo: `Hoy harías ${rutina.nombre} y el ${nombreDelDia(fecha)} pasaría a ser ${rutinaDeHoy?.nombre}.`,
        confirmar: 'Intercambiar',
        alConfirmar: () => empezar(rutina.id, hoy, fecha),
      })
    }
  }

  const listaDeAbajo = resumen.ofrecidas

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <View style={e.cabecera}>
          <Text style={e.cabeceraFecha}>{fechaLarga(hoy)}</Text>
          <Text style={e.cabeceraTitulo} accessibilityRole="header">
            Hoy
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajustes"
            onPress={() => router.push('/ajustes')}
            style={e.engranaje}
          >
            <Icono nombre="ajustes" color={c.textoTenue} />
          </Pressable>
        </View>

        {aviso && (
          <Text style={e.avisoEnLinea} accessibilityLiveRegion="polite">
            {aviso}
          </Text>
        )}

        <View style={e.tira}>
          {resumen.semana.map((uno, indice) => {
            const esHoy = uno.fecha === hoy
            return (
              <View key={uno.fecha} style={[e.tiraDia, esHoy && e.tiraHoy]}>
                <Text style={[e.tiraLetra, esHoy && e.tiraLetraHoy]}>{INICIALES[indice]}</Text>
                <MarcaDelDia dia={uno} diasDelPrograma={programa?.dias} />
              </View>
            )
          })}
        </View>

        <Tarjeta
          resumen={resumen}
          programa={programa}
          enCurso={enCurso}
          detalle={detalle}
          ejercicios={ejercicios}
          alEmpezar={() => rutinaDeHoy && pedirEmpezar(rutinaDeHoy, hoy)}
          alContinuar={() => abrirSesion(resumen.sesion!.entrenamiento_id)}
        />

        {/* Una sesión de un día pasado que se dejó a medias cuenta como hecha, pero quizá se
            olvidó; una vacía no cuenta, pero quizá se abrió para apuntar ese día y se quedó
            ahí. Las dos se avisan aquí hasta que se terminen o se cancelen. */}
        {sinTerminar.length > 0 && (
          <Seccion titulo="Sin terminar">
            {sinTerminar.map((sesion) => (
              <Fila key={sesion.id} alPulsar={() => abrirSesion(sesion.id)}>
                {/* «Rutina · día», como las demás listas, y el día siempre escrito. */}
                <View style={e.filaTitulo}>
                  <Text style={e.filaFuerte}>
                    {nombreDeRutina(sesion.rutina_id)} · {fechaEnFrase(sesion.fecha, false)}
                  </Text>
                  {sesion.series.length === 0 && <Text style={e.etiquetaChica}>vacía</Text>}
                </View>
                <Text style={e.filaTexto}>
                  {sesion.series.length === 0
                    ? 'apunta las series o cancélala'
                    : `${contar(sesion.series.length, 'serie', 'series')} · termínala o cancélala`}
                </Text>
              </Fila>
            ))}
          </Seccion>
        )}

        {resumen.por_recuperar.length > 0 && (
          <Seccion titulo="Por recuperar">
            <View style={e.recuperables}>
              {resumen.por_recuperar.map((recuperable, indice) => (
                <FilaRecuperable
                  key={recuperable.fecha}
                  recuperable={recuperable}
                  hoy={hoy}
                  primera={indice === 0}
                  ejercicios={ejercicios(recuperable.rutina)}
                  alRecuperar={() => pedirRecuperar(recuperable)}
                />
              ))}
            </View>
          </Seccion>
        )}

        {resumen.ultima_sesion && (
          <Seccion titulo="Última sesión hecha">
            <UltimaSesion ultima={resumen.ultima_sesion} />
          </Seccion>
        )}

        {listaDeAbajo.length > 0 && (
          <Seccion titulo={TITULO_DE_LA_LISTA[listaDeAbajo[0].accion]}>
            {listaDeAbajo.map((ofrecida) => (
              // Hoy ya se entrenó: la fila es solo un recordatorio, sin flecha ni nada que
              // pulsar (como los recuperables sin botón).
              <Fila
                key={`${ofrecida.rutina.id}-${ofrecida.fecha}`}
                alPulsar={ofrecida.se_puede_hoy ? () => pedirOfrecida(ofrecida) : undefined}
              >
                {/* El día junto al nombre: «Rutina · día», como las demás listas. */}
                <Text style={e.filaFuerte}>
                  {ofrecida.rutina.nombre}
                  {ofrecida.fecha && ` · ${fechaEnFrase(ofrecida.fecha, false)}`}
                </Text>
                <Text style={e.filaTexto}>{detalle(ofrecida.rutina)}</Text>
              </Fila>
            ))}
          </Seccion>
        )}

        {resumen.situacion === 'primera_vez' && (
          <Text style={e.pie}>
            También puedes entrenar sin programa. En cuanto tengas una rutina, podrás empezarla
            desde aquí, las veces que quieras.
          </Text>
        )}
      </ScrollView>

      {confirmando && (
        <Dialogo
          titulo={confirmando.titulo}
          cuerpo={confirmando.cuerpo}
          confirmar={confirmando.confirmar}
          cancelar={confirmando.cancelar}
          alConfirmar={confirmando.alConfirmar}
          alCancelar={() => setConfirmando(null)}
        />
      )}
    </SafeAreaView>
  )
}

/** Cuándo toca algo, para una frase: «mañana», «el viernes», «el lunes 28». */
function cuandoToca(fecha: string, hoy: string) {
  if (fecha === sumarDias(hoy, 1)) return 'mañana'
  // A menos de una semana basta con el día: «el viernes», no «el viernes 18».
  if (fecha <= sumarDias(hoy, 6)) return `el ${nombreDelDia(fecha)}`
  return conArticulo(fecha)
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  const e = useEstilos(useColores())
  return (
    <View style={e.seccion}>
      <Text style={e.rotulo} accessibilityRole="header">
        {titulo}
      </Text>
      {children}
    </View>
  )
}

/** Una fila de las listas: con `alPulsar` lleva flecha y se pulsa; sin él, es un recordatorio. */
function Fila({ alPulsar, children }: { alPulsar?: () => void; children: ReactNode }) {
  const c = useColores()
  const e = useEstilos(c)
  const contenido = (
    <>
      <View style={e.filaContenido}>{children}</View>
      {alPulsar && <Icono nombre="abrir" color={c.textoTenue} pequeno />}
    </>
  )
  if (!alPulsar) return <View style={e.fila}>{contenido}</View>
  return (
    <Pressable
      accessibilityRole="button"
      onPress={alPulsar}
      style={({ pressed }) => [e.fila, pressed && { borderColor: c.textoTenue }]}
    >
      {contenido}
    </Pressable>
  )
}

type PropsTarjeta = {
  resumen: ResumenDeHoy
  programa: Programa | null
  enCurso: Entrenamiento | null
  detalle: (rutina: RutinaMinima) => string
  ejercicios: (rutina: RutinaMinima) => string
  alEmpezar: () => void
  alContinuar: () => void
}

/** La tarjeta grande: qué toca hoy, según la situación del día. */
function Tarjeta({
  resumen,
  programa,
  enCurso,
  detalle,
  ejercicios,
  alEmpezar,
  alContinuar,
}: PropsTarjeta) {
  const c = useColores()
  const e = useEstilos(c)
  const dia = resumen.semana.find((uno) => uno.fecha === resumen.fecha)!
  const rutina = dia.descanso ? null : dia.rutina
  const sesion = resumen.sesion
  const chip = programa && <Text style={e.chip}>Programa · {programa.nombre}</Text>
  const antes = (texto: string, conChip = true) => (
    <Text style={[e.tarjetaAntes, conChip && programa && e.conChip]}>{texto}</Text>
  )
  const hecho = (texto: string) => (
    <View style={e.tarjetaHecho}>
      <Icono nombre="hecho" color={c.acento} pequeno />
      <Text style={[e.tarjetaDespues, { color: c.acento }]}>{texto}</Text>
    </View>
  )

  switch (resumen.situacion) {
    case 'primera_vez':
      return (
        <View style={e.tarjeta}>
          {antes('Primera vez', false)}
          <Text style={e.tarjetaGrande}>Te damos la bienvenida</Text>
          {/* Dice qué es una rutina y qué es un programa: quien abre la app por primera vez
              no conoce ninguna de las dos palabras. */}
          <View style={e.pasos}>
            <Text style={e.paso}>Para que la app te diga qué entrenar cada día:</Text>
            <Text style={e.paso}>
              1 · Crea tus rutinas, con los ejercicios de cada día de entreno
            </Text>
            <Text style={e.paso}>2 · Crea un programa para repartir tus rutinas en la semana</Text>
          </View>
          <View style={e.tarjetaBoton}>
            <Boton
              texto="Ir a Programas"
              variante="principal"
              alPulsar={() => router.navigate('/programas')}
            />
          </View>
        </View>
      )

    case 'sin_programa':
      return (
        <View style={e.tarjeta}>
          {antes('Hoy', false)}
          <Text style={e.tarjetaGrande}>Sin programa</Text>
          <Text style={e.tarjetaDespues}>
            Activa un programa para que te diga qué rutina toca cada día.
          </Text>
          <View style={e.tarjetaBotonNormal}>
            <Boton texto="Elegir un programa" alPulsar={() => router.navigate('/programas')} />
          </View>
        </View>
      )

    case 'en_curso': {
      const nombre = sesion?.rutina.nombre ?? 'La sesión'
      const series = enCurso ? ` · ${contar(enCurso.series.length, 'serie', 'series')}` : ''
      const loDeHoy = sesion?.cuenta && sesion.cubre_fecha === resumen.fecha
      return (
        <View style={e.tarjeta}>
          {chip}
          {antes(loDeHoy ? 'Hoy toca' : 'Hoy')}
          <Text style={e.tarjetaGrande}>{nombre}</Text>
          <Text style={e.tarjetaDespues}>
            {enCurso ? `En curso desde las ${hora(enCurso.created_at)}${series}` : 'En curso'}
          </Text>
          {sesion?.cubre_fecha && sesion.cubre_fecha !== resumen.fecha && (
            <Text style={e.tarjetaDespues}>
              {sesion.cubre_fecha < resumen.fecha ? 'Recuperado' : 'Adelantado'} del{' '}
              {fechaEnFrase(sesion.cubre_fecha, false)}
            </Text>
          )}
          <View style={e.tarjetaBoton}>
            <Boton
              texto={`Continuar ${sesion?.rutina.nombre ?? 'la sesión'}`}
              variante="principal"
              alPulsar={alContinuar}
            />
          </View>
        </View>
      )
    }

    case 'hecho': {
      // Lo grande es lo que tocaba; debajo, lo que se hizo, si fue otra cosa.
      let texto = 'Hecho'
      if (sesion && sesion.cubre_fecha && sesion.cubre_fecha !== resumen.fecha && sesion.cuenta) {
        const verbo = sesion.cubre_fecha < resumen.fecha ? 'Recuperaste' : 'Adelantaste'
        texto = `${verbo} el ${sesion.rutina.nombre} del ${fechaEnFrase(sesion.cubre_fecha, false)}`
      } else if (sesion && !sesion.cuenta) {
        texto = `Entrenaste ${sesion.rutina.nombre}`
      }
      return (
        <View style={e.tarjeta}>
          {chip}
          {/* Si hoy tocaba una rutina y se hizo otra cosa, lo de hoy queda pendiente. */}
          {antes(rutina && texto !== 'Hecho' ? 'Hoy tocaba' : 'Hoy')}
          <Text style={e.tarjetaGrande}>{rutina?.nombre ?? 'Descanso'}</Text>
          {hecho(texto)}
        </View>
      )
    }

    case 'movido': {
      const cuando = dia.cubierto_por!.fecha
      const como = cuando < resumen.fecha ? 'Hecho por adelantado' : 'Recuperado'
      return (
        <View style={e.tarjeta}>
          {chip}
          {antes('Hoy tocaba')}
          <Text style={e.tarjetaGrande}>{dia.rutina?.nombre}</Text>
          {hecho(`${como} el ${fechaEnFrase(cuando, false)}`)}
        </View>
      )
    }

    case 'descanso': {
      const proximo = resumen.proximo
      return (
        <View style={e.tarjeta}>
          {chip}
          {antes('Hoy')}
          <Text style={e.tarjetaGrande}>Descanso</Text>
          {proximo?.rutina && (
            <Text style={e.tarjetaDespues}>
              {mayuscula(cuandoToca(proximo.fecha, resumen.fecha))} toca {proximo.rutina.nombre} ·{' '}
              {ejercicios(proximo.rutina)}
            </Text>
          )}
        </View>
      )
    }

    case 'entrenamiento':
      return (
        <View style={e.tarjeta}>
          {chip}
          {antes('Hoy toca')}
          <Text style={e.tarjetaGrande}>{rutina!.nombre}</Text>
          <Text style={e.tarjetaDespues}>{detalle(rutina!)}</Text>
          <View style={e.tarjetaBoton}>
            <Boton texto={`Empezar ${rutina!.nombre}`} variante="principal" alPulsar={alEmpezar} />
          </View>
        </View>
      )
  }
}

type PropsRecuperable = {
  recuperable: Recuperable
  hoy: string
  primera: boolean
  ejercicios: string
  alRecuperar: () => void
}

/** Un día por recuperar: hasta cuándo se puede y, si hoy se puede, su botón. */
function FilaRecuperable({ recuperable, hoy, primera, ejercicios, alRecuperar }: PropsRecuperable) {
  const c = useColores()
  const e = useEstilos(c)
  const { rutina, fecha, plazo, se_puede_hoy } = recuperable
  const caducaHoy = plazo === hoy
  let texto: string
  if (!se_puede_hoy) texto = `Recupéralo otro día, hasta ${conArticulo(plazo)}`
  else if (caducaHoy) texto = `${ejercicios} · hoy es el último día`
  else texto = `${ejercicios} · hasta ${conArticulo(plazo)}`
  if (!se_puede_hoy && caducaHoy) texto = 'Hoy era el último día para recuperarlo'

  return (
    <View style={[e.recuperable, !primera && { borderTopWidth: 1, borderTopColor: c.borde }]}>
      <View style={e.filaContenido}>
        <Text style={e.filaFuerte}>
          {rutina.nombre} · {fechaEnFrase(fecha, false)}
        </Text>
        <Text style={[e.filaTexto, caducaHoy && se_puede_hoy && { color: c.ambar }]}>{texto}</Text>
      </View>
      {/* Siempre en verde, también junto a Empezar: decisión expresa del autor. */}
      {se_puede_hoy && (
        <Pressable
          accessibilityRole="button"
          onPress={alRecuperar}
          style={({ pressed }) => [e.botonRecuperar, pressed && { opacity: 0.8 }]}
        >
          <Text style={e.botonRecuperarTexto}>Recuperar</Text>
        </Pressable>
      )}
    </View>
  )
}

/**
 * La última sesión hecha. En la web lleva a su día en el historial; aquí, hasta que llegue
 * el historial, se enseña sin flecha.
 */
function UltimaSesion({ ultima }: { ultima: NonNullable<ResumenDeHoy['ultima_sesion']> }) {
  const c = useColores()
  const e = useEstilos(c)
  const nombre = ultima.rutina.nombre
  let cifras = `${contar(ultima.series, 'serie', 'series')} · ${contar(ultima.ejercicios, 'ejercicio', 'ejercicios')}`
  if (ultima.cubre_fecha && ultima.cubre_fecha !== ultima.fecha) {
    const como = ultima.cubre_fecha < ultima.fecha ? 'Recuperado' : 'Adelantado'
    cifras = `${como} del ${fechaEnFrase(ultima.cubre_fecha, false)} · ${contar(ultima.series, 'serie', 'series')}`
  }
  return (
    <Fila>
      <View style={e.filaTitulo}>
        <Text style={e.filaFuerte}>
          {nombre} · {fechaEnFrase(ultima.fecha, false)}
        </Text>
        <Icono nombre="hecho" color={c.acento} pequeno />
      </View>
      <Text style={e.filaTexto}>{cifras}</Text>
    </Fila>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, gap: 20 },
    aviso: { color: c.textoTenue, fontSize: 14, padding: 16 },
    avisoEnLinea: { color: c.texto, fontSize: 14, lineHeight: 20 },
    cabecera: { alignItems: 'center', marginBottom: -4 },
    cabeceraFecha: { fontSize: 13, color: c.textoTenue },
    cabeceraTitulo: { fontSize: 22, fontWeight: '700', color: c.texto },
    engranaje: {
      position: 'absolute',
      top: -4,
      right: -10,
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tira: { flexDirection: 'row', gap: 4 },
    tiraDia: {
      flex: 1,
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: 'transparent',
      borderRadius: RADIO,
    },
    tiraHoy: { borderColor: c.acento },
    tiraLetra: { fontSize: 12.5, color: c.textoTenue },
    tiraLetraHoy: { color: c.acento, fontWeight: '700' },
    tarjeta: {
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
      padding: 20,
    },
    chip: {
      fontSize: 12.5,
      color: c.acento,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 2,
      paddingHorizontal: 10,
    },
    tarjetaAntes: { fontSize: 14, color: c.textoTenue, textAlign: 'center' },
    conChip: { marginTop: 10 },
    tarjetaGrande: {
      fontSize: 36,
      fontWeight: '800',
      lineHeight: 40,
      letterSpacing: -0.5,
      color: c.texto,
      textAlign: 'center',
    },
    tarjetaDespues: { fontSize: 14, color: c.textoTenue, textAlign: 'center' },
    tarjetaHecho: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tarjetaBoton: { alignSelf: 'stretch', marginTop: 18 },
    tarjetaBotonNormal: { alignSelf: 'stretch', marginTop: 12 },
    pasos: { maxWidth: 320, marginTop: 6, gap: 4 },
    paso: { fontSize: 14, lineHeight: 20, color: c.textoTenue },
    seccion: { gap: 8 },
    rotulo: { fontSize: 13, color: c.textoTenue },
    fila: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingLeft: 16,
      paddingRight: 12,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    filaContenido: { flex: 1, minWidth: 0 },
    filaTitulo: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    filaFuerte: { fontSize: 15, fontWeight: '600', color: c.texto, flexShrink: 1 },
    filaTexto: { fontSize: 13, color: c.textoTenue },
    etiquetaChica: {
      fontSize: 11,
      color: c.textoTenue,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 1,
      paddingHorizontal: 7,
      marginLeft: 2,
    },
    recuperables: {
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
      paddingLeft: 16,
      paddingRight: 12,
    },
    recuperable: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10 },
    botonRecuperar: {
      minHeight: 44,
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 6,
      backgroundColor: c.acento,
      flexShrink: 0,
    },
    botonRecuperarTexto: { fontSize: 14, fontWeight: '600', color: c.sobreAcento },
    pie: {
      maxWidth: 320,
      alignSelf: 'center',
      fontSize: 12.5,
      lineHeight: 18,
      color: c.textoTenue,
    },
  })
}
