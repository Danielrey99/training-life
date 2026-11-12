/**
 * Los ajustes de cómo se entrena y cómo se ve la app. Puerto de
 * `web/src/paginas/ajustes/Preferencias.tsx`, con sus textos. Se aplican al momento, sin
 * botón de guardar: no tocan nada de lo apuntado, solo cómo se enseña.
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { Boton } from '../../componentes/Boton'
import { CampoConPasos } from '../../componentes/CampoConPasos'
import { CampoDeDuracion } from '../../componentes/CampoDeDuracion'
import { Icono } from '../../componentes/Icono'
import { Selector } from '../../componentes/Selector'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import type { TipoRegistro } from '../../logica/tipos'
import {
  entero,
  falloDelObjetivo,
  MAXIMO_PESO_CORPORAL,
  MAXIMO_REPS,
  MAXIMO_SEGUNDOS,
  MAXIMO_SERIES,
  MINIMO_PESO_CORPORAL,
  pasoDelPesoValido,
  pasoDelTiempoValido,
} from '../../reglasDePantalla/ajustes'
import type { TextosDelObjetivo } from '../../reglasDePantalla/ajustes'
import { RADIO, RADIO_PEQUENO, useColores } from '../../tema'
import type { Colores } from '../../tema'
import { cambiarAjustes, POR_DEFECTO, useAjustes } from '../../utiles/ajustes'
import type { Ajustes } from '../../utiles/ajustes'
import { colorDelDia } from '../../utiles/colores'
import { aKilos, enUnidad, leerNumero, numeroLegible, pesoLegible } from '../../utiles/numeros'
import { nombreDelDiaSemana } from '../../utiles/textos'
import { HojaDeColor } from './HojaDeColor'

/** Una tarjeta de Ajustes, con su título centrado. */
export function Tarjeta({ titulo, children }: { titulo?: string; children: ReactNode }) {
  const c = useColores()
  return (
    <View style={[estilos.tarjeta, { backgroundColor: c.superficie, borderColor: c.borde }]}>
      {titulo && (
        <Text style={[estilos.tituloTarjeta, { color: c.texto }]} accessibilityRole="header">
          {titulo}
        </Text>
      )}
      {children}
    </View>
  )
}

/** Un párrafo de explicación dentro de una tarjeta. */
export function Parrafo({ centrado, children }: { centrado?: boolean; children: ReactNode }) {
  const c = useColores()
  const estilo = [estilos.parrafo, { color: c.textoTenue }]
  if (centrado) return <TextoCentrado style={estilo}>{children}</TextoCentrado>
  return <Text style={estilo}>{children}</Text>
}

/** Entrenamiento, Apariencia, Tus datos: centrados y a 15 px, como en la web. */
export function Apartado({ children }: { children: string }) {
  const c = useColores()
  return (
    <Text style={[estilos.apartado, { color: c.texto }]} accessibilityRole="header">
      {children}
    </Text>
  )
}

function Fallo({ children, centrado }: { children: ReactNode; centrado?: boolean }) {
  const c = useColores()
  const estilo = [estilos.fallo, { color: c.error }]
  if (centrado) return <TextoCentrado style={estilo}>{children}</TextoCentrado>
  return <Text style={estilo}>{children}</Text>
}

/**
 * «Suben o bajan [1] kg cada vez.»: el campo dentro de la frase. Se guarda al escribir un
 * número que vale; con uno que no, avisa y se queda el de antes. Al salir del campo vuelve a
 * enseñar el guardado, para que no se quede a la vista algo que no vale.
 */
function CampoDePaso({
  inicial,
  vale,
  guardar,
  despues,
  decimales,
  fallo,
}: {
  inicial: string
  vale: (valor: number | null) => boolean
  guardar: (valor: number) => void
  despues: string
  decimales: boolean
  fallo: string
}) {
  const c = useColores()
  const [texto, setTexto] = useState(inicial)
  const valido = vale(leerNumero(texto))

  return (
    <View>
      <View style={estilos.paso}>
        <Text style={[estilos.parrafo, { color: c.textoTenue }]}>Suben o bajan</Text>
        <TextInput
          style={[
            estilos.campoPaso,
            { color: c.texto, backgroundColor: c.fondo, borderColor: valido ? c.borde : c.error },
          ]}
          value={texto}
          keyboardType={decimales ? 'decimal-pad' : 'number-pad'}
          selectTextOnFocus
          accessibilityLabel="Cuánto suben o bajan"
          onChangeText={(nuevoTexto) => {
            setTexto(nuevoTexto)
            const nuevo = leerNumero(nuevoTexto)
            if (vale(nuevo) && nuevo !== null) guardar(nuevo)
          }}
          onBlur={() => setTexto(inicial)}
        />
        <Text style={[estilos.parrafo, { color: c.textoTenue }]}>{despues}</Text>
      </View>
      {!valido && <Fallo centrado>{fallo}</Fallo>}
    </View>
  )
}

