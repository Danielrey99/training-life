"""Qué toca cada día: el plan, calculado a partir de los programas.

Lo usan la pantalla de hoy (qué toca hoy y el resto de la semana), el calendario
(qué tocaba cada día del mes, para compararlo con lo que se hizo) y la de
planificar (los próximos días). Por eso vive aparte y no dentro de un router.

Cada día se resuelve con el programa que estaba activo **ese día**, no con el de
hoy: un mes de hace un año se compara con el plan de entonces.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import ExcepcionDelPlan, Programa, ProgramaDia, ProgramaPeriodo, Rutina

# Lo que pide la pantalla de resumen: la constancia de un año entero.
DIAS_MAXIMOS = 400


@dataclass
class DiaPlan:
    fecha: date
    # De dónde sale lo que toca: de un cambio hecho a mano para ese día, del
    # programa activo ese día, o de ninguno.
    origen: Literal["excepcion", "programa", "sin_programa"]
    # El programa activo ese día, si lo había, aunque lo que toque venga de una
    # excepción.
    programa_id: int | None
    rutina: Rutina | None
    # Sin rutina, o con una rutina que ese día ya estaba oculta: un día con una
    # rutina oculta se sigue enseñando (en gris), pero no se entrena.
    descanso: bool


def _oculta_ese_dia(rutina: Rutina | None, fecha: date) -> bool:
    return rutina is not None and rutina.oculto_desde is not None and rutina.oculto_desde <= fecha


def validar_rango(desde: date, hasta: date) -> None:
    """422 si el rango está invertido: solo puede ser un error de quien llama, y
    devolver una lista vacía lo disimularía.
    """
    if desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango de fechas está invertido: 'desde' ({desde}) es posterior a 'hasta' ({hasta}).",
        )


def validar_rango_del_plan(desde: date, hasta: date) -> None:
    """Rango no invertido y de como mucho `DIAS_MAXIMOS` días."""
    validar_rango(desde, hasta)
    if (hasta - desde).days + 1 > DIAS_MAXIMOS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango no puede pasar de {DIAS_MAXIMOS} días.",
        )


def dias_del_plan(db: Session, usuario_id: int, desde: date, hasta: date) -> list[DiaPlan]:
    """Qué toca cada día de `desde` a `hasta`, los dos incluidos."""
    validar_rango_del_plan(desde, hasta)
    return resolver_dias(db, usuario_id, desde, hasta)


def resolver_dias(db: Session, usuario_id: int, desde: date, hasta: date) -> list[DiaPlan]:
    """Como `dias_del_plan`, pero sin validar el rango: para quien necesita unos
    días de margen alrededor del que le han pedido (el seguimiento).
    """
    # Los periodos que tocan el rango, con su programa y los días de este ya
    # cargados, y las excepciones del rango: dos consultas en total, en vez de
    # una por día.
    periodos = db.scalars(
        select(ProgramaPeriodo)
        .where(
            ProgramaPeriodo.usuario_id == usuario_id,
            ProgramaPeriodo.desde <= hasta,
            or_(ProgramaPeriodo.hasta.is_(None), ProgramaPeriodo.hasta > desde),
        )
        .options(
            selectinload(ProgramaPeriodo.programa)
            .selectinload(Programa.filas_dias)
            .selectinload(ProgramaDia.rutina)
        )
    ).all()
    excepciones = {
        excepcion.fecha: excepcion
        for excepcion in db.scalars(
            select(ExcepcionDelPlan)
            .where(
                ExcepcionDelPlan.usuario_id == usuario_id,
                ExcepcionDelPlan.fecha >= desde,
                ExcepcionDelPlan.fecha <= hasta,
            )
            .options(selectinload(ExcepcionDelPlan.rutina))
        )
    }

    plan = []
    fecha = desde
    while fecha <= hasta:
        # El periodo cubre de `desde` a `hasta` sin incluir `hasta`.
        periodo = next(
            (p for p in periodos if p.desde <= fecha and (p.hasta is None or fecha < p.hasta)),
            None,
        )
        programa_id = periodo.programa_id if periodo else None
        excepcion = excepciones.get(fecha)
        if excepcion is not None:
            # Lo que se cambió a mano para ese día manda sobre el programa.
            rutina = excepcion.rutina
            origen = "excepcion"
        elif periodo is not None:
            # La fila vigente ESE día, no la de hoy: editar el programa no cambia el pasado.
            dia = next(
                (
                    d
                    for d in periodo.programa.filas_dias
                    if d.dia_semana == fecha.isoweekday()
                    and (d.desde is None or d.desde <= fecha)
                    and (d.hasta is None or fecha < d.hasta)
                ),
                None,
            )
            rutina = dia.rutina if dia else None
            origen = "programa"
        else:
            rutina = None
            origen = "sin_programa"
        plan.append(
            DiaPlan(
                fecha,
                origen,
                programa_id,
                rutina,
                descanso=rutina is None or _oculta_ese_dia(rutina, fecha),
            )
        )
        fecha += timedelta(days=1)
    return plan
