"""renombrar ocho predefinidos y anadir cinco

Revision ID: e3f7a1c92b04
Revises: 6dc16fa47939
Create Date: 2026-11-07 20:00:00.000000

Pone a ocho predefinidos el nombre con el que se conocen en el gimnasio, o su material o su
agarre («Contractor de pecho» pasa a «Pec deck», «Dominadas» a «Dominadas pronas»), añade cinco
(de 146 a 151), pasa a Isquiotibiales los dos pesos muertos que estaban en Espalda y cambia tres
descripciones. La lista viva está en shared/predefinidos.json.

Al cambiar el nombre se conservan sus ids, así que sus series, huecos y notas siguen en su sitio;
pero un archivo exportado antes que use un nombre viejo ya no se puede importar, porque los
predefinidos viajan por su nombre.

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e3f7a1c92b04"
down_revision: Union[str, None] = "6dc16fa47939"
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
    sa.column("descripcion"),
    sa.column("es_predefinido"),
    sa.column("tipo_registro"),
    sa.column("created_at"),
    sa.column("updated_at"),
)

# Todo congelado aquí y no leído de shared/predefinidos.json: la lista puede cambiar después y
# esta migración tiene que hacer siempre lo mismo.

# (nombre viejo, nombre nuevo). Ningún nombre nuevo está en NUEVOS: así el downgrade borra los
# cinco añadidos y no un renombrado.
RENOMBRES = [
    ("Contractor inverso", "Pec deck inverso"),
    ("Contractor de pecho", "Pec deck"),
    ("Peso muerto rumano", "Peso muerto rumano con barra"),
    ("Dominadas", "Dominadas pronas"),
    ("Curl martillo", "Curl martillo con mancuernas"),
    ("Remo en polea baja", "Remo en polea baja con agarre cerrado"),
    ("Remo en T", "Remo en T con agarre diagonal"),
    ("Peso muerto", "Peso muerto con barra"),
]
VIEJOS = [viejo for viejo, _ in RENOMBRES]
DESTINOS = [nuevo for _, nuevo in RENOMBRES]

# (nombre, grupo, tipo, descripción).
NUEVOS = [
    (
        "Curl con barra Z",
        "Bíceps",
        "peso_reps",
        "De pie, con la barra Z agarrada por debajo, las manos en sus tramos inclinados y los "
        "codos pegados al cuerpo. Sube la barra doblando los codos sin moverlos hacia delante "
        "y bájala despacio hasta estirar los brazos, sin balancear el tronco.",
    ),
    (
        "Curl martillo en polea",
        "Bíceps",
        "peso_reps",
        "De pie frente a una polea baja, con una cuerda agarrada por sus extremos, las palmas "
        "mirándose y los codos pegados al cuerpo. Sube doblando los codos sin girar las muñecas "
        "y baja despacio hasta estirar los brazos.",
    ),
    (
        "Peso muerto con barra hexagonal",
        "Isquiotibiales",
        "peso_reps",
        "De pie dentro de la barra hexagonal, con los pies a la anchura de la cadera. Baja la "
        "cadera, agarra las asas con las palmas mirándose y saca el pecho con la espalda recta. "
        "Levántala empujando el suelo con los pies hasta quedar de pie y bájala por el mismo "
        "camino.",
    ),
    (
        "Remo en polea baja con agarre abierto",
        "Espalda",
        "peso_reps",
        "Siéntate con los pies apoyados y las rodillas un poco flexionadas, y agarra la barra "
        "larga más abierta que los hombros, con los brazos estirados. Tira hacia la parte alta "
        "del abdomen llevando los codos atrás y abiertos, juntando los omóplatos, y vuelve "
        "despacio sin balancear el tronco.",
    ),
    (
        "Remo en T con agarre horizontal",
        "Espalda",
        "peso_reps",
        "Coge las asas anchas horizontales con las palmas hacia abajo y los brazos estirados. "
        "Con la espalda recta, tira hacia el pecho llevando los codos atrás y abiertos, y baja "
        "despacio hasta estirar los brazos, sin redondear la espalda.",
    ),
]
NOMBRES_NUEVOS = [nombre for nombre, _, _, _ in NUEVOS]

# {nombre ya cambiado: (vieja, nueva)}.
DESCRIPCIONES = {
    "Remo en polea baja con agarre cerrado": (
        "Siéntate con los pies apoyados y las rodillas un poco flexionadas, y agarra el asa con "
        "los brazos estirados. Tira hacia el abdomen llevando los codos atrás y juntando los "
        "omóplatos, con la espalda recta, y vuelve despacio sin balancear el tronco.",
        "Siéntate con los pies apoyados y las rodillas un poco flexionadas, y agarra el asa "
        "estrecha con las palmas mirándose y los brazos estirados. Tira hacia el abdomen "
        "llevando los codos atrás, pegados al cuerpo, y juntando los omóplatos, con la espalda "
        "recta, y vuelve despacio sin balancear el tronco.",
    ),
    "Remo en T con agarre diagonal": (
        "Con la barra entre las piernas y el agarre en el extremo, inclina el tronco con la "
        "espalda recta y las rodillas flexionadas. Tira hacia el pecho llevando los codos atrás "
        "y baja despacio sin incorporarte ni redondear la espalda.",
        "Coge las asas diagonales con las palmas mirando hacia dentro y los brazos estirados. "
        "Con la espalda recta, tira hacia el pecho llevando los codos atrás, pegados al cuerpo, "
        "y baja despacio hasta estirar los brazos, sin redondear la espalda.",
    ),
    "Curl en polea": (
        "De pie frente a una polea baja, con una barra o cuerda y los codos pegados al cuerpo. "
        "Sube doblando los codos sin moverlos hacia delante y baja despacio hasta estirar los "
        "brazos.",
        "De pie frente a una polea baja, con una barra y los codos pegados al cuerpo. Sube "
        "doblando los codos sin moverlos hacia delante y baja despacio hasta estirar los "
        "brazos.",
    ),
}

# {nombre ya cambiado: (grupo de antes, grupo de ahora)}.
CAMBIOS_DE_GRUPO = {
    "Peso muerto con barra": ("Espalda", "Isquiotibiales"),
    "Peso muerto con mancuernas": ("Espalda", "Isquiotibiales"),
}

# Los que cambian algo sin cambiar de nombre: también tienen que estar, en los dos sentidos.
SIN_RENOMBRAR = sorted((set(DESCRIPCIONES) | set(CAMBIOS_DE_GRUPO)) - set(DESTINOS))

GRUPOS = sorted(
    {grupo for _, grupo, _, _ in NUEVOS}
    | {grupo for pareja in CAMBIOS_DE_GRUPO.values() for grupo in pareja}
)

# Copia de app/nombres.py (una migración no importa de app): se compara como la API.
_SIN_TILDES = str.maketrans("áàâäéèêëíìîïóòôöúùûü", "aaaaeeeeiiiioooouuuu")


def _clave_de_nombre(nombre: str) -> str:
    return " ".join(nombre.split()).lower().translate(_SIN_TILDES)


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


def _predefinidos_que_chocan(conexion, nombres: list[str]) -> list[str]:
    """Los predefinidos que ya se llaman como uno de esos, comparando como la API. Solo los
    predefinidos: un propio que se llame igual convive con el nuevo.
    """
    claves = {_clave_de_nombre(nombre) for nombre in nombres}
    return [
        nombre
        for nombre in conexion.execute(
            sa.select(ejercicios.c.nombre).where(ejercicios.c.es_predefinido.is_(True))
        ).scalars()
        if _clave_de_nombre(nombre) in claves
    ]


def _ids_de_grupos(conexion) -> dict[str, int]:
    """Los ids de los grupos que se usan. Error si falta alguno."""
    ids = dict(
        conexion.execute(
            sa.select(grupos_musculares.c.nombre, grupos_musculares.c.id).where(
                grupos_musculares.c.nombre.in_(GRUPOS)
            )
        ).all()
    )
    faltan = [grupo for grupo in GRUPOS if grupo not in ids]
    if faltan:
        raise RuntimeError(f"Faltan grupos musculares: {', '.join(faltan)}.")
    return ids


def _renombrar(pares: list[tuple[str, str]]) -> None:
    # op.execute no pasa por el onupdate del ORM: updated_at se pone a mano.
    ahora = datetime.now(timezone.utc)
    for desde, hasta in pares:
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre == desde)
            .values(nombre=hasta, updated_at=ahora)
        )


def _poner_descripciones(cual: int) -> None:
    ahora = datetime.now(timezone.utc)
    for nombre, textos in DESCRIPCIONES.items():
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre == nombre)
            .values(descripcion=textos[cual], updated_at=ahora)
        )


def _poner_grupos(cual: int, grupo_ids: dict[str, int]) -> None:
    ahora = datetime.now(timezone.utc)
    for nombre, grupos in CAMBIOS_DE_GRUPO.items():
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre == nombre)
            .values(grupo_muscular_id=grupo_ids[grupos[cual]], updated_at=ahora)
        )


def upgrade() -> None:
    conexion = op.get_bind()

    # Primero se comprueba todo y solo después se escribe: si algo no cuadra, mejor un error
    # que lo diga que unos cambios a medias.
    grupo_ids = _ids_de_grupos(conexion)
    no_unicos = _predefinidos_no_unicos(conexion, VIEJOS + SIN_RENOMBRAR)
    if no_unicos:
        raise RuntimeError(
            "No se pueden cambiar los predefinidos: falta o está repetido "
            f"{', '.join(no_unicos)}."
        )
    chocan = _predefinidos_que_chocan(conexion, DESTINOS + NOMBRES_NUEVOS)
    if chocan:
        raise RuntimeError(
            "Ya hay predefinidos con el nombre de los nuevos o de los renombrados: "
            f"{', '.join(chocan)}."
        )

    _renombrar(RENOMBRES)
    _poner_descripciones(1)
    _poner_grupos(1, grupo_ids)
    ahora = datetime.now(timezone.utc)
    op.bulk_insert(
        ejercicios,
        [
            {
                "nombre": nombre,
                "grupo_muscular_id": grupo_ids[grupo],
                "descripcion": descripcion,
                "es_predefinido": True,
                "tipo_registro": tipo,
                "created_at": ahora,
                "updated_at": ahora,
            }
            for nombre, grupo, tipo, descripcion in NUEVOS
        ],
    )


def downgrade() -> None:
    conexion = op.get_bind()

    # Los nuevos, usados, no se pueden quitar: sus series, huecos y notas se perderían (o la
    # base no lo dejaría). Los renombrados no cuentan: conservan sus usos con el nombre viejo.
    usos = _cuantos_usos(conexion, NOMBRES_NUEVOS)
    if usos:
        raise RuntimeError(
            f"No se puede deshacer: los ejercicios nuevos ya se usan ({usos} series, huecos, "
            "alternativas o notas)."
        )
    grupo_ids = _ids_de_grupos(conexion)
    no_unicos = _predefinidos_no_unicos(conexion, DESTINOS + NOMBRES_NUEVOS + SIN_RENOMBRAR)
    if no_unicos:
        raise RuntimeError(f"No se puede deshacer: falta o está repetido {', '.join(no_unicos)}.")
    chocan = _predefinidos_que_chocan(conexion, VIEJOS)
    if chocan:
        raise RuntimeError(
            f"No se puede deshacer: ya hay predefinidos llamados {', '.join(chocan)}."
        )

    op.execute(
        ejercicios.delete().where(
            ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre.in_(NOMBRES_NUEVOS)
        )
    )
    _poner_descripciones(0)
    _poner_grupos(0, grupo_ids)
    # Lo último: las descripciones y los grupos se buscan por el nombre ya cambiado.
    _renombrar([(nuevo, viejo) for viejo, nuevo in RENOMBRES])
