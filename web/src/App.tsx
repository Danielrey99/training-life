import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { Pestanas } from './componentes/Pestanas'
import { Ajustes } from './paginas/ajustes/Ajustes'
import { Biblioteca } from './paginas/ejercicios/Biblioteca'
import { Ficha } from './paginas/ejercicios/Ficha'
import { Formulario } from './paginas/ejercicios/Formulario'
import { Calendario } from './paginas/historial/Calendario'
import { Dia } from './paginas/historial/Dia'
import { Planificar } from './paginas/historial/Planificar'
import { Resumen } from './paginas/historial/Resumen'
import { Hoy } from './paginas/hoy/Hoy'
import { Ejercicio } from './paginas/programas/Ejercicio'
import { ProgramaNuevo } from './paginas/programas/ProgramaNuevo'
import { Programas } from './paginas/programas/Programas'
import { Rutina } from './paginas/programas/Rutina'
import { RutinaNueva } from './paginas/programas/RutinaNueva'
import { Semana } from './paginas/programas/Semana'
import { Progresion } from './paginas/progresion/Progresion'
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
          <Route path="/historial/planificar" element={<Planificar />} />
          <Route path="/historial/resumen" element={<Resumen />} />
          <Route path="/historial/:fecha" element={<Dia />} />
          {/* Direcciones antiguas, por si quedaron guardadas en el móvil: registrar un
              día pasado vive ahora en el calendario, y la sesión, en /sesion. */}
          <Route path="/registrar" element={<Navigate to="/historial" replace />} />
          <Route path="/registrar/:entrenamientoId" element={<RedirigirASesion />} />
          <Route path="/progresion/:ejercicioId" element={<Progresion />} />
          <Route path="/programas" element={<Programas />} />
          <Route path="/programas/nuevo" element={<ProgramaNuevo />} />
          {/* La rutina nueva y sus ejercicios trabajan sobre un borrador: nada se guarda
              hasta el Guardar de la rutina. */}
          <Route path="/programas/rutinas/nueva" element={<RutinaNueva />} />
          <Route path="/programas/rutinas/nueva/ejercicios/:indice" element={<Ejercicio />} />
          <Route path="/programas/rutinas/:rutinaId" element={<Rutina />} />
          <Route path="/programas/rutinas/:rutinaId/ejercicios/:huecoId" element={<Ejercicio />} />
          <Route path="/programas/:programaId" element={<Semana />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="/ejercicios" element={<Biblioteca />} />
          {/* "nuevo" antes que el id, o se leería como uno. */}
          <Route path="/ejercicios/nuevo" element={<Formulario />} />
          <Route path="/ejercicios/:ejercicioId" element={<Ficha />} />
          <Route path="/ejercicios/:ejercicioId/editar" element={<Formulario />} />
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
