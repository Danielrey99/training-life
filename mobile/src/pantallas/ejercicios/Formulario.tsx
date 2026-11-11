/**
 * X3 · Ejercicio nuevo o editar uno tuyo: nombre, grupo muscular, cómo se apunta y una
 * descripción opcional. Puerto de `web/src/paginas/ejercicios/Formulario.tsx`. Cómo se apunta
 * se elige al crearlo y no se puede cambiar: decide qué lleva cada serie, y cambiarlo dejaría
 * series que no cuadran. Lo que es de cada uno (un ajuste, cómo le sale mejor) va en las notas
 * de la ficha, no aquí: la descripción es del ejercicio.
 *
 * Nada se guarda hasta pulsar *Guardar*. Un predefinido o uno oculto no se editan: si se llega
 * a su ruta, se vuelve a la ficha, que explica por qué.
 *
 * Diferencia con la web: el grupo se elige en una hoja (aquí no hay `<select>`).
 */
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Cabecera } from '../../componentes/Cabecera'
import { CampoDeNombre } from '../../componentes/CampoDeNombre'
import { Desplazable } from '../../componentes/Desplazable'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { esDelCampo, textoDelFallo } from '../../logica/api'
import type { GrupoMuscular, TipoRegistro } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, RADIO_PEQUENO, useColores, type Colores } from '../../tema'
import { HojaDeGrupos } from './HojaDeGrupos'
import { TIPOS } from './tiposDeRegistro'

type Falta = { nombre?: string; grupo?: string }

/** A la ficha o a la biblioteca, de donde se vino. */
function volver(id: number | null) {
  if (router.canGoBack()) router.back()
  else if (id === null) router.replace('/ejercicios')
  else router.replace({ pathname: '/ejercicios/[id]', params: { id: String(id) } })
}

