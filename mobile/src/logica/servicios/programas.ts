/**
 * Los programas: sus días, sus periodos de uso y qué programa está activo. Puerto de
 * `backend/app/routers/programas.py`: mismas comprobaciones, en el mismo orden y con los
 * mismos textos.
 *
 * Un periodo cubre de `desde` a `hasta` sin incluir `hasta`: al cambiar de programa, el que
 * se va cierra con `hasta` = hoy y el que llega abre con `desde` = hoy.
 */
import type { Contexto } from '../contexto'
import { conflicto, noEncontrado } from '../fallos'
import { diaDeLaSemana, sumarDias } from '../reglas/dias'
import { diasQueCambian } from '../reglas/ediciones'
import { claveDeNombre } from '../reglas/nombres'
import { ordenarPorNombre } from '../reglas/orden'
import type { Programa } from '../tipos'
import type { CambiosDePrograma, ProgramaNuevo } from '../validacion/programas'
import { exigirVisible } from './comun'
import type { ModoBorrado } from './ejercicios'
import { obtenerRutinaVisible } from './rutinas'
import { agrupar, marcas, porIds, rutinaMinima, type FilaRutina } from './salidas'
import { seguimiento } from './seguimiento'

interface FilaPrograma {
  id: number
  nombre: string
  oculto_desde: string | null
  created_at: string
  updated_at: string
}

interface FilaDia {
  id: number
  programa_id: number
  dia_semana: number
  rutina_id: number
  desde: string | null
  hasta: string | null
}

interface FilaPeriodo {
  id: number
  programa_id: number
  desde: string
  hasta: string | null
}

// --- Salidas -------------------------------------------------------------------------------

/**
 * Los programas con sus días vigentes (por día de la semana), si están activos y su último
 * periodo: el abierto si lo hay; si no, el último que se cerró.
 */
function programasOut(ctx: Contexto, programas: readonly FilaPrograma[]): Programa[] {
  if (programas.length === 0) return []
  const ids = programas.map((p) => p.id)
  const dias = ctx.bd.todas<FilaDia>(
    `SELECT * FROM programa_dias WHERE programa_id IN ${marcas(ids)} AND hasta IS NULL` +
      ' ORDER BY dia_semana, id',
    ...ids,
  )
  const rutinas = porIds<FilaRutina>(
    ctx.bd,
    'rutinas',
    dias.map((d) => d.rutina_id),
  )
  const periodos = agrupar(
    ctx.bd.todas<FilaPeriodo>(
      `SELECT * FROM programa_periodos WHERE programa_id IN ${marcas(ids)}`,
      ...ids,
    ),
    (p) => p.programa_id,
  )
  const diasDe = agrupar(dias, (d) => d.programa_id)
  return programas.map((p) => {
    const suyos = periodos.get(p.id) ?? []
    // Los periodos no se solapan y como mucho uno está abierto: el de `desde` más reciente
    // es el abierto si lo hay.
    const ultimo = suyos.reduce<FilaPeriodo | null>(
      (m, x) => (m === null || x.desde > m.desde || (x.desde === m.desde && x.id > m.id) ? x : m),
      null,
    )
    return {
      id: p.id,
      nombre: p.nombre,
      oculto_desde: p.oculto_desde,
      activo: suyos.some((x) => x.hasta === null),
      ultimo_periodo: ultimo === null ? null : { desde: ultimo.desde, hasta: ultimo.hasta },
      created_at: p.created_at,
      updated_at: p.updated_at,
      dias: (diasDe.get(p.id) ?? []).map((d) => ({
        dia_semana: d.dia_semana as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        rutina: rutinaMinima(rutinas.get(d.rutina_id)!),
      })),
    }
  })
}

function programaOut(ctx: Contexto, programaId: number): Programa {
  return programasOut(ctx, [leer(ctx, programaId)!])[0]
}

function leer(ctx: Contexto, programaId: number): FilaPrograma | undefined {
  return ctx.bd.una<FilaPrograma>('SELECT * FROM programas WHERE id = ?', programaId)
}

// --- Comprobaciones ------------------------------------------------------------------------

/** Para leer: 404 si no existe. Admite los ocultos. */
function obtenerProgramaLegible(ctx: Contexto, programaId: number): FilaPrograma {
  const programa = leer(ctx, programaId)
  if (programa === undefined) {
    throw noEncontrado('Este programa ya no existe. Puede que lo hayas borrado.')
  }
  return programa
}

