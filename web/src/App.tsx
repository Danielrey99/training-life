import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { Pestanas } from './componentes/Pestanas'
import { Ejercicios } from './paginas/Ejercicios'
import { Calendario } from './paginas/historial/Calendario'
import { Dia } from './paginas/historial/Dia'
import { Hoy } from './paginas/hoy/Hoy'
import { PorHacer } from './paginas/PorHacer'
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
          {/* La sesión abierta va en la URL: recargar no echa atrás. */}
          <Route path="/sesion/:entrenamientoId" element={<Sesion />} />
          <Route path="/historial" element={<Calendario />} />
          <Route path="/historial/:fecha" element={<Dia />} />
          {/* Direcciones antiguas, por si quedaron guardadas en el móvil: registrar un
              día pasado vive ahora en el calendario, y la sesión, en /sesion. */}
          <Route path="/registrar" element={<Navigate to="/historial" replace />} />
          <Route path="/registrar/:entrenamientoId" element={<RedirigirASesion />} />
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
