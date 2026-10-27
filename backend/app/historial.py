"""Consulta del historial de progresión de un ejercicio: quedarse con las últimas
sesiones en que se hizo y agrupar sus series por día.
"""

from collections import defaultdict
from datetime import date

from sqlalchemy import ColumnElement, select
from sqlalchemy.orm import Session

from app.models import Entrenamiento, Rutina, Serie

SESIONES_POR_DEFECTO = 50


def sesiones_con_series(
    db: Session,
    filtro: ColumnElement[bool],
    hasta: date | None = None,
    limite: int = SESIONES_POR_DEFECTO,
) -> list[dict]:
    """Las últimas sesiones con series que cumplan `filtro`, de la más
    reciente a la más antigua y con esas series dentro.

    El límite cuenta sesiones, no series: cortar por series partiría un día por la
    mitad y la progresión de ese día se leería mal.
    """
    sesiones = (
        select(Entrenamiento.id, Entrenamiento.fecha, Rutina.nombre)
        .join(Serie, Serie.entrenamiento_id == Entrenamiento.id)
        .join(Rutina, Rutina.id == Entrenamiento.rutina_id)
        .where(filtro)
    )
    if hasta is not None:
        sesiones = sesiones.where(Entrenamiento.fecha <= hasta)

    # DISTINCT porque el join con series devuelve una fila por serie, y aquí solo
    # se buscan los entrenamientos. Las tres columnas van en el SELECT porque
    # Postgres exige que lo ordenado aparezca en él cuando hay DISTINCT.
    filas = db.execute(
        sesiones.distinct()
        .order_by(Entrenamiento.fecha.desc(), Entrenamiento.id.desc())
        .limit(limite)
    ).all()
    if not filas:
        return []

    series = db.scalars(
        select(Serie)
        .where(Serie.entrenamiento_id.in_([fila[0] for fila in filas]), filtro)
        # El id desempata: si un ejercicio ocupa dos huecos de la misma rutina,
        # el mismo día trae dos series con el mismo numero_serie, y sin
        # desempate Postgres puede devolverlas en cualquier orden.
        .order_by(Serie.numero_serie, Serie.id)
    ).all()

    por_sesion = defaultdict(list)
    for serie in series:
        por_sesion[serie.entrenamiento_id].append(serie)

    return [
        {
            "entrenamiento_id": entrenamiento_id,
            "fecha": fecha,
            "rutina": nombre_rutina,
            "series": por_sesion[entrenamiento_id],
        }
        for entrenamiento_id, fecha, nombre_rutina in filas
    ]
