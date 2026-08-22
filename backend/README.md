# backend

API REST del proyecto, construida con **FastAPI** (Python) sobre **PostgreSQL**.

Ningún frontend (web ni móvil) accede directamente a la base de datos: siempre pasan por esta API.

## Estado actual

🚧 Solo esqueleto: la app arranca, responde en `/health` y expone la documentación interactiva en `/docs`, pero todavía no tiene modelos ni endpoints de negocio (ejercicios, entrenamientos, rutinas). Eso es lo siguiente que se va a construir.

## Estructura

```
backend/
├── app/
│   ├── __init__.py
│   └── main.py       # instancia de FastAPI y endpoints
├── requirements.txt
├── Dockerfile
└── .dockerignore
```

## Cómo ejecutarlo

Lo normal es levantarlo junto con la base de datos desde la raíz del repo con `docker compose up` (ver el [README raíz](../README.md)). Ese comando ya se encarga de construir la imagen de este `Dockerfile`, instalar `requirements.txt` y arrancar `uvicorn` con recarga automática.

Si quieres ejecutarlo suelto (sin Docker), fuera de este contenedor:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # en Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

En ese caso no tendrás una base de datos disponible salvo que apuntes `DATABASE_URL` a un PostgreSQL propio.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL. Cuando se ejecuta vía `docker compose`, se construye automáticamente a partir de `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` (definidas en el `.env` de la raíz). |

## Endpoints disponibles

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Comprobación de que la API está viva. Devuelve `{"status": "ok"}`. |
| `GET` | `/docs` | Documentación interactiva (Swagger UI), autogenerada por FastAPI. |
