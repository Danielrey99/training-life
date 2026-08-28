from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Usuario(Base):
    """Usuario de la app.

    Mientras no exista autenticación real (JWT, "nivel medio" del roadmap),
    el backend trabaja con una única fila sembrada por migración y un
    usuario_id hardcodeado en el código — ver CLAUDE.md, sección
    "Esquema de base de datos".
    """

    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class GrupoMuscular(Base):
    """Grupo muscular (ej. "Pecho", "Espalda", "Pierna").

    Tabla de referencia simple para evitar inconsistencias de texto libre
    en Ejercicio (ej. "pecho" vs "Pecho" vs "pectoral").
    """

    __tablename__ = "grupos_musculares"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(50), unique=True)


class Ejercicio(Base):
    """Un ejercicio de la biblioteca (ej. 'Press banca', 'Sentadilla').

    Biblioteca combinada: ejercicios predefinidos (es_predefinido=True,
    usuario_id NULL) + ejercicios creados por cada usuario (usuario_id propio),
    en la misma tabla. Sin unicidad de `nombre`: dos usuarios distintos pueden
    llamar igual a su propio ejercicio.

    Es la tabla base de la que dependerán más adelante los entrenamientos
    (qué ejercicio se hizo) y las rutinas/plantillas (qué ejercicios incluyen).
    """

    __tablename__ = "ejercicios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    grupo_muscular_id: Mapped[int] = mapped_column(ForeignKey("grupos_musculares.id"))
    descripcion: Mapped[str | None] = mapped_column(String(500), default=None)
    es_predefinido: Mapped[bool] = mapped_column(Boolean, default=False)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), default=None)
    visibilidad: Mapped[str] = mapped_column(String(20), default="privado")
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
