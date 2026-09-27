from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.fechas import hoy


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Ocultable:
    """Lo que se puede ocultar: deja de ofrecerse para usarlo, pero conserva
    todo lo que ya se hizo con ello.

    Se guarda desde cuándo está oculto y no un sí/no, porque la app enseña esa
    fecha ("oculto desde el 10 de septiembre"). El sí/no se deduce de ella, sin
    guardarlo aparte: dos columnas que dicen lo mismo acaban contradiciéndose.
    """

    oculto_desde: Mapped[date | None] = mapped_column(Date, default=None)

    @property
    def oculto(self) -> bool:
        return self.oculto_desde is not None


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


class Ejercicio(Ocultable, Base):
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class NotaUsuarioEjercicio(Base):
    """Una nota personal y privada de un usuario sobre un ejercicio, propio o
    predefinido (ej. "en esta máquina el asiento va en el 4").

    Separada de Ejercicio.descripcion porque esa es información general y
    objetiva del ejercicio (y no editable si es predefinido), mientras que
    una nota es subjetiva y solo la ve quien la escribió. Sin unicidad de
    (usuario_id, ejercicio_id) a propósito: se pueden ir acumulando notas
    independientes sobre el mismo ejercicio a lo largo del tiempo, cada una
    con su propia fila, editable y borrable por separado.
    """

    __tablename__ = "notas_usuario_ejercicio"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    # CASCADE (a diferencia de rutina_slots, slot_alternativas y series hacia
    # ejercicios, que son RESTRICT): una nota no es historial de progresión
    # que haya que proteger, es un accesorio del ejercicio — huérfana no
    # significa nada, así que se va con él sin avisar aparte.
    ejercicio_id: Mapped[int] = mapped_column(ForeignKey("ejercicios.id", ondelete="CASCADE"))
    nota: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class Rutina(Ocultable, Base):
    """Una rutina/plantilla del usuario (ej. "Push", "Leg", "Pull") — el
    plan, no un entrenamiento concreto de un día. No existen rutinas
    predefinidas: siempre son propias de un usuario.
    """

    __tablename__ = "rutinas"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    nombre: Mapped[str] = mapped_column(String(100))
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
    # viewonly: solo para leer en qué días de programa está. Así SQLAlchemy no
    # intenta gestionarlos al borrar la rutina (se van solos, ON DELETE CASCADE),
    # que es justo la trampa en la que ya se cayó con Entrenamiento.series.
    dias_de_programa: Mapped[list["ProgramaDia"]] = relationship(viewonly=True)

    @property
    def num_programas(self) -> int:
        """En cuántos programas visibles aparece, para la lista de rutinas."""
        return len({dia.programa_id for dia in self.dias_de_programa if not dia.programa.oculto})


class RutinaSlot(Ocultable, Base):
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
        intermedia) — lo que de verdad le interesa a la API.
        """
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

    A diferencia de Ejercicio/Rutina/RutinaSlot, no se puede ocultar: es el propio historial, no algo que otras tablas referencien
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
    # Nula mientras la sesión está abierta. Es lo que distingue una sesión a
    # medias de una acabada, que por lo demás son idénticas.
    terminada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    @property
    def en_curso(self) -> bool:
        """Abierta y de hoy: la que se puede continuar.

        Una sesión que se quedó sin terminar de un día para otro cuenta como
        terminada, así que no hace falta cerrarla a medianoche: basta con mirar la
        fecha al leer. Por lo mismo, una sesión pasada que se está apuntando a
        posteriori tampoco está en curso.
        """
        return self.terminada_en is None and self.fecha == hoy()

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


# --- Programas -----------------------------------------------------------


class Programa(Ocultable, Base):
    """Reparte rutinas en la semana: qué rutina toca cada día.

    Las rutinas no son del programa: la misma puede estar en varios programas y
    en varios días de uno. Por eso la relación va en `programa_dias`, y no con
    un `programa_id` en `rutinas`, que ataría cada rutina a un solo programa.
    """

    __tablename__ = "programas"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    nombre: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    # passive_deletes=True en las dos: los días y los periodos se borran con el
    # programa por ON DELETE CASCADE, y SQLAlchemy no debe intentar desvincularlos.
    dias: Mapped[list["ProgramaDia"]] = relationship(
        order_by="ProgramaDia.dia_semana", passive_deletes=True, back_populates="programa"
    )
    periodos: Mapped[list["ProgramaPeriodo"]] = relationship(
        order_by="ProgramaPeriodo.desde", passive_deletes=True
    )

    @property
    def activo(self) -> bool:
        """En uso: el que dice qué toca hoy. Es el que tiene un periodo abierto."""
        return any(periodo.hasta is None for periodo in self.periodos)

    @property
    def activo_desde(self) -> date | None:
        return next((periodo.desde for periodo in self.periodos if periodo.hasta is None), None)


class ProgramaDia(Base):
    """Qué rutina toca un día de la semana en un programa. Un día sin fila es
    descanso.
    """

    __tablename__ = "programa_dias"
    __table_args__ = (
        UniqueConstraint(
            "programa_id", "dia_semana", name="programa_dias_programa_id_dia_semana_key"
        ),
        CheckConstraint("dia_semana BETWEEN 1 AND 7", name="programa_dias_dia_semana_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    programa_id: Mapped[int] = mapped_column(ForeignKey("programas.id", ondelete="CASCADE"))
    # 1 = lunes … 7 = domingo, como date.isoweekday().
    dia_semana: Mapped[int] = mapped_column()
    # CASCADE y no RESTRICT: un día sin su rutina no significa nada, es un
    # accesorio del programa como un comodín lo es de su hueco. Si la rutina se
    # borra, ese día pasa a descanso.
    rutina_id: Mapped[int] = mapped_column(ForeignKey("rutinas.id", ondelete="CASCADE"))

    programa: Mapped["Programa"] = relationship(back_populates="dias")
    rutina: Mapped["Rutina"] = relationship()


class ProgramaPeriodo(Base):
    """Un tramo de tiempo en que un programa estuvo activo, de `desde` a `hasta`
    (sin incluir `hasta`). Abierto, con `hasta` nulo, mientras sigue activo.

    Existe para que el calendario compare cada mes con el programa que tocaba
    entonces, y no con el de hoy.
    """

    __tablename__ = "programa_periodos"
    __table_args__ = (
        CheckConstraint("hasta IS NULL OR hasta >= desde", name="programa_periodos_rango_check"),
        # Solo un periodo abierto por usuario: solo un programa activo. Lo
        # comprueba antes el endpoint; esto es la red por si dos peticiones a la
        # vez se colaran.
        Index(
            "ix_programa_periodos_usuario_abierto",
            "usuario_id",
            unique=True,
            postgresql_where=text("hasta IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    programa_id: Mapped[int] = mapped_column(ForeignKey("programas.id", ondelete="CASCADE"))
    # Repite el del programa porque el índice de arriba necesita tenerlo en la
    # propia tabla. Lo pone siempre el backend, copiado del programa.
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    desde: Mapped[date] = mapped_column(Date)
    hasta: Mapped[date | None] = mapped_column(Date, default=None)
