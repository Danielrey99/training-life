/**
 * H4 · Planificar: qué toca cada día de hoy en adelante, por semanas y sin límite. Puerto de
 * `web/src/paginas/historial/Planificar.tsx`; las reglas sin React, en
 * `reglasDePantalla/planificar.ts`.
 *
 * Cambiar un día sustituye lo que tocaba (no lo intercambia con otro) y se guarda al tocar.
 * La lógica decide qué día cuenta cada sesión y si un cambio deja sin día a lo que ya se hizo
 * por adelantado (409); esta pantalla solo lo pinta y explica por qué no se puede. El pasado
 * no se planifica: la lista empieza hoy.
 */
import { router } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Cabecera } from '../../componentes/Cabecera'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Hoja } from '../../componentes/Hoja'
import { Icono } from '../../componentes/Icono'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import { AvisoDeLaWeb, ErrorDeApi, textoDelFallo } from '../../logica/api'
import type { DiaSeguimiento, Hoy, Programa, RutinaDeHoy } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import {
  domingoDe,
  enSemanas,
  etiquetaDelDia,
  lunesDe,
  porQueNoSePuede,
  porQueNoSeRestablece,
  rutinasDeLaHoja,
  type Semana,
} from '../../reglasDePantalla/planificar'
import { RADIO, useColores, type Colores } from '../../tema'
import { useAjustes } from '../../utiles/ajustes'
import { colorDelDia, colorDeRutina, sinDia } from '../../utiles/colores'
import { diaDeLaSemana, diaYMesConAnio, fechaLarga, sumarDias } from '../../utiles/fechas'

// Las semanas que se piden de una vez, y el máximo de días que admite la lógica por llamada
// (400) con un margen.
const SEMANAS_POR_TANDA = 4
const DIAS_POR_LLAMADA = 392

function contar(cuantos: number) {
  return cuantos === 1 ? '1 ejercicio' : `${cuantos} ejercicios`
}

/** Los días de `desde` a `hasta`, en las llamadas que haga falta. */
async function leerDias(desde: string, hasta: string) {
  const dias: DiaSeguimiento[] = []
  for (let inicio = desde; inicio <= hasta; inicio = sumarDias(inicio, DIAS_POR_LLAMADA)) {
    const fin = sumarDias(inicio, DIAS_POR_LLAMADA - 1)
    dias.push(...(await api.seguimiento(inicio, fin < hasta ? fin : hasta)))
  }
  return dias
}

type Confirmacion = {
  titulo: string
  cuerpo: string
  alConfirmar: () => Promise<void>
}

/** Al calendario, que es de donde se viene siempre. */
function volver() {
  if (router.canGoBack()) router.back()
  else router.replace('/historial')
}

