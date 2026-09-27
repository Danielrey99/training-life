from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.fechas import hoy
from app.models import Entrenamiento, Rutina, RutinaSlot, Serie
from app.routers.ejercicios import obtener_ejercicio_visible
from app.schemas import (
    EntrenamientoCreate,
    EntrenamientoOut,
    EntrenamientoUpdate,
    SerieCreate,
    SerieOut,
    SerieUpdate,
)

router = APIRouter(prefix="/entrenamientos", tags=["entrenamientos"])


# --- Entrenamientos ------------------------------------------------------


def _obtener_entrenamiento_propio(
    db: Session, entrenamiento_id: int, usuario_id: int
) -> Entrenamiento:
    """No hay entrenamientos predefinidos ni ajenos visibles: 404 si no
    existe, 403 si existe pero no es tuyo.
    """
    entrenamiento = db.get(Entrenamiento, entrenamiento_id)
    if entrenamiento is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entrenamiento no encontrado"
        )
    if entrenamiento.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede acceder a un entrenamiento que no es tuyo",
        )
    return entrenamiento


def _validar_rutina_propia(db: Session, rutina_id: int, usuario_id: int) -> None:
    rutina = db.get(Rutina, rutina_id)
    if rutina is None or rutina.oculto or rutina.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe ninguna rutina con id {rutina_id}",
        )


def _validar_cambio_de_rutina(db: Session, entrenamiento_id: int) -> None:
    """Mover un entrenamiento a otra rutina dejaría sus series apuntando a huecos
    de la rutina anterior, y el historial de esos huecos mostraría una sesión con
    el nombre de una rutina que no es la suya.

    Solo estorban las series atadas a un hueco: las de un entrenamiento libre no
    referencian ninguna rutina, así que pueden acompañarlo sin romper nada.
    """
    atadas = db.scalar(
        select(func.count())
        .select_from(Serie)
        .where(Serie.entrenamiento_id == entrenamiento_id, Serie.slot_id.is_not(None))
    )
    if atadas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Este entrenamiento tiene {atadas} series registradas en huecos de su "
                "rutina actual. Cambiarlo de rutina las dejaría apuntando a huecos que "
                "ya no le corresponden: borra antes esas series, o deja la rutina como está."
            ),
        )


def _validar_sin_sesion_en_curso(
    db: Session, usuario_id: int, excepto_id: int | None = None
) -> None:
    """Solo puede haber una sesión en curso: o se termina la empezada o se
    cancela, y entonces se elige otra.

    Se comprueba aquí y no con un índice porque depende de qué día es hoy, y eso
    no cabe en una restricción de la base de datos.
    """
    stmt = select(Entrenamiento.id).where(
        Entrenamiento.usuario_id == usuario_id,
        Entrenamiento.fecha == hoy(),
        Entrenamiento.terminada_en.is_(None),
    )
    if excepto_id is not None:
        stmt = stmt.where(Entrenamiento.id != excepto_id)
    abierta = db.scalar(stmt.limit(1))
    if abierta is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "mensaje": "Ya hay una sesión en curso hoy. Termínala o cancélala antes de empezar otra.",
                "entrenamiento_id": abierta,
            },
        )


