import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { Ejercicios } from './paginas/Ejercicios'
import { RegistrarEntrenamiento } from './paginas/RegistrarEntrenamiento'
import './App.css'

/** El armazón: la cabecera fija y el hueco donde se pinta cada pantalla. */
export default function App() {
  return (
    <div className="app">
      <header>
        <h1>Training Life 🏋️</h1>
        <nav>
          <NavLink to="/registrar">Registrar</NavLink>
          <NavLink to="/ejercicios">Ejercicios</NavLink>
        </nav>
      </header>

      <main>
        <Routes>
          {/* La raíz lleva a registrar, que es a lo que se entra en el gimnasio. */}
          <Route path="/" element={<Navigate to="/registrar" replace />} />
          <Route path="/registrar" element={<RegistrarEntrenamiento />} />
          {/* La sesión abierta va en la URL: recargar no echa atrás. */}
          <Route path="/registrar/:entrenamientoId" element={<RegistrarEntrenamiento />} />
          <Route path="/ejercicios" element={<Ejercicios />} />
          <Route path="*" element={<p className="aviso">Esa página no existe.</p>} />
        </Routes>
      </main>
    </div>
  )
}
