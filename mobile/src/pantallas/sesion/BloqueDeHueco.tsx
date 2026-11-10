/**
 * Un hueco de la sesión. Plegado es una fila con lo que lleva hecho; desplegado (solo uno a
 * la vez) tiene la última vez, las series de hoy y el formulario. Puerto de
 * `web/src/paginas/sesion/BloqueDeHueco.tsx`.
 */
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Icono } from '../../componentes/Icono'
import type { Ejercicio, HuecoDeRutina, Serie } from '../../logica/tipos'
import { RADIO, useColores } from '../../tema'
import { fechaCorta } from '../../utiles/fechas'
import { pesoCorporalLegible, ritmoDeLaSerie, serieLarga } from '../../utiles/medidas'
import { objetivoDelEjercicio, seriesObjetivoDe } from '../../utiles/textos'
import { FichasUltimaVez } from './FichasUltimaVez'
import { FormularioDeSerie, type DatosDeSerie } from './FormularioDeSerie'
import { DesplegableDeEjercicios, FlechaDeComodin } from './SelectorDeEjercicio'
import { useUltimaVez } from './ultimaVez'

export type SerieAGuardar = DatosDeSerie & {
  ejercicio_id: number
  numero_serie: number
}

type Props = {
  hueco: HuecoDeRutina
  titulo: string
  /** Las series de hoy en este bloque. */
  series: Serie[]
  /** El ejercicio de hoy; nulo si no queda ninguno que se pueda usar. */
  elegido: Ejercicio | null
  elegir: (ejercicio: Ejercicio) => void
  abierto: boolean
  abrir: () => void
  /** La serie que se está editando: las ediciones van de una en una. */
  editandoId: number | null
  alEditar: (serieId: number | null) => void
  bloqueado: boolean
  sesion: { id: number; fecha: string }
  guardar: (datos: SerieAGuardar, serieId?: number) => Promise<void>
  pedirBorrar: (serie: Serie, numero: number) => void
}

function Etiqueta({ texto }: { texto: string }) {
  const c = useColores()
  return (
    <Text style={[estilos.etiqueta, { color: c.textoTenue, borderColor: c.borde }]}>{texto}</Text>
  )
}

export function BloqueDeHueco(props: Props) {
  const c = useColores()
  const { hueco, titulo, series, elegido, abierto, abrir, bloqueado } = props
  const hechas = series.length
  const objetivo = seriesObjetivoDe(hueco, elegido?.id)
  const completo = hechas >= objetivo
  const comodin = elegido !== null && elegido.id !== hueco.ejercicio_principal.id

  if (!abierto) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={abrir}
        disabled={bloqueado}
        style={[
          estilos.plegado,
          { backgroundColor: c.superficie, borderColor: c.borde },
          bloqueado && estilos.gris,
        ]}
      >
        <View style={estilos.plegadoNombre}>
          <Text style={[estilos.plegadoTexto, { color: completo ? c.textoTenue : c.texto }]}>
            {titulo}
          </Text>
          {comodin && <Etiqueta texto="alternativa" />}
          {hueco.oculto_desde ? (
            <Etiqueta texto="oculto en la rutina" />
          ) : (
            elegido?.oculto_desde && <Etiqueta texto="oculto" />
          )}
        </View>
        <Text style={[estilos.cuenta, { color: completo ? c.acento : c.textoTenue }]}>
          {hechas}/{objetivo}
        </Text>
        <Icono
          nombre={completo ? 'hecho' : 'abrir'}
          color={completo ? c.acento : c.textoTenue}
          pequeno
        />
      </Pressable>
    )
  }

  return <HuecoAbierto {...props} />
}

