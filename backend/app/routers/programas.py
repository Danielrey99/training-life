from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.ediciones import dias_que_cambian
from app.fechas import hoy
from app.models import ExcepcionDelPlan, Programa, ProgramaDia, ProgramaPeriodo
from app.nombres import clave_de_nombre
from app.ocultos import exigir_visible
from app.routers.rutinas import obtener_rutina_visible
from app.schemas import (
    ActivarPrograma,
    ProgramaCreate,
    ProgramaOut,
    ProgramaUpdate,
)
from app.seguimiento import seguimiento

router = APIRouter(prefix="/programas", tags=["programas"])


def _obtener_programa_legible(db: Session, programa_id: int) -> Programa:
    """Para leer: 404 si no existe. Admite los ocultos."""
    programa = db.get(Programa, programa_id)
    if programa is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Este programa ya no existe. Puede que lo hayas borrado.",
        )
    return programa


def _obtener_programa_modificable(
    db: Session, programa_id: int, admitir_oculto: bool = False
) -> Programa:
    """Para modificar: 404 si no existe y 409 si está oculto, salvo con `admitir_oculto`, que es para borrarlo o volver a mostrarlo."""
    programa = _obtener_programa_legible(db, programa_id)
    if not admitir_oculto:
        exigir_visible(programa, "Este programa está oculto. Muéstralo antes de cambiarlo.")
    return programa


# --- Periodos: qué programa está activo -----------------------------------
#
# Un periodo cubre de `desde` a `hasta` sin incluir `hasta`: al cambiar de
# programa, el que se va cierra con `hasta` = hoy y el que llega abre con
# `desde` = hoy, así que hoy le toca al nuevo y no se solapan.


def _quitar_excepciones_desde_hoy(db: Session) -> None:
    """Borra los días cambiados a mano de hoy en adelante, que se planificaron pensando
    en el programa anterior. Los pasados se quedan: dicen qué tocaba entonces.
    """
    db.execute(delete(ExcepcionDelPlan).where(ExcepcionDelPlan.fecha >= hoy()))


def _cerrar_periodo_abierto(db: Session) -> None:
    """Deja sin programa activo.

    Si el periodo empezó hoy, no llegó a cubrir ningún día: se borra en vez de
    cerrarse, para que activar y desactivar el mismo día no deje rastro. Lo mismo
    si empieza después de hoy (un reloj que fue hacia atrás): cerrarlo hoy dejaría
    un periodo que acaba antes de empezar, que la base rechaza.
    """
    periodo = db.scalar(select(ProgramaPeriodo).where(ProgramaPeriodo.hasta.is_(None)))
    if periodo is None:
        return
    if periodo.desde >= hoy():
        db.delete(periodo)
    else:
        periodo.hasta = hoy()
    # Antes de abrir otro: el índice único de periodos abiertos no admite dos a la
    # vez, y sin flush SQLAlchemy podría mandar primero el INSERT del nuevo.
    db.flush()


def _activar(db: Session, programa: Programa) -> None:
    """Pone el programa en uso y saca de uso al que lo estuviera. Activar el que
    ya está activo no hace nada.
    """
    if programa.activo:
        return
    _cerrar_periodo_abierto(db)
    # Si se desactivó hoy mismo, se reabre ese periodo en vez de empezar otro.
    ultimo = db.scalar(
        select(ProgramaPeriodo)
        .where(ProgramaPeriodo.programa_id == programa.id)
        .order_by(ProgramaPeriodo.desde.desc(), ProgramaPeriodo.id.desc())
        .limit(1)
    )
    if ultimo is not None and ultimo.hasta == hoy():
        ultimo.hasta = None
    else:
        db.add(ProgramaPeriodo(programa_id=programa.id, desde=hoy()))


@router.get("", response_model=list[ProgramaOut])
def listar_programas(
    ocultos: bool = False,
    db: Session = Depends(get_db),
):
    """Los programas visibles o, con `ocultos=true`, los ocultos."""
    filtro = Programa.oculto_desde.is_not(None) if ocultos else Programa.oculto_desde.is_(None)
    stmt = (
        select(Programa)
        .where(filtro)
        # De una vez para todos los programas, y no una consulta por programa al
        # serializar sus periodos y sus días.
        .options(
            selectinload(Programa.periodos),
            selectinload(Programa.filas_dias).selectinload(ProgramaDia.rutina),
        )
    )
    # Con el id detrás: dos con el mismo nombre salen siempre en el mismo orden.
    return db.scalars(stmt.order_by(Programa.nombre, Programa.id)).all()


@router.get("/{programa_id}", response_model=ProgramaOut)
def obtener_programa(
    programa_id: int,
    db: Session = Depends(get_db),
):
    return _obtener_programa_legible(db, programa_id)


