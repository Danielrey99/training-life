import type { DiaSeguimiento } from '../api/tipos'
import { colorDelDia, colorDeRutina } from '../utiles/colores'
import { diaDeLaSemana } from '../utiles/fechas'

import './MarcaDelDia.css'

/** La flecha de un día movido: → se hizo después, ← se hizo antes. */
function Flecha({ color, haciaAtras }: { color: string; haciaAtras: boolean }) {
  return (
    <svg className="marca-flecha" viewBox="0 0 24 24" style={{ stroke: color }} aria-hidden>
      <path d={haciaAtras ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </svg>
  )
}

/**
 * La marca de un día, la misma en la tira de Hoy y en el calendario.
 *
 * Junta dos cosas que pueden no coincidir: **lo que se hizo ese día**, un punto
 * lleno del color del día que contó (el del lunes si ese día se recuperó el
 * lunes); y **lo que tocaba**, del color de su propio día: un aro si sigue sin
 * hacer, una flecha si se hizo otro día (→ después, ← antes) y un punto apagado
 * si aún no ha llegado. Por eso salen combinadas: "●○" es que se hizo otra cosa y
 * lo suyo sigue sin hacer, y "←●" que lo suyo se hizo antes y ese día, otra cosa.
 */
export function MarcaDelDia({
  dia,
  diasDelPrograma,
}: {
  dia: DiaSeguimiento
  // Los del programa activo, para dar color a lo que se hizo sin contar para ningún día.
  diasDelPrograma?: { dia_semana: number; rutina: { id: number } }[]
}) {
  const propio = colorDelDia(diaDeLaSemana(dia.fecha))
  const sesion = dia.sesion

  // Lo que se hizo: del color del día que cuenta; si no cuenta ninguno, del día de
  // su rutina en el programa, o neutro si tampoco está en él.
  let hecho: string | null = null
  if (sesion) {
    hecho =
      sesion.cuenta && sesion.cubre_fecha
        ? colorDelDia(diaDeLaSemana(sesion.cubre_fecha))
        : colorDeRutina(diasDelPrograma, sesion.rutina.id)
  }

  // Lo que tocaba, si no es lo mismo que el punto de lo hecho.
  let tocaba = null
  if (dia.estado === 'movido' && dia.cubierto_por) {
    const antes = dia.cubierto_por.fecha < dia.fecha
    tocaba = <Flecha color={propio} haciaAtras={antes} />
    // Adelantado: la flecha va delante del punto de lo que se hizo ese día.
    if (antes) {
      return (
        <span className="marca">
          {tocaba}
          {hecho && <span className="marca-punto" style={{ background: hecho }} />}
        </span>
      )
    }
  } else if (dia.estado === 'sin_hacer' || dia.estado === 'pendiente') {
    tocaba = <span className="marca-punto" style={{ border: `1.5px solid ${propio}` }} />
  } else if (dia.estado === 'proximo') {
    tocaba = <span className="marca-punto apagado" style={{ background: propio }} />
  }

  return (
    <span className="marca">
      {hecho && <span className="marca-punto" style={{ background: hecho }} />}
      {tocaba}
    </span>
  )
}
