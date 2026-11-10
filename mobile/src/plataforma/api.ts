/**
 * La api de la app: la misma lógica que prueban los tests, sobre la base, el reloj y la zona
 * del teléfono. Las pantallas la usan como la web usa la suya.
 */
import { crearApi } from '../logica/api'
import type { Contexto } from '../logica/contexto'
import { baseDelTelefono } from './arranque'
import { relojDelTelefono, zonaDelTelefono } from './reloj'

const contexto: Contexto = {
  // Al pedirla y no al cargar el módulo: la primera llamada abre la base y la pone al día.
  get bd() {
    return baseDelTelefono()
  },
  reloj: relojDelTelefono,
  zona: zonaDelTelefono,
}

export const api = crearApi(contexto)

export { ErrorDeApi, esDelCampo, textoDelFallo } from '../logica/api'
