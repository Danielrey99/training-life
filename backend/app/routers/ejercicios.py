from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fechas import hoy
from app.ocultos import exigir_visible
from app.historial import SESIONES_POR_DEFECTO, sesiones_con_series
from app.models import (
    Ejercicio,
    Entrenamiento,
    GrupoMuscular,
    NotaEjercicio,
    Programa,
    ProgramaDia,
    ProgramaPeriodo,
    Rutina,
    RutinaSlot,
    Serie,
    SlotAlternativa,
)
from app.schemas import (
    AvisoDeBorrarEjercicioOut,
    EjercicioCreate,
    EjercicioOut,
    EjercicioUpdate,
    NotaCreate,
    NotaOut,
    NotaUpdate,
    ProgramaDeUnUsoOut,
    RutinaMinima,
    SesionHistorial,
    SesionQueSeVaciaOut,
    UsoEnRutinaOut,
)
from app.seguimiento import sesiones_que_se_vacian

router = APIRouter(prefix="/ejercicios", tags=["ejercicios"])


def _validar_grupo_muscular(db: Session, grupo_muscular_id: int) -> None:
    if db.get(GrupoMuscular, grupo_muscular_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe ningún grupo muscular con id {grupo_muscular_id}",
        )


def obtener_ejercicio_legible(db: Session, ejercicio_id: int) -> Ejercicio:
    """El ejercicio aunque esté ocultado, o 404 si no existe.

    Biblioteca combinada: cuentan los predefinidos y los propios. Es la
    comprobación para *leer* historial — ocultar un ejercicio deja de ofrecerlo
    para entrenamientos nuevos, pero no esconde lo que ya se hizo con él.
    """
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    return ejercicio


def obtener_ejercicio_visible(db: Session, ejercicio_id: int) -> Ejercicio:
    """Lo mismo, pero además no puede estar oculto: es la comprobación para
    *usar* el ejercicio (ponerlo en un hueco, registrar una serie, anotarlo).

    Pública (sin `_`) porque la usan también los otros routers para validar
    cualquier ejercicio_id que llegue en una petición.
    """
    ejercicio = obtener_ejercicio_legible(db, ejercicio_id)
    if ejercicio.oculto:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    return ejercicio


def _huecos_donde_es_principal(ejercicio_id: int):
    """Los ids de los huecos donde este ejercicio es el principal, como subconsulta:
    son los que se borran enteros con el ejercicio.
    """
    return select(RutinaSlot.id).where(RutinaSlot.ejercicio_principal_id == ejercicio_id)


def _series_que_se_borran(ejercicio_id: int):
    """Las series que se van con el ejercicio, como condición: las suyas y todas las
    de los huecos donde es el principal (también las hechas con un comodín, que
    apuntan al hueco). Una sola expresión para el aviso y el borrado, para
    que lo que se anuncia sea lo que se borra.
    """
    return or_(
        Serie.ejercicio_id == ejercicio_id,
        Serie.slot_id.in_(_huecos_donde_es_principal(ejercicio_id)),
    )


def _tiene_historial_ejercicio(db: Session, ejercicio_id: int) -> bool:
    """¿Se usa este ejercicio? Como principal o comodín de un hueco, o con series
    registradas. rutina_slots, slot_alternativas y series hacia ejercicios son
    RESTRICT, así que un borrado directo fallaría con un error de la base de datos
    si no se detecta aquí antes. Las notas no cuentan: se van con él (CASCADE).
    """
    return db.scalar(
        select(
            or_(
                exists().where(RutinaSlot.ejercicio_principal_id == ejercicio_id),
                exists().where(SlotAlternativa.ejercicio_id == ejercicio_id),
                exists().where(Serie.ejercicio_id == ejercicio_id),
            )
        )
    )


