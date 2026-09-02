# backend

API REST del proyecto, construida con **FastAPI** (Python) sobre **PostgreSQL**, usando **SQLAlchemy** como ORM y **Alembic** para gestionar los cambios del esquema de base de datos (migraciones).

Ningún frontend (web ni móvil) accede directamente a la base de datos: siempre pasan por esta API.

## Estado actual

🚧 Backend del MVP completo: CRUD de `Ejercicio`, `Rutina` (con huecos y comodines) y `Entrenamiento`/`Serie` (registro real, con peso/repeticiones/RPE). El borrado con historial (`?modo=ocultar`/`?modo=definitivo`) protege ya todos los usos cruzados reales: un ejercicio usado en una rutina o con series registradas, una rutina con huecos o entrenamientos, un hueco con series registradas. `Entrenamiento`/`Serie` no tienen ese borrado lógico — son el propio historial, se borran directo.

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
├── alembic.ini              # configuración general de Alembic
├── requirements.txt         # dependencias Python
├── Dockerfile                # receta para construir la imagen del backend
└── .dockerignore             # qué no copiar a la imagen al construirla (igual que .gitignore, pero para Docker)
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
| `DELETE` | `/ejercicios/{id}` | Borra un ejercicio propio. Sin uso asociado, lo borra de verdad; en uso, hace falta `?modo=ocultar` (borrado lógico) o `?modo=definitivo` (pierde el historial) — sin ninguno de los dos, devuelve 409 explicando dónde se usa (rutina y hueco concretos). |
| `POST` | `/ejercicios/{id}/reactivar` | Deshace un `?modo=ocultar` — vuelve a hacer visible un ejercicio propio. |
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
