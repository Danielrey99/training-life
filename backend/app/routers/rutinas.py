from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.fechas import hoy
from app.historial import SESIONES_POR_DEFECTO, sesiones_con_series
from app.models import (
    Entrenamiento,
    ExcepcionDelPlan,
    ProgramaDia,
    ProgramaPeriodo,
    Rutina,
    RutinaSlot,
    Serie,
    SlotAlternativa,
)
from app.ocultos import exigir_visible
from app.routers.ejercicios import obtener_ejercicio_del_usuario, obtener_ejercicio_visible
from app.schemas import (
    ComodinCreate,
    RutinaCreate,
    RutinaOut,
    RutinaSlotCreate,
    RutinaSlotOut,
    RutinaSlotUpdate,
    RutinaUpdate,
    SesionHistorialHueco,
)

router = APIRouter(prefix="/rutinas", tags=["rutinas"])


# --- Rutinas -------------------------------------------------------------


def _obtener_rutina_legible(db: Session, rutina_id: int, usuario_id: int) -> Rutina:
    """Para leer: 404 tanto si no existe como si no es tuya (no hay rutinas
    predefinidas). Admite las ocultas, que tienen su propia vista.
    """
    rutina = db.get(Rutina, rutina_id)
    if rutina is None or rutina.usuario_id != usuario_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rutina no encontrada")
    return rutina


def obtener_rutina_visible(db: Session, rutina_id: int, usuario_id: int) -> Rutina:
    """Para *usar* una rutina que llega en una petición (asignarla a un día de un
    programa): 404 si no existe, es de otro o está oculta, igual que
    `obtener_ejercicio_visible`. Lo oculto deja de ofrecerse para elegir.

    Pública porque la usan también otros routers.
    """
    rutina = db.get(Rutina, rutina_id)
    if rutina is None or rutina.usuario_id != usuario_id or rutina.oculto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe ninguna rutina con id {rutina_id}",
        )
    return rutina


def _aviso_de_dias(cuantos: int, que_les_pasa: str) -> str:
    """Una frase del aviso de borrado: " Además, está en 3 días …", en singular o
    plural según haga falta. `que_les_pasa` lleva {s} y {n} donde van las
    terminaciones del plural.
    """
    if not cuantos:
        return ""
    plural = cuantos != 1
    texto = que_les_pasa.format(s="s" if plural else "", n="n" if plural else "")
    return f" Además, está en {cuantos} día{'s' if plural else ''} {texto}."


def _obtener_rutina_propia(
    db: Session, rutina_id: int, usuario_id: int, admitir_oculta: bool = False
) -> Rutina:
    """Para modificar: 404 si no existe, 403 si no es tuya y 409 si está oculta,
    salvo con `admitir_oculta`, que es para borrarla o volver a mostrarla.
    """
    rutina = db.get(Rutina, rutina_id)
    if rutina is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rutina no encontrada")
    if rutina.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede modificar una rutina que no es tuya",
        )
    if not admitir_oculta:
        exigir_visible(rutina, "Esta rutina está oculta: muéstrala antes de cambiarla.")
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


def _estuvo_en_el_plan(db: Session, rutina_id: int) -> bool:
    """¿Tocó esta rutina algún día que ya pasó? Por un día del programa mientras
    este estaba activo, o por un día planificado a mano.

    Borrarla se lleva en cascada sus días de programa y sus días planificados,
    también los pasados: el calendario pintaría esos días como descanso, como si
    nunca hubiera tocado nada. Por eso, si ya estuvo en el plan, borrarla pide
    `modo`, igual que si tuviera historial.
    """
    hoy_ = hoy()
    planificada = db.scalar(
        select(ExcepcionDelPlan.id)
        .where(ExcepcionDelPlan.rutina_id == rutina_id, ExcepcionDelPlan.fecha < hoy_)
        .limit(1)
    )
    if planificada is not None:
        return True
    filas = db.execute(
        select(ProgramaDia, ProgramaPeriodo)
        .join(ProgramaPeriodo, ProgramaPeriodo.programa_id == ProgramaDia.programa_id)
        .where(ProgramaDia.rutina_id == rutina_id)
    ).all()
    for fila, periodo in filas:
        # Lo que la fila y el periodo tienen en común antes de hoy (los dos son
        # de `desde` a `hasta` sin incluirlo; nulo es sin límite).
        inicio = max(periodo.desde, fila.desde or date.min)
        fin = min(periodo.hasta or date.max, fila.hasta or date.max, hoy_)
        if inicio >= fin:
            continue
        # Y dentro de eso, algún día de la semana de la fila.
        primero = inicio + timedelta(days=(fila.dia_semana - inicio.isoweekday()) % 7)
        if primero < fin:
            return True
    return False


