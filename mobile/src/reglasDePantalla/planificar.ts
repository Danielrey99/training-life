/**
 * Las reglas de H4 · Planificar que no necesitan React Native, para probarlas sin él: las
 * semanas de la lista, el orden de las rutinas en la hoja de un día y los porqués de los 409.
 * Copia de las funciones de `web/src/paginas/historial/Planificar.tsx`.
 */
import type { DiaSeguimiento, Programa, RutinaDeHoy } from '../logica/tipos'
import { conArticulo, diaDeLaSemana, fechaEnFrase, nombreDelDia, sumarDias } from '../utiles/fechas'

export type Semana = { lunes: string; domingo: string; dias: DiaSeguimiento[] }

function mayuscula(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** "Mar 15": el día de la semana en tres letras y el número. */
export function etiquetaDelDia(fecha: string) {
  return `${mayuscula(nombreDelDia(fecha).slice(0, 3))} ${Number(fecha.slice(8))}`
}

export function lunesDe(fecha: string) {
  return sumarDias(fecha, 1 - diaDeLaSemana(fecha))
}

/** El domingo de la semana de `fecha`. */
export function domingoDe(fecha: string) {
  return sumarDias(fecha, 7 - diaDeLaSemana(fecha))
}

/** Una semana por grupo, de lunes a domingo; la primera empieza en el primer día dado. */
export function enSemanas(dias: readonly DiaSeguimiento[]): Semana[] {
  const semanas: Semana[] = []
  for (const dia of dias) {
    const lunes = lunesDe(dia.fecha)
    const ultima = semanas[semanas.length - 1]
    if (ultima && ultima.lunes === lunes) ultima.dias.push(dia)
    else semanas.push({ lunes, domingo: sumarDias(lunes, 6), dias: [dia] })
  }
  return semanas
}

/**
 * Las rutinas de la hoja de un día. Primero las del programa, en el orden de la semana (cada
 * una una vez, aunque toque dos días); aparte, las demás, por orden alfabético. Sin programa,
 * todas son «otras». Solo las visibles: lo oculto deja de ofrecerse.
 */
export function rutinasDeLaHoja(
  rutinas: readonly RutinaDeHoy[],
  programa: Programa | null,
): { delPrograma: RutinaDeHoy[]; otras: RutinaDeHoy[] } {
  const visibles = new Map(rutinas.map((rutina) => [rutina.id, rutina]))
  const delPrograma: RutinaDeHoy[] = []
  for (const uno of [...(programa?.dias ?? [])].sort((a, b) => a.dia_semana - b.dia_semana)) {
    const rutina = visibles.get(uno.rutina.id)
    if (rutina && !delPrograma.includes(rutina)) delPrograma.push(rutina)
  }
  const enElPrograma = new Set(delPrograma.map((rutina) => rutina.id))
  const otras = rutinas
    .filter((rutina) => !enElPrograma.has(rutina.id))
    .sort((una, otra) => una.nombre.localeCompare(otra.nombre, 'es'))
  return { delPrograma, otras }
}

/**
 * El porqué del 409 al cambiar un día, con las palabras del boceto: dejaría sin día lo que
 * ya se entrenó para él (`hechoEl`).
 */
export function porQueNoSePuede(rutina: string, fecha: string, hechoEl: string, oculta: boolean) {
  const suDia = nombreDelDia(fecha)
  // Con la rutina oculta no se puede poner en otro día: hay que mostrarla o borrar la sesión.
  const sinOtroDia = `y ${rutina} está oculta, así que no puede ir a otro día. Muestra ${rutina} desde la pestaña Programas o borra la sesión`
  // Hecho ese mismo día: solo puede ser hoy (el pasado no se planifica).
  if (hechoEl === fecha) {
    if (oculta) {
      return (
        `El ${rutina} de hoy ya lo hiciste. Si hoy deja de tener ${rutina}, lo que entrenaste ` +
        `no contaría para ningún día, ${sinOtroDia} de hoy, y después cambia hoy.`
      )
    }
    return (
      `El ${rutina} de hoy ya lo hiciste. Si hoy deja de tener ${rutina} y no lo pones en ` +
      `otro día de esta semana, lo que entrenaste no contaría para ningún día. Pon antes el ` +
      `${rutina} en otro día, y después cambia hoy.`
    )
  }
  const hecho = nombreDelDia(hechoEl)
  if (oculta) {
    return (
      `El ${rutina} del ${suDia} ya lo hiciste el ${hecho}. Si el ${suDia} deja de tener ` +
      `${rutina}, lo que entrenaste el ${hecho} no contaría para ningún día, ${sinOtroDia} ` +
      `del ${hecho}, y después cambia el ${suDia}.`
    )
  }
  return (
    `El ${rutina} del ${suDia} ya lo hiciste el ${hecho}. Si el ${suDia} deja de tener ` +
    `${rutina} y no lo pones en otro día de esta semana, lo que entrenaste el ${hecho} no ` +
    `contaría para ningún día. Pon antes el ${rutina} en otro día, y después cambia el ${suDia}.`
  )
}

/** El porqué del 409 al restablecer una semana: lo hecho se quedaría sin día. */
export function porQueNoSeRestablece(rutina: string, hechoEl: string, oculta: boolean) {
  if (oculta) {
    return (
      `El ${rutina} que hiciste ${conArticulo(hechoEl)} se quedaría sin ningún día de esta ` +
      `semana en el que contar, y ${rutina} está oculta, así que no puede ir a otro día. ` +
      `Muestra ${rutina} desde la pestaña Programas o borra la sesión del ` +
      `${fechaEnFrase(hechoEl, false)}, y después restablece la semana.`
    )
  }
  return (
    `El ${rutina} que hiciste ${conArticulo(hechoEl)} se quedaría sin ningún día de esta ` +
    `semana en el que contar. Restablece los días uno a uno, dejando algún día con ${rutina}.`
  )
}
