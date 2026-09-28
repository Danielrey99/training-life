# Backend ⚙️

API REST del proyecto, construida con **FastAPI** (Python) sobre **PostgreSQL**, usando
**SQLAlchemy** como ORM y **Alembic** para gestionar los cambios del esquema de base de datos.

Ningún frontend (web ni móvil) accede directamente a la base de datos: siempre pasan por esta API.

**Índice:** [Estado actual](#estado-actual) · [Estructura](#estructura) ·
[Cómo ejecutarlo](#cómo-ejecutarlo) · [Modelos y migraciones](#modelos-y-migraciones-alembic) ·
[Tests](#tests) · [Convenciones de código](#convenciones-de-código) ·
[Variables de entorno](#variables-de-entorno) · [Autenticación](#autenticación-pendiente) ·
[Endpoints](#endpoints-disponibles)

## Estado actual

🚧 **Backend del MVP completo.** Están implementados el CRUD de `Ejercicio`, el de `Rutina` (con sus
huecos y comodines), el de `Entrenamiento`/`Serie` —el registro real, con peso, repeticiones y RPE—
y las notas personales por ejercicio. Encima de las rutinas están los **programas**, que dicen qué
rutina toca cada día de la semana.

El borrado con historial (`?modo=ocultar` / `?modo=definitivo`) cubre ya todos los usos cruzados
reales:

- un ejercicio usado en una rutina, o con series registradas
- una rutina con huecos definidos o con entrenamientos
- un hueco con series registradas

Ocultar guarda desde cuándo está oculta cada cosa (`oculto_desde`, nula si está visible), no un
simple sí/no: la app enseña esa fecha, y el sí/no se deduce de ella. Lo contrario de ocultar es
*mostrar* (`POST .../mostrar`). Lo oculto se puede abrir, borrar y volver a mostrar, pero no editar ni
usar: eso da 409 hasta que se muestre. Las notas son la excepción: se pueden añadir, editar y borrar
también en un ejercicio oculto, porque son tuyas y no lo usan (y son un buen sitio para apuntar por
qué se ocultó).

`Entrenamiento` y `Serie` se quedan fuera de ese mecanismo a propósito: son el propio historial, no
algo que otras tablas tengan que proteger, así que se borran directo.

Cada sesión sabe si está **en curso**: abierta (sin `terminada_en`) y de hoy. Solo puede haber una a
la vez, y una que se quedó abierta de un día para otro cuenta como terminada sin que nadie tenga que
cerrarla. "Hoy" se calcula en la zona horaria del usuario, no en la del servidor.

Sobre ese historial se consulta la **progresión**, en dos vistas que no se sustituyen: la de un
ejercicio concreto (`/ejercicios/{id}/historial`) y la de un hueco entero de una rutina
(`/rutinas/{id}/slots/{slot_id}/historial`), que incluye también los días en que ese hueco se hizo
con un comodín. Las dos siguen respondiendo aunque el ejercicio, el hueco o la rutina estén
ocultados: ocultar retira algo de circulación, no borra lo que ya entrenaste con ello.

Mientras no exista autenticación real (JWT), la API trabaja con un único usuario sembrado por
migración —datos placeholder, no reales— y un `usuario_id` hardcodeado en el código.

La biblioteca viene con **59 ejercicios predefinidos**, sembrados por migración y repartidos por
los 17 grupos musculares, para que la app no arranque vacía: se puede montar una rutina sin crear
ningún ejercicio antes. Son de todos y de nadie, así que no se pueden editar, ocultar ni borrar;
las notas sobre ellos, en cambio, son de cada usuario.

Los **grupos musculares** tampoco se crean desde la API: son 17 fijos, sembrados por migración, los
que se usan para clasificar ejercicios de gimnasio: Pecho, Espalda, Trapecio, Lumbar, Hombro,
Bíceps, Tríceps, Antebrazo, Abdomen, Oblicuos, Cuádriceps, Isquiotibiales, Glúteo, Aductores,
Abductores, Pantorrilla y Cuello. No se baja a músculos sueltos a propósito: cada ejercicio tiene un
solo grupo, y con grupos muy finos cualquier elección sería engañosa.

**Próximo paso:** el backend ya tiene todo lo que pide el [diseño de la app](../README.md#diseño-de-la-app),
así que lo siguiente es rehacer la web siguiendo ese diseño. Del backend queda pendiente, para
cuando lo pida la pantalla del calendario, calcular qué días se entrenaron, se movieron o no se
hicieron.

## Estructura

```
backend/
├── app/
│   ├── __init__.py         # marca app/ como paquete Python importable (vacío)
│   ├── main.py             # crea la app FastAPI y registra los routers
│   ├── database.py         # conexión a PostgreSQL: engine, sesión, dependencia get_db
│   ├── models.py           # tablas (modelos SQLAlchemy)
│   ├── schemas.py          # forma de los datos que entran/salen de la API (Pydantic)
│   ├── auth.py             # quién es "el usuario actual" (hardcodeado hasta que exista JWT)
│   ├── historial.py        # la consulta de progresión, compartida por dos endpoints
│   ├── fechas.py           # qué día es "hoy" en la zona horaria del usuario, no la del servidor
│   ├── ocultos.py          # qué se puede hacer con algo oculto (leer y borrar sí, editar no)
│   ├── plan.py             # qué toca cada día, según el programa activo en esa fecha
│   └── routers/            # los endpoints en sí, un archivo por entidad
│       ├── ejercicios.py          # CRUD de ejercicios, y las notas de cada uno
│       ├── grupos_musculares.py   # solo lectura: listar el catálogo de grupos musculares
│       ├── rutinas.py             # CRUD de rutinas, huecos (slots) y comodines, todo anidado
│       ├── entrenamientos.py      # CRUD de entrenamientos y series, anidado
│       ├── programas.py           # programas y qué rutina toca cada día de la semana
│       └── plan.py                # el plan de un rango de fechas
├── alembic/
│   ├── env.py              # configuración de Alembic (a qué BD conectarse, qué modelos vigilar)
│   └── versions/           # historial de migraciones, una por cambio de esquema
├── tests/                   # tests automáticos (pytest)
│   ├── conftest.py          # base de datos de tests, cliente HTTP y limpieza entre tests
│   ├── test_borrados.py     # borrado con historial y cascadas
│   ├── test_aislamiento_por_usuario.py
│   ├── test_crud.py         # camino feliz y validaciones de entrada
│   ├── test_historial.py    # la progresión por ejercicio y por hueco
│   ├── test_sesiones.py     # la sesión en curso: terminarla y no empezar dos a la vez
│   ├── test_programas.py    # programas, sus días y cómo conviven con las rutinas
│   ├── test_relaciones.py   # borrar un padre con sus hijos ya cargados en memoria
│   ├── test_plan.py         # qué toca cada día, también en el pasado
│   └── test_infraestructura.py
├── alembic.ini              # configuración general de Alembic
├── requirements.txt         # dependencias Python
├── requirements-dev.txt     # dependencias solo de desarrollo (tests, linter)
├── ruff.toml                # estilo del código: ancho de línea y qué queda fuera del formateo
├── CONVENCIONES.md          # cómo se comenta y se formatea el código
├── Dockerfile                # receta para construir la imagen del backend
├── .dockerignore             # qué no copiar a la imagen al construirla (igual que .gitignore, pero para Docker)
└── .env.example              # plantilla del .env para ejecutar el backend fuera de Docker
```

Cómo dependen unos de otros, de arriba abajo:

```
main.py         registra los routers y nada más, sin lógica de negocio propia
   ↑
routers/        los endpoints: juntan las cuatro piezas de abajo
   ↑
schemas.py      qué JSON entra y sale        auth.py    de quién son los datos
models.py       las tablas
   ↑
database.py     la sesión y la conexión — no depende de nada más del proyecto
```

Los `routers/` no son del todo independientes entre sí: `rutinas.py` y `entrenamientos.py`
reutilizan una función de `ejercicios.py` (comprobar que un ejercicio existe y es visible para el
usuario actual) en vez de repetir esa lógica. Tiene sentido: tanto un hueco de rutina como una serie
siempre referencian un ejercicio ya existente.

`alembic/` va aparte. Solo lee `models.py` (qué tablas debería haber) y `database.py` (a qué
Postgres conectarse), y la API no lo usa en tiempo de ejecución: se ejecuta puntualmente, para crear
o actualizar tablas.

## Cómo ejecutarlo

Lo normal es levantarlo junto con la base de datos desde la raíz del repo con `docker compose up`
(ver el [README raíz](../README.md)). Ese comando, de una vez:

1. construye la imagen,
2. instala `requirements.txt`,
3. **aplica las migraciones pendientes**,
4. y arranca `uvicorn` con recarga automática.

### Sin Docker, por ejemplo para usar Alembic desde tu propio editor

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # en Windows
pip install -r requirements.txt
```

Copia `backend/.env.example` a `backend/.env`: apunta a `localhost:5433`, el puerto que Postgres
expone al host. Necesitas el contenedor de la base de datos levantado (`docker compose up -d
postgres`), aunque no uses el del backend.

```bash
uvicorn app.main:app --reload
```

## Modelos y migraciones (Alembic)

![Esquema de la base de datos de Training Life](../docs/esquema_base_datos.svg)

Las 13 tablas y sus claves ajenas, con la regla de borrado de cada una —`CASCADE` arrastra al
hijo, `RESTRICT` impide borrar al padre mientras exista— y qué tablas se pueden ocultar (columna
`oculto_desde`), cuáles son historial y cuáles son accesorios que se borran con su padre. El diagrama
se mantiene a mano: al añadir o cambiar una tabla hay que actualizarlo.

Cada tabla se define primero como una clase Python en `app/models.py`. Para que ese cambio llegue de
verdad a PostgreSQL hace falta generar y aplicar una migración:

```bash
# 1. Genera un archivo de migración comparando los modelos actuales contra la base de datos real
.venv\Scripts\python -m alembic revision --autogenerate -m "descripción del cambio"

# 2. Revisa el archivo generado en alembic/versions/ (Alembic no siempre acierta al 100%)

# 3. Aplica la migración a la base de datos
.venv\Scripts\python -m alembic upgrade head
```

Con Docker el paso 3 no hace falta: el contenedor ejecuta `alembic upgrade head` cada vez que
arranca.

El paso 1 sí es manual, y puedes hacerlo sin Docker contra el Postgres de `localhost:5433`. La
migración que generes llega al contenedor al instante, sin reconstruir la imagen, porque el bind
mount cubre toda la carpeta `backend/`.

## Tests

```bash
cd backend
.venv\Scripts\python -m pip install -r requirements-dev.txt   # solo la primera vez
.venv\Scripts\python -m pytest tests/
```

Corren contra **PostgreSQL de verdad**, en una base de datos aparte (`training_life_test`) dentro
del mismo contenedor que la de desarrollo, así que hace falta tener Postgres levantado
(`docker compose up -d postgres`).

No se usa SQLite a propósito: buena parte de la lógica del backend son cascadas de borrado y
restricciones `ON DELETE`, que SQLite no reproduce. Unos tests sobre SQLite pasarían en verde con
esos fallos vivos.

No hay ningún paso previo que recordar:

- Si la base de tests no existe todavía —la primera vez, o tras un `docker compose down -v`— la
  propia tanda la crea.
- Su esquema se construye aplicando las migraciones, así que cada ejecución comprueba de paso que la
  cadena funciona desde cero.
- La base de desarrollo no se toca nunca: si la conexión no apunta a `training_life_test`, los tests
  abortan antes de ejecutar nada.

| Archivo | Qué cubre |
|---|---|
| `test_borrados.py` | El borrado con historial (`modo=ocultar`/`definitivo`) y sus cascadas |
| `test_aislamiento_por_usuario.py` | Que los datos de un usuario no son visibles ni editables por otro |
| `test_crud.py` | Camino feliz de cada CRUD y las validaciones de entrada |
| `test_historial.py` | La progresión por ejercicio y por hueco: agrupación por sesión, límites y filtros de fecha y de ejercicio |
| `test_sesiones.py` | La sesión en curso: terminarla, que una abierta de otro día no cuente, que no se puedan empezar dos a la vez y los filtros del listado |
| `test_programas.py` | Los programas y sus días: una rutina en varios días y programas, un día con una sola rutina, qué les pasa a los días cuando su rutina se oculta o se borra, y activar, ocultar y borrar programas sin dejar nunca dos activos |
| `test_relaciones.py` | Qué pasa al borrar un padre con la lista de hijos ya cargada en memoria: que los hijos que se borran con él se borren, y que los que lo impiden lo sigan impidiendo |
| `test_plan.py` | Qué toca cada día: con y sin programa, un mes pasado comparado con el programa de entonces, una rutina oculta que cuenta como descanso desde su fecha, los días cambiados a mano (que el pasado no se toca) y el intercambio de dos días |
| `test_infraestructura.py` | Que el propio andamiaje de los tests funciona, y que las migraciones sembraron los grupos musculares y los ejercicios predefinidos |

## Convenciones de código

Cómo se comenta y se formatea el código está en **[CONVENCIONES.md](CONVENCIONES.md)**. En resumen:

- **Docstring y `#` no se eligen por longitud, sino por posición**: el docstring documenta un módulo,
  una clase o una función (y FastAPI publica el de cada endpoint en `/docs`); el `#` explica por qué
  una línea concreta está así.
- Docstrings según [PEP 257](https://peps.python.org/pep-0257/), en español, y **solo cuando el
  nombre no basta**: repetir el nombre en prosa es ruido.
- Comentarios lo más cortos que se entiendan, explicando el **porqué** y nunca el qué.
- El formato lo aplica `ruff` a 100 columnas (`ruff.toml`).

## Variables de entorno

| Variable | Dónde se define | Descripción |
|---|---|---|
| `DATABASE_URL` | Inyectada por `docker-compose.yml` (raíz) cuando se ejecuta en Docker; o por `backend/.env` cuando se ejecuta suelto | Cadena de conexión a PostgreSQL. Dentro de Docker el host es `postgres` (nombre del servicio); fuera de Docker es `localhost:5433` (puerto publicado al host). |
| `ZONA_HORARIA` | Opcional; por defecto `Europe/Madrid` | En qué zona horaria se calcula qué día es "hoy" (la sesión en curso, lo que se puede planificar). El contenedor corre en UTC, y sin esto una sesión empezada pasada la medianoche en España caería en el día anterior. |

## Autenticación (pendiente)

Todavía no hay JWT. Todos los endpoints trabajan con un único usuario fijo (`app/auth.py`, función
`get_usuario_actual_id`) — la fila sembrada por migración. Cuando se implemente JWT solo cambia esa
función; los endpoints no necesitan tocarse.

## Endpoints disponibles

### General

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Comprobación de que la API está viva. Devuelve `{"status": "ok"}`. |
| `GET` | `/docs` | Documentación interactiva (Swagger UI), autogenerada por FastAPI. |
| `GET` | `/grupos-musculares` | Lista el catálogo de grupos musculares (sembrado por migración, sin CRUD propio). |

### Ejercicios

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/ejercicios` | Lista los ejercicios visibles para el usuario actual (predefinidos + propios, sin los ocultos). Con `?ocultos=true`, lista en cambio los propios ocultados. |
| `GET` | `/ejercicios/{id}` | Obtiene un ejercicio por id, también si está oculto (404 si no existe o es de otro usuario). |
| `POST` | `/ejercicios` | Crea un ejercicio propio del usuario actual. |
| `PUT` | `/ejercicios/{id}` | Edita un ejercicio propio (403 si es de otro usuario o predefinido, 409 si está oculto: hay que mostrarlo antes). |
| `DELETE` | `/ejercicios/{id}` | Borra un ejercicio propio. Sin uso asociado, lo borra de verdad; en uso, hace falta `?modo=ocultar` (borrado lógico) o `?modo=definitivo` (pierde el historial) — sin ninguno de los dos, devuelve 409 explicando dónde se usa (rutina y hueco concretos) y cuántas notas se perderían. Tus notas nunca bloquean el borrado: se van siempre con el ejercicio, y `?modo=ocultar` las conserva. |
| `POST` | `/ejercicios/{id}/mostrar` | Deshace un `?modo=ocultar`: el ejercicio vuelve a ofrecerse para usarlo. |
| `GET` | `/ejercicios/{id}/historial` | Los días en que se hizo este ejercicio, del más reciente al más antiguo, con las series de cada día. Acepta `?desde=`, `?hasta=` (fechas inclusivas) y `?limite=`, que cuenta **sesiones**, no series — 50 por defecto, 500 como máximo. Sigue funcionando aunque el ejercicio esté ocultado: ocultar no borra el historial. |

### Notas de un ejercicio

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/ejercicios/{id}/notas` | Lista tus notas personales sobre ese ejercicio, de la más reciente a la más antigua. Solo las tuyas, incluso si el ejercicio es predefinido y por tanto lo comparten todos los usuarios. Funciona también con el ejercicio oculto, igual que añadir, editar o borrar notas. |
| `POST` | `/ejercicios/{id}/notas` | Añade una nota. Se pueden acumular varias sobre el mismo ejercicio: son independientes, no se sobreescriben. |
| `PUT` | `/ejercicios/{id}/notas/{nota_id}` | Edita una nota propia (403 si es de otro usuario). |
| `DELETE` | `/ejercicios/{id}/notas/{nota_id}` | Borra una nota suelta. Sin `?modo`: nada depende de una nota. |

### Rutinas, huecos y comodines

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/rutinas` | Lista las rutinas activas del usuario actual. Con `?ocultas=true`, lista en cambio las ocultadas. |
| `GET` | `/rutinas/{id}` | Obtiene una rutina con sus huecos y comodines anidados, también si está oculta, y con sus huecos ocultos incluidos. |
| `POST` | `/rutinas` | Crea una rutina (sin huecos todavía). |
| `PUT` | `/rutinas/{id}` | Edita el nombre de una rutina propia (409 si está oculta). |
| `DELETE` | `/rutinas/{id}` | Borra una rutina propia. Mismo patrón que `Ejercicio`: directo si no tiene huecos ni historial; si tiene, exige `?modo=ocultar` o `?modo=definitivo` (que borra también sus huecos y comodines, en transacción). |
| `POST` | `/rutinas/{id}/mostrar` | Deshace un `?modo=ocultar`: la rutina vuelve a ofrecerse para usarla. |
| `POST` | `/rutinas/{id}/slots` | Añade un hueco a una rutina propia. |
| `PUT` | `/rutinas/{id}/slots/{slot_id}` | Edita un hueco (409 si el hueco o su rutina están ocultos). |
| `DELETE` | `/rutinas/{id}/slots/{slot_id}` | Borra un hueco. Mismo patrón que `Ejercicio`/`Rutina`: directo si no tiene series registradas; si tiene, exige `?modo=ocultar` o `?modo=definitivo`. |
| `POST` | `/rutinas/{id}/slots/{slot_id}/mostrar` | Deshace un `?modo=ocultar`: el hueco vuelve a su rutina, en el mismo sitio. |
| `GET` | `/rutinas/{id}/slots/{slot_id}/historial` | La progresión del hueco entero: los días en que se entrenó, con qué ejercicio se hizo cada serie (principal o comodín) y con cuánto peso. Mismos filtros que el historial de un ejercicio, más `?ejercicio_id=` para quedarse solo con las series de ese ejercicio en el hueco: es la "última vez" con la que se compara al entrenar (con `?hasta=` el día anterior y `?limite=1`), que tiene que ser con el mismo ejercicio y no con el comodín de otra semana. También sigue funcionando con el hueco o la rutina ocultados. |
| `POST` | `/rutinas/{id}/slots/{slot_id}/alternativas` | Añade un ejercicio comodín al hueco (409 si ya lo era). |
| `DELETE` | `/rutinas/{id}/slots/{slot_id}/alternativas/{ejercicio_id}` | Quita un comodín del hueco. |

### Programas

Un programa reparte rutinas en la semana: qué rutina toca cada día (1 = lunes … 7 = domingo). Las
rutinas no pertenecen a ningún programa: la misma puede estar en varios programas y en varios días
de uno, y cada rutina dice en cuántos programas aparece (`num_programas`). Un día sin rutina es
descanso.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/programas` | Lista los programas visibles del usuario. Con `?ocultos=true`, los que ha ocultado. |
| `GET` | `/programas/{id}` | Un programa con sus días, también si está oculto. Cada día trae su rutina con su `oculto_desde`: una rutina oculta sigue en el día (se enseña en gris y cuenta como descanso), para que mostrarla de nuevo lo deje como estaba. |
| `POST` | `/programas` | Crea un programa con sus días de una vez (`{nombre, dias: [{dia_semana, rutina_id}], activar}`): o se guarda todo o nada. Con `activar: true` queda en uso desde hoy. 422 si un día se repite, 404 si una rutina no es tuya o está oculta. |
| `PUT` | `/programas/{id}` | Cambia el nombre (409 si está oculto). |
| `PUT` | `/programas/{id}/dias/{dia}` | Pone una rutina en un día. Si ya tenía una, la sustituye: un día, una rutina. |
| `DELETE` | `/programas/{id}/dias/{dia}` | Deja el día en descanso (404 si ya lo era). |
| `POST` | `/programas/{id}/activar` | Lo pone en uso desde hoy; el que estuviera activo deja de estarlo en la misma transacción. Con `{quitar_excepciones: true}` borra además los días cambiados a mano de hoy en adelante, que se planificaron pensando en el programa anterior. Activar el que ya lo está no cambia nada, y uno oculto no se puede activar (409). |
| `POST` | `/programas/{id}/desactivar` | Lo saca de uso y deja al usuario sin programa activo. |
| `DELETE` | `/programas/{id}` | Si nunca estuvo activo, se borra directo. Si lo estuvo, exige `?modo=ocultar` (conserva todo; si era el activo, deja de serlo) o `?modo=definitivo` (se van también sus días y sus periodos); sin ninguno, 409 con los periodos en que estuvo activo. Las sesiones nunca se tocan. |
| `POST` | `/programas/{id}/mostrar` | Deshace un `?modo=ocultar`. No lo vuelve a activar aunque lo estuviera. |

**Solo puede haber un programa activo**, o ninguno. Se guarda en qué periodos estuvo activo cada uno
(de `desde` a `hasta`, sin incluir `hasta`), para que el calendario compare cada mes con el programa
que tocaba entonces y no con el de hoy; por eso, para borrar uno que estuvo activo hay que elegir.
Activar y desactivar un programa el mismo día no deja rastro, y volver a activarlo el día en que se
desactivó retoma el mismo periodo. Además de comprobarlo el backend, un índice único parcial en la
base de datos impide que un usuario tenga dos periodos abiertos a la vez.

Borrar una rutina no se bloquea por estar en un programa: los días que la tenían pasan a descanso.
Si otra cosa ya obliga a elegir entre ocultarla o borrarla, el aviso cuenta también esos días.

### Plan: qué toca cada día

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/plan?desde=&hasta=` | Qué toca cada día del rango (incluidos los extremos, como mucho 400 días): la rutina, de dónde sale (`origen`: `excepcion` si se cambió a mano, `programa` o `sin_programa`) y si es `descanso`. Cada día se resuelve con el programa que estaba activo **ese día**, así que sirve igual para el calendario (un mes pasado se compara con el plan de entonces) que para los próximos días. Un día con una rutina que ya estaba oculta esa fecha es descanso, pero trae la rutina igual, para enseñarla en gris. |
| `GET` | `/plan/excepciones` | Los días cambiados a mano, con `?desde=` y `?hasta=` opcionales. Con `desde` = hoy, los que se perderían al activar otro programa quitándolos. |
| `PUT` | `/plan/excepciones/{fecha}` | Cambia lo que toca un día: otra rutina, o descanso con `rutina_id` nulo. Sustituye si ya estaba cambiado, y se guarda aunque coincida con el programa (queda marcado como cambiado). Solo de hoy en adelante (422 si la fecha ya pasó); 404 si la rutina no es tuya o está oculta. |
| `DELETE` | `/plan/excepciones/{fecha}` | *Restablecer este día*: vuelve a lo que diga el programa (404 si no estaba cambiado). |
| `DELETE` | `/plan/excepciones?desde=&hasta=` | *Restablecer la semana*: devuelve al programa los días del rango, sin tocar los que ya pasaron. |
| `POST` | `/plan/intercambiar` | Intercambia lo que toca a dos días (`{fecha_a, fecha_b}`) en una sola transacción. Una rutina oculta ese día se mueve como descanso. |

Lo que toca un día es, por orden: lo que se cambió a mano para ese día, o lo que diga el programa
que estaba activo ese día, o nada. Si una rutina se borra, sus días planificados vuelven al programa.

### Entrenamientos y series

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/entrenamientos` | Lista los entrenamientos del usuario actual, más recientes primero. Acepta `?desde=` y `?hasta=` (fechas incluidas) para pedir una semana o un mes, y `?en_curso=true` para quedarse solo con la sesión en curso, si la hay. |
| `GET` | `/entrenamientos/{id}` | Obtiene un entrenamiento con sus series anidadas (cada una con su ejercicio ya resuelto). |
| `POST` | `/entrenamientos` | Crea un entrenamiento (sin series todavía); `rutina_id` es opcional — `null` para uno libre. Si es de hoy y ya hay otra sesión en curso, devuelve 409 con el id de esa sesión: solo puede haber una abierta a la vez. Apuntar un día pasado no choca con nada. |
| `POST` | `/entrenamientos/{id}/terminar` | Da la sesión por terminada. Terminarla otra vez no cambia nada: se conserva la hora de la primera. Una sesión terminada admite todavía series nuevas o corregidas, para poder editar un día ya pasado. |
| `PUT` | `/entrenamientos/{id}` | Edita fecha/notas/rutina de un entrenamiento propio. Cambiarlo de rutina devuelve 409 si ya tiene series registradas en huecos de la rutina actual: quedarían apuntando a huecos que no le corresponden, y el historial de esos huecos mostraría una sesión con el nombre de otra rutina. |
| `DELETE` | `/entrenamientos/{id}` | Borra un entrenamiento propio, con todas sus series. Sin `?modo`: nada más depende de un entrenamiento concreto. |
| `POST` | `/entrenamientos/{id}/series` | Registra una serie real (ejercicio, peso, repeticiones, RPE opcional, `slot_id` opcional si el entrenamiento sigue una rutina). Los números tienen tope (peso hasta 9999,99; repeticiones hasta 1000): fuera de él, 422. |
| `PUT` | `/entrenamientos/{id}/series/{serie_id}` | Edita una serie. |
| `DELETE` | `/entrenamientos/{id}/series/{serie_id}` | Borra una serie suelta. |
