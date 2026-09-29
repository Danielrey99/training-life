from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.fechas import hoy
from app.models import ExcepcionDelPlan, Programa, ProgramaDia, ProgramaPeriodo
from app.ocultos import exigir_visible
from app.routers.rutinas import obtener_rutina_visible
from app.schemas import (
    ActivarPrograma,
    PeriodoOut,
    ProgramaCreate,
    ProgramaDiaUpdate,
    ProgramaOut,
    ProgramaUpdate,
)

router = APIRouter(prefix="/programas", tags=["programas"])

DiaDeLaRuta = Path(ge=1, le=7, description="1 = lunes … 7 = domingo")


def _obtener_programa_legible(db: Session, programa_id: int, usuario_id: int) -> Programa:
    """Para leer: 404 si no existe o no es tuyo. Admite los ocultos."""
    programa = db.get(Programa, programa_id)
    if programa is None or programa.usuario_id != usuario_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Programa no encontrado")
    return programa


def _obtener_programa_propio(
    db: Session, programa_id: int, usuario_id: int, admitir_oculto: bool = False
) -> Programa:
    """Para modificar: 404 si no existe, 403 si no es tuyo y 409 si está oculto,
    salvo con `admitir_oculto`, que es para borrarlo o volver a mostrarlo.
    """
    programa = db.get(Programa, programa_id)
    if programa is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Programa no encontrado")
    if programa.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede modificar un programa que no es tuyo",
        )
    if not admitir_oculto:
        exigir_visible(programa, "Este programa está oculto: muéstralo antes de cambiarlo.")
    return programa


# --- Periodos: qué programa está activo -----------------------------------
#
# Un periodo cubre de `desde` a `hasta` sin incluir `hasta`: al cambiar de
# programa, el que se va cierra con `hasta` = hoy y el que llega abre con
# `desde` = hoy, así que hoy le toca al nuevo y no se solapan.


def _cerrar_periodo_abierto(db: Session, usuario_id: int) -> None:
    """Deja al usuario sin programa activo.

    Si el periodo empezó hoy, no llegó a cubrir ningún día: se borra en vez de
    cerrarse, para que activar y desactivar el mismo día no deje rastro.
    """
    periodo = db.scalar(
        select(ProgramaPeriodo).where(
            ProgramaPeriodo.usuario_id == usuario_id, ProgramaPeriodo.hasta.is_(None)
        )
    )
    if periodo is None:
        return
    if periodo.desde == hoy():
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
    _cerrar_periodo_abierto(db, programa.usuario_id)
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
        db.add(
            ProgramaPeriodo(programa_id=programa.id, usuario_id=programa.usuario_id, desde=hoy())
        )


