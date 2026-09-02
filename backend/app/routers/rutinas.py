from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.models import Entrenamiento, Rutina, RutinaSlot, Serie, SlotAlternativa
from app.routers.ejercicios import obtener_ejercicio_visible
from app.schemas import (
    ComodinCreate,
    RutinaCreate,
    RutinaOut,
    RutinaSlotCreate,
    RutinaSlotOut,
    RutinaSlotUpdate,
    RutinaUpdate,
)

router = APIRouter(prefix="/rutinas", tags=["rutinas"])


# --- Rutinas -------------------------------------------------------------


def _obtener_rutina_visible(db: Session, rutina_id: int, usuario_id: int) -> Rutina:
    """Para GET: 404 tanto si no existe como si no es tuya (no hay rutinas predefinidas)."""
    rutina = db.get(Rutina, rutina_id)
    if rutina is None or not rutina.activo or rutina.usuario_id != usuario_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rutina no encontrada")
    return rutina


def _obtener_rutina_propia(db: Session, rutina_id: int, usuario_id: int) -> Rutina:
    """Para PUT/DELETE: 404 si no existe, 403 si existe pero no es tuya."""
    rutina = db.get(Rutina, rutina_id)
    if rutina is None or not rutina.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rutina no encontrada")
    if rutina.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede modificar una rutina que no es tuya",
        )
    return rutina


def _tiene_dependientes(db: Session, rutina_id: int) -> bool:
    """¿Tiene esta rutina huecos (su propia estructura) o entrenamientos
    (historial real)? `rutina_slots.rutina_id` y `entrenamientos.rutina_id`
    son ON DELETE RESTRICT — con cualquiera de las dos cosas, un borrado
    directo rompería referencias.
    """
    tiene_slots = (
        db.scalar(select(RutinaSlot.id).where(RutinaSlot.rutina_id == rutina_id).limit(1))
        is not None
    )
    tiene_entrenamientos = (
        db.scalar(select(Entrenamiento.id).where(Entrenamiento.rutina_id == rutina_id).limit(1))
        is not None
    )
    return tiene_slots or tiene_entrenamientos


@router.get("", response_model=list[RutinaOut])
def listar_rutinas(
    ocultas: bool = False,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Por defecto, lista las rutinas activas del usuario. Con
    `ocultas=true`, lista en cambio las que ha ocultado — para poder
    reactivarlas (`POST /rutinas/{id}/reactivar`) o borrarlas definitivamente.
    """
    stmt = (
        select(Rutina)
        .where(Rutina.usuario_id == usuario_id, Rutina.activo.is_(not ocultas))
        .order_by(Rutina.nombre)
    )
    return db.scalars(stmt).all()


@router.get("/{rutina_id}", response_model=RutinaOut)
def obtener_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    return _obtener_rutina_visible(db, rutina_id, usuario_id)


@router.post("", response_model=RutinaOut, status_code=status.HTTP_201_CREATED)
def crear_rutina(
    datos: RutinaCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Crea la rutina "vacía" (sin huecos todavía) — los huecos se añaden
    aparte, con POST /rutinas/{id}/slots."""
    rutina = Rutina(**datos.model_dump(), usuario_id=usuario_id)
    db.add(rutina)
    db.commit()
    db.refresh(rutina)
    return rutina


@router.put("/{rutina_id}", response_model=RutinaOut)
def actualizar_rutina(
    rutina_id: int,
    datos: RutinaUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    rutina = _obtener_rutina_propia(db, rutina_id, usuario_id)
    for campo, valor in datos.model_dump().items():
        setattr(rutina, campo, valor)
    db.commit()
    db.refresh(rutina)
    return rutina


@router.post("/{rutina_id}/reactivar", response_model=RutinaOut)
def reactivar_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Deshace un `modo=ocultar`: vuelve a hacer visible una rutina propia."""
    rutina = db.get(Rutina, rutina_id)
    if rutina is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rutina no encontrada")
    if rutina.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede reactivar una rutina que no es tuya",
        )
    rutina.activo = True
    db.commit()
    db.refresh(rutina)
    return rutina


@router.delete("/{rutina_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_rutina(
    rutina_id: int,
    modo: Literal["ocultar", "definitivo"] | None = None,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Borra una rutina propia.

    - Sin huecos ni entrenamientos asociados: se borra de verdad, sin
      preguntar nada.
    - Con huecos o entrenamientos: hace falta `modo=ocultar` (conserva todo)
      o `modo=definitivo` (lo borra todo, sin vuelta atrás).
    """
    rutina = _obtener_rutina_propia(db, rutina_id, usuario_id)

    if modo == "ocultar":
        rutina.activo = False
        db.commit()
        return

    if _tiene_dependientes(db, rutina_id) and modo != "definitivo":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Esta rutina tiene huecos definidos (o historial de entrenamientos). "
                "Repite la petición con ?modo=ocultar (conserva todo, deja de estar "
                "disponible para entrenamientos nuevos) o ?modo=definitivo (lo borra "
                "todo, sin poder deshacerlo)."
            ),
        )

    # rutina_slots.rutina_id y entrenamientos.rutina_id son RESTRICT: hay que
    # borrar antes ambos. Primero los entrenamientos (sus series se van
    # solas, en cascada) — así ningún rutina_slot queda ya bloqueado por una
    # serie que lo referenciaba, y se puede borrar limpio justo después
    # (sus comodines también se van en cascada).
    for entrenamiento in db.scalars(
        select(Entrenamiento).where(Entrenamiento.rutina_id == rutina_id)
    ).all():
        db.delete(entrenamiento)
    for slot in db.scalars(select(RutinaSlot).where(RutinaSlot.rutina_id == rutina_id)).all():
        db.delete(slot)
    db.delete(rutina)
    db.commit()


