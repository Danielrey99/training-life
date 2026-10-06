/**
 * Un color por día de la semana, no por rutina: un día movido conserva el color
 * del día en que tocaba, y así se ve de dónde viene. Lunes, miércoles y viernes
 * son los de los bocetos; el resto se eligió para que se distingan entre sí y del
 * rojo de los errores.
 */
const POR_DIA: Record<number, string> = {
  1: '#4ade80', // lunes, verde
  2: '#2dd4bf', // martes, turquesa
  3: '#69beff', // miércoles, azul
  4: '#c084fc', // jueves, violeta
  5: '#ecb432', // viernes, ámbar
  6: '#f472b6', // sábado, rosa
  7: '#fb923c', // domingo, naranja
}

/** El color de un día de la semana (1 = lunes … 7 = domingo). */
export function colorDelDia(diaSemana: number): string {
  return POR_DIA[diaSemana]
}

// Lo que se hizo sin contar para ningún día (una rutina que no está en el programa):
// no tiene día del que tomar el color.
export const SIN_DIA = '#9aa1ac'

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
