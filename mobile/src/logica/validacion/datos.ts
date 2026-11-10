/**
 * El archivo de exportación: `ArchivoDeDatos` y sus piezas, de `backend/app/schemas.py`.
 * Un solo formato para la ida y la vuelta: lo que escribe `exportar` es lo que se lee aquí.
 *
 * Como en el backend, los errores no salen como un 422 de FastAPI sino dentro de «El
 * archivo está dañado.»: quien llama los convierte en «ruta.del.campo: mensaje».
 */
import { TIPOS, type TipoRegistro } from '../reglas/medidas'
import type { FilaObjetivo } from '../servicios/salidas'
import type { SeriePedida } from './entrenamientos'
import { camposDeSerie } from './entrenamientos'
import {
  entero,
  fecha,
  instanteConZona,
  lista,
  literal,
  submodelo,
  texto,
  textoConTope,
  textoObligatorio,
  textoOpcional,
  type Loc,
  type Validador,
} from './base'

export interface PredefinidoDeArchivo {
  id: number
  nombre: string
}

export interface EjercicioDeArchivo {
  id: number
  nombre: string
  grupo_muscular: string
  tipo_registro: TipoRegistro
  descripcion: string | null
  oculto_desde: string | null
  created_at: string
  updated_at: string
}

export interface NotaDeArchivo {
  ejercicio_id: number
  nota: string
  created_at: string
  updated_at: string
}

export interface AlternativaDeArchivo extends FilaObjetivo {
  ejercicio_id: number
}

export interface SlotDeArchivo extends FilaObjetivo {
  ejercicio_principal_id: number
  id: number
  orden: number
  alternativas: AlternativaDeArchivo[]
  oculto_desde: string | null
  created_at: string
  updated_at: string
}

export interface TramoOcultoDeArchivo {
  desde: string
  hasta: string
}

export interface RutinaDeArchivo {
  id: number
  nombre: string
  oculto_desde: string | null
  created_at: string
  updated_at: string
  slots: SlotDeArchivo[]
  periodos_ocultos: TramoOcultoDeArchivo[]
}

export interface DiaDeArchivo {
  dia_semana: number
  rutina_id: number
  desde: string | null
  hasta: string | null
}

export interface PeriodoDeArchivo {
  desde: string
  hasta: string | null
}

export interface ProgramaDeArchivo {
  nombre: string
  oculto_desde: string | null
  created_at: string
  updated_at: string
  dias: DiaDeArchivo[]
  periodos: PeriodoDeArchivo[]
}

export interface ExcepcionDeArchivo {
  fecha: string
  rutina_id: number | null
  created_at: string
  updated_at: string
}

export interface SerieDeArchivo extends SeriePedida {
  created_at: string
  updated_at: string
}

export interface EntrenamientoDeArchivo {
  rutina_id: number
  fecha: string
  cubre_fecha: string | null
  notas: string | null
  terminada_en: string | null
  created_at: string
  updated_at: string
  series: SerieDeArchivo[]
}

export interface ArchivoDeDatos {
  formato: 'training-life'
  version: 2 | 3
  exportado_en: string
  zona_horaria: string | null
  predefinidos: PredefinidoDeArchivo[]
  ejercicios: EjercicioDeArchivo[]
  notas: NotaDeArchivo[]
  rutinas: RutinaDeArchivo[]
  programas: ProgramaDeArchivo[]
  excepciones: ExcepcionDeArchivo[]
  entrenamientos: EntrenamientoDeArchivo[]
}

const OPCIONAL = { porDefecto: null, nulo: true }

/** Un submodelo: lee sus campos y, si todos valen, corre sus comprobaciones de modelo. */
function modelo<T>(
  v: Validador,
  valor: unknown,
  loc: Loc,
  nombre: string,
  leer: (d: Record<string, unknown>) => T,
  comprobar?: (x: T) => string | null,
): T | undefined {
  const d = submodelo(v, valor, loc, nombre)
  if (d === null) return undefined
  const antes = v.errores.length
  const x = leer(d)
  if (v.errores.length > antes) return undefined
  const mal = comprobar?.(x)
  if (mal) {
    v.errorDeValor(loc, mal)
    return undefined
  }
  return x
}