export function Planificar() {
  const c = useColores()
  const e = useEstilos(c)
  const [resumen, setResumen] = useState<Hoy | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [dias, setDias] = useState<DiaSeguimiento[]>([])
  const [error, setError] = useState<unknown>(null)
  const [lectura, setLectura] = useState(0)
  const [abierto, setAbierto] = useState<DiaSeguimiento | null>(null)
  const [confirmando, setConfirmando] = useState<Confirmacion | null>(null)
  const cargandoMas = useRef(false)
  const [cargando, setCargando] = useState(false)
  const ultimo = dias.length > 0 ? dias[dias.length - 1].fecha : null

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const [leido, programas] = await Promise.all([api.hoy(), api.programas()])
        const lista = await leerDias(
          leido.fecha,
          sumarDias(domingoDe(leido.fecha), 7 * (SEMANAS_POR_TANDA - 1)),
        )
        if (!vigente) return
        setResumen(leido)
        setPrograma(programas.find((uno) => uno.activo) ?? null)
        setDias(lista)
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

  /** Vuelve a leer todo lo cargado: un cambio puede mover lo que se hizo por adelantado. */
  const recargar = useCallback(async () => {
    if (!resumen || !ultimo) return
    const lista = await leerDias(resumen.fecha, ultimo)
    // Las semanas que llegaron mientras tanto se conservan.
    setDias((antes) => [...lista, ...antes.filter((dia) => dia.fecha > ultimo)])
  }, [resumen, ultimo])

  const cargarMas = useCallback(async () => {
    if (cargandoMas.current || !ultimo) return
    cargandoMas.current = true
    setCargando(true)
    try {
      const mas = await leerDias(sumarDias(ultimo, 1), sumarDias(ultimo, 7 * SEMANAS_POR_TANDA))
      setDias((antes) => [...antes, ...mas])
    } catch (fallo) {
      setError(fallo)
    } finally {
      cargandoMas.current = false
      setCargando(false)
    }
  }, [ultimo])

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="Planificar" alVolver={volver} />
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!resumen) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="Planificar" alVolver={volver} />
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const hoy = resumen.fecha
  const semanas = enSemanas(dias)

  function ejercicios(rutinaId: number) {
    const datos = resumen!.rutinas.find((una) => una.id === rutinaId)
    return datos ? contar(datos.ejercicios) : ''
  }

  function pedirRestablecerSemana(semana: Semana) {
    const cambiados = semana.dias.filter((dia) => dia.origen === 'excepcion').length
    const esta = semana.lunes === lunesDe(hoy)
    setConfirmando({
      titulo: esta
        ? '¿Restablecer esta semana?'
        : `¿Restablecer la semana del ${diaYMesConAnio(semana.lunes)}?`,
      cuerpo:
        cambiados === 1
          ? 'El día que cambiaste volverá a lo que dice el programa.'
          : `Los ${cambiados} días que cambiaste volverán a lo que dice el programa.`,
      alConfirmar: async () => {
        try {
          await api.restablecerRango(semana.dias[0].fecha, semana.domingo)
        } catch (fallo) {
          // El único 409: lo hecho por adelantado se quedaría sin día. El texto de la lógica
          // lleva fechas ISO; se cuenta con las palabras del aviso de cambiar un día.
          const sinDia = fallo instanceof ErrorDeApi && fallo.estado === 409
          const fecha = sinDia ? (fallo.detalle as { fecha?: string } | null)?.fecha : undefined
          const dia = semana.dias.find((uno) => uno.cubierto_por?.fecha === fecha && uno.rutina)
          if (dia?.rutina && fecha)
            throw new AvisoDeLaWeb(
              porQueNoSeRestablece(dia.rutina.nombre, fecha, Boolean(dia.rutina.oculto_desde)),
            )
          throw fallo
        }
        await recargar()
        setConfirmando(null)
      },
    })
  }

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo="Planificar"
        subtitulo={programa ? programa.nombre : undefined}
        alVolver={volver}
      />
      <ScrollView contentContainerStyle={e.contenido}>
        <View style={e.explicacion}>
          <TextoCentrado style={e.ayuda}>Toca un día para cambiar qué rutina toca.</TextoCentrado>
          {/* Lo que quieren decir los iconos de las filas, con el icono real. */}
          <View style={e.leyenda}>
            <Icono nombre="hecho" color={c.acento} pequeno />
            <Text style={e.ayuda}>Ya hecho</Text>
            <View style={e.separacion} />
            <Icono nombre="editar" color={c.textoTenue} pequeno />
            <Text style={e.ayuda}>Cambiado por ti</Text>
          </View>
        </View>

        {semanas.map((semana) => {
          const esta = semana.lunes === lunesDe(hoy)
          const hayCambios = semana.dias.some((dia) => dia.origen === 'excepcion')
          return (
            <View key={semana.lunes} style={e.seccion}>
              <View style={e.semana}>
                <Text style={e.rotulo}>
                  {esta ? 'Esta semana' : `Semana del ${diaYMesConAnio(semana.lunes)}`}
                </Text>
                {hayCambios && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => pedirRestablecerSemana(semana)}
                    style={e.restablecer}
                  >
                    <Text style={e.restablecerTexto}>
                      Restablecer {esta ? 'esta semana' : 'la semana'}
                    </Text>
                  </Pressable>
                )}
              </View>
              <View style={e.dias}>
                {semana.dias.map((dia, indice) => (
                  <FilaDelDia
                    key={dia.fecha}
                    dia={dia}
                    hoy={hoy}
                    primera={indice === 0}
                    ejercicios={ejercicios}
                    alTocar={() => setAbierto(dia)}
                  />
                ))}
              </View>
            </View>
          )
        })}

        {/* Con un botón y no al bajar (decisión del autor): la lista tiene final y no se acaba
            meses adelante sin querer; planificar más allá de unas semanas es raro. */}
        <Boton
          texto={cargando ? 'Cargando…' : `Ver ${SEMANAS_POR_TANDA} semanas más`}
          alPulsar={() => void cargarMas()}
          desactivado={cargando}
        />
      </ScrollView>

      {abierto && (
        <HojaDelDia
          dia={abierto}
          programa={programa}
          resumen={resumen}
          ejercicios={ejercicios}
          alCambiar={recargar}
          alCerrar={() => setAbierto(null)}
        />
      )}

      {confirmando && (
        <Dialogo
          titulo={confirmando.titulo}
          cuerpo={confirmando.cuerpo}
          confirmar="Restablecer"
          alConfirmar={confirmando.alConfirmar}
          alCancelar={() => setConfirmando(null)}
        />
      )}
    </SafeAreaView>
  )
}

