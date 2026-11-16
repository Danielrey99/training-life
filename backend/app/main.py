from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.fechas import fijar_zona, soltar_zona
from app.routers.datos import NO_ES_UNA_COPIA
from app.routers import (
    datos,
    ejercicios,
    entrenamientos,
    grupos_musculares,
    plan,
    programas,
    resumen,
    rutinas,
)

app = FastAPI(
    title="Training Life API",
    description="API REST del proyecto Training Life (registro de entrenamientos de gimnasio).",
    version="0.1.0",
)


@app.exception_handler(RequestValidationError)
async def _json_que_no_se_puede_leer(request: Request, error: RequestValidationError):
    """Un archivo que ni siquiera es JSON, al importar datos: FastAPI lo rechaza antes
    de llegar al endpoint con su 422 en inglés. Se contesta como cualquier archivo que
    no es una copia; el resto de 422 de validación siguen igual.
    """
    if request.url.path == "/datos/importar" and any(
        fallo.get("type") == "json_invalid" for fallo in error.errors()
    ):
        return JSONResponse(status_code=422, content={"detail": {"mensaje": NO_ES_UNA_COPIA}})
    return await request_validation_exception_handler(request, error)


# El navegador bloquea las peticiones entre orígenes distintos, y en desarrollo
# la web (localhost:5173, Vite) y esta API (localhost:8000) lo son. Se nombra el
# origen en vez de abrir a todos: un "*" dejaría que cualquier página llamara a
# la API desde el navegador.
# En producción la web se servirá desde el mismo origen que la API y esto dejará
# de hacer falta.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _zona_de_quien_pide(request: Request, call_next):
    """«Hoy» es el del dispositivo de quien usa la app, que manda su zona horaria en la
    cabecera `X-Zona-Horaria` (ver `app/fechas.py`).
    """
    # Aquí y no en una dependencia: una dependencia síncrona corre en otro hilo con una
    # copia del contexto, y la zona que fijara no llegaría al endpoint.
    token = fijar_zona(request.headers.get("x-zona-horaria"))
    try:
        return await call_next(request)
    finally:
        soltar_zona(token)


app.include_router(grupos_musculares.router)
app.include_router(ejercicios.router)
app.include_router(rutinas.router)
app.include_router(entrenamientos.router)
app.include_router(programas.router)
app.include_router(plan.router)
app.include_router(resumen.router)
app.include_router(datos.router)


@app.get("/health", tags=["health"])
def health_check():
    """Comprueba que la API está viva, sin tocar la base de datos ni depender
    de ningún otro endpoint.
    """
    return {"status": "ok"}
