/**
 * La api del móvil: los mismos nombres, firmas y fallos que `web/src/api/cliente.ts`, para
 * que las pantallas de la web se porten sin tocar sus llamadas.
 *
 * Los métodos son copia de los de la web. Lo único que cambia es `peticion`: en vez de
 * `fetch` a un servidor, `despachar` la misma ruta en el propio teléfono (`rutas.ts`), en
 * una transacción. Devuelve `Promise` aunque todo sea síncrono, para que el código de las
 * pantallas (`await`, `Promise.all`) se quede igual.
 */

import type {
  AvisoDeBorrarEjercicio,
  AvisoDeBorrarHueco,
  AvisoDeBorrarRutina,
  CambiosDeHueco,
  ComprobacionDeImportar,
  DiaSeguimiento,
  DiaSemana,
  Ejercicio,
  Entrenamiento,
  EntrenamientoCorregido,
  Excepcion,
  GrupoMuscular,
  Hoy,
  HuecoDeRutina,
  ModoBorrado,
  Nota,
  NuevaRutina,
  NuevaSerie,
  NuevoEjercicio,
  NuevoEntrenamiento,
  NuevoHueco,
  NuevoPrograma,
  Programa,
  Resumen,
  ResumenDeDatos,
  Rutina,
  Serie,
  SesionHistorial,
  UsoEnRutina,
} from './tipos'
import type { Contexto } from './contexto'
import { despachar, type Metodo } from './rutas'

/**
 * Un fallo de la api con lo que hace falta para reaccionar a él: el código y el `detail`
 * tal cual. Copia de la web: algunos 409 traen datos que la pantalla usa.
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

/** El motivo real del fallo, sacado del `detail` (copia de la web). */
function motivoDelFallo(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // Los de una comprobación de la app (`value_error`) traen una frase tras un «Value
    // error, » que sobra; los demás son de la validación, en inglés: se dicen con palabras
    // de la app.
    const frases = detail.map((fallo: { type?: string; msg?: string }) =>
      fallo.type === 'value_error' && fallo.msg
        ? fallo.msg.replace(/^Value error, /, '')
        : DATO_NO_VALIDO,
    )
    return [...new Set(frases)].join(' ')
  }
  if (detail && typeof detail === 'object' && 'mensaje' in detail) {
    return String(detail.mensaje)
  }
  return null
}

const FALLO_DE_LA_APP = 'Algo ha fallado. Inténtalo de nuevo.'
const DATO_NO_VALIDO = 'Algún dato no es válido. Revísalo e inténtalo de nuevo.'

/** Un fallo que la propia pantalla explica con sus palabras: `textoDelFallo` lo enseña tal cual. */
export class AvisoDeLaWeb extends Error {}

/** Lo que se enseña de un fallo cualquiera (copia de la web). */
export function textoDelFallo(fallo: unknown): string {
  return fallo instanceof ErrorDeApi || fallo instanceof AvisoDeLaWeb
    ? fallo.message
    : FALLO_DE_LA_APP
}

/** Si el fallo es de ese campo del formulario: el aviso va bajo él, no arriba. */
export function esDelCampo(fallo: unknown, campo: 'fecha' | 'nombre'): fallo is ErrorDeApi {
  return (
    fallo instanceof ErrorDeApi && (fallo.detalle as { campo?: string } | null)?.campo === campo
  )
}

/** Lo que en la web son las opciones de `fetch`: el método y el cuerpo. */
interface Opciones {
  method: Metodo
  cuerpo?: unknown
}

/** Los parámetros de consulta, sin los que vienen vacíos (sin `URLSearchParams`, que en
 * React Native está a medias). */
function consulta(parametros: Record<string, string | number | boolean | null | undefined>) {
  const pares = Object.entries(parametros).filter(([, valor]) => valor != null && valor !== false)
  if (pares.length === 0) return ''
  return (
    '?' +
    pares
      .map(([clave, valor]) => `${encodeURIComponent(clave)}=${encodeURIComponent(String(valor))}`)
      .join('&')
  )
}

function conCuerpo(metodo: 'POST' | 'PUT', datos?: unknown): Opciones {
  return { method: metodo, cuerpo: datos }
}

const BORRAR: Opciones = { method: 'DELETE' }

