import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Props = { ruta: string; children: ReactNode }
type Estado = { fallo: boolean; ruta: string }

/**
 * Si algo falla al pintar una pantalla, React la deja en blanco, también a mitad de
 * sesión. Esto enseña en su lugar un aviso con la salida a Entrenar. Al cambiar de
 * pantalla (`ruta`), el aviso se va y se vuelve a intentar.
 */
export class Proteccion extends Component<Props, Estado> {
  state: Estado = { fallo: false, ruta: this.props.ruta }

  static getDerivedStateFromError(): Partial<Estado> {
    return { fallo: true }
  }

  static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
    return props.ruta === estado.ruta ? null : { fallo: false, ruta: props.ruta }
  }

  render() {
    if (!this.state.fallo) return this.props.children
    return (
      <div className="aviso-y-salida">
        <p className="aviso error">
          Algo ha fallado al enseñar esta pantalla. Lo que ya habías guardado sigue guardado.
        </p>
        <Link to="/" className="boton">
          Ir a Entrenar
        </Link>
      </div>
    )
  }
}
