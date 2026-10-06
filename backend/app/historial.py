"""Consulta compartida del historial de progresión.

La usan dos endpoints con filtros distintos —las series de un ejercicio concreto y
las de un hueco de rutina— pero el resto del trabajo es el mismo: quedarse con las
últimas sesiones del usuario y agrupar sus series por día.
"""

from collections import defaultdict
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, select
from sqlalchemy.orm import Session, selectinload

from app.models import Entrenamiento, Rutina, Serie

SESIONES_POR_DEFECTO = 50


def sesiones_con_series(
    db: Session,
    usuario_id: int,
    filtro: ColumnElement[bool],
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = SESIONES_POR_DEFECTO,
) -> list[dict]:
    """Las últimas sesiones del usuario con series que cumplan `filtro`, de la más
    reciente a la más antigua y con esas series dentro.

    El límite cuenta sesiones, no series: cortar por series partiría un día por la
    mitad y la progresión de ese día se leería mal.
    """
    # Un rango invertido siempre devolvería una lista vacía, y eso disimularía el
    # error del cliente. Mismo criterio que reps_max/reps_min en un hueco.
    if desde is not None and hasta is not None and desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango de fechas está invertido: 'desde' ({desde}) es posterior a 'hasta' ({hasta}).",
        )

    sesiones = (
        select(Entrenamiento.id, Entrenamiento.fecha, Rutina.nombre)
        .join(Serie, Serie.entrenamiento_id == Entrenamiento.id)
        .join(Rutina, Rutina.id == Entrenamiento.rutina_id)
        .where(Entrenamiento.usuario_id == usuario_id, filtro)
    )
    if desde is not None:
        sesiones = sesiones.where(Entrenamiento.fecha >= desde)
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
        .options(selectinload(Serie.ejercicio))
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
