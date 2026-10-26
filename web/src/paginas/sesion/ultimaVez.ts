import { useEffect, useState } from 'react'

import { api } from '../../api/cliente'
import type { SesionHistorial } from '../../api/tipos'

type Sesion = { id: number; fecha: string }

/**
 * La última vez que se hizo un ejercicio, en la rutina que fuera, para compararse con ella.
 *
 * - `undefined` mientras se pide, `null` si no hay ninguna (o si la petición
 *   falla: sin última vez la sesión se puede registrar igual, así que no merece
 *   un error en pantalla). Con `ejercicioId` nulo no pide nada.
 * - Mira hacia atrás desde la fecha de la sesión, no desde hoy: al apuntar un
 *   día pasado, la última vez es la anterior a ese día.
 * - Se salta la propia sesión, que ya aparece en el historial en cuanto tiene
 *   una serie. Por eso se piden dos días y no uno.
 */
export function useUltimaVez(
  ejercicioId: number | null,
  sesion: Sesion,
): SesionHistorial | null | undefined {
  const { id: sesionId, fecha } = sesion
  const clave = `${ejercicioId}-${fecha}-${sesionId}`
  const [resultado, setResultado] = useState<{
    clave: string
    sesion: SesionHistorial | null
  }>()

  useEffect(() => {
    if (ejercicioId === null) return
    const filtro = { hasta: fecha, limite: 2 }
    const peticion = api.historialDeEjercicio(ejercicioId, filtro)
    // Si se elige otro ejercicio antes de que llegue la respuesta, la vieja no
    // debe pisar a la nueva.
    let vigente = true
    peticion
      .then((sesiones) => sesiones.find((otra) => otra.entrenamiento_id !== sesionId) ?? null)
      .catch(() => null)
      .then((encontrada) => {
        if (vigente) setResultado({ clave, sesion: encontrada })
      })
    return () => {
      vigente = false
    }
  }, [clave, ejercicioId, fecha, sesionId])

  if (ejercicioId === null) return null
  return resultado?.clave === clave ? resultado.sesion : undefined
}
