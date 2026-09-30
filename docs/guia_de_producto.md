# Guía de producto — Training Life

Qué hace la app, qué pantallas tiene y cómo se comporta cada una. Es la referencia para implementar
tanto la web como la app móvil: **las dos tienen las mismas funciones y el mismo diseño**. Lo que
cambia entre una y otra es el ancho de pantalla, no lo que se puede hacer.

Va acompañada de dos imágenes que conviene tener abiertas al leerla:

- **[Bocetos](bocetos-movil-training-life.png)**: las 16 pantallas en todos sus estados, cada una
  con una nota. Los códigos de esta guía (E1, H2, P4…) son los de los bocetos.
- **[Mapa de navegación](mapa-navegacion-training-life.png)**: qué se toca para ir de una pantalla
  a otra.

Los datos que aparecen en los bocetos son de ejemplo: enseñan cómo se ve cada función, no tienen
por qué cuadrar entre una pantalla y otra.

**Índice:** [Para qué existe](#para-qué-existe) · [Lo que hace el usuario](#lo-que-hace-el-usuario) ·
[Vocabulario](#vocabulario) · [Principios](#principios) · [Pantallas](#pantallas) ·
[Entrenar](#entrenar) · [Historial](#historial) · [Programas y rutinas](#programas-y-rutinas) ·
[Ejercicios](#ejercicios) · [Ocultar y borrar](#ocultar-y-borrar) · [La primera vez](#la-primera-vez) ·
[Flujos](#flujos) · [Lo que necesita del backend](#lo-que-necesita-del-backend) ·
[Por decidir](#por-decidir)

## Para qué existe

Sustituir el bloc de notas donde se apuntan los entrenamientos. Eso marca el listón: si registrar
una serie cuesta más que escribir "60x10" en una nota, la app ha fracasado, por muchas gráficas que
tenga. Todo lo demás —programas, calendario, progresión— existe para que ese registro diario valga
más que una nota suelta.

## Lo que hace el usuario

Ordenado por frecuencia. No se diseña igual lo que se hace cada día que lo que se hace una vez al
mes, y la última columna dice **para qué situación hay que diseñar cada cosa**, no en qué
dispositivo está disponible (está en todos).

| Cada cuánto | Qué | Contexto para el que se diseña |
|---|---|---|
| Cada día de gimnasio | Registrar la sesión, serie a serie | De pie, entre series, con una mano, sudado |
| Cada día de gimnasio | Ver qué hizo la última vez en este hueco, para decidir el peso | El mismo momento: tiene que estar a la vista, sin buscarlo |
| Cada semana | Mirar el calendario: qué días fue, cuáles faltó, qué toca después | Sentado, de un vistazo |
| Cada semana | Ver cómo va un ejercicio ("¿subo peso?") | Sentado, con calma |
| De vez en cuando | Mover un día concreto del plan, o apuntar una sesión que olvidó | Sentado |
| De vez en cuando | Repasar o corregir una sesión pasada | Sentado |
| Casi nunca | Montar o retocar programas y rutinas | En casa, con tiempo; puede ser "de formulario" |
| Casi nunca | Añadir ejercicios a la biblioteca, escribir notas sobre uno | En casa |

Las dos primeras filas son la app. Si la pantalla de entrenar es buena y el resto regular, la app
se usa. Al revés, no.

## Vocabulario

Un nombre para cada cosa, el mismo en la interfaz, en el código y en esta guía:

| Término | Qué es | Ejemplo |
|---|---|---|
| **Programa** | Reparte rutinas en la semana: qué rutina toca cada día | "Push Pull Leg" |
| **Programa activo** | El programa en uso: el que dice qué toca hoy y contra el que se pinta el calendario. Solo uno, o ninguno | — |
| **Rutina** | Los ejercicios de un día; un "tipo de día" | "Push" |
| **Hueco** | Un puesto dentro de la rutina: qué ejercicio, cuántas series y qué rango de reps | "1 · Press banca, 4 × 6-10" |
| **Comodín** | Ejercicio alternativo para un hueco, por si el principal no se puede hacer | "Press banca en máquina" |
| **Ejercicio** | Un movimiento de la biblioteca: predefinido (viene con la app) o propio | "Press banca con barra" |
| **Sesión** | Un día real de entrenamiento, con fecha | "El Push del lunes 14" |
| **Serie** | Lo que se hizo: peso × repeticiones, y su variante si la tiene | "60 kg × 10" |
| **Variante** | Matiz de ejecución que no merece un ejercicio aparte | "agarre cerrado" |
| **Planificar** | Cambiar qué toca un día concreto sin tocar el programa | "El miércoles 23, Push en vez de Pull" |
| **Recuperar** | Hacer más tarde un entrenamiento que se quedó sin hacer. Cuenta como el de aquel día | "El Push del lunes, el martes" |
| **Adelantar** | Hacer antes el entrenamiento de un día que todavía no ha llegado. Cuenta como el de ese día | "El Pull del miércoles, el martes" |
| **Ocultar** | Quitar algo de la vista sin perder su historial. Lo contrario es **Mostrar** | — |

**Las rutinas son del usuario, no de un programa.** La misma rutina puede estar en varios programas
y en varios días del mismo programa, y editarla la cambia en todos. Para que dos versiones
diverjan, se duplica.

**Cada sesión cuenta para un día del plan**: el que tocaba o el que se recupera o adelanta, y un
día solo lo cuenta una sesión. Lo decide el botón que se pulsa (*Empezar*, *Recuperar*,
*Adelantar*), así que la app nunca tiene que adivinar qué pretendía cada entrenamiento. Las
sesiones sin programa, o sin rutina, no cuentan para ninguno.

**Una sesión por día, como mucho**, sea del tipo que sea: hoy, un día pasado o uno movido. Si hoy
ya se entrenó, no se ofrece nada más.

**Una sesión sin ninguna serie, cuando ya no está en curso, cuenta como cancelada**: no se hizo nada.
No ocupa su día, y lo que iba a recuperar o adelantar vuelve a estar como estaba (si se abrió el
Pull del miércoles el martes y no se apuntó nada, el miércoles sigue tocando Pull).

**"Activo" solo significa "programa en uso".** Lo que no está oculto es *visible*, y para sacar
algo de ocultos el botón es *Mostrar*, nunca *Activar*: así un programa oculto no se confunde con
uno que no está en uso.

## Principios

Concretos, para poder comprobar si una pantalla los cumple.

**Estructura**

1. **Lo de cada día, sin rodeos.** Abrir la app deja delante lo que toca hoy. Nunca hay que pasar
   por una lista para llegar a ello.
2. **Móvil primero.** Se diseña para 390 px de ancho y una mano. La versión de escritorio es la
   misma pantalla con más aire, y como mucho dos columnas donde tenga sentido. No hay funciones
   "solo de PC" ni "solo de móvil".
3. **Cuatro secciones**: Entrenar, Historial, Programas y Ejercicios. En el móvil, una barra de
   pestañas abajo (donde llega el pulgar); en el PC, un menú lateral.
4. **Lo que se puede deducir no se pregunta**: qué toca hoy, el número de la siguiente serie, si un
   día se movió o se faltó. La app lo calcula de lo que pasó.

**Interacción**

5. **Cada acción tiene su botón visible**, con un nombre que dice lo que hace. El único gesto oculto
   es mantener pulsada una ficha de "última vez" para ver su variante.
6. **Todo se guarda al confirmarlo, nunca al salir de una pantalla.** Cada serie se guarda al
   pulsar su botón; no hay "guardar sesión" ni botones de guardar globales. Salir de una pantalla
   no pierde nada ni guarda nada que no se haya confirmado.
7. **Todo lo que empieza, adelanta, recupera, intercambia, activa, desactiva, oculta o borra algo
   pide confirmación antes**: siempre se puede pulsar sin querer. También la ✕ de una serie. No la
   piden las acciones que se corrigen con otro toque: guardar una serie o sus cambios, cambiar la
   rutina de un día, restablecer un día, o *Continuar* una sesión, que no empieza nada.
8. **Los diálogos llevan *Cancelar* frente al verbo** (*Empezar*, *Ocultar*, *Borrar*…), nunca
   *Sí / No*: el botón dice lo que hace sin releer la pregunta. En verde si se puede deshacer, en
   rojo si no. El texto cuenta qué se pierde y qué no. Única excepción: *¿Intercambiar con el
   miércoles?*, que es una pregunta de sí o no.
9. **Editar no abre otra pantalla, la cambia** (patrón *Editar / Listo*): los campos pasan a ser
   editables, cada cambio se guarda con su propio botón o al momento, y *Listo* solo sale del modo
   editar.
10. **Los valores anteriores ya puestos.** El teclado solo sale para nombres, notas y variantes;
    para lo demás, lo normal es confirmar lo que ya está o ajustarlo con − / +.

**Aspecto**

11. **Tema oscuro**, con contraste alto: luz de gimnasio, pantalla con reflejos. Fondo `#14161a`,
    superficie `#1c1f26`, borde `#2c313b`, texto `#e8eaed` y `#9aa1ac`, acento verde `#4ade80`.
12. **Jerarquía de botones**: verde relleno para la acción principal (una por pantalla); con
    recuadro para las normales; solo texto para las secundarias o peligrosas. Al menos 44 px de
    alto. Única excepción: los *Recuperar* de *Por recuperar* van siempre en verde, también junto
    a *Empezar* en un día de entrenamiento.
13. **Si un bloque está vacío, no se enseña**: sin descripción no hay rótulo ni recuadro de
    descripción.

**Textos**

14. **Cortos, y nombrando el control de verdad**: "Pulsa › para cambiar la rutina de un día", no
    "toca un día para…" cuando lo que se pulsa es un icono concreto.
15. **Frases cortas, una por línea y centradas**, para que nunca quede una palabra suelta colgando.
    **Frases largas, en un solo párrafo** alineado a la izquierda, en un bloque centrado y más
    estrecho que la pantalla.
16. **Las leyendas van al final**, debajo de los botones: se consultan, no se leen antes de actuar.
    Excepción: la de Planificar va arriba, porque su lista no tiene final.
17. **Los títulos de tarjeta van centrados**; los rótulos de sección que encabezan una lista, a la
    izquierda, como la lista. En los diálogos, todo a la izquierda.

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
| **P3** | Rutina | Los huecos de una rutina | P2, P1, X2 |
| **P4** | Hueco | Formulario de un hueco, nuevo o existente | P3, P6 |
| **P5** | Programa nuevo | Nombre, si se activa y los siete días | P1 |
| **P6** | Rutina nueva | Nombre; arranca sin huecos | P1, P5 |
| **X1** | Biblioteca | Ejercicios, con buscador y filtros | Pestaña Ejercicios |
| **X2** | Ficha | Descripción, progresión, notas y dónde se usa | X1 |
| **X3** | Nuevo / editar ejercicio | Nombre, grupo y descripción | X1, X2 |

**Cómo se cuentan.** Un código es una pantalla que hay que programar; los bocetos que comparten
código son la misma pantalla en otro estado (H2 y H2 editando, P4 nuevo, existente y oculto). El
corte está entre **leer y escribir**: la ficha de un ejercicio (X2) y su formulario (X3) son
pantallas distintas, y por lo mismo lo son la semana de un programa (P2) y el formulario de uno
nuevo (P5). En cambio, **crear y editar con el mismo formulario no se separan**: X3 sirve para los
dos, y P4 también, porque un hueco no tiene versión de solo leer. Son un componente con un id
opcional sirviendo a dos rutas.

## Entrenar

### E1 · Hoy

La pantalla de entrada. Arriba, la **tira de la semana**, con las mismas marcas que el calendario
(ver [H1](#h1--calendario)). Debajo, una **tarjeta** con lo de hoy según el programa activo. Más
abajo, **Por recuperar** si queda algo sin hacer, la **última sesión hecha** (lleva a H2) y una
**lista de otras rutinas**.

Qué enseña la tarjeta según el día:

| Situación | La tarjeta |
|---|---|
| Día de entrenamiento | *Hoy toca Push*, con *Empezar Push* |
| Con una sesión empezada y sin terminar | *Continuar Push*, que vuelve a E2 sin preguntar |
| Hoy ya se entrenó | *Hoy · Pull · Hecho*, sin botón y sin lista de otras rutinas: se entrena una rutina al día |
| Lo de hoy ya se hizo por adelantado | *Hoy tocaba Pull · Hecho por adelantado el martes*. El día se comporta como un descanso |
| Día de descanso | *Descanso* y qué toca mañana, sin botón grande |
| Descanso con la semana ya hecha | *Descanso* y qué toca el próximo día, sin lista: *Esta semana ya está hecha* |
| Sin programa activo | *Sin programa*, con *Elegir un programa* (lleva a P1) |
| Primera vez | Una bienvenida (ver [La primera vez](#la-primera-vez)) |

**Por recuperar.** Lo que se quedó sin hacer se puede recuperar **hasta el día antes del mismo día
de la semana siguiente** (el Push del lunes, hasta el domingo). Mientras tanto, E1 lo enseña todo en
una lista, cada entrenamiento con su plazo; el que caduca hoy lo dice en ámbar (*hoy es el último
día*). Cada uno lleva su *Recuperar*, que pregunta antes y abre E2; esa sesión cuenta como la del día
que se recupera.

- **En un día de descanso**, recuperar no cuesta nada: el plan no cambia.
- **En un día de entrenamiento también se puede**, sin pasar por Planificar. Como se entrena una
  rutina al día, lo que tocaba hoy queda por recuperar, y la confirmación lo dice: *Solo se hace una
  rutina al día: el Pull de hoy quedará pendiente, y podrás recuperarlo hasta el martes 22*.
- **Si hoy ya se entrenó o hay una sesión a medias**, la lista sigue saliendo, como recordatorio,
  pero sin botón: *Recupéralo otro día, hasta el domingo 20*.
- **Solo se recupera lo del programa activo.** Al activar otro programa, o al quedarse sin ninguno,
  lo que se faltó con el anterior sigue en el calendario como no hecho, pero deja de ofrecerse:
  del programa antiguo queda solo lo hecho.

**Qué ofrece la lista de abajo**, y qué pregunta al elegir:

- **En un día de entrenamiento** se llama *Otra rutina del programa* y solo ofrece rutinas de días
  posteriores de esta semana, hasta el domingo, como adelantar, y nunca la misma que toca hoy
  (intercambiarla no cambiaría nada). Elegir una pregunta *¿Intercambiar con el miércoles?*: *Sí*
  cambia el plan de los dos días (hoy esa, el miércoles la de hoy) y empieza la sesión; *No* lo deja
  todo como estaba.
  No hay opción de hacerla sin intercambiar: acabaría la misma rutina dos veces en la semana.
- **En un día de descanso**, o en uno cuya rutina ya se hizo por adelantado, se llama *Entrenar hoy
  de todas formas* y ofrece adelantar lo que queda de esta semana, preguntando antes (*¿Adelantar el
  Pull del miércoles?*). Adelantar no cambia el plan. Lo que ya está hecho no sale, y lo que se
  recupera va en *Por recuperar*.
- **Una rutina se puede hacer tantas veces como aparezca en la semana del programa, ni una más.**
  Para entrenar más, se cambia el programa.
- **Sin programa activo** salen todas las rutinas, sin límite de veces: sin plan no hay nada que
  contar, intercambiar ni adelantar. Empezar una sigue pidiendo confirmación.
- **Con una sesión abierta, o si hoy ya se entrenó,** la lista no sale.

### E2 · Sesión en curso

La pantalla importante. Un bloque por hueco de la rutina, en orden; el que se está haciendo va
desplegado y los demás plegados a una línea (nombre y series hechas / objetivo), para no hacer
scroll entre series. El bloque desplegado enseña:

- **El objetivo** del hueco (4 × 6-10).
- **La última vez, en fichas, una por serie**, cada una con su peso (las series de un día pueden ir
  a pesos distintos). Es lo que decide el peso de hoy, así que está en el mismo bloque, sin navegar.
  Es la última vez que se hizo **ese ejercicio en ese hueco**, no la última sesión sin más.
- **Las series de hoy**, con un lápiz y una ✕ cada una.
- **El formulario**: peso y reps con − / +, y variante opcional.

Comportamiento:

- **El formulario arranca con la serie anterior** (ejercicio, peso y variante). Lo normal es cambiar
  solo las reps.
- **El número de la siguiente serie es el mayor + 1**, no la cuenta: si se borra una del medio, no
  se repite un número.
- **Cambiar al comodín**: si el hueco tiene comodines, junto al nombre del ejercicio hay una flecha
  en su propio botón, con recuadro y en verde para que no pase desapercibida. Al tocarla (el nombre
  no abre nada) se despliegan el principal y sus comodines, cada uno con su última vez, y el de hoy
  marcado. Al elegir un comodín, la última vez, el peso con el que arranca el formulario y las
  series que se apunten pasan a ser de ese ejercicio, y el hueco plegado lo dice con la etiqueta
  *comodín*. Se queda elegido para el resto del hueco. Si el principal está oculto, el hueco empieza
  ya con el comodín; un hueco sin comodines no lleva flecha, porque no hay nada que elegir.
- **La variante** va por serie. En las fichas no se escribe: las que tienen variante llevan un
  punto verde, y al mantenerlas pulsadas (o con el ratón encima) sale un globo por encima del dedo.
- **Editar una serie**: el lápiz la carga en el mismo formulario, que pasa a *Guardar cambios ·
  serie 2* con un *Cancelar*. La ✕ pregunta antes de borrar.
- **Sin RPE**: la base de datos lo admite, pero la interfaz no lo pide ni lo enseña.
- **Si la sesión recupera o adelanta otro día**, la cabecera lo recuerda bajo la fecha:
  *Recuperando el Push del lunes 14*.
- **Cada serie se guarda al pulsar su botón**, así que se puede salir de E2 a otras pantallas y
  volver: la sesión queda abierta.
- **Al pie**, *Terminar sesión* y, en rojo, *Cancelar sesión*. Terminar pregunta (y dice cuánto se
  lleva, para darse cuenta de si se termina antes de tiempo) y lleva a H2, con las notas abiertas y
  un botón *Cerrar*. Cancelar deja el día como si no se hubiera empezado: borra la sesión y sus
  series, y pregunta con *Seguir entrenando* como salida.
- **Una sesión abierta de un día para otro cuenta como terminada**: al día siguiente E1 vuelve a
  ofrecer *Empezar*, no *Continuar*.

## Historial

### H1 · Calendario

El mes, con un **color por día de la semana** (no por rutina; más adelante podrá personalizarse).
Cada día lleva una marca, que dice a la vez qué tocaba y qué se hizo ese día:

| Marca | Significa |
|---|---|
| Punto lleno | Ese día se hizo lo que tocaba (o se recuperó o adelantó otro, ver abajo) |
| Aro vacío | Tocaba y no se hizo |
| Aro con flecha → | Lo que tocaba se hizo más tarde, otro día (recuperado) |
| Aro con flecha ← | Lo que tocaba se hizo antes, otro día (adelantado) |
| Punto lleno con flecha | Ese día se hizo otra rutina, y la suya se hizo otro día |
| Punto lleno y aro | Ese día se hizo otra rutina, y la suya sigue sin hacer |
| Apagado | Próximo |

**El punto lleno lleva el color de lo que se hizo; el aro y la flecha, el de lo que tocaba.** Así,
si el martes se adelantó el Pull del miércoles, el martes lleva el punto del Pull y el miércoles el
aro con la flecha hacia atrás. La leyenda va plegada bajo las cifras (*Ver leyenda*), porque se
consulta poco.

Debajo, las cifras del mes (entrenados, movidos, no hechos) y dos botones: *Planificar los próximos
días* (H4) y *Ver resumen* (H5).

**Tocar un día enseña siempre lo que se hizo ese día**, nunca lo de otro:

- Si ese día hubo sesión, lleva a H2.
- Si no, se comporta como un descanso, aunque su rutina se hiciera otro día. Si es un día pasado,
  abre una hoja para apuntar lo que se hizo: ofrece lo mismo que habría ofrecido Hoy aquel día
  (*Recuperar el Pull del miércoles 9*, si seguía en plazo), salvo intercambiar, porque el pasado
  no se planifica; y las demás rutinas, que se apuntan sin contar para ningún día del programa.
  Elegir pregunta antes y abre E2 con esa fecha. Sirve para pasar la libreta de meses anteriores o
  para el día que se entrenó y se olvidó apuntar. No cambia lo planificado: registra lo que pasó.

**Cómo se decide si un día está hecho, movido o sin hacer**, sin que el usuario marque nada: cada
sesión cuenta para un día (ver [Vocabulario](#vocabulario)). Un día planificado está **hecho** si lo
cuenta una sesión de ese mismo día, **movido** si lo cuenta una de otro día, y **sin hacer** si no
lo cuenta ninguna y ya pasó.

Cada mes se compara con **el programa que estaba activo entonces**, no con el de hoy: si no, un mes
de hace un año marcaría como faltados días que entonces no tocaban. Por lo mismo, **editar un
programa o activar otro no cambia los días que ya pasaron** ni los que ya están hechos por
adelantado.

### H2 · Un día

La única pantalla de ver un día. Arriba, las cifras (series, volumen y huecos mejorados). Por
hueco: qué ejercicio se hizo (y si fue el comodín), sus series, una insignia de mejora (`+2 kg`,
`+3 reps`, `igual`, `nuevo`) y la última vez en fichas. La comparación **mira siempre hacia atrás
desde ese día**, con la última vez que se hizo ese ejercicio en ese hueco, y por eso lleva su
fecha. La flecha de cada hueco lleva a su progresión (H3). Si la sesión cuenta para otro día, la
cabecera lo dice bajo la fecha: *Recuperado del lunes 14*, o *Adelantado del miércoles 16*.

**Editar**: lápiz y ✕ en cada serie. El lápiz despliega el formulario bajo la serie y cada cambio
se guarda con su *Guardar cambios*; la ✕ pregunta antes. *Listo* sale del modo editar. Además:

- **La fecha pasa a ser un campo**, por si la sesión se apuntó en otro día. Sigue contando para
  el mismo día del plan, así que solo puede ir donde se habría podido hacer: hacia delante, hasta
  el día antes del mismo día de la semana siguiente; hacia atrás, dentro de la misma semana. Un
  día que ya tiene sesión tampoco vale. En los dos casos el cambio no se hace y el campo explica
  por qué (y, si el día está ocupado, que la otra sesión se mueve desde su propio día).
- **Al pie, *Borrar este día*** en rojo: quita la sesión entera con sus series, para arreglar un
  día o una rutina apuntados por error. Pregunta antes. El día que contaba vuelve a quedar sin
  hacer, y se puede recuperar si sigue en plazo.

### H3 · Progresión

La gráfica de un ejercicio, con un punto por sesión. Arriba, el rango (1 mes, 3 meses, 6 meses,
1 año, todo) y un conmutador de qué se pinta sobre los mismos puntos:

- **Peso**: el mejor peso de cada sesión.
- **Volumen**: peso × reps sumado. Enseña las semanas en que el peso no sube pero se hacen más reps.
- **1RM estimado**: el peso que se levantaría una sola vez, `peso × (1 + reps / 30)` (Epley). Sirve
  para comparar series de rangos distintos (60 × 10 frente a 65 × 6). Sale de datos que ya se
  guardan.

Tocar un punto enseña la sesión en un globo que se recoloca para no tapar la línea. Debajo, la
lista de sesiones, que lleva a cada día en H2. Se descartó un selector "este ejercicio / este
hueco": pintar la barra y la máquina en la misma línea no significa nada.

### H4 · Planificar

Los días **de hoy en adelante**, agrupados por semanas, sin límite (al bajar aparecen más). Tocar un
día abre una hoja con lo que toca según el programa, las rutinas para sustituirlo y *Descanso*. Se
guarda al tocar, sin botón de guardar. **Sustituye, no intercambia.** Los días cambiados llevan su
marca.

- *Restablecer este día* devuelve un día a lo que dice el programa. No es lo mismo que elegir a mano
  la rutina del programa, que dejaría el día marcado como cambiado.
- *Restablecer la semana* devuelve los siete días, y pregunta antes.
- El pasado no se planifica: lo que pasó se registra (desde H1), no se cambia.
- **Arriba, lo pendiente de recuperar**, para tenerlo presente al planificar. Solo informa: se
  recupera desde Hoy, adonde lleva.
- **Un día ya hecho por adelantado** lleva *hecho el martes*. Si su rutina se pasa a otro día de
  la semana, el adelanto pasa a contar para ese día. Lo que no se puede es dejar ese entrenamiento
  sin ningún día: la app lo explica y pide poner antes la rutina en otro día.
- Al activar otro programa, la app avisa de los días planificados y ofrece quitarlos.

### H5 · Resumen

Progresión general, no por ejercicio: el volumen por semana o por mes, de todo o de una rutina; el
reparto del mes por rutina; las series por grupo muscular; y la **constancia del año**, con dos
alturas por mes (gris = planificado, verde = entrenado; el hueco es lo que se faltó). Lo
recuperado y lo adelantado cuentan como entrenado, en el mes del día que tocaba.

## Programas y rutinas

### P1 · Programas y rutinas

Dos secciones. **Programas**, con el activo marcado y desde cuándo lo está. **Rutinas**, todas las
del usuario, con en cuántos programas se usa cada una. Sin esta segunda sección, una rutina que no
estuviera en ningún programa sería inalcanzable. Al pie, una línea explica la diferencia: una
rutina son los ejercicios de un día; un programa las reparte en la semana.

### P2 · Semana del programa

La plantilla que se repite: qué rutina toca cada día, o descanso. Tocar un día lleva a su rutina
(P3). Mover un día concreto no se hace aquí, sino en H4.

- **Arriba del todo, el interruptor *Programa activo*.** Es lo único que se cambia sin entrar en
  *Editar*, porque no toca el programa, solo cuál está en uso. Guarda al momento, así que pregunta
  antes. Apagarlo deja sin programa activo; encenderlo en otro dice cuál deja de estarlo. Se puede
  no tener ninguno.
- **Editando**: el nombre pasa a ser un campo; la › de un día abre la hoja de elegir rutina (la
  misma que en P5) y la nueva sustituye a la que hubiera; la ✕ deja el día en descanso. Al pie,
  *Ocultar programa* y *Borrar programa*.
- **Un día, una rutina.** Si un día ya tiene rutina y se le pone otra, la nueva la sustituye.
- **Lo hecho por adelantado se queda como estaba.** Si el Leg del viernes ya se hizo el martes y
  los viernes pasan a Push, ese viernes sigue contando como Leg hecho, y el Push empieza el viernes
  siguiente. Los días que ya pasaron tampoco cambian.

### P3 · Rutina

Los huecos de la rutina en orden, cada uno con su objetivo y sus comodines. Tocar un hueco lleva a
P4. *Añadir hueco* y *Duplicar rutina* (una copia independiente, para que dos versiones diverjan).

- **Editando**: el nombre pasa a ser un campo y cada hueco gana un asa para reordenarlo. Al pie,
  *Ocultar rutina* y *Borrar rutina*. Ocultar y borrar un hueco no están aquí sino dentro del
  propio hueco (P4), que es donde se avisa de lo que se pierde.
- **Los huecos se numeran por su posición** entre los visibles (1, 2, 3…), no por el orden
  guardado: ocultar el primero renumera los demás.

### P4 · Hueco

Formulario: ejercicio principal (de la biblioteca), comodines (varios), series objetivo y reps
mínimas y máximas, con − / +. Tres estados de la misma pantalla:

- **Nuevo**: solo *Guardar* y *Cancelar*.
- **Existente**: además, *Ocultar hueco* y *Borrar hueco*, cada uno con su diálogo.
- **Oculto**: un aviso arriba y *Mostrar hueco* como acción principal.

### P5 · Programa nuevo

Todo en una pantalla: nombre, *Activarlo al crearlo* y los siete días. El + de un día abre una hoja
con las rutinas del usuario para reutilizarlas, y un *+ Nueva rutina* que lleva a P6. Los días
vacíos son descanso. **Nada se guarda hasta pulsar *Crear*.**

### P6 · Rutina nueva

Pide el nombre y arranca sin huecos; *Añadir hueco* lleva a P4. Si se crea desde la hoja de elegir
rutina, queda asignada a ese día. En cualquier caso entra en la biblioteca de rutinas.

## Ejercicios

### X1 · Biblioteca

Buscador, filtro de origen (*Todos · Predefinidos · Míos*) y filtro por grupo muscular. Cada
ejercicio dice su grupo y su origen, y la etiqueta *nota* marca los que tienen notas del usuario.
*Nuevo ejercicio* lleva a X3.

### X2 · Ficha

Descripción; acceso a la progresión (H3) con el peso actual; las notas personales con su fecha
(*Añadir nota*); y *Rutinas donde se usa*, con el hueco, la rutina y su programa (lleva a P3).
Si es propio, *Editar* arriba (lleva a X3) y *Ocultar* y *Borrar* al pie.

**Los predefinidos no se pueden editar, ocultar ni borrar**: vienen con la app y son compartidos
por todos los usuarios. Su ficha no tiene *Editar* ni botones al pie, y lo dice en una línea. Las
notas sí, porque son del usuario.

### X3 · Nuevo / editar ejercicio

Nombre, grupo muscular y descripción. Bajo la descripción, una línea aclara la diferencia con las
notas: la descripción es información general del ejercicio; lo que sea de uno va en las notas de
su ficha.

## Ocultar y borrar

Programas, rutinas, huecos y ejercicios propios se pueden ocultar o borrar. **Ocultar** los quita
de la vista pero **conserva su historial**; **borrar** los elimina con todo lo que dependa de ellos.
Cada uno tiene su sitio: el ejercicio en su ficha (X2), el hueco en P4, y el programa y la rutina en
el modo editar de P2 y P3.

- **Sin historial, borrar es directo**, porque no hay nada que perder (tras la confirmación de
  siempre). Una rutina que ya estuvo en el plan algún día pasado cuenta como con historial, aunque
  no se entrenara: borrarla quitaría esos días del calendario, así que pide elegir entre ocultarla o
  borrarla, como un programa que estuvo activo.
- **Con historial, borrar cuenta lo que se pierde** —cuántas series, qué huecos, qué notas— y ofrece
  ocultar en su lugar. En rojo, porque no se puede deshacer.
- **Ocultar es reversible de verdad.** Una rutina oculta no sale del programa: el día la conserva,
  en gris, y cuenta como descanso; al mostrarla, vuelve a estar como estaba. Lo mismo un ejercicio
  oculto dentro de su hueco (se ve en gris, y E2 propone el comodín) o un hueco oculto dentro de su
  rutina. Si ocultar quitara la asignación, mostrarla no podría deshacerlo.
- **Si a ese día se le pone otra rutina**, la nueva sustituye a la oculta, y mostrar la oculta ya no
  recupera el día: el sitio ya tiene dueño.
- **Un programa oculto deja de ser el activo** si lo era, y no vuelve a serlo solo al mostrarlo.
- **Cada lista con algo oculto lleva un *Ver N ocultos* al pie** (P1 una vez por sección, P3 y X1),
  que despliega los ocultos en gris, con la fecha desde la que lo están. Tocar uno lo abre en su
  estado oculto: un aviso arriba, *Mostrar* como acción principal y *Borrar* debajo, sin *Editar*.
- **Las listas para elegir no enseñan lo oculto** (la hoja de rutinas de P5, el selector de
  ejercicio de P4, el de rutina de H4): ocultar significa que deja de ofrecerse. Para volver a
  usarlo, primero se muestra.

## La primera vez

Recién instalada, la app no tiene rutinas, ni programas, ni historial. Ejercicios sí: viene con una
biblioteca de predefinidos, así que se puede montar una rutina sin crear ninguno antes.

- **E1** da la bienvenida y explica los dos pasos (primero rutinas, luego un programa que las
  reparta), con *Ir a Programas*. Debajo, que también se puede entrenar sin programa. En cuanto
  hay una rutina, la bienvenida deja paso a *Sin programa*, con la lista de rutinas.
- **P1** dice que cada sección está vacía, y *Nueva rutina* pasa a ser la acción principal, porque
  es el primer paso.
- **X1** solo puede estar vacío en *Míos*: lo dice, recuerda dónde están los predefinidos, y *Nuevo
  ejercicio* pasa a ser la acción principal.

## Flujos

**Un día de gimnasio**

1. Abre la app. E1 dice *Hoy toca Push*. Pulsa *Empezar Push* y confirma.
2. E2 aparece con el hueco 1 desplegado: la última vez en fichas y el formulario ya relleno.
3. Hace la primera serie, ajusta las reps si cambian y pulsa *Guardar serie 1*. El botón pasa a
   *Guardar serie 2*, con los mismos valores.
4. Repite. Al acabar el hueco, despliega el siguiente.
5. En el hueco 3 la máquina está ocupada: toca la flecha junto al nombre del ejercicio y elige
   el comodín. La última vez y el peso pasan a ser los del comodín.
6. Se equivoca al apuntar una serie: el lápiz la carga en el formulario y la corrige.
7. Al acabar, *Terminar sesión* y confirma. H2 le enseña en qué huecos mejoró. Escribe una nota si
   quiere y pulsa *Cerrar*.

**"No pude ir el lunes y voy el martes"**: el martes, E1 dice *Descanso* y, en *Por recuperar*,
*Push del lunes 14 · hasta el domingo 20*, con *Recuperar*. Confirma y entrena. El calendario
pinta después el lunes con la flecha y el martes con el punto del Push. Si no lo recupera antes del
domingo, el lunes queda como no hecho.

**"Falté el lunes y el miércoles toca Pull"**: el miércoles, *Por recuperar* sigue ofreciendo el
Push. Si lo recupera ese día, el Pull del miércoles pasa a *Por recuperar*, con su propio plazo, y
así se va corriendo la semana.

**"Esta semana el miércoles no puedo"**: Historial → *Planificar los próximos días* → el miércoles →
*Descanso*, o la rutina que prefiera. El programa no cambia; solo ese día.

**Montar un programa desde cero** (una vez, sentado): Programas → *Nueva rutina* → "Push" → *Añadir
hueco* → ejercicio, comodines, series y reps → *Guardar* → siguiente hueco… Luego *Nuevo programa*
→ nombre → lunes → Push, miércoles → Pull… → *Activarlo al crearlo* → *Crear*.

**Pasar la libreta de meses anteriores**: Historial → el mes → un día pasado sin sesión → la rutina
→ E2 con esa fecha, serie a serie.

**"¿Subo peso en el press banca?"**: Ejercicios → buscar → la ficha → la progresión. O desde un día
del historial, con la flecha del hueco.

**Corregir una serie de otro día**: Historial → el día → *Editar* → el lápiz de la serie.

## Lo que necesita del backend

Todo lo que pide este diseño ya existe en el backend: programas, qué programa estuvo activo en cada
periodo, días planificados, ocultar con fecha, sesiones terminadas, ejercicios predefinidos, el
historial de un hueco filtrado por ejercicio, una sesión por día, días de programa con fecha de
vigencia, qué día del plan cuenta cada sesión y el plazo para moverla, el estado de cada día, que
Planificar y editar un programa respeten lo hecho por adelantado, y que borrar una rutina que ya
estuvo en el plan pida elegir. El estado de cada día y lo que se ofrece en Hoy se calculan en el
backend, para que la web y el móvil digan siempre lo mismo.

Lo que queda es construir las pantallas.

## Por decidir

Hablado, sin prisa: se decidirá cuando la app esté en uso.

- **Objetivo por ejercicio y no por hueco.** Hoy las series objetivo y el rango de reps son del
  hueco, y el comodín los hereda. Queda por ver si cada ejercicio del hueco debería llevar los
  suyos. Se deja así porque el objetivo es una guía, no una regla, y duplicaría el formulario de P4
  para un caso raro.
- **Ocultar predefinidos**: haría falta guardarlo por usuario, porque ocultar la fila compartida la
  ocultaría para todos.
- **Temporizador de descanso** entre series, en E2.
- **Peso corporal**, para comparar con el peso levantado.
- **Cardio**: la app está pensada para series de peso por repeticiones, y el cardio (cinta, bici,
  remo) se mide de otra forma, con tiempo, distancia o ritmo. Tendría sentido como grupo aparte,
  con su propio registro.
