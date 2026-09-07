import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { Ejercicios } from './paginas/Ejercicios'
import './App.css'

/** El armazón: la cabecera fija y el hueco donde se pinta cada pantalla. */
export default function App() {
  return (
    <div className="app">
      <header>
        <h1>Training Life 🏋️</h1>
        <nav>
          <NavLink to="/ejercicios">Ejercicios</NavLink>
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/ejercicios" replace />} />
          <Route path="/ejercicios" element={<Ejercicios />} />
          <Route path="*" element={<p className="aviso">Esa página no existe.</p>} />
        </Routes>
      </main>
    </div>
  )
}
