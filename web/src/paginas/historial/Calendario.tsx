import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { DiaSeguimiento, Programa } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { MarcaDelDia } from '../../componentes/MarcaDelDia'
import { colorDelDia, SIN_DIA } from '../../utiles/colores'
import {
  diaDeLaSemana,
  diaYMes,
  finDeMes,
  hoy as hoyLocal,
  inicioDeMes,
  sumarMeses,
  tituloDeMes,
} from '../../utiles/fechas'
import { HojaRegistrar } from './HojaRegistrar'
import './historial.css'

const INICIALES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const NOMBRES_DIA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

type Cifras = { entrenados: number; planificados: number; movidos: number; noHechos: number }

/**
 * Las cifras del mes. Un día cuenta como entrenado si está hecho o movido (también
 * un adelanto de un día que aún no ha llegado), y como planificado si además no
 * se hizo pero ya pasó. Lo de hoy sin hacer todavía no es un fallo.
 */
function cifras(dias: DiaSeguimiento[]): Cifras {
  const entrenados = dias.filter((d) => d.estado === 'hecho' || d.estado === 'movido').length
  const noHechos = dias.filter((d) => d.estado === 'sin_hacer').length
  return {
    entrenados,
    planificados: entrenados + noHechos,
    movidos: dias.filter((d) => d.estado === 'movido').length,
    noHechos,
  }
}

/**
 * H1 · Calendario: el mes, con lo que se hizo y lo que tocaba cada día.
 *
 * El estado de cada día (hecho, movido, sin hacer…) lo calcula el backend
 * (`GET /plan/seguimiento`); aquí solo se pinta, con las mismas marcas que la tira
 * de la semana de Hoy. El mes va en la URL (`?mes=2026-09`) para que volver de un
 * día no devuelva al mes actual.
 */
export function Calendario() {
  const navegar = useNavigate()
  const [parametros, setParametros] = useSearchParams()
  const hoy = hoyLocal()
  const mes = parametros.get('mes') ? `${parametros.get('mes')}-01` : inicioDeMes(hoy)

  // Cada carga recuerda de qué mes es: al cambiar de mes, los datos del anterior no
  // se pintan mientras llegan los nuevos.
  const [cargado, setCargado] = useState<{
    mes: string
    dias: DiaSeguimiento[]
    series: number
  } | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leyenda, setLeyenda] = useState(false)
  const [registrando, setRegistrando] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      try {
        const fin = finDeMes(mes)
        const hastaHoy = fin < hoy ? fin : hoy
        const [seguimiento, programas, sesiones] = await Promise.all([
          api.seguimiento(mes, fin),
          api.programas(),
          mes <= hoy ? api.entrenamientos({ desde: mes, hasta: hastaHoy }) : Promise.resolve([]),
        ])
        if (!vigente) return
        setCargado({
          mes,
          dias: seguimiento,
          series: sesiones.reduce((total, sesion) => total + sesion.series.length, 0),
        })
        setPrograma(programas.find((uno) => uno.activo) ?? null)
      } catch (fallo) {
        if (vigente) setError((fallo as Error).message)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [mes, hoy])

  function irAlMes(meses: number) {
    setParametros({ mes: sumarMeses(mes, meses).slice(0, 7) })
  }

  /** Tocar un día enseña lo que se hizo ESE día, nunca lo del día en que se hizo su rutina. */
  function tocar(dia: DiaSeguimiento) {
    if (dia.sesion) navegar(`/historial/${dia.fecha}`)
    else if (dia.fecha === hoy) navegar('/')
    else if (dia.fecha < hoy) setRegistrando(dia.fecha)
  }

  if (error) return <p className="aviso error">{error}</p>

  // Huecos antes del día 1, para que cada columna sea un día de la semana.
  const vacios = diaDeLaSemana(mes) - 1
  const dias = cargado?.mes === mes ? cargado.dias : null
  const series = cargado?.series ?? 0
  const resumen = dias && cifras(dias)
  const esteMes = inicioDeMes(hoy) === mes

  return (
    <div className="historial">
      <header className="historial-cabecera">
        <h1>Historial</h1>
      </header>

      <div className="mes">
        <button
          type="button"
          className="boton-icono"
          onClick={() => irAlMes(-1)}
          aria-label="Mes anterior"
        >
          <Icono nombre="volver" />
        </button>
        <h2>{tituloDeMes(mes)}</h2>
        <button
          type="button"
          className="boton-icono"
          onClick={() => irAlMes(1)}
          aria-label="Mes siguiente"
        >
          <Icono nombre="abrir" />
        </button>
      </div>

      <div className="calendario">
        {INICIALES.map((inicial) => (
          <span key={inicial} className="calendario-cabecera">
            {inicial}
          </span>
        ))}
        {Array.from({ length: vacios }, (_, indice) => (
          <span key={`vacio-${indice}`} />
        ))}
        {dias?.map((dia) => {
          const clases = ['calendario-dia']
          if (dia.fecha === hoy) clases.push('es-hoy')
          else if (dia.fecha > hoy) clases.push('futuro')
          const tocable = Boolean(dia.sesion) || dia.fecha <= hoy
          return (
            <button
              key={dia.fecha}
              type="button"
              className={clases.join(' ')}
              onClick={() => tocar(dia)}
              disabled={!tocable}
            >
              <span className="num">{Number(dia.fecha.slice(8))}</span>
              <MarcaDelDia dia={dia} diasDelPrograma={programa?.dias} />
            </button>
          )
        })}
      </div>

      {resumen && mes <= hoy && (
        <>
          <div className="cifras">
            <div className="cifra">
              <span className="num cifra-valor destacada">
                {resumen.entrenados}
                <small> / {resumen.planificados}</small>
              </span>
              <span>entrenados</span>
            </div>
            <div className="cifra">
              <span className="num cifra-valor">{resumen.movidos}</span>
              <span>{resumen.movidos === 1 ? 'movido' : 'movidos'}</span>
            </div>
            <div className="cifra">
              <span className="num cifra-valor">{resumen.noHechos}</span>
              <span>no hecho{resumen.noHechos === 1 ? '' : 's'}</span>
            </div>
          </div>
          <p className="cifras-pie">
            {esteMes ? `Hasta hoy, ${diaYMes(hoy)} · ` : ''}
            {series === 1 ? '1 serie registrada' : `${series} series registradas`}
          </p>
        </>
      )}

      <button type="button" className="ver-leyenda" onClick={() => setLeyenda(!leyenda)}>
        {leyenda ? 'Ocultar leyenda' : 'Ver leyenda'}
        <Icono nombre={leyenda ? 'arriba' : 'abajo'} pequeno />
      </button>
      {leyenda && <Leyenda programa={programa} />}

      <Link to="/historial/planificar" className="boton">
        Planificar los próximos días
      </Link>

      {registrando && (
        <HojaRegistrar
          fecha={registrando}
          programa={programa}
          alCerrar={() => setRegistrando(null)}
        />
      )}
    </div>
  )
}

