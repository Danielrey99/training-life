# Web 💻

Frontend web del proyecto, construido con **React 19** y **TypeScript**, sobre **Vite**. Consume la
API REST del [backend](../backend/README.md); nunca habla con la base de datos directamente.

**Índice:** [Estado actual](#estado-actual) · [Cómo ejecutarlo](#cómo-ejecutarlo) ·
[Estructura](#estructura) · [La sesión en curso](#la-sesión-en-curso) ·
[Hablar con la API](#hablar-con-la-api) · [Variables de entorno](#variables-de-entorno)

## Estado actual

🚧 En construcción, pero ya sirve para lo que se hizo el proyecto: registrar un entrenamiento
mientras se entrena.

La primera versión se escribió para validar que el circuito funciona —React pide, la API responde,
la pantalla pinta— y sirvió también para encontrar las asperezas de la API consumiéndola de verdad.
Con eso aprendido, la app se [diseñó entera](../README.md#diseño-de-la-app) antes de seguir, y la
web se está rehaciendo pantalla a pantalla siguiendo ese diseño. La primera, la sesión en curso.

- [x] Proyecto Vite + React + TypeScript, con React Router
- [x] Módulo propio para hablar con la API, con los tipos de cada respuesta
- [x] Pantalla de ejercicios
- [x] Primera versión de registrar un entrenamiento (ya sustituida)
- [x] El armazón del diseño: las cuatro secciones (Entrenar, Historial, Programas, Ejercicios)
  en una barra abajo en el móvil y en una columna a la izquierda en el PC, y el cliente de la API
  completo, con los tipos al día
- [x] La sesión en curso, siguiendo los bocetos
- [ ] *Hoy*, que sustituirá a la entrada provisional de ahora (elegir rutina y empezar)
- [ ] Rehacer el resto siguiendo los [bocetos](../docs/bocetos-movil-training-life.png): el
  calendario y la progresión, los programas y rutinas, y la biblioteca de ejercicios

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
    ├── App.tsx           # las pestañas y las rutas
    ├── index.css         # colores, medidas e iconos generales
    ├── App.css           # estilos del armazón y de las tarjetas
    ├── api/
    │   ├── tipos.ts      # la forma de lo que devuelve la API
    │   └── cliente.ts    # todas las llamadas, en un solo sitio
    ├── componentes/      # piezas que usan varias pantallas
    │   ├── Dialogo.tsx   # la confirmación antes de terminar, cancelar o borrar
    │   ├── Icono.tsx     # los iconos de trazo de los bocetos
    │   └── Pestanas.tsx  # la barra de las cuatro secciones
    ├── utiles/           # fechas y números en formato español
    └── paginas/          # una pantalla por archivo, o por carpeta si tiene piezas propias
        ├── Ejercicios.tsx
        ├── PorHacer.tsx  # lo que enseña una sección aún sin construir
        ├── RegistrarEntrenamiento.tsx   # entrada provisional a la sesión
        └── sesion/       # la sesión en curso
            ├── Sesion.tsx               # la pantalla: carga, huecos, terminar y cancelar
            ├── BloqueDeHueco.tsx        # un hueco, plegado o desplegado
            ├── SelectorDeEjercicio.tsx  # la flecha del comodín y su desplegable
            ├── FichasUltimaVez.tsx      # la última vez, con el globo de la variante
            ├── FormularioDeSerie.tsx    # peso y reps con − / +
            └── ultimaVez.ts             # cómo se pide la última vez
```

## La sesión en curso

Es la pantalla que se usa en el gimnasio (`/sesion/{id}`). Cada hueco de la rutina es un bloque, y
solo uno va desplegado: el que se está haciendo. Plegados, los demás dicen cuántas series llevan de
las que pide el hueco. Dentro del desplegado está la **última vez** que se hizo ese ejercicio en ese
hueco, en fichas (una por serie, con su peso); las series de hoy, cada una con su lápiz para
corregirla y su ✕ para borrarla; y el formulario de la siguiente, con peso y repeticiones en − / +
para poder usarlo con una mano.

Decisiones que se notan al usarla:

- **Cada serie se guarda en cuanto se pulsa *Guardar***, en vez de acumularlas para enviarlas al
  final. Una sesión dura más de una hora, y cerrar la pestaña sin querer no puede llevarse el
  entrenamiento.
- **La sesión vive en la URL**, no en la memoria de la página: se puede salir a otras pantallas,
  recargar o volver más tarde, y todo sigue ahí hasta pulsar *Terminar sesión* o *Cancelar sesión*.
  Las dos piden confirmación, y cancelar la borra con sus series, como si no se hubiera empezado.
- **El formulario arranca con la serie anterior** de ese ejercicio (peso, repeticiones y variante),
  porque las series de un hueco casi siempre repiten: lo normal es cambiar solo las repeticiones. En
  la primera serie arranca con la última vez. No se vacía al guardar, por lo mismo.
- **El número de la siguiente serie es el más alto + 1**, no cuántas hay: borrando una del medio,
  contarlas repetiría un número.
- **El comodín se elige con la flecha** que hay junto al nombre del ejercicio, en un botón propio
  para que no pase desapercibida. El desplegable enseña el principal y los comodines, cada uno con
  su última vez. Al elegir uno, la última vez, el peso de partida y las series nuevas pasan a ser de
  ese ejercicio. Si el principal está oculto, el hueco empieza ya con el comodín.
- **Editar una serie usa el mismo formulario**: el lápiz carga sus datos y el botón pasa a *Guardar
  cambios*. No hay un modo de edición aparte.
- **La variante no ocupa sitio en las fichas**: las que la tienen llevan un punto, y al mantenerlas
  pulsadas (o con el ratón encima) sale un globo por encima, donde el dedo no lo tapa.

Mientras no exista la pantalla de *Hoy*, a la sesión se entra desde una pantalla provisional que
permite elegir la fecha y la rutina, o continuar una sesión ya empezada. Si al empezar ya hay otra
sesión en curso ese día, lleva a ella en vez de dar un error.

## Hablar con la API

Todas las peticiones pasan por `src/api/cliente.ts`. Las pantallas no construyen URLs ni tratan
errores HTTP por su cuenta: piden `api.ejercicios()` y reciben datos ya tipados. El cliente cubre ya
todos los endpoints del backend, agrupados por recurso, aunque todavía no los usen todas las pantallas.

Cuando la API responde con un error, el cliente lanza un `ErrorDeApi` con un mensaje legible (el
motivo que da el backend, no "la API respondió 409"), el código de estado y el `detail` tal cual
llegó. La pantalla suele necesitar solo el mensaje, pero algunos 409 traen datos con los que
reaccionar: al empezar una sesión con otra ya en curso, el backend dice cuál es, y la pantalla puede
ofrecer continuarla.

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
