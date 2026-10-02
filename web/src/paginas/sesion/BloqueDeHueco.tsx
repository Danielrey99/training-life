import type { Ejercicio, HuecoDeRutina, Serie } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { fechaCorta } from '../../utiles/fechas'
import { pesoLegible } from '../../utiles/numeros'
import { FichasUltimaVez } from './FichasUltimaVez'
import { FormularioDeSerie, type DatosDeSerie } from './FormularioDeSerie'
import { SelectorDeEjercicio } from './SelectorDeEjercicio'
import { useUltimaVez } from './ultimaVez'

export type SerieAGuardar = DatosDeSerie & {
  ejercicio_id: number
  numero_serie: number
}

type Props = {
  // Un hueco de la rutina o, con `null`, las series que no van a ningún hueco
  // (un entrenamiento libre, o las que se apuntaron fuera de la rutina).
  hueco: HuecoDeRutina | null
  titulo: string
  rutinaId: number | null
  // Las series de hoy en este bloque.
  series: Serie[]
  // El ejercicio de hoy; nulo si no queda ninguno que se pueda usar.
  elegido: Ejercicio | null
  elegir: (ejercicio: Ejercicio) => void
  // Para las series sueltas, que no tienen principal ni comodines entre los que elegir.
  biblioteca: Ejercicio[]
  abierto: boolean
  abrir: () => void
  // La serie que se está editando. La lleva la pantalla, porque las ediciones van de
  // una en una: con una serie o la nota abiertas, todo lo demás se queda en gris.
  editandoId: number | null
  alEditar: (serieId: number | null) => void
  bloqueado: boolean
  sesion: { id: number; fecha: string }
  guardar: (datos: SerieAGuardar, serieId?: number) => Promise<void>
  pedirBorrar: (serie: Serie) => void
}

/**
 * Un hueco de la sesión. Plegado es una fila con lo que lleva hecho; desplegado
 * (solo uno a la vez) tiene la última vez, las series de hoy y el formulario.
 */
export function BloqueDeHueco(props: Props) {
  const { hueco, titulo, series, elegido, abierto, abrir, bloqueado } = props
  const hechas = series.length
  const objetivo = hueco?.series_objetivo
  const completo = objetivo !== undefined && hechas >= objetivo
  const comodin = hueco !== null && elegido !== null && elegido.id !== hueco.ejercicio_principal.id

  if (!abierto) {
    return (
      <button type="button" className="hueco-plegado" onClick={abrir} disabled={bloqueado}>
        <span className="hueco-plegado-nombre">
          <span>{titulo}</span>
          {comodin && <span className="etiqueta-chica">comodín</span>}
          {hueco?.oculto_desde && <span className="etiqueta-chica">oculto</span>}
        </span>
        <span className={completo ? 'hueco-cuenta num completo' : 'hueco-cuenta num'}>
          {objetivo === undefined ? hechas : `${hechas}/${objetivo}`}
        </span>
        <span className={completo ? 'completo' : ''}>
          <Icono nombre={completo ? 'hecho' : 'abrir'} pequeno />
        </span>
      </button>
    )
  }

  return <HuecoAbierto {...props} />
}

