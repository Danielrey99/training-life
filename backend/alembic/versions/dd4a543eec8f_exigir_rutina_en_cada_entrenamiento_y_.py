"""exigir rutina en cada entrenamiento y hueco en cada serie

Revision ID: dd4a543eec8f
Revises: 0a3efc993007
Create Date: 2026-10-05 15:23:12.951514

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd4a543eec8f'
down_revision: Union[str, None] = '0a3efc993007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conexion = op.get_bind()
    # Desde ahora toda sesión es de una rutina y toda serie va en un hueco. Si queda
    # algo de cuando se admitía el entrenamiento libre, no se borra ni se inventa
    # nada a ciegas: se para y se dice qué es, para decidirlo a mano.
    libres = conexion.execute(
        sa.text("SELECT id, fecha FROM entrenamientos WHERE rutina_id IS NULL ORDER BY fecha")
    ).all()
    sueltas = conexion.execute(
        sa.text("SELECT id, entrenamiento_id FROM series WHERE slot_id IS NULL ORDER BY id")
    ).all()
    if libres or sueltas:
        partes = []
        if libres:
            partes.append(
                "sesiones sin rutina: " + ", ".join(f"id {i} ({f})" for i, f in libres)
            )
        if sueltas:
            partes.append(
                "series sin hueco: " + ", ".join(f"id {i} (sesión {e})" for i, e in sueltas)
            )
        raise RuntimeError(
            "No se puede exigir rutina y hueco: quedan datos del entrenamiento libre. "
            + "; ".join(partes)
        )
    op.alter_column("entrenamientos", "rutina_id", existing_type=sa.INTEGER(), nullable=False)
    op.alter_column("series", "slot_id", existing_type=sa.INTEGER(), nullable=False)


def downgrade() -> None:
    op.alter_column("series", "slot_id", existing_type=sa.INTEGER(), nullable=True)
    op.alter_column("entrenamientos", "rutina_id", existing_type=sa.INTEGER(), nullable=True)
