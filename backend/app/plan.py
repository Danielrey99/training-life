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

from app.fechas import fecha_en_texto
from app.models import (
    ExcepcionDelPlan,
    Programa,
    ProgramaDia,
    ProgramaPeriodo,
    Rutina,
    RutinaPeriodoOculto,
)

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
    # Sin rutina, o con una rutina que ese día estaba oculta (ahora o en un tramo ya
    # cerrado): un día con una rutina oculta se sigue enseñando (en gris), pero no se
    # entrena. Es lo que toca, no lo que pasó: si una sesión de esa rutina ya contaba
    # ese día antes de ocultarla, el seguimiento lo da por hecho.
    descanso: bool


def _oculta_ese_dia(
    rutina: Rutina, fecha: date, tramos: dict[int, list[tuple[date, date]]]
) -> bool:
    """Si la rutina estaba oculta ese día: lo está ahora desde antes, o el día cae en un
    tramo en que lo estuvo (`[desde, hasta)`).
    """
    if rutina.oculto_desde is not None and rutina.oculto_desde <= fecha:
        return True
    return any(desde <= fecha < hasta for desde, hasta in tramos.get(rutina.id, ()))


def validar_rango(desde: date, hasta: date) -> None:
    """422 si el rango está invertido: solo puede ser un error de quien llama, y
    devolver una lista vacía lo disimularía.
    """
    if desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Las fechas están al revés. El {fecha_en_texto(desde)} va después del"
                f" {fecha_en_texto(hasta)}."
            ),
        )


def validar_rango_del_plan(desde: date, hasta: date) -> None:
    """Rango no invertido y de como mucho `DIAS_MAXIMOS` días."""
    validar_rango(desde, hasta)
    if (hasta - desde).days + 1 > DIAS_MAXIMOS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Como mucho se piden {DIAS_MAXIMOS} días de una vez.",
        )


def dias_del_plan(db: Session, desde: date, hasta: date) -> list[DiaPlan]:
    """Qué toca cada día de `desde` a `hasta`, los dos incluidos."""
    validar_rango_del_plan(desde, hasta)
    return resolver_dias(db, desde, hasta)


def resolver_dias(db: Session, desde: date, hasta: date) -> list[DiaPlan]:
    """Como `dias_del_plan`, pero sin validar el rango: para quien necesita unos
    días de margen alrededor del que le han pedido (el seguimiento).
    """
    # Los periodos que tocan el rango, con su programa y los días de este ya
    # cargados, las excepciones del rango y los tramos en que alguna rutina estuvo
    # oculta: un número fijo de consultas, en vez de una por día.
    periodos = db.scalars(
        select(ProgramaPeriodo)
        .where(
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
                ExcepcionDelPlan.fecha >= desde,
                ExcepcionDelPlan.fecha <= hasta,
            )
            .options(selectinload(ExcepcionDelPlan.rutina))
        )
    }

    tramos: dict[int, list[tuple[date, date]]] = {}
    for tramo in db.scalars(
        select(RutinaPeriodoOculto).where(
            RutinaPeriodoOculto.desde <= hasta, RutinaPeriodoOculto.hasta > desde
        )
    ):
        tramos.setdefault(tramo.rutina_id, []).append((tramo.desde, tramo.hasta))

    plan = []
    # Contando días y no sumando hasta pasarse: después del 31-12-9999 no hay fecha.
    for n in range((hasta - desde).days + 1):
        fecha = desde + timedelta(days=n)
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
                descanso=rutina is None or _oculta_ese_dia(rutina, fecha, tramos),
            )
        )
    return plan


def buscar_excepcion(db: Session, fecha: date) -> ExcepcionDelPlan | None:
    return db.scalar(select(ExcepcionDelPlan).where(ExcepcionDelPlan.fecha == fecha))


def poner_excepcion(db: Session, fecha: date, rutina_id: int | None) -> None:
    """Cambia a mano lo que toca un día (sin confirmar la transacción)."""
    # Se busca antes y se actualiza, en vez de insertar y dejar que la unicidad de
    # la fecha salte en la base de datos con un error crudo.
    excepcion = buscar_excepcion(db, fecha)
    if excepcion is None:
        db.add(ExcepcionDelPlan(fecha=fecha, rutina_id=rutina_id))
    else:
        excepcion.rutina_id = rutina_id
