# Guía de producto — Training Life

Qué hace la app, qué pantallas tiene y cómo se comporta cada una. Es la referencia para implementar tanto la web como la app móvil: **las dos tienen las mismas funciones y el mismo diseño**. Lo que cambia entre una y otra es el ancho de pantalla, no lo que se puede hacer.

Va acompañada de dos imágenes que conviene tener abiertas al leerla:

- **[Bocetos](bocetos-movil-training-life.png)**: las 17 pantallas en todos sus estados, cada una con una nota. Los códigos de esta guía (E1, H2, P4…) son los de los bocetos.
- **[Mapa de navegación](mapa-navegacion-training-life.png)**: qué se toca para ir de una pantalla a otra.

Los datos que aparecen en los bocetos son de ejemplo: enseñan cómo se ve cada función, no tienen por qué cuadrar entre una pantalla y otra.

**Índice:** [Para qué existe](#para-qué-existe) · [Lo que hace el usuario](#lo-que-hace-el-usuario) ·
[Vocabulario](#vocabulario) · [Principios](#principios) · [Pantallas](#pantallas) ·
[Entrenar](#entrenar) · [Historial](#historial) · [Programas y rutinas](#programas-y-rutinas) ·
[Ejercicios](#ejercicios) · [Ajustes](#ajustes) · [Ocultar y borrar](#ocultar-y-borrar) · [La primera vez](#la-primera-vez) ·
[Flujos](#flujos) · [Lo que necesita del backend](#lo-que-necesita-del-backend) ·
[Por decidir](#por-decidir)

## Para qué existe

Sustituir el bloc de notas donde se apuntan los entrenamientos. Eso marca el listón: si registrar una serie cuesta más que escribir "60x10" en una nota, la app ha fracasado, por muchas gráficas que tenga. Todo lo demás —programas, calendario, progresión— existe para que ese registro diario valga más que una nota suelta.

## Lo que hace el usuario

Ordenado por frecuencia. No se diseña igual lo que se hace cada día que lo que se hace una vez al mes, y la última columna dice **para qué situación hay que diseñar cada cosa**, no en qué dispositivo está disponible (está en todos).

| Cada cuánto | Qué | Contexto para el que se diseña |
|---|---|---|
| Cada día de gimnasio | Registrar la sesión, serie a serie | De pie, entre series, con una mano, sudado |
| Cada día de gimnasio | Ver qué hizo la última vez en este ejercicio, para decidir el peso | El mismo momento: tiene que estar a la vista, sin buscarlo |
| Cada semana | Mirar el calendario: qué días fue, cuáles faltó, qué toca después | Sentado, de un vistazo |
| Cada semana | Ver cómo va un ejercicio ("¿subo peso?") | Sentado, con calma |
| De vez en cuando | Mover un día concreto del plan, o apuntar una sesión que olvidó | Sentado |
| De vez en cuando | Repasar o corregir una sesión pasada | Sentado |
| Casi nunca | Montar o retocar programas y rutinas | En casa, con tiempo; puede ser "de formulario" |
| Casi nunca | Añadir ejercicios a la biblioteca, escribir notas sobre uno | En casa |

Las dos primeras filas son la app. Si la pantalla de entrenar es buena y el resto regular, la app se usa. Al revés, no.

## Vocabulario

Un nombre para cada cosa, el mismo en la interfaz, en el código y en esta guía:

| Término | Qué es | Ejemplo |
|---|---|---|
| **Programa** | Reparte rutinas en la semana: qué rutina toca cada día | "Push Pull Leg" |
| **Programa activo** | El programa en uso: el que dice qué toca hoy y contra el que se pinta el calendario. Solo uno, o ninguno | — |
| **Rutina** | Los ejercicios de un día; un "tipo de día" | "Push" |
| **Ejercicio de una rutina** | Un puesto dentro de la rutina: qué ejercicio, cuántas series y qué rango de reps. En el código y la API se llama *hueco*; la app nunca dice «hueco» | "1 · Press banca, 4 × 6-10" |
| **Alternativa** | Ejercicio que se puede hacer en lugar del principal, por si ese día no se puede. En el código y la API se llama *comodín* | "Press banca en máquina" |
| **Ejercicio** | Un movimiento de la biblioteca: predefinido (viene con la app) o propio. Se apunta de una de cuatro formas (peso y repeticiones, peso corporal, tiempo o cardio), que se elige al crearlo | "Press banca con barra" |
| **Sesión** | Un día real de entrenamiento, con fecha | "El Push del lunes 14" |
| **Serie** | Lo que se hizo, con las medidas del tipo de su ejercicio (peso y repeticiones, repeticiones con lastre o ayuda, tiempo, o tiempo y distancia), y su variante si la tiene | "60 kg × 10", "28 min 15 s · 5,2 km" |
| **Variante** | Matiz de ejecución que no merece un ejercicio aparte | "con pausa" |
| **Planificar** | Cambiar qué toca un día concreto sin tocar el programa | "El miércoles 23, Push en vez de Pull" |
| **Recuperar** | Hacer más tarde un entrenamiento que se quedó sin hacer. Cuenta como el de aquel día | "El Push del lunes, el martes" |
| **Adelantar** | Hacer antes el entrenamiento de un día que todavía no ha llegado. Cuenta como el de ese día | "El Pull del miércoles, el martes" |
| **Ocultar** | Quitar algo de la vista sin perder su historial. Lo contrario es **Mostrar** | — |

**Las rutinas son del usuario, no de un programa.** La misma rutina puede estar en varios programas y en varios días del mismo programa, y editarla la cambia en todos. Para que dos versiones diverjan, se duplica.

**Cada sesión cuenta para un día del plan**: el que tocaba o el que se recupera o adelanta, y un día solo lo cuenta una sesión. Lo decide el botón que se pulsa (*Empezar*, *Recuperar*, *Adelantar*), así que la app nunca tiene que adivinar qué pretendía cada entrenamiento. Las sesiones sin programa no cuentan para ninguno.

**Una sesión por día, como mucho**, sea del tipo que sea: hoy, un día pasado o uno movido. Si hoy ya se entrenó, no se ofrece nada más.

**Una sesión sin ninguna serie, cuando ya no está en curso, cuenta como cancelada**: no se hizo nada. No ocupa su día, y lo que iba a recuperar o adelantar vuelve a estar como estaba (si se abrió el Pull del miércoles el martes y no se apuntó nada, el miércoles sigue tocando Pull).

**"Activo" solo significa "programa en uso".** Lo que no está oculto es *visible*, y para sacar algo de ocultos el botón es *Mostrar*, nunca *Activar*: así un programa oculto no se confunde con uno que no está en uso.

## Principios

Concretos, para poder comprobar si una pantalla los cumple.

**Estructura**

1. **Lo de cada día, sin rodeos.** Abrir la app deja delante lo que toca hoy. Nunca hay que pasar por una lista para llegar a ello.
2. **Móvil primero.** Se diseña para 390 px de ancho y una mano. La versión de escritorio es la misma pantalla con más aire, y como mucho dos columnas donde tenga sentido. No hay funciones "solo de PC" ni "solo de móvil".
3. **Cuatro secciones**: Entrenar, Historial, Programas y Ejercicios. En el móvil, una barra de pestañas abajo (donde llega el pulgar); en el PC, un menú lateral.
4. **Lo que se puede deducir no se pregunta**: qué toca hoy, el número de la siguiente serie, si un día se movió o se faltó. La app lo calcula de lo que pasó.

**Interacción**

5. **Cada acción tiene su botón visible**, con un nombre que dice lo que hace, y no hay gestos ocultos. Para ver la variante de una ficha de "última vez" basta tocarla; el punto verde avisa de que tiene.
6. **Todo se guarda al confirmarlo, nunca al salir de una pantalla.** Cada serie se guarda al pulsar su botón; no hay "guardar sesión" ni botones de guardar globales. Salir de una pantalla no pierde nada ni guarda nada que no se haya confirmado.
7. **Todo lo que empieza, adelanta, recupera, intercambia, activa, desactiva, oculta, borra, exporta o sustituye algo pide confirmación antes**: siempre se puede pulsar sin querer. También la ✕ de una serie. No la piden las acciones que se corrigen con otro toque: guardar una serie o sus cambios, cambiar la rutina de un día, restablecer un día, o *Continuar* una sesión, que no empieza nada.
8. **Los diálogos llevan *Cancelar* frente al verbo** (*Empezar*, *Ocultar*, *Borrar*…), nunca *Sí / No*: el botón dice lo que hace sin releer la pregunta. En verde si se puede deshacer, en rojo si no. El texto cuenta qué se pierde y qué no, y solo si no lo dice ya la pregunta: *¿Borrar la nota?* no lleva texto, y *¿Borrar la serie 2?* solo enseña la serie. El título va centrado, y el texto también si cabe en una línea; si ocupa más, a la izquierda.
9. **Editar no abre otra pantalla, la cambia** (patrón *Editar / Guardar*): los campos pasan a ser editables, la flecha de volver pasa a ser *Cancelar* y *Editar*, *Guardar*. **Nada se guarda hasta pulsar *Guardar***, que lo guarda todo de golpe; *Cancelar* lo deshace todo. Por eso los formularios de dentro (una serie, la nota) no dicen *Guardar* sino *Añadir* o *Aplicar*: solo cambian lo que se guardará. Si algo no vale (la fecha), *Guardar* no guarda nada, el modo editar sigue abierto y el campo explica por qué. **Se edita una cosa cada vez**: con un formulario abierto, todo lo demás se queda en gris (incluidos *Cancelar* y *Guardar*) hasta aplicarlo o cancelarlo. Esos formularios llevan *Cancelar* (en rojo) y *Añadir* o *Aplicar* (en verde) en la misma línea. Fuera del modo editar (la sesión, las notas de un ejercicio), cada formulario se guarda con su propio *Guardar*.
10. **Los valores anteriores ya puestos.** El teclado solo sale para nombres, notas y variantes; para lo demás, lo normal es confirmar lo que ya está o ajustarlo con − / +.
11. **Las cuatro pantallas de la barra no llevan flecha de volver**, porque son el punto de partida; cada pestaña lleva siempre a su pantalla principal, también si ya se está dentro de ella (desde un ejercicio de una rutina, tocar *Programas* vuelve a la lista de un toque). **En las demás, la flecha de volver lleva a la pantalla de la que se viene**, no a una fija: si se abre un día desde *Hoy*, volver deja en *Hoy*. Tras terminar, cancelar o borrar algo no lleva a lo que acaba de desaparecer.
12. **Las fechas llevan el año solo si no es el actual**: «Jueves 1 de octubre» este año, «Jueves 1 de octubre de 2025» si no. Así no se confunden ejercicios o días de un año con otro, sin llenar la app de años.

**Aspecto**

11. **Tema oscuro**, con contraste alto: luz de gimnasio, pantalla con reflejos. Fondo `#14161a`, superficie `#1c1f26`, borde `#2c313b`, texto `#e8eaed` y `#9aa1ac`, acento verde `#4ade80`. También hay **tema claro**, y por defecto la app sigue al del móvil u ordenador (se elige en Ajustes).
12. **Jerarquía de botones**: verde relleno para la acción principal (una por pantalla); con recuadro y fondo para las normales; con recuadro y sin fondo para las secundarias (gris: *Duplicar rutina*, *Ocultar programa*) y las peligrosas (rojo: *Borrar rutina*, *Cancelar sesión*), porque solo el texto se leía como un rótulo. Los selectores de opciones son todos una barra con la elegida resaltada dentro: más grandes los filtros de arriba de una pantalla, algo más pequeños los de dentro de una tarjeta. Solo van como texto los atajos que se entienden por su forma: el desplegable *Ver 2 rutinas ocultas*, con su flecha, y *+ Añadir serie*, dentro de cada ejercicio. *Añadir nota* sí lleva recuadro: va suelto entre los botones del final. Al menos 44 px de alto. Única excepción: los *Recuperar* de *Por recuperar* van siempre en verde, también junto a *Empezar* en un día de entrenamiento.
13. **Si un bloque está vacío, no se enseña**: sin descripción no hay rótulo ni recuadro de descripción.
14. **El color es de los días, no de las rutinas.** Una rutina solo tiene color puesta en un día (en la semana de un programa, en Planificar, en el calendario), y es el de ese día: una rutina que va el martes y el jueves sale naranja el martes y verde el jueves. Donde la rutina se ve por su papel en el programa (las rutinas del programa en la hoja de Planificar, el volumen por rutina del resumen), lleva el color de su día en él: Pull, el del miércoles, aunque se vaya a poner otro día. Suelta en una lista que no tiene que ver con el programa, sin punto: un color ahí no diría nada.

**Textos**

14. **Cortos, y nombrando el control de verdad**: "Pulsa › para cambiar la rutina de un día", no "toca un día para…" cuando lo que se pulsa es un icono concreto.
15. **Frases cortas, una por línea y centradas**, para que nunca quede una palabra suelta colgando; si en una pantalla estrecha alguna no cabe, el texto entero pasa a párrafo alineado a la izquierda. **Frases largas, en un solo párrafo** alineado a la izquierda, en un bloque centrado y más estrecho que la pantalla.
16. **Las leyendas van al final**, debajo de los botones: se consultan, no se leen antes de actuar. Excepción: la de Planificar va arriba, porque su lista no tiene final.
17. **Los títulos de tarjeta van centrados**; los rótulos de sección que encabezan una lista, a la izquierda, como la lista. En los diálogos, todo a la izquierda.

## Pantallas

| | Pantalla | Qué es | Se llega desde |
|---|---|---|---|
| **E1** | Hoy | Qué toca hoy, la semana, lo que queda por recuperar, la última sesión y otras rutinas | Pestaña Entrenar |
| **E2** | Sesión en curso | Registrar serie a serie | E1, H1 (día pasado) |
| **H1** | Calendario | El mes: entrenado, faltado, movido y próximo | Pestaña Historial |
| **H2** | Un día | Ver y corregir una sesión | H1, E1, E2 al terminar |
| **H3** | Progresión | La gráfica de un ejercicio | H2, X2 |
| **H4** | Planificar | Cambiar qué toca cada día, de hoy en adelante | H1 |
| **H5** | Resumen | Volumen y constancia, no por ejercicio | H1 |
| **P1** | Programas y rutinas | Los programas y, aparte, la biblioteca de rutinas | Pestaña Programas |
| **P2** | Semana del programa | Qué rutina toca cada día | P1 |
| **P3** | Rutina | Los ejercicios de una rutina; también la rutina nueva | P2, P1, P5, X2 |
| **P4** | Ejercicio de la rutina | Formulario de un ejercicio de una rutina, nuevo o existente | P3 |
| **P5** | Programa nuevo | Nombre, si se activa y los siete días | P1 |
| **X1** | Biblioteca | Ejercicios, con buscador y filtros | Pestaña Ejercicios |
| **X2** | Ficha | Descripción, progresión, notas y dónde se usa | X1 |
| **X3** | Nuevo / editar ejercicio | Nombre, grupo y descripción | X1, X2 |
| **A1** | Ajustes | Unidad, botones del peso, 1RM, tema, colores de los días y tus datos (exportar, importar, borrar) | E1 (engranaje) |

**Cómo se cuentan.** Un código es una pantalla que hay que programar; los bocetos que comparten código son la misma pantalla en otro estado (H2 y H2 editando, P4 nuevo, existente y oculto). El corte está entre **leer y escribir**: la ficha de un ejercicio (X2) y su formulario (X3) son pantallas distintas, y por lo mismo lo son la semana de un programa (P2) y el formulario de uno nuevo (P5). En cambio, **crear y editar con el mismo formulario no se separan**: X3 sirve para los dos, y P4 también, porque un ejercicio de una rutina no tiene versión de solo leer. Son un componente con un id opcional sirviendo a dos rutas.

## Entrenar

### E1 · Hoy

La pantalla de entrada. Arriba, la **tira de la semana**, con las mismas marcas que el calendario (ver [H1](#h1--calendario)). Debajo, una **tarjeta** con lo de hoy según el programa activo. Más abajo, **Sin terminar** si hay una sesión de un día pasado a medias, **Por recuperar** si queda algo sin hacer, la **última sesión hecha** (lleva a H2) y una **lista de otras rutinas**.

Qué enseña la tarjeta según el día:

| Situación | La tarjeta |
|---|---|
| Día de entrenamiento | *Hoy toca Push*, con *Empezar Push* |
| Con una sesión empezada y sin terminar | *Continuar Push*, que vuelve a E2 sin preguntar |
| Hoy ya se entrenó | *Hoy · Pull · Hecho*, sin botón: se entrena una rutina al día. *Lo que queda esta semana* sale igual, como recordatorio, sin poder pulsarla |
| Lo de hoy ya se hizo por adelantado | *Hoy tocaba Pull · Hecho por adelantado el martes*. El día se comporta como un descanso |
| Día de descanso | *Descanso* y qué toca mañana, sin botón grande |
| Descanso con la semana ya hecha | *Descanso* y qué toca el próximo día, sin lista |
| Sin programa activo | *Sin programa*, con *Elegir un programa* (lleva a P1) |
| Primera vez | Una bienvenida (ver [La primera vez](#la-primera-vez)) |

**Sin terminar.** Una sesión de un día pasado (apuntada desde el calendario) con series y sin terminar cuenta como hecha, pero quizá se dejó a medias sin querer. E1 la avisa bajo la tarjeta (*Push · domingo 27 de septiembre*, y debajo *1 serie · termínala o cancélala*) y la fila lleva a su sesión, donde se termina o se cancela; entonces el aviso desaparece. Una sin ninguna serie también sale, en el mismo apartado y con la etiqueta *vacía* (*Push · lunes 7 de septiembre · vacía*, y debajo *apunta las series o cancélala*): no cuenta como hecha, pero quizá se abrió para apuntar ese día y se olvidó. Nada se borra solo: se queda ahí hasta que se completa o se cancela.

**Por recuperar.** Lo que se quedó sin hacer se puede recuperar **hasta el día antes del mismo día de la semana siguiente** (el Push del lunes, hasta el domingo). Mientras tanto, E1 lo enseña todo en una lista, cada entrenamiento con su plazo; el que caduca hoy lo dice en ámbar (*hoy es el último día*). Cada uno lleva su *Recuperar*, que pregunta antes y abre E2; esa sesión cuenta como la del día que se recupera.

- **En un día de descanso**, recuperar no cuesta nada: el plan no cambia.
- **En un día de entrenamiento también se puede**, sin pasar por Planificar. Como se entrena una rutina al día, lo que tocaba hoy queda por recuperar, y la confirmación lo dice: *Solo se hace una rutina al día. El Pull de hoy quedará pendiente, y podrás recuperarlo hasta el martes 22*.
- **Si hoy ya se entrenó o hay una sesión a medias**, la lista sigue saliendo, como recordatorio, pero sin botón: *Recupéralo otro día, hasta el domingo 20*.
- **Solo se recupera lo del programa activo.** Al activar otro programa, o al quedarse sin ninguno, lo que se faltó con el anterior sigue en el calendario como no hecho, pero deja de ofrecerse: del programa antiguo queda solo lo hecho.

**Las listas de E1 dicen todas igual qué rutina y qué día** (*Pull · miércoles 9*, *Leg · viernes 18*), con el día siempre escrito, nunca *hoy* ni *ayer*, para que todas las filas se lean igual, y el detalle debajo: *Sin terminar*, *Por recuperar*, *Última sesión hecha* y *Lo que queda esta semana*. Lo mismo en toda la app: la última vez, los plazos y los diálogos dicen el día con su número (*última vez el lunes 21*, *hasta el miércoles 23*, *¿Registrar Leg el jueves 8?*). Las excepciones son la tarjeta de un descanso, *Mañana toca Pull*, que se entiende mejor así, y el aviso en ámbar de un plazo que se acaba, *hoy es el último día*.

**Qué ofrece la lista de abajo**, *Lo que queda esta semana*, y qué pregunta al elegir:

- **En un día de entrenamiento** solo ofrece rutinas de días posteriores de esta semana, hasta el domingo, como adelantar, y nunca la misma que toca hoy (intercambiarla no cambiaría nada). Elegir una pregunta *¿Intercambiar con el miércoles?*: *Intercambiar* cambia el plan de los dos días (hoy esa, el miércoles la de hoy) y empieza la sesión; *Cancelar* lo deja todo como estaba. No hay opción de hacerla sin intercambiar: acabaría la misma rutina dos veces en la semana.
- **En un día de descanso**, o en uno cuya rutina ya se hizo por adelantado, ofrece adelantar lo que queda de esta semana, preguntando antes (*¿Adelantar el Pull del miércoles?*). Adelantar no cambia el plan. Lo que ya está hecho no sale, y lo que se recupera va en *Por recuperar*.
- **Una rutina se puede hacer tantas veces como aparezca en la semana del programa, ni una más.** Para entrenar más, se cambia el programa.
- **Sin programa activo** salen todas las rutinas, sin límite de veces: sin plan no hay nada que contar, intercambiar ni adelantar. Empezar una sigue pidiendo confirmación.
- **Con una sesión abierta, o si hoy ya se entrenó,** la lista sale igual, como recordatorio de lo que falta de la semana, pero sin flecha y sin poder pulsarla: hoy ya no se puede entrenar otra rutina. Sin programa activo, no sale.

### E2 · Sesión en curso

La pantalla importante. Un bloque por ejercicio de la rutina, en orden; el que se está haciendo va desplegado y los demás plegados a una línea (nombre y series hechas / objetivo), para no hacer scroll entre series. El bloque desplegado enseña:

- **El objetivo** del ejercicio (4 × 6-10).
- **La última vez, en fichas, una por serie**, cada una con su peso (las series de un día pueden ir a pesos distintos). Es lo que decide el peso de hoy, así que está en el mismo bloque, sin navegar. Es la última vez que se hizo **ese ejercicio**, en la rutina que fuera, no la última sesión sin más.
- **Las series de hoy**, con un lápiz y una ✕ cada una.
- **El formulario**: peso y reps con − / +, y variante opcional. El peso va en la unidad elegida (kg o lb), y − / + lo mueven lo que diga Ajustes (por defecto, 1).

Comportamiento:

- **El formulario arranca con la serie anterior** (ejercicio, peso y variante). Lo normal es cambiar solo las reps.
- **El número de la siguiente serie es el mayor + 1**, no la cuenta: si se borra una del medio, no se repite un número.
- **Cambiar a una alternativa**: si el ejercicio tiene alternativas, junto a su nombre hay una flecha en su propio botón, con recuadro y en verde para que no pase desapercibida. Al tocarla (el nombre no abre nada) se despliegan el principal y sus alternativas, cada uno con su última vez, y el de hoy marcado. Al elegir una alternativa, la última vez, el peso con el que arranca el formulario y las series que se apunten pasan a ser de ese ejercicio, y el bloque plegado lo dice con la etiqueta *alternativa*. Se queda elegida para el resto del ejercicio. Un ejercicio de la rutina se hace con un solo ejercicio por sesión: si ya tiene series apuntadas y se elige otro, la app pregunta («¿Cambiar a Press militar en máquina? Se borrarán las 2 series de Press militar con mancuernas de hoy») y, si se confirma, borra esas series; sin series, cambia sin preguntar. Si el principal está oculto, empieza ya con una alternativa; un ejercicio sin alternativas no lleva flecha, porque no hay nada que elegir.
- **La variante** va por serie. En las fichas no se escribe: las que tienen variante llevan un punto verde, y al tocarlas (o con el ratón encima) sale un globo por encima del dedo; tocar otra vez, o en cualquier otro sitio, lo cierra.
- **Editar una serie**: el lápiz la carga en el mismo formulario, con *Cancelar* y *Guardar cambios* en la misma línea; mientras tanto, el resto de la sesión se queda en gris. La ✕ pregunta antes de borrar.
- **Sin RPE**: la app no lo apunta.
- **Si la sesión recupera o adelanta otro día**, la cabecera lo recuerda bajo la fecha, en verde: *Recuperado del lunes 14 de septiembre*, o *Adelantado del jueves 17 de septiembre*.
- **Cada serie se guarda al pulsar su botón**, así que se puede salir de E2 a otras pantallas y volver: la sesión queda abierta.
- **La nota de la sesión se escribe en cualquier momento**, no solo al terminar: si hay que esperar al final, se olvida lo que se quería apuntar. Encima de *Terminar sesión* sale *Añadir nota*, que abre el campo con *Cancelar* y *Guardar*; una vez escrita, se ve con su lápiz y su ✕, como las series.
- **Al pie**, *Terminar sesión* y, en rojo, *Cancelar sesión*. Terminar pregunta (y dice cuánto se lleva, para darse cuenta de si se termina antes de tiempo) y lleva a H2. Si no se ha apuntado ninguna serie, terminar no deja un día vacío en el historial: la sesión se cancela, y el diálogo lo avisa. Cancelar deja el día como si no se hubiera empezado: borra la sesión y sus series, y pregunta con *Seguir* como salida.
- **Una sesión de un día pasado** (apuntada desde el calendario) lleva la fecha en su propia línea en la cabecera. Su flecha de volver y *Cancelar sesión* no van a Hoy, que no la enseña, sino a su día en H2 (o al mes del calendario, si aún no tiene series). Si se sale sin terminarla, queda guardada y E1 la avisa en *Sin terminar*.
- **Siempre se entrena una rutina**: con programa, la que toca o una que se recupera o se adelanta; sin programa, cualquiera de las tuyas. No hay entrenamientos sin rutina: si un día se hace algo distinto, se crea una rutina para ello.
- **Una sesión abierta de un día para otro cuenta como terminada**: al día siguiente E1 vuelve a ofrecer *Empezar*, no *Continuar*.

## Historial

### H1 · Calendario

El mes, con un **color por día de la semana** (no por rutina; más adelante podrá personalizarse). Cada día lleva una marca, que dice a la vez qué tocaba y qué se hizo ese día:

| Marca | Significa |
|---|---|
| Punto lleno | Ese día se hizo lo que tocaba (o se recuperó o adelantó otro, ver abajo) |
| Aro vacío | Tocaba y no se hizo |
| Aro con flecha → | Lo que tocaba se hizo más tarde, otro día (recuperado) |
| Aro con flecha ← | Lo que tocaba se hizo antes, otro día (adelantado) |
| Punto lleno con flecha | Ese día se hizo otra rutina, y la suya se hizo otro día |
| Punto lleno y aro | Ese día se hizo otra rutina, y la suya sigue sin hacer |
| Apagado | Próximo |

**El punto lleno lleva el color de lo que se hizo; el aro y la flecha, el de lo que tocaba.** Así, si el martes se adelantó el Pull del miércoles, el martes lleva el punto del Pull y el miércoles el aro con la flecha hacia atrás. La leyenda va plegada bajo las cifras (*Ver leyenda*), porque se consulta poco, y sus ejemplos llevan los colores de los dos primeros días de tu programa, como el calendario.

Debajo, las cifras del mes (entrenados, movidos, no hechos) y dos botones: *Planificar los próximos días* (H4) y *Ver resumen* (H5), que no sale en un mes que aún no ha empezado.

**Tocar un día enseña siempre lo que se hizo ese día**, nunca lo de otro:

- Si ese día hubo sesión, lleva a H2.
- Si no, se comporta como un descanso, aunque su rutina se hiciera otro día. Si es un día pasado, abre una hoja para apuntar lo que se hizo: ofrece lo mismo que habría ofrecido Hoy aquel día (*Recuperar el Pull del miércoles 9*, si seguía en plazo), salvo intercambiar y adelantar: el pasado no se planifica, y adelantar se hace solo desde Hoy; y las demás rutinas, que se apuntan sin contar para ningún día del programa. Las que cuentan llevan el color del día para el que cuentan y ninguna explicación más, porque su nombre ya dice de qué día son (*Pull, lo que tocaba*); las que no cuentan van sin color y lo avisan. Elegir pregunta antes y abre E2 con esa fecha. Sirve para pasar la libreta de meses anteriores o para el día que se entrenó y se olvidó apuntar. No cambia lo planificado: registra lo que pasó.

**Cómo se decide si un día está hecho, movido o sin hacer**, sin que el usuario marque nada: cada sesión cuenta para un día (ver [Vocabulario](#vocabulario)). Un día planificado está **hecho** si lo cuenta una sesión de ese mismo día, **movido** si lo cuenta una de otro día, y **sin hacer** si no lo cuenta ninguna y ya pasó.

Cada mes se compara con **el programa que estaba activo entonces**, no con el de hoy: si no, un mes de hace un año marcaría como faltados días que entonces no tocaban. Por lo mismo, **editar un programa o activar otro no cambia los días que ya pasaron** ni los que ya están hechos por adelantado.

### H2 · Un día

La única pantalla de ver un día. Arriba, las cifras (series, volumen y ejercicios mejorados). Por ejercicio de la rutina: cuál se hizo (y si fue una alternativa) con su objetivo debajo del nombre (`3 × 8-12`), las insignias de mejora, sus series y la última vez en fichas. La comparación **mira siempre hacia atrás desde ese día**, con la última vez que se hizo ese ejercicio, en la rutina que fuera, y por eso lleva su fecha, entera (*Última vez · martes 8 de septiembre*). La flecha de cada ejercicio lleva a su progresión (H3). Si la sesión cuenta para otro día, la cabecera lo dice bajo la fecha: *Recuperado del lunes 14 de septiembre*, o *Adelantado del miércoles 16 de septiembre*.

**Cómo se decide si un ejercicio mejoró.** Las insignias dicen qué cambió, una por cosa, y **van en verde siempre que algo sube**, sea cual sea el tipo de ejercicio (en gris si se queda igual o baja). Cada tipo se mide con lo suyo, frente a la última vez que se hizo ese ejercicio, en la rutina que fuera:

- **Peso y repeticiones**: el peso más alto (`+2,5 kg`), el total de repeticiones (`−7 reps`, que ya recoge si se hicieron más o menos series) y el **1RM estimado** (`↑ 1RM 36,1 kg (+1,3)`). Lo que decide si mejoró es solo el 1RM: por defecto, la media de lo que cada serie permitiría levantar una sola vez (`peso × (1 + reps / 30)`). Así subir peso y bajar repeticiones se compensa en una medida, cualquier serie que mejore cuenta (no solo la mejor), y hacer una serie menos no se toma por empeorar. En Ajustes se puede elegir la mejor serie del día.
- **Peso corporal**: manda la carga más alta (`+2 kg`, con lastre o con ayuda) y, con la misma, la media de repeticiones por serie. El peso corporal del día no cuenta.
- **Tiempo**: manda el peso más alto (sin peso cuenta como 0) y, con el mismo, la duración media por serie (`+10 s`).
- **Cardio**: manda la distancia (`5,2 km (+0,4)`), con la misma, el ritmo (`↑ Ritmo 5:26 min/km (−0:07)`: más rápido es mejor) y, sin distancia, el tiempo (`28 min 15 s (+1 min 35 s)`).

Las insignias del 1RM y del ritmo llevan flecha (`↑` verde mejora, `↓` gris empeora). **Si un ejercicio no se había hecho nunca, solo lleva `nuevo`**: sin una vez anterior no hay con qué comparar, así que no salen insignias de cambio ni de mejora.

El **volumen** lleva debajo su cambio frente a **la sesión anterior de la misma rutina** que tuvo volumen (`↓ −558 kg`; una de solo cardio se salta). Es un dato de cuánto trabajo se hizo, no de fuerza: puede bajar aunque todo mejore, si se saltó un ejercicio o se usó una alternativa más ligera. Solo suma los ejercicios de peso y repeticiones. Al pie, una leyenda lo recuerda: *La mejora, frente a la última vez con ese ejercicio: en peso y repeticiones, el 1RM; en peso corporal, la carga y luego las reps; en tiempo, el peso y luego la duración; en cardio, la distancia y luego el ritmo. El volumen solo cuenta peso y repeticiones, frente a la sesión anterior de esta rutina.*

Si la sesión es de un día pasado y no está terminada, el día ofrece **Seguir apuntando**, que vuelve a la sesión.

**Editar**: la flecha de volver pasa a ser *Cancelar* y *Editar*, *Guardar*, que guarda de golpe todo lo cambiado (fecha, series y nota); *Cancelar* lo deshace todo. Lápiz y ✕ en cada serie: el lápiz despliega el formulario bajo la serie, con *Aplicar*, y la ✕ pregunta antes. Con un formulario abierto (una serie, una serie nueva o la nota), el resto se queda en gris. Además:

- **La fecha pasa a ser un campo**, por si la sesión se apuntó en otro día. Al tocarlo sube una hoja con el mes del calendario, con sus marcas, para ver qué días ya tienen sesión; tocar un día lo elige. Sigue contando para el mismo día del plan, así que solo puede ir donde se habría podido hacer: hacia delante, hasta el día antes del mismo día de la semana siguiente; hacia atrás, dentro de la misma semana; y siempre a un día en que se siguiera el mismo programa que el día que cuenta. Un día que ya tiene sesión tampoco vale. Si no vale, *Guardar* no guarda nada, el modo editar sigue abierto y el campo explica por qué (y, si el día está ocupado, que la otra sesión se mueve desde su propio día).
- **Cada ejercicio lleva *+ Añadir serie***, para la serie que se olvidó apuntar: abre ahí mismo el formulario de la sesión, con la siguiente serie y los datos de la anterior. Los ejercicios que ese día se quedaron sin series también salen al editar, con borde discontinuo, para poder añadírselas; si tienen alternativas, llevan la misma flecha que en la sesión para elegir con cuál (los que ya tienen series también la llevan, con el mismo aviso de que cambiar de ejercicio borra esas series al guardar). Un ejercicio oculto no admite series nuevas.
- **La nota gana su lápiz y su ✕**, como las series, o *Añadir nota* si no tiene. Sin editar, la nota solo se lee.
- **Al pie, *Borrar este día*** en rojo: quita la sesión entera con sus series, para arreglar un día o una rutina apuntados por error. Pregunta antes. El día que contaba vuelve a quedar sin hacer, y se puede recuperar si sigue en plazo.

### H3 · Progresión

La gráfica de un ejercicio, con un punto por sesión. Arriba, el rango (1 mes, 3 meses, 6 meses y todo) y un conmutador de qué se pinta sobre los mismos puntos:

**Al abrir, el rango es el más corto en el que cabe todo tu historial del ejercicio**: si empezaste hace menos de un mes, 1 mes; hasta tres, 3 meses; hasta seis, 6 meses; y si no, todo. Así nunca abre con la gráfica casi vacía. El que elijas se respeta.

**Todo** se dibuja a la escala de 6 meses para que los puntos y los meses no se apilen: si hay más, la gráfica se desliza de lado, abre en lo más reciente y los valores de la izquierda se quedan fijos. No hay rango de un año: ahí ya no cabían.

Cada ejercicio tiene tres medidas, según su tipo, y **un rótulo sobre la cifra grande dice qué mide** («El más alto de la sesión», «Suma de las series», «Media de las series»…). En peso y repeticiones:

- **Peso**: el mejor peso de cada sesión.
- **Volumen**: peso × reps sumado. Enseña las semanas en que el peso no sube pero se hacen más reps.
- **1RM estimado**: el peso que se levantaría una sola vez, `peso × (1 + reps / 30)` (Epley), **por defecto, como media de las series** de la sesión, igual que en H2 (en Ajustes se puede elegir la mejor serie, y cambian las dos pantallas a la vez). Sirve para comparar series de rangos distintos (60 × 10 frente a 65 × 6). Sale de datos que ya se guardan. Se promedia y no se toma la mejor serie porque las rutinas son de doble progresión (se suben repeticiones hasta llegar al máximo del rango en todas las series y entonces se sube el peso): en esas semanas el progreso está en las series de después, y con la mejor serie la línea se quedaría plana aunque se mejorase cada semana. Por eso el globo dice *16,3 kg de media*; con la mejor serie dice solo el valor.

Arriba, la medida que se elige, sola y centrada; debajo, a la izquierda el último valor y a la derecha cuánto cambió desde la primera sesión del rango, con el número de sesiones debajo. Los puntos se reparten **según la fecha**. Tocar un punto enseña la sesión en un globo (por defecto, la última) que se recoloca para no tapar la línea. Con *Peso*, el globo dice la serie más pesada del día con sus repeticiones (*20 kg × 10 reps*); si varias tienen ese peso, la de más repeticiones. Así se ve si se subió el peso o se hicieron más repeticiones con el mismo. Debajo, la lista de sesiones con sus series, que lleva a cada día en H2. Se llega desde la flecha de cada ejercicio en H2 (y desde la ficha del ejercicio, X2). Se descartó un selector "este ejercicio / este hueco": pintar la barra y la máquina en la misma línea no significa nada.

**Sin datos**: si el ejercicio no se ha hecho nunca, dice *Aún no has hecho este ejercicio.*; si se hizo pero no en el rango elegido, *No lo has hecho en este tiempo. Prueba con un rango más largo.* En ambos casos las píldoras del rango siguen ahí (en el segundo son la salida).

### H4 · Planificar

Los días **de hoy en adelante**, agrupados por semanas: salen cuatro, y al final, *Ver 4 semanas más* añade otras cuatro, sin límite. Con un botón y no al bajar, para que la lista tenga final. Tocar un día abre una hoja con lo que toca según el programa y las rutinas para sustituirlo: primero, bajo *Rutinas del programa*, las del programa en el orden de la semana, y *Descanso*; debajo, *Otras rutinas* (las que no están en el programa, por orden alfabético). Sin programa activo salen todas por orden alfabético. Poner una rutina de fuera en un día lo cambia solo ese día, y cuenta como cualquier otro: *Hoy* lo propone y el calendario lo marca hecho o sin hacer. Se guarda al tocar, sin botón de guardar. **Sustituye, no intercambia.** Los días cambiados llevan su marca.

- *Restablecer este día* devuelve un día a lo que dice el programa. No es lo mismo que elegir a mano la rutina del programa, que dejaría el día marcado como cambiado.
- *Restablecer la semana* devuelve los siete días, y pregunta antes.
- El pasado no se planifica: lo que pasó se registra (desde H1), no se cambia.
- **Lo pendiente de recuperar no sale aquí**: H4 solo enseña hoy y los días que vienen, y recuperar se hace desde Hoy.
- **Una rutina oculta** sigue en su día, en gris y con *oculta*, porque ocultar no la quita del programa; ese día cuenta como descanso. Se puede dejar en *Descanso* a propósito, y elegir otra rutina la sustituye solo en esa fecha.
- **Un día ya hecho** lleva un ✓ verde, y uno cambiado a mano, un lápiz; los dos sin texto, para que el nombre de la rutina tenga sitio, y explicados en una leyenda bajo la ayuda de arriba (*✓ Ya hecho · ✎ Cambiado por ti*). Si su rutina se pasa a otro día de la semana, el adelanto pasa a contar para ese día. Lo que no se puede es dejar ese entrenamiento sin ningún día: la app lo explica y pide poner antes la rutina en otro día.
- Al activar otro programa (o crear uno y activarlo), si hay días cambiados a mano de hoy en adelante, la app dice cuántos son y entre qué fechas y deja elegir: *Activar y dejarlos* o *Activar y quitarlos* (los días pasados no cuentan). Sin días cambiados, el aviso es el de siempre.

### H5 · Resumen

Progresión general, no por ejercicio. Arriba, el mes con sus flechas, como en el calendario (*‹ Septiembre 2026 ›*): las barras acaban en ese mes, y así se puede ir hacia atrás sin volver al calendario. La flecha de adelante se apaga en el mes de hoy, porque uno sin empezar no tiene nada. Debajo, un solo control, *Por semana* o *Por mes*, y nada de filtros por rutina: se probaron y no se entendía qué filtraba cada cosa.

- **Volumen por semana** (o por mes): una barra por cada una de las últimas ocho semanas (o meses) ya terminadas, con el peso por repeticiones de todo lo entrenado. Si la semana (o el mes) de hoy cae en la gráfica, va una barra más, **rayada**, con lo que va de ella; las rayas siguen aunque se elija, para que se vea que no ha terminado.
- **Tocar una barra la elige**: se pinta en verde vivo y arriba salen su periodo (*15 de septiembre*; el título ya dice que es una semana), su volumen y cuánto cambió. Al entrar, y al cambiar de semanas a meses, queda elegida la última terminada.
- **El cambio se compara con el último periodo en que se entrenó**, aunque quede fuera de la gráfica: tras una semana de vacaciones, la siguiente dice *+5,7 % sobre la semana del 11 de agosto*. Si es la de justo antes, *sobre la semana anterior*. Una semana sin series dice *Sin series esta semana*.
- **Volumen por rutina** y **Series por grupo muscular** son de la barra elegida, y salen siempre: si esa barra no tiene series, cada uno lo dice (*Sin series esta semana*), para que la pantalla tenga siempre la misma forma: la gráfica enseña la evolución, y estos dos recuadros, el desglose de lo que se toca. Las series cuentan en el grupo del ejercicio que se hizo (una alternativa de otro grupo cuenta en el suyo). Cada rutina lleva el color de su día en el programa, el mismo del calendario; las series por grupo van en gris, porque un color por grupo serían siete u ocho colores que no dicen nada y se confundirían con los de los días.
- **Constancia** del año, fija, sin seguir a la barra elegida: dos alturas por mes, en gris lo planificado (también los días que aún no han llegado) y en verde lo entrenado, que lo va llenando. En los meses ya pasados el hueco es lo que se faltó. La cifra (*91 / 101 días entrenados, hasta hoy*) cuenta solo hasta hoy. Lo recuperado y lo adelantado cuentan como entrenado, en el mes del día que tocaba.
- Dentro de la tarjeta del volumen, bajo las barras, cómo se usan: *Toca una barra para ver esa semana. La rayada es la semana en curso, aún sin terminar.* Al final de la pantalla no se veía a qué se refería.

## Programas y rutinas

### P1 · Programas y rutinas

Dos secciones. **Programas**, con el activo primero y marcado; cada uno dice cuándo se usó (*Desde el 6 de julio*, *Del 2 de marzo al 28 de junio* o *Sin usar todavía*). **Rutinas**, todas las del usuario y por orden alfabético, con cuántos ejercicios tiene y en cuántos programas se usa (o *sin programa*). Sin esta segunda sección, una rutina que no estuviera en ningún programa sería inalcanzable. Al pie, una línea explica la diferencia: una rutina son los ejercicios de un día; un programa las reparte en la semana.

### P2 · Semana del programa

La plantilla que se repite: qué rutina toca cada día, o descanso. Tocar un día lleva a su rutina (P3). Mover un día concreto no se hace aquí, sino en H4.

- **Arriba del todo, el interruptor *Programa activo*.** Es lo único que se cambia sin entrar en *Editar*, porque no toca el programa, solo cuál está en uso. Guarda al momento, así que pregunta antes, con palabras de lo que pasa (*Entrenar dejará de decirte qué rutina toca y el calendario no marcará los días que te saltes*). Apagarlo deja sin programa activo; encenderlo en otro dice cuál dejará de estar activo (*Al activarlo, Push Pull Leg dejará de estar activo*). Se puede no tener ninguno. **Dentro de *Editar* el interruptor desaparece**, para que en el modo editar todo espere a *Guardar*.
- **Editando**: el nombre pasa a ser un campo; la › de un día abre la hoja de elegir rutina y la nueva sustituye a la que hubiera; la ✕ deja el día en descanso. La hoja ofrece al final *+ Nueva rutina*: lleva a crear la rutina y, al guardarla, se vuelve aquí, todavía en *Editar*, con lo que se llevaba cambiado y la rutina puesta en ese día. Se trabaja sobre un borrador: *Guardar* lo guarda todo de golpe y *Cancelar* lo descarta. Al pie, *Ocultar programa* y *Borrar programa*.
- **Un día, una rutina.** Si un día ya tiene rutina y se le pone otra, la nueva la sustituye.
- **Una rutina oculta sigue en su día**, en gris y con la etiqueta *oculta*, pero ese día cuenta como descanso; un párrafo lo explica y dice cómo volver a mostrarla.
- **Un programa oculto no se edita**: la vista es de solo lectura, con el aviso de desde cuándo, *Mostrar programa* y *Borrar programa*. Mostrar pide confirmación y no lo reactiva solo.
- **Borrar** avisa solo si el programa llegó a estar activo (el calendario dejará de saber qué tocaba); si nunca se usó, la pregunta basta.
- **Lo hecho por adelantado se queda como estaba.** Si el Leg del viernes ya se hizo el martes y los viernes pasan a Push, ese viernes sigue contando como Leg hecho, y el Push empieza el viernes siguiente. Los días que ya pasaron tampoco cambian.

### P3 · Rutina

Los ejercicios de la rutina en orden, cada uno con su objetivo y cuántas alternativas tiene (*2 alternativas*): sus nombres se ven al abrirlo, porque con varias la lista ocupaba tres líneas y la rutina dejaba de leerse de un vistazo. Tocar uno lleva a P4. *Añadir ejercicio* y *Duplicar rutina* (una copia independiente, para que dos versiones diverjan). La copia se llama como hace Windows con los archivos: *Push - copia* y, si ya existe, *Push - copia (2)*, *Push - copia (3)*…

- **Editando**: el nombre pasa a ser un campo y cada ejercicio gana un asa ≡ para arrastrarlo (también con las flechas del teclado). Se trabaja sobre un borrador: *Guardar* lo guarda todo de golpe y *Cancelar* lo descarta. Al pie, *Ocultar rutina* y *Borrar rutina*. **Editar sirve solo para el nombre, el orden, ocultar y borrar la rutina**: *Añadir ejercicio* y *Duplicar rutina* no salen mientras se edita, porque llevan a otra pantalla y lo cambiado se perdería; y ocultar o borrar un ejercicio está dentro del propio ejercicio (P4), que es donde se avisa de lo que se pierde.
- **Los ejercicios se numeran por su posición** entre los visibles (1, 2, 3…), no por el orden guardado: ocultar el primero renumera los demás. Los ocultos van plegados al pie (*Ver 1 ejercicio oculto*).
- **Rutina nueva**: la misma pantalla, sin *Editar* porque ya se está escribiendo. Pide el nombre y arranca sin ejercicios. **Todo va a un borrador**: *Añadir ejercicio* abre el formulario de P4, cuyo *Guardar* solo apunta el ejercicio en la lista; la rutina no existe hasta el *Guardar* de esta pantalla, que la crea con todos sus ejercicios de una vez. Salir sin guardar no deja nada. Si se crea desde la hoja de elegir rutina de un programa (nuevo o ya creado), el subtítulo lo recuerda (*Se pondrá el jueves de PPL*) y, al guardar, se vuelve allí con la rutina puesta en ese día.
- **Una rutina oculta no se edita**: aviso arriba, sus ejercicios en solo lectura, *Duplicar rutina* (no la modifica), *Mostrar rutina* y *Borrar rutina*.
- **Borrar cuenta lo que se pierde** con cifras reales (ejercicios, series de sus sesiones, días de programa que pasarían a descanso, sesión abierta hoy) y, si no hay nada que contar, la pregunta basta.
- Bajo el nombre no hay más datos: una rutina puede no estar en ningún programa ni día, o estar en varios.

### P4 · Ejercicio de la rutina

Formulario: ejercicio principal (con su grupo muscular a la derecha de la etiqueta, *Pecho*: las etiquetas van a la izquierda, y así no se confunde con el nombre de un campo), alternativas (varias; las que se pueden hacer en su lugar, por ejemplo si la máquina está ocupada), y el objetivo con − / + (series y reps mínimas y máximas, o series y duración mínima y máxima en los de tiempo y cardio), uno para el principal y otro para cada alternativa. Un ejercicio nuevo parte del objetivo de su tipo en Ajustes (3 × 8-12 en peso y repeticiones), que se cambia antes de guardar. El principal y cada alternativa se eligen en una hoja con buscador y filtro por grupo muscular, porque entre los predefinidos y los propios hay muchos; los ocultos no salen. El filtro es el mismo campo que en la biblioteca, pero como ya está dentro de una hoja, su lista se despliega justo debajo en vez de abrir otra hoja. Estados de la misma pantalla:

- **Nuevo en una rutina que ya existe**: se titula *Añadir ejercicio*, como el botón que lleva a él (crear un ejercicio para la biblioteca es otra cosa, en la pestaña Ejercicios). *Guardar* guarda al momento. Debajo del título, el nombre de la rutina y *será el ejercicio 5*.
- **Nuevo o existente en una rutina nueva**: *Guardar* solo cambia el borrador de la rutina; un ejercicio ya añadido ofrece *Quitar de la rutina* en lugar de Ocultar y Borrar.
- **Existente**: además, *Ocultar ejercicio* y *Borrar ejercicio*, cada uno con su diálogo (borrar cuenta las series y las sesiones que se vaciarían con él).
- **Oculto**: un aviso arriba, los datos en solo lectura y *Mostrar ejercicio* como acción principal. Lo mismo si lo oculta es la rutina entera: se ve sin poder cambiarlo y dice que primero hay que mostrarla.

Bajo *Ejercicio 1* va el nombre de su rutina.

### P5 · Programa nuevo

Todo en una pantalla: nombre, *Activarlo al crearlo* (empieza apagado: activarlo es algo que se elige a propósito; encendido, *Crear* pregunta antes, *¿Crear y activar PPL de 5 días?*, porque el programa nuevo pasa a ser el que marca qué toca cada día, en lugar del que hubiera) y los siete días. El + de un día abre una hoja con las rutinas del usuario para reutilizarlas, y un *+ Nueva rutina* que lleva a la pantalla de una rutina nueva (P3); al guardarla se vuelve aquí con la rutina puesta en ese día, y lo escrito en el programa sigue ahí. Los días vacíos son descanso. **Nada se guarda hasta pulsar *Crear*.**

## Ejercicios

### X1 · Biblioteca

Buscador, filtro de origen (*Todos · Predefinidos · Míos*) y filtro por grupo muscular (solo salen los grupos que tienen algo en el origen elegido). El grupo muscular se elige con un campo (*Todos los grupos musculares*) que abre una hoja con los grupos en dos columnas, todos a la vista; con uno elegido, el campo dice cuál, en verde. Cada ejercicio dice su grupo y su origen (*predefinido* o *mío*). Al pie, *Nuevo ejercicio*, que lleva a X3, con cualquier filtro (también con *Predefinidos*: es de la pantalla, no del filtro, y quien no encuentra su ejercicio lo crea ahí mismo), y debajo *Ver N ejercicios ocultos*, en el mismo orden que en Programas; con *Predefinidos* no sale, porque un predefinido no se oculta. Desde la pestaña, la biblioteca abre siempre en *Todos* y todos los grupos; lo que se busca y filtra se conserva al volver de una ficha.

### X2 · Ficha

Descripción; la progresión, con el peso más alto de la última sesión y cuándo fue (*Última vez el jueves 1*), que lleva a la gráfica (H3); las notas personales con su fecha, las más recientes arriba, cada una con su lápiz para cambiarla y su ✕ para borrarla (pregunta antes), y *Añadir nota*, que abre el campo ahí mismo con *Cancelar* y *Guardar* (mientras tanto, el resto en gris); y *Rutinas donde se usa*, con el lugar que ocupa en la rutina (*Push · ejercicio 1*), si es el principal o una alternativa, y en qué programas está la rutina. Lleva a la rutina (P3). Solo el programa activo lo dice (*Push Pull Leg · programa activo*); los demás salen con su nombre. Si el ejercicio está oculto dentro de una rutina, o la rutina está oculta, esa fila va plegada en *Ver N rutinas ocultas*. Si es propio, *Editar* arriba (lleva a X3) y *Ocultar* y *Borrar* al pie. Lo que no tiene contenido no sale: sin descripción, sin sesiones o sin rutinas, esos bloques no aparecen.

**Los predefinidos no se pueden editar, ocultar ni borrar**: vienen con la app. Su ficha no tiene *Editar* ni botones al pie, y lo dice en una línea. Las notas sí, porque son tuyas.

### X3 · Nuevo / editar ejercicio

Nombre, grupo muscular y descripción (opcional), con *Guardar* arriba. Si falta el nombre o el grupo, lo dice bajo ese campo y no guarda nada. Al crear, se abre la ficha del ejercicio nuevo; al editar, se vuelve a ella.

## Ajustes

### A1 · Ajustes

Se llega con el engranaje de arriba a la derecha de *Hoy*. Tiene tres apartados. Los dos primeros se aplican al momento, sin botón de guardar, y son de cada dispositivo: no van en el archivo de exportación.

**Entrenamiento**

- **Unidad de peso**: kilos o libras. Lo apuntado se guarda igual; solo cambia cómo se ve y en qué unidad se escribe.
- **Botones − y + del peso**: cuánto suben o bajan cada vez. El número lo escribe el usuario (por defecto, 1).
- **Ejercicio nuevo en una rutina**: el objetivo con el que empieza cada ejercicio que se añade a una rutina, uno por tipo (por defecto, 3 × 8-12 en peso y repeticiones, 3 × 6-10 en peso corporal, 3 × 30 s-1 min en tiempo y 1 × 20-30 min en cardio). Luego se cambia en cada uno.
- **1RM estimado**: la **media de las series** (por defecto) o la **mejor serie** del día. Es lo que dice si un ejercicio ha mejorado, en el día del historial y en la gráfica de progresión, que cambian a la vez. La media cuenta el progreso de las series de después, que es donde está en las rutinas de doble progresión; la mejor serie es lo habitual en el entrenamiento de fuerza máxima.

**Apariencia**

- **Tema**: oscuro, claro o automático (el del móvil u ordenador), que es el de por defecto. En el claro, los colores de los días y el verde son más oscuros, porque los vivos apenas se ven sobre blanco.
- **Colores de los días**: por defecto, el arcoíris de lunes (rojo) a domingo (rosa). Cada día abre una hoja con veinticuatro colores ordenados por tono —los de toda la vida y variaciones de ellos, como granate, coral o azul marino—, cada uno con su versión para los dos temas. No hay color libre: la paleta basta. Un color que ya tiene otro día no se puede elegir, para que no haya dos días iguales. Se puede volver a los colores de la app.

**Tus datos**

- **Exportar datos** guarda en un archivo todo lo apuntado (rutinas, programas, sesiones, notas y ejercicios propios). Antes pregunta, diciendo qué se va a guardar, dónde encontrarlo y que los ajustes no van en el archivo. La web y la app móvil no se conectan entre sí: así es como los datos pasan de una a otra, y también sirve de copia de seguridad.
- **Importar datos** carga un archivo exportado y **sustituye todo lo que hay**. Antes de hacer nada pregunta, contando qué hay ahora y qué trae el archivo, con la fecha en que se exportó, para no cargar una copia vieja por error; recuerda que, si se quiere conservar lo de ahora, hay que exportarlo antes. Si el archivo no vale (no es una copia de la app, es de una versión más nueva o algo no cuadra), lo dice y no cambia nada.
- **Borrar todos tus datos**, para empezar de cero: rutinas, programas, sesiones, notas y ejercicios propios. Los ejercicios que trae la app y los ajustes se quedan. Pregunta antes, en rojo, contando lo que se pierde y recomendando exportar antes.

## Ocultar y borrar

Programas, rutinas, ejercicios de una rutina y ejercicios propios se pueden ocultar o borrar. **Ocultar** los quita de la vista pero **conserva su historial**; **borrar** los elimina con todo lo que dependa de ellos. Cada uno tiene su sitio: el ejercicio en su ficha (X2), el ejercicio de una rutina en P4, y el programa y la rutina en el modo editar de P2 y P3.

- **Sin historial, borrar es directo**, porque no hay nada que perder (tras la confirmación de siempre). Una rutina que ya estuvo en el plan algún día pasado cuenta como con historial, aunque no se entrenara: borrarla quitaría esos días del calendario, así que pide elegir entre ocultarla o borrarla, como un programa que estuvo activo.
- **Con historial, borrar cuenta lo que se pierde** —cuántas series, qué ejercicios, qué notas, y las sesiones que solo tenían series de ese ejercicio, que se borran con él— y ofrece ocultar en su lugar. Si hay una sesión de esa rutina abierta hoy, también lo dice. En rojo, porque no se puede deshacer. Una sesión sin ninguna serie en un día pasado no cuenta como historial.
- **Ocultar es reversible de verdad.** Una rutina oculta no sale del programa: el día la conserva, en gris, y cuenta como descanso; al mostrarla, vuelve a estar como estaba. Lo mismo un ejercicio oculto dentro de su puesto en la rutina (se ve en gris, y E2 propone la alternativa) o un ejercicio de la rutina oculto dentro de su rutina. Si ocultar quitara la asignación, mostrarla no podría deshacerlo.
- **Si a ese día se le pone otra rutina**, la nueva sustituye a la oculta, y mostrar la oculta ya no recupera el día: el sitio ya tiene dueño.
- **Un programa oculto deja de ser el activo** si lo era, y no vuelve a serlo solo al mostrarlo.
- **Cada lista con algo oculto lleva un *Ver N ocultos* al pie** (P1 una vez por sección, P3, X1 y las rutinas donde se usa un ejercicio, en X2), que despliega los ocultos en gris, con la fecha desde la que lo están. Tocar uno lo abre en su estado oculto: un aviso arriba, *Mostrar* como acción principal y *Borrar* debajo, sin *Editar*: lo oculto no se edita, para cambiarlo primero se muestra (*Mostrar* pregunta antes, como el resto). Se puede *Duplicar* una rutina oculta, y las notas de un ejercicio oculto se siguen pudiendo escribir y cambiar, porque son del usuario.
- **Las listas para elegir no enseñan lo oculto** (la hoja de rutinas de P5, el selector de ejercicio de P4, el de rutina de H4): ocultar significa que deja de ofrecerse. Para volver a usarlo, primero se muestra.

## La primera vez

Recién instalada, la app no tiene rutinas, ni programas, ni historial. Ejercicios sí: viene con una biblioteca de predefinidos, así que se puede montar una rutina sin crear ninguno antes.

- **E1** da la bienvenida y explica los dos pasos diciendo qué es cada cosa: una rutina son los ejercicios de cada día de entreno, y un programa, tus rutinas repartidas en la semana. Debajo, *Ir a Programas*. Debajo, que también se puede entrenar sin programa. En cuanto hay una rutina, la bienvenida deja paso a *Sin programa*, con la lista de rutinas.
- **P1** dice que cada sección está vacía, y *Nueva rutina* pasa a ser la acción principal, porque es el primer paso.
- **X1** solo puede estar vacío en *Míos*: lo dice en una frase (*Todavía no has creado ningún ejercicio.*), y *Nuevo ejercicio* pasa a ser la acción principal.

## Flujos

**Un día de gimnasio**

1. Abre la app. E1 dice *Hoy toca Push*. Pulsa *Empezar Push* y confirma.
2. E2 aparece con el ejercicio 1 desplegado: la última vez en fichas y el formulario ya relleno.
3. Hace la primera serie, ajusta las reps si cambian y pulsa *Guardar serie 1*. El botón pasa a *Guardar serie 2*, con los mismos valores.
4. Repite. Al acabar el ejercicio, despliega el siguiente.
5. En el ejercicio 3 la máquina está ocupada: toca la flecha junto al nombre del ejercicio y elige la alternativa. La última vez y el peso pasan a ser los de la alternativa.
6. Se equivoca al apuntar una serie: el lápiz la carga en el formulario y la corrige.
7. Entre series se acuerda de algo y lo apunta en *Añadir nota*. Al acabar, *Terminar sesión* y confirma. H2 le enseña en qué ejercicios mejoró.

**"No pude ir el lunes y voy el martes"**: el martes, E1 dice *Descanso* y, en *Por recuperar*, *Push del lunes 14 · hasta el domingo 20*, con *Recuperar*. Confirma y entrena. El calendario pinta después el lunes con la flecha y el martes con el punto del Push. Si no lo recupera antes del domingo, el lunes queda como no hecho.

**"Falté el lunes y el miércoles toca Pull"**: el miércoles, *Por recuperar* sigue ofreciendo el Push. Si lo recupera ese día, el Pull del miércoles pasa a *Por recuperar*, con su propio plazo, y así se va corriendo la semana.

**"Esta semana el miércoles no puedo"**: Historial → *Planificar los próximos días* → el miércoles → *Descanso*, o la rutina que prefiera. El programa no cambia; solo ese día.

**Montar un programa desde cero** (una vez, sentado): Programas → *Nueva rutina* → "Push" → *Añadir ejercicio* → ejercicio, alternativas, series y reps → *Guardar* → siguiente ejercicio… → *Guardar*. Luego *Nuevo programa* → nombre → lunes → Push, miércoles → Pull… → *Crear* (y, si se quiere usar ya, activarlo después).

**Pasar la libreta de meses anteriores**: Historial → el mes → un día pasado sin sesión → la rutina → E2 con esa fecha, serie a serie.

**"¿Subo peso en el press banca?"**: Ejercicios → buscar → la ficha → la progresión. O desde un día del historial, con la flecha del ejercicio.

**Corregir una serie de otro día**: Historial → el día → *Editar* → el lápiz de la serie.

## Lo que necesita del backend

Todo lo que pide este diseño ya existe en el backend: programas, qué programa estuvo activo en cada periodo, días planificados, ocultar con fecha, sesiones terminadas, ejercicios predefinidos, el historial de cada ejercicio, una sesión por día, días de programa con fecha de vigencia, qué día del plan cuenta cada sesión y el plazo para moverla, el estado de cada día, que Planificar y editar un programa respeten lo hecho por adelantado, que borrar una rutina que ya estuvo en el plan pida elegir, y exportar e importar todos los datos. El estado de cada día y lo que se ofrece en Hoy se calculan en el backend, para que la web solo tenga que pintarlos. La app móvil no se conectará al PC (los datos pasan en un archivo exportado), así que hará esos cálculos ella misma.

Las pantallas de la web ya están todas. La app ya es de una sola persona por instalación, sin usuarios, y apunta los cuatro tipos de ejercicio (ver más abajo). Con todo repasado, lo siguiente es la app móvil para Android, que guardará los datos en el propio teléfono y llevará dentro la misma lógica que hoy hace el backend.

## Por decidir

Hablado, sin prisa: se decidirá cuando la app esté en uso.

- **Ocultar predefinidos**: de momento no se ve necesario, así que no se pueden ocultar.
- **Temporizador de descanso** entre series, en E2, con el tiempo por defecto en Ajustes.
- **Contar el peso corporal en los cálculos** (volumen y 1RM) de los ejercicios de peso corporal, con una casilla por ejercicio. De momento solo se guarda con cada serie.

## Ejercicios que no son de peso y repeticiones

Cada ejercicio se apunta de una de cuatro formas, que se elige al crearlo y no se puede cambiar (cada pantalla que cambia tiene una vista por tipo en los bocetos):

- **Peso y repeticiones**, como hasta ahora.
- **Peso corporal** (dominadas, fondos, flexiones): repeticiones y una carga opcional, de lastre o de ayuda, más el peso corporal de ese día, que no entra en ningún cálculo.
- **Tiempo** (plancha, paseo del granjero): la duración, en minutos y segundos, y un peso opcional.
- **Cardio** (cinta, bici, elíptica, remo): la duración, la distancia si se quiere y el ritmo que sale de las dos (`5:26 min/km`).

En la gráfica de un ejercicio (H3), las medidas son: **peso corporal**, repeticiones (media por serie), repeticiones totales y carga; **tiempo**, la duración (media por serie), la total y el peso; **cardio**, la distancia, el tiempo y el ritmo. La carga, el peso, la distancia y el ritmo solo salen si se apuntaron en el rango elegido (un cardio sin distancia en el último mes abre en el tiempo). El globo de un punto solo dice la fecha y el valor.

La biblioteca viene con 146 ejercicios predefinidos en 19 grupos (con Cuerpo completo, para los que trabajan todo el cuerpo a la vez), cada uno con su tipo (las dominadas y los fondos son de peso corporal, la plancha, de tiempo, y la cinta, de cardio); al crear uno propio, el grupo Cardio marca solo el tipo Cardio. Cada ejercicio de una rutina, y cada una de sus alternativas, lleva su propio objetivo en la unidad de su tipo (repeticiones o duración); las alternativas pueden ser de otro tipo (un crunch en polea o una plancha). En una sesión, cada ejercicio de la rutina se hace con uno solo: cambiar a otro con series ya apuntadas pide confirmar y las borra. Solo el volumen de peso y repeticiones suma kilos; las series de todos los tipos cuentan en las de cada grupo muscular. Ajustes lleva el peso corporal, el paso de los botones del tiempo, la unidad de distancia y el objetivo con el que empieza cada tipo.
