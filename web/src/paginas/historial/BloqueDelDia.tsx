import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { Ejercicio, HuecoDeRutina, Serie, SesionHistorial } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { fechaEnFrase } from '../../utiles/fechas'
import { pesoLegible } from '../../utiles/numeros'
import { FichasUltimaVez } from '../sesion/FichasUltimaVez'
import { FormularioDeSerie, type DatosDeSerie } from '../sesion/FormularioDeSerie'
import { SelectorDeEjercicio } from '../sesion/SelectorDeEjercicio'
import type { Abierta } from './Dia'

/** Un bloque del día: un hueco de la rutina. */
export type Bloque = {
  clave: string
  hueco: HuecoDeRutina
  // El de sus series; en un hueco que ese día se quedó sin series, el primero que
  // se puede elegir (el principal, o el primer comodín si está oculto).
  ejercicio: Ejercicio
  series: Serie[]
  // La última vez con ese ejercicio en ese hueco, antes de este día; nula si no hay.
  ultima: SesionHistorial | null
}

export type Insignia = { texto: string; clase: 'mejor' | 'igual' | 'peor' }

// `clase`: si el ejercicio mejoró (lo decide el 1RM); `insignias`: qué cambió, una por
// cosa ("+1 kg", "−3 reps"), y al final la del 1RM con su flecha.
export type Mejora = { clase: Insignia['clase']; insignias: Insignia[] }

type Props = {
  bloque: Bloque
  // La posición entre los huecos visibles; 0 si no lleva número.
  numero: number
  mejora: Mejora | null
  rutinaId: number
  sesion: { id: number; fecha: string }
  editando: boolean
  // Lo que hay abierto en el día: una sola cosa a la vez, y con otra abierta todo lo de
  // este bloque se queda en gris.
  abierta: Abierta | null
  alAbrir: (abierta: Abierta) => void
  alCerrar: () => void
  alBorrarSerie: (serie: Serie) => void
  // Cambiar o añadir una serie solo toca el borrador del día: se guarda con Guardar arriba.
  alCambiarSerie: (serie: Serie, datos: DatosDeSerie) => void
  alAnadirSerie: (ejercicio: Ejercicio, numero: number, datos: DatosDeSerie) => void
}

/**
 * Un hueco en el día del historial: sus series, cómo le fue frente a la última vez y
 * esa última vez en fichas.
 *
 * Con Editar, cada serie gana su lápiz y su ✕, y el bloque un *+ Añadir serie* para
 * la que se olvidó apuntar. Las ediciones van de una en una: con un formulario abierto
 * en cualquier parte del día, lo de este bloque se queda en gris. Un hueco que ese día se quedó sin series solo sale al
 * editar, para poder añadírselas, y si tiene comodines lleva la misma flecha que en
 * la sesión para elegir con qué ejercicio.
 */
