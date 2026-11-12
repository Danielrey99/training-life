/**
 * Los textos de la pantalla de arranque fallido (A0 · Al abrir la app), sin React para
 * probarlos en Node. Escritos para alguien que no sabe cómo funciona la app: qué ha pasado,
 * que no desinstale (se borrarían sus datos) y cómo hacer llegar el archivo a quien lo revise.
 */
import type { MotivoDelFallo } from '../logica/bd/abrir'

export type AccionDelArranque = 'compartir' | 'reintentar'

export interface TextosDelArranqueFallido {
  titulo: string
  parrafos: string[]
  /** En orden: el primero es el principal de la pantalla (salvo con `normal`). */
  botones: {
    accion: AccionDelArranque
    texto: string
    variante: 'principal' | 'secundaria' | 'normal'
  }[]
}

export const COMPARTIR = 'Compartir el archivo de tus datos'
export const REINTENTAR = 'Volver a intentarlo'

const NO_DESINSTALES = 'No desinstales la app, porque al desinstalarla se borran tus datos.'

const COMUN =
  `${NO_DESINSTALES} Pulsa ${COMPARTIR} y mándalo, por ejemplo por WhatsApp o por correo, ` +
  'a quien te pasó la app para que lo revise.'

export const ANTES_DEL_DETALLE = 'Si te preguntan qué ha fallado, este es el aviso de la app.'

export const FALLO_AL_COMPARTIR = 'No se ha podido crear el archivo. Vuelve a intentarlo.'

export function textosDelArranqueFallido(motivo: MotivoDelFallo): TextosDelArranqueFallido {
  const compartirPrimero: TextosDelArranqueFallido['botones'] = [
    { accion: 'compartir', texto: COMPARTIR, variante: 'principal' },
    { accion: 'reintentar', texto: REINTENTAR, variante: 'secundaria' },
  ]
  switch (motivo) {
    case 'al_poner_al_dia':
      return {
        titulo: 'No se han podido abrir tus datos',
        parrafos: [
          'Esta versión de la app tenía que poner al día tus datos y no ha podido. Se han ' +
            'quedado como estaban, no se ha borrado nada.',
          COMUN,
        ],
        botones: compartirPrimero,
      }
    case 'otro':
      return {
        titulo: 'No se han podido abrir tus datos',
        parrafos: ['La app no ha podido abrir tus datos. Siguen guardados en el teléfono.', COMUN],
        botones: compartirPrimero,
      }
    case 'sin_copia':
      return {
        titulo: 'No se ha podido guardar una copia de tus datos',
        parrafos: [
          'Antes de poner al día tus datos, la app guarda una copia en el teléfono por si algo ' +
            'sale mal, y esta vez no ha podido. Puede que el teléfono no tenga espacio libre. No ' +
            'se ha cambiado nada.',
          `Libera espacio y pulsa ${REINTENTAR}. Si sigue sin funcionar, pulsa ${COMPARTIR} y ` +
            'mándalo a quien te pasó la app.',
        ],
        botones: [
          { accion: 'reintentar', texto: REINTENTAR, variante: 'principal' },
          { accion: 'compartir', texto: COMPARTIR, variante: 'secundaria' },
        ],
      }
    case 'base_mas_nueva':
      return {
        titulo: 'Tus datos son de una versión más nueva de la app',
        parrafos: [
          'Esta versión de la app es más antigua que la que guardó tus datos y no sabe ' +
            'abrirlos. Instala la última versión para volver a verlos. No se ha borrado nada.',
          NO_DESINSTALES,
        ],
        // Volver a intentarlo no serviría de nada: solo queda compartir el archivo.
        botones: [{ accion: 'compartir', texto: COMPARTIR, variante: 'normal' }],
      }
  }
}