function HuecoAbierto({
  hueco,
  titulo,
  series,
  elegido,
  elegir,
  sesion,
  guardar,
  pedirBorrar,
  editandoId,
  alEditar,
  bloqueado,
}: Props) {
  const c = useColores()
  const [desplegado, setDesplegado] = useState(false)
  // Si la serie que se editaba se borra, el formulario vuelve a ser el de una nueva.
  const editando = series.find((serie) => serie.id === editandoId) ?? null

  const idElegido = elegido?.id ?? null
  const ultima = useUltimaVez(idElegido, sesion)

  // La serie anterior de hoy con este ejercicio, si la hay: de ella arranca el formulario.
  const anteriorDeHoy = [...series].reverse().find((serie) => serie.ejercicio_id === idElegido)
  const semilla = editando ?? anteriorDeHoy ?? ultima?.series[0] ?? null
  // Sin serie de hoy hay que esperar a la última vez, o el formulario arrancaría vacío y se
  // rellenaría solo un instante después.
  const semillaLista = editando !== null || anteriorDeHoy !== undefined || ultima !== undefined
  // Para guardar: el más alto + 1 y no la cuenta, para que quede la última aunque haya
  // saltos. En pantalla, una serie se numera por su posición.
  const siguiente = series.reduce((mayor, serie) => Math.max(mayor, serie.numero_serie), 0) + 1
  // Un hueco oculto conserva sus series para poder corregirlas, pero no admite nuevas; un
  // ejercicio oculto a mitad de sesión, tampoco. Con otra edición abierta, el formulario de
  // una nueva no se enseña.
  const ejercicioOculto = elegido !== null && elegido.oculto_desde !== null
  const admiteNuevas = elegido !== null && !ejercicioOculto && !hueco.oculto_desde && !bloqueado
  const comodines = hueco.alternativas.map((alternativa) => alternativa.ejercicio)
  const conFlecha = elegido !== null && comodines.length > 0 && !bloqueado && !hueco.oculto_desde

  async function guardarDesdeFormulario(datos: DatosDeSerie) {
    if (editando) {
      // Editar corrige peso, reps o variante; el ejercicio de la serie no cambia.
      await guardar(
        { ...datos, ejercicio_id: editando.ejercicio_id, numero_serie: editando.numero_serie },
        editando.id,
      )
      alEditar(null)
    } else if (elegido) {
      await guardar({ ...datos, ejercicio_id: elegido.id, numero_serie: siguiente })
    }
  }

  const texto = (estilo: object) => [estilo, { color: c.textoTenue }]
  const objetivoTexto = objetivoDelEjercicio(hueco, elegido?.id)

  return (
    <View style={[estilos.abierto, { backgroundColor: c.superficie, borderColor: c.borde }]}>
      {/* Por encima de lo de debajo: el desplegable cuelga de aquí. */}
      <View style={estilos.cabecera}>
        <Text style={[estilos.nombre, { color: c.texto }]}>{titulo}</Text>
        {/* En un hueco oculto en la rutina no se apunta nada: cambiar solo borraría sus series. */}
        {conFlecha && (
          <FlechaDeComodin abierto={desplegado} alPulsar={() => setDesplegado(!desplegado)} />
        )}
        {conFlecha && desplegado && (
          <DesplegableDeEjercicios
            principal={hueco.ejercicio_principal}
            comodines={comodines}
            elegido={elegido}
            sesion={sesion}
            elegir={(ejercicio) => {
              setDesplegado(false)
              elegir(ejercicio)
            }}
          />
        )}
      </View>
      <View style={estilos.datos}>
        {objetivoTexto && (
          <Text style={[estilos.objetivo, { color: c.acento, borderColor: c.borde }]}>
            {objetivoTexto}
          </Text>
        )}
        {hueco.oculto_desde ? (
          <Etiqueta texto="oculto en la rutina" />
        ) : (
          ejercicioOculto && <Etiqueta texto="oculto" />
        )}
      </View>

      {/* Sin ninguna vez anterior, se dice: si no, la última vez desaparece sin explicación. */}
      {ultima === null && (
        <View style={estilos.ultimaVez}>
          <Text style={texto(estilos.rotulo)}>Primera vez con este ejercicio</Text>
        </View>
      )}
      {ultima && ultima.series.length > 0 && (
        <View style={estilos.ultimaVez}>
          <Text style={texto(estilos.rotulo)}>Última vez · {fechaCorta(ultima.fecha)}</Text>
          <FichasUltimaVez
            tipo={(elegido ?? hueco.ejercicio_principal).tipo_registro}
            series={ultima.series}
          />
        </View>
      )}

      {series.length > 0 && (
        <View>
          <Text style={[texto(estilos.rotulo), estilos.hoyRotulo]}>Hoy</Text>
          <View style={{ borderBottomWidth: 1, borderBottomColor: c.borde }}>
            {series.map((serie, indice) => {
              const esta = serie.id === editandoId
              const corporal = pesoCorporalLegible(serie)
              const ritmo = ritmoDeLaSerie(serie)
              return (
                <View
                  key={serie.id}
                  style={[estilos.serie, { borderTopWidth: 1, borderTopColor: c.borde }]}
                >
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
                      <Text style={[estilos.serieVariante, { color: c.textoTenue }]}>
                        {serie.variante}
                      </Text>
                    )}
                    {corporal && (
                      <Text style={[estilos.serieCorporal, { color: c.textoTenue }]}>
                        {corporal}
                      </Text>
                    )}
                    {ritmo && (
                      <Text style={[estilos.serieCorporal, { color: c.textoTenue }]}>{ritmo}</Text>
                    )}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Editar la serie ${indice + 1}`}
                    onPress={() => alEditar(serie.id)}
                    disabled={bloqueado}
                    style={[estilos.icono, bloqueado && estilos.gris]}
                  >
                    <Icono nombre="editar" color={esta ? c.acento : c.textoTenue} pequeno />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Borrar la serie ${indice + 1}`}
                    onPress={() => pedirBorrar(serie, indice + 1)}
                    disabled={bloqueado}
                    style={[estilos.icono, estilos.quitar, bloqueado && estilos.gris]}
                  >
                    <Icono nombre="quitar" color={c.error} pequeno />
                  </Pressable>
                </View>
              )
            })}
          </View>
        </View>
      )}

      {(editando || admiteNuevas) && semillaLista && (
        <FormularioDeSerie
          key={`${idElegido}-${editando?.id ?? 'nueva'}`}
          numero={editando ? series.indexOf(editando) + 1 : series.length + 1}
          orden={editando?.numero_serie ?? siguiente}
          // Al editar, el tipo de la serie: el elegido puede ser otro si la rutina cambió.
          tipo={(editando?.ejercicio ?? elegido ?? hueco.ejercicio_principal).tipo_registro}
          semilla={semilla}
          editando={editando !== null}
          alGuardar={guardarDesdeFormulario}
          alCancelar={() => alEditar(null)}
        />
      )}

      {ejercicioOculto && !hueco.oculto_desde && !editando && (
        <Text style={texto(estilos.nota)}>
          {elegido.nombre} está oculto. Puedes corregir sus series, pero para apuntar más muéstralo
          desde la pestaña Ejercicios.
        </Text>
      )}

      {!elegido && (
        <Text style={texto(estilos.nota)}>
          Este ejercicio y sus alternativas están ocultos. Muestra alguno desde la pestaña
          Ejercicios para usarlo.
        </Text>
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  gris: { opacity: 0.45 },
  fuerte: { fontWeight: '700' },
  etiqueta: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 7,
  },
  plegado: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: RADIO,
  },
  plegadoNombre: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  plegadoTexto: { fontSize: 15, flexShrink: 1 },
  cuenta: { fontSize: 13, fontVariant: ['tabular-nums'] },
  // Por encima de los bloques de debajo, para que el desplegable de alternativas los tape.
  abierto: {
    zIndex: 1,
    gap: 10,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderWidth: 1,
    borderRadius: RADIO,
  },
  cabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, zIndex: 10 },
  nombre: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600', lineHeight: 21, paddingTop: 5 },
  datos: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: -2 },
  objetivo: {
    fontSize: 12.5,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
    fontVariant: ['tabular-nums'],
  },
  ultimaVez: { gap: 8, paddingTop: 4 },
  rotulo: { fontSize: 12.5 },
  hoyRotulo: { minHeight: 32, textAlignVertical: 'center' },
  serie: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  serieNumero: { width: 18, fontSize: 13, fontVariant: ['tabular-nums'] },
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
  serieCorporal: { fontSize: 13, flexBasis: '100%' },
  icono: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  quitar: { marginRight: -12 },
  nota: { fontSize: 13, lineHeight: 19 },
})