/** Una lista de submodelos (`list[X] = []`). */
function listaDe<T>(
  v: Validador,
  d: Record<string, unknown>,
  nombre: string,
  loc: Loc,
  leer: (valor: unknown, loc: Loc) => T | undefined,
): T[] {
  const crudos = lista(v, d, nombre, loc, undefined, { porDefecto: [] }) ?? []
  return crudos.map((x, i) => leer(x, [...loc, nombre, i])) as T[]
}

const instante = (v: Validador, d: Record<string, unknown>, nombre: string, loc: Loc) =>
  instanteConZona(v, d, nombre, loc) as string

/** `ObjetivoBase`: los cinco campos y su comprobación. */
function objetivo(v: Validador, d: Record<string, unknown>, loc: Loc): FilaObjetivo {
  return {
    series_objetivo: entero(v, d, 'series_objetivo', loc, { gt: 0, le: 50 }) as number,
    reps_min: entero(v, d, 'reps_min', loc, { gt: 0, le: 1000 }, OPCIONAL) as number | null,
    reps_max: entero(v, d, 'reps_max', loc, { gt: 0, le: 1000 }, OPCIONAL) as number | null,
    duracion_min_s: entero(v, d, 'duracion_min_s', loc, { gt: 0, le: 86400 }, OPCIONAL) as
      number | null,
    duracion_max_s: entero(v, d, 'duracion_max_s', loc, { gt: 0, le: 86400 }, OPCIONAL) as
      number | null,
  }
}

/** `ObjetivoBase._validar_objetivo`. */
function malObjetivo(o: FilaObjetivo): string | null {
  const conReps = [o.reps_min !== null, o.reps_max !== null]
  const conDuracion = [o.duracion_min_s !== null, o.duracion_max_s !== null]
  if (
    conReps[0] !== conReps[1] ||
    conDuracion[0] !== conDuracion[1] ||
    conReps[0] === conDuracion[0]
  ) {
    return 'El objetivo lleva repeticiones o tiempo, uno de los dos, con su mínimo y su máximo.'
  }
  if (conReps[0] && o.reps_max! < o.reps_min!) {
    return 'El máximo de repeticiones no puede ser menor que el mínimo.'
  }
  if (conDuracion[0] && o.duracion_max_s! < o.duracion_min_s!) {
    return 'El tiempo máximo no puede ser menor que el mínimo.'
  }
  return null
}

function predefinido(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'PredefinidoDeArchivo', (d) => ({
    id: entero(v, d, 'id', loc) as number,
    nombre: texto(v, d, 'nombre', loc) as string,
  }))
}

function ejercicio(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'EjercicioDeArchivo', (d) => ({
    id: entero(v, d, 'id', loc) as number,
    nombre: textoObligatorio(v, d, 'nombre', loc, 100) as string,
    grupo_muscular: texto(v, d, 'grupo_muscular', loc) as string,
    tipo_registro: literal(v, d, 'tipo_registro', loc, TIPOS) as TipoRegistro,
    descripcion: textoOpcional(v, d, 'descripcion', loc, 500) as string | null,
    oculto_desde: fecha(v, d, 'oculto_desde', loc, OPCIONAL) as string | null,
    created_at: instante(v, d, 'created_at', loc),
    updated_at: instante(v, d, 'updated_at', loc),
  }))
}

function nota(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'NotaDeArchivo', (d) => ({
    ejercicio_id: entero(v, d, 'ejercicio_id', loc) as number,
    nota: textoObligatorio(v, d, 'nota', loc, 1000) as string,
    created_at: instante(v, d, 'created_at', loc),
    updated_at: instante(v, d, 'updated_at', loc),
  }))
}

