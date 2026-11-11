/**
 * Las medidas de la gráfica de progresión (H3) de `src/utiles/progresion.ts` (copia de la web,
 * que no tenía tests): qué medidas tiene cada tipo de ejercicio, cómo se convierte el valor a la
 * unidad elegida y cómo se escriben el valor, el cambio y el globo de cada una.
 */
import type { SesionHistorial, TipoRegistro } from '../../src/logica/tipos'
import { cambiarAjustes } from '../../src/utiles/ajustes'
import { enKilos, medidasDe, valorEnPantalla, type Medida } from '../../src/utiles/progresion'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

beforeEach(() => {
  cambiarAjustes({ unidad: 'kg', distancia: 'km', unoRM: 'media' })
})

type Medidas = {
  peso?: string | null
  repeticiones?: number | null
  duracion_s?: number | null
  distancia_m?: number | null
}

function sesion(...series: Medidas[]): SesionHistorial {
  return {
    entrenamiento_id: 1,
    fecha: '2026-11-10',
    rutina: 'Rutina',
    series: series.map((s) => ({
      peso: null,
      repeticiones: null,
      duracion_s: null,
      distancia_m: null,
      ...s,
    })),
  } as unknown as SesionHistorial
}

const claves = (tipo: TipoRegistro, sesiones: SesionHistorial[]) =>
  medidasDe(tipo, sesiones).map((m) => m.clave)

function medida(tipo: TipoRegistro, clave: string, sesiones: SesionHistorial[]): Medida {
  const encontrada = medidasDe(tipo, sesiones).find((m) => m.clave === clave)
  if (!encontrada) throw new Error(`no hay medida ${clave} para ${tipo}`)
  return encontrada
}

describe('medidasDe', () => {
  test('peso_y_reps_siempre_tiene_peso_volumen_y_1rm', () => {
    expect(claves('peso_reps', [])).toEqual(['peso', 'volumen', 'rm'])
    expect(claves('peso_reps', [sesion({ peso: '50.00', repeticiones: 8 })])).toEqual([
      'peso',
      'volumen',
      'rm',
    ])
  })

  test('corporal_sin_carga_en_ninguna_sesion_no_ofrece_la_carga', () => {
    const sin = [sesion({ repeticiones: 10 }), sesion({ repeticiones: 8, peso: '0.00' })]
    expect(claves('corporal', sin)).toEqual(['reps', 'total'])
    expect(claves('corporal', [])).toEqual(['reps', 'total'])
  })

  test('corporal_con_lastre_o_con_ayuda_en_alguna_sesion_ofrece_la_carga', () => {
    expect(
      claves('corporal', [
        sesion({ repeticiones: 10 }),
        sesion({ repeticiones: 8, peso: '10.00' }),
      ]),
    ).toEqual(['reps', 'total', 'carga'])
    // Una ayuda (peso negativo) también es carga.
    expect(claves('corporal', [sesion({ repeticiones: 8, peso: '-20.00' })])).toEqual([
      'reps',
      'total',
      'carga',
    ])
  })

  test('tiempo_sin_peso_solo_ofrece_tiempo_y_tiempo_total', () => {
    expect(claves('tiempo', [sesion({ duracion_s: 60 })])).toEqual(['tiempo', 'total'])
    expect(claves('tiempo', [sesion({ duracion_s: 60, peso: '0.00' })])).toEqual([
      'tiempo',
      'total',
    ])
  })

  test('tiempo_con_peso_en_alguna_sesion_ofrece_el_peso', () => {
    expect(
      claves('tiempo', [sesion({ duracion_s: 60 }), sesion({ duracion_s: 30, peso: '5.00' })]),
    ).toEqual(['tiempo', 'total', 'peso'])
  })

  test('cardio_sin_distancia_en_el_rango_solo_tiene_el_tiempo', () => {
    expect(claves('cardio', [sesion({ duracion_s: 1200 })])).toEqual(['tiempo'])
    expect(claves('cardio', [sesion({ duracion_s: 1200, distancia_m: 0 })])).toEqual(['tiempo'])
    expect(claves('cardio', [])).toEqual(['tiempo'])
  })

  test('cardio_con_distancia_en_alguna_sesion_tiene_distancia_tiempo_y_ritmo', () => {
    expect(
      claves('cardio', [
        sesion({ duracion_s: 600 }),
        sesion({ duracion_s: 1200, distancia_m: 3000 }),
      ]),
    ).toEqual(['distancia', 'tiempo', 'ritmo'])
  })
})

