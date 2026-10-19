"""renombrar notas_usuario_ejercicio a notas_ejercicio

Revision ID: b4e81d2c6f07
Revises: a7c3f19b2d84
Create Date: 2026-10-19 19:20:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b4e81d2c6f07'
down_revision: Union[str, None] = 'a7c3f19b2d84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _renombrar(antes: str, despues: str) -> None:
    # rename_table no toca la secuencia ni las restricciones: se renombran aparte para
    # que los nombres sigan el patrón de siempre (<tabla>_pkey, <tabla>_<columna>_fkey).
    op.rename_table(antes, despues)
    op.execute(f'ALTER SEQUENCE {antes}_id_seq RENAME TO {despues}_id_seq')
    op.execute(f'ALTER TABLE {despues} RENAME CONSTRAINT {antes}_pkey TO {despues}_pkey')
    op.execute(
        f'ALTER TABLE {despues} RENAME CONSTRAINT {antes}_ejercicio_id_fkey'
        f' TO {despues}_ejercicio_id_fkey'
    )


def upgrade() -> None:
    _renombrar('notas_usuario_ejercicio', 'notas_ejercicio')


def downgrade() -> None:
    _renombrar('notas_ejercicio', 'notas_usuario_ejercicio')
