/**
 * Ayudas que comparten los tests para montar sus escenarios. Puerto de
 * `backend/tests/ayudas.py`: mismos nombres (en snake_case, para buscarlos desde el test de
 * Python), mismo comportamiento y los textos copiados letra a letra.
 *
 * Las `crear_*` crean un ejercicio, una rutina o un hueco por la API, siempre nuevos.
 *
 * Toda sesión es de una rutina y toda serie va en un hueco de esa rutina, así que para
 * apuntar una serie hace falta antes una rutina con su hueco. `entrenar`, `serie_en` y
 * compañía lo montan a demanda y sin repetirlo: si la rutina o el hueco ya existen, los usan.
 *
 * Ojo con lo que se monta a demanda: si el ejercicio no es el principal de ningún hueco
 * visible de la rutina, `hueco_para` le añade uno, y eso cambia lo que la rutina tiene. Un
 * test que cuente huecos o ejercicios de una rutina debe pasar el `slot_id` explícito.
 *
 * Cómo se pasan los argumentos (Python tiene nombrados; TypeScript, no):
 * - Los que Python casi siempre pasa por posición (el nombre de `crear_ejercicio` y de
 *   `crear_rutina`, las series y repeticiones de `objetivo`) siguen por posición.
 * - Los que Python pasa por nombre (`tipo=`, `orden=`, `duracion=`, los `**campos`) van en un
 *   objeto final con esa misma clave: `crear_ejercicio(cliente, g, 'Cinta', { tipo: 'cardio' })`.
 * - `duracion=(30, 45)` de `objetivo` y `alternativa` va en lugar de las repeticiones:
 *   `objetivo(3, { duracion: [30, 45] })`.
 * - Las fechas son textos ISO («2026-09-16»), no `date`: `fecha.isoformat()` sobra.
 * - Una tupla de Python es un array. Una tupla de Python como resultado es un array.
 *
 * No se portan `consultas_de` (cuenta las consultas SQL de SQLAlchemy, que el móvil no tiene)
 * ni `cuantas_filas` con modelos: ahora recibe nombres de tabla.
 */
import type { Bd } from '../../src/logica/bd/bd'
import { fechaEnTexto } from '../../src/logica/reglas/fechas'
import { predefinidos } from './baseNueva'
import { hoy, type ClienteDeTest as Cliente, type RespuestaDeTest } from './cliente'
import { contar, filaRutina } from './filas'

type Par = [number, number]

/** Lo que `assert respuesta.status_code == N, respuesta.text` es en Python. */
export function esperar_estado(respuesta: RespuestaDeTest, estado: number): void {
  if (respuesta.status_code !== estado) {
    throw new Error(`Se esperaba ${estado} y llegó ${respuesta.status_code}: ${respuesta.text}`)
  }
}

function afirmar(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(mensaje)
}

export const NOMBRE_DE_PRUEBA = 'Rutina de prueba'

// El 409 del DELETE sin `modo` de lo que tiene historial: una frase fija que solo pide
// elegir `modo`. Lo que se perdería lo cuenta su aviso de borrado.
export const PIDE_MODO = {
  ejercicio:
    'Este ejercicio está en uso. Repite la petición con ?modo=ocultar (conserva ' +
    'todo) o ?modo=definitivo (lo borra con todo lo que lo usa, sin poder deshacerlo).',
  rutina:
    'Esta rutina tiene historial. Repite la petición con ?modo=ocultar (conserva ' +
    'todo) o ?modo=definitivo (la borra con todo lo que la usa, sin poder deshacerlo).',
  hueco:
    'Este ejercicio de la rutina tiene series apuntadas. Repite la petición con ' +
    '?modo=ocultar (conserva todo) o ?modo=definitivo (lo borra con sus series, sin poder ' +
    'deshacerlo).',
  programa:
    'Este programa ha estado activo. Repite la petición con ?modo=ocultar ' +
    '(conserva todo) o ?modo=definitivo (lo borra con sus días y periodos, sin poder ' +
    'deshacerlo).',
}