describe('valorEnPantalla', () => {
  const s = sesion({ peso: '100.00', repeticiones: 5 }, { peso: '80.00', repeticiones: 10 })

  test('los_kilos_salen_tal_cual_en_kg', () => {
    expect(valorEnPantalla(medida('peso_reps', 'peso', [s]), s)).toBe(100)
    expect(valorEnPantalla(medida('peso_reps', 'volumen', [s]), s)).toBe(1300)
  })

  test('los_kilos_pasan_a_libras_si_se_elige', () => {
    cambiarAjustes({ unidad: 'lb' })
    expect(valorEnPantalla(medida('peso_reps', 'peso', [s]), s)).toBeCloseTo(220.462, 3)
    expect(valorEnPantalla(medida('peso_reps', 'volumen', [s]), s)).toBeCloseTo(2866.006, 3)
  })

  test('las_repeticiones_y_los_segundos_no_se_convierten_en_libras', () => {
    cambiarAjustes({ unidad: 'lb' })
    const c = sesion({ repeticiones: 10 }, { repeticiones: 8 })
    expect(valorEnPantalla(medida('corporal', 'reps', [c]), c)).toBe(9)
    const t = sesion({ duracion_s: 45 })
    expect(valorEnPantalla(medida('tiempo', 'tiempo', [t]), t)).toBe(45)
  })

  test('la_distancia_va_en_la_unidad_de_distancia_y_no_en_la_de_peso', () => {
    const c = sesion({ duracion_s: 1695, distancia_m: 5200 })
    expect(valorEnPantalla(medida('cardio', 'distancia', [c]), c)).toBe(5.2)
    cambiarAjustes({ unidad: 'lb', distancia: 'mi' })
    expect(valorEnPantalla(medida('cardio', 'distancia', [c]), c)).toBeCloseTo(3.231, 3)
  })

  test('el_1rm_en_libras_se_convierte_y_la_media_o_la_mejor_salen_del_ajuste', () => {
    const rm = medida('peso_reps', 'rm', [s])
    expect(rm.rotulo).toBe('Media de las series')
    expect(valorEnPantalla(rm, s)).toBeCloseTo(111.667, 3)
    cambiarAjustes({ unoRM: 'mejor' })
    expect(rm.rotulo).toBe('La mejor serie')
    expect(valorEnPantalla(rm, s)).toBeCloseTo(116.667, 3)
    cambiarAjustes({ unidad: 'lb' })
    expect(valorEnPantalla(rm, s)).toBeCloseTo(116.667 * 2.20462, 2)
  })
})

describe('enKilos', () => {
  test('escribe_un_decimal_como_mucho_con_la_unidad_elegida', () => {
    expect(enKilos(26.666)).toBe('26,7 kg')
    expect(enKilos(80)).toBe('80 kg')
    expect(enKilos(0)).toBe('0 kg')
    cambiarAjustes({ unidad: 'lb' })
    expect(enKilos(220.462)).toBe('220,5 lb')
  })
})

describe('textos de peso_reps', () => {
  const s = sesion({ peso: '100.00', repeticiones: 5 }, { peso: '80.00', repeticiones: 10 })

  test('el_peso_se_escribe_y_su_globo_dice_las_reps_de_la_serie_mas_pesada', () => {
    const peso = medida('peso_reps', 'peso', [s])
    expect(peso.escribir(100)).toBe('100 kg')
    expect(peso.globo(s, 100)).toBe('100 kg × 5 reps')
  })

  test('con_una_sola_repeticion_el_globo_dice_1_rep', () => {
    const uno = sesion({ peso: '120.00', repeticiones: 1 })
    expect(medida('peso_reps', 'peso', [uno]).globo(uno, 120)).toBe('120 kg × 1 rep')
  })

  test('con_dos_series_del_mismo_peso_el_globo_da_las_reps_de_la_que_tiene_mas', () => {
    const dos = sesion({ peso: '80.00', repeticiones: 6 }, { peso: '80.00', repeticiones: 9 })
    expect(medida('peso_reps', 'peso', [dos]).globo(dos, 80)).toBe('80 kg × 9 reps')
  })

  test('el_volumen_suma_peso_por_reps_y_su_globo_es_solo_la_cifra', () => {
    const volumen = medida('peso_reps', 'volumen', [s])
    expect(volumen.valor(s)).toBe(1300)
    expect(volumen.escribir(1300)).toBe('1300 kg')
    expect(volumen.globo(s, 1300)).toBe('1300 kg')
  })

  test('el_volumen_ignora_las_series_sin_peso_o_sin_reps', () => {
    const mezcla = sesion({ peso: '50.00', repeticiones: 10 }, { peso: null, repeticiones: 20 })
    expect(medida('peso_reps', 'volumen', [mezcla]).valor(mezcla)).toBe(500)
  })

  test('el_cambio_lleva_signo_y_el_menos_es_el_tipografico', () => {
    const peso = medida('peso_reps', 'peso', [s])
    expect(peso.cambio(2.5)).toBe('+2,5 kg')
    expect(peso.cambio(-2.5)).toBe('−2,5 kg')
    expect(peso.cambio(0)).toBe('0 kg')
  })

  test('el_cambio_en_libras_usa_lb', () => {
    cambiarAjustes({ unidad: 'lb' })
    expect(medida('peso_reps', 'peso', [s]).cambio(5)).toBe('+5 lb')
  })
})

