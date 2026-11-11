/**
 * X2 · La ficha de un ejercicio: descripción, cómo se apunta, progresión, tus notas y las
 * rutinas donde se usa. Desde aquí se edita (X3), se oculta, se muestra y se borra. Puerto de
 * `web/src/paginas/ejercicios/Ficha.tsx`.
 *
 * Un predefinido no se edita, oculta ni borra (es de todos), pero sus notas son tuyas. Uno
 * oculto es de solo lectura, con *Mostrar* y *Borrar*; sus notas sí se cambian, cada una con
 * su propio formulario. Un bloque vacío no desaparece: lo dice en su recuadro.
 *
 * Diferencias con la web: relee al volver de editarlo (aquí se queda montada debajo), los usos
 * ocultos abiertos no van en la ruta y, hasta que llegue la gráfica de progresión, su tarjeta
 * enseña la cifra sin llevar a ninguna parte.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Cabecera } from '../../componentes/Cabecera'
import { Desplazable } from '../../componentes/Desplazable'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { Ocultos } from '../../componentes/Ocultos'
import { RecuadroVacio } from '../../componentes/RecuadroVacio'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import { textoDelFallo } from '../../logica/api'
import type {
  AvisoDeBorrarEjercicio,
  Ejercicio,
  GrupoMuscular,
  Nota,
  SesionHistorial,
  UsoEnRutina,
} from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { loQueSePierdeDelEjercicio } from '../../reglasDePantalla/loQueSePierde'
import { RADIO, RADIO_PEQUENO, useColores, type Colores } from '../../tema'
import { conArticulo, diaDe, diaYMesConAnio } from '../../utiles/fechas'
import { medidasDe, valorEnPantalla } from '../../utiles/progresion'
import { enumerar } from '../../utiles/textos'
import { TIPOS } from './tiposDeRegistro'

type Datos = {
  ejercicio: Ejercicio
  grupos: GrupoMuscular[]
  // De la más reciente a la más antigua, como las da la lógica.
  sesiones: SesionHistorial[]
  notas: Nota[]
  usos: UsoEnRutina[]
}

type Pregunta = 'ocultar' | 'mostrar' | 'borrar' | null

// La nota que se está escribiendo: una nueva, la de ese id o ninguna.
type Escribiendo = 'nueva' | number | null

/** La primera medida de su gráfica en la última sesión. */
function progresionDe(tipo: Ejercicio['tipo_registro'], ultima: SesionHistorial) {
  const medida = medidasDe(tipo, [ultima])[0]
  return medida.escribir(valorEnPantalla(medida, ultima))
}

/** "Push · ejercicio 1"; uno oculto en su rutina no tiene número. */
function queEjercicio(uso: UsoEnRutina) {
  const cual = uso.posicion === null ? 'oculto en la rutina' : `ejercicio ${uso.posicion}`
  return `${uso.rutina.nombre} · ${cual}`
}

/**
 * En qué programas está la rutina: el activo lo dice (solo puede haber uno) y los demás van
 * con su nombre a secas. Una rutina oculta lo dice primero.
 */
function dondeEsta(uso: UsoEnRutina) {
  const programas =
    uso.programas.length === 0
      ? 'sin programa'
      : enumerar(
          uso.programas.map((programa) =>
            programa.activo ? `${programa.nombre} · programa activo` : programa.nombre,
          ),
        )
  if (uso.rutina.oculto_desde) {
    return `Rutina oculta desde el ${diaYMesConAnio(uso.rutina.oculto_desde)} · ${programas}`
  }
  return programas
}

/** A la biblioteca, que es de donde se viene siempre. */
function volver() {
  if (router.canGoBack()) router.back()
  else router.replace('/ejercicios')
}