// Los 404 con las palabras de la app. Lo que falta por la ruta dice «ya no existe»; lo
// elegido en el cuerpo se nombra si existe (oculto), y si no, no se puede: solo hay id.

export const EJERCICIO_YA_NO_EXISTE = 'Este ejercicio ya no existe. Puede que lo hayas borrado.'
export const ELEGIDO_YA_NO_EXISTE =
  'Uno de los ejercicios que has elegido ya no existe. Elige otro en su lugar.'
export const SERIE_YA_NO_EXISTE = 'Esa serie ya no existe. Puede que la hayas borrado.'
export const SERIE_DEL_DIA_YA_NO_EXISTE =
  'Una de las series de este día ya no existe. Pulsa Cancelar y vuelve a editar el día.'

/** El 404 de elegir un ejercicio oculto. */
export function ejercicio_oculto(nombre: string): string {
  return (
    `«${nombre}» está oculto, así que no se puede elegir. Muéstralo desde la pestaña` +
    ' Ejercicios o elige otro.'
  )
}

/**
 * El `detail` del 409 de un nombre repetido: marcado con `campo` para enseñarlo bajo el
 * nombre. El de editar algo oculto, en cambio, es un texto sin más.
 */
export function nombre_repetido(mensaje: string): Record<string, string> {
  return { mensaje, campo: 'nombre' }
}

// Los 422 de fechas que salen en más de un endpoint, con el texto exacto: comparar solo un
// trozo dejaría pasar una frase rota. Las fechas van como las escribe la web («martes 15
// de septiembre»), con `fechaEnTexto`, que tiene sus propios tests.

/** `fecha_en_texto` de la fecha escrita como «2026-09-14», con el «hoy» del cliente actual. */
export function en_texto(fecha: string): string {
  return fechaEnTexto(fecha, hoy())
}

export function rango_invertido(desde: string, hasta: string): string {
  return `Las fechas están al revés. El ${en_texto(desde)} va después del ${en_texto(hasta)}.`
}

export function todavia_no_ha_llegado(fecha: string): string {
  return `El ${en_texto(fecha)} todavía no ha llegado. Solo se apuntan días de hoy hacia atrás.`
}

export function fuera_de_plazo(cubre: string, desde: string, hasta: string): string {
  return (
    `Lo del ${en_texto(cubre)} solo se puede entrenar entre el ${en_texto(desde)}` +
    ` y el ${en_texto(hasta)}. Se adelanta dentro de su semana y se recupera hasta el` +
    ' día antes del mismo día de la semana siguiente.'
  )
}

// Al mover la fecha de un día del historial, los avisos son los que la web enseña bajo la
// fecha: van marcados con `campo` y hablan de la sesión que se mueve.

/** El `detail` de un fallo al mover la fecha de un día del historial. */
export function bajo_la_fecha(mensaje: string): Record<string, string> {
  return { mensaje, campo: 'fecha' }
}

/** Fuera del plazo del día que cuenta: hasta (o desde) dónde puede ir. */
export function solo_puede_ir(
  rutina: string,
  contado: string,
  hacia: string,
  limite: string,
): string {
  return (
    `Este ${rutina} cuenta como el del ${en_texto(contado)}, así que solo puede ir` +
    ` ${hacia} el ${en_texto(limite)}.`
  )
}

/** Dentro del plazo, pero en un día de otro programa (o sin programa). */
export function no_seguias_el_programa(rutina: string, contado: string, nueva: string): string {
  return (
    `Este ${rutina} cuenta como el del ${en_texto(contado)}, y el ${en_texto(nueva)} no` +
    ' seguías el mismo programa que ese día. Solo se puede mover a un día en que lo' +
    ' siguieras.'
  )
}