/**
 * Cuánto pesa la persona: con él arranca cada serie de los ejercicios de peso corporal.
 * Vacío vale (no se sabe): las series arrancan sin él. Se guarda al escribir un peso que
 * vale, de 20 a 400 kg o su equivalente en la unidad elegida.
 */
function CampoDePesoCorporal({ ajustes }: { ajustes: Ajustes }) {
  const [texto, setTexto] = useState(
    ajustes.pesoCorporal === null ? '' : pesoLegible(ajustes.pesoCorporal),
  )
  const valor = leerNumero(texto)
  const minimo = Math.ceil(enUnidad(MINIMO_PESO_CORPORAL))
  const maximo = Math.floor(enUnidad(MAXIMO_PESO_CORPORAL))
  const vale = texto.trim() === '' || (valor !== null && valor >= minimo && valor <= maximo)

  function cambiar(nuevoTexto: string) {
    setTexto(nuevoTexto)
    const nuevo = leerNumero(nuevoTexto)
    if (nuevoTexto.trim() === '') cambiarAjustes({ pesoCorporal: null })
    else if (nuevo !== null && nuevo >= minimo && nuevo <= maximo) {
      cambiarAjustes({ pesoCorporal: aKilos(nuevo) })
    }
  }

  return (
    <>
      <View style={estilos.fila}>
        <CampoConPasos
          etiqueta={`Peso corporal (${ajustes.unidad})`}
          valor={texto}
          cambiar={cambiar}
          paso={ajustes.pasoPeso}
          minimo={minimo}
          decimales
        />
      </View>
      {!vale && (
        <Fallo>
          Pon un peso de {minimo} a {maximo} {ajustes.unidad}.
        </Fallo>
      )}
    </>
  )
}

/**
 * Con lo que empieza un ejercicio nuevo de una rutina según cómo se apunta, con los mismos
 * campos del formulario del ejercicio: series y reps mínimas y máximas, o series y duración
 * mínima y máxima. Se guarda cuando todo vale; si no, avisa y se queda lo de antes.
 */
function CamposDeObjetivo({
  ajustes,
  tipo,
  titulo,
  c,
}: {
  ajustes: Ajustes
  tipo: TipoRegistro
  titulo: string
  c: Colores
}) {
  const guardado = ajustes.objetivoNuevo[tipo]
  const porDuracion = tipo === 'tiempo' || tipo === 'cardio'
  const maximo = porDuracion ? MAXIMO_SEGUNDOS : MAXIMO_REPS
  const [textos, setTextos] = useState<TextosDelObjetivo>({
    series: String(guardado.series),
    min: String(guardado.min),
    max: String(guardado.max),
  })
  const fallo = falloDelObjetivo(textos, porDuracion)
  const min = leerNumero(textos.min)
  const max = leerNumero(textos.max)

  function cambiar(cambios: Partial<TextosDelObjetivo>) {
    const nuevos = { ...textos, ...cambios }
    setTextos(nuevos)
    const s = leerNumero(nuevos.series)
    const n = leerNumero(nuevos.min)
    const x = leerNumero(nuevos.max)
    if (entero(s, MAXIMO_SERIES) && entero(n, maximo) && entero(x, maximo) && x >= n) {
      cambiarAjustes({
        objetivoNuevo: { ...ajustes.objetivoNuevo, [tipo]: { series: s, min: n, max: x } },
      })
    }
  }

  return (
    <View style={[estilos.objetivo, { backgroundColor: c.fondo, borderColor: c.borde }]}>
      <Text style={[estilos.tituloObjetivo, { color: c.texto, borderBottomColor: c.borde }]}>
        {titulo}
      </Text>
      <View style={estilos.fila}>
        <CampoConPasos
          etiqueta="Series objetivo"
          valor={textos.series}
          cambiar={(valor) => cambiar({ series: valor })}
          paso={1}
          minimo={1}
        />
      </View>
      {porDuracion ? (
        <>
          <View style={estilos.fila}>
            <CampoDeDuracion
              etiqueta="Duración mínima"
              segundos={min ?? 0}
              cambiar={(segundos) => cambiar({ min: String(segundos) })}
              paso={ajustes.pasoTiempo}
            />
          </View>
          <View style={estilos.fila}>
            <CampoDeDuracion
              etiqueta="Duración máxima"
              segundos={max ?? 0}
              cambiar={(segundos) => cambiar({ max: String(segundos) })}
              paso={ajustes.pasoTiempo}
            />
          </View>
        </>
      ) : (
        <View style={estilos.fila}>
          <CampoConPasos
            etiqueta="Reps mínimas"
            valor={textos.min}
            cambiar={(valor) => cambiar({ min: valor })}
            paso={1}
            minimo={1}
          />
          <CampoConPasos
            etiqueta="Reps máximas"
            valor={textos.max}
            cambiar={(valor) => cambiar({ max: valor })}
            paso={1}
            minimo={1}
          />
        </View>
      )}
      {fallo && <Fallo>{fallo}</Fallo>}
    </View>
  )
}

