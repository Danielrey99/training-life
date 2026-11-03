import { Component, createContext, Fragment, useContext, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ErrorDeApi, textoDelFallo } from '../api/cliente'

type Props = { ruta: string; children: ReactNode }
type Estado = { fallo: boolean; ruta: string; intento: number }

// Vuelve a montar la pantalla de cero: con ella se repiten todas sus lecturas.
const Reintentar = createContext<() => void>(() => {})

/**
 * Si algo falla al pintar una pantalla, React la deja en blanco, también a mitad de
 * sesión. Esto enseña en su lugar un aviso con la salida a Entrenar. Al cambiar de
 * pantalla (`ruta`), el aviso se va y se vuelve a intentar. Si lo que falla es la propia
 * Entrenar, ir a ella no la volvería a montar: el botón la reintenta.
 */
export class Proteccion extends Component<Props, Estado> {
  state: Estado = { fallo: false, ruta: this.props.ruta, intento: 0 }

  static getDerivedStateFromError(): Partial<Estado> {
    return { fallo: true }
  }

  static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
    return props.ruta === estado.ruta ? null : { fallo: false, ruta: props.ruta }
  }

  reintentar = () => this.setState(({ intento }) => ({ fallo: false, intento: intento + 1 }))

  render() {
    if (!this.state.fallo) {
      return (
        <Reintentar.Provider value={this.reintentar}>
          <Fragment key={this.state.intento}>{this.props.children}</Fragment>
        </Reintentar.Provider>
      )
    }
    return (
      <div className="aviso-y-salida">
        <p className="aviso error">
          Algo ha fallado al enseñar esta pantalla. Lo que ya habías guardado sigue guardado.
        </p>
        {this.props.ruta === '/' ? (
          <button type="button" className="boton" onClick={this.reintentar}>
            Reintentar
          </button>
        ) : (
          <Link to="/" className="boton">
            Ir a Entrenar
          </Link>
        )}
      </div>
    )
  }
}

/**
 * Lo que sale cuando una pantalla no ha podido leer sus datos (sin conexión, un fallo
 * del servidor): el motivo y un botón para volver a pedirlos sin recargar la página.
 * Lo que no existe (un 404, o una dirección que no lleva un número donde va) no se
 * reintenta: dice que no existe, con `siNoExiste` si la pantalla tiene su propia frase.
 */
export function FalloAlCargar({ fallo, siNoExiste }: { fallo: unknown; siNoExiste?: string }) {
  const reintentar = useContext(Reintentar)
  if (fallo instanceof ErrorDeApi && fallo.estado === 404) {
    return <p className="aviso error">{siNoExiste ?? textoDelFallo(fallo)}</p>
  }
  // Al leer, un dato que no vale solo puede venir de la dirección («/sesion/abc»).
  if (fallo instanceof ErrorDeApi && fallo.estado === 422) {
    return <p className="aviso error">{siNoExiste ?? 'Esa página no existe.'}</p>
  }
  return (
    <div className="aviso-y-salida">
      <p className="aviso error">{textoDelFallo(fallo)}</p>
      <button type="button" className="boton" onClick={reintentar}>
        Reintentar
      </button>
    </div>
  )
}
