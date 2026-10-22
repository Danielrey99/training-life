from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, exists, func, select
from sqlalchemy.orm import Session, selectinload

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
from app.seguimiento import (
    aviso_de_sesiones_que_se_borran,
    cancelada_sql,
    en_curso_sql,
    sesiones_que_se_vacian,
)
from app.routers.ejercicios import obtener_ejercicio_legible, obtener_ejercicio_visible
from app.schemas import (
    AvisoDeBorrarHuecoOut,
    AvisoDeBorrarRutinaOut,
    OrdenDeHuecos,
    RutinaCreate,
    RutinaOut,
    RutinaSlotCreate,
    RutinaSlotOut,
    RutinaSlotUpdate,
    RutinaUpdate,
    SesionHistorialHueco,
    SesionQueSeVaciaOut,
)

router = APIRouter(prefix="/rutinas", tags=["rutinas"])


# --- Rutinas -------------------------------------------------------------


def _obtener_rutina_legible(db: Session, rutina_id: int) -> Rutina:
    """Para leer: 404 si no existe. Admite las ocultas, que tienen su propia vista."""
    rutina = db.get(Rutina, rutina_id)
    if rutina is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rutina no encontrada")
    return rutina


def obtener_rutina_visible(db: Session, rutina_id: int) -> Rutina:
    """Para *usar* una rutina que llega en una petición (asignarla a un día de un
    programa): 404 si no existe o está oculta, igual que
    `obtener_ejercicio_visible`. Lo oculto deja de ofrecerse para elegir.

    Pública porque la usan también otros routers.
    """
    rutina = db.get(Rutina, rutina_id)
    if rutina is None or rutina.oculto:
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


def _obtener_rutina_modificable(
    db: Session, rutina_id: int, admitir_oculta: bool = False
) -> Rutina:
    """Para modificar: 404 si no existe y 409 si está oculta, salvo con
    `admitir_oculta`, que es para borrarla o volver a mostrarla.
    """
    rutina = db.get(Rutina, rutina_id)
    if rutina is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rutina no encontrada")
    if not admitir_oculta:
        exigir_visible(rutina, "Esta rutina está oculta: muéstrala antes de cambiarla.")
    return rutina


def _tiene_dependientes(db: Session, rutina_id: int) -> bool:
    """¿Tiene esta rutina huecos (su propia estructura, también los ocultos) o
    sesiones (historial real)? Es lo que hace que borrarla tenga que preguntar.

    Las sesiones canceladas no cuentan: no se hizo nada en ellas (`esta_cancelada`).
    Se borran con la rutina igualmente, porque `entrenamientos.rutina_id` es
    RESTRICT. La vacía en curso hoy sí cuenta: se acaba de empezar.
    """
    tiene_slots = (
        db.scalar(select(RutinaSlot.id).where(RutinaSlot.rutina_id == rutina_id).limit(1))
        is not None
    )
    tiene_entrenamientos = (
        db.scalar(
            select(Entrenamiento.id)
            .where(Entrenamiento.rutina_id == rutina_id, ~cancelada_sql())
            .limit(1)
        )
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


def _dias_de_programa(db: Session, rutina_id: int) -> int:
    """En cuántos días vigentes de programa está: pasarían a descanso al borrarla."""
    return db.scalar(
        select(func.count())
        .select_from(ProgramaDia)
        .where(ProgramaDia.rutina_id == rutina_id, ProgramaDia.hasta.is_(None))
    )


def _dias_planificados(db: Session, rutina_id: int) -> int:
    """En cuántos días planificados a mano está: volverían a lo que diga el programa."""
    return db.scalar(
        select(func.count())
        .select_from(ExcepcionDelPlan)
        .where(ExcepcionDelPlan.rutina_id == rutina_id)
    )


@router.get("", response_model=list[RutinaOut])
def listar_rutinas(
    ocultas: bool = False,
    db: Session = Depends(get_db),
):
    """Por defecto, lista las rutinas visibles. Con
    `ocultas=true`, lista en cambio las que ha ocultado — para poder
    volver a mostrarlas (`POST /rutinas/{id}/mostrar`) o borrarlas definitivamente.
    """
    filtro = Rutina.oculto_desde.is_not(None) if ocultas else Rutina.oculto_desde.is_(None)
    huecos = selectinload(Rutina.slots)
    stmt = (
        select(Rutina)
        .where(filtro)
        # De una vez para todas las rutinas, y no una consulta por rutina al
        # serializar sus huecos, sus comodines y en qué programas está.
        .options(
            huecos.selectinload(RutinaSlot.ejercicio_principal),
            huecos.selectinload(RutinaSlot.slot_alternativas).selectinload(
                SlotAlternativa.ejercicio
            ),
            selectinload(Rutina.dias_de_programa).selectinload(ProgramaDia.programa),
        )
        .order_by(Rutina.nombre)
    )
    return db.scalars(stmt).all()


@router.get("/{rutina_id}", response_model=RutinaOut)
def obtener_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
):
    return _obtener_rutina_legible(db, rutina_id)


