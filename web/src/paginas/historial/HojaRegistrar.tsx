import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { Hoy, Programa, RutinaMinima } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { colorDelDia, colorDeRutina } from '../../utiles/colores'
import {
  conArticulo,
  diaDeLaSemana,
  fechaEnFrase,
  fechaLarga,
  nombreDelDia,
} from '../../utiles/fechas'

type Props = {
  fecha: string
  programa: Programa | null
  alCerrar: () => void
}

/** Una opción de la hoja: qué rutina, qué día cuenta y cómo se dice. */
type Opcion = {
  clave: string
  rutina: RutinaMinima
  titulo: string
  detalle: string | null
  cubre: string | null
  color: string
}

type Eleccion = { opcion: Opcion; cuerpo: string }

function contarEjercicios(cuantos: number) {
  return cuantos === 1 ? '1 ejercicio' : `${cuantos} ejercicios`
}

/**
 * H1b · Registrar un día pasado: para pasar la libreta de meses anteriores o
 * apuntar un día que se olvidó.
 *
 * Ofrece lo mismo que habría ofrecido la pantalla de Hoy ese día (`GET /plan/hoy`
 * con esa fecha): lo que tocaba, lo que seguía por recuperar y lo que se podía
 * adelantar. Cualquier otra rutina se apunta igual, pero sin contar para ningún
 * día del programa. No cambia lo planificado: registra lo que pasó.
 */
export function HojaRegistrar({ fecha, programa, alCerrar }: Props) {
  const navegar = useNavigate()
  const [resumen, setResumen] = useState<Hoy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [eleccion, setEleccion] = useState<Eleccion | null>(null)

  useEffect(() => {
    let vigente = true
    api
      .hoy(fecha)
      .then((leido) => vigente && setResumen(leido))
      .catch((fallo: Error) => vigente && setError(fallo.message))
    return () => {
      vigente = false
    }
  }, [fecha])

  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape' && !eleccion) alCerrar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [eleccion, alCerrar])

  function ejercicios(rutina: RutinaMinima) {
    const datos = resumen?.rutinas.find((una) => una.id === rutina.id)
    return datos ? contarEjercicios(datos.ejercicios) : ''
  }

  const cuentan: Opcion[] = []
  const otras: Opcion[] = []
  if (resumen) {
    const dia = resumen.semana.find((uno) => uno.fecha === fecha)
    if (resumen.situacion === 'entrenamiento' && dia?.rutina) {
      cuentan.push({
        clave: 'propia',
        rutina: dia.rutina,
        titulo: `${dia.rutina.nombre}, lo que tocaba`,
        detalle: 'Contará como la de ese día',
        cubre: fecha,
        color: colorDelDia(diaDeLaSemana(fecha)),
      })
    }
    for (const recuperable of resumen.por_recuperar.filter((r) => r.se_puede_hoy)) {
      cuentan.push({
        clave: `recuperar-${recuperable.fecha}`,
        rutina: recuperable.rutina,
        titulo: `Recuperar el ${recuperable.rutina.nombre} del ${fechaEnFrase(recuperable.fecha, false)}`,
        detalle: `Contará como el del ${nombreDelDia(recuperable.fecha)}`,
        cubre: recuperable.fecha,
        color: colorDelDia(diaDeLaSemana(recuperable.fecha)),
      })
    }
    for (const ofrecida of resumen.ofrecidas) {
      if (ofrecida.accion === 'adelantar' && ofrecida.fecha) {
        cuentan.push({
          clave: `adelantar-${ofrecida.fecha}`,
          rutina: ofrecida.rutina,
          titulo: `Adelantar el ${ofrecida.rutina.nombre} del ${fechaEnFrase(ofrecida.fecha, false)}`,
          detalle: `Contará como el del ${nombreDelDia(ofrecida.fecha)}`,
          cubre: ofrecida.fecha,
          color: colorDelDia(diaDeLaSemana(ofrecida.fecha)),
        })
      } else if (ofrecida.accion === 'sin_contar') {
        otras.push({
          clave: `otra-${ofrecida.rutina.id}`,
          rutina: ofrecida.rutina,
          titulo: ofrecida.rutina.nombre,
          detalle: null,
          cubre: null,
          color: colorDeRutina(programa?.dias, ofrecida.rutina.id),
        })
      }
    }
  }

  function elegir(opcion: Opcion) {
    const cuerpo = opcion.cubre ? `${opcion.detalle}.` : 'No contará para ningún día del programa.'
    setEleccion({ opcion, cuerpo })
  }

  async function registrar(opcion: Opcion) {
    const creada = await api.crearEntrenamiento({
      rutina_id: opcion.rutina.id,
      fecha,
      notas: null,
      cubre_fecha: opcion.cubre,
    })
    navegar(`/sesion/${creada.id}`)
  }

  function Fila({ opcion }: { opcion: Opcion }) {
    return (
      <button type="button" className="hoja-fila" onClick={() => elegir(opcion)}>
        <span className="marca-punto" style={{ background: opcion.color }} />
        <span className="hoja-fila-texto">
          <strong>{opcion.titulo}</strong>
          {opcion.detalle && <span>{opcion.detalle}</span>}
        </span>
        <span className="hoja-fila-extra">{ejercicios(opcion.rutina)}</span>
      </button>
    )
  }

  return (
    <div className="hoja-fondo" onClick={() => !eleccion && alCerrar()}>
      <div
        className="hoja"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoja-titulo"
        onClick={(evento) => evento.stopPropagation()}
      >
        <span className="hoja-asa" />
        <h2 id="hoja-titulo">{fechaLarga(fecha)}</h2>
        <p className="hoja-subtitulo">
          No hay ninguna sesión registrada este día.
          <br />
          Elige qué rutina hiciste para apuntarlo ahora.
        </p>

        {error && <p className="aviso error">{error}</p>}
        {!resumen && !error && <p className="hoja-subtitulo">Cargando…</p>}

        {resumen?.situacion === 'primera_vez' && (
          <p className="hoja-vacia">
            Todavía no tienes rutinas. Crea una en <Link to="/programas">Programas</Link> para poder
            apuntar lo que hiciste.
          </p>
        )}

        {cuentan.map((opcion) => (
          <Fila key={opcion.clave} opcion={opcion} />
        ))}
        {otras.length > 0 && (
          <>
            <p className="hoja-rotulo">Estas no contarán para ningún día del programa</p>
            {otras.map((opcion) => (
              <Fila key={opcion.clave} opcion={opcion} />
            ))}
          </>
        )}
      </div>

      {eleccion && (
        <Dialogo
          titulo={`¿Registrar ${eleccion.opcion.rutina.nombre} ${conArticulo(fecha)}?`}
          cuerpo={eleccion.cuerpo}
          confirmar="Registrar"
          alConfirmar={() => registrar(eleccion.opcion)}
          alCancelar={() => setEleccion(null)}
        />
      )}
    </div>
  )
}
