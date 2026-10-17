import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../../api/cliente'
import type { Ejercicio, GrupoMuscular } from '../../api/tipos'
import { Icono } from '../../componentes/Icono'
import { Ocultos } from '../../componentes/Ocultos'
import { diaYMesConAnio } from '../../utiles/fechas'
import '../programas/ejercicio.css'
import '../programas/programas.css'
import '../progresion/progresion.css'
import './ejercicios.css'
import { TODOS_LOS_GRUPOS } from '../programas/DesplegableDeGrupo'
import { HojaDeGrupos } from './HojaDeGrupos'

const ORIGENES = [
  { clave: 'todos', texto: 'Todos' },
  { clave: 'predefinidos', texto: 'Predefinidos' },
  { clave: 'mios', texto: 'Míos' },
] as const

type Origen = (typeof ORIGENES)[number]['clave']

type Datos = {
  visibles: Ejercicio[]
  ocultos: Ejercicio[]
  grupos: GrupoMuscular[]
}

/** Sin mayúsculas ni tildes, para que "jalon" encuentre "Jalón en polea". */
function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function delOrigen(ejercicio: Ejercicio, origen: Origen) {
  if (origen === 'todos') return true
  return ejercicio.es_predefinido === (origen === 'predefinidos')
}

/**
 * X1 · Ejercicios: la biblioteca, con los predefinidos y los tuyos. Se busca por
 * nombre y se filtra por origen y por grupo muscular; los ocultos van plegados al pie.
 *
 * La búsqueda, los filtros y si los ocultos están desplegados van en la URL, para
 * que volver de la ficha de un ejercicio deje la lista como estaba.
 */
