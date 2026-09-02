from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Usuario(Base):
    """Usuario de la app.

    Mientras no exista autenticación real (JWT, "nivel medio" del roadmap),
    el backend trabaja con una única fila sembrada por migración y un
    usuario_id hardcodeado en el código (ver app/auth.py).
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

    # passive_deletes=True: al borrar la rutina, no intentar gestionar sus
    # huecos desde Python (SQLAlchemy por defecto pondría su FK a NULL, y
    # como rutina_id no admite NULL, eso rompería con un error) — confiar en
    # que el backend ya los borra explícitamente antes (o en el ON DELETE
    # real de la base de datos).
    slots: Mapped[list["RutinaSlot"]] = relationship(
        order_by="RutinaSlot.orden", passive_deletes=True
    )


class RutinaSlot(Base):
    """Un "hueco" dentro de una rutina (ej. "empuje horizontal", hueco 1 del
    Push) — no un ejercicio fijo: tiene un ejercicio principal y, aparte,
    puede tener comodines (ver SlotAlternativa).
    """

    __tablename__ = "rutina_slots"
    __table_args__ = (UniqueConstraint("rutina_id", "orden"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # RESTRICT (no CASCADE): borrar una rutina con huecos no debe arrastrarlos
    # por accidente — es el backend (routers/rutinas.py) el que decide
    # explícitamente qué hacer con ellos.
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
    # passive_deletes=True: mismo motivo que en Rutina.slots — al borrar el
    # hueco, que sea la base de datos (ON DELETE CASCADE) la que borre sus
    # comodines, sin que SQLAlchemy intente poner slot_id a NULL antes.
    slot_alternativas: Mapped[list["SlotAlternativa"]] = relationship(
        order_by="SlotAlternativa.id", passive_deletes=True
    )

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


class Entrenamiento(Base):
    """Una sesión real de entrenamiento, en una fecha concreta.

    A diferencia de Ejercicio/Rutina/RutinaSlot, no tiene borrado lógico
    (`activo`): es el propio historial, no algo que otras tablas referencien
    con historial que proteger — nada depende de un entrenamiento concreto
    salvo sus propias series, que se borran con él (CASCADE). Por eso su
    DELETE es directo, sin parámetro `modo` de por medio.
    """

    __tablename__ = "entrenamientos"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    # RESTRICT: borrar una rutina con entrenamientos ya registrados no debe
    # arrastrarlos por accidente (ver Rutina/borrar_rutina, modo=definitivo).
    rutina_id: Mapped[int | None] = mapped_column(
        ForeignKey("rutinas.id", ondelete="RESTRICT"), default=None
    )
    fecha: Mapped[date] = mapped_column(Date)
    notas: Mapped[str | None] = mapped_column(String(1000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    # passive_deletes=True: mismo motivo que en Rutina.slots — al borrar el
    # entrenamiento, que sea la base de datos (ON DELETE CASCADE) la que
    # borre sus series, sin que SQLAlchemy intente poner entrenamiento_id a
    # NULL antes (fallaría: esa columna no admite NULL).
    series: Mapped[list["Serie"]] = relationship(
        order_by="Serie.numero_serie", passive_deletes=True
    )


class Serie(Base):
    """Una serie real dentro de un entrenamiento: el ejercicio que de verdad
    se hizo, con su peso, repeticiones y RPE — lo que llena el historial de
    progresión.
    """

    __tablename__ = "series"

    id: Mapped[int] = mapped_column(primary_key=True)
    # CASCADE: una serie no tiene sentido sin su entrenamiento (a diferencia
    # de slot_id/ejercicio_id, que sí son RESTRICT — esos sí son historial
    # que otras tablas deben proteger explícitamente).
    entrenamiento_id: Mapped[int] = mapped_column(
        ForeignKey("entrenamientos.id", ondelete="CASCADE")
    )
    slot_id: Mapped[int | None] = mapped_column(
        ForeignKey("rutina_slots.id", ondelete="RESTRICT"), default=None
    )
    ejercicio_id: Mapped[int] = mapped_column(ForeignKey("ejercicios.id", ondelete="RESTRICT"))
    numero_serie: Mapped[int] = mapped_column()
    peso: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    repeticiones: Mapped[int] = mapped_column()
    rpe: Mapped[Decimal | None] = mapped_column(Numeric(3, 1), default=None)
    variante: Mapped[str | None] = mapped_column(String(100), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    ejercicio: Mapped["Ejercicio"] = relationship()
