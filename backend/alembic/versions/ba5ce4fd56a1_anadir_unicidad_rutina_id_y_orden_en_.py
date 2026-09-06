"""anadir unicidad rutina_id y orden en rutina_slots

Revision ID: ba5ce4fd56a1
Revises: 3bb7508b76ec
Create Date: 2026-08-31 17:14:49.907901

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ba5ce4fd56a1'
down_revision: Union[str, None] = '3bb7508b76ec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# El autogenerate dejó el nombre a None. Al crear la restricción daba igual
# (Postgres la bautiza sola), pero un DROP necesita nombrarla, así que el
# downgrade fallaba con "Can't emit DROP CONSTRAINT ...; it has no name".
# El nombre de aquí es exactamente el que Postgres genera por defecto
# (<tabla>_<columnas>_key), así que las bases ya migradas encajan sin tocar
# nada y una base nueva queda igual que antes.
NOMBRE = 'rutina_slots_rutina_id_orden_key'


def upgrade() -> None:
    op.create_unique_constraint(NOMBRE, 'rutina_slots', ['rutina_id', 'orden'])


def downgrade() -> None:
    op.drop_constraint(NOMBRE, 'rutina_slots', type_='unique')