def _validar_nombre_libre(db: Session, nombre: str) -> None:
    """Un programa nuevo o renombrado no puede llamarse como otro, sin distinguir
    mayúsculas, tildes ni espacios (decisión del autor, como con los ejercicios): dos
    programas iguales se confunden al elegir y en el historial.

    La base no lo impide, a propósito: un archivo importado puede traer dos que ya
    convivían, y tiene que poder cargarse.
    """
    clave = clave_de_nombre(nombre)
    iguales = [
        (otro_nombre, oculto_desde)
        for otro_nombre, oculto_desde in db.execute(select(Programa.nombre, Programa.oculto_desde))
        if clave_de_nombre(otro_nombre) == clave
    ]
    if not iguales:
        return
    # Si conviven varios con ese nombre, se nombra el visible, que es el que se encuentra.
    otro_nombre, oculto_desde = min(iguales, key=lambda igual: igual[1] is not None)
    if oculto_desde is None:
        detalle = f"Ya tienes un programa que se llama «{otro_nombre}». Elige otro nombre."
    else:
        detalle = (
            f"Ya tienes un programa oculto que se llama «{otro_nombre}». "
            "Muéstralo desde la pestaña Programas o elige otro nombre."
        )
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalle)


@router.post("", response_model=ProgramaOut, status_code=status.HTTP_201_CREATED)
def crear_programa(
    datos: ProgramaCreate,
    db: Session = Depends(get_db),
):
    """Crea el programa con sus días en una sola transacción: o se guarda todo, o
    nada. Cada rutina tiene que existir y estar visible. Con `activar` y
    `quitar_excepciones`, también quita los días cambiados a mano de hoy en adelante.
    """
    for dia in datos.dias:
        obtener_rutina_visible(db, dia.rutina_id)
    _validar_nombre_libre(db, datos.nombre)
    programa = Programa(nombre=datos.nombre)
    # Todavía no ha gobernado ningún día: sus filas valen desde siempre.
    programa.filas_dias = [
        ProgramaDia(dia_semana=dia.dia_semana, rutina_id=dia.rutina_id) for dia in datos.dias
    ]
    db.add(programa)
    if datos.activar:
        db.flush()  # para que el programa tenga id antes de abrirle un periodo
        _activar(db, programa)
        if datos.quitar_excepciones:
            _quitar_excepciones_desde_hoy(db)
    db.commit()
    db.refresh(programa)
    return programa


@router.put("/{programa_id}", response_model=ProgramaOut)
def actualizar_programa(
    programa_id: int,
    datos: ProgramaUpdate,
    db: Session = Depends(get_db),
):
    """El *Guardar* de la semana editando: el nombre y, si llegan, los días, en una
    sola transacción. Todo se valida antes de escribir, así que o se guarda todo o
    nada. Solo se valida lo que cambia: un día que llega igual vale aunque su rutina
    esté oculta.
    """
    programa = _obtener_programa_modificable(db, programa_id)
    cambian = []
    if datos.dias is not None:
        cambian = dias_que_cambian(
            {fila.dia_semana: fila.rutina_id for fila in programa.dias},
            {dia.dia_semana: dia.rutina_id for dia in datos.dias},
        )
        for _, rutina_id in cambian:
            if rutina_id is not None:
                obtener_rutina_visible(db, rutina_id)
    # Solo si cambia de verdad, como en las rutinas.
    if clave_de_nombre(datos.nombre) != clave_de_nombre(programa.nombre):
        _validar_nombre_libre(db, datos.nombre)
    programa.nombre = datos.nombre
    for dia_semana, rutina_id in cambian:
        _cambiar_dia(db, programa, dia_semana, rutina_id)
    db.commit()
    db.refresh(programa)
    return programa


@router.post("/{programa_id}/activar", response_model=ProgramaOut)
def activar_programa(
    programa_id: int,
    datos: ActivarPrograma | None = None,
    db: Session = Depends(get_db),
):
    """Lo pone en uso: es el que dirá qué toca hoy. El que estuviera activo deja
    de estarlo, en la misma transacción. Un programa oculto no se puede activar.

    Con `quitar_excepciones`, borra además los días cambiados a mano de hoy en
    adelante, que se planificaron pensando en el programa anterior. Los pasados
    se quedan: dicen qué tocaba entonces.
    """
    programa = _obtener_programa_modificable(db, programa_id)
    _activar(db, programa)
    if datos is not None and datos.quitar_excepciones:
        _quitar_excepciones_desde_hoy(db)
    db.commit()
    db.refresh(programa)
    return programa


@router.post("/{programa_id}/desactivar", response_model=ProgramaOut)
def desactivar_programa(
    programa_id: int,
    db: Session = Depends(get_db),
):
    """Lo saca de uso y deja sin programa activo. Si no estaba activo,
    no hace nada.
    """
    programa = _obtener_programa_modificable(db, programa_id, admitir_oculto=True)
    if programa.activo:
        _cerrar_periodo_abierto(db)
        db.commit()
        db.refresh(programa)
    return programa


