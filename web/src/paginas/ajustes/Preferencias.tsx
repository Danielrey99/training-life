import { useState } from 'react'

import { Icono } from '../../componentes/Icono'
import { cambiarAjustes, POR_DEFECTO, useAjustes } from '../../utiles/ajustes'
import type { Ajustes } from '../../utiles/ajustes'
import { colorDelDia } from '../../utiles/colores'
import { leerNumero, numeroLegible } from '../../utiles/numeros'
import { nombreDelDiaSemana } from '../programas/textos'
import { CampoConPasos } from '../sesion/FormularioDeSerie'
import { HojaDeColor } from './HojaDeColor'

/** Unas pocas opciones, una al lado de otra; la elegida resaltada. */
function Selector<T extends string>({
  etiqueta,
  opciones,
  valor,
  alCambiar,
}: {
  etiqueta: string
  opciones: { clave: T; texto: string }[]
  valor: T
  alCambiar: (clave: T) => void
}) {
  return (
    <div
      className="ajustes-selector"
      role="group"
      aria-label={etiqueta}
      style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}
    >
      {opciones.map((opcion) => (
        <button
          key={opcion.clave}
          type="button"
          className={opcion.clave === valor ? 'activa' : undefined}
          aria-pressed={opcion.clave === valor}
          onClick={() => alCambiar(opcion.clave)}
        >
          {opcion.texto}
        </button>
      ))}
    </div>
  )
}

/**
 * El paso de los botones − / + del peso. Se guarda al escribir un número que vale; con
 * uno que no, avisa y se queda el de antes. Al salir del campo vuelve a enseñar el
 * guardado, para que no se quede a la vista algo que no vale.
 */
function CampoDePaso({ ajustes }: { ajustes: Ajustes }) {
  const [texto, setTexto] = useState(numeroLegible(ajustes.pasoPeso))
  const valor = leerNumero(texto)
  const vale = valor !== null && valor > 0 && valor <= 100

  return (
    <div className="ajustes-paso">
      <label>
        <span>Suben o bajan</span>
        <input
          className="campo-texto num"
          type="text"
          inputMode="decimal"
          value={texto}
          aria-invalid={!vale}
          onChange={(evento) => {
            setTexto(evento.target.value)
            const nuevo = leerNumero(evento.target.value)
            if (nuevo !== null && nuevo > 0 && nuevo <= 100) cambiarAjustes({ pasoPeso: nuevo })
          }}
          onFocus={(evento) => evento.target.select()}
          onBlur={() => setTexto(numeroLegible(ajustes.pasoPeso))}
        />
        <span>{ajustes.unidad} cada vez.</span>
      </label>
      {!vale && <p className="fallo">Pon un número mayor que 0 (hasta 100).</p>}
    </div>
  )
}

/** Lo que cabe en cada campo: los mismos límites que la API pone a un ejercicio de rutina. */
const MAXIMO_SERIES = 50
const MAXIMO_REPS = 1000

/**
 * Las series y reps con las que empieza un ejercicio nuevo de una rutina, con los mismos
 * campos − / + del formulario de la rutina. Se guardan cuando los tres valen; si no,
 * avisa y se quedan los de antes.
 */
function CamposDeObjetivo({ ajustes }: { ajustes: Ajustes }) {
  const [textos, setTextos] = useState({
    series: String(ajustes.objetivo.series),
    repsMin: String(ajustes.objetivo.repsMin),
    repsMax: String(ajustes.objetivo.repsMax),
  })
  const series = leerNumero(textos.series)
  const repsMin = leerNumero(textos.repsMin)
  const repsMax = leerNumero(textos.repsMax)
  const entero = (valor: number | null, maximo: number): valor is number =>
    valor !== null && Number.isInteger(valor) && valor >= 1 && valor <= maximo
  let fallo: string | null = null
  if (!entero(series, MAXIMO_SERIES))
    fallo = `Las series, un número entero del 1 al ${MAXIMO_SERIES}.`
  else if (!entero(repsMin, MAXIMO_REPS) || !entero(repsMax, MAXIMO_REPS))
    fallo = 'Las reps, números enteros mayores que 0.'
  else if (repsMax < repsMin) fallo = 'Las reps máximas no pueden ser menos que las mínimas.'

  function cambiar(cambios: Partial<typeof textos>) {
    const nuevos = { ...textos, ...cambios }
    setTextos(nuevos)
    const s = leerNumero(nuevos.series)
    const min = leerNumero(nuevos.repsMin)
    const max = leerNumero(nuevos.repsMax)
    if (
      entero(s, MAXIMO_SERIES) &&
      entero(min, MAXIMO_REPS) &&
      entero(max, MAXIMO_REPS) &&
      max >= min
    ) {
      cambiarAjustes({ objetivo: { series: s, repsMin: min, repsMax: max } })
    }
  }

  return (
    <>
      <CampoConPasos
        etiqueta="Series objetivo"
        valor={textos.series}
        cambiar={(valor) => cambiar({ series: valor })}
        paso={1}
        minimo={1}
      />
      <div className="ajustes-reps">
        <CampoConPasos
          etiqueta="Reps mínimas"
          valor={textos.repsMin}
          cambiar={(valor) => cambiar({ repsMin: valor })}
          paso={1}
          minimo={1}
        />
        <CampoConPasos
          etiqueta="Reps máximas"
          valor={textos.repsMax}
          cambiar={(valor) => cambiar({ repsMax: valor })}
          paso={1}
          minimo={1}
        />
      </div>
      {fallo && <p className="fallo">{fallo}</p>}
    </>
  )
}

