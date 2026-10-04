/**
 * Único punto por el que la web habla con la API.
 *
 * Todas las llamadas pasan por aquí para que las pantallas no repartan URLs ni
 * manejo de errores por su cuenta: si cambia la forma de un endpoint, se toca
 * un archivo. También es lo que permitiría cambiar `fetch` por otra cosa —o
 * añadir el token cuando exista JWT— sin recorrer toda la aplicación.
 */

import type {
  DiaPlan,
  DiaSeguimiento,
  DiaSemana,
  Ejercicio,
  Entrenamiento,
  Excepcion,
  GrupoMuscular,
  Hoy,
  HuecoDeRutina,
  ModoBorrado,
  Nota,
  NuevaSerie,
  NuevoEjercicio,
  NuevoEntrenamiento,
  NuevoHueco,
  NuevoPrograma,
  Programa,
  Rutina,
  Serie,
  SerieHistorialHueco,
  SesionHistorial,
} from './tipos'

// Configurable por si la web se abre desde otro dispositivo de la red de casa,
// donde "localhost" ya no es el PC que sirve la API.
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/**
 * Un fallo de la API con lo que hace falta para reaccionar a él: el código de
 * estado y el `detail` tal cual llegó. El mensaje legible basta para enseñarlo,
 * pero algunos 409 traen datos que la pantalla usa (la sesión que ya está en
 * curso, dónde se usa un ejercicio que se quiere borrar).
 */
export class ErrorDeApi extends Error {
  readonly estado: number
  readonly detalle: unknown

  constructor(mensaje: string, estado: number, detalle: unknown) {
    super(mensaje)
    this.name = 'ErrorDeApi'
    this.estado = estado
    this.detalle = detalle
  }
}

/**
 * Saca del `detail` el motivo real del fallo.
 *
 * FastAPI no siempre lo manda como texto: un 422 de validación trae una lista
 * de fallos y algún 409 trae un objeto con datos de más. Sin esto la pantalla
 * solo sabría decir "la API respondió 409", que es justo lo que no ayuda cuando
 * estás en el gimnasio con el móvil en la mano.
 */
function motivoDelFallo(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((fallo: { msg?: string }) => fallo.msg).join('. ')
  }
  if (detail && typeof detail === 'object' && 'mensaje' in detail) {
    return String(detail.mensaje)
  }
  return null
}

/**
 * Falla con un `ErrorDeApi` en vez de dejar que la pantalla se encuentre un
 * JSON inesperado: `fetch` solo lanza si la red se cae, no si la API responde
 * 404 o 500.
 */
async function peticion<T>(ruta: string, opciones?: RequestInit): Promise<T> {
  const respuesta = await fetch(`${BASE}${ruta}`, opciones)
  if (!respuesta.ok) {
    const detalle = await respuesta
      .json()
      .then((cuerpo: { detail?: unknown }) => cuerpo.detail)
      .catch(() => undefined) // la respuesta no traía JSON
    const mensaje = motivoDelFallo(detalle) ?? `La API respondió ${respuesta.status}`
    throw new ErrorDeApi(mensaje, respuesta.status, detalle)
  }
  // Los DELETE contestan 204, sin cuerpo: pedirles el JSON reventaría.
  if (respuesta.status === 204) return undefined as T
  return (await respuesta.json()) as T
}

/** Sin la cabecera `Content-Type`, FastAPI no lee el cuerpo como JSON. */
function conCuerpo(metodo: 'POST' | 'PUT', datos?: unknown): RequestInit {
  return {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: datos === undefined ? undefined : JSON.stringify(datos),
  }
}

const BORRAR: RequestInit = { method: 'DELETE' }

/** Los parámetros de consulta, sin los que vienen vacíos. */
function consulta(parametros: Record<string, string | number | boolean | null | undefined>) {
  const pares = Object.entries(parametros).filter(([, valor]) => valor != null && valor !== false)
  if (pares.length === 0) return ''
  return '?' + new URLSearchParams(pares.map(([clave, valor]) => [clave, String(valor)]))
}

type Rango = { desde?: string; hasta?: string }
type RangoConLimite = Rango & { limite?: number }

