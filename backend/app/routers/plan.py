from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.fechas import hoy
from app.models import ExcepcionDelPlan
from app.plan import dias_del_plan, validar_rango
from app.routers.rutinas import obtener_rutina_visible
from app.schemas import (
    DiaPlanOut,
    DiaSeguimientoOut,
    ExcepcionOut,
    ExcepcionUpdate,
    HoyOut,
    IntercambioCreate,
)
from app.seguimiento import (
    coberturas_en_juego,
    reubicar_coberturas,
    resumen_de_hoy,
    seguimiento,
)

router = APIRouter(prefix="/plan", tags=["plan"])


def _exigir_hoy_o_despues(fecha: date) -> None:
    """El pasado no se planifica: lo que pasó se registra, no se cambia."""
    if fecha < hoy():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El {fecha} ya ha pasado: solo se puede planificar de hoy en adelante.",
        )


def _buscar_excepcion(db: Session, usuario_id: int, fecha: date) -> ExcepcionDelPlan | None:
    return db.scalar(
        select(ExcepcionDelPlan).where(
            ExcepcionDelPlan.usuario_id == usuario_id, ExcepcionDelPlan.fecha == fecha
        )
    )


def _poner_excepcion(db: Session, usuario_id: int, fecha: date, rutina_id: int | None) -> None:
    # Se busca antes y se actualiza, en vez de insertar y dejar que la unicidad de
    # usuario y fecha salte en la base de datos con un error crudo.
    excepcion = _buscar_excepcion(db, usuario_id, fecha)
    if excepcion is None:
        db.add(ExcepcionDelPlan(usuario_id=usuario_id, fecha=fecha, rutina_id=rutina_id))
    else:
        excepcion.rutina_id = rutina_id


