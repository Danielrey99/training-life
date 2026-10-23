"""tipos de ejercicio y medidas de serie

Revision ID: c5a91e7d3b24
Revises: b4e81d2c6f07
Create Date: 2026-10-23 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c5a91e7d3b24'
down_revision: Union[str, None] = 'b4e81d2c6f07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Todo lo que ya existe es de peso y repeticiones: el server_default lo rellena.
    op.add_column(
        'ejercicios',
        sa.Column('tipo_registro', sa.String(length=20), server_default='peso_reps', nullable=False),
    )
    op.create_check_constraint(
        'ejercicios_tipo_registro_check',
        'ejercicios',
        "tipo_registro IN ('peso_reps', 'corporal', 'tiempo')",
    )
    # El peso y las repeticiones pasan a poder ir nulos (una serie por tiempo no los lleva).
    op.alter_column('series', 'peso', existing_type=sa.Numeric(6, 2), nullable=True)
    op.alter_column('series', 'repeticiones', existing_type=sa.Integer(), nullable=True)
    op.add_column('series', sa.Column('duracion_s', sa.Integer(), nullable=True))
    op.add_column('series', sa.Column('peso_corporal', sa.Numeric(5, 2), nullable=True))
    # Los CHECK se escriben a mano: el autogenerate no los ve en una tabla que ya existe.
    op.create_check_constraint(
        'series_medidas_check',
        'series',
        '(repeticiones IS NOT NULL AND peso IS NOT NULL AND duracion_s IS NULL)'
        ' OR (repeticiones IS NULL AND duracion_s IS NOT NULL)',
    )
    op.create_check_constraint(
        'series_peso_check', 'series', 'peso IS NULL OR peso >= 0 OR repeticiones IS NOT NULL'
    )
    op.create_check_constraint(
        'series_duracion_check', 'series', 'duracion_s IS NULL OR duracion_s > 0'
    )
    op.create_check_constraint(
        'series_peso_corporal_check',
        'series',
        'peso_corporal IS NULL OR (peso_corporal > 0 AND repeticiones IS NOT NULL)',
    )


def downgrade() -> None:
    # Volver atrás perdería lo que solo existe con los tipos: se niega si hay series de
    # tiempo o con una carga negativa (no caben en las columnas de antes).
    conn = op.get_bind()
    sin_peso_o_reps = conn.execute(
        sa.text('SELECT count(*) FROM series WHERE peso IS NULL OR repeticiones IS NULL OR peso < 0')
    ).scalar()
    if sin_peso_o_reps:
        raise RuntimeError(
            f'No se puede deshacer: hay {sin_peso_o_reps} serie(s) que no son de peso y '
            'repeticiones (por tiempo, o con una carga de ayuda) y no caben en el esquema anterior.'
        )
    for nombre in (
        'series_peso_corporal_check',
        'series_duracion_check',
        'series_peso_check',
        'series_medidas_check',
    ):
        op.drop_constraint(nombre, 'series', type_='check')
    op.drop_column('series', 'peso_corporal')
    op.drop_column('series', 'duracion_s')
    op.alter_column('series', 'repeticiones', existing_type=sa.Integer(), nullable=False)
    op.alter_column('series', 'peso', existing_type=sa.Numeric(6, 2), nullable=False)
    op.drop_constraint('ejercicios_tipo_registro_check', 'ejercicios', type_='check')
    op.drop_column('ejercicios', 'tipo_registro')
