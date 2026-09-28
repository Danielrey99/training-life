type Props = {
  seccion: string
}

/**
 * Lo que enseña una sección que todavía no se ha construido, para que su
 * pestaña no lleve a una página en blanco mientras la web se rehace.
 */
export function PorHacer({ seccion }: Props) {
  return (
    <p className="aviso">
      {seccion} todavía no está hecho: la web se está rehaciendo pantalla a pantalla.
    </p>
  )
}
