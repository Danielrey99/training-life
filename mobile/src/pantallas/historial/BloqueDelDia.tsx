/**
 * Un hueco en el día del historial: sus series, cómo le fue frente a la última vez y esa
 * última vez en fichas. Puerto de `web/src/paginas/historial/BloqueDelDia.tsx`.
 *
 * Con Editar, cada serie gana su lápiz y su ✕, y el bloque un *+ Añadir serie*. Las ediciones
 * van de una en una: con un formulario abierto en cualquier parte del día, lo de este bloque
 * se queda en gris. Un hueco que ese día se quedó sin series solo sale al editar.
 */
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Icono } from '../../componentes/Icono'
import type { Ejercicio, HuecoDeRutina, Serie, SesionHistorial } from '../../logica/tipos'
import type { Mejora } from '../../reglasDePantalla/mejora'
import { RADIO, useColores } from '../../tema'
import { fechaCompleta } from '../../utiles/fechas'
import { pesoCorporalLegible, ritmoDeLaSerie, serieLarga } from '../../utiles/medidas'
import { objetivoDelEjercicio } from '../../utiles/textos'
import { FichasUltimaVez } from '../sesion/FichasUltimaVez'
import { FormularioDeSerie, type DatosDeSerie } from '../sesion/FormularioDeSerie'
import { DesplegableDeEjercicios, FlechaDeComodin } from '../sesion/SelectorDeEjercicio'

/** Un bloque del día: un hueco de la rutina. */
export type Bloque = {
  clave: string
  hueco: HuecoDeRutina
  /**
   * El de sus series; en un hueco sin series, el elegido en el borrador o, si no, el primero
   * que se puede elegir (el principal, o el primer comodín si está oculto).
   */
  ejercicio: Ejercicio
  series: Serie[]
  /** La última vez con ese ejercicio, en la rutina que fuera, antes de este día. */
  ultima: SesionHistorial | null
}

/** Lo que hay abierto en el modo editar: una sola cosa a la vez. */
export type Abierta =
  { tipo: 'serie'; id: number } | { tipo: 'anadir'; clave: string } | { tipo: 'nota' }

interface Props {
  bloque: Bloque
  /** La posición entre los huecos visibles; 0 si no lleva número. */
  numero: number
  mejora: Mejora | null
  sesion: { id: number; fecha: string }
  editando: boolean
  abierta: Abierta | null
  alAbrir: (abierta: Abierta) => void
  alCerrar: () => void
  alBorrarSerie: (serie: Serie, numero: number) => void
  /** Elegir otro ejercicio en un hueco sin series: no hay nada que confirmar. */
  alElegir: (ejercicio: Ejercicio) => void
  /** Elegir otro en un hueco con series: lo confirma el día, que borra esas series. */
  alPedirCambiar: (ejercicio: Ejercicio) => void
  /** Cambiar o añadir una serie solo toca el borrador del día. */
  alCambiarSerie: (serie: Serie, datos: DatosDeSerie) => void
  alAnadirSerie: (ejercicio: Ejercicio, numero: number, datos: DatosDeSerie) => void
}

