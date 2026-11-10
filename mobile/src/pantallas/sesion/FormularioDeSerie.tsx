/**
 * El formulario de una serie, con los campos del tipo de su ejercicio en − / + para poder
 * usarlo con una mano. Puerto de `web/src/paginas/sesion/FormularioDeSerie.tsx`: misma
 * lectura de las medidas, mismos topes y mismos textos.
 *
 * - peso y repeticiones: Peso y Reps;
 * - peso corporal: Carga (con *Lastre* o *Ayuda*; 0 es sin carga), Reps y Peso corporal;
 * - tiempo: Tiempo (minutos y segundos) y Peso, que es opcional;
 * - cardio: Tiempo y Distancia, que es opcional.
 *
 * Arranca con los datos de la serie anterior porque las series de un ejercicio suelen
 * repetir peso: lo normal es cambiar solo las repeticiones. Por eso no se vacía al guardar.
 */
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { Boton } from '../../componentes/Boton'
import { CampoConPasos, Rotulo } from '../../componentes/CampoConPasos'
import { CampoDeDuracion } from '../../componentes/CampoDeDuracion'
import { textoDelFallo } from '../../logica/api'
import type { TipoRegistro } from '../../logica/tipos'
import { RADIO_PEQUENO, useColores } from '../../tema'
import { ajustes } from '../../utiles/ajustes'
import { kilos, kilosCorporales } from '../../utiles/medidas'
import {
  aKilos,
  aMetros,
  enUnidad,
  enUnidadDeDistancia,
  leerNumero,
  numeroLegible,
  pesoLegible,
  unidad,
  unidadDeDistancia,
} from '../../utiles/numeros'

export type DatosDeSerie = {
  // En kg y en segundos, como lo guarda la api, aunque se apunte en lb. Solo van las
  // medidas del tipo del ejercicio; el resto, nulo.
  peso: number | null
  repeticiones: number | null
  duracion_s: number | null
  // En metros: solo en el cardio, y si se apunta.
  distancia_m: number | null
  peso_corporal: number | null
  variante: string | null
}

// Lo que vale un peso corporal, en kg (como en Ajustes).
const MINIMO_PESO_CORPORAL = 20
const MAXIMO_PESO_CORPORAL = 400

// Los topes de la api: pasarlos daría un 422 en inglés, así que se dicen antes.
const MAXIMO_PESO = 9999.99
const MAXIMO_REPS = 1000
const MAXIMO_SEGUNDOS = 86400
const MAXIMO_METROS = 1_000_000
const MAXIMO_NUMERO_DE_SERIE = 100

/** Qué tope de la api pasa la serie, dicho en la unidad elegida; nulo si ninguno. */
function topePasado(orden: number, medidas: Omit<DatosDeSerie, 'variante'>): string | null {
  if (orden > MAXIMO_NUMERO_DE_SERIE) {
    return `Un ejercicio no admite más de ${MAXIMO_NUMERO_DE_SERIE} series.`
  }
  if (medidas.peso !== null && Math.abs(medidas.peso) > MAXIMO_PESO) {
    return `El peso no puede pasar de ${numeroLegible(Math.floor(enUnidad(MAXIMO_PESO)))} ${unidad()}.`
  }
  if (medidas.repeticiones !== null && medidas.repeticiones > MAXIMO_REPS) {
    return `Las repeticiones no pueden pasar de ${MAXIMO_REPS}.`
  }
  if (medidas.duracion_s !== null && medidas.duracion_s > MAXIMO_SEGUNDOS) {
    return 'La duración no puede pasar de 24 horas.'
  }
  if (medidas.distancia_m !== null && medidas.distancia_m > MAXIMO_METROS) {
    return `La distancia no puede pasar de ${numeroLegible(Math.floor(enUnidadDeDistancia(MAXIMO_METROS)))} ${unidadDeDistancia()}.`
  }
  return null
}

// El ejemplo de variante de cada tipo: «con pausa» no le dice nada a quien corre en la cinta.
const EJEMPLO_DE_VARIANTE: Record<TipoRegistro, string> = {
  peso_reps: 'Ej. con pausa, sentado',
  corporal: 'Ej. con pausa',
  tiempo: 'Ej. con las rodillas apoyadas',
  cardio: 'Ej. con inclinación del 2 %',
}

