import { ajustes, temaVisible } from './ajustes'

/**
 * Los colores que se pueden elegir para un día en Ajustes, ordenados por tono (como salen
 * en la hoja). Los nueve de toda la vida (rojo, naranja, amarillo, verde, celeste, azul,
 * morado, rosa y marrón, los del sistema de iOS) y variaciones claras de ellos. Cada uno
 * en sus dos versiones: los oscuros (granate, azul marino) se aclaran en el tema oscuro
 * para no perderse en el fondo. Sin gris: es el de lo que no cuenta para ningún día.
 */
export const PALETA = [
  { id: 'rojo', nombre: 'Rojo', oscuro: '#ff453a', claro: '#ff3b30' },
  { id: 'granate', nombre: 'Granate', oscuro: '#c0506e', claro: '#8e1b3a' },
  { id: 'coral', nombre: 'Coral', oscuro: '#ff8a7a', claro: '#ff6f61' },
  { id: 'terracota', nombre: 'Terracota', oscuro: '#e07a50', claro: '#c2562e' },
  { id: 'naranja', nombre: 'Naranja', oscuro: '#ff9f0a', claro: '#ff9500' },
  { id: 'melocoton', nombre: 'Melocotón', oscuro: '#ffbf80', claro: '#f2a65a' },
  { id: 'dorado', nombre: 'Dorado', oscuro: '#e0b530', claro: '#c99a06' },
  { id: 'amarillo', nombre: 'Amarillo', oscuro: '#ffd60a', claro: '#f5b800' },
  { id: 'oliva', nombre: 'Oliva', oscuro: '#adad5c', claro: '#7a7a2a' },
  { id: 'lima', nombre: 'Lima', oscuro: '#a3e635', claro: '#7cb518' },
  { id: 'verde', nombre: 'Verde', oscuro: '#30d158', claro: '#34c759' },
  { id: 'verde-oscuro', nombre: 'Verde oscuro', oscuro: '#3e9b5a', claro: '#1e7a3c' },
  { id: 'menta', nombre: 'Menta', oscuro: '#63e6be', claro: '#00b894' },
  { id: 'turquesa', nombre: 'Turquesa', oscuro: '#40c8e0', claro: '#30b0c7' },
  { id: 'celeste', nombre: 'Celeste', oscuro: '#64d2ff', claro: '#32ade6' },
  { id: 'azul', nombre: 'Azul', oscuro: '#0a84ff', claro: '#007aff' },
  { id: 'azul-marino', nombre: 'Azul marino', oscuro: '#5b7bd5', claro: '#1f3a93' },
  { id: 'indigo', nombre: 'Índigo', oscuro: '#5e5ce6', claro: '#5856d6' },
  { id: 'lavanda', nombre: 'Lavanda', oscuro: '#c3b5f5', claro: '#9b8bd6' },
  { id: 'morado', nombre: 'Morado', oscuro: '#bf5af2', claro: '#af52de' },
  { id: 'fucsia', nombre: 'Fucsia', oscuro: '#f048c8', claro: '#d6249f' },
  { id: 'rosa', nombre: 'Rosa', oscuro: '#ff6fae', claro: '#e8458b' },
  { id: 'rosa-palo', nombre: 'Rosa palo', oscuro: '#f7b6c6', claro: '#e89aae' },
  { id: 'marron', nombre: 'Marrón', oscuro: '#ac8e68', claro: '#a2845e' },
] as const

/**
 * Un color por día de la semana, no por rutina: un día movido conserva el color
 * del día en que tocaba, y así se ve de dónde viene. Por defecto, el arcoíris de lunes
 * a domingo (decisión del autor): fácil de recordar, y dos días seguidos nunca se
 * parecen. En Ajustes se puede cambiar el de cada día.
 */
export const POR_DIA: Record<number, string> = {
  1: 'rojo',
  2: 'naranja',
  3: 'amarillo',
  4: 'verde',
  5: 'azul',
  6: 'morado',
  7: 'rosa',
}

/** Un color de la paleta (su id) hecho color, en el tema que se ve. */
export function resolverColor(elegido: string): string {
  const color = PALETA.find((opcion) => opcion.id === elegido) ?? PALETA[0]
  return color[temaVisible()]
}

/**
 * Lo elegido para un día: lo de Ajustes o, si no, el de la app. Lo que no está en la
 * paleta (un color que se quitó, o un color libre de cuando se podía elegir cualquiera)
 * vuelve al de la app.
 */
export function eleccionDelDia(diaSemana: number): string {
  const elegido = ajustes().colores[diaSemana]
  const vale = elegido !== undefined && PALETA.some((opcion) => opcion.id === elegido)
  return vale ? elegido : POR_DIA[diaSemana]
}

/** El color de un día de la semana (1 = lunes … 7 = domingo). */
export function colorDelDia(diaSemana: number): string {
  return resolverColor(eleccionDelDia(diaSemana))
}

// Lo que se hizo sin contar para ningún día (una rutina que no está en el programa):
// no tiene día del que tomar el color.
export const SIN_DIA = 'var(--texto-tenue)'

/**
 * El color de una rutina que se hizo sin contar para ningún día: el del día en que
 * la tiene el programa activo, para que se reconozca en el calendario. Sin
 * programa, o si la rutina no está en él, el neutro.
 */
export function colorDeRutina(
  dias: { dia_semana: number; rutina: { id: number } }[] | undefined,
  rutinaId: number | null | undefined,
): string {
  const suDia = dias?.find((dia) => dia.rutina.id === rutinaId)
  return suDia ? colorDelDia(suDia.dia_semana) : SIN_DIA
}