function alternativa(v: Validador, valor: unknown, loc: Loc) {
  return modelo(
    v,
    valor,
    loc,
    'AlternativaDeHueco',
    (d) => ({ ...objetivo(v, d, loc), ejercicio_id: entero(v, d, 'ejercicio_id', loc) as number }),
    malObjetivo,
  )
}

function slot(v: Validador, valor: unknown, loc: Loc) {
  return modelo(
    v,
    valor,
    loc,
    'SlotDeArchivo',
    (d): SlotDeArchivo => ({
      ...objetivo(v, d, loc),
      ejercicio_principal_id: entero(v, d, 'ejercicio_principal_id', loc) as number,
      id: entero(v, d, 'id', loc) as number,
      orden: entero(v, d, 'orden', loc, { gt: 0, le: 100 }) as number,
      alternativas: listaDe(v, d, 'alternativas', loc, (x, l) => alternativa(v, x, l)),
      oculto_desde: fecha(v, d, 'oculto_desde', loc, OPCIONAL) as string | null,
      created_at: instante(v, d, 'created_at', loc),
      updated_at: instante(v, d, 'updated_at', loc),
    }),
    (s) => {
      const mal = malObjetivo(s)
      if (mal) return mal
      const ids = s.alternativas.map((a) => a.ejercicio_id)
      if (ids.includes(s.ejercicio_principal_id)) {
        return 'Una alternativa no puede ser el mismo ejercicio que el principal.'
      }
      if (new Set(ids).size !== ids.length) return 'Hay alternativas repetidas.'
      return null
    },
  )
}

function tramoOculto(v: Validador, valor: unknown, loc: Loc) {
  return modelo(
    v,
    valor,
    loc,
    'PeriodoOcultoDeArchivo',
    (d) => ({
      desde: fecha(v, d, 'desde', loc) as string,
      hasta: fecha(v, d, 'hasta', loc) as string,
    }),
    // El mismo CHECK de la base (`rutina_periodos_ocultos_rango_check`).
    (t) => (t.hasta <= t.desde ? 'un tramo oculto termina antes de empezar' : null),
  )
}

function rutina(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'RutinaDeArchivo', (d) => ({
    id: entero(v, d, 'id', loc) as number,
    nombre: textoObligatorio(v, d, 'nombre', loc, 100) as string,
    oculto_desde: fecha(v, d, 'oculto_desde', loc, OPCIONAL) as string | null,
    created_at: instante(v, d, 'created_at', loc),
    updated_at: instante(v, d, 'updated_at', loc),
    slots: listaDe(v, d, 'slots', loc, (x, l) => slot(v, x, l)),
    // Un archivo de la versión 2 no los trae: no se guardaban.
    periodos_ocultos: listaDe(v, d, 'periodos_ocultos', loc, (x, l) => tramoOculto(v, x, l)),
  }))
}

function diaDePrograma(v: Validador, valor: unknown, loc: Loc) {
  return modelo(
    v,
    valor,
    loc,
    'DiaDeArchivo',
    (d) => ({
      dia_semana: entero(v, d, 'dia_semana', loc, { ge: 1, le: 7 }) as number,
      rutina_id: entero(v, d, 'rutina_id', loc) as number,
      desde: fecha(v, d, 'desde', loc, OPCIONAL) as string | null,
      hasta: fecha(v, d, 'hasta', loc, OPCIONAL) as string | null,
    }),
    // El mismo CHECK de la base (`programa_dias_vigencia_check`).
    (x) =>
      x.desde !== null && x.hasta !== null && x.hasta <= x.desde
        ? 'la vigencia de un día termina antes de empezar'
        : null,
  )
}

function periodo(v: Validador, valor: unknown, loc: Loc) {
  return modelo(
    v,
    valor,
    loc,
    'PeriodoDeArchivo',
    (d) => ({
      desde: fecha(v, d, 'desde', loc) as string,
      hasta: fecha(v, d, 'hasta', loc, OPCIONAL) as string | null,
    }),
    // El mismo CHECK de la base (`programa_periodos_rango_check`).
    (p) => (p.hasta !== null && p.hasta < p.desde ? 'un periodo termina antes de empezar' : null),
  )
}

