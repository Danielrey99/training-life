/**
 * Los datos tal y como los devuelve la API, en el mismo orden y con los mismos
 * nombres que los esquemas de `backend/app/schemas.py`.
 *
 * Las fechas llegan como texto (`"2026-09-05"`, ISO), no como Date: es lo que
 * viaja en el JSON, y convertirlas es cosa de quien las pinte.
 */

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
  activo: boolean
  created_at: string
  updated_at: string
}

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
  ejercicio: Ejercicio
}

export type Entrenamiento = {
  id: number
  usuario_id: number
  rutina_id: number | null
  fecha: string
  notas: string | null
  series: Serie[]
}

export type Rutina = {
  id: number
  usuario_id: number
  nombre: string
  dia_habitual: string | null
  activo: boolean
  slots: HuecoDeRutina[]
}

export type HuecoDeRutina = {
  id: number
  rutina_id: number
  orden: number
  series_objetivo: number
  reps_min: number
  reps_max: number
  activo: boolean
  ejercicio_principal: Ejercicio
  alternativas: Ejercicio[]
}
