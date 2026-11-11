/**
 * P4 · Un ejercicio de una rutina: el principal, sus alternativas (las que se pueden hacer en
 * su lugar) y el objetivo de series y repeticiones. Puerto de
 * `web/src/paginas/programas/Ejercicio.tsx`.
 *
 * En la rutina nueva, *Guardar* solo cambia su borrador: lo que guarda de verdad es el
 * *Guardar* de la rutina. En una rutina que ya existe, *Guardar* guarda al momento. Un
 * ejercicio oculto, o uno de una rutina oculta, se ve sin poder cambiarlo.
 */
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { Cabecera } from '../../componentes/Cabecera'
import { Desplazable } from '../../componentes/Desplazable'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { ErrorDeApi, textoDelFallo } from '../../logica/api'
import type {
  AvisoDeBorrarHueco,
  Ejercicio as DatosEjercicio,
  GrupoMuscular,
  HuecoDeRutina,
  Rutina,
} from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { CAMBIARLO, loQueSePierdeDelHueco } from '../../reglasDePantalla/loQueSePierde'
import {
  aObjetivo,
  deAjustes,
  enTexto,
  familiaDe,
  queFaltaDelObjetivo,
  resumenDelObjetivo,
  type ObjetivoEnTexto,
} from '../../reglasDePantalla/objetivos'
import { RADIO, RADIO_PEQUENO, useColores, type Colores } from '../../tema'
import { diaYMesConAnio } from '../../utiles/fechas'
import {
  guardarBorrador,
  leerBorrador,
  RUTINA_NUEVA,
  type BorradorDeRutina,
  type EjercicioDelBorrador,
} from './borradores'
import { CamposDelObjetivo } from './CamposDelObjetivo'
import { HojaDeEjercicios } from './HojaDeEjercicios'

/**
 * De dónde sale lo que se edita: un ejercicio del borrador de la rutina nueva (nada se guarda
 * hasta el *Guardar* de esa rutina), uno nuevo de una rutina que ya existe, o uno que ya existe.
 */
type Origen =
  | { tipo: 'borrador'; borrador: BorradorDeRutina; indice: number | null }
  | { tipo: 'nuevo'; rutina: Rutina }
  | { tipo: 'existente'; rutina: Rutina; hueco: HuecoDeRutina; posicion: number | null }

/** Una alternativa en el formulario, con su objetivo tecleado. */
type AlternativaEnFormulario = { ejercicio: DatosEjercicio; objetivo: ObjetivoEnTexto }

type Formulario = {
  principal: DatosEjercicio | null
  objetivo: ObjetivoEnTexto
  alternativas: AlternativaEnFormulario[]
}

type Datos = { origen: Origen; ejercicios: DatosEjercicio[]; grupos: GrupoMuscular[] }

type Pregunta = 'ocultar' | 'mostrar' | 'borrar' | 'quitar'

/** Un ejercicio nuevo: sin elegir, con el objetivo de peso y repeticiones de Ajustes. */
function vacio(): Formulario {
  return { principal: null, objetivo: deAjustes({ tipo_registro: 'peso_reps' }), alternativas: [] }
}

function desdeBorrador(ejercicio: EjercicioDelBorrador): Formulario {
  return {
    principal: ejercicio.principal,
    objetivo: enTexto(ejercicio.objetivo),
    alternativas: ejercicio.alternativas.map((alternativa) => ({
      ejercicio: alternativa.ejercicio,
      objetivo: enTexto(alternativa.objetivo),
    })),
  }
}

function desdeHueco(hueco: HuecoDeRutina): Formulario {
  return {
    principal: hueco.ejercicio_principal,
    objetivo: enTexto(hueco),
    alternativas: hueco.alternativas.map((alternativa) => ({
      ejercicio: alternativa.ejercicio,
      objetivo: enTexto(alternativa),
    })),
  }
}

