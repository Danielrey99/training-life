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

// Lo que se hizo sin contar para ningún día (un entrenamiento libre, una rutina
// sin programa): no tiene día del que tomar el color.
export const SIN_DIA = '#9aa1ac'
