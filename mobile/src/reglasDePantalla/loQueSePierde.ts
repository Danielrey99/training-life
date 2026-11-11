/**
 * Qué se perdería al borrar una rutina, un ejercicio de una rutina o un ejercicio, con las
 * cifras del aviso de borrado de la lógica. Copia literal de `loQueSePierde` de
 * `web/src/paginas/programas/Rutina.tsx`, de `Ejercicio.tsx` y de
 * `web/src/paginas/ejercicios/Ficha.tsx`: si cambian allí, se cambian aquí. Aparte de las
 * pantallas para poder probarlas sin React Native.
 */
import type {
  AvisoDeBorrarEjercicio,
  AvisoDeBorrarHueco,
  AvisoDeBorrarRutina,
} from '../logica/tipos'
import { diaYMesConAnio } from '../utiles/fechas'
import { enumerar } from '../utiles/textos'

/** Que no hace falta ocultar ni borrar para hacer otro ejercicio en su lugar. */
export const CAMBIARLO =
  'Si quieres hacer otro ejercicio en su lugar, cambia el ejercicio principal o las alternativas y lo que ya hiciste se conservará.'

/** Lo que se pierde al borrar una rutina. Sin historial, nada que contar: la pregunta basta. */
export function loQueSePierdeDeLaRutina(aviso: AvisoDeBorrarRutina, oculta: boolean) {
  const frases: string[] = []
  const cosas: string[] = []
  if (aviso.huecos > 0) {
    cosas.push(aviso.huecos === 1 ? 'su ejercicio' : `sus ${aviso.huecos} ejercicios`)
  }
  // Las sesiones se borran enteras, no solo sus series (decisión del autor). Los días que
  // contaban no quedan sin hacer: pasan a descanso, y eso ya lo dice otra frase.
  if (aviso.sesiones > 0) {
    cosas.push(aviso.sesiones === 1 ? 'su sesión entera' : `sus ${aviso.sesiones} sesiones enteras`)
  }
  // Una sola cosa y una sola vez: «Se borrará también su ejercicio», no «Se borrarán».
  const una = aviso.huecos + aviso.sesiones === 1
  const verbo = una ? 'Se borrará' : 'Se borrarán'
  if (cosas.length > 0) frases.push(`${verbo} también ${enumerar(cosas)}.`)
  if (aviso.dias_de_programa > 0) {
    frases.push('Los días de tus programas que la tienen pasarán a descanso.')
  }
  if (aviso.dias_planificados > 0) {
    frases.push('Los días en que la elegiste a mano volverán a lo que diga tu programa.')
  }
  if (aviso.toco_dias_pasados) {
    frases.push('El calendario dejará de saber qué tocaba los días pasados que la tenían.')
  }
  if (aviso.sesion_en_curso) frases.push('También se cancelará la sesión que tienes abierta hoy.')
  // Ocultarla como salida solo tiene sentido si aún se ve.
  if (aviso.con_historial && !oculta) frases.push('Si solo quieres que deje de salir, ocúltala.')
  return frases.length > 0 ? frases.join(' ') : undefined
}

/** «Se borrarán también sus 47 series, apuntadas desde el 6 de julio…»; sin series, nada. */
export function loQueSePierdeDelHueco(aviso: AvisoDeBorrarHueco, oculto: boolean) {
  if (aviso.series === 0) return undefined
  const series = aviso.series === 1 ? 'su serie' : `sus ${aviso.series} series`
  const apuntadas = aviso.series === 1 ? 'apuntada' : 'apuntadas'
  const desde = aviso.desde ? `, ${apuntadas} desde el ${diaYMesConAnio(aviso.desde)}` : ''
  const vacias = aviso.sesiones_que_se_vacian.length
  const sesiones =
    vacias === 0
      ? ''
      : vacias === 1
        ? ', y 1 sesión que solo tenía series de este ejercicio'
        : `, y ${vacias} sesiones que solo tenían series de este ejercicio`
  // Ocultarlo en la rutina como salida solo tiene sentido si aún se ve en ella.
  const salida = oculto
    ? ''
    : ` Si solo quieres que deje de salir, ocúltalo en esta rutina y su historial se conservará. ${CAMBIARLO}`
  // Una sola serie y nada más: «Se borrará», no «Se borrarán».
  const verbo = aviso.series === 1 && vacias === 0 ? 'Se borrará' : 'Se borrarán'
  return `${verbo} también ${series}${desde}${sesiones}.${salida}`
}

/**
 * Lo que dice el diálogo de borrar un ejercicio, con palabras de lo que pasa: «Se borrarán
 * también sus series de 11 sesiones, tus 2 notas, y se quitará de las rutinas donde se usa».
 * Sin nada que perder, no lleva texto.
 */
export function loQueSePierdeDelEjercicio(aviso: AvisoDeBorrarEjercicio, oculto: boolean) {
  const seBorra: string[] = []
  if (aviso.sesiones > 0) {
    seBorra.push(
      aviso.sesiones === 1 ? 'sus series de 1 sesión' : `sus series de ${aviso.sesiones} sesiones`,
    )
  }
  if (aviso.notas > 0) seBorra.push(aviso.notas === 1 ? 'tu nota' : `tus ${aviso.notas} notas`)
  // Las rutinas, sin decir en qué puesto ni si es principal o alternativa (decisión del
  // autor: «su ejercicio 1 en Push» sonaba raro); eso ya lo enseña la ficha, en «Rutinas
  // donde se usa».
  // Donde es el principal, el ejercicio de la rutina se va entero, con sus alternativas.
  const rutinas = new Set(aviso.huecos.map((uso) => uso.rutina.id)).size
  const conAlternativas = aviso.huecos.some((uso) => uso.rol === 'principal')
    ? ', con sus alternativas donde es el principal'
    : ''
  const deLasRutinas =
    rutinas === 0
      ? null
      : `se quitará de ${rutinas === 1 ? 'la rutina' : 'las rutinas'} donde se usa${conAlternativas}`

  // Solo una nota: «Se borrará también tu nota», no «Se borrarán».
  const verbo = seBorra.length === 1 && seBorra[0] === 'tu nota' ? 'Se borrará' : 'Se borrarán'
  const frases: string[] = []
  if (seBorra.length > 0 && deLasRutinas) {
    frases.push(`${verbo} también ${enumerar(seBorra)}, y ${deLasRutinas}.`)
  } else if (seBorra.length > 0) {
    frases.push(`${verbo} también ${enumerar(seBorra)}.`)
  } else if (deLasRutinas) {
    frases.push(`${deLasRutinas[0].toUpperCase()}${deLasRutinas.slice(1)}.`)
  }
  const vacias = aviso.sesiones_que_se_vacian.length
  if (vacias === 1) frases.push('Una sesión se quedará sin series y desaparecerá entera.')
  if (vacias > 1) frases.push(`${vacias} sesiones se quedarán sin series y desaparecerán enteras.`)
  if (frases.length > 0 && !oculto) frases.push('Si solo quieres que deje de salir, ocúltalo.')
  return frases.join(' ') || undefined
}
