import { useNavigate } from 'react-router-dom'

/**
 * La flecha de volver: a la pantalla de la que se vino, que es lo que espera quien
 * la pulsa (de Hoy a un día del historial, la flecha vuelve a Hoy y no al calendario).
 *
 * Si la visita empezó en esta misma pantalla (se abrió el enlace directamente o se
 * recargó), no hay pantalla anterior dentro de la app: se va a `padre`, la pantalla
 * de la que cuelga esta. Se pasa al pulsar porque a veces depende de lo que se cargó.
 *
 * La primera entrada se reconoce por el `idx` que React Router guarda en el historial
 * del navegador, no por la clave `default` de `useLocation()`: cambiar la URL con
 * `replace` (el rango de H3, la rutina de H5) le da otra clave pero conserva el
 * `idx`, y con la clave la flecha sacaba de la app.
 *
 * Para que volver no lleve a algo que ya no existe (una sesión terminada o un día
 * borrado), quien navega después de terminar, cancelar o borrar lo hace con
 * `replace`.
 */
export function useVolver() {
  const navegar = useNavigate()
  return (padre: string) => {
    const primera = (window.history.state as { idx?: number } | null)?.idx === 0
    return primera ? navegar(padre, { replace: true }) : navegar(-1)
  }
}