@router.get("", response_model=list[RutinaOut])
def listar_rutinas(
    ocultas: bool = False,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Por defecto, lista las rutinas visibles del usuario. Con
    `ocultas=true`, lista en cambio las que ha ocultado — para poder
    volver a mostrarlas (`POST /rutinas/{id}/mostrar`) o borrarlas definitivamente.
    """
    filtro = Rutina.oculto_desde.is_not(None) if ocultas else Rutina.oculto_desde.is_(None)
    stmt = select(Rutina).where(Rutina.usuario_id == usuario_id, filtro).order_by(Rutina.nombre)
    return db.scalars(stmt).all()


@router.get("/{rutina_id}", response_model=RutinaOut)
def obtener_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    return _obtener_rutina_legible(db, rutina_id, usuario_id)


@router.post("", response_model=RutinaOut, status_code=status.HTTP_201_CREATED)
def crear_rutina(
    datos: RutinaCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Crea la rutina "vacía" (sin huecos todavía) — los huecos se añaden
    aparte, con POST /rutinas/{id}/slots.
    """
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


@router.post("/{rutina_id}/mostrar", response_model=RutinaOut)
def mostrar_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Deshace un `modo=ocultar`: la rutina vuelve a ofrecerse para usarla."""
    rutina = _obtener_rutina_propia(db, rutina_id, usuario_id, admitir_oculta=True)
    rutina.oculto_desde = None
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

    - Sin huecos ni entrenamientos asociados, y sin haber tocado ningún día
      pasado: se borra de verdad, sin preguntar nada.
    - Con huecos, entrenamientos o días pasados en el plan: hace falta
      `modo=ocultar` (conserva todo) o `modo=definitivo` (lo borra todo, sin
      vuelta atrás, y esos días pasan a descanso en el calendario).
    """
    rutina = _obtener_rutina_propia(db, rutina_id, usuario_id, admitir_oculta=True)

    if modo == "ocultar":
        # Si ya estaba oculta, se conserva desde cuándo.
        if rutina.oculto_desde is None:
            rutina.oculto_desde = hoy()
        db.commit()
        return

    razones = []
    if _tiene_dependientes(db, rutina_id):
        razones.append("tiene huecos definidos (o historial de entrenamientos)")
    if _estuvo_en_el_plan(db, rutina_id):
        razones.append("ya tocó días que han pasado, que en el calendario pasarían a descanso")
    if razones and modo != "definitivo":
        # Los días de programa y los días planificados con ella no bloquean el
        # borrado (se van solos, en cascada), pero si otra cosa ya lo bloquea, el
        # aviso cuenta también lo que se pierde ahí.
        en_programas = _aviso_de_dias(
            db.scalar(
                select(func.count())
                .select_from(ProgramaDia)
                .where(ProgramaDia.rutina_id == rutina_id, ProgramaDia.hasta.is_(None))
            ),
            "de programa, que pasaría{n} a descanso",
        ) + _aviso_de_dias(
            db.scalar(
                select(func.count())
                .select_from(ExcepcionDelPlan)
                .where(ExcepcionDelPlan.rutina_id == rutina_id)
            ),
            "planificado{s} a mano, que volvería{n} a lo que diga el programa",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Esta rutina {' y '.join(razones)}. "
                "Repite la petición con ?modo=ocultar (conserva todo, deja de estar "
                "disponible para entrenamientos nuevos) o ?modo=definitivo (lo borra "
                "todo, sin poder deshacerlo)." + en_programas
            ),
        )

    # rutina_slots.rutina_id y entrenamientos.rutina_id son RESTRICT: hay que
    # borrar ambos antes, y en este orden — al irse el entrenamiento se van sus
    # series en cascada, que son las que bloquearían el hueco.
    for entrenamiento in db.scalars(
        select(Entrenamiento).where(Entrenamiento.rutina_id == rutina_id)
    ).all():
        db.delete(entrenamiento)
    # El flush es lo que garantiza ese orden: sin él lo decide SQLAlchemy por su
    # cuenta (mismo caso que en borrar_ejercicio).
    db.flush()
    for slot in db.scalars(select(RutinaSlot).where(RutinaSlot.rutina_id == rutina_id)).all():
        db.delete(slot)
    db.delete(rutina)
    db.commit()


# --- Huecos (rutina_slots) -----------------------------------------------


def _obtener_slot_propio(
    db: Session, rutina_id: int, slot_id: int, usuario_id: int, admitir_oculto: bool = False
) -> RutinaSlot:
    """Para modificar un hueco: los mismos códigos que `_obtener_rutina_propia`, y
    el 409 salta tanto si está oculto el hueco como si lo está su rutina.
    """
    _obtener_rutina_propia(db, rutina_id, usuario_id, admitir_oculta=admitir_oculto)
    slot = db.get(RutinaSlot, slot_id)
    if slot is None or slot.rutina_id != rutina_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hueco no encontrado")
    if not admitir_oculto:
        exigir_visible(slot, "Este hueco está oculto: muéstralo antes de cambiarlo.")
    return slot


