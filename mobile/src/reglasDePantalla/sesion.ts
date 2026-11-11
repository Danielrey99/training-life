/**
 * Las cuentas de la sesión que no dependen de la pantalla: qué ejercicio arranca en cada
 * hueco y cómo se dicen las series y los ejercicios que se llevan. Vienen de `web/src/paginas/sesion/Sesion.tsx`
 * y están aparte para poder probarlas sin React Native.
 */
import type { Ejercicio, HuecoDeRutina, Serie } from '../logica/tipos'

/**
 * «12/21 series»: las apuntadas sobre la suma de las series del objetivo de cada ejercicio,
 * como el «2/3» de cada uno. Pasarse se lee igual («28/21 series»).
 */
export function cuentaDeSeries(hechas: number, objetivo: number) {
  return `${hechas}/${objetivo} series`
}

/**
 * «6 de 7 ejercicios»: los que tienen al menos una serie. El objetivo es una recomendación,
 * así que un ejercicio con menos series de las que pide cuenta como hecho (decisión del autor).
 */
export function cuentaDeEjercicios(hechos: number, total: number) {
  return `${hechos} de ${total} ${total === 1 ? 'ejercicio' : 'ejercicios'}`
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