export const api = {
  gruposMusculares: () => peticion<GrupoMuscular[]>('/grupos-musculares'),

  // --- Ejercicios y sus notas ---
  ejercicios: (filtro: { ocultos?: boolean } = {}) =>
    peticion<Ejercicio[]>(`/ejercicios${consulta(filtro)}`),
  ejercicio: (id: number) => peticion<Ejercicio>(`/ejercicios/${id}`),
  crearEjercicio: (datos: NuevoEjercicio) =>
    peticion<Ejercicio>('/ejercicios', conCuerpo('POST', datos)),
  actualizarEjercicio: (id: number, datos: NuevoEjercicio) =>
    peticion<Ejercicio>(`/ejercicios/${id}`, conCuerpo('PUT', datos)),
  borrarEjercicio: (id: number, modo?: ModoBorrado) =>
    peticion<void>(`/ejercicios/${id}${consulta({ modo })}`, BORRAR),
  mostrarEjercicio: (id: number) =>
    peticion<Ejercicio>(`/ejercicios/${id}/mostrar`, conCuerpo('POST')),
  historialDeEjercicio: (id: number, filtro: RangoConLimite = {}) =>
    peticion<SesionHistorial[]>(`/ejercicios/${id}/historial${consulta(filtro)}`),

  notas: (ejercicioId: number) => peticion<Nota[]>(`/ejercicios/${ejercicioId}/notas`),
  crearNota: (ejercicioId: number, nota: string) =>
    peticion<Nota>(`/ejercicios/${ejercicioId}/notas`, conCuerpo('POST', { nota })),
  actualizarNota: (ejercicioId: number, notaId: number, nota: string) =>
    peticion<Nota>(`/ejercicios/${ejercicioId}/notas/${notaId}`, conCuerpo('PUT', { nota })),
  borrarNota: (ejercicioId: number, notaId: number) =>
    peticion<void>(`/ejercicios/${ejercicioId}/notas/${notaId}`, BORRAR),

  // --- Rutinas, huecos y comodines ---
  rutinas: (filtro: { ocultas?: boolean } = {}) =>
    peticion<Rutina[]>(`/rutinas${consulta(filtro)}`),
  rutina: (id: number) => peticion<Rutina>(`/rutinas/${id}`),
  crearRutina: (nombre: string) => peticion<Rutina>('/rutinas', conCuerpo('POST', { nombre })),
  actualizarRutina: (id: number, nombre: string) =>
    peticion<Rutina>(`/rutinas/${id}`, conCuerpo('PUT', { nombre })),
  borrarRutina: (id: number, modo?: ModoBorrado) =>
    peticion<void>(`/rutinas/${id}${consulta({ modo })}`, BORRAR),
  mostrarRutina: (id: number) => peticion<Rutina>(`/rutinas/${id}/mostrar`, conCuerpo('POST')),

  crearHueco: (rutinaId: number, datos: NuevoHueco) =>
    peticion<HuecoDeRutina>(`/rutinas/${rutinaId}/slots`, conCuerpo('POST', datos)),
  actualizarHueco: (rutinaId: number, huecoId: number, datos: NuevoHueco) =>
    peticion<HuecoDeRutina>(`/rutinas/${rutinaId}/slots/${huecoId}`, conCuerpo('PUT', datos)),
  borrarHueco: (rutinaId: number, huecoId: number, modo?: ModoBorrado) =>
    peticion<void>(`/rutinas/${rutinaId}/slots/${huecoId}${consulta({ modo })}`, BORRAR),
  mostrarHueco: (rutinaId: number, huecoId: number) =>
    peticion<HuecoDeRutina>(`/rutinas/${rutinaId}/slots/${huecoId}/mostrar`, conCuerpo('POST')),
  /** Con `ejercicio_id`, solo los días en que el hueco se hizo con ese ejercicio. */
  historialDeHueco: (
    rutinaId: number,
    huecoId: number,
    filtro: RangoConLimite & { ejercicio_id?: number } = {},
  ) =>
    peticion<SesionHistorial<SerieHistorialHueco>[]>(
      `/rutinas/${rutinaId}/slots/${huecoId}/historial${consulta(filtro)}`,
    ),
  anadirComodin: (rutinaId: number, huecoId: number, ejercicioId: number) =>
    peticion<HuecoDeRutina>(
      `/rutinas/${rutinaId}/slots/${huecoId}/alternativas`,
      conCuerpo('POST', { ejercicio_id: ejercicioId }),
    ),
  quitarComodin: (rutinaId: number, huecoId: number, ejercicioId: number) =>
    peticion<void>(`/rutinas/${rutinaId}/slots/${huecoId}/alternativas/${ejercicioId}`, BORRAR),

  // --- Entrenamientos y series ---
  /**
   * Con `en_curso`, una lista con la sesión abierta de hoy o vacía. Con `sin_terminar`,
   * las de días pasados que se dejaron a medias (sin terminar y con alguna serie). Con
   * `rutina_id` y `limite`, las últimas sesiones de una rutina.
   */
  entrenamientos: (
    filtro: RangoConLimite & {
      en_curso?: boolean
      sin_terminar?: boolean
      rutina_id?: number
    } = {},
  ) => peticion<Entrenamiento[]>(`/entrenamientos${consulta(filtro)}`),
  entrenamiento: (id: number) => peticion<Entrenamiento>(`/entrenamientos/${id}`),
  crearEntrenamiento: (datos: NuevoEntrenamiento) =>
    peticion<Entrenamiento>('/entrenamientos', conCuerpo('POST', datos)),
  actualizarEntrenamiento: (id: number, datos: NuevoEntrenamiento) =>
    peticion<Entrenamiento>(`/entrenamientos/${id}`, conCuerpo('PUT', datos)),
  terminarEntrenamiento: (id: number) =>
    peticion<Entrenamiento>(`/entrenamientos/${id}/terminar`, conCuerpo('POST')),
  /** *Cancelar sesión*: se lleva la sesión y sus series, como si no se hubiera empezado. */
  borrarEntrenamiento: (id: number) => peticion<void>(`/entrenamientos/${id}`, BORRAR),

  crearSerie: (entrenamientoId: number, datos: NuevaSerie) =>
    peticion<Serie>(`/entrenamientos/${entrenamientoId}/series`, conCuerpo('POST', datos)),
  actualizarSerie: (entrenamientoId: number, serieId: number, datos: NuevaSerie) =>
    peticion<Serie>(
      `/entrenamientos/${entrenamientoId}/series/${serieId}`,
      conCuerpo('PUT', datos),
    ),
  borrarSerie: (entrenamientoId: number, serieId: number) =>
    peticion<void>(`/entrenamientos/${entrenamientoId}/series/${serieId}`, BORRAR),

  // --- Programas ---
  programas: (filtro: { ocultos?: boolean } = {}) =>
    peticion<Programa[]>(`/programas${consulta(filtro)}`),
  programa: (id: number) => peticion<Programa>(`/programas/${id}`),
  crearPrograma: (datos: NuevoPrograma) =>
    peticion<Programa>('/programas', conCuerpo('POST', datos)),
  actualizarPrograma: (id: number, nombre: string) =>
    peticion<Programa>(`/programas/${id}`, conCuerpo('PUT', { nombre })),
  /** Con `quitarExcepciones`, borra lo planificado a mano de hoy en adelante. */
  activarPrograma: (id: number, quitarExcepciones = false) =>
    peticion<Programa>(
      `/programas/${id}/activar`,
      conCuerpo('POST', { quitar_excepciones: quitarExcepciones }),
    ),
  desactivarPrograma: (id: number) =>
    peticion<Programa>(`/programas/${id}/desactivar`, conCuerpo('POST')),
  mostrarPrograma: (id: number) =>
    peticion<Programa>(`/programas/${id}/mostrar`, conCuerpo('POST')),
  borrarPrograma: (id: number, modo?: ModoBorrado) =>
    peticion<void>(`/programas/${id}${consulta({ modo })}`, BORRAR),
  ponerRutinaEnDia: (id: number, dia: DiaSemana, rutinaId: number) =>
    peticion<Programa>(`/programas/${id}/dias/${dia}`, conCuerpo('PUT', { rutina_id: rutinaId })),
  /** Deja el día en descanso. */
  quitarRutinaDeDia: (id: number, dia: DiaSemana) =>
    peticion<void>(`/programas/${id}/dias/${dia}`, BORRAR),

  // --- Plan: qué toca cada día ---
  plan: (desde: string, hasta: string) => peticion<DiaPlan[]>(`/plan${consulta({ desde, hasta })}`),
  /** Qué tocaba cada día y qué pasó: hecho, movido, sin hacer… */
  seguimiento: (desde: string, hasta: string) =>
    peticion<DiaSeguimiento[]>(`/plan/seguimiento${consulta({ desde, hasta })}`),
  /** La pantalla de hoy; con una fecha pasada, la hoja de registrar ese día. */
  hoy: (fecha?: string) => peticion<Hoy>(`/plan/hoy${consulta({ fecha })}`),
  excepciones: (filtro: Rango = {}) =>
    peticion<Excepcion[]>(`/plan/excepciones${consulta(filtro)}`),
  /** Sin rutina, el día queda en descanso. */
  planificarDia: (fecha: string, rutinaId: number | null) =>
    peticion<Excepcion>(`/plan/excepciones/${fecha}`, conCuerpo('PUT', { rutina_id: rutinaId })),
  /** *Restablecer este día*: vuelve a lo que diga el programa. */
  restablecerDia: (fecha: string) => peticion<void>(`/plan/excepciones/${fecha}`, BORRAR),
  /** *Restablecer la semana*: solo toca los días de hoy en adelante. */
  restablecerRango: (desde: string, hasta: string) =>
    peticion<void>(`/plan/excepciones${consulta({ desde, hasta })}`, BORRAR),
  intercambiarDias: (fechaA: string, fechaB: string) =>
    peticion<DiaPlan[]>(
      '/plan/intercambiar',
      conCuerpo('POST', { fecha_a: fechaA, fecha_b: fechaB }),
    ),
}
