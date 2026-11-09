/**
 * Las cuentas del *Guardar* de los modos de editar, sin base de datos. Puerto de
 * `backend/tests/test_ediciones.py`. En TS los diccionarios son `Map`, las tuplas son
 * listas y `motivoDeLaFecha` recibe «hoy» al final.
 *
 * Diferencia con el backend: allí el peso llega como `Decimal` y Python compara 62,5 con
 * 62,50 como números; aquí quien llama ya lo pasa a centésimas (`aCentesimas`), y así se
 * prueba.
 */
import { aCentesimas } from '../../../src/logica/reglas/centesimas'
import {
  cambiosDeSeries,
  diasQueCambian,
  mezclaEnHueco,
  motivoDeLaFecha,
  repartoDelOrden,
  type SerieComparable,
} from '../../../src/logica/reglas/ediciones'
import { fechaEnTexto } from '../../../src/logica/reglas/fechas'

const HOY = '2026-11-09'

const mapa = (o: Record<number, number>) =>
  new Map(Object.entries(o).map(([k, v]) => [Number(k), v] as [number, number]))

// --- diasQueCambian --------------------------------------------------------------

test('dias_que_cambian_da_los_cambiados_los_nuevos_y_los_que_pasan_a_descanso', () => {
  const vigentes = mapa({ 1: 10, 3: 20, 5: 30 })
  const pedidos = mapa({ 1: 11, 3: 20, 6: 30 })

  expect(diasQueCambian(vigentes, pedidos)).toEqual([
    [1, 11],
    [5, null],
    [6, 30],
  ])
})

test.each([[{}], [{ 1: 10, 7: 10 }]])(
  'dias_que_cambian_con_la_misma_semana_no_da_ninguno (%j)',
  (semana: Record<number, number>) => {
    expect(diasQueCambian(mapa(semana), mapa({ ...semana }))).toEqual([])
  },
)

test('dias_que_cambian_va_del_lunes_al_domingo', () => {
  // En orden: el servicio los cambia en ese orden, uno detrás de otro.
  expect(diasQueCambian(new Map(), mapa({ 7: 1, 2: 1, 5: 1 }))).toEqual([
    [2, 1],
    [5, 1],
    [7, 1],
  ])
})

// --- repartoDelOrden -------------------------------------------------------------

test('reparto_del_orden_reparte_los_orden_que_ya_tenian', () => {
  // Los visibles tienen 1, 2 y 5 (el 3 y el 4 son de ocultos): se los reparten en el orden
  // pedido, y nadie toca el 3 ni el 4.
  expect(repartoDelOrden(mapa({ 7: 1, 8: 2, 9: 5 }), [9, 7, 8])).toEqual(mapa({ 9: 1, 7: 2, 8: 5 }))
})

test.each([[{}], [{ 7: 1, 8: 2, 9: 5 }]])(
  'reparto_del_orden_sin_cambios_es_vacio (%j)',
  (visibles: Record<number, number>) => {
    const m = mapa(visibles)
    const enSuOrden = [...m.keys()].sort((a, b) => m.get(a)! - m.get(b)!)
    expect(repartoDelOrden(m, enSuOrden)).toEqual(new Map())
  },
)

test.each([
  ['falta uno', [7, 8]],
  ['sobra uno', [7, 8, 9, 10]],
  ['repetido en vez de otro', [7, 7, 9]],
  ['repetido de más', [7, 8, 9, 9]],
  ['uno ajeno', [10, 8, 9]],
])('reparto_del_orden_sin_ser_exactamente_los_visibles_es_none (%s)', (_, slotIds) => {
  expect(repartoDelOrden(mapa({ 7: 1, 8: 2, 9: 5 }), slotIds)).toBeNull()
})

// --- cambiosDeSeries -------------------------------------------------------------

interface Datos {
  ejercicio?: number
  hueco?: number
  numero?: number
  peso?: string | null
  reps?: number
}

/** Una serie como la lee el servicio de la base: el peso, en centésimas. */
function guardada(
  { ejercicio = 1, hueco = 1, numero = 1, peso = '60.00', reps = 8 }: Datos = {},
  campos: Partial<SerieComparable> = {},
): SerieComparable {
  return {
    ejercicio_id: ejercicio,
    slot_id: hueco,
    numero_serie: numero,
    peso: peso === null ? null : aCentesimas(peso),
    repeticiones: reps,
    duracion_s: null,
    distancia_m: null,
    peso_corporal: null,
    variante: null,
    ...campos,
  }
}

test('cambios_de_series_separa_borrar_cambiar_crear_y_ajenas', () => {
  const guardadas = new Map([
    [1, guardada({ numero: 1 })],
    [2, guardada({ numero: 2 })],
    [3, guardada({ numero: 3 })],
  ])
  const igual = { id: 1, ...guardada({ numero: 1 }) }
  const cambiada = { id: 2, ...guardada({ numero: 2, reps: 6 }) }
  const nueva = { id: null, ...guardada({ numero: 4 }) }
  const ajena = { id: 99, ...guardada({ numero: 5 }) }

  const [aBorrar, aCambiar, aCrear, ajenas] = cambiosDeSeries(guardadas, [
    igual,
    cambiada,
    nueva,
    ajena,
  ])
  expect(aBorrar).toEqual([3])
  // Las mismas series que se pidieron, no copias: el servicio escribe con ellas.
  expect(aCambiar).toHaveLength(1)
  expect(aCambiar[0]).toBe(cambiada)
  expect(aCrear).toHaveLength(1)
  expect(aCrear[0]).toBe(nueva)
  expect(ajenas).toEqual([99])
})

