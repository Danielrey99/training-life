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

from app.models import Programa, ProgramaDia, ProgramaPeriodo, Rutina

# Lo que pide la pantalla de resumen: la constancia de un año entero.
DIAS_MAXIMOS = 400


@dataclass
class DiaPlan:
    fecha: date
    # De dónde sale lo que toca: del programa activo ese día, o de ninguno.
    origen: Literal["programa", "sin_programa"]
    programa_id: int | None
    rutina: Rutina | None
    # Sin rutina, o con una rutina que ese día ya estaba oculta: un día con una
    # rutina oculta se sigue enseñando (en gris), pero no se entrena.
    descanso: bool


def dias_del_plan(db: Session, usuario_id: int, desde: date, hasta: date) -> list[DiaPlan]:
    """Qué toca cada día de `desde` a `hasta`, los dos incluidos."""
    if desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango de fechas está invertido: 'desde' ({desde}) es posterior a 'hasta' ({hasta}).",
        )
    if (hasta - desde).days + 1 > DIAS_MAXIMOS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango no puede pasar de {DIAS_MAXIMOS} días.",
        )

    # Los periodos que tocan el rango, con su programa y los días de este ya
    # cargados: una sola consulta, en vez de una por día.
    periodos = db.scalars(
        select(ProgramaPeriodo)
        .where(
            ProgramaPeriodo.usuario_id == usuario_id,
            ProgramaPeriodo.desde <= hasta,
            or_(ProgramaPeriodo.hasta.is_(None), ProgramaPeriodo.hasta > desde),
        )
        .options(
            selectinload(ProgramaPeriodo.programa)
            .selectinload(Programa.dias)
            .selectinload(ProgramaDia.rutina)
        )
    ).all()

    plan = []
    fecha = desde
    while fecha <= hasta:
        # El periodo cubre de `desde` a `hasta` sin incluir `hasta`.
        periodo = next(
            (p for p in periodos if p.desde <= fecha and (p.hasta is None or fecha < p.hasta)),
            None,
        )
        if periodo is None:
            plan.append(DiaPlan(fecha, "sin_programa", None, None, descanso=True))
        else:
            dia = next(
                (d for d in periodo.programa.dias if d.dia_semana == fecha.isoweekday()), None
            )
            rutina = dia.rutina if dia else None
            oculta_ese_dia = (
                rutina is not None
                and rutina.oculto_desde is not None
                and (rutina.oculto_desde <= fecha)
            )
            plan.append(
                DiaPlan(
                    fecha,
                    "programa",
                    periodo.programa_id,
                    rutina,
                    descanso=rutina is None or oculta_ese_dia,
                )
            )
        fecha += timedelta(days=1)
    return plan
