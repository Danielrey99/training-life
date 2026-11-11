/**
 * El objetivo de un ejercicio en el formulario de la rutina (`src/reglasDePantalla/objetivos.ts`,
 * copia de `web/src/paginas/programas/objetivos.ts`): en qué unidad va según el tipo, cómo pasa
 * de la API al formulario y vuelta, con qué empieza uno nuevo, qué no vale (con los mismos
 * límites que la validación de la lógica) y su resumen.
 */
import type { Ejercicio, Objetivo, TipoRegistro } from '../../src/logica/tipos'
import {
  aObjetivo,
  deAjustes,
  enTexto,
  familiaDe,
  queFaltaDelObjetivo,
  resumenDelObjetivo,
  type Familia,
  type ObjetivoEnTexto,
} from '../../src/reglasDePantalla/objetivos'
import { cambiarAjustes, POR_DEFECTO } from '../../src/utiles/ajustes'
import { objetivo as objetivoEnTexto } from '../../src/utiles/textos'

jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)

beforeEach(() => {
  cambiarAjustes({ objetivoNuevo: POR_DEFECTO.objetivoNuevo })
})

function ejercicio(tipo: TipoRegistro): Ejercicio {
  return {
    id: 1,
    nombre: 'Press banca',
    grupo_muscular_id: 1,
    descripcion: null,
    es_predefinido: false,
    tipo_registro: tipo,
    oculto_desde: null,
    created_at: '2026-01-01T10:00:00+00:00',
    updated_at: '2026-01-01T10:00:00+00:00',
  }
}

const texto = (series: string, min: string, max: string): ObjetivoEnTexto => ({ series, min, max })

describe('familiaDe', () => {
  test.each<[TipoRegistro, Familia]>([
    ['peso_reps', 'repeticiones'],
    ['corporal', 'repeticiones'],
    ['tiempo', 'duracion'],
    ['cardio', 'duracion'],
  ])('un ejercicio de %s va por %s', (tipo, familia) => {
    expect(familiaDe({ tipo_registro: tipo })).toBe(familia)
  })
})

describe('enTexto', () => {
  test('un objetivo por repeticiones pasa sus reps al formulario', () => {
    const objetivo: Objetivo = {
      series_objetivo: 4,
      reps_min: 6,
      reps_max: 10,
      duracion_min_s: null,
      duracion_max_s: null,
    }
    expect(enTexto(objetivo)).toEqual(texto('4', '6', '10'))
  })

  test('un objetivo por duración pasa sus segundos al formulario', () => {
    const objetivo: Objetivo = {
      series_objetivo: 3,
      reps_min: null,
      reps_max: null,
      duracion_min_s: 30,
      duracion_max_s: 45,
    }
    expect(enTexto(objetivo)).toEqual(texto('3', '30', '45'))
  })

  test('sin reps ni duración, el mínimo y el máximo quedan vacíos y no «null»', () => {
    const objetivo: Objetivo = {
      series_objetivo: 3,
      reps_min: null,
      reps_max: null,
      duracion_min_s: null,
      duracion_max_s: null,
    }
    expect(enTexto(objetivo)).toEqual(texto('3', '', ''))
  })
})

describe('deAjustes', () => {
  test.each<[TipoRegistro, ObjetivoEnTexto]>([
    ['peso_reps', texto('3', '8', '12')],
    ['corporal', texto('3', '6', '10')],
    ['tiempo', texto('3', '30', '60')],
    ['cardio', texto('1', '1200', '1800')],
  ])(
    'un ejercicio nuevo de %s empieza con el objetivo por defecto de su tipo',
    (tipo, esperado) => {
      expect(deAjustes({ tipo_registro: tipo })).toEqual(esperado)
    },
  )

  test('sigue lo que se cambió en los ajustes para ese tipo y no los demás', () => {
    cambiarAjustes({
      objetivoNuevo: { ...POR_DEFECTO.objetivoNuevo, tiempo: { series: 5, min: 20, max: 40 } },
    })
    expect(deAjustes({ tipo_registro: 'tiempo' })).toEqual(texto('5', '20', '40'))
    expect(deAjustes({ tipo_registro: 'cardio' })).toEqual(texto('1', '1200', '1800'))
  })
})

describe('aObjetivo', () => {
  test('por repeticiones, rellena las reps y deja nula la duración', () => {
    expect(aObjetivo('repeticiones', texto('3', '8', '12'))).toEqual({
      series_objetivo: 3,
      reps_min: 8,
      reps_max: 12,
      duracion_min_s: null,
      duracion_max_s: null,
    })
  })

  test('por duración, rellena los segundos y deja nulas las reps', () => {
    expect(aObjetivo('duracion', texto('1', '1200', '1800'))).toEqual({
      series_objetivo: 1,
      reps_min: null,
      reps_max: null,
      duracion_min_s: 1200,
      duracion_max_s: 1800,
    })
  })

  test('lee lo tecleado con espacios y con coma decimal', () => {
    expect(aObjetivo('repeticiones', texto(' 3 ', '7,5', '12'))).toEqual({
      series_objetivo: 3,
      reps_min: 7.5,
      reps_max: 12,
      duracion_min_s: null,
      duracion_max_s: null,
    })
  })
})

