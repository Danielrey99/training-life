import { Navigate, Route, Routes } from 'react-router-dom'

import { Pestanas } from './componentes/Pestanas'
import { Ejercicios } from './paginas/Ejercicios'
import { PorHacer } from './paginas/PorHacer'
import { RegistrarEntrenamiento } from './paginas/RegistrarEntrenamiento'
import './App.css'

/** El armazón: las pestañas de las cuatro secciones y el hueco donde se pinta cada pantalla. */
export default function App() {
  return (
    <div className="armazon">
      <Pestanas />

      <main className="contenido">
        <Routes>
          {/* Hasta que exista Hoy, Entrenar abre la pantalla de registrar. */}
          <Route path="/" element={<Navigate to="/registrar" replace />} />
          <Route path="/registrar" element={<RegistrarEntrenamiento />} />
          {/* La sesión abierta va en la URL: recargar no echa atrás. */}
          <Route path="/registrar/:entrenamientoId" element={<RegistrarEntrenamiento />} />
          <Route path="/historial" element={<PorHacer seccion="El historial" />} />
          <Route path="/programas" element={<PorHacer seccion="Programas y rutinas" />} />
          <Route path="/ejercicios" element={<Ejercicios />} />
          <Route path="*" element={<p className="aviso">Esa página no existe.</p>} />
        </Routes>
      </main>
    </div>
  )
}