/** Lo que no vale, dicho para quien lo rellena; nulo si todo está bien. */
function queFalta(formulario: Formulario) {
  if (!formulario.principal) return 'Elige el ejercicio principal.'
  const delPrincipal = queFaltaDelObjetivo(
    formulario.principal.nombre,
    familiaDe(formulario.principal),
    formulario.objetivo,
  )
  if (delPrincipal) return delPrincipal
  for (const alternativa of formulario.alternativas) {
    const falta = queFaltaDelObjetivo(
      alternativa.ejercicio.nombre,
      familiaDe(alternativa.ejercicio),
      alternativa.objetivo,
    )
    if (falta) return falta
  }
  return null
}

async function leer(rutinaId: number | null, clave: string): Promise<Datos | 'sin-borrador'> {
  const [ejercicios, grupos] = await Promise.all([api.ejercicios(), api.gruposMusculares()])
  if (rutinaId === null) {
    const borrador = leerBorrador<BorradorDeRutina>(RUTINA_NUEVA)
    if (!borrador) return 'sin-borrador'
    const indice = clave === 'nuevo' ? null : Number(clave)
    if (indice !== null && !borrador.ejercicios[indice]) return 'sin-borrador'
    return { origen: { tipo: 'borrador', borrador, indice }, ejercicios, grupos }
  }
  const rutina = await api.rutina(rutinaId)
  if (clave === 'nuevo') return { origen: { tipo: 'nuevo', rutina }, ejercicios, grupos }
  const hueco = rutina.slots.find((uno) => uno.id === Number(clave))
  if (!hueco) throw new ErrorDeApi('Ese ejercicio no está en esta rutina.', 404, null)
  const visibles = rutina.slots
    .filter((uno) => uno.oculto_desde === null)
    .sort((uno, otro) => uno.orden - otro.orden)
  const posicion = hueco.oculto_desde === null ? visibles.indexOf(hueco) + 1 : null
  return { origen: { tipo: 'existente', rutina, hueco, posicion }, ejercicios, grupos }
}

/** A la rutina de la que se vino (la que existe o la nueva). */
function volver() {
  if (router.canGoBack()) router.back()
  else router.replace('/programas')
}

