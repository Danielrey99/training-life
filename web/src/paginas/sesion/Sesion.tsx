import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { api, ErrorDeApi } from '../../api/cliente'
import type { Ejercicio, Entrenamiento, HuecoDeRutina, Rutina, Serie } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { NotaDeSesion } from '../../componentes/NotaDeSesion'
import { Ocultos } from '../../componentes/Ocultos'
import { fechaCompleta, fechaTitulo, hoy } from '../../utiles/fechas'
import { serieLarga } from '../../utiles/medidas'
import { seriesObjetivoDe } from '../programas/textos'
import { useVolver } from '../../utiles/volver'
import { BloqueDeHueco, type SerieAGuardar } from './BloqueDeHueco'
import './sesion.css'

// Adónde se va al cancelar una sesión de hoy, y la flecha si no hay pantalla anterior:
// la pantalla de Hoy. *Terminar* lleva en cambio al día en el historial.
const SALIDA = '/'

function contarSeries(cuantas: number) {
  return cuantas === 1 ? '1 serie' : `${cuantas} series`
}

/** «has completado 1 de los 4 ejercicios»: con cualquier número, sin concordar «completo(s)». */
function completados(hechos: number, total: number) {
  if (total === 1)
    return hechos === 1 ? 'has completado el ejercicio' : 'aún no has completado el ejercicio'
  return `has completado ${hechos} de los ${total} ejercicios`
}

/**
 * El ejercicio con el que arranca un hueco: el de la última serie de hoy si ya
 * se empezó (quien cambió al comodín sigue con él); si no, el principal; y si el
 * principal está oculto, el primer comodín visible. Nulo si no queda ninguno.
 */
function ejercicioInicial(hueco: HuecoDeRutina, series: Serie[]): Ejercicio | null {
  const opciones = [
    hueco.ejercicio_principal,
    ...hueco.alternativas.map((alternativa) => alternativa.ejercicio),
  ]
  const ultima = series.filter((serie) => serie.slot_id === hueco.id).at(-1)
  const deHoy = opciones.find((ejercicio) => ejercicio.id === ultima?.ejercicio_id)
  return deHoy ?? opciones.find((ejercicio) => ejercicio.oculto_desde === null) ?? null
}

/**
 * E2 · La sesión en curso: se registra serie a serie, hueco a hueco.
 *
 * Cada serie viaja a la API en cuanto se guarda, en vez de acumularlas para el
 * final: una sesión dura más de una hora y cerrar la pestaña sin querer no puede
 * llevarse el entrenamiento. Por lo mismo, la sesión va en la URL
 * (`/sesion/{id}`): se puede salir a otras pantallas, recargar o volver más
 * tarde, y todo sigue ahí hasta *Terminar* o *Cancelar*.
 */
