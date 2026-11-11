/**
 * P1 · Programas y rutinas: los programas (el activo primero) y la biblioteca de rutinas,
 * cada lista con sus ocultos plegados al pie. Puerto de `web/src/paginas/programas/Programas.tsx`.
 *
 * Las rutinas van en su propia lista y no solo dentro de los programas: una rutina puede
 * estar en varios o en ninguno, y sin esta lista la que no está en ninguno sería inalcanzable.
 *
 * Diferencia con la web: qué listas de ocultos están abiertas no va en la ruta, porque aquí
 * la pantalla se queda montada debajo de la que se abre y al volver siguen igual.
 */
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Boton } from '../../componentes/Boton'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Icono } from '../../componentes/Icono'
import { Ocultos } from '../../componentes/Ocultos'
import { TextoCentrado } from '../../componentes/TextoCentrado'
import type { Programa, Rutina } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { RADIO, useColores, type Colores } from '../../tema'
import { diaYMesConAnio, mesConAnio, sumarDias } from '../../utiles/fechas'
import { cuantosDias, ejercicios, enumerar, NOMBRES_DE_LOS_DIAS } from '../../utiles/textos'

type Datos = {
  programas: Programa[]
  programasOcultos: Programa[]
  rutinas: Rutina[]
  rutinasOcultas: Rutina[]
}

/**
 * «3 días · lunes, miércoles y viernes»; sin `conNombres`, solo «3 días» (uno oculto, donde
 * no importa cuáles). Solo cuentan los días cuya rutina está visible: una rutina oculta deja
 * su día en descanso.
 */
function diasDelPrograma(programa: Programa, conNombres = true) {
  const dias = programa.dias.filter((dia) => dia.rutina.oculto_desde === null)
  const cuantos = cuantosDias(dias.length)
  if (dias.length === 0 || !conNombres) return cuantos
  if (dias.length === 7) return `${cuantos} · todos los días`
  return `${cuantos} · ${enumerar(dias.map((dia) => NOMBRES_DE_LOS_DIAS[dia.dia_semana - 1]))}`
}

/** Cuándo se usó: «Desde el 6 de julio», «Del 2 de marzo al 28 de junio». */
function usoDelPrograma(programa: Programa) {
  const periodo = programa.ultimo_periodo
  if (periodo === null) return 'Sin usar todavía'
  if (periodo.hasta === null) return `Desde el ${diaYMesConAnio(periodo.desde)}`
  // `hasta` es el primer día en que ya no estaba activo.
  const ultimo = sumarDias(periodo.hasta, -1)
  if (ultimo === periodo.desde) return `El ${diaYMesConAnio(ultimo)}`
  return `Del ${diaYMesConAnio(periodo.desde)} al ${diaYMesConAnio(ultimo)}`
}

/**
 * Uno oculto dice desde cuándo no se usa, y no las fechas exactas: ya no cuenta. Ocultar el
 * activo cierra su periodo, así que siempre tiene `hasta`.
 */
function sinUsarDesde(programa: Programa) {
  const hasta = programa.ultimo_periodo?.hasta
  return hasta ? `sin usar desde ${mesConAnio(sumarDias(hasta, -1))}` : 'sin usar todavía'
}

function enProgramas(rutina: Rutina) {
  if (rutina.num_programas === 0) return 'sin programa'
  return rutina.num_programas === 1 ? 'en 1 programa' : `en ${rutina.num_programas} programas`
}

