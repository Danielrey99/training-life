/**
 * Exportar, importar y borrar todos los datos. Puerto de `backend/app/datos.py` y
 * `backend/app/routers/datos.py`.
 *
 * Importar **sustituye todo**: se borra lo que hay y se carga lo del archivo, en una sola
 * transacción. Los ids del archivo solo enlazan cosas dentro de él: al importar se asignan
 * otros. Los predefinidos y los grupos van por nombre, porque los siembra la app y su id
 * cambia de una instalación a otra.
 */
import type { Contexto } from '../contexto'
import { noValido, type ErrorDeValidacion } from '../fallos'
import { aCentesimas } from '../reglas/centesimas'
import { nombreDelDia } from '../reglas/fechas'
import { validarMedidas, validarObjetivo, type TipoRegistro } from '../reglas/medidas'
import { hoyEn, zonaValida } from '../reglas/zonas'
import type { ComprobacionDeImportar, ResumenDeDatos } from '../tipos'
import { Validador } from '../validacion/base'
import { archivoDeDatos, type ArchivoDeDatos } from '../validacion/datos'
import { enTexto } from './plan'
import {
  agrupar,
  objetivoDe,
  pesoOut,
  valoresDelObjetivo,
  CAMPOS_DEL_OBJETIVO,
  type FilaAlternativa,
  type FilaEjercicio,
  type FilaRutina,
  type FilaSerie,
  type FilaSlot,
} from './salidas'
import { plazo, type FilaEntrenamiento } from './seguimiento'

/** Más no ayudan a arreglar nada y alargan la respuesta. */
export const MAXIMO_DE_ERRORES = 20

export const NO_ES_UNA_COPIA = 'Este archivo no es una copia de los datos de Training Life.'

function noSePuede(mensaje: string, errores?: string[]) {
  return noValido(errores && errores.length > 0 ? { mensaje, errores } : { mensaje })
}

// --- Exportar ------------------------------------------------------------------------------

/**
 * Todo lo que hay, cada lista por id. De los ejercicios, solo los propios y los predefinidos
 * que usa algo: los demás vienen con la app.
 */
