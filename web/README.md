# Web 💻

Frontend web del proyecto, construido con **React 19** y **TypeScript**, sobre **Vite**. Consume la
API REST del [backend](../backend/README.md); nunca habla con la base de datos directamente.

**Índice:** [Estado actual](#estado-actual) · [Cómo ejecutarlo](#cómo-ejecutarlo) ·
[Estructura](#estructura) · [Hablar con la API](#hablar-con-la-api) ·
[Variables de entorno](#variables-de-entorno)

## Estado actual

🚧 Recién empezada. Funciona el circuito completo —React pide datos, la API responde y la pantalla
los pinta— con una sola pantalla: la biblioteca de ejercicios.

- [x] Proyecto Vite + React + TypeScript, con React Router
- [x] Módulo propio para hablar con la API, con los tipos de cada respuesta
- [x] Pantalla de ejercicios
- [ ] Registrar un entrenamiento (la que de verdad se usará en el gimnasio)
- [ ] Rutinas, con sus huecos y comodines
- [ ] Historial de progresión por ejercicio y por hueco

## Cómo ejecutarlo

Hace falta el backend levantado (`docker compose up -d` en la raíz del repo).

```bash
cd web
npm install      # solo la primera vez
npm run dev
```

La web queda en **http://localhost:5173**. Ese puerto está fijado en `vite.config.ts` a propósito:
el backend solo acepta peticiones desde ese origen, así que si Vite eligiera otro al encontrarlo
ocupado, el navegador bloquearía todas las llamadas.

Otros comandos: `npm run build` (compila TypeScript y genera `dist/`) y `npm run lint`.

En desarrollo la web se sirve con Vite, no con Docker: el recargado en caliente es la mitad del
valor de trabajar así, y montar `node_modules` en un contenedor de Windows lo vuelve lento. Cuando
la web esté hecha se añadirá al `docker-compose.yml` un servicio que sirva el build ya compilado.

## Estructura

```
web/
├── index.html            # el html que carga la aplicación
├── vite.config.ts        # configuración de Vite (incluido el puerto fijo)
├── public/               # archivos servidos tal cual (el favicon)
└── src/
    ├── main.tsx          # arranca React y monta el router
    ├── App.tsx           # la cabecera y las rutas
    ├── index.css         # colores y estilos generales
    ├── App.css           # estilos del armazón y de las tarjetas
    ├── api/
    │   ├── tipos.ts      # la forma de lo que devuelve la API
    │   └── cliente.ts    # todas las llamadas, en un solo sitio
    └── paginas/          # una pantalla por archivo
        └── Ejercicios.tsx
```

## Hablar con la API

Todas las peticiones pasan por `src/api/cliente.ts`. Las pantallas no construyen URLs ni tratan
errores HTTP por su cuenta: piden `api.ejercicios()` y reciben datos ya tipados.

Esa separación es la que permitirá cambiar cosas en un solo archivo más adelante — añadir el token
cuando exista JWT, reintentar peticiones fallidas o meter una caché — sin recorrer todas las
pantallas.

Los tipos de `src/api/tipos.ts` reflejan los esquemas de `backend/app/schemas.py`. **No se generan
solos**: si cambia un endpoint, hay que actualizarlos a mano o el editor mentirá.

## Variables de entorno

| Variable | Para qué | Valor por defecto |
|---|---|---|
| `VITE_API_URL` | Dónde está la API | `http://localhost:8000` |

Solo hace falta tocarla para abrir la web desde otro dispositivo de la red de casa, donde
`localhost` ya no es el PC que sirve la API. Se define en un archivo `.env` dentro de `web/`
(copia de `.env.example`), que no se sube a git.