/** Para modificar: 404 si no existe y 409 si está oculto, salvo para borrarlo o mostrarlo. */
function obtenerProgramaModificable(
  ctx: Contexto,
  programaId: number,
  admitirOculto = false,
): FilaPrograma {
  const programa = obtenerProgramaLegible(ctx, programaId)
  if (!admitirOculto) {
    exigirVisible(programa, 'Este programa está oculto. Muéstralo antes de cambiarlo.')
  }
  return programa
}

function estaActivo(ctx: Contexto, programaId: number): boolean {
  return (
    ctx.bd.una(
      'SELECT 1 FROM programa_periodos WHERE programa_id = ? AND hasta IS NULL',
      programaId,
    ) !== undefined
  )
}

/**
 * Un programa nuevo o renombrado no puede llamarse como otro, sin distinguir mayúsculas,
 * tildes ni espacios. La base no lo impide: un archivo importado puede traer dos iguales.
 */
function validarNombreLibre(ctx: Contexto, nombre: string): void {
  const clave = claveDeNombre(nombre)
  const iguales = ctx.bd
    .todas<Pick<FilaPrograma, 'nombre' | 'oculto_desde'>>(
      'SELECT nombre, oculto_desde FROM programas ORDER BY id',
    )
    .filter((otro) => claveDeNombre(otro.nombre) === clave)
  if (iguales.length === 0) return
  // Si conviven varios, se nombra el visible, que es el que se encuentra.
  const otro = iguales.find((p) => p.oculto_desde === null) ?? iguales[0]
  const mensaje =
    otro.oculto_desde === null
      ? `Ya tienes un programa que se llama «${otro.nombre}». Elige otro nombre.`
      : `Ya tienes un programa oculto que se llama «${otro.nombre}». ` +
        'Muéstralo desde la pestaña Programas o elige otro nombre.'
  throw conflicto({ mensaje, campo: 'nombre' })
}

// --- Periodos ------------------------------------------------------------------------------

/** Borra los días cambiados a mano de hoy en adelante; los pasados se quedan. */
function quitarExcepcionesDesdeHoy(ctx: Contexto): void {
  ctx.bd.ejecutar('DELETE FROM excepciones_del_plan WHERE fecha >= ?', ctx.reloj.hoy())
}

/**
 * Deja sin programa activo. Si el periodo empezó hoy (o después, con un reloj que fue hacia
 * atrás), no llegó a cubrir ningún día: se borra en vez de cerrarse.
 */
function cerrarPeriodoAbierto(ctx: Contexto): void {
  const periodo = ctx.bd.una<FilaPeriodo>('SELECT * FROM programa_periodos WHERE hasta IS NULL')
  if (periodo === undefined) return
  const hoy = ctx.reloj.hoy()
  if (periodo.desde >= hoy) {
    ctx.bd.ejecutar('DELETE FROM programa_periodos WHERE id = ?', periodo.id)
  } else {
    ctx.bd.ejecutar('UPDATE programa_periodos SET hasta = ? WHERE id = ?', hoy, periodo.id)
  }
}

/** Lo pone en uso y saca de uso al que lo estuviera. Activar el activo no hace nada. */
function activar(ctx: Contexto, programaId: number): void {
  if (estaActivo(ctx, programaId)) return
  cerrarPeriodoAbierto(ctx)
  const hoy = ctx.reloj.hoy()
  // Si se desactivó hoy mismo, se reabre ese periodo en vez de empezar otro.
  const ultimo = ctx.bd.una<FilaPeriodo>(
    'SELECT * FROM programa_periodos WHERE programa_id = ? ORDER BY desde DESC, id DESC LIMIT 1',
    programaId,
  )
  if (ultimo !== undefined && ultimo.hasta === hoy) {
    ctx.bd.ejecutar('UPDATE programa_periodos SET hasta = NULL WHERE id = ?', ultimo.id)
  } else {
    ctx.bd.ejecutar(
      'INSERT INTO programa_periodos (programa_id, desde) VALUES (?, ?)',
      programaId,
      hoy,
    )
  }
}

// --- Endpoints -----------------------------------------------------------------------------