@router.post("", response_model=RutinaOut, status_code=status.HTTP_201_CREATED)
def crear_rutina(
    datos: RutinaCreate,
    db: Session = Depends(get_db),
):
    """Crea una rutina, vacía o con sus huecos y comodines de una vez.

    Todo en una transacción: primero se comprueba cada ejercicio y solo después se
    construye nada, así que un ejercicio que no vale (inexistente u oculto:
    404) no deja una rutina a medias. El orden de los huecos es el de la lista.
    """
    _validar_ejercicios_elegidos(
        db,
        [
            id_
            for hueco in datos.slots
            for id_ in (hueco.ejercicio_principal_id, *hueco.alternativa_ids)
        ],
    )
    rutina = Rutina(nombre=datos.nombre)
    # Solo INSERT, todos en la misma relación: no hace falta flush() entre ellos.
    rutina.slots = [
        RutinaSlot(
            orden=posicion,
            ejercicio_principal_id=hueco.ejercicio_principal_id,
            series_objetivo=hueco.series_objetivo,
            reps_min=hueco.reps_min,
            reps_max=hueco.reps_max,
            slot_alternativas=[SlotAlternativa(ejercicio_id=id_) for id_ in hueco.alternativa_ids],
        )
        for posicion, hueco in enumerate(datos.slots, start=1)
    ]
    db.add(rutina)
    db.commit()
    db.refresh(rutina)
    return rutina


@router.put("/{rutina_id}", response_model=RutinaOut)
def actualizar_rutina(
    rutina_id: int,
    datos: RutinaUpdate,
    db: Session = Depends(get_db),
):
    rutina = _obtener_rutina_modificable(db, rutina_id)
    for campo, valor in datos.model_dump().items():
        setattr(rutina, campo, valor)
    db.commit()
    db.refresh(rutina)
    return rutina


def _nombre_de_copia(nombre: str, ocupados: set[str]) -> str:
    """El nombre de la copia como lo pone Windows: «Push - copia», y si ya existe,
    «Push - copia (2)», «(3)»… Si no cabe en los 100 caracteres, se recorta el
    nombre y no el sufijo, que es lo que dice que es una copia.
    """
    numero = 1
    while True:
        sufijo = " - copia" if numero == 1 else f" - copia ({numero})"
        candidato = nombre[: 100 - len(sufijo)].rstrip() + sufijo
        if candidato.casefold() not in ocupados:
            return candidato
        numero += 1


