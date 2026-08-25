import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# En Docker Compose esta variable la inyecta docker-compose.yml (host "postgres")
# y este load_dotenv no hace nada porque backend/.env no existe dentro del contenedor.
# Fuera de Docker (ejecución local con venv), se lee de backend/.env (host "localhost").
load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Clase base de la que heredan todos los modelos (tablas) de la app."""


def get_db():
    """Dependencia de FastAPI: abre una sesión de base de datos por petición
    y la cierra siempre al terminar, incluso si la petición falla.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