type PropsFila = {
  dia: DiaSeguimiento
  hoy: string
  primera: boolean
  ejercicios: (rutinaId: number) => string
  alTocar: () => void
}

/** Un día de la lista: qué toca, y si ya se hizo por adelantado o se cambió a mano. */
function FilaDelDia({ dia, hoy, primera, ejercicios, alTocar }: PropsFila) {
  const c = useColores()
  // Los colores de los días dependen de los ajustes: se vuelve a pintar al cambiarlos.
  const actuales = useAjustes()
  const e = useEstilos(c)
  const rutina = dia.descanso ? null : dia.rutina
  // Una rutina oculta sigue en su día, en gris, pero cuenta como descanso.
  const oculta = dia.rutina?.oculto_desde ? dia.rutina : null
  const hecho = dia.cubierto_por
  return (
    <Pressable
      accessibilityRole="button"
      onPress={alTocar}
      style={[e.dia, !primera && { borderTopWidth: 1, borderTopColor: c.borde }]}
    >
      <Text style={[e.fecha, dia.fecha === hoy && e.fechaDeHoy]}>{etiquetaDelDia(dia.fecha)}</Text>
      {rutina ? (
        <>
          {/* El color del día, también para una rutina de fuera del programa (decisión del
              autor): una rutina solo tiene color puesta en un día, y es el de ese día. */}
          <View
            style={[e.punto, { backgroundColor: colorDelDia(diaDeLaSemana(dia.fecha), actuales) }]}
          />
          {/* Una fila por día, de una sola línea: un nombre que no cabe se corta con «…». */}
          <Text style={e.nombre} numberOfLines={1}>
            {rutina.nombre}
          </Text>
          {!hecho && <Text style={e.detalle}>{ejercicios(rutina.id)}</Text>}
        </>
      ) : oculta ? (
        <>
          <View style={[e.punto, { backgroundColor: sinDia(actuales) }]} />
          <Text style={[e.nombre, { color: c.textoTenue }]} numberOfLines={1}>
            {oculta.nombre}
          </Text>
        </>
      ) : (
        <>
          <View style={e.espacio} />
          <Text style={e.descanso}>Descanso</Text>
        </>
      )}
      <View style={e.relleno} />
      {/* Hecho y cambiado, solo con su icono (decisión del autor): los explica la leyenda. */}
      {hecho && (
        <View accessible accessibilityLabel="Hecho">
          <Icono nombre="hecho" color={c.acento} pequeno />
        </View>
      )}
      {oculta && <Text style={e.etiqueta}>oculta</Text>}
      {dia.origen === 'excepcion' && (
        <View accessible accessibilityLabel="Cambiado por ti">
          <Icono nombre="editar" color={c.textoTenue} pequeno />
        </View>
      )}
      <Icono nombre="abrir" color={c.textoTenue} pequeno />
    </Pressable>
  )
}

