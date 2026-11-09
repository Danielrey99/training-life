/**
 * Los ejercicios predefinidos, sembrados desde `shared/predefinidos.json`: la misma lista
 * que siembran las migraciones del backend.
 *
 * Se guarda en `meta` una huella de la lista. En el primer arranque, o cuando un APK nuevo
 * trae una lista distinta, se pone la base al día:
 * - los grupos que falten se insertan por nombre;
 * - cada ejercicio de la lista se busca por `claveDeNombre`, y solo entre los predefinidos
 *   (uno propio que se llame igual convive con él). Si no está, se inserta. Si está, se le
 *   ponen el nombre, el grupo y la descripción de la lista; el tipo, solo si nada lo usa,
 *   porque cambiar el tipo de un ejercicio con series rompería sus medidas;
 * - un predefinido que ya no está en la lista se deja como está.
 */
import { claveDeNombre } from '../reglas/nombres'
import type { TipoRegistro } from '../reglas/medidas'
import type { Bd } from './bd'

export interface ListaDePredefinidos {
  grupos: string[]
  ejercicios: {
    nombre: string
    grupo: string
    tipo_registro: TipoRegistro
    descripcion: string | null
  }[]
}

const CLAVE_DE_LA_HUELLA = 'predefinidos_huella'

/** FNV-1a de 32 bits sobre el texto, en hexadecimal: basta para saber si cambió. */
export function huella(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

interface Predefinido {
  id: number
  nombre: string
  grupo_muscular_id: number
  descripcion: string | null
  tipo_registro: TipoRegistro
}

/**
 * Pone los predefinidos de la base como dice `lista`. Devuelve si ha escrito algo (con la
 * misma huella, no toca nada). `ahora` es el instante para `created_at`.
 */
export function sincronizarPredefinidos(
  bd: Bd,
  lista: ListaDePredefinidos,
  ahora: string,
): boolean {
  const nueva = huella(JSON.stringify(lista))
  const guardada = bd.una<{ valor: string }>(
    'SELECT valor FROM meta WHERE clave = ?',
    CLAVE_DE_LA_HUELLA,
  )
  if (guardada?.valor === nueva) return false

  bd.transaccion(() => {
    const grupos = new Map(
      bd
        .todas<{ id: number; nombre: string }>('SELECT id, nombre FROM grupos_musculares')
        .map((g) => [g.nombre, g.id]),
    )
    for (const nombre of lista.grupos) {
      if (!grupos.has(nombre)) {
        grupos.set(
          nombre,
          bd.ejecutar('INSERT INTO grupos_musculares (nombre) VALUES (?)', nombre).ultimoId,
        )
      }
    }

    const existentes = new Map(
      bd
        .todas<Predefinido>(
          'SELECT id, nombre, grupo_muscular_id, descripcion, tipo_registro FROM ejercicios' +
            ' WHERE es_predefinido = 1',
        )
        .map((e) => [claveDeNombre(e.nombre), e]),
    )

    for (const ejercicio of lista.ejercicios) {
      const grupoId = grupos.get(ejercicio.grupo)
      if (grupoId === undefined) {
        throw new Error(
          `El grupo «${ejercicio.grupo}» de «${ejercicio.nombre}» no está en la lista.`,
        )
      }
      const descripcion = ejercicio.descripcion ?? null
      const actual = existentes.get(claveDeNombre(ejercicio.nombre))
      if (!actual) {
        bd.ejecutar(
          'INSERT INTO ejercicios (nombre, grupo_muscular_id, descripcion, es_predefinido,' +
            ' tipo_registro, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)',
          ejercicio.nombre,
          grupoId,
          descripcion,
          ejercicio.tipo_registro,
          ahora,
          ahora,
        )
        continue
      }
      if (
        actual.nombre !== ejercicio.nombre ||
        actual.grupo_muscular_id !== grupoId ||
        actual.descripcion !== descripcion
      ) {
        bd.ejecutar(
          'UPDATE ejercicios SET nombre = ?, grupo_muscular_id = ?, descripcion = ? WHERE id = ?',
          ejercicio.nombre,
          grupoId,
          descripcion,
          actual.id,
        )
      }
      if (actual.tipo_registro !== ejercicio.tipo_registro && !estaUsado(bd, actual.id)) {
        bd.ejecutar(
          'UPDATE ejercicios SET tipo_registro = ? WHERE id = ?',
          ejercicio.tipo_registro,
          actual.id,
        )
      }
    }

    bd.ejecutar(
      'INSERT INTO meta (clave, valor) VALUES (?, ?)' +
        ' ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor',
      CLAVE_DE_LA_HUELLA,
      nueva,
    )
  })
  return true
}

function estaUsado(bd: Bd, ejercicioId: number): boolean {
  return (
    bd.una(
      // Un `?` por uso y no `?1` repetido: node:sqlite no enlaza bien los numerados.
      'SELECT 1 FROM series WHERE ejercicio_id = ?' +
        ' UNION ALL SELECT 1 FROM rutina_slots WHERE ejercicio_principal_id = ?' +
        ' UNION ALL SELECT 1 FROM slot_alternativas WHERE ejercicio_id = ? LIMIT 1',
      ejercicioId,
      ejercicioId,
      ejercicioId,
    ) !== undefined
  )
}
