import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { Ejercicio, SesionHistorial } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { diaYMes, fechaAbreviada, hoy, sumarDias } from '../../utiles/fechas'
import { unoRM } from '../../utiles/numeros'
import { useVolver } from '../../utiles/volver'
import { FichasUltimaVez } from '../sesion/FichasUltimaVez'
import { Grafica, type Punto } from './Grafica'
import '../sesion/sesion.css'
import './progresion.css'

const RANGOS = [
  { clave: '1m', texto: '1 mes', dias: 30 },
  { clave: '3m', texto: '3 meses', dias: 91 },
  { clave: '6m', texto: '6 meses', dias: 182 },
  { clave: '1a', texto: '1 año', dias: 365 },
  { clave: 'todo', texto: 'Todo', dias: null },
] as const

const MEDIDAS = [
  { clave: 'peso', texto: 'Peso' },
  { clave: 'volumen', texto: 'Volumen' },
  { clave: 'rm', texto: '1RM' },
] as const

type Medida = (typeof MEDIDAS)[number]['clave']

// Las sesiones que se enseñan antes de "Ver N sesiones más".
const VISIBLES = 4

/**
 * Lo que vale una sesión en cada medida: el peso más alto, el volumen total o el 1RM
 * medio (el mismo de las insignias de H2, para que un día dé igual en las dos pantallas).
 */
function valorDe(sesion: SesionHistorial, medida: Medida): number {
  const { series } = sesion
  if (medida === 'peso') return Math.max(...series.map((serie) => Number(serie.peso)))
  if (medida === 'volumen') {
    return series.reduce((total, serie) => total + Number(serie.peso) * serie.repeticiones, 0)
  }
  return unoRM(series)
}

/** "26,7 kg": el valor con un decimal como mucho. */
function enKilos(valor: number): string {
  return `${(Math.round(valor * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 })} kg`
}

function conSigno(diferencia: number): string {
  const texto = enKilos(Math.abs(diferencia))
  return `${diferencia > 0 ? '+' : diferencia < 0 ? '−' : ''}${texto}`
}

function fechaFila(iso: string): string {
  const texto = fechaAbreviada(iso)
  return texto.charAt(0).toUpperCase() + texto.slice(1)
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

  const rango = RANGOS.find((r) => r.clave === parametros.get('rango')) ?? RANGOS[1]
  const medida = MEDIDAS.find((m) => m.clave === parametros.get('medida'))?.clave ?? 'peso'

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

  const desde = rango.dias === null ? null : sumarDias(hoy(), -rango.dias)
  const enRango = sesiones.filter((sesion) => desde === null || sesion.fecha >= desde)
  const puntos: Punto[] = [...enRango].reverse().map((sesion) => {
    const valor = valorDe(sesion, medida)
    return {
      id: sesion.entrenamiento_id,
      fecha: sesion.fecha,
      valor,
      detalle:
        medida === 'volumen'
          ? `${enKilos(valor)} en ${sesion.series.length} ${sesion.series.length === 1 ? 'serie' : 'series'}`
          : medida === 'rm'
            ? `${enKilos(valor)} de media`
            : enKilos(valor),
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
            <div className="progresion-medida">
              <span className="rotulo">Por sesión</span>
              <div className="progresion-selector" role="group" aria-label="Medida">
                {MEDIDAS.map((opcion) => (
                  <button
                    key={opcion.clave}
                    type="button"
                    className={opcion.clave === medida ? 'activa' : undefined}
                    aria-pressed={opcion.clave === medida}
                    onClick={() => cambiar('medida', opcion.clave)}
                  >
                    {opcion.texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="progresion-cifra">
              <span className="progresion-valor num">{enKilos(ultimo.valor)}</span>
              <span className="progresion-cambio num">
                {puntos.length > 1
                  ? `${conSigno(ultimo.valor - primero.valor)} desde el ${diaYMes(primero.fecha)} · ${puntos.length} sesiones`
                  : '1 sesión'}
              </span>
            </div>
            <Grafica puntos={puntos} elegido={elegido} alElegir={setElegido} />
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
                  <FichasUltimaVez series={sesion.series} />
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