/** Una marca de ejemplo, en gris: la leyenda explica la forma, no el color. */
function Punto({ lleno = false, color = SIN_DIA, apagado = false }) {
  return (
    <span
      className={apagado ? 'marca-punto apagado' : 'marca-punto'}
      style={lleno ? { background: color } : { border: `1.5px solid ${color}` }}
    />
  )
}

function Flecha({ haciaAtras = false }) {
  return (
    <svg className="marca-flecha" viewBox="0 0 24 24" style={{ stroke: SIN_DIA }} aria-hidden>
      <path d={haciaAtras ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </svg>
  )
}

/** Qué significa cada marca y cada color. Plegada por defecto: se consulta poco. */
function Leyenda({ programa }: { programa: Programa | null }) {
  const verde = colorDelDia(1)
  const azul = colorDelDia(3)
  const filas = [
    { marca: <Punto lleno />, texto: 'Hecho ese día' },
    { marca: <Punto />, texto: 'Sin hacer' },
    {
      marca: (
        <>
          <Punto />
          <Flecha />
        </>
      ),
      texto: 'Hecho otro día, más tarde (recuperado)',
    },
    {
      marca: (
        <>
          <Flecha haciaAtras />
          <Punto />
        </>
      ),
      texto: 'Hecho otro día, antes (adelantado)',
    },
    {
      marca: (
        <>
          <Punto lleno color={verde} />
          <Flecha />
        </>
      ),
      texto: 'Ese día se hizo otra rutina; la suya, otro día',
    },
    {
      marca: (
        <>
          <Punto lleno color={verde} />
          <Punto color={azul} />
        </>
      ),
      texto: 'Ese día se hizo otra rutina; la suya, sin hacer',
    },
    { marca: <Punto lleno apagado />, texto: 'Próximo' },
  ]

  return (
    <div className="leyenda">
      {programa && programa.dias.length > 0 && (
        <div className="leyenda-colores">
          {programa.dias.map((dia) => (
            <span key={dia.dia_semana}>
              <Punto lleno color={colorDelDia(dia.dia_semana)} />
              {NOMBRES_DIA[dia.dia_semana - 1]} · {dia.rutina.nombre}
            </span>
          ))}
        </div>
      )}
      <div className="leyenda-marcas">
        {filas.map((fila) => (
          <div key={fila.texto} className="leyenda-fila">
            <span className="leyenda-marca">{fila.marca}</span>
            <span>{fila.texto}</span>
          </div>
        ))}
      </div>
      <p>
        El punto lleno lleva el color de lo que se hizo; el aro y la flecha, el de lo que tocaba ese
        día.
      </p>
    </div>
  )
}