def _usos_en_rutinas(db: Session, ejercicio_id: int) -> list[UsoEnRutinaOut]:
    """Los huecos de las rutinas donde aparece el ejercicio, con lo que hace falta
    para enseñarlos: su número en la rutina, si están ocultos y en qué programas
    está la rutina. Tres consultas, sin una más por uso.
    """
    filas = db.execute(
        select(RutinaSlot, Rutina)
        .join(Rutina, Rutina.id == RutinaSlot.rutina_id)
        .outerjoin(
            SlotAlternativa,
            and_(
                SlotAlternativa.slot_id == RutinaSlot.id,
                SlotAlternativa.ejercicio_id == ejercicio_id,
            ),
        )
        .where(
            or_(
                RutinaSlot.ejercicio_principal_id == ejercicio_id,
                SlotAlternativa.id.is_not(None),
            ),
        )
        .order_by(Rutina.nombre, Rutina.id, RutinaSlot.orden)
    ).all()
    if not filas:
        return []
    rutina_ids = {rutina.id for _, rutina in filas}

    # El número de un hueco es su posición entre los visibles, no su `orden`: un
    # hueco oculto no cuenta, igual que en la rutina.
    posiciones: dict[int, int] = {}
    vistos: dict[int, int] = {}
    for slot_id, rutina_id in db.execute(
        select(RutinaSlot.id, RutinaSlot.rutina_id)
        .where(RutinaSlot.rutina_id.in_(rutina_ids), RutinaSlot.oculto_desde.is_(None))
        .order_by(RutinaSlot.rutina_id, RutinaSlot.orden)
    ):
        vistos[rutina_id] = vistos.get(rutina_id, 0) + 1
        posiciones[slot_id] = vistos[rutina_id]

    # Los programas visibles donde la rutina tiene algún día vigente.
    programas: dict[int, dict[int, ProgramaDeUnUsoOut]] = {}
    for rutina_id, programa, periodo_abierto in db.execute(
        select(ProgramaDia.rutina_id, Programa, ProgramaPeriodo.id)
        .join(Programa, Programa.id == ProgramaDia.programa_id)
        .outerjoin(
            ProgramaPeriodo,
            and_(
                ProgramaPeriodo.programa_id == Programa.id,
                ProgramaPeriodo.hasta.is_(None),
            ),
        )
        .where(
            ProgramaDia.rutina_id.in_(rutina_ids),
            ProgramaDia.hasta.is_(None),
            Programa.oculto_desde.is_(None),
        )
        .order_by(Programa.nombre, Programa.id, ProgramaDia.dia_semana)
    ):
        del_programa = programas.setdefault(rutina_id, {})
        if programa.id not in del_programa:
            del_programa[programa.id] = ProgramaDeUnUsoOut(
                id=programa.id,
                nombre=programa.nombre,
                activo=periodo_abierto is not None,
            )

    return [
        UsoEnRutinaOut(
            rutina=RutinaMinima.model_validate(rutina),
            slot_id=slot.id,
            rol="principal" if slot.ejercicio_principal_id == ejercicio_id else "comodin",
            posicion=posiciones.get(slot.id),
            oculto=slot.oculto or rutina.oculto,
            programas=list(programas.get(rutina.id, {}).values()),
        )
        for slot, rutina in filas
    ]


@router.get("", response_model=list[EjercicioOut])
def listar_ejercicios(
    ocultos: bool = False,
    db: Session = Depends(get_db),
):
    """Por defecto, biblioteca combinada: ejercicios predefinidos + los propios,
    sin los ocultos. Con `ocultos=true`, lista en cambio los que se han ocultado
    — para poder volver a mostrarlos (`POST /ejercicios/{id}/mostrar`) o
    borrarlos definitivamente.
    """
    if ocultos:
        stmt = select(Ejercicio).where(Ejercicio.oculto_desde.is_not(None))
    else:
        stmt = select(Ejercicio).where(Ejercicio.oculto_desde.is_(None))
    return db.scalars(stmt.order_by(Ejercicio.nombre)).all()


@router.get("/{ejercicio_id}", response_model=EjercicioOut)
def obtener_ejercicio(
    ejercicio_id: int,
    db: Session = Depends(get_db),
):
    # Legible y no visible: la ficha de un ejercicio oculto necesita abrirlo.
    return obtener_ejercicio_legible(db, ejercicio_id)


@router.get("/{ejercicio_id}/donde-se-usa", response_model=list[UsoEnRutinaOut])
def donde_se_usa(
    ejercicio_id: int,
    db: Session = Depends(get_db),
):
    """Las rutinas donde aparece, para la ficha del ejercicio. Aparte del aviso
    de borrado porque la ficha lo enseña siempre, no solo al borrar.
    Admite ocultos y predefinidos.
    """
    obtener_ejercicio_legible(db, ejercicio_id)
    return _usos_en_rutinas(db, ejercicio_id)


def _cuantas_notas(db: Session, ejercicio_id: int) -> int:
    return db.scalar(
        select(func.count())
        .select_from(NotaEjercicio)
        .where(
            NotaEjercicio.ejercicio_id == ejercicio_id,
        )
    )


