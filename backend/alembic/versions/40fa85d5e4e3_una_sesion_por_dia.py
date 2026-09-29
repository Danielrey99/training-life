"""una sesion por dia

Revision ID: 40fa85d5e4e3
Revises: f2534cce9bf5
Create Date: 2026-09-29 23:10:43.858768

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '40fa85d5e4e3'
down_revision: Union[str, None] = 'f2534cce9bf5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conexion = op.get_bind()
    # Donde un día tenga varias sesiones, las que no tienen ninguna serie sobran:
    # una sesión vacía que ya no está en curso cuenta como cancelada. Se borra
    # también la de hoy si está vacía y hay otra ese día, porque alguna tiene que irse.
    conexion.execute(
        sa.text(
            """
            DELETE FROM entrenamientos e
            WHERE NOT EXISTS (SELECT 1 FROM series s WHERE s.entrenamiento_id = e.id)
              AND EXISTS (
                SELECT 1 FROM entrenamientos o
                WHERE o.usuario_id = e.usuario_id AND o.fecha = e.fecha AND o.id <> e.id
              )
            """
        )
    )
    # Si aun así quedan días con dos sesiones con series, no se junta nada a
    # ciegas (rutinas distintas, números de serie repetidos): se para y se dice cuáles.
    repetidos = conexion.execute(
        sa.text(
            """
            SELECT usuario_id, fecha, count(*) FROM entrenamientos
            GROUP BY usuario_id, fecha HAVING count(*) > 1
            ORDER BY usuario_id, fecha
            """
        )
    ).all()
    if repetidos:
        lista = ", ".join(f"usuario {u} el {f} ({n} sesiones)" for u, f, n in repetidos)
        raise RuntimeError(
            "No se puede aplicar la regla de una sesión por día: hay días con varias sesiones"
            f" con series ({lista}). Borra o cambia de fecha las que sobren y vuelve a migrar."
        )
    op.create_unique_constraint(
        'entrenamientos_usuario_id_fecha_key', 'entrenamientos', ['usuario_id', 'fecha']
    )


def downgrade() -> None:
    op.drop_constraint('entrenamientos_usuario_id_fecha_key', 'entrenamientos', type_='unique')
