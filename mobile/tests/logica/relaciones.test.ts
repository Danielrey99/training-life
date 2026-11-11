/**
 * Cómo se comportan las relaciones uno-a-muchos al borrar al padre: qué borra la base
 * por su cuenta (CASCADE) y qué impide (RESTRICT).
 *
 * Puerto de `backend/tests/test_relaciones.py`. Allí se probaba el ORM con la lista de
 * hijos cargada (ya dio un 500 real con los programas); aquí no hay ORM, así que se prueba
 * lo que queda debajo: que la propia base, con SQL directo, borra o se niega igual.
 */
import type { Bd } from '../../src/logica/bd/bd'
import { AHORA, baseNueva, predefinidos } from '../apoyo/baseNueva'
import {
  contar,
  filaAlternativa,
  filaEjercicio,
  filaEntrenamiento,
  filaHueco,
  filaPrograma,
  filaRutina,
  filaSerie,
  insertar,
} from '../apoyo/filas'

let bd: Bd
beforeEach(() => {
  bd = baseNueva()
})

/** Una rutina con un hueco que tiene un comodín, y una sesión con una serie. */
function rutinaConHueco() {
  const principal = filaEjercicio(bd, { nombre: 'Press banca' })
  const comodin = filaEjercicio(bd, { nombre: 'Press en máquina' })
  const rutina = filaRutina(bd)
  const hueco = filaHueco(bd, rutina, principal)
  filaAlternativa(bd, hueco, comodin)
  const entrenamiento = filaEntrenamiento(bd, rutina, { fecha: '2026-09-01' })
  filaSerie(bd, entrenamiento, hueco, principal)
  return { rutina, hueco, entrenamiento, principal, comodin }
}

const FK = 'FOREIGN KEY constraint failed'

test('borrar_un_entrenamiento_con_sus_series_cargadas_las_borra', () => {
  const { entrenamiento } = rutinaConHueco()
  expect(contar(bd, 'series')).toBe(1)

  bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', entrenamiento)

  expect(contar(bd, 'series')).toBe(0)
})

test('borrar_un_hueco_con_sus_comodines_cargados_los_borra', () => {
  const { hueco, entrenamiento } = rutinaConHueco()
  // Sin su sesión no quedan series en el hueco: con ellas, su FK (RESTRICT) lo impide.
  bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', entrenamiento)
  expect(contar(bd, 'slot_alternativas')).toBe(1)

  bd.ejecutar('DELETE FROM rutina_slots WHERE id = ?', hueco)

  expect(contar(bd, 'slot_alternativas')).toBe(0)
})

test('borrar_un_programa_con_sus_dias_y_periodos_cargados_los_borra', () => {
  // Con una fila de día cerrada y un periodo cerrado además de los vigentes.
  const push = filaRutina(bd)
  const programa = filaPrograma(bd)
  insertar(bd, 'programa_dias', { programa_id: programa, dia_semana: 1, rutina_id: push })
  insertar(bd, 'programa_dias', {
    programa_id: programa,
    dia_semana: 2,
    rutina_id: push,
    desde: '2026-08-01',
    hasta: '2026-09-01',
  })
  insertar(bd, 'programa_periodos', {
    programa_id: programa,
    desde: '2026-08-01',
    hasta: '2026-09-01',
  })
  insertar(bd, 'programa_periodos', { programa_id: programa, desde: '2026-09-07' })
  expect([contar(bd, 'programa_dias'), contar(bd, 'programa_periodos')]).toEqual([2, 2])

  bd.ejecutar('DELETE FROM programas WHERE id = ?', programa)

  expect([contar(bd, 'programa_dias'), contar(bd, 'programa_periodos')]).toEqual([0, 0])
  // La rutina no es hija del programa: se queda.
  expect(contar(bd, 'rutinas')).toBe(1)
})

test('borrar_una_rutina_con_sus_huecos_cargados_lo_sigue_impidiendo_la_base', () => {
  // Los huecos no se borran con su rutina: su FK es RESTRICT a propósito, y la lógica los
  // borra antes, explícitamente. Sin su sesión, que también la referencia (RESTRICT): así
  // lo único que bloquea es el hueco.
  const { rutina, entrenamiento } = rutinaConHueco()
  bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', entrenamiento)

  expect(() => bd.ejecutar('DELETE FROM rutinas WHERE id = ?', rutina)).toThrow(FK)

  expect([contar(bd, 'rutinas'), contar(bd, 'rutina_slots')]).toEqual([1, 1])
})

// --- Lo que el ORM del backend no dejaba ver: el resto de CASCADE y RESTRICT ---

test('un_hueco_con_series_no_se_borra', () => {
  const { hueco } = rutinaConHueco()

  expect(() => bd.ejecutar('DELETE FROM rutina_slots WHERE id = ?', hueco)).toThrow(FK)
  expect(contar(bd, 'slot_alternativas')).toBe(1)
})

test('una_rutina_con_sesiones_no_se_borra_aunque_no_tenga_huecos', () => {
  const rutina = filaRutina(bd)
  filaEntrenamiento(bd, rutina)

  expect(() => bd.ejecutar('DELETE FROM rutinas WHERE id = ?', rutina)).toThrow(FK)
})

