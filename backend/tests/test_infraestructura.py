"""Comprueba que el andamiaje de los tests está bien montado.

No prueba lógica de negocio: verifica que la limpieza entre tests funciona, que la
cadena entera de migraciones baja y sube desde cero y que lo sembrado está donde
debe.

Las negativas de cada migración a subir o bajar con datos dentro (siembras, tipos,
objetivo por ejercicio, usuarios…) se probaron al escribirlas y ya no se prueban: la
base de desarrollo pasó por todas, y una instalación nueva las recorre sobre una base
vacía, donde no pueden saltar. Una migración nueva que se niegue con datos lleva aquí
su test mientras haya bases que no la hayan pasado.
"""

import os
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.fechas import hoy
from app.nombres import clave_de_nombre
from tests.ayudas import (
    crear_ejercicio,
    crear_hueco,
    crear_rutina,
    entrenar,
    lista_de_predefinidos,
    serie_en,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _configuracion_de_alembic():
    """La de `alembic.ini`, con las rutas absolutas para que no dependa de desde
    dónde se lance pytest.
    """
    from alembic.config import Config

    # Bajar y subir versiones es destructivo: solo contra la base de tests.
    assert os.environ["DATABASE_URL"].endswith("/training_life_test")
    configuracion = Config(str(BACKEND_DIR / "alembic.ini"))
    configuracion.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return configuracion


def test_la_api_responde(cliente):
    respuesta = cliente.get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"status": "ok"}


def propios(cliente) -> list:
    """Los ejercicios propios: los predefinidos están siempre, sembrados."""
    return [e for e in cliente.get("/ejercicios").json() if not e["es_predefinido"]]


def test_cada_test_arranca_sin_ejercicios_propios(cliente, grupo_muscular_id):
    """La limpieza entre tests funciona: este crea uno y el siguiente no lo verá.
    Los predefinidos, en cambio, siguen ahí.
    """
    assert propios(cliente) == []
    crear_ejercicio(cliente, grupo_muscular_id)
    assert len(propios(cliente)) == 1


def test_el_ejercicio_del_test_anterior_ya_no_esta(cliente):
    assert propios(cliente) == []
    assert len(cliente.get("/ejercicios").json()) == len(lista_de_predefinidos()["ejercicios"])


# --- El esquema que dejan las migraciones es el de los modelos ---------------
#
# Tablas, columnas (con su tipo y si admiten nulos), claves foráneas (con su ON
# DELETE: CASCADE o RESTRICT es una decisión del diseño), unicidades, CHECK por su
# nombre e índices (con su condición, si son parciales). Una columna que una
# migración olvida quitar (como hicieron en su día los usuarios o el RPE), un
# `String(100)` que se queda en 50 o un RESTRICT que pasa a NO ACTION salen aquí.


def _sin_parentesis(condicion) -> str | None:
    return None if condicion is None else str(condicion).strip("()")


def esquema_de_la_base(conexion) -> dict[str, set]:
    from sqlalchemy import inspect
    from sqlalchemy.dialects import postgresql

    inspector = inspect(conexion)
    tablas = set(inspector.get_table_names()) - {"alembic_version"}
    esquema = {clave: set() for clave in ("columnas", "fks", "unicas", "checks", "indices")}
    esquema["tablas"] = tablas
    for tabla in tablas:
        for columna in inspector.get_columns(tabla):
            tipo = columna["type"].compile(dialect=postgresql.dialect())
            esquema["columnas"].add((tabla, columna["name"], tipo, columna["nullable"]))
        for fk in inspector.get_foreign_keys(tabla):
            esquema["fks"].add(
                (
                    tabla,
                    tuple(fk["constrained_columns"]),
                    fk["referred_table"],
                    fk["options"].get("ondelete"),
                )
            )
        for unica in inspector.get_unique_constraints(tabla):
            esquema["unicas"].add((tabla, tuple(sorted(unica["column_names"]))))
        for check in inspector.get_check_constraints(tabla):
            esquema["checks"].add((tabla, check["name"]))
        for indice in inspector.get_indexes(tabla):
            if "duplicates_constraint" in indice:
                continue  # el índice que Postgres crea por debajo de un UNIQUE
            condicion = indice.get("dialect_options", {}).get("postgresql_where")
            esquema["indices"].add(
                (tabla, indice["name"], indice["unique"], _sin_parentesis(condicion))
            )
    return esquema


