import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import { api, ErrorDeApi } from '../../api/cliente'
import type { ComprobacionDeImportar, ResumenDeDatos } from '../../api/tipos'
import { Dialogo } from '../../componentes/Dialogo'
import { Icono } from '../../componentes/Icono'
import { diaDe, diaYMesConAnio, hoy } from '../../utiles/fechas'
import { useVolver } from '../../utiles/volver'
import { tirarTodosLosBorradores } from '../programas/borradores'
import { enumerar } from '../programas/textos'
import '../sesion/sesion.css'
import './ajustes.css'

type Pendiente = { archivo: unknown; comprobacion: ComprobacionDeImportar }

const NO_ES_UNA_COPIA = 'Ese archivo no es una copia de los datos de Training Life.'

function contar(cuantos: number, singular: string, plural: string) {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

/** «3 rutinas, 1 programa y 12 sesiones (del 2 de septiembre al 1 de octubre)». */
function describir(resumen: ResumenDeDatos) {
  const partes: string[] = []
  if (resumen.rutinas) partes.push(contar(resumen.rutinas, 'rutina', 'rutinas'))
  if (resumen.programas) partes.push(contar(resumen.programas, 'programa', 'programas'))
  if (resumen.ejercicios)
    partes.push(contar(resumen.ejercicios, 'ejercicio tuyo', 'ejercicios tuyos'))
  if (resumen.notas) partes.push(contar(resumen.notas, 'nota', 'notas'))
  if (resumen.sesiones && resumen.primera_sesion && resumen.ultima_sesion) {
    const desde = diaYMesConAnio(resumen.primera_sesion)
    const hasta = diaYMesConAnio(resumen.ultima_sesion)
    const cuando = desde === hasta ? `del ${desde}` : `del ${desde} al ${hasta}`
    partes.push(`${contar(resumen.sesiones, 'sesión', 'sesiones')} (${cuando})`)
  }
  return partes.length === 0 ? 'nada' : enumerar(partes)
}

/**
 * Ajustes: por ahora, tus datos. *Exportar* los guarda todos en un archivo (tras confirmar,
 * con lo que se va a guardar), para pasarlos
 * a otro dispositivo (la web y el móvil no se conectan entre sí) o tener una copia.
 * *Importar* carga uno y **sustituye todo** lo que hay: antes de hacerlo, el diálogo dice
 * qué se sustituye por qué, con lo que cuenta la API sin escribir nada.
 */
export function Ajustes() {
  const volver = useVolver()
  const elegir = useRef<HTMLInputElement>(null)
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<{ mensaje: string; errores: string[] } | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [porExportar, setPorExportar] = useState<ResumenDeDatos | null>(null)

  function fallar(error: unknown) {
    if (error instanceof ErrorDeApi) {
      const detalle = error.detalle as { errores?: string[] } | null
      // Los errores de un archivo dañado son los del validador, en inglés: no ayudan.
      const errores = error.message === 'El archivo está dañado.' ? [] : (detalle?.errores ?? [])
      setFallo({ mensaje: error.message, errores })
    } else {
      setFallo({ mensaje: (error as Error).message, errores: [] })
    }
  }

  /** Antes de exportar, cuánto hay: el diálogo dice qué se va a guardar. */
  async function preguntarExportar() {
    setOcupado(true)
    setFallo(null)
    setHecho(null)
    try {
      setPorExportar(await api.resumenDeDatos())
    } catch (error) {
      fallar(error)
    } finally {
      setOcupado(false)
    }
  }

  /** Descarga el archivo. Si falla, el diálogo lo dice. */
  async function exportar() {
    const datos = await api.exportarDatos()
    const archivo = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })
    const enlace = document.createElement('a')
    enlace.href = URL.createObjectURL(archivo)
    enlace.download = `training-life-${hoy()}.json`
    enlace.click()
    URL.revokeObjectURL(enlace.href)
    setPorExportar(null)
    setHecho('Tus datos se han guardado en un archivo, en la carpeta de descargas.')
  }

  async function alElegirArchivo(evento: ChangeEvent<HTMLInputElement>) {
    const fichero = evento.target.files?.[0]
    // Vaciarlo deja volver a elegir el mismo archivo.
    evento.target.value = ''
    if (!fichero) return
    setOcupado(true)
    setFallo(null)
    setHecho(null)
    try {
      let archivo: unknown
      try {
        archivo = JSON.parse(await fichero.text())
      } catch {
        setFallo({ mensaje: NO_ES_UNA_COPIA, errores: [] })
        return
      }
      setPendiente({ archivo, comprobacion: await api.comprobarImportar(archivo) })
    } catch (error) {
      fallar(error)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="ajustes">
      <header className="sesion-cabecera">
        <button
          type="button"
          className="boton-icono"
          aria-label="Volver"
          onClick={() => volver('/')}
        >
          <Icono nombre="volver" />
        </button>
        <div className="sesion-titulo">
          <h1>Ajustes</h1>
        </div>
        <span className="ajustes-hueco" />
      </header>

      <section className="ajustes-bloque">
        <h2 className="rotulo">Tus datos</h2>
        <div className="ajustes-tarjeta">
          <p>
            Guarda en un archivo todo lo que has apuntado: rutinas, programas, sesiones y notas.
            Sirve para pasarlo a otro dispositivo o para tener una copia.
          </p>
          <button
            type="button"
            className="boton"
            onClick={() => void preguntarExportar()}
            disabled={ocupado}
          >
            Exportar datos
          </button>
        </div>
        <div className="ajustes-tarjeta">
          <p>
            Carga un archivo exportado. <strong>Sustituye todo lo que tienes ahora</strong> por lo
            del archivo; antes te dirá qué hay en cada sitio.
          </p>
          <button
            type="button"
            className="boton"
            onClick={() => elegir.current?.click()}
            disabled={ocupado}
          >
            Importar datos
          </button>
          <input
            ref={elegir}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(evento) => void alElegirArchivo(evento)}
          />
        </div>
      </section>

      {hecho && <p className="aviso">{hecho}</p>}
      {fallo && (
        <div className="aviso error">
          {fallo.mensaje}
          {fallo.errores.length > 0 && (
            <ul className="ajustes-errores">
              {fallo.errores.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {porExportar && (
        <Dialogo
          titulo="¿Exportar tus datos?"
          cuerpo={
            describir(porExportar) === 'nada'
              ? 'Todavía no tienes nada apuntado: el archivo se guardará vacío.'
              : `Se guardarán en un archivo ${describir(porExportar)}. ` +
                'Lo encontrarás en la carpeta de descargas.'
          }
          confirmar="Exportar"
          alConfirmar={exportar}
          alCancelar={() => setPorExportar(null)}
        />
      )}
      {pendiente && (
        <Dialogo
          titulo="¿Sustituir tus datos?"
          cuerpo={
            `Ahora tienes ${describir(pendiente.comprobacion.actual)}. ` +
            `El archivo, exportado el ${diaYMesConAnio(diaDe(pendiente.comprobacion.exportado_en))}, ` +
            `tiene ${describir(pendiente.comprobacion.archivo)}. ` +
            'Todo lo de ahora se sustituirá por lo del archivo. ' +
            'Si quieres conservarlo, expórtalo antes.'
          }
          confirmar="Sustituir"
          peligro
          alConfirmar={async () => {
            const cargado = await api.importarDatos(pendiente.archivo)
            // Los ids de los borradores eran de los datos de antes.
            tirarTodosLosBorradores()
            setPendiente(null)
            setHecho(`Datos cargados: ${describir(cargado)}.`)
          }}
          alCancelar={() => setPendiente(null)}
        />
      )}
    </div>
  )
}
