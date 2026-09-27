from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ejercicios, entrenamientos, grupos_musculares, plan, programas, rutinas

app = FastAPI(
    title="Training Life API",
    description="API REST del proyecto Training Life (registro de entrenamientos de gimnasio).",
    version="0.1.0",
)

# El navegador bloquea las peticiones entre orígenes distintos, y en desarrollo
# la web (localhost:5173, Vite) y esta API (localhost:8000) lo son. Se nombra el
# origen en vez de abrir a todos: cuando exista JWT, un "*" dejaría que
# cualquier página llamara a la API desde el navegador de un usuario con sesión.
# En producción la web se servirá desde el mismo origen que la API y esto dejará
# de hacer falta.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(grupos_musculares.router)
app.include_router(ejercicios.router)
app.include_router(rutinas.router)
app.include_router(entrenamientos.router)
app.include_router(programas.router)
app.include_router(plan.router)


@app.get("/health", tags=["health"])
def health_check():
    """Comprueba que la API está viva, sin tocar la base de datos ni depender
    de ningún otro endpoint.
    """
    return {"status": "ok"}
