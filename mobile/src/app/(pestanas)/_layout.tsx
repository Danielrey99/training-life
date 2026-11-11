/**
 * Las cuatro secciones de la app, abajo, al alcance del pulgar. Cada pestaña lleva siempre a
 * su pantalla principal, también al volver a ella desde otra (decisión del autor): por eso
 * `popToTopOnBlur`.
 */
import { Tabs } from 'expo-router'

import { Icono, type NombreIcono } from '../../componentes/Icono'
import { useColores } from '../../tema'

const PESTANAS: { ruta: string; nombre: string; icono: NombreIcono }[] = [
  { ruta: '(entrenar)', nombre: 'Entrenar', icono: 'entrenar' },
  { ruta: 'historial', nombre: 'Historial', icono: 'historial' },
  { ruta: 'programas', nombre: 'Programas', icono: 'programas' },
  { ruta: 'ejercicios', nombre: 'Ejercicios', icono: 'ejercicios' },
]

export default function Pestanas() {
  const c = useColores()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        popToTopOnBlur: true,
        tabBarActiveTintColor: c.acento,
        tabBarInactiveTintColor: c.textoTenue,
        // Sin altura fija: así suma la barra de gestos de Android y no queda debajo de ella.
        tabBarStyle: { backgroundColor: c.superficie, borderTopColor: c.borde },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: c.fondo },
      }}
    >
      {PESTANAS.map(({ ruta, nombre, icono }) => (
        <Tabs.Screen
          key={ruta}
          name={ruta}
          options={{
            title: nombre,
            tabBarIcon: ({ color }) => <Icono nombre={icono} color={color} />,
          }}
        />
      ))}
    </Tabs>
  )
}
