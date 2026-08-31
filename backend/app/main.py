from fastapi import FastAPI

from app.routers import ejercicios, grupos_musculares, rutinas

app = FastAPI(
    title="Training Life API",
    description="API REST del proyecto Training Life (registro de entrenamientos de gimnasio).",
    version="0.1.0",
)

app.include_router(grupos_musculares.router)
app.include_router(ejercicios.router)
app.include_router(rutinas.router)


@app.get("/health", tags=["health"])
def health_check():
    """Endpoint mínimo para comprobar que la API está viva, sin tocar la
    base de datos ni depender de ningún otro endpoint — útil para saber si
    el contenedor arrancó bien antes de mirar nada más.
    """
    return {"status": "ok"}
