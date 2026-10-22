from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fechas import hoy
from app.models import Ejercicio, Entrenamiento, RutinaSlot, Serie
from app.plan import DiaPlan, dias_del_plan
from app.routers.ejercicios import obtener_ejercicio_legible, obtener_ejercicio_visible
from app.routers.rutinas import obtener_rutina_visible
from app.schemas import (
    EntrenamientoCreate,
    EntrenamientoOut,
    EntrenamientoUpdate,
    SerieCreate,
    SerieOut,
    SerieUpdate,
)
from app.seguimiento import cuenta, esta_cancelada, intercambiar, plazo

router = APIRouter(prefix="/entrenamientos", tags=["entrenamientos"])


# --- Entrenamientos ------------------------------------------------------


def _obtener_entrenamiento(db: Session, entrenamiento_id: int) -> Entrenamiento:
    """404 si no existe."""
    entrenamiento = db.get(Entrenamiento, entrenamiento_id)
    if entrenamiento is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entrenamiento no encontrado"
        )
    return entrenamiento


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


def _validar_dia_libre(db: Session, fecha: date, excepto_id: int | None = None) -> None:
    """Una sesión por día como mucho, sea de la rutina que sea: se entrena una rutina al
    día. Lo garantiza también la base de datos; esto es para dar un 409 que diga
    cuál es la otra sesión (la pantalla de hoy lo usa para ofrecer *Continuar*) y
    si está en curso.

    Una sesión sin ninguna serie que ya no está en curso cuenta como cancelada:
    no se hizo nada. Si es la que ocupa el día, se borra y el día queda libre.
    """
    stmt = select(Entrenamiento).where(Entrenamiento.fecha == fecha)
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


def _validar_cubre_fecha(db: Session, datos: EntrenamientoCreate) -> DiaPlan:
    """Comprueba que la sesión puede contar para el día que dice, y devuelve ese
    día del plan.

    Todo da 422, porque es un error de quien llama: un día fuera de plazo no se
    puede ni recuperar ni adelantar, y un día que no toca esa rutina no se cubre
    con ella. Lo faltado con un programa que ya no está activo tampoco se
    recupera: la fecha de la sesión y el día que cuenta tienen que caer en el
    mismo programa.
    """
    fecha, cubre = datos.fecha, datos.cubre_fecha
    _validar_en_plazo(fecha, cubre)
    plan = {dia.fecha: dia for dia in dias_del_plan(db, min(fecha, cubre), max(fecha, cubre))}
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


def _validar_intercambio(db: Session, datos: EntrenamientoCreate) -> None:
    """Empezar hoy lo que toca otro día (`intercambiar_con`): hoy y ese día
    intercambian lo que les toca antes de crear la sesión. Todo da 422: es un error de
    quien llama. Se mira antes de tocar el plan, para que un fallo no deje nada cambiado.
    """
    otro = datos.intercambiar_con
    if datos.fecha != hoy():
        detalle = "Solo se intercambia al empezar la sesión de hoy."
    elif otro == datos.fecha:
        detalle = "Para intercambiar hacen falta dos días distintos."
    elif otro < hoy():
        detalle = (
            f"El {otro} ya ha pasado: solo se puede intercambiar con un día de hoy en adelante."
        )
    elif datos.cubre_fecha != datos.fecha:
        detalle = (
            "Al intercambiar, la sesión cuenta como la de hoy: "
            f"cubre_fecha tiene que ser {datos.fecha}."
        )
    else:
        [dia] = dias_del_plan(db, otro, otro)
        if not dia.descanso and dia.rutina.id == datos.rutina_id:
            return
        detalle = f"El {otro} no toca esa rutina: intercambiar trae a hoy lo que toca ese día."
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detalle)