def _obtener_slot_legible(db: Session, rutina_id: int, slot_id: int, usuario_id: int) -> RutinaSlot:
    """Para leer el historial de un hueco: 404 si no existe o no es tuyo.

    A diferencia de `_obtener_slot_propio`, admite que el hueco o su rutina
    estén ocultos: ocultarlos deja de ofrecerlos para entrenamientos nuevos,
    pero no borra lo que ya se entrenó ahí. Y responde 404 en vez de 403, como
    el resto de los GET del proyecto: en una lectura no hay ninguna acción para
    la que el usuario pudiera "tener permiso de más".
    """
    _obtener_rutina_legible(db, rutina_id, usuario_id)
    slot = db.get(RutinaSlot, slot_id)
    if slot is None or slot.rutina_id != rutina_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hueco no encontrado")
    return slot


def _validar_orden_disponible(
    db: Session, rutina_id: int, orden: int, excluir_slot_id: int | None = None
) -> None:
    """`UniqueConstraint(rutina_id, orden)` a nivel de base de datos evita
    duplicados de verdad, pero comprobarlo antes da un 409 legible en vez de
    un error crudo de la base de datos.
    """
    stmt = select(RutinaSlot.id).where(RutinaSlot.rutina_id == rutina_id, RutinaSlot.orden == orden)
    if excluir_slot_id is not None:
        stmt = stmt.where(RutinaSlot.id != excluir_slot_id)
    if db.scalar(stmt.limit(1)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya hay un hueco con orden={orden} en esta rutina",
        )


@router.post(
    "/{rutina_id}/slots",
    response_model=RutinaSlotOut,
    status_code=status.HTTP_201_CREATED,
)
def crear_slot(
    rutina_id: int,
    datos: RutinaSlotCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
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
    # El principal solo se valida si cambia: si se ocultó después, el hueco lo
    # sigue enseñando, y corregir sus series o reps no es elegirlo de nuevo.
    if datos.ejercicio_principal_id != slot.ejercicio_principal_id:
        obtener_ejercicio_visible(db, datos.ejercicio_principal_id, usuario_id)
        if any(comodin.id == datos.ejercicio_principal_id for comodin in slot.alternativas):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ese ejercicio ya es comodín de este hueco: quítalo antes de hacerlo principal",
            )
    _validar_orden_disponible(db, rutina_id, datos.orden, excluir_slot_id=slot_id)
    for campo, valor in datos.model_dump().items():
        setattr(slot, campo, valor)
    db.commit()
    db.refresh(slot)
    return slot


def _tiene_historial_slot(db: Session, slot_id: int) -> bool:
    """¿Hay alguna serie registrada que use este hueco? `series.slot_id` es
    RESTRICT hacia rutina_slots.
    """
    return db.scalar(select(Serie.id).where(Serie.slot_id == slot_id).limit(1)) is not None


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
    slot = _obtener_slot_propio(db, rutina_id, slot_id, usuario_id, admitir_oculto=True)

    if modo == "ocultar":
        # Si ya estaba oculto, se conserva desde cuándo.
        if slot.oculto_desde is None:
            slot.oculto_desde = hoy()
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
    # Sin flush, SQLAlchemy puede mandar el DELETE del hueco antes que el de sus
    # series (no hay relación declarada entre ambos que le diga el orden), y
    # Postgres lo rechaza porque las series aún lo referencian.
    db.flush()
    db.delete(slot)
    db.commit()


@router.post("/{rutina_id}/slots/{slot_id}/mostrar", response_model=RutinaSlotOut)
def mostrar_slot(
    rutina_id: int,
    slot_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Deshace un `modo=ocultar`: el hueco vuelve a su rutina, en el mismo sitio."""
    slot = _obtener_slot_propio(db, rutina_id, slot_id, usuario_id, admitir_oculto=True)
    slot.oculto_desde = None
    db.commit()
    db.refresh(slot)
    return slot


@router.get("/{rutina_id}/slots/{slot_id}/historial", response_model=list[SesionHistorialHueco])
def historial_de_hueco(
    rutina_id: int,
    slot_id: int,
    ejercicio_id: int | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = Query(default=SESIONES_POR_DEFECTO, gt=0, le=500),
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """La progresión del hueco entero, no la de un ejercicio suelto: los días en
    que se entrenó, con qué ejercicio se hizo cada serie y con cuánto peso.

    Es la vista que justifica que `series` guarde `slot_id` además de
    `ejercicio_id`: aquí cuentan por igual los días con el ejercicio principal y
    los días en que tocó un comodín.

    Con `ejercicio_id`, solo las series de ese ejercicio en este hueco: es la
    "última vez" con la que se compara al entrenar, que tiene que ser con el mismo
    ejercicio y no con el comodín que tocó la semana pasada.
    """
    _obtener_slot_legible(db, rutina_id, slot_id, usuario_id)
    filtro = Serie.slot_id == slot_id
    if ejercicio_id is not None:
        # Legible y no visible: un ejercicio ocultado sigue teniendo historial.
        obtener_ejercicio_del_usuario(db, ejercicio_id, usuario_id)
        filtro = and_(filtro, Serie.ejercicio_id == ejercicio_id)
    return sesiones_con_series(db, usuario_id, filtro, desde, hasta, limite)


# --- Comodines (slot_alternativas) ---------------------------------------


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

    if datos.ejercicio_id == slot.ejercicio_principal_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese ejercicio ya es el principal de este hueco",
        )
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
