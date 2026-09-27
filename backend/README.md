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
y las notas personales por ejercicio.

El borrado con historial (`?modo=ocultar` / `?modo=definitivo`) cubre ya todos los usos cruzados
reales:

- un ejercicio usado en una rutina, o con series registradas
- una rutina con huecos definidos o con entrenamientos
- un hueco con series registradas

`Entrenamiento` y `Serie` se quedan fuera de ese mecanismo a propósito: son el propio historial, no
algo que otras tablas tengan que proteger, así que se borran directo.

Sobre ese historial se consulta la **progresión**, en dos vistas que no se sustituyen: la de un
ejercicio concreto (`/ejercicios/{id}/historial`) y la de un hueco entero de una rutina
(`/rutinas/{id}/slots/{slot_id}/historial`), que incluye también los días en que ese hueco se hizo
con un comodín. Las dos siguen respondiendo aunque el ejercicio, el hueco o la rutina estén
ocultados: ocultar retira algo de circulación, no borra lo que ya entrenaste con ello.

Mientras no exista autenticación real (JWT), la API trabaja con un único usuario sembrado por
migración —datos placeholder, no reales— y un `usuario_id` hardcodeado en el código.

**Próximo paso: ampliar el modelo con lo que pide el [diseño de la app](../README.md#diseño-de-la-app).**
Lo que hay hoy basta para registrar entrenamientos, pero no para saber qué toca cada día. Los
cambios previstos:

- **Programas semanales**: qué rutina toca cada día de la semana. Una misma rutina puede estar en
  varios programas y en varios días, y se guarda qué programa estaba activo en cada periodo, para
  que el calendario compare cada mes con el plan que tocaba entonces.
- **Planificación por fecha**: cambiar qué toca un día concreto sin tocar el programa.
- **Ocultar con fecha**: la columna `activo` pasa a ser `oculto_desde`, para poder decir desde
  cuándo está oculta cada cosa. Así además *activo* queda solo para "el programa en uso".
- **Sesiones abiertas**: marcar cuándo se termina un entrenamiento, para distinguir uno a medias de
  uno acabado.
- **Ejercicios predefinidos** sembrados por migración, para que la app no arranque con la
  biblioteca vacía.

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
│   └── routers/            # los endpoints en sí, un archivo por entidad
│       ├── ejercicios.py          # CRUD de ejercicios, y las notas de cada uno
│       ├── grupos_musculares.py   # solo lectura: listar el catálogo de grupos musculares
│       ├── rutinas.py             # CRUD de rutinas, huecos (slots) y comodines, todo anidado
│       └── entrenamientos.py      # CRUD de entrenamientos y series, anidado
├── alembic/
│   ├── env.py              # configuración de Alembic (a qué BD conectarse, qué modelos vigilar)
│   └── versions/           # historial de migraciones, una por cambio de esquema
├── tests/                   # tests automáticos (pytest)
│   ├── conftest.py          # base de datos de tests, cliente HTTP y limpieza entre tests
│   ├── test_borrados.py     # borrado con historial y cascadas
│   ├── test_aislamiento_por_usuario.py
│   ├── test_crud.py         # camino feliz y validaciones de entrada
│   ├── test_historial.py    # la progresión por ejercicio y por hueco
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

Las 9 tablas del MVP y sus claves ajenas, con la regla de borrado de cada una — `CASCADE` arrastra
al hijo, `RESTRICT` impide borrar al padre mientras exista — y qué tablas llevan borrado lógico
(columna `activo`) frente a las que son historial puro. El diagrama se mantiene a mano: al añadir o
cambiar una tabla hay que actualizarlo.

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
| `test_infraestructura.py` | Que el propio andamiaje de los tests funciona |

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
| `GET` | `/ejercicios` | Lista los ejercicios visibles para el usuario actual (predefinidos + propios, solo activos). Con `?ocultos=true`, lista en cambio los propios ocultados. |
| `GET` | `/ejercicios/{id}` | Obtiene un ejercicio por id (404 si no existe o no es visible). |
| `POST` | `/ejercicios` | Crea un ejercicio propio del usuario actual. |
| `PUT` | `/ejercicios/{id}` | Edita un ejercicio propio (403 si es de otro usuario o predefinido). |
| `DELETE` | `/ejercicios/{id}` | Borra un ejercicio propio. Sin uso asociado, lo borra de verdad; en uso, hace falta `?modo=ocultar` (borrado lógico) o `?modo=definitivo` (pierde el historial) — sin ninguno de los dos, devuelve 409 explicando dónde se usa (rutina y hueco concretos) y cuántas notas se perderían. Tus notas nunca bloquean el borrado: se van siempre con el ejercicio, y `?modo=ocultar` las conserva. |
| `POST` | `/ejercicios/{id}/reactivar` | Deshace un `?modo=ocultar` — vuelve a hacer visible un ejercicio propio. |
| `GET` | `/ejercicios/{id}/historial` | Los días en que se hizo este ejercicio, del más reciente al más antiguo, con las series de cada día. Acepta `?desde=`, `?hasta=` (fechas inclusivas) y `?limite=`, que cuenta **sesiones**, no series — 50 por defecto, 500 como máximo. Sigue funcionando aunque el ejercicio esté ocultado: ocultar no borra el historial. |

### Notas de un ejercicio

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/ejercicios/{id}/notas` | Lista tus notas personales sobre ese ejercicio, de la más reciente a la más antigua. Solo las tuyas, incluso si el ejercicio es predefinido y por tanto lo comparten todos los usuarios. |
| `POST` | `/ejercicios/{id}/notas` | Añade una nota. Se pueden acumular varias sobre el mismo ejercicio: son independientes, no se sobreescriben. |
| `PUT` | `/ejercicios/{id}/notas/{nota_id}` | Edita una nota propia (403 si es de otro usuario). |
| `DELETE` | `/ejercicios/{id}/notas/{nota_id}` | Borra una nota suelta. Sin `?modo`: nada depende de una nota. |

### Rutinas, huecos y comodines

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/rutinas` | Lista las rutinas activas del usuario actual. Con `?ocultas=true`, lista en cambio las ocultadas. |
| `GET` | `/rutinas/{id}` | Obtiene una rutina con sus huecos y comodines anidados. |
| `POST` | `/rutinas` | Crea una rutina (sin huecos todavía). |
| `PUT` | `/rutinas/{id}` | Edita el nombre/día habitual de una rutina propia. |
| `DELETE` | `/rutinas/{id}` | Borra una rutina propia. Mismo patrón que `Ejercicio`: directo si no tiene huecos ni historial; si tiene, exige `?modo=ocultar` o `?modo=definitivo` (que borra también sus huecos y comodines, en transacción). |
| `POST` | `/rutinas/{id}/reactivar` | Deshace un `?modo=ocultar` — vuelve a hacer visible una rutina propia. |
| `POST` | `/rutinas/{id}/slots` | Añade un hueco a una rutina propia. |
| `PUT` | `/rutinas/{id}/slots/{slot_id}` | Edita un hueco. |
| `DELETE` | `/rutinas/{id}/slots/{slot_id}` | Borra un hueco. Mismo patrón que `Ejercicio`/`Rutina`: directo si no tiene series registradas; si tiene, exige `?modo=ocultar` o `?modo=definitivo`. |
| `GET` | `/rutinas/{id}/slots/{slot_id}/historial` | La progresión del hueco entero: los días en que se entrenó, con qué ejercicio se hizo cada serie (principal o comodín) y con cuánto peso. Mismos filtros que el historial de un ejercicio, más `?ejercicio_id=` para quedarse solo con las series de ese ejercicio en el hueco: es la "última vez" con la que se compara al entrenar (con `?hasta=` el día anterior y `?limite=1`), que tiene que ser con el mismo ejercicio y no con el comodín de otra semana. También sigue funcionando con el hueco o la rutina ocultados. |
| `POST` | `/rutinas/{id}/slots/{slot_id}/alternativas` | Añade un ejercicio comodín al hueco (409 si ya lo era). |
| `DELETE` | `/rutinas/{id}/slots/{slot_id}/alternativas/{ejercicio_id}` | Quita un comodín del hueco. |

### Entrenamientos y series

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/entrenamientos` | Lista los entrenamientos del usuario actual, más recientes primero. |
| `GET` | `/entrenamientos/{id}` | Obtiene un entrenamiento con sus series anidadas (cada una con su ejercicio ya resuelto). |
| `POST` | `/entrenamientos` | Crea un entrenamiento (sin series todavía); `rutina_id` es opcional — `null` para uno libre. |
| `PUT` | `/entrenamientos/{id}` | Edita fecha/notas/rutina de un entrenamiento propio. Cambiarlo de rutina devuelve 409 si ya tiene series registradas en huecos de la rutina actual: quedarían apuntando a huecos que no le corresponden, y el historial de esos huecos mostraría una sesión con el nombre de otra rutina. |
| `DELETE` | `/entrenamientos/{id}` | Borra un entrenamiento propio, con todas sus series. Sin `?modo`: nada más depende de un entrenamiento concreto. |
| `POST` | `/entrenamientos/{id}/series` | Registra una serie real (ejercicio, peso, repeticiones, RPE opcional, `slot_id` opcional si el entrenamiento sigue una rutina). |
| `PUT` | `/entrenamientos/{id}/series/{serie_id}` | Edita una serie. |
| `DELETE` | `/entrenamientos/{id}/series/{serie_id}` | Borra una serie suelta. |