export function Formulario() {
  const c = useColores()
  const e = useEstilos(c)
  const { id: idDeLaRuta } = useLocalSearchParams<{ id?: string }>()
  const id = idDeLaRuta === undefined ? null : Number(idDeLaRuta)
  const [grupos, setGrupos] = useState<GrupoMuscular[] | null>(null)
  const [nombre, setNombre] = useState('')
  const [grupo, setGrupo] = useState<number | null>(null)
  const [descripcion, setDescripcion] = useState('')
  const [tipo, setTipo] = useState<TipoRegistro>('peso_reps')
  const [error, setError] = useState<unknown>(null)
  const [falta, setFalta] = useState<Falta>({})
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [eligiendoGrupo, setEligiendoGrupo] = useState(false)
  const [lectura, setLectura] = useState(0)

  useEffect(() => {
    let vigente = true
    Promise.all([api.gruposMusculares(), id === null ? null : api.ejercicio(id)])
      .then(([todos, ejercicio]) => {
        if (!vigente) return
        if (ejercicio && (ejercicio.es_predefinido || ejercicio.oculto_desde !== null)) {
          router.replace({ pathname: '/ejercicios/[id]', params: { id: String(ejercicio.id) } })
          return
        }
        if (ejercicio) {
          setNombre(ejercicio.nombre)
          setGrupo(ejercicio.grupo_muscular_id)
          setDescripcion(ejercicio.descripcion ?? '')
          setTipo(ejercicio.tipo_registro)
        }
        setGrupos(todos.sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es')))
        setError(null)
      })
      .catch((problema: unknown) => {
        if (vigente) setError(problema)
      })
    return () => {
      vigente = false
    }
    // `lectura` solo sirve para que Reintentar vuelva a pedirlo.
  }, [id, lectura])

  /** Lo que falta, con un mensaje legible: mejor que el 422 de la lógica. */
  function queFalta(): Falta {
    const pendiente: Falta = {}
    if (nombre.trim() === '') pendiente.nombre = 'Escribe cómo se llama.'
    if (grupo === null) pendiente.grupo = 'Elige el grupo muscular que trabaja.'
    return pendiente
  }

  async function guardar() {
    const pendiente = queFalta()
    setFalta(pendiente)
    if (pendiente.nombre || pendiente.grupo) return

    setGuardando(true)
    setFallo(null)
    const datos = {
      nombre: nombre.trim(),
      grupo_muscular_id: grupo!,
      descripcion: descripcion.trim() === '' ? null : descripcion.trim(),
    }
    try {
      if (id === null) {
        const creado = await api.crearEjercicio({ ...datos, tipo_registro: tipo })
        // Con replace: volver desde la ficha lleva a la biblioteca, no al formulario.
        router.replace({ pathname: '/ejercicios/[id]', params: { id: String(creado.id) } })
      } else {
        await api.actualizarEjercicio(id, datos)
        volver(id)
      }
    } catch (problema) {
      // El nombre de otro ejercicio: bajo su campo, que es lo que hay que cambiar.
      if (esDelCampo(problema, 'nombre')) {
        setFalta({ nombre: problema.message })
      } else {
        setFallo(textoDelFallo(problema))
      }
      setGuardando(false)
    }
  }

  const titulo = id === null ? 'Nuevo ejercicio' : 'Editar ejercicio'

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo={titulo} alVolver={() => volver(id)} />
        <FalloAlCargar fallo={error} alReintentar={() => setLectura((n) => n + 1)} />
      </SafeAreaView>
    )
  }
  if (!grupos) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Text style={e.aviso}>Cargando…</Text>
      </SafeAreaView>
    )
  }

  const nombreDelGrupo = grupos.find((uno) => uno.id === grupo)?.nombre

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo={titulo}
        alVolver={() => volver(id)}
        derecha={{ texto: 'Guardar', alPulsar: () => void guardar(), desactivado: guardando }}
      />

      <Desplazable contentContainerStyle={e.contenido}>
        {fallo && <Text style={e.fallo}>{fallo}</Text>}

        <CampoDeNombre
          valor={nombre}
          alCambiar={(valor) => {
            setNombre(valor)
            setFalta((antes) => ({ ...antes, nombre: undefined }))
          }}
          fallo={falta.nombre ?? null}
          ejemplo="Ej. Jalón en polea"
          desactivado={guardando}
        />

        <View style={e.campo}>
          <Text style={e.etiqueta}>Grupo muscular</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Grupo muscular"
            onPress={() => setEligiendoGrupo(true)}
            disabled={guardando}
            style={[e.caja, e.desplegable, falta.grupo && { borderColor: c.error }]}
          >
            <Text style={[e.cajaTexto, !nombreDelGrupo && { color: c.textoTenue }]}>
              {nombreDelGrupo ?? 'Elige uno'}
            </Text>
            <Icono nombre="abajo" color={c.textoTenue} pequeno />
          </Pressable>
          {falta.grupo && <Text style={e.fallo}>{falta.grupo}</Text>}
        </View>

        <View style={e.campo}>
          <Text style={[e.etiqueta, e.etiquetaDelTipo]}>Cómo se apunta</Text>
          {id === null ? (
            <>
              {TIPOS.map((opcion) => {
                const elegida = opcion.clave === tipo
                return (
                  <Pressable
                    key={opcion.clave}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: elegida }}
                    onPress={() => setTipo(opcion.clave)}
                    disabled={guardando}
                    style={[e.tipo, elegida && { borderColor: c.acento }]}
                  >
                    <View style={[e.marca, elegida && { borderColor: c.acento }]}>
                      {elegida && <View style={e.punto} />}
                    </View>
                    <View style={e.tipoTexto}>
                      <Text style={e.tipoNombre}>{opcion.nombre}</Text>
                      <Text style={e.tipoAyuda}>{opcion.ayuda}</Text>
                    </View>
                  </Pressable>
                )
              })}
              <Text style={e.tipoAviso}>Se elige al crearlo y no se puede cambiar después.</Text>
            </>
          ) : (
            <>
              <View style={[e.caja, e.desplegable, { backgroundColor: c.superficie }]}>
                <Text style={[e.cajaTexto, { color: c.textoTenue }]}>
                  {TIPOS.find((opcion) => opcion.clave === tipo)?.nombre}
                </Text>
                <Icono nombre="candado" color={c.textoTenue} pequeno />
              </View>
              <Text style={e.tipoAviso}>
                No se puede cambiar. Si no es el que querías, crea otro ejercicio y borra este.
              </Text>
            </>
          )}
        </View>

        <View style={e.campo}>
          <Text style={e.etiqueta}>Descripción (opcional)</Text>
          <TextInput
            accessibilityLabel="Descripción"
            style={[e.caja, e.descripcion]}
            multiline
            numberOfLines={3}
            maxLength={500}
            value={descripcion}
            placeholder="Cómo se ejecuta, qué máquina hace falta…"
            placeholderTextColor={c.textoTenue}
            onChangeText={setDescripcion}
            editable={!guardando}
          />
        </View>
      </Desplazable>

      {eligiendoGrupo && (
        <HojaDeGrupos
          grupos={grupos}
          elegido={grupo}
          paraElegir
          alElegir={(elegido) => {
            setEligiendoGrupo(false)
            if (elegido === null) return
            setGrupo(elegido)
            setFalta((antes) => ({ ...antes, grupo: undefined }))
            // Elegir el grupo Cardio marca solo el tipo Cardio, y se puede cambiar antes de crear.
            const suNombre = grupos.find((uno) => uno.id === elegido)?.nombre
            if (id === null && suNombre === 'Cardio') setTipo('cardio')
          }}
          alCerrar={() => setEligiendoGrupo(false)}
        />
      )}
    </SafeAreaView>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 16 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue, padding: 16 },
    fallo: { fontSize: 14, lineHeight: 20, color: c.error },
    campo: { gap: 4 },
    etiqueta: { fontSize: 12.5, color: c.textoTenue },
    etiquetaDelTipo: { marginBottom: 6 },
    caja: {
      minHeight: 44,
      paddingHorizontal: 10,
      backgroundColor: c.fondo,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO_PEQUENO,
    },
    desplegable: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cajaTexto: { flex: 1, fontSize: 15, color: c.texto },
    descripcion: {
      minHeight: 92,
      paddingVertical: 10,
      fontSize: 15,
      lineHeight: 21,
      textAlignVertical: 'top',
      color: c.texto,
    },
    tipo: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 4,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    // El círculo: vacío, o con un punto verde cuando es el elegido.
    marca: {
      width: 20,
      height: 20,
      marginTop: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.textoTenue,
      borderRadius: 10,
    },
    punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.acento },
    tipoTexto: { flex: 1, minWidth: 0, gap: 2 },
    tipoNombre: { fontSize: 15, fontWeight: '600', color: c.texto },
    tipoAyuda: { fontSize: 13, color: c.textoTenue },
    tipoAviso: { fontSize: 13, color: c.textoTenue },
  })
}
