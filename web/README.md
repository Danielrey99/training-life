# Web 💻

Frontend web del proyecto, construido con **React 19** y **TypeScript**, sobre **Vite**. Consume la
API REST del [backend](../backend/README.md); nunca habla con la base de datos directamente.

**Índice:** [Estado actual](#estado-actual) · [Cómo ejecutarlo](#cómo-ejecutarlo) ·
[Estructura](#estructura) · [Registrar un entrenamiento](#registrar-un-entrenamiento) ·
[Hablar con la API](#hablar-con-la-api) · [Variables de entorno](#variables-de-entorno)

## Estado actual

🚧 En construcción, pero ya sirve para lo que se hizo el proyecto: registrar un entrenamiento
mientras se entrena.

Esta primera pantalla se escribió para validar que el circuito funciona —React pide, la API responde,
la pantalla pinta— y sirvió también para encontrar las asperezas de la API consumiéndola de verdad.
Con eso aprendido, la app se ha [diseñado entera](../README.md#diseño-de-la-app) antes de seguir,
así que esta pantalla se rehará siguiendo ese diseño. Lo que se conserva es el comportamiento que
ya funciona: la sesión en la URL, guardar cada serie en el momento y arrancar el formulario con la
serie anterior.

- [x] Proyecto Vite + React + TypeScript, con React Router
- [x] Módulo propio para hablar con la API, con los tipos de cada respuesta
- [x] Pantalla de ejercicios
- [x] Registrar un entrenamiento: elegir rutina, anotar series hueco a hueco y borrarlas
- [ ] Rehacer la web siguiendo los [bocetos](../docs/bocetos-movil-training-life.png), pantalla a
  pantalla, empezando por *Hoy* y la sesión en curso: después el calendario y la progresión, los
  programas y rutinas, y la biblioteca de ejercicios

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
        ├── Ejercicios.tsx
        └── RegistrarEntrenamiento.tsx
```

## Registrar un entrenamiento

Es la pantalla que se usa en el gimnasio, y por eso es la que abre la web. Se elige la fecha y la
rutina (o "entrenamiento libre"), y a partir de ahí cada hueco de la rutina tiene su propio bloque:
lo que ya se ha hecho hoy, y un formulario para añadir la siguiente serie.

Dos decisiones que se notan al usarla:

- **Cada serie se guarda en cuanto se añade**, en vez de acumularlas para enviarlas al final. Una
  sesión dura más de una hora y cerrar la pestaña sin querer no puede llevarse el entrenamiento.
- **La sesión abierta vive en la URL** (`/registrar/{id}`), no en la memoria de la página. Recargar
  desde el móvil deja donde estabas, y volver a entrar más tarde es cuestión de retomar la sesión
  desde la lista.

El formulario arranca con el ejercicio, el peso y la variante de la serie anterior, porque las
series de un mismo hueco casi siempre repiten: lo normal es cambiar solo las repeticiones. El RPE no
se arrastra, que cambia en cada serie. El desplegable de ejercicio ofrece el principal del hueco y
sus comodines; si un día se hace algo que no está en la rutina, va en el bloque de series sueltas.

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
