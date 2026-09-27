import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api/cliente'
import type { Ejercicio, Entrenamiento, HuecoDeRutina, NuevaSerie, Rutina, Serie } from '../api/tipos'

const SESIONES_RECIENTES = 5

/** La fecha de hoy, en el formato que esperan `<input type="date">` y la API. */
function hoy(): string {
  const ahora = new Date()
  // A mano y no con toISOString(), que pasa antes por UTC: entrenando de noche
  // eso devolvería el día anterior.
  const mes = String(ahora.getMonth() + 1).padStart(2, '0')
  const dia = String(ahora.getDate()).padStart(2, '0')
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

/** El peso llega como "60.00" porque es un DECIMAL; se enseña como "60". */
function pesoLegible(peso: string): string {
  return String(Number(peso))
}

/**
 * La pantalla que se usa en el gimnasio: se elige (o se retoma) la sesión del
 * día y se van anotando las series hueco a hueco.
 *
 * Cada serie viaja a la API en cuanto se añade, en vez de acumularlas para
 * guardarlas al final: una sesión dura más de una hora, y cerrar la pestaña sin
 * querer no puede llevarse el entrenamiento por delante. Por lo mismo, la sesión
 * abierta va en la URL (`/registrar/{id}`) y no en el estado: recargar desde el
 * móvil deja donde estabas en vez de mandarte al principio.
 */
export function RegistrarEntrenamiento() {
  const [rutinas, setRutinas] = useState<Rutina[]>([])
  const [ejercicios, setEjercicios] = useState<Ejercicio[]>([])
  const [sesiones, setSesiones] = useState<Entrenamiento[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  const { entrenamientoId } = useParams()
  const navegar = useNavigate()

  useEffect(() => {
    Promise.all([api.rutinas(), api.ejercicios(), api.entrenamientos()])
      .then(([listaRutinas, listaEjercicios, listaSesiones]) => {
        setRutinas(listaRutinas)
        setEjercicios(listaEjercicios)
        setSesiones(listaSesiones)
      })
      .catch((error: Error) => setError(error.message))
      .finally(() => setCargando(false))
  }, [])

  const activa = sesiones.find((sesion) => String(sesion.id) === entrenamientoId)

  // Recibe el cambio y no la sesión ya cambiada: quien llama viene de un await, y
  // la sesión que tenía antes puede no ser ya la última. Con dos series guardadas
  // a la vez desde huecos distintos, la segunda pisaría a la primera en pantalla.
  function cambiarSesion(id: number, cambio: (sesion: Entrenamiento) => Entrenamiento) {
    setSesiones((previas) => previas.map((otra) => (otra.id === id ? cambio(otra) : otra)))
  }

  async function empezar(fecha: string, rutinaId: number | null) {
    const sesion = await api.crearEntrenamiento({ rutina_id: rutinaId, fecha, notas: null })
    setSesiones((previas) => [sesion, ...previas])
    navegar(`/registrar/${sesion.id}`)
  }

  async function registrarSerie(datos: NuevaSerie) {
    if (!activa) return
    const serie = await api.crearSerie(activa.id, datos)
    cambiarSesion(activa.id, (sesion) => ({ ...sesion, series: [...sesion.series, serie] }))
  }

  // A diferencia de añadir una serie, borrarla no tiene formulario donde poner
  // el error al lado, así que sube a la barra de la sesión.
  async function borrarSerie(serieId: number) {
    if (!activa) return
    setFallo(null)
    try {
      await api.borrarSerie(activa.id, serieId)
      cambiarSesion(activa.id, (sesion) => ({
        ...sesion,
        series: sesion.series.filter((serie) => serie.id !== serieId),
      }))
    } catch (error) {
      setFallo((error as Error).message)
    }
  }

  if (cargando) return <p className="aviso">Cargando…</p>
  if (error) {
    return (
      <p className="aviso error">
        {error}
        <br />
        <small>¿Está levantado el backend? `docker compose up -d` en la raíz del repo.</small>
      </p>
    )
  }

  // Un id que ya no existe (la sesión se borró, o la URL viene mal copiada) no
  // puede dejar la pantalla en blanco: se vuelve al principio.
  if (entrenamientoId && !activa) return <Navigate to="/registrar" replace />

  if (!activa) {
    return (
      <ElegirSesion
        rutinas={rutinas}
        sesiones={sesiones}
        empezar={empezar}
        continuar={(sesion) => navegar(`/registrar/${sesion.id}`)}
      />
    )
  }

  return (
    <SesionActiva
      key={activa.id}
      sesion={activa}
      rutina={rutinas.find((rutina) => rutina.id === activa.rutina_id)}
      ejercicios={ejercicios}
      fallo={fallo}
      registrar={registrarSerie}
      borrar={borrarSerie}
      salir={() => navegar('/registrar')}
    />
  )
}

/** Paso previo: empezar una sesión nueva o retomar una que quedó a medias. */
function ElegirSesion({
  rutinas,
  sesiones,
  empezar,
  continuar,
}: {
  rutinas: Rutina[]
  sesiones: Entrenamiento[]
  empezar: (fecha: string, rutinaId: number | null) => Promise<void>
  continuar: (sesion: Entrenamiento) => void
}) {
  const [fecha, setFecha] = useState(hoy())
  const [rutinaId, setRutinaId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const nombreDeRutina = new Map(rutinas.map((rutina) => [rutina.id, rutina.nombre]))

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setFallo(null)
    try {
      await empezar(fecha, rutinaId === '' ? null : Number(rutinaId))
    } catch (error) {
      setFallo((error as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <h2>Registrar entrenamiento</h2>

      <form className="tarjeta formulario" onSubmit={enviar}>
        <div className="campos">
          <label>
            Fecha
            <input
              type="date"
              value={fecha}
              required
              onChange={(evento) => setFecha(evento.target.value)}
            />
          </label>
          <label className="ancho">
            Rutina
            <select value={rutinaId} onChange={(evento) => setRutinaId(evento.target.value)}>
              <option value="">Entrenamiento libre (sin rutina)</option>
              {rutinas.map((rutina) => (
                <option key={rutina.id} value={rutina.id}>
                  {rutina.nombre}
                  {rutina.dia_habitual ? ` · ${rutina.dia_habitual}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={guardando}>
          {guardando ? 'Empezando…' : 'Empezar sesión'}
        </button>
        {fallo && <p className="aviso error">{fallo}</p>}
      </form>

      {rutinas.length === 0 && (
        <p className="aviso">
          Todavía no hay rutinas. Se crean con <code>POST /rutinas</code> mientras la pantalla para
          gestionarlas no exista; sin rutina, la sesión se registra como entrenamiento libre.
        </p>
      )}

      {sesiones.length > 0 && (
        <>
          <h3>O continúa una sesión ya empezada</h3>
          <ul className="tarjetas">
            {sesiones.slice(0, SESIONES_RECIENTES).map((sesion) => (
              <li key={sesion.id} className="tarjeta">
                <strong>{sesion.fecha}</strong>
                <span className="etiqueta">
                  {sesion.rutina_id === null
                    ? 'Libre'
                    : (nombreDeRutina.get(sesion.rutina_id) ?? 'Rutina oculta')}
                </span>
                <p className="descripcion">
                  {sesion.series.length === 1 ? '1 serie' : `${sesion.series.length} series`}
                </p>
                <button type="button" className="secundario" onClick={() => continuar(sesion)}>
                  Continuar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/** La sesión abierta: un bloque por hueco de la rutina, más las series sueltas. */
function SesionActiva({
  sesion,
  rutina,
  ejercicios,
  fallo,
  registrar,
  borrar,
  salir,
}: {
  sesion: Entrenamiento
  rutina: Rutina | undefined
  ejercicios: Ejercicio[]
  fallo: string | null
  registrar: (datos: NuevaSerie) => Promise<void>
  borrar: (serieId: number) => Promise<void>
  salir: () => void
}) {
  // Un hueco oculto no sirve para huecos nuevos, pero si ya tiene series de esta
  // sesión hay que seguir enseñándolas: si no, desaparecerían sin explicación.
  const huecos = (rutina?.slots ?? [])
    .filter((hueco) => !hueco.oculto_desde || sesion.series.some((serie) => serie.slot_id === hueco.id))
    .sort((uno, otro) => uno.orden - otro.orden)

  const sueltas = sesion.series.filter((serie) => serie.slot_id === null)

  return (
    <>
      <div className="barra-sesion">
        <div>
          <h2>{rutina ? rutina.nombre : 'Entrenamiento libre'}</h2>
          <p className="descripcion">
            {sesion.fecha} · {sesion.series.length === 1 ? '1 serie' : `${sesion.series.length} series`}
          </p>
        </div>
        <button type="button" className="secundario" onClick={salir}>
          Cambiar de sesión
        </button>
      </div>

      {fallo && <p className="aviso error">{fallo}</p>}

      {sesion.rutina_id !== null && !rutina && (
        <p className="aviso">
          La rutina de esta sesión está oculta, así que no se pueden añadir series a sus huecos.
          Puedes volver a mostrarla con <code>POST /rutinas/{sesion.rutina_id}/mostrar</code> para
          seguir donde lo dejaste.
        </p>
      )}

      <div className="huecos">
        {huecos.map((hueco) => (
          <BloqueDeHueco
            key={hueco.id}
            hueco={hueco}
            series={sesion.series}
            registrar={registrar}
            borrar={borrar}
          />
        ))}

        <section className="tarjeta hueco">
          <header className="hueco-cabecera">
            <strong>{rutina ? 'Series sueltas' : 'Series'}</strong>
            {rutina && <span className="etiqueta">fuera de la rutina</span>}
          </header>
          <ListaDeSeries series={sueltas} borrar={borrar} mostrarEjercicio />
          <FormularioDeSerie
            opciones={ejercicios}
            numeroSerie={siguienteNumero(sueltas)}
            anterior={sueltas[sueltas.length - 1]}
            registrar={(datos) => registrar({ ...datos, slot_id: null })}
          />
        </section>
      </div>
    </>
  )
}

/** Un hueco de la rutina, con lo que ya se ha hecho hoy y el formulario. */
function BloqueDeHueco({
  hueco,
  series,
  registrar,
  borrar,
}: {
  hueco: HuecoDeRutina
  series: Serie[]
  registrar: (datos: NuevaSerie) => Promise<void>
  borrar: (serieId: number) => Promise<void>
}) {
  const hechas = series
    .filter((serie) => serie.slot_id === hueco.id)
    .sort((una, otra) => una.numero_serie - otra.numero_serie)
  const opciones = [hueco.ejercicio_principal, ...hueco.alternativas]

  return (
    <section className="tarjeta hueco">
      <header className="hueco-cabecera">
        <strong>
          {hueco.orden}. {hueco.ejercicio_principal.nombre}
        </strong>
        <span className="etiqueta">
          {hueco.series_objetivo} × {hueco.reps_min}-{hueco.reps_max}
        </span>
        {hueco.oculto_desde && <span className="etiqueta">Oculto</span>}
      </header>

      <ListaDeSeries series={hechas} borrar={borrar} mostrarEjercicio={opciones.length > 1} />

      {!hueco.oculto_desde && (
        <FormularioDeSerie
          opciones={opciones}
          numeroSerie={siguienteNumero(hechas)}
          anterior={hechas[hechas.length - 1]}
          registrar={(datos) => registrar({ ...datos, slot_id: hueco.id })}
        />
      )}
    </section>
  )
}

/**
 * El número que le toca a la siguiente serie.
 *
 * Se calcula desde el número más alto y no desde cuántas hay: borrando una del
 * medio, contarlas daría un número que ya está usado.
 */
function siguienteNumero(series: Serie[]): number {
  return series.reduce((mayor, serie) => Math.max(mayor, serie.numero_serie), 0) + 1
}

function ListaDeSeries({
  series,
  borrar,
  mostrarEjercicio,
}: {
  series: Serie[]
  borrar: (serieId: number) => Promise<void>
  mostrarEjercicio: boolean
}) {
  if (series.length === 0) return <p className="descripcion">Todavía sin series.</p>

  return (
    <ul className="series">
      {series.map((serie) => (
        <li key={serie.id}>
          <span className="numero">{serie.numero_serie}</span>
          <span className="carga">
            {pesoLegible(serie.peso)} kg × {serie.repeticiones}
          </span>
          {mostrarEjercicio && <span className="descripcion">{serie.ejercicio.nombre}</span>}
          {serie.rpe && <span className="descripcion">RPE {pesoLegible(serie.rpe)}</span>}
          {serie.variante && <span className="descripcion">{serie.variante}</span>}
          <button
            type="button"
            className="borrar"
            title="Borrar esta serie"
            onClick={() => void borrar(serie.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * El formulario de una serie.
 *
 * Arranca con los datos de la serie anterior porque en el gimnasio las series de
 * un mismo hueco repiten ejercicio y peso: lo normal es cambiar solo las
 * repeticiones. El RPE no se arrastra, que cambia en cada serie. Tampoco se
 * limpian los campos al guardar, por lo mismo.
 */
function FormularioDeSerie({
  opciones,
  numeroSerie,
  anterior,
  registrar,
}: {
  opciones: Ejercicio[]
  numeroSerie: number
  anterior: Serie | undefined
  registrar: (datos: Omit<NuevaSerie, 'slot_id'>) => Promise<void>
}) {
  const [ejercicioId, setEjercicioId] = useState(
    String(anterior?.ejercicio_id ?? opciones[0]?.id ?? ''),
  )
  const [peso, setPeso] = useState(anterior ? pesoLegible(anterior.peso) : '')
  const [repeticiones, setRepeticiones] = useState(anterior ? String(anterior.repeticiones) : '')
  const [variante, setVariante] = useState(anterior?.variante ?? '')
  const [rpe, setRpe] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setFallo(null)
    try {
      await registrar({
        ejercicio_id: Number(ejercicioId),
        numero_serie: numeroSerie,
        peso: Number(peso),
        repeticiones: Number(repeticiones),
        rpe: rpe === '' ? null : Number(rpe),
        variante: variante.trim() === '' ? null : variante.trim(),
      })
      setRpe('')
    } catch (error) {
      setFallo((error as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  if (opciones.length === 0) {
    return (
      <p className="descripcion">
        No hay ningún ejercicio en la biblioteca todavía.
      </p>
    )
  }

  return (
    <form className="formulario" onSubmit={enviar}>
      <div className="campos">
        <label className="ancho">
          Ejercicio
          <select
            value={ejercicioId}
            onChange={(evento) => setEjercicioId(evento.target.value)}
            required
          >
            {opciones.map((ejercicio) => (
              <option key={ejercicio.id} value={ejercicio.id}>
                {ejercicio.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Peso (kg)
          <input
            type="number"
            step="0.5"
            min="0"
            value={peso}
            required
            onChange={(evento) => setPeso(evento.target.value)}
          />
        </label>
        <label>
          Reps
          <input
            type="number"
            min="1"
            value={repeticiones}
            required
            onChange={(evento) => setRepeticiones(evento.target.value)}
          />
        </label>
        <label>
          RPE
          <input
            type="number"
            step="0.5"
            min="0"
            max="10"
            value={rpe}
            onChange={(evento) => setRpe(evento.target.value)}
          />
        </label>
        <label className="ancho">
          Variante
          <input
            type="text"
            maxLength={100}
            value={variante}
            placeholder="agarre cerrado, abductores internos…"
            onChange={(evento) => setVariante(evento.target.value)}
          />
        </label>
      </div>
      <button type="submit" disabled={guardando}>
        {guardando ? 'Guardando…' : `Añadir serie ${numeroSerie}`}
      </button>
      {fallo && <p className="aviso error">{fallo}</p>}
    </form>
  )
}