export function exportar(ctx: Contexto): ArchivoDeDatos {
  const { bd } = ctx
  const todas = <T>(tabla: string, where = '') =>
    bd.todas<T>(`SELECT * FROM ${tabla}${where} ORDER BY id`)
  const ejercicios = todas<FilaEjercicio>('ejercicios', ' WHERE es_predefinido = 0')
  const notas = todas<{
    id: number
    ejercicio_id: number
    nota: string
    created_at: string
    updated_at: string
  }>('notas_ejercicio')
  const rutinas = todas<FilaRutina>('rutinas')
  const tramos = todas<{ rutina_id: number; desde: string; hasta: string }>(
    'rutina_periodos_ocultos',
  )
  const huecos = todas<FilaSlot>('rutina_slots')
  const alternativas = todas<FilaAlternativa>('slot_alternativas')
  const programas = todas<{
    id: number
    nombre: string
    oculto_desde: string | null
    created_at: string
    updated_at: string
  }>('programas')
  const dias = todas<{
    programa_id: number
    dia_semana: number
    rutina_id: number
    desde: string | null
    hasta: string | null
  }>('programa_dias')
  const periodos = todas<{ programa_id: number; desde: string; hasta: string | null }>(
    'programa_periodos',
  )
  const excepciones = todas<{
    fecha: string
    rutina_id: number | null
    created_at: string
    updated_at: string
  }>('excepciones_del_plan')
  const sesiones = todas<FilaEntrenamiento>('entrenamientos')
  const series = todas<FilaSerie>('series')
  const grupos = new Map(
    bd
      .todas<{ id: number; nombre: string }>('SELECT id, nombre FROM grupos_musculares')
      .map((g) => [g.id, g.nombre] as [number, string]),
  )

  // Solo los predefinidos que usa algo.
  const usados = new Set([
    ...huecos.map((h) => h.ejercicio_principal_id),
    ...alternativas.map((a) => a.ejercicio_id),
    ...series.map((s) => s.ejercicio_id),
    ...notas.map((n) => n.ejercicio_id),
  ])
  const predefinidos = todas<FilaEjercicio>('ejercicios', ' WHERE es_predefinido = 1').filter((e) =>
    usados.has(e.id),
  )

  const tramosDe = agrupar(tramos, (t) => t.rutina_id)
  const alternativasDe = agrupar(alternativas, (a) => a.slot_id)
  const huecosDe = agrupar(huecos, (h) => h.rutina_id)
  const diasDe = agrupar(dias, (d) => d.programa_id)
  const periodosDe = agrupar(periodos, (p) => p.programa_id)
  const seriesDe = agrupar(series, (s) => s.entrenamiento_id)

  return {
    formato: 'training-life',
    version: 3,
    exportado_en: ctx.reloj.ahora(),
    zona_horaria: ctx.zona(),
    predefinidos: predefinidos.map((e) => ({ id: e.id, nombre: e.nombre })),
    ejercicios: ejercicios.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      grupo_muscular: grupos.get(e.grupo_muscular_id)!,
      tipo_registro: e.tipo_registro,
      descripcion: e.descripcion,
      oculto_desde: e.oculto_desde,
      created_at: e.created_at,
      updated_at: e.updated_at,
    })),
    notas: notas.map((n) => ({
      ejercicio_id: n.ejercicio_id,
      nota: n.nota,
      created_at: n.created_at,
      updated_at: n.updated_at,
    })),
    rutinas: rutinas.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      oculto_desde: r.oculto_desde,
      created_at: r.created_at,
      updated_at: r.updated_at,
      slots: (huecosDe.get(r.id) ?? []).map((h) => ({
        ...objetivoDe(h),
        ejercicio_principal_id: h.ejercicio_principal_id,
        id: h.id,
        orden: h.orden,
        alternativas: (alternativasDe.get(h.id) ?? []).map((a) => ({
          ...objetivoDe(a),
          ejercicio_id: a.ejercicio_id,
        })),
        oculto_desde: h.oculto_desde,
        created_at: h.created_at,
        updated_at: h.updated_at,
      })),
      periodos_ocultos: (tramosDe.get(r.id) ?? []).map((t) => ({ desde: t.desde, hasta: t.hasta })),
    })),
    programas: programas.map((p) => ({
      nombre: p.nombre,
      oculto_desde: p.oculto_desde,
      created_at: p.created_at,
      updated_at: p.updated_at,
      dias: (diasDe.get(p.id) ?? []).map((d) => ({
        dia_semana: d.dia_semana,
        rutina_id: d.rutina_id,
        desde: d.desde,
        hasta: d.hasta,
      })),
      periodos: (periodosDe.get(p.id) ?? []).map((x) => ({ desde: x.desde, hasta: x.hasta })),
    })),
    excepciones: excepciones.map((x) => ({
      fecha: x.fecha,
      rutina_id: x.rutina_id,
      created_at: x.created_at,
      updated_at: x.updated_at,
    })),
    entrenamientos: sesiones.map((s) => ({
      rutina_id: s.rutina_id,
      fecha: s.fecha,
      cubre_fecha: s.cubre_fecha,
      notas: s.notas,
      terminada_en: s.terminada_en,
      created_at: s.created_at,
      updated_at: s.updated_at,
      series: (seriesDe.get(s.id) ?? []).map((x) => ({
        ejercicio_id: x.ejercicio_id,
        slot_id: x.slot_id,
        numero_serie: x.numero_serie,
        peso: pesoOut(x.peso_centesimas),
        repeticiones: x.repeticiones,
        duracion_s: x.duracion_s,
        distancia_m: x.distancia_m,
        peso_corporal: pesoOut(x.peso_corporal_centesimas),
        variante: x.variante,
        created_at: x.created_at,
        updated_at: x.updated_at,
      })),
    })),
  }
}

// --- Validar -------------------------------------------------------------------------------

