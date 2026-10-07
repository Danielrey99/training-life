import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { Programa, Rutina } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { colorDeRutina } from '../../utiles/colores'
import { diaYMesConAnio, mesConAnio, sumarDias } from '../../utiles/fechas'
import './programas.css'

const NOMBRES_DE_LOS_DIAS = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
]

type Datos = {
  programas: Programa[]
  programasOcultos: Programa[]
  rutinas: Rutina[]
  rutinasOcultas: Rutina[]
}

/** "lunes, miércoles y viernes". */
function enumerar(partes: string[]) {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * "3 días · lunes, miércoles y viernes"; sin `conNombres`, solo "3 días" (uno
 * oculto, donde no importa cuáles). Solo cuentan los días cuya rutina está
 * visible: una rutina oculta deja su día en descanso.
 */
function diasDelPrograma(programa: Programa, conNombres = true) {
  const dias = programa.dias.filter((dia) => dia.rutina.oculto_desde === null)
  if (dias.length === 0) return 'Sin días de entreno'
  const cuantos = dias.length === 1 ? '1 día' : `${dias.length} días`
  if (!conNombres) return cuantos
  if (dias.length === 7) return `${cuantos} · todos los días`
  return `${cuantos} · ${enumerar(dias.map((dia) => NOMBRES_DE_LOS_DIAS[dia.dia_semana - 1]))}`
}

/** Cuándo se usó: "Desde el 6 de julio", "Del 2 de marzo al 28 de junio". */
function usoDelPrograma(programa: Programa) {
  const periodo = programa.ultimo_periodo
  if (periodo === null) return 'Sin usar todavía'
  if (periodo.hasta === null) return `Desde el ${diaYMesConAnio(periodo.desde)}`
  // `hasta` es el primer día en que ya no estaba activo.
  const ultimo = sumarDias(periodo.hasta, -1)
  if (ultimo === periodo.desde) return `El ${diaYMesConAnio(ultimo)}`
  return `Del ${diaYMesConAnio(periodo.desde)} al ${diaYMesConAnio(ultimo)}`
}

/** Los ejercicios de una rutina son sus huecos visibles: los ocultos ya no se entrenan. */
function ejercicios(rutina: Rutina) {
  const cuantos = rutina.slots.filter((hueco) => hueco.oculto_desde === null).length
  if (cuantos === 0) return 'Sin ejercicios'
  return cuantos === 1 ? '1 ejercicio' : `${cuantos} ejercicios`
}

function enProgramas(rutina: Rutina) {
  if (rutina.num_programas === 0) return 'sin programa'
  return rutina.num_programas === 1 ? 'en 1 programa' : `en ${rutina.num_programas} programas`
}

/**
 * P1 · Programas y rutinas: los programas (el activo primero) y la biblioteca de
 * rutinas, cada lista con sus ocultos plegados al pie.
 *
 * Las rutinas van en su propia lista y no solo dentro de los programas: una rutina
 * puede estar en varios o en ninguno, y sin esta lista la que no está en ninguno
 * sería inalcanzable. Qué listas de ocultos están abiertas va en la URL, para que
 * volver de la vista de uno oculto no las cierre.
 */
export function Programas() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useSearchParams()
  const abiertos = busqueda.getAll('ver')

  useEffect(() => {
    let vigente = true
    Promise.all([
      api.programas(),
      api.programas({ ocultos: true }),
      api.rutinas(),
      api.rutinas({ ocultas: true }),
    ])
      .then(([programas, programasOcultos, rutinas, rutinasOcultas]) => {
        if (vigente) setDatos({ programas, programasOcultos, rutinas, rutinasOcultas })
      })
      .catch((fallo: Error) => {
        if (vigente) setError(fallo.message)
      })
    return () => {
      vigente = false
    }
  }, [])

  function alternar(lista: 'programas' | 'rutinas') {
    // Sobre la URL del momento y no la de este render, para que dos toques seguidos no
    // se pisen: la forma con función de `setBusqueda` también parte de la del render.
    const siguiente = new URLSearchParams(window.location.search)
    const ver = siguiente.getAll('ver')
    siguiente.delete('ver')
    const quedan = ver.includes(lista) ? ver.filter((otra) => otra !== lista) : [...ver, lista]
    for (const otra of quedan) siguiente.append('ver', otra)
    setBusqueda(siguiente, { replace: true })
  }

  if (error) return <p className="aviso error">{error}</p>
  if (!datos) return <p className="aviso">Cargando…</p>

  // El activo primero; el resto, por nombre (ya vienen así de la API).
  const programas = [...datos.programas].sort((a, b) => Number(b.activo) - Number(a.activo))
  const diasDelActivo = programas.find((programa) => programa.activo)?.dias
  const sinRutinas = datos.rutinas.length === 0

  return (
    <div className="programas">
      <header className="programas-cabecera">
        <h1>Programas</h1>
      </header>

      <section className="programas-seccion">
        <h2 className="programas-rotulo">Programas</h2>
        {programas.length === 0 && (
          <p className="programas-vacio">Todavía no tienes ningún programa.</p>
        )}
        {programas.map((programa) => (
          <TarjetaDePrograma key={programa.id} programa={programa} />
        ))}
        <Link to="/programas/nuevo" className="boton programas-nuevo">
          Nuevo programa
        </Link>
        <Ocultos
          cuantos={datos.programasOcultos.length}
          singular="programa oculto"
          plural="programas ocultos"
          abierto={abiertos.includes('programas')}
          alAlternar={() => alternar('programas')}
        />
        {abiertos.includes('programas') &&
          datos.programasOcultos.map((programa) => (
            <TarjetaDePrograma key={programa.id} programa={programa} />
          ))}
      </section>

      <section className="programas-seccion">
        <h2 className="programas-rotulo">Rutinas</h2>
        {sinRutinas ? (
          <p className="programas-vacio">
            Todavía no tienes rutinas.
            <br />
            Crea primero una y luego reúnelas en un programa.
          </p>
        ) : (
          <div className="programas-rutinas">
            {datos.rutinas.map((rutina) => (
              <FilaDeRutina
                key={rutina.id}
                rutina={rutina}
                color={colorDeRutina(diasDelActivo, rutina.id)}
              />
            ))}
          </div>
        )}
        {/* Sin rutinas no se puede hacer nada más: crear una es lo primero. */}
        <Link
          to="/programas/rutinas/nueva"
          className={`boton programas-nuevo${sinRutinas ? ' boton-principal' : ''}`}
        >
          Nueva rutina
        </Link>
        <Ocultos
          cuantos={datos.rutinasOcultas.length}
          singular="rutina oculta"
          plural="rutinas ocultas"
          abierto={abiertos.includes('rutinas')}
          alAlternar={() => alternar('rutinas')}
        />
        {abiertos.includes('rutinas') && datos.rutinasOcultas.length > 0 && (
          <div className="programas-rutinas oculta">
            {datos.rutinasOcultas.map((rutina) => (
              <FilaDeRutina key={rutina.id} rutina={rutina} />
            ))}
          </div>
        )}
      </section>

      <p className="programas-pie">
        Una rutina son los ejercicios de un día.
        <br />
        Un programa reparte esas rutinas en la semana.
      </p>
    </div>
  )
}