@router.post("/{rutina_id}/duplicar", response_model=RutinaOut, status_code=status.HTTP_201_CREATED)
def duplicar_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
):
    """Una copia de la rutina para que diverja del original: editar una rutina
    cambia todos los programas y días donde está, y esta es la forma de no
    hacerlo.

    Copia lo que se ve: los huecos visibles con su ejercicio y sus comodines,
    aunque alguno esté oculto (decisión del autor). No copia los huecos ocultos,
    ni los días de programa (la copia nace sin usar), ni el historial. Admite una
    rutina oculta, porque duplicar no la modifica; la copia nace visible.
    """
    rutina = _obtener_rutina_modificable(db, rutina_id, admitir_oculta=True)
    # También las ocultas: dos rutinas con el mismo nombre se confundirían al
    # volver a mostrar una.
    ocupados = {nombre.casefold() for nombre in db.scalars(select(Rutina.nombre))}
    copia = Rutina(nombre=_nombre_de_copia(rutina.nombre, ocupados))
    copia.slots = [
        RutinaSlot(
            ejercicio_principal_id=slot.ejercicio_principal_id,
            orden=slot.orden,
            series_objetivo=slot.series_objetivo,
            reps_min=slot.reps_min,
            reps_max=slot.reps_max,
            slot_alternativas=[
                SlotAlternativa(ejercicio_id=comodin.ejercicio_id)
                for comodin in slot.slot_alternativas
            ],
        )
        for slot in rutina.slots
        if not slot.oculto
    ]
    db.add(copia)
    db.commit()
    db.refresh(copia)
    return copia


@router.put("/{rutina_id}/orden", response_model=RutinaOut)
def ordenar_huecos(
    rutina_id: int,
    datos: OrdenDeHuecos,
    db: Session = Depends(get_db),
):
    """Reordena los huecos visibles de una vez. Con PUT sueltos no se puede:
    intercambiar dos huecos choca a medias con `UNIQUE(rutina_id, orden)`.

    Los visibles se reparten los `orden` que ya tenían, en el orden nuevo, y los
    ocultos conservan el suyo: así no chocan, y al mostrarlos vuelven a su sitio.
    """
    rutina = _obtener_rutina_modificable(db, rutina_id)
    visibles = {slot.id: slot for slot in rutina.slots if not slot.oculto}
    # 422 y no 404 con un id que no es de esta rutina.
    if set(datos.slot_ids) != set(visibles):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Manda todos los huecos visibles de la rutina, cada uno una vez",
        )
    ordenes = sorted(slot.orden for slot in visibles.values())
    # Dos pasos: primero cada uno a un valor que no choca con nadie (los ocultos
    # tienen orden positivo) y luego el definitivo. Sin el flush, la restricción
    # única saltaría a mitad de camino.
    for slot in visibles.values():
        slot.orden = -slot.id
    db.flush()
    for orden, slot_id in zip(ordenes, datos.slot_ids, strict=True):
        visibles[slot_id].orden = orden
    db.commit()
    # La lista de huecos ya cargada sigue en el orden de antes.
    db.refresh(rutina)
    return rutina


@router.get("/{rutina_id}/aviso-de-borrado", response_model=AvisoDeBorrarRutinaOut)
def aviso_de_borrar_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
):
    """Lo que se perdería al borrarla, para el diálogo de confirmar. La web no
    puede saberlo con el 409 del DELETE: sin historial, el DELETE borraría sin
    preguntar.
    """
    _obtener_rutina_legible(db, rutina_id)
    toco_dias_pasados = _estuvo_en_el_plan(db, rutina_id)
    con_series = exists().where(Serie.entrenamiento_id == Entrenamiento.id)
    return AvisoDeBorrarRutinaOut(
        con_historial=_tiene_dependientes(db, rutina_id) or toco_dias_pasados,
        huecos=db.scalar(
            select(func.count()).select_from(RutinaSlot).where(RutinaSlot.rutina_id == rutina_id)
        ),
        sesiones=db.scalar(
            select(func.count())
            .select_from(Entrenamiento)
            .where(Entrenamiento.rutina_id == rutina_id, con_series)
        ),
        dias_de_programa=_dias_de_programa(db, rutina_id),
        dias_planificados=_dias_planificados(db, rutina_id),
        toco_dias_pasados=toco_dias_pasados,
        sesion_en_curso=db.scalar(
            select(Entrenamiento.id)
            .where(Entrenamiento.rutina_id == rutina_id, en_curso_sql())
            .limit(1)
        )
        is not None,
    )


