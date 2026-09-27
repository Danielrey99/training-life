from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.fechas import hoy
from app.historial import SESIONES_POR_DEFECTO, sesiones_con_series
from app.models import (
    Ejercicio,
    Entrenamiento,
    GrupoMuscular,
    NotaUsuarioEjercicio,
    Rutina,
    RutinaSlot,
    Serie,
    SlotAlternativa,
)
from app.schemas import (
    EjercicioCreate,
    EjercicioOut,
    EjercicioUpdate,
    NotaCreate,
    NotaOut,
    NotaUpdate,
    SesionHistorial,
)

router = APIRouter(prefix="/ejercicios", tags=["ejercicios"])


def _validar_grupo_muscular(db: Session, grupo_muscular_id: int) -> None:
    if db.get(GrupoMuscular, grupo_muscular_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe ningún grupo muscular con id {grupo_muscular_id}",
        )


def obtener_ejercicio_del_usuario(db: Session, ejercicio_id: int, usuario_id: int) -> Ejercicio:
    """El ejercicio aunque esté ocultado, o 404 si no existe o es de otro.

    Biblioteca combinada: cuentan los predefinidos y los propios. Es la
    comprobación para *leer* historial — ocultar un ejercicio deja de ofrecerlo
    para entrenamientos nuevos, pero no esconde lo que ya se hizo con él.
    """
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None or not (ejercicio.es_predefinido or ejercicio.usuario_id == usuario_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    return ejercicio


def obtener_ejercicio_visible(db: Session, ejercicio_id: int, usuario_id: int) -> Ejercicio:
    """Lo mismo, pero además no puede estar oculto: es la comprobación para
    *usar* el ejercicio (ponerlo en un hueco, registrar una serie, anotarlo).

    Pública (sin `_`) porque la usan también los otros routers para validar
    cualquier ejercicio_id que llegue en una petición.
    """
    ejercicio = obtener_ejercicio_del_usuario(db, ejercicio_id, usuario_id)
    if ejercicio.oculto:
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
            {
                "rol": "principal",
                "slot_id": slot_id,
                "rutina_id": rutina_id,
                "rutina_nombre": nombre,
            }
            for slot_id, rutina_id, nombre in principales
        ]
        + [
            {
                "rol": "comodín",
                "slot_id": slot_id,
                "rutina_id": rutina_id,
                "rutina_nombre": nombre,
            }
            for slot_id, rutina_id, nombre in comodines
        ]
        + [
            {
                "rol": "serie registrada",
                "entrenamiento_id": entrenamiento_id,
                "fecha": str(fecha),
            }
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
    creados por el usuario actual, sin los ocultos. Con `ocultos=true`, lista
    en cambio los propios que el usuario ha ocultado — para poder
    volver a mostrarlos (`POST /ejercicios/{id}/mostrar`) o borrarlos
    definitivamente.
    """
    if ocultos:
        stmt = select(Ejercicio).where(
            Ejercicio.oculto_desde.is_not(None), Ejercicio.usuario_id == usuario_id
        )
    else:
        stmt = select(Ejercicio).where(
            Ejercicio.oculto_desde.is_(None),
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
    se gestiona aparte, no a través de este endpoint).
    """
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
    (cuando exista JWT) no se pueden editar por aquí.
    """
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None or ejercicio.oculto:
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
      (borrado lógico: `oculto_desde=hoy`, conserva todo) o `modo=definitivo`
      (borra también las filas dependientes, sin vuelta atrás). Sin `modo`,
      el 409 explica dónde se usa.
    """
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None or ejercicio.oculto:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede borrar un ejercicio que no es tuyo",
        )

    if modo == "ocultar":
        ejercicio.oculto_desde = hoy()
        db.commit()
        return

    usos = _usos_de_ejercicio(db, ejercicio_id)
    if usos and modo != "definitivo":
        # Las notas nunca bloquean el borrado (su FK es CASCADE: se van solas
        # con el ejercicio). Pero si algo más ya lo está bloqueando, el aviso
        # tiene que enumerar todo lo que se perdería con modo=definitivo, no
        # solo lo que lo impide — si no, las notas desaparecen en silencio
        # justo cuando la API está detallando el resto.
        notas = db.scalar(
            select(func.count())
            .select_from(NotaUsuarioEjercicio)
            .where(
                NotaUsuarioEjercicio.ejercicio_id == ejercicio_id,
                NotaUsuarioEjercicio.usuario_id == usuario_id,
            )
        )
        mensaje = (
            "Este ejercicio está en uso. Repite la petición con "
            "?modo=ocultar (deja de aparecer para entrenamientos nuevos, "
            "conserva todo) o ?modo=definitivo (borra también los huecos, "
            "comodines y series registradas que lo usan, sin poder "
            "deshacerlo)."
        )
        if notas:
            mensaje += (
                f" Con ?modo=definitivo perderás también tus notas sobre este ejercicio ({notas})."
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "mensaje": mensaje,
                "usos": usos,
                "notas_que_se_perderian": notas,
            },
        )

    # Sin usos, o modo=definitivo: borra de verdad. rutina_slots,
    # slot_alternativas y series hacia ejercicios son RESTRICT, así que hay
    # que borrar antes las filas dependientes explícitamente (los comodines
    # de cada hueco se van solos, en cascada por FK).
    for serie in db.scalars(select(Serie).where(Serie.ejercicio_id == ejercicio_id)).all():
        db.delete(serie)
    # flush obligatorio: sin él los DELETE viajan juntos al commit y SQLAlchemy
    # los ordena por las relationship() que conoce — no hay ninguna entre Serie y
    # RutinaSlot, así que borraría el hueco antes que sus series (RESTRICT).
    db.flush()
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


