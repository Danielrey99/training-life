import { useEffect } from 'react'

import type { ProgramaDia, Rutina } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import '../historial/historial.css'
import './programas.css'
import { ejercicios, nombreDelDiaSemana } from './textos'

type Props = {
  diaSemana: number
  // Las visibles: lo oculto deja de ofrecerse.
  rutinas: Rutina[]
  // Los días del programa activo, para el orden.
  diasDelActivo: ProgramaDia[] | undefined
  // La que ya tiene el día, con su marca; nula si es descanso.
  elegida: number | null
  alElegir: (rutina: Rutina) => void
  alCerrar: () => void
  // Si se pasa, la hoja ofrece *+ Nueva rutina* al final (P5).
  alCrearNueva?: () => void
}

/**
 * La hoja que sube al pulsar › o *Añadir rutina* en un día de la semana del
 * programa: tus rutinas para elegir una. Elegir no guarda nada: cambia el borrador
 * de quien la abre, que lo guarda con *Guardar* o *Crear*.
 *
 * Primero las del programa activo, en el orden de su semana (cada una una vez), y
 * luego las demás por orden alfabético: así las de siempre salen arriba. Sin color:
 * una rutina solo lo tiene puesta en un día, y es el de ese día (decisión del autor).
 */
export function HojaDeRutinas({
  diaSemana,
  rutinas,
  diasDelActivo,
  elegida,
  alElegir,
  alCerrar,
  alCrearNueva,
}: Props) {
  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [alCerrar])

  const porId = new Map(rutinas.map((rutina) => [rutina.id, rutina]))
  const primero: Rutina[] = []
  for (const dia of [...(diasDelActivo ?? [])].sort((a, b) => a.dia_semana - b.dia_semana)) {
    const rutina = porId.get(dia.rutina.id)
    if (rutina && !primero.includes(rutina)) primero.push(rutina)
  }
  const resto = rutinas
    .filter((rutina) => !primero.includes(rutina))
    .sort((una, otra) => una.nombre.localeCompare(otra.nombre, 'es'))

  return (
    <div className="hoja-fondo" onClick={alCerrar}>
      <div
        className="hoja"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoja-titulo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <span className="hoja-asa" />
        <h2 id="hoja-titulo">{nombreDelDiaSemana(diaSemana)}</h2>
        <p className="hoja-subtitulo">
          {alCrearNueva ? 'Elige una de tus rutinas o crea una nueva' : 'Elige una de tus rutinas'}
        </p>
        {rutinas.length === 0 && <p className="hoja-vacia">Todavía no tienes rutinas.</p>}
        {[...primero, ...resto].map((rutina) => (
          <button
            key={rutina.id}
            type="button"
            className="hoja-fila"
            onClick={() => alElegir(rutina)}
          >
            <span className="hoja-fila-texto">
              <strong>{rutina.nombre}</strong>
            </span>
            <span className="hoja-fila-extra">{ejercicios(rutina)}</span>
            {elegida === rutina.id ? (
              <Icono nombre="elegido" pequeno />
            ) : (
              <span className="hoja-fila-marca" />
            )}
          </button>
        ))}
        {alCrearNueva && (
          <button type="button" className="hoja-fila programas-hoja-nueva" onClick={alCrearNueva}>
            + Nueva rutina
          </button>
        )}
      </div>
    </div>
  )
}