export function BloqueDelDia({
  bloque,
  numero,
  mejora,
  sesion,
  editando,
  abierta,
  alAbrir,
  alCerrar,
  alBorrarSerie,
  alElegir,
  alPedirCambiar,
  alCambiarSerie,
  alAnadirSerie,
}: Props) {
  const c = useColores()
  const [desplegado, setDesplegado] = useState(false)
  const editandoSerie = abierta?.tipo === 'serie' ? abierta.id : null
  const anadiendo = abierta?.tipo === 'anadir' && abierta.clave === bloque.clave
  // Hay algo abierto (aquí o en otra parte): no se puede abrir nada más.
  const bloqueado = abierta !== null

  const { hueco, series, ejercicio } = bloque
  const vacio = series.length === 0
  const principal = hueco.ejercicio_principal
  const esComodin = principal.id !== ejercicio.id
  // Las series nuevas, solo en un hueco visible y con un ejercicio visible.
  const admiteNuevas = editando && !hueco.oculto_desde && !ejercicio.oculto_desde
  const oculto = Boolean(hueco.oculto_desde || ejercicio.oculto_desde)
  const comodines = hueco.alternativas.map((alternativa) => alternativa.ejercicio)
  // La flecha sale si hay otro ejercicio visible al que cambiar.
  const hayOtro = [principal, ...comodines].some(
    (otro) => otro.id !== ejercicio.id && !otro.oculto_desde,
  )
  // Elegir con qué ejercicio se hizo es parte de añadir la serie: la flecha sigue en el hueco
  // al que se añade, y solo desaparece si lo abierto es otra cosa.
  const conFlecha =
    editando && !hueco.oculto_desde && (vacio ? !bloqueado || anadiendo : !bloqueado) && hayOtro
  // Para guardar, como en la sesión: en pantalla, una serie se numera por su posición.
  const siguiente = series.reduce((mayor, serie) => Math.max(mayor, serie.numero_serie), 0) + 1
  // Arranca con la última serie del bloque o, si no tiene, con la última vez.
  const semilla = series.at(-1) ?? bloque.ultima?.series[0] ?? null
  const objetivo = objetivoDelEjercicio(hueco, ejercicio.id)
  const tenue = { color: c.textoTenue }

  return (
    <View
      style={[
        estilos.hueco,
        { backgroundColor: c.superficie, borderColor: c.borde },
        vacio && estilos.vacio,
        desplegado && estilos.encima,
      ]}
    >
      <View style={estilos.cabecera}>
        <Text style={[estilos.nombre, { color: c.texto }]}>
          {numero > 0 && `${numero} · `}
          {ejercicio.nombre}
        </Text>
        {conFlecha && (
          <FlechaDeComodin abierto={desplegado} alPulsar={() => setDesplegado(!desplegado)} />
        )}
        {conFlecha && desplegado && (
          <DesplegableDeEjercicios
            principal={principal}
            comodines={comodines}
            elegido={ejercicio}
            sesion={sesion}
            elegir={(otro) => {
              setDesplegado(false)
              if (vacio) alElegir(otro)
              else alPedirCambiar(otro)
            }}
          />
        )}
        {/* A la gráfica de este ejercicio; con Editar no, que la pantalla se queda quieta. */}
        {!vacio && !editando && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ver la progresión de ${ejercicio.nombre}`}
            onPress={() =>
              router.push({
                pathname: '/historial/progresion/[id]',
                params: { id: String(ejercicio.id) },
              })
            }
            style={estilos.progresion}
          >
            <Icono nombre="abrir" color={c.textoTenue} pequeno />
          </Pressable>
        )}
      </View>
      {/* El objetivo, debajo del nombre y aparte de las mejoras: es lo que pide la rutina. */}
      {(objetivo || oculto) && (
        <View style={estilos.filaEtiquetas}>
          {objetivo && (
            <Text style={[estilos.chip, { color: c.acento, borderColor: c.borde }]}>
              {objetivo}
            </Text>
          )}
          {oculto && (
            <Text style={[estilos.etiqueta, { color: c.textoTenue, borderColor: c.borde }]}>
              {hueco.oculto_desde ? 'oculto en la rutina' : 'oculto'}
            </Text>
          )}
        </View>
      )}
      {mejora && (
        <View style={[estilos.filaEtiquetas, estilos.insignias]}>
          {mejora.insignias.map((insignia) => (
            <Text
              key={insignia.texto}
              style={[
                estilos.chip,
                {
                  borderColor: c.borde,
                  color: insignia.clase === 'mejor' ? c.acento : c.textoTenue,
                },
              ]}
            >
              {insignia.texto}
            </Text>
          ))}
        </View>
      )}

      {vacio && (
        <Text style={[estilos.rotulo, estilos.cursiva, tenue]}>
          Ese día no se apuntó ninguna serie
        </Text>
      )}
      <View>
        {series.map((serie, indice) => {
          const esta = serie.id === editandoSerie
          const corporal = pesoCorporalLegible(serie)
          const ritmo = ritmoDeLaSerie(serie)
          return (
            <View key={serie.id}>
              <View style={[estilos.serie, { borderTopColor: c.borde }]}>
                <Text
                  style={[
                    estilos.serieNumero,
                    { color: esta ? c.acento : c.textoTenue },
                    esta && estilos.fuerte,
                  ]}
                >
                  {indice + 1}
                </Text>
                <View style={estilos.serieTexto}>
                  <Text style={[estilos.serieCarga, { color: c.texto }]}>
                    {serieLarga(serie.ejercicio.tipo_registro, serie)}
                  </Text>
                  {serie.variante && (
                    <Text style={[estilos.serieVariante, tenue]}>{serie.variante}</Text>
                  )}
                  {corporal && <Text style={[estilos.serieLinea, tenue]}>{corporal}</Text>}
                  {ritmo && <Text style={[estilos.serieLinea, tenue]}>{ritmo}</Text>}
                </View>
                {editando && (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Editar la serie ${indice + 1}`}
                      onPress={() => alAbrir({ tipo: 'serie', id: serie.id })}
                      disabled={bloqueado}
                      style={[estilos.icono, bloqueado && estilos.gris]}
                    >
                      <Icono nombre="editar" color={esta ? c.acento : c.textoTenue} pequeno />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Borrar la serie ${indice + 1}`}
                      onPress={() => alBorrarSerie(serie, indice + 1)}
                      disabled={bloqueado}
                      style={[estilos.icono, estilos.quitar, bloqueado && estilos.gris]}
                    >
                      <Icono nombre="quitar" color={c.error} pequeno />
                    </Pressable>
                  </>
                )}
              </View>
              {editando && esta && (
                <View style={estilos.formulario}>
                  <FormularioDeSerie
                    numero={indice + 1}
                    orden={serie.numero_serie}
                    tipo={ejercicio.tipo_registro}
                    semilla={serie}
                    editando
                    textoGuardar="Aplicar"
                    alGuardar={async (datos) => alCambiarSerie(serie, datos)}
                    alCancelar={alCerrar}
                  />
                </View>
              )}
            </View>
          )
        })}
      </View>

      {admiteNuevas &&
        (anadiendo ? (
          <FormularioDeSerie
            key={`${ejercicio.id}-${siguiente}`}
            numero={series.length + 1}
            orden={siguiente}
            tipo={ejercicio.tipo_registro}
            semilla={semilla}
            editando={false}
            enLinea
            textoGuardar="Añadir"
            alGuardar={async (datos) => alAnadirSerie(ejercicio, siguiente, datos)}
            alCancelar={alCerrar}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => alAbrir({ tipo: 'anadir', clave: bloque.clave })}
            disabled={bloqueado}
            style={[estilos.anadir, bloqueado && estilos.gris]}
          >
            <Text style={[estilos.anadirTexto, { color: c.acento }]}>+ Añadir serie</Text>
          </Pressable>
        ))}

      {editando && ejercicio.oculto_desde && !hueco.oculto_desde && (
        <Text style={[estilos.nota, tenue]}>
          {ejercicio.nombre} está oculto. Puedes corregir sus series, pero para apuntar más
          muéstralo desde la pestaña Ejercicios.
        </Text>
      )}

      {!vacio && (
        <View style={[estilos.vez, { borderTopColor: c.borde }]}>
          {bloque.ultima ? (
            <>
              <Text style={[estilos.rotulo, tenue]}>
                Última vez · {fechaCompleta(bloque.ultima.fecha)}
              </Text>
              <FichasUltimaVez tipo={ejercicio.tipo_registro} series={bloque.ultima.series} />
            </>
          ) : (
            <Text style={[estilos.rotulo, estilos.cursiva, tenue]}>
              Primera vez con este ejercicio
            </Text>
          )}
        </View>
      )}
      {esComodin && (
        <View style={[estilos.pie, { borderTopColor: c.borde }]}>
          <Text style={[estilos.pieTexto, tenue]}>En lugar de {principal.nombre}</Text>
          <Text style={[estilos.etiqueta, { color: c.textoTenue, borderColor: c.borde }]}>
            alternativa
          </Text>
        </View>
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  hueco: {
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: RADIO,
  },
  vacio: { borderStyle: 'dashed' },
  // Por encima de los bloques de debajo, para que el desplegable de alternativas los tape.
  encima: { zIndex: 1 },
  cabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, minHeight: 32, zIndex: 10 },
  nombre: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600', lineHeight: 21, paddingTop: 5 },
  // 44 px para el dedo, sin agrandar la cabecera: se come el relleno del bloque.
  progresion: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
    marginRight: -12,
    marginBottom: -10,
    marginLeft: -6,
  },
  filaEtiquetas: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: -6,
  },
  insignias: { gap: 6, marginTop: -4 },
  chip: {
    fontSize: 12.5,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
    fontVariant: ['tabular-nums'],
  },
  etiqueta: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 7,
  },
  rotulo: { fontSize: 12.5 },
  cursiva: { fontStyle: 'italic' },
  serie: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1 },
  serieNumero: { width: 18, fontSize: 13, fontVariant: ['tabular-nums'] },
  fuerte: { fontWeight: '700' },
  serieTexto: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 2,
    paddingVertical: 6,
  },
  serieCarga: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  serieVariante: { fontSize: 13, fontStyle: 'italic' },
  // El peso corporal o el ritmo, en su propia línea debajo de la carga.
  serieLinea: { fontSize: 13, flexBasis: '100%' },
  icono: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  quitar: { marginRight: -12 },
  gris: { opacity: 0.45 },
  // Los botones del formulario casi tocaban la raya de la serie siguiente.
  formulario: { marginBottom: 12 },
  anadir: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  anadirTexto: { fontSize: 14, fontWeight: '600' },
  nota: { fontSize: 13, lineHeight: 19 },
  vez: { gap: 6, paddingTop: 10, borderTopWidth: 1 },
  pie: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderTopWidth: 1,
  },
  pieTexto: { fontSize: 12.5, flexShrink: 1 },
})
