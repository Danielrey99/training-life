"""cardio

Revision ID: f9a2b6c83d15
Revises: e8c4d1b97a36
Create Date: 2026-10-24 10:00:00.000000

Un ejercicio más: el cardio (cinta, bicicleta…), que se apunta por tiempo y, si se quiere,
con la distancia. Lleva su grupo y cuatro predefinidos.

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f9a2b6c83d15"
down_revision: Union[str, None] = "e8c4d1b97a36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tablas ligeras declaradas aquí y no importadas de app.models: los modelos cambian con el
# tiempo y romperían esta migración antigua.
grupos_musculares = sa.table("grupos_musculares", sa.column("id"), sa.column("nombre"))
ejercicios = sa.table(
    "ejercicios",
    sa.column("id"),
    sa.column("nombre"),
    sa.column("grupo_muscular_id"),
    sa.column("es_predefinido"),
    sa.column("tipo_registro"),
    sa.column("created_at"),
    sa.column("updated_at"),
)

GRUPO = "Cardio"
NUEVOS = ["Cinta de correr", "Bicicleta estática", "Elíptica", "Remo ergómetro"]

# La forma de una serie con la distancia: de repeticiones (con peso, sin duración ni
# distancia) o de duración (con peso o con distancia, no con las dos).
MEDIDAS_CON_DISTANCIA = (
    "(repeticiones IS NOT NULL AND peso IS NOT NULL AND duracion_s IS NULL"
    " AND distancia_m IS NULL)"
    " OR (repeticiones IS NULL AND duracion_s IS NOT NULL"
    " AND (peso IS NULL OR distancia_m IS NULL))"
)
MEDIDAS_SIN_DISTANCIA = (
    "(repeticiones IS NOT NULL AND peso IS NOT NULL AND duracion_s IS NULL)"
    " OR (repeticiones IS NULL AND duracion_s IS NOT NULL)"
)
TIPOS_CON_CARDIO = "tipo_registro IN ('peso_reps', 'corporal', 'tiempo', 'cardio')"
TIPOS_SIN_CARDIO = "tipo_registro IN ('peso_reps', 'corporal', 'tiempo')"


def _cuantos_usos(conexion, nombres: list[str]) -> int:
    """Cuántas series, huecos, alternativas y notas tienen los predefinidos con esos nombres."""
    return conexion.execute(
        sa.text(
            """
            SELECT
              (SELECT count(*) FROM series s JOIN ejercicios e ON e.id = s.ejercicio_id
                 WHERE e.es_predefinido AND e.nombre = ANY(:nombres))
            + (SELECT count(*) FROM rutina_slots r JOIN ejercicios e ON e.id = r.ejercicio_principal_id
                 WHERE e.es_predefinido AND e.nombre = ANY(:nombres))
            + (SELECT count(*) FROM slot_alternativas a JOIN ejercicios e ON e.id = a.ejercicio_id
                 WHERE e.es_predefinido AND e.nombre = ANY(:nombres))
            + (SELECT count(*) FROM notas_ejercicio n JOIN ejercicios e ON e.id = n.ejercicio_id
                 WHERE e.es_predefinido AND e.nombre = ANY(:nombres))
            """
        ),
        {"nombres": nombres},
    ).scalar()


def upgrade() -> None:
    conexion = op.get_bind()

    # El grupo y los nombres, libres: si alguien ya los creó, mejor un error que lo diga.
    if conexion.execute(
        sa.select(grupos_musculares.c.id).where(grupos_musculares.c.nombre == GRUPO)
    ).first():
        raise RuntimeError(f'Ya existe un grupo muscular llamado "{GRUPO}".')
    existentes = (
        conexion.execute(
            sa.text("SELECT nombre FROM ejercicios WHERE lower(nombre) = ANY(:nombres)"),
            {"nombres": [nombre.lower() for nombre in NUEVOS]},
        )
        .scalars()
        .all()
    )
    if existentes:
        raise RuntimeError(
            f"Ya hay ejercicios con el nombre de los nuevos predefinidos: {', '.join(existentes)}."
        )

    # El tipo nuevo y la distancia en las series.
    op.drop_constraint("ejercicios_tipo_registro_check", "ejercicios", type_="check")
    op.create_check_constraint("ejercicios_tipo_registro_check", "ejercicios", TIPOS_CON_CARDIO)
    op.add_column("series", sa.Column("distancia_m", sa.Integer(), nullable=True))
    op.drop_constraint("series_medidas_check", "series", type_="check")
    op.create_check_constraint("series_medidas_check", "series", MEDIDAS_CON_DISTANCIA)
    op.create_check_constraint(
        "series_distancia_check", "series", "distancia_m IS NULL OR distancia_m > 0"
    )

    # El grupo y sus cuatro predefinidos.
    op.bulk_insert(grupos_musculares, [{"nombre": GRUPO}])
    grupo_id = conexion.execute(
        sa.select(grupos_musculares.c.id).where(grupos_musculares.c.nombre == GRUPO)
    ).scalar_one()
    ahora = datetime.now(timezone.utc)
    op.bulk_insert(
        ejercicios,
        [
            {
                "nombre": nombre,
                "grupo_muscular_id": grupo_id,
                "es_predefinido": True,
                "tipo_registro": "cardio",
                "created_at": ahora,
                "updated_at": ahora,
            }
            for nombre in NUEVOS
        ],
    )


def downgrade() -> None:
    conexion = op.get_bind()

    # Los cuatro predefinidos, usados, no se pueden quitar: sus series, huecos y notas
    # se perderían (o la base no lo dejaría).
    usos = _cuantos_usos(conexion, NUEVOS)
    if usos:
        raise RuntimeError(
            f"No se puede deshacer el cardio: sus ejercicios predefinidos ya se usan ({usos} "
            "series, huecos, alternativas o notas)."
        )
    # Ni otro ejercicio de cardio (propio) ni uno propio en el grupo Cardio: no cabrían sin
    # el tipo ni sin el grupo.
    otros = conexion.execute(
        sa.text(
            """
            SELECT count(*) FROM ejercicios e
            WHERE (e.tipo_registro = 'cardio'
                   OR e.grupo_muscular_id IN (SELECT id FROM grupos_musculares WHERE nombre = :grupo))
              AND NOT (e.es_predefinido AND e.nombre = ANY(:nombres))
            """
        ),
        {"grupo": GRUPO, "nombres": NUEVOS},
    ).scalar()
    if otros:
        raise RuntimeError(
            f"No se puede deshacer el cardio: hay {otros} ejercicio(s) propios de cardio o en el "
            f'grupo "{GRUPO}".'
        )

    op.execute(
        ejercicios.delete().where(
            ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre.in_(NUEVOS)
        )
    )
    op.execute(grupos_musculares.delete().where(grupos_musculares.c.nombre == GRUPO))
    op.drop_constraint("series_distancia_check", "series", type_="check")
    op.drop_constraint("series_medidas_check", "series", type_="check")
    op.drop_column("series", "distancia_m")
    op.create_check_constraint("series_medidas_check", "series", MEDIDAS_SIN_DISTANCIA)
    op.drop_constraint("ejercicios_tipo_registro_check", "ejercicios", type_="check")
    op.create_check_constraint("ejercicios_tipo_registro_check", "ejercicios", TIPOS_SIN_CARDIO)
