from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.fechas import hoy
from app.models import Entrenamiento, Rutina, RutinaSlot, Serie
from app.plan import DiaPlan, dias_del_plan
from app.routers.ejercicios import obtener_ejercicio_del_usuario, obtener_ejercicio_visible
from app.schemas import (
    EntrenamientoCreate,
    EntrenamientoOut,
    EntrenamientoUpdate,
    SerieCreate,
    SerieOut,
    SerieUpdate,
)
from app.seguimiento import cuenta, esta_cancelada, plazo

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


def _validar_fecha_no_futura(fecha: date) -> None:
    """Se registra lo que se entrenó, no lo que se va a entrenar: el futuro se
    planifica (`/plan`), no se apunta. Y una sesión del futuro sin terminar
    pasaría sola a estar en curso al llegar su día, sin que nadie la empezara.
    """
    if fecha > hoy():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El {fecha} todavía no ha llegado: solo se registran días de hoy hacia atrás.",
        )


def _validar_dia_libre(
    db: Session, usuario_id: int, fecha: date, excepto_id: int | None = None
) -> None:
    """Una sesión por día como mucho, del tipo que sea: se entrena una rutina al
    día. Lo garantiza también la base de datos; esto es para dar un 409 que diga
    cuál es la otra sesión (la pantalla de hoy lo usa para ofrecer *Continuar*) y
    si está en curso.

    Una sesión sin ninguna serie que ya no está en curso cuenta como cancelada:
    no se hizo nada. Si es la que ocupa el día, se borra y el día queda libre.
    """
    stmt = select(Entrenamiento).where(
        Entrenamiento.usuario_id == usuario_id, Entrenamiento.fecha == fecha
    )
    if excepto_id is not None:
        stmt = stmt.where(Entrenamiento.id != excepto_id)
    otra = db.scalar(stmt)
    if otra is None:
        return
    if esta_cancelada(otra):
        db.delete(otra)
        # Antes que el INSERT o el UPDATE de la otra, o chocarían en la unicidad.
        db.flush()
        return
    mensaje = (
        "Ya hay una sesión en curso hoy. Termínala o cancélala antes de empezar otra."
        if otra.en_curso
        else "Ese día ya tiene una sesión, y se entrena una rutina al día. Para usarlo, cambia"
        " antes la fecha de la otra desde su día en el historial."
    )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"mensaje": mensaje, "entrenamiento_id": otra.id, "en_curso": otra.en_curso},
    )


def _validar_en_plazo(fecha: date, cubre: date) -> None:
    """Lo de un día se entrena dentro de su plazo (ver `plazo`), tanto al crear la
    sesión como al corregir su fecha después.
    """
    desde, hasta = plazo(cubre)
    if not desde <= fecha <= hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Lo del {cubre} solo se puede entrenar del {desde} al {hasta}: se adelanta"
                " dentro de su semana y se recupera hasta el día antes del mismo día de la"
                " semana siguiente."
            ),
        )


def _validar_cubre_fecha(db: Session, usuario_id: int, datos: EntrenamientoCreate) -> DiaPlan:
    """Comprueba que la sesión puede contar para el día que dice, y devuelve ese
    día del plan.

    Todo da 422, porque es un error de quien llama: una sesión libre no cuenta para
    ningún día, un día fuera de plazo no se puede ni recuperar ni adelantar, y un
    día que no toca esa rutina no se cubre con ella. Lo faltado con un programa
    que ya no está activo tampoco se recupera: la fecha de la sesión y el día que
    cuenta tienen que caer en el mismo programa.
    """
    fecha, cubre = datos.fecha, datos.cubre_fecha
    if datos.rutina_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Un entrenamiento libre no cuenta para ningún día del plan.",
        )
    _validar_en_plazo(fecha, cubre)
    plan = {
        dia.fecha: dia
        for dia in dias_del_plan(db, usuario_id, min(fecha, cubre), max(fecha, cubre))
    }
    dia = plan[cubre]
    if dia.descanso or dia.rutina.id != datos.rutina_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El {cubre} no toca esa rutina.",
        )
    if dia.programa_id != plan[fecha].programa_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"El {cubre} lo planificaba otro programa: lo que tocaba con un programa que ya"
                " no está activo no se recupera."
            ),
        )
    return dia


def _dejar_sitio_en(db: Session, usuario_id: int, dia: DiaPlan) -> None:
    """Un día del plan lo cuenta una sesión como mucho.

    Si ya lo cuenta otra, 409 con su id. Si lo retiene una que no lo cuenta, lo
    suelta: la cancelada se borra, como en `_validar_dia_libre`, y la de una rutina
    que ese día ya no toca se queda en el historial sin contar para ningún día.
    """
    cubre = dia.fecha
    otra = db.scalar(
        select(Entrenamiento).where(
            Entrenamiento.usuario_id == usuario_id, Entrenamiento.cubre_fecha == cubre
        )
    )
    if otra is None:
        return
    if cuenta(otra, dia):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "mensaje": f"Lo del {cubre} ya está hecho: lo cuenta la sesión del {otra.fecha}.",
                "entrenamiento_id": otra.id,
            },
        )
    if esta_cancelada(otra):
        db.delete(otra)
    else:
        otra.cubre_fecha = None
    # Antes del INSERT de la nueva, o chocaría con la otra en la unicidad.
    db.flush()


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
    """404 tanto si no existe como si es de otro usuario, como el resto de los GET:
    un 403 confirmaría que ese id existe.
    """
    entrenamiento = db.get(Entrenamiento, entrenamiento_id)
    if entrenamiento is None or entrenamiento.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entrenamiento no encontrado"
        )
    return entrenamiento


