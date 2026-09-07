# backend

API REST del proyecto, construida con **FastAPI** (Python) sobre **PostgreSQL**, usando **SQLAlchemy** como ORM y **Alembic** para gestionar los cambios del esquema de base de datos (migraciones).

Ningún frontend (web ni móvil) accede directamente a la base de datos: siempre pasan por esta API.

## Estado actual

🚧 Backend del MVP completo: CRUD de `Ejercicio`, `Rutina` (con huecos y comodines), `Entrenamiento`/`Serie` (registro real, con peso/repeticiones/RPE) y notas personales por ejercicio. El borrado con historial (`?modo=ocultar`/`?modo=definitivo`) protege ya todos los usos cruzados reales: un ejercicio usado en una rutina o con series registradas, una rutina con huecos o entrenamientos, un hueco con series registradas. `Entrenamiento`/`Serie` no tienen ese borrado lógico — son el propio historial, se borran directo.

Mientras no exista autenticación real (JWT), el backend trabaja con un único usuario sembrado por migración (datos placeholder, no reales) y un `usuario_id` hardcodeado en el código.

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
│   └── routers/            # los endpoints en sí, un archivo por entidad
│       ├── ejercicios.py          # CRUD de ejercicios
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
│   └── test_infraestructura.py
├── alembic.ini              # configuración general de Alembic
├── requirements.txt         # dependencias Python
├── requirements-dev.txt     # dependencias solo de desarrollo (tests, linter)
├── ruff.toml                # estilo del código: ancho de línea y qué queda fuera del formateo
├── Dockerfile                # receta para construir la imagen del backend
├── .dockerignore             # qué no copiar a la imagen al construirla (igual que .gitignore, pero para Docker)
└── .env.example              # plantilla del .env para ejecutar el backend fuera de Docker
```

Cómo se conectan, de abajo arriba: `database.py` es la base (no depende de nada más del proyecto) → `models.py` depende de `database.py` (usa su `Base` para definir las tablas) → `schemas.py` y `auth.py` son independientes entre sí (uno describe JSON, el otro quién pregunta) → cada archivo de `routers/` junta todo lo anterior (usa `database.py` para la sesión, `models.py` para consultar/crear filas, `schemas.py` para validar entrada/salida, `auth.py` para saber de quién son los datos) → `main.py` está arriba del todo, solo importa los `routers/` y los registra, sin lógica de negocio propia.

Los `routers/` no son del todo independientes entre sí: tanto `rutinas.py` como `entrenamientos.py` reutilizan una función de `ejercicios.py` (comprobar que un ejercicio existe y es visible para el usuario actual), en vez de repetir esa lógica — tiene sentido, ya que tanto un hueco de rutina como una serie siempre referencian un ejercicio ya existente.

`alembic/` es un mundo aparte: solo lee `models.py` (para saber qué tablas debería haber) y `database.py` (para saber a qué Postgres conectarse), pero no lo usa la API en tiempo de ejecución — se ejecuta puntualmente para crear/actualizar tablas.

## Cómo ejecutarlo

Lo normal es levantarlo junto con la base de datos desde la raíz del repo con `docker compose up` (ver el [README raíz](../README.md)). Ese comando construye la imagen, instala `requirements.txt`, **aplica las migraciones de Alembic pendientes** y arranca `uvicorn` con recarga automática — todo en un solo paso.

### Ejecutarlo suelto, sin Docker (por ejemplo para usar herramientas como Alembic desde tu propio editor)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # en Windows
pip install -r requirements.txt
```

Copia `backend/.env.example` a `backend/.env` — apunta a `localhost:5433`, el puerto que Postgres expone al host cuando el contenedor está levantado (necesitas tener `docker compose up -d postgres` corriendo, aunque no uses el contenedor del backend).

```bash
uvicorn app.main:app --reload
```

## Modelos y migraciones (Alembic)

Cada tabla de la base de datos se define primero como una clase Python en `app/models.py` (un modelo SQLAlchemy). Para que ese cambio se refleje de verdad en PostgreSQL hace falta generar y aplicar una migración:

```bash
# 1. Genera un archivo de migración comparando los modelos actuales contra la base de datos real
.venv\Scripts\python -m alembic revision --autogenerate -m "descripción del cambio"

# 2. Revisa el archivo generado en alembic/versions/ (Alembic no siempre acierta al 100%)

# 3. Aplica la migración a la base de datos
.venv\Scripts\python -m alembic upgrade head
```