export function Sesion() {
  const { entrenamientoId } = useParams()
  const navegar = useNavigate()
  const volverAtras = useVolver()
  const desdeSuDia = (useLocation().state as { desdeSuDia?: boolean } | null)?.desdeSuDia ?? false

  const [sesion, setSesion] = useState<Entrenamiento | null>(null)
  const [rutina, setRutina] = useState<Rutina | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [abierto, setAbierto] = useState<number | null>(null)
  const [elegidos, setElegidos] = useState<Record<number, Ejercicio | null>>({})
  const [aBorrar, setABorrar] = useState<Serie | null>(null)
  // Elegir otro ejercicio en un hueco que ya tiene series: se pregunta, porque en cada hueco
  // se hace un solo ejercicio por sesión y cambiar borra las series que había.
  const [aCambiar, setACambiar] = useState<{ hueco: HuecoDeRutina; ejercicio: Ejercicio } | null>(
    null,
  )
  const [confirmando, setConfirmando] = useState<'terminar' | 'cancelar' | null>(null)
  // Las ediciones van de una en una: una serie o la nota, y mientras tanto el resto se
  // queda en gris (otros lápices, las ✕, los demás huecos, Terminar y Cancelar).
  const [editandoSerie, setEditandoSerie] = useState<number | null>(null)
  const [notaAbierta, setNotaAbierta] = useState(false)
  const [verOcultos, setVerOcultos] = useState(false)
  const hayAbierta = editandoSerie !== null || notaAbierta

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const leida = await api.entrenamiento(Number(entrenamientoId))
        // La rutina se pide aunque esté oculta: la sesión se tiene que poder terminar.
        const suRutina = await api.rutina(leida.rutina_id)
        if (!vigente) return

        const huecos = suRutina.slots
        const iniciales: Record<number, Ejercicio | null> = {}
        for (const hueco of huecos) iniciales[hueco.id] = ejercicioInicial(hueco, leida.series)

        // Se abre el primer hueco sin terminar: es por donde se va.
        const pendiente = huecos
          .filter((hueco) => !hueco.oculto_desde)
          .sort((uno, otro) => uno.orden - otro.orden)
          .find(
            (hueco) =>
              leida.series.filter((s) => s.slot_id === hueco.id).length <
              seriesObjetivoDe(hueco, iniciales[hueco.id]?.id),
          )

        setSesion(leida)
        setRutina(suRutina)
        setElegidos(iniciales)
        setAbierto(pendiente?.id ?? null)
      } catch (fallo) {
        if (!vigente) return
        // Una sesión que ya no existe (se canceló, o la URL viene mal copiada) no
        // puede dejar la pantalla en blanco: se vuelve a la salida.
        if (fallo instanceof ErrorDeApi && fallo.estado === 404) navegar(SALIDA, { replace: true })
        else setError((fallo as Error).message)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [entrenamientoId, navegar])

  if (error) return <p className="aviso error">{error}</p>
  if (!sesion || !rutina) return <p className="aviso">Cargando…</p>

  const activa = sesion

  // Un hueco oculto no se ofrece, pero si ya tiene series de esta sesión se sigue
  // enseñando: si no, desaparecerían sin explicación.
  const huecos = rutina.slots
    .filter(
      (hueco) => !hueco.oculto_desde || activa.series.some((serie) => serie.slot_id === hueco.id),
    )
    .sort((uno, otro) => uno.orden - otro.orden)

  const deHueco = (hueco: HuecoDeRutina) =>
    activa.series
      .filter((serie) => serie.slot_id === hueco.id)
      .sort((una, otra) => una.numero_serie - otra.numero_serie)
  const visibles = huecos.filter((hueco) => !hueco.oculto_desde)
  const ocultosConSeries = huecos.filter((hueco) => hueco.oculto_desde)
  const completos = visibles.filter(
    (hueco) => deHueco(hueco).length >= seriesObjetivoDe(hueco, elegidos[hueco.id]?.id),
  ).length

  // La pantalla de la que cuelga, para cancelar y para la flecha si no hay pantalla
  // anterior. Una sesión de un día pasado se apunta desde el calendario: va a su día (o
  // al mes, si aún no tiene series y no hay día que ver).
  const deOtroDia = activa.fecha < hoy()
  const mes = `/historial?mes=${activa.fecha.slice(0, 7)}`
  const padre = !deOtroDia ? SALIDA : activa.series.length > 0 ? `/historial/${activa.fecha}` : mes
  const alCancelar = deOtroDia ? mes : SALIDA

  const cifras = `${contarSeries(activa.series.length)} · ${completos} de ${visibles.length} ejercicios`

  async function guardar(huecoId: number, datos: SerieAGuardar, serieId?: number) {
    const cuerpo = { ...datos, slot_id: huecoId }
    const guardada = serieId
      ? await api.actualizarSerie(activa.id, serieId, cuerpo)
      : await api.crearSerie(activa.id, cuerpo)
    // Sobre el estado más reciente y no sobre `activa`: quien llama viene de un
    // await, y otra serie guardada entretanto se perdería.
    setSesion(
      (previa) =>
        previa && {
          ...previa,
          series: serieId
            ? previa.series.map((serie) => (serie.id === serieId ? guardada : serie))
            : [...previa.series, guardada],
        },
    )
  }

  async function borrar(serie: Serie) {
    await api.borrarSerie(activa.id, serie.id)
    setSesion(
      (previa) =>
        previa && {
          ...previa,
          series: previa.series.filter((s) => s.id !== serie.id),
        },
    )
    setABorrar(null)
  }

  function elegirEjercicio(hueco: HuecoDeRutina, ejercicio: Ejercicio) {
    setElegidos((previos) => ({ ...previos, [hueco.id]: ejercicio }))
  }

  function pedirElegir(hueco: HuecoDeRutina, ejercicio: Ejercicio) {
    if (elegidos[hueco.id]?.id === ejercicio.id) return
    // Sin series no hay nada que perder: se cambia sin preguntar.
    if (deHueco(hueco).length === 0) elegirEjercicio(hueco, ejercicio)
    else setACambiar({ hueco, ejercicio })
  }

  /** Borra las series que había en el hueco, una a una, y pasa al ejercicio elegido. */
  async function cambiarDeEjercicio(hueco: HuecoDeRutina, ejercicio: Ejercicio) {
    try {
      for (const serie of deHueco(hueco)) {
        await api.borrarSerie(activa.id, serie.id)
        setSesion(
          (previa) =>
            previa && { ...previa, series: previa.series.filter((s) => s.id !== serie.id) },
        )
      }
    } catch {
      // Se vuelve a leer lo que quedó: no se sabe cuántas llegaron a borrarse.
      setSesion(await api.entrenamiento(activa.id))
      throw new Error('No se pudieron borrar todas las series. Inténtalo otra vez.')
    }
    elegirEjercicio(hueco, ejercicio)
    setACambiar(null)
  }

  function bloque(hueco: HuecoDeRutina) {
    const clave = hueco.id
    const elegido = elegidos[clave] ?? null
    // La posición entre los visibles, como en el día del historial: uno oculto que ya
    // tiene series sale sin número (y al final, plegado) y no mueve el de los demás.
    const posicion = visibles.indexOf(hueco) + 1
    const nombre = elegido?.nombre ?? hueco.ejercicio_principal.nombre
    const titulo = posicion > 0 ? `${posicion} · ${nombre}` : nombre
    return (
      <BloqueDeHueco
        key={clave}
        hueco={hueco}
        titulo={titulo}
        series={deHueco(hueco)}
        elegido={elegido}
        elegir={(ejercicio) => pedirElegir(hueco, ejercicio)}
        abierto={abierto === clave}
        abrir={() => setAbierto(clave)}
        editandoId={editandoSerie}
        alEditar={setEditandoSerie}
        bloqueado={hayAbierta}
        sesion={activa}
        guardar={(datos, serieId) => guardar(hueco.id, datos, serieId)}
        pedirBorrar={setABorrar}
      />
    )
  }

  return (
    <div className="sesion">
      <header className="sesion-cabecera">
        <button
          type="button"
          className="boton-icono"
          aria-label="Volver"
          onClick={() => volverAtras(padre)}
        >
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>{rutina.nombre}</h1>
          {/* La fecha de un día pasado es larga ("Miércoles 30 de septiembre") y no cabe con
              las cifras: va en su propia línea, en vez de partirse por cualquier sitio. */}
          {deOtroDia ? (
            <>
              <p>{fechaTitulo(activa.fecha)}</p>
              <p>{cifras}</p>
            </>
          ) : (
            <p>
              {fechaTitulo(activa.fecha)} · {cifras}
            </p>
          )}
          {/* Si la sesión cuenta otro día, que se note: es "el Push del lunes", no el de hoy.
              Sin el nombre de la rutina, que ya va en el título (como en el día del historial). */}
          {activa.cubre_fecha && activa.cubre_fecha !== activa.fecha && (
            <span className="sesion-cuenta">
              {activa.cubre_fecha < activa.fecha ? 'Recuperado' : 'Adelantado'} del{' '}
              {fechaCompleta(activa.cubre_fecha)}
            </span>
          )}
        </div>
        {/* Del ancho de la flecha de volver, para que el título quede centrado. */}
        <span className="sesion-hueco-derecho" />
      </header>

      <div className="huecos">{visibles.map((hueco) => bloque(hueco))}</div>

      {/* Los ocultos en la rutina con series de hoy, al final y plegados, como en las demás
          listas: arriba quedan los que se están haciendo, en orden. */}
      <Ocultos
        cuantos={ocultosConSeries.length}
        singular="ejercicio oculto en la rutina"
        plural="ejercicios ocultos en la rutina"
        abierto={verOcultos}
        alAlternar={() => setVerOcultos(!verOcultos)}
      />
      {verOcultos && ocultosConSeries.length > 0 && (
        <div className="huecos">{ocultosConSeries.map((hueco) => bloque(hueco))}</div>
      )}

      {/* La nota se puede escribir en cualquier momento, no solo al terminar: si hay que
          esperar al final, se olvida lo que se quería apuntar. */}
      <NotaDeSesion
        nota={activa.notas}
        editable
        abierta={notaAbierta}
        alAbrir={() => setNotaAbierta(true)}
        alCerrar={() => setNotaAbierta(false)}
        bloqueada={hayAbierta}
        alGuardar={async (nota) => {
          const guardada = await api.actualizarEntrenamiento(activa.id, {
            fecha: activa.fecha,
            notas: nota,
          })
          setSesion(guardada)
        }}
      />

      {/* Una sesión terminada se corrige desde el historial: aquí ya no se termina ni se cancela. */}
      {activa.terminada_en === null && (
        <div className="sesion-pie">
          <button
            type="button"
            className="boton"
            onClick={() => setConfirmando('terminar')}
            disabled={hayAbierta}
          >
            Terminar sesión
          </button>
          <button
            type="button"
            className="boton boton-texto peligro"
            onClick={() => setConfirmando('cancelar')}
            disabled={hayAbierta}
          >
            Cancelar sesión
          </button>
        </div>
      )}

      {aBorrar && (
        <Dialogo
          titulo={`¿Borrar la serie ${aBorrar.numero_serie}?`}
          cuerpo={`${serieLarga(aBorrar.ejercicio.tipo_registro, aBorrar)}${
            aBorrar.variante ? ` · ${aBorrar.variante}` : ''
          }`}
          confirmar="Borrar"
          peligro
          alConfirmar={() => borrar(aBorrar)}
          alCancelar={() => setABorrar(null)}
        />
      )}

      {aCambiar && (
        <Dialogo
          titulo={`¿Cambiar a ${aCambiar.ejercicio.nombre}?`}
          cuerpo={(() => {
            const series = deHueco(aCambiar.hueco)
            const cuantas = series.length === 1 ? 'la serie' : `las ${series.length} series`
            return `Se borrarán ${cuantas} de ${series[0].ejercicio.nombre} de ${
              deOtroDia ? 'este día' : 'hoy'
            }.`
          })()}
          confirmar="Cambiar"
          peligro
          alConfirmar={() => cambiarDeEjercicio(aCambiar.hueco, aCambiar.ejercicio)}
          alCancelar={() => setACambiar(null)}
        />
      )}

      {confirmando === 'terminar' && activa.series.length === 0 && (
        // Una sesión sin series no se hizo: se cancela en vez de quedar como un día
        // vacío en el historial, y el diálogo lo avisa (decisión del autor).
        <Dialogo
          titulo="¿Terminar la sesión?"
          cuerpo="No has apuntado ninguna serie, así que la sesión se cancelará, como si no la hubieras empezado."
          confirmar="Terminar"
          alConfirmar={async () => {
            await api.borrarEntrenamiento(activa.id)
            navegar(alCancelar, { replace: true })
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}

      {confirmando === 'terminar' && activa.series.length > 0 && (
        <Dialogo
          titulo="¿Terminar la sesión?"
          cuerpo={`Llevas ${contarSeries(activa.series.length)} y ${completados(completos, visibles.length)}. Podrás revisarla y corregirla después en la pestaña Historial.`}
          confirmar="Terminar"
          alConfirmar={async () => {
            await api.terminarEntrenamiento(activa.id)
            // Si se abrió desde su día (Seguir apuntando), se vuelve a él; si no, el día
            // sustituye a la sesión, para que volver desde él no lleve a ella ya terminada.
            if (desdeSuDia) navegar(-1)
            else navegar(`/historial/${activa.fecha}`, { replace: true })
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}

      {confirmando === 'cancelar' && (
        <Dialogo
          titulo="¿Cancelar la sesión?"
          cuerpo={
            activa.series.length === 0
              ? 'Se borrará la sesión, como si no la hubieras empezado.'
              : `Se borrarán ${
                  activa.series.length === 1 ? 'la serie' : `las ${activa.series.length} series`
                } que llevas, como si no la hubieras empezado.`
          }
          confirmar="Cancelar sesión"
          // No «Cancelar»: junto a «Cancelar sesión» no se sabría cuál cancela qué.
          cancelar="Seguir"
          peligro
          alConfirmar={async () => {
            await api.borrarEntrenamiento(activa.id)
            navegar(alCancelar, { replace: true })
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}