def esquema_de_los_modelos() -> dict[str, set]:
    from sqlalchemy import CheckConstraint, UniqueConstraint
    from sqlalchemy.dialects import postgresql

    import app.models  # noqa: F401  (registra las tablas en el metadata)
    from app.database import Base

    esquema = {clave: set() for clave in ("columnas", "fks", "unicas", "checks", "indices")}
    esquema["tablas"] = set(Base.metadata.tables)
    for tabla in Base.metadata.tables.values():
        for columna in tabla.columns:
            tipo = columna.type.compile(dialect=postgresql.dialect())
            esquema["columnas"].add((tabla.name, columna.name, tipo, columna.nullable))
            if columna.unique:
                esquema["unicas"].add((tabla.name, (columna.name,)))
        for fk in tabla.foreign_keys:
            esquema["fks"].add((tabla.name, (fk.parent.name,), fk.column.table.name, fk.ondelete))
        for restriccion in tabla.constraints:
            if isinstance(restriccion, UniqueConstraint):
                columnas = tuple(sorted(c.name for c in restriccion.columns))
                esquema["unicas"].add((tabla.name, columnas))
            elif isinstance(restriccion, CheckConstraint):
                esquema["checks"].add((tabla.name, restriccion.name))
        for indice in tabla.indexes:
            condicion = indice.dialect_options["postgresql"]["where"]
            esquema["indices"].add(
                (tabla.name, indice.name, bool(indice.unique), _sin_parentesis(condicion))
            )
    return esquema


def comprobar_que_la_base_es_la_de_los_modelos() -> None:
    """Compara parte por parte, para que el fallo diga qué sobra y qué falta."""
    from app.database import engine

    with engine.connect() as conexion:
        en_la_base = esquema_de_la_base(conexion)
    en_los_modelos = esquema_de_los_modelos()
    for parte, esperado in en_los_modelos.items():
        assert {
            "sobra en la base": en_la_base[parte] - esperado,
            "falta en la base": esperado - en_la_base[parte],
        } == {"sobra en la base": set(), "falta en la base": set()}, parte


def test_la_base_de_tests_tiene_el_esquema_de_los_modelos(cliente):
    """La base de tests se sube migración a migración: un modelo cambiado sin su
    migración (o una migración que no hace lo que dice el modelo) sale aquí.
    """
    comprobar_que_la_base_es_la_de_los_modelos()


# --- La cadena entera de migraciones --------------------------------------


def test_la_cadena_de_migraciones_baja_hasta_el_principio_y_vuelve_a_subir_entera(cliente):
    """`conftest.py` solo sube lo que falte: en una base de tests que ya existe, la
    cadena desde cero no se vuelve a recorrer. Aquí se baja hasta antes de la primera
    migración (no queda ni una tabla) y se sube hasta la última, y la base queda
    exactamente como dicen los modelos (es lo que recorre una instalación nueva), con
    lo sembrado otra vez en su sitio.
    """
    from alembic import command
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    try:
        command.downgrade(configuracion, "base")
        with engine.connect() as conexion:
            tablas = conexion.scalars(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            ).all()
        assert tablas == ["alembic_version"]

        engine.dispose()
        command.upgrade(configuracion, "head")
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
        assert version == ScriptDirectory.from_config(configuracion).get_current_head()
        comprobar_que_la_base_es_la_de_los_modelos()
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    # Lo sembrado vuelve, y la API funciona sobre la base recién subida.
    lista = lista_de_predefinidos()
    assert len(cliente.get("/grupos-musculares").json()) == len(lista["grupos"])
    predefinidos = [e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]
    assert len(predefinidos) == len(lista["ejercicios"])
    assert cliente.post("/rutinas", json={"nombre": "Push"}).status_code == 201


# --- La migración que renombra ocho predefinidos y añade cinco --------------------
#
# Se niega con datos dentro, y hay bases que aún tienen que pasarla. Solo cambia datos:
# la API funciona igual en la revisión anterior, y con ella se lee y se monta lo que
# haga falta (sin `sesion_bd`, que dejaría una conexión abierta al bajar).

ANTES_DE_RENOMBRAR = "6dc16fa47939"
RENOMBRADOS_Y_ANADIDOS = "e3f7a1c92b04"
RENOMBRADOS = {
    "Contractor inverso": "Pec deck inverso",
    "Contractor de pecho": "Pec deck",
    "Peso muerto rumano": "Peso muerto rumano con barra",
    "Dominadas": "Dominadas pronas",
    "Curl martillo": "Curl martillo con mancuernas",
    "Remo en polea baja": "Remo en polea baja con agarre cerrado",
    "Remo en T": "Remo en T con agarre diagonal",
    "Peso muerto": "Peso muerto con barra",
}
ANADIDOS = {
    "Curl con barra Z",
    "Curl martillo en polea",
    "Peso muerto con barra hexagonal",
    "Remo en polea baja con agarre abierto",
    "Remo en T con agarre horizontal",
}


