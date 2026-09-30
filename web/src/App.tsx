import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'

import { Pestanas } from './componentes/Pestanas'
import { Ejercicios } from './paginas/Ejercicios'
import { Hoy } from './paginas/hoy/Hoy'
import { PorHacer } from './paginas/PorHacer'
import { RegistrarEntrenamiento } from './paginas/RegistrarEntrenamiento'
import { Sesion } from './paginas/sesion/Sesion'
import './App.css'

/** El armazón: las pestañas de las cuatro secciones y el hueco donde se pinta cada pantalla. */
export default function App() {
  return (
    <div className="armazon">
      <Pestanas />

      <main className="contenido">
        <Routes>
          <Route path="/" element={<Hoy />} />
          {/* Hasta que exista el calendario, es donde se apunta un día pasado. */}
          <Route path="/registrar" element={<RegistrarEntrenamiento />} />
          {/* La sesión abierta va en la URL: recargar no echa atrás. */}
          <Route path="/sesion/:entrenamientoId" element={<Sesion />} />
          {/* Donde vivía antes la sesión, por si quedó guardada en el móvil. */}
          <Route path="/registrar/:entrenamientoId" element={<RedirigirASesion />} />
          <Route
            path="/historial"
            element={
              <PorHacer seccion="El historial">
                Mientras tanto, un día pasado se apunta en{' '}
                <Link to="/registrar">Registrar un entrenamiento</Link>.
              </PorHacer>
            }
          />
          <Route path="/programas" element={<PorHacer seccion="Programas y rutinas" />} />
          <Route path="/ejercicios" element={<Ejercicios />} />
          <Route path="*" element={<p className="aviso">Esa página no existe.</p>} />
        </Routes>
      </main>
    </div>
  )
}

function RedirigirASesion() {
  const { entrenamientoId } = useParams()
  return <Navigate to={`/sesion/${entrenamientoId}`} replace />
}
