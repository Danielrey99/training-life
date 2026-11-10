/**
 * Los archivos de la copia de tus datos: elegir uno para importarlo y compartir el que se
 * exporta (a Drive, al correo, a WhatsApp…) con el menú de compartir de Android.
 */
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

/**
 * El texto del archivo que elija la persona, o `null` si cancela. Con cualquier tipo:
 * Android suele etiquetar un `.json` como `application/octet-stream`, y filtrar por JSON lo
 * escondería.
 */
export async function elegirArchivo(): Promise<string | null> {
  const resultado = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (resultado.canceled) return null
  return new File(resultado.assets[0].uri).text()
}

/**
 * Escribe `texto` en un archivo de la caché con ese nombre y abre el menú de compartir.
 * Termina cuando se cierra el menú, se haya compartido o no.
 */
export async function compartirArchivo(nombre: string, texto: string): Promise<void> {
  const archivo = new File(Paths.cache, nombre)
  if (archivo.exists) archivo.delete()
  archivo.create()
  await archivo.write(texto)
  await Sharing.shareAsync(archivo.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Guardar la copia de tus datos',
  })
}
