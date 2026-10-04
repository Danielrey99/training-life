import { useLocation, useNavigate } from 'react-router-dom'

/**
 * La flecha de volver: a la pantalla de la que se vino, que es lo que espera quien
 * la pulsa (de Hoy a un día del historial, la flecha vuelve a Hoy y no al calendario).
 *
 * Si la visita empezó en esta misma pantalla (se abrió el enlace directamente o se
 * recargó), no hay pantalla anterior dentro de la app: se va a `padre`, la pantalla
 * de la que cuelga esta. Se pasa al pulsar porque a veces depende de lo que se cargó. React Router marca esa primera entrada con la clave
 * `default`.
 *
 * Para que volver no lleve a algo que ya no existe (una sesión terminada o un día
 * borrado), quien navega después de terminar, cancelar o borrar lo hace con
 * `replace`.
 */
export function useVolver() {
  const navegar = useNavigate()
  const { key } = useLocation()
  return (padre: string) => (key === 'default' ? navegar(padre, { replace: true }) : navegar(-1))
}
