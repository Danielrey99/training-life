/**
 * Los iconos de la app, dibujados a trazo como en los bocetos. Puerto de
 * `web/src/componentes/Icono.tsx` con react-native-svg: los mismos trazos, y el color, que
 * en la web hereda del texto, aquí se pasa.
 */
import type { ReactNode } from 'react'
import type { ColorValue } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

const TRAZOS = {
  entrenar: <Path d="M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8" />,
  historial: (
    <>
      <Rect x="3" y="5" width="18" height="16" rx="2" />
      <Path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  programas: (
    <>
      <Rect x="3" y="4" width="18" height="16" rx="2" />
      <Path d="M3 9h18M9 9v11M15 9v11" />
    </>
  ),
  ejercicios: (
    <>
      <Path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <Path d="M5 17a3 3 0 0 1 3-3h11" />
    </>
  ),
  volver: <Path d="M15 6l-6 6 6 6" />,
  abrir: <Path d="M9 6l6 6-6 6" />,
  abajo: <Path d="M6 9l6 6 6-6" />,
  arriba: <Path d="M6 15l6-6 6 6" />,
  hecho: <Path d="M5 12l4 4L19 6" />,
  elegido: <Path d="M5 12l5 5 9-10" />,
  editar: (
    <>
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  quitar: <Path d="M6 6l12 12M18 6L6 18" />,
  mas: <Path d="M12 5v14M5 12h14" />,
  menos: <Path d="M5 12h14" />,
  // El asa para arrastrar y cambiar el orden.
  asa: <Path d="M5 9h14M5 15h14" />,
  // El engranaje de Lucide (licencia ISC), al trazo de los demás.
  ajustes: (
    <>
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  buscar: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-4-4" />
    </>
  ),
  candado: (
    <>
      <Rect x="5" y="11" width="14" height="9" rx="2" />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type NombreIcono = keyof typeof TRAZOS

interface Props {
  nombre: NombreIcono
  color: ColorValue
  /** 18 px en vez de 24: dentro de una fila o de un botón pequeño. */
  pequeno?: boolean
}

export function Icono({ nombre, color, pequeno = false }: Props) {
  const lado = pequeno ? 18 : 24
  return (
    <Svg
      width={lado}
      height={lado}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {TRAZOS[nombre]}
    </Svg>
  )
}