export function Ejercicio() {
  const c = useColores()
  const e = useEstilos(c)
  // `id` y `hueco` en una rutina que existe; `indice` en la rutina nueva.
  const parametros = useLocalSearchParams<{ id?: string; hueco?: string; indice?: string }>()
  const enBorrador = parametros.id === undefined
  const idRutina = enBorrador ? null : Number(parametros.id)
  const clave = (enBorrador ? parametros.indice : parametros.hueco) ?? 'nuevo'

  const [datos, setDatos] = useState<Datos | null>(null)
  const [formulario, setFormulario] = useState<Formulario>(vacio)
  const [error, setError] = useState<unknown>(null)
  const [hoja, setHoja] = useState<'principal' | 'alternativa' | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [aviso, setAviso] = useState<AvisoDeBorrarHueco | null>(null)
  // La alternativa con su objetivo a la vista: una sola a la vez.
  const [abierta, setAbierta] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [lectura, setLectura] = useState(0)

  const aplicar = useCallback((leidos: Datos) => {
    setDatos(leidos)
    const { origen } = leidos
    if (origen.tipo === 'borrador' && origen.indice !== null) {
      setFormulario(desdeBorrador(origen.borrador.ejercicios[origen.indice]))
    } else if (origen.tipo === 'existente') {
      setFormulario(desdeHueco(origen.hueco))
    }
  }, [])

  useEffect(() => {
    let vigente = true
    leer(idRutina, clave)
      .then((leidos) => {
        if (!vigente) return
        setError(null)
        // Sin borrador (la rutina nueva ya se cerró) no hay nada que editar: de vuelta.
        if (leidos === 'sin-borrador') volver()
        else aplicar(leidos)
      })
      .catch((fallo: unknown) => {
        if (vigente) setError(fallo)
      })
    return () => {
      vigente = false
    }
  }, [idRutina, clave, aplicar, lectura])

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

  const { origen, ejercicios, grupos } = datos
  // El grupo del principal, a la derecha de su etiqueta (decisión del autor). Que sea
  // predefinido o tuyo no se dice: aquí no cambia nada; se ve al elegirlo.
  const suGrupo = grupos.find((uno) => uno.id === formulario.principal?.grupo_muscular_id)
  const huecoOculto = origen.tipo === 'existente' && origen.hueco.oculto_desde !== null
  const rutinaOculta = origen.tipo !== 'borrador' && origen.rutina.oculto_desde !== null
  const soloLectura = huecoOculto || rutinaOculta
  const nombreDeRutina =
    origen.tipo === 'borrador'
      ? origen.borrador.nombre.trim() || 'Rutina nueva'
      : origen.rutina.nombre

  let titulo: string
  let subtitulo = nombreDeRutina
  if (origen.tipo === 'borrador' && origen.indice !== null) {
    titulo = `Ejercicio ${origen.indice + 1}`
  } else if (origen.tipo === 'existente') {
    titulo = origen.posicion === null ? 'Ejercicio oculto' : `Ejercicio ${origen.posicion}`
  } else {
    titulo = 'Añadir ejercicio'
    const cuantos =
      origen.tipo === 'borrador'
        ? origen.borrador.ejercicios.length
        : origen.rutina.slots.filter((uno) => uno.oculto_desde === null).length
    subtitulo = `${nombreDeRutina} · será el ejercicio ${cuantos + 1}`
  }
  const principalNombre = formulario.principal?.nombre ?? 'el ejercicio'

  function cambiar(cambios: Partial<Formulario>) {
    setFormulario((antes) => ({ ...antes, ...cambios }))
    setFallo(null)
  }

  function elegir(ejercicio: DatosEjercicio) {
    if (hoja === 'principal') {
      // Si era una alternativa, deja de serlo (no puede ser las dos cosas) y se lleva su
      // objetivo. Si no, con la misma unidad que el principal de antes se conserva el
      // objetivo; con otra, toma el de su tipo en Ajustes.
      const eraAlternativa = formulario.alternativas.find(
        (otra) => otra.ejercicio.id === ejercicio.id,
      )
      const mismaUnidad =
        formulario.principal !== null && familiaDe(formulario.principal) === familiaDe(ejercicio)
      cambiar({
        principal: ejercicio,
        objetivo:
          eraAlternativa?.objetivo ?? (mismaUnidad ? formulario.objetivo : deAjustes(ejercicio)),
        alternativas: formulario.alternativas.filter((otra) => otra.ejercicio.id !== ejercicio.id),
      })
      setAbierta(null)
    } else {
      // Una alternativa nueva nace con el objetivo de su tipo, no con el del principal.
      cambiar({
        alternativas: [...formulario.alternativas, { ejercicio, objetivo: deAjustes(ejercicio) }],
      })
      setAbierta(formulario.alternativas.length)
    }
    setHoja(null)
  }

  async function confirmar() {
    const motivo = queFalta(formulario)
    if (motivo) {
      setFallo(motivo)
      return
    }
    const objetivoDelPrincipal = aObjetivo(familiaDe(formulario.principal!), formulario.objetivo)
    const alternativas = formulario.alternativas.map((alternativa) => ({
      ejercicio: alternativa.ejercicio,
      objetivo: aObjetivo(familiaDe(alternativa.ejercicio), alternativa.objetivo),
    }))

    if (origen.tipo === 'borrador') {
      const ejercicio: EjercicioDelBorrador = {
        principal: formulario.principal!,
        objetivo: objetivoDelPrincipal,
        alternativas,
      }
      // Sobre el borrador del momento, no el leído al abrir: es el mismo, pero así no se
      // pisa nada si cambiara.
      const actual = leerBorrador<BorradorDeRutina>(RUTINA_NUEVA) ?? origen.borrador
      const lista = [...actual.ejercicios]
      if (origen.indice === null) lista.push(ejercicio)
      else lista[origen.indice] = ejercicio
      guardarBorrador(RUTINA_NUEVA, { ...actual, ejercicios: lista })
      volver()
      return
    }

    const cuerpo = {
      ejercicio_principal_id: formulario.principal!.id,
      ...objetivoDelPrincipal,
      alternativas: alternativas.map((alternativa) => ({
        ejercicio_id: alternativa.ejercicio.id,
        ...alternativa.objetivo,
      })),
    }
    setGuardando(true)
    try {
      if (origen.tipo === 'nuevo') await api.crearHueco(origen.rutina.id, cuerpo)
      else
        await api.actualizarHueco(origen.rutina.id, origen.hueco.id, {
          ...cuerpo,
          orden: origen.hueco.orden,
        })
      volver()
    } catch (fallo) {
      setFallo(textoDelFallo(fallo))
      setGuardando(false)
    }
  }

  async function preguntarBorrar() {
    if (origen.tipo !== 'existente') return
    setFallo(null)
    try {
      setAviso(await api.avisoDeBorrarHueco(origen.rutina.id, origen.hueco.id))
      setPregunta('borrar')
    } catch (fallo) {
      setFallo(textoDelFallo(fallo))
    }
  }

  async function recargar() {
    const leidos = await leer(idRutina, clave)
    if (leidos !== 'sin-borrador') aplicar(leidos)
  }

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <Cabecera
        titulo={titulo}
        subtitulo={subtitulo}
        alVolver={volver}
        derecha={
          soloLectura
            ? undefined
            : { texto: 'Guardar', alPulsar: () => void confirmar(), desactivado: guardando }
        }
      />

      <Desplazable contentContainerStyle={e.contenido}>
        {huecoOculto && origen.tipo === 'existente' && (
          <View style={e.oculto}>
            <Text style={e.ocultoTitulo}>
              Oculto en esta rutina desde el {diaYMesConAnio(origen.hueco.oculto_desde!)}
            </Text>
            <Text style={e.ocultoTexto}>No sale en la rutina ni al entrenar.</Text>
            <Text style={e.ocultoTexto}>Su historial sigue intacto.</Text>
          </View>
        )}
        {rutinaOculta && !huecoOculto && (
          <View style={e.oculto}>
            <Text style={e.ocultoTitulo}>{nombreDeRutina} está oculta</Text>
            <Text style={e.ocultoTexto}>Para cambiar sus ejercicios, muéstrala antes.</Text>
          </View>
        )}

        {fallo && <Text style={e.fallo}>{fallo}</Text>}

        <View style={e.tarjeta}>
          <View style={e.campo}>
            <View style={e.cabeceraCampo}>
              <Text style={e.tarjetaTitulo}>Ejercicio principal</Text>
              {suGrupo && <Text style={e.grupo}>{suGrupo.nombre}</Text>}
            </View>
            {soloLectura ? (
              <View style={e.caja}>
                <Text style={e.cajaTexto}>{formulario.principal?.nombre}</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setHoja('principal')}
                disabled={guardando}
                style={({ pressed }) => [e.caja, pressed && { opacity: 0.7 }]}
              >
                <Text style={[e.cajaTexto, !formulario.principal && { color: c.textoTenue }]}>
                  {formulario.principal?.nombre ?? 'Elige un ejercicio'}
                </Text>
                {formulario.principal?.oculto_desde && <Text style={e.etiquetaChica}>oculto</Text>}
                <Icono nombre="abajo" color={c.textoTenue} pequeno />
              </Pressable>
            )}
            {/* Para que nadie oculte o borre un ejercicio de la rutina solo para hacer otro:
                basta con cambiarlo, y su historial no se toca. */}
            {origen.tipo === 'existente' && !soloLectura && (
              <Text style={e.ayuda}>Puedes cambiarlo por otro sin perder lo que ya hiciste.</Text>
            )}
          </View>

          {formulario.principal && (
            <CamposDelObjetivo
              familia={familiaDe(formulario.principal)}
              valor={formulario.objetivo}
              cambiar={(cambios) => cambiar({ objetivo: { ...formulario.objetivo, ...cambios } })}
              soloLectura={soloLectura}
            />
          )}
        </View>

        <View style={e.tarjeta}>
          <View style={e.campo}>
            <Text style={e.tarjetaTitulo}>Alternativas</Text>
            {formulario.alternativas.length > 0 ? (
              <Text style={e.ayuda}>
                Cada una tiene su propio objetivo.
                {!soloLectura && ' Toca una para verlo o cambiarlo.'}
              </Text>
            ) : (
              <Text style={e.ayuda}>Todavía no tiene alternativas.</Text>
            )}
            <View style={e.alternativas}>
              {formulario.alternativas.map((alternativa, posicion) => {
                const { ejercicio } = alternativa
                const desplegada = !soloLectura && abierta === posicion
                return (
                  <View key={ejercicio.id} style={e.alternativa}>
                    <View style={[e.alternativaFila, desplegada && { borderColor: c.acento }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: desplegada }}
                        onPress={() => setAbierta(desplegada ? null : posicion)}
                        disabled={soloLectura || guardando}
                        style={e.alternativaCuerpo}
                      >
                        <Text style={e.alternativaNombre}>{ejercicio.nombre}</Text>
                        {ejercicio.oculto_desde && <Text style={e.etiquetaChica}>oculto</Text>}
                        <Text style={e.objetivo}>
                          {resumenDelObjetivo(ejercicio, alternativa.objetivo)}
                        </Text>
                      </Pressable>
                      {!soloLectura && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Quitar ${ejercicio.nombre}`}
                          onPress={() => {
                            cambiar({
                              alternativas: formulario.alternativas.filter(
                                (_, i) => i !== posicion,
                              ),
                            })
                            setAbierta(null)
                          }}
                          disabled={guardando}
                          style={e.quitar}
                        >
                          <Icono nombre="quitar" color={c.textoTenue} pequeno />
                        </Pressable>
                      )}
                    </View>
                    {desplegada && (
                      <View style={e.alternativaCampos}>
                        <CamposDelObjetivo
                          familia={familiaDe(ejercicio)}
                          valor={alternativa.objetivo}
                          cambiar={(cambios) =>
                            cambiar({
                              alternativas: formulario.alternativas.map((otra, i) =>
                                i === posicion
                                  ? { ...otra, objetivo: { ...otra.objetivo, ...cambios } }
                                  : otra,
                              ),
                            })
                          }
                        />
                      </View>
                    )}
                  </View>
                )
              })}
              {!soloLectura && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setHoja('alternativa')}
                  disabled={guardando}
                  style={({ pressed }) => [e.anadir, pressed && { opacity: 0.7 }]}
                >
                  <Text style={e.anadirTexto}>+ Añadir alternativa</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        <View style={e.acciones}>
          {origen.tipo === 'borrador' && origen.indice !== null && (
            <Boton
              texto="Quitar de la rutina"
              variante="peligro"
              alPulsar={() => setPregunta('quitar')}
            />
          )}
          {(origen.tipo === 'nuevo' || (origen.tipo === 'borrador' && origen.indice === null)) && (
            <Boton texto="Cancelar" variante="secundaria" alPulsar={volver} />
          )}
          {origen.tipo === 'existente' && !rutinaOculta && (
            <>
              {huecoOculto ? (
                <Boton
                  texto="Mostrar en esta rutina"
                  variante="principal"
                  alPulsar={() => setPregunta('mostrar')}
                />
              ) : (
                <Boton
                  texto="Ocultar en esta rutina"
                  variante="secundaria"
                  alPulsar={() => setPregunta('ocultar')}
                  desactivado={guardando}
                />
              )}
              <Boton
                texto="Borrar ejercicio"
                variante="peligro"
                alPulsar={() => void preguntarBorrar()}
                desactivado={guardando}
              />
            </>
          )}
        </View>
      </Desplazable>

      {hoja && (
        <HojaDeEjercicios
          titulo={hoja === 'principal' ? 'Ejercicio principal' : 'Alternativa'}
          subtitulo={`${titulo} · ${nombreDeRutina}`}
          ejercicios={ejercicios}
          grupos={grupos}
          excluir={
            hoja === 'principal'
              ? []
              : [
                  ...(formulario.principal ? [formulario.principal.id] : []),
                  ...formulario.alternativas.map((alternativa) => alternativa.ejercicio.id),
                ]
          }
          elegido={hoja === 'principal' ? (formulario.principal?.id ?? null) : null}
          alElegir={elegir}
          alCerrar={() => setHoja(null)}
        />
      )}

      {pregunta === 'quitar' && origen.tipo === 'borrador' && origen.indice !== null && (
        <Dialogo
          titulo={`¿Quitar ${principalNombre}?`}
          confirmar="Quitar"
          peligro
          alConfirmar={async () => {
            const actual = leerBorrador<BorradorDeRutina>(RUTINA_NUEVA) ?? origen.borrador
            const lista = actual.ejercicios.filter((_, i) => i !== origen.indice)
            guardarBorrador(RUTINA_NUEVA, { ...actual, ejercicios: lista })
            setPregunta(null)
            volver()
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'ocultar' && origen.tipo === 'existente' && (
        <Dialogo
          titulo={`¿Ocultar ${principalNombre} en ${origen.rutina.nombre}?`}
          cuerpo={`Dejará de salir en esta rutina y en tus próximas sesiones. Lo que hiciste con él sigue en tu historial, y podrás volver a mostrarlo desde la rutina. ${CAMBIARLO}`}
          confirmar="Ocultar"
          alConfirmar={async () => {
            await api.borrarHueco(origen.rutina.id, origen.hueco.id, 'ocultar')
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'mostrar' && origen.tipo === 'existente' && (
        <Dialogo
          titulo={`¿Mostrar ${principalNombre} en ${origen.rutina.nombre}?`}
          cuerpo="Volverá a salir en esta rutina y en tus próximas sesiones."
          confirmar="Mostrar"
          alConfirmar={async () => {
            await api.mostrarHueco(origen.rutina.id, origen.hueco.id)
            await recargar()
            setPregunta(null)
          }}
          alCancelar={() => setPregunta(null)}
        />
      )}
      {pregunta === 'borrar' && origen.tipo === 'existente' && aviso && (
        <Dialogo
          titulo={`¿Borrar ${principalNombre}?`}
          cuerpo={loQueSePierdeDelHueco(aviso, huecoOculto)}
          confirmar="Borrar"
          peligro
          alConfirmar={async () => {
            // Siempre en definitivo: sin historial, ese modo borra directo igual.
            await api.borrarHueco(origen.rutina.id, origen.hueco.id, 'definitivo')
            setPregunta(null)
            volver()
          }}
          alCancelar={() => setPregunta(null)}
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
    // El principal con su objetivo, y las alternativas, cada una en su tarjeta.
    tarjeta: {
      gap: 16,
      padding: 14,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 10,
    },
    tarjetaTitulo: { fontSize: 15, fontWeight: '600', color: c.texto },
    campo: { gap: 4 },
    cabeceraCampo: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 8,
    },
    grupo: { flexShrink: 0, fontSize: 12.5, color: c.textoTenue },
    caja: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: c.fondo,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO_PEQUENO,
    },
    cajaTexto: { flex: 1, fontSize: 15, color: c.texto },
    etiquetaChica: {
      flexShrink: 0,
      fontSize: 11,
      color: c.textoTenue,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 1,
      paddingHorizontal: 7,
    },
    ayuda: { fontSize: 13, lineHeight: 19, color: c.textoTenue },
    alternativas: { gap: 8, marginTop: 4 },
    // Abierta, son dos piezas: la fila, con el borde verde, y debajo un recuadro con su objetivo.
    alternativa: { gap: 8 },
    alternativaFila: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: 4,
      backgroundColor: c.fondo,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    alternativaCuerpo: {
      flex: 1,
      minWidth: 0,
      minHeight: 46,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      paddingLeft: 14,
      paddingRight: 4,
    },
    alternativaNombre: { flex: 1, minWidth: 0, fontSize: 15, color: c.texto },
    objetivo: {
      flexShrink: 0,
      fontSize: 12.5,
      color: c.acento,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 2,
      paddingHorizontal: 10,
      fontVariant: ['tabular-nums'],
    },
    quitar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    alternativaCampos: {
      gap: 10,
      padding: 12,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    // «+ Añadir alternativa»: un rectángulo a lo ancho, con borde de rayas, como el boceto.
    anadir: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    anadirTexto: { fontSize: 14, color: c.textoTenue },
    acciones: { gap: 12, marginTop: 8 },
  })
}
