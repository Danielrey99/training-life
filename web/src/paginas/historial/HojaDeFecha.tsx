import { useEffect, useState } from 'react'

import { api } from '../../api/cliente'
import type { DiaSeguimiento, Programa } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { finDeMes, hoy, inicioDeMes, sumarMeses, tituloDeMes } from '../../utiles/fechas'
import { MesConMarcas } from './MesConMarcas'

type Props = {
  // La fecha que tiene ahora el campo: abre en su mes y sale marcada.
  fecha: string
  alElegir: (fecha: string) => void
  alCerrar: () => void
}

/**
 * La hoja de cambiar la fecha de una sesión (H2 editando): el mismo mes del
 * calendario, con sus marcas, para ver de un vistazo qué días ya tienen sesión.
 * Antes era el selector de fecha del sistema, que cada navegador dibuja a su manera
 * y no enseña nada de lo entrenado. Tocar un día lo elige y cierra la hoja; si la
 * fecha no vale (ya tiene sesión, o queda fuera de plazo), lo dice el campo al
 * guardar, como siempre.
 */
export function HojaDeFecha({ fecha, alElegir, alCerrar }: Props) {
  const hoyIso = hoy()
  const [mes, setMes] = useState(inicioDeMes(fecha))
  const [cargado, setCargado] = useState<{ mes: string; dias: DiaSeguimiento[] } | null>(null)
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [alCerrar])

  useEffect(() => {
    let vigente = true
    Promise.all([api.seguimiento(mes, finDeMes(mes)), api.programas()])
      .then(([dias, programas]) => {
        if (!vigente) return
        setCargado({ mes, dias })
        setPrograma(programas.find((uno) => uno.activo) ?? null)
      })
      .catch((fallo: Error) => vigente && setError(fallo.message))
    return () => {
      vigente = false
    }
  }, [mes])

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
        <h2 id="hoja-titulo">Fecha de la sesión</h2>
        <div className="mes">
          <button
            type="button"
            className="boton-icono"
            onClick={() => setMes(sumarMeses(mes, -1))}
            aria-label="Mes anterior"
          >
            <Icono nombre="volver" />
          </button>
          <h2>{tituloDeMes(mes)}</h2>
          <button
            type="button"
            className="boton-icono"
            onClick={() => setMes(sumarMeses(mes, 1))}
            aria-label="Mes siguiente"
          >
            <Icono nombre="abrir" />
          </button>
        </div>
        {error ? (
          <p className="aviso error">{error}</p>
        ) : (
          <MesConMarcas
            mes={mes}
            dias={cargado?.mes === mes ? cargado.dias : null}
            hoy={hoyIso}
            programa={programa}
            elegida={fecha}
            alTocar={(dia) => alElegir(dia.fecha)}
          />
        )}
      </div>
    </div>
  )
}
