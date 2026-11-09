/**
 * La forma de un nombre (de ejercicio, de rutina o de programa) con la que se compara si
 * ya existe otro igual. Copia de `backend/app/nombres.py`.
 */
import { palabras } from './textos'

// Una tabla explícita y no `normalize('NFD')`: NFD también quitaría la tilde de la ñ y la
// cedilla de la ç, y «Año» y «Ano» son nombres distintos. Es la misma tabla del backend.
const CON_TILDE = 'áàâäéèêëíìîïóòôöúùûü'
const SIN_TILDE = 'aaaaeeeeiiiioooouuuu'

/**
 * «Press  Banca» y «press banca» son el mismo nombre: sin bordes, con los espacios
 * seguidos como uno, en minúsculas y sin tildes ni diéresis.
 */
export function claveDeNombre(nombre: string): string {
  let clave = ''
  for (const letra of palabras(nombre).join(' ').toLowerCase()) {
    const i = CON_TILDE.indexOf(letra)
    clave += i === -1 ? letra : SIN_TILDE[i]
  }
  return clave
}