@router.post("/{programa_id}/mostrar", response_model=ProgramaOut)
def mostrar_programa(
    programa_id: int,
    db: Session = Depends(get_db),
):
    """Deshace un `modo=ocultar`. No lo vuelve a activar aunque lo estuviera:
    qué programa está en uso se decide activándolo.
    """
    programa = _obtener_programa_modificable(db, programa_id, admitir_oculto=True)
    programa.oculto_desde = None
    db.commit()
    db.refresh(programa)
    return programa


@router.delete("/{programa_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_programa(
    programa_id: int,
    modo: Literal["ocultar", "definitivo"] | None = None,
    db: Session = Depends(get_db),
):
    """Borra un programa.

    Aquí el historial que hay que proteger son sus **periodos**: sin ellos, el
    calendario ya no sabe qué tocaba los días en que estuvo activo. Las sesiones
    no dependen del programa y nunca se tocan.

    - Si nunca estuvo activo, se borra directamente.
    - Si lo estuvo, hace falta `modo=ocultar` (conserva todo; si era el activo,
      deja de serlo) o `modo=definitivo` (se van también sus días y periodos).
    """
    programa = _obtener_programa_modificable(db, programa_id, admitir_oculto=True)

    if modo == "ocultar":
        if programa.activo:
            _cerrar_periodo_abierto(db)
        # Si ya estaba oculto, se conserva desde cuándo.
        if programa.oculto_desde is None:
            programa.oculto_desde = hoy()
        db.commit()
        return

    if programa.periodos and modo != "definitivo":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este programa ha estado activo. Repite la petición con ?modo=ocultar (conserva"
                " todo) o ?modo=definitivo (lo borra con sus días y periodos, sin poder"
                " deshacerlo)."
            ),
        )

    # Días y periodos se van con el programa. Los periodos ya están cargados
    # (se han leído arriba para decidir si pedir modo), y con la lista cargada
    # passive_deletes no basta: los borra el cascade="all, delete-orphan" de la
    # relación; los que no estuvieran cargados, el ON DELETE CASCADE.
    db.delete(programa)
    db.commit()


# --- Días del programa ---------------------------------------------------


def _desde_cuando_cambia(db: Session, programa: Programa, dia_semana: int) -> date:
    """Desde qué fecha vale un cambio en un día de la semana del programa: hoy, o
    el día siguiente a la próxima vez que toca, si esa ya se hizo por adelantado.

    Lo hecho por adelantado se queda como estaba: el Leg del viernes hecho el
    martes sigue contando aunque el viernes pase a ser Push, y el Push empieza el
    viernes siguiente. Solo si ese día lo planifica este programa: con una
    excepción de Planificar, el programa no decide lo que toca.
    """
    hoy_ = hoy()
    proximo = hoy_ + timedelta(days=(dia_semana - hoy_.isoweekday()) % 7)
    [dia] = seguimiento(db, proximo, proximo)
    contado = dia.cubierto_por is not None and dia.origen == "programa"
    if contado and dia.programa_id == programa.id:
        return proximo + timedelta(days=1)
    return hoy_


def _cambiar_dia(db: Session, programa: Programa, dia_semana: int, rutina_id: int | None) -> None:
    """Pone `rutina_id` en un día del programa (o lo deja en descanso, con None)
    sin reescribir el pasado: la fila que valía hasta ahora se cierra y se abre
    otra desde hoy (o desde después del día ya hecho por adelantado, ver
    `_desde_cuando_cambia`), así los días anteriores siguen resolviéndose con la vieja.

    Si el programa nunca ha estado activo antes de esa fecha, no hay pasado que
    conservar: se sustituye la fila sin más, y así editar un programa nuevo
    no va dejando filas cerradas que no dicen nada.

    Solo se llama con un día que cambia de verdad (`dias_que_cambian`).
    """
    filas = [fila for fila in programa.filas_dias if fila.dia_semana == dia_semana]
    desde = _desde_cuando_cambia(db, programa, dia_semana)
    gobierna_el_pasado = any(periodo.desde < desde for periodo in programa.periodos)
    for fila in filas:
        if not gobierna_el_pasado or (fila.desde is not None and fila.desde >= desde):
            # Nunca valió para un día pasado: se puede borrar.
            programa.filas_dias.remove(fila)
        elif fila.hasta is None or fila.hasta > desde:
            fila.hasta = desde
    # Antes de abrir la nueva: la unicidad de "una fila vigente por día" la
    # comprueba la base al insertar, y SQLAlchemy emite los DELETE después de los INSERT.
    db.flush()
    if rutina_id is not None:
        programa.filas_dias.append(
            ProgramaDia(
                dia_semana=dia_semana,
                rutina_id=rutina_id,
                desde=desde if gobierna_el_pasado else None,
            )
        )