type Props = {
  /** El número que se lee: la posición de la serie en su ejercicio. */
  numero: number
  /** Lo que se guarda como `numero_serie`: es sobre esto el tope de la api. */
  orden: number
  /** Cómo se apunta el ejercicio: decide qué campos lleva el formulario. */
  tipo: TipoRegistro
  /**
   * Con qué valores arranca: la serie anterior, la que se edita, o la última vez. Una serie
   * de hoy trae su peso corporal (aunque sea nulo); la última vez, no: entonces arranca con
   * el de Ajustes.
   */
  semilla: {
    peso: string | number | null
    repeticiones: number | null
    duracion_s?: number | null
    distancia_m?: number | null
    peso_corporal?: string | number | null
    variante: string | null
  } | null
  editando: boolean
  /** Guardar y Cancelar en la misma línea: al editar, y al añadir en el día del historial. */
  enLinea?: boolean
  /** El texto del botón de guardar, si no es el de siempre (Añadir o Aplicar en el día). */
  textoGuardar?: string
  alGuardar: (datos: DatosDeSerie) => Promise<void>
  alCancelar: () => void
}

export function FormularioDeSerie({
  numero,
  orden,
  tipo,
  semilla,
  editando,
  enLinea = false,
  textoGuardar,
  alGuardar,
  alCancelar,
}: Props) {
  const c = useColores()
  const corporal = tipo === 'corporal'
  const sembrado = semilla?.peso != null ? kilos(semilla) : null
  // El peso corporal con el que arranca, en kg. Solo cuenta en un formulario de peso corporal.
  const inicialCorporal =
    semilla && 'peso_corporal' in semilla ? kilosCorporales(semilla) : ajustes().pesoCorporal

  const textoPesoInicial = corporal
    ? pesoLegible(Math.abs(sembrado ?? 0))
    : sembrado !== null
      ? pesoLegible(sembrado)
      : ''
  const [peso, setPeso] = useState(textoPesoInicial)
  /**
   * Lo tecleado en kg, sin signo. Si el campo sigue como arrancó, el peso guardado tal cual:
   * en lb, pasarlo por libras y de vuelta lo movería unos céntimos (61,25 → 61,23).
   */
  function pesoEnKilos(valor: number): number {
    return sembrado !== null && peso.trim() === textoPesoInicial
      ? Math.abs(sembrado)
      : aKilos(valor)
  }
  // Con carga de ayuda, el peso guardado es negativo: aquí se escribe en positivo y el
  // conmutador dice si es ayuda.
  const [ayuda, setAyuda] = useState(corporal && sembrado !== null && sembrado < 0)
  const [repeticiones, setRepeticiones] = useState(
    semilla?.repeticiones != null ? String(semilla.repeticiones) : '',
  )
  const [segundos, setSegundos] = useState(semilla?.duracion_s ?? 0)
  // La distancia, tal y como se teclea: en la unidad elegida, vacía si no se apuntó.
  const [distancia, setDistancia] = useState(
    semilla?.distancia_m ? numeroLegible(enUnidadDeDistancia(semilla.distancia_m), 2) : '',
  )
  const [pesoCorporal, setPesoCorporal] = useState(
    inicialCorporal !== null ? pesoLegible(inicialCorporal) : '',
  )
  const [variante, setVariante] = useState(semilla?.variante ?? '')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  /** Las medidas de la serie según el tipo, o el aviso de lo que falta. */
  function leerMedidas(): Omit<DatosDeSerie, 'variante'> | string {
    if (tipo === 'cardio') {
      if (segundos < 1) return 'Pon cuánto duró.'
      const km = leerNumero(distancia)
      if (distancia.trim() !== '' && (km === null || aMetros(km) < 1)) {
        return 'Pon la distancia, o déjala vacía.'
      }
      return {
        peso: null,
        repeticiones: null,
        duracion_s: segundos,
        distancia_m: distancia.trim() === '' || km === null ? null : aMetros(km),
        peso_corporal: null,
      }
    }
    if (tipo === 'tiempo') {
      if (segundos < 1) return 'Pon cuánto duró.'
      const valor = leerNumero(peso)
      if (peso.trim() !== '' && (valor === null || valor < 0)) return 'Pon el peso, o déjalo vacío.'
      return {
        peso: peso.trim() === '' || valor === null ? null : pesoEnKilos(valor),
        repeticiones: null,
        duracion_s: segundos,
        distancia_m: null,
        peso_corporal: null,
      }
    }
    const valor = leerNumero(peso)
    const reps = leerNumero(repeticiones)
    if (valor === null || valor < 0 || reps === null || reps < 1 || !Number.isInteger(reps)) {
      return corporal ? 'Pon la carga y las repeticiones.' : 'Pon el peso y las repeticiones.'
    }
    if (!corporal) {
      return {
        peso: pesoEnKilos(valor),
        repeticiones: reps,
        duracion_s: null,
        distancia_m: null,
        peso_corporal: null,
      }
    }
    const carga = pesoEnKilos(valor)
    const corporalKg = leerNumero(pesoCorporal)
    if (pesoCorporal.trim() !== '' && corporalKg === null) return 'Pon tu peso corporal.'
    const textoInicial = inicialCorporal !== null ? pesoLegible(inicialCorporal) : ''
    const tocado = pesoCorporal.trim() !== textoInicial
    const nuevoCorporal = !tocado
      ? inicialCorporal
      : corporalKg === null
        ? null
        : aKilos(corporalKg)
    // Solo se comprueba el rango si se cambió: uno ya guardado fuera de él no impide
    // corregir otra cosa.
    if (
      tocado &&
      nuevoCorporal !== null &&
      (nuevoCorporal < MINIMO_PESO_CORPORAL || nuevoCorporal > MAXIMO_PESO_CORPORAL)
    ) {
      return `Pon un peso corporal de ${numeroLegible(Math.ceil(enUnidad(MINIMO_PESO_CORPORAL)))} a ${numeroLegible(Math.floor(enUnidad(MAXIMO_PESO_CORPORAL)))} ${unidad()}.`
    }
    return {
      peso: ayuda && carga > 0 ? -carga : carga,
      repeticiones: reps,
      duracion_s: null,
      distancia_m: null,
      // Si no se tocó, el valor guardado en kg tal cual.
      peso_corporal: nuevoCorporal,
    }
  }

  async function enviar() {
    const medidas = leerMedidas()
    if (typeof medidas === 'string') {
      setFallo(medidas)
      return
    }
    const tope = topePasado(orden, medidas)
    if (tope) {
      setFallo(tope)
      return
    }
    setGuardando(true)
    setFallo(null)
    try {
      await alGuardar({
        ...medidas,
        variante: variante.trim() === '' ? null : variante.trim(),
      })
    } catch (error) {
      setFallo(textoDelFallo(error))
    } finally {
      setGuardando(false)
    }
  }

  const campoDePeso = (etiqueta: string, extra?: ReactNode) => (
    <CampoConPasos
      etiqueta={etiqueta}
      extra={extra}
      valor={peso}
      cambiar={setPeso}
      // Lo que sube o baja con − / +, en Ajustes. Un peso que no cae en el paso se teclea.
      paso={ajustes().pasoPeso}
      minimo={0}
      decimales
    />
  )

  const opcionDeCarga = (texto: string, activa: boolean, alPulsar: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: activa }}
      onPress={alPulsar}
      style={[estilos.opcionCarga, activa && { backgroundColor: c.superficie }]}
    >
      <Text
        style={[
          estilos.opcionCargaTexto,
          { color: activa ? c.acento : c.textoTenue },
          activa && estilos.fuerte,
        ]}
      >
        {texto}
      </Text>
    </Pressable>
  )

  return (
    <View style={estilos.formulario}>
      {editando && (
        <Text style={[estilos.editandoAviso, { color: c.acento }]}>Editando la serie {numero}</Text>
      )}
      {tipo === 'peso_reps' && (
        <View style={estilos.dos}>
          {campoDePeso(`Peso (${unidad()})`)}
          <CampoConPasos
            etiqueta="Reps"
            valor={repeticiones}
            cambiar={setRepeticiones}
            paso={1}
            minimo={1}
          />
        </View>
      )}
      {corporal && (
        <>
          {campoDePeso(
            `Carga (${unidad()})`,
            <View
              accessibilityLabel="Tipo de carga"
              style={[estilos.carga, { borderColor: c.borde, backgroundColor: c.fondo }]}
            >
              {opcionDeCarga('Lastre', !ayuda, () => setAyuda(false))}
              {opcionDeCarga('Ayuda', ayuda, () => setAyuda(true))}
            </View>,
          )}
          <View style={estilos.dos}>
            <CampoConPasos
              etiqueta="Reps"
              valor={repeticiones}
              cambiar={setRepeticiones}
              paso={1}
              minimo={1}
            />
            <CampoConPasos
              etiqueta={`Peso corporal (${unidad()})`}
              valor={pesoCorporal}
              cambiar={setPesoCorporal}
              paso={ajustes().pasoPeso}
              minimo={0}
              decimales
            />
          </View>
        </>
      )}
      {tipo === 'cardio' && (
        <>
          <CampoDeDuracion
            etiqueta="Tiempo"
            sinTitulo
            segundos={segundos}
            cambiar={setSegundos}
            paso={ajustes().pasoTiempo}
          />
          <CampoConPasos
            etiqueta={`Distancia (${unidadDeDistancia()}, opcional)`}
            valor={distancia}
            cambiar={setDistancia}
            paso={0.1}
            minimo={0}
            decimales
          />
        </>
      )}
      {tipo === 'tiempo' && (
        <>
          <CampoDeDuracion
            etiqueta="Tiempo"
            sinTitulo
            segundos={segundos}
            cambiar={setSegundos}
            paso={ajustes().pasoTiempo}
          />
          {campoDePeso(`Peso (${unidad()}, opcional)`)}
        </>
      )}
      <View style={estilos.campo}>
        <Rotulo>Variante (opcional)</Rotulo>
        <TextInput
          style={[
            estilos.campoTexto,
            { color: c.texto, backgroundColor: c.fondo, borderColor: c.borde },
          ]}
          maxLength={100}
          value={variante}
          placeholder={EJEMPLO_DE_VARIANTE[tipo]}
          placeholderTextColor={c.textoTenue}
          onChangeText={setVariante}
          accessibilityLabel="Variante (opcional)"
        />
      </View>
      {editando || enLinea ? (
        <View style={estilos.botones}>
          <Boton
            texto="Cancelar"
            variante="peligro"
            alPulsar={alCancelar}
            desactivado={guardando}
            estirar
          />
          <Boton
            texto={textoGuardar ?? (editando ? 'Guardar cambios' : `Guardar serie ${numero}`)}
            variante="principal"
            alPulsar={() => void enviar()}
            desactivado={guardando}
            estirar
          />
        </View>
      ) : (
        <Boton
          texto={`Guardar serie ${numero}`}
          variante="principal"
          alPulsar={() => void enviar()}
          desactivado={guardando}
        />
      )}
      {fallo && <Text style={[estilos.fallo, { color: c.error }]}>{fallo}</Text>}
    </View>
  )
}

const estilos = StyleSheet.create({
  formulario: { gap: 10, marginTop: 4 },
  editandoAviso: { fontSize: 12.5, fontWeight: '600' },
  dos: { flexDirection: 'row', gap: 8 },
  campo: { gap: 4 },
  campoTexto: {
    height: 48,
    borderWidth: 1,
    borderRadius: RADIO_PEQUENO,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  carga: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, padding: 2 },
  opcionCarga: { paddingVertical: 3, paddingHorizontal: 12, borderRadius: 999 },
  opcionCargaTexto: { fontSize: 12.5 },
  fuerte: { fontWeight: '600' },
  botones: { flexDirection: 'row', gap: 12 },
  fallo: { fontSize: 13 },
})
