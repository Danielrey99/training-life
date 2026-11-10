/**
 * H1 · Calendario: el mes, con lo que se hizo y lo que tocaba cada día. Puerto de
 * `web/src/paginas/historial/Calendario.tsx`.
 *
 * El estado de cada día lo calcula la lógica (`api.seguimiento`); aquí solo se pinta, con las
 * mismas marcas que la tira de la semana de Entrenar. El mes va en la ruta (`?mes=2026-09`)
 * para que volver de un día no devuelva al mes actual.
 *
 * Diferencia con la web, hasta H4: sin los botones de Planificar y de Resumen.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'

import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { MesConMarcas } from '../../componentes/MesConMarcas'
import type { DiaSemana, DiaSeguimiento, Programa } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, useColores, type Colores } from '../../tema'
import { useAjustes } from '../../utiles/ajustes'
import { colorDelDia } from '../../utiles/colores'
import {
  diaYMes,
  finDeMes,
  hoy as hoyLocal,
  inicioDeMes,
  mesDeLaUrl,
  sumarMeses,
  tituloDeMes,
} from '../../utiles/fechas'
import { HojaRegistrar } from './HojaRegistrar'
import { TextoCentrado } from '../../componentes/TextoCentrado'

const NOMBRES_DIA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

type Cifras = { entrenados: number; planificados: number; movidos: number; noHechos: number }

/**
 * Las cifras del mes. Un día cuenta como entrenado si está hecho o movido, y como
 * planificado si además no se hizo pero ya pasó. Lo de hoy sin hacer todavía no es un fallo.
 */
function cifras(dias: DiaSeguimiento[]): Cifras {
  const entrenados = dias.filter((d) => d.estado === 'hecho' || d.estado === 'movido').length
  const noHechos = dias.filter((d) => d.estado === 'sin_hacer').length
  return {
    entrenados,
    planificados: entrenados + noHechos,
    movidos: dias.filter((d) => d.estado === 'movido').length,
    noHechos,
  }
}

