from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.models import Ejercicio, Entrenamiento, GrupoMuscular, Rutina, RutinaSlot, Serie, SlotAlternativa
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


def obtener_ejercicio_visible(db: Session, ejercicio_id: int, usuario_id: int) -> Ejercicio:
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None or not _es_visible(ejercicio, usuario_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    return ejercicio


def _usos_de_ejercicio(db: Session, ejercicio_id: int) -> list[dict]:
    """¿Dónde se usa este ejercicio? Una entrada por cada hueco donde
    aparece (como principal o como comodín) y una por cada entrenamiento con
    series registradas de este ejercicio — con nombre/fecha, para que el
    aviso de borrado sea concreto y no un genérico "está en uso".
    rutina_slots, slot_alternativas y series hacia ejercicios son RESTRICT,
    así que un borrado directo fallaría con un error de la base de datos si
    no se detectan aquí antes.
    """
    principales = db.execute(
        select(RutinaSlot.id, Rutina.id, Rutina.nombre)
        .join(Rutina, Rutina.id == RutinaSlot.rutina_id)
        .where(RutinaSlot.ejercicio_principal_id == ejercicio_id)
    ).all()
    comodines = db.execute(
        select(RutinaSlot.id, Rutina.id, Rutina.nombre)
        .join(Rutina, Rutina.id == RutinaSlot.rutina_id)
        .join(SlotAlternativa, SlotAlternativa.slot_id == RutinaSlot.id)
        .where(SlotAlternativa.ejercicio_id == ejercicio_id)
    ).all()
    entrenamientos_con_series = db.execute(
        select(Entrenamiento.id, Entrenamiento.fecha)
        .join(Serie, Serie.entrenamiento_id == Entrenamiento.id)
        .where(Serie.ejercicio_id == ejercicio_id)
        .distinct()
    ).all()
    return (
        [
            {"rol": "principal", "slot_id": slot_id, "rutina_id": rutina_id, "rutina_nombre": nombre}
            for slot_id, rutina_id, nombre in principales
        ]
        + [
            {"rol": "comodín", "slot_id": slot_id, "rutina_id": rutina_id, "rutina_nombre": nombre}
            for slot_id, rutina_id, nombre in comodines
        ]
        + [
            {"rol": "serie registrada", "entrenamiento_id": entrenamiento_id, "fecha": str(fecha)}
            for entrenamiento_id, fecha in entrenamientos_con_series
        ]
    )


@router.get("", response_model=list[EjercicioOut])
def listar_ejercicios(
    ocultos: bool = False,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Por defecto, biblioteca combinada: ejercicios predefinidos + los
    creados por el usuario actual (solo activos). Con `ocultos=true`, lista
    en cambio los propios que el usuario ha ocultado — para poder
    reactivarlos (`POST /ejercicios/{id}/reactivar`) o borrarlos
    definitivamente.
    """
    if ocultos:
        stmt = select(Ejercicio).where(
            Ejercicio.activo.is_(False), Ejercicio.usuario_id == usuario_id
        )
    else:
        stmt = select(Ejercicio).where(
            Ejercicio.activo.is_(True),
            (Ejercicio.es_predefinido.is_(True)) | (Ejercicio.usuario_id == usuario_id),
        )
    return db.scalars(stmt.order_by(Ejercicio.nombre)).all()


@router.get("/{ejercicio_id}", response_model=EjercicioOut)
def obtener_ejercicio(
    ejercicio_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    return obtener_ejercicio_visible(db, ejercicio_id, usuario_id)


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

    - Sin usos (ver `_usos_de_ejercicio`): se borra de verdad, sin preguntar nada.
    - En uso: hace falta indicar `modo` explícitamente — `modo=ocultar`
      (borrado lógico: `activo=False`, conserva todo) o `modo=definitivo`
      (borra también las filas dependientes, sin vuelta atrás). Sin `modo`,
      el 409 explica dónde se usa.
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

    usos = _usos_de_ejercicio(db, ejercicio_id)
    if usos and modo != "definitivo":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "mensaje": (
                    "Este ejercicio está en uso. Repite la petición con "
                    "?modo=ocultar (deja de aparecer para entrenamientos nuevos, "
                    "conserva todo) o ?modo=definitivo (borra también los huecos, "
                    "comodines y series registradas que lo usan, sin poder "
                    "deshacerlo)."
                ),
                "usos": usos,
            },
        )

    # Sin usos, o modo=definitivo: borra de verdad. rutina_slots,
    # slot_alternativas y series hacia ejercicios son RESTRICT, así que hay
    # que borrar antes las filas dependientes explícitamente (los comodines
    # de cada hueco se van solos, en cascada por FK).
    for serie in db.scalars(select(Serie).where(Serie.ejercicio_id == ejercicio_id)).all():
        db.delete(serie)
    for slot in db.scalars(
        select(RutinaSlot).where(RutinaSlot.ejercicio_principal_id == ejercicio_id)
    ).all():
        db.delete(slot)
    for comodin in db.scalars(
        select(SlotAlternativa).where(SlotAlternativa.ejercicio_id == ejercicio_id)
    ).all():
        db.delete(comodin)
    db.delete(ejercicio)
    db.commit()


@router.post("/{ejercicio_id}/reactivar", response_model=EjercicioOut)
def reactivar_ejercicio(
    ejercicio_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Deshace un `modo=ocultar`: vuelve a hacer visible un ejercicio propio."""
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede reactivar un ejercicio que no es tuyo",
        )
    ejercicio.activo = True
    db.commit()
    db.refresh(ejercicio)
    return ejercicio
