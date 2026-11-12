/**
 * Las versiones del esquema de la base del teléfono, como las migraciones de Alembic.
 *
 * La versión guardada es `PRAGMA user_version` (0 en una base recién creada). Al abrir
 * la app se aplican, en una sola transacción, los pasos que van detrás de ella.
 *
 * Un paso ya publicado en un APK no se edita nunca: los teléfonos que ya lo aplicaron no
 * lo volverían a aplicar. Un cambio va siempre en un paso nuevo, al final de la lista.
 *
 * Los datos solo están en el teléfono, así que poner al día la base no puede perder nada:
 * antes de escribir se comprueba cada paso, y antes de confirmar se compara la base con
 * cómo estaba (filas, índices, disparadores, secuencias de ids y claves ajenas). Si algo no
 * cuadra, se deshace todo y la base se queda como estaba.
 */
import type { Bd } from './bd'
import { ESQUEMA_V1 } from './esquema'

export interface Migracion {
  version: number
  sql: string
  /**
   * El paso rehace tablas (con `rehacerTabla`): todo el lote se aplica con las claves ajenas
   * apagadas. Sin esto, borrar la tabla vieja borraría en cascada sus hijas (las series de
   * cada sesión, por ejemplo), y por eso un `DROP TABLE` o un `RENAME` sin la marca se rechaza.
   */
  sinClavesAjenas?: true
  /**
   * Tablas que pueden perder filas o desaparecer, e índices o disparadores que pueden
   * quitarse, a propósito. Cada nombre quita la red para eso: se revisa a mano.
   */
  pierdeAProposito?: string[]
}

export interface OpcionesDeMigrar {
  /**
   * Se llama antes de escribir nada, solo si hay pasos pendientes y la base ya tenía datos
   * (versión guardada mayor que 0). Si lanza, no se migra. Es donde se copia la base.
   */
  antesDeMigrar?: (desde: number, hasta: number) => void
}

export const MIGRACIONES: Migracion[] = [{ version: 1, sql: ESQUEMA_V1 }]

export const VERSION_ACTUAL = MIGRACIONES[MIGRACIONES.length - 1].version

/** La base es de una versión de la app más nueva que esta (se instaló un APK más viejo encima). */
export class BaseMasNueva extends Error {
  constructor(
    readonly versionDeLaBase: number,
    readonly versionDeLaApp: number,
  ) {
    super(
      'Tus datos son de una versión más nueva de la app. Instala la última versión para abrirlos.',
    )
    this.name = 'BaseMasNueva'
  }
}

/** Un paso que podría perder datos, o que los ha perdido y se ha deshecho. */
export class MigracionPeligrosa extends Error {
  constructor(
    readonly version: number | null,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'MigracionPeligrosa'
  }
}

export function versionDeLaBase(bd: Bd): number {
  return bd.una<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0
}

/**
 * El SQL sin comentarios ni textos entre comillas: lo que se mira son las sentencias. En una
 * sola pasada de izquierda a derecha, como lo lee SQLite: un `--` dentro de un texto no abre
 * un comentario, ni una comilla dentro de un comentario abre un texto.
 */
function sinTextos(sql: string): string {
  let limpio = ''
  let i = 0
  while (i < sql.length) {
    const dos = sql.slice(i, i + 2)
    if (dos === '--') {
      const fin = sql.indexOf('\n', i)
      i = fin === -1 ? sql.length : fin
      limpio += ' '
    } else if (dos === '/*') {
      const fin = sql.indexOf('*/', i + 2)
      i = fin === -1 ? sql.length : fin + 2
      limpio += ' '
    } else if (sql[i] === "'" || sql[i] === '"' || sql[i] === '`') {
      // Un texto ('…') o un nombre entre comillas ("…" o `…`); la comilla doblada es una comilla.
      const comilla = sql[i]
      i++
      while (i < sql.length) {
        if (sql[i] === comilla && sql[i + 1] === comilla) i += 2
        else if (sql[i] === comilla) break
        else i++
      }
      i++
      limpio += `${comilla}${comilla}`
    } else if (sql[i] === '[') {
      // Un nombre entre corchetes: dentro no hay escapes, acaba en el primer `]`.
      const fin = sql.indexOf(']', i + 1)
      i = fin === -1 ? sql.length : fin + 1
      limpio += '[]'
    } else {
      limpio += sql[i]
      i++
    }
  }
  return limpio
}

/**
 * El SQL (ya sin textos) sin el cuerpo de sus disparadores: su `BEGIN … END;` no abre ni
 * cierra ninguna transacción. Dentro del cuerpo, cada `CASE` lleva su propio `END`.
 */
