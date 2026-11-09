/**
 * Lo que la lógica necesita del mundo: la base y la hora. Cada servicio lo recibe primero,
 * como cada endpoint del backend recibe la sesión de la base.
 *
 * En el teléfono, el reloj y la zona son los suyos; en los tests, un reloj que se fija
 * (el `hoy_es` de los tests del backend).
 */
import type { Bd } from './bd/bd'

export interface Reloj {
  /** El día de hoy en la zona de quien entrena, 'YYYY-MM-DD'. */
  hoy(): string
  /** El instante actual en ISO, con zona: lo que se guarda en `created_at` y compañía. */
  ahora(): string
}

export interface Contexto {
  bd: Bd
  reloj: Reloj
  /** La zona horaria del teléfono (`Europe/Madrid`): la que se escribe al exportar. */
  zona(): string
}
