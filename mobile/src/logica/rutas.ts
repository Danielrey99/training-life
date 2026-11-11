/**
 * Las rutas del backend, dentro del teléfono: `despachar(ctx, 'POST', '/rutinas', cuerpo)`
 * hace lo mismo que esa petición a la API y contesta con el mismo código y el mismo JSON.
 *
 * Es el único camino a los servicios: lo usa `api.ts` (y, por él, las pantallas) y lo usan
 * los tests portados del backend, que mandan la misma URL y el mismo cuerpo que allí. Así
 * lo que se prueba es lo que usa la app.
 *
 * Como FastAPI, cada petición:
 * - busca su ruta (404 «Not Found» si no hay ninguna, 405 si la hay con otro método);
 * - valida la ruta, la consulta y el cuerpo, en ese orden, y junta todos los errores en un
 *   422 con la forma de FastAPI (`loc` empieza por 'path', 'query' o 'body');
 * - corre en una transacción: si el servicio lanza, no queda nada escrito (en el backend,
 *   una sesión que se cierra sin `commit()`).
 */
import type { Contexto } from './contexto'
import { FalloDeLaApp } from './fallos'
import * as ejercicios from './servicios/ejercicios'
import * as entrenamientos from './servicios/entrenamientos'
import { SESIONES_POR_DEFECTO } from './servicios/historial'
import * as planificar from './servicios/planificar'
import { obtenerResumen } from './servicios/resumen'
import * as rutinas from './servicios/rutinas'
import {
  aBooleano,
  aEntero,
  aFecha,
  entero as campoEntero,
  objeto,
  Validador,
  type Loc,
  type Topes,
} from './validacion/base'
import { cambiosDeEjercicio, ejercicioNuevo, textoDeNota } from './validacion/ejercicios'
import { cambiosDeEntrenamiento, entrenamientoNuevo, serie } from './validacion/entrenamientos'
import { activarPrograma, cambiosDePrograma, programaNuevo } from './validacion/programas'
import { cambiosDeRutina, hueco, rutinaNueva } from './validacion/rutinas'
import * as programas from './servicios/programas'
import * as datos from './servicios/datos'

export type Metodo = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface Respuesta {
  estado: number
  /** El JSON de la respuesta: lo que devuelve el servicio, o `{ detail }` si falla. */
  cuerpo: unknown
}

// --- Lo que llega en la petición ---------------------------------------------------------

/**
 * Lo que trae una petición, con lectores que apuntan los errores en un solo `Validador`.
 * Cada ruta lee primero lo de la ruta, luego la consulta y por último el cuerpo, como
 * FastAPI, y `validar()` lanza el 422 con todos los errores.
 */
class Entrada {
  readonly v = new Validador()

  constructor(
    private readonly enRuta: Record<string, string>,
    private readonly enConsulta: Map<string, string>,
    private readonly cuerpoCrudo: unknown,
  ) {}

  /** Un entero de la ruta (`/rutinas/{rutina_id}`). */
  id(nombre: string): number {
    return aEntero(this.v, this.enRuta[nombre], ['path', nombre]) as number
  }

  /** Una fecha de la ruta (`/plan/excepciones/{fecha}`). */
  fechaEnRuta(nombre: string): string {
    return aFecha(this.v, this.enRuta[nombre], ['path', nombre]) as string
  }

  private consulta<T>(
    nombre: string,
    porDefecto: T,
    leer: (valor: string, loc: Loc) => T | undefined,
  ): T {
    const valor = this.enConsulta.get(nombre)
    if (valor === undefined) return porDefecto
    return leer(valor, ['query', nombre]) as T
  }

  booleano(nombre: string): boolean {
    return this.consulta(nombre, false, (valor, loc) => aBooleano(this.v, valor, loc))
  }

  entero(nombre: string, porDefecto: number, topes: Topes = {}): number {
    return this.consulta(nombre, porDefecto, (valor, loc) => aEntero(this.v, valor, loc, topes))
  }

  enteroOpcional(nombre: string, topes: Topes = {}): number | null {
    return this.consulta<number | null>(nombre, null, (valor, loc) =>
      aEntero(this.v, valor, loc, topes),
    )
  }

  fecha(nombre: string): string | null {
    return this.consulta<string | null>(nombre, null, (valor, loc) => aFecha(this.v, valor, loc))
  }