@contextmanager
def volviendo_a_head():
    """Da la configuración de Alembic y, pase lo que pase dentro, deja la base en la
    última revisión: una a medias rompería todos los tests siguientes.
    """
    from alembic import command

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    try:
        yield configuracion
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")


def bajar_a_antes_de_renombrar(configuracion) -> None:
    from alembic import command

    from app.database import engine

    engine.dispose()
    command.downgrade(configuracion, ANTES_DE_RENOMBRAR)


def subir_los_renombrados(configuracion) -> None:
    from alembic import command

    from app.database import engine

    engine.dispose()
    command.upgrade(configuracion, RENOMBRADOS_Y_ANADIDOS)


def version_de_la_base() -> str:
    from sqlalchemy import text

    from app.database import engine

    with engine.connect() as conexion:
        return conexion.scalar(text("SELECT version_num FROM alembic_version"))


def predefinidos_por_id(cliente) -> dict[int, tuple]:
    """Lo que cambia la migración de cada predefinido: nombre, grupo y descripción (y
    su tipo, que no debe cambiar).
    """
    grupos = {g["id"]: g["nombre"] for g in cliente.get("/grupos-musculares").json()}
    return {
        e["id"]: (
            e["nombre"],
            grupos[e["grupo_muscular_id"]],
            e["tipo_registro"],
            e["descripcion"],
        )
        for e in cliente.get("/ejercicios").json()
        if e["es_predefinido"]
    }


def id_del_predefinido(cliente, nombre) -> int:
    return next(id_ for id_, fila in predefinidos_por_id(cliente).items() if fila[0] == nombre)


def test_bajar_y_subir_los_renombrados_conserva_sus_ids_y_lo_que_los_usa(cliente):
    """En el camino de ida y vuelta, cada renombrado sigue siendo la misma fila, la
    serie y el hueco de las dominadas no se mueven, los dos pesos muertos cambian de
    grupo en los dos sentidos y lo que no toca la migración queda como estaba.
    """
    arriba = predefinidos_por_id(cliente)
    ids = {fila[0]: id_ for id_, fila in arriba.items()}
    dominadas = ids["Dominadas pronas"]
    rutina_id = crear_rutina(cliente)
    hueco_id = crear_hueco(cliente, rutina_id, dominadas)
    sesion_id = entrenar(cliente, hoy(), rutina_id).json()["id"]
    serie = serie_en(cliente, sesion_id, dominadas, slot_id=hueco_id, peso=0)
    assert serie.status_code == 201, serie.text

    def lo_que_usa_las_dominadas() -> list[tuple]:
        hueco = cliente.get(f"/rutinas/{rutina_id}").json()["slots"][0]
        guardada = cliente.get(f"/entrenamientos/{sesion_id}").json()["series"][0]
        return [
            (
                hueco["id"],
                hueco["ejercicio_principal"]["id"],
                hueco["ejercicio_principal"]["nombre"],
            ),
            (guardada["slot_id"], guardada["ejercicio"]["id"], guardada["ejercicio"]["nombre"]),
        ]

    with volviendo_a_head() as configuracion:
        bajar_a_antes_de_renombrar(configuracion)

        abajo = predefinidos_por_id(cliente)
        assert {viejo: abajo[ids[nuevo]][0] for viejo, nuevo in RENOMBRADOS.items()} == {
            viejo: viejo for viejo in RENOMBRADOS
        }
        assert {fila[0] for fila in abajo.values()}.isdisjoint(ANADIDOS)
        assert len(abajo) == len(arriba) - len(ANADIDOS)
        assert abajo[ids["Peso muerto con barra"]][1] == "Espalda"
        assert abajo[ids["Peso muerto con mancuernas"]][1] == "Espalda"
        # Una de las tres descripciones cambiadas, en uno que no se renombra.
        assert "con una barra o cuerda" in abajo[ids["Curl en polea"]][3]
        assert lo_que_usa_las_dominadas() == [(hueco_id, dominadas, "Dominadas")] * 2

        subir_los_renombrados(configuracion)

        vuelta = predefinidos_por_id(cliente)
        assert vuelta[ids["Peso muerto con barra"]][1] == "Isquiotibiales"
        assert vuelta[ids["Peso muerto con mancuernas"]][1] == "Isquiotibiales"
        assert lo_que_usa_las_dominadas() == [(hueco_id, dominadas, "Dominadas pronas")] * 2
        # Los añadidos se crean otra vez, con otro id; todos los demás, idénticos.
        assert {i: f for i, f in vuelta.items() if f[0] not in ANADIDOS} == {
            i: f for i, f in arriba.items() if f[0] not in ANADIDOS
        }
        assert sorted(vuelta.values()) == sorted(arriba.values())