Si solo usas Docker, no necesitas ejecutar `alembic upgrade head` a mano: el `Dockerfile` ya lo hace automáticamente cada vez que arranca el contenedor. El comando manual de arriba es para cuando generas una migración *nueva* (paso 1), que si quieres puedes hacerlo también sin Docker, contra el Postgres expuesto en `localhost:5433` — el bind mount cubre toda la carpeta `backend/`, así que la migración nueva llega al contenedor al instante, sin necesidad de reconstruir la imagen.

## Tests

```bash
cd backend
.venv\Scripts\python -m pip install -r requirements-dev.txt   # solo la primera vez
.venv\Scripts\python -m pytest tests/
```

Los tests corren contra **PostgreSQL de verdad**, en una base de datos aparte
(`training_life_test`) dentro del mismo contenedor que la de desarrollo, así que
hace falta tener Postgres levantado (`docker compose up -d postgres`). No se usa
SQLite a propósito: buena parte de la lógica del backend son cascadas de borrado
y restricciones `ON DELETE`, que SQLite no reproduce — unos tests sobre SQLite
pasarían en verde con esos fallos vivos.

No hay ningún paso previo que recordar: si la base de tests todavía no existe (la
primera vez, o después de un `docker compose down -v`), la propia tanda la crea.
Su esquema se construye aplicando las migraciones de Alembic, así que cada
ejecución comprueba de paso que la cadena de migraciones funciona desde cero. La
base de desarrollo no se toca en ningún momento: si la conexión no apunta a
`training_life_test`, los tests abortan antes de ejecutar nada.

| Archivo | Qué cubre |
|---|---|
| `test_borrados.py` | El borrado con historial (`modo=ocultar`/`definitivo`) y sus cascadas |
| `test_aislamiento_por_usuario.py` | Que los datos de un usuario no son visibles ni editables por otro |
| `test_crud.py` | Camino feliz de cada CRUD y las validaciones de entrada |
| `test_infraestructura.py` | Que el propio andamiaje de los tests funciona |

## Convención de comentarios

### `#` y docstring no son dos tamaños de lo mismo

No se eligen según lo largo que sea el texto, sino según dónde van y para qué sirven:

| | Dónde va | Qué es |
|---|---|---|
| **Docstring** `"""..."""` | La **primera línea** de un módulo, una clase o una función | Documentación de verdad: Python la guarda en `__doc__`, el editor la enseña al pasar el ratón y **FastAPI publica la de cada endpoint como su descripción en `/docs`** |
| **Comentario** `#` | Cualquier otro sitio | Una nota para quien lea el código. Puede ocupar cinco líneas seguidas sin dejar por ello de ser un comentario |

Un `"""..."""` colocado fuera de esa primera posición no documenta nada: es un texto que Python
construye y tira acto seguido.

Cada uno responde además a una pregunta distinta:

- **El docstring dice qué es esto y por qué existe**, para quien lo usa sin abrirlo por dentro.
- **El comentario dice por qué esta línea está así**, para quien vaya a modificarla.

Por eso conviven sin pisarse:

```python
class NotaUsuarioEjercicio(Base):
    """Una nota personal y privada de un usuario sobre un ejercicio, propio o
    predefinido (ej. "en esta máquina el asiento va en el 4").
    """

    __tablename__ = "notas_usuario_ejercicio"

    # CASCADE (a diferencia de rutina_slots, slot_alternativas y series hacia
    # ejercicios, que son RESTRICT): una nota no es historial de progresión
    # que haya que proteger, es un accesorio del ejercicio.
    ejercicio_id: Mapped[int] = mapped_column(ForeignKey("ejercicios.id", ondelete="CASCADE"))
```

### Formato del docstring

