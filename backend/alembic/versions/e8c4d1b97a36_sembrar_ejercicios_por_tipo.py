"""sembrar ejercicios por tipo

Revision ID: e8c4d1b97a36
Revises: d7b3c2e91a58
Create Date: 2026-10-23 16:00:00.000000

Con los tipos de ejercicio, la biblioteca de predefinidos se pone al día: unos pasan a
apuntarse con el peso corporal (las dominadas, los fondos…) o por tiempo (la plancha, el
paseo del granjero), y llegan tres nuevos. Hasta ahora todos eran de peso y repeticiones.

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e8c4d1b97a36"
down_revision: Union[str, None] = "d7b3c2e91a58"
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

# (nombre, grupo, tipo)
NUEVOS = [
    ("Flexiones", "Pecho", "corporal"),
    ("Crunch abdominal", "Abdomen", "corporal"),
    ("Plancha lateral", "Oblicuos", "tiempo"),
]
NOMBRES_NUEVOS = [nombre for nombre, _, _ in NUEVOS]

# Los que ya existían y cambian de tipo. Los de peso corporal siguen valiendo con sus
# series y objetivos de antes (son de repeticiones); los de tiempo no, y la subida se
# niega si están en uso: pasar repeticiones a segundos no se puede deducir.
A_CORPORAL = [
    "Dominadas",
    "Fondos en paralelas",
    "Elevación de piernas colgado",
    "Hiperextensiones",
    "Russian twist",
    "Puente de glúteo",
]
A_TIEMPO = ["Plancha", "Paseo del granjero"]

# Dónde se usa un ejercicio: sirve para decir cuántas veces, o si no se usa.
USOS = {
    "series": "SELECT count(*) FROM series s WHERE s.ejercicio_id = e.id",
    "huecos como principal": (
        "SELECT count(*) FROM rutina_slots r WHERE r.ejercicio_principal_id = e.id"
    ),
    "huecos como alternativa": (
        "SELECT count(*) FROM slot_alternativas a WHERE a.ejercicio_id = e.id"
    ),
    "notas": "SELECT count(*) FROM notas_ejercicio n WHERE n.ejercicio_id = e.id",
}


def _usos(conexion, nombres: list[str], consulta: str) -> int:
    """Cuántas filas cuentan `consulta` para los predefinidos con esos nombres."""
    return conexion.execute(
        sa.text(
            f"SELECT coalesce(sum(({consulta})), 0) FROM ejercicios e "
            "WHERE e.es_predefinido AND e.nombre = ANY(:nombres)"
        ),
        {"nombres": nombres},
    ).scalar()


def _contar_usos(conexion, nombres: list[str]) -> str:
    """«2 series y 1 hueco como principal», o texto vacío si no se usan."""
    partes = []
    for texto, consulta in USOS.items():
        cuantos = _usos(conexion, nombres, consulta)
        if cuantos:
            partes.append(f"{cuantos} {texto}")
    return ", ".join(partes)


def upgrade() -> None:
    conexion = op.get_bind()

    # 1. Los grupos que usan los nuevos.
    grupos = dict(conexion.execute(sa.select(grupos_musculares.c.nombre, grupos_musculares.c.id)).all())
    faltan = sorted({grupo for _, grupo, _ in NUEVOS if grupo not in grupos})
    if faltan:
        raise RuntimeError(f"Faltan grupos musculares para la siembra: {', '.join(faltan)}.")

    # 2. Plancha y Paseo del granjero pasan a tiempo: con algo apuntado, sus series y
    # objetivos serían de repeticiones y no cuadrarían.
    en_uso = _contar_usos(conexion, A_TIEMPO)
    if en_uso:
        raise RuntimeError(
            "No se puede subir esta migración: Plancha o Paseo del granjero ya se usan "
            f"({en_uso}) y pasan a apuntarse por tiempo. Quítalos de las rutinas y borra sus "
            "series antes."
        )

    # 3. Los tres nuevos, que no se deben haber creado ya.
    existentes = conexion.execute(
        sa.text("SELECT nombre FROM ejercicios WHERE lower(nombre) = ANY(:nombres)"),
        {"nombres": [nombre.lower() for nombre in NOMBRES_NUEVOS]},
    ).scalars().all()
    if existentes:
        raise RuntimeError(
            f"Ya hay ejercicios con el nombre de los nuevos predefinidos: {', '.join(existentes)}."
        )
    ahora = datetime.now(timezone.utc)
    op.bulk_insert(
        ejercicios,
        [
            {
                "nombre": nombre,
                "grupo_muscular_id": grupos[grupo],
                "es_predefinido": True,
                "tipo_registro": tipo,
                "created_at": ahora,
                "updated_at": ahora,
            }
            for nombre, grupo, tipo in NUEVOS
        ],
    )

    # 4. Los cambios de tipo, solo de predefinidos.
    for tipo, nombres in (("corporal", A_CORPORAL), ("tiempo", A_TIEMPO)):
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre.in_(nombres))
            .values(tipo_registro=tipo)
        )


def downgrade() -> None:
    conexion = op.get_bind()

    # Los nuevos, con algo suyo, no se pueden quitar: sus huecos, series y notas se
    # perderían (o la base no lo dejaría).
    en_uso = _contar_usos(conexion, NOMBRES_NUEVOS)
    if en_uso:
        raise RuntimeError(
            f"No se puede deshacer la siembra: los ejercicios nuevos ya se usan ({en_uso})."
        )
    # Los de tiempo, con series, huecos o alternativas, ya no serían de peso y repeticiones.
    de_tiempo = _contar_usos(conexion, A_TIEMPO)
    if de_tiempo:
        raise RuntimeError(
            "No se puede deshacer la siembra: Plancha o Paseo del granjero ya se usan "
            f"({de_tiempo}) y no caben como ejercicios de peso y repeticiones."
        )
    # Los de peso corporal, con una carga de ayuda o un peso corporal, tampoco.
    con_ayuda = _usos(
        conexion,
        A_CORPORAL,
        "SELECT count(*) FROM series s WHERE s.ejercicio_id = e.id "
        "AND (s.peso < 0 OR s.peso_corporal IS NOT NULL)",
    )
    if con_ayuda:
        raise RuntimeError(
            f"No se puede deshacer la siembra: hay {con_ayuda} serie(s) de ejercicios de peso "
            "corporal con una carga de ayuda o con el peso corporal apuntado."
        )

    for nombres in (A_CORPORAL, A_TIEMPO):
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre.in_(nombres))
            .values(tipo_registro="peso_reps")
        )
    op.execute(
        ejercicios.delete().where(
            ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre.in_(NOMBRES_NUEVOS)
        )
    )