/** Lo que `validar` resuelve y `cargar` necesita: los ids de aquí de predefinidos y grupos. */
interface Mapas {
  predefinidos: Map<number, number>
  grupos: Map<string, number>
}

/** Los valores que salen más de una vez, en el orden en que aparecen por primera vez. */
function repetidos<T>(valores: Iterable<T>): T[] {
  const veces = new Map<T, number>()
  for (const x of valores) veces.set(x, (veces.get(x) ?? 0) + 1)
  return [...veces].filter(([, n]) => n > 1).map(([x]) => x)
}

/**
 * Todo lo que impediría cargar el archivo tal cual, de una vez y sin tocar nada: ids
 * repetidos, referencias a algo que no está en el archivo, predefinidos o grupos que no
 * existen aquí, las restricciones de la base y las fechas que la app nunca crea (del
 * futuro, o un día que cuenta una sesión fuera de su plazo). «Hoy» es el mayor entre hoy
 * aquí y hoy en la zona de quien exportó.
 */
function validar(ctx: Contexto, datos: ArchivoDeDatos): [string[], Mapas] {
  const errores: string[] = []
  const mapas: Mapas = { predefinidos: new Map(), grupos: new Map() }
  const texto = (f: string) => enTexto(ctx, f)

  // Ids repetidos.
  const idsDeEjercicio = [
    ...datos.ejercicios.map((e) => e.id),
    ...datos.predefinidos.map((p) => p.id),
  ]
  if (repetidos(idsDeEjercicio).length > 0) {
    errores.push('Hay dos ejercicios con el mismo identificador.')
  }
  // Dos ids con el mismo nombre serían el mismo ejercicio de aquí.
  for (const nombre of repetidos(datos.predefinidos.map((p) => p.nombre))) {
    errores.push(`El ejercicio predefinido «${nombre}» está dos veces en el archivo.`)
  }
  if (repetidos(datos.rutinas.map((r) => r.id)).length > 0) {
    errores.push('Hay dos rutinas con el mismo identificador.')
  }
  const huecos = datos.rutinas.flatMap((r) => r.slots.map((h) => [r, h] as const))
  if (repetidos(huecos.map(([, h]) => h.id)).length > 0) {
    errores.push('Hay dos ejercicios de una rutina con el mismo identificador.')
  }

  // Predefinidos y grupos de aquí, por nombre (si hubiera dos iguales, el más antiguo).
  const nombres = new Set(datos.predefinidos.map((p) => p.nombre))
  const existentes = new Map<string, { id: number; tipo: TipoRegistro }>()
  for (const e of ctx.bd.todas<FilaEjercicio>(
    'SELECT * FROM ejercicios WHERE es_predefinido = 1 ORDER BY id',
  )) {
    if (nombres.has(e.nombre) && !existentes.has(e.nombre)) {
      existentes.set(e.nombre, { id: e.id, tipo: e.tipo_registro })
    }
  }
  for (const p of datos.predefinidos) {
    const aqui = existentes.get(p.nombre)
    if (aqui !== undefined) mapas.predefinidos.set(p.id, aqui.id)
    else errores.push(`El ejercicio predefinido «${p.nombre}» no existe en esta versión de la app.`)
  }
  for (const g of ctx.bd.todas<{ id: number; nombre: string }>(
    'SELECT id, nombre FROM grupos_musculares',
  )) {
    mapas.grupos.set(g.nombre, g.id)
  }
  for (const e of datos.ejercicios) {
    if (!mapas.grupos.has(e.grupo_muscular)) {
      errores.push(
        `El grupo muscular «${e.grupo_muscular}» del ejercicio` +
          ` «${e.nombre}» no existe en esta versión de la app.`,
      )
    }
  }

  // Solo con los ejercicios que se han podido resolver.
  const tipoDe = new Map<number, TipoRegistro>([
    ...datos.ejercicios.map((e): [number, TipoRegistro] => [e.id, e.tipo_registro]),
    ...datos.predefinidos
      .filter((p) => existentes.has(p.nombre))
      .map((p): [number, TipoRegistro] => [p.id, existentes.get(p.nombre)!.tipo]),
  ])
  const nombreDe = new Map<number, string>([
    ...datos.ejercicios.map((e): [number, string] => [e.id, e.nombre]),
    ...datos.predefinidos.map((p): [number, string] => [p.id, p.nombre]),
  ])

  // Referencias dentro del archivo.
  const ejercicios = new Set(idsDeEjercicio)
  const rutinas = new Map(datos.rutinas.map((r) => [r.id, r]))
  const rutinaDelHueco = new Map(huecos.map(([r, h]) => [h.id, r]))
  for (const n of datos.notas) {
    if (!ejercicios.has(n.ejercicio_id)) {
      errores.push('Una nota es de un ejercicio que no está en el archivo.')
    }
  }
  for (const [r, h] of huecos) {
    const elegidos = [
      [h.ejercicio_principal_id, h] as const,
      ...h.alternativas.map((a) => [a.ejercicio_id, a] as const),
    ]
    for (const [ejercicioId, obj] of elegidos) {
      if (!ejercicios.has(ejercicioId)) {
        errores.push(`La rutina «${r.nombre}» usa un ejercicio que no está en el archivo.`)
      } else if (tipoDe.has(ejercicioId)) {
        const mal = validarObjetivo(nombreDe.get(ejercicioId)!, tipoDe.get(ejercicioId)!, obj)
        if (mal) errores.push(`La rutina «${r.nombre}» tiene un objetivo mal puesto. ${mal}`)
      }
    }
  }
  // UNIQUE(rutina_id, orden).
  for (const r of datos.rutinas) {
    for (const orden of repetidos(r.slots.map((h) => h.orden))) {
      errores.push(`La rutina «${r.nombre}» tiene dos ejercicios en la posición ${orden}.`)
    }
  }
  for (const p of datos.programas) {
    for (const d of p.dias) {
      if (!rutinas.has(d.rutina_id)) {
        errores.push(`El programa «${p.nombre}» usa una rutina que no está en el archivo.`)
      }
    }
    // Una sola fila vigente por día.
    for (const diaSemana of repetidos(
      p.dias.filter((d) => d.hasta === null).map((d) => d.dia_semana),
    )) {
      const dia = nombreDelDia(diaSemana)
      // «los lunes», pero «los sábados».
      const dias = dia.endsWith('o') ? `${dia}s` : dia
      errores.push(`El programa «${p.nombre}» tiene dos rutinas a la vez los ${dias}.`)
    }
  }
  let hoy = ctx.reloj.hoy()
  if (datos.zona_horaria !== null) {
    if (!zonaValida(datos.zona_horaria)) {
      errores.push(
        `La zona horaria del archivo («${datos.zona_horaria}») no la conoce esta` +
          ' versión de la app.',
      )
    } else {
      const alli = hoyEn(datos.zona_horaria, new Date(ctx.reloj.ahora()))
      if (alli > hoy) hoy = alli
    }
  }
  const comprueba = ' Comprueba la fecha del teléfono o del ordenador que hizo la copia.'
  for (const p of datos.programas) {
    for (const x of p.periodos) {
      if (x.desde > hoy || (x.hasta !== null && x.hasta > hoy)) {
        const empezo = x.desde > hoy
        const cuando = empezo ? 'se empezó a usar' : 'se dejó de usar'
        const fecha = empezo ? x.desde : x.hasta!
        errores.push(
          `El programa «${p.nombre}» ${cuando} el ${texto(fecha)}, un día` +
            ` que todavía no ha llegado.${comprueba}`,
        )
      }
    }
  }
  const ocultos: [string, string | null][] = [
    ...datos.ejercicios.map((e): [string, string | null] => [
      `El ejercicio «${e.nombre}»`,
      e.oculto_desde,
    ]),
    ...datos.rutinas.map((r): [string, string | null] => [
      `La rutina «${r.nombre}»`,
      r.oculto_desde,
    ]),
    ...huecos.map(([r, h]): [string, string | null] => [
      `El ejercicio «${nombreDe.get(h.ejercicio_principal_id) ?? ''}» de la rutina «${r.nombre}»`,
      h.oculto_desde,
    ]),
    ...datos.programas.map((p): [string, string | null] => [
      `El programa «${p.nombre}»`,
      p.oculto_desde,
    ]),
  ]
  for (const r of datos.rutinas) {
    for (const t of r.periodos_ocultos) {
      if (t.hasta > hoy) {
        errores.push(
          `La rutina «${r.nombre}» se volvió a mostrar el` +
            ` ${texto(t.hasta)}, un día que todavía no ha llegado.${comprueba}`,
        )
      }
    }
  }
  for (const [quien, desde] of ocultos) {
    if (desde !== null && desde > hoy) {
      errores.push(
        `${quien} se ocultó el ${texto(desde)}, un día que todavía no ha llegado.${comprueba}`,
      )
    }
  }
  const abiertos = datos.programas.flatMap((p) => p.periodos.filter((x) => x.hasta === null))
  if (abiertos.length > 1) errores.push('Hay más de un programa activo a la vez.')
  for (const x of datos.excepciones) {
    if (x.rutina_id !== null && !rutinas.has(x.rutina_id)) {
      errores.push(`El ${texto(x.fecha)} tiene una rutina que no está en el archivo.`)
    }
  }
  for (const fecha of repetidos(datos.excepciones.map((x) => x.fecha))) {
    errores.push(`El ${texto(fecha)} está planificado dos veces.`)
  }

  for (const s of datos.entrenamientos) {
    const rutina = rutinas.get(s.rutina_id)
    const delDia = texto(s.fecha)
    if (rutina === undefined) {
      errores.push(`La sesión del ${delDia} es de una rutina que no está en el archivo.`)
    }
    if (s.fecha > hoy) {
      errores.push(`La sesión del ${delDia} es de un día que todavía no ha llegado.${comprueba}`)
    }
    if (s.cubre_fecha !== null) {
      const [primero, ultimo] = plazo(s.cubre_fecha)
      if (!(primero <= s.fecha && s.fecha <= ultimo)) {
        errores.push(
          `La sesión del ${delDia} cuenta como la del` +
            ` ${texto(s.cubre_fecha)}, fuera de su plazo, que va del` +
            ` ${texto(primero)} al ${texto(ultimo)}.`,
        )
      }
    }
    for (const x of s.series) {
      if (tipoDe.has(x.ejercicio_id)) {
        const mal = validarMedidas(nombreDe.get(x.ejercicio_id)!, tipoDe.get(x.ejercicio_id)!, x)
        if (mal) errores.push(`La sesión del ${delDia} tiene una serie mal apuntada. ${mal}`)
      }
      if (!ejercicios.has(x.ejercicio_id)) {
        errores.push(
          `La sesión del ${delDia} tiene una serie de un ejercicio que no está` + ' en el archivo.',
        )
      }
      // Toda serie va en un hueco de la rutina de su sesión.
      if (rutina !== undefined && rutinaDelHueco.get(x.slot_id) !== rutina) {
        errores.push(
          `La sesión del ${delDia} tiene una serie fuera de los ejercicios de` +
            ` «${rutina.nombre}».`,
        )
      }
    }
    // En una sesión, cada hueco se hace con un solo ejercicio.
    const ejerciciosDeHueco = new Map<number, Set<number>>()
    for (const x of s.series) {
      const del = ejerciciosDeHueco.get(x.slot_id) ?? new Set<number>()
      del.add(x.ejercicio_id)
      ejerciciosDeHueco.set(x.slot_id, del)
    }
    for (const ids of ejerciciosDeHueco.values()) {
      if (ids.size > 1) {
        const partes = [...ids].map((id) => `de «${nombreDe.get(id) ?? id}»`)
        const cuales = `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
        const donde = rutina !== undefined ? ` de «${rutina.nombre}»` : ''
        errores.push(
          `La sesión del ${delDia} tiene series ${cuales} en el mismo ejercicio` +
            `${donde}. En una sesión, cada uno se hace con un solo ejercicio.`,
        )
      }
    }
  }
  for (const fecha of repetidos(datos.entrenamientos.map((s) => s.fecha))) {
    errores.push(`Hay dos sesiones el ${texto(fecha)}.`)
  }
  for (const fecha of repetidos(
    datos.entrenamientos.map((s) => s.cubre_fecha).filter((f): f is string => f !== null),
  )) {
    errores.push(`Hay dos sesiones que cuentan como la del ${texto(fecha)}.`)
  }

  // Sin repetir un mismo error (una sesión con varias series malas).
  return [[...new Set(errores)].slice(0, MAXIMO_DE_ERRORES), mapas]
}

// --- Resumir -------------------------------------------------------------------------------

function resumirArchivo(datos: ArchivoDeDatos): ResumenDeDatos {
  const conSeries = datos.entrenamientos.filter((s) => s.series.length > 0)
  const fechas = conSeries.map((s) => s.fecha).sort()
  return {
    ejercicios: datos.ejercicios.length,
    notas: datos.notas.length,
    rutinas: datos.rutinas.length,
    programas: datos.programas.length,
    sesiones: conSeries.length,
    series: datos.entrenamientos.reduce((n, s) => n + s.series.length, 0),
    primera_sesion: fechas[0] ?? null,
    ultima_sesion: fechas[fechas.length - 1] ?? null,
  }
}

/** Cuánto hay ahora: las mismas cifras para exportar, borrar e importar. */
export function resumirActual(ctx: Contexto): ResumenDeDatos {
  const contar = (sql: string) => ctx.bd.una<{ n: number }>(`SELECT COUNT(*) AS n FROM ${sql}`)!.n
  const sesiones = ctx.bd.una<{ n: number; primera: string | null; ultima: string | null }>(
    'SELECT COUNT(DISTINCT e.id) AS n, MIN(e.fecha) AS primera, MAX(e.fecha) AS ultima' +
      ' FROM entrenamientos e JOIN series s ON s.entrenamiento_id = e.id',
  )!
  return {
    // Solo los propios: los predefinidos vienen con la app y no se pierden al importar.
    ejercicios: contar('ejercicios WHERE es_predefinido = 0'),
    notas: contar('notas_ejercicio'),
    rutinas: contar('rutinas'),
    programas: contar('programas'),
    sesiones: sesiones.n,
    series: contar('series'),
    primera_sesion: sesiones.primera,
    ultima_sesion: sesiones.ultima,
  }
}

// --- Borrar e importar ---------------------------------------------------------------------

/**
 * Borra todo menos los ejercicios predefinidos, en el orden que piden las claves ajenas: lo
 * que es RESTRICT hacia algo, antes que ese algo. Lo que es CASCADE se va solo (días y
 * periodos con su programa, series con su sesión, comodines con su hueco, tramos ocultos con
 * su rutina). La usan importar y borrar todo.
 */
export function borrarTodo(ctx: Contexto): void {
  const { bd } = ctx
  bd.ejecutar('DELETE FROM excepciones_del_plan')
  bd.ejecutar('DELETE FROM programas')
  bd.ejecutar('DELETE FROM entrenamientos')
  // También las notas de predefinidos, que no se irían con ningún ejercicio.
  bd.ejecutar('DELETE FROM notas_ejercicio')
  bd.ejecutar('DELETE FROM rutina_slots')
  bd.ejecutar('DELETE FROM rutinas')
  // ⚠️ Solo los propios: sin esta condición se borrarían también los predefinidos.
  bd.ejecutar('DELETE FROM ejercicios WHERE es_predefinido = 0')
}

/**
 * Inserta el archivo, nivel a nivel y en su orden, con ids nuevos. Las fechas de creación y
 * de cambio se conservan tal cual: la copia es idéntica a lo exportado.
 */
function cargar(ctx: Contexto, datos: ArchivoDeDatos, mapas: Mapas): void {
  const { bd } = ctx
  const ejercicioNuevo = new Map(mapas.predefinidos)
  for (const e of datos.ejercicios) {
    const { ultimoId } = bd.ejecutar(
      'INSERT INTO ejercicios (nombre, grupo_muscular_id, descripcion, tipo_registro,' +
        ' es_predefinido, oculto_desde, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
      e.nombre,
      mapas.grupos.get(e.grupo_muscular)!,
      e.descripcion,
      e.tipo_registro,
      e.oculto_desde,
      e.created_at,
      e.updated_at,
    )
    ejercicioNuevo.set(e.id, ultimoId)
  }
  for (const n of datos.notas) {
    bd.ejecutar(
      'INSERT INTO notas_ejercicio (ejercicio_id, nota, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ejercicioNuevo.get(n.ejercicio_id)!,
      n.nota,
      n.created_at,
      n.updated_at,
    )
  }

  const rutinaNueva = new Map<number, number>()
  for (const r of datos.rutinas) {
    const { ultimoId } = bd.ejecutar(
      'INSERT INTO rutinas (nombre, oculto_desde, created_at, updated_at) VALUES (?, ?, ?, ?)',
      r.nombre,
      r.oculto_desde,
      r.created_at,
      r.updated_at,
    )
    rutinaNueva.set(r.id, ultimoId)
  }
  for (const r of datos.rutinas) {
    for (const t of r.periodos_ocultos) {
      bd.ejecutar(
        'INSERT INTO rutina_periodos_ocultos (rutina_id, desde, hasta) VALUES (?, ?, ?)',
        rutinaNueva.get(r.id)!,
        t.desde,
        t.hasta,
      )
    }
  }

  // Todos los huecos antes que sus alternativas, como el backend: así los ids de las
  // alternativas quedan en el mismo orden relativo.
  const huecoNuevo = new Map<number, number>()
  const columnas = CAMPOS_DEL_OBJETIVO.join(', ')
  for (const r of datos.rutinas) {
    for (const h of r.slots) {
      const { ultimoId } = bd.ejecutar(
        `INSERT INTO rutina_slots (rutina_id, ejercicio_principal_id, orden, ${columnas},` +
          ' oculto_desde, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        rutinaNueva.get(r.id)!,
        ejercicioNuevo.get(h.ejercicio_principal_id)!,
        h.orden,
        ...valoresDelObjetivo(h),
        h.oculto_desde,
        h.created_at,
        h.updated_at,
      )
      huecoNuevo.set(h.id, ultimoId)
    }
  }
  for (const r of datos.rutinas) {
    for (const h of r.slots) {
      for (const a of h.alternativas) {
        bd.ejecutar(
          `INSERT INTO slot_alternativas (slot_id, ejercicio_id, ${columnas})` +
            ' VALUES (?, ?, ?, ?, ?, ?, ?)',
          huecoNuevo.get(h.id)!,
          ejercicioNuevo.get(a.ejercicio_id)!,
          ...valoresDelObjetivo(a),
        )
      }
    }
  }

  const programaNuevo: number[] = []
  for (const p of datos.programas) {
    programaNuevo.push(
      bd.ejecutar(
        'INSERT INTO programas (nombre, oculto_desde, created_at, updated_at) VALUES (?, ?, ?, ?)',
        p.nombre,
        p.oculto_desde,
        p.created_at,
        p.updated_at,
      ).ultimoId,
    )
  }
  datos.programas.forEach((p, i) => {
    for (const d of p.dias) {
      bd.ejecutar(
        'INSERT INTO programa_dias (programa_id, dia_semana, rutina_id, desde, hasta)' +
          ' VALUES (?, ?, ?, ?, ?)',
        programaNuevo[i],
        d.dia_semana,
        rutinaNueva.get(d.rutina_id)!,
        d.desde,
        d.hasta,
      )
    }
    for (const x of p.periodos) {
      bd.ejecutar(
        'INSERT INTO programa_periodos (programa_id, desde, hasta) VALUES (?, ?, ?)',
        programaNuevo[i],
        x.desde,
        x.hasta,
      )
    }
  })

  for (const x of datos.excepciones) {
    bd.ejecutar(
      'INSERT INTO excepciones_del_plan (fecha, rutina_id, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?)',
      x.fecha,
      x.rutina_id === null ? null : rutinaNueva.get(x.rutina_id)!,
      x.created_at,
      x.updated_at,
    )
  }

  const sesionNueva: number[] = []
  for (const s of datos.entrenamientos) {
    sesionNueva.push(
      bd.ejecutar(
        'INSERT INTO entrenamientos (rutina_id, fecha, cubre_fecha, notas, terminada_en,' +
          ' created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        rutinaNueva.get(s.rutina_id)!,
        s.fecha,
        s.cubre_fecha,
        s.notas,
        s.terminada_en,
        s.created_at,
        s.updated_at,
      ).ultimoId,
    )
  }
  datos.entrenamientos.forEach((s, i) => {
    for (const x of s.series) {
      bd.ejecutar(
        'INSERT INTO series (entrenamiento_id, slot_id, ejercicio_id, numero_serie,' +
          ' peso_centesimas, repeticiones, duracion_s, distancia_m, peso_corporal_centesimas,' +
          ' variante, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        sesionNueva[i],
        huecoNuevo.get(x.slot_id)!,
        ejercicioNuevo.get(x.ejercicio_id)!,
        x.numero_serie,
        x.peso === null ? null : aCentesimas(x.peso),
        x.repeticiones,
        x.duracion_s,
        x.distancia_m,
        x.peso_corporal === null ? null : aCentesimas(x.peso_corporal),
        x.variante,
        x.created_at,
        x.updated_at,
      )
    }
  })
}

// --- Endpoints -----------------------------------------------------------------------------

/** El error de un campo del archivo como lo escribe el backend: «ruta.del.campo: mensaje». */
function errorDeCampo(error: ErrorDeValidacion): string {
  return `${error.loc.map(String).join('.')}: ${error.msg}`
}

/**
 * **Sustituye todos tus datos** por los del archivo, en una sola transacción: si algo no
 * vale, no se toca nada y el 422 dice qué. Con `comprobar`, no cambia nada: dice qué hay en
 * el archivo y qué hay ahora.
 */
export function importarDatos(
  ctx: Contexto,
  archivo: unknown,
  comprobar: boolean,
): ComprobacionDeImportar | ResumenDeDatos {
  if (
    typeof archivo !== 'object' ||
    archivo === null ||
    Array.isArray(archivo) ||
    (archivo as Record<string, unknown>).formato !== 'training-life'
  ) {
    throw noSePuede(NO_ES_UNA_COPIA)
  }
  const crudo = archivo as Record<string, unknown>
  // En JS un 3.0 del JSON ya es 3: no se distingue de un entero, como sí hace Python.
  const version =
    typeof crudo.version === 'number' && Number.isInteger(crudo.version) ? crudo.version : null
  if (version !== null && version > 3) {
    throw noSePuede(
      'Este archivo es de una versión más nueva de la app. Actualízala para cargarlo.',
    )
  }
  if (version === 1) {
    // Sin tipos de ejercicio: no se convierte, la app todavía no se usaba.
    throw noSePuede('Este archivo es de una versión anterior de la app y ya no se puede cargar.')
  }
  if (version !== 2 && version !== 3) throw noSePuede(NO_ES_UNA_COPIA)

  const v = new Validador()
  const datos = archivoDeDatos(v, crudo)
  if (v.errores.length > 0) {
    throw noSePuede(
      'El archivo está dañado.',
      v.errores.map(errorDeCampo).slice(0, MAXIMO_DE_ERRORES),
    )
  }

  const [errores, mapas] = validar(ctx, datos)
  if (errores.length > 0) {
    throw noSePuede('No se puede cargar el archivo, así que no se ha cambiado nada.', errores)
  }

  if (comprobar) {
    return {
      exportado_en: datos.exportado_en,
      archivo: resumirArchivo(datos),
      actual: resumirActual(ctx),
    }
  }
  borrarTodo(ctx)
  cargar(ctx, datos, mapas)
  return resumirActual(ctx)
}
