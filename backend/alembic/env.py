import os
import sys
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Permite importar "app.*" al ejecutar Alembic desde dentro de backend/
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

# Fuera de Docker, backend/.env trae el DATABASE_URL apuntando a localhost.
# Dentro de Docker ya viene inyectada por docker-compose.yml y este archivo no existe.
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from app.database import Base  # noqa: E402
from app import models  # noqa: E402,F401  (importa los modelos para registrarlos en Base.metadata)

# Objeto de configuración de Alembic (lee alembic.ini).
config = context.config

# La URL de conexión se toma de la variable de entorno DATABASE_URL
# (misma que usa la propia app), en vez de dejarla fija en alembic.ini.
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# MetaData de nuestros modelos: permite que `alembic revision --autogenerate`
# compare los modelos de app/models.py contra el estado real de la base de datos.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Modo 'offline': genera el SQL de la migración sin conectarse a la
    base de datos (solo necesita la URL). No se usa en este proyecto —
    las migraciones siempre se aplican en modo 'online', ver más abajo."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Modo 'online': se conecta de verdad a la base de datos y aplica la
    migración — el modo real que usa este proyecto (`alembic upgrade head`)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