@router.post("/{rutina_id}/mostrar", response_model=RutinaOut)
def mostrar_rutina(
    rutina_id: int,
    db: Session = Depends(get_db),
):
    """Deshace un `modo=ocultar`: la rutina vuelve a ofrecerse para usarla."""
    rutina = _obtener_rutina_modificable(db, rutina_id, admitir_oculta=True)
    rutina.oculto_desde = None
    db.commit()
    db.refresh(rutina)
    return rutina


@router.delete("/{rutina_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_rutina(
    rutina_id: int,
    modo: Literal["ocultar", "definitivo"] | None = None,
    db: Session = Depends(get_db),
):
    """Borra una rutina.

    - Sin huecos ni sesiones (las canceladas no cuentan y se borran con ella), y
      sin haber tocado ningún día pasado: se borra de verdad, sin preguntar nada.
    - Con huecos, sesiones o días pasados en el plan: hace falta
      `modo=ocultar` (conserva todo) o `modo=definitivo` (lo borra todo, sin
      vuelta atrás, y esos días pasan a descanso en el calendario).
    """
    rutina = _obtener_rutina_modificable(db, rutina_id, admitir_oculta=True)

    if modo == "ocultar":
        # Si ya estaba oculta, se conserva desde cuándo.
        if rutina.oculto_desde is None:
            rutina.oculto_desde = hoy()
        db.commit()
        return

    razones = []
    if _tiene_dependientes(db, rutina_id):
        razones.append("tiene huecos o sesiones registradas")
    if _estuvo_en_el_plan(db, rutina_id):
        razones.append("ya tocó días que han pasado, que en el calendario pasarían a descanso")
    if razones and modo != "definitivo":
        # Los días de programa y los días planificados con ella no bloquean el
        # borrado (se van solos, en cascada), pero si otra cosa ya lo bloquea, el
        # aviso cuenta también lo que se pierde ahí.
        en_programas = _aviso_de_dias(
            _dias_de_programa(db, rutina_id), "de programa, que pasaría{n} a descanso"
        ) + _aviso_de_dias(
            _dias_planificados(db, rutina_id),
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


def _obtener_slot_modificable(
    db: Session, rutina_id: int, slot_id: int, admitir_oculto: bool = False
) -> RutinaSlot:
    """Para modificar un hueco: 404 si no existe él o su rutina, y 409 si la rutina está
    oculta (cambiar lo de dentro de algo que no se ve no se permite: se muestra antes
    la rutina). `admitir_oculto` deja pasar solo al hueco oculto, para mostrarlo o
    borrarlo; con la rutina oculta no vale nunca.

    Los 404 van antes que los 409: un hueco que no existe es 404 aunque su rutina
    esté oculta.
    """
    rutina = _obtener_rutina_modificable(db, rutina_id, admitir_oculta=True)
    slot = db.get(RutinaSlot, slot_id)
    if slot is None or slot.rutina_id != rutina_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hueco no encontrado")
    exigir_visible(rutina, "Esta rutina está oculta: muéstrala antes de cambiarla.")
    if not admitir_oculto:
        exigir_visible(slot, "Este hueco está oculto: muéstralo antes de cambiarlo.")
    return slot


def _obtener_slot_legible(db: Session, rutina_id: int, slot_id: int) -> RutinaSlot:
    """Para leer el historial de un hueco: 404 si no existe.

    A diferencia de `_obtener_slot_modificable`, admite que el hueco o su rutina
    estén ocultos: ocultarlos deja de ofrecerlos para entrenamientos nuevos,
    pero no borra lo que ya se entrenó ahí.
    """
    _obtener_rutina_legible(db, rutina_id)
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


def _validar_ejercicios_elegidos(db: Session, ids) -> None:
    """Cada ejercicio que se elige (principal o comodín) tiene que ser visible: 404
    si no existe o está oculto. Cada id se mira una vez.
    """
    for ejercicio_id in dict.fromkeys(ids):
        obtener_ejercicio_visible(db, ejercicio_id)


ORDEN_MAXIMO = 100


def _siguiente_orden(db: Session, rutina_id: int) -> int:
    """Al final de la rutina: el mayor `orden` de todos sus huecos, también los
    ocultos (al mostrarlos vuelven a su sitio y no deben chocar), más uno.

    Con tope, porque el PUT de un hueco exige `orden <= 100`: uno con 101 ya no se
    podría editar.
    """
    mayor = db.scalar(select(func.max(RutinaSlot.orden)).where(RutinaSlot.rutina_id == rutina_id))
    siguiente = (mayor or 0) + 1
    if siguiente > ORDEN_MAXIMO:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta rutina no admite más ejercicios",
        )
    return siguiente