export function Calendario() {
  const c = useColores()
  const e = useEstilos(c)
  const parametros = useLocalSearchParams<{ mes?: string }>()
  const hoy = hoyLocal()
  const mes = mesDeLaUrl(parametros.mes ?? null, hoy)

  // Cada carga recuerda de qué mes es: al cambiar de mes, los datos del anterior no se
  // pintan mientras llegan los nuevos.
  const [cargado, setCargado] = useState<{
    mes: string
    dias: DiaSeguimiento[]
    series: number
  } | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [leyenda, setLeyenda] = useState(false)
  const [registrando, setRegistrando] = useState<string | null>(null)
  const [lectura, setLectura] = useState(0)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const fin = finDeMes(mes)
        const hastaHoy = fin < hoy ? fin : hoy
        const [seguimiento, programas, sesiones] = await Promise.all([
          api.seguimiento(mes, fin),
          api.programas(),
          mes <= hoy ? api.entrenamientos({ desde: mes, hasta: hastaHoy }) : Promise.resolve([]),
        ])
        if (!vigente) return
        setCargado({
          mes,
          dias: seguimiento,
          series: sesiones.reduce((total, sesion) => total + sesion.series.length, 0),
        })
        setPrograma(programas.find((uno) => uno.activo) ?? null)
        setError(null)
      } catch (fallo) {
        if (vigente) setError(fallo)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [mes, hoy, lectura])

  // Al volver de un día (que se puede haber editado o borrado), se lee de nuevo: en la web la
  // pantalla se vuelve a montar; aquí se queda montada debajo.
  useFocusEffect(
    useCallback(() => {
      setLectura((n) => n + 1)
    }, []),
  )

  function irAlMes(meses: number) {
    router.setParams({ mes: sumarMeses(mes, meses).slice(0, 7) })
  }

  /**
   * Tocar un día enseña lo que se hizo ESE día. La sesión de hoy a medias se abre para seguir
   * apuntando; una pasada sin terminar cuenta como hecha y va a su día.
   */
  function tocar(dia: DiaSeguimiento) {
    if (dia.sesion?.en_curso) {
      router.navigate({
        pathname: '/sesion/[id]',
        params: { id: String(dia.sesion.entrenamiento_id) },
      })
    } else if (dia.sesion) {
      router.push({ pathname: '/historial/[fecha]', params: { fecha: dia.fecha } })
    } else if (dia.fecha === hoy) router.navigate('/')
    else if (dia.fecha < hoy) setRegistrando(dia.fecha)
  }

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }

  const dias = cargado?.mes === mes ? cargado.dias : null
  const series = cargado?.series ?? 0
  const resumen = dias && cifras(dias)
  const esteMes = inicioDeMes(hoy) === mes

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <Text style={e.titulo} accessibilityRole="header">
          Historial
        </Text>

        <View style={e.mes}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mes anterior"
            onPress={() => irAlMes(-1)}
            style={e.flecha}
          >
            <Icono nombre="volver" color={c.texto} />
          </Pressable>
          <Text style={e.mesTitulo}>{tituloDeMes(mes)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mes siguiente"
            onPress={() => irAlMes(1)}
            style={e.flecha}
          >
            <Icono nombre="abrir" color={c.texto} />
          </Pressable>
        </View>

        <MesConMarcas
          mes={mes}
          dias={dias}
          hoy={hoy}
          programa={programa}
          tocado={registrando ?? undefined}
          alTocar={tocar}
        />

        {resumen && mes <= hoy && (
          <>
            <View style={e.cifras}>
              <View style={e.cifra}>
                <Text style={[e.cifraValor, { color: c.acento }]}>
                  {resumen.entrenados}
                  <Text style={e.cifraPequena}> / {resumen.planificados}</Text>
                </Text>
                <Text style={e.cifraTexto}>entrenados</Text>
              </View>
              <View style={e.cifra}>
                <Text style={e.cifraValor}>{resumen.movidos}</Text>
                <Text style={e.cifraTexto}>{resumen.movidos === 1 ? 'movido' : 'movidos'}</Text>
              </View>
              <View style={e.cifra}>
                <Text style={e.cifraValor}>{resumen.noHechos}</Text>
                <Text style={e.cifraTexto}>no hecho{resumen.noHechos === 1 ? '' : 's'}</Text>
              </View>
            </View>
            <TextoCentrado style={e.cifrasPie}>
              {esteMes ? `Hasta hoy, ${diaYMes(hoy)} · ` : ''}
              {series === 1 ? '1 serie registrada' : `${series} series registradas`}
            </TextoCentrado>
          </>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: leyenda }}
          onPress={() => setLeyenda(!leyenda)}
          style={e.verLeyenda}
        >
          <Text style={e.verLeyendaTexto}>{leyenda ? 'Ocultar leyenda' : 'Ver leyenda'}</Text>
          <Icono nombre={leyenda ? 'arriba' : 'abajo'} color={c.textoTenue} pequeno />
        </Pressable>
        {leyenda && <Leyenda programa={programa} />}
      </ScrollView>

      {registrando && <HojaRegistrar fecha={registrando} alCerrar={() => setRegistrando(null)} />}
    </SafeAreaView>
  )
}

/** Una marca de ejemplo, con el color de un día. */
function Punto({
  lleno = false,
  color,
  apagado = false,
}: {
  lleno?: boolean
  color: string
  apagado?: boolean
}) {
  return (
    <View
      style={[
        estilosLeyenda.punto,
        lleno ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: color },
        apagado && { opacity: 0.35 },
      ]}
    />
  )
}

