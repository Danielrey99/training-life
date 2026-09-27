"""sustituir activo por oculto_desde

Revision ID: a86aaeb21ca7
Revises: e02ac0d16118
Create Date: 2026-09-27 16:27:13.702131

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a86aaeb21ca7'
down_revision: Union[str, None] = 'e02ac0d16118'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Las tres tablas que se pueden ocultar. Mismo tratamiento para todas.
TABLAS = ("ejercicios", "rutinas", "rutina_slots")


def upgrade() -> None:
    for tabla in TABLAS:
        op.add_column(tabla, sa.Column("oculto_desde", sa.Date(), nullable=True))
        # Lo que ya estaba oculto conserva cuándo se ocultó: para una fila oculta,
        # updated_at es justo ese momento, porque editarla estando oculta no se
        # permite. Se pasa a fecha en hora de España, la que ve el usuario.
        op.execute(
            f"UPDATE {tabla} SET oculto_desde = (updated_at AT TIME ZONE 'Europe/Madrid')::date "
            "WHERE activo = false"
        )
        op.drop_column(tabla, "activo")


def downgrade() -> None:
    for tabla in TABLAS:
        # Con valor por defecto para que se pueda añadir sobre filas que ya
        # existen; después se quita, porque la columna original no lo tenía.
        op.add_column(
            tabla,
            sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
        op.execute(f"UPDATE {tabla} SET activo = (oculto_desde IS NULL)")
        op.alter_column(tabla, "activo", server_default=None)
        op.drop_column(tabla, "oculto_desde")