describe('textos de corporal', () => {
  const s = sesion(
    { repeticiones: 10, peso: '10.00' },
    { repeticiones: 8, peso: '5.00' },
    { repeticiones: 9 },
  )

  test('reps_es_la_media_por_serie_y_total_es_la_suma', () => {
    expect(medida('corporal', 'reps', [s]).valor(s)).toBe(9)
    expect(medida('corporal', 'total', [s]).valor(s)).toBe(27)
  })

  test('las_repeticiones_se_escriben_en_singular_solo_con_una', () => {
    const reps = medida('corporal', 'reps', [s])
    expect(reps.escribir(1)).toBe('1 rep')
    expect(reps.escribir(9)).toBe('9 reps')
    expect(reps.escribir(9.5)).toBe('9,5 reps')
    expect(reps.globo(s, 8.5)).toBe('8,5 reps')
  })

  test('el_cambio_de_repeticiones_lleva_signo', () => {
    const total = medida('corporal', 'total', [s])
    expect(total.cambio(3)).toBe('+3 reps')
    expect(total.cambio(-1)).toBe('−1 rep')
    expect(total.cambio(0)).toBe('0 reps')
  })

  test('la_carga_es_la_mas_alta_y_las_series_sin_peso_cuentan_como_cero', () => {
    const carga = medida('corporal', 'carga', [s])
    expect(carga.valor(s)).toBe(10)
    const soloSinPeso = sesion({ repeticiones: 10 })
    expect(carga.valor(soloSinPeso)).toBe(0)
  })

  test('la_carga_se_escribe_con_lastre_con_ayuda_o_sin_carga', () => {
    const carga = medida('corporal', 'carga', [s])
    expect(carga.escribir(10)).toBe('10 kg')
    expect(carga.escribir(-20)).toBe('20 kg de ayuda')
    expect(carga.escribir(0)).toBe('sin carga')
    expect(carga.globo(s, -20)).toBe('20 kg de ayuda')
    expect(carga.cambio(5)).toBe('+5 kg')
    expect(carga.cambio(-5)).toBe('−5 kg')
  })

  test('con_ayuda_la_carga_mas_alta_es_la_menos_negativa', () => {
    // Menos ayuda es progreso: -20 es «más alta» que -30.
    const ayuda = sesion({ repeticiones: 5, peso: '-30.00' }, { repeticiones: 5, peso: '-20.00' })
    expect(medida('corporal', 'carga', [ayuda]).valor(ayuda)).toBe(-20)
  })
})

describe('textos de tiempo', () => {
  const s = sesion({ duracion_s: 45 }, { duracion_s: 90 })

  test('el_tiempo_es_la_media_redondeada_y_el_total_es_la_suma', () => {
    const tiempo = medida('tiempo', 'tiempo', [s])
    const total = medida('tiempo', 'total', [s])
    expect(tiempo.valor(s)).toBe(67.5)
    expect(tiempo.escribir(67.5)).toBe('1 min 8 s')
    expect(tiempo.globo(s, 67.5)).toBe('1 min 8 s')
    expect(total.valor(s)).toBe(135)
    expect(total.escribir(135)).toBe('2 min 15 s')
    expect(total.enMinutos).toBe(true)
    expect(tiempo.enMinutos).toBeUndefined()
  })

  test('el_cambio_de_tiempo_lleva_signo_y_redondea_a_segundos', () => {
    const tiempo = medida('tiempo', 'tiempo', [s])
    expect(tiempo.cambio(15)).toBe('+15 s')
    expect(tiempo.cambio(-15)).toBe('−15 s')
    expect(tiempo.cambio(0)).toBe('0 s')
    expect(tiempo.cambio(75)).toBe('+1 min 15 s')
    expect(tiempo.cambio(-0.4)).toBe('−0 s')
  })

  test('el_peso_de_un_ejercicio_de_tiempo_es_la_carga_mas_alta', () => {
    const conPeso = sesion({ duracion_s: 30, peso: '5.00' }, { duracion_s: 30, peso: '10.00' })
    const peso = medida('tiempo', 'peso', [conPeso])
    expect(peso.valor(conPeso)).toBe(10)
    expect(peso.escribir(10)).toBe('10 kg')
    expect(peso.globo(conPeso, 10)).toBe('10 kg')
  })
})