describe('queFaltaDelObjetivo', () => {
  const SERIES =
    'El objetivo de Press banca: las series tienen que ser un número entero entre 1 y 50.'
  const REPS =
    'El objetivo de Press banca: las repeticiones tienen que ser números enteros entre 1 y 1000.'
  const DURACION = 'El objetivo de Press banca: la duración tiene que ir de 1 segundo a 24 horas.'

  test.each<[string, Familia, ObjetivoEnTexto, string | null]>([
    ['series vacías', 'repeticiones', texto('', '8', '12'), SERIES],
    ['cero series', 'repeticiones', texto('0', '8', '12'), SERIES],
    ['51 series', 'duracion', texto('51', '30', '60'), SERIES],
    ['series no enteras', 'repeticiones', texto('2,5', '8', '12'), SERIES],
    ['series que no son un número', 'repeticiones', texto('tres', '8', '12'), SERIES],
    ['reps mínimas a cero', 'repeticiones', texto('3', '0', '12'), REPS],
    ['reps máximas por encima de 1000', 'repeticiones', texto('3', '8', '1001'), REPS],
    ['reps no enteras', 'repeticiones', texto('3', '8,5', '12'), REPS],
    ['reps máximas vacías', 'repeticiones', texto('3', '8', ''), REPS],
    ['duración a cero', 'duracion', texto('3', '0', '60'), DURACION],
    ['duración de más de 24 horas', 'duracion', texto('3', '30', '86401'), DURACION],
    ['duración no entera', 'duracion', texto('3', '30,5', '60'), DURACION],
    // Más de 1000 vale en duración (son segundos), y es lo que lleva el cardio por defecto.
    ['1200 segundos', 'duracion', texto('1', '1200', '1800'), null],
    ['los límites justos de reps', 'repeticiones', texto('50', '1', '1000'), null],
    ['los límites justos de duración', 'duracion', texto('1', '1', '86400'), null],
    ['mínimo igual que el máximo', 'repeticiones', texto('3', '8', '8'), null],
  ])('%s', (_caso, familia, objetivo, esperado) => {
    expect(queFaltaDelObjetivo('Press banca', familia, objetivo)).toBe(esperado)
  })

  test('las repeticiones máximas no pueden ser menos que las mínimas', () => {
    expect(queFaltaDelObjetivo('Press banca', 'repeticiones', texto('3', '12', '8'))).toBe(
      'El objetivo de Press banca: las repeticiones máximas no pueden ser menos que las mínimas.',
    )
  })

  test('la duración máxima no puede ser menos que la mínima', () => {
    expect(queFaltaDelObjetivo('Plancha', 'duracion', texto('3', '60', '30'))).toBe(
      'El objetivo de Plancha: la duración máxima no puede ser menos que la mínima.',
    )
  })
})

describe('resumenDelObjetivo', () => {
  test('si el objetivo no vale todavía, sale una raya', () => {
    expect(resumenDelObjetivo(ejercicio('peso_reps'), texto('3', '12', '8'))).toBe('—')
  })

  test('por repeticiones, el texto del objetivo', () => {
    const resumen = resumenDelObjetivo(ejercicio('corporal'), texto('4', '6', '10'))
    expect(resumen).toBe('4 × 6-10')
    expect(resumen).toBe(objetivoEnTexto(aObjetivo('repeticiones', texto('4', '6', '10'))))
  })

  test('por duración, el texto del objetivo en segundos o minutos', () => {
    const resumen = resumenDelObjetivo(ejercicio('cardio'), texto('1', '1200', '1800'))
    expect(resumen).toBe('1 × 20-30 min')
    expect(resumen).toBe(objetivoEnTexto(aObjetivo('duracion', texto('1', '1200', '1800'))))
  })

  test('el mismo texto vale o no según el tipo del ejercicio', () => {
    // 2000 es demasiado para unas repeticiones, pero son 33 min 20 s de un ejercicio de tiempo.
    expect(resumenDelObjetivo(ejercicio('peso_reps'), texto('1', '1200', '2000'))).toBe('—')
    expect(resumenDelObjetivo(ejercicio('tiempo'), texto('1', '1200', '2000'))).toBe(
      '1 × 20 min-33 min 20 s',
    )
  })
})