@router.get("/{ejercicio_id}/aviso-de-borrado", response_model=AvisoDeBorrarEjercicioOut)
def aviso_de_borrar_ejercicio(
    ejercicio_id: int,
    db: Session = Depends(get_db),
):
    """Lo que se perdería al borrarlo, para el diálogo de confirmar (como el de la
    rutina y el del hueco). No modifica nada.

    Un predefinido da 404 y no 403: no se puede borrar, así que su aviso no existe.
    """
    ejercicio = obtener_ejercicio_legible(db, ejercicio_id)
    if ejercicio.es_predefinido:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    series, sesiones, desde = db.execute(
        select(
            func.count(Serie.id),
            func.count(func.distinct(Serie.entrenamiento_id)),
            func.min(Entrenamiento.fecha),
        )
        .join(Entrenamiento, Entrenamiento.id == Serie.entrenamiento_id)
        .where(_series_que_se_borran(ejercicio_id))
    ).one()
    return AvisoDeBorrarEjercicioOut(
        # Lo mismo que decide el 409 del DELETE, para que el diálogo no diga otra cosa.
        con_historial=_tiene_historial_ejercicio(db, ejercicio_id),
        series=series,
        sesiones=sesiones,
        desde=desde,
        notas=_cuantas_notas(db, ejercicio_id),
        huecos=_usos_en_rutinas(db, ejercicio_id),
        sesiones_que_se_vacian=[
            SesionQueSeVaciaOut(
                entrenamiento_id=sesion.id, fecha=sesion.fecha, cubre_fecha=sesion.cubre_fecha
            )
            for sesion in sesiones_que_se_vacian(db, _series_que_se_borran(ejercicio_id))
        ],
    )


@router.post("", response_model=EjercicioOut, status_code=status.HTTP_201_CREATED)
def crear_ejercicio(
    datos: EjercicioCreate,
    db: Session = Depends(get_db),
):
    """Crea un ejercicio propio (nunca predefinido — eso se gestiona aparte, no a
    través de este endpoint).
    """
    _validar_grupo_muscular(db, datos.grupo_muscular_id)
    ejercicio = Ejercicio(**datos.model_dump())
    db.add(ejercicio)
    db.commit()
    db.refresh(ejercicio)
    return ejercicio


@router.put("/{ejercicio_id}", response_model=EjercicioOut)
def actualizar_ejercicio(
    ejercicio_id: int,
    datos: EjercicioUpdate,
    db: Session = Depends(get_db),
):
    """Edita un ejercicio propio. Los predefinidos no se pueden editar."""
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.es_predefinido:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Los ejercicios predefinidos no se pueden editar.",
        )
    exigir_visible(ejercicio, "Este ejercicio está oculto: muéstralo antes de editarlo.")
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
):
    """Borra un ejercicio propio.

    - Sin usos (ver `_tiene_historial_ejercicio`): se borra de verdad, sin preguntar nada.
    - En uso: hace falta indicar `modo` explícitamente — `modo=ocultar`
      (borrado lógico: `oculto_desde=hoy`, conserva todo) o `modo=definitivo`
      (borra también las filas dependientes y las sesiones que se quedan sin
      ninguna serie, sin vuelta atrás). Sin `modo`, 409: lo que se perdería
      lo cuenta el aviso de borrado.
    """
    # Admite lo oculto: la ficha de un ejercicio oculto ofrece borrarlo.
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.es_predefinido:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Los ejercicios predefinidos no se pueden ocultar ni borrar.",
        )

    if modo == "ocultar":
        # Si ya estaba oculto, se conserva desde cuándo.
        if ejercicio.oculto_desde is None:
            ejercicio.oculto_desde = hoy()
        db.commit()
        return

    if modo != "definitivo" and _tiene_historial_ejercicio(db, ejercicio_id):
        # Lo que se perdería no se cuenta aquí: lo cuenta el aviso de borrado.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este ejercicio está en uso. Repite la petición con ?modo=ocultar (conserva"
                " todo) o ?modo=definitivo (lo borra con todo lo que lo usa, sin poder"
                " deshacerlo)."
            ),
        )

    # Sin usos, o modo=definitivo: borra de verdad. rutina_slots,
    # slot_alternativas y series hacia ejercicios son RESTRICT, así que hay
    # que borrar antes las filas dependientes explícitamente (los comodines
    # de cada hueco se van solos, en cascada por FK).
    # Antes de tocar nada: sin las series, ya no se sabría qué sesiones se vacían.
    vacias = sesiones_que_se_vacian(db, _series_que_se_borran(ejercicio_id))
    # Las series del ejercicio y, además, todas las de los huecos que se van a
    # borrar: las hechas con un comodín también apuntan al hueco (RESTRICT).
    for serie in db.scalars(select(Serie).where(_series_que_se_borran(ejercicio_id))).all():
        db.delete(serie)
    # flush obligatorio: sin él los DELETE viajan juntos al commit y SQLAlchemy
    # los ordena por las relationship() que conoce — no hay ninguna entre Serie y
    # RutinaSlot, así que borraría el hueco antes que sus series (RESTRICT).
    db.flush()
    # Ya sin series: se quedarían canceladas, así que se van con él.
    for sesion in vacias:
        db.delete(sesion)
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
):
    """Deshace un `modo=ocultar`: el ejercicio vuelve a ofrecerse para usarlo."""
    ejercicio = db.get(Ejercicio, ejercicio_id)
    if ejercicio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ejercicio no encontrado")
    if ejercicio.es_predefinido:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Los ejercicios predefinidos no se ocultan.",
        )
    ejercicio.oculto_desde = None
    db.commit()
    db.refresh(ejercicio)
    return ejercicio


