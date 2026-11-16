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
  return { series: 0, desde: null, sesiones_que_se_vacian: 0, ...cambios }
}

const OCULTALA = 'Si solo quieres que deje de salir, ocúltala.'
const OCULTALO = `Si solo quieres que deje de salir, ocúltalo en esta rutina y su historial se conservará. ${CAMBIARLO}`

describe('loQueSePierdeDeLaRutina', () => {
  test('una_rutina_sin_nada_no_cuenta_nada_la_pregunta_basta', () => {
    expect(loQueSePierdeDeLaRutina(avisoDeRutina(), false)).toBeUndefined()
  })

  test('con_un_solo_ejercicio_en_singular', () => {
    const aviso = avisoDeRutina({ con_historial: true, huecos: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, true)).toBe('Se borrará también su ejercicio.')
  })

  test('con_una_sola_sesion_y_nada_mas_tambien_en_singular', () => {
    const aviso = avisoDeRutina({ con_historial: true, sesiones: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, true)).toBe('Se borrará también su sesión entera.')
  })

  test('un_ejercicio_y_una_sesion_ya_son_dos_cosas_en_plural', () => {
    const aviso = avisoDeRutina({ con_historial: true, huecos: 1, sesiones: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, true)).toBe(
      'Se borrarán también su ejercicio y su sesión entera.',
    )
  })

  test('con_varios_ejercicios_y_varias_sesiones_cuenta_los_dos', () => {
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
  ])('cuenta_lo_que_pasa_con_%s', (_caso, cambios, frase) => {
    expect(loQueSePierdeDeLaRutina(avisoDeRutina(cambios), true)).toBe(frase)
  })

  test('con_todo_a_la_vez_las_frases_van_en_orden_y_la_salida_de_ocultar_al_final', () => {
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

  test('con_historial_y_visible_ofrece_ocultarla', () => {
    const aviso = avisoDeRutina({ con_historial: true, huecos: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, false)).toBe(
      `Se borrará también su ejercicio. ${OCULTALA}`,
    )
  })

  test('sin_historial_no_ofrece_ocultarla_aunque_se_vea', () => {
    const aviso = avisoDeRutina({ dias_de_programa: 1 })
    expect(loQueSePierdeDeLaRutina(aviso, false)).toBe(
      'Los días de tus programas que la tienen pasarán a descanso.',
    )
  })
})

describe('loQueSePierdeDelHueco', () => {
  test('sin_series_no_cuenta_nada_la_pregunta_basta', () => {
    expect(loQueSePierdeDelHueco(avisoDeHueco(), false)).toBeUndefined()
  })

  test('una_sola_serie_y_ninguna_sesion_que_se_vacie_en_singular', () => {
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 1 }), true)).toBe(
      'Se borrará también su serie.',
    )
  })

  test('con_la_fecha_de_la_primera_serie_dice_desde_cuando', () => {
    const desde = `${hoy().slice(0, 4)}-07-06`
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 47, desde }), true)).toBe(
      'Se borrarán también sus 47 series, apuntadas desde el 6 de julio.',
    )
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 1, desde }), true)).toBe(
      'Se borrará también su serie, apuntada desde el 6 de julio.',
    )
  })

  test('una_fecha_de_otro_año_lleva_el_año', () => {
    const anioPasado = Number(hoy().slice(0, 4)) - 1
    const aviso = avisoDeHueco({ series: 2, desde: `${anioPasado}-07-06` })
    expect(loQueSePierdeDelHueco(aviso, true)).toBe(
      `Se borrarán también sus 2 series, apuntadas desde el 6 de julio de ${anioPasado}.`,
    )
  })

  test('una_serie_que_vacia_su_sesion_ya_son_dos_cosas_en_plural', () => {
    const aviso = avisoDeHueco({ series: 1, sesiones_que_se_vacian: 1 })
    expect(loQueSePierdeDelHueco(aviso, true)).toBe(
      'Se borrarán también su serie, y 1 sesión que solo tenía series de este ejercicio.',
    )
  })

  test('cuenta_las_sesiones_que_se_vacian_detras_de_la_fecha', () => {
    const desde = `${hoy().slice(0, 4)}-07-06`
    const aviso = avisoDeHueco({ series: 9, desde, sesiones_que_se_vacian: 3 })
    expect(loQueSePierdeDelHueco(aviso, true)).toBe(
      'Se borrarán también sus 9 series, apuntadas desde el 6 de julio, ' +
        'y 3 sesiones que solo tenían series de este ejercicio.',
    )
  })

  test('si_aun_se_ve_en_la_rutina_ofrece_ocultarlo_y_cambiarlo', () => {
    expect(loQueSePierdeDelHueco(avisoDeHueco({ series: 4 }), false)).toBe(
      `Se borrarán también sus 4 series. ${OCULTALO}`,
    )
  })
})

