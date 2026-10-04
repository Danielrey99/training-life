import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, ErrorDeApi } from '../../api/cliente'
import type { Ejercicio, Entrenamiento, HuecoDeRutina, Rutina, Serie } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { NotaDeSesion } from '../../componentes/NotaDeSesion'
import { fechaEnFrase, fechaTitulo } from '../../utiles/fechas'
import { pesoLegible } from '../../utiles/numeros'
import { BloqueDeHueco, type SerieAGuardar } from './BloqueDeHueco'
import './sesion.css'

// Adónde se vuelve al salir de la sesión o al cancelarla: la pantalla de Hoy.
// *Terminar* lleva en cambio al día en el historial.
const SALIDA = '/'

// El bloque de las series que no van a ningún hueco, en el mismo mapa que los huecos.
const SUELTAS = 0

function contarSeries(cuantas: number) {
  return cuantas === 1 ? '1 serie' : `${cuantas} series`
}

/**
 * El ejercicio con el que arranca un hueco: el de la última serie de hoy si ya
 * se empezó (quien cambió al comodín sigue con él); si no, el principal; y si el
 * principal está oculto, el primer comodín visible. Nulo si no queda ninguno.
 */
function ejercicioInicial(hueco: HuecoDeRutina, series: Serie[]): Ejercicio | null {
  const opciones = [hueco.ejercicio_principal, ...hueco.alternativas]
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

  const [sesion, setSesion] = useState<Entrenamiento | null>(null)
  const [rutina, setRutina] = useState<Rutina | null>(null)
  const [biblioteca, setBiblioteca] = useState<Ejercicio[]>([])
  const [error, setError] = useState<string | null>(null)

  const [abierto, setAbierto] = useState<number | null>(null)
  const [elegidos, setElegidos] = useState<Record<number, Ejercicio | null>>({})
  const [aBorrar, setABorrar] = useState<Serie | null>(null)
  const [confirmando, setConfirmando] = useState<'terminar' | 'cancelar' | null>(null)
  // Las ediciones van de una en una: una serie o la nota, y mientras tanto el resto se
  // queda en gris (otros lápices, las ✕, los demás huecos, Terminar y Cancelar).
  const [editandoSerie, setEditandoSerie] = useState<number | null>(null)
  const [notaAbierta, setNotaAbierta] = useState(false)
  const hayAbierta = editandoSerie !== null || notaAbierta

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const leida = await api.entrenamiento(Number(entrenamientoId))
        // La rutina se pide aunque esté oculta: la sesión se tiene que poder terminar.
        const suRutina = leida.rutina_id === null ? null : await api.rutina(leida.rutina_id)
        const sueltas = leida.series.some((serie) => serie.slot_id === null)
        const ejercicios = suRutina === null || sueltas ? await api.ejercicios() : []
        if (!vigente) return

        const huecos = suRutina?.slots ?? []
        const iniciales: Record<number, Ejercicio | null> = {}
        for (const hueco of huecos) iniciales[hueco.id] = ejercicioInicial(hueco, leida.series)
        iniciales[SUELTAS] =
          ejercicios.find(
            (otro) =>
              otro.id === leida.series.filter((s) => s.slot_id === null).at(-1)?.ejercicio_id,
          ) ??
          ejercicios[0] ??
          null

        // Se abre el primer hueco sin terminar: es por donde se va.
        const pendiente = huecos
          .filter((hueco) => !hueco.oculto_desde)
          .sort((uno, otro) => uno.orden - otro.orden)
          .find(
            (hueco) =>
              leida.series.filter((s) => s.slot_id === hueco.id).length < hueco.series_objetivo,
          )

        setSesion(leida)
        setRutina(suRutina)
        setBiblioteca(ejercicios)
        setElegidos(iniciales)
        setAbierto(suRutina === null ? SUELTAS : (pendiente?.id ?? null))
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
  if (!sesion) return <p className="aviso">Cargando…</p>

  const activa = sesion

  // Un hueco oculto no se ofrece, pero si ya tiene series de esta sesión se sigue
  // enseñando: si no, desaparecerían sin explicación.
  const huecos = (rutina?.slots ?? [])
    .filter(
      (hueco) => !hueco.oculto_desde || activa.series.some((serie) => serie.slot_id === hueco.id),
    )
    .sort((uno, otro) => uno.orden - otro.orden)
  const sueltas = activa.series.filter((serie) => serie.slot_id === null)
  const conSueltas = rutina === null || sueltas.length > 0

  const deHueco = (hueco: HuecoDeRutina) =>
    activa.series
      .filter((serie) => serie.slot_id === hueco.id)
      .sort((una, otra) => una.numero_serie - otra.numero_serie)
  const visibles = huecos.filter((hueco) => !hueco.oculto_desde)
  const completos = visibles.filter(
    (hueco) => deHueco(hueco).length >= hueco.series_objetivo,
  ).length

  let subtitulo = `${fechaTitulo(activa.fecha)} · ${contarSeries(activa.series.length)}`
  if (rutina) subtitulo += ` · ${completos} de ${visibles.length} ejercicios`

  async function guardar(huecoId: number | null, datos: SerieAGuardar, serieId?: number) {
    const cuerpo = { ...datos, slot_id: huecoId, rpe: null }
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

  function bloque(hueco: HuecoDeRutina | null, posicion: number) {
    const clave = hueco?.id ?? SUELTAS
    const elegido = elegidos[clave] ?? null
    const titulo = hueco
      ? `${posicion} · ${elegido?.nombre ?? hueco.ejercicio_principal.nombre}`
      : rutina
        ? 'Series sueltas'
        : 'Series'
    return (
      <BloqueDeHueco
        key={clave}
        hueco={hueco}
        titulo={titulo}
        rutinaId={rutina?.id ?? null}
        series={hueco ? deHueco(hueco) : sueltas}
        elegido={elegido}
        elegir={(ejercicio) => setElegidos((previos) => ({ ...previos, [clave]: ejercicio }))}
        biblioteca={biblioteca.filter((ejercicio) => ejercicio.oculto_desde === null)}
        abierto={abierto === clave}
        abrir={() => setAbierto(clave)}
        editandoId={editandoSerie}
        alEditar={setEditandoSerie}
        bloqueado={hayAbierta}
        sesion={activa}
        guardar={(datos, serieId) => guardar(hueco?.id ?? null, datos, serieId)}
        pedirBorrar={setABorrar}
      />
    )
  }

  return (
    <div className="sesion">
      <header className="sesion-cabecera">
        <Link to={SALIDA} className="boton-icono" aria-label="Volver">
          <Icono nombre="volver" />
        </Link>
        <div className="sesion-titulo">
          <h1>{rutina?.nombre ?? 'Entrenamiento libre'}</h1>
          <p>{subtitulo}</p>
          {/* Si la sesión cuenta otro día, que se note: es "el Push del lunes", no el de hoy. */}
          {activa.cubre_fecha && activa.cubre_fecha !== activa.fecha && (
            <span className="sesion-cuenta">
              {activa.cubre_fecha < activa.fecha ? 'Recuperando' : 'Adelantando'} el{' '}
              {rutina?.nombre} del {fechaEnFrase(activa.cubre_fecha, false)}
            </span>
          )}
        </div>
        {/* Del ancho de la flecha de volver, para que el título quede centrado. */}
        <span className="sesion-hueco-derecho" />
      </header>

      <div className="huecos">
        {huecos.map((hueco, indice) => bloque(hueco, indice + 1))}
        {conSueltas && bloque(null, 0)}
      </div>

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
            rutina_id: activa.rutina_id,
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
          cuerpo={`${pesoLegible(aBorrar.peso)} kg × ${aBorrar.repeticiones} reps${
            aBorrar.variante ? ` · ${aBorrar.variante}` : ''
          }`}
          confirmar="Borrar"
          peligro
          alConfirmar={() => borrar(aBorrar)}
          alCancelar={() => setABorrar(null)}
        />
      )}

      {confirmando === 'terminar' && activa.series.length === 0 && (
        // Una sesión sin series no se hizo: se cancela en vez de quedar como un día
        // vacío en el historial, y el diálogo lo avisa (decisión del autor).
        <Dialogo
          titulo="¿Terminar la sesión?"
          cuerpo="No has apuntado ninguna serie, así que la sesión se cancelará, como si no la hubieras empezado."
          confirmar="Terminar"
          cancelar="Seguir entrenando"
          alConfirmar={async () => {
            await api.borrarEntrenamiento(activa.id)
            navegar(SALIDA)
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}

      {confirmando === 'terminar' && activa.series.length > 0 && (
        <Dialogo
          titulo="¿Terminar la sesión?"
          cuerpo={`Llevas ${contarSeries(activa.series.length)}${
            rutina ? ` y ${completos} de ${visibles.length} ejercicios completos` : ''
          }. Podrás revisarla y corregirla después en el historial.`}
          confirmar="Terminar"
          cancelar="Seguir entrenando"
          alConfirmar={async () => {
            await api.terminarEntrenamiento(activa.id)
            navegar(`/historial/${activa.fecha}`)
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
                } que llevas, como si no la hubieras empezado. No se puede deshacer.`
          }
          confirmar="Cancelar sesión"
          cancelar="Seguir entrenando"
          peligro
          alConfirmar={async () => {
            await api.borrarEntrenamiento(activa.id)
            navegar(SALIDA)
          }}
          alCancelar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}