@router.get("/{ejercicio_id}/historial", response_model=list[SesionHistorial])
def historial_de_ejercicio(
    ejercicio_id: int,
    hasta: date | None = None,
    limite: int = Query(default=SESIONES_POR_DEFECTO, gt=0, le=500),
    db: Session = Depends(get_db),
):
    """Los días en que se hizo este ejercicio, del más reciente al más antiguo,
    con las series de cada día — la progresión de un ejercicio concreto.

    Cuenta las veces que se hizo, en la rutina que fuera y como principal o como
    comodín: es también la "última vez" con la que se compara al entrenar. Se
    filtra con `hasta` (incluido) y `limite`, que es lo que piden las pantallas.
    """
    obtener_ejercicio_legible(db, ejercicio_id)
    return sesiones_con_series(db, Serie.ejercicio_id == ejercicio_id, hasta=hasta, limite=limite)


# --- Notas sobre un ejercicio --------------------------------


def _obtener_nota(db: Session, ejercicio_id: int, nota_id: int) -> NotaEjercicio:
    """404 si el ejercicio o la nota no existen, o la nota es de otro ejercicio.

    Admite ejercicios ocultos: las notas no "usan" el ejercicio, y una nota es
    justo donde apuntar por qué se ocultó.
    """
    obtener_ejercicio_legible(db, ejercicio_id)
    nota = db.get(NotaEjercicio, nota_id)
    if nota is None or nota.ejercicio_id != ejercicio_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nota no encontrada")
    return nota


@router.get("/{ejercicio_id}/notas", response_model=list[NotaOut])
def listar_notas(
    ejercicio_id: int,
    db: Session = Depends(get_db),
):
    """Las notas sobre este ejercicio, de la más reciente a la más antigua."""
    # También si está oculto: las notas se pueden leer y escribir igual (ver
    # `_obtener_nota`).
    obtener_ejercicio_legible(db, ejercicio_id)
    stmt = (
        select(NotaEjercicio)
        .where(
            NotaEjercicio.ejercicio_id == ejercicio_id,
        )
        .order_by(NotaEjercicio.created_at.desc(), NotaEjercicio.id.desc())
    )
    return db.scalars(stmt).all()


@router.post("/{ejercicio_id}/notas", response_model=NotaOut, status_code=status.HTTP_201_CREATED)
def crear_nota(
    ejercicio_id: int,
    datos: NotaCreate,
    db: Session = Depends(get_db),
):
    """Añade una nota al ejercicio. Se pueden acumular varias sobre el mismo
    ejercicio: cada una es independiente, no se sobreescriben. También en uno
    oculto, por ejemplo para apuntar por qué se ocultó.
    """
    obtener_ejercicio_legible(db, ejercicio_id)
    nota = NotaEjercicio(**datos.model_dump(), ejercicio_id=ejercicio_id)
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
):
    nota = _obtener_nota(db, ejercicio_id, nota_id)
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
):
    """Borrado directo, sin parámetro `modo`: nada referencia una nota, así
    que no hay historial que proteger (igual que con las series).
    """
    nota = _obtener_nota(db, ejercicio_id, nota_id)
    db.delete(nota)
    db.commit()
