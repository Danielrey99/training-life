import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type {
  EvolucionDeVolumen,
  PeriodoDeVolumen,
  Programa,
  Resumen as DatosResumen,
} from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { colorDeRutina, SIN_DIA } from '../../utiles/colores'
import {
  diaYMesCorto,
  hoy as hoyLocal,
  inicioDeMes,
  mesCorto,
  sumarDias,
  sumarMeses,
  tituloDeMes,
} from '../../utiles/fechas'
import { useVolver } from '../../utiles/volver'
import '../sesion/sesion.css'
import '../progresion/progresion.css'
import './resumen.css'

const INICIALES_MES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// Las alturas de las barras, en píxeles, como en el boceto.
const ALTO_VOLUMEN = 150
const ALTO_CONSTANCIA = 70

// En español los números de cuatro cifras no llevan punto por defecto ("4520"); el
// boceto los agrupa ("4.520 kg") para leerlos de un vistazo junto a los de cinco.
const KILOS = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 0,
  useGrouping: 'always',
} as Intl.NumberFormatOptions)

function enKilos(volumen: string | number): string {
  return `${KILOS.format(Number(volumen))} kg`
}

/** "+7 %", "−12,5 %". */
function porcentaje(cambio: number): string {
  const texto = Math.abs(cambio).toLocaleString('es-ES', { maximumFractionDigits: 1 })
  return `${cambio > 0 ? '+' : cambio < 0 ? '−' : ''}${texto} %`
}

/** "15 sep", o "29 dic de 2025" si no es del año de `referencia`. */
function diaConAnio(iso: string, referencia: string): string {
  const texto = diaYMesCorto(iso)
  return iso.slice(0, 4) === referencia.slice(0, 4) ? texto : `${texto} de ${iso.slice(0, 4)}`
}

/** "agosto", o "diciembre de 2025" si no es del año de `referencia`. */
function mesConAnio(iso: string, referencia: string): string {
  const texto = tituloDeMes(iso).split(' ')[0].toLowerCase()
  return iso.slice(0, 4) === referencia.slice(0, 4) ? texto : `${texto} de ${iso.slice(0, 4)}`
}

/** Cómo se nombra cada vista en sus textos. */
const VISTAS = {
  semana: {
    titulo: 'Volumen por semana',
    periodo: (p: PeriodoDeVolumen, hoy: string) => `Semana del ${diaConAnio(p.desde, hoy)}`,
    enUnaFrase: (p: PeriodoDeVolumen, hoy: string) => `semana del ${diaConAnio(p.desde, hoy)}`,
    comparadoCon: (p: PeriodoDeVolumen, con: string) =>
      con === sumarDias(p.desde, -7)
        ? 'la semana anterior'
        : `la semana del ${diaConAnio(con, p.desde)}`,
    sinSeries: 'Sin series esta semana.',
    vacio: 'No hay series en estas semanas.',
    leyenda: 'Toca una barra para ver esa semana.',
    enCurso: 'La rayada es la semana en curso, aún sin terminar.',
  },
  mes: {
    titulo: 'Volumen por mes',
    periodo: (p: PeriodoDeVolumen) => tituloDeMes(p.desde),
    enUnaFrase: (p: PeriodoDeVolumen, hoy: string) => mesConAnio(p.desde, hoy),
    comparadoCon: (p: PeriodoDeVolumen, con: string) =>
      con === sumarMeses(p.desde, -1) ? 'el mes anterior' : mesConAnio(con, p.desde),
    sinSeries: 'Sin series este mes.',
    vacio: 'No hay series en estos meses.',
    leyenda: 'Toca una barra para ver ese mes.',
    enCurso: 'La rayada es el mes en curso, aún sin terminar.',
  },
}

type Vista = (typeof VISTAS)[keyof typeof VISTAS]

/**
 * Las dos líneas bajo cada barra: el día del lunes (o el mes) y, debajo, el mes (o
 * el año) solo en la primera barra y donde cambia, para que quepan nueve a 390 px.
 */
