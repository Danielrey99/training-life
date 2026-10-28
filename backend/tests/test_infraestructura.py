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

import json
import os
from pathlib import Path

from tests.ayudas import crear_ejercicio

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


def _lista_de_predefinidos() -> dict:
    """`shared/predefinidos.json`: los grupos y los ejercicios predefinidos que deja
    la siembra.
    """
    ruta = BACKEND_DIR.parent / "shared" / "predefinidos.json"
    return json.loads(ruta.read_text(encoding="utf-8"))


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
    assert len(cliente.get("/ejercicios").json()) == len(_lista_de_predefinidos()["ejercicios"])


# --- La cadena entera de migraciones --------------------------------------


def test_la_cadena_de_migraciones_baja_hasta_el_principio_y_vuelve_a_subir_entera(cliente):
    """`conftest.py` solo sube lo que falte: en una base de tests que ya existe, la
    cadena desde cero no se vuelve a recorrer. Aquí se baja hasta antes de la primera
    migración (no queda ni una tabla) y se sube hasta la última, y la base queda
    como dicen los modelos: sin usuarios, con las restricciones globales que los
    sustituyeron, las notas con su nombre nuevo, las series sin la columna del RPE
    (se quitó de la app: la migración la borra, no la deja huérfana) y lo sembrado
    otra vez en su sitio.
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

            def nombres(sql):
                return set(conexion.scalars(text(sql)).all())

            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
            assert version == ScriptDirectory.from_config(configuracion).get_current_head()
            assert "usuarios" not in nombres("SELECT tablename FROM pg_tables")
            assert "notas_ejercicio" in nombres("SELECT tablename FROM pg_tables")
            assert "notas_usuario_ejercicio" not in nombres("SELECT tablename FROM pg_tables")
            columnas = nombres(
                "SELECT table_name || '.' || column_name FROM information_schema.columns "
                "WHERE table_schema = 'public'"
            )
            assert not {c for c in columnas if c.endswith((".usuario_id", ".visibilidad"))}
            assert "series.peso" in columnas and "series.rpe" not in columnas
            assert {
                "ejercicios.tipo_registro",
                "series.duracion_s",
                "series.peso_corporal",
                "series.distancia_m",
            } <= columnas
            assert {
                "ejercicios_tipo_registro_check",
                "series_medidas_check",
                "series_peso_check",
                "series_duracion_check",
                "series_peso_corporal_check",
                "series_distancia_check",
                "rutina_slots_objetivo_check",
                "slot_alternativas_objetivo_check",
            } <= nombres("SELECT conname FROM pg_constraint WHERE contype = 'c'")
            assert {
                "rutina_slots.duracion_min_s",
                "rutina_slots.duracion_max_s",
            } | {
                f"slot_alternativas.{columna}"
                for columna in (
                    "series_objetivo",
                    "reps_min",
                    "reps_max",
                    "duracion_min_s",
                    "duracion_max_s",
                )
            } <= columnas
            nulables = nombres(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'series' AND is_nullable = 'YES'"
            )
            assert {
                "peso",
                "repeticiones",
                "duracion_s",
                "peso_corporal",
                "distancia_m",
            } <= nulables
            assert {
                "entrenamientos_fecha_key",
                "entrenamientos_cubre_fecha_key",
                "excepciones_del_plan_fecha_key",
            } <= nombres("SELECT conname FROM pg_constraint WHERE contype = 'u'")
            indice = conexion.scalar(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_programa_periodos_abierto'"
                )
            )
            assert indice is not None and "UNIQUE" in indice and "hasta IS NULL" in indice
            assert not nombres("SELECT conname FROM pg_constraint WHERE conname LIKE '%usuario%'")
            assert not nombres("SELECT indexname FROM pg_indexes WHERE indexname LIKE '%usuario%'")
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    # Lo sembrado vuelve, y la API funciona sobre la base recién subida.
    lista = _lista_de_predefinidos()
    assert len(cliente.get("/grupos-musculares").json()) == len(lista["grupos"])
    predefinidos = [e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]
    assert len(predefinidos) == len(lista["ejercicios"])
    assert cliente.post("/rutinas", json={"nombre": "Push"}).status_code == 201


# --- Lo sembrado, tal como queda en la última migración -------------------------


TIPOS_DE_REGISTRO = {"peso_reps", "corporal", "tiempo", "cardio"}


def test_la_siembra_coincide_con_la_lista_de_predefinidos(cliente):
    """`shared/predefinidos.json` es la fuente que copiará la app móvil para sembrar
    los suyos, así que tiene que decir exactamente lo que dejan las migraciones: ni
    un grupo ni un ejercicio de más o de menos, cada uno en su grupo y con su tipo.
    Renombrar un predefinido o un grupo rompe además los archivos de exportación,
    que los nombran por su nombre: este test lo caza en cualquiera de los dos lados.
    """
    lista = _lista_de_predefinidos()
    grupos = cliente.get("/grupos-musculares").json()
    # Ordenadas, para que un nombre repetido en un lado tampoco pase.
    assert sorted(g["nombre"] for g in grupos) == sorted(lista["grupos"])

    nombre_del_grupo = {g["id"]: g["nombre"] for g in grupos}
    predefinidos = [e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]
    assert len(predefinidos) == len(lista["ejercicios"])
    en_la_api = {
        e["nombre"]: (nombre_del_grupo[e["grupo_muscular_id"]], e["tipo_registro"])
        for e in predefinidos
    }
    en_la_lista = {e["nombre"]: (e["grupo"], e["tipo_registro"]) for e in lista["ejercicios"]}
    assert en_la_api == en_la_lista


def test_la_lista_de_predefinidos_es_coherente():
    """Sin base de datos: la lista no se contradice a sí misma. Un nombre repetido
    (también solo cambiando mayúsculas) chocaría al sembrar; un grupo o un tipo que
    no existe no se podría sembrar; un grupo sin ejercicios no sirve de nada; y el
    grupo Cardio es justo el de los ejercicios de cardio.
    """
    lista = _lista_de_predefinidos()
    grupos = lista["grupos"]
    ejercicios = lista["ejercicios"]

    assert len({g.casefold() for g in grupos}) == len(grupos)
    nombres = [e["nombre"] for e in ejercicios]
    assert len({n.casefold() for n in nombres}) == len(nombres)
    for ejercicio in ejercicios:
        assert set(ejercicio) == {"nombre", "grupo", "tipo_registro"}, ejercicio
        assert ejercicio["nombre"].strip() == ejercicio["nombre"] != "", ejercicio
        assert ejercicio["grupo"] in grupos, ejercicio
        assert ejercicio["tipo_registro"] in TIPOS_DE_REGISTRO, ejercicio
        assert (ejercicio["grupo"] == "Cardio") == (ejercicio["tipo_registro"] == "cardio"), (
            ejercicio
        )
    assert {e["grupo"] for e in ejercicios} == set(grupos)