/** Los visibles o, con `ocultos`, los ocultos. */
export function listarProgramas(ctx: Contexto, ocultos: boolean): Programa[] {
  const filas = ctx.bd.todas<FilaPrograma>(
    `SELECT * FROM programas WHERE oculto_desde IS ${ocultos ? 'NOT ' : ''}NULL`,
  )
  return programasOut(ctx, ordenarPorNombre(filas))
}

export function obtenerPrograma(ctx: Contexto, programaId: number): Programa {
  obtenerProgramaLegible(ctx, programaId)
  return programaOut(ctx, programaId)
}

/**
 * El programa con sus días, de una vez. Cada rutina tiene que existir y estar visible. Con
 * `activar` y `quitar_excepciones`, también quita los días cambiados a mano desde hoy.
 */
export function crearPrograma(ctx: Contexto, datos: ProgramaNuevo): Programa {
  for (const dia of datos.dias) obtenerRutinaVisible(ctx, dia.rutina_id)
  validarNombreLibre(ctx, datos.nombre)
  const ahora = ctx.reloj.ahora()
  const { ultimoId } = ctx.bd.ejecutar(
    'INSERT INTO programas (nombre, created_at, updated_at) VALUES (?, ?, ?)',
    datos.nombre,
    ahora,
    ahora,
  )
  // Todavía no ha gobernado ningún día: sus filas valen desde siempre.
  for (const dia of datos.dias) {
    ctx.bd.ejecutar(
      'INSERT INTO programa_dias (programa_id, dia_semana, rutina_id) VALUES (?, ?, ?)',
      ultimoId,
      dia.dia_semana,
      dia.rutina_id,
    )
  }
  if (datos.activar) {
    activar(ctx, ultimoId)
    if (datos.quitar_excepciones) quitarExcepcionesDesdeHoy(ctx)
  }
  return programaOut(ctx, ultimoId)
}

/**
 * El *Guardar* de la semana: el nombre y, si llegan, los días, de una vez. Solo se valida lo
 * que cambia: un día que llega igual vale aunque su rutina esté oculta.
 */
export function actualizarPrograma(
  ctx: Contexto,
  programaId: number,
  datos: CambiosDePrograma,
): Programa {
  const programa = obtenerProgramaModificable(ctx, programaId)
  let cambian: [number, number | null][] = []
  if (datos.dias !== null) {
    const vigentes = ctx.bd.todas<FilaDia>(
      'SELECT * FROM programa_dias WHERE programa_id = ? AND hasta IS NULL',
      programaId,
    )
    cambian = diasQueCambian(
      new Map(vigentes.map((f) => [f.dia_semana, f.rutina_id] as [number, number])),
      new Map(datos.dias.map((d) => [d.dia_semana, d.rutina_id] as [number, number])),
    )
    for (const [, rutinaId] of cambian) {
      if (rutinaId !== null) obtenerRutinaVisible(ctx, rutinaId)
    }
  }
  if (claveDeNombre(datos.nombre) !== claveDeNombre(programa.nombre)) {
    validarNombreLibre(ctx, datos.nombre)
  }
  ctx.bd.ejecutar('UPDATE programas SET nombre = ? WHERE id = ?', datos.nombre, programaId)
  for (const [diaSemana, rutinaId] of cambian) cambiarDia(ctx, programaId, diaSemana, rutinaId)
  return programaOut(ctx, programaId)
}

/**
 * Lo pone en uso; el que estuviera activo deja de estarlo. Un programa oculto no se activa.
 * Con `quitarExcepciones`, borra además los días cambiados a mano de hoy en adelante.
 */
export function activarPrograma(
  ctx: Contexto,
  programaId: number,
  quitarExcepciones: boolean,
): Programa {
  obtenerProgramaModificable(ctx, programaId)
  activar(ctx, programaId)
  if (quitarExcepciones) quitarExcepcionesDesdeHoy(ctx)
  return programaOut(ctx, programaId)
}

/** Lo saca de uso y deja sin programa activo. Si no estaba activo, no hace nada. */
export function desactivarPrograma(ctx: Contexto, programaId: number): Programa {
  obtenerProgramaModificable(ctx, programaId, true)
  if (estaActivo(ctx, programaId)) cerrarPeriodoAbierto(ctx)
  return programaOut(ctx, programaId)
}

