import {
  alApuntar,
  apuntarFallo,
  cargarFallo,
  ultimoFallo,
  type Fallo,
} from '../../src/logica/rastro'

beforeEach(() => {
  cargarFallo(null)
  alApuntar(null)
})

test('apuntar_un_error_guarda_la_hora_el_detalle_y_la_pila_recortada', () => {
  const error = new TypeError('no es una función')
  error.stack = 'x'.repeat(5000)

  apuntarFallo(error, '2026-11-12T10:00:00.000Z')

  const fallo = ultimoFallo()
  expect(fallo?.cuando).toBe('2026-11-12T10:00:00.000Z')
  expect(fallo?.detalle).toBe('TypeError: no es una función')
  expect(fallo?.pila).toHaveLength(2000)
})

test('un_valor_que_no_es_un_error_queda_sin_pila', () => {
  apuntarFallo('se rompió', '2026-11-12T10:00:00.000Z')

  expect(ultimoFallo()).toEqual({
    cuando: '2026-11-12T10:00:00.000Z',
    detalle: 'se rompió',
    pila: null,
  })
})

test('apuntar_el_mismo_objeto_dos_veces_solo_guarda_una', () => {
  const guardados: Fallo[] = []
  alApuntar((f) => guardados.push(f))
  const error = new Error('uno')

  apuntarFallo(error)
  apuntarFallo(error)
  expect(guardados).toHaveLength(1)

  apuntarFallo(new Error('otro'))
  expect(guardados).toHaveLength(2)
  expect(ultimoFallo()?.detalle).toBe('Error: otro')
})

test('si_la_accion_de_guardar_lanza_el_fallo_queda_en_memoria_y_no_se_propaga', () => {
  alApuntar(() => {
    throw new Error('disco lleno')
  })

  expect(() => apuntarFallo(new Error('el de verdad'))).not.toThrow()
  expect(ultimoFallo()?.detalle).toBe('Error: el de verdad')
})

test('cargar_un_fallo_lo_deja_como_ultimo_sin_llamar_a_la_accion', () => {
  const accion = jest.fn()
  alApuntar(accion)
  const guardado: Fallo = {
    cuando: '2026-11-11T08:00:00.000Z',
    detalle: 'Error: viejo',
    pila: null,
  }

  cargarFallo(guardado)

  expect(ultimoFallo()).toBe(guardado)
  expect(accion).not.toHaveBeenCalled()
})

test('cargar_null_deja_el_rastro_vacio', () => {
  apuntarFallo(new Error('algo'))
  cargarFallo(null)

  expect(ultimoFallo()).toBeNull()
})
