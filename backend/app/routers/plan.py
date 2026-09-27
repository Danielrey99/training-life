from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_usuario_actual_id
from app.database import get_db
from app.plan import dias_del_plan
from app.schemas import DiaPlanOut

router = APIRouter(prefix="/plan", tags=["plan"])


@router.get("", response_model=list[DiaPlanOut])
def obtener_plan(
    desde: date,
    hasta: date,
    db: Session = Depends(get_db),
    usuario_id: int = Depends(get_usuario_actual_id),
):
    """Qué toca cada día de `desde` a `hasta` (incluidos), según el programa que
    estaba activo ese día. Sirve igual para el pasado (el calendario) que para el
    futuro (los próximos días). Como mucho, 400 días de una vez.
    """
    return dias_del_plan(db, usuario_id, desde, hasta)
