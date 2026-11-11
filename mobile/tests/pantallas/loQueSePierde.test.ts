/**
 * Lo que dice el diálogo de borrar una rutina o un ejercicio de una rutina, con las cifras del
 * aviso de borrado (`src/reglasDePantalla/loQueSePierde.ts`, copia de `loQueSePierde` de
 * `Rutina.tsx` y `Ejercicio.tsx` de la web): qué se borra con ella, singular o plural, qué
 * pasa con los días y cuándo se ofrece ocultar como salida.
 */
import type { AvisoDeBorrarHueco, AvisoDeBorrarRutina } from '../../src/logica/tipos'
import {
  CAMBIARLO,
  loQueSePierdeDelHueco,
  loQueSePierdeDeLaRutina,
} from '../../src/reglasDePantalla/loQueSePierde'
import { hoy } from '../../src/utiles/fechas'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

function avisoDeRutina(cambios: Partial<AvisoDeBorrarRutina> = {}): AvisoDeBorrarRutina {
  return {
    con_historial: false,
    huecos: 0,
    sesiones: 0,
    dias_de_programa: 0,
    dias_planificados: 0,
    toco_dias_pasados: false,
    sesion_en_curso: false,
    ...cambios,
  }
}

function avisoDeHueco(cambios: Partial<AvisoDeBorrarHueco> = {}): AvisoDeBorrarHueco {
  return { series: 0, desde: null, sesiones_que_se_vacian: [], ...cambios }
}

function sesionesQueSeVacian(cuantas: number) {
  return Array.from({ length: cuantas }, (_, i) => ({
    entrenamiento_id: i + 1,
    fecha: '2026-07-06',
    cubre_fecha: null,
  }))
}

const OCULTALA = 'Si solo quieres que deje de salir, ocúltala.'
const OCULTALO = `Si solo quieres que deje de salir, ocúltalo en esta rutina y su historial se conservará. ${CAMBIARLO}`

describe('loQueSePierdeDeLaRutina', () => {
  test('una rutina sin nada no cuenta nada: la pregunta basta', () => {
    expect(loQueSePierdeDeLaRutina(avisoDeRutina(), false)).toBeUndefined()
  })

  test('con un solo ejercicio, en singular', () => {
    const aviso = avisoDeRutina({ con_historial: true, huecos: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, true)).toBe('Se borrará también su ejercicio.')
  })

  test('con una sola sesión y nada más, también en singular', () => {
    const aviso = avisoDeRutina({ con_historial: true, sesiones: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, true)).toBe('Se borrará también su sesión entera.')
  })

  test('un ejercicio y una sesión ya son dos cosas, en plural', () => {
    const aviso = avisoDeRutina({ con_historial: true, huecos: 1, sesiones: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, true)).toBe(
      'Se borrarán también su ejercicio y su sesión entera.',
    )
  })

  test('con varios ejercicios y varias sesiones, cuenta los dos', () => {
    const aviso = avisoDeRutina({ con_historial: true, huecos: 5, sesiones: 12 })
    expect(loQueSePierdeDeLaRutina(aviso, true)).toBe(
      'Se borrarán también sus 5 ejercicios y sus 12 sesiones enteras.',
    )
  })

  test.each<[string, Partial<AvisoDeBorrarRutina>, string]>([
    [
      'los días de programa',
      { dias_de_programa: 2 },
      'Los días de tus programas que la tienen pasarán a descanso.',
    ],
    [
      'los días planificados a mano',
      { dias_planificados: 1 },
      'Los días en que la elegiste a mano volverán a lo que diga tu programa.',
    ],
    [
      'los días pasados en que tocaba',
      { toco_dias_pasados: true },
      'El calendario dejará de saber qué tocaba los días pasados que la tenían.',
    ],
    [
      'la sesión abierta hoy',
      { sesion_en_curso: true },
      'También se cancelará la sesión que tienes abierta hoy.',
    ],
  ])('cuenta lo que pasa con %s', (_caso, cambios, frase) => {
    expect(loQueSePierdeDeLaRutina(avisoDeRutina(cambios), true)).toBe(frase)
  })

  test('con todo a la vez, las frases van en orden y la salida de ocultar al final', () => {
    const aviso = avisoDeRutina({
      con_historial: true,
      huecos: 3,
      sesiones: 4,
      dias_de_programa: 1,
      dias_planificados: 1,
      toco_dias_pasados: true,
      sesion_en_curso: true,
    })
    expect(loQueSePierdeDeLaRutina(aviso, false)).toBe(
      'Se borrarán también sus 3 ejercicios y sus 4 sesiones enteras. ' +
        'Los días de tus programas que la tienen pasarán a descanso. ' +
        'Los días en que la elegiste a mano volverán a lo que diga tu programa. ' +
        'El calendario dejará de saber qué tocaba los días pasados que la tenían. ' +
        'También se cancelará la sesión que tienes abierta hoy. ' +
        OCULTALA,
    )
  })

  test('con historial y visible, ofrece ocultarla', () => {
    const aviso = avisoDeRutina({ con_historial: true, huecos: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, false)).toBe(
      `Se borrará también su ejercicio. ${OCULTALA}`,
    )
  })

  test('sin historial no ofrece ocultarla, aunque se vea', () => {
    const aviso = avisoDeRutina({ dias_de_programa: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, false)).toBe(
      'Los días de tus programas que la tienen pasarán a descanso.',
    )
  })
})