/**
 * Los ajustes de cómo se entrena y cómo se ve la app. Se aplican al momento, sin
 * botón de guardar: no tocan nada de lo apuntado, solo cómo se enseña.
 */
export function Preferencias() {
  const ajustes = useAjustes()
  const [diaAbierto, setDiaAbierto] = useState<number | null>(null)
  const coloresPropios = Object.keys(ajustes.colores).length > 0

  function elegirColor(dia: number, eleccion: string | null) {
    const colores = { ...ajustes.colores }
    if (eleccion === null) delete colores[dia]
    else colores[dia] = eleccion
    cambiarAjustes({ colores })
    // Un color libre se elige en el selector del sistema, que avisa a cada cambio:
    // cerrar la hoja ahí cerraría también el selector.
    if (eleccion === null || !eleccion.startsWith('#')) setDiaAbierto(null)
  }

  return (
    <>
      <section className="ajustes-bloque">
        <h2 className="rotulo">Entrenamiento</h2>
        <div className="ajustes-tarjeta">
          <h3>Unidad de peso</h3>
          <Selector
            etiqueta="Unidad de peso"
            opciones={[
              { clave: 'kg', texto: 'Kilos (kg)' },
              { clave: 'lb', texto: 'Libras (lb)' },
            ]}
            valor={ajustes.unidad}
            alCambiar={(unidad) => cambiarAjustes({ unidad })}
          />
        </div>
        <div className="ajustes-tarjeta">
          <h3>Botones − y + del peso</h3>
          <CampoDePaso key={ajustes.unidad} ajustes={ajustes} />
        </div>
        <div className="ajustes-tarjeta">
          <h3>Ejercicio nuevo en una rutina</h3>
          <p>
            Con lo que empieza cada ejercicio que añadas a una rutina. Luego lo puedes cambiar en
            cada uno.
          </p>
          <CamposDeObjetivo ajustes={ajustes} />
        </div>
        <div className="ajustes-tarjeta">
          <h3>1RM estimado</h3>
          <Selector
            etiqueta="Cómo se calcula el 1RM"
            opciones={[
              { clave: 'media', texto: 'Media de las series' },
              { clave: 'mejor', texto: 'Mejor serie' },
            ]}
            valor={ajustes.unoRM}
            alCambiar={(unoRM) => cambiarAjustes({ unoRM })}
          />
          <p>
            {ajustes.unoRM === 'media'
              ? 'Hace la media de todas las series del día: si te cansas en las últimas, baja.'
              : 'Usa solo la serie más fuerte del día: las demás no cuentan.'}{' '}
            Con él se ve si un ejercicio ha mejorado, en el historial y en su gráfica.
          </p>
        </div>
      </section>

      <section className="ajustes-bloque">
        <h2 className="rotulo">Apariencia</h2>
        <div className="ajustes-tarjeta">
          <h3>Tema</h3>
          <Selector
            etiqueta="Tema"
            opciones={[
              { clave: 'oscuro', texto: 'Oscuro' },
              { clave: 'claro', texto: 'Claro' },
              { clave: 'sistema', texto: 'Automático' },
            ]}
            valor={ajustes.tema}
            alCambiar={(tema) => cambiarAjustes({ tema })}
          />
          <p>Automático usa el mismo que tu móvil u ordenador.</p>
        </div>
        <div className="ajustes-tarjeta">
          <h3>Colores de los días</h3>
          <p>Cada día de la semana tiene su color en el calendario y en las rutinas.</p>
          <ul className="ajustes-dias">
            {[1, 2, 3, 4, 5, 6, 7].map((dia) => (
              <li key={dia}>
                <button type="button" onClick={() => setDiaAbierto(dia)}>
                  <span className="color-muestra" style={{ background: colorDelDia(dia) }} />
                  {nombreDelDiaSemana(dia)}
                  <Icono nombre="abrir" pequeno />
                </button>
              </li>
            ))}
          </ul>
          {coloresPropios && (
            <button
              type="button"
              className="boton boton-texto"
              onClick={() => cambiarAjustes({ colores: POR_DEFECTO.colores })}
            >
              Volver a los colores de la app
            </button>
          )}
        </div>
      </section>

      {diaAbierto !== null && (
        <HojaDeColor
          diaSemana={diaAbierto}
          alElegir={(eleccion) => elegirColor(diaAbierto, eleccion)}
          alCerrar={() => setDiaAbierto(null)}
        />
      )}
    </>
  )
}