function sinCuerposDeDisparadores(sql: string): string {
  const palabras = /\b(CREATE|TRIGGER|BEGIN|CASE|END)\b|;/gi
  let limpio = ''
  let desde = 0
  let estado: 'fuera' | 'cabecera' | 'cuerpo' = 'fuera'
  let creando = false
  let casos = 0
  for (let m = palabras.exec(sql); m; m = palabras.exec(sql)) {
    const palabra = m[0].toUpperCase()
    if (estado === 'fuera') {
      if (palabra === 'CREATE') creando = true
      else if (palabra === 'TRIGGER' && creando) {
        estado = 'cabecera'
        limpio += sql.slice(desde, m.index)
      } else if (palabra === ';') creando = false
    } else if (estado === 'cabecera') {
      if (palabra === 'BEGIN') {
        estado = 'cuerpo'
        casos = 0
      }
    } else if (palabra === 'CASE') casos++
    else if (palabra === 'END') {
      if (casos > 0) casos--
      else {
        estado = 'fuera'
        creando = false
        desde = m.index + m[0].length
        limpio += ' TRIGGER '
      }
    }
  }
  return estado === 'fuera' ? limpio + sql.slice(desde) : limpio
}

/**
 * Lo que un paso no puede llevar. Se comprueba sobre el texto, antes de copiar ni escribir:
 * - `PRAGMA`, `VACUUM`, `ATTACH` y `DETACH` son cosa de la infraestructura (apagar las
 *   claves ajenas, poner la versión), nunca de un paso;
 * - abrir o cerrar una transacción rompería el todo o nada (el `BEGIN … END` de un
 *   disparador y el `RAISE(ROLLBACK, …)` sí valen: no son sentencias sueltas);
 * - borrar o renombrar una tabla sin `sinClavesAjenas` borraría en cascada sus hijas.
 */
export function comprobarPaso(paso: Migracion): void {
  const sql = sinTextos(paso.sql)
  const prohibida = /\b(PRAGMA|VACUUM|ATTACH|DETACH)\b/i.exec(sql)
  if (prohibida) {
    throw new MigracionPeligrosa(
      paso.version,
      `El paso ${paso.version} lleva ${prohibida[1].toUpperCase()}, que solo puede usar la infraestructura.`,
    )
  }
  // `END` a secas es `COMMIT` para SQLite: por eso se quitan antes los cuerpos de los
  // disparadores, que terminan en un `END;` que no cierra nada.
  const transaccion =
    /(?:^|;)\s*(BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?|COMMIT(?:\s+TRANSACTION)?|END(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TRANSACTION)?)\s*(?:;|$)/i.exec(
      sinCuerposDeDisparadores(sql),
    )
  if (transaccion) {
    throw new MigracionPeligrosa(
      paso.version,
      `El paso ${paso.version} abre o cierra una transacción (${transaccion[1].trim()}).`,
    )
  }
  if (
    !paso.sinClavesAjenas &&
    (/\bDROP\s+TABLE\b/i.test(sql) || /\bALTER\s+TABLE\s+\S+\s+RENAME\s+TO\b/i.test(sql))
  ) {
    throw new MigracionPeligrosa(
      paso.version,
      `El paso ${paso.version} borra o renombra una tabla sin sinClavesAjenas: borraría en cascada sus hijas.`,
    )
  }
}

/** Cómo está la base: lo que se compara antes y después de ponerla al día. */
interface Foto {
  filas: Map<string, number>
  objetos: Set<string>
  secuencias: Map<string, number>
}