# --- Huecos (rutina_slots) ------------------------------------------------


def _obtener_slot_propio(db: Session, rutina_id: int, slot_id: int, usuario_id: int) -> RutinaSlot:
    _obtener_rutina_propia(db, rutina_id, usuario_id)  # valida que la rutina es tuya
    slot = db.get(RutinaSlot, slot_id)
    if slot is None or not slot.activo or slot.rutina_id != rutina_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hueco no encontrado")
    return slot


def _validar_orden_disponible(
    db: Session, rutina_id: int, orden: int, excluir_slot_id: int | None = None
) -> None:
    """`UniqueConstraint(rutina_id, orden)` a nivel de base de datos evita
    duplicados de verdad, pero comprobarlo antes da un 409 legible en vez de
    un error crudo de la base de datos."""
    stmt = select(RutinaSlot.id).where(RutinaSlot.rutina_id == rutina_id, RutinaSlot.orden == orden)
    if excluir_slot_id is not None:
        stmt = stmt.where(RutinaSlot.id != excluir_slot_id)
    if db.scalar(stmt.limit(1)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya hay un hueco con orden={orden} en esta rutina",
        )


@router.post("/{rutina_id}/slots", response_model=RutinaSlotOut, status_code=status.HTTP_201_CREATED)
def crear_slot(
    rutina_id: int,
    datos: RutinaSlotCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Añade un hueco a una rutina propia."""
    _obtener_rutina_propia(db, rutina_id, usuario_id)
    obtener_ejercicio_visible(db, datos.ejercicio_principal_id, usuario_id)
    _validar_orden_disponible(db, rutina_id, datos.orden)
    slot = RutinaSlot(**datos.model_dump(), rutina_id=rutina_id)
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return slot


@router.put("/{rutina_id}/slots/{slot_id}", response_model=RutinaSlotOut)
def actualizar_slot(
    rutina_id: int,
    slot_id: int,
    datos: RutinaSlotUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    slot = _obtener_slot_propio(db, rutina_id, slot_id, usuario_id)
    obtener_ejercicio_visible(db, datos.ejercicio_principal_id, usuario_id)
    _validar_orden_disponible(db, rutina_id, datos.orden, excluir_slot_id=slot_id)
    for campo, valor in datos.model_dump().items():
        setattr(slot, campo, valor)
    db.commit()
    db.refresh(slot)
    return slot


def _tiene_historial_slot(db: Session, slot_id: int) -> bool:
    """¿Hay alguna serie registrada que use este hueco? `series.slot_id` es
    RESTRICT hacia rutina_slots."""
    return (
        db.scalar(select(Serie.id).where(Serie.slot_id == slot_id).limit(1)) is not None
    )


@router.delete("/{rutina_id}/slots/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_slot(
    rutina_id: int,
    slot_id: int,
    modo: Literal["ocultar", "definitivo"] | None = None,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Borra un hueco propio.

    - Sin series registradas: se borra de verdad (sus comodines se van con
      él, en cascada por FK), sin preguntar nada.
    - Con series: hace falta `modo=ocultar` (conserva todo) o
      `modo=definitivo` (borra también las series que lo usan, sin vuelta
      atrás).
    """
    slot = _obtener_slot_propio(db, rutina_id, slot_id, usuario_id)

    if modo == "ocultar":
        slot.activo = False
        db.commit()
        return

    if _tiene_historial_slot(db, slot_id) and modo != "definitivo":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este hueco tiene series registradas. Repite la petición con "
                "?modo=ocultar (conserva todo) o ?modo=definitivo (borra "
                "también esas series, sin poder deshacerlo)."
            ),
        )

    # series.slot_id es RESTRICT: hay que borrar antes las series que lo usan.
    for serie in db.scalars(select(Serie).where(Serie.slot_id == slot_id)).all():
        db.delete(serie)
    db.delete(slot)
    db.commit()


# --- Comodines (slot_alternativas) ----------------------------------------


@router.post(
    "/{rutina_id}/slots/{slot_id}/alternativas",
    response_model=RutinaSlotOut,
    status_code=status.HTTP_201_CREATED,
)
def anadir_comodin(
    rutina_id: int,
    slot_id: int,
    datos: ComodinCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    slot = _obtener_slot_propio(db, rutina_id, slot_id, usuario_id)
    obtener_ejercicio_visible(db, datos.ejercicio_id, usuario_id)

    ya_existe = db.scalar(
        select(SlotAlternativa).where(
            SlotAlternativa.slot_id == slot_id,
            SlotAlternativa.ejercicio_id == datos.ejercicio_id,
        )
    )
    if ya_existe is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese ejercicio ya es comodín de este hueco",
        )

    db.add(SlotAlternativa(slot_id=slot_id, ejercicio_id=datos.ejercicio_id))
    db.commit()
    db.refresh(slot)
    return slot


@router.delete(
    "/{rutina_id}/slots/{slot_id}/alternativas/{ejercicio_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def quitar_comodin(
    rutina_id: int,
    slot_id: int,
    ejercicio_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    _obtener_slot_propio(db, rutina_id, slot_id, usuario_id)
    comodin = db.scalar(
        select(SlotAlternativa).where(
            SlotAlternativa.slot_id == slot_id,
            SlotAlternativa.ejercicio_id == ejercicio_id,
        )
    )
    if comodin is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese ejercicio no es comodín de este hueco",
        )
    db.delete(comodin)
    db.commit()