type PropsHoja = {
  dia: DiaSeguimiento
  programa: Programa | null
  resumen: Hoy
  ejercicios: (rutinaId: number) => string
  alCambiar: () => Promise<void>
  alCerrar: () => void
}

/** La hoja de un día: se elige qué toca y se guarda en el momento. */
function HojaDelDia({ dia, programa, resumen, ejercicios, alCambiar, alCerrar }: PropsHoja) {
  const c = useColores()
  const actuales = useAjustes()
  const e = useEstilos(c)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ titulo: string; cuerpo: string } | null>(null)

  // Con una rutina oculta no hay nada elegido: ese día cuenta como descanso, pero elegir
  // *Descanso* sí cambia algo, porque lo deja así aunque la rutina se vuelva a mostrar.
  const oculta = dia.rutina?.oculto_desde ? dia.rutina : null
  const actual = oculta ? undefined : dia.descanso ? null : (dia.rutina?.id ?? null)
  const cambiado = dia.origen === 'excepcion'
  const delPrograma = programa?.dias.find((uno) => uno.dia_semana === diaDeLaSemana(dia.fecha))
  const { delPrograma: delProgramaEnOrden, otras } = rutinasDeLaHoja(resumen.rutinas, programa)

  /** Lo que haya cambiado, guardado; los errores de lo hecho por adelantado se explican. */
  async function guardar(accion: () => Promise<unknown>) {
    setGuardando(true)
    setFallo(null)
    try {
      await accion()
      await alCambiar()
      alCerrar()
    } catch (problema) {
      setGuardando(false)
      // El único 409 de cambiar un día: dejaría sin día lo que ya se entrenó para él.
      if (
        problema instanceof ErrorDeApi &&
        problema.estado === 409 &&
        dia.cubierto_por &&
        dia.rutina
      ) {
        setAviso({
          titulo: `No puedes quitar este ${dia.rutina.nombre}`,
          cuerpo: porQueNoSePuede(
            dia.rutina.nombre,
            dia.fecha,
            dia.cubierto_por.fecha,
            Boolean(dia.rutina.oculto_desde),
          ),
        })
      } else {
        setFallo(textoDelFallo(problema))
      }
    }
  }

  function elegir(rutinaId: number | null) {
    // Elegir lo que ya toca no cambia nada: se cierra sin marcar el día como cambiado.
    if (rutinaId === actual) return alCerrar()
    void guardar(() => api.planificarDia(dia.fecha, rutinaId))
  }

  const marca = (elegida: boolean) =>
    elegida ? <Icono nombre="elegido" color={c.acento} pequeno /> : <View style={e.sinMarca} />

  // `color`, solo las del programa: el de su día en él, que dice de qué día es (decisión del
  // autor). Las otras van sin punto: no están puestas en ningún día.
  const filaDeRutina = (rutina: RutinaDeHoy, color?: string) => (
    <Pressable
      key={rutina.id}
      accessibilityRole="button"
      onPress={() => elegir(rutina.id)}
      disabled={guardando}
      style={e.filaHoja}
    >
      {color && <View style={[e.punto, { backgroundColor: color }]} />}
      <Text style={e.filaTitulo}>{rutina.nombre}</Text>
      <Text style={e.detalle}>{ejercicios(rutina.id)}</Text>
      {marca(actual === rutina.id)}
    </Pressable>
  )

  const subtitulo = oculta
    ? `${oculta.nombre} está oculta, así que este día cuenta como descanso`
    : !cambiado
      ? 'Elige qué toca este día'
      : !programa
        ? 'Sin programa activo sería descanso'
        : delPrograma
          ? `Según el programa toca ${delPrograma.rutina.nombre}`
          : 'Según el programa es descanso'

  return (
    <>
      <Hoja
        titulo={fechaLarga(dia.fecha)}
        subtitulo={subtitulo}
        alCerrar={() => !guardando && !aviso && alCerrar()}
      >
        {fallo && <Text style={e.fallo}>{fallo}</Text>}

        {/* Con rótulo, como las de abajo: así se entiende por qué hay dos grupos. */}
        {programa && delProgramaEnOrden.length > 0 && (
          <Text style={e.rotuloHoja}>Rutinas del programa</Text>
        )}
        {delProgramaEnOrden.map((rutina) =>
          filaDeRutina(rutina, colorDeRutina(programa?.dias, rutina.id, actuales)),
        )}
        {/* Sin programa no hay "otras": todas lo son, y van sin rótulo. */}
        {!programa && otras.map((rutina) => filaDeRutina(rutina))}
        <Pressable
          accessibilityRole="button"
          onPress={() => elegir(null)}
          disabled={guardando}
          style={e.filaHoja}
        >
          {/* Con programa va con las suyas, que llevan punto: el hueco lo alinea con ellas. */}
          {programa && <View style={e.espacio} />}
          <Text style={[e.descanso, e.filaTituloDescanso]}>Descanso</Text>
          {marca(actual === null)}
        </Pressable>
        {/* Elegida aquí, también cuenta para ese día: es lo que toca, aunque no esté en el
            programa. Por eso el rótulo no dice que no contará, como en la hoja de registrar. */}
        {programa && otras.length > 0 && (
          <>
            <Text style={e.rotuloHoja}>Otras rutinas</Text>
            {otras.map((rutina) => filaDeRutina(rutina))}
          </>
        )}

        {cambiado && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void guardar(() => api.restablecerDia(dia.fecha))}
            disabled={guardando}
            style={e.restablecerDia}
          >
            <Text style={e.restablecerDiaTexto}>Restablecer este día</Text>
          </Pressable>
        )}
      </Hoja>

      {aviso && (
        <Dialogo
          titulo={aviso.titulo}
          cuerpo={aviso.cuerpo}
          soloAviso="Entendido"
          alCancelar={() => setAviso(null)}
        />
      )}
    </>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 16 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue, padding: 16 },
    explicacion: { gap: 6 },
    ayuda: { fontSize: 13, lineHeight: 18, color: c.textoTenue },
    leyenda: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
    separacion: { width: 8 },
    seccion: { gap: 8 },
    semana: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    rotulo: { flexShrink: 1, fontSize: 13, color: c.textoTenue },
    // Texto sin recuadro, que es la acción secundaria; el área táctil llega a 44 px.
    restablecer: {
      minHeight: 44,
      marginVertical: -12,
      paddingHorizontal: 4,
      justifyContent: 'center',
    },
    restablecerTexto: { fontSize: 13, fontWeight: '600', color: c.textoTenue },
    dias: {
      paddingLeft: 16,
      paddingRight: 12,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    dia: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
    fecha: {
      width: 68,
      flexShrink: 0,
      fontSize: 13,
      color: c.textoTenue,
      fontVariant: ['tabular-nums'],
    },
    fechaDeHoy: { fontWeight: '700', color: c.acento },
    punto: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
    espacio: { width: 8, flexShrink: 0 },
    nombre: { flexShrink: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: c.texto },
    detalle: { flexShrink: 0, fontSize: 13, color: c.textoTenue },
    descanso: { fontSize: 15, fontStyle: 'italic', color: c.textoTenue },
    relleno: { flexGrow: 1 },
    // `.etiqueta-chica` de la web.
    etiqueta: {
      fontSize: 11,
      color: c.textoTenue,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 1,
      paddingHorizontal: 7,
    },
    // La hoja de un día: filas algo más bajas que las de registrar, como en el boceto.
    filaHoja: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: c.borde,
    },
    filaTitulo: { flex: 1, fontSize: 15, fontWeight: '600', color: c.texto },
    filaTituloDescanso: { flex: 1 },
    sinMarca: { width: 18 },
    rotuloHoja: {
      paddingTop: 14,
      paddingBottom: 8,
      borderTopWidth: 1,
      borderTopColor: c.borde,
      fontSize: 12.5,
      textAlign: 'center',
      color: c.textoTenue,
    },
    fallo: { fontSize: 14, lineHeight: 20, color: c.error, paddingVertical: 8 },
    restablecerDia: {
      minHeight: 44,
      marginTop: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderTopWidth: 1,
      borderTopColor: c.borde,
    },
    restablecerDiaTexto: { fontSize: 14, fontWeight: '600', color: c.textoTenue },
  })
}
