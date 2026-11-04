from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.ediciones import CAMPOS_DE_SERIE, cambios_de_series, mezcla_en_hueco, motivo_de_la_fecha
from app.fechas import fecha_en_texto, hoy
from app.medidas import validar_medidas
from app.models import Ejercicio, Entrenamiento, RutinaSlot, Serie
from app.plan import DiaPlan, dias_del_plan
from app.routers.ejercicios import obtener_ejercicio_legible, obtener_ejercicio_visible
from app.routers.rutinas import obtener_rutina_visible
from app.schemas import (
    EntrenamientoCreate,
    EntrenamientoOut,
    EntrenamientoUpdate,
    SerieCreate,
    SerieDelDia,
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sesión no encontrada")
    return entrenamiento


def _validar_fecha_no_futura(fecha: date) -> None:
    """Se registra lo que se entrenó, no lo que se va a entrenar: el futuro se
    planifica (`/plan`), no se apunta. Y una sesión del futuro sin terminar
    pasaría sola a estar en curso al llegar su día, sin que nadie la empezara.
    """
    if fecha > hoy():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"El {fecha_en_texto(fecha)} todavía no ha llegado. Solo se apuntan días de"
                " hoy hacia atrás."
            ),
        )


def _validar_dia_libre(
    db: Session, fecha: date, excepto_id: int | None = None, moviendo: bool = False
) -> None:
    """Una sesión por día como mucho, sea de la rutina que sea: se entrena una rutina al
    día. Lo garantiza también la base de datos; esto es para dar un 409 que diga
    cuál es la otra sesión (la pantalla de hoy lo usa para ofrecer *Continuar*) y
    si está en curso.

    Una sesión sin ninguna serie que ya no está en curso cuenta como cancelada:
    no se hizo nada. Si es la que ocupa el día, se borra y el día queda libre.

    `moviendo`: se está cambiando la fecha de un día del historial. El aviso habla de
    ese día y va marcado como de la fecha (`campo`), para enseñarlo bajo ella.
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
    detalle = {"entrenamiento_id": otra.id, "en_curso": otra.en_curso}
    if moviendo and otra.en_curso:
        mensaje = (
            f"El {fecha_en_texto(fecha)} ya tiene una sesión empezada, y solo se hace una por"
            " día. Termínala o cancélala desde la pestaña Entrenar antes de mover esta."
        )
        detalle["campo"] = "fecha"
    elif moviendo:
        mensaje = (
            f"El {fecha_en_texto(fecha)} ya tiene una sesión, y solo se hace una por día. Para"
            " usar ese día, cambia antes la fecha de esa sesión desde su día en la pestaña"
            " Historial."
        )
        detalle["campo"] = "fecha"
    elif otra.en_curso:
        mensaje = "Ya hay una sesión en curso hoy. Termínala o cancélala antes de empezar otra."
    else:
        mensaje = (
            "Ese día ya tiene una sesión, y se entrena una rutina al día. Para usarlo, cambia"
            " antes la fecha de la otra desde su día en el historial."
        )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail={"mensaje": mensaje, **detalle}
    )


def _validar_en_plazo(fecha: date, cubre: date) -> None:
    """Lo de un día se entrena dentro de su plazo (ver `plazo`). Al corregir la fecha
    después, lo mismo lo comprueba `_validar_fecha_nueva`, con su propio aviso.
    """
    desde, hasta = plazo(cubre)
    if not desde <= fecha <= hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Lo del {fecha_en_texto(cubre)} solo se puede entrenar entre el"
                f" {fecha_en_texto(desde)} y el {fecha_en_texto(hasta)}. Se adelanta dentro"
                " de su semana y se recupera hasta el día antes del mismo día de la semana"
                " siguiente."
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
            detail=f"El {fecha_en_texto(cubre)} no toca esa rutina.",
        )
    _validar_mismo_programa(cubre, plan, fecha)
    return dia


def _validar_mismo_programa(cubre: date, plan: dict[date, DiaPlan], fecha: date) -> None:
    """La fecha de la sesión y el día que cuenta caen en el mismo programa (o los dos
    sin programa): lo que tocaba con un programa que ya no está activo no se recupera.
    Al corregir la fecha después, lo comprueba `_validar_fecha_nueva`.
    """
    if plan[cubre].programa_id != plan[fecha].programa_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"El {fecha_en_texto(cubre)} lo planificaba otro programa, y lo que tocaba con"
                " un programa que ya no está activo no se recupera."
            ),
        )


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
            f"El {fecha_en_texto(otro)} ya ha pasado. Solo se puede intercambiar con un día"
            " de hoy en adelante."
        )
    elif datos.cubre_fecha != datos.fecha:
        detalle = "Al intercambiar, la sesión cuenta como lo que toca hoy."
    else:
        [dia] = dias_del_plan(db, otro, otro)
        if not dia.descanso and dia.rutina.id == datos.rutina_id:
            return
        detalle = (
            f"El {fecha_en_texto(otro)} no toca esa rutina. Intercambiar trae a hoy lo que"
            " toca ese día."
        )
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
                "mensaje": (
                    f"Lo del {fecha_en_texto(cubre)} ya está hecho. Lo cuenta la sesión del"
                    f" {fecha_en_texto(otra.fecha)}."
                ),
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
    sin_terminar: bool = False,
    rutina_id: int | None = None,
    limite: int | None = Query(default=None, gt=0, le=500),
    db: Session = Depends(get_db),
):
    """Los entrenamientos, del más reciente al más antiguo.

    `desde` y `hasta` (incluidos) sirven para pedir una semana o un mes, y
    `rutina_id` con `limite`, las últimas sesiones de una rutina (el día del
    historial compara su volumen con el de la anterior).

    Con `sin_terminar=true`, las de días pasados que se quedaron sin terminar, con
    series o sin ellas: las que tienen series cuentan como hechas, pero quizá se
    dejaron a medias sin querer; las vacías (canceladas, `esta_cancelada`) quizá se
    abrieron para apuntar un día pasado y se olvidaron. La pantalla de hoy avisa de
    las dos.
    """
    if desde is not None and hasta is not None and desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Las fechas están al revés. El {fecha_en_texto(desde)} va después del"
                f" {fecha_en_texto(hasta)}."
            ),
        )
    stmt = select(Entrenamiento)
    if desde is not None:
        stmt = stmt.where(Entrenamiento.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(Entrenamiento.fecha <= hasta)
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


def _fallo_de_la_fecha(estado: int, mensaje: str) -> HTTPException:
    """Un fallo al mover la fecha de un día, marcado para enseñarlo bajo la fecha."""
    return HTTPException(status_code=estado, detail={"mensaje": mensaje, "campo": "fecha"})


def _validar_fecha_nueva(db: Session, entrenamiento: Entrenamiento, fecha: date) -> None:
    """La fecha nueva de una sesión: no del futuro, dentro del plazo del día que cuenta y
    en un día del mismo programa que él, como al crearla (422, bajo la fecha).

    El día que cuenta no cambia al corregir la fecha: la sesión sigue siendo "la del
    lunes". Una sesión que ya cruzaba programas (se adelantó un día y después se activó
    otro programa) se puede seguir corrigiendo: solo se valida lo que cambia.
    """
    if fecha > hoy():
        raise _fallo_de_la_fecha(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"El {fecha_en_texto(fecha)} todavía no ha llegado. Solo se apuntan días de hoy"
            " hacia atrás.",
        )
    cubre = entrenamiento.cubre_fecha
    if cubre is None:
        return
    desde, hasta = plazo(cubre)
    fechas = (fecha, entrenamiento.fecha, cubre)
    plan = {dia.fecha: dia for dia in dias_del_plan(db, min(fechas), max(fechas))}
    en_plazo = desde <= fecha <= hasta
    cruzaba = plan[entrenamiento.fecha].programa_id != plan[cubre].programa_id
    if not en_plazo or (not cruzaba and plan[fecha].programa_id != plan[cubre].programa_id):
        raise _fallo_de_la_fecha(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            motivo_de_la_fecha(entrenamiento.rutina.nombre, cubre, fecha, desde, hasta),
        )


def _validar_series_del_dia(
    db: Session, entrenamiento: Entrenamiento, pedidas: list[SerieDelDia]
) -> tuple[list[Serie], list[SerieDelDia], list[SerieDelDia]]:
    """Las series de un día como deben quedar: cada una nueva o cambiada se valida como
    al apuntarla o corregirla una a una, y la que llega igual no (corregir sí, elegir
    algo oculto no). Devuelve qué borrar, qué cambiar y qué crear.

    Un ejercicio por hueco: si en un hueco tocado quedan series de dos ejercicios, 422,
    y no el 409 de apuntar una suelta, porque el choque está dentro de lo que se manda.
    Así cambiar de ejercicio un hueco (quitar las de uno y poner las del otro) cabe en una
    sola petición.
    """
    guardadas = {serie.id: serie for serie in entrenamiento.series}
    a_borrar, a_cambiar, _, ajenas = cambios_de_series(
        {
            id_: {campo: getattr(serie, campo) for campo in CAMPOS_DE_SERIE}
            for id_, serie in guardadas.items()
        },
        [serie.model_dump() for serie in pedidas],
    )
    cambian = {serie["id"] for serie in a_cambiar}
    nuevas = [serie for serie in pedidas if serie.id is None]
    cambiadas = [serie for serie in pedidas if serie.id in cambian]
    tocados: set[int] = set()
    # En el orden en que llegan: el primer fallo es el de la primera serie que no vale.
    for serie in pedidas:
        if serie.id in ajenas:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Serie no encontrada")
        if serie.id is None:
            ejercicio = obtener_ejercicio_visible(db, serie.ejercicio_id)
            _validar_slot(db, serie.slot_id, entrenamiento.rutina_id, serie.ejercicio_id)
            tocados.add(serie.slot_id)
        elif serie.id in cambian:
            antes = guardadas[serie.id]
            # Como al corregir una suelta: el mismo ejercicio basta con que sea legible.
            if serie.ejercicio_id == antes.ejercicio_id:
                ejercicio = obtener_ejercicio_legible(db, serie.ejercicio_id)
            else:
                ejercicio = obtener_ejercicio_visible(db, serie.ejercicio_id)
            _validar_slot(
                db,
                serie.slot_id,
                entrenamiento.rutina_id,
                serie.ejercicio_id,
                actual=(antes.slot_id, antes.ejercicio_id),
            )
            if (serie.slot_id, serie.ejercicio_id) != (antes.slot_id, antes.ejercicio_id):
                tocados |= {serie.slot_id, antes.slot_id}
        else:
            continue
        _validar_medidas_de_la_serie(ejercicio, SerieCreate(**serie.model_dump(exclude={"id"})))
    finales = [
        (serie.slot_id, serie.ejercicio_id)
        for serie in guardadas.values()
        if serie.id not in a_borrar and serie.id not in cambian
    ] + [(serie.slot_id, serie.ejercicio_id) for serie in cambiadas + nuevas]
    mezcla = mezcla_en_hueco(finales, tocados)
    if mezcla is not None:
        uno, otro = (db.get(Ejercicio, id_).nombre for id_ in mezcla)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"En un mismo ejercicio de la rutina hay series de «{uno}» y de «{otro}», y en"
                " cada uno se hace un solo ejercicio por sesión. Deja solo las de uno."
            ),
        )
    return [guardadas[id_] for id_ in a_borrar], cambiadas, nuevas


@router.put("/{entrenamiento_id}", response_model=EntrenamientoOut)
def actualizar_entrenamiento(
    entrenamiento_id: int,
    datos: EntrenamientoUpdate,
    db: Session = Depends(get_db),
):
    """El *Guardar* de un día del historial: la fecha, la nota y, si llegan, todas las
    series como deben quedar, en una sola transacción. Todo se valida antes de escribir
    (la sesión, la fecha, cada serie y, lo último, que el día nuevo esté libre), así que
    o se guarda todo o nada. Sin `series`, solo la fecha y la nota: la nota de la sesión
    en curso.

    La rutina y el día que cuenta se fijan al crear la sesión: para apuntar otra rutina
    se borra el día y se registra de nuevo. Quitar todas las series no borra la sesión:
    lo decide quien llama, con `DELETE`.
    """
    entrenamiento = _obtener_entrenamiento(db, entrenamiento_id)
    mueve = datos.fecha != entrenamiento.fecha
    if mueve:
        _validar_fecha_nueva(db, entrenamiento, datos.fecha)
    if datos.series is not None:
        a_borrar, cambiadas, nuevas = _validar_series_del_dia(db, entrenamiento, datos.series)
    if mueve:
        # Lo último: puede borrar una sesión cancelada que ocupe el día nuevo.
        _validar_dia_libre(db, datos.fecha, excepto_id=entrenamiento_id, moviendo=True)
    entrenamiento.fecha = datos.fecha
    entrenamiento.notas = datos.notas
    if datos.series is not None:
        for serie in a_borrar:
            entrenamiento.series.remove(serie)
        guardadas = {serie.id: serie for serie in entrenamiento.series}
        for serie in cambiadas:
            for campo, valor in serie.model_dump(exclude={"id"}).items():
                setattr(guardadas[serie.id], campo, valor)
        for serie in nuevas:
            entrenamiento.series.append(Serie(**serie.model_dump(exclude={"id"})))
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
            detail="Ese ejercicio no está en la rutina de esta sesión.",
        )
    if actual == (slot_id, ejercicio_id):
        return
    ejercicios_del_hueco = {slot.ejercicio_principal_id} | {
        comodin.id for comodin in slot.alternativas
    }
    if ejercicio_id not in ejercicios_del_hueco:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ese ejercicio no es ni el de la rutina ni una de sus alternativas.",
        )


def _validar_medidas_de_la_serie(ejercicio: Ejercicio, datos: SerieCreate | SerieUpdate) -> None:
    """Las medidas de la serie tienen que ser las que pide el tipo de su ejercicio (422):
    una plancha no lleva repeticiones ni un press banca, duración. En un `PUT`, el
    ejercicio es el final: cambiar de ejercicio exige las medidas del nuevo.
    """
    error = validar_medidas(ejercicio.nombre, ejercicio.tipo_registro, datos.model_dump())
    if error is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error)


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
    cuantas, esas = (
        ("la serie", "esa serie")
        if len(series) == 1
        else (f"las {len(series)} series", "esas series")
    )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Esta sesión ya tiene {cuantas} de «{anterior.nombre}» en ese ejercicio de la rutina, "
            f"y en cada uno se hace un solo ejercicio por sesión. Borra antes {esas} "
            f"para apuntar «{nuevo.nombre}»."
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
    ejercicio = obtener_ejercicio_visible(db, datos.ejercicio_id)
    _validar_slot(db, datos.slot_id, entrenamiento.rutina_id, datos.ejercicio_id)
    _validar_medidas_de_la_serie(ejercicio, datos)
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
        ejercicio = obtener_ejercicio_legible(db, datos.ejercicio_id)
    else:
        ejercicio = obtener_ejercicio_visible(db, datos.ejercicio_id)
    _validar_slot(
        db,
        datos.slot_id,
        entrenamiento.rutina_id,
        datos.ejercicio_id,
        actual=(serie.slot_id, serie.ejercicio_id),
    )
    _validar_medidas_de_la_serie(ejercicio, datos)
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


@router.delete("/{entrenamiento_id}/series", status_code=status.HTTP_204_NO_CONTENT)
def borrar_series_del_hueco(
    entrenamiento_id: int,
    slot_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Borra de una vez todas las series de la sesión en un hueco: cambiar de ejercicio
    en la sesión en curso, todo o nada. Un hueco oculto vale: es quitar lo apuntado, no
    elegir nada. No borra la sesión aunque se quede vacía.

    `slot_id` es obligatorio: sin él, esto borraría todas las series del día.
    """
    entrenamiento = _obtener_entrenamiento(db, entrenamiento_id)
    slot = db.get(RutinaSlot, slot_id)
    if slot is None or slot.rutina_id != entrenamiento.rutina_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese ejercicio no está en la rutina de esta sesión.",
        )
    for serie in [serie for serie in entrenamiento.series if serie.slot_id == slot_id]:
        entrenamiento.series.remove(serie)
    db.commit()


@router.delete("/{entrenamiento_id}/series/{serie_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_serie(
    entrenamiento_id: int,
    serie_id: int,
    db: Session = Depends(get_db),
):
    serie = _obtener_serie(db, entrenamiento_id, serie_id)
    db.delete(serie)
    db.commit()
