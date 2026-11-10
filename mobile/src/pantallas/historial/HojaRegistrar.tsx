/**
 * H1b · Registrar un día pasado: para pasar la libreta o apuntar un día que se olvidó.
 * Puerto de `web/src/paginas/historial/HojaRegistrar.tsx`.
 *
 * Ofrece lo que tocaba y lo que seguía por recuperar ese día (`api.hoy(fecha)`), pero no
 * adelantar: la hoja apunta de hoy hacia atrás, y adelantar se hace solo desde Entrenar
 * (decisión del autor). Debajo, todas las rutinas, también esas, para apuntarlas sin contar
 * para ningún día del programa. No cambia lo planificado: registra lo que pasó.
 */
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Boton } from '../../componentes/Boton'
import { Dialogo } from '../../componentes/Dialogo'
import { FalloAlCargar } from '../../componentes/FalloAlCargar'
import { Hoja } from '../../componentes/Hoja'
import type { Hoy, RutinaMinima } from '../../logica/tipos'
import { api } from '../../plataforma/api'
import { useColores } from '../../tema'
import { colorDelDia } from '../../utiles/colores'
import {
  conArticulo,
  diaDeLaSemana,
  fechaCompleta,
  fechaLarga,
  nombreDelDia,
} from '../../utiles/fechas'

interface Props {
  fecha: string
  alCerrar: () => void
}

/**
 * Una opción de la hoja: qué rutina, qué día cuenta y cómo se dice. Las que cuentan para un
 * día del programa llevan el color de ese día; las que no, sin punto.
 */
type Opcion = {
  clave: string
  rutina: RutinaMinima
  titulo: string
  cubre: string | null
}

type Eleccion = { opcion: Opcion; cuerpo: string | undefined }

function contarEjercicios(cuantos: number) {
  return cuantos === 1 ? '1 ejercicio' : `${cuantos} ejercicios`
}