function avisoDeEjercicio(cambios: Partial<AvisoDeBorrarEjercicio> = {}): AvisoDeBorrarEjercicio {
  return {
    sesiones: 0,
    notas: 0,
    huecos: [],
    sesiones_que_se_vacian: 0,
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
  test('sin_nada_que_perder_no_cuenta_nada_la_pregunta_basta', () => {
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio(), false)).toBeUndefined()
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio(), true)).toBeUndefined()
  })

  test('solo_una_nota_en_singular_y_ofrece_ocultarlo', () => {
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio({ notas: 1 }), false)).toBe(
      `Se borrará también tu nota. ${OCULTALO_EJERCICIO}`,
    )
  })

  test('varias_notas_en_plural', () => {
    expect(loQueSePierdeDelEjercicio(avisoDeEjercicio({ notas: 3 }), true)).toBe(
      'Se borrarán también tus 3 notas.',
    )
  })

  test('una_sola_sesion_en_singular', () => {
    const aviso = avisoDeEjercicio({ sesiones: 1 })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se borrarán también sus series de 1 sesión.',
    )
  })

  test('sesiones_y_notas_juntas', () => {
    const aviso = avisoDeEjercicio({ sesiones: 11, notas: 2 })
    expect(loQueSePierdeDelEjercicio(aviso, false)).toBe(
      `Se borrarán también sus series de 11 sesiones y tus 2 notas. ${OCULTALO_EJERCICIO}`,
    )
    const una = avisoDeEjercicio({ sesiones: 1, notas: 2 })
    expect(loQueSePierdeDelEjercicio(una, true)).toBe(
      'Se borrarán también sus series de 1 sesión y tus 2 notas.',
    )
  })

  test('dos_huecos_de_la_misma_rutina_cuentan_como_una_sola_rutina', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'comodin'), uso(1, 11, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe('Se quitará de la rutina donde se usa.')
  })

  test('en_dos_rutinas_distintas_habla_de_las_rutinas', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'comodin'), uso(2, 20, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe('Se quitará de las rutinas donde se usa.')
  })

  test('donde_es_el_principal_avisa_de_que_se_van_sus_alternativas', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'principal'), uso(2, 20, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se quitará de las rutinas donde se usa, con sus alternativas donde es el principal.',
    )
  })

  test('sin_ser_principal_en_ninguna_no_menciona_las_alternativas', () => {
    const aviso = avisoDeEjercicio({ huecos: [uso(1, 10, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).not.toContain('alternativas')
  })

  test('series_y_rutinas_juntas_se_unen_con_una_coma_y_una_y', () => {
    const aviso = avisoDeEjercicio({
      sesiones: 3,
      huecos: [uso(1, 10, 'principal')],
    })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se borrarán también sus series de 3 sesiones, y se quitará de la rutina donde se usa, ' +
        'con sus alternativas donde es el principal.',
    )
  })

  test('una_nota_y_una_rutina_el_verbo_sigue_en_singular_solo_si_hay_una_sola_cosa', () => {
    const aviso = avisoDeEjercicio({ notas: 1, huecos: [uso(1, 10, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se borrará también tu nota, y se quitará de la rutina donde se usa.',
    )
  })

  test('una_sesion_que_se_vacia', () => {
    const aviso = avisoDeEjercicio({
      sesiones: 1,
      sesiones_que_se_vacian: 1,
    })
    expect(loQueSePierdeDelEjercicio(aviso, true)).toBe(
      'Se borrarán también sus series de 1 sesión. Una sesión se quedará sin series y desaparecerá entera.',
    )
  })

  test('varias_sesiones_que_se_vacian', () => {
    const aviso = avisoDeEjercicio({
      sesiones: 5,
      sesiones_que_se_vacian: 3,
    })
    expect(loQueSePierdeDelEjercicio(aviso, false)).toBe(
      'Se borrarán también sus series de 5 sesiones. ' +
        '3 sesiones se quedarán sin series y desaparecerán enteras. ' +
        OCULTALO_EJERCICIO,
    )
  })

  test('oculto_no_ofrece_ocultarlo', () => {
    const aviso = avisoDeEjercicio({ notas: 2, huecos: [uso(1, 10, 'comodin')] })
    expect(loQueSePierdeDelEjercicio(aviso, true)).not.toContain('ocúltalo')
    expect(loQueSePierdeDelEjercicio(aviso, false)).toContain(OCULTALO_EJERCICIO)
  })
})
