/**
 * Los iconos de la app, dibujados a trazo como en los bocetos.
 *
 * Van en línea y no como archivos sueltos para que hereden el color del texto
 * (`currentColor`): el icono de la pestaña activa se pone verde sin tocarlo.
 */

const TRAZOS = {
  entrenar: <path d="M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8" />,
  historial: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  programas: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11M15 9v11" />
    </>
  ),
  ejercicios: (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h11" />
    </>
  ),
  volver: <path d="M15 6l-6 6 6 6" />,
  abrir: <path d="M9 6l6 6-6 6" />,
  abajo: <path d="M6 9l6 6 6-6" />,
  arriba: <path d="M6 15l6-6 6 6" />,
  hecho: <path d="M5 12l4 4L19 6" />,
  elegido: <path d="M5 12l5 5 9-10" />,
  editar: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  quitar: <path d="M6 6l12 12M18 6L6 18" />,
  mas: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
}

export type NombreIcono = keyof typeof TRAZOS

type Props = {
  nombre: NombreIcono
  // 18 px en vez de 24: el tamaño de los iconos dentro de una fila o un botón pequeño.
  pequeno?: boolean
}

export function Icono({ nombre, pequeno = false }: Props) {
  return (
    <svg
      className={pequeno ? 'icono icono-pequeno' : 'icono'}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {TRAZOS[nombre]}
    </svg>
  )
}