describe('textos de cardio', () => {
  const s = sesion({ duracion_s: 1695, distancia_m: 5200 })

  test('la_distancia_se_suma_y_se_escribe_con_su_unidad', () => {
    const doble = sesion(
      { duracion_s: 600, distancia_m: 2000 },
      { duracion_s: 600, distancia_m: 3200 },
    )
    const distancia = medida('cardio', 'distancia', [doble])
    expect(distancia.valor(doble)).toBe(5.2)
    expect(distancia.escribir(5.2)).toBe('5,2 km')
    expect(distancia.globo(doble, 5.2)).toBe('5,2 km')
    expect(distancia.cambio(0.5)).toBe('+0,5 km')
    expect(distancia.cambio(-1.25)).toBe('−1,25 km')
    expect(distancia.cambio(0)).toBe('0 km')
  })

  test('la_distancia_en_millas_usa_mi', () => {
    cambiarAjustes({ distancia: 'mi' })
    const distancia = medida('cardio', 'distancia', [s])
    expect(distancia.escribir(3.23)).toBe('3,23 mi')
  })

  test('el_tiempo_de_cardio_es_la_suma_en_minutos', () => {
    const tiempo = medida('cardio', 'tiempo', [s])
    expect(tiempo.valor(s)).toBe(1695)
    expect(tiempo.escribir(1695)).toBe('28 min 15 s')
    expect(tiempo.enMinutos).toBe(true)
  })

  test('el_ritmo_es_segundos_por_km_y_su_eje_va_sin_unidad', () => {
    const ritmo = medida('cardio', 'ritmo', [s])
    expect(ritmo.valor(s)).toBeCloseTo(325.96, 2)
    expect(ritmo.escribir(ritmo.valor(s))).toBe('5:26 min/km')
    expect(ritmo.globo(s, ritmo.valor(s))).toBe('5:26 min/km')
    expect(ritmo.marca?.(ritmo.valor(s))).toBe('5:26')
    expect(ritmo.marca?.(300)).toBe('5:00')
    expect(ritmo.marca?.(59.6)).toBe('1:00')
  })

  test('el_ritmo_en_millas_usa_la_milla_y_su_marca_tambien_va_sin_unidad', () => {
    cambiarAjustes({ distancia: 'mi' })
    const dos = sesion({ duracion_s: 1800, distancia_m: 3218.688 })
    const ritmo = medida('cardio', 'ritmo', [dos])
    expect(ritmo.valor(dos)).toBeCloseTo(900, 5)
    expect(ritmo.escribir(900)).toBe('15:00 min/mi')
    expect(ritmo.marca?.(900)).toBe('15:00')
  })

  test('el_ritmo_solo_cuenta_las_series_que_llevan_distancia', () => {
    // La serie de calentamiento sin distancia no entra ni en el tiempo ni en los metros.
    const mezcla = sesion({ duracion_s: 600 }, { duracion_s: 1500, distancia_m: 5000 })
    expect(medida('cardio', 'ritmo', [mezcla]).valor(mezcla)).toBe(300)
  })

  test('el_cambio_de_ritmo_lleva_signo_sin_invertirlo', () => {
    const ritmo = medida('cardio', 'ritmo', [s])
    expect(ritmo.cambio(-15)).toBe('−0:15 min/km')
    expect(ritmo.cambio(30)).toBe('+0:30 min/km')
    expect(ritmo.cambio(0)).toBe('0:00 min/km')
  })

  test('el_ritmo_y_la_distancia_solo_aplican_a_sesiones_con_distancia', () => {
    const sin = sesion({ duracion_s: 600 })
    const con = sesion({ duracion_s: 600, distancia_m: 1000 })
    const todas = [sin, con]
    const distancia = medida('cardio', 'distancia', todas)
    const ritmo = medida('cardio', 'ritmo', todas)
    const tiempo = medida('cardio', 'tiempo', todas)
    expect(distancia.aplica?.(sin)).toBe(false)
    expect(distancia.aplica?.(con)).toBe(true)
    expect(ritmo.aplica?.(sin)).toBe(false)
    expect(ritmo.aplica?.(con)).toBe(true)
    expect(tiempo.aplica).toBeUndefined()
  })

  test('los_pasos_del_eje_del_ritmo_son_segundos_que_se_leen_bien', () => {
    const ritmo = medida('cardio', 'ritmo', [s])
    expect(ritmo.pasos).toEqual([1, 2, 5, 10, 15, 30, 60, 120, 300])
  })
})
