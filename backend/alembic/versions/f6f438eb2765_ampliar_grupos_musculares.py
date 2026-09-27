"""ampliar grupos musculares

Revision ID: f6f438eb2765
Revises: 3872db2b2520
Create Date: 2026-09-27 18:32:55.379465

Los 11 grupos de 4cb2b149bf00 se pensaron para una rutina Push/Pull/Leg, pero el
usuario no puede crear grupos: si falta uno, un ejercicio acaba en el grupo que no
es. Estos seis completan los que se usan para clasificar ejercicios de gimnasio.
No se baja a músculos sueltos (cada ejercicio tiene un solo grupo, y con grupos
muy finos cualquier elección sería engañosa).

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f6f438eb2765"
down_revision: Union[str, None] = "3872db2b2520"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


grupos_musculares = sa.table("grupos_musculares", sa.column("nombre"))

NOMBRES = ["Trapecio", "Lumbar", "Oblicuos", "Aductores", "Abductores", "Cuello"]


def upgrade() -> None:
    op.bulk_insert(grupos_musculares, [{"nombre": nombre} for nombre in NOMBRES])


def downgrade() -> None:
    # Si algún ejercicio los usa, la FK lo impide: deshacer un esquema con datos
    # dentro no está soportado, como en la siembra de los grupos originales.
    op.execute(grupos_musculares.delete().where(grupos_musculares.c.nombre.in_(NOMBRES)))
