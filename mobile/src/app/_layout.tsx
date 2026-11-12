// Antes que nada: los ajustes se guardan en el `localStorage` que instala expo-sqlite.
import 'expo-sqlite/localStorage/install'

import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'

import { ArranqueFallido } from '../pantallas/ArranqueFallido'
import { arrancar } from '../plataforma/arranque'
import { prepararRastroDeFallos } from '../plataforma/rastro'
import { useAjustes } from '../utiles/ajustes'
import { useColores } from '../tema'

// Antes de abrir la base: un fallo al arrancar también deja rastro.
prepararRastroDeFallos()

export default function Layout() {
  const c = useColores()
  const { tema } = useAjustes()
  // La base se abre aquí, antes de enseñar nada: si no se puede, en vez de la app sale la
  // pantalla de arranque fallido, y no un «Algo ha fallado» en cada pantalla.
  const [estado, setEstado] = useState(arrancar)
  return (
    <>
      {/* La hora y los iconos de arriba, oscuros en tema claro y claros en oscuro. */}
      <StatusBar style={tema === 'sistema' ? 'auto' : tema === 'claro' ? 'dark' : 'light'} />
      {estado.tipo === 'fallida' ? (
        <ArranqueFallido estado={estado} alReintentar={() => setEstado(arrancar())} />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.fondo } }} />
      )}
    </>
  )
}