  /** Un parámetro de consulta sin valor por defecto: si falta, «Field required». */
  private obligatorio<T>(nombre: string, leer: (valor: string, loc: Loc) => T | undefined): T {
    const valor = this.enConsulta.get(nombre)
    if (valor === undefined) {
      return this.v.error('missing', ['query', nombre], 'Field required') as T
    }
    return leer(valor, ['query', nombre]) as T
  }

  /** Un texto de la consulta que tiene que encajar en `patron` (`Query(pattern=...)`). */
  textoConPatron(nombre: string, patron: string): string | null {
    return this.consulta<string | null>(nombre, null, (valor, loc) => {
      if (new RegExp(patron).test(valor)) return valor
      return this.v.error('string_pattern_mismatch', loc, `String should match pattern '${patron}'`)
    })
  }

  fechaObligatoria(nombre: string): string {
    return this.obligatorio(nombre, (valor, loc) => aFecha(this.v, valor, loc))
  }

  enteroObligatorio(nombre: string): number {
    return this.obligatorio(nombre, (valor, loc) => aEntero(this.v, valor, loc))
  }

  /** `modo` de los DELETE: `Literal["ocultar", "definitivo"] | None`. */
  modo(): ejercicios.ModoBorrado | null {
    return this.consulta<ejercicios.ModoBorrado | null>('modo', null, (valor, loc) => {
      if (valor === 'ocultar' || valor === 'definitivo') return valor
      return this.v.error('literal_error', loc, "Input should be 'ocultar' or 'definitivo'")
    })
  }

  /** El cuerpo, leído con `leer`. Sin cuerpo (o `null`), «Field required» en ['body']. */
  cuerpo<T>(leer: (v: Validador, datos: Record<string, unknown>, loc: Loc) => T): T {
    if (this.cuerpoCrudo === undefined || this.cuerpoCrudo === null) {
      return this.v.error('missing', ['body'], 'Field required') as T
    }
    const datos = objeto(this.v, this.cuerpoCrudo, ['body'])
    return (datos === null ? undefined : leer(this.v, datos, ['body'])) as T
  }

  /** Cualquier JSON (`Any = Body(...)`), sin validar: solo tiene que llegar. */
  cuerpoSinValidar(): unknown {
    if (this.cuerpoCrudo === undefined || this.cuerpoCrudo === null) {
      return this.v.error('missing', ['body'], 'Field required')
    }
    return this.cuerpoCrudo
  }

  /** Un cuerpo que puede faltar (`Modelo | None = None`): sin él, `sinCuerpo`. */
  cuerpoOpcional<T>(
    leer: (v: Validador, datos: Record<string, unknown>, loc: Loc) => T,
    sinCuerpo: T,
  ): T {
    if (this.cuerpoCrudo === undefined || this.cuerpoCrudo === null) return sinCuerpo
    return this.cuerpo(leer)
  }

  /** Lanza el 422 si algo no valía. */
  validar(): void {
    this.v.terminar()
  }
}

// --- Las rutas ---------------------------------------------------------------------------

interface Ruta {
  metodo: Metodo
  patron: string[]
  /** El código si todo va bien: 200, o 201 al crear y 204 al borrar. */
  estado: number
  manejar(ctx: Contexto, e: Entrada): unknown
}

const RUTAS: Ruta[] = []

function ruta(
  metodo: Metodo,
  patron: string,
  manejar: (ctx: Contexto, e: Entrada) => unknown,
  estado = metodo === 'DELETE' ? 204 : 200,
): void {
  RUTAS.push({ metodo, patron: patron.split('/').filter(Boolean), estado, manejar })
}

/** Lee lo que diga `leer` y, si todo vale, llama al servicio. */
function con<T>(e: Entrada, leer: () => T, servicio: (datos: T) => unknown): unknown {
  const datos = leer()
  e.validar()
  return servicio(datos)
}

// Grupos musculares
ruta('GET', '/grupos-musculares', (ctx) => ejercicios.listarGruposMusculares(ctx))