function HuecoAbierto({
  hueco,
  titulo,
  rutinaId,
  series,
  elegido,
  elegir,
  biblioteca,
  sesion,
  guardar,
  pedirBorrar,
  editandoId,
  alEditar,
  bloqueado,
}: Props) {
  // Si la serie que se editaba se borra, el formulario vuelve a ser el de una nueva.
  const editando = series.find((serie) => serie.id === editandoId) ?? null

  const idElegido = elegido?.id ?? null
  const ultima = useUltimaVez(rutinaId, hueco?.id ?? null, idElegido, sesion)

  // La serie anterior de hoy con este ejercicio, si la hay: de ella arranca el formulario.
  const anteriorDeHoy = [...series].reverse().find((serie) => serie.ejercicio_id === idElegido)
  const semilla = editando ?? anteriorDeHoy ?? ultima?.series[0] ?? null
  // Sin serie de hoy hay que esperar a la última vez, o el formulario arrancaría
  // vacío y se rellenaría solo un instante después.
  const semillaLista = editando !== null || anteriorDeHoy !== undefined || ultima !== undefined
  // El número más alto + 1 y no la cuenta: borrando una del medio, contarlas
  // repetiría un número.
  const siguiente = series.reduce((mayor, serie) => Math.max(mayor, serie.numero_serie), 0) + 1
  // Un hueco oculto conserva sus series para poder corregirlas, pero no admite nuevas.
  // Con otra edición abierta (la nota), el formulario de una nueva no se enseña.
  const admiteNuevas = elegido !== null && !hueco?.oculto_desde && !bloqueado
  const comodines = hueco?.alternativas ?? []

  async function guardarDesdeFormulario(datos: DatosDeSerie) {
    if (editando) {
      // Editar corrige peso, reps o variante; el ejercicio de la serie no cambia.
      await guardar(
        {
          ...datos,
          ejercicio_id: editando.ejercicio_id,
          numero_serie: editando.numero_serie,
        },
        editando.id,
      )
      alEditar(null)
    } else if (elegido) {
      await guardar({
        ...datos,
        ejercicio_id: elegido.id,
        numero_serie: siguiente,
      })
    }
  }

  return (
    <section className="hueco-abierto">
      <div className="hueco-cabecera">
        <div className="hueco-nombre">
          <span>{titulo}</span>
          {hueco && elegido && comodines.length > 0 && rutinaId !== null && !bloqueado && (
            <SelectorDeEjercicio
              rutinaId={rutinaId}
              huecoId={hueco.id}
              principal={hueco.ejercicio_principal}
              comodines={comodines}
              elegido={elegido}
              sesion={sesion}
              elegir={elegir}
            />
          )}
        </div>
        {hueco && (
          <span className="objetivo num">
            {hueco.series_objetivo} × {hueco.reps_min}-{hueco.reps_max}
          </span>
        )}
        {hueco?.oculto_desde && <span className="etiqueta-chica">oculto</span>}
      </div>

      {!hueco && (
        <label className="campo">
          <span className="campo-etiqueta">Ejercicio</span>
          <select
            className="campo-texto"
            value={idElegido ?? ''}
            onChange={(evento) => {
              const ejercicio = biblioteca.find((otro) => otro.id === Number(evento.target.value))
              if (ejercicio) elegir(ejercicio)
            }}
          >
            {biblioteca.map((ejercicio) => (
              <option key={ejercicio.id} value={ejercicio.id}>
                {ejercicio.nombre}
              </option>
            ))}
          </select>
        </label>
      )}

      {ultima && ultima.series.length > 0 && (
        <div className="ultima-vez">
          <span className="rotulo">Última vez · {fechaCorta(ultima.fecha)}</span>
          <FichasUltimaVez series={ultima.series} />
        </div>
      )}

      {series.length > 0 && (
        <div className="hoy">
          <span className="rotulo hoy-rotulo">Hoy</span>
          <ul>
            {series.map((serie) => (
              <li key={serie.id} className={serie.id === editandoId ? 'serie editando' : 'serie'}>
                <span className="serie-numero num">{serie.numero_serie}</span>
                <span className="serie-texto">
                  <span className="serie-carga num">
                    {pesoLegible(serie.peso)} kg × {serie.repeticiones} reps
                  </span>
                  {serie.variante && <span className="serie-variante">{serie.variante}</span>}
                  {/* Con un comodín por medio, un mismo hueco mezcla ejercicios: se dice cuál. */}
                  {serie.ejercicio_id !== idElegido && (
                    <span className="serie-ejercicio">{serie.ejercicio.nombre}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="boton-icono"
                  aria-label={`Editar la serie ${serie.numero_serie}`}
                  onClick={() => alEditar(serie.id)}
                  disabled={bloqueado}
                >
                  <Icono nombre="editar" pequeno />
                </button>
                <button
                  type="button"
                  className="boton-icono quitar"
                  aria-label={`Borrar la serie ${serie.numero_serie}`}
                  onClick={() => pedirBorrar(serie)}
                  disabled={bloqueado}
                >
                  <Icono nombre="quitar" pequeno />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(editando || admiteNuevas) && semillaLista && (
        <FormularioDeSerie
          key={`${idElegido}-${editando?.id ?? 'nueva'}`}
          numero={editando?.numero_serie ?? siguiente}
          semilla={semilla}
          editando={editando !== null}
          alGuardar={guardarDesdeFormulario}
          alCancelar={() => alEditar(null)}
        />
      )}

      {hueco && !elegido && (
        <p className="nota">
          Los ejercicios de este hueco están ocultos: muestra alguno para usarlo.
        </p>
      )}
    </section>
  )
}
