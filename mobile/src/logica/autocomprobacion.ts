/**
 * Comprobaciones de que el SQLite y el JavaScript donde corre la app se portan como
 * espera la lógica. Los tests corren en Node, con otro SQLite y otro motor de JavaScript
 * que los del teléfono: esto repite en el teléfono, en una base en memoria, lo que los
 * tests dan por hecho. Lo enseña la pantalla oculta de autocomprobación.
 */
import type { Bd } from './bd/bd'
import { copiarBase } from './bd/copias'
import {
  aplicarMigraciones,
  MIGRACIONES,
  MigracionPeligrosa,
  VERSION_ACTUAL,
  versionDeLaBase,
  type Migracion,
} from './bd/migraciones'
import { rehacerTabla } from './bd/rehacer'
import { sincronizarPredefinidos, type ListaDePredefinidos } from './bd/siembra'
import { hoyEn, zonaValida } from './reglas/zonas'
import { ordenarPorNombre } from './reglas/orden'
import { aCentesimas } from './reglas/centesimas'
import { sumarDias } from './reglas/dias'

export interface Resultado {
  nombre: string
  bien: boolean
  detalle: string
}

const AHORA = '2026-01-01T00:00:00.000Z'

function lanza(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Monta una rutina con un hueco y una sesión con una serie. Devuelve sus ids. */
function montarSesion(bd: Bd) {
  const ejercicio = bd.una<{ id: number }>('SELECT id FROM ejercicios ORDER BY id LIMIT 1')!.id
  const rutina = bd.ejecutar(
    'INSERT INTO rutinas (nombre, created_at, updated_at) VALUES (?, ?, ?)',
    'Prueba',
    AHORA,
    AHORA,
  ).ultimoId
  const slot = bd.ejecutar(
    'INSERT INTO rutina_slots (rutina_id, ejercicio_principal_id, orden, series_objetivo,' +
      ' reps_min, reps_max, created_at, updated_at) VALUES (?, ?, 1, 3, 8, 12, ?, ?)',
    rutina,
    ejercicio,
    AHORA,
    AHORA,
  ).ultimoId
  const sesion = bd.ejecutar(
    'INSERT INTO entrenamientos (rutina_id, fecha, created_at, updated_at) VALUES (?, ?, ?, ?)',
    rutina,
    // Cada sesión, un día distinto: la fecha es única.
    sumarDias('2026-01-05', rutina),
    AHORA,
    AHORA,
  ).ultimoId
  bd.ejecutar(
    'INSERT INTO series (entrenamiento_id, slot_id, ejercicio_id, numero_serie, peso_centesimas,' +
      ' repeticiones, created_at, updated_at) VALUES (?, ?, ?, 1, 8000, 10, ?, ?)',
    sesion,
    slot,
    ejercicio,
    AHORA,
    AHORA,
  )
  return { ejercicio, rutina, slot, sesion }
}

/**
 * Pasa todas las comprobaciones sobre `bd`, que tiene que ser una base nueva y vacía (se
 * escribe en ella). `predefinidos` es la lista de shared/. `rutaDePrueba` es un archivo que
 * no existe, donde se prueba a copiar la base: quien llama lo borra antes y después.
 */
export function autocomprobar(
  bd: Bd,
  predefinidos: ListaDePredefinidos,
  rutaDePrueba: string,
): Resultado[] {
  const resultados: Resultado[] = []
  const comprobar = (nombre: string, fn: () => string | true) => {
    try {
      const r = fn()
      resultados.push({ nombre, bien: r === true, detalle: r === true ? 'Bien' : r })
    } catch (error) {
      const texto = error instanceof Error ? error.message : String(error)
      resultados.push({ nombre, bien: false, detalle: `Ha lanzado: ${texto}` })
    }
  }

  comprobar('Versión de SQLite', () => {
    const v = bd.una<{ v: string }>('SELECT sqlite_version() AS v')!.v
    const [mayor, menor] = v.split('.').map(Number)
    // STRICT necesita la 3.37.
    return mayor > 3 || (mayor === 3 && menor >= 37)
      ? true
      : `Es la ${v}, y hace falta la 3.37 o posterior`
  })

  comprobar('Claves ajenas activadas', () => {
    const fk = bd.una<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys
    return fk === 1 ? true : `PRAGMA foreign_keys da ${fk}`
  })

  comprobar('Migraciones', () => {
    aplicarMigraciones(bd)
    const v = versionDeLaBase(bd)
    return v === VERSION_ACTUAL ? true : `La base queda en la versión ${v}`
  })

  comprobar('Predefinidos sembrados', () => {
    sincronizarPredefinidos(bd, predefinidos, AHORA)
    const grupos = bd.una<{ n: number }>('SELECT count(*) AS n FROM grupos_musculares')!.n
    const ejercicios = bd.una<{ n: number }>(
      'SELECT count(*) AS n FROM ejercicios WHERE es_predefinido = 1',
    )!.n
    const esperado = `${predefinidos.grupos.length} grupos y ${predefinidos.ejercicios.length} ejercicios`
    return grupos === predefinidos.grupos.length && ejercicios === predefinidos.ejercicios.length
      ? true
      : `Hay ${grupos} grupos y ${ejercicios} ejercicios; se esperaban ${esperado}`
  })

  comprobar('Borrar una sesión borra sus series (CASCADE)', () => {
    const { sesion } = montarSesion(bd)
    bd.ejecutar('DELETE FROM entrenamientos WHERE id = ?', sesion)
    const quedan = bd.una<{ n: number }>(
      'SELECT count(*) AS n FROM series WHERE entrenamiento_id = ?',
      sesion,
    )!.n
    return quedan === 0 ? true : `Quedan ${quedan} series`
  })

  comprobar('Un ejercicio usado no se borra (RESTRICT)', () => {
    const { ejercicio } = montarSesion(bd)
    const error = lanza(() => bd.ejecutar('DELETE FROM ejercicios WHERE id = ?', ejercicio))
    return error?.includes('FOREIGN KEY') ? true : `Se ha podido borrar (${error ?? 'sin error'})`
  })

  comprobar('Una transacción a medias se deshace', () => {
    const antes = bd.una<{ n: number }>('SELECT count(*) AS n FROM rutinas')!.n
    lanza(() =>
      bd.transaccion(() => {
        bd.ejecutar(
          'INSERT INTO rutinas (nombre, created_at, updated_at) VALUES (?, ?, ?)',
          'A medias',
          AHORA,
          AHORA,
        )
        throw new Error('a propósito')
      }),
    )
    const despues = bd.una<{ n: number }>('SELECT count(*) AS n FROM rutinas')!.n
    return antes === despues ? true : `Había ${antes} rutinas y hay ${despues}`
  })

  comprobar('Restricciones con nombre (CHECK)', () => {
    const { sesion, slot, ejercicio } = montarSesion(bd)
    const error = lanza(() =>
      bd.ejecutar(
        'INSERT INTO series (entrenamiento_id, slot_id, ejercicio_id, numero_serie,' +
          ' repeticiones, created_at, updated_at) VALUES (?, ?, ?, 2, 10, ?, ?)',
        sesion,
        slot,
        ejercicio,
        AHORA,
        AHORA,
      ),
    )
    return error?.includes('series_medidas_check')
      ? true
      : `Error inesperado: ${error ?? 'ninguno'}`
  })

  comprobar('Tablas estrictas (STRICT)', () => {
    const { sesion, slot, ejercicio } = montarSesion(bd)
    const error = lanza(() =>
      bd.ejecutar(
        'INSERT INTO series (entrenamiento_id, slot_id, ejercicio_id, numero_serie,' +
          ' peso_centesimas, repeticiones, created_at, updated_at) VALUES (?, ?, ?, 2, 80.5, 10, ?, ?)',
        sesion,
        slot,
        ejercicio,
        AHORA,
        AHORA,
      ),
    )
    return error !== null ? true : 'Ha guardado 80.5 en una columna de enteros'
  })

  comprobar('Un solo programa activo (índice parcial)', () => {
    const programa = (nombre: string) =>
      bd.ejecutar(
        'INSERT INTO programas (nombre, created_at, updated_at) VALUES (?, ?, ?)',
        nombre,
        AHORA,
        AHORA,
      ).ultimoId
    bd.ejecutar(
      'INSERT INTO programa_periodos (programa_id, desde) VALUES (?, ?)',
      programa('A'),
      '2026-01-01',
    )
    const error = lanza(() =>
      bd.ejecutar(
        'INSERT INTO programa_periodos (programa_id, desde) VALUES (?, ?)',
        programa('B'),
        '2026-01-01',
      ),
    )
    return error?.includes('UNIQUE')
      ? true
      : `Ha dejado dos periodos abiertos (${error ?? 'sin error'})`
  })

  comprobar('updated_at se pone solo (disparador)', () => {
    const { rutina } = montarSesion(bd)
    bd.ejecutar('UPDATE rutinas SET nombre = ? WHERE id = ?', 'Otra', rutina)
    const fila = bd.una<{ updated_at: string }>(
      'SELECT updated_at FROM rutinas WHERE id = ?',
      rutina,
    )!
    return fila.updated_at !== AHORA ? true : 'No ha cambiado'
  })

  comprobar('Números grandes (BigInt)', () => {
    return aCentesimas('22.505') === 2251 && aCentesimas('9999.995') === 1000000
      ? true
      : `22.505 da ${aCentesimas('22.505')} y 9999.995 da ${aCentesimas('9999.995')}`
  })

  comprobar('Orden alfabético en español', () => {
    const nombres = ['Zancadas', 'abdominales', 'Ñandú', 'árbol', 'Nube']
    const ordenados = ordenarPorNombre(nombres.map((nombre, id) => ({ nombre, id }))).map(
      (x) => x.nombre,
    )
    const esperado = ['abdominales', 'árbol', 'Nube', 'Ñandú', 'Zancadas']
    return ordenados.join() === esperado.join() ? true : `Sale ${ordenados.join(', ')}`
  })

  comprobar('Zonas horarias', () => {
    const instante = new Date('2026-11-09T11:00:00Z')
    const madrid = hoyEn('Europe/Madrid', new Date('2026-11-09T23:30:00Z'))
    const kiritimati = hoyEn('Pacific/Kiritimati', instante)
    if (madrid !== '2026-11-10') return `En Madrid sale ${madrid}`
    if (kiritimati !== '2026-11-10') return `En Kiritimati sale ${kiritimati}`
    if (!zonaValida('Europe/Madrid')) return 'No reconoce Europe/Madrid'
    return true
  })

  comprobar('Una zona inventada no vale', () => {
    const error = lanza(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Marte/Base' }))
    if (error === null) return 'Intl acepta una zona inventada'
    return zonaValida('Marte/Base') ? 'zonaValida acepta una zona inventada' : true
  })

  // Lo de poner la base al día va al final: sube la versión de esta base en memoria.
  comprobar('Copia de la base (VACUUM INTO)', () => {
    copiarBase(bd, rutaDePrueba)
    return true
  })

  comprobar('Las claves ajenas no se apagan dentro de una transacción', () => {
    const claves = () => bd.una<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys
    const dentro = bd.transaccion(() => {
      bd.ejecutarVarias('PRAGMA foreign_keys = OFF')
      return claves()
    })
    if (dentro !== 1) return `Dentro de una transacción se han apagado (${dentro})`
    bd.ejecutarVarias('PRAGMA foreign_keys = OFF')
    const fuera = claves()
    bd.ejecutarVarias('PRAGMA foreign_keys = ON')
    if (fuera !== 0) return `Fuera de una transacción no se apagan (${fuera})`
    return claves() === 1 ? true : 'No se han vuelto a encender'
  })

  // Una tabla madre y una hija con CASCADE, y los pasos que se van añadiendo a la lista.
  const pasos: Migracion[] = [...MIGRACIONES]
  const hijos = () => bd.una<{ n: number }>('SELECT count(*) AS n FROM prueba_hijo')!.n
  comprobar('Rehacer una tabla con hijos los conserva', () => {
    bd.ejecutarVarias(
      'CREATE TABLE prueba_padre (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL) STRICT;' +
        ' CREATE TABLE prueba_hijo (id INTEGER PRIMARY KEY AUTOINCREMENT,' +
        ' padre_id INTEGER NOT NULL REFERENCES prueba_padre (id) ON DELETE CASCADE) STRICT;' +
        " INSERT INTO prueba_padre (nombre) VALUES ('uno'), ('dos');" +
        ' INSERT INTO prueba_hijo (padre_id) VALUES (1), (1);' +
        // El último id se borra: la secuencia tiene que seguir en 2 después de rehacerla.
        ' DELETE FROM prueba_padre WHERE id = 2;',
    )
    pasos.push({
      version: VERSION_ACTUAL + 1,
      sinClavesAjenas: true,
      sql: rehacerTabla({
        tabla: 'prueba_padre',
        cuerpo: 'id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL',
        columnas: { id: 'id', nombre: 'nombre' },
        indices: [],
      }),
    })
    aplicarMigraciones(bd, pasos)
    const claves = bd.una<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys
    if (claves !== 1) return 'Las claves ajenas se han quedado apagadas'
    return hijos() === 2 ? true : `Quedan ${hijos()} hijos de 2`
  })

  comprobar('Un paso que borra hijos sin decirlo se para', () => {
    pasos.push({ version: VERSION_ACTUAL + 2, sql: 'DELETE FROM prueba_padre;' })
    let error: unknown = null
    try {
      aplicarMigraciones(bd, pasos)
    } catch (lanzado) {
      error = lanzado
    }
    pasos.pop()
    if (error === null) return 'Se ha aplicado'
    if (!(error instanceof MigracionPeligrosa)) return `Ha lanzado otro error: ${String(error)}`
    if (hijos() !== 2) return `Se ha parado, pero quedan ${hijos()} hijos de 2`
    return versionDeLaBase(bd) === VERSION_ACTUAL + 1 ? true : 'Ha cambiado la versión'
  })

  comprobar('La secuencia de ids se conserva al rehacer', () => {
    const seq = bd.una<{ seq: number }>(
      "SELECT seq FROM sqlite_sequence WHERE name = 'prueba_padre'",
    )?.seq
    return seq === 2 ? true : `La secuencia está en ${seq ?? 'ninguna'} y tenía que seguir en 2`
  })

  return resultados
}