describe('loQueSePierdeDelHueco', () => {
  test('sin series no cuenta nada: la pregunta basta', () => {
    expect(loQueSePierdeDelHueco(avisoDeHueco(), false)).toBeUndefined()
  })

  test('una sola serie y ninguna sesión que se vacíe, en singular', () => {
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 1 }), true)).toBe(
      'Se borrará también su serie.',
    )
  })

  test('con la fecha de la primera serie, dice desde cuándo', () => {
    const desde = `${hoy().slice(0, 4)}-07-06`
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 47, desde }), true)).toBe(
      'Se borrarán también sus 47 series, apuntadas desde el 6 de julio.',
    )
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 1, desde }), true)).toBe(
      'Se borrará también su serie, apuntada desde el 6 de julio.',
    )
  })

  test('una fecha de otro año lleva el año', () => {
    const anioPasado = Number(hoy().slice(0, 4)) - 1
    const aviso = avisoDeHueco({ series: 2, desde: `${anioPasado}-07-06` })
    expect(loQueSePierdeDelHueco(aviso, true)).toBe(
      `Se borrarán también sus 2 series, apuntadas desde el 6 de julio de ${anioPasado}.`,
    )
  })

  test('una serie que vacía su sesión ya son dos cosas, en plural', () => {
    const aviso = avisoDeHueco({ series: 1, sesiones_que_se_vacian: sesionesQueSeVacian(1) })
    expect(loQueSePierdeDelHueco(aviso, true)).toBe(
      'Se borrarán también su serie, y 1 sesión que solo tenía series de este ejercicio.',
    )
  })

  test('cuenta las sesiones que se vacían detrás de la fecha', () => {
    const desde = `${hoy().slice(0, 4)}-07-06`
    const aviso = avisoDeHueco({ series: 9, desde, sesiones_que_se_vacian: sesionesQueSeVacian(3) })
    expect(loQueSePierdeDelHueco(aviso, true)).toBe(
      'Se borrarán también sus 9 series, apuntadas desde el 6 de julio, ' +
        'y 3 sesiones que solo tenían series de este ejercicio.',
    )
  })

  test('si aún se ve en la rutina, ofrece ocultarlo y cambiarlo', () => {
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 4 }), false)).toBe(
      `Se borrarán también sus 4 series. ${OCULTALO}`,
    )
  })
})
