import { useState } from 'react'

import type { TipoRegistro } from '../../api/tipos'
import { CampoDeDuracion } from '../../componentes/CampoDeDuracion'
import { Icono } from '../../componentes/Icono'
import { cambiarAjustes, POR_DEFECTO, useAjustes } from '../../utiles/ajustes'
import type { Ajustes } from '../../utiles/ajustes'
import { colorDelDia } from '../../utiles/colores'
import { aKilos, enUnidad, leerNumero, numeroLegible, pesoLegible } from '../../utiles/numeros'
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
const MAXIMO_SEGUNDOS = 86400
// El peso corporal que vale, en kg.
const MINIMO_PESO_CORPORAL = 20
const MAXIMO_PESO_CORPORAL = 400

/** Un número entero de 1 al máximo; lo demás no vale. */
const entero = (valor: number | null, maximo: number): valor is number =>
  valor !== null && Number.isInteger(valor) && valor >= 1 && valor <= maximo

/**
 * El paso de los botones − / + de los segundos de una duración: un número entero de
 * segundos, de 1 a 59. Se guarda al escribir uno que vale.
 */
function CampoDePasoDelTiempo({ ajustes }: { ajustes: Ajustes }) {
  const [texto, setTexto] = useState(String(ajustes.pasoTiempo))
  const vale = entero(leerNumero(texto), 59)

  return (
    <div className="ajustes-paso">
      <label>
        <span>Suben o bajan</span>
        <input
          className="campo-texto num"
          type="text"
          inputMode="numeric"
          value={texto}
          aria-invalid={!vale}
          onChange={(evento) => {
            setTexto(evento.target.value)
            const nuevo = leerNumero(evento.target.value)
            if (entero(nuevo, 59)) cambiarAjustes({ pasoTiempo: nuevo })
          }}
          onFocus={(evento) => evento.target.select()}
          onBlur={() => setTexto(String(ajustes.pasoTiempo))}
        />
        <span>segundos cada vez.</span>
      </label>
      {!vale && <p className="fallo">Pon un número entero de segundos, del 1 al 59.</p>}
    </div>
  )
}

/**
 * Cuánto pesa la persona: con él arranca cada serie de los ejercicios de peso corporal.
 * Vacío vale (no se sabe): las series arrancan sin él. Se guarda al escribir un peso que
 * vale, de 20 a 400 kg o su equivalente en la unidad elegida.
 */
function CampoDePesoCorporal({ ajustes }: { ajustes: Ajustes }) {
  const [texto, setTexto] = useState(
    ajustes.pesoCorporal === null ? '' : pesoLegible(ajustes.pesoCorporal),
  )
  const valor = leerNumero(texto)
  const minimo = Math.ceil(enUnidad(MINIMO_PESO_CORPORAL))
  const maximo = Math.floor(enUnidad(MAXIMO_PESO_CORPORAL))
  const vale = texto.trim() === '' || (valor !== null && valor >= minimo && valor <= maximo)

  function cambiar(nuevoTexto: string) {
    setTexto(nuevoTexto)
    const nuevo = leerNumero(nuevoTexto)
    if (nuevoTexto.trim() === '') cambiarAjustes({ pesoCorporal: null })
    else if (nuevo !== null && nuevo >= minimo && nuevo <= maximo) {
      cambiarAjustes({ pesoCorporal: aKilos(nuevo) })
    }
  }

  return (
    <>
      <CampoConPasos
        etiqueta={`Peso corporal (${ajustes.unidad})`}
        valor={texto}
        cambiar={cambiar}
        paso={ajustes.pasoPeso}
        minimo={minimo}
        decimales
      />
      {!vale && (
        <p className="fallo">
          Pon un peso de {minimo} a {maximo} {ajustes.unidad}.
        </p>
      )}
    </>
  )
}

/**
 * Con lo que empieza un ejercicio nuevo de una rutina según cómo se apunta, con los
 * mismos campos del formulario del ejercicio: series y reps mínimas y máximas, o series
 * y duración mínima y máxima. Se guarda cuando todo vale; si no, avisa y se queda lo de
 * antes.
 */