test.each([
  ['ejercicio_id', 2],
  ['slot_id', 2],
  ['numero_serie', 2],
  ['peso', aCentesimas('60.5')],
  ['repeticiones', 9],
  ['duracion_s', 30],
  ['distancia_m', 100],
  ['peso_corporal', aCentesimas('80')],
  ['variante', 'Agarre cerrado'],
])('cualquier_campo_distinto_cambia_la_serie (%s)', (campo, valor) => {
  const pedida = { id: 1, ...guardada(), [campo]: valor }

  expect(cambiosDeSeries(new Map([[1, guardada()]]), [pedida])).toEqual([[], [pedida], [], []])
})

test('el_peso_se_compara_como_numero', () => {
  // 62,5 pedido y 62,50 guardado son el mismo peso. Solo se ve aquí: por la api, la serie
  // contada como cambiada se reescribiría con el mismo valor y nada lo notaría.
  const pedida = { id: 1, ...guardada({ peso: '62.5' }) }

  expect(cambiosDeSeries(new Map([[1, guardada({ peso: '62.50' })]]), [pedida])).toEqual([
    [],
    [],
    [],
    [],
  ])
})

test('un_campo_ausente_y_uno_nulo_son_lo_mismo', () => {
  // Propio del móvil: en Python un campo que no viene en el esquema vale None; en TS puede
  // llegar como `undefined`, y no por eso la serie ha cambiado.
  const sinVariante: Record<string, unknown> = { id: 1, ...guardada() }
  delete sinVariante.variante
  const pedida = sinVariante as SerieComparable

  expect(cambiosDeSeries(new Map([[1, guardada()]]), [pedida])).toEqual([[], [], [], []])
})

// --- mezclaEnHueco ---------------------------------------------------------------

test('la_mezcla_en_un_hueco_tocado_da_los_dos_primeros_ejercicios', () => {
  const finales: [number, number][] = [
    [2, 20],
    [1, 10],
    [1, 11],
    [1, 12],
  ]
  expect(mezclaEnHueco(finales, new Set([1]))).toEqual([10, 11])
})

test('la_mezcla_en_un_hueco_que_no_se_toca_no_cuenta', () => {
  // Una sesión ya mezclada en la que solo se corrige un peso no se bloquea.
  const mezclada: [number, number][] = [
    [1, 10],
    [1, 11],
    [2, 20],
  ]
  expect(mezclaEnHueco(mezclada, new Set([2]))).toBeNull()
  expect(mezclaEnHueco(mezclada.slice(0, 2), new Set())).toBeNull()
})

// --- motivoDeLaFecha -------------------------------------------------------------

// Lo del lunes 14 de septiembre se entrena del lunes 14 al domingo 20.
const LUNES = '2026-09-14'
const DOMINGO = '2026-09-20'

const enTexto = (fecha: string) => fechaEnTexto(fecha, HOY)

// Puertos de `solo_puede_ir` y `no_seguias_el_programa` de `backend/tests/ayudas.py`.
function soloPuedeIr(rutina: string, contado: string, hacia: string, limite: string): string {
  return (
    `Este ${rutina} cuenta como el del ${enTexto(contado)}, así que solo puede ir` +
    ` ${hacia} el ${enTexto(limite)}.`
  )
}

function noSeguiasElPrograma(rutina: string, contado: string, nueva: string): string {
  return (
    `Este ${rutina} cuenta como el del ${enTexto(contado)}, y el ${enTexto(nueva)} no` +
    ' seguías el mismo programa que ese día. Solo se puede mover a un día en que lo' +
    ' siguieras.'
  )
}

test('despues_del_plazo_dice_hasta_donde_puede_ir', () => {
  const motivo = motivoDeLaFecha('Push', LUNES, '2026-09-21', LUNES, DOMINGO, HOY)

  expect(motivo).toBe(soloPuedeIr('Push', LUNES, 'hasta', DOMINGO))
  // Y literal, para no depender solo de `fechaEnTexto`.
  expect(motivo).toBe(
    'Este Push cuenta como el del lunes 14 de septiembre, así que solo puede ir hasta el' +
      ' domingo 20 de septiembre.',
  )
})

test('antes_del_plazo_dice_desde_donde_puede_ir', () => {
  // Lo del viernes 18 se adelanta como mucho hasta el lunes 14 de su semana.
  const viernes = '2026-09-18'

  expect(motivoDeLaFecha('Leg', viernes, '2026-09-13', LUNES, '2026-09-24', HOY)).toBe(
    soloPuedeIr('Leg', viernes, 'desde', LUNES),
  )
})

test.each([LUNES, DOMINGO])('dentro_del_plazo_el_motivo_es_el_programa (%s)', (nueva) => {
  // Los dos extremos del plazo cuentan como dentro.
  expect(motivoDeLaFecha('Push', LUNES, nueva, LUNES, DOMINGO, HOY)).toBe(
    noSeguiasElPrograma('Push', LUNES, nueva),
  )
})

test('el_motivo_lleva_el_anio_si_hoy_es_de_otro_anio', () => {
  // Propio del móvil: el año de las fechas lo decide el «hoy» que se pasa.
  expect(motivoDeLaFecha('Push', LUNES, '2026-09-21', LUNES, DOMINGO, '2027-01-02')).toBe(
    'Este Push cuenta como el del lunes 14 de septiembre de 2026, así que solo puede ir' +
      ' hasta el domingo 20 de septiembre de 2026.',
  )
})
