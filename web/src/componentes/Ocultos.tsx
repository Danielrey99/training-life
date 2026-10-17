import { Icono } from './Icono'

type Props = {
  cuantos: number
  singular: string
  plural: string
  abierto: boolean
  alAlternar: () => void
}

/**
 * "Ver 2 rutinas ocultas ⌄" / "Esconder…", al pie de una lista con ocultos (P1, X1,
 * la ficha de un ejercicio): solo si hay alguno. Lo oculto va plegado para que no
 * estorbe, pero sigue a mano para mostrarlo o borrarlo.
 */
export function Ocultos({ cuantos, singular, plural, abierto, alAlternar }: Props) {
  if (cuantos === 0) return null
  const que = cuantos === 1 ? `1 ${singular}` : `${cuantos} ${plural}`
  return (
    <button
      type="button"
      className="boton boton-texto atajo programas-ver-ocultos"
      aria-expanded={abierto}
      onClick={alAlternar}
    >
      {abierto ? 'Esconder' : 'Ver'} {que}
      <Icono nombre={abierto ? 'arriba' : 'abajo'} pequeno />
    </button>
  )
}
