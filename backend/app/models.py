from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

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

    Es la tabla base de la que dependen las rutinas/plantillas (qué
    ejercicios incluyen, ver Rutina/RutinaSlot) y de la que dependerán más
    adelante los entrenamientos (qué ejercicio se hizo de verdad).
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


class Rutina(Base):
    """Una rutina/plantilla del usuario (ej. "Push", "Leg", "Pull") — el
    plan, no un entrenamiento concreto de un día. No existen rutinas
    predefinidas: siempre son propias de un usuario.
    """

    __tablename__ = "rutinas"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    nombre: Mapped[str] = mapped_column(String(100))
    dia_habitual: Mapped[str | None] = mapped_column(String(20), default=None)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    slots: Mapped[list["RutinaSlot"]] = relationship(order_by="RutinaSlot.orden")


class RutinaSlot(Base):
    """Un "hueco" dentro de una rutina (ej. "empuje horizontal", hueco 1 del
    Push) — no un ejercicio fijo: tiene un ejercicio principal y, aparte,
    puede tener comodines (ver SlotAlternativa).
    """

    __tablename__ = "rutina_slots"
    __table_args__ = (UniqueConstraint("rutina_id", "orden"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # RESTRICT (no CASCADE): borrar una rutina con huecos no debe arrastrarlos
    # por accidente — el backend decide explícitamente qué hacer (ver
    # CLAUDE.md, "Borrado de datos").
    rutina_id: Mapped[int] = mapped_column(ForeignKey("rutinas.id", ondelete="RESTRICT"))
    ejercicio_principal_id: Mapped[int] = mapped_column(
        ForeignKey("ejercicios.id", ondelete="RESTRICT")
    )
    orden: Mapped[int] = mapped_column()
    series_objetivo: Mapped[int] = mapped_column()
    reps_min: Mapped[int] = mapped_column()
    reps_max: Mapped[int] = mapped_column()
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    ejercicio_principal: Mapped["Ejercicio"] = relationship()
    slot_alternativas: Mapped[list["SlotAlternativa"]] = relationship(order_by="SlotAlternativa.id")

    @property
    def alternativas(self) -> list["Ejercicio"]:
        """Los ejercicios comodín de este hueco (no la fila de la tabla
        intermedia) — lo que de verdad le interesa a la API."""
        return [sa.ejercicio for sa in self.slot_alternativas]


class SlotAlternativa(Base):
    """Un ejercicio comodín de un hueco de rutina."""

    __tablename__ = "slot_alternativas"
    __table_args__ = (UniqueConstraint("slot_id", "ejercicio_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # CASCADE (a diferencia de rutina_slots→rutinas): un comodín no es
    # "historial", no tiene sentido sin su hueco — si el hueco se borra de
    # verdad, sus comodines se van con él, sin necesidad de avisar aparte.
    slot_id: Mapped[int] = mapped_column(ForeignKey("rutina_slots.id", ondelete="CASCADE"))
    ejercicio_id: Mapped[int] = mapped_column(ForeignKey("ejercicios.id", ondelete="RESTRICT"))

    ejercicio: Mapped["Ejercicio"] = relationship()
