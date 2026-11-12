/**
 * H5 · Resumen: el volumen por semana o por mes, el desglose de la barra elegida (por rutina y
 * por grupo muscular) y la constancia del año. Puerto de
 * `web/src/paginas/historial/Resumen.tsx`.
 *
 * Todo lo calcula la lógica (`api.resumen`, el `GET /resumen` del backend) y llega en una sola
 * respuesta: cambiar de vista o tocar una barra no pide nada.
 *
 * Diferencias con la web: la vista y la barra elegida no van en la ruta (aquí no se recarga),
 * y la barra en curso se raya con un patrón de react-native-svg.
 */
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Defs, Pattern, Rect } from 'react-native-svg'

import { Cabecera } from '../../componentes/Cabecera'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { Selector } from '../../componentes/Selector'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import type {
  EvolucionDeVolumen,
  PeriodoDeVolumen,
  Programa,
  Resumen as DatosResumen,
} from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, useColores, type Colores } from '../../tema'
import { useAjustes } from '../../utiles/ajustes'
import { colorDeRutina, sinDia } from '../../utiles/colores'
import {
  diaYMes,
  hoy as hoyLocal,
  mesCorto,
  mesDeLaUrl,
  sumarDias,
  sumarMeses,
  tituloDeMes,
} from '../../utiles/fechas'
import { conMiles, enUnidad, numeroLegible, unidad } from '../../utiles/numeros'

const INICIALES_MES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// Las alturas de las barras, en píxeles, como en el boceto.
const ALTO_VOLUMEN = 150
const ALTO_CONSTANCIA = 70

/** «4.520 kg»: el volumen llega en kg y se enseña en la unidad elegida, con los miles. */
function enKilos(volumen: string | number): string {
  return `${conMiles(enUnidad(volumen))} ${unidad()}`
}

/** "+7 %", "−12,5 %". */
function porcentaje(cambio: number): string {
  const texto = numeroLegible(Math.abs(cambio), 1)
  return `${cambio > 0 ? '+' : cambio < 0 ? '−' : ''}${texto} %`
}

/**
 * "15 de septiembre", o "29 de diciembre de 2025" si no es del año de `referencia`. El mes
 * entero y no "15 sep" (decisión del autor); el corto queda para el eje de la gráfica.
 */
function diaConAnio(iso: string, referencia: string): string {
  const texto = diaYMes(iso)
  return iso.slice(0, 4) === referencia.slice(0, 4) ? texto : `${texto} de ${iso.slice(0, 4)}`
}

/** "agosto", o "diciembre de 2025" si no es del año de `referencia`. */
function mesConAnio(iso: string, referencia: string): string {
  const texto = tituloDeMes(iso).split(' ')[0].toLowerCase()
  return iso.slice(0, 4) === referencia.slice(0, 4) ? texto : `${texto} de ${iso.slice(0, 4)}`
}

/** Cómo se nombra cada vista en sus textos. */
const VISTAS = {
  semana: {
    titulo: 'Volumen por semana',
    // Sin «Semana del»: ya lo dice el título de la tarjeta (decisión del autor).
    periodo: (p: PeriodoDeVolumen, hoy: string) => diaConAnio(p.desde, hoy),
    enUnaFrase: (p: PeriodoDeVolumen, hoy: string) => `semana del ${diaConAnio(p.desde, hoy)}`,
    comparadoCon: (p: PeriodoDeVolumen, con: string) =>
      con === sumarDias(p.desde, -7)
        ? 'la semana anterior'
        : `la semana del ${diaConAnio(con, p.desde)}`,
    sinSeries: 'Sin series esta semana.',
    // Hubo series, pero ninguna de peso y repeticiones, que son las que suman volumen.
    sinPeso: 'Sin ejercicios con peso esta semana',
    vacio: 'No hay series en estas semanas.',
    leyenda: 'Toca una barra para ver esa semana.',
    enCurso: 'La rayada es la semana en curso, aún sin terminar.',
  },
  mes: {
    titulo: 'Volumen por mes',
    periodo: (p: PeriodoDeVolumen) => tituloDeMes(p.desde),
    enUnaFrase: (p: PeriodoDeVolumen, hoy: string) => mesConAnio(p.desde, hoy),
    comparadoCon: (p: PeriodoDeVolumen, con: string) =>
      con === sumarMeses(p.desde, -1) ? 'el mes anterior' : mesConAnio(con, p.desde),
    sinSeries: 'Sin series este mes.',
    sinPeso: 'Sin ejercicios con peso este mes',
    vacio: 'No hay series en estos meses.',
    leyenda: 'Toca una barra para ver ese mes.',
    enCurso: 'La rayada es el mes en curso, aún sin terminar.',
  },
}

