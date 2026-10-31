"""descripciones sin punto y coma

Revision ID: c6d6c8434fa9
Revises: f1f0031b966e
Create Date: 2026-10-31 04:00:00.000000

Cambia el «;» por un punto en las tres descripciones de predefinidos que lo llevaban: ningún
texto de la app lleva «;», y dos frases se separan con punto. La lista viva está en
shared/predefinidos.json.

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c6d6c8434fa9"
down_revision: Union[str, None] = "f1f0031b966e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tabla ligera declarada aquí y no importada de app.models: los modelos cambian con el tiempo
# y romperían esta migración antigua.
ejercicios = sa.table(
    "ejercicios",
    sa.column("nombre"),
    sa.column("es_predefinido"),
    sa.column("descripcion"),
    sa.column("updated_at"),
)

# {nombre: (viejo, nuevo)}, congelado aquí y no leído del JSON: la lista puede cambiar después
# y esta migración tiene que poner siempre lo mismo.
CAMBIOS = {
    "Remo con barra": (
        "Inclina el tronco hacia delante con la espalda recta y las rodillas un poco "
        "flexionadas, con la barra colgando a la altura de las rodillas. Tira hacia el "
        "ombligo llevando los codos atrás y junta los omóplatos arriba; baja controlando sin "
        "incorporarte.",
        "Inclina el tronco hacia delante con la espalda recta y las rodillas un poco "
        "flexionadas, con la barra colgando a la altura de las rodillas. Tira hacia el "
        "ombligo llevando los codos atrás y junta los omóplatos arriba. Baja controlando sin "
        "incorporarte.",
    ),
    "Patada de tríceps": (
        "Con una mancuerna en una mano, apoya la otra mano y la rodilla del mismo lado en un "
        "banco, con la espalda recta. Pega el codo al costado con el brazo paralelo al suelo "
        "y estira el codo hacia atrás hasta tener el brazo recto; vuelve despacio moviendo "
        "solo el antebrazo.",
        "Con una mancuerna en una mano, apoya la otra mano y la rodilla del mismo lado en un "
        "banco, con la espalda recta. Pega el codo al costado con el brazo paralelo al suelo "
        "y estira el codo hacia atrás hasta tener el brazo recto. Vuelve despacio moviendo "
        "solo el antebrazo.",
    ),
    "Wall ball": (
        "Frente a una pared, con un balón medicinal sujeto delante del pecho. Baja en "
        "sentadilla y, al subir, lanza el balón a un punto alto de la pared; recógelo y "
        "encadena la siguiente sentadilla.",
        "Frente a una pared, con un balón medicinal sujeto delante del pecho. Baja en "
        "sentadilla y, al subir, lanza el balón a un punto alto de la pared. Recógelo y "
        "encadena la siguiente sentadilla.",
    ),
}


def _predefinidos_no_unicos(conexion, nombres: list[str]) -> list[str]:
    """De esos nombres, los que no están exactamente una vez como predefinido."""
    cuantos = dict(
        conexion.execute(
            sa.text(
                "SELECT nombre, count(*) FROM ejercicios"
                " WHERE es_predefinido AND nombre = ANY(:nombres) GROUP BY nombre"
            ),
            {"nombres": nombres},
        ).all()
    )
    return [nombre for nombre in nombres if cuantos.get(nombre) != 1]


def _poner(cual: int, accion: str) -> None:
    # Primero se comprueba y solo después se escribe: mejor un error que lo diga que unas
    # descripciones a medias.
    no_unicos = _predefinidos_no_unicos(op.get_bind(), list(CAMBIOS))
    if no_unicos:
        raise RuntimeError(
            f"No se pueden {accion} las descripciones de los predefinidos, porque falta o está "
            f"repetido {', '.join(no_unicos)}."
        )
    # op.execute no pasa por el onupdate del ORM: updated_at se pone a mano.
    ahora = datetime.now(timezone.utc)
    for nombre, textos in CAMBIOS.items():
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre == nombre)
            .values(descripcion=textos[cual], updated_at=ahora)
        )


def upgrade() -> None:
    _poner(1, "cambiar")


def downgrade() -> None:
    _poner(0, "devolver")