// Ejercicios
ruta('GET', '/ejercicios', (ctx, e) =>
  con(
    e,
    () => e.booleano('ocultos'),
    (ocultos) => ejercicios.listarEjercicios(ctx, ocultos),
  ),
)
ruta('GET', '/ejercicios/{ejercicio_id}', (ctx, e) =>
  con(
    e,
    () => e.id('ejercicio_id'),
    (id) => ejercicios.obtenerEjercicio(ctx, id),
  ),
)
ruta('GET', '/ejercicios/{ejercicio_id}/donde-se-usa', (ctx, e) =>
  con(
    e,
    () => e.id('ejercicio_id'),
    (id) => ejercicios.dondeSeUsa(ctx, id),
  ),
)
ruta('GET', '/ejercicios/{ejercicio_id}/aviso-de-borrado', (ctx, e) =>
  con(
    e,
    () => e.id('ejercicio_id'),
    (id) => ejercicios.avisoDeBorrarEjercicio(ctx, id),
  ),
)
ruta(
  'POST',
  '/ejercicios',
  (ctx, e) =>
    con(
      e,
      () => e.cuerpo(ejercicioNuevo),
      (datos) => ejercicios.crearEjercicio(ctx, datos),
    ),
  201,
)
ruta('PUT', '/ejercicios/{ejercicio_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('ejercicio_id'), e.cuerpo(cambiosDeEjercicio)] as const,
    ([id, datos]) => ejercicios.actualizarEjercicio(ctx, id, datos),
  ),
)
ruta('DELETE', '/ejercicios/{ejercicio_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('ejercicio_id'), e.modo()] as const,
    ([id, modo]) => ejercicios.borrarEjercicio(ctx, id, modo),
  ),
)
ruta('POST', '/ejercicios/{ejercicio_id}/mostrar', (ctx, e) =>
  con(
    e,
    () => e.id('ejercicio_id'),
    (id) => ejercicios.mostrarEjercicio(ctx, id),
  ),
)
ruta('GET', '/ejercicios/{ejercicio_id}/historial', (ctx, e) =>
  con(
    e,
    () =>
      [
        e.id('ejercicio_id'),
        e.fecha('hasta'),
        e.entero('limite', SESIONES_POR_DEFECTO, { gt: 0, le: 500 }),
      ] as const,
    ([id, hasta, limite]) => ejercicios.historialDeEjercicio(ctx, id, hasta, limite),
  ),
)

// Notas de un ejercicio
ruta('GET', '/ejercicios/{ejercicio_id}/notas', (ctx, e) =>
  con(
    e,
    () => e.id('ejercicio_id'),
    (id) => ejercicios.listarNotas(ctx, id),
  ),
)
ruta(
  'POST',
  '/ejercicios/{ejercicio_id}/notas',
  (ctx, e) =>
    con(
      e,
      () => [e.id('ejercicio_id'), e.cuerpo(textoDeNota)] as const,
      ([id, texto]) => ejercicios.crearNota(ctx, id, texto),
    ),
  201,
)
ruta('PUT', '/ejercicios/{ejercicio_id}/notas/{nota_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('ejercicio_id'), e.id('nota_id'), e.cuerpo(textoDeNota)] as const,
    ([id, notaId, texto]) => ejercicios.actualizarNota(ctx, id, notaId, texto),
  ),
)
ruta('DELETE', '/ejercicios/{ejercicio_id}/notas/{nota_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('ejercicio_id'), e.id('nota_id')] as const,
    ([id, notaId]) => ejercicios.borrarNota(ctx, id, notaId),
  ),
)

// Rutinas
ruta('GET', '/rutinas', (ctx, e) =>
  con(
    e,
    () => e.booleano('ocultas'),
    (ocultas) => rutinas.listarRutinas(ctx, ocultas),
  ),
)
ruta('GET', '/rutinas/{rutina_id}', (ctx, e) =>
  con(
    e,
    () => e.id('rutina_id'),
    (id) => rutinas.obtenerRutina(ctx, id),
  ),
)
ruta(
  'POST',
  '/rutinas',
  (ctx, e) =>
    con(
      e,
      () => e.cuerpo(rutinaNueva),
      (datos) => rutinas.crearRutina(ctx, datos),
    ),
  201,
)
ruta('PUT', '/rutinas/{rutina_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('rutina_id'), e.cuerpo(cambiosDeRutina)] as const,
    ([id, datos]) => rutinas.actualizarRutina(ctx, id, datos),
  ),
)
ruta(
  'POST',
  '/rutinas/{rutina_id}/duplicar',
  (ctx, e) =>
    con(
      e,
      () => e.id('rutina_id'),
      (id) => rutinas.duplicarRutina(ctx, id),
    ),
  201,
)
ruta('GET', '/rutinas/{rutina_id}/aviso-de-borrado', (ctx, e) =>
  con(
    e,
    () => e.id('rutina_id'),
    (id) => rutinas.avisoDeBorrarRutina(ctx, id),
  ),
)
ruta('POST', '/rutinas/{rutina_id}/mostrar', (ctx, e) =>
  con(
    e,
    () => e.id('rutina_id'),
    (id) => rutinas.mostrarRutina(ctx, id),
  ),
)
ruta('DELETE', '/rutinas/{rutina_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('rutina_id'), e.modo()] as const,
    ([id, modo]) => rutinas.borrarRutina(ctx, id, modo),
  ),
)