function programa(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'ProgramaDeArchivo', (d) => ({
    nombre: textoObligatorio(v, d, 'nombre', loc, 100) as string,
    oculto_desde: fecha(v, d, 'oculto_desde', loc, OPCIONAL) as string | null,
    created_at: instante(v, d, 'created_at', loc),
    updated_at: instante(v, d, 'updated_at', loc),
    dias: listaDe(v, d, 'dias', loc, (x, l) => diaDePrograma(v, x, l)),
    periodos: listaDe(v, d, 'periodos', loc, (x, l) => periodo(v, x, l)),
  }))
}

function excepcion(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'ExcepcionDeArchivo', (d) => ({
    fecha: fecha(v, d, 'fecha', loc) as string,
    // Nula: ese día es descanso.
    rutina_id: entero(v, d, 'rutina_id', loc, {}, OPCIONAL) as number | null,
    created_at: instante(v, d, 'created_at', loc),
    updated_at: instante(v, d, 'updated_at', loc),
  }))
}

function serieDeArchivo(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'SerieDeArchivo', (d) => ({
    ...camposDeSerie(v, d, loc),
    created_at: instante(v, d, 'created_at', loc),
    updated_at: instante(v, d, 'updated_at', loc),
  }))
}

function entrenamiento(v: Validador, valor: unknown, loc: Loc) {
  return modelo(v, valor, loc, 'EntrenamientoDeArchivo', (d) => ({
    rutina_id: entero(v, d, 'rutina_id', loc) as number,
    fecha: fecha(v, d, 'fecha', loc) as string,
    cubre_fecha: fecha(v, d, 'cubre_fecha', loc, OPCIONAL) as string | null,
    notas: textoOpcional(v, d, 'notas', loc, 1000) as string | null,
    terminada_en: instanteConZona(v, d, 'terminada_en', loc, OPCIONAL) as string | null,
    created_at: instante(v, d, 'created_at', loc),
    updated_at: instante(v, d, 'updated_at', loc),
    series: listaDe(v, d, 'series', loc, (x, l) => serieDeArchivo(v, x, l)),
  }))
}

/**
 * `ArchivoDeDatos`. `formato` y `version` ya los ha mirado quien llama (para dar sus
 * propios avisos); aquí se validan igual, como hace Pydantic.
 */
export function archivoDeDatos(v: Validador, d: Record<string, unknown>): ArchivoDeDatos {
  const loc: Loc = []
  const formato = literal(v, d, 'formato', loc, ['training-life'] as const, {
    porDefecto: 'training-life',
  })
  let version: 2 | 3 = 3
  if ('version' in d) {
    if (d.version === 2 || d.version === 3) version = d.version
    else v.error('literal_error', ['version'], 'Input should be 2 or 3')
  }
  return {
    formato: formato as 'training-life',
    version,
    exportado_en: instante(v, d, 'exportado_en', loc),
    zona_horaria: textoConTope(v, d, 'zona_horaria', loc, 64, OPCIONAL) as string | null,
    predefinidos: listaDe(v, d, 'predefinidos', loc, (x, l) => predefinido(v, x, l)),
    ejercicios: listaDe(v, d, 'ejercicios', loc, (x, l) => ejercicio(v, x, l)),
    notas: listaDe(v, d, 'notas', loc, (x, l) => nota(v, x, l)),
    rutinas: listaDe(v, d, 'rutinas', loc, (x, l) => rutina(v, x, l)),
    programas: listaDe(v, d, 'programas', loc, (x, l) => programa(v, x, l)),
    excepciones: listaDe(v, d, 'excepciones', loc, (x, l) => excepcion(v, x, l)),
    entrenamientos: listaDe(v, d, 'entrenamientos', loc, (x, l) => entrenamiento(v, x, l)),
  }
}
