/**
 * Lo que hace la app al abrirse antes de enseñar nada: abrir la base del teléfono, ponerla
 * en la última versión del esquema (copiándola antes) y al día con los ejercicios
 * predefinidos. Si no puede, la app enseña la pantalla de arranque fallido.
 */
import { File, Paths } from 'expo-file-system'
import { defaultDatabaseDirectory } from 'expo-sqlite'

import predefinidos from '../../../shared/predefinidos.json'
import { fallida, prepararBase, type EstadoDelArranque } from '../logica/bd/abrir'
import type { Bd } from '../logica/bd/bd'
import type { ListaDePredefinidos } from '../logica/bd/siembra'
import { compartirArchivoDeDatos } from './archivos'
import { abrirArchivoDeLaBase, NOMBRE_DEL_ARCHIVO, type BaseAbierta } from './bdExpo'
import { hacerCopia, limpiarCopias, rutaDeArchivo } from './copias'
import { relojDelTelefono } from './reloj'

export const PREDEFINIDOS = predefinidos as ListaDePredefinidos

let abierta: BaseAbierta | null = null
let estado: EstadoDelArranque | null = null

/**
 * Abre la base y la deja lista. Si ya lo está, no hace nada; si falló, lo intenta otra vez
 * desde el principio (Volver a intentarlo). La conexión se guarda aunque falle, para poder
 * compartir el archivo.
 */
export function arrancar(): EstadoDelArranque {
  if (abierta && estado?.tipo === 'lista') return estado
  if (abierta) {
    try {
      abierta.cerrar()
    } catch {
      // Se abre de nuevo igual: lo que importa es el intento de ahora.
    }
    abierta = null
  }
  try {
    abierta = abrirArchivoDeLaBase()
  } catch (error) {
    estado = fallida('otro', error)
    return estado
  }
  const base = abierta
  estado = prepararBase(base.bd, {
    copiar: (_desde, hasta) => hacerCopia(base.bd, base.ruta, hasta),
    limpiarCopias: () => limpiarCopias(base.ruta),
    predefinidos: PREDEFINIDOS,
    ahora: relojDelTelefono.ahora(),
  })
  return estado
}

/** La base del teléfono, abierta y al día. La primera llamada la prepara; las demás la reutilizan. */
export function baseDelTelefono(): Bd {
  const ahora = arrancar()
  // Con la pantalla de arranque fallido en el layout no se llega aquí, pero por si acaso.
  if (ahora.tipo !== 'lista') throw new Error(`No se han podido abrir tus datos. ${ahora.detalle}`)
  return abierta!.bd
}

/** La ruta de la base abierta, para la autocomprobación (o `null` si no se ha podido abrir). */
export function rutaDeLaBase(): string | null {
  return abierta?.ruta ?? null
}

/**
 * Comparte el archivo de la base tal cual (el `.db`): con la base a medio poner al día o de
 * una versión más nueva, esta versión no sabe sacar la copia en texto de siempre.
 */
export async function compartirTusDatos(): Promise<void> {
  const destino = new File(Paths.cache, `training-life-${relojDelTelefono.ahora().slice(0, 10)}.db`)
  if (destino.exists) destino.delete()
  let copiada = false
  if (abierta && !abierta.bd.enTransaccion) {
    try {
      // Así sale también lo que aún esté en el archivo `-wal`.
      abierta.bd.ejecutar('VACUUM INTO ?', rutaDeArchivo(destino.uri))
      copiada = true
    } catch {
      if (destino.exists) destino.delete()
    }
  }
  if (!copiada) {
    const ruta = abierta?.ruta ?? `${defaultDatabaseDirectory}/${NOMBRE_DEL_ARCHIVO}`
    new File(ruta.startsWith('file://') ? ruta : `file://${ruta}`).copySync(destino)
  }
  await compartirArchivoDeDatos(destino)
}