type Rango = { desde?: string; hasta?: string }
type RangoConLimite = Rango & { limite?: number }

export type Api = ReturnType<typeof crearApi>

export function crearApi(ctx: Contexto) {
  /**
   * La petición, despachada en el teléfono. Un fallo de la app sale como `ErrorDeApi`,
   * con su motivo; cualquier otro error es un fallo de programación y sale tal cual.
   */
  async function peticion<T>(ruta: string, opciones: Opciones = { method: 'GET' }): Promise<T> {
    // Lo que manda la web pasa por JSON: lo que no viaja (un `undefined`) no llega.
    const cuerpo =
      opciones.cuerpo === undefined ? undefined : JSON.parse(JSON.stringify(opciones.cuerpo))
    const respuesta = despachar(ctx, opciones.method, ruta, cuerpo)
    if (respuesta.estado >= 400) {
      const detalle = (respuesta.cuerpo as { detail?: unknown } | null)?.detail
      throw new ErrorDeApi(motivoDelFallo(detalle) ?? FALLO_DE_LA_APP, respuesta.estado, detalle)
    }
    return respuesta.cuerpo as T
  }

  return {
    // --- Tus datos: exportar, importar y borrar ---
    /** Cuánto hay, para la confirmación de exportar y de borrar (no es `resumen`, el de H5). */
    resumenDeDatos: () => peticion<ResumenDeDatos>('/datos/resumen'),
    /** Todo, tal cual lo da la API: la pantalla lo guarda en un archivo. */
    exportarDatos: () => peticion<unknown>('/datos/exportar'),
    /** Sin escribir nada: si el archivo vale y qué se sustituiría por qué. */
    comprobarImportar: (archivo: unknown) =>
      peticion<ComprobacionDeImportar>(
        `/datos/importar${consulta({ comprobar: true })}`,
        conCuerpo('POST', archivo),
      ),
    /** Sustituye todo por lo del archivo. */
    importarDatos: (archivo: unknown) =>
      peticion<ResumenDeDatos>('/datos/importar', conCuerpo('POST', archivo)),
    /** Borra todo lo tuyo para empezar de cero (los ejercicios de la app se quedan). */
    borrarDatos: () => peticion<void>('/datos', BORRAR),

    gruposMusculares: () => peticion<GrupoMuscular[]>('/grupos-musculares'),

    // --- Ejercicios y sus notas ---
    ejercicios: (filtro: { ocultos?: boolean } = {}) =>
      peticion<Ejercicio[]>(`/ejercicios${consulta(filtro)}`),
    ejercicio: (id: number) => peticion<Ejercicio>(`/ejercicios/${id}`),
    crearEjercicio: (datos: NuevoEjercicio) =>
      peticion<Ejercicio>('/ejercicios', conCuerpo('POST', datos)),
    actualizarEjercicio: (id: number, datos: NuevoEjercicio) =>
      peticion<Ejercicio>(`/ejercicios/${id}`, conCuerpo('PUT', datos)),
    dondeSeUsa: (id: number) => peticion<UsoEnRutina[]>(`/ejercicios/${id}/donde-se-usa`),
    avisoDeBorrarEjercicio: (id: number) =>
      peticion<AvisoDeBorrarEjercicio>(`/ejercicios/${id}/aviso-de-borrado`),
    borrarEjercicio: (id: number, modo?: ModoBorrado) =>
      peticion<void>(`/ejercicios/${id}${consulta({ modo })}`, BORRAR),
    mostrarEjercicio: (id: number) =>
      peticion<Ejercicio>(`/ejercicios/${id}/mostrar`, conCuerpo('POST')),
    historialDeEjercicio: (id: number, filtro: { hasta?: string; limite?: number } = {}) =>
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
    /** Con sus ejercicios (`slots`), todo en una petición: si algo no vale, no se crea nada. */
    crearRutina: (datos: NuevaRutina) => peticion<Rutina>('/rutinas', conCuerpo('POST', datos)),
    /** El *Guardar* de la rutina: el nombre y, si va, el orden de los ejercicios visibles, de golpe. */
    actualizarRutina: (id: number, nombre: string, huecoIds?: number[]) =>
      peticion<Rutina>(`/rutinas/${id}`, conCuerpo('PUT', { nombre, slot_ids: huecoIds })),
    borrarRutina: (id: number, modo?: ModoBorrado) =>
      peticion<void>(`/rutinas/${id}${consulta({ modo })}`, BORRAR),
    mostrarRutina: (id: number) => peticion<Rutina>(`/rutinas/${id}/mostrar`, conCuerpo('POST')),
    /** La copia se llama como en Windows («Push - copia») y nace sin estar en ningún programa. */
    duplicarRutina: (id: number) => peticion<Rutina>(`/rutinas/${id}/duplicar`, conCuerpo('POST')),
    /** Lo que se perdería al borrarla, para enseñarlo antes de preguntar. */
    avisoDeBorrarRutina: (id: number) =>
      peticion<AvisoDeBorrarRutina>(`/rutinas/${id}/aviso-de-borrado`),

    crearHueco: (rutinaId: number, datos: NuevoHueco) =>
      peticion<HuecoDeRutina>(`/rutinas/${rutinaId}/slots`, conCuerpo('POST', datos)),
    actualizarHueco: (rutinaId: number, huecoId: number, datos: CambiosDeHueco) =>
      peticion<HuecoDeRutina>(`/rutinas/${rutinaId}/slots/${huecoId}`, conCuerpo('PUT', datos)),
    borrarHueco: (rutinaId: number, huecoId: number, modo?: ModoBorrado) =>
      peticion<void>(`/rutinas/${rutinaId}/slots/${huecoId}${consulta({ modo })}`, BORRAR),
    /** Lo que se perdería al borrarlo, para enseñarlo antes de preguntar. */
    avisoDeBorrarHueco: (rutinaId: number, huecoId: number) =>
      peticion<AvisoDeBorrarHueco>(`/rutinas/${rutinaId}/slots/${huecoId}/aviso-de-borrado`),
    mostrarHueco: (rutinaId: number, huecoId: number) =>
      peticion<HuecoDeRutina>(`/rutinas/${rutinaId}/slots/${huecoId}/mostrar`, conCuerpo('POST')),

    // --- Entrenamientos y series ---
    /**
     * Con `sin_terminar`, las de días pasados que se dejaron sin terminar, con series o
     * vacías. Con `rutina_id` y `limite`, las últimas sesiones de una rutina.
     */
    entrenamientos: (
      filtro: RangoConLimite & {
        sin_terminar?: boolean
        rutina_id?: number
      } = {},
    ) => peticion<Entrenamiento[]>(`/entrenamientos${consulta(filtro)}`),
    entrenamiento: (id: number) => peticion<Entrenamiento>(`/entrenamientos/${id}`),
    crearEntrenamiento: (datos: NuevoEntrenamiento) =>
      peticion<Entrenamiento>('/entrenamientos', conCuerpo('POST', datos)),
    actualizarEntrenamiento: (id: number, datos: EntrenamientoCorregido) =>
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
    /** Todas las series de un ejercicio de la rutina en la sesión, de una vez: cambiar de ejercicio. */
    borrarSeriesDelHueco: (entrenamientoId: number, huecoId: number) =>
      peticion<void>(
        `/entrenamientos/${entrenamientoId}/series${consulta({ slot_id: huecoId })}`,
        BORRAR,
      ),

    // --- Programas ---
    programas: (filtro: { ocultos?: boolean } = {}) =>
      peticion<Programa[]>(`/programas${consulta(filtro)}`),
    programa: (id: number) => peticion<Programa>(`/programas/${id}`),
    crearPrograma: (datos: NuevoPrograma) =>
      peticion<Programa>('/programas', conCuerpo('POST', datos)),
    /** El *Guardar* de la semana: el nombre y, si van, los siete días (los que faltan, descanso), de golpe. */
    actualizarPrograma: (
      id: number,
      nombre: string,
      dias?: { dia_semana: DiaSemana; rutina_id: number }[],
    ) => peticion<Programa>(`/programas/${id}`, conCuerpo('PUT', { nombre, dias })),
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

    // --- Plan: qué toca cada día ---
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
    // --- Resumen ---
    /** `mes` como `2026-09`; sin él, el de hoy. */
    resumen: (mes?: string) => peticion<Resumen>(`/resumen${consulta({ mes })}`),
  }
}