function etiqueta(
  periodo: PeriodoDeVolumen,
  anterior: PeriodoDeVolumen | undefined,
  porMes: boolean,
): [string, string] {
  if (porMes) {
    const cambiaAnio = !anterior || anterior.desde.slice(0, 4) !== periodo.desde.slice(0, 4)
    return [mesCorto(periodo.desde), cambiaAnio ? periodo.desde.slice(0, 4) : '']
  }
  const cambiaMes = !anterior || anterior.desde.slice(5, 7) !== periodo.desde.slice(5, 7)
  return [String(Number(periodo.desde.slice(8))), cambiaMes ? mesCorto(periodo.desde) : '']
}

/**
 * H5 · Resumen: el volumen por semana o por mes, el desglose de la barra elegida (por
 * rutina y por grupo muscular) y la constancia del año.
 *
 * Todo lo calcula el backend (`GET /resumen`) y llega en una sola respuesta: cambiar
 * de vista o tocar una barra no pide nada. El mes, la vista y la barra elegida van
 * en la URL, para que recargar no los pierda.
 */
export function Resumen() {
  const volver = useVolver()
  const [parametros, setParametros] = useSearchParams()
  const hoy = hoyLocal()
  const mes = parametros.get('mes') ? `${parametros.get('mes')}-01` : inicioDeMes(hoy)
  const porMes = parametros.get('vista') === 'mes'

  const [datos, setDatos] = useState<DatosResumen | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    Promise.all([api.resumen(mes.slice(0, 7)), api.programas()])
      .then(([resumen, programas]) => {
        if (!vigente) return
        setDatos(resumen)
        setPrograma(programas.find((uno) => uno.activo) ?? null)
      })
      .catch((fallo: Error) => {
        if (vigente) setError(fallo.message)
      })
    return () => {
      vigente = false
    }
  }, [mes])

  /** Cambiar de vista vuelve a la última barra terminada (decisión del autor). */
  function cambiar(cambios: Record<string, string | null>) {
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales)
        for (const [clave, valor] of Object.entries(cambios)) {
          if (valor === null) nuevos.delete(clave)
          else nuevos.set(clave, valor)
        }
        return nuevos
      },
      { replace: true },
    )
  }

  const cabecera = (
    <header className="sesion-cabecera">
      <button
        type="button"
        className="boton-icono"
        aria-label="Volver"
        onClick={() => volver(`/historial?mes=${mes.slice(0, 7)}`)}
      >
        <Icono nombre="volver" />
      </button>
      <div className="sesion-titulo">
        <h1>Resumen</h1>
      </div>
      <span className="progresion-hueco" />
    </header>
  )

  if (error) {
    return (
      <div className="resumen">
        {cabecera}
        <p className="aviso error">{error}</p>
      </div>
    )
  }
  if (!datos || datos.mes !== mes) {
    return (
      <div className="resumen">
        {cabecera}
        <p className="aviso">Cargando…</p>
      </div>
    )
  }

  const vista = porMes ? VISTAS.mes : VISTAS.semana
  const evolucion = porMes ? datos.por_mes : datos.por_semana
  const barras = evolucion.en_curso
    ? [...evolucion.periodos, evolucion.en_curso]
    : evolucion.periodos
  // La de la URL; si no está en esta vista (o no hay), la última terminada.
  const elegida =
    barras.find((barra) => barra.desde === parametros.get('barra')) ?? evolucion.periodos.at(-1)!
  const conSeries = elegida.series_por_grupo.length > 0
  const colorDe = (rutina: { id: number; oculto_desde: string | null }) =>
    rutina.oculto_desde ? SIN_DIA : colorDeRutina(programa?.dias, rutina.id)

  return (
    <div className="resumen">
      {cabecera}

      <div className="resumen-vista" role="group" aria-label="Vista">
        {[
          { texto: 'Por semana', valor: null },
          { texto: 'Por mes', valor: 'mes' },
        ].map((opcion) => {
          const activa = (opcion.valor === 'mes') === porMes
          return (
            <button
              key={opcion.texto}
              type="button"
              className={activa ? 'activa' : undefined}
              aria-pressed={activa}
              onClick={() => cambiar({ vista: opcion.valor, barra: null })}
            >
              {opcion.texto}
            </button>
          )
        })}
      </div>

      <Volumen
        evolucion={evolucion}
        elegida={elegida}
        vista={vista}
        porMes={porMes}
        hoy={hoy}
        alElegir={(desde) => cambiar({ barra: desde })}
      />

      {conSeries && (
        <>
          <section className="resumen-tarjeta">
            <h2 className="rotulo resumen-titulo">
              Volumen por rutina · {vista.enUnaFrase(elegida, hoy)}
            </h2>
            <Reparto
              filas={elegida.volumen_por_rutina.map(({ rutina, volumen }) => ({
                clave: rutina.id,
                nombre: rutina.nombre,
                oculta: Boolean(rutina.oculto_desde),
                valor: Number(volumen),
                texto: enKilos(volumen),
                color: colorDe(rutina),
              }))}
            />
          </section>

          <section className="resumen-tarjeta">
            <h2 className="rotulo resumen-titulo">
              Series por grupo muscular · {vista.enUnaFrase(elegida, hoy)}
            </h2>
            <Reparto
              filas={elegida.series_por_grupo.map(({ grupo_muscular, series }) => ({
                clave: grupo_muscular.id,
                nombre: grupo_muscular.nombre,
                valor: series,
                texto: series === 1 ? '1 serie' : `${series} series`,
                color: null,
              }))}
            />
          </section>
        </>
      )}

      <Constancia
        constancia={datos.constancia}
        anio={mes.slice(0, 4)}
        esteAnio={mes.slice(0, 4) === hoy.slice(0, 4)}
      />

      {barras.some((barra) => Number(barra.volumen) > 0) && (
        <p className="resumen-pie">
          {vista.leyenda}
          {evolucion.en_curso && (
            <>
              <br />
              {vista.enCurso}
            </>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * La tarjeta de volumen: las barras (la elegida en verde vivo y la en curso rayada),
 * y arriba el periodo elegido, su volumen y su cambio. Cada columna es un botón.
 */
function Volumen({
  evolucion,
  elegida,
  vista,
  porMes,
  hoy,
  alElegir,
}: {
  evolucion: EvolucionDeVolumen
  elegida: PeriodoDeVolumen
  vista: Vista
  porMes: boolean
  hoy: string
  alElegir: (desde: string) => void
}) {
  const barras = evolucion.en_curso
    ? [...evolucion.periodos, evolucion.en_curso]
    : evolucion.periodos
  const maximo = Math.max(...barras.map((barra) => Number(barra.volumen)))
  const enCurso = elegida === evolucion.en_curso

  return (
    <section className="resumen-tarjeta">
      <h2 className="rotulo resumen-titulo">{vista.titulo}</h2>
      {maximo === 0 ? (
        <p className="resumen-vacio">{vista.vacio}</p>
      ) : (
        <>
          <p className="resumen-periodo">
            {vista.periodo(elegida, hoy)}
            {enCurso && ' (en curso)'}
          </p>
          {elegida.series_por_grupo.length === 0 ? (
            <p className="resumen-sin-series">{vista.sinSeries}</p>
          ) : (
            <div className="resumen-cifra">
              <span className="resumen-valor num">{enKilos(elegida.volumen)}</span>
              {elegida.cambio !== null && elegida.comparado_con !== null && (
                <span
                  className={elegida.cambio > 0 ? 'resumen-cambio num sube' : 'resumen-cambio num'}
                >
                  {porcentaje(elegida.cambio)} sobre{' '}
                  {vista.comparadoCon(elegida, elegida.comparado_con)}
                </span>
              )}
            </div>
          )}
          <div className="resumen-barras">
            {barras.map((barra, indice) => {
              const [arriba, abajo] = etiqueta(barra, barras[indice - 1], porMes)
              const esElegida = barra === elegida
              const clases = ['resumen-barra']
              if (barra === evolucion.en_curso) clases.push('en-curso')
              if (esElegida) clases.push('elegida')
              return (
                <button
                  key={barra.desde}
                  type="button"
                  className="resumen-columna"
                  aria-pressed={esElegida}
                  aria-label={`${vista.periodo(barra, hoy)}: ${enKilos(barra.volumen)}`}
                  onClick={() => alElegir(barra.desde)}
                >
                  <span className="resumen-pista" style={{ height: ALTO_VOLUMEN }}>
                    <span
                      className={clases.join(' ')}
                      style={{ height: (Number(barra.volumen) / maximo) * ALTO_VOLUMEN }}
                    />
                  </span>
                  <span className={esElegida ? 'resumen-eje elegida' : 'resumen-eje'}>
                    {arriba}
                    <br />
                    {abajo || ' '}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

type FilaDeReparto = {
  clave: number
  nombre: string
  oculta?: boolean
  valor: number
  texto: string
  // Sin color de identidad, barra gris y sin punto: un ranking no necesita un color
  // por fila, y uno inventado se confundiría con los de los días.
  color: string | null
}

/** Una barra horizontal por fila, relativa a la mayor (que ocupa todo el ancho). */
function Reparto({ filas }: { filas: FilaDeReparto[] }) {
  const maximo = Math.max(...filas.map((fila) => fila.valor), 1)
  return (
    <ul className="resumen-reparto">
      {filas.map((fila) => (
        <li key={fila.clave}>
          <div className="resumen-fila">
            {fila.color && <span className="resumen-punto" style={{ background: fila.color }} />}
            <span className="resumen-nombre">
              {fila.nombre}
              {fila.oculta && <span className="etiqueta-chica">oculta</span>}
            </span>
            <span className="num">{fila.texto}</span>
          </div>
          <div className="resumen-carril">
            <div
              style={{
                width: `${(fila.valor / maximo) * 100}%`,
                background: fila.color ?? 'var(--texto-tenue)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * La constancia del año: por mes, en gris lo planificado (también lo que aún no ha
 * llegado) y en verde lo entrenado, que lo va llenando. La cifra, solo hasta hoy.
 */
function Constancia({
  constancia,
  anio,
  esteAnio,
}: {
  constancia: DatosResumen['constancia']
  anio: string
  esteAnio: boolean
}) {
  const maximo = Math.max(...constancia.meses.map((mes) => mes.planificados + mes.por_llegar))

  return (
    <section className="resumen-tarjeta">
      <h2 className="rotulo resumen-titulo">Constancia · {anio}</h2>
      {maximo === 0 ? (
        <p className="resumen-vacio">No hay días planificados en {anio}.</p>
      ) : (
        <>
          <div className="resumen-leyenda">
            <span>
              <span className="resumen-muestra entrenado" />
              Entrenados
            </span>
            <span>
              <span className="resumen-muestra" />
              Planificados
            </span>
          </div>
          <div className="resumen-cifra">
            <span className="resumen-valor num">
              {constancia.entrenados}
              <small> / {constancia.planificados}</small>
            </span>
            <span className="resumen-cambio">
              {esteAnio ? 'días entrenados, hasta hoy' : `días entrenados en ${anio}`}
            </span>
          </div>
          <div className="resumen-barras estrechas">
            {constancia.meses.map((mes, indice) => {
              const total = mes.planificados + mes.por_llegar
              return (
                <div key={mes.mes} className="resumen-columna">
                  <div className="resumen-pista" style={{ height: ALTO_CONSTANCIA }}>
                    <div
                      className="resumen-planificado"
                      style={{ height: (total / maximo) * ALTO_CONSTANCIA }}
                      title={`${mes.entrenados} de ${total}`}
                    >
                      <div
                        className="resumen-entrenado"
                        style={{ height: (mes.entrenados / maximo) * ALTO_CONSTANCIA }}
                      />
                    </div>
                  </div>
                  <span className="resumen-eje">{INICIALES_MES[indice]}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
