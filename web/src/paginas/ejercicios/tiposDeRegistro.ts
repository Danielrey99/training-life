import type { TipoRegistro } from '../../api/tipos'

/** Cómo se puede apuntar un ejercicio, con una línea que dice qué se pone en cada serie. */
export const TIPOS: { clave: TipoRegistro; nombre: string; ayuda: string }[] = [
  {
    clave: 'peso_reps',
    nombre: 'Peso y repeticiones',
    ayuda: 'Cuánto peso y cuántas repeticiones (press banca, sentadilla…)',
  },
  {
    clave: 'corporal',
    nombre: 'Peso corporal',
    ayuda: 'Repeticiones con tu cuerpo, con lastre o con ayuda si la usas (dominadas, fondos…)',
  },
  {
    clave: 'tiempo',
    nombre: 'Tiempo',
    ayuda: 'Cuánto aguantas, con peso si lo llevas (plancha, paseo del granjero…)',
  },
  {
    clave: 'cardio',
    nombre: 'Cardio',
    ayuda: 'Cuánto tiempo y, si quieres, qué distancia (cinta, bici…)',
  },
]
