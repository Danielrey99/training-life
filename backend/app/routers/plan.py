from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fechas import hoy
from app.models import ExcepcionDelPlan
from app.plan import buscar_excepcion, poner_excepcion, validar_rango
from app.routers.rutinas import obtener_rutina_visible
from app.schemas import (
    DiaSeguimientoOut,
    ExcepcionOut,
    ExcepcionUpdate,
    HoyOut,
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
            detail=f"El {fecha} ya ha pasado. Solo se puede planificar de hoy en adelante.",
        )


@router.get("/seguimiento", response_model=list[DiaSeguimientoOut])
def obtener_seguimiento(
    desde: date,
    hasta: date,
    db: Session = Depends(get_db),
):
    """Qué tocaba cada día de `desde` a `hasta` (incluidos) y qué pasó: si está
    hecho, movido a otro día, sin hacer, pendiente (hoy) o próximo, qué sesión lo
    cuenta y qué se hizo ese día. Lo usan el calendario, la semana de la pantalla
    de hoy y la constancia del resumen (`app/resumen.py`). Como mucho, 400 días de
    una vez.
    """
    return seguimiento(db, desde, hasta)


@router.get("/hoy", response_model=HoyOut)
def obtener_hoy(
    fecha: date | None = None,
    db: Session = Depends(get_db),
):
    """Lo que necesita la pantalla de hoy: en qué situación está el día, la semana,
    lo que se puede recuperar, lo que se ofrece entrenar, el próximo entrenamiento
    y la última sesión.

    Con `fecha` (un día pasado) sirve para la hoja de registrar ese día desde el
    calendario: lo que tocaba, lo que seguía por recuperar y el resto sin contar,
    sin intercambiar ni adelantar (adelantar, solo desde Entrenar). Una
    fecha futura da 422: el futuro se planifica, no se registra.
    """
    fecha = fecha or hoy()
    if fecha > hoy():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El {fecha} todavía no ha llegado. Solo se registran días de hoy hacia atrás.",
        )
    return resumen_de_hoy(db, fecha)


# --- Excepciones: lo que se cambia a mano para un día ---------------------


@router.get("/excepciones", response_model=list[ExcepcionOut])
def listar_excepciones(
    desde: date | None = None,
    hasta: date | None = None,
    db: Session = Depends(get_db),
):
    """Los días cambiados a mano, del más cercano al más lejano. Con `desde` = hoy
    son los que se perderían al activar otro programa quitándolos.
    """
    if desde is not None and hasta is not None:
        validar_rango(desde, hasta)
    stmt = select(ExcepcionDelPlan)
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
        obtener_rutina_visible(db, datos.rutina_id)
    contaban = coberturas_en_juego(db)
    poner_excepcion(db, fecha, datos.rutina_id)
    reubicar_coberturas(db, contaban)
    db.commit()
    return buscar_excepcion(db, fecha)


@router.delete("/excepciones/{fecha}", status_code=status.HTTP_204_NO_CONTENT)
def restablecer_dia(
    fecha: date,
    db: Session = Depends(get_db),
):
    """*Restablecer este día*: vuelve a lo que diga el programa. Lo hecho por
    adelantado se reubica como al planificar.
    """
    _exigir_hoy_o_despues(fecha)
    excepcion = buscar_excepcion(db, fecha)
    if excepcion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese día no estaba cambiado. Ya es lo que dice el programa",
        )
    contaban = coberturas_en_juego(db)
    db.delete(excepcion)
    reubicar_coberturas(db, contaban)
    db.commit()


@router.delete("/excepciones", status_code=status.HTTP_204_NO_CONTENT)
def restablecer_rango(
    desde: date,
    hasta: date,
    db: Session = Depends(get_db),
):
    """*Restablecer la semana*: devuelve al programa los días del rango, de hoy en
    adelante. Los días ya pasados no se tocan: el pasado no se planifica. Lo hecho
    por adelantado se reubica como al planificar.
    """
    validar_rango(desde, hasta)
    contaban = coberturas_en_juego(db)
    db.execute(
        delete(ExcepcionDelPlan).where(
            ExcepcionDelPlan.fecha >= max(desde, hoy()),
            ExcepcionDelPlan.fecha <= hasta,
        )
    )
    reubicar_coberturas(db, contaban)
    db.commit()
