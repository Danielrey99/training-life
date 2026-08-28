from fastapi import FastAPI

from app.routers import ejercicios, grupos_musculares

app = FastAPI(
    title="Training Life API",
    description="API REST del proyecto Training Life (registro de entrenamientos de gimnasio).",
    version="0.1.0",
)

app.include_router(grupos_musculares.router)
app.include_router(ejercicios.router)


@app.get("/health", tags=["health"])
def health_check():
    """Endpoint mínimo para comprobar que la API está viva.

    Sin lógica de negocio todavía: sirve para verificar que el contenedor
    del backend arranca correctamente antes de añadir modelos y endpoints reales.
    """
    return {"status": "ok"}
