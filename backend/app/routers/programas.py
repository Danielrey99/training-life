from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.models import Programa, ProgramaDia
from app.ocultos import exigir_visible
from app.routers.rutinas import obtener_rutina_visible
from app.schemas import ProgramaCreate, ProgramaDiaUpdate, ProgramaOut, ProgramaUpdate

router = APIRouter(prefix="/programas", tags=["programas"])

DiaDeLaRuta = Path(ge=1, le=7, description="1 = lunes … 7 = domingo")


def _obtener_programa_legible(db: Session, programa_id: int, usuario_id: int) -> Programa:
    """Para leer: 404 si no existe o no es tuyo. Admite los ocultos."""
    programa = db.get(Programa, programa_id)
    if programa is None or programa.usuario_id != usuario_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Programa no encontrado")
    return programa


def _obtener_programa_propio(db: Session, programa_id: int, usuario_id: int) -> Programa:
    """Para modificar: 404 si no existe, 403 si no es tuyo y 409 si está oculto."""
    programa = db.get(Programa, programa_id)
    if programa is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Programa no encontrado")
    if programa.usuario_id != usuario_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede modificar un programa que no es tuyo",
        )
    exigir_visible(programa, "Este programa está oculto: muéstralo antes de cambiarlo.")
    return programa


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