@pytest.mark.parametrize("uso", ["hueco", "nota"])
def test_no_se_baja_si_un_ejercicio_anadido_se_usa_y_no_cambia_nada(cliente, uso):
    """Con el hueco, sin la comprobación, saltaría el RESTRICT de la base; con la nota
    sería peor, porque el CASCADE la borraría sin avisar.
    """
    curl = id_del_predefinido(cliente, "Curl con barra Z")
    rutina_id = crear_rutina(cliente)
    if uso == "hueco":
        crear_hueco(cliente, rutina_id, curl)
    else:
        respuesta = cliente.post(f"/ejercicios/{curl}/notas", json={"nota": "Agarre cómodo"})
        assert respuesta.status_code == 201, respuesta.text
    antes = predefinidos_por_id(cliente)
    version = version_de_la_base()

    with volviendo_a_head() as configuracion:
        with pytest.raises(RuntimeError, match=r"los ejercicios nuevos ya se usan \(1 series"):
            bajar_a_antes_de_renombrar(configuracion)
        assert version_de_la_base() == version

    assert predefinidos_por_id(cliente) == antes
    if uso == "hueco":
        huecos = cliente.get(f"/rutinas/{rutina_id}").json()["slots"]
        assert [h["ejercicio_principal"]["id"] for h in huecos] == [curl]
    else:
        notas = cliente.get(f"/ejercicios/{curl}/notas").json()
        assert [n["nota"] for n in notas] == ["Agarre cómodo"]


def test_un_propio_con_el_nombre_de_un_predefinido_no_impide_subir_y_los_dos_conviven(
    cliente, grupo_muscular_id
):
    """La siembra compara solo con los predefinidos. Vale tanto para un renombrado como
    para un añadido, aunque el propio cambie mayúsculas: ni se niega ni se toca.
    """
    with volviendo_a_head() as configuracion:
        bajar_a_antes_de_renombrar(configuracion)
        propios_antes = {
            crear_ejercicio(cliente, grupo_muscular_id, "Pec deck"): "Pec deck",
            crear_ejercicio(cliente, grupo_muscular_id, "CURL CON BARRA Z"): "CURL CON BARRA Z",
        }

        subir_los_renombrados(configuracion)

        assert version_de_la_base() == RENOMBRADOS_Y_ANADIDOS
        assert {e["id"]: e["nombre"] for e in propios(cliente)} == propios_antes
        nombres = [fila[0] for fila in predefinidos_por_id(cliente).values()]
        assert nombres.count("Pec deck") == 1
        assert nombres.count("Curl con barra Z") == 1


def test_si_falta_un_predefinido_viejo_no_se_sube_ni_se_renombra_ningun_otro(cliente):
    """Falta el último de la lista: si se renombrara sobre la marcha, los siete
    anteriores ya estarían cambiados cuando saltara el error.
    """
    from sqlalchemy import text

    from app.database import engine

    with volviendo_a_head() as configuracion:
        bajar_a_antes_de_renombrar(configuracion)
        with engine.begin() as conexion:
            apartado = conexion.scalar(
                text(
                    "UPDATE ejercicios SET nombre = 'Peso muerto apartado'"
                    " WHERE es_predefinido AND nombre = 'Peso muerto' RETURNING id"
                )
            )
        try:
            antes = predefinidos_por_id(cliente)

            with pytest.raises(RuntimeError, match=r"falta o está repetido Peso muerto\.$"):
                subir_los_renombrados(configuracion)

            assert predefinidos_por_id(cliente) == antes
            assert version_de_la_base() == ANTES_DE_RENOMBRAR
        finally:
            # Antes de que `volviendo_a_head` suba: con el nombre cambiado, se negaría.
            with engine.begin() as conexion:
                conexion.execute(
                    text("UPDATE ejercicios SET nombre = 'Peso muerto' WHERE id = :id"),
                    {"id": apartado},
                )


# --- Lo sembrado, tal como queda en la última migración -------------------------