function foto(bd: Bd): Foto {
  const tablas = bd.todas<{ name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  const filas = new Map<string, number>()
  for (const { name } of tablas) {
    // El nombre sale de la propia base, no de fuera; las comillas dobles lo protegen igual.
    const fila = bd.una<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`)
    filas.set(name, fila?.n ?? 0)
  }
  const objetos = new Set(
    bd
      .todas<{
        name: string
      }>("SELECT name FROM sqlite_schema WHERE type IN ('index', 'trigger') AND sql IS NOT NULL")
      .map((fila) => fila.name),
  )
  const secuencias = new Map<string, number>()
  const haySecuencias = bd.una<{ name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_sequence'",
  )
  if (haySecuencias) {
    for (const { name, seq } of bd.todas<{ name: string; seq: number }>(
      'SELECT name, seq FROM sqlite_sequence',
    )) {
      secuencias.set(name, Number(seq))
    }
  }
  return { filas, objetos, secuencias }
}

function compararFotos(antes: Foto, despues: Foto, permitido: Set<string>, version: number): void {
  for (const [tabla, filasAntes] of antes.filas) {
    if (permitido.has(tabla)) continue
    const filasDespues = despues.filas.get(tabla)
    if (filasDespues === undefined) {
      throw new MigracionPeligrosa(
        version,
        `La puesta al día a la versión ${version} quita la tabla ${tabla}.`,
      )
    }
    if (filasDespues < filasAntes) {
      throw new MigracionPeligrosa(
        version,
        `La puesta al día a la versión ${version} deja la tabla ${tabla} con ${filasDespues} filas de ${filasAntes}.`,
      )
    }
  }
  for (const objeto of antes.objetos) {
    if (!permitido.has(objeto) && !despues.objetos.has(objeto)) {
      throw new MigracionPeligrosa(
        version,
        `La puesta al día a la versión ${version} quita ${objeto} (un índice o un disparador).`,
      )
    }
  }
  for (const [tabla, seqAntes] of antes.secuencias) {
    // La secuencia de una tabla que ya no está se va con ella (lo vigila el recuento).
    if (permitido.has(tabla) || !despues.filas.has(tabla)) continue
    const seqDespues = despues.secuencias.get(tabla) ?? 0
    if (seqDespues < seqAntes) {
      throw new MigracionPeligrosa(
        version,
        `La puesta al día a la versión ${version} baja la secuencia de ids de ${tabla} de ${seqAntes} a ${seqDespues}: se reutilizarían ids borrados.`,
      )
    }
  }
}

function clavesAjenas(bd: Bd): number {
  return bd.una<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys ?? -1
}

/** Deja la base en la última versión. Devuelve los pasos que ha aplicado. */
export function aplicarMigraciones(
  bd: Bd,
  migraciones: Migracion[] = MIGRACIONES,
  opciones: OpcionesDeMigrar = {},
): number[] {
  // Dentro de una transacción, SQLite no deja apagar las claves ajenas (ni lo avisa).
  if (bd.enTransaccion) {
    throw new MigracionPeligrosa(null, 'La base no se pone al día dentro de una transacción.')
  }
  const ultima = migraciones[migraciones.length - 1].version
  const guardada = versionDeLaBase(bd)
  if (guardada > ultima) throw new BaseMasNueva(guardada, ultima)
  const pendientes = migraciones.filter((m) => m.version > guardada)
  if (pendientes.length === 0) return []

  // Todos los pasos se comprueban antes de copiar ni escribir nada.
  for (const paso of pendientes) comprobarPaso(paso)
  if (guardada > 0) opciones.antesDeMigrar?.(guardada, ultima)

  const permitido = new Set(pendientes.flatMap((paso) => paso.pierdeAProposito ?? []))
  const apagar = pendientes.some((paso) => paso.sinClavesAjenas)
  if (apagar) {
    // Fuera de la transacción, que dentro no tendría efecto. El lote entero va así: en un
    // lote mixto, los CASCADE de un paso normal tampoco actúan (si deja huérfanos, lo para
    // `foreign_key_check`).
    bd.ejecutarVarias('PRAGMA foreign_keys = OFF')
    if (clavesAjenas(bd) !== 0) {
      throw new MigracionPeligrosa(null, 'No se han podido apagar las claves ajenas.')
    }
  }
  try {
    bd.transaccion(() => {
      const antes = foto(bd)
      for (const paso of pendientes) {
        bd.ejecutarVarias(paso.sql)
        // PRAGMA no admite parámetros; la versión es un número de esta lista, no un dato de fuera.
        bd.ejecutarVarias(`PRAGMA user_version = ${Math.trunc(paso.version)}`)
      }
      compararFotos(antes, foto(bd), permitido, ultima)
      const huerfanas = bd.todas<{ table: string; parent: string }>('PRAGMA foreign_key_check')
      if (huerfanas.length > 0) {
        const { table, parent } = huerfanas[0]
        throw new MigracionPeligrosa(
          ultima,
          `La puesta al día a la versión ${ultima} deja ${huerfanas.length} filas de ${table} sin su ${parent}.`,
        )
      }
      const integridad = bd.una<{ quick_check: string }>('PRAGMA quick_check')?.quick_check
      if (integridad !== 'ok') {
        throw new MigracionPeligrosa(
          ultima,
          `La puesta al día a la versión ${ultima} deja la base dañada: ${integridad}.`,
        )
      }
    })
  } finally {
    if (apagar) {
      bd.ejecutarVarias('PRAGMA foreign_keys = ON')
      // Nunca se sigue con las claves apagadas: sin ellas no hay CASCADE ni RESTRICT.
      if (clavesAjenas(bd) !== 1) {
        // Este fallo tapa el del paso, si lo hubo: seguir sin claves ajenas es peor.
        throw new MigracionPeligrosa(null, 'No se han podido volver a encender las claves ajenas.')
      }
    }
  }
  return pendientes.map((m) => m.version)
}
