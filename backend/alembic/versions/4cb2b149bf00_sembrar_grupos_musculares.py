"""sembrar grupos musculares

Revision ID: 4cb2b149bf00
Revises: 32c0db792aa1
Create Date: 2026-08-28 13:25:12.128494

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4cb2b149bf00'
down_revision: Union[str, None] = '32c0db792aa1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tabla "ligera" (solo para esta migración, no el modelo real) que describe
# lo mínimo necesario para insertar/borrar filas de forma segura y parametrizada.
grupos_musculares = sa.table(
    "grupos_musculares",
    sa.column("nombre", sa.String),
)

# Categorización pensada para una rutina Push/Pull/Leg.
NOMBRES = [
    "Pecho",
    "Espalda",
    "Hombro",
    "Bíceps",
    "Tríceps",
    "Antebrazo",
    "Cuádriceps",
    "Isquiotibiales",
    "Glúteo",
    "Pantorrilla",
    "Abdomen",
]


def upgrade() -> None:
    op.bulk_insert(grupos_musculares, [{"nombre": nombre} for nombre in NOMBRES])


def downgrade() -> None:
    op.execute(
        grupos_musculares.delete().where(grupos_musculares.c.nombre.in_(NOMBRES))
    )