test.each([
  ['es el principal de un hueco', 'principal'],
  ['es un comodín', 'comodin'],
] as const)('un_ejercicio_que_%s_no_se_borra', (_, cual) => {
  const ids = rutinaConHueco()
  bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', ids.entrenamiento)

  expect(() => bd.ejecutar('DELETE FROM ejercicios WHERE id = ?', ids[cual])).toThrow(FK)
})

test('un_ejercicio_con_series_no_se_borra_aunque_no_este_en_ningun_hueco', () => {
  const { hueco, entrenamiento } = rutinaConHueco()
  const suelto = filaEjercicio(bd, { nombre: 'Suelto' })
  filaSerie(bd, entrenamiento, hueco, suelto, { numero_serie: 2 })

  expect(() => bd.ejecutar('DELETE FROM ejercicios WHERE id = ?', suelto)).toThrow(FK)
})

test('borrar_un_ejercicio_borra_sus_notas', () => {
  const ejercicio = filaEjercicio(bd)
  insertar(bd, 'notas_ejercicio', {
    ejercicio_id: ejercicio,
    nota: 'Agarre cerrado',
    created_at: AHORA,
    updated_at: AHORA,
  })

  bd.ejecutar('DELETE FROM ejercicios WHERE id = ?', ejercicio)

  expect(contar(bd, 'notas_ejercicio')).toBe(0)
})

test('un_grupo_muscular_con_ejercicios_no_se_borra', () => {
  const ejercicio = filaEjercicio(bd)
  const grupo = bd.una<{ g: number }>(
    'SELECT grupo_muscular_id AS g FROM ejercicios WHERE id = ?',
    ejercicio,
  )!.g

  expect(() => bd.ejecutar('DELETE FROM grupos_musculares WHERE id = ?', grupo)).toThrow(FK)
})

test('borrar_una_rutina_borra_sus_dias_de_programa_excepciones_y_tramos_ocultos', () => {
  // Lo que es accesorio de la rutina (CASCADE): un día sin su rutina pasa a descanso, y
  // una excepción sin su rutina vuelve a lo que diga el programa.
  const rutina = filaRutina(bd)
  const otra = filaRutina(bd, { nombre: 'Pull' })
  const programa = filaPrograma(bd)
  insertar(bd, 'programa_dias', { programa_id: programa, dia_semana: 1, rutina_id: rutina })
  insertar(bd, 'programa_dias', { programa_id: programa, dia_semana: 2, rutina_id: otra })
  const excepcion = (fecha: string, id: number | null) =>
    insertar(bd, 'excepciones_del_plan', {
      fecha,
      rutina_id: id,
      created_at: AHORA,
      updated_at: AHORA,
    })
  excepcion('2026-09-01', rutina)
  excepcion('2026-09-02', null)
  insertar(bd, 'rutina_periodos_ocultos', {
    rutina_id: rutina,
    desde: '2026-08-01',
    hasta: '2026-08-10',
  })

  bd.ejecutar('DELETE FROM rutinas WHERE id = ?', rutina)

  expect(bd.todas('SELECT rutina_id FROM programa_dias')).toEqual([{ rutina_id: otra }])
  expect(bd.todas('SELECT fecha FROM excepciones_del_plan')).toEqual([{ fecha: '2026-09-02' }])
  expect(contar(bd, 'rutina_periodos_ocultos')).toBe(0)
  expect(contar(bd, 'programas')).toBe(1)
})

test('borrar_una_rutina_con_historial_en_orden_dentro_de_una_transaccion_no_choca', () => {
  // El orden que tiene que seguir la lógica con `modo=definitivo`: sesiones (y con ellas
  // sus series), huecos (y con ellos sus comodines) y por último la rutina.
  const { rutina } = rutinaConHueco()

  bd.transaccion(() => {
    bd.ejecutar('DELETE FROM entrenamientos WHERE rutina_id = ?', rutina)
    bd.ejecutar('DELETE FROM rutina_slots WHERE rutina_id = ?', rutina)
    bd.ejecutar('DELETE FROM rutinas WHERE id = ?', rutina)
  })

  const tablas = ['rutinas', 'rutina_slots', 'slot_alternativas', 'entrenamientos', 'series']
  expect(tablas.map((t) => contar(bd, t))).toEqual([0, 0, 0, 0, 0])
  expect(contar(bd, 'ejercicios')).toBe(predefinidos().ejercicios.length + 2)
})

test('un_borrado_que_choca_a_mitad_de_una_transaccion_no_deja_nada_a_medias', () => {
  // Las series se borrarían por su sesión, pero la rutina sigue teniendo su hueco.
  const { rutina } = rutinaConHueco()

  expect(() =>
    bd.transaccion(() => {
      bd.ejecutar('DELETE FROM entrenamientos WHERE rutina_id = ?', rutina)
      bd.ejecutar('DELETE FROM rutinas WHERE id = ?', rutina)
    }),
  ).toThrow(FK)

  expect([contar(bd, 'entrenamientos'), contar(bd, 'series')]).toEqual([1, 1])
})
