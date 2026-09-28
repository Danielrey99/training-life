/**
 * Los datos tal y como los devuelve la API, en el mismo orden y con los mismos
 * nombres que los esquemas de `backend/app/schemas.py`.
 *
 * Las fechas llegan como texto (`"2026-09-05"`, ISO), no como Date: es lo que
 * viaja en el JSON, y convertirlas es cosa de quien las pinte. Los decimales
 * (peso, RPE) también llegan como texto, porque Pydantic serializa así los
 * `Decimal` para no perder precisión.
 */

// --- Catálogo y ejercicios -----------------------------------------------

export type GrupoMuscular = {
  id: number
  nombre: string
}

export type Ejercicio = {
  id: number
  nombre: string
  grupo_muscular_id: number
  descripcion: string | null
  es_predefinido: boolean
  usuario_id: number | null
  visibilidad: string
  // Desde cuándo está oculto; nulo si está visible.
  oculto_desde: string | null
  created_at: string
  updated_at: string
}

/** Lo justo para saber qué ejercicio fue, en el historial de un hueco. */
export type EjercicioMinimo = {
  id: number
  nombre: string
}

export type Nota = {
  id: number
  usuario_id: number
  ejercicio_id: number
  nota: string
  created_at: string
  updated_at: string
}

// --- Rutinas y huecos ----------------------------------------------------

export type HuecoDeRutina = {
  id: number
  rutina_id: number
  ejercicio_principal_id: number
  orden: number
  series_objetivo: number
  reps_min: number
  reps_max: number
  // Desde cuándo está oculto; nulo si está visible.
  oculto_desde: string | null
  created_at: string
  updated_at: string
  ejercicio_principal: Ejercicio
  // Los comodines del hueco.
  alternativas: Ejercicio[]
}

export type Rutina = {
  id: number
  usuario_id: number
  nombre: string
  // Desde cuándo está oculto; nulo si está visible.
  oculto_desde: string | null
  // En cuántos programas visibles aparece.
  num_programas: number
  created_at: string
  updated_at: string
  slots: HuecoDeRutina[]
}

/** Lo justo de una rutina para pintarla en un día; si está oculta, va en gris. */
export type RutinaMinima = {
  id: number
  nombre: string
  oculto_desde: string | null
}

// --- Entrenamientos y series ---------------------------------------------

export type Serie = {
  id: number
  entrenamiento_id: number
  ejercicio_id: number
  slot_id: number | null
  numero_serie: number
  peso: string
  repeticiones: number
  rpe: string | null
  variante: string | null
  created_at: string
  updated_at: string
  ejercicio: Ejercicio
}

export type Entrenamiento = {
  id: number
  usuario_id: number
  rutina_id: number | null
  fecha: string
  notas: string | null
  // Nula mientras la sesión sigue abierta.
  terminada_en: string | null
  // Abierta y de hoy: la que se puede continuar. La calcula el backend.
  en_curso: boolean
  created_at: string
  updated_at: string
  series: Serie[]
}

// --- Historial -----------------------------------------------------------

/**
 * Una serie del historial. No repite fecha ni ejercicio (los trae la sesión que
 * la agrupa), pero sí el hueco: el mismo ejercicio puede ocupar dos huecos de
 * una rutina, y un mismo día traería dos tandas que numeran desde 1.
 */
export type SerieHistorial = {
  id: number
  slot_id: number | null
  numero_serie: number
  peso: string
  repeticiones: number
  rpe: string | null
  variante: string | null
}

/** En el historial de un hueco, cada serie dice con qué ejercicio se hizo. */
export type SerieHistorialHueco = SerieHistorial & {
  ejercicio: EjercicioMinimo
}

/** Un día con las series que tocaron ese ejercicio o ese hueco. */
export type SesionHistorial<S extends SerieHistorial = SerieHistorial> = {
  entrenamiento_id: number
  fecha: string
  // Nombre de la rutina que se siguió; nulo si fue un entrenamiento libre.
  rutina: string | null
  series: S[]
}

// --- Programas y plan ----------------------------------------------------

/** 1 = lunes … 7 = domingo. */
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type ProgramaDia = {
  dia_semana: DiaSemana
  rutina: RutinaMinima
}

export type Programa = {
  id: number
  usuario_id: number
  nombre: string
  oculto_desde: string | null
  // El que usan Hoy y el calendario. Solo puede haber uno.
  activo: boolean
  activo_desde: string | null
  created_at: string
  updated_at: string
  // Solo los días con rutina: los que faltan son descanso.
  dias: ProgramaDia[]
}

/** Qué toca un día. */
export type DiaPlan = {
  fecha: string
  // De dónde sale: un cambio hecho a mano, la semana del programa, o nada.
  origen: 'excepcion' | 'programa' | 'sin_programa'
  programa_id: number | null
  // Viene aunque esté oculta (para pintarla en gris); entonces `descanso` es verdadero.
  rutina: RutinaMinima | null
  descanso: boolean
}

/** Un día al que se le cambió a mano lo que toca. Sin rutina, es descanso. */
export type Excepcion = {
  fecha: string
  rutina: RutinaMinima | null
}

/**
 * Lo que la web envía, que no es lo mismo que lo que recibe: son los esquemas
 * `...Create`/`...Update` del backend, sin id, sin fechas técnicas y sin los
 * campos que decide el servidor. Los números van como números, aunque vuelvan
 * como texto.
 */

export type NuevoEjercicio = {
  nombre: string
  grupo_muscular_id: number
  descripcion: string | null
}

export type NuevoHueco = {
  ejercicio_principal_id: number
  orden: number
  series_objetivo: number
  reps_min: number
  reps_max: number
}

export type NuevoEntrenamiento = {
  rutina_id: number | null
  fecha: string
  notas: string | null
}

export type NuevaSerie = {
  ejercicio_id: number
  slot_id: number | null
  numero_serie: number
  peso: number
  repeticiones: number
  rpe: number | null
  variante: string | null
}

export type NuevoPrograma = {
  nombre: string
  dias: { dia_semana: DiaSemana; rutina_id: number }[]
  // "Activarlo al crearlo": deja de estar activo el que lo fuera.
  activar: boolean
}

/** Al borrar algo con historial: ocultarlo o llevarse el historial con ello. */
export type ModoBorrado = 'ocultar' | 'definitivo'
