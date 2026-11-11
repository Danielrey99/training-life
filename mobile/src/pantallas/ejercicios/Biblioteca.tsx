/**
 * X1 · Ejercicios: la biblioteca, con los predefinidos y los tuyos. Se busca por nombre y se
 * filtra por origen y por grupo muscular; los ocultos van plegados al pie. Puerto de
 * `web/src/paginas/ejercicios/Biblioteca.tsx`.
 *
 * Diferencia con la web: la búsqueda, los filtros y los ocultos abiertos no van en la ruta,
 * porque aquí la pantalla se queda montada debajo de la ficha y al volver siguen igual. Por
 * eso mismo relee al volver: el ejercicio se puede haber creado, cambiado, ocultado o borrado.
 */
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { Ocultos } from '../../componentes/Ocultos'
import { RecuadroVacio } from '../../componentes/RecuadroVacio'
import type { Ejercicio, GrupoMuscular } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, RADIO_PEQUENO, useColores, type Colores } from '../../tema'
import { diaYMesConAnio } from '../../utiles/fechas'
import { TODOS_LOS_GRUPOS } from '../programas/DesplegableDeGrupo'
import { HojaDeGrupos } from './HojaDeGrupos'

const ORIGENES = [
  { clave: 'todos', texto: 'Todos' },
  { clave: 'predefinidos', texto: 'Predefinidos' },
  { clave: 'mios', texto: 'Míos' },
] as const

type Origen = (typeof ORIGENES)[number]['clave']

type Datos = {
  visibles: Ejercicio[]
  ocultos: Ejercicio[]
  grupos: GrupoMuscular[]
}

/** Sin mayúsculas ni tildes, para que "jalon" encuentre "Jalón en polea". */
function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function delOrigen(ejercicio: Ejercicio, origen: Origen) {
  if (origen === 'todos') return true
  return ejercicio.es_predefinido === (origen === 'predefinidos')
}