TIPOS_DE_REGISTRO = {"peso_reps", "corporal", "tiempo", "cardio"}
LARGO_MINIMO_DE_DESCRIPCION = 60
LARGO_MAXIMO_DE_DESCRIPCION = 320


def test_la_siembra_coincide_con_la_lista_de_predefinidos(cliente):
    """`shared/predefinidos.json` es la fuente que copiará la app móvil para sembrar
    los suyos, así que tiene que decir exactamente lo que dejan las migraciones: ni
    un grupo ni un ejercicio de más o de menos, cada uno en su grupo, con su tipo y
    con su descripción.
    Renombrar un predefinido o un grupo rompe además los archivos de exportación,
    que los nombran por su nombre: este test lo caza en cualquiera de los dos lados.
    """
    lista = lista_de_predefinidos()
    grupos = cliente.get("/grupos-musculares").json()
    # Ordenadas, para que un nombre repetido en un lado tampoco pase.
    assert sorted(g["nombre"] for g in grupos) == sorted(lista["grupos"])

    nombre_del_grupo = {g["id"]: g["nombre"] for g in grupos}
    predefinidos = [e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]
    assert len(predefinidos) == len(lista["ejercicios"])
    en_la_api = {
        e["nombre"]: (
            nombre_del_grupo[e["grupo_muscular_id"]],
            e["tipo_registro"],
            e["descripcion"],
        )
        for e in predefinidos
    }
    en_la_lista = {
        e["nombre"]: (e["grupo"], e["tipo_registro"], e["descripcion"]) for e in lista["ejercicios"]
    }
    assert en_la_api == en_la_lista


def test_la_lista_de_predefinidos_es_coherente():
    """Sin base de datos: la lista no se contradice a sí misma. Un nombre repetido
    (también solo cambiando mayúsculas, tildes o espacios) chocaría al sembrar; un grupo
    o un tipo que no existe no se podría sembrar; un grupo sin ejercicios no sirve de nada; y el
    grupo Cardio es justo el de los ejercicios de cardio. Cada descripción es un texto
    de una sola línea, sin espacios sobrantes, de largo razonable (cabe en la columna
    de 500), distinto del nombre y que no repite la de otro ejercicio. Ni el nombre ni
    la descripción llevan «;», que ningún texto de la app usa («:» sí, para abrir una
    enumeración, así que ese no se mira).
    """
    lista = lista_de_predefinidos()
    grupos = lista["grupos"]
    ejercicios = lista["ejercicios"]

    assert len({g.casefold() for g in grupos}) == len(grupos)
    nombres = [e["nombre"] for e in ejercicios]
    # Con la clave de la API: dos que solo cambien en tildes o espacios tampoco.
    assert len({clave_de_nombre(n) for n in nombres}) == len(nombres)
    for ejercicio in ejercicios:
        assert set(ejercicio) == {"nombre", "grupo", "tipo_registro", "descripcion"}, ejercicio
        assert ejercicio["nombre"].strip() == ejercicio["nombre"] != "", ejercicio
        assert ejercicio["grupo"] in grupos, ejercicio
        assert ejercicio["tipo_registro"] in TIPOS_DE_REGISTRO, ejercicio
        assert (ejercicio["grupo"] == "Cardio") == (ejercicio["tipo_registro"] == "cardio"), (
            ejercicio
        )
        nombre = ejercicio["nombre"]
        texto = ejercicio["descripcion"]
        assert isinstance(texto, str), f"{nombre}: la descripción no es un texto"
        assert texto == texto.strip(), f"{nombre}: la descripción tiene espacios sobrantes"
        assert LARGO_MINIMO_DE_DESCRIPCION <= len(texto) <= LARGO_MAXIMO_DE_DESCRIPCION, (
            f"{nombre}: la descripción mide {len(texto)} caracteres"
        )
        assert "\n" not in texto and "\r" not in texto, f"{nombre}: la descripción tiene saltos"
        assert texto.casefold() != nombre.casefold(), f"{nombre}: la descripción es su nombre"
    descripciones = [e["descripcion"].casefold() for e in ejercicios]
    assert len(set(descripciones)) == len(descripciones), "hay descripciones repetidas"
    assert {e["grupo"] for e in ejercicios} == set(grupos)
    con_punto_y_coma = [
        e["nombre"] for e in ejercicios if ";" in e["nombre"] or ";" in e["descripcion"]
    ]
    assert con_punto_y_coma == [], f"llevan «;» en el nombre o la descripción: {con_punto_y_coma}"