@router.post(
    "/{rutina_id}/slots",
    response_model=RutinaSlotOut,
    status_code=status.HTTP_201_CREATED,
)
def crear_slot(
    rutina_id: int,
    datos: RutinaSlotCreate,
    db: Session = Depends(get_db),
):
    _obtener_rutina_modificable(db, rutina_id)
    _validar_ejercicios_elegidos(db, [datos.ejercicio_principal_id, *datos.alternativa_ids])
    if datos.orden is None:
        orden = _siguiente_orden(db, rutina_id)
    else:
        _validar_orden_disponible(db, rutina_id, datos.orden)
        orden = datos.orden
    slot = RutinaSlot(
        rutina_id=rutina_id,
        orden=orden,
        ejercicio_principal_id=datos.ejercicio_principal_id,
        series_objetivo=datos.series_objetivo,
        reps_min=datos.reps_min,
        reps_max=datos.reps_max,
        slot_alternativas=[SlotAlternativa(ejercicio_id=id_) for id_ in datos.alternativa_ids],
    )
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
):
    """Cambia un hueco. Con `alternativa_ids`, la lista sustituye a los comodines
    actuales (vacía, los quita todos); sin ella, los comodines no se tocan.
    """
    slot = _obtener_slot_modificable(db, rutina_id, slot_id)
    actuales = {fila.ejercicio_id for fila in slot.slot_alternativas}
    # El principal solo se valida si cambia: si se ocultó después, el hueco lo
    # sigue enseñando, y corregir sus series o reps no es elegirlo de nuevo.
    if datos.ejercicio_principal_id != slot.ejercicio_principal_id:
        obtener_ejercicio_visible(db, datos.ejercicio_principal_id)
        # Con la lista nueva, el validador ya garantiza que el principal no está en
        # ella: intercambiar principal y comodín en una sola petición vale.
        if datos.alternativa_ids is None and datos.ejercicio_principal_id in actuales:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ese ejercicio ya es comodín de este hueco: quítalo antes de hacerlo principal",
            )
    # Solo se validan los comodines que se añaden: uno ya oculto que se conserva no
    # se está eligiendo de nuevo ("corregir sí, elegir algo oculto no").
    if datos.alternativa_ids is not None:
        _validar_ejercicios_elegidos(
            db, [id_ for id_ in datos.alternativa_ids if id_ not in actuales]
        )
    _validar_orden_disponible(db, rutina_id, datos.orden, excluir_slot_id=slot_id)
    for campo, valor in datos.model_dump(exclude={"alternativa_ids"}).items():
        setattr(slot, campo, valor)
    if datos.alternativa_ids is not None:
        # Se conservan las filas de los que siguen. Reconstruir la lista entera
        # borraría y volvería a insertar el mismo par (hueco, ejercicio), y SQLAlchemy
        # emite los INSERT antes que los DELETE: UNIQUE(slot_id, ejercicio_id) daría 500.
        nuevos = set(datos.alternativa_ids)
        for fila in list(slot.slot_alternativas):
            if fila.ejercicio_id not in nuevos:
                slot.slot_alternativas.remove(fila)
        for id_ in datos.alternativa_ids:
            if id_ not in actuales:
                slot.slot_alternativas.append(SlotAlternativa(ejercicio_id=id_))
    db.commit()
    db.refresh(slot)
    return slot