def _dejar_sitio_en(db: Session, dia: DiaPlan) -> None:
    """Un día del plan lo cuenta una sesión como mucho.

    Si ya lo cuenta otra, 409 con su id. Si lo retiene una que no lo cuenta, lo
    suelta: la cancelada se borra, como en `_validar_dia_libre`, y la de una rutina
    que ese día ya no toca se queda en el historial sin contar para ningún día.
    """
    cubre = dia.fecha
    otra = db.scalar(select(Entrenamiento).where(Entrenamiento.cubre_fecha == cubre))
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
    sin_terminar: bool = False,
    rutina_id: int | None = None,
    limite: int | None = Query(default=None, gt=0, le=500),
    db: Session = Depends(get_db),
):
    """Los entrenamientos, del más reciente al más antiguo.

    `desde` y `hasta` (incluidos) sirven para pedir una semana o un mes, y
    `rutina_id` con `limite`, las últimas sesiones de una rutina (el día del
    historial compara su volumen con el de la anterior). Con
    `en_curso=true` devuelve solo la sesión en curso, si la hay: una lista con uno
    o ningún elemento, que es lo que necesita la pantalla de hoy para ofrecer
    *Continuar* en vez de *Empezar*.

    Con `sin_terminar=true`, las de días pasados que se quedaron sin terminar, con
    series o sin ellas: las que tienen series cuentan como hechas, pero quizá se
    dejaron a medias sin querer; las vacías (canceladas, `esta_cancelada`) quizá se
    abrieron para apuntar un día pasado y se olvidaron. La pantalla de hoy avisa de
    las dos.
    """
    if desde is not None and hasta is not None and desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango de fechas está invertido: 'desde' ({desde}) es posterior a 'hasta' ({hasta}).",
        )
    stmt = select(Entrenamiento)
    if desde is not None:
        stmt = stmt.where(Entrenamiento.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(Entrenamiento.fecha <= hasta)
    if en_curso:
        stmt = stmt.where(Entrenamiento.fecha == hoy(), Entrenamiento.terminada_en.is_(None))
    if sin_terminar:
        stmt = stmt.where(Entrenamiento.fecha < hoy(), Entrenamiento.terminada_en.is_(None))
    if rutina_id is not None:
        stmt = stmt.where(Entrenamiento.rutina_id == rutina_id)
    stmt = stmt.order_by(Entrenamiento.fecha.desc(), Entrenamiento.id.desc()).limit(limite)
    return db.scalars(stmt).all()


@router.get("/{entrenamiento_id}", response_model=EntrenamientoOut)
def obtener_entrenamiento(
    entrenamiento_id: int,
    db: Session = Depends(get_db),
):
    return _obtener_entrenamiento(db, entrenamiento_id)


@router.post("", response_model=EntrenamientoOut, status_code=status.HTTP_201_CREATED)
def crear_entrenamiento(
    datos: EntrenamientoCreate,
    db: Session = Depends(get_db),
):
    """Crea la sesión "vacía" (sin series todavía) — se añaden aparte, con
    POST /entrenamientos/{id}/series.

    `cubre_fecha` es el día del plan que cuenta: el de hoy al empezar lo que toca,
    uno pasado al recuperar o uno de esta semana al adelantar. Sin él, la sesión
    queda en el historial pero no cuenta para ningún día.

    Con `intercambiar_con`, antes de crear la sesión intercambia lo que toca hoy con lo
    que toca ese día (*Intercambiar* y *Empezar* de la pantalla de hoy): todo o nada,
    en una sola transacción, así que un fallo no deja los días cambiados.
    """
    _validar_fecha_no_futura(datos.fecha)
    obtener_rutina_visible(db, datos.rutina_id)
    # Primero todo lo que es un error de la petición (422), haya lo que haya en la
    # base; después lo que choca con otras sesiones, que puede borrar las canceladas.
    if datos.intercambiar_con is not None:
        _validar_intercambio(db, datos)
        # Antes de tocar el plan: si hoy ya hay sesión, el plan se queda como está.
        _validar_dia_libre(db, datos.fecha)
        intercambiar(db, datos.fecha, datos.intercambiar_con)
    dia = _validar_cubre_fecha(db, datos) if datos.cubre_fecha else None
    _validar_dia_libre(db, datos.fecha)
    if dia is not None:
        _dejar_sitio_en(db, dia)
    entrenamiento = Entrenamiento(**datos.model_dump(exclude={"intercambiar_con"}))
    db.add(entrenamiento)
    db.commit()
    db.refresh(entrenamiento)
    return entrenamiento


@router.put("/{entrenamiento_id}", response_model=EntrenamientoOut)
def actualizar_entrenamiento(
    entrenamiento_id: int,
    datos: EntrenamientoUpdate,
    db: Session = Depends(get_db),
):
    """Corrige la fecha y las notas. La rutina y el día que cuenta se fijan al
    crear la sesión: para apuntar otra rutina se borra el día y se registra de nuevo.
    """
    entrenamiento = _obtener_entrenamiento(db, entrenamiento_id)
    _validar_fecha_no_futura(datos.fecha)
    if datos.fecha != entrenamiento.fecha:
        # El día que cuenta no cambia al corregir la fecha: la sesión sigue siendo "la
        # del lunes", así que solo se mueve dentro del plazo de ese día (422), y antes
        # que mirar si el día nuevo está ocupado (409).
        if entrenamiento.cubre_fecha is not None:
            _validar_en_plazo(datos.fecha, entrenamiento.cubre_fecha)
        _validar_dia_libre(db, datos.fecha, excepto_id=entrenamiento_id)
    for campo, valor in datos.model_dump().items():
        setattr(entrenamiento, campo, valor)
    db.commit()
    db.refresh(entrenamiento)
    return entrenamiento


@router.post("/{entrenamiento_id}/terminar", response_model=EntrenamientoOut)
def terminar_entrenamiento(
    entrenamiento_id: int,
    db: Session = Depends(get_db),
):
    """Da la sesión por terminada. Terminarla otra vez no hace nada: se conserva
    la hora de la primera, que es cuando de verdad se acabó.

    Terminada no significa cerrada: se le pueden seguir añadiendo o corrigiendo
    series, que es lo que hace la edición de un día ya pasado.
    """
    entrenamiento = _obtener_entrenamiento(db, entrenamiento_id)
    if entrenamiento.terminada_en is None:
        entrenamiento.terminada_en = datetime.now(timezone.utc)
        db.commit()
        db.refresh(entrenamiento)
    return entrenamiento


@router.delete("/{entrenamiento_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_entrenamiento(
    entrenamiento_id: int,
    db: Session = Depends(get_db),
):
    """Borra un entrenamiento, con todas sus series (se van con él,
    en cascada por FK). A diferencia de Ejercicio/Rutina/RutinaSlot, no tiene
    parámetro `modo`: nada más depende de un entrenamiento concreto, así que
    no hay nada que proteger con un aviso previo.
    """
    entrenamiento = _obtener_entrenamiento(db, entrenamiento_id)
    db.delete(entrenamiento)
    db.commit()


# --- Series --------------------------------------------------------------


def _obtener_serie(db: Session, entrenamiento_id: int, serie_id: int) -> Serie:
    _obtener_entrenamiento(db, entrenamiento_id)  # valida el entrenamiento
    serie = db.get(Serie, serie_id)
    if serie is None or serie.entrenamiento_id != entrenamiento_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Serie no encontrada")
    return serie


def _validar_slot(
    db: Session,
    slot_id: int,
    rutina_id: int,
    ejercicio_id: int,
    actual: tuple[int, int] | None = None,
) -> None:
    """El slot_id de una serie tiene que ser un hueco real de la rutina de ese
    entrenamiento.

    No puede estar oculto: lo oculto deja de ofrecerse, así que para elegirlo es
    como si no existiera (404). Y el ejercicio tiene que ser el principal del
    hueco o uno de sus comodines (422): si no, el historial del hueco mezclaría
    ejercicios que no son suyos.

    `actual` es el (hueco, ejercicio) que la serie ya tenía, al editarla:
    corregir lo que ya se apuntó no es elegir nada nuevo, así que el hueco puede
    estar oculto y el ejercicio haber dejado de ser comodín.
    """
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


def _validar_un_ejercicio_por_hueco(
    db: Session,
    entrenamiento_id: int,
    slot_id: int,
    ejercicio_id: int,
    excepto_serie_id: int | None = None,
) -> None:
    """En una sesión, cada hueco de la rutina se hace con un solo ejercicio.

    Si ya hay series de otro ejercicio en ese hueco, apuntar o mover una más de
    este mezclaría dos en el mismo (409): hay que borrar antes las otras. No va
    en la base de datos porque haría falta una restricción entre filas (un
    `EXCLUDE` o un trigger) que SQLite, la base del móvil, no tiene igual.

    `excepto_serie_id` deja fuera la serie que se está cambiando: si es la única
    del hueco, cambiarle el ejercicio no mezcla nada.
    """
    otras = select(Serie).where(
        Serie.entrenamiento_id == entrenamiento_id,
        Serie.slot_id == slot_id,
        Serie.ejercicio_id != ejercicio_id,
    )
    if excepto_serie_id is not None:
        otras = otras.where(Serie.id != excepto_serie_id)
    series = db.scalars(otras).all()
    if not series:
        return
    anterior = series[0].ejercicio
    nuevo = db.get(Ejercicio, ejercicio_id)
    cuantas = "la serie" if len(series) == 1 else f"las {len(series)} series"
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Esta sesión ya tiene {cuantas} de {anterior.nombre} en ese ejercicio de la rutina, "
            f"y en cada uno se hace un solo ejercicio por sesión: borra antes esas series "
            f"para apuntar {nuevo.nombre}."
        ),
    )


