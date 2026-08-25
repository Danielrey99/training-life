from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Ejercicio(Base):
    """Un ejercicio de la biblioteca (ej. 'Press banca', 'Sentadilla').

    Es la tabla base de la que dependerán más adelante los entrenamientos
    (qué ejercicio se hizo) y las rutinas/plantillas (qué ejercicios incluyen).
    """

    __tablename__ = "ejercicios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    grupo_muscular: Mapped[str] = mapped_column(String(50))
    descripcion: Mapped[str | None] = mapped_column(String(500), default=None)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
