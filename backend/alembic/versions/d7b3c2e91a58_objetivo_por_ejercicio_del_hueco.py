"""objetivo por ejercicio del hueco

Revision ID: d7b3c2e91a58
Revises: c5a91e7d3b24
Create Date: 2026-10-23 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd7b3c2e91a58'
down_revision: Union[str, None] = 'c5a91e7d3b24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OBJETIVO_CHECK = (
    '(reps_min IS NULL) = (reps_max IS NULL)'
    ' AND (duracion_min_s IS NULL) = (duracion_max_s IS NULL)'
    ' AND (reps_min IS NULL) <> (duracion_min_s IS NULL)'
)


def upgrade() -> None:
    op.alter_column('rutina_slots', 'reps_min', existing_type=sa.Integer(), nullable=True)
    op.alter_column('rutina_slots', 'reps_max', existing_type=sa.Integer(), nullable=True)
    op.add_column('rutina_slots', sa.Column('duracion_min_s', sa.Integer(), nullable=True))
    op.add_column('rutina_slots', sa.Column('duracion_max_s', sa.Integer(), nullable=True))
    op.add_column('slot_alternativas', sa.Column('series_objetivo', sa.Integer(), nullable=True))
    op.add_column('slot_alternativas', sa.Column('reps_min', sa.Integer(), nullable=True))
    op.add_column('slot_alternativas', sa.Column('reps_max', sa.Integer(), nullable=True))
    op.add_column('slot_alternativas', sa.Column('duracion_min_s', sa.Integer(), nullable=True))
    op.add_column('slot_alternativas', sa.Column('duracion_max_s', sa.Integer(), nullable=True))
    # Hasta ahora una alternativa se hacía con el objetivo del principal, y todos los
    # ejercicios son de peso y repeticiones: se le copia.
    op.execute(
        'UPDATE slot_alternativas sa SET series_objetivo = rs.series_objetivo,'
        ' reps_min = rs.reps_min, reps_max = rs.reps_max'
        ' FROM rutina_slots rs WHERE rs.id = sa.slot_id'
    )
    op.alter_column('slot_alternativas', 'series_objetivo', existing_type=sa.Integer(), nullable=False)
    # Los CHECK se escriben a mano: el autogenerate no los ve en una tabla que ya existe.
    op.create_check_constraint('rutina_slots_objetivo_check', 'rutina_slots', OBJETIVO_CHECK)
    op.create_check_constraint('slot_alternativas_objetivo_check', 'slot_alternativas', OBJETIVO_CHECK)


def downgrade() -> None:
    # Un objetivo por duración no cabe en las columnas de antes.
    conn = op.get_bind()
    de_duracion = conn.execute(
        sa.text(
            'SELECT (SELECT count(*) FROM rutina_slots WHERE duracion_min_s IS NOT NULL)'
            ' + (SELECT count(*) FROM slot_alternativas WHERE duracion_min_s IS NOT NULL)'
        )
    ).scalar()
    if de_duracion:
        raise RuntimeError(
            f'No se puede deshacer: hay {de_duracion} hueco(s) o alternativa(s) con el objetivo en duración '
            'y no caben en el esquema anterior.'
        )
    op.drop_constraint('slot_alternativas_objetivo_check', 'slot_alternativas', type_='check')
    op.drop_constraint('rutina_slots_objetivo_check', 'rutina_slots', type_='check')
    for columna in ('duracion_max_s', 'duracion_min_s', 'reps_max', 'reps_min', 'series_objetivo'):
        op.drop_column('slot_alternativas', columna)
    op.drop_column('rutina_slots', 'duracion_max_s')
    op.drop_column('rutina_slots', 'duracion_min_s')
    op.alter_column('rutina_slots', 'reps_max', existing_type=sa.Integer(), nullable=False)
    op.alter_column('rutina_slots', 'reps_min', existing_type=sa.Integer(), nullable=False)