type Vista = (typeof VISTAS)[keyof typeof VISTAS]

const OPCIONES_DE_VISTA = [
  { clave: 'semana', texto: 'Por semana' },
  { clave: 'mes', texto: 'Por mes' },
] as const

/**
 * Las dos líneas bajo cada barra: el día del lunes (o el mes) y, debajo, el mes (o el año)
 * solo en la primera barra y donde cambia, para que quepan nueve a 390 px.
 */
function etiqueta(
  periodo: PeriodoDeVolumen,
  anterior: PeriodoDeVolumen | undefined,
  porMes: boolean,
): [string, string] {
  if (porMes) {
    const cambiaAnio = !anterior || anterior.desde.slice(0, 4) !== periodo.desde.slice(0, 4)
    return [mesCorto(periodo.desde), cambiaAnio ? periodo.desde.slice(0, 4) : '']
  }
  const cambiaMes = !anterior || anterior.desde.slice(5, 7) !== periodo.desde.slice(5, 7)
  return [String(Number(periodo.desde.slice(8))), cambiaMes ? mesCorto(periodo.desde) : '']
}

/** Al calendario, que es de donde se viene siempre. */
function volver() {
  if (router.canGoBack()) router.back()
  else router.replace('/historial')
}

export function Resumen() {
  const c = useColores()
  // Los colores de las rutinas dependen de los ajustes: se vuelve a pintar al cambiarlos.
  const actuales = useAjustes()
  const e = useEstilos(c)
  const parametros = useLocalSearchParams<{ mes?: string }>()
  const hoy = hoyLocal()
  const [mes, setMes] = useState(() => mesDeLaUrl(parametros.mes ?? null, hoy))
  const [porMes, setPorMes] = useState(false)
  const [barra, setBarra] = useState<string | null>(null)
  const [lectura, setLectura] = useState(0)

  const [datos, setDatos] = useState<DatosResumen | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  // Con su mes: el fallo de un mes no es el de otro.
  const [fallido, setFallido] = useState<{ mes: string; fallo: unknown } | null>(null)
  const error = fallido?.mes === mes ? fallido.fallo : null

  useEffect(() => {
    let vigente = true
    Promise.all([api.resumen(mes.slice(0, 7)), api.programas()])
      .then(([resumen, programas]) => {
        if (!vigente) return
        setDatos(resumen)
        setPrograma(programas.find((uno) => uno.activo) ?? null)
        setFallido(null)
      })
      .catch((fallo: unknown) => {
        if (vigente) setFallido({ mes, fallo })
      })
    return () => {
      vigente = false
    }
  }, [mes, lectura])

  /** Otro mes, con su última barra terminada. */
  function irAlMes(cuantos: number) {
    setMes(sumarMeses(mes, cuantos))
    setBarra(null)
  }

  // El mes del resumen, con flechas como el calendario (decisión del autor): las barras
  // acaban en ese mes. No se pasa del mes actual: uno sin empezar no tiene nada.
  const siguiente = sumarMeses(mes, 1)
  const selectorDeMes = (
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
        accessibilityState={{ disabled: siguiente > hoy }}
        disabled={siguiente > hoy}
        onPress={() => irAlMes(1)}
        style={[e.flecha, siguiente > hoy && { opacity: 0.35 }]}
      >
        <Icono nombre="abrir" color={c.texto} />
      </Pressable>
    </View>
  )

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="Resumen" alVolver={volver} />
        <View style={e.contenido}>
          {selectorDeMes}
          <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
        </View>
      </SafeAreaView>
    )
  }
  if (!datos || datos.mes !== mes) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="Resumen" alVolver={volver} />
        <View style={e.contenido}>
          {selectorDeMes}
          <Text style={e.aviso}>Cargando…</Text>
        </View>
      </SafeAreaView>
    )
  }

  const vista = porMes ? VISTAS.mes : VISTAS.semana
  const evolucion = porMes ? datos.por_mes : datos.por_semana
  const barras = evolucion.en_curso
    ? [...evolucion.periodos, evolucion.en_curso]
    : evolucion.periodos
  // La elegida; si no está en esta vista (o no hay), la última terminada.
  const elegida = barras.find((una) => una.desde === barra) ?? evolucion.periodos.at(-1)!
  const conSeries = elegida.series_por_grupo.length > 0
  const colorDe = (rutina: { id: number; oculto_desde: string | null }) =>
    rutina.oculto_desde ? sinDia(actuales) : colorDeRutina(programa?.dias, rutina.id, actuales)

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera titulo="Resumen" alVolver={volver} />
      <ScrollView contentContainerStyle={e.contenido}>
        {selectorDeMes}

        {/* Cambiar de vista vuelve a la última barra terminada (decisión del autor). */}
        <Selector
          etiqueta="Vista"
          opciones={OPCIONES_DE_VISTA}
          elegida={porMes ? 'mes' : 'semana'}
          alElegir={(clave) => {
            setPorMes(clave === 'mes')
            setBarra(null)
          }}
        />

        <Volumen
          evolucion={evolucion}
          elegida={elegida}
          vista={vista}
          porMes={porMes}
          hoy={hoy}
          alElegir={setBarra}
        />

        {/* El desglose sale siempre, también sin series (decisión del autor): así la pantalla
            tiene siempre la misma forma, y cada recuadro dice que no hay nada. */}
        <View style={e.tarjeta}>
          <TextoCentrado style={e.tituloTarjeta}>
            Volumen por rutina · {vista.enUnaFrase(elegida, hoy)}
          </TextoCentrado>
          {!conSeries ? (
            <Text style={e.vacio}>{vista.sinSeries}</Text>
          ) : elegida.volumen_por_rutina.length === 0 ? (
            <Text style={e.vacio}>{vista.sinPeso}</Text>
          ) : (
            <Reparto
              filas={elegida.volumen_por_rutina.map(({ rutina, volumen }) => ({
                clave: rutina.id,
                nombre: rutina.nombre,
                oculta: Boolean(rutina.oculto_desde),
                valor: Number(volumen),
                texto: enKilos(volumen),
                color: colorDe(rutina),
              }))}
            />
          )}
        </View>

        <View style={e.tarjeta}>
          <TextoCentrado style={e.tituloTarjeta}>
            Series por grupo muscular · {vista.enUnaFrase(elegida, hoy)}
          </TextoCentrado>
          {!conSeries ? (
            <Text style={e.vacio}>{vista.sinSeries}</Text>
          ) : (
            <Reparto
              filas={elegida.series_por_grupo.map(({ grupo_muscular, series }) => ({
                clave: grupo_muscular.id,
                nombre: grupo_muscular.nombre,
                valor: series,
                texto: series === 1 ? '1 serie' : `${series} series`,
                color: null,
              }))}
            />
          )}
        </View>

        <Constancia
          constancia={datos.constancia}
          anio={mes.slice(0, 4)}
          esteAnio={mes.slice(0, 4) === hoy.slice(0, 4)}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