export function Programas() {
  const c = useColores()
  const e = useEstilos(c)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [abiertos, setAbiertos] = useState<{ programas: boolean; rutinas: boolean }>({
    programas: false,
    rutinas: false,
  })
  const [lectura, setLectura] = useState(0)

  // Al volver de un programa o una rutina (que se pueden haber cambiado, ocultado o borrado),
  // se lee de nuevo: en la web la pantalla se vuelve a montar; aquí se queda debajo.
  useFocusEffect(
    useCallback(() => {
      let vigente = true
      Promise.all([
        api.programas(),
        api.programas({ ocultos: true }),
        api.rutinas(),
        api.rutinas({ ocultas: true }),
      ])
        .then(([programas, programasOcultos, rutinas, rutinasOcultas]) => {
          if (!vigente) return
          setDatos({ programas, programasOcultos, rutinas, rutinasOcultas })
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

  // El activo primero; el resto, por nombre (ya vienen así de la lógica).
  const programas = [...datos.programas].sort((a, b) => Number(b.activo) - Number(a.activo))
  const sinRutinas = datos.rutinas.length === 0

  return (
    <SafeAreaView edges={['top']} style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <Text style={e.titulo} accessibilityRole="header">
          Programas
        </Text>

        <View style={e.seccion}>
          <Text style={e.rotulo}>Programas</Text>
          {programas.length === 0 && (
            <Text style={e.recuadroVacio}>Todavía no tienes ningún programa.</Text>
          )}
          {programas.map((programa) => (
            <TarjetaDePrograma key={programa.id} programa={programa} />
          ))}
          <View style={e.nuevo}>
            <Boton texto="Nuevo programa" alPulsar={() => router.push('/programas/nuevo')} />
          </View>
          <Ocultos
            cuantos={datos.programasOcultos.length}
            singular="programa oculto"
            plural="programas ocultos"
            abierto={abiertos.programas}
            alAlternar={() => setAbiertos((antes) => ({ ...antes, programas: !antes.programas }))}
          />
          {abiertos.programas &&
            datos.programasOcultos.map((programa) => (
              <TarjetaDePrograma key={programa.id} programa={programa} />
            ))}
        </View>

        <View style={e.seccion}>
          <Text style={e.rotulo}>Rutinas</Text>
          {sinRutinas ? (
            <TextoCentrado style={e.recuadroVacio}>
              {'Todavía no tienes rutinas.\nCrea primero una y luego reúnelas en un programa.'}
            </TextoCentrado>
          ) : (
            <View style={e.rutinas}>
              {datos.rutinas.map((rutina, indice) => (
                <FilaDeRutina key={rutina.id} rutina={rutina} primera={indice === 0} />
              ))}
            </View>
          )}
          {/* Sin rutinas no se puede hacer nada más: crear una es lo primero. */}
          <View style={e.nuevo}>
            <Boton
              texto="Nueva rutina"
              variante={sinRutinas ? 'principal' : 'normal'}
              alPulsar={() => router.push('/programas/rutinas/nueva')}
            />
          </View>
          <Ocultos
            cuantos={datos.rutinasOcultas.length}
            singular="rutina oculta"
            plural="rutinas ocultas"
            abierto={abiertos.rutinas}
            alAlternar={() => setAbiertos((antes) => ({ ...antes, rutinas: !antes.rutinas }))}
          />
          {abiertos.rutinas && datos.rutinasOcultas.length > 0 && (
            <View style={[e.rutinas, e.discontinuo]}>
              {datos.rutinasOcultas.map((rutina, indice) => (
                <FilaDeRutina key={rutina.id} rutina={rutina} primera={indice === 0} />
              ))}
            </View>
          )}
        </View>

        <TextoCentrado style={e.pie}>
          {
            'Una rutina son los ejercicios de un día.\nUn programa reparte esas rutinas en la semana.'
          }
        </TextoCentrado>
      </ScrollView>
    </SafeAreaView>
  )
}

function TarjetaDePrograma({ programa }: { programa: Programa }) {
  const c = useColores()
  const e = useEstilos(c)
  const oculto = programa.oculto_desde !== null

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/programas/[id]', params: { id: String(programa.id) } })
      }
      style={({ pressed }) => [e.tarjeta, oculto && e.discontinuo, pressed && { opacity: 0.7 }]}
    >
      <View style={e.tarjetaTexto}>
        {/* Solo el activo lleva el nombre en blanco: los demás no se están usando. */}
        <Text style={[e.tarjetaNombre, programa.activo && { color: c.texto }]}>
          {programa.nombre}
        </Text>
        {oculto ? (
          <>
            <Text style={e.linea}>
              {diasDelPrograma(programa, false)} · {sinUsarDesde(programa)}
            </Text>
            <Text style={e.linea}>Oculto desde el {diaYMesConAnio(programa.oculto_desde!)}</Text>
          </>
        ) : (
          <>
            <Text style={e.linea}>{diasDelPrograma(programa)}</Text>
            <Text style={e.linea}>{usoDelPrograma(programa)}</Text>
          </>
        )}
      </View>
      {programa.activo && <Text style={e.etiquetaActivo}>activo</Text>}
      <Icono nombre="abrir" color={c.textoTenue} pequeno />
    </Pressable>
  )
}

/**
 * Sin punto de color (decisión del autor): una rutina solo tiene color puesta en un día de un
 * programa, y es el de ese día. Una oculta dice «oculta desde…».
 */
function FilaDeRutina({ rutina, primera }: { rutina: Rutina; primera: boolean }) {
  const c = useColores()
  const e = useEstilos(c)
  const oculta = rutina.oculto_desde !== null
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/programas/rutinas/[id]', params: { id: String(rutina.id) } })
      }
      style={({ pressed }) => [
        e.rutina,
        !primera && { borderTopWidth: 1, borderTopColor: c.borde },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={e.rutinaTexto}>
        <Text style={[e.rutinaNombre, oculta && { color: c.textoTenue }]}>{rutina.nombre}</Text>
        <Text style={e.linea}>
          {ejercicios(rutina)} ·{' '}
          {oculta ? `oculta desde el ${diaYMesConAnio(rutina.oculto_desde!)}` : enProgramas(rutina)}
        </Text>
      </View>
      <Icono nombre="abrir" color={c.textoTenue} pequeno />
    </Pressable>
  )
}

function useEstilos(c: Colores) {
  return StyleSheet.create({
    pantalla: { flex: 1, backgroundColor: c.fondo },
    contenido: { padding: 16, gap: 18 },
    aviso: { fontSize: 14, lineHeight: 20, color: c.textoTenue, padding: 16 },
    titulo: { fontSize: 22, fontWeight: '700', textAlign: 'center', color: c.texto },
    seccion: { gap: 10 },
    rotulo: { fontSize: 13, color: c.textoTenue },
    nuevo: { marginTop: 6 },
    recuadroVacio: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
      fontSize: 14,
      lineHeight: 20,
      color: c.textoTenue,
    },
    discontinuo: { borderStyle: 'dashed' },
    tarjeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 14,
      paddingLeft: 16,
      paddingRight: 12,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    tarjetaTexto: { flex: 1, minWidth: 0, gap: 2 },
    tarjetaNombre: { fontSize: 16, fontWeight: '600', color: c.textoTenue },
    linea: { fontSize: 13, color: c.textoTenue },
    etiquetaActivo: {
      flexShrink: 0,
      fontSize: 12.5,
      color: c.acento,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 2,
      paddingHorizontal: 10,
    },
    rutinas: {
      paddingHorizontal: 16,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    rutina: {
      minHeight: 56,
      // Aire arriba y abajo para cuando el nombre ocupa dos líneas.
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    rutinaTexto: { flex: 1, minWidth: 0 },
    rutinaNombre: { fontSize: 15, fontWeight: '600', color: c.texto },
    pie: { fontSize: 13, lineHeight: 19, color: c.textoTenue },
  })
}
