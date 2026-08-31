from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.models import Ejercicio, GrupoMuscular
from app.schemas import EjercicioCreate, EjercicioOut, EjercicioUpdate

router = APIRouter(prefix="/ejercicios", tags=["ejercicios"])


def _validar_grupo_muscular(db: Session, grupo_muscular_id: int) -> None:
    if db.get(GrupoMuscular, grupo_muscular_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe ningún grupo muscular con id {grupo_muscular_id}",
        )


def _es_visible(ejercicio: Ejercicio, usuario_id: int) -> bool:
    """Biblioteca combinada: visible si es predefinido o si es del usuario actual."""
    return ejercicio.activo and (ejercicio.es_predefinido or ejercicio.usuario_id == usuario_id)


def _obtener_ejercicio_visible(db: Session, ejercicio_id: int, usuario_id: int) -> Ejercicio:
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None or not _es_visible(ejercicio, usuario_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    return ejercicio


def _tiene_historial(db: Session, ejercicio_id: int) -> bool:
    """¿Hay algo (series, rutina_slots, slot_alternativas) que dependa de
    este ejercicio? Esas tablas todavía no existen en el esquema
    implementado, así que de momento esto siempre es False — se completará
    con consultas reales en cuanto se añadan (ver CLAUDE.md, "Borrado de
    datos").
    """
    return False


@router.get("", response_model=list[EjercicioOut])
def listar_ejercicios(
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Biblioteca combinada: ejercicios predefinidos + los creados por el usuario actual."""
    stmt = (
        select(Ejercicio)
        .where(Ejercicio.activo.is_(True))
        .where((Ejercicio.es_predefinido.is_(True)) | (Ejercicio.usuario_id == usuario_id))
        .order_by(Ejercicio.nombre)
    )
    return db.scalars(stmt).all()


@router.get("/{ejercicio_id}", response_model=EjercicioOut)
def obtener_ejercicio(
    ejercicio_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    return _obtener_ejercicio_visible(db, ejercicio_id, usuario_id)


@router.post("", response_model=EjercicioOut, status_code=status.HTTP_201_CREATED)
def crear_ejercicio(
    datos: EjercicioCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Crea un ejercicio propio del usuario actual (nunca predefinido — eso
    se gestiona aparte, no a través de este endpoint)."""
    _validar_grupo_muscular(db, datos.grupo_muscular_id)
    ejercicio = Ejercicio(**datos.model_dump(), usuario_id=usuario_id)
    db.add(ejercicio)
    db.commit()
    db.refresh(ejercicio)
    return ejercicio


@router.put("/{ejercicio_id}", response_model=EjercicioOut)
def actualizar_ejercicio(
    ejercicio_id: int,
    datos: EjercicioUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Edita un ejercicio propio. Los predefinidos y los de otros usuarios
    (cuando exista JWT) no se pueden editar por aquí."""
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None or not ejercicio.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede editar un ejercicio que no es tuyo",
        )
    _validar_grupo_muscular(db, datos.grupo_muscular_id)
    for campo, valor in datos.model_dump().items():
        setattr(ejercicio, campo, valor)
    db.commit()
    db.refresh(ejercicio)
    return ejercicio


@router.delete("/{ejercicio_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_ejercicio(
    ejercicio_id: int,
    modo: Literal["ocultar", "definitivo"] | None = None,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Borra un ejercicio propio.

    - Sin historial dependiente: se borra de verdad, sin preguntar nada.
    - Con historial dependiente: hace falta indicar `modo` explícitamente en
      la query string — `?modo=ocultar` (borrado lógico: `activo=False`,
      conserva el historial) o `?modo=definitivo` (borra también las filas
      dependientes, sin vuelta atrás). Sin `modo`, devuelve 409 con las dos
      opciones explicadas.
    """
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None or not ejercicio.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede borrar un ejercicio que no es tuyo",
        )

    if modo == "ocultar":
        ejercicio.activo = False
        db.commit()
        return

    if _tiene_historial(db, ejercicio_id) and modo != "definitivo":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este ejercicio tiene historial de entrenamientos asociado. "
                "Repite la petición con ?modo=ocultar (deja de aparecer para "
                "entrenamientos nuevos, conserva el historial) o "
                "?modo=definitivo (lo borra también, sin poder deshacerlo)."
            ),
        )

    # Sin historial, o modo=definitivo: borra de verdad. Cuando existan
    # series/rutina_slots/slot_alternativas, aquí habrá que borrar antes las
    # filas dependientes (transacción explícita), no dejarlo en cascada.
    db.delete(ejercicio)
    db.commit()