function CamposDeObjetivo({
  ajustes,
  tipo,
  titulo,
}: {
  ajustes: Ajustes
  tipo: TipoRegistro
  titulo: string
}) {
  const guardado = ajustes.objetivoNuevo[tipo]
  const porDuracion = tipo === 'tiempo'
  const maximo = porDuracion ? MAXIMO_SEGUNDOS : MAXIMO_REPS
  const [textos, setTextos] = useState({
    series: String(guardado.series),
    min: String(guardado.min),
    max: String(guardado.max),
  })
  const series = leerNumero(textos.series)
  const min = leerNumero(textos.min)
  const max = leerNumero(textos.max)
  let fallo: string | null = null
  if (!entero(series, MAXIMO_SERIES)) {
    fallo = `Las series, un número entero del 1 al ${MAXIMO_SERIES}.`
  } else if (!entero(min, maximo) || !entero(max, maximo)) {
    fallo = porDuracion
      ? 'La duración, de 1 segundo a 24 horas.'
      : 'Las reps, números enteros mayores que 0.'
  } else if (max < min) {
    fallo = porDuracion
      ? 'La duración máxima no puede ser menos que la mínima.'
      : 'Las reps máximas no pueden ser menos que las mínimas.'
  }

  function cambiar(cambios: Partial<typeof textos>) {
    const nuevos = { ...textos, ...cambios }
    setTextos(nuevos)
    const s = leerNumero(nuevos.series)
    const n = leerNumero(nuevos.min)
    const x = leerNumero(nuevos.max)
    if (entero(s, MAXIMO_SERIES) && entero(n, maximo) && entero(x, maximo) && x >= n) {
      cambiarAjustes({
        objetivoNuevo: { ...ajustes.objetivoNuevo, [tipo]: { series: s, min: n, max: x } },
      })
    }
  }

  return (
    <div className="ajustes-objetivo">
      <h4>{titulo}</h4>
      <CampoConPasos
        etiqueta="Series objetivo"
        valor={textos.series}
        cambiar={(valor) => cambiar({ series: valor })}
        paso={1}
        minimo={1}
      />
      {porDuracion ? (
        <>
          <CampoDeDuracion
            etiqueta="Duración mínima"
            segundos={min ?? 0}
            cambiar={(segundos) => cambiar({ min: String(segundos) })}
            paso={ajustes.pasoTiempo}
          />
          <CampoDeDuracion
            etiqueta="Duración máxima"
            segundos={max ?? 0}
            cambiar={(segundos) => cambiar({ max: String(segundos) })}
            paso={ajustes.pasoTiempo}
          />
        </>
      ) : (
        <div className="ajustes-reps">
          <CampoConPasos
            etiqueta="Reps mínimas"
            valor={textos.min}
            cambiar={(valor) => cambiar({ min: valor })}
            paso={1}
            minimo={1}
          />
          <CampoConPasos
            etiqueta="Reps máximas"
            valor={textos.max}
            cambiar={(valor) => cambiar({ max: valor })}
            paso={1}
            minimo={1}
          />
        </div>
      )}
      {fallo && <p className="fallo">{fallo}</p>}
    </div>
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
    setDiaAbierto(null)
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
          <h3>Peso corporal</h3>
          <p>
            Se apunta con cada serie de los ejercicios de peso corporal (dominadas, fondos…), y ahí
            lo puedes cambiar. Cambiarlo aquí no cambia las series que ya tienes apuntadas.
          </p>
          <CampoDePesoCorporal key={ajustes.unidad} ajustes={ajustes} />
        </div>
        <div className="ajustes-tarjeta">
          <h3>Botones − y + del peso</h3>
          <CampoDePaso key={ajustes.unidad} ajustes={ajustes} />
        </div>
        <div className="ajustes-tarjeta">
          <h3>Botones − y + del tiempo</h3>
          <CampoDePasoDelTiempo ajustes={ajustes} />
        </div>
        <div className="ajustes-tarjeta">
          <h3>Ejercicio nuevo en una rutina</h3>
          <p>
            Con lo que empieza cada ejercicio que añadas a una rutina. Luego lo puedes cambiar en
            cada uno.
          </p>
          <CamposDeObjetivo ajustes={ajustes} tipo="peso_reps" titulo="Peso y repeticiones" />
          <CamposDeObjetivo ajustes={ajustes} tipo="corporal" titulo="Peso corporal" />
          <CamposDeObjetivo ajustes={ajustes} tipo="tiempo" titulo="Tiempo" />
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
              ? 'Hace la media de todas las series del día.'
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
          <p className="ajustes-centrado">Automático usa el mismo que tu móvil u ordenador.</p>
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