function Flecha({ haciaAtras = false, color }: { haciaAtras?: boolean; color: string }) {
  return (
    <Svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={haciaAtras ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </Svg>
  )
}

/** Qué significa cada marca y cada color. Plegada por defecto: se consulta poco. */
function Leyenda({ programa }: { programa: Programa | null }) {
  const c = useColores()
  // Los colores dependen de los ajustes: se vuelve a pintar al cambiarlos.
  useAjustes()
  // Los colores de los ejemplos: los de los dos primeros días del programa; si no llega a
  // dos, se completan con el lunes y el miércoles. Siempre de la paleta, nunca el gris.
  const dias = (programa?.dias ?? []).map((dia) => dia.dia_semana).sort((a, b) => a - b)
  for (const relleno of [1, 3, 2] as DiaSemana[]) {
    if (dias.length < 2 && !dias.includes(relleno)) dias.push(relleno)
  }
  const [uno, otro] = dias.map(colorDelDia)
  const filas = [
    { marca: <Punto lleno color={uno} />, texto: 'Hecho ese día' },
    { marca: <Punto color={uno} />, texto: 'Sin hacer' },
    {
      marca: (
        <>
          <Punto color={uno} />
          <Flecha color={uno} />
        </>
      ),
      texto: 'Hecho otro día, más tarde (recuperado)',
    },
    {
      marca: (
        <>
          <Flecha haciaAtras color={uno} />
          <Punto color={uno} />
        </>
      ),
      texto: 'Hecho otro día, antes (adelantado)',
    },
    {
      marca: (
        <>
          <Punto lleno color={uno} />
          <Flecha color={otro} />
        </>
      ),
      texto: 'Ese día se hizo otra rutina y la suya, otro día',
    },
    {
      marca: (
        <>
          <Punto lleno color={uno} />
          <Punto color={otro} />
        </>
      ),
      texto: 'Ese día se hizo otra rutina y la suya se quedó sin hacer',
    },
    { marca: <Punto lleno apagado color={uno} />, texto: 'Próximo' },
  ]
  const texto = { color: c.textoTenue, fontSize: 13, flexShrink: 1 } as const

  return (
    <View style={[estilosLeyenda.caja, { backgroundColor: c.superficie, borderColor: c.borde }]}>
      {programa && programa.dias.length > 0 && (
        <View style={[estilosLeyenda.colores, { borderBottomColor: c.borde }]}>
          {programa.dias.map((dia) => (
            <View key={dia.dia_semana} style={estilosLeyenda.color}>
              <Punto lleno color={colorDelDia(dia.dia_semana)} />
              <Text style={texto}>
                {NOMBRES_DIA[dia.dia_semana - 1]} · {dia.rutina.nombre}
              </Text>
            </View>
          ))}
        </View>
      )}
      {filas.map((fila) => (
        <View key={fila.texto} style={estilosLeyenda.fila}>
          <View style={estilosLeyenda.marca}>{fila.marca}</View>
          <Text style={texto}>{fila.texto}</Text>
        </View>
      ))}
    </View>
  )
}

const estilosLeyenda = StyleSheet.create({
  caja: { gap: 8, marginTop: -6, padding: 14, borderWidth: 1, borderRadius: RADIO },
  colores: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  color: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  marca: {
    width: 34,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  punto: { width: 8, height: 8, borderRadius: 999 },
})

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, gap: 12 },
    titulo: { fontSize: 22, fontWeight: '700', textAlign: 'center', color: c.texto },
    mes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    flecha: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    mesTitulo: { fontSize: 17, fontWeight: '600', color: c.texto },
    cifras: { flexDirection: 'row', gap: 8, marginTop: 4 },
    cifra: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
      paddingVertical: 12,
      paddingHorizontal: 10,
    },
    cifraValor: { fontSize: 24, fontWeight: '700', lineHeight: 29, color: c.texto },
    cifraPequena: { fontSize: 14, fontWeight: '500', color: c.textoTenue },
    cifraTexto: { fontSize: 12.5, color: c.textoTenue, textAlign: 'center' },
    cifrasPie: { marginTop: -6, fontSize: 12.5, color: c.textoTenue, textAlign: 'center' },
    verLeyenda: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    verLeyendaTexto: { fontSize: 14, fontWeight: '600', color: c.textoTenue },
  })
}
