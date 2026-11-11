/**
 * Lo que dice el diálogo de borrar una rutina o un ejercicio de una rutina, con las cifras del
 * aviso de borrado (`src/reglasDePantalla/loQueSePierde.ts`, copia de `loQueSePierde` de
 * `Rutina.tsx` y `Ejercicio.tsx` de la web): qué se borra con ella, singular o plural, qué
 * pasa con los días y cuándo se ofrece ocultar como salida.
 */
import type {
  AvisoDeBorrarEjercicio,
  AvisoDeBorrarHueco,
  AvisoDeBorrarRutina,
  UsoEnRutina,
} from '../../src/logica/tipos'
import {
  CAMBIARLO,
  loQueSePierdeDelEjercicio,
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

function avisoDeEjercicio(cambios: Partial<AvisoDeBorrarEjercicio> = {}): AvisoDeBorrarEjercicio {
  return {
    con_historial: false,
    series: 0,
    sesiones: 0,
    desde: null,
    notas: 0,
    huecos: [],
    sesiones_que_se_vacian: [],
    ...cambios,
  }
}

function uso(rutinaId: number, slotId: number, rol: 'principal' | 'comodin'): UsoEnRutina {
  return {
    rutina: { id: rutinaId, nombre: `Rutina ${rutinaId}`, oculto_desde: null },
    slot_id: slotId,
    rol,
    posicion: slotId,
    oculto: false,
    programas: [],
  }
}

const OCULTALO_EJERCICIO = 'Si solo quieres que deje de salir, ocúltalo.'

describe('loQueSePierdeDelEjercicio', () => {
  test('sin nada que perder no cuenta nada: la pregunta basta', () => {
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio(), false)).toBeUndefined()
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio(), true)).toBeUndefined()
  })

  test('solo una nota, en singular, y ofrece ocultarlo', () => {
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio({ notas: 1 }), false)).toBe(
      `Se borrará también tu nota. ${OCULTALO_EJERCICIO}`,
    )
  })

  test('varias notas, en plural', () => {
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio({ notas: 3 }), true)).toBe(
      'Se borrarán también tus 3 notas.',
    )
  })

  test('una sola sesión, en singular', () => {
    const aviso = avisoDeEjercicio({ con_historial: true, series: 4, sesiones: 1 })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe('Se borrarán también sus series de 1 sesión.')
  })

  test('sesiones y notas juntas', () => {
    const aviso = avisoDeEjercicio({ con_historial: true, series: 30, sesiones: 11, notas: 2 })
    expect(loQueSePierdeDelEjercicio(aviso, false)).toBe(
      `Se borrarán también sus series de 11 sesiones y tus 2 notas. ${OCULTALO_EJERCICIO}`,
    )
    const una = avisoDeEjercicio({ con_historial: true, series: 3, sesiones: 1, notas: 2 })
    expect(loQueSePierdeDelEjercicio(una, true)).toBe(
      'Se borrarán también sus series de 1 sesión y tus 2 notas.',
    )
  })

  test('dos huecos de la misma rutina cuentan como una sola rutina', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'comodin'), uso(1, 11, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe('Se quitará de la rutina donde se usa.')
  })

  test('en dos rutinas distintas, habla de las rutinas', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'comodin'), uso(2, 20, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe('Se quitará de las rutinas donde se usa.')
  })

  test('donde es el principal, avisa de que se van sus alternativas', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'principal'), uso(2, 20, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se quitará de las rutinas donde se usa, con sus alternativas donde es el principal.',
    )
  })

  test('sin ser principal en ninguna, no menciona las alternativas', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).not.toContain('alternativas')
  })

  test('series y rutinas juntas se unen con una coma y una «y»', () => {
    const aviso = avisoDeEjercicio({
      con_historial: true,
      series: 8,
      sesiones: 3,
      huecos: [uso(1, 10, 'principal')],
    })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se borrarán también sus series de 3 sesiones, y se quitará de la rutina donde se usa, ' +
        'con sus alternativas donde es el principal.',
    )
  })

  test('una nota y una rutina: el verbo sigue en singular solo si hay una sola cosa', () => {
    const aviso = avisoDeEjercicio({ notas: 1, huecos: [uso(1, 10, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se borrará también tu nota, y se quitará de la rutina donde se usa.',
    )
  })

  test('una sesión que se vacía', () => {
    const aviso = avisoDeEjercicio({
      con_historial: true,
      series: 2,
      sesiones: 1,
      sesiones_que_se_vacian: sesionesQueSeVacian(1),
    })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se borrarán también sus series de 1 sesión. Una sesión se quedará sin series y desaparecerá entera.',
    )
  })

  test('varias sesiones que se vacían', () => {
    const aviso = avisoDeEjercicio({
      con_historial: true,
      series: 20,
      sesiones: 5,
      sesiones_que_se_vacian: sesionesQueSeVacian(3),
    })
    expect(loQueSePierdeDelEjercicio(aviso, false)).toBe(
      'Se borrarán también sus series de 5 sesiones. ' +
        '3 sesiones se quedarán sin series y desaparecerán enteras. ' +
        OCULTALO_EJERCICIO,
    )
  })

  test('oculto, no ofrece ocultarlo', () => {
    const aviso = avisoDeEjercicio({ notas: 2, huecos: [uso(1, 10, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).not.toContain('ocúltalo')
    expect(loQueSePierdeDelEjercicio(aviso, false)).toContain(OCULTALO_EJERCICIO)
  })
})
