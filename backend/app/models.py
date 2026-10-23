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

    Biblioteca combinada: ejercicios predefinidos (es_predefinido=True) +
    ejercicios propios, en la misma tabla. Sin unicidad de `nombre`: uno propio
    puede llamarse como un predefinido.

    Es la tabla base de la que dependen las rutinas/plantillas (qué
    ejercicios incluyen, ver Rutina/RutinaSlot) y de la que dependerán más
    adelante los entrenamientos (qué ejercicio se hizo de verdad).
    """

    __tablename__ = "ejercicios"
    __table_args__ = (
        CheckConstraint(
            "tipo_registro IN ('peso_reps', 'corporal', 'tiempo')",
            name="ejercicios_tipo_registro_check",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    grupo_muscular_id: Mapped[int] = mapped_column(ForeignKey("grupos_musculares.id"))
    descripcion: Mapped[str | None] = mapped_column(String(500), default=None)
    es_predefinido: Mapped[bool] = mapped_column(Boolean, default=False)
    # Cómo se apunta cada serie de este ejercicio (ver `app/medidas.py`). Se elige al
    # crearlo y no cambia: una serie ya apuntada no se puede reinterpretar.
    tipo_registro: Mapped[str] = mapped_column(
        String(20), default="peso_reps", server_default="peso_reps"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class NotaEjercicio(Base):
    """Una nota personal sobre un ejercicio, propio o predefinido (ej. "en esta
    máquina el asiento va en el 4").

    Separada de Ejercicio.descripcion porque esa es información general y
    objetiva del ejercicio (y no editable si es predefinido), mientras que una
    nota es subjetiva. Sin unicidad de `ejercicio_id` a propósito: se pueden ir
    acumulando notas independientes sobre el mismo ejercicio a lo largo del
    tiempo, cada una con su propia fila, editable y borrable por separado.
    """

    __tablename__ = "notas_ejercicio"

    id: Mapped[int] = mapped_column(primary_key=True)
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
    """Una rutina/plantilla (ej. "Push", "Leg", "Pull") — el plan, no un
    entrenamiento concreto de un día. No existen rutinas predefinidas.
    """

    __tablename__ = "rutinas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    # passive_deletes="all": al borrar la rutina, SQLAlchemy no toca sus huecos
    # nunca, ni siquiera si la lista está cargada (con True a secas, en ese caso
    # intentaría ponerles rutina_id a NULL). Quien decide es la FK, que es
    # RESTRICT a propósito: borrar_rutina borra antes los huecos, explícitamente,
    # y sin eso la base de datos rechaza el borrado. No lleva cascade como las
    # demás porque aquí no se quiere que los huecos se vayan solos.
    slots: Mapped[list["RutinaSlot"]] = relationship(
        order_by="RutinaSlot.orden", passive_deletes="all"
    )
    # viewonly: solo para leer en qué días de programa está. Así SQLAlchemy no
    # intenta gestionarlos al borrar la rutina (se van solos, ON DELETE CASCADE),
    # que es justo la trampa en la que ya se cayó con Entrenamiento.series.
    dias_de_programa: Mapped[list["ProgramaDia"]] = relationship(viewonly=True)

    @property
    def num_programas(self) -> int:
        """En cuántos programas visibles aparece hoy, para la lista de rutinas. Las
        filas cerradas no cuentan: son de lo que tocaba antes.
        """
        return len(
            {
                dia.programa_id
                for dia in self.dias_de_programa
                if dia.hasta is None and not dia.programa.oculto
            }
        )


# Exactamente un par de objetivo, y completo: repeticiones o duración, nunca los dos
# ni ninguno. Vale igual en SQLite, que es donde lo copiará el móvil.
OBJETIVO_CHECK = (
    "(reps_min IS NULL) = (reps_max IS NULL)"
    " AND (duracion_min_s IS NULL) = (duracion_max_s IS NULL)"
    " AND (reps_min IS NULL) <> (duracion_min_s IS NULL)"
)


class RutinaSlot(Ocultable, Base):
    """Un "hueco" dentro de una rutina (ej. "empuje horizontal", hueco 1 del
    Push) — no un ejercicio fijo: tiene un ejercicio principal y, aparte,
    puede tener comodines (ver SlotAlternativa).
    """

    __tablename__ = "rutina_slots"
    __table_args__ = (
        UniqueConstraint("rutina_id", "orden"),
        CheckConstraint(OBJETIVO_CHECK, name="rutina_slots_objetivo_check"),
    )

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
    # El objetivo es de repeticiones o de duración, según el tipo del ejercicio: un par
    # completo y el otro nulo (OBJETIVO_CHECK).
    reps_min: Mapped[int | None] = mapped_column()
    reps_max: Mapped[int | None] = mapped_column()
    duracion_min_s: Mapped[int | None] = mapped_column()
    duracion_max_s: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    ejercicio_principal: Mapped["Ejercicio"] = relationship()
    # Los comodines se borran con su hueco (ON DELETE CASCADE). passive_deletes
    # solo no basta: con la lista cargada, SQLAlchemy intentaría poner su slot_id
    # a NULL. Con el cascade, los cargados los borra él y los que no, la base.
    slot_alternativas: Mapped[list["SlotAlternativa"]] = relationship(
        order_by="SlotAlternativa.id", cascade="all, delete-orphan", passive_deletes=True
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
    __table_args__ = (
        UniqueConstraint("slot_id", "ejercicio_id"),
        CheckConstraint(OBJETIVO_CHECK, name="slot_alternativas_objetivo_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # CASCADE (a diferencia de rutina_slots→rutinas): un comodín no es
    # "historial", no tiene sentido sin su hueco — si el hueco se borra de
    # verdad, sus comodines se van con él, sin necesidad de avisar aparte.
    slot_id: Mapped[int] = mapped_column(ForeignKey("rutina_slots.id", ondelete="CASCADE"))
    ejercicio_id: Mapped[int] = mapped_column(ForeignKey("ejercicios.id", ondelete="RESTRICT"))
    # El objetivo de esta alternativa en este hueco: no tiene por qué ser el del
    # principal (Plancha puede ser 3 × 30-45 s donde el principal es de repeticiones).
    series_objetivo: Mapped[int] = mapped_column()
    reps_min: Mapped[int | None] = mapped_column()
    reps_max: Mapped[int | None] = mapped_column()
    duracion_min_s: Mapped[int | None] = mapped_column()
    duracion_max_s: Mapped[int | None] = mapped_column()

    ejercicio: Mapped["Ejercicio"] = relationship()


class Entrenamiento(Base):
    """Una sesión real de entrenamiento, en una fecha concreta.

    A diferencia de Ejercicio/Rutina/RutinaSlot, no se puede ocultar: es el propio
    historial, no algo que otras tablas referencien con historial que proteger —
    nada depende de un entrenamiento concreto salvo sus propias series, que se
    borran con él (CASCADE). Por eso su DELETE es directo, sin parámetro `modo`
    de por medio.
    """

    __tablename__ = "entrenamientos"
    # Una sesión por día como mucho, sea de la rutina que sea: se entrena una rutina al
    # día. La API lo comprueba antes (_validar_dia_libre) para dar un 409 legible.
    # Y un día del plan lo cuenta una sesión como mucho; las que no cuentan para
    # ninguno llevan cubre_fecha nula, y los nulos no chocan entre sí.
    __table_args__ = (
        UniqueConstraint("fecha", name="entrenamientos_fecha_key"),
        UniqueConstraint("cubre_fecha", name="entrenamientos_cubre_fecha_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # RESTRICT: borrar una rutina con entrenamientos ya registrados no debe
    # arrastrarlos por accidente (ver Rutina/borrar_rutina, modo=definitivo).
    # Se fija al crear la sesión y no cambia: sus series van en huecos de esta
    # rutina, y solo eso lo garantiza (junto con `_validar_slot`). Si algún día otro
    # camino la cambiara (importar datos), habría que volver a comprobarlo.
    rutina_id: Mapped[int] = mapped_column(ForeignKey("rutinas.id", ondelete="RESTRICT"))
    fecha: Mapped[date] = mapped_column(Date)
    # El día del plan que cuenta esta sesión: el mismo que `fecha` al empezar lo
    # que toca hoy, uno pasado al recuperar y uno de esta semana al adelantar. Lo
    # decide el botón que se pulsa, no se deduce: con dos Push en la semana, la
    # misma sesión puede ser una cosa u otra. Nula si no cuenta para ninguno.
    cubre_fecha: Mapped[date | None] = mapped_column(Date, default=None)
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

    # Las series se borran con su entrenamiento (ON DELETE CASCADE). Mismo patrón
    # que en RutinaSlot.slot_alternativas: el cascade cubre la lista cargada, que
    # passive_deletes solo no cubre.
    series: Mapped[list["Serie"]] = relationship(
        order_by="Serie.numero_serie", cascade="all, delete-orphan", passive_deletes=True
    )
    # Solo para leer (el seguimiento la carga de una vez para todas las sesiones):
    # que SQLAlchemy no gestione nada por ella al borrar la rutina, que ya
    # decide borrar_rutina.
    rutina: Mapped["Rutina"] = relationship(viewonly=True)


class Serie(Base):
    """Una serie real dentro de un entrenamiento: el ejercicio que de verdad
    se hizo, con su peso, repeticiones y variante — lo que llena el historial de
    progresión.
    """

    __tablename__ = "series"
    # Solo la forma de la serie: o lleva repeticiones (con peso) o lleva duración. Qué
    # medidas pide cada ejercicio lo decide su tipo (`app/medidas.py`), que está en otra
    # tabla y por eso lo comprueba el endpoint.
    __table_args__ = (
        CheckConstraint(
            "(repeticiones IS NOT NULL AND peso IS NOT NULL AND duracion_s IS NULL)"
            " OR (repeticiones IS NULL AND duracion_s IS NOT NULL)",
            name="series_medidas_check",
        ),
        # Una carga negativa (la ayuda de las dominadas) solo existe con repeticiones.
        CheckConstraint(
            "peso IS NULL OR peso >= 0 OR repeticiones IS NOT NULL", name="series_peso_check"
        ),
        CheckConstraint("duracion_s IS NULL OR duracion_s > 0", name="series_duracion_check"),
        CheckConstraint(
            "peso_corporal IS NULL OR (peso_corporal > 0 AND repeticiones IS NOT NULL)",
            name="series_peso_corporal_check",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # CASCADE: una serie no tiene sentido sin su entrenamiento (a diferencia
    # de slot_id/ejercicio_id, que sí son RESTRICT — esos sí son historial
    # que otras tablas deben proteger explícitamente).
    entrenamiento_id: Mapped[int] = mapped_column(
        ForeignKey("entrenamientos.id", ondelete="CASCADE")
    )
    slot_id: Mapped[int] = mapped_column(ForeignKey("rutina_slots.id", ondelete="RESTRICT"))
    ejercicio_id: Mapped[int] = mapped_column(ForeignKey("ejercicios.id", ondelete="RESTRICT"))
    numero_serie: Mapped[int] = mapped_column()
    # Según el tipo del ejercicio, unas medidas valen y otras van nulas.
    peso: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), default=None)
    repeticiones: Mapped[int | None] = mapped_column(default=None)
    # En segundos.
    duracion_s: Mapped[int | None] = mapped_column(default=None)
    # Cuánto pesaba la persona al hacer una serie de peso corporal, en kg. Ningún cálculo
    # lo usa: es un dato de la serie, como la variante.
    peso_corporal: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), default=None)
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
    nombre: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    # Días y periodos se borran con el programa. passive_deletes solo no basta: si
    # la lista ya está cargada (y lo está al comprobar si tiene periodos antes de
    # borrarlo), SQLAlchemy intenta poner su programa_id a NULL. Con el cascade,
    # los cargados los borra él y los que no, el ON DELETE CASCADE de la base.
    # Todas las filas, también las que ya no están vigentes: son las que dicen qué
    # tocaba en el pasado (ver ProgramaDia). La plantilla de hoy es `dias`.
    filas_dias: Mapped[list["ProgramaDia"]] = relationship(
        order_by="ProgramaDia.dia_semana",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="programa",
    )
    periodos: Mapped[list["ProgramaPeriodo"]] = relationship(
        order_by="ProgramaPeriodo.desde",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="programa",
    )

    @property
    def dias(self) -> list["ProgramaDia"]:
        """La plantilla de ahora: solo las filas vigentes, una por día como mucho.
        Para saber qué tocaba un día pasado hay que mirar `filas_dias` con su
        vigencia, no esto.
        """
        return [fila for fila in self.filas_dias if fila.hasta is None]

    @property
    def activo(self) -> bool:
        """En uso: el que dice qué toca hoy. Es el que tiene un periodo abierto."""
        return any(periodo.hasta is None for periodo in self.periodos)

    @property
    def ultimo_periodo(self) -> "ProgramaPeriodo | None":
        """El último tramo en uso: el abierto si está activo; si no, el último que
        se cerró. Nulo si nunca se ha usado. Es lo que dice la lista de programas
        ("Del 2 de marzo al 28 de junio") y si borrarlo pierde algo del calendario.
        """
        # Los periodos de un programa no se solapan y como mucho uno está abierto,
        # así que el de `desde` más reciente es el abierto si lo hay.
        return max(self.periodos, key=lambda periodo: (periodo.desde, periodo.id), default=None)


class ProgramaDia(Base):
    """Qué rutina toca un día de la semana en un programa, y desde cuándo hasta
    cuándo. Un día sin fila vigente es descanso.

    La vigencia existe para que editar un programa no reescriba el pasado:
    cambiar la rutina de un día cierra la fila de antes (`hasta` = hoy) y abre
    otra (`desde` = hoy), y los días pasados siguen resolviéndose con la vieja.
    Intervalo semiabierto, como los periodos: de `desde` a `hasta` sin incluirlo.
    `desde` nulo = desde siempre; `hasta` nulo = vigente.
    """

    __tablename__ = "programa_dias"
    __table_args__ = (
        CheckConstraint("dia_semana BETWEEN 1 AND 7", name="programa_dias_dia_semana_check"),
        CheckConstraint(
            "desde IS NULL OR hasta IS NULL OR hasta > desde", name="programa_dias_vigencia_check"
        ),
        # Una sola fila vigente por día: un día, una rutina. Las cerradas no chocan.
        Index(
            "ix_programa_dias_programa_dia_abierto",
            "programa_id",
            "dia_semana",
            unique=True,
            postgresql_where=text("hasta IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    programa_id: Mapped[int] = mapped_column(ForeignKey("programas.id", ondelete="CASCADE"))
    # 1 = lunes … 7 = domingo, como date.isoweekday().
    dia_semana: Mapped[int] = mapped_column()
    # CASCADE y no RESTRICT: un día sin su rutina no significa nada, es un
    # accesorio del programa como un comodín lo es de su hueco. Si la rutina se
    # borra, ese día pasa a descanso.
    rutina_id: Mapped[int] = mapped_column(ForeignKey("rutinas.id", ondelete="CASCADE"))
    desde: Mapped[date | None] = mapped_column(Date, default=None)
    hasta: Mapped[date | None] = mapped_column(Date, default=None)

    programa: Mapped["Programa"] = relationship(back_populates="filas_dias")
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
        # Solo un periodo abierto: solo un programa activo. Lo comprueba antes el
        # endpoint; esto es la red por si dos peticiones a la vez se colaran. Es
        # un índice sobre una expresión constante (`hasta IS NULL` vale lo mismo en
        # todos los abiertos), así que un segundo abierto choca; vale igual en SQLite.
        Index(
            "ix_programa_periodos_abierto",
            text("(hasta IS NULL)"),
            unique=True,
            postgresql_where=text("hasta IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    programa_id: Mapped[int] = mapped_column(ForeignKey("programas.id", ondelete="CASCADE"))
    desde: Mapped[date] = mapped_column(Date)
    hasta: Mapped[date | None] = mapped_column(Date, default=None)

    programa: Mapped["Programa"] = relationship(back_populates="periodos")


class ExcepcionDelPlan(Base):
    """Lo que toca un día concreto cuando no es lo que dice el programa: otra
    rutina o descanso. Es lo que se cambia en la pantalla de planificar.

    Qué toca el día X: su excepción si la tiene; si no, lo que diga el programa
    que esté activo ese día.
    """

    __tablename__ = "excepciones_del_plan"
    __table_args__ = (UniqueConstraint("fecha", name="excepciones_del_plan_fecha_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[date] = mapped_column(Date)
    # Nula = ese día es descanso. CASCADE y no SET NULL: si la rutina se borra,
    # el día vuelve a lo que diga el programa, en vez de quedarse en un descanso
    # que nadie eligió.
    rutina_id: Mapped[int | None] = mapped_column(
        ForeignKey("rutinas.id", ondelete="CASCADE"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    rutina: Mapped["Rutina | None"] = relationship()