export function HojaRegistrar({ fecha, alCerrar }: Props) {
  const c = useColores()
  const [resumen, setResumen] = useState<Hoy | null>(null)
  // Cada vez que cambia, se vuelve a leer el día (Reintentar), sin cerrar la hoja.
  const [intento, setIntento] = useState(0)
  const [fallido, setFallido] = useState<{ intento: number; fallo: unknown } | null>(null)
  const error = fallido?.intento === intento ? fallido.fallo : null
  const [eleccion, setEleccion] = useState<Eleccion | null>(null)

  useEffect(() => {
    let vigente = true
    api
      .hoy(fecha)
      .then((leido) => vigente && setResumen(leido))
      .catch((fallo: Error) => vigente && setFallido({ intento, fallo }))
    return () => {
      vigente = false
    }
  }, [fecha, intento])

  // «del miércoles 9»: lo que se recupera es de pocos días antes que el de la hoja, cuyo
  // título ya dice el mes. De otro mes, la fecha entera.
  function delDia(iso: string) {
    return iso.slice(0, 7) === fecha.slice(0, 7)
      ? `${nombreDelDia(iso)} ${Number(iso.slice(8))}`
      : fechaCompleta(iso)
  }

  function ejercicios(rutina: RutinaMinima) {
    const datos = resumen?.rutinas.find((una) => una.id === rutina.id)
    return datos ? contarEjercicios(datos.ejercicios) : ''
  }

  const cuentan: Opcion[] = []
  const otras: Opcion[] = []
  if (resumen) {
    const dia = resumen.semana.find((uno) => uno.fecha === fecha)
    if (resumen.situacion === 'entrenamiento' && dia?.rutina) {
      cuentan.push({
        clave: 'propia',
        rutina: dia.rutina,
        titulo: `${dia.rutina.nombre}, lo que tocaba`,
        cubre: fecha,
      })
    }
    for (const recuperable of resumen.por_recuperar.filter((r) => r.se_puede_hoy)) {
      cuentan.push({
        clave: `recuperar-${recuperable.fecha}`,
        rutina: recuperable.rutina,
        titulo: `Recuperar el ${recuperable.rutina.nombre} del ${delDia(recuperable.fecha)}`,
        cubre: recuperable.fecha,
      })
    }
    // Con un día pasado, la lógica solo ofrece `sin_contar`: ni intercambiar ni adelantar.
    for (const ofrecida of resumen.ofrecidas) {
      if (ofrecida.accion === 'sin_contar') {
        otras.push({
          clave: `otra-${ofrecida.rutina.id}`,
          rutina: ofrecida.rutina,
          titulo: ofrecida.rutina.nombre,
          cubre: null,
        })
      }
    }
  }

  function elegir(opcion: Opcion) {
    // Las que cuentan para un día no llevan texto (decisión del autor): el título ya dice
    // qué día recupera.
    const cuerpo = opcion.cubre ? undefined : 'No contará para ningún día del programa.'
    setEleccion({ opcion, cuerpo })
  }

  async function registrar(opcion: Opcion) {
    const creada = await api.crearEntrenamiento({
      rutina_id: opcion.rutina.id,
      fecha,
      notas: null,
      cubre_fecha: opcion.cubre,
    })
    setEleccion(null)
    alCerrar()
    router.push({
      pathname: '/sesion/[id]',
      params: { id: String(creada.id) },
    })
  }

  function Fila({ opcion }: { opcion: Opcion }) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => elegir(opcion)}
        style={({ pressed }) => [
          estilos.fila,
          { borderTopColor: c.borde },
          pressed && { opacity: 0.7 },
        ]}
      >
        {opcion.cubre && (
          <View
            style={[estilos.punto, { backgroundColor: colorDelDia(diaDeLaSemana(opcion.cubre)) }]}
          />
        )}
        <Text style={[estilos.filaTitulo, { color: c.texto }]}>{opcion.titulo}</Text>
        <Text style={[estilos.filaExtra, { color: c.textoTenue }]}>
          {ejercicios(opcion.rutina)}
        </Text>
      </Pressable>
    )
  }

  return (
    <>
      <Hoja
        titulo={fechaLarga(fecha)}
        subtitulo={
          'No hay ninguna sesión registrada este día.\nElige qué rutina hiciste para apuntarlo ahora.'
        }
        alCerrar={() => !eleccion && alCerrar()}
      >
        {error ? (
          <FalloAlCargar fallo={error} alReintentar={() => setIntento((n) => n + 1)} />
        ) : null}
        {!resumen && !error && (
          <Text style={[estilos.cargando, { color: c.textoTenue }]}>Cargando…</Text>
        )}

        {resumen?.situacion === 'primera_vez' && (
          <View style={[estilos.vacia, { borderTopColor: c.borde }]}>
            <Text style={[estilos.vaciaTexto, { color: c.textoTenue }]}>
              Todavía no tienes rutinas. Crea una en la pestaña Programas para poder apuntar lo que
              hiciste.
            </Text>
            <Boton
              texto="Ir a Programas"
              alPulsar={() => {
                alCerrar()
                router.navigate('/programas')
              }}
            />
          </View>
        )}

        {cuentan.map((opcion) => (
          <Fila key={opcion.clave} opcion={opcion} />
        ))}
        {otras.length > 0 && (
          <>
            <Text style={[estilos.rotulo, { color: c.textoTenue, borderTopColor: c.borde }]}>
              Estas no contarán para ningún día del programa
            </Text>
            {otras.map((opcion) => (
              <Fila key={opcion.clave} opcion={opcion} />
            ))}
          </>
        )}
      </Hoja>

      {eleccion && (
        <Dialogo
          titulo={`¿Registrar ${eleccion.opcion.rutina.nombre} ${conArticulo(fecha)}?`}
          cuerpo={eleccion.cuerpo}
          confirmar="Registrar"
          alConfirmar={() => registrar(eleccion.opcion)}
          alCancelar={() => setEleccion(null)}
        />
      )}
    </>
  )
}

const estilos = StyleSheet.create({
  cargando: { fontSize: 13, textAlign: 'center', paddingVertical: 10 },
  fila: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  punto: { width: 8, height: 8, borderRadius: 999 },
  filaTitulo: { flex: 1, fontSize: 15, fontWeight: '600' },
  filaExtra: { fontSize: 13, flexShrink: 0 },
  rotulo: {
    paddingTop: 14,
    paddingBottom: 8,
    borderTopWidth: 1,
    fontSize: 12.5,
    textAlign: 'center',
  },
  vacia: { gap: 12, paddingTop: 14, paddingBottom: 4, borderTopWidth: 1 },
  vaciaTexto: { fontSize: 14, lineHeight: 20 },
})