@router.get("", response_model=list[DiaPlanOut])
def obtener_plan(
    desde: date,
    hasta: date,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Qué toca cada día de `desde` a `hasta` (incluidos): lo que se haya cambiado
    a mano para ese día o, si no, lo que diga el programa que estaba activo ese
    día. Sirve igual para el pasado (el calendario) que para el futuro (los
    próximos días). Como mucho, 400 días de una vez.
    """
    return dias_del_plan(db, usuario_id, desde, hasta)


@router.get("/seguimiento", response_model=list[DiaSeguimientoOut])
def obtener_seguimiento(
    desde: date,
    hasta: date,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Qué tocaba cada día de `desde` a `hasta` (incluidos) y qué pasó: si está
    hecho, movido a otro día, sin hacer, pendiente (hoy) o próximo, qué sesión lo
    cuenta y qué se hizo ese día. Lo usan el calendario, la semana de la pantalla
    de hoy y la constancia del resumen (`app/resumen.py`). Como mucho, 400 días de
    una vez.
    """
    return seguimiento(db, usuario_id, desde, hasta)


@router.get("/hoy", response_model=HoyOut)
def obtener_hoy(
    fecha: date | None = None,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Lo que necesita la pantalla de hoy: en qué situación está el día, la semana,
    lo que se puede recuperar, lo que se ofrece entrenar, el próximo entrenamiento
    y la última sesión.

    Con `fecha` (un día pasado) sirve para la hoja de registrar ese día desde el
    calendario, que ofrece lo que habría ofrecido la pantalla de hoy aquel día. Una
    fecha futura da 422: el futuro se planifica, no se registra.
    """
    fecha = fecha or hoy()
    if fecha > hoy():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El {fecha} todavía no ha llegado: solo se registran días de hoy hacia atrás.",
        )
    return resumen_de_hoy(db, usuario_id, fecha)


# --- Excepciones: lo que se cambia a mano para un día ---------------------


@router.get("/excepciones", response_model=list[ExcepcionOut])
def listar_excepciones(
    desde: date | None = None,
    hasta: date | None = None,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Los días cambiados a mano, del más cercano al más lejano. Con `desde` = hoy
    son los que se perderían al activar otro programa quitándolos.
    """
    if desde is not None and hasta is not None:
        validar_rango(desde, hasta)
    stmt = select(ExcepcionDelPlan).where(ExcepcionDelPlan.usuario_id == usuario_id)
    if desde is not None:
        stmt = stmt.where(ExcepcionDelPlan.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(ExcepcionDelPlan.fecha <= hasta)
    return db.scalars(stmt.order_by(ExcepcionDelPlan.fecha)).all()


@router.put("/excepciones/{fecha}", response_model=ExcepcionOut)
def planificar_dia(
    fecha: date,
    datos: ExcepcionUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Cambia lo que toca un día: otra rutina, o descanso con `rutina_id` nulo. Si
    ya estaba cambiado, lo sustituye.

    Se guarda aunque coincida con lo que dice el programa: elegir a mano la rutina
    de siempre deja el día marcado como cambiado, y para devolverlo al programa
    está *Restablecer este día*.

    Si el día ya estaba hecho por adelantado, la sesión sigue a su rutina a otro
    día de esta semana; si no le queda ninguno, 409 (ver `reubicar_coberturas`).
    """
    _exigir_hoy_o_despues(fecha)
    if datos.rutina_id is not None:
        obtener_rutina_visible(db, datos.rutina_id, usuario_id)
    contaban = coberturas_en_juego(db, usuario_id)
    _poner_excepcion(db, usuario_id, fecha, datos.rutina_id)
    reubicar_coberturas(db, usuario_id, contaban)
    db.commit()
    return _buscar_excepcion(db, usuario_id, fecha)


@router.delete("/excepciones/{fecha}", status_code=status.HTTP_204_NO_CONTENT)
def restablecer_dia(
    fecha: date,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """*Restablecer este día*: vuelve a lo que diga el programa. Lo hecho por
    adelantado se reubica como al planificar.
    """
    _exigir_hoy_o_despues(fecha)
    excepcion = _buscar_excepcion(db, usuario_id, fecha)
    if excepcion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese día no estaba cambiado: ya es lo que dice el programa",
        )
    contaban = coberturas_en_juego(db, usuario_id)
    db.delete(excepcion)
    reubicar_coberturas(db, usuario_id, contaban)
    db.commit()


@router.delete("/excepciones", status_code=status.HTTP_204_NO_CONTENT)
def restablecer_rango(
    desde: date,
    hasta: date,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """*Restablecer la semana*: devuelve al programa los días del rango, de hoy en
    adelante. Los días ya pasados no se tocan: el pasado no se planifica. Lo hecho
    por adelantado se reubica como al planificar.
    """
    validar_rango(desde, hasta)
    contaban = coberturas_en_juego(db, usuario_id)
    db.execute(
        delete(ExcepcionDelPlan).where(
            ExcepcionDelPlan.usuario_id == usuario_id,
            ExcepcionDelPlan.fecha >= max(desde, hoy()),
            ExcepcionDelPlan.fecha <= hasta,
        )
    )
    reubicar_coberturas(db, usuario_id, contaban)
    db.commit()


@router.post("/intercambiar", response_model=list[DiaPlanOut])
def intercambiar_dias(
    datos: IntercambioCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Lo que toca un día pasa al otro y al revés, en una sola transacción: con dos
    llamadas por separado, un fallo entre medias dejaría un día cambiado y el otro
    no. Es lo que hace el intercambio de dos días en la pantalla de hoy.

    Una rutina que ese día contaba como descanso (porque está oculta) se
    intercambia como descanso: lo oculto no se vuelve a planificar. Lo hecho por
    adelantado se reubica como al planificar.
    """
    if datos.fecha_a == datos.fecha_b:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Para intercambiar hacen falta dos días distintos.",
        )
    for fecha in (datos.fecha_a, datos.fecha_b):
        _exigir_hoy_o_despues(fecha)

    [dia_a] = dias_del_plan(db, usuario_id, datos.fecha_a, datos.fecha_a)
    [dia_b] = dias_del_plan(db, usuario_id, datos.fecha_b, datos.fecha_b)
    rutina_a = None if dia_a.descanso else dia_a.rutina.id
    rutina_b = None if dia_b.descanso else dia_b.rutina.id
    contaban = coberturas_en_juego(db, usuario_id)
    _poner_excepcion(db, usuario_id, datos.fecha_a, rutina_b)
    _poner_excepcion(db, usuario_id, datos.fecha_b, rutina_a)
    reubicar_coberturas(db, usuario_id, contaban)
    db.commit()
    return [
        *dias_del_plan(db, usuario_id, datos.fecha_a, datos.fecha_a),
        *dias_del_plan(db, usuario_id, datos.fecha_b, datos.fecha_b),
    ]