/** Deshace un `modo=ocultar`. No lo vuelve a activar aunque lo estuviera. */
export function mostrarPrograma(ctx: Contexto, programaId: number): Programa {
  obtenerProgramaModificable(ctx, programaId, true)
  ctx.bd.ejecutar('UPDATE programas SET oculto_desde = NULL WHERE id = ?', programaId)
  return programaOut(ctx, programaId)
}

/**
 * Lo que protege son sus **periodos**: sin ellos el calendario ya no sabe qué tocaba los
 * días en que estuvo activo. Si nunca estuvo activo, se borra directo; si lo estuvo, hace
 * falta `modo`. Las sesiones nunca se tocan.
 */
export function borrarPrograma(ctx: Contexto, programaId: number, modo: ModoBorrado | null): void {
  const programa = obtenerProgramaModificable(ctx, programaId, true)

  if (modo === 'ocultar') {
    if (estaActivo(ctx, programaId)) cerrarPeriodoAbierto(ctx)
    // Si ya estaba oculto, se conserva desde cuándo.
    if (programa.oculto_desde === null) {
      ctx.bd.ejecutar(
        'UPDATE programas SET oculto_desde = ? WHERE id = ?',
        ctx.reloj.hoy(),
        programaId,
      )
    }
    return
  }

  const conPeriodos =
    ctx.bd.una('SELECT 1 FROM programa_periodos WHERE programa_id = ? LIMIT 1', programaId) !==
    undefined
  if (conPeriodos && modo !== 'definitivo') {
    throw conflicto(
      'Este programa ha estado activo. Repite la petición con ?modo=ocultar (conserva' +
        ' todo) o ?modo=definitivo (lo borra con sus días y periodos, sin poder' +
        ' deshacerlo).',
    )
  }
  // Días y periodos se van con él, en cascada.
  ctx.bd.ejecutar('DELETE FROM programas WHERE id = ?', programaId)
}

// --- Días del programa ---------------------------------------------------------------------

/**
 * Desde qué fecha vale un cambio en un día de la semana: hoy, o el día siguiente a la
 * próxima vez que toca, si esa ya se hizo por adelantado y la planifica este programa.
 */
function desdeCuandoCambia(ctx: Contexto, programaId: number, diaSemana: number): string {
  const hoy = ctx.reloj.hoy()
  const proximo = sumarDias(hoy, (((diaSemana - diaDeLaSemana(hoy)) % 7) + 7) % 7)
  const [dia] = seguimiento(ctx, proximo, proximo)
  const contado = dia.cubierto_por !== null && dia.origen === 'programa'
  if (contado && dia.programa_id === programaId) return sumarDias(proximo, 1)
  return hoy
}

/**
 * Pone `rutinaId` en un día del programa (o lo deja en descanso, con null) sin reescribir
 * el pasado: la fila que valía hasta ahora se cierra y se abre otra desde `desde`. Si el
 * programa nunca ha estado activo antes de esa fecha, se sustituye la fila sin más.
 */
function cambiarDia(
  ctx: Contexto,
  programaId: number,
  diaSemana: number,
  rutinaId: number | null,
): void {
  const filas = ctx.bd.todas<FilaDia>(
    'SELECT * FROM programa_dias WHERE programa_id = ? AND dia_semana = ? ORDER BY id',
    programaId,
    diaSemana,
  )
  const desde = desdeCuandoCambia(ctx, programaId, diaSemana)
  const gobiernaElPasado =
    ctx.bd.una(
      'SELECT 1 FROM programa_periodos WHERE programa_id = ? AND desde < ? LIMIT 1',
      programaId,
      desde,
    ) !== undefined
  for (const fila of filas) {
    if (!gobiernaElPasado || (fila.desde !== null && fila.desde >= desde)) {
      // Nunca valió para un día pasado: se puede borrar.
      ctx.bd.ejecutar('DELETE FROM programa_dias WHERE id = ?', fila.id)
    } else if (fila.hasta === null || fila.hasta > desde) {
      ctx.bd.ejecutar('UPDATE programa_dias SET hasta = ? WHERE id = ?', desde, fila.id)
    }
  }
  if (rutinaId !== null) {
    ctx.bd.ejecutar(
      'INSERT INTO programa_dias (programa_id, dia_semana, rutina_id, desde) VALUES (?, ?, ?, ?)',
      programaId,
      diaSemana,
      rutinaId,
      gobiernaElPasado ? desde : null,
    )
  }
}