@router.get("", response_model=list[EntrenamientoOut])
def listar_entrenamientos(
    desde: date | None = None,
    hasta: date | None = None,
    en_curso: bool = False,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Los entrenamientos del usuario, del más reciente al más antiguo.

    `desde` y `hasta` (incluidos) sirven para pedir una semana o un mes. Con
    `en_curso=true` devuelve solo la sesión en curso, si la hay: una lista con uno
    o ningún elemento, que es lo que necesita la pantalla de hoy para ofrecer
    *Continuar* en vez de *Empezar*.
    """
    if desde is not None and hasta is not None and desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango de fechas está invertido: 'desde' ({desde}) es posterior a 'hasta' ({hasta}).",
        )
    stmt = select(Entrenamiento).where(Entrenamiento.usuario_id == usuario_id)
    if desde is not None:
        stmt = stmt.where(Entrenamiento.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(Entrenamiento.fecha <= hasta)
    if en_curso:
        stmt = stmt.where(Entrenamiento.fecha == hoy(), Entrenamiento.terminada_en.is_(None))
    stmt = stmt.order_by(Entrenamiento.fecha.desc(), Entrenamiento.id.desc())
    return db.scalars(stmt).all()


@router.get("/{entrenamiento_id}", response_model=EntrenamientoOut)
def obtener_entrenamiento(
    entrenamiento_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    return _obtener_entrenamiento_propio(db, entrenamiento_id, usuario_id)


@router.post("", response_model=EntrenamientoOut, status_code=status.HTTP_201_CREATED)
def crear_entrenamiento(
    datos: EntrenamientoCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Crea la sesión "vacía" (sin series todavía) — se añaden aparte, con
    POST /entrenamientos/{id}/series. rutina_id es opcional (entrenamiento libre).
    """
    if datos.rutina_id is not None:
        _validar_rutina_propia(db, datos.rutina_id, usuario_id)
    # Una sesión de otro día no estorba: apuntar un día pasado no es empezar a entrenar.
    if datos.fecha == hoy():
        _validar_sin_sesion_en_curso(db, usuario_id)
    entrenamiento = Entrenamiento(**datos.model_dump(), usuario_id=usuario_id)
    db.add(entrenamiento)
    db.commit()
    db.refresh(entrenamiento)
    return entrenamiento


@router.put("/{entrenamiento_id}", response_model=EntrenamientoOut)
def actualizar_entrenamiento(
    entrenamiento_id: int,
    datos: EntrenamientoUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    entrenamiento = _obtener_entrenamiento_propio(db, entrenamiento_id, usuario_id)
    if datos.rutina_id is not None:
        _validar_rutina_propia(db, datos.rutina_id, usuario_id)
    if datos.rutina_id != entrenamiento.rutina_id:
        _validar_cambio_de_rutina(db, entrenamiento_id)
    # Mover a hoy una sesión sin terminar la convierte en otra sesión en curso.
    if datos.fecha == hoy() and entrenamiento.terminada_en is None:
        _validar_sin_sesion_en_curso(db, usuario_id, excepto_id=entrenamiento_id)
    for campo, valor in datos.model_dump().items():
        setattr(entrenamiento, campo, valor)
    db.commit()
    db.refresh(entrenamiento)
    return entrenamiento


@router.post("/{entrenamiento_id}/terminar", response_model=EntrenamientoOut)
def terminar_entrenamiento(
    entrenamiento_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Da la sesión por terminada. Terminarla otra vez no hace nada: se conserva
    la hora de la primera, que es cuando de verdad se acabó.

    Terminada no significa cerrada: se le pueden seguir añadiendo o corrigiendo
    series, que es lo que hace la edición de un día ya pasado.
    """
    entrenamiento = _obtener_entrenamiento_propio(db, entrenamiento_id, usuario_id)
    if entrenamiento.terminada_en is None:
        entrenamiento.terminada_en = datetime.now(timezone.utc)
        db.commit()
        db.refresh(entrenamiento)
    return entrenamiento


@router.delete("/{entrenamiento_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_entrenamiento(
    entrenamiento_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Borra un entrenamiento propio, con todas sus series (se van con él,
    en cascada por FK). A diferencia de Ejercicio/Rutina/RutinaSlot, no tiene
    parámetro `modo`: nada más depende de un entrenamiento concreto, así que
    no hay nada que proteger con un aviso previo.
    """
    entrenamiento = _obtener_entrenamiento_propio(db, entrenamiento_id, usuario_id)
    db.delete(entrenamiento)
    db.commit()


# --- Series --------------------------------------------------------------


def _obtener_serie_propia(
    db: Session, entrenamiento_id: int, serie_id: int, usuario_id: int
) -> Serie:
    _obtener_entrenamiento_propio(
        db, entrenamiento_id, usuario_id
    )  # valida dueño del entrenamiento
    serie = db.get(Serie, serie_id)
    if serie is None or serie.entrenamiento_id != entrenamiento_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Serie no encontrada")
    return serie


def _validar_slot(db: Session, slot_id: int, rutina_id: int | None) -> None:
    """El slot_id de una serie, si se manda, tiene que ser un hueco real de
    la rutina de ese entrenamiento — no tiene sentido en un entrenamiento libre.
    """
    if rutina_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este entrenamiento es libre (sin rutina): no puede tener slot_id",
        )
    slot = db.get(RutinaSlot, slot_id)
    if slot is None or slot.rutina_id != rutina_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe ningún hueco con id {slot_id} en la rutina de este entrenamiento",
        )


@router.post(
    "/{entrenamiento_id}/series", response_model=SerieOut, status_code=status.HTTP_201_CREATED
)
def crear_serie(
    entrenamiento_id: int,
    datos: SerieCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    entrenamiento = _obtener_entrenamiento_propio(db, entrenamiento_id, usuario_id)
    obtener_ejercicio_visible(db, datos.ejercicio_id, usuario_id)
    if datos.slot_id is not None:
        _validar_slot(db, datos.slot_id, entrenamiento.rutina_id)
    serie = Serie(**datos.model_dump(), entrenamiento_id=entrenamiento_id)
    db.add(serie)
    db.commit()
    db.refresh(serie)
    return serie


@router.put("/{entrenamiento_id}/series/{serie_id}", response_model=SerieOut)
def actualizar_serie(
    entrenamiento_id: int,
    serie_id: int,
    datos: SerieUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    serie = _obtener_serie_propia(db, entrenamiento_id, serie_id, usuario_id)
    entrenamiento = _obtener_entrenamiento_propio(db, entrenamiento_id, usuario_id)
    obtener_ejercicio_visible(db, datos.ejercicio_id, usuario_id)
    if datos.slot_id is not None:
        _validar_slot(db, datos.slot_id, entrenamiento.rutina_id)
    for campo, valor in datos.model_dump().items():
        setattr(serie, campo, valor)
    db.commit()
    db.refresh(serie)
    return serie


@router.delete("/{entrenamiento_id}/series/{serie_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_serie(
    entrenamiento_id: int,
    serie_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    serie = _obtener_serie_propia(db, entrenamiento_id, serie_id, usuario_id)
    db.delete(serie)
    db.commit()
