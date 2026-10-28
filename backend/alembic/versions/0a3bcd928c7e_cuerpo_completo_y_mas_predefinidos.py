"""cuerpo completo y mas predefinidos

Revision ID: 0a3bcd928c7e
Revises: f9a2b6c83d15
Create Date: 2026-10-28 20:16:19.708345

Amplía la biblioteca de predefinidos de 66 a 146 para que los ejercicios habituales de
cualquier rutina ya estén: el grupo «Cuerpo completo» (los que trabajan todo el cuerpo a la
vez) y 80 ejercicios más, sobre todo las otras formas de hacer los que ya había (con barra,
mancuernas, máquina, polea o multipower). La lista viva está en shared/predefinidos.json.

Cambia además el nombre de cuatro predefinidos por el habitual («Press militar»,
«Curl predicador») o para distinguirlos del nuevo («Jalón en polea con agarre abierto» frente
al de agarre cerrado). Al cambiar el nombre se conservan sus ids, así que sus series, huecos y
notas siguen en su sitio; pero un archivo exportado antes que use un nombre viejo ya no se
puede importar, porque los predefinidos viajan por su nombre.

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0a3bcd928c7e"
down_revision: Union[str, None] = "f9a2b6c83d15"
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

GRUPO = "Cuerpo completo"

# Congelada aquí y no leída de shared/predefinidos.json: la lista puede cambiar después y esta
# migración tiene que sembrar siempre lo mismo.
NUEVOS = [
    ("Aperturas con mancuernas", "Pecho", "peso_reps"),
    ("Press banca en multipower", "Pecho", "peso_reps"),
    ("Press declinado con barra", "Pecho", "peso_reps"),
    ("Press declinado con mancuernas", "Pecho", "peso_reps"),
    ("Press inclinado en máquina", "Pecho", "peso_reps"),
    ("Press inclinado en multipower", "Pecho", "peso_reps"),
    ("Dominadas supinas", "Espalda", "corporal"),
    ("Jalón en máquina", "Espalda", "peso_reps"),
    ("Jalón en polea con agarre cerrado", "Espalda", "peso_reps"),
    ("Muscle-up", "Espalda", "corporal"),
    ("Peso muerto con mancuernas", "Espalda", "peso_reps"),
    ("Pullover con mancuerna", "Espalda", "peso_reps"),
    ("Remo con mancuernas en banco inclinado", "Espalda", "peso_reps"),
    ("Remo en máquina unilateral", "Espalda", "peso_reps"),
    ("Remo en polea baja unilateral", "Espalda", "peso_reps"),
    ("Remo en T", "Espalda", "peso_reps"),
    ("Remo invertido", "Espalda", "corporal"),
    ("Contractor inverso", "Hombro", "peso_reps"),
    ("Elevaciones frontales con mancuernas", "Hombro", "peso_reps"),
    ("Elevaciones frontales en polea", "Hombro", "peso_reps"),
    ("Elevaciones laterales en máquina", "Hombro", "peso_reps"),
    ("Flexiones en pica", "Hombro", "corporal"),
    ("Pájaros con mancuernas", "Hombro", "peso_reps"),
    ("Pájaros en polea", "Hombro", "peso_reps"),
    ("Press Arnold", "Hombro", "peso_reps"),
    ("Remo al mentón", "Hombro", "peso_reps"),
    ("Curl concentrado", "Bíceps", "peso_reps"),
    ("Curl en máquina", "Bíceps", "peso_reps"),
    ("Curl inclinado con mancuernas", "Bíceps", "peso_reps"),
    ("Extensión de tríceps en máquina", "Tríceps", "peso_reps"),
    ("Flexiones diamante", "Tríceps", "corporal"),
    ("Fondos en banco", "Tríceps", "corporal"),
    ("Fondos en máquina", "Tríceps", "peso_reps"),
    ("Patada de tríceps", "Tríceps", "peso_reps"),
    ("Colgarse de la barra", "Antebrazo", "tiempo"),
    ("Curl inverso", "Antebrazo", "peso_reps"),
    ("Extensión de muñeca", "Antebrazo", "peso_reps"),
    ("Sentadilla con peso corporal", "Cuádriceps", "corporal"),
    ("Sentadilla con salto", "Cuádriceps", "corporal"),
    ("Sentadilla en multipower", "Cuádriceps", "peso_reps"),
    ("Sentadilla frontal", "Cuádriceps", "peso_reps"),
    ("Sentadilla goblet", "Cuádriceps", "peso_reps"),
    ("Subidas al cajón", "Cuádriceps", "peso_reps"),
    ("Curl nórdico", "Isquiotibiales", "corporal"),
    ("Peso muerto a una pierna", "Isquiotibiales", "peso_reps"),
    ("Peso muerto rumano con mancuernas", "Isquiotibiales", "peso_reps"),
    ("Hip thrust en máquina", "Glúteo", "peso_reps"),
    ("Patada de glúteo en máquina", "Glúteo", "peso_reps"),
    ("Peso muerto sumo", "Glúteo", "peso_reps"),
    ("Elevación de talones en prensa", "Pantorrilla", "peso_reps"),
    ("Abdominales en V", "Abdomen", "corporal"),
    ("Crunch bicicleta", "Abdomen", "corporal"),
    ("Crunch en máquina", "Abdomen", "peso_reps"),
    ("Crunch inverso", "Abdomen", "corporal"),
    ("Elevación de piernas tumbado", "Abdomen", "corporal"),
    ("Elevación de rodillas en paralelas", "Abdomen", "corporal"),
    ("Hollow hold", "Abdomen", "tiempo"),
    ("Rueda abdominal", "Abdomen", "corporal"),
    ("Sit-ups", "Abdomen", "corporal"),
    ("Encogimientos en máquina", "Trapecio", "peso_reps"),
    ("Flexión lateral con mancuerna", "Oblicuos", "peso_reps"),
    ("Bicicleta al aire libre", "Cardio", "cardio"),
    ("Bicicleta de aire", "Cardio", "cardio"),
    ("Caminar", "Cardio", "cardio"),
    ("Comba", "Cardio", "cardio"),
    ("Correr al aire libre", "Cardio", "cardio"),
    ("Escaladora", "Cardio", "cardio"),
    ("Natación", "Cardio", "cardio"),
    ("Arrancada", GRUPO, "peso_reps"),
    ("Burpees", GRUPO, "corporal"),
    ("Cargada de potencia", GRUPO, "peso_reps"),
    ("Cuerdas de batalla", GRUPO, "tiempo"),
    ("Dos tiempos", GRUPO, "peso_reps"),
    ("Empuje de trineo", GRUPO, "tiempo"),
    ("Kettlebell swing", GRUPO, "peso_reps"),
    ("Levantamiento turco", GRUPO, "peso_reps"),
    ("Mountain climbers", GRUPO, "tiempo"),
    ("Saltos al cajón", GRUPO, "corporal"),
    ("Thruster", GRUPO, "peso_reps"),
    ("Wall ball", GRUPO, "peso_reps"),
]
NOMBRES_NUEVOS = [nombre for nombre, _, _ in NUEVOS]

# (nombre viejo, nombre nuevo). Ningún nombre nuevo está en NUEVOS: así el downgrade borra el
# jalón de agarre cerrado y no el de agarre abierto.
RENOMBRES = [
    ("Press de hombro con mancuernas", "Press militar con mancuernas"),
    ("Press de hombro en máquina", "Press militar en máquina"),
    ("Curl en banco Scott", "Curl predicador"),
    ("Jalón en polea", "Jalón en polea con agarre abierto"),
]
VIEJOS = [viejo for viejo, _ in RENOMBRES]
DESTINOS = [nuevo for _, nuevo in RENOMBRES]


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


def _ya_usados(conexion, nombres: list[str]) -> list[str]:
    """Los ejercicios, propios o predefinidos, que ya se llaman así sin mirar mayúsculas."""
    return (
        conexion.execute(
            sa.text("SELECT nombre FROM ejercicios WHERE lower(nombre) = ANY(:nombres)"),
            {"nombres": [nombre.lower() for nombre in nombres]},
        )
        .scalars()
        .all()
    )


def _renombrar(pares: list[tuple[str, str]]) -> None:
    # op.execute no pasa por el onupdate del ORM: updated_at se pone a mano.
    ahora = datetime.now(timezone.utc)
    for desde, hasta in pares:
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre == desde)
            .values(nombre=hasta, updated_at=ahora)
        )


def upgrade() -> None:
    conexion = op.get_bind()

    # Primero se comprueba todo y solo después se escribe: si algo no cuadra, mejor un error
    # que lo diga que una siembra a medias.
    if conexion.execute(
        sa.select(grupos_musculares.c.id).where(grupos_musculares.c.nombre == GRUPO)
    ).first():
        raise RuntimeError(f'Ya existe un grupo muscular llamado "{GRUPO}".')
    usados = sorted({grupo for _, grupo, _ in NUEVOS} - {GRUPO})
    hay = set(
        conexion.execute(
            sa.select(grupos_musculares.c.nombre).where(grupos_musculares.c.nombre.in_(usados))
        )
        .scalars()
        .all()
    )
    faltan = [grupo for grupo in usados if grupo not in hay]
    if faltan:
        raise RuntimeError(f"Faltan grupos musculares para la siembra: {', '.join(faltan)}.")
    no_unicos = _predefinidos_no_unicos(conexion, VIEJOS)
    if no_unicos:
        raise RuntimeError(
            "No se pueden renombrar los predefinidos: falta o está repetido "
            f"{', '.join(no_unicos)}."
        )
    existentes = _ya_usados(conexion, NOMBRES_NUEVOS + DESTINOS)
    if existentes:
        raise RuntimeError(
            "Ya hay ejercicios con el nombre de los nuevos predefinidos o de los renombrados: "
            f"{', '.join(existentes)}. Cámbiales el nombre antes de actualizar."
        )

    _renombrar(RENOMBRES)

    op.bulk_insert(grupos_musculares, [{"nombre": GRUPO}])
    grupo_ids = dict(
        conexion.execute(sa.select(grupos_musculares.c.nombre, grupos_musculares.c.id)).all()
    )
    ahora = datetime.now(timezone.utc)
    op.bulk_insert(
        ejercicios,
        [
            {
                "nombre": nombre,
                "grupo_muscular_id": grupo_ids[grupo],
                "es_predefinido": True,
                "tipo_registro": tipo,
                "created_at": ahora,
                "updated_at": ahora,
            }
            for nombre, grupo, tipo in NUEVOS
        ],
    )


def downgrade() -> None:
    conexion = op.get_bind()

    # Los nuevos, usados, no se pueden quitar: sus series, huecos y notas se perderían (o la
    # base no lo dejaría). Los renombrados no cuentan: conservan sus usos con el nombre viejo.
    usos = _cuantos_usos(conexion, NOMBRES_NUEVOS)
    if usos:
        raise RuntimeError(
            f"No se puede deshacer la siembra: los ejercicios nuevos ya se usan ({usos} "
            "series, huecos, alternativas o notas)."
        )
    propios = conexion.execute(
        sa.text(
            """
            SELECT count(*) FROM ejercicios e
            WHERE NOT e.es_predefinido
              AND e.grupo_muscular_id IN (SELECT id FROM grupos_musculares WHERE nombre = :grupo)
            """
        ),
        {"grupo": GRUPO},
    ).scalar()
    if propios:
        raise RuntimeError(
            f'No se puede deshacer la siembra: hay {propios} ejercicio(s) propios en el grupo "'
            f'{GRUPO}".'
        )
    no_unicos = _predefinidos_no_unicos(conexion, DESTINOS)
    if no_unicos:
        raise RuntimeError(
            "No se pueden deshacer los cambios de nombre: falta o está repetido "
            f"{', '.join(no_unicos)}."
        )
    existentes = _ya_usados(conexion, VIEJOS)
    if existentes:
        raise RuntimeError(
            "No se pueden deshacer los cambios de nombre: ya hay ejercicios llamados "
            f"{', '.join(existentes)}. Cámbiales el nombre antes."
        )

    op.execute(
        ejercicios.delete().where(
            ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre.in_(NOMBRES_NUEVOS)
        )
    )
    op.execute(grupos_musculares.delete().where(grupos_musculares.c.nombre == GRUPO))
    _renombrar([(nuevo, viejo) for viejo, nuevo in RENOMBRES])