@router.post("/{ejercicio_id}/mostrar", response_model=EjercicioOut)
def mostrar_ejercicio(
    ejercicio_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Deshace un `modo=ocultar`: el ejercicio vuelve a ofrecerse para usarlo."""
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede mostrar un ejercicio que no es tuyo",
        )
    ejercicio.oculto_desde = None
    db.commit()
    db.refresh(ejercicio)
    return ejercicio


@router.get("/{ejercicio_id}/historial", response_model=list[SesionHistorial])
def historial_de_ejercicio(
    ejercicio_id: int,
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = Query(default=SESIONES_POR_DEFECTO, gt=0, le=500),
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Los días en que se hizo este ejercicio, del más reciente al más antiguo,
    con las series de cada día — la progresión de un ejercicio concreto.

    Cuenta las veces que se hizo, siga o no una rutina. Para ver en cambio cómo
    evoluciona un hueco entero (unos días con el ejercicio principal y otros con
    un comodín), el endpoint es `/rutinas/{id}/slots/{slot_id}/historial`.
    """
    obtener_ejercicio_del_usuario(db, ejercicio_id, usuario_id)
    return sesiones_con_series(
        db, usuario_id, Serie.ejercicio_id == ejercicio_id, desde, hasta, limite
    )


# --- Notas del usuario sobre un ejercicio --------------------------------


def _obtener_nota_propia(
    db: Session, ejercicio_id: int, nota_id: int, usuario_id: int
) -> NotaUsuarioEjercicio:
    """404 si el ejercicio o la nota no existen (o la nota es de otro
    ejercicio), 403 si la nota existe pero no es tuya.

    A diferencia de los demás recursos anidados (series, comodines), aquí no
    basta con comprobar que el padre es accesible: un ejercicio predefinido
    lo ven todos los usuarios, así que el dueño hay que comprobarlo en la
    propia nota.
    """
    obtener_ejercicio_visible(db, ejercicio_id, usuario_id)
    nota = db.get(NotaUsuarioEjercicio, nota_id)
    if nota is None or nota.ejercicio_id != ejercicio_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nota no encontrada")
    if nota.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede acceder a una nota que no es tuya",
        )
    return nota


@router.get("/{ejercicio_id}/notas", response_model=list[NotaOut])
def listar_notas(
    ejercicio_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Las notas del usuario actual sobre este ejercicio, de la más reciente
    a la más antigua. Nunca incluye las de otros usuarios, ni siquiera cuando
    el ejercicio es predefinido y por tanto compartido.
    """
    obtener_ejercicio_visible(db, ejercicio_id, usuario_id)
    stmt = (
        select(NotaUsuarioEjercicio)
        .where(
            NotaUsuarioEjercicio.ejercicio_id == ejercicio_id,
            NotaUsuarioEjercicio.usuario_id == usuario_id,
        )
        .order_by(NotaUsuarioEjercicio.created_at.desc(), NotaUsuarioEjercicio.id.desc())
    )
    return db.scalars(stmt).all()


@router.post("/{ejercicio_id}/notas", response_model=NotaOut, status_code=status.HTTP_201_CREATED)
def crear_nota(
    ejercicio_id: int,
    datos: NotaCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Añade una nota al ejercicio. Se pueden acumular varias sobre el mismo
    ejercicio: cada una es independiente, no se sobreescriben.
    """
    obtener_ejercicio_visible(db, ejercicio_id, usuario_id)
    nota = NotaUsuarioEjercicio(
        **datos.model_dump(), usuario_id=usuario_id, ejercicio_id=ejercicio_id
    )
    db.add(nota)
    db.commit()
    db.refresh(nota)
    return nota


@router.put("/{ejercicio_id}/notas/{nota_id}", response_model=NotaOut)
def actualizar_nota(
    ejercicio_id: int,
    nota_id: int,
    datos: NotaUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    nota = _obtener_nota_propia(db, ejercicio_id, nota_id, usuario_id)
    for campo, valor in datos.model_dump().items():
        setattr(nota, campo, valor)
    db.commit()
    db.refresh(nota)
    return nota


@router.delete("/{ejercicio_id}/notas/{nota_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_nota(
    ejercicio_id: int,
    nota_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Borrado directo, sin parámetro `modo`: nada referencia una nota, así
    que no hay historial ajeno que proteger (igual que con las series).
    """
    nota = _obtener_nota_propia(db, ejercicio_id, nota_id, usuario_id)
    db.delete(nota)
    db.commit()
