import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Puerto fijo: el backend solo permite peticiones desde este origen
    // (CORSMiddleware en backend/app/main.py). Si Vite eligiera otro puerto al
    // encontrarlo ocupado, el navegador bloquearía todas las llamadas a la API.
    port: 5173,
    strictPort: true,
  },
})
