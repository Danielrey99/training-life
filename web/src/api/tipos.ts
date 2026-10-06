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
  slot_id: number
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
  rutina_id: number
  fecha: string
  // El día del plan que cuenta: el de hoy, uno que se recupera o uno que se
  // adelanta. Nulo si no cuenta para ninguno.
  cubre_fecha: string | null
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
  slot_id: number
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
  // Nombre de la rutina que se siguió.
  rutina: string
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

/** Lo que se hizo un día, cuente o no para alguno. */
export type SesionDelDia = {
  entrenamiento_id: number
  rutina: RutinaMinima
  en_curso: boolean
  vacia: boolean
  cubre_fecha: string | null
  // Si cuenta de verdad para `cubre_fecha`.
  cuenta: boolean
}

export type EstadoDelDia = 'descanso' | 'hecho' | 'movido' | 'sin_hacer' | 'pendiente' | 'proximo'

/**
 * Un día del plan con lo que pasó: `estado` es de lo que tocaba; `sesion`, de lo
 * que se hizo ese día, que puede ser otra cosa (las marcas combinadas).
 */
export type DiaSeguimiento = DiaPlan & {
  estado: EstadoDelDia
  // La sesión que cuenta este día, y en qué fecha se hizo.
  cubierto_por: { entrenamiento_id: number; fecha: string } | null
  sesion: SesionDelDia | null
}

export type SituacionDeHoy =
  'en_curso' | 'hecho' | 'primera_vez' | 'sin_programa' | 'movido' | 'descanso' | 'entrenamiento'

export type Recuperable = {
  fecha: string
  rutina: RutinaMinima
  // El último día en que se puede recuperar.
  plazo: string
  // Falso si hoy ya hay sesión: se enseña, pero sin botón.
  se_puede_hoy: boolean
}

/** Una rutina de la lista de abajo. Sin fecha, se entrena sin contar para ningún día. */
export type Ofrecida = {
  accion: 'intercambiar' | 'adelantar' | 'sin_contar'
  rutina: RutinaMinima
  fecha: string | null
}

/** La última sesión con algo apuntado, sin contar la que está a medias. */
export type UltimaSesion = {
  entrenamiento_id: number
  fecha: string
  rutina: RutinaMinima
  // Si recuperaba o adelantaba otro día.
  cubre_fecha: string | null
  series: number
  ejercicios: number
}

/** Lo que la pantalla de hoy dice de cada rutina: "5 ejercicios · última vez el miércoles 2". */
export type RutinaDeHoy = {
  id: number
  nombre: string
  ejercicios: number
  ultima_vez: string | null
}

/** Todo lo que necesita la pantalla de hoy, en una sola respuesta. */
export type Hoy = {
  fecha: string
  situacion: SituacionDeHoy
  // De lunes a domingo.
  semana: DiaSeguimiento[]
  sesion: SesionDelDia | null
  proximo: DiaSeguimiento | null
  por_recuperar: Recuperable[]
  ofrecidas: Ofrecida[]
  ultima_sesion: UltimaSesion | null
  rutinas: RutinaDeHoy[]
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

// La rutina y el día que cuenta solo van al crear: los decide el botón pulsado
// (Empezar, Recuperar, Adelantar) y no cambian después.
export type NuevoEntrenamiento = {
  rutina_id: number
  fecha: string
  notas: string | null
  cubre_fecha?: string | null
}

/** Lo que se corrige de una sesión ya creada. */
export type EntrenamientoCorregido = {
  fecha: string
  notas: string | null
}

export type NuevaSerie = {
  ejercicio_id: number
  slot_id: number
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
