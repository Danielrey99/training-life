/**
 * Las copias de la base que se guardan antes de ponerla al día, en una carpeta `copias` junto
 * a la base: en el almacenamiento propio de la app, no en la caché, que Android puede vaciar
 * cuando quiera. Se quedan las dos últimas; «Borrar todos tus datos» no las toca (son una red
 * de seguridad, no datos de la app).
 */
import { Directory, File, Paths } from 'expo-file-system'

import type { Bd } from '../logica/bd/bd'
import { copiarBase, copiasQueSobran, nombreDeLaCopia, SinCopia } from '../logica/bd/copias'
import { compartirArchivoDeDatos } from './archivos'

/** La ruta del sistema de archivos de una URI `file://` (la que necesita SQLite). */
export function rutaDeArchivo(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''))
}

function archivoEn(ruta: string): File {
  return new File(ruta.startsWith('file://') ? ruta : `file://${ruta}`)
}

function carpetaDeCopias(rutaDeLaBase: string): Directory {
  const carpeta = new Directory(archivoEn(rutaDeLaBase).parentDirectory, 'copias')
  carpeta.create({ idempotent: true })
  return carpeta
}

/** Copia la base antes de ponerla en la versión `hasta`. Si no puede, lanza `SinCopia`. */
export function hacerCopia(bd: Bd, rutaDeLaBase: string, hasta: number): void {
  try {
    const archivo = new File(carpetaDeCopias(rutaDeLaBase), nombreDeLaCopia(hasta))
    // Reintentar sobrescribe la copia de esa misma versión.
    if (archivo.exists) archivo.delete()
    copiarBase(bd, rutaDeArchivo(archivo.uri))
  } catch (error) {
    throw error instanceof SinCopia ? error : new SinCopia(error)
  }
}

function archivosDeCopias(rutaDeLaBase: string): File[] {
  return carpetaDeCopias(rutaDeLaBase)
    .list()
    .filter((elemento): elemento is File => elemento instanceof File)
}

/** Borra las copias que sobran (se quedan las dos de versiones más altas). */
export function limpiarCopias(rutaDeLaBase: string): void {
  const archivos = archivosDeCopias(rutaDeLaBase)
  const sobran = new Set(copiasQueSobran(archivos.map((archivo) => archivo.name)))
  for (const archivo of archivos) if (sobran.has(archivo.name)) archivo.delete()
}

export interface CopiaGuardada {
  nombre: string
  /** En bytes. */
  tamano: number
  /** Milisegundos desde 1970, o `null` si Android no lo sabe. */
  fecha: number | null
}

/** Las copias que hay, para la pantalla de autocomprobación. */
export function copiasGuardadas(rutaDeLaBase: string): CopiaGuardada[] {
  return archivosDeCopias(rutaDeLaBase).map((archivo) => {
    const info = archivo.info()
    return { nombre: archivo.name, tamano: info.size ?? 0, fecha: info.modificationTime ?? null }
  })
}

/** Comparte una copia con el menú de compartir de Android (pasándola antes por la caché). */
export async function compartirCopia(rutaDeLaBase: string, nombre: string): Promise<void> {
  const destino = new File(Paths.cache, nombre)
  if (destino.exists) destino.delete()
  new File(carpetaDeCopias(rutaDeLaBase), nombre).copySync(destino)
  await compartirArchivoDeDatos(destino)
}