def _tiene_historial_slot(db: Session, slot_id: int) -> bool:
    """¿Hay alguna serie registrada que use este hueco? `series.slot_id` es
    RESTRICT hacia rutina_slots.
    """
    return db.scalar(select(Serie.id).where(Serie.slot_id == slot_id).limit(1)) is not None


@router.get("/{rutina_id}/slots/{slot_id}/aviso-de-borrado", response_model=AvisoDeBorrarHuecoOut)
def aviso_de_borrar_slot(
    rutina_id: int,
    slot_id: int,
    db: Session = Depends(get_db),
):
    """Lo que se perdería al borrarlo, para el diálogo de confirmar (como el de la
    rutina): cuántas series, desde cuándo y qué sesiones se quedarían vacías.
    """
    _obtener_slot_legible(db, rutina_id, slot_id)
    series, desde = db.execute(
        select(func.count(Serie.id), func.min(Entrenamiento.fecha))
        .join(Entrenamiento, Entrenamiento.id == Serie.entrenamiento_id)
        .where(Serie.slot_id == slot_id)
    ).one()
    return AvisoDeBorrarHuecoOut(
        series=series,
        desde=desde,
        sesiones_que_se_vacian=[
            SesionQueSeVaciaOut(
                entrenamiento_id=sesion.id, fecha=sesion.fecha, cubre_fecha=sesion.cubre_fecha
            )
            for sesion in sesiones_que_se_vacian(db, Serie.slot_id == slot_id)
        ],
    )


@router.delete("/{rutina_id}/slots/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_slot(
    rutina_id: int,
    slot_id: int,
    modo: Literal["ocultar", "definitivo"] | None = None,
    db: Session = Depends(get_db),
):
    """Borra un hueco.

    - Sin series registradas: se borra de verdad (sus comodines se van con
      él, en cascada por FK), sin preguntar nada.
    - Con series: hace falta `modo=ocultar` (conserva todo) o
      `modo=definitivo` (borra también las series que lo usan, y las sesiones
      que se quedan sin ninguna, sin vuelta atrás).
    """
    slot = _obtener_slot_modificable(db, rutina_id, slot_id, admitir_oculto=True)

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
                + aviso_de_sesiones_que_se_borran(
                    len(sesiones_que_se_vacian(db, Serie.slot_id == slot_id)),
                    "este hueco",
                )
            ),
        )

    # Antes de tocar nada: sin las series del hueco, ya no se sabría cuáles se vacían.
    vacias = sesiones_que_se_vacian(db, Serie.slot_id == slot_id)
    # series.slot_id es RESTRICT: hay que borrar antes las series que lo usan.
    for serie in db.scalars(select(Serie).where(Serie.slot_id == slot_id)).all():
        db.delete(serie)
    # Sin flush, SQLAlchemy puede mandar el DELETE del hueco antes que el de sus
    # series (no hay relación declarada entre ambos que le diga el orden), y
    # Postgres lo rechaza porque las series aún lo referencian.
    db.flush()
    for sesion in vacias:
        db.delete(sesion)
    db.delete(slot)
    db.commit()


@router.post("/{rutina_id}/slots/{slot_id}/mostrar", response_model=RutinaSlotOut)
def mostrar_slot(
    rutina_id: int,
    slot_id: int,
    db: Session = Depends(get_db),
):
    """Deshace un `modo=ocultar`: el hueco vuelve a su rutina, en el mismo sitio."""
    slot = _obtener_slot_modificable(db, rutina_id, slot_id, admitir_oculto=True)
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
    _obtener_slot_legible(db, rutina_id, slot_id)
    filtro = Serie.slot_id == slot_id
    if ejercicio_id is not None:
        # Legible y no visible: un ejercicio ocultado sigue teniendo historial.
        obtener_ejercicio_legible(db, ejercicio_id)
        filtro = and_(filtro, Serie.ejercicio_id == ejercicio_id)
    return sesiones_con_series(db, filtro, desde, hasta, limite)
