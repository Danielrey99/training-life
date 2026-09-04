"""Configuración común de los tests.

Los tests corren contra PostgreSQL de verdad (no SQLite), en una base de datos
aparte, `training_life_test`, dentro del mismo contenedor que la de desarrollo.
Es imprescindible que sea Postgres real: los casos más delicados del backend son
borrados en cascada y restricciones `ON DELETE`, que SQLite no reproduce.
"""

import os
import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

NOMBRE_BD_TESTS = "training_life_test"


def _url_de_tests() -> str:
    """Reutiliza la conexión de desarrollo cambiando solo el nombre de la base."""
    url_desarrollo = os.environ["DATABASE_URL"]
    return url_desarrollo.rsplit("/", 1)[0] + "/" + NOMBRE_BD_TESTS


# Debe fijarse ANTES de importar nada de `app`: app/database.py lee DATABASE_URL
# al importarse y construye el engine con ella. Así la aplicación entera queda
# apuntando a la base de tests, y es imposible que un test toque la de desarrollo.
os.environ["DATABASE_URL"] = _url_de_tests()

from fastapi.testclient import TestClient  # noqa: E402
from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402

# Tablas que los tests ensucian. `usuarios` y `grupos_musculares` quedan fuera a
# propósito: las siembran las migraciones y todos los tests las necesitan.
TABLAS_A_VACIAR = (
    "series",
    "entrenamientos",
    "slot_alternativas",
    "rutina_slots",
    "rutinas",
    "ejercicios",
)


def _crear_base_de_tests_si_no_existe() -> None:
    """Crea `training_life_test` la primera vez, para que los tests funcionen
    con solo levantar Postgres (también tras un `docker compose down -v`).

    Alembic construye el esquema, pero la base en sí tiene que existir antes.
    Dos particularidades de PostgreSQL: no admite `CREATE DATABASE IF NOT
    EXISTS`, así que hay que preguntar; y ese comando no puede ejecutarse
    dentro de una transacción, de ahí el AUTOCOMMIT.
    """
    motor = create_engine(
        engine.url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    try:
        with motor.connect() as conexion:
            existe = conexion.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :nombre"),
                {"nombre": NOMBRE_BD_TESTS},
            )
            if not existe:
                # El nombre es un identificador, no un valor: no se puede
                # parametrizar. Es seguro porque es una constante de este
                # archivo, nunca entrada externa.
                conexion.execute(text(f'CREATE DATABASE "{NOMBRE_BD_TESTS}"'))
    finally:
        motor.dispose()


@pytest.fixture(scope="session", autouse=True)
def preparar_base_de_datos():
    """Crea el esquema una sola vez por tanda, aplicando las migraciones reales.

    Usar Alembic en vez de `create_all()` tiene un efecto secundario valioso:
    cada tanda de tests comprueba que la cadena de migraciones funciona desde cero.
    """
    if not str(engine.url).endswith(NOMBRE_BD_TESTS):
        pytest.exit(
            f"ABORTADO: los tests apuntan a '{engine.url}', que no es la base de "
            f"tests. Se negarían a borrar datos que no son suyos.",
            returncode=1,
        )

    _crear_base_de_tests_si_no_existe()

    from alembic import command
    from alembic.config import Config

    configuracion = Config(str(BACKEND_DIR / "alembic.ini"))
    configuracion.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(configuracion, "head")


@pytest.fixture(autouse=True)
def limpiar_tablas():
    """Deja la base en un estado limpio y predecible antes de cada test.

    Se hace antes y no después para que una tanda interrumpida no contamine la
    siguiente, y para poder inspeccionar los datos que dejó un test que falló.
    """
    with engine.begin() as conexion:
        conexion.execute(
            text(f"TRUNCATE {', '.join(TABLAS_A_VACIAR)} RESTART IDENTITY CASCADE")
        )


@pytest.fixture
def cliente() -> TestClient:
    """Cliente HTTP contra la API, sin levantar ningún servidor."""
    return TestClient(app)


@pytest.fixture
def grupo_muscular_id(cliente: TestClient) -> int:
    """Un grupo muscular cualquiera de los sembrados por migración."""
    return cliente.get("/grupos-musculares").json()[0]["id"]


@pytest.fixture
def sesion_bd():
    """Acceso directo a la base, para montar situaciones que la API no permite
    crear (por ejemplo, datos pertenecientes a otro usuario)."""
    from app.database import SessionLocal

    sesion = SessionLocal()
    try:
        yield sesion
    finally:
        sesion.close()
