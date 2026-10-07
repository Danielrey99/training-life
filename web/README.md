# Web 💻

Frontend web del proyecto, construido con **React 19** y **TypeScript**, sobre **Vite**. Consume la API REST del [backend](../backend/README.md); nunca habla con la base de datos directamente.

**Índice:** [Estado actual](#estado-actual) · [Cómo ejecutarlo](#cómo-ejecutarlo) ·
[Estructura](#estructura) · [La sesión en curso](#la-sesión-en-curso) · [Programas](#programas-y-rutinas) ·
[Hablar con la API](#hablar-con-la-api) · [Variables de entorno](#variables-de-entorno)

## Estado actual

🚧 En construcción, pero ya sirve para lo que se hizo el proyecto: registrar un entrenamiento mientras se entrena.

La primera versión se escribió para validar que el circuito funciona —React pide, la API responde, la pantalla pinta— y sirvió también para encontrar las asperezas de la API consumiéndola de verdad. Con eso aprendido, la app se [diseñó entera](../README.md#diseño-de-la-app) antes de seguir, y la web se está rehaciendo pantalla a pantalla siguiendo ese diseño. Ya están la sesión en curso, la pantalla de entrada (*Hoy*), el historial (el calendario y cada día), la progresión de un ejercicio, la planificación de los próximos días y el resumen de volumen y constancia.

- [x] Proyecto Vite + React + TypeScript, con React Router
- [x] Módulo propio para hablar con la API, con los tipos de cada respuesta
- [x] Pantalla de ejercicios
- [x] Primera versión de registrar un entrenamiento (ya sustituida)
- [x] El armazón del diseño: las cuatro secciones (Entrenar, Historial, Programas, Ejercicios) en una barra abajo en el móvil y en una columna a la izquierda en el PC, y el cliente de la API completo, con los tipos al día
- [x] La sesión en curso, siguiendo los bocetos
- [x] *Hoy*: qué toca, la semana, lo que queda por recuperar y qué más se puede entrenar
- [x] El calendario del historial, y apuntar desde él un día pasado
- [x] Ver un día y corregirlo: sus series, la fecha, las notas o borrarlo entero
- [x] La progresión de un ejercicio: una gráfica de peso, volumen o 1RM estimado por sesión
- [x] Planificar los próximos días: qué toca cada día de hoy en adelante, sustituyéndolo al tocar
- [x] El resumen: el volumen por semana o por mes con el desglose de la barra elegida, y la constancia del año
- [x] La lista de programas y rutinas, con sus ocultos plegados
- [ ] Rehacer el resto siguiendo los [bocetos](../docs/bocetos-movil-training-life.png): la semana de un programa, las rutinas y sus huecos, y la biblioteca de ejercicios

## Cómo ejecutarlo

Hace falta el backend levantado (`docker compose up -d` en la raíz del repo).

```bash
cd web
npm install      # solo la primera vez
npm run dev
```

La web queda en **http://localhost:5173**. Ese puerto está fijado en `vite.config.ts` a propósito: el backend solo acepta peticiones desde ese origen, así que si Vite eligiera otro al encontrarlo ocupado, el navegador bloquearía todas las llamadas.

Otros comandos: `npm run build` (compila TypeScript y genera `dist/`) y `npm run lint`.

En desarrollo la web se sirve con Vite, no con Docker: el recargado en caliente es la mitad del valor de trabajar así, y montar `node_modules` en un contenedor de Windows lo vuelve lento. Cuando la web esté hecha se añadirá al `docker-compose.yml` un servicio que sirva el build ya compilado.

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
    │   ├── Dialogo.tsx   # la confirmación antes de terminar, cancelar o borrar, y el aviso de un solo botón
    │   ├── Icono.tsx     # los iconos de trazo de los bocetos
    │   ├── MarcaDelDia.tsx  # la marca de un día (hecho, movido, sin hacer…), para la semana y el calendario
    │   ├── NotaDeSesion.tsx # la nota de una sesión, en la sesión y en el día del historial
    │   └── Pestanas.tsx  # la barra de las cuatro secciones
    ├── utiles/           # fechas y números en formato español, el color de cada día y la flecha de volver
    └── paginas/          # una pantalla por archivo, o por carpeta si tiene piezas propias
        ├── Ejercicios.tsx
        ├── PorHacer.tsx  # lo que enseña una sección aún sin construir
        ├── historial/    # la pestaña de Historial
        │   ├── Calendario.tsx           # el mes, sus cifras y la leyenda
        │   ├── HojaRegistrar.tsx        # apuntar un día pasado
        │   ├── Dia.tsx                  # ver un día y corregirlo
        │   ├── Planificar.tsx           # qué toca cada día de hoy en adelante, por semanas
        │   ├── Resumen.tsx              # el volumen por semana o por mes, su desglose y la constancia
        │   └── BloqueDelDia.tsx         # un hueco del día, con sus series y + Añadir serie
        ├── hoy/          # la pantalla de entrada
        │   └── Hoy.tsx                  # la semana, la tarjeta de hoy, lo que recuperar y las listas
        ├── programas/    # la pestaña de Programas
        │   ├── Programas.tsx            # los programas y la biblioteca de rutinas, con sus ocultos
        │   └── programas.css
        ├── progresion/   # la gráfica de un ejercicio
        │   ├── Progresion.tsx           # el rango, la medida, la cifra y la lista de sesiones
        │   ├── Grafica.tsx              # el SVG: ejes, línea, puntos y globo
        │   └── progresion.css
        └── sesion/       # la sesión en curso
            ├── Sesion.tsx               # la pantalla: carga, huecos, terminar y cancelar
            ├── BloqueDeHueco.tsx        # un hueco, plegado o desplegado
            ├── SelectorDeEjercicio.tsx  # la flecha del comodín y su desplegable
            ├── FichasUltimaVez.tsx      # la última vez, con el globo de la variante
            ├── FormularioDeSerie.tsx    # peso y reps con − / +
            └── ultimaVez.ts             # cómo se pide la última vez
```

## La sesión en curso

Es la pantalla que se usa en el gimnasio (`/sesion/{id}`). Cada hueco de la rutina es un bloque, y solo uno va desplegado: el que se está haciendo. Plegados, los demás dicen cuántas series llevan de las que pide el hueco. Dentro del desplegado está la **última vez** que se hizo ese ejercicio en ese hueco, en fichas (una por serie, con su peso); las series de hoy, cada una con su lápiz para corregirla y su ✕ para borrarla; y el formulario de la siguiente, con peso y repeticiones en − / + para poder usarlo con una mano.

Decisiones que se notan al usarla:

- **Cada serie se guarda en cuanto se pulsa *Guardar***, en vez de acumularlas para enviarlas al final. Una sesión dura más de una hora, y cerrar la pestaña sin querer no puede llevarse el entrenamiento.
- **La sesión vive en la URL**, no en la memoria de la página: se puede salir a otras pantallas, recargar o volver más tarde, y todo sigue ahí hasta pulsar *Terminar sesión* o *Cancelar sesión*. Terminar una sesión sin ninguna serie la cancela, en vez de dejar un día vacío en el historial, y el diálogo lo avisa. Las dos piden confirmación, y cancelar la borra con sus series, como si no se hubiera empezado. La flecha de volver lleva a la pantalla de la que se venía, y en una sesión de un día pasado, a su día en el historial.
- **El formulario arranca con la serie anterior** de ese ejercicio (peso, repeticiones y variante), porque las series de un hueco casi siempre repiten: lo normal es cambiar solo las repeticiones. En la primera serie arranca con la última vez. No se vacía al guardar, por lo mismo.
- **El número de la siguiente serie es el más alto + 1**, no cuántas hay: borrando una del medio, contarlas repetiría un número.
- **El comodín se elige con la flecha** que hay junto al nombre del ejercicio, en un botón propio para que no pase desapercibida. El desplegable enseña el principal y los comodines, cada uno con su última vez. Al elegir uno, la última vez, el peso de partida y las series nuevas pasan a ser de ese ejercicio. Si el principal está oculto, el hueco empieza ya con el comodín.
- **Editar una serie usa el mismo formulario**: el lápiz carga sus datos, con *Cancelar* y *Guardar cambios* en la misma línea. No hay un modo de edición aparte.
- **Se edita una cosa cada vez**: con una serie o la nota abiertas, el resto (los otros lápices y ✕, los demás huecos, *Terminar* y *Cancelar sesión*) se queda desactivado hasta guardar o cancelar. Por eso qué está abierto lo lleva la pantalla y no cada bloque.
- **La nota se escribe en cualquier momento**, no solo al terminar: al final de la sesión sale *Añadir nota*, y una vez escrita se ve con su lápiz y su ✕, como una serie. Es el mismo bloque que en el día del historial (`componentes/NotaDeSesion.tsx`).
- **La variante no ocupa sitio en las fichas**: las que la tienen llevan un punto, y al tocarlas (o con el ratón encima) sale un globo por encima, donde el dedo no lo tapa. Se cierra tocando otra vez o en cualquier otro sitio. Se descartó mantener pulsado: es un gesto que nadie descubre solo.

Si la sesión recupera o adelanta otro día, la cabecera lo dice: *Recuperando el Push del lunes 28*.

## Hoy

La pantalla de entrada (`/`). Arriba, la semana con las mismas marcas que tendrá el calendario; debajo, una tarjeta con lo de hoy, lo que queda **por recuperar** con el plazo de cada día, la **última sesión hecha** y una lista con qué más se puede entrenar hoy.

- **Todo sale de una sola llamada** (`GET /plan/hoy`). Qué toca, qué se puede recuperar, adelantar o intercambiar, y si hoy ya se entrenó, lo decide el backend: así la web y el móvil dirán siempre lo mismo, y la pantalla solo pinta.
- **Al pulsar un botón, la web dice qué día del plan va a contar la sesión**: *Empezar* cuenta hoy, *Recuperar* el día que se faltó y *Adelantar* el día ofrecido. *Intercambiar* cambia antes el plan de los dos días y después empieza la de hoy.
- **Las sesiones de un día pasado que se dejaron sin terminar se avisan** en una sección *Sin terminar* bajo la tarjeta, con sus series y un enlace para terminarlas o cancelarlas. Cuentan como hechas desde la primera serie, así que sin el aviso se podrían olvidar a medias. Una sesión que se abrió para apuntar un día pasado y se quedó sin ninguna serie también sale, con la etiqueta *vacía*, para completarla o cancelarla; no cuenta como hecha y nada la borra por su cuenta.
- **Todo lo que empieza algo pregunta antes**, con un botón que dice lo que hace (*Empezar*, *Recuperar*, *Adelantar*, *Intercambiar*). Recuperar en un día de entrenamiento avisa de que lo de hoy quedará pendiente, y hasta cuándo se podrá recuperar.
- **Las marcas de la semana juntan lo que se hizo y lo que tocaba**: el punto lleno es lo que se hizo ese día, del color del día que contó; el aro, lo que tocaba y sigue sin hacer; la flecha, que se hizo otro día (→ después, ← antes). Cada día de la semana tiene su color, no cada rutina, para que un día movido diga de dónde viene.
- **La tarjeta cambia con el día**: empezar lo que toca, continuar la sesión a medias, ya entrenado, descanso (con qué toca después), hecho por adelantado, sin programa (con todas las rutinas para entrenar igualmente) o, la primera vez, una bienvenida que lleva a Programas.

## Historial

El calendario (`/historial`) enseña el mes con las mismas marcas que la semana de *Hoy*, y debajo tres cifras: cuántos días planificados se entrenaron (también los movidos), cuántos se movieron y cuántos se quedaron sin hacer. La leyenda va plegada, porque se consulta poco. El mes va en la URL (`?mes=2026-09`), para que volver de un día no devuelva al mes actual.

**Tocar un día enseña siempre lo que se hizo ese día**, nunca lo del día en que se hizo su rutina: si hubo sesión, abre el día; si es hoy, lleva a *Hoy*; y si es un día pasado sin sesión, abre una hoja para apuntar lo que se hizo. Esa hoja ofrece lo mismo que habría ofrecido *Hoy* aquel día (lo que tocaba, lo que seguía por recuperar y lo que se podía adelantar), y además cualquier otra rutina, que se apunta sin contar para ningún día del programa. Sirve para pasar a la app la libreta de meses anteriores, o para el día que se entrenó y se olvidó apuntar.

Lo que se hizo sin contar para ningún día lleva el color del día de su rutina en el programa activo, para que se reconozca; solo sale en gris si la rutina no está en el programa.

### Un día

La única pantalla de ver un día (`/historial/2026-09-29`), a la que se llega desde el calendario, desde la última sesión de *Hoy* y al terminar una sesión. Arriba, tres cifras: las series frente a las que pedía la rutina, el volumen (peso por repeticiones), con cuánto cambió frente a la sesión anterior de la misma rutina, y cuántos ejercicios mejoraron. Debajo, un bloque por hueco con el ejercicio que se hizo, su objetivo (*3 × 8-12*, a la derecha del nombre), sus series y **la última vez que se hizo ese ejercicio en ese hueco**, en fichas, mirando siempre hacia atrás desde ese día.

- **Las insignias de cada ejercicio comparan con esa última vez**, una por cosa que cambió: el peso más alto (*+2,5 kg*), el total de repeticiones (*−7 reps*) y el **1RM estimado** (*↑ 1RM 36,1 kg (+1,3)*), que es el que decide si mejoró. Es la media de lo que cada serie permitiría levantar una sola vez (fórmula de Epley, `peso × (1 + reps / 30)`), así que subir peso y bajar repeticiones se compensa en una sola medida, y hacer una serie menos no cuenta como empeorar. Si es la primera vez, *nuevo*.
- **El volumen es un dato de cuánto trabajo se hizo, no de fuerza**: puede bajar aunque todo mejore, por ejemplo si se usó un comodín más ligero. La leyenda del final dice con qué se compara cada cosa.
- **Mientras una sesión de un día pasado no está terminada**, el día ofrece *Seguir apuntando*, que vuelve a la sesión.
- **Si se hizo con un comodín, lo dice**: *En lugar de Fondos en paralelas*. Y si la sesión recuperaba o adelantaba otro día, la cabecera lo recuerda (*Recuperado del lunes 28*).
- **Con *Editar*** la fecha pasa a ser un campo, cada serie gana su lápiz (que abre el mismo formulario de la sesión) y su ✕, la nota también (o *Añadir nota* si no tiene), y al pie sale *Borrar este día*. La flecha de volver pasa a ser *Cancelar* y *Editar*, *Guardar*. **Todo va a un borrador** (fecha, nota y series; las nuevas, con id negativo) y *Guardar* lo envía de golpe; *Cancelar* lo descarta. Por eso los formularios de dentro dicen *Añadir* o *Aplicar*. Se envía primero la fecha y la nota, que son lo que puede no valer: si falla, no se toca nada más y el modo editar sigue abierto; después, las series borradas, cambiadas y nuevas. Igual que en la sesión, se edita una cosa cada vez: con un formulario abierto, el resto se desactiva, incluidos *Cancelar* y *Guardar*.
- **Las series que se olvidó apuntar se añaden ahí mismo**: con *Editar*, cada hueco lleva *+ Añadir serie*, que abre el formulario de la sesión con la siguiente serie. Los huecos que ese día se quedaron sin series también salen al editar, con borde discontinuo, y si tienen comodines llevan la misma flecha que en la sesión para elegir con qué ejercicio.
- **La fecha solo se mueve dentro del plazo del día que cuenta** la sesión, y nunca a un día que ya tiene otra. Si no se puede, el campo explica por qué con palabras de la app, no con las de la API.
- **Al terminar una sesión** se llega a su día. La flecha de volver, aquí y en el resto de pantallas, lleva a la pantalla de la que se vino (de *Hoy* a un día, vuelve a *Hoy*), y tras terminar, cancelar o borrar no lleva a algo que ya no existe. Si la pantalla se abrió directamente (un enlace o una recarga), lleva a la pantalla de la que cuelga; para saberlo mira la posición en el historial del navegador, que no cambia cuando la pantalla reescribe su URL al elegir una opción.

### Planificar

Los días de hoy en adelante (`/historial/planificar`), por semanas y sin límite: al llegar al final de la lista se piden cuatro semanas más (un `IntersectionObserver`), y el backend admite hasta 400 días por llamada. Tocar un día abre una hoja con las rutinas del programa (en el orden de la semana), *Descanso* y, debajo, *Otras rutinas* (las que no están en el programa, por orden alfabético; sin programa activo salen todas así); elegir una **sustituye** lo que tocaba (no lo intercambia con otro día) y se guarda en el momento. Los días cambiados llevan su marca, y *Restablecer este día* o *la semana* los devuelven al programa; la semana pregunta antes.

- **Lo pendiente de recuperar no sale aquí**: la pantalla solo enseña hoy y lo que viene, y recuperar se hace desde *Hoy*.
- **Un día ya hecho por adelantado** lleva *hecho el martes*. Si se le quita su rutina y no queda otro día de la semana con ella, el backend lo rechaza con un 409 y la pantalla lo explica con las palabras del boceto (*No puedes quitar este Pull…*) en un aviso de un solo botón. Es el mismo `Dialogo` de las confirmaciones, con una variante cuyo tipo no admite mezclar el botón único con el de confirmar.
- **Una rutina oculta sigue en su día, en gris**, porque ocultar no la quita del programa, pero ese día cuenta como descanso. Elegir *Descanso* ahí sí cambia algo (lo deja así aunque la rutina se vuelva a mostrar), y elegir otra rutina la sustituye solo en esa fecha.
- Cada recarga tras un cambio vuelve a leer lo ya cargado, porque mover un día puede mover también lo que se hizo por adelantado.

### Resumen

La progresión general, no por ejercicio (`/historial/resumen?mes=2026-09`), a la que se llega con *Ver resumen* desde el calendario. Arriba, *Por semana* o *Por mes*; debajo, una gráfica de barras con el volumen (peso por repeticiones) de las últimas ocho semanas o meses terminados y, si el periodo de hoy cae en ella, una barra más, rayada, con lo que va de él.

- **Tocar una barra la elige** (toda la columna es un botón, barra y fecha): arriba salen su periodo, su volumen y cuánto cambió, y los dos recuadros de abajo pasan a ser de esa barra: el **volumen por rutina** y las **series por grupo muscular**. Así la gráfica enseña la evolución y los recuadros el desglose de lo que se toca, sin más controles. Al entrar, o al cambiar de semanas a meses, queda elegida la última barra terminada.
- **El cambio se compara con el último periodo en que se entrenó**, aunque quede fuera de la gráfica: tras una semana de vacaciones, la siguiente dice *+5,7 % sobre la semana del 11 ago* en lugar de quedarse sin porcentaje. Si es la semana justo anterior, dice *sobre la semana anterior*.
- **El color se usa solo cuando dice algo**: cada rutina lleva el color de su día en el programa (el mismo del calendario), y las series por grupo van en gris, porque un color por grupo serían siete u ocho que no significan nada y se confundirían con los de los días. El verde queda para el volumen y la constancia.
- **La constancia del año** va en su propio recuadro, fija: por mes, en gris lo planificado (también lo que aún no ha llegado) y en verde lo entrenado, que lo va llenando. Lo recuperado y lo adelantado cuentan en el mes del día que tocaba.
- **Todo llega en una sola llamada** (`GET /resumen`), con el desglose de cada barra ya calculado: elegir otra barra o cambiar de vista no espera a la red. El mes, la vista y la barra elegida van en la URL, para que recargar no los pierda.

## Progresión

La gráfica de un ejercicio (`/progresion/86`), a la que se llega con la flecha de cada hueco en un día del historial. Un punto por sesión, repartidos según la fecha (dos sesiones muy separadas se ven separadas), con tres medidas sobre los mismos puntos y cinco rangos (1 mes, 3, 6, 1 año y todo). El rango y la medida van en la URL, así que recargar no los pierde. Arriba, el último valor y cuánto ha cambiado desde la primera sesión del rango; debajo, las sesiones con sus series, cada una enlazada a su día.

- **Peso**: el más alto de cada sesión. **Volumen**: peso por repeticiones, sumado. **1RM estimado**: la media de lo que cada serie permitiría levantar una sola vez (fórmula de Epley, `peso × (1 + reps / 30)`).
- **El 1RM es el mismo que decide si un ejercicio mejoró en el día del historial**, y sale de una única función (`unoRM`), así que un mismo día da el mismo número en las dos pantallas. Se hace la media de las series y no se toma la mejor porque las rutinas son de doble progresión (*3 × 8-12*): se sube repeticiones hasta llegar a 12 en todas las series y entonces se sube peso, y en esas semanas el progreso está en las series de después, que la mejor serie no ve.
- **La gráfica es SVG hecho a mano**, sin librería: la cuadrícula busca valores redondos (pasos de 1, 2, 2,5 o 5), y se dibuja al ancho real de la tarjeta, medido con `ResizeObserver`, para que las letras no cambien de tamaño entre el móvil y el escritorio. Cada punto lleva una zona táctil mayor que él y se maneja también con el teclado; tocar uno cambia el globo con su día, su rutina y su valor.
- Si el ejercicio no se ha hecho nunca, o no en el rango elegido, la pantalla lo dice en vez de enseñar una gráfica vacía.

## Programas y rutinas

La pestaña de Programas (`/programas`) tiene dos listas: los **programas**, con el activo primero y marcado, y la **biblioteca de rutinas**. Cada programa dice cuándo se usó (*Desde el 6 de julio*, *Del 2 de marzo al 28 de junio* o *Sin usar todavía*) y cada rutina cuántos ejercicios tiene y en cuántos programas está, o *sin programa*. Sin esa segunda lista, una rutina que no estuviera en ningún programa sería inalcanzable.

- **Los ocultos van plegados al pie de cada lista** (*Ver 2 rutinas ocultas*), y cuáles están desplegadas queda en la URL (`?ver=rutinas`), para que volver desde uno oculto no los cierre. Un programa oculto no recuerda las fechas exactas, solo desde cuándo no se usa.
- **Solo cuenta lo visible**: un programa con una rutina oculta dice un día menos (ese día queda en descanso) y una rutina con un hueco oculto, un ejercicio menos.
- **Sin rutinas ni programas** la pantalla lo dice y *Nueva rutina* pasa a ser la acción principal, en verde: es el primer paso.
- **Todo llega en cuatro llamadas en paralelo** (programas y rutinas, visibles y ocultos). El backend las responde con un número fijo de consultas, sin una por programa o por rutina.

## Hablar con la API

Todas las peticiones pasan por `src/api/cliente.ts`. Las pantallas no construyen URLs ni tratan errores HTTP por su cuenta: piden `api.ejercicios()` y reciben datos ya tipados. El cliente cubre ya todos los endpoints del backend, agrupados por recurso, aunque todavía no los usen todas las pantallas.

Cuando la API responde con un error, el cliente lanza un `ErrorDeApi` con un mensaje legible (el motivo que da el backend, no "la API respondió 409"), el código de estado y el `detail` tal cual llegó. La pantalla suele necesitar solo el mensaje, pero algunos 409 traen datos con los que reaccionar: al empezar una sesión con otra ya en curso, el backend dice cuál es, y la pantalla puede ofrecer continuarla.

Esa separación es la que permitirá cambiar cosas en un solo archivo más adelante — añadir el token cuando exista JWT, reintentar peticiones fallidas o meter una caché — sin recorrer todas las pantallas.

Los tipos de `src/api/tipos.ts` reflejan los esquemas de `backend/app/schemas.py`. **No se generan solos**: si cambia un endpoint, hay que actualizarlos a mano o el editor mentirá.

## Variables de entorno

| Variable | Para qué | Valor por defecto |
|---|---|---|
| `VITE_API_URL` | Dónde está la API | `http://localhost:8000` |

Solo hace falta tocarla para abrir la web desde otro dispositivo de la red de casa, donde `localhost` ya no es el PC que sirve la API. Se define en un archivo `.env` dentro de `web/` (copia de `.env.example`), que no se sube a git.