// Huecos de una rutina
ruta(
  'POST',
  '/rutinas/{rutina_id}/slots',
  (ctx, e) =>
    con(
      e,
      () =>
        [e.id('rutina_id'), e.cuerpo((v, d, loc) => hueco(v, d, loc, 'RutinaSlotCreate'))] as const,
      ([id, datos]) => rutinas.crearSlot(ctx, id, datos!),
    ),
  201,
)
ruta('PUT', '/rutinas/{rutina_id}/slots/{slot_id}', (ctx, e) =>
  con(
    e,
    () =>
      [
        e.id('rutina_id'),
        e.id('slot_id'),
        e.cuerpo((v, d, loc) => hueco(v, d, loc, 'RutinaSlotUpdate')),
      ] as const,
    ([id, slotId, datos]) => rutinas.actualizarSlot(ctx, id, slotId, datos!),
  ),
)
ruta('GET', '/rutinas/{rutina_id}/slots/{slot_id}/aviso-de-borrado', (ctx, e) =>
  con(
    e,
    () => [e.id('rutina_id'), e.id('slot_id')] as const,
    ([id, slotId]) => rutinas.avisoDeBorrarSlot(ctx, id, slotId),
  ),
)
ruta('DELETE', '/rutinas/{rutina_id}/slots/{slot_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('rutina_id'), e.id('slot_id'), e.modo()] as const,
    ([id, slotId, modo]) => rutinas.borrarSlot(ctx, id, slotId, modo),
  ),
)
ruta('POST', '/rutinas/{rutina_id}/slots/{slot_id}/mostrar', (ctx, e) =>
  con(
    e,
    () => [e.id('rutina_id'), e.id('slot_id')] as const,
    ([id, slotId]) => rutinas.mostrarSlot(ctx, id, slotId),
  ),
)

// Sesiones
ruta('GET', '/entrenamientos', (ctx, e) =>
  con(
    e,
    () => ({
      desde: e.fecha('desde'),
      hasta: e.fecha('hasta'),
      sin_terminar: e.booleano('sin_terminar'),
      rutina_id: e.enteroOpcional('rutina_id'),
      limite: e.enteroOpcional('limite', { gt: 0, le: 500 }),
    }),
    (filtro) => entrenamientos.listarEntrenamientos(ctx, filtro),
  ),
)
ruta('GET', '/entrenamientos/{entrenamiento_id}', (ctx, e) =>
  con(
    e,
    () => e.id('entrenamiento_id'),
    (id) => entrenamientos.obtenerEntrenamientoOut(ctx, id),
  ),
)
ruta(
  'POST',
  '/entrenamientos',
  (ctx, e) =>
    con(
      e,
      () => e.cuerpo(entrenamientoNuevo),
      (datos) => entrenamientos.crearEntrenamiento(ctx, datos),
    ),
  201,
)
ruta('PUT', '/entrenamientos/{entrenamiento_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('entrenamiento_id'), e.cuerpo(cambiosDeEntrenamiento)] as const,
    ([id, datos]) => entrenamientos.actualizarEntrenamiento(ctx, id, datos),
  ),
)
ruta('POST', '/entrenamientos/{entrenamiento_id}/terminar', (ctx, e) =>
  con(
    e,
    () => e.id('entrenamiento_id'),
    (id) => entrenamientos.terminarEntrenamiento(ctx, id),
  ),
)
ruta('DELETE', '/entrenamientos/{entrenamiento_id}', (ctx, e) =>
  con(
    e,
    () => e.id('entrenamiento_id'),
    (id) => entrenamientos.borrarEntrenamiento(ctx, id),
  ),
)

