/**
 * Filas metidas con SQL directo, para los tests de la propia base (restricciones,
 * cascadas, disparadores), que no pasan por la lógica. Cada una devuelve su id y admite
 * sustituir cualquier columna.
 */
import type { Bd, Valor } from '../../src/logica/bd/bd'
import { AHORA } from './baseNueva'

type Columnas = Record<string, Valor>

export function insertar(bd: Bd, tabla: string, columnas: Columnas): number {
  const nombres = Object.keys(columnas)
  const huecos = nombres.map(() => '?').join(', ')
  return bd.ejecutar(
    `INSERT INTO ${tabla} (${nombres.join(', ')}) VALUES (${huecos})`,
    ...nombres.map((n) => columnas[n]),
  ).ultimoId
}

const FECHAS = { created_at: AHORA, updated_at: AHORA }

export function unGrupo(bd: Bd): number {
  return bd.una<{ id: number }>('SELECT id FROM grupos_musculares ORDER BY id LIMIT 1')!.id
}

export function filaEjercicio(bd: Bd, cambios: Columnas = {}): number {
  return insertar(bd, 'ejercicios', {
    nombre: 'Press banca',
    grupo_muscular_id: unGrupo(bd),
    tipo_registro: 'peso_reps',
    ...FECHAS,
    ...cambios,
  })
}

export function filaRutina(bd: Bd, cambios: Columnas = {}): number {
  return insertar(bd, 'rutinas', { nombre: 'Push', ...FECHAS, ...cambios })
}

export function filaHueco(bd: Bd, rutinaId: number, ejercicioId: number, cambios: Columnas = {}) {
  return insertar(bd, 'rutina_slots', {
    rutina_id: rutinaId,
    ejercicio_principal_id: ejercicioId,
    orden: 1,
    series_objetivo: 3,
    reps_min: 8,
    reps_max: 12,
    ...FECHAS,
    ...cambios,
  })
}

export function filaAlternativa(
  bd: Bd,
  huecoId: number,
  ejercicioId: number,
  cambios: Columnas = {},
) {
  return insertar(bd, 'slot_alternativas', {
    slot_id: huecoId,
    ejercicio_id: ejercicioId,
    series_objetivo: 3,
    reps_min: 8,
    reps_max: 12,
    ...cambios,
  })
}

export function filaEntrenamiento(bd: Bd, rutinaId: number, cambios: Columnas = {}) {
  return insertar(bd, 'entrenamientos', {
    rutina_id: rutinaId,
    fecha: '2026-09-01',
    ...FECHAS,
    ...cambios,
  })
}

/** Una serie de peso y repeticiones (80 kg × 8) si no se dice otra cosa. */
export function filaSerie(
  bd: Bd,
  entrenamientoId: number,
  huecoId: number,
  ejercicioId: number,
  cambios: Columnas = {},
) {
  return insertar(bd, 'series', {
    entrenamiento_id: entrenamientoId,
    slot_id: huecoId,
    ejercicio_id: ejercicioId,
    numero_serie: 1,
    peso_centesimas: 8000,
    repeticiones: 8,
    ...FECHAS,
    ...cambios,
  })
}

export function filaPrograma(bd: Bd, cambios: Columnas = {}): number {
  return insertar(bd, 'programas', { nombre: 'PPL', ...FECHAS, ...cambios })
}

export function contar(bd: Bd, tabla: string): number {
  return bd.una<{ n: number }>(`SELECT count(*) AS n FROM ${tabla}`)!.n
}
