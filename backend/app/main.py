from fastapi import FastAPI

app = FastAPI(
    title="Training Life API",
    description="API REST del proyecto Training Life (registro de entrenamientos de gimnasio).",
    version="0.1.0",
)


@app.get("/health", tags=["health"])
def health_check():
    """Endpoint mínimo para comprobar que la API está viva.

    Sin lógica de negocio todavía: sirve para verificar que el contenedor
    del backend arranca correctamente antes de añadir modelos y endpoints reales.
    """
    return {"status": "ok"}
