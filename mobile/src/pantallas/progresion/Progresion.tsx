/**
 * H3 · La progresión de un ejercicio: una gráfica con un punto por sesión (peso más alto,
 * volumen, 1RM estimado… según el tipo) y debajo las sesiones con sus series. Puerto de
 * `web/src/paginas/progresion/Progresion.tsx`.
 *
 * Vive en la pila de Historial, que es la pestaña que marca en la web. Se llega desde el día
 * del historial (la flecha de cada ejercicio) y desde la ficha de un ejercicio, que la abre con
 * `ficha` en los parámetros: su flecha y el atrás de Android vuelven entonces a esa ficha.
 *
 * Diferencias con la web: el rango y la medida no van en la ruta (aquí no se recarga), salvo la
 * medida con la que se abre desde la ficha.
 */
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Cabecera } from '../../componentes/Cabecera'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { Selector } from '../../componentes/Selector'
import type { Ejercicio, SesionHistorial } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, useColores, type Colores } from '../../tema'
import { diaYMesConAnio, diasEntre, fechaAbreviada, hoy, sumarDias } from '../../utiles/fechas'
import { medidasDe, valorEnPantalla } from '../../utiles/progresion'
import { FichasUltimaVez } from '../sesion/FichasUltimaVez'
import { Grafica, type Punto } from './Grafica'

const RANGOS = [
  { clave: '1m', texto: '1 mes', dias: 30 },
  { clave: '3m', texto: '3 meses', dias: 91 },
  { clave: '6m', texto: '6 meses', dias: 182 },
  { clave: 'todo', texto: 'Todo', dias: null },
] as const

type Rango = (typeof RANGOS)[number]

// Las sesiones que se enseñan antes de "Ver N sesiones más".
const VISIBLES = 4

/**
 * El rango con el que se abre, si no se ha elegido otro: el más corto en el que cabe todo el
 * historial del ejercicio, desde la primera sesión (decisión del autor, 15-10-2026). Así nunca
 * abre con una gráfica casi vacía, y con mucho historial abre en Todo. Sin sesiones, el más
 * corto, con su aviso.
 */
function rangoPorDefecto(sesiones: SesionHistorial[]): Rango {
  // De la más reciente a la más antigua: la primera de todas es la última.
  const primera = sesiones.at(-1)
  if (!primera) return RANGOS[0]
  const dias = diasEntre(primera.fecha, hoy())
  return RANGOS.find((r) => r.dias !== null && dias <= r.dias) ?? RANGOS[RANGOS.length - 1]
}

/** A la ficha del ejercicio si se vino de ella; si no, a la pantalla de debajo (el día). */
function volverDeLaProgresion(ficha: string | undefined) {
  if (ficha) {
    router.navigate({ pathname: '/ejercicios/[id]', params: { id: ficha } }, { withAnchor: true })
  } else if (router.canGoBack()) router.back()
  else router.replace('/historial')
}