export function Biblioteca() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useSearchParams()

  const texto = busqueda.get('q') ?? ''
  const origen: Origen =
    ORIGENES.find((opcion) => opcion.clave === busqueda.get('origen'))?.clave ?? 'todos'
  const grupo = Number(busqueda.get('grupo')) || null
  const verOcultos = busqueda.get('ver') === 'ocultos'
  const [eligiendoGrupo, setEligiendoGrupo] = useState(false)

  useEffect(() => {
    let vigente = true
    Promise.all([api.ejercicios(), api.ejercicios({ ocultos: true }), api.gruposMusculares()])
      .then(([visibles, ocultos, grupos]) => {
        if (vigente) setDatos({ visibles, ocultos, grupos })
      })
      .catch((fallo: Error) => {
        if (vigente) setError(fallo.message)
      })
    return () => {
      vigente = false
    }
  }, [])

  function cambiar(clave: string, valor: string | null) {
    // Sobre la URL del momento y no la de este render, para que dos cambios seguidos
    // (escribir deprisa) no se pisen.
    const siguiente = new URLSearchParams(window.location.search)
    if (valor) siguiente.set(clave, valor)
    else siguiente.delete(clave)
    setBusqueda(siguiente, { replace: true })
  }

  if (error) return <p className="aviso error">{error}</p>
  if (!datos) return <p className="aviso">Cargando…</p>

  const nombreDeGrupo = new Map(datos.grupos.map((uno) => [uno.id, uno.nombre]))
  const buscado = normalizar(texto.trim())
  const encaja = (ejercicio: Ejercicio) =>
    delOrigen(ejercicio, origen) &&
    (grupo === null || ejercicio.grupo_muscular_id === grupo) &&
    normalizar(ejercicio.nombre).includes(buscado)
  const lista = datos.visibles.filter(encaja)
  const ocultos = datos.ocultos.filter(encaja)
  // Solo los grupos con algo que enseñar en el origen elegido: uno vacío no lleva a nada.
  const conEjercicios = datos.grupos
    .filter((uno) =>
      [...datos.visibles, ...datos.ocultos].some(
        (ejercicio) => ejercicio.grupo_muscular_id === uno.id && delOrigen(ejercicio, origen),
      ),
    )
    .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'))
  const sinPropios = ![...datos.visibles, ...datos.ocultos].some(
    (ejercicio) => !ejercicio.es_predefinido,
  )

  return (
    <div className="programas">
      <header className="programas-cabecera">
        <h1>Ejercicios</h1>
      </header>

      <div className="biblioteca-filtros">
        <label className="ejercicio-buscador biblioteca-buscador">
          <Icono nombre="buscar" pequeno />
          <input
            type="search"
            placeholder="Buscar ejercicio"
            value={texto}
            onChange={(evento) => cambiar('q', evento.target.value || null)}
          />
        </label>

        <div className="progresion-selector ejercicios-origen" role="group" aria-label="Origen">
          {ORIGENES.map((opcion) => (
            <button
              key={opcion.clave}
              type="button"
              className={opcion.clave === origen ? 'activa' : undefined}
              aria-pressed={opcion.clave === origen}
              onClick={() => cambiar('origen', opcion.clave === 'todos' ? null : opcion.clave)}
            >
              {opcion.texto}
            </button>
          ))}
        </div>

        <div className="ejercicio-filtro">
          <button
            type="button"
            className={`ejercicio-filtro-campo${grupo === null ? '' : ' elegido'}`}
            aria-label="Grupo muscular"
            onClick={() => setEligiendoGrupo(true)}
          >
            {grupo === null ? TODOS_LOS_GRUPOS : (nombreDeGrupo.get(grupo) ?? TODOS_LOS_GRUPOS)}
          </button>
          <Icono nombre="abajo" pequeno />
        </div>
      </div>

      {lista.length > 0 ? (
        <div className="programas-rutinas">
          {lista.map((ejercicio) => (
            <FilaDeEjercicio key={ejercicio.id} ejercicio={ejercicio} grupos={nombreDeGrupo} />
          ))}
        </div>
      ) : (
        <p className="programas-vacio">
          {origen === 'mios' && sinPropios
            ? 'Todavía no has creado ningún ejercicio.'
            : 'Ningún ejercicio coincide con lo que buscas.'}
        </p>
      )}

      {/* Sin ninguno propio a la vista, crear uno es lo único que se puede hacer aquí. */}
      <Link
        to="/ejercicios/nuevo"
        className={`boton${origen === 'mios' && sinPropios ? ' boton-principal' : ''}`}
      >
        Nuevo ejercicio
      </Link>

      {eligiendoGrupo && (
        <HojaDeGrupos
          grupos={conEjercicios}
          elegido={grupo}
          alElegir={(elegido) => {
            cambiar('grupo', elegido === null ? null : String(elegido))
            setEligiendoGrupo(false)
          }}
          alCerrar={() => setEligiendoGrupo(false)}
        />
      )}

      <Ocultos
        cuantos={ocultos.length}
        singular="ejercicio oculto"
        plural="ejercicios ocultos"
        abierto={verOcultos}
        alAlternar={() => cambiar('ver', verOcultos ? null : 'ocultos')}
      />
      {verOcultos && ocultos.length > 0 && (
        <div className="programas-rutinas oculta">
          {ocultos.map((ejercicio) => (
            <FilaDeEjercicio key={ejercicio.id} ejercicio={ejercicio} grupos={nombreDeGrupo} />
          ))}
        </div>
      )}
    </div>
  )
}

/** "Press banca con barra / Pecho · mío"; uno oculto dice además desde cuándo. */
function FilaDeEjercicio({
  ejercicio,
  grupos,
}: {
  ejercicio: Ejercicio
  grupos: Map<number, string>
}) {
  const detalle = [
    grupos.get(ejercicio.grupo_muscular_id) ?? 'Sin grupo',
    ejercicio.es_predefinido ? 'predefinido' : 'mío',
  ]
  if (ejercicio.oculto_desde) {
    detalle.push(`oculto desde el ${diaYMesConAnio(ejercicio.oculto_desde)}`)
  }
  return (
    <Link to={`/ejercicios/${ejercicio.id}`} className="programas-rutina biblioteca-fila">
      <span className="programas-rutina-texto">
        <strong>{ejercicio.nombre}</strong>
        <span>{detalle.join(' · ')}</span>
      </span>
      <Icono nombre="abrir" pequeno />
    </Link>
  )
}