@router.get("", response_model=list[ProgramaOut])
def listar_programas(
    ocultos: bool = False,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Los programas visibles del usuario o, con `ocultos=true`, los que ha ocultado."""
    filtro = Programa.oculto_desde.is_not(None) if ocultos else Programa.oculto_desde.is_(None)
    stmt = select(Programa).where(Programa.usuario_id == usuario_id, filtro)
    return db.scalars(stmt.order_by(Programa.nombre)).all()


@router.get("/{programa_id}", response_model=ProgramaOut)
def obtener_programa(
    programa_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    return _obtener_programa_legible(db, programa_id, usuario_id)


@router.post("", response_model=ProgramaOut, status_code=status.HTTP_201_CREATED)
def crear_programa(
    datos: ProgramaCreate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Crea el programa con sus días en una sola transacción: o se guarda todo, o
    nada. Cada rutina tiene que ser tuya y estar visible.
    """
    for dia in datos.dias:
        obtener_rutina_visible(db, dia.rutina_id, usuario_id)
    programa = Programa(usuario_id=usuario_id, nombre=datos.nombre)
    programa.dias = [
        ProgramaDia(dia_semana=dia.dia_semana, rutina_id=dia.rutina_id) for dia in datos.dias
    ]
    db.add(programa)
    if datos.activar:
        db.flush()  # para que el programa tenga id antes de abrirle un periodo
        _activar(db, programa)
    db.commit()
    db.refresh(programa)
    return programa


@router.put("/{programa_id}", response_model=ProgramaOut)
def actualizar_programa(
    programa_id: int,
    datos: ProgramaUpdate,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    programa = _obtener_programa_propio(db, programa_id, usuario_id)
    programa.nombre = datos.nombre
    db.commit()
    db.refresh(programa)
    return programa


@router.post("/{programa_id}/activar", response_model=ProgramaOut)
def activar_programa(
    programa_id: int,
    datos: ActivarPrograma | None = None,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Lo pone en uso: es el que dirá qué toca hoy. El que estuviera activo deja
    de estarlo, en la misma transacción. Un programa oculto no se puede activar.

    Con `quitar_excepciones`, borra además los días cambiados a mano de hoy en
    adelante, que se planificaron pensando en el programa anterior. Los pasados
    se quedan: dicen qué tocaba entonces.
    """
    programa = _obtener_programa_propio(db, programa_id, usuario_id)
    _activar(db, programa)
    if datos is not None and datos.quitar_excepciones:
        db.execute(
            delete(ExcepcionDelPlan).where(
                ExcepcionDelPlan.usuario_id == usuario_id, ExcepcionDelPlan.fecha >= hoy()
            )
        )
    db.commit()
    db.refresh(programa)
    return programa


@router.post("/{programa_id}/desactivar", response_model=ProgramaOut)
def desactivar_programa(
    programa_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Lo saca de uso y deja al usuario sin programa activo. Si no estaba activo,
    no hace nada.
    """
    programa = _obtener_programa_propio(db, programa_id, usuario_id, admitir_oculto=True)
    if programa.activo:
        _cerrar_periodo_abierto(db, usuario_id)
        db.commit()
        db.refresh(programa)
    return programa


@router.post("/{programa_id}/mostrar", response_model=ProgramaOut)
def mostrar_programa(
    programa_id: int,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Deshace un `modo=ocultar`. No lo vuelve a activar aunque lo estuviera:
    qué programa está en uso se decide activándolo.
    """
    programa = _obtener_programa_propio(db, programa_id, usuario_id, admitir_oculto=True)
    programa.oculto_desde = None
    db.commit()
    db.refresh(programa)
    return programa


@router.delete("/{programa_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_programa(
    programa_id: int,
    modo: Literal["ocultar", "definitivo"] | None = None,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Borra un programa propio.

    Aquí el historial que hay que proteger son sus **periodos**: sin ellos, el
    calendario ya no sabe qué tocaba los días en que estuvo activo. Las sesiones
    no dependen del programa y nunca se tocan.

    - Si nunca estuvo activo, se borra directamente.
    - Si lo estuvo, hace falta `modo=ocultar` (conserva todo; si era el activo,
      deja de serlo) o `modo=definitivo` (se van también sus días y periodos).
    """
    programa = _obtener_programa_propio(db, programa_id, usuario_id, admitir_oculto=True)

    if modo == "ocultar":
        if programa.activo:
            _cerrar_periodo_abierto(db, usuario_id)
        # Si ya estaba oculto, se conserva desde cuándo.
        if programa.oculto_desde is None:
            programa.oculto_desde = hoy()
        db.commit()
        return

    if programa.periodos and modo != "definitivo":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "mensaje": (
                    "Este programa ha estado activo. Si lo borras, el calendario dejará de "
                    "saber qué tocaba esos días (tus sesiones no se tocan). Repite la "
                    "petición con ?modo=ocultar (conserva todo) o ?modo=definitivo."
                ),
                "periodos": [
                    PeriodoOut.model_validate(periodo).model_dump(mode="json")
                    for periodo in programa.periodos
                ],
            },
        )

    # Días y periodos se van con el programa. Los periodos ya están cargados
    # (se han leído arriba para decidir si pedir modo), y con la lista cargada
    # passive_deletes no basta: los borra el cascade="all, delete-orphan" de la
    # relación; los que no estuvieran cargados, el ON DELETE CASCADE.
    db.delete(programa)
    db.commit()


# --- Días del programa ---------------------------------------------------


@router.put("/{programa_id}/dias/{dia_semana}", response_model=ProgramaOut)
def poner_rutina_en_dia(
    programa_id: int,
    datos: ProgramaDiaUpdate,
    dia_semana: int = DiaDeLaRuta,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Pone una rutina en un día. Si el día ya tenía una (también si estaba
    oculta), la nueva la sustituye: un día, una rutina.
    """
    programa = _obtener_programa_propio(db, programa_id, usuario_id)
    obtener_rutina_visible(db, datos.rutina_id, usuario_id)
    # Se busca antes y se actualiza, en vez de insertar y dejar que la unicidad
    # de programa y día salte en la base de datos con un error crudo.
    dia = db.scalar(
        select(ProgramaDia).where(
            ProgramaDia.programa_id == programa_id, ProgramaDia.dia_semana == dia_semana
        )
    )
    if dia is None:
        db.add(
            ProgramaDia(programa_id=programa_id, dia_semana=dia_semana, rutina_id=datos.rutina_id)
        )
    else:
        dia.rutina_id = datos.rutina_id
    db.commit()
    db.refresh(programa)
    return programa


@router.delete("/{programa_id}/dias/{dia_semana}", status_code=status.HTTP_204_NO_CONTENT)
def quitar_rutina_de_dia(
    programa_id: int,
    dia_semana: int = DiaDeLaRuta,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Deja el día en descanso."""
    _obtener_programa_propio(db, programa_id, usuario_id)
    dia = db.scalar(
        select(ProgramaDia).where(
            ProgramaDia.programa_id == programa_id, ProgramaDia.dia_semana == dia_semana
        )
    )
    if dia is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ese día ya es de descanso"
        )
    db.delete(dia)
    db.commit()