export function BloqueDelDia({
  bloque,
  numero,
  mejora,
  rutinaId,
  sesion,
  editando,
  abierta,
  alAbrir,
  alCerrar,
  alBorrarSerie,
  alCambiarSerie,
  alAnadirSerie,
}: Props) {
  const [elegido, setElegido] = useState<Ejercicio>(bloque.ejercicio)

  const editandoSerie = abierta?.tipo === 'serie' ? abierta.id : null
  const anadiendo = abierta?.tipo === 'anadir' && abierta.clave === bloque.clave
  // Hay algo abierto (aquí o en otra parte): no se puede abrir nada más.
  const bloqueado = abierta !== null

  const { hueco, series } = bloque
  const vacio = series.length === 0
  const principal = hueco.ejercicio_principal
  const ejercicio = vacio ? elegido : bloque.ejercicio
  const esComodin = principal.id !== ejercicio.id
  // Las series nuevas, solo en un hueco visible: el backend no las admite en uno oculto.
  const admiteNuevas = editando && !hueco.oculto_desde
  const comodines = hueco.alternativas.filter((otro) => !otro.oculto_desde)
  const siguiente = series.reduce((mayor, serie) => Math.max(mayor, serie.numero_serie), 0) + 1
  // Arranca con la última serie del bloque o, si no tiene, con la última vez (si es
  // del ejercicio que se va a apuntar).
  const ultimaDelBloque = series.at(-1)
  const semilla =
    ultimaDelBloque ??
    (bloque.ultima && ejercicio.id === bloque.ejercicio.id ? bloque.ultima.series[0] : null)

  return (
    <section className={vacio ? 'dia-hueco vacio' : 'dia-hueco'}>
      <div className="dia-hueco-cabecera">
        <h2>
          {numero > 0 && `${numero} · `}
          {ejercicio.nombre}
        </h2>
        {/* Elegir con qué ejercicio se hizo es parte de añadir la serie: la flecha sigue en
            el hueco al que se añade, y solo desaparece si lo abierto es otra cosa. */}
        {vacio && admiteNuevas && (!bloqueado || anadiendo) && comodines.length > 0 && (
          <SelectorDeEjercicio
            rutinaId={rutinaId}
            huecoId={hueco.id}
            principal={principal}
            comodines={comodines}
            elegido={elegido}
            sesion={sesion}
            elegir={setElegido}
          />
        )}
        {/* El objetivo arriba, con el nombre, y no junto a las mejoras: es lo que pide la
            rutina, no cómo fue el día. */}
        <span className="dia-objetivo num">
          {hueco.series_objetivo} × {hueco.reps_min}-{hueco.reps_max}
        </span>
        {/* A la gráfica de este ejercicio; con Editar no, que la pantalla se queda quieta. */}
        {!vacio && !editando && (
          <Link
            to={`/progresion/${ejercicio.id}`}
            className="boton-icono dia-progresion"
            aria-label={`Ver la progresión de ${ejercicio.nombre}`}
          >
            <Icono nombre="abrir" pequeno />
          </Link>
        )}
      </div>
      {mejora && (
        <div className="dia-insignias">
          {mejora.insignias.map((insignia) => (
            <span key={insignia.texto} className={`dia-mejora num ${insignia.clase}`}>
              {insignia.texto}
            </span>
          ))}
        </div>
      )}

      {vacio && <p className="rotulo dia-primera">Ese día no se apuntó ninguna serie</p>}
      <ul>
        {series.map((serie) => (
          <li key={serie.id}>
            <div className={serie.id === editandoSerie ? 'serie editando' : 'serie'}>
              <span className="serie-numero num">{serie.numero_serie}</span>
              <span className="serie-texto">
                <span className="serie-carga num">
                  {pesoLegible(serie.peso)} kg × {serie.repeticiones} reps
                </span>
                {serie.variante && <span className="serie-variante">{serie.variante}</span>}
              </span>
              {editando && (
                <>
                  <button
                    type="button"
                    className="boton-icono"
                    aria-label={`Editar la serie ${serie.numero_serie}`}
                    onClick={() => alAbrir({ tipo: 'serie', id: serie.id })}
                    disabled={bloqueado}
                  >
                    <Icono nombre="editar" pequeno />
                  </button>
                  <button
                    type="button"
                    className="boton-icono quitar"
                    aria-label={`Borrar la serie ${serie.numero_serie}`}
                    onClick={() => alBorrarSerie(serie)}
                    disabled={bloqueado}
                  >
                    <Icono nombre="quitar" pequeno />
                  </button>
                </>
              )}
            </div>
            {editando && serie.id === editandoSerie && (
              <FormularioDeSerie
                numero={serie.numero_serie}
                semilla={serie}
                editando
                textoGuardar="Aplicar"
                alGuardar={async (datos) => alCambiarSerie(serie, datos)}
                alCancelar={alCerrar}
              />
            )}
          </li>
        ))}
      </ul>

      {admiteNuevas &&
        (anadiendo ? (
          <FormularioDeSerie
            key={`${ejercicio.id}-${siguiente}`}
            numero={siguiente}
            semilla={semilla}
            editando={false}
            enLinea
            textoGuardar="Añadir"
            alGuardar={async (datos) => alAnadirSerie(ejercicio, siguiente, datos)}
            alCancelar={alCerrar}
          />
        ) : (
          <button
            type="button"
            className="boton boton-texto dia-anadir-serie"
            onClick={() => alAbrir({ tipo: 'anadir', clave: bloque.clave })}
            disabled={bloqueado}
          >
            + Añadir serie
          </button>
        ))}

      {!vacio && (
        <div className="dia-vez">
          {bloque.ultima ? (
            <>
              <span className="rotulo">
                Última vez · {fechaEnFrase(bloque.ultima.fecha, false)}
              </span>
              <FichasUltimaVez series={bloque.ultima.series} />
            </>
          ) : (
            <span className="rotulo dia-primera">Primera vez con este ejercicio en el hueco</span>
          )}
        </div>
      )}
      {esComodin && (
        <div className="dia-pie">
          <span>En lugar de {principal.nombre}</span>
          <span className="etiqueta-chica">comodín</span>
        </div>
      )}
    </section>
  )
}
