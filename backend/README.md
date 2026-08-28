# backend

API REST del proyecto, construida con **FastAPI** (Python) sobre **PostgreSQL**, usando **SQLAlchemy** como ORM y **Alembic** para gestionar los cambios del esquema de base de datos (migraciones).

Ningún frontend (web ni móvil) accede directamente a la base de datos: siempre pasan por esta API.

## Estado actual

🚧 Los modelos `Usuario`, `GrupoMuscular` y `Ejercicio` ya están migrados a PostgreSQL (con sus relaciones y el usuario único sembrado), pero todavía no existen endpoints de negocio (CRUD) que los usen — solo `/health`. Eso es lo siguiente.

Mientras no exista autenticación real (JWT), el backend trabaja con un único usuario sembrado por migración (datos placeholder, no reales) y un `usuario_id` hardcodeado en el código.

## Estructura

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py        # instancia de FastAPI y endpoints
│   ├── database.py     # conexión a PostgreSQL (engine, sesión) y dependencia get_db
│   └── models.py       # modelos SQLAlchemy (tablas)
├── alembic/
│   ├── env.py          # configuración de Alembic (URL de conexión, modelos a detectar)
│   └── versions/        # historial de migraciones
├── alembic.ini
├── requirements.txt
├── Dockerfile
└── .dockerignore
```

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

## Endpoints disponibles

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Comprobación de que la API está viva. Devuelve `{"status": "ok"}`. |
| `GET` | `/docs` | Documentación interactiva (Swagger UI), autogenerada por FastAPI. |
