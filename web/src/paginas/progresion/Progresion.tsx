import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { Ejercicio, SesionHistorial } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { diaYMesConAnio, diasEntre, fechaAbreviada, hoy, sumarDias } from '../../utiles/fechas'
import { medidasDe, valorEnPantalla } from '../../utiles/progresion'
import { useVolver } from '../../utiles/volver'
import { FichasUltimaVez } from '../sesion/FichasUltimaVez'
import { Grafica, type Punto } from './Grafica'
import '../sesion/sesion.css'
import './progresion.css'

const RANGOS = [
  { clave: '1m', texto: '1 mes', dias: 30 },
  { clave: '3m', texto: '3 meses', dias: 91 },
  { clave: '6m', texto: '6 meses', dias: 182 },
  { clave: 'todo', texto: 'Todo', dias: null },
] as const

// Las sesiones que se enseñan antes de "Ver N sesiones más".
const VISIBLES = 4

function fechaFila(iso: string): string {
  const texto = fechaAbreviada(iso)
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * El rango con el que se abre, si no se ha elegido otro: el más corto en el que cabe todo
 * el historial del ejercicio, desde la primera sesión (decisión del autor, 15-10-2026,
 * para revisar más adelante). Así nunca abre con una gráfica casi vacía, y con mucho
 * historial abre en Todo, que se ve como 6 meses pero deja deslizar hacia atrás. Sin
 * sesiones, el más corto, con su aviso.
 */
function rangoPorDefecto(sesiones: SesionHistorial[]) {
  // De la más reciente a la más antigua: la primera de todas es la última.
  const primera = sesiones.at(-1)
  if (!primera) return RANGOS[0]
  const dias = diasEntre(primera.fecha, hoy())
  return RANGOS.find((r) => r.dias !== null && dias <= r.dias) ?? RANGOS[RANGOS.length - 1]
}

/**
 * La progresión de un ejercicio: una gráfica con un punto por sesión (peso más alto,
 * volumen o 1RM estimado) y debajo las sesiones con sus series. El rango y la medida
 * van en la URL, para que recargar no los pierda.
 */
export function Progresion() {
  const { ejercicioId } = useParams()
  const volver = useVolver()
  const [parametros, setParametros] = useSearchParams()
  const [ejercicio, setEjercicio] = useState<Ejercicio | null>(null)
  // De la más reciente a la más antigua, como las da la API.
  const [sesiones, setSesiones] = useState<SesionHistorial[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elegido, setElegido] = useState<number | null>(null)
  const [todas, setTodas] = useState(false)

  const rangoElegido = RANGOS.find((r) => r.clave === parametros.get('rango'))

  useEffect(() => {
    const id = Number(ejercicioId)
    Promise.all([api.ejercicio(id), api.historialDeEjercicio(id, { limite: 500 })])
      .then(([datosEjercicio, historial]) => {
        setEjercicio(datosEjercicio)
        setSesiones(historial)
      })
      .catch((fallo: Error) => setError(fallo.message))
  }, [ejercicioId])

  function cambiar(clave: string, valor: string) {
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales)
        nuevos.set(clave, valor)
        return nuevos
      },
      { replace: true },
    )
    setElegido(null)
    setTodas(false)
  }

  if (error) return <p className="aviso error">{error}</p>
  if (!ejercicio || !sesiones) return <p className="aviso">Cargando…</p>

  // Las medidas que tiene un ejercicio dependen de cómo se apunta; la de la URL, si no es
  // una de ellas, es la primera.
  const medidas = medidasDe(ejercicio.tipo_registro, sesiones)
  const medida = medidas.find((m) => m.clave === parametros.get('medida')) ?? medidas[0]
  const rango = rangoElegido ?? rangoPorDefecto(sesiones)
  const desde = rango.dias === null ? null : sumarDias(hoy(), -rango.dias)
  const enRango = sesiones.filter((sesion) => desde === null || sesion.fecha >= desde)
  const puntos: Punto[] = [...enRango].reverse().map((sesion) => {
    // En la unidad elegida: la gráfica y los textos ya no convierten.
    const valor = valorEnPantalla(medida, sesion)
    return {
      id: sesion.entrenamiento_id,
      fecha: sesion.fecha,
      valor,
      detalle: medida.globo(sesion, valor),
      rutina: sesion.rutina,
    }
  })
  const ultimo = puntos.at(-1)
  const primero = puntos[0]
  const visibles = todas ? enRango : enRango.slice(0, VISIBLES)

  return (
    <div className="progresion">
      <header className="sesion-cabecera">
        <button
          type="button"
          className="boton-icono"
          aria-label="Volver"
          onClick={() => volver('/ejercicios')}
        >
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>{ejercicio.nombre}</h1>
          <p>Progresión</p>
        </div>
        <span className="progresion-hueco" />
      </header>

      <div className="progresion-rangos">
        {RANGOS.map((opcion) => (
          <button
            key={opcion.clave}
            type="button"
            className={
              opcion.clave === rango.clave ? 'progresion-pildora activa' : 'progresion-pildora'
            }
            aria-pressed={opcion.clave === rango.clave}
            onClick={() => cambiar('rango', opcion.clave)}
          >
            {opcion.texto}
          </button>
        ))}
      </div>

      {enRango.length === 0 || !ultimo || !primero ? (
        <p className="aviso">
          {sesiones.length === 0
            ? 'Aún no has hecho este ejercicio.'
            : 'No lo has hecho en este tiempo. Prueba con un rango más largo.'}
        </p>
      ) : (
        <>
          <section className="progresion-tarjeta">
            {/* La medida sola en su fila, centrada; debajo, la cifra a la izquierda y el
                cambio a la derecha. Con un cambio largo («desde el 5 de septiembre de
                2025») no cabía en la misma línea que la cifra. */}
            <div className="progresion-medida">
              <div className="progresion-selector" role="group" aria-label="Medida">
                {medidas.map((opcion) => (
                  <button
                    key={opcion.clave}
                    type="button"
                    className={opcion.clave === medida.clave ? 'activa' : undefined}
                    aria-pressed={opcion.clave === medida.clave}
                    onClick={() => cambiar('medida', opcion.clave)}
                  >
                    {opcion.texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="progresion-cifra">
              <div className="progresion-lado">
                <span className="rotulo">{medida.rotulo}</span>
                <span className="progresion-valor num">{medida.escribir(ultimo.valor)}</span>
              </div>
              <div className="progresion-lado derecha">
                {puntos.length > 1 && (
                  <span className="progresion-cambio num">
                    {medida.cambio(ultimo.valor - primero.valor)} desde el{' '}
                    {diaYMesConAnio(primero.fecha)}
                  </span>
                )}
                <span className="progresion-sesiones-cuenta num">
                  {puntos.length === 1 ? '1 sesión' : `${puntos.length} sesiones`}
                </span>
              </div>
            </div>
            <Grafica
              puntos={puntos}
              elegido={elegido}
              alElegir={setElegido}
              // Todo, a la escala de 6 meses: con más, se desliza de lado.
              diasVisibles={rango.dias === null ? 182 : undefined}
            />
          </section>

          <section className="progresion-sesiones">
            <h2 className="rotulo">Sesiones</h2>
            <ul>
              {visibles.map((sesion) => (
                <li key={sesion.entrenamiento_id} className="progresion-sesion">
                  <Link to={`/historial/${sesion.fecha}`} className="progresion-fila">
                    <span className="progresion-fecha">{fechaFila(sesion.fecha)}</span>
                    {sesion.rutina && <span className="etiqueta-chica">{sesion.rutina}</span>}
                    <span className="progresion-relleno" />
                    <Icono nombre="abrir" pequeno />
                  </Link>
                  <FichasUltimaVez tipo={ejercicio.tipo_registro} series={sesion.series} />
                </li>
              ))}
            </ul>
            {!todas && enRango.length > VISIBLES && (
              <button type="button" className="progresion-mas" onClick={() => setTodas(true)}>
                {enRango.length - VISIBLES === 1
                  ? 'Ver 1 sesión más'
                  : `Ver ${enRango.length - VISIBLES} sesiones más`}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  )
}