// --- Crear lo básico por la API -------------------------------------------
// Siempre crean uno nuevo y fallan si la API no da 201: un test que monta su escenario con
// ellas no puede seguir con un id que no existe. Dos ejercicios no pueden llamarse igual, ni
// uno propio como un predefinido: cada test que cree más de uno les pone nombre.

/**
 * Un ejercicio propio nuevo; devuelve su id. Sin `tipo`, el de la API por defecto (peso y
 * repeticiones).
 */
export function crear_ejercicio(
  cliente: Cliente,
  grupo_muscular_id: number,
  nombre = 'Press banca',
  { tipo }: { tipo?: string } = {},
): number {
  const cuerpo: Record<string, unknown> = { nombre, grupo_muscular_id }
  if (tipo !== undefined) cuerpo.tipo_registro = tipo
  const respuesta = cliente.post('/ejercicios', { json: cuerpo })
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

/** Una rutina nueva, sin huecos; devuelve su id. */
export function crear_rutina(cliente: Cliente, nombre = 'Push'): number {
  const respuesta = cliente.post('/rutinas', { json: { nombre } })
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

// --- El objetivo de cada ejercicio en un hueco ------------------------------
// Va en repeticiones o en segundos según la familia del tipo del ejercicio: los de tiempo,
// en segundos; los demás, en repeticiones (`medidas.ts`).

export const CAMPOS_DEL_OBJETIVO = [
  'series_objetivo',
  'reps_min',
  'reps_max',
  'duracion_min_s',
  'duracion_max_s',
] as const
export const DURACION_POR_DEFECTO: Par = [30, 60]

/** Las repeticiones `[min, max]`, o `{ duracion: [min, max] }` en segundos en su lugar. */
export type Medida = Par | { duracion?: Par }

function separar(medida: Medida): { reps: Par; duracion?: Par } {
  if (Array.isArray(medida)) return { reps: medida }
  return { reps: [6, 10], duracion: medida.duracion }
}

/** Los cinco campos del objetivo: con `duracion`, en segundos; si no, en repeticiones. */
export function objetivo(series = 4, medida: Medida = [6, 10]): Record<string, number | null> {
  const { reps, duracion } = separar(medida)
  if (duracion !== undefined) {
    return {
      series_objetivo: series,
      reps_min: null,
      reps_max: null,
      duracion_min_s: duracion[0],
      duracion_max_s: duracion[1],
    }
  }
  return {
    series_objetivo: series,
    reps_min: reps[0],
    reps_max: reps[1],
    duracion_min_s: null,
    duracion_max_s: null,
  }
}

/** Los cinco campos del objetivo de un hueco o de una alternativa de la API. */
export function objetivo_de(fila: any): Record<string, number | null> {
  return Object.fromEntries(CAMPOS_DEL_OBJETIVO.map((campo) => [campo, fila[campo]]))
}

/** Una alternativa para el cuerpo de un hueco, con su objetivo. */
export function alternativa(
  ejercicio_id: number,
  series = 3,
  medida: Medida = [6, 10],
): Record<string, unknown> {
  return { ejercicio_id, ...objetivo(series, medida) }
}

/**
 * Si el objetivo de ese ejercicio va en segundos (los de tiempo y los de cardio). Uno que no
 * existe, no: así el test que lo usa a propósito recibe el 404 de la API y no un fallo de aquí.
 */
export function es_de_tiempo(cliente: Cliente, ejercicio_id: number): boolean {
  const respuesta = cliente.get(`/ejercicios/${ejercicio_id}`)
  return (
    respuesta.status_code === 200 && ['tiempo', 'cardio'].includes(respuesta.json().tipo_registro)
  )
}

/** El cuerpo de un hueco de repeticiones sin comodines, con `orden` (el PUT lo exige). */
export function cuerpo_de_hueco(
  ejercicio_id: number,
  { orden = 1, series = 4, reps = [6, 10] }: { orden?: number; series?: number; reps?: Par } = {},
): Record<string, unknown> {
  return { ejercicio_principal_id: ejercicio_id, orden, ...objetivo(series, reps) }
}

/**
 * Un hueco nuevo en la rutina, con ese ejercicio de principal y sin comodines. Sin `orden`,
 * el backend lo pone al final. El objetivo va en repeticiones, salvo que se pase `duracion`
 * o el ejercicio sea de tiempo (entonces, en segundos). Devuelve su id.
 */
export function crear_hueco(
  cliente: Cliente,
  rutina_id: number,
  ejercicio_id: number,
  {
    orden,
    series = 4,
    reps = [6, 10],
    duracion,
  }: { orden?: number; series?: number; reps?: Par; duracion?: Par } = {},
): number {
  if (duracion === undefined && es_de_tiempo(cliente, ejercicio_id)) {
    duracion = DURACION_POR_DEFECTO
  }
  const cuerpo: Record<string, unknown> = {
    ejercicio_principal_id: ejercicio_id,
    ...objetivo(series, duracion === undefined ? reps : { duracion }),
  }
  if (orden !== undefined) cuerpo.orden = orden
  const respuesta = cliente.post(`/rutinas/${rutina_id}/slots`, { json: cuerpo })
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

/**
 * PUT del hueco con esa lista de alternativas (comodines) y el resto de sus campos tal cual:
 * la lista sustituye a la que tenía. Es la única forma de cambiarlas en un hueco que ya
 * existe. Devuelve la respuesta entera, para mirar el código; para montar datos,
 * `poner_alternativas`.
 *
 * Cada alternativa es un cuerpo entero (`alternativa(...)`) o solo un id de ejercicio. Con
 * solo el id: si ya es alternativa del hueco, conserva su objetivo; si no, lleva el del
 * principal cuando es de su misma unidad (repeticiones o segundos), y uno por defecto cuando no.
 */
export function cambiar_alternativas(
  cliente: Cliente,
  rutina_id: number,
  slot_id: number,
  alternativas: (number | Record<string, unknown>)[],
): RespuestaDeTest {
  const huecos: any[] = cliente.get(`/rutinas/${rutina_id}`).json().slots
  const hueco = huecos.find((h) => h.id === slot_id)
  afirmar(hueco !== undefined, `El hueco ${slot_id} no está en la rutina ${rutina_id}.`)
  const actuales = new Map<number, Record<string, number | null>>(
    hueco.alternativas.map((a: any) => [a.ejercicio.id, objetivo_de(a)]),
  )
  const principal_en_segundos = hueco.duracion_min_s !== null

  const cuerpo_de = (elegida: number | Record<string, unknown>) => {
    if (typeof elegida !== 'number') return elegida
    const suyo = actuales.get(elegida)
    if (suyo !== undefined) return { ejercicio_id: elegida, ...suyo }
    const en_segundos = es_de_tiempo(cliente, elegida)
    if (en_segundos === principal_en_segundos) {
      return { ejercicio_id: elegida, ...objetivo_de(hueco) }
    }
    return alternativa(elegida, 3, en_segundos ? { duracion: DURACION_POR_DEFECTO } : [6, 10])
  }

  return cliente.put(`/rutinas/${rutina_id}/slots/${slot_id}`, {
    json: {
      ejercicio_principal_id: hueco.ejercicio_principal.id,
      orden: hueco.orden,
      ...objetivo_de(hueco),
      alternativas: alternativas.map(cuerpo_de),
    },
  })
}

/**
 * Deja en el hueco justo esas alternativas, en ese orden (`cambiar_alternativas`). Falla si
 * la API no da 200; devuelve el hueco.
 */
export function poner_alternativas(
  cliente: Cliente,
  rutina_id: number,
  slot_id: number,
  alternativas: (number | Record<string, unknown>)[],
): any {
  const respuesta = cambiar_alternativas(cliente, rutina_id, slot_id, alternativas)
  esperar_estado(respuesta, 200)
  return respuesta.json()
}

/** Los ids de ejercicio de las alternativas de un hueco de la API, en su orden. */
export function ids_de_alternativas(hueco: any): number[] {
  return hueco.alternativas.map((a: any) => a.ejercicio.id)
}

/** Oculta el hueco (`?modo=ocultar`); falla si la API no da 204. */
export function ocultar_hueco(cliente: Cliente, rutina_id: number, slot_id: number): void {
  esperar_estado(cliente.delete(`/rutinas/${rutina_id}/slots/${slot_id}?modo=ocultar`), 204)
}

/** Oculta el ejercicio (`?modo=ocultar`); falla si la API no da 204. */
export function ocultar_ejercicio(cliente: Cliente, ejercicio_id: number): void {
  esperar_estado(cliente.delete(`/ejercicios/${ejercicio_id}?modo=ocultar`), 204)
}

// --- Programas -------------------------------------------------------------

/**
 * Un programa nuevo con esos días, cada uno `[dia_semana, rutina_id]`; activo desde hoy si se
 * pide. Devuelve el programa de la API. Todo va por nombre en el objeto final, también el
 * nombre (Python lo pasa de las dos formas): `crear_programa(cliente, { nombre, dias })`.
 */
export function crear_programa(
  cliente: Cliente,
  {
    nombre = 'Push Pull Leg',
    dias = [],
    activar = false,
  }: { nombre?: string; dias?: [number, number][]; activar?: boolean } = {},
): any {
  const respuesta = cliente.post('/programas', {
    json: {
      nombre,
      activar,
      dias: dias.map(([dia, rutina]) => ({ dia_semana: dia, rutina_id: rutina })),
    },
  })
  esperar_estado(respuesta, 201)
  return respuesta.json()
}

/**
 * El *Guardar* de la semana, como lo manda la web: `PUT /programas/{id}` con el nombre y la
 * semana entera, que es la de ahora con los `cambios` (de día a rutina; `null`, descanso).
 * Devuelve la respuesta entera, para mirar el código.
 */
export function cambiar_dias(
  cliente: Cliente,
  programa_id: number,
  cambios: Record<number, number | null>,
  nombre?: string,
): RespuestaDeTest {
  const leido = cliente.get(`/programas/${programa_id}`)
  esperar_estado(leido, 200)
  const programa = leido.json()
  const dias = new Map<number, number | null>(
    programa.dias.map((dia: any) => [dia.dia_semana, dia.rutina.id]),
  )
  for (const [dia, rutina] of Object.entries(cambios)) dias.set(Number(dia), rutina)
  return cliente.put(`/programas/${programa_id}`, {
    json: {
      nombre: nombre === undefined ? programa.nombre : nombre,
      dias: [...dias.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, rutina]) => rutina !== null)
        .map(([dia, rutina]) => ({ dia_semana: dia, rutina_id: rutina })),
    },
  })
}

/**
 * Sustituye los datos por un archivo con estas rutinas y programas (sin huecos ni días), cada
 * uno un nombre o un `[nombre, oculto_desde en ISO]`. Es la única forma de tener dos con el
 * mismo nombre: la API no deja crearlos, importar no lo mira.
 *
 * Devuelve los ids nuevos de cada lista, en el orden del archivo: se insertan en ese orden,
 * así que es el de sus ids.
 */
export function importar_rutinas_y_programas(
  cliente: Cliente,
  rutinas: (string | [string, string | null])[] = [],
  programas: (string | [string, string | null])[] = [],
): [number[], number[]] {
  const marca = { created_at: '2026-09-01T10:00:00+00:00', updated_at: '2026-09-01T10:00:00+00:00' }
  const filas = (lista: (string | [string, string | null])[]): [string, string | null][] =>
    lista.map((x) => (Array.isArray(x) ? x : [x, null]))

  const archivo = {
    formato: 'training-life',
    version: 3,
    exportado_en: marca.created_at,
    rutinas: filas(rutinas).map(([nombre, oculto], n) => ({
      id: n + 1,
      nombre,
      oculto_desde: oculto,
      ...marca,
    })),
    programas: filas(programas).map(([nombre, oculto]) => ({
      nombre,
      oculto_desde: oculto,
      ...marca,
    })),
  }
  esperar_estado(cliente.post('/datos/importar', { json: archivo }), 200)

  const ids = (ruta: string, parametro: string): number[] => {
    const todos: any[] = [
      ...cliente.get(ruta).json(),
      ...cliente.get(ruta, { params: { [parametro]: true } }).json(),
    ]
    return todos.map((x) => x.id).sort((a, b) => a - b)
  }
  return [ids('/rutinas', 'ocultas'), ids('/programas', 'ocultos')]
}

// --- El plan: días cambiados a mano ---------------------------------------

/**
 * PUT de la excepción de ese día (`rutina_id` nulo: descanso); devuelve la respuesta entera,
 * para mirar el código. Para montar datos, `dejar_planificado`.
 */
export function planificar(
  cliente: Cliente,
  fecha: string,
  rutina_id: number | null,
): RespuestaDeTest {
  return cliente.put(`/plan/excepciones/${fecha}`, { json: { rutina_id } })
}

/** Como `planificar`, pero falla si la API no da 200. */
export function dejar_planificado(cliente: Cliente, fecha: string, rutina_id: number | null): void {
  esperar_estado(planificar(cliente, fecha, rutina_id), 200)
}

// --- Lo que se busca o se crea a demanda ------------------------------------

/** El id de la rutina con ese nombre; la crea si todavía no existe. */
export function rutina_de_prueba(cliente: Cliente, nombre = NOMBRE_DE_PRUEBA): number {
  const rutinas: any[] = cliente.get('/rutinas').json()
  const existente = rutinas.find((rutina) => rutina.nombre === nombre)
  if (existente !== undefined) return existente.id
  const respuesta = cliente.post('/rutinas', { json: { nombre } })
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

/** El id del ejercicio propio con ese nombre; lo crea si todavía no existe. */
export function ejercicio_de_prueba(
  cliente: Cliente,
  grupo_muscular_id: number,
  nombre: string,
): number {
  const ejercicios: any[] = cliente.get('/ejercicios').json()
  const existente = ejercicios.find((e) => e.nombre === nombre && !e.es_predefinido)
  if (existente !== undefined) return existente.id
  const respuesta = cliente.post('/ejercicios', { json: { nombre, grupo_muscular_id } })
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

/**
 * POST /entrenamientos de la rutina que se diga o, sin ella, de la rutina de prueba (no hay
 * forma de mandar `rutina_id` nulo con esta función: para eso, el POST a mano). Devuelve la
 * respuesta entera, para mirar el código. Lo demás (`slot_id`, `series`…) va en `campos`.
 */
export function entrenar(
  cliente: Cliente,
  fecha: string,
  rutina_id?: number | null,
  campos: Record<string, unknown> = {},
): RespuestaDeTest {
  const cuerpo = {
    rutina_id:
      rutina_id !== undefined && rutina_id !== null ? rutina_id : rutina_de_prueba(cliente),
    fecha,
    ...campos,
  }
  return cliente.post('/entrenamientos', { json: cuerpo })
}

/**
 * El hueco visible de la rutina cuyo ejercicio principal es ese; lo añade si no hay ninguno.
 *
 * Si el único que hay está oculto, falla en vez de elegirlo (la serie daría un 404 que
 * parecería del test) o de añadir otro a escondidas: ese test tiene que decir el hueco que
 * quiere.
 */
export function hueco_para(cliente: Cliente, rutina_id: number, ejercicio_id: number): number {
  const huecos: any[] = cliente.get(`/rutinas/${rutina_id}`).json().slots
  const del_ejercicio = huecos.filter((h) => h.ejercicio_principal.id === ejercicio_id)
  for (const hueco of del_ejercicio) {
    if (hueco.oculto_desde === null) return hueco.id
  }
  afirmar(
    del_ejercicio.length === 0,
    `El hueco del ejercicio ${ejercicio_id} en la rutina ${rutina_id} está oculto, así que ` +
      'pasa el slot_id explícito.',
  )
  const duracion = es_de_tiempo(cliente, ejercicio_id) ? DURACION_POR_DEFECTO : undefined
  const respuesta = cliente.post(`/rutinas/${rutina_id}/slots`, {
    json: {
      ejercicio_principal_id: ejercicio_id,
      orden: Math.max(0, ...huecos.map((h) => h.orden)) + 1,
      ...objetivo(3, duracion === undefined ? [6, 12] : { duracion }),
    },
  })
  esperar_estado(respuesta, 201)
  return respuesta.json().id
}

/**
 * El cuerpo de una serie en el hueco de la rutina de esa sesión. `numero`, `peso` y
 * `repeticiones` van en `campos` (por defecto 1, 60 y 8), igual que cualquier otro campo.
 *
 * Con `slot_id` en `campos` se usa ese tal cual y no se busca ni se crea nada: así se puede
 * apuntar a un hueco de comodín, de otra rutina u oculto sin que la rutina gane un hueco por
 * el camino.
 */
export function cuerpo_de_serie(
  cliente: Cliente,
  entrenamiento_id: number,
  ejercicio_id: number,
  campos: Record<string, unknown> = {},
): Record<string, unknown> {
  const { numero = 1, peso = 60, repeticiones = 8, ...resto } = campos
  if (!('slot_id' in resto)) {
    const rutina_id = cliente.get(`/entrenamientos/${entrenamiento_id}`).json().rutina_id
    resto.slot_id = hueco_para(cliente, rutina_id, ejercicio_id)
  }
  return { ejercicio_id, numero_serie: numero, peso, repeticiones, ...resto }
}

/** POST de una serie en esa sesión; devuelve la respuesta entera. */
export function serie_en(
  cliente: Cliente,
  entrenamiento_id: number,
  ejercicio_id: number,
  campos: Record<string, unknown> = {},
): RespuestaDeTest {
  const cuerpo = cuerpo_de_serie(cliente, entrenamiento_id, ejercicio_id, campos)
  return cliente.post(`/entrenamientos/${entrenamiento_id}/series`, { json: cuerpo })
}

/**
 * Las sesiones del listado que dicen estar en curso (de hoy y sin terminar).
 *
 * El listado tuvo un filtro `?en_curso=true` que se quitó: FastAPI ignora un parámetro
 * desconocido, así que pedirlo devolvería todas sin dar error. Por eso se filtra aquí, por
 * el campo `en_curso` de cada una.
 */
export function sesiones_en_curso(cliente: Cliente): any[] {
  const respuesta = cliente.get('/entrenamientos')
  esperar_estado(respuesta, 200)
  return respuesta.json().filter((sesion: any) => sesion.en_curso)
}

// --- Lo mismo, directamente en la base ------------------------------------
// Para montar lo que la API no deja crear (por ejemplo, dos sesiones el mismo día).

/** Una rutina creada directamente en la base. */
export function rutina_en_bd(bd: Bd, nombre = NOMBRE_DE_PRUEBA): number {
  return filaRutina(bd, { nombre })
}

/**
 * Cuántas filas tiene cada tabla, también las ocultas: para ver que un fallo no ha dejado
 * nada a medias. `const [series, sesiones] = cuantas_filas(bd, 'series', 'entrenamientos')`.
 */
export function cuantas_filas(bd: Bd, ...tablas: string[]): number[] {
  return tablas.map((tabla) => contar(bd, tabla))
}

// --- Lo que deja la siembra -----------------------------------------------

/**
 * `shared/predefinidos.json`: los grupos y los ejercicios predefinidos que deja la siembra.
 * Para contar los predefinidos sin fijar el número en cada test.
 */
export function lista_de_predefinidos(): ReturnType<typeof predefinidos> {
  return predefinidos()
}
