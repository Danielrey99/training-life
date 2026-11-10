/**
 * Las cuentas de la sesión que no dependen de la pantalla: qué ejercicio arranca en cada
 * hueco y cómo se dice cuántos se han completado. Vienen de `web/src/paginas/sesion/Sesion.tsx`
 * y están aparte para poder probarlas sin React Native.
 */
import type { Ejercicio, HuecoDeRutina, Serie } from '../logica/tipos'

/** «has completado 1 de los 4 ejercicios»: con cualquier número, sin concordar «completo(s)». */
export function completados(hechos: number, total: number) {
  if (total === 1)
    return hechos === 1 ? 'has completado el ejercicio' : 'aún no has completado el ejercicio'
  return `has completado ${hechos} de los ${total} ejercicios`
}

/**
 * El ejercicio con el que arranca un hueco: el de la última serie de hoy si ya se empezó
 * (quien cambió al comodín sigue con él); si no, el principal; y si el principal está
 * oculto, el primer comodín visible. Nulo si no queda ninguno.
 */
export function ejercicioInicial(hueco: HuecoDeRutina, series: Serie[]): Ejercicio | null {
  const opciones = [
    hueco.ejercicio_principal,
    ...hueco.alternativas.map((alternativa) => alternativa.ejercicio),
  ]
  const ultima = series.filter((serie) => serie.slot_id === hueco.id).at(-1)
  const deHoy = opciones.find((ejercicio) => ejercicio.id === ultima?.ejercicio_id)
  return deHoy ?? opciones.find((ejercicio) => ejercicio.oculto_desde === null) ?? null
}
