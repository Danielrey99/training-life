from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.fechas import hoy
from app.resumen import nombre_del_mes, resumen
from app.schemas import ResumenOut

router = APIRouter(prefix="/resumen", tags=["resumen"])


@router.get("", response_model=ResumenOut)
def obtener_resumen(
    # Años de 2000 a 2099: limita el formato y evita que restar meses a una fecha
    # extrema se salga del calendario de Python.
    mes: str | None = Query(default=None, pattern=r"^20\d{2}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """El resumen del mes `mes` (`2026-09`; sin él, el de hoy): las barras de
    volumen por semana y por mes (las terminadas y la en curso), cada una con su
    cambio y su desglose por rutina y por grupo muscular; y la constancia de su
    año. Las reglas de cada cifra, en `app/resumen.py`.

    Un mes que aún no ha empezado da 422: el resumen es de lo ya entrenado.
    """
    hoy_ = hoy()
    primero = date(int(mes[:4]), int(mes[5:]), 1) if mes else hoy_.replace(day=1)
    if primero > hoy_:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"{nombre_del_mes(primero)} todavía no ha llegado: el resumen es de lo ya"
                " entrenado."
            ),
        )
    return resumen(db, usuario_id, primero)