export function Preferencias() {
  const c = useColores()
  const ajustes = useAjustes()
  const [diaAbierto, setDiaAbierto] = useState<number | null>(null)
  const coloresPropios = Object.keys(ajustes.colores).length > 0

  function elegirColor(dia: number, eleccion: string | null) {
    const colores = { ...ajustes.colores }
    if (eleccion === null) delete colores[dia]
    else colores[dia] = eleccion
    cambiarAjustes({ colores })
    setDiaAbierto(null)
  }

  return (
    <>
      <Apartado>Entrenamiento</Apartado>
      <Tarjeta titulo="Unidad de peso">
        <Selector
          etiqueta="Unidad de peso"
          pequeno
          aLoAncho
          opciones={[
            { clave: 'kg', texto: 'Kilos (kg)' },
            { clave: 'lb', texto: 'Libras (lb)' },
          ]}
          elegida={ajustes.unidad}
          alElegir={(unidad) => cambiarAjustes({ unidad })}
        />
      </Tarjeta>
      <Tarjeta titulo="Unidad de distancia">
        <Selector
          etiqueta="Unidad de distancia"
          pequeno
          aLoAncho
          opciones={[
            { clave: 'km', texto: 'Kilómetros (km)' },
            { clave: 'mi', texto: 'Millas (mi)' },
          ]}
          elegida={ajustes.distancia}
          alElegir={(distancia) => cambiarAjustes({ distancia })}
        />
      </Tarjeta>
      <Tarjeta titulo="Peso corporal">
        <Parrafo>
          Se apunta con cada serie de los ejercicios de peso corporal (dominadas, fondos…), y ahí lo
          puedes cambiar. Cambiarlo aquí no cambia las series que ya tienes apuntadas.
        </Parrafo>
        <CampoDePesoCorporal key={ajustes.unidad} ajustes={ajustes} />
      </Tarjeta>
      <Tarjeta titulo="Botones − y + del peso">
        <CampoDePaso
          key={ajustes.unidad}
          inicial={numeroLegible(ajustes.pasoPeso)}
          vale={pasoDelPesoValido}
          guardar={(pasoPeso) => cambiarAjustes({ pasoPeso })}
          despues={`${ajustes.unidad} cada vez.`}
          decimales
          fallo="Pon un número mayor que 0 (hasta 100)."
        />
      </Tarjeta>
      <Tarjeta titulo="Botones − y + del tiempo">
        <CampoDePaso
          inicial={String(ajustes.pasoTiempo)}
          vale={pasoDelTiempoValido}
          guardar={(pasoTiempo) => cambiarAjustes({ pasoTiempo })}
          despues="segundos cada vez."
          decimales={false}
          fallo="Pon un número entero de segundos, del 1 al 59."
        />
      </Tarjeta>
      <Tarjeta titulo="Ejercicio nuevo en una rutina">
        <Parrafo>
          Con lo que empieza cada ejercicio que añadas a una rutina. Luego lo puedes cambiar en cada
          uno.
        </Parrafo>
        <CamposDeObjetivo c={c} ajustes={ajustes} tipo="peso_reps" titulo="Peso y repeticiones" />
        <CamposDeObjetivo c={c} ajustes={ajustes} tipo="corporal" titulo="Peso corporal" />
        <CamposDeObjetivo c={c} ajustes={ajustes} tipo="tiempo" titulo="Tiempo" />
        <CamposDeObjetivo c={c} ajustes={ajustes} tipo="cardio" titulo="Cardio" />
      </Tarjeta>
      <Tarjeta titulo="1RM estimado">
        <Selector
          etiqueta="Cómo se calcula el 1RM"
          pequeno
          aLoAncho
          opciones={[
            { clave: 'media', texto: 'Media de las series' },
            { clave: 'mejor', texto: 'Mejor serie' },
          ]}
          elegida={ajustes.unoRM}
          alElegir={(unoRM) => cambiarAjustes({ unoRM })}
        />
        <Parrafo>
          {ajustes.unoRM === 'media'
            ? 'Hace la media de todas las series del día.'
            : 'Usa solo la serie más fuerte del día y las demás no cuentan.'}{' '}
          Con él se ve si un ejercicio ha mejorado, en el historial y en su gráfica.
        </Parrafo>
      </Tarjeta>

      <Apartado>Apariencia</Apartado>
      <Tarjeta titulo="Tema">
        <Selector
          etiqueta="Tema"
          pequeno
          aLoAncho
          opciones={[
            { clave: 'oscuro', texto: 'Oscuro' },
            { clave: 'claro', texto: 'Claro' },
            { clave: 'sistema', texto: 'Automático' },
          ]}
          elegida={ajustes.tema}
          alElegir={(tema) => cambiarAjustes({ tema })}
        />
        <Parrafo centrado>Automático usa el mismo que tu dispositivo.</Parrafo>
      </Tarjeta>
      <Tarjeta titulo="Colores de los días">
        <Parrafo>Cada día de la semana tiene su color en el calendario y en las rutinas.</Parrafo>
        <View>
          {[1, 2, 3, 4, 5, 6, 7].map((dia) => (
            <Pressable
              key={dia}
              accessibilityRole="button"
              onPress={() => setDiaAbierto(dia)}
              style={[estilos.dia, dia > 1 && { borderTopWidth: 1, borderTopColor: c.borde }]}
            >
              <View style={[estilos.muestra, { backgroundColor: colorDelDia(dia, ajustes) }]} />
              <Text style={[estilos.nombreDia, { color: c.texto }]}>{nombreDelDiaSemana(dia)}</Text>
              <Icono nombre="abrir" pequeno color={c.textoTenue} />
            </Pressable>
          ))}
        </View>
        {coloresPropios && (
          <Boton
            variante="secundaria"
            texto="Volver a los colores de la app"
            alPulsar={() => cambiarAjustes({ colores: POR_DEFECTO.colores })}
          />
        )}
      </Tarjeta>

      {diaAbierto !== null && (
        <HojaDeColor
          diaSemana={diaAbierto}
          alElegir={(eleccion) => elegirColor(diaAbierto, eleccion)}
          alCerrar={() => setDiaAbierto(null)}
        />
      )}
    </>
  )
}

const estilos = StyleSheet.create({
  apartado: { marginTop: 8, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  tarjeta: {
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderWidth: 1,
    borderRadius: RADIO,
  },
  tituloTarjeta: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  parrafo: { fontSize: 14, lineHeight: 20 },
  fallo: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  fila: { flexDirection: 'row', gap: 8 },
  paso: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  campoPaso: {
    width: 72,
    height: 44,
    padding: 0,
    fontSize: 16,
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
    fontVariant: ['tabular-nums'],
  },
  objetivo: {
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderWidth: 1,
    borderRadius: RADIO,
  },
  tituloObjetivo: { paddingBottom: 8, borderBottomWidth: 1, fontSize: 14, fontWeight: '600' },
  dia: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  muestra: { width: 22, height: 22, borderRadius: 11 },
  nombreDia: { flex: 1, fontSize: 15 },
})