/**
 * Uno oculto dice desde cuándo no se usa, y no las fechas exactas: ya no cuenta.
 * Ocultar el activo cierra su periodo, así que siempre tiene `hasta`.
 */
function sinUsarDesde(programa: Programa) {
  const hasta = programa.ultimo_periodo?.hasta
  return hasta ? `sin usar desde ${mesConAnio(sumarDias(hasta, -1))}` : 'sin usar todavía'
}

function TarjetaDePrograma({ programa }: { programa: Programa }) {
  const oculto = programa.oculto_desde !== null

  return (
    <Link
      to={`/programas/${programa.id}`}
      className={`programas-tarjeta${programa.activo ? ' activo' : ''}${oculto ? ' oculto' : ''}`}
    >
      <span className="programas-tarjeta-texto">
        <span className="programas-tarjeta-nombre">
          <strong>{programa.nombre}</strong>
          {programa.activo && <span className="etiqueta">activo</span>}
        </span>
        {oculto ? (
          <>
            <span>
              {diasDelPrograma(programa, false)} · {sinUsarDesde(programa)}
            </span>
            <span>Oculto desde el {diaYMesConAnio(programa.oculto_desde!)}</span>
          </>
        ) : (
          <>
            <span>{diasDelPrograma(programa)}</span>
            <span>{usoDelPrograma(programa)}</span>
          </>
        )}
      </span>
      <Icono nombre="abrir" pequeno />
    </Link>
  )
}

/** Sin `color`, la rutina está oculta: punto apagado y "oculta desde…". */
function FilaDeRutina({ rutina, color }: { rutina: Rutina; color?: string }) {
  return (
    <Link to={`/programas/rutinas/${rutina.id}`} className="programas-rutina">
      <span className="programas-punto" style={color ? { background: color } : undefined} />
      <span className="programas-rutina-texto">
        <strong>{rutina.nombre}</strong>
        <span>
          {ejercicios(rutina)} ·{' '}
          {rutina.oculto_desde === null
            ? enProgramas(rutina)
            : `oculta desde el ${diaYMesConAnio(rutina.oculto_desde)}`}
        </span>
      </span>
      <Icono nombre="abrir" pequeno />
    </Link>
  )
}

type PropsDeOcultos = {
  cuantos: number
  singular: string
  plural: string
  abierto: boolean
  alAlternar: () => void
}

/** "Ver 2 rutinas ocultas ⌄" / "Esconder…": solo si hay alguno. */
function Ocultos({ cuantos, singular, plural, abierto, alAlternar }: PropsDeOcultos) {
  if (cuantos === 0) return null
  const que = cuantos === 1 ? `1 ${singular}` : `${cuantos} ${plural}`
  return (
    <button
      type="button"
      className="boton boton-texto programas-ver-ocultos"
      aria-expanded={abierto}
      onClick={alAlternar}
    >
      {abierto ? 'Esconder' : 'Ver'} {que}
      <Icono nombre={abierto ? 'arriba' : 'abajo'} pequeno />
    </button>
  )
}