// Series de una sesión
ruta(
  'POST',
  '/entrenamientos/{entrenamiento_id}/series',
  (ctx, e) =>
    con(
      e,
      () => [e.id('entrenamiento_id'), e.cuerpo(serie)] as const,
      ([id, datos]) => entrenamientos.crearSerie(ctx, id, datos),
    ),
  201,
)
ruta('PUT', '/entrenamientos/{entrenamiento_id}/series/{serie_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('entrenamiento_id'), e.id('serie_id'), e.cuerpo(serie)] as const,
    ([id, serieId, datos]) => entrenamientos.actualizarSerie(ctx, id, serieId, datos),
  ),
)
ruta('DELETE', '/entrenamientos/{entrenamiento_id}/series', (ctx, e) =>
  con(
    e,
    () => [e.id('entrenamiento_id'), e.enteroObligatorio('slot_id')] as const,
    ([id, slotId]) => entrenamientos.borrarSeriesDelHueco(ctx, id, slotId),
  ),
)
ruta('DELETE', '/entrenamientos/{entrenamiento_id}/series/{serie_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('entrenamiento_id'), e.id('serie_id')] as const,
    ([id, serieId]) => entrenamientos.borrarSerie(ctx, id, serieId),
  ),
)

// Tus datos: exportar, importar y borrar
ruta('GET', '/datos/exportar', (ctx) => datos.exportar(ctx))
ruta('GET', '/datos/resumen', (ctx) => datos.resumirActual(ctx))
ruta('POST', '/datos/importar', (ctx, e) =>
  con(
    e,
    () => [e.booleano('comprobar'), e.cuerpoSinValidar()] as const,
    ([comprobar, archivo]) => datos.importarDatos(ctx, archivo, comprobar),
  ),
)
ruta('DELETE', '/datos', (ctx) => datos.borrarTodo(ctx))

// Programas
ruta('GET', '/programas', (ctx, e) =>
  con(
    e,
    () => e.booleano('ocultos'),
    (ocultos) => programas.listarProgramas(ctx, ocultos),
  ),
)
ruta('GET', '/programas/{programa_id}', (ctx, e) =>
  con(
    e,
    () => e.id('programa_id'),
    (id) => programas.obtenerPrograma(ctx, id),
  ),
)
ruta(
  'POST',
  '/programas',
  (ctx, e) =>
    con(
      e,
      () => e.cuerpo(programaNuevo),
      (datos) => programas.crearPrograma(ctx, datos),
    ),
  201,
)
ruta('PUT', '/programas/{programa_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('programa_id'), e.cuerpo(cambiosDePrograma)] as const,
    ([id, datos]) => programas.actualizarPrograma(ctx, id, datos),
  ),
)
ruta('POST', '/programas/{programa_id}/activar', (ctx, e) =>
  con(
    e,
    () => [e.id('programa_id'), e.cuerpoOpcional(activarPrograma, false)] as const,
    ([id, quitar]) => programas.activarPrograma(ctx, id, quitar),
  ),
)
ruta('POST', '/programas/{programa_id}/desactivar', (ctx, e) =>
  con(
    e,
    () => e.id('programa_id'),
    (id) => programas.desactivarPrograma(ctx, id),
  ),
)
ruta('POST', '/programas/{programa_id}/mostrar', (ctx, e) =>
  con(
    e,
    () => e.id('programa_id'),
    (id) => programas.mostrarPrograma(ctx, id),
  ),
)
ruta('DELETE', '/programas/{programa_id}', (ctx, e) =>
  con(
    e,
    () => [e.id('programa_id'), e.modo()] as const,
    ([id, modo]) => programas.borrarPrograma(ctx, id, modo),
  ),
)

// Resumen. Años de 2000 a 2099, como el backend: restar meses a una fecha extrema se
// saldría del calendario.
ruta('GET', '/resumen', (ctx, e) =>
  con(
    e,
    () => e.textoConPatron('mes', String.raw`^20\d{2}-(0[1-9]|1[0-2])$`),
    (mes) => obtenerResumen(ctx, mes),
  ),
)

