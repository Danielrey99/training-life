import { Link, useLocation } from 'react-router-dom'

import { Icono, type NombreIcono } from './Icono'

type Pestana = {
  nombre: string
  icono: NombreIcono
  destino: string
  // Rutas que cuentan como esta sección: la sesión en curso es de Entrenar,
  // aunque su URL no empiece por la de la pestaña.
  rutas: string[]
}

const PESTANAS: Pestana[] = [
  { nombre: 'Entrenar', icono: 'entrenar', destino: '/', rutas: ['/sesion'] },
  // Registrar un día pasado será parte del calendario; mientras no exista, vive aparte.
  {
    nombre: 'Historial',
    icono: 'historial',
    destino: '/historial',
    rutas: ['/historial', '/registrar'],
  },
  { nombre: 'Programas', icono: 'programas', destino: '/programas', rutas: ['/programas'] },
  { nombre: 'Ejercicios', icono: 'ejercicios', destino: '/ejercicios', rutas: ['/ejercicios'] },
]

function esActiva(pestana: Pestana, ruta: string) {
  return (
    ruta === pestana.destino ||
    pestana.rutas.some((prefijo) => ruta === prefijo || ruta.startsWith(prefijo + '/'))
  )
}

/**
 * Las cuatro secciones de la app. En el móvil van abajo, al alcance del pulgar;
 * en el PC, en una columna a la izquierda. Es el mismo componente: lo que cambia
 * es el CSS.
 */
export function Pestanas() {
  const { pathname } = useLocation()

  return (
    <nav className="pestanas">
      {PESTANAS.map((pestana) => {
        const activa = esActiva(pestana, pathname)
        return (
          <Link
            key={pestana.destino}
            to={pestana.destino}
            className={activa ? 'pestana activa' : 'pestana'}
            aria-current={activa ? 'page' : undefined}
          >
            <Icono nombre={pestana.icono} />
            <span>{pestana.nombre}</span>
          </Link>
        )
      })}
    </nav>
  )
}
