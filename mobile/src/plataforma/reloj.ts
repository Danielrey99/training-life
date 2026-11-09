/** El reloj y la zona horaria del teléfono: «hoy» es el día que vive quien entrena. */
import type { Reloj } from '../logica/contexto'
import { hoyEn } from '../logica/reglas/zonas'

export function zonaDelTelefono(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export const relojDelTelefono: Reloj = {
  hoy: () => hoyEn(zonaDelTelefono()),
  ahora: () => new Date().toISOString(),
}