/** Una barra rayada en diagonal: la en curso, que está a medias, elegida o no. */
function Rayada({
  alto,
  color,
  raya,
  id,
}: {
  alto: number
  color: string
  raya: string
  id: string
}) {
  return (
    <Svg width="100%" height={alto}>
      <Defs>
        <Pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width={10}
          height={10}
          patternTransform="rotate(45)"
        >
          <Rect x={0} y={0} width={6} height={10} fill={color} />
          <Rect x={6} y={0} width={4} height={10} fill={raya} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height={alto} fill={`url(#${id})`} />
    </Svg>
  )
}

/**
 * La tarjeta de volumen: las barras (la elegida en verde vivo y la en curso rayada), y arriba
 * el periodo elegido, su volumen y su cambio. Cada columna se toca entera.
 */
function Volumen({
  evolucion,
  elegida,
  vista,
  porMes,
  hoy,
  alElegir,
}: {
  evolucion: EvolucionDeVolumen
  elegida: PeriodoDeVolumen
  vista: Vista
  porMes: boolean
  hoy: string
  alElegir: (desde: string) => void
}) {
  const c = useColores()
  const e = useEstilos(c)
  const barras = evolucion.en_curso
    ? [...evolucion.periodos, evolucion.en_curso]
    : evolucion.periodos
  const maximo = Math.max(...barras.map((una) => Number(una.volumen)))
  // Sin ninguna serie en todo el rango no hay nada que enseñar; con series pero sin
  // ejercicios con peso, la tarjeta sale con el volumen vacío.
  const sinNada = barras.every((una) => una.series_por_grupo.length === 0)
  const enCurso = elegida === evolucion.en_curso

  return (
    <View style={e.tarjeta}>
      <TextoCentrado style={e.tituloTarjeta}>{vista.titulo}</TextoCentrado>
      {maximo === 0 && sinNada ? (
        <Text style={e.vacio}>{vista.vacio}</Text>
      ) : (
        <>
          <Text style={e.periodo}>
            {vista.periodo(elegida, hoy)}
            {enCurso && ' (en curso)'}
          </Text>
          {elegida.series_por_grupo.length === 0 ? (
            <Text style={e.sinSeries}>{vista.sinSeries}</Text>
          ) : Number(elegida.volumen) === 0 ? (
            <Text style={e.sinSeries}>{vista.sinPeso}</Text>
          ) : (
            <View style={e.cifraVertical}>
              <Text style={e.valor}>{enKilos(elegida.volumen)}</Text>
              {elegida.cambio !== null && elegida.comparado_con !== null && (
                <Text style={[e.cambio, elegida.cambio > 0 && { color: c.acento }]}>
                  {porcentaje(elegida.cambio)} sobre{' '}
                  {vista.comparadoCon(elegida, elegida.comparado_con)}
                </Text>
              )}
            </View>
          )}
          <View style={e.barras}>
            {barras.map((una, indice) => {
              const [arriba, abajo] = etiqueta(una, barras[indice - 1], porMes)
              const esElegida = una === elegida
              const alto = (Number(una.volumen) / (maximo || 1)) * ALTO_VOLUMEN
              return (
                <Pressable
                  key={una.desde}
                  accessibilityRole="button"
                  accessibilityState={{ selected: esElegida }}
                  accessibilityLabel={`${vista.periodo(una, hoy)}: ${enKilos(una.volumen)}`}
                  onPress={() => alElegir(una.desde)}
                  style={e.columna}
                >
                  <View style={[e.pista, { height: ALTO_VOLUMEN }]}>
                    {alto > 0 && (
                      <View style={[e.barra, { height: alto }]}>
                        {una === evolucion.en_curso ? (
                          <Rayada
                            id={`rayas-${una.desde}`}
                            alto={alto}
                            color={esElegida ? c.acento : c.barra}
                            raya={esElegida ? c.acentoRaya : c.barraRaya}
                          />
                        ) : (
                          <View
                            style={{ flex: 1, backgroundColor: esElegida ? c.acento : c.barra }}
                          />
                        )}
                      </View>
                    )}
                  </View>
                  <Text style={[e.eje, esElegida && e.ejeElegido]}>
                    {arriba}
                    {'\n'}
                    {abajo || ' '}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </>
      )}
      {/* Dentro de la tarjeta y bajo las barras (decisión del autor): al final de la pantalla
          no se veía a qué se refería. */}
      {!sinNada && (
        <TextoCentrado style={e.pie}>
          {vista.leyenda}
          {evolucion.en_curso ? `\n${vista.enCurso}` : ''}
          {'\nSolo cuentan los ejercicios de peso y repeticiones.'}
        </TextoCentrado>
      )}
    </View>
  )
}

type FilaDeReparto = {
  clave: number
  nombre: string
  oculta?: boolean
  valor: number
  texto: string
  // Sin color de identidad, barra gris y sin punto: un ranking no necesita un color por
  // fila, y uno inventado se confundiría con los de los días.
  color: string | null
}

/** Una barra horizontal por fila, relativa a la mayor (que ocupa todo el ancho). */
function Reparto({ filas }: { filas: FilaDeReparto[] }) {
  const c = useColores()
  const e = useEstilos(c)
  const maximo = Math.max(...filas.map((fila) => fila.valor), 1)
  return (
    <View style={e.reparto}>
      {filas.map((fila) => (
        <View key={fila.clave} style={e.repartoFila}>
          <View style={e.fila}>
            {fila.color && <View style={[e.punto, { backgroundColor: fila.color }]} />}
            <View style={e.nombre}>
              <Text style={e.nombreTexto}>{fila.nombre}</Text>
              {fila.oculta && <Text style={e.etiqueta}>oculta</Text>}
            </View>
            {/* «6.758 kg», «3 series»: a la derecha, aunque el nombre ocupe dos líneas. */}
            <Text style={e.filaCifra}>{fila.texto}</Text>
          </View>
          <View style={e.carril}>
            <View
              style={{
                width: `${(fila.valor / maximo) * 100}%`,
                height: '100%',
                borderRadius: 4,
                backgroundColor: fila.color ?? c.textoTenue,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  )
}

/**
 * La constancia del año: por mes, en gris lo planificado (también lo que aún no ha llegado) y
 * en verde lo entrenado, que lo va llenando. La cifra, solo hasta hoy.
 */
function Constancia({
  constancia,
  anio,
  esteAnio,
}: {
  constancia: DatosResumen['constancia']
  anio: string
  esteAnio: boolean
}) {
  const c = useColores()
  const e = useEstilos(c)
  const maximo = Math.max(...constancia.meses.map((mes) => mes.planificados + mes.por_llegar))

  return (
    <View style={e.tarjeta}>
      <TextoCentrado style={e.tituloTarjeta}>Constancia · {anio}</TextoCentrado>
      {maximo === 0 ? (
        <Text style={e.vacio}>No hay días planificados en {anio}.</Text>
      ) : (
        <>
          <View style={e.leyenda}>
            <View style={e.leyendaParte}>
              <View style={[e.muestra, { backgroundColor: c.acento }]} />
              <Text style={e.leyendaTexto}>Entrenados</Text>
            </View>
            <View style={e.leyendaParte}>
              <View style={[e.muestra, { backgroundColor: c.barraVacia }]} />
              <Text style={e.leyendaTexto}>Planificados</Text>
            </View>
          </View>
          <View style={e.cifra}>
            <Text style={e.valor}>
              {constancia.entrenados}
              <Text style={e.valorPequeno}> / {constancia.planificados}</Text>
            </Text>
            <Text style={e.cambio}>
              {esteAnio ? 'días entrenados, hasta hoy' : `días entrenados en ${anio}`}
            </Text>
          </View>
          <View style={[e.barras, e.estrechas]}>
            {constancia.meses.map((mes, indice) => {
              const total = mes.planificados + mes.por_llegar
              return (
                <View key={mes.mes} style={e.columna}>
                  <View style={[e.pista, { height: ALTO_CONSTANCIA }]}>
                    <View
                      style={[
                        e.planificado,
                        {
                          height: (total / maximo) * ALTO_CONSTANCIA,
                          backgroundColor: c.barraVacia,
                        },
                      ]}
                    >
                      <View
                        style={[
                          e.entrenado,
                          {
                            height: (mes.entrenados / maximo) * ALTO_CONSTANCIA,
                            backgroundColor: c.acento,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={e.eje}>{INICIALES_MES[indice]}</Text>
                </View>
              )
            })}
          </View>
        </>
      )}
    </View>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 14 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue },
    mes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    flecha: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    mesTitulo: { fontSize: 17, fontWeight: '600', color: c.texto },
    tarjeta: {
      gap: 10,
      paddingTop: 14,
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    tituloTarjeta: { fontSize: 13, color: c.textoTenue },
    vacio: { paddingVertical: 12, textAlign: 'center', fontSize: 14, color: c.textoTenue },
    periodo: { textAlign: 'center', fontSize: 13, fontWeight: '600', color: c.texto },
    sinSeries: { textAlign: 'center', fontSize: 14, color: c.textoTenue },
    pie: { fontSize: 12.5, lineHeight: 17, color: c.textoTenue },
    cifra: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: 10,
    },
    // La del volumen: la cifra y, debajo, cuánto ha cambiado, siempre en dos líneas y
    // centradas, sea cual sea lo largo del texto de la comparación.
    cifraVertical: { alignItems: 'center', gap: 2 },
    valor: { fontSize: 26, fontWeight: '700', lineHeight: 29, color: c.texto },
    valorPequeno: { fontSize: 14, fontWeight: '500', color: c.textoTenue },
    cambio: { fontSize: 13, color: c.textoTenue, textAlign: 'center' },
    // Por arriba: todas las pistas miden lo mismo, así que las barras empiezan al mismo nivel
    // aunque la fecha de debajo de una ocupe más líneas que la de otra.
    barras: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    estrechas: { gap: 4 },
    columna: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
    pista: { width: '100%', justifyContent: 'flex-end' },
    barra: {
      width: '100%',
      overflow: 'hidden',
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
    },
    eje: { fontSize: 10.5, lineHeight: 14, color: c.textoTenue, textAlign: 'center' },
    ejeElegido: { color: c.texto, fontWeight: '700' },
    planificado: {
      width: '100%',
      justifyContent: 'flex-end',
      overflow: 'hidden',
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
    },
    entrenado: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    leyenda: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      rowGap: 6,
      columnGap: 14,
    },
    leyendaParte: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    leyendaTexto: { fontSize: 12, color: c.textoTenue },
    muestra: { width: 8, height: 8, borderRadius: 2 },
    reparto: { gap: 12 },
    repartoFila: { gap: 4 },
    fila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    punto: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
    nombre: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    nombreTexto: { flexShrink: 1, fontSize: 13, color: c.texto },
    filaCifra: { flexShrink: 0, fontSize: 13, color: c.textoTenue },
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
    carril: { height: 8, backgroundColor: c.fondo, borderRadius: 4, overflow: 'hidden' },
  })
}