Se sigue [PEP 257](https://peps.python.org/pep-0257/), la guía oficial de Python:

- Termina siempre en punto.
- De una línea, todo junto: `"""Visible si es predefinido o si es del usuario actual."""`
- De varias líneas, el `"""` de cierre **baja a su propia línea**, para marcar dónde acaba la
  explicación y empieza el código.
- Escrito en español. Las clases se describen con un sustantivo ("Un hueco dentro de una
  rutina..."); las funciones, en tercera persona ("Devuelve...", "Crea...").

No se usan formatos con secciones (`Args:`, `Returns:`, estilo Google o NumPy): los tipos ya
están en la firma de la función y FastAPI genera la documentación de la API a partir de los
esquemas, así que repetirlos en prosa solo añade texto que se queda desactualizado.

### Cuándo se escribe uno

La regla de fondo es que **un docstring que repite el nombre en prosa es ruido**: poner
`"""Crea una nota."""` encima de `def crear_nota()` no le cuenta nada a nadie.

- **Módulo**: solo si el archivo tiene algo que contar que no se deduzca de su nombre. `models.py`
  no lo necesita; `tests/conftest.py` sí, porque explica contra qué base de datos corren los tests.
- **Clase**: siempre que represente una entidad del dominio, para dejar claro qué es y en qué se
  diferencia de sus vecinas.
- **Función**: cuando el nombre no baste — una decisión de diseño, un código de estado que sorprende,
  una trampa conocida. Las funciones evidentes se quedan sin él.
- **Test**: cuando el nombre no explique **por qué existe** ese test. Si cubre un fallo real que ya
  ocurrió, el docstring cuenta cuál era.

### Lo más corto que se entienda

Un comentario existe para ahorrarle tiempo a quien lee, así que cada palabra de más juega en su
contra. La prueba es sencilla: **si al quitar media frase el motivo sigue estando claro, sobraba;
si al quitarla desaparece la razón, tenía que ser así de largo.**

Esto no es un límite de líneas ni una invitación a amputar. Un porqué complicado necesita las
líneas que necesite — lo que no puede es repetirse, adornarse ni explicar lo que el código ya dice:

```python
# Antes (seis líneas, dice dos veces lo mismo):
    # flush obligatorio antes de tocar los huecos: series.slot_id → rutina_slots
    # es RESTRICT, y marcar los borrados en el orden correcto no basta. Sin
    # este flush todo viaja junto al commit, y SQLAlchemy ordena los DELETE
    # según las relationship() que conoce — entre Serie y RutinaSlot no hay
    # ninguna, así que emite el del hueco primero y la base de datos lo
    # rechaza. El flush fuerza a que las series ya no existan.

# Después (tres líneas, mismo porqué):
    # flush obligatorio: sin él los DELETE viajan juntos al commit y SQLAlchemy
    # los ordena por las relationship() que conoce — no hay ninguna entre Serie y
    # RutinaSlot, así que borraría el hueco antes que sus series (RESTRICT).
```

### Comentarios `#`

- Explican **por qué**, nunca **qué**: el qué ya lo dice el código de al lado.
- Van en su propia línea, justo encima de aquello que comentan.
- Al final de una línea de código solo caben apostillas de cuatro o cinco palabras, separadas por
  dos espacios (`# noqa` y similares son instrucciones para las herramientas, no comentarios).
- **Los banners de sección son la excepción a todo lo anterior**: no explican ningún porqué, parten
  un archivo largo en bloques. Se usan cuando un archivo agrupa varios recursos —`ejercicios.py`
  reúne los endpoints de ejercicios y los de sus notas; `rutinas.py`, los de rutinas, huecos y
  comodines— y se escriben con el nombre del bloque y guiones de relleno hasta la columna 75:

```python
# --- Comodines (slot_alternativas) -----------------------------------------
```

- El mejor comentario es el que **justifica que una línea exista**:

```python
    # flush obligatorio antes de tocar los huecos: series.slot_id → rutina_slots
    # es RESTRICT, y marcar los borrados en el orden correcto no basta.
    db.flush()
```

Sin esas dos líneas, `db.flush()` parece prescindible y acaba desapareciendo en el primer refactor,
devolviendo al backend un error 500 que ya se había arreglado una vez.

### Formato

El formato lo aplica [ruff](https://docs.astral.sh/ruff/) (viene en `requirements-dev.txt`), con la
configuración de `ruff.toml`: **100 columnas**, y las migraciones de `alembic/versions/` excluidas,
porque las genera Alembic con su propio estilo y reformatearlas solo ensucia los diffs.

```bash
.venv\Scripts\python -m ruff format .   # formatea
.venv\Scripts\python -m ruff check .    # busca imports sin usar y similares
```

Nada de lo anterior lo comprueba una herramienta: que un comentario explique el *porqué* y no repita
el nombre de la función no es verificable automáticamente, así que esta convención se sostiene al
revisar el código, no en el linter.

## Variables de entorno

| Variable | Dónde se define | Descripción |
|---|---|---|
| `DATABASE_URL` | Inyectada por `docker-compose.yml` (raíz) cuando se ejecuta en Docker; o por `backend/.env` cuando se ejecuta suelto | Cadena de conexión a PostgreSQL. Dentro de Docker el host es `postgres` (nombre del servicio); fuera de Docker es `localhost:5433` (puerto publicado al host). |

## Autenticación (pendiente)

Todavía no hay JWT. Todos los endpoints trabajan con un único usuario fijo (`app/auth.py`, función `get_usuario_actual_id`) — la fila sembrada por migración. Cuando se implemente JWT, solo esa función cambia; los endpoints no necesitan tocarse.

## Endpoints disponibles

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Comprobación de que la API está viva. Devuelve `{"status": "ok"}`. |
| `GET` | `/docs` | Documentación interactiva (Swagger UI), autogenerada por FastAPI. |
| `GET` | `/grupos-musculares` | Lista el catálogo de grupos musculares (sembrado por migración, sin CRUD propio). |
| `GET` | `/ejercicios` | Lista los ejercicios visibles para el usuario actual (predefinidos + propios, solo activos). Con `?ocultos=true`, lista en cambio los propios ocultados. |
| `GET` | `/ejercicios/{id}` | Obtiene un ejercicio por id (404 si no existe o no es visible). |
| `POST` | `/ejercicios` | Crea un ejercicio propio del usuario actual. |
| `PUT` | `/ejercicios/{id}` | Edita un ejercicio propio (403 si es de otro usuario o predefinido). |
| `DELETE` | `/ejercicios/{id}` | Borra un ejercicio propio. Sin uso asociado, lo borra de verdad; en uso, hace falta `?modo=ocultar` (borrado lógico) o `?modo=definitivo` (pierde el historial) — sin ninguno de los dos, devuelve 409 explicando dónde se usa (rutina y hueco concretos) y cuántas notas se perderían. Tus notas nunca bloquean el borrado: se van siempre con el ejercicio, y `?modo=ocultar` las conserva. |
| `POST` | `/ejercicios/{id}/reactivar` | Deshace un `?modo=ocultar` — vuelve a hacer visible un ejercicio propio. |
| `GET` | `/ejercicios/{id}/notas` | Lista tus notas personales sobre ese ejercicio, de la más reciente a la más antigua. Solo las tuyas, incluso si el ejercicio es predefinido y por tanto lo comparten todos los usuarios. |
| `POST` | `/ejercicios/{id}/notas` | Añade una nota. Se pueden acumular varias sobre el mismo ejercicio: son independientes, no se sobreescriben. |
| `PUT` | `/ejercicios/{id}/notas/{nota_id}` | Edita una nota propia (403 si es de otro usuario). |
| `DELETE` | `/ejercicios/{id}/notas/{nota_id}` | Borra una nota suelta. Sin `?modo`: nada depende de una nota. |
| `GET` | `/rutinas` | Lista las rutinas activas del usuario actual. Con `?ocultas=true`, lista en cambio las ocultadas. |
| `GET` | `/rutinas/{id}` | Obtiene una rutina con sus huecos y comodines anidados. |
| `POST` | `/rutinas` | Crea una rutina (sin huecos todavía). |
| `PUT` | `/rutinas/{id}` | Edita el nombre/día habitual de una rutina propia. |
| `DELETE` | `/rutinas/{id}` | Borra una rutina propia. Mismo patrón que `Ejercicio`: directo si no tiene huecos ni historial; si tiene, exige `?modo=ocultar` o `?modo=definitivo` (que borra también sus huecos y comodines, en transacción). |
| `POST` | `/rutinas/{id}/reactivar` | Deshace un `?modo=ocultar` — vuelve a hacer visible una rutina propia. |
| `POST` | `/rutinas/{id}/slots` | Añade un hueco a una rutina propia. |
| `PUT` | `/rutinas/{id}/slots/{slot_id}` | Edita un hueco. |
| `DELETE` | `/rutinas/{id}/slots/{slot_id}` | Borra un hueco. Mismo patrón que `Ejercicio`/`Rutina`: directo si no tiene series registradas; si tiene, exige `?modo=ocultar` o `?modo=definitivo`. |
| `POST` | `/rutinas/{id}/slots/{slot_id}/alternativas` | Añade un ejercicio comodín al hueco (409 si ya lo era). |
| `DELETE` | `/rutinas/{id}/slots/{slot_id}/alternativas/{ejercicio_id}` | Quita un comodín del hueco. |
| `GET` | `/entrenamientos` | Lista los entrenamientos del usuario actual, más recientes primero. |
| `GET` | `/entrenamientos/{id}` | Obtiene un entrenamiento con sus series anidadas (cada una con su ejercicio ya resuelto). |
| `POST` | `/entrenamientos` | Crea un entrenamiento (sin series todavía); `rutina_id` es opcional — `null` para uno libre. |
| `PUT` | `/entrenamientos/{id}` | Edita fecha/notas/rutina de un entrenamiento propio. |
| `DELETE` | `/entrenamientos/{id}` | Borra un entrenamiento propio, con todas sus series. Sin `?modo`: nada más depende de un entrenamiento concreto. |
| `POST` | `/entrenamientos/{id}/series` | Registra una serie real (ejercicio, peso, repeticiones, RPE opcional, `slot_id` opcional si el entrenamiento sigue una rutina). |
| `PUT` | `/entrenamientos/{id}/series/{serie_id}` | Edita una serie. |
| `DELETE` | `/entrenamientos/{id}/series/{serie_id}` | Borra una serie suelta. |
