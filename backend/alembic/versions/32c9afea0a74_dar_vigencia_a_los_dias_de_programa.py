"""dar vigencia a los dias de programa

Revision ID: 32c9afea0a74
Revises: 40fa85d5e4e3
Create Date: 2026-09-29 23:23:01.742630

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '32c9afea0a74'
down_revision: Union[str, None] = '40fa85d5e4e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nulas las dos: las filas que ya existen valen desde siempre y siguen
    # vigentes, que es exactamente lo que significaban hasta ahora.
    op.add_column('programa_dias', sa.Column('desde', sa.Date(), nullable=True))
    op.add_column('programa_dias', sa.Column('hasta', sa.Date(), nullable=True))
    # Un día ya puede tener varias filas (las cerradas son el pasado): la unicidad
    # pasa a ser solo entre las vigentes.
    op.drop_constraint('programa_dias_programa_id_dia_semana_key', 'programa_dias', type_='unique')
    op.create_index(
        'ix_programa_dias_programa_dia_abierto',
        'programa_dias',
        ['programa_id', 'dia_semana'],
        unique=True,
        postgresql_where=sa.text('hasta IS NULL'),
    )
    # El autogenerate no detecta un CHECK nuevo en una tabla que ya existe.
    op.create_check_constraint(
        'programa_dias_vigencia_check',
        'programa_dias',
        'desde IS NULL OR hasta IS NULL OR hasta > desde',
    )


def downgrade() -> None:
    # El esquema viejo solo sabe guardar la plantilla de hoy: lo que ya no está
    # vigente se pierde, o la unicidad de programa y día no se podría recrear.
    op.execute('DELETE FROM programa_dias WHERE hasta IS NOT NULL')
    op.drop_constraint('programa_dias_vigencia_check', 'programa_dias', type_='check')
    op.drop_index(
        'ix_programa_dias_programa_dia_abierto',
        table_name='programa_dias',
        postgresql_where=sa.text('hasta IS NULL'),
    )
    op.create_unique_constraint(
        'programa_dias_programa_id_dia_semana_key', 'programa_dias', ['programa_id', 'dia_semana']
    )
    op.drop_column('programa_dias', 'hasta')
    op.drop_column('programa_dias', 'desde')