export function Ficha() {
  const c = useColores()
  const e = useEstilos(c)
  const { id: idDeLaRuta = '' } = useLocalSearchParams<{ id: string }>()
  const id = Number(idDeLaRuta)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta>(null)
  const [aviso, setAviso] = useState<AvisoDeBorrarEjercicio | null>(null)
  const [escribiendo, setEscribiendo] = useState<Escribiendo>(null)
  const [notaABorrar, setNotaABorrar] = useState<Nota | null>(null)
  const [verOcultos, setVerOcultos] = useState(false)
  const [lectura, setLectura] = useState(0)

  const leer = useCallback(async (): Promise<Datos> => {
    const [ejercicio, grupos, sesiones, notas, usos] = await Promise.all([
      api.ejercicio(id),
      api.gruposMusculares(),
      api.historialDeEjercicio(id, { limite: 1 }),
      api.notas(id),
      api.dondeSeUsa(id),
    ])
    // Las más recientes arriba.
    notas.sort((una, otra) => otra.created_at.localeCompare(una.created_at))
    return { ejercicio, grupos, sesiones, notas, usos }
  }, [id])

  // Al abrirla y al volver de editarlo.
  useFocusEffect(
    useCallback(() => {
      let vigente = true
      leer()
        .then((leidos) => {
          if (!vigente) return
          setDatos(leidos)
          setError(null)
        })
        .catch((problema: unknown) => {
          if (vigente) setError(problema)
        })
      return () => {
        vigente = false
      }
      // `lectura` solo sirve para que Reintentar vuelva a pedirlo.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leer, lectura]),
  )

  if (error) {
    return (
      <SafeAreaView edges={['top']} style={e.pantalla}>
        <Cabecera titulo="" alVolver={volver} />
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

  const { ejercicio, notas, usos } = datos
  const oculto = ejercicio.oculto_desde !== null
  const propio = !ejercicio.es_predefinido
  const grupo =
    datos.grupos.find((uno) => uno.id === ejercicio.grupo_muscular_id)?.nombre ?? 'Sin grupo'
  const ultima = datos.sesiones[0]
  const tipo = TIPOS.find((opcion) => opcion.clave === ejercicio.tipo_registro)
  const usosVisibles = usos.filter((uso) => !uso.oculto)
  const usosOcultos = usos.filter((uso) => uso.oculto)
  const ocupado = escribiendo !== null

  /** Tras un cambio, todo de nuevo: el aviso de oculto, las notas y los botones cambian. */
  async function recargar() {
    setDatos(await leer())
  }

  async function preguntarBorrar() {
    setFallo(null)
    try {
      setAviso(await api.avisoDeBorrarEjercicio(id))
      setPregunta('borrar')
    } catch (problema) {
      setFallo(textoDelFallo(problema))
    }
  }

  async function guardarNota(nota: Nota | null, texto: string) {
    if (nota) await api.actualizarNota(id, nota.id, texto)
    else await api.crearNota(id, texto)
    await recargar()
    setEscribiendo(null)
  }

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo={ejercicio.nombre}
        subtitulo={propio ? grupo : `${grupo} · predefinido`}
        alVolver={volver}
        derecha={
          propio && !oculto
            ? {
                texto: 'Editar',
                alPulsar: () =>
                  router.push({ pathname: '/ejercicios/[id]/editar', params: { id: String(id) } }),
                desactivado: ocupado,
              }
            : undefined
        }
      />

      <Desplazable contentContainerStyle={e.contenido}>
        {fallo && <Text style={e.fallo}>{fallo}</Text>}

        {oculto && (
          <View style={e.oculto}>
            <Text style={e.ocultoTitulo}>
              Oculto desde el {diaYMesConAnio(ejercicio.oculto_desde!)}
            </Text>
            <Text style={e.ocultoTexto}>No sale en las listas de ejercicios.</Text>
            <Text style={e.ocultoTexto}>Las rutinas que lo usan lo conservan, en gris.</Text>
          </View>
        )}

        <View style={e.bloque}>
          <Text style={e.rotulo}>Descripción</Text>
          {ejercicio.descripcion ? (
            <Text style={[e.tarjeta, e.descripcion]}>{ejercicio.descripcion}</Text>
          ) : (
            <RecuadroVacio>
              {'Todavía no tiene descripción.'}
              {propio && !oculto && ' Puedes añadirla con Editar.'}
            </RecuadroVacio>
          )}
        </View>

        {tipo && (
          <View style={e.bloque}>
            <Text style={e.rotulo}>Cómo se apunta</Text>
            <View style={[e.tarjeta, e.tipo]}>
              <Text style={e.tipoNombre}>{tipo.nombre}</Text>
              <Text style={e.tipoAyuda}>{tipo.ayuda}</Text>
            </View>
          </View>
        )}

        <View style={e.bloque}>
          <Text style={e.rotulo}>Progresión</Text>
          {ultima ? (
            <View style={[e.tarjeta, e.progresion]}>
              <Text style={e.cifra}>{progresionDe(ejercicio.tipo_registro, ultima)}</Text>
              <Text style={e.tipoAyuda}>Última vez {conArticulo(ultima.fecha)}</Text>
            </View>
          ) : (
            <RecuadroVacio>Aún no has hecho este ejercicio.</RecuadroVacio>
          )}
        </View>

        <View style={e.bloque}>
          <Text style={e.rotulo}>Mis notas</Text>
          {notas.length === 0 && escribiendo !== 'nueva' && (
            <RecuadroVacio>Aún no tienes notas de este ejercicio.</RecuadroVacio>
          )}
          {notas.length > 0 && (
            <View style={[e.tarjeta, e.notas]}>
              {notas.map((nota, indice) => (
                <View key={nota.id} style={indice > 0 && e.separada}>
                  {escribiendo === nota.id ? (
                    <FormularioDeNota
                      inicial={nota.nota}
                      alGuardar={(texto) => guardarNota(nota, texto)}
                      alCancelar={() => setEscribiendo(null)}
                    />
                  ) : (
                    <View style={e.nota}>
                      <View style={e.notaTexto}>
                        <Text style={e.notaCuerpo}>{nota.nota}</Text>
                        <Text style={e.notaFecha}>{diaYMesConAnio(diaDe(nota.created_at))}</Text>
                      </View>
                      <BotonDeIcono
                        icono="editar"
                        etiqueta="Cambiar la nota"
                        color={c.textoTenue}
                        alPulsar={() => setEscribiendo(nota.id)}
                        desactivado={ocupado}
                      />
                      <BotonDeIcono
                        icono="quitar"
                        etiqueta="Borrar la nota"
                        color={c.error}
                        alPulsar={() => setNotaABorrar(nota)}
                        desactivado={ocupado}
                      />
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
          {escribiendo === 'nueva' ? (
            <View style={[e.tarjeta, e.notas]}>
              <FormularioDeNota
                titulo="Nota nueva"
                alGuardar={(texto) => guardarNota(null, texto)}
                alCancelar={() => setEscribiendo(null)}
              />
            </View>
          ) : (
            <Boton
              texto="Añadir nota"
              alPulsar={() => setEscribiendo('nueva')}
              desactivado={ocupado}
            />
          )}
        </View>

        <View style={e.bloque}>
          <Text style={e.rotulo}>Rutinas donde se usa</Text>
          {usosVisibles.length === 0 && (
            <RecuadroVacio>
              {usosOcultos.length > 0
                ? 'Ya no está en ninguna rutina a la vista.'
                : 'Todavía no está en ninguna rutina.'}
            </RecuadroVacio>
          )}
          {usosVisibles.length > 0 && (
            <View style={e.lista}>
              {usosVisibles.map((uso, indice) => (
                <FilaDeUso
                  key={`${uso.rol}-${uso.slot_id}`}
                  uso={uso}
                  ejercicio={id}
                  primera={indice === 0}
                />
              ))}
            </View>
          )}
          <Ocultos
            cuantos={usosOcultos.length}
            singular="rutina donde ya no está"
            plural="rutinas donde ya no está"
            abierto={verOcultos}
            alAlternar={() => setVerOcultos(!verOcultos)}
          />
          {verOcultos && usosOcultos.length > 0 && (
            <View style={[e.lista, e.discontinuo]}>
              {usosOcultos.map((uso, indice) => (
                <FilaDeUso
                  key={`${uso.rol}-${uso.slot_id}`}
                  uso={uso}
                  ejercicio={id}
                  primera={indice === 0}
                />
              ))}
            </View>
          )}
        </View>

        {propio ? (
          <View style={e.acciones}>
            {oculto ? (
              <Boton
                texto="Mostrar ejercicio"
                variante="principal"
                alPulsar={() => setPregunta('mostrar')}
                desactivado={ocupado}
              />
            ) : (
              <Boton
                texto="Ocultar ejercicio"
                variante="secundaria"
                alPulsar={() => setPregunta('ocultar')}
                desactivado={ocupado}
              />
            )}
            <Boton
              texto="Borrar ejercicio"
              variante="peligro"
              alPulsar={() => void preguntarBorrar()}
              desactivado={ocupado}
            />
          </View>
        ) : (
          <TextoCentrado style={e.pie}>
            Los predefinidos no se pueden editar, ocultar ni borrar.
          </TextoCentrado>
        )}
      </Desplazable>

      {pregunta === 'ocultar' && (
        <Dialogo
          titulo={`¿Ocultar ${ejercicio.nombre}?`}
          cuerpo="Dejará de salir en las listas de ejercicios. Las rutinas que lo usan lo conservan en gris, y su historial y tus notas siguen intactos."
          confirmar="Ocultar"
          alConfirmar={async () => {
            await api.borrarEjercicio(id, 'ocultar')
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && (
        <Dialogo
          titulo={`¿Mostrar ${ejercicio.nombre}?`}
          cuerpo="Volverá a salir en las listas de ejercicios."
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarEjercicio(id)
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && aviso && (
        <Dialogo
          titulo={`¿Borrar ${ejercicio.nombre}?`}
          cuerpo={loQueSePierdeDelEjercicio(aviso, oculto)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await api.borrarEjercicio(id, 'definitivo')
            setPregunta(null)
            // A la biblioteca: volver no debe llevar a la ficha de algo que ya no existe.
            router.dismissTo('/ejercicios')
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {notaABorrar && (
        <Dialogo
          titulo="¿Borrar la nota?"
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            await api.borrarNota(id, notaABorrar.id)
            await recargar()
            setNotaABorrar(null)
          }}
          alCancelar={() => setNotaABorrar(null)}
        />
      )}
    </SafeAreaView>
  )
}

function BotonDeIcono({
  icono,
  etiqueta,
  color,
  alPulsar,
  desactivado,
}: {
  icono: 'editar' | 'quitar'
  etiqueta: string
  color: string
  alPulsar: () => void
  desactivado: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      onPress={alPulsar}
      disabled={desactivado}
      style={[estilosFijos.icono, desactivado && { opacity: 0.35 }]}
    >
      <Icono nombre={icono} color={color} pequeno />
    </Pressable>
  )
}

/**
 * Sin punto de color, como en Programas: una rutina solo lo tiene puesta en un día. Abre la
 * rutina en la pestaña Programas, y su flecha vuelve aquí.
 */
function FilaDeUso({
  uso,
  ejercicio,
  primera,
}: {
  uso: UsoEnRutina
  ejercicio: number
  primera: boolean
}) {
  const c = useColores()
  const e = useEstilos(c)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.navigate(
          {
            pathname: '/programas/rutinas/[id]',
            params: { id: String(uso.rutina.id), ejercicio: String(ejercicio) },
          },
          { withAnchor: true },
        )
      }
      style={({ pressed }) => [
        e.fila,
        !primera && { borderTopWidth: 1, borderTopColor: c.borde },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={e.filaTexto}>
        <Text style={e.filaNombre}>{queEjercicio(uso)}</Text>
        <Text style={e.linea}>{dondeEsta(uso)}</Text>
      </View>
      <Text style={e.etiqueta}>{uso.rol === 'principal' ? 'principal' : 'alternativa'}</Text>
      <Icono nombre="abrir" color={c.textoTenue} pequeno />
    </Pressable>
  )
}

/** El campo de una nota, nueva o existente, con su propio Cancelar y Guardar. */
function FormularioDeNota({
  titulo = 'Nota',
  inicial = '',
  alGuardar,
  alCancelar,
}: {
  titulo?: string
  inicial?: string
  alGuardar: (texto: string) => Promise<void>
  alCancelar: () => void
}) {
  const c = useColores()
  const e = useEstilos(c)
  const [texto, setTexto] = useState(inicial)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  async function enviar() {
    if (texto.trim() === '') {
      setFallo('Escribe algo en la nota, o pulsa Cancelar.')
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      await alGuardar(texto.trim())
    } catch (problema) {
      setFallo(textoDelFallo(problema))
      setGuardando(false)
    }
  }

  return (
    <View style={e.formulario}>
      <Text style={e.etiquetaDeCampo}>{titulo}</Text>
      <TextInput
        accessibilityLabel={titulo}
        style={e.campo}
        multiline
        numberOfLines={3}
        maxLength={1000}
        value={texto}
        placeholder="Un ajuste de la máquina, cómo te sale mejor…"
        placeholderTextColor={c.textoTenue}
        onChangeText={setTexto}
        autoFocus
      />
      <View style={e.botones}>
        <Boton texto="Cancelar" alPulsar={alCancelar} desactivado={guardando} estirar />
        <Boton
          texto="Guardar"
          variante="principal"
          alPulsar={() => void enviar()}
          desactivado={guardando}
          estirar
        />
      </View>
      {fallo && <Text style={e.fallo}>{fallo}</Text>}
    </View>
  )
}

const estilosFijos = StyleSheet.create({
  icono: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
})

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, paddingTop: 8, gap: 16 },
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
    bloque: { gap: 8 },
    rotulo: { fontSize: 13, color: c.textoTenue },
    tarjeta: {
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    descripcion: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      fontSize: 15,
      lineHeight: 21,
      color: c.texto,
    },
    tipo: { paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
    tipoNombre: { fontSize: 15, fontWeight: '700', color: c.texto },
    tipoAyuda: { fontSize: 13, color: c.textoTenue },
    progresion: { paddingVertical: 14, paddingHorizontal: 16 },
    cifra: { fontSize: 24, fontWeight: '700', lineHeight: 31, color: c.texto },
    notas: { paddingLeft: 16, paddingRight: 4 },
    separada: { borderTopWidth: 1, borderTopColor: c.borde },
    nota: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
    notaTexto: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 6 },
    notaCuerpo: { fontSize: 15, lineHeight: 21, color: c.texto },
    notaFecha: { fontSize: 12.5, color: c.textoTenue },
    formulario: { gap: 10, paddingVertical: 12, paddingRight: 12 },
    etiquetaDeCampo: { fontSize: 12.5, color: c.textoTenue },
    campo: {
      minHeight: 80,
      padding: 10,
      fontSize: 15,
      textAlignVertical: 'top',
      color: c.texto,
      backgroundColor: c.fondo,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO_PEQUENO,
    },
    botones: { flexDirection: 'row', gap: 12 },
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
    etiqueta: {
      flexShrink: 0,
      fontSize: 12,
      color: c.textoTenue,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 1,
      paddingHorizontal: 8,
    },
    acciones: { gap: 12 },
    pie: { fontSize: 13, lineHeight: 19, color: c.textoTenue },
  })
}
