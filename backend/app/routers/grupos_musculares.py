from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import GrupoMuscular
from app.schemas import GrupoMuscularOut

router = APIRouter(prefix="/grupos-musculares", tags=["grupos musculares"])


@router.get("", response_model=list[GrupoMuscularOut])
def listar_grupos_musculares(db: Session = Depends(get_db)):
    """Lista los grupos musculares disponibles.

    Catálogo fijo sin CRUD propio (ver seed en la migración de Alembic) — se
    usa para elegir `grupo_muscular_id` al crear/editar un ejercicio.
    """
    return db.scalars(select(GrupoMuscular).order_by(GrupoMuscular.nombre)).all()