// El plan
ruta('GET', '/plan/seguimiento', (ctx, e) =>
  con(
    e,
    () => [e.fechaObligatoria('desde'), e.fechaObligatoria('hasta')] as const,
    ([desde, hasta]) => planificar.obtenerSeguimiento(ctx, desde, hasta),
  ),
)
ruta('GET', '/plan/hoy', (ctx, e) =>
  con(
    e,
    () => e.fecha('fecha'),
    (fecha) => planificar.obtenerHoy(ctx, fecha),
  ),
)
ruta('GET', '/plan/excepciones', (ctx, e) =>
  con(
    e,
    () => [e.fecha('desde'), e.fecha('hasta')] as const,
    ([desde, hasta]) => planificar.listarExcepciones(ctx, desde, hasta),
  ),
)
ruta('PUT', '/plan/excepciones/{fecha}', (ctx, e) =>
  con(
    e,
    () =>
      [
        e.fechaEnRuta('fecha'),
        // `ExcepcionUpdate`: `rutina_id` es obligatorio, y nulo es descanso.
        e.cuerpo((v, d, loc) => campoEntero(v, d, 'rutina_id', loc, {}, { nulo: true })),
      ] as const,
    ([fecha, rutinaId]) => planificar.planificarDia(ctx, fecha, rutinaId ?? null),
  ),
)
ruta('DELETE', '/plan/excepciones/{fecha}', (ctx, e) =>
  con(
    e,
    () => e.fechaEnRuta('fecha'),
    (fecha) => planificar.restablecerDia(ctx, fecha),
  ),
)
ruta('DELETE', '/plan/excepciones', (ctx, e) =>
  con(
    e,
    () => [e.fechaObligatoria('desde'), e.fechaObligatoria('hasta')] as const,
    ([desde, hasta]) => planificar.restablecerRango(ctx, desde, hasta),
  ),
)

// --- Despachar ---------------------------------------------------------------------------

/** `a=1&b=2` a un mapa. Si una clave se repite, vale la última, como en FastAPI. */
function leerConsulta(texto: string): Map<string, string> {
  const consulta = new Map<string, string>()
  for (const par of texto.split('&')) {
    if (par === '') continue
    const [clave, ...resto] = par.split('=')
    const descifrar = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '))
    consulta.set(descifrar(clave), descifrar(resto.join('=')))
  }
  return consulta
}

function buscar(
  metodo: Metodo,
  segmentos: string[],
): { ruta: Ruta; enRuta: Record<string, string> } | 'otro_metodo' | null {
  let otroMetodo = false
  for (const r of RUTAS) {
    if (r.patron.length !== segmentos.length) continue
    const enRuta: Record<string, string> = {}
    const encaja = r.patron.every((trozo, i) => {
      if (trozo.startsWith('{')) {
        enRuta[trozo.slice(1, -1)] = segmentos[i]
        return true
      }
      return trozo === segmentos[i]
    })
    if (!encaja) continue
    if (r.metodo === metodo) return { ruta: r, enRuta }
    otroMetodo = true
  }
  return otroMetodo ? 'otro_metodo' : null
}

/**
 * Hace la petición `metodo url` con ese cuerpo (ya leído del JSON) y devuelve el código y
 * el JSON de la respuesta, igual que el backend. Un error que no sea de la app (un fallo de
 * programación, un CHECK de la base que salta) no se convierte: se lanza, como un 500.
 */
export function despachar(ctx: Contexto, metodo: Metodo, url: string, cuerpo?: unknown): Respuesta {
  const [camino, consulta = ''] = url.split('?', 2)
  const segmentos = camino.split('/').filter(Boolean).map(decodeURIComponent)
  const encontrada = buscar(metodo, segmentos)
  if (encontrada === null) return { estado: 404, cuerpo: { detail: 'Not Found' } }
  if (encontrada === 'otro_metodo') {
    return { estado: 405, cuerpo: { detail: 'Method Not Allowed' } }
  }
  const { ruta: r, enRuta } = encontrada
  try {
    const resultado = ctx.bd.transaccion(() =>
      r.manejar(ctx, new Entrada(enRuta, leerConsulta(consulta), cuerpo)),
    )
    // Por JSON, como viajaría: sin `undefined` y sin compartir objetos con la lógica.
    const json = r.estado === 204 ? null : JSON.parse(JSON.stringify(resultado))
    return { estado: r.estado, cuerpo: json }
  } catch (error) {
    if (error instanceof FalloDeLaApp) {
      return { estado: error.estado, cuerpo: { detail: error.detalle } }
    }
    throw error
  }
}
