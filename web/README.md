# Web 💻

Frontend web del proyecto, construido con **React 19** y **TypeScript**, sobre **Vite**. Consume la API REST del [backend](../backend/README.md); nunca habla con la base de datos directamente.

**Índice:** [Estado actual](#estado-actual) · [Cómo ejecutarlo](#cómo-ejecutarlo) ·
[Estructura](#estructura) · [La sesión en curso](#la-sesión-en-curso) · [Programas](#programas-y-rutinas) ·
[Hablar con la API](#hablar-con-la-api) · [Variables de entorno](#variables-de-entorno)

## Estado actual

Completa: tiene todas las pantallas del diseño de la app.

La primera versión se escribió para validar que el circuito funciona —React pide, la API responde, la pantalla pinta— y sirvió también para encontrar las asperezas de la API consumiéndola de verdad. Con eso aprendido, la app se [diseñó entera](../README.md#diseño-de-la-app) antes de seguir, y la web se rehízo pantalla a pantalla siguiendo ese diseño. Están la sesión en curso, la pantalla de entrada (*Hoy*), el historial (el calendario y cada día), la progresión de un ejercicio, la planificación de los próximos días, el resumen de volumen y constancia, los programas con sus rutinas, la biblioteca de ejercicios y los ajustes: todas las pantallas del diseño.

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
- [x] La semana de un programa y crear un programa nuevo
- [x] Una rutina y cada uno de sus ejercicios, también para crear una rutina nueva
- [x] La biblioteca de ejercicios: buscador y filtros, la ficha de cada uno (progresión, notas y dónde se usa) y el formulario para crear o editar uno
- [x] Ajustes: kilos o libras, el paso de los botones del peso, cómo se calcula el 1RM, tema claro u oscuro, el color de cada día, y exportar, importar o borrar todos los datos

## Aspecto

- **Tres tipos de botón, y se distinguen de un vistazo**: verde relleno para la acción principal de la pantalla (una sola), con recuadro y fondo para las normales, y con recuadro sin fondo para las secundarias (en gris: *Duplicar rutina*, *Ocultar programa*) y las peligrosas (en rojo: *Borrar*, *Cancelar sesión*). Solo van como texto los atajos que se entienden por su forma: el desplegable de los ocultos, con su flecha, y *+ Añadir serie*. Un botón de solo texto se leía como un rótulo.
- **Los selectores de opciones son todos una barra**, con la opción elegida resaltada dentro, en dos tamaños: los filtros de arriba de una pantalla (el rango de la gráfica, el origen de la biblioteca, semanas o meses del resumen) más grandes, y los de dentro de una tarjeta (la medida de la gráfica, los de Ajustes) algo más pequeños, para que no compitan.

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
    │   ├── Interruptor.tsx  # la tarjeta con un interruptor: «Programa activo» y «Activarlo al crearlo»
    │   ├── MarcaDelDia.tsx  # la marca de un día (hecho, movido, sin hacer…), para la semana y el calendario
    │   ├── NotaDeSesion.tsx # la nota de una sesión, en la sesión y en el día del historial
    │   ├── Ocultos.tsx   # el «Ver N ocultos» plegable del pie de una lista
    │   └── Pestanas.tsx  # la barra de las cuatro secciones
    ├── utiles/           # los ajustes, fechas y pesos en formato español (en kg o lb), el color de cada día, la flecha de volver y los textos que pasan a párrafo
    └── paginas/          # una pantalla por archivo, o por carpeta si tiene piezas propias
        ├── ajustes/      # los ajustes del dispositivo y tus datos (exportar, importar, borrar)
        ├── ejercicios/   # la pestaña de Ejercicios
        │   ├── Biblioteca.tsx           # la lista, con buscador, filtros y los ocultos plegados
        │   ├── Ficha.tsx                # un ejercicio: progresión, notas, dónde se usa, ocultar y borrar
        │   ├── Formulario.tsx           # crear o editar un ejercicio
        │   ├── HojaDeGrupos.tsx         # la hoja del filtro por grupo muscular
        │   └── ejercicios.css
        ├── historial/    # la pestaña de Historial
        │   ├── Calendario.tsx           # el mes, sus cifras y la leyenda
        │   ├── MesConMarcas.tsx         # la cuadrícula del mes, que comparten el calendario y la hoja de la fecha
        │   ├── HojaRegistrar.tsx        # apuntar un día pasado
        │   ├── Dia.tsx                  # ver un día y corregirlo
        │   ├── HojaDeFecha.tsx          # cambiar la fecha de una sesión, con el mes y sus marcas
        │   ├── Planificar.tsx           # qué toca cada día de hoy en adelante, por semanas
        │   ├── Resumen.tsx              # el volumen por semana o por mes, su desglose y la constancia
        │   └── BloqueDelDia.tsx         # un hueco del día, con sus series y + Añadir serie
        ├── hoy/          # la pantalla de entrada
        │   └── Hoy.tsx                  # la semana, la tarjeta de hoy, lo que recuperar y las listas
        ├── programas/    # la pestaña de Programas
        │   ├── Programas.tsx            # los programas y la biblioteca de rutinas, con sus ocultos
        │   ├── Semana.tsx               # la semana de un programa: qué rutina toca cada día
        │   ├── ProgramaNuevo.tsx        # crear un programa
        │   ├── Rutina.tsx               # una rutina: sus ejercicios, su orden, ocultarla y borrarla
        │   ├── RutinaNueva.tsx          # crear una rutina con sus ejercicios, sobre un borrador
        │   ├── Ejercicio.tsx            # un ejercicio de una rutina: principal, alternativas, series y reps
        │   ├── DiasEditables.tsx        # los siete días de un programa que se está escribiendo
        │   ├── HojaDeRutinas.tsx        # la hoja de elegir la rutina de un día
        │   ├── HojaDeEjercicios.tsx     # la hoja de elegir un ejercicio, con buscador y filtro por grupo
        │   ├── DesplegableDeGrupo.tsx   # el filtro por grupo de esa hoja, con su lista debajo
        │   ├── ListaDeEjercicios.tsx    # los ejercicios de una rutina, con el asa para reordenarlos
        │   ├── borradores.ts            # lo que sigue ahí al ir a otra pantalla y volver
        │   ├── textos.ts                # frases comunes: «4 × 6-10», «3 días»…
        │   └── programas.css, semana.css, rutina.css, ejercicio.css
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

Es la pantalla que se usa en el gimnasio (`/sesion/{id}`). Cada ejercicio de la rutina es un bloque, y solo uno va desplegado: el que se está haciendo. Plegados, los demás dicen cuántas series llevan de las que pide el ejercicio. Dentro del desplegado está la **última vez** que se hizo ese ejercicio en esa rutina, en fichas (una por serie, con su peso); las series de hoy, cada una con su lápiz para corregirla y su ✕ para borrarla; y el formulario de la siguiente, con peso y repeticiones en − / + para poder usarlo con una mano.

Decisiones que se notan al usarla:

- **Cada serie se guarda en cuanto se pulsa *Guardar***, en vez de acumularlas para enviarlas al final. Una sesión dura más de una hora, y cerrar la pestaña sin querer no puede llevarse el entrenamiento.
- **La sesión vive en la URL**, no en la memoria de la página: se puede salir a otras pantallas, recargar o volver más tarde, y todo sigue ahí hasta pulsar *Terminar sesión* o *Cancelar sesión*. Terminar una sesión sin ninguna serie la cancela, en vez de dejar un día vacío en el historial, y el diálogo lo avisa. Las dos piden confirmación, y cancelar la borra con sus series, como si no se hubiera empezado. La flecha de volver lleva a la pantalla de la que se venía, y en una sesión de un día pasado, a su día en el historial.
- **El formulario arranca con la serie anterior** de ese ejercicio (peso, repeticiones y variante), porque las series de un ejercicio casi siempre repiten: lo normal es cambiar solo las repeticiones. En la primera serie arranca con la última vez. No se vacía al guardar, por lo mismo.
- **El número de la siguiente serie es el más alto + 1**, no cuántas hay: borrando una del medio, contarlas repetiría un número.
- **La alternativa se elige con la flecha** que hay junto al nombre del ejercicio, en un botón propio para que no pase desapercibida. El desplegable enseña el principal y las alternativas, cada uno con su última vez. Al elegir una, la última vez, el peso de partida y las series nuevas pasan a ser de ese ejercicio. Si el principal está oculto, el ejercicio empieza ya con una alternativa.
- **Editar una serie usa el mismo formulario**: el lápiz carga sus datos, con *Cancelar* y *Guardar cambios* en la misma línea. No hay un modo de edición aparte.
- **Se edita una cosa cada vez**: con una serie o la nota abiertas, el resto (los otros lápices y ✕, los demás ejercicios, *Terminar* y *Cancelar sesión*) se queda desactivado hasta guardar o cancelar. Por eso qué está abierto lo lleva la pantalla y no cada bloque.
- **La nota se escribe en cualquier momento**, no solo al terminar: al final de la sesión sale *Añadir nota*, y una vez escrita se ve con su lápiz y su ✕, como una serie. Es el mismo bloque que en el día del historial (`componentes/NotaDeSesion.tsx`).
- **La variante no ocupa sitio en las fichas**: las que la tienen llevan un punto, y al tocarlas (o con el ratón encima) sale un globo por encima, donde el dedo no lo tapa. Se cierra tocando otra vez o en cualquier otro sitio. Se descartó mantener pulsado: es un gesto que nadie descubre solo.

Si la sesión recupera o adelanta otro día, la cabecera lo dice: *Recuperado del lunes 28 de septiembre* (o *Adelantado del jueves 1 de octubre*), sin repetir el nombre de la rutina, que ya está en el título.

## Hoy

La pantalla de entrada (`/`). Arriba, la semana con las mismas marcas que tendrá el calendario; debajo, una tarjeta con lo de hoy, lo que queda **por recuperar** con el plazo de cada día, la **última sesión hecha** y una lista con qué más se puede entrenar hoy.

- **Todo sale de una sola llamada** (`GET /plan/hoy`). Qué toca, qué se puede recuperar, adelantar o intercambiar, y si hoy ya se entrenó, lo decide el backend: así la web y el móvil dirán siempre lo mismo, y la pantalla solo pinta.
- **Al pulsar un botón, la web dice qué día del plan va a contar la sesión**: *Empezar* cuenta hoy, *Recuperar* el día que se faltó y *Adelantar* el día ofrecido. *Intercambiar* cambia antes el plan de los dos días y después empieza la de hoy.
- **Todas las listas de la pantalla dicen igual qué rutina y qué día** (*Pull · miércoles 9*, *Leg · viernes 18*), con el día siempre escrito y el detalle debajo: lo que queda sin terminar, lo que está por recuperar, la última sesión y lo que queda de la semana.
- **Las sesiones de un día pasado que se dejaron sin terminar se avisan** en una sección *Sin terminar* bajo la tarjeta, con sus series y un enlace para terminarlas o cancelarlas. Cuentan como hechas desde la primera serie, así que sin el aviso se podrían olvidar a medias. Una sesión que se abrió para apuntar un día pasado y se quedó sin ninguna serie también sale, con la etiqueta *vacía*, para completarla o cancelarla; no cuenta como hecha y nada la borra por su cuenta.
- **Todo lo que empieza algo pregunta antes**, con un botón que dice lo que hace (*Empezar*, *Recuperar*, *Adelantar*, *Intercambiar*). Recuperar en un día de entrenamiento avisa de que lo de hoy quedará pendiente, y hasta cuándo se podrá recuperar.
- **Las marcas de la semana juntan lo que se hizo y lo que tocaba**: el punto lleno es lo que se hizo ese día, del color del día que contó; el aro, lo que tocaba y sigue sin hacer; la flecha, que se hizo otro día (→ después, ← antes). Cada día de la semana tiene su color, no cada rutina, para que un día movido diga de dónde viene.
- **La tarjeta cambia con el día**: empezar lo que toca, continuar la sesión a medias, ya entrenado, descanso (con qué toca después), hecho por adelantado, sin programa (con todas las rutinas para entrenar igualmente) o, la primera vez, una bienvenida que lleva a Programas.

## Historial

El calendario (`/historial`) enseña el mes con las mismas marcas que la semana de *Hoy*, y debajo tres cifras: cuántos días planificados se entrenaron (también los movidos), cuántos se movieron y cuántos se quedaron sin hacer. La leyenda va plegada, porque se consulta poco. El mes va en la URL (`?mes=2026-09`), para que volver de un día no devuelva al mes actual.

**Tocar un día enseña siempre lo que se hizo ese día**, nunca lo del día en que se hizo su rutina: si hubo sesión, abre el día; si es hoy, lleva a *Hoy*; y si es un día pasado sin sesión, abre una hoja para apuntar lo que se hizo. Esa hoja ofrece lo que tocaba y lo que seguía por recuperar aquel día (adelantar, solo desde *Hoy*), y además cualquier otra rutina, que se apunta sin contar para ningún día del programa (solo esas lo avisan, también al confirmar; las que cuentan ya lo dicen en su nombre). Sirve para pasar a la app la libreta de meses anteriores, o para el día que se entrenó y se olvidó apuntar.

Lo que se hizo sin contar para ningún día lleva el color del día de su rutina en el programa activo, para que se reconozca; solo sale en gris si la rutina no está en el programa.

### Un día

La única pantalla de ver un día (`/historial/2026-09-29`), a la que se llega desde el calendario, desde la última sesión de *Hoy* y al terminar una sesión. Arriba, tres cifras: las series frente a las que pedía la rutina, el volumen (peso por repeticiones), con cuánto cambió frente a la sesión anterior de la misma rutina, y cuántos ejercicios mejoraron. Debajo, un bloque por ejercicio de la rutina con el que se hizo, su objetivo (*3 × 8-12*, a la derecha del nombre), sus series y **la última vez que se hizo ese ejercicio en esa rutina**, en fichas, mirando siempre hacia atrás desde ese día.

- **Las insignias de cada ejercicio comparan con esa última vez**, una por cosa que cambió: el peso más alto (*+2,5 kg*), el total de repeticiones (*−7 reps*) y el **1RM estimado** (*↑ 1RM 36,1 kg (+1,3)*), que es el que decide si mejoró. Por defecto es la media de lo que cada serie permitiría levantar una sola vez (fórmula de Epley, `peso × (1 + reps / 30)`), así que subir peso y bajar repeticiones se compensa en una sola medida, y hacer una serie menos no cuenta como empeorar; en Ajustes se puede elegir la mejor serie. Si es la primera vez, *nuevo*.
- **El volumen es un dato de cuánto trabajo se hizo, no de fuerza**: puede bajar aunque todo mejore, por ejemplo si se usó una alternativa más ligera. La leyenda del final dice con qué se compara cada cosa.
- **Mientras una sesión de un día pasado no está terminada**, el día ofrece *Seguir apuntando*, que vuelve a la sesión.
- **Si se hizo con una alternativa, lo dice**: *En lugar de Fondos en paralelas*. Y si la sesión recuperaba o adelantaba otro día, la cabecera lo recuerda (*Recuperado del lunes 28 de septiembre*).
- **Con *Editar*** la fecha pasa a ser un campo que abre una hoja con el mes del calendario y sus marcas (`HojaDeFecha`, que comparte la cuadrícula con el calendario en `MesConMarcas`), no el selector del sistema, que cada navegador dibuja a su manera; cada serie gana su lápiz (que abre el mismo formulario de la sesión) y su ✕, la nota también (o *Añadir nota* si no tiene), y al pie sale *Borrar este día*. La flecha de volver pasa a ser *Cancelar* y *Editar*, *Guardar*. **Todo va a un borrador** (fecha, nota y series; las nuevas, con id negativo) y *Guardar* lo envía de golpe; *Cancelar* lo descarta. Por eso los formularios de dentro dicen *Añadir* o *Aplicar*. Se envía primero la fecha y la nota, que son lo que puede no valer: si falla, no se toca nada más y el modo editar sigue abierto; después, las series borradas, cambiadas y nuevas. Igual que en la sesión, se edita una cosa cada vez: con un formulario abierto, el resto se desactiva, incluidos *Cancelar* y *Guardar*.
- **Las series que se olvidó apuntar se añaden ahí mismo**: con *Editar*, cada ejercicio lleva *+ Añadir serie*, que abre el formulario de la sesión con la siguiente serie. Los ejercicios que ese día se quedaron sin series también salen al editar, con borde discontinuo, y si tienen alternativas llevan la misma flecha que en la sesión para elegir con cuál.
- **La fecha solo se mueve dentro del plazo del día que cuenta** la sesión, y nunca a un día que ya tiene otra. Si no se puede, el campo explica por qué con palabras de la app, no con las de la API.
- **Al terminar una sesión** se llega a su día. La flecha de volver, aquí y en el resto de pantallas, lleva a la pantalla de la que se vino (de *Hoy* a un día, vuelve a *Hoy*), y tras terminar, cancelar o borrar no lleva a algo que ya no existe. Si la pantalla se abrió directamente (un enlace o una recarga), lleva a la pantalla de la que cuelga; para saberlo mira la posición en el historial del navegador, que no cambia cuando la pantalla reescribe su URL al elegir una opción.

### Planificar

Los días de hoy en adelante (`/historial/planificar`), por semanas y sin límite: abre con cuatro y el botón del final, *Ver 4 semanas más*, pide otras cuatro (con un botón y no al bajar, para que la lista tenga final), y el backend admite hasta 400 días por llamada. Tocar un día abre una hoja con *Rutinas del programa* (en el orden de la semana), *Descanso* y, debajo, *Otras rutinas* (las que no están en el programa, por orden alfabético; sin programa activo salen todas así); elegir una **sustituye** lo que tocaba (no lo intercambia con otro día) y se guarda en el momento. Los días cambiados llevan su marca, y *Restablecer este día* o *la semana* los devuelven al programa; la semana pregunta antes.

- **Lo pendiente de recuperar no sale aquí**: la pantalla solo enseña hoy y lo que viene, y recuperar se hace desde *Hoy*.
- **Un día ya hecho lleva un ✓ verde, y uno cambiado, un lápiz**, sin texto y con su nombre para los lectores de pantalla: con *Hecho* y *cambiado* escritos no quedaba sitio para el nombre de la rutina. Una leyenda bajo la ayuda de arriba explica los dos. Un nombre largo se corta con «…». Si se le quita su rutina y no queda otro día de la semana con ella, el backend lo rechaza con un 409 y la pantalla lo explica con las palabras del boceto (*No puedes quitar este Pull…*) en un aviso de un solo botón. Es el mismo `Dialogo` de las confirmaciones, con una variante cuyo tipo no admite mezclar el botón único con el de confirmar.
- **Una rutina oculta sigue en su día, en gris**, porque ocultar no la quita del programa, pero ese día cuenta como descanso. Elegir *Descanso* ahí sí cambia algo (lo deja así aunque la rutina se vuelva a mostrar), y elegir otra rutina la sustituye solo en esa fecha.
- Cada recarga tras un cambio vuelve a leer lo ya cargado, porque mover un día puede mover también lo que se hizo por adelantado.

### Resumen

La progresión general, no por ejercicio (`/historial/resumen?mes=2026-09`), a la que se llega con *Ver resumen* desde el calendario. Arriba, el mes con flechas para ir atrás o adelante, como en el calendario (la de adelante se apaga en el mes de hoy), y *Por semana* o *Por mes*; debajo, una gráfica de barras con el volumen (peso por repeticiones) de las últimas ocho semanas o meses terminados y, si el periodo de hoy cae en ella, una barra más, rayada, con lo que va de él.

- **Tocar una barra la elige** (toda la columna es un botón, barra y fecha): arriba salen su periodo, su volumen y cuánto cambió, y los dos recuadros de abajo pasan a ser de esa barra: el **volumen por rutina** y las **series por grupo muscular**. Así la gráfica enseña la evolución y los recuadros el desglose de lo que se toca, sin más controles. Al entrar, o al cambiar de semanas a meses, queda elegida la última barra terminada.
- **El cambio se compara con el último periodo en que se entrenó**, aunque quede fuera de la gráfica: tras una semana de vacaciones, la siguiente dice *+5,7 % sobre la semana del 11 de agosto* en lugar de quedarse sin porcentaje. Si es la semana justo anterior, dice *sobre la semana anterior*.
- **El color se usa solo cuando dice algo**: cada rutina lleva el color de su día en el programa (el mismo del calendario), y las series por grupo van en gris, porque un color por grupo serían siete u ocho que no significan nada y se confundirían con los de los días. El verde queda para el volumen y la constancia.
- **La constancia del año** va en su propio recuadro, fija: por mes, en gris lo planificado (también lo que aún no ha llegado) y en verde lo entrenado, que lo va llenando. Lo recuperado y lo adelantado cuentan en el mes del día que tocaba.
- **Todo llega en una sola llamada** (`GET /resumen`), con el desglose de cada barra ya calculado: elegir otra barra o cambiar de vista no espera a la red. El mes, la vista y la barra elegida van en la URL, para que recargar no los pierda.

## Progresión

La gráfica de un ejercicio (`/progresion/86`), a la que se llega con la flecha de cada ejercicio en un día del historial. Un punto por sesión, repartidos según la fecha (dos sesiones muy separadas se ven separadas), con tres medidas sobre los mismos puntos y cuatro rangos (1 mes, 3, 6 y todo). Abre en el rango más corto que cubre todo el historial del ejercicio (`rangoPorDefecto`). *Todo* va a la escala de 6 meses y, si hay más, la gráfica se desliza de lado con los valores fijos a la izquierda, abriendo en lo más reciente. El rango y la medida van en la URL, así que recargar no los pierde. Arriba, el último valor y cuánto ha cambiado desde la primera sesión del rango; debajo, las sesiones con sus series, cada una enlazada a su día.

- **Peso**: el más alto de cada sesión. **Volumen**: peso por repeticiones, sumado. **1RM estimado**: la media de lo que cada serie permitiría levantar una sola vez (fórmula de Epley, `peso × (1 + reps / 30)`), o la mejor serie si se elige en Ajustes.
- **El 1RM es el mismo que decide si un ejercicio mejoró en el día del historial**, y sale de una única función (`unoRM`), así que un mismo día da el mismo número en las dos pantallas. Por defecto se hace la media de las series y no se toma la mejor porque las rutinas son de doble progresión (*3 × 8-12*): se sube repeticiones hasta llegar a 12 en todas las series y entonces se sube peso, y en esas semanas el progreso está en las series de después, que la mejor serie no ve. Para quien entrena fuerza máxima, Ajustes deja elegir la mejor serie, y las dos pantallas cambian a la vez.
- **La gráfica es SVG hecho a mano**, sin librería: la cuadrícula busca valores redondos (pasos de 1, 2, 2,5 o 5), y se dibuja al ancho real de la tarjeta, medido con `ResizeObserver`, para que las letras no cambien de tamaño entre el móvil y el escritorio. Cada punto lleva una zona táctil mayor que él y se maneja también con el teclado; tocar uno cambia el globo con su día, su rutina y su valor.
- Si el ejercicio no se ha hecho nunca, o no en el rango elegido, la pantalla lo dice en vez de enseñar una gráfica vacía.

## Programas y rutinas

La pestaña de Programas (`/programas`) tiene dos listas: los **programas**, con el activo primero y marcado, y la **biblioteca de rutinas**. Cada programa dice cuándo se usó (*Desde el 6 de julio*, *Del 2 de marzo al 28 de junio* o *Sin usar todavía*) y cada rutina cuántos ejercicios tiene y en cuántos programas está, o *sin programa*. Sin esa segunda lista, una rutina que no estuviera en ningún programa sería inalcanzable.

- **Los ocultos van plegados al pie de cada lista** (*Ver 2 rutinas ocultas*), y cuáles están desplegadas queda en la URL (`?ver=rutinas`), para que volver desde uno oculto no los cierre. Un programa oculto no recuerda las fechas exactas, solo desde cuándo no se usa.
- **Solo cuenta lo visible**: un programa con una rutina oculta dice un día menos (ese día queda en descanso) y una rutina con un hueco oculto, un ejercicio menos.
- **Sin rutinas ni programas** la pantalla lo dice y *Nueva rutina* pasa a ser la acción principal, en verde: es el primer paso.
- **Todo llega en cuatro llamadas en paralelo** (programas y rutinas, visibles y ocultos). El backend las responde con un número fijo de consultas, sin una por programa o por rutina.

### La semana de un programa

Tocar un programa abre su semana (`/programas/7`): qué rutina toca cada día, o descanso. Arriba, el interruptor **Programa activo**, que es lo único que se cambia sin entrar en *Editar* (no toca el programa, solo cuál está en uso): pregunta antes y guarda al momento. Con *Editar* el interruptor desaparece y todo va a un **borrador**: el nombre y los días se envían de golpe con *Guardar*, y *Cancelar* los descarta. La › de un día abre una hoja con las rutinas, la ✕ lo deja en descanso, y al pie están *Ocultar programa* y *Borrar programa*.

- **Los textos están escritos para quien no conoce la app**: dicen qué pasa (*Entrenar dejará de decirte qué rutina toca*) y no cómo se llama cada pantalla por dentro. Para mandar a otro sitio nombran lo que se ve, como la pestaña *Historial*.
- **Guardar no es atómico**, porque no hay un endpoint para todo a la vez: se envía primero el nombre, que es lo único que puede no valer, y después cada día cambiado; si algo falla a medias, lo dice y vuelve a leer el programa para enseñar lo que quedó guardado.
- **Una rutina oculta sigue en su día, en gris**, y ese día cuenta como descanso. Un programa oculto es de solo lectura, con *Mostrar* y *Borrar*, y mostrarlo no lo reactiva.
- **La hoja de elegir rutina ofrece *+ Nueva rutina*.** En un programa que ya existe, el borrador de la edición espera mientras se crea la rutina, y al guardarla se vuelve a la semana, todavía editando, con la rutina puesta en ese día.
- **Crear un programa** (`/programas/nuevo`) es la misma lista de días, sobre un borrador que sobrevive a ir a crear una rutina y volver. *Activarlo al crearlo* hace que *Crear* pregunte antes (*¿Crear y activar…?*), como activar un programa desde su semana, y empieza apagado: activarlo es algo que se elige a propósito.

### Una rutina y sus ejercicios

La rutina (`/programas/rutinas/10`) enseña sus ejercicios en orden, numerados por su posición entre los visibles, cada uno con su objetivo (*3 × 8-12*) y cuántas alternativas tiene (*2 alternativas*; los nombres, con varias, ocupaban tres líneas y se ven al abrirlo). *Editar* sirve para el nombre, el orden (arrastrando el asa, o con las flechas del teclado), *Ocultar rutina* y *Borrar rutina*; añadir, ocultar o borrar un ejercicio se hace dentro de él, y *Añadir ejercicio* y *Duplicar rutina* no salen al editar porque llevan a otra pantalla y lo cambiado se perdería.

- **El formulario de un ejercicio** (`/programas/rutinas/10/ejercicios/19`) elige el principal y las alternativas en una hoja con buscador (sin tildes ni mayúsculas) y filtro por grupo muscular, y las series y repeticiones con − / +. Uno nuevo parte de 3 × 8-12 como referencia. El grupo del principal va a la derecha de su etiqueta (*Ejercicio principal · Pecho*), para que no se confunda con el nombre de un campo. El filtro de la hoja empieza en *Todos los grupos musculares*, y su lista llega hasta el pie de la hoja: al abrirla se mide el sitio que queda debajo del campo.
- **Una rutina nueva trabaja sobre un borrador.** El *Guardar* del formulario de cada ejercicio solo cambia la lista de la pantalla; la rutina no existe hasta el *Guardar* de esa pantalla, que la crea con todos sus ejercicios en una sola petición. Si algo falla no queda ninguna rutina a medias, y salir sin guardar no deja nada. El borrador vive en memoria y en `sessionStorage`, así que sobrevive a recargar. Quien abre la pantalla para empezar una rutina lo marca en el estado de la navegación, y esa marca se quita enseguida: volver desde un ejercicio conserva lo escrito y entrar de nuevo empieza otra.
- **Reordenar arrastrando** se hace a mano con eventos de puntero sobre el asa (sin librería): al pasar el dedo por la mitad de la tarjeta vecina se intercambian, y la arrastrada sigue al dedo. El asa va fuera del enlace de la tarjeta, para que arrastrar no abra el ejercicio.
- **Lo oculto no se edita**: un ejercicio oculto, o cualquiera de una rutina oculta, se ve en solo lectura con *Mostrar*. Borrar cuenta lo que se pierde con las cifras que da la API (series, sesiones que se vaciarían, días de programa) y, si no hay nada que contar, la pregunta basta.

## Ejercicios

La biblioteca (`/ejercicios`) junta los 59 ejercicios predefinidos y los propios, con un buscador (sin tildes ni mayúsculas), un filtro de origen (*Todos · Predefinidos · Míos*) y otro por grupo muscular, que solo ofrece los grupos con algo que enseñar. Cada ejercicio dice su grupo y su origen. El grupo se elige con un campo que abre una hoja con los 17 grupos en dos columnas: en una fila de píldoras no se veían todos, y envueltos ocupaban media pantalla. Lo que se busca y filtra va en la URL, así que volver de una ficha deja la lista como estaba.

- **La ficha** (`/ejercicios/12`) enseña la descripción, la progresión (el peso más alto de la última sesión y cuándo fue, que lleva a la gráfica), las notas y las rutinas donde se usa: *Push · ejercicio 1*, si es el principal o una alternativa y en qué programas está la rutina, con el punto del color de su día. Un bloque sin contenido no sale.
- **Las notas se escriben en la propia ficha**, cada una con su lápiz y su ✕ y su propio *Guardar*, porque la ficha no tiene un modo editar general. Se puede anotar también un ejercicio predefinido o uno oculto: las notas son tuyas. Su fecha es la del día en que se escribieron en tu hora, no en la del servidor, que la guarda en UTC: si no, una nota de pasada la medianoche saldría del día anterior.
- **Lo oculto va plegado**, como en Programas: los ejercicios ocultos al pie de la biblioteca, y en la ficha, las rutinas donde el ejercicio está oculto o que lo están ellas. Un ejercicio oculto se ve en solo lectura, con *Mostrar*. Los predefinidos no se pueden editar, ocultar ni borrar, y la ficha lo dice.
- **Borrar cuenta lo que se pierde** con las cifras que da la API (*Se borrarán también sus series de 11 sesiones y tus 2 notas, y se quitará de las rutinas donde se usa, con sus alternativas donde es el principal*) y ofrece ocultarlo en su lugar.
- **El formulario** (`/ejercicios/nuevo`, `/ejercicios/12/editar`) es el mismo para crear y para editar: nombre, grupo y una descripción opcional. Si falta algo lo dice bajo el campo, antes de llamar a la API.

## Ajustes

Desde el engranaje de *Hoy* (`/ajustes`). Arriba, los ajustes de la app: **unidad de peso** (kg o lb), cuánto suben o bajan los **botones − y + del peso**, con qué **series y reps** empieza un ejercicio nuevo de una rutina, cómo se calcula el **1RM** (media de las series o mejor serie), el **tema** (oscuro, claro o automático) y el **color de cada día**. Debajo, tus datos: **Exportar datos** descarga un archivo con todo lo apuntado, después de confirmar con lo que se va a guardar; **Importar datos** carga uno y sustituye todo lo que hay; **Borrar todos tus datos** deja la app vacía para empezar de cero. La web y la app móvil no se conectan entre sí: los datos pasan de una a otra en ese archivo.

- **Los ajustes son de cada dispositivo**: se guardan en el navegador (`utiles/ajustes.ts`), se aplican al momento, sin botón de guardar, y no van en el archivo de exportación (el diálogo de exportar lo avisa). Si el navegador no deja guardar, valen los de por defecto.
- **La base de datos guarda siempre kilos**: en libras se convierte al enseñar y al apuntar, en un solo sitio (`utiles/numeros.ts`), y se redondea a una décima para que 135 lb no vuelva como 134,99. Lo mismo el volumen y el 1RM.
- **El tema claro cambia solo las variables de color** de `index.css` (`<html data-tema="claro">`): casi todo el CSS ya las usaba. Con *Automático* sigue al sistema, también si cambia con la app abierta.
- **Los colores de los días son 24**, ordenados por tono: los de toda la vida (los del sistema de iOS) y variaciones de ellos, y por defecto el arcoíris de lunes a domingo. **Cada uno tiene dos versiones**, una por tema: los oscuros, como el granate o el azul marino, se aclaran en el tema oscuro para no perderse en el fondo. En la hoja de un día, un color de la paleta que ya tiene otro sale apagado, para que no haya dos iguales. No hay color libre: con la paleta basta, y así cada color se ve bien en los dos temas.

- **Antes de importar, la API comprueba el archivo sin escribir nada** y la confirmación cuenta qué hay ahora y qué trae (*Ahora tienes 3 rutinas, 1 programa y 12 sesiones… El archivo, exportado el 9 de octubre, tiene…*), para no cargar una copia vieja por error.
- Si el archivo no vale, se enseña el motivo y la lista de lo que no cuadra, y no cambia nada.
- **Borrar todos tus datos** pregunta en rojo contando lo que se pierde (los ejercicios de la app y los ajustes se quedan), y deja borrar aunque no haya nada que contar: puede quedar algo, como un descanso planificado.
- Tras importar o borrar se tiran los borradores guardados en el navegador: sus ids eran de los datos de antes.

## Hablar con la API

Todas las peticiones pasan por `src/api/cliente.ts`. Las pantallas no construyen URLs ni tratan errores HTTP por su cuenta: piden `api.ejercicios()` y reciben datos ya tipados. El cliente cubre todos los endpoints del backend, agrupados por recurso. Los errores llegan a la pantalla como una frase para quien usa la app: el motivo que da la API, o, si no se puede conectar con el PC o el servidor falla, qué comprobar.

Cuando la API responde con un error, el cliente lanza un `ErrorDeApi` con un mensaje legible (el motivo que da el backend, no "la API respondió 409"), el código de estado y el `detail` tal cual llegó. La pantalla suele necesitar solo el mensaje, pero algunos 409 traen datos con los que reaccionar: al empezar una sesión con otra ya en curso, el backend dice cuál es, y la pantalla puede ofrecer continuarla.

Esa separación es la que permitirá cambiar cosas en un solo archivo más adelante — añadir el token cuando exista JWT, reintentar peticiones fallidas o meter una caché — sin recorrer todas las pantallas.

Los tipos de `src/api/tipos.ts` reflejan los esquemas de `backend/app/schemas.py`. **No se generan solos**: si cambia un endpoint, hay que actualizarlos a mano o el editor mentirá.

## Variables de entorno

| Variable | Para qué | Valor por defecto |
|---|---|---|
| `VITE_API_URL` | Dónde está la API | `http://localhost:8000` |

Solo hace falta tocarla si la API no está en `localhost:8000`, por ejemplo con el backend en otro puerto. Se define en un archivo `.env` dentro de `web/` (copia de `.env.example`), que no se sube a git.