export function Progresion() {
  const c = useColores()
  const e = useEstilos(c)
  const {
    id: idDeLaRuta = '',
    medida: medidaInicial,
    ficha,
  } = useLocalSearchParams<{ id: string; medida?: string; ficha?: string }>()
  const id = Number(idDeLaRuta)
  const [ejercicio, setEjercicio] = useState<Ejercicio | null>(null)
  // De la más reciente a la más antigua, como las da la lógica.
  const [sesiones, setSesiones] = useState<SesionHistorial[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [lectura, setLectura] = useState(0)
  const [rangoElegido, setRangoElegido] = useState<Rango['clave'] | null>(null)
  const [medidaElegida, setMedidaElegida] = useState<string | undefined>(medidaInicial)
  const [elegido, setElegido] = useState<number | null>(null)
  const [todas, setTodas] = useState(false)

  useEffect(() => {
    let vigente = true
    Promise.all([api.ejercicio(id), api.historialDeEjercicio(id, { limite: 500 })])
      .then(([datosEjercicio, historial]) => {
        if (!vigente) return
        setEjercicio(datosEjercicio)
        setSesiones(historial)
        setError(null)
      })
      .catch((fallo: unknown) => {
        if (vigente) setError(fallo)
      })
    return () => {
      vigente = false
    }
  }, [id, lectura])

  const volver = useCallback(() => volverDeLaProgresion(ficha), [ficha])

  // Abierta desde la ficha, el atrás de Android vuelve a ella, como la flecha.
  useEffect(() => {
    if (!ficha) return
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      volver()
      return true
    })
    return () => suscripcion.remove()
  }, [ficha, volver])

  function cambiarRango(clave: Rango['clave']) {
    setRangoElegido(clave)
    setElegido(null)
    setTodas(false)
  }

  function cambiarMedida(clave: string) {
    setMedidaElegida(clave)
    setElegido(null)
    setTodas(false)
  }

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="" alVolver={volver} />
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!ejercicio || !sesiones) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="" alVolver={volver} />
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const rango = RANGOS.find((r) => r.clave === rangoElegido) ?? rangoPorDefecto(sesiones)
  const desde = rango.dias === null ? null : sumarDias(hoy(), -rango.dias)
  const enRango = sesiones.filter((sesion) => desde === null || sesion.fecha >= desde)
  // Las medidas dependen de cómo se apunta y de lo apuntado en el rango: un cardio sin
  // distancia en este mes abre en Tiempo, no en una gráfica vacía. La elegida, si no es una
  // de ellas, es la primera.
  const medidas = medidasDe(ejercicio.tipo_registro, enRango)
  const medida = medidas.find((m) => m.clave === medidaElegida) ?? medidas[0]
  // Las sesiones que cuentan en esta medida: la distancia y el ritmo, solo las que la apuntaron.
  const paraLaMedida = enRango.filter((sesion) => medida.aplica?.(sesion) ?? true)
  const puntos: Punto[] = [...paraLaMedida].reverse().map((sesion) => {
    // En la unidad elegida: la gráfica y los textos ya no convierten.
    const valor = valorEnPantalla(medida, sesion)
    return {
      id: sesion.entrenamiento_id,
      fecha: sesion.fecha,
      valor,
      detalle: medida.globo(sesion, valor),
    }
  })
  const ultimo = puntos.at(-1)
  const primero = puntos[0]
  const visibles = todas ? enRango : enRango.slice(0, VISIBLES)

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera titulo={ejercicio.nombre} subtitulo="Progresión" alVolver={volver} />
      <ScrollView contentContainerStyle={e.contenido}>
        <Selector
          etiqueta="Rango"
          opciones={RANGOS}
          elegida={rango.clave}
          alElegir={cambiarRango}
        />

        {enRango.length === 0 || !ultimo || !primero ? (
          <Text style={e.vacio}>
            {sesiones.length === 0
              ? 'Aún no has hecho este ejercicio.'
              : 'No lo has hecho en este tiempo. Prueba con un rango más largo.'}
          </Text>
        ) : (
          <>
            <View style={e.tarjeta}>
              <Selector
                pequeno
                etiqueta="Medida"
                opciones={medidas}
                elegida={medida.clave}
                alElegir={cambiarMedida}
              />
              {/* La cifra a la izquierda y el cambio a la derecha, alineados por abajo. */}
              <View style={e.cifra}>
                <View style={e.ladoIzquierdo}>
                  <Text style={e.rotulo}>{medida.rotulo}</Text>
                  <Text style={e.valor}>{medida.escribir(ultimo.valor)}</Text>
                </View>
                <View style={e.ladoDerecho}>
                  {puntos.length > 1 && (
                    <Text style={e.cambio}>
                      {medida.cambio(ultimo.valor - primero.valor)} desde el{' '}
                      {diaYMesConAnio(primero.fecha)}
                    </Text>
                  )}
                  <Text style={e.cambio}>
                    {puntos.length === 1 ? '1 sesión' : `${puntos.length} sesiones`}
                  </Text>
                </View>
              </View>
              <Grafica
                puntos={puntos}
                elegido={elegido}
                alElegir={setElegido}
                formatoDeMarca={medida.marca}
                divisor={medida.enMinutos ? 60 : 1}
                pasos={medida.pasos}
                // Todo, a la escala de 6 meses: con más, se desliza de lado.
                diasVisibles={rango.dias === null ? 182 : undefined}
              />
            </View>

            <View style={e.bloque}>
              <Text style={e.rotulo}>Sesiones</Text>
              <View style={e.lista}>
                {visibles.map((sesion, indice) => (
                  <View
                    key={sesion.entrenamiento_id}
                    style={[e.sesion, indice > 0 && { borderTopWidth: 1, borderTopColor: c.borde }]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: '/historial/[fecha]',
                          params: { fecha: sesion.fecha },
                        })
                      }
                      style={e.fila}
                    >
                      <Text style={e.fecha}>{fechaAbreviada(sesion.fecha)}</Text>
                      {sesion.rutina && (
                        <Text style={e.etiqueta} numberOfLines={1}>
                          {sesion.rutina}
                        </Text>
                      )}
                      <View style={e.relleno} />
                      <Icono nombre="abrir" color={c.textoTenue} pequeno />
                    </Pressable>
                    <FichasUltimaVez tipo={ejercicio.tipo_registro} series={sesion.series} />
                  </View>
                ))}
              </View>
              {!todas && enRango.length > VISIBLES && (
                <Pressable accessibilityRole="button" onPress={() => setTodas(true)} style={e.mas}>
                  <Text style={e.masTexto}>
                    {enRango.length - VISIBLES === 1
                      ? 'Ver 1 sesión más'
                      : `Ver ${enRango.length - VISIBLES} sesiones más`}
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 12 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue, padding: 16 },
    vacio: { fontSize: 15, lineHeight: 21, color: c.textoTenue },
    tarjeta: {
      gap: 8,
      paddingTop: 14,
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    cifra: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 4,
      paddingTop: 12,
      paddingHorizontal: 6,
      paddingBottom: 4,
      borderTopWidth: 1,
      borderTopColor: c.borde,
    },
    // La cifra nunca se parte («12 / kg»): el que cede es el texto de la derecha.
    ladoIzquierdo: { flexShrink: 0, gap: 2 },
    ladoDerecho: { flexShrink: 1, minWidth: 0, alignItems: 'flex-end', gap: 2 },
    rotulo: { fontSize: 13, color: c.textoTenue },
    valor: { fontSize: 26, fontWeight: '700', lineHeight: 29, color: c.texto },
    cambio: { fontSize: 13, color: c.textoTenue, textAlign: 'right' },
    bloque: { gap: 8 },
    lista: {
      paddingHorizontal: 16,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    sesion: { gap: 8, paddingVertical: 12 },
    fila: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
    fecha: { fontSize: 14, fontWeight: '600', color: c.texto },
    // `.etiqueta-chica` de la web.
    etiqueta: {
      flexShrink: 1,
      fontSize: 11,
      color: c.textoTenue,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 1,
      paddingHorizontal: 7,
    },
    relleno: { flexGrow: 1 },
    mas: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    masTexto: { fontSize: 14, fontWeight: '600', color: c.textoTenue },
  })
}
