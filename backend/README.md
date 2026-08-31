# backend

API REST del proyecto, construida con **FastAPI** (Python) sobre **PostgreSQL**, usando **SQLAlchemy** como ORM y **Alembic** para gestionar los cambios del esquema de base de datos (migraciones).

Ningún frontend (web ni móvil) accede directamente a la base de datos: siempre pasan por esta API.

## Estado actual

🚧 CRUD de `Ejercicio` completo (crear, listar, ver uno, editar, borrar) y `GrupoMuscular` (listar). Rutinas, entrenamientos y series todavía no tienen ni modelo ni endpoints — hasta que existan, el borrado con historial (`?modo=ocultar`/`?modo=definitivo`) no tiene nada real que proteger.

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
│       ├── ejercicios.py          # CRUD de ejercicios (crear, listar, ver uno, editar)
│       └── grupos_musculares.py   # solo lectura: listar el catálogo de grupos musculares
├── alembic/
│   ├── env.py              # configuración de Alembic (a qué BD conectarse, qué modelos vigilar)
│   └── versions/           # historial de migraciones, una por cambio de esquema
├── alembic.ini              # configuración general de Alembic
├── requirements.txt         # dependencias Python
├── Dockerfile                # receta para construir la imagen del backend
└── .dockerignore             # qué no copiar a la imagen al construirla (igual que .gitignore, pero para Docker)
```

Cómo se conectan, de abajo arriba: `database.py` es la base (no depende de nada más del proyecto) → `models.py` depende de `database.py` (usa su `Base` para definir las tablas) → `schemas.py` y `auth.py` son independientes entre sí (uno describe JSON, el otro quién pregunta) → cada archivo de `routers/` junta todo lo anterior (usa `database.py` para la sesión, `models.py` para consultar/crear filas, `schemas.py` para validar entrada/salida, `auth.py` para saber de quién son los datos) → `main.py` está arriba del todo, solo importa los `routers/` y los registra, sin lógica de negocio propia.

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

Si solo usas Docker, no necesitas ejecutar `alembic upgrade head` a mano: el `Dockerfile` ya lo hace automáticamente cada vez que arranca el contenedor. El comando manual de arriba es para cuando generas una migración *nueva* (paso 1), que si quieres puedes hacerlo también sin Docker, contra el Postgres expuesto en `localhost:5433`.

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
| `GET` | `/ejercicios` | Lista los ejercicios visibles para el usuario actual (predefinidos + propios, solo activos). |
| `GET` | `/ejercicios/{id}` | Obtiene un ejercicio por id (404 si no existe o no es visible). |
| `POST` | `/ejercicios` | Crea un ejercicio propio del usuario actual. |
| `PUT` | `/ejercicios/{id}` | Edita un ejercicio propio (403 si es de otro usuario o predefinido). |
| `DELETE` | `/ejercicios/{id}` | Borra un ejercicio propio. Sin historial asociado, lo borra de verdad; con historial, hace falta `?modo=ocultar` (borrado lógico) o `?modo=definitivo` (pierde el historial) — sin ninguno de los dos, devuelve 409 explicando las opciones. |
