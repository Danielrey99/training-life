/**
 * Dónde queda el rastro de los fallos en el teléfono: un archivo junto a los documentos de
 * la app, para que sobreviva a un cierre (un fallo que tumba la app también se apunta). Se
 * ve en la autocomprobación.
 */
import { File, Paths } from 'expo-file-system'

import { alApuntar, apuntarFallo, cargarFallo, type Fallo } from '../logica/rastro'

function archivo(): File {
  return new File(Paths.document, 'ultimo-fallo.json')
}

let preparado = false

/** Carga el último fallo guardado y apunta los que vengan. Se llama una vez, al abrir. */
export function prepararRastroDeFallos(): void {
  if (preparado) return
  preparado = true
  try {
    const guardado = archivo()
    if (guardado.exists) cargarFallo(JSON.parse(guardado.textSync()) as Fallo)
  } catch {
    // Un archivo roto no impide abrir la app: el próximo fallo lo sustituye.
  }
  alApuntar((fallo) => archivo().writeSync(JSON.stringify(fallo)))

  // Lo que nadie recoge (y lo que cierra la app) pasa por aquí antes que por el de siempre.
  const anterior = ErrorUtils.getGlobalHandler()
  ErrorUtils.setGlobalHandler((error, esFatal) => {
    apuntarFallo(error)
    anterior(error, esFatal)
  })
}

/** Olvida el último fallo, en memoria y en el archivo. */
export function olvidarFallo(): void {
  cargarFallo(null)
  try {
    const guardado = archivo()
    if (guardado.exists) guardado.delete()
  } catch {
    // Si no se puede borrar, vuelve a salir al abrir la app: no rompe nada.
  }
}