@router.post(
    "/{entrenamiento_id}/series", response_model=SerieOut, status_code=status.HTTP_201_CREATED
)
def crear_serie(
    entrenamiento_id: int,
    datos: SerieCreate,
    db: Session = Depends(get_db),
):
    entrenamiento = _obtener_entrenamiento(db, entrenamiento_id)
    obtener_ejercicio_visible(db, datos.ejercicio_id)
    _validar_slot(db, datos.slot_id, entrenamiento.rutina_id, datos.ejercicio_id)
    _validar_un_ejercicio_por_hueco(db, entrenamiento_id, datos.slot_id, datos.ejercicio_id)
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
):
    serie = _obtener_serie(db, entrenamiento_id, serie_id)
    entrenamiento = _obtener_entrenamiento(db, entrenamiento_id)
    # Corregir lo que ya se apuntó no es elegir nada nuevo: si el ejercicio no
    # cambia, basta con que sea legible (puede estar oculto). Si cambia por otro,
    # ese otro tiene que estar visible, como al apuntar una serie nueva.
    if datos.ejercicio_id == serie.ejercicio_id:
        obtener_ejercicio_legible(db, datos.ejercicio_id)
    else:
        obtener_ejercicio_visible(db, datos.ejercicio_id)
    _validar_slot(
        db,
        datos.slot_id,
        entrenamiento.rutina_id,
        datos.ejercicio_id,
        actual=(serie.slot_id, serie.ejercicio_id),
    )
    # Corregir peso, reps o variante no toca el par (hueco, ejercicio): solo si
    # cambia hay que mirar que no se mezcle con lo que ya hay en el hueco.
    if (datos.slot_id, datos.ejercicio_id) != (serie.slot_id, serie.ejercicio_id):
        _validar_un_ejercicio_por_hueco(
            db, entrenamiento_id, datos.slot_id, datos.ejercicio_id, excepto_serie_id=serie.id
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
):
    serie = _obtener_serie(db, entrenamiento_id, serie_id)
    db.delete(serie)
    db.commit()