export function Biblioteca() {
  const c = useColores()
  const e = useEstilos(c)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [texto, setTexto] = useState('')
  const [origen, setOrigen] = useState<Origen>('todos')
  const [grupo, setGrupo] = useState<number | null>(null)
  const [verOcultos, setVerOcultos] = useState(false)
  const [eligiendoGrupo, setEligiendoGrupo] = useState(false)
  const [lectura, setLectura] = useState(0)

  useFocusEffect(
    useCallback(() => {
      let vigente = true
      Promise.all([api.ejercicios(), api.ejercicios({ ocultos: true }), api.gruposMusculares()])
        .then(([visibles, ocultos, grupos]) => {
          if (!vigente) return
          setDatos({ visibles, ocultos, grupos })
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

  const nombreDeGrupo = new Map(datos.grupos.map((uno) => [uno.id, uno.nombre]))
  const buscado = normalizar(texto.trim())
  const encaja = (ejercicio: Ejercicio) =>
    delOrigen(ejercicio, origen) &&
    (grupo === null || ejercicio.grupo_muscular_id === grupo) &&
    normalizar(ejercicio.nombre).includes(buscado)
  const lista = datos.visibles.filter(encaja)
  const ocultos = datos.ocultos.filter(encaja)
  // Solo los grupos con algo que enseñar en el origen elegido: uno vacío no lleva a nada.
  const conEjercicios = datos.grupos
    .filter((uno) =>
      [...datos.visibles, ...datos.ocultos].some(
        (ejercicio) => ejercicio.grupo_muscular_id === uno.id && delOrigen(ejercicio, origen),
      ),
    )
    .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'))
  const sinPropios = ![...datos.visibles, ...datos.ocultos].some(
    (ejercicio) => !ejercicio.es_predefinido,
  )

  // Sin ninguno propio a la vista, crear uno es lo único que se puede hacer aquí.
  const nuevo = (
    <Boton
      texto="Nuevo ejercicio"
      variante={origen === 'mios' && sinPropios ? 'principal' : 'normal'}
      alPulsar={() => router.push('/ejercicios/nuevo')}
    />
  )

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido} keyboardShouldPersistTaps="handled">
        <Text style={e.titulo} accessibilityRole="header">
          Ejercicios
        </Text>

        <View style={e.filtros}>
          <View style={e.buscador}>
            <Icono nombre="buscar" color={c.textoTenue} pequeno />
            <TextInput
              accessibilityLabel="Buscar ejercicio"
              placeholder="Buscar ejercicio"
              placeholderTextColor={c.textoTenue}
              value={texto}
              onChangeText={setTexto}
              style={e.buscadorTexto}
            />
          </View>

          <View style={e.selector} accessibilityRole="radiogroup" accessibilityLabel="Origen">
            {ORIGENES.map((opcion) => {
              const activa = opcion.clave === origen
              return (
                <Pressable
                  key={opcion.clave}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: activa }}
                  onPress={() => setOrigen(opcion.clave)}
                  style={[e.opcion, activa && e.opcionActiva]}
                >
                  <Text style={[e.opcionTexto, activa && { color: c.acento }]}>{opcion.texto}</Text>
                </Pressable>
              )
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Grupo muscular"
            onPress={() => setEligiendoGrupo(true)}
            style={[e.grupo, grupo !== null && { borderColor: c.acento }]}
          >
            <Text style={[e.grupoTexto, grupo !== null && { color: c.acento }]}>
              {grupo === null ? TODOS_LOS_GRUPOS : (nombreDeGrupo.get(grupo) ?? TODOS_LOS_GRUPOS)}
            </Text>
            <Icono nombre="abajo" color={grupo === null ? c.textoTenue : c.acento} pequeno />
          </Pressable>
        </View>

        {lista.length > 0 ? (
          <>
            <View style={e.lista}>
              {lista.map((ejercicio, indice) => (
                <FilaDeEjercicio
                  key={ejercicio.id}
                  ejercicio={ejercicio}
                  grupos={nombreDeGrupo}
                  primera={indice === 0}
                />
              ))}
            </View>
            {nuevo}
          </>
        ) : (
          <>
            <RecuadroVacio>
              {origen === 'mios' && sinPropios
                ? 'Todavía no has creado ningún ejercicio.'
                : 'Ningún ejercicio coincide con lo que buscas.'}
            </RecuadroVacio>
            {nuevo}
          </>
        )}

        <Ocultos
          cuantos={ocultos.length}
          singular="ejercicio oculto"
          plural="ejercicios ocultos"
          abierto={verOcultos}
          alAlternar={() => setVerOcultos(!verOcultos)}
        />
        {verOcultos && ocultos.length > 0 && (
          <View style={[e.lista, e.discontinuo]}>
            {ocultos.map((ejercicio, indice) => (
              <FilaDeEjercicio
                key={ejercicio.id}
                ejercicio={ejercicio}
                grupos={nombreDeGrupo}
                primera={indice === 0}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {eligiendoGrupo && (
        <HojaDeGrupos
          grupos={conEjercicios}
          elegido={grupo}
          alElegir={(elegido) => {
            setGrupo(elegido)
            setEligiendoGrupo(false)
          }}
          alCerrar={() => setEligiendoGrupo(false)}
        />
      )}
    </SafeAreaView>
  )
}

/** "Press banca con barra / Pecho · mío"; uno oculto dice además desde cuándo. */
function FilaDeEjercicio({
  ejercicio,
  grupos,
  primera,
}: {
  ejercicio: Ejercicio
  grupos: Map<number, string>
  primera: boolean
}) {
  const c = useColores()
  const e = useEstilos(c)
  const detalle = [
    grupos.get(ejercicio.grupo_muscular_id) ?? 'Sin grupo',
    ejercicio.es_predefinido ? 'predefinido' : 'mío',
  ]
  if (ejercicio.oculto_desde) {
    detalle.push(`oculto desde el ${diaYMesConAnio(ejercicio.oculto_desde)}`)
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/ejercicios/[id]', params: { id: String(ejercicio.id) } })
      }
      style={({ pressed }) => [
        e.fila,
        !primera && { borderTopWidth: 1, borderTopColor: c.borde },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={e.filaTexto}>
        <Text style={[e.filaNombre, ejercicio.oculto_desde !== null && { color: c.textoTenue }]}>
          {ejercicio.nombre}
        </Text>
        <Text style={e.linea}>{detalle.join(' · ')}</Text>
      </View>
      <Icono nombre="abrir" color={c.textoTenue} pequeno />
    </Pressable>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, gap: 12 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue, padding: 16 },
    titulo: { fontSize: 22, fontWeight: '700', textAlign: 'center', color: c.texto },
    filtros: { gap: 10, marginBottom: 6 },
    buscador: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      backgroundColor: c.fondo,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO_PEQUENO,
    },
    buscadorTexto: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 0, color: c.texto },
    // El selector grande de la web (38 px, letra de 14): es un filtro de la pantalla.
    selector: {
      flexDirection: 'row',
      gap: 3,
      padding: 3,
      backgroundColor: c.fondo,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    opcion: {
      flex: 1,
      minHeight: 38,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'transparent',
      borderRadius: RADIO_PEQUENO,
    },
    opcionActiva: { backgroundColor: c.superficie, borderColor: c.borde },
    opcionTexto: { fontSize: 14, fontWeight: '600', color: c.textoTenue },
    grupo: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      backgroundColor: c.fondo,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO_PEQUENO,
    },
    grupoTexto: { flex: 1, fontSize: 15, color: c.texto },
    lista: {
      paddingHorizontal: 16,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    discontinuo: { borderStyle: 'dashed' },
    fila: {
      minHeight: 60,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    filaTexto: { flex: 1, minWidth: 0 },
    filaNombre: { fontSize: 15, fontWeight: '600', color: c.texto },
    linea: { fontSize: 13, color: c.textoTenue },
  })
}