@router.post("", response_model=EntrenamientoOut, status_code=status.HTTP_201_CREATED)
def crear_entrenamiento(
    datos: EntrenamientoCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Crea la sesión "vacía" (sin series todavía) — se añaden aparte, con
    POST /entrenamientos/{id}/series. rutina_id es opcional (entrenamiento libre).

    `cubre_fecha` es el día del plan que cuenta: el de hoy al empezar lo que toca,
    uno pasado al recuperar o uno de esta semana al adelantar. Sin él, la sesión
    queda en el historial pero no cuenta para ningún día.
    """
    _validar_fecha_no_futura(datos.fecha)
    if datos.rutina_id is not None:
        _validar_rutina_propia(db, datos.rutina_id, usuario_id)
    # Primero todo lo que es un error de la petición (422), haya lo que haya en la
    # base; después lo que choca con otras sesiones, que puede borrar las canceladas.
    dia = _validar_cubre_fecha(db, usuario_id, datos) if datos.cubre_fecha else None
    _validar_dia_libre(db, usuario_id, datos.fecha)
    if dia is not None:
        _dejar_sitio_en(db, usuario_id, dia)
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
    _validar_fecha_no_futura(datos.fecha)
    # El día que cuenta no cambia al corregir la fecha: la sesión sigue siendo "la
    # del lunes", así que solo se mueve dentro del plazo de ese día.
    if datos.fecha != entrenamiento.fecha and entrenamiento.cubre_fecha is not None:
        _validar_en_plazo(datos.fecha, entrenamiento.cubre_fecha)
    # La rutina solo se valida si cambia: una sesión de una rutina que se ocultó
    # después tiene que poder corregirse (notas, fecha) sin mostrarla antes.
    if datos.rutina_id is not None and datos.rutina_id != entrenamiento.rutina_id:
        _validar_rutina_propia(db, datos.rutina_id, usuario_id)
    if datos.rutina_id != entrenamiento.rutina_id:
        if entrenamiento.cubre_fecha is not None:
            # Con otra rutina ya no contaría su día, y recalcular cuál contaría abre
            # más casos de los que resuelve. Se borra el día y se apunta la buena.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Esta sesión cuenta como lo del {entrenamiento.cubre_fecha}: no se le cambia"
                    " la rutina. Para apuntar otra, borra el día y regístralo de nuevo."
                ),
            )
        _validar_cambio_de_rutina(db, entrenamiento_id)
    if datos.fecha != entrenamiento.fecha:
        _validar_dia_libre(db, usuario_id, datos.fecha, excepto_id=entrenamiento_id)
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


def _validar_slot(
    db: Session,
    slot_id: int,
    rutina_id: int | None,
    ejercicio_id: int,
    actual: tuple[int | None, int] | None = None,
) -> None:
    """El slot_id de una serie, si se manda, tiene que ser un hueco real de
    la rutina de ese entrenamiento — no tiene sentido en un entrenamiento libre
    (422: son datos incoherentes, no un conflicto con el estado).

    No puede estar oculto: lo oculto deja de ofrecerse, así que para elegirlo es
    como si no existiera (404). Y el ejercicio tiene que ser el principal del
    hueco o uno de sus comodines (422): si no, el historial del hueco mezclaría
    ejercicios que no son suyos.

    `actual` es el (hueco, ejercicio) que la serie ya tenía, al editarla:
    corregir lo que ya se apuntó no es elegir nada nuevo, así que el hueco puede
    estar oculto y el ejercicio haber dejado de ser comodín.
    """
    if rutina_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Este entrenamiento es libre (sin rutina): no puede tener slot_id",
        )
    slot = db.get(RutinaSlot, slot_id)
    oculto_y_nuevo = slot is not None and slot.oculto and (actual is None or slot_id != actual[0])
    if slot is None or slot.rutina_id != rutina_id or oculto_y_nuevo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe ningún hueco con id {slot_id} en la rutina de este entrenamiento",
        )
    if actual == (slot_id, ejercicio_id):
        return
    ejercicios_del_hueco = {slot.ejercicio_principal_id} | {
        comodin.id for comodin in slot.alternativas
    }
    if ejercicio_id not in ejercicios_del_hueco:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ese ejercicio no es ni el principal ni un comodín de este hueco",
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
        _validar_slot(db, datos.slot_id, entrenamiento.rutina_id, datos.ejercicio_id)
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
    # Corregir lo que ya se apuntó no es elegir nada nuevo: si el ejercicio no
    # cambia, basta con que sea legible (puede estar oculto). Si cambia por otro,
    # ese otro tiene que estar visible, como al apuntar una serie nueva.
    if datos.ejercicio_id == serie.ejercicio_id:
        obtener_ejercicio_del_usuario(db, datos.ejercicio_id, usuario_id)
    else:
        obtener_ejercicio_visible(db, datos.ejercicio_id, usuario_id)
    if datos.slot_id is not None:
        _validar_slot(
            db,
            datos.slot_id,
            entrenamiento.rutina_id,
            datos.ejercicio_id,
            actual=(serie.slot_id, serie.ejercicio_id),
        )
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
