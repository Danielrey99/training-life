"""sembrar ejercicios predefinidos

Revision ID: f2534cce9bf5
Revises: f6f438eb2765
Create Date: 2026-09-27 18:02:38.745679

La app viene con una biblioteca de ejercicios desde el primer día: sin ella, lo
primero que tendría que hacer alguien nuevo es crear ejercicios uno a uno antes de
poder montar una rutina. Son predefinidos (sin dueño y compartidos por todos), así
que nadie los puede editar, ocultar ni borrar.

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2534cce9bf5"
down_revision: Union[str, None] = "f6f438eb2765"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tablas ligeras declaradas aquí y no importadas de app.models: los modelos
# cambian con el tiempo y romperían esta migración antigua.
grupos_musculares = sa.table("grupos_musculares", sa.column("id"), sa.column("nombre"))
ejercicios = sa.table(
    "ejercicios",
    sa.column("id"),
    sa.column("nombre"),
    sa.column("grupo_muscular_id"),
    sa.column("es_predefinido"),
    sa.column("usuario_id"),
    sa.column("visibilidad"),
    sa.column("created_at"),
    sa.column("updated_at"),
)

# Por grupo muscular, con los nombres que siembran 4cb2b149bf00 y f6f438eb2765.
# Las variantes de un mismo ejercicio (agarre abierto o cerrado, por ejemplo) no
# son ejercicios aparte: se apuntan en cada serie. Abductores y aductores sí van
# por separado, porque son músculos y grupos distintos.
PREDEFINIDOS = {
    "Pecho": [
        "Press banca con barra",
        "Press banca con mancuernas",
        "Press banca en máquina",
        "Press inclinado con barra",
        "Press inclinado con mancuernas",
        "Cruce de poleas",
        "Contractor de pecho",
    ],
    "Espalda": [
        "Dominadas",
        "Jalón en polea",
        "Remo con barra",
        "Remo con mancuerna",
        "Remo en polea baja",
        "Remo en máquina",
        "Peso muerto",
        "Pullover en polea",
    ],
    "Hombro": [
        "Press militar con barra",
        "Press de hombro con mancuernas",
        "Press de hombro en máquina",
        "Elevaciones laterales con mancuernas",
        "Elevaciones laterales en polea",
        "Face pull",
    ],
    "Bíceps": [
        "Curl con barra",
        "Curl con mancuernas",
        "Curl martillo",
        "Curl en banco Scott",
        "Curl en polea",
    ],
    "Tríceps": [
        "Extensión de tríceps en polea",
        "Press francés",
        "Extensión de tríceps sobre la cabeza",
        "Fondos en paralelas",
        "Press banca con agarre cerrado",
    ],
    "Antebrazo": ["Curl de muñeca", "Paseo del granjero"],
    "Cuádriceps": [
        "Sentadilla con barra",
        "Prensa de piernas",
        "Extensión de cuádriceps",
        "Sentadilla búlgara",
        "Sentadilla hack",
        "Zancadas",
    ],
    "Isquiotibiales": ["Peso muerto rumano", "Curl femoral tumbado", "Curl femoral sentado"],
    "Glúteo": ["Hip thrust", "Puente de glúteo", "Patada de glúteo en polea"],
    "Pantorrilla": ["Elevación de talones de pie", "Elevación de talones sentado"],
    "Abdomen": ["Crunch en polea", "Elevación de piernas colgado", "Plancha"],
    # Los seis grupos que añade f6f438eb2765, para que ninguno nazca vacío.
    "Trapecio": ["Encogimientos con barra", "Encogimientos con mancuernas"],
    "Lumbar": ["Hiperextensiones", "Buenos días"],
    "Oblicuos": ["Russian twist", "Leñador en polea"],
    "Aductores": ["Máquina de aductores"],
    "Abductores": ["Máquina de abductores"],
    "Cuello": ["Flexión de cuello con disco"],
}

NOMBRES = [nombre for nombres in PREDEFINIDOS.values() for nombre in nombres]


def _sembrados():
    """Los ejercicios de esta siembra: predefinidos, sin dueño y con uno de estos
    nombres. Así nunca se confunden con un ejercicio propio que se llame igual.
    """
    return sa.and_(
        ejercicios.c.es_predefinido.is_(True),
        ejercicios.c.usuario_id.is_(None),
        ejercicios.c.nombre.in_(NOMBRES),
    )


def upgrade() -> None:
    conexion = op.get_bind()
    # El grupo se busca por nombre y no por id: los ids dependen del orden en que
    # se insertaron, y en otra base podrían no coincidir.
    ids = dict(
        conexion.execute(sa.select(grupos_musculares.c.nombre, grupos_musculares.c.id)).all()
    )
    faltan = set(PREDEFINIDOS) - set(ids)
    if faltan:
        raise RuntimeError(f"Faltan grupos musculares para la siembra: {sorted(faltan)}")

    ahora = datetime.now(timezone.utc)
    op.bulk_insert(
        ejercicios,
        [
            {
                "nombre": nombre,
                "grupo_muscular_id": ids[grupo],
                "es_predefinido": True,
                "usuario_id": None,
                "visibilidad": "privado",
                "created_at": ahora,
                "updated_at": ahora,
            }
            for grupo, nombres in PREDEFINIDOS.items()
            for nombre in nombres
        ],
    )


def downgrade() -> None:
    conexion = op.get_bind()
    # Deshacer la siembra con alguno ya en uso rompería la integridad (huecos,
    # comodines y series los referencian con RESTRICT) o, peor, borraría notas
    # sin avisar (las suyas son CASCADE). Mejor un error que diga por qué.
    en_uso = conexion.execute(
        sa.text(
            """
            SELECT count(DISTINCT e.id) FROM ejercicios e
            WHERE e.es_predefinido AND e.usuario_id IS NULL AND e.nombre = ANY(:nombres)
              AND (
                EXISTS (SELECT 1 FROM rutina_slots s WHERE s.ejercicio_principal_id = e.id)
                OR EXISTS (SELECT 1 FROM slot_alternativas a WHERE a.ejercicio_id = e.id)
                OR EXISTS (SELECT 1 FROM series r WHERE r.ejercicio_id = e.id)
                OR EXISTS (SELECT 1 FROM notas_usuario_ejercicio n WHERE n.ejercicio_id = e.id)
              )
            """
        ),
        {"nombres": NOMBRES},
    ).scalar()
    if en_uso:
        cuantos = "1 ejercicio predefinido ya se usa" if en_uso == 1 else (
            f"{en_uso} ejercicios predefinidos ya se usan"
        )
        raise RuntimeError(
            f"No se puede deshacer la siembra: {cuantos} en rutinas, series o notas."
        )
    op.execute(ejercicios.delete().where(_sembrados()))
