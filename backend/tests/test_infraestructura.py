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


def test_las_migraciones_sembraron_los_grupos_musculares(cliente):
    nombres = [grupo["nombre"] for grupo in cliente.get("/grupos-musculares").json()]
    assert len(nombres) == 18
    assert {"Pecho", "Trapecio", "Aductores", "Abductores"} <= set(nombres)


def propios(cliente) -> list:
    """Los ejercicios propios: los predefinidos están siempre, sembrados."""
    return [e for e in cliente.get("/ejercicios").json() if not e["es_predefinido"]]


# Los predefinidos que no son de peso y repeticiones, y los tres que añadió la siembra
# por tipos (`e8c4d1b97a36`); los de cardio, de `f9a2b6c83d15`.
CARDIO_PREDEFINIDOS = ["Cinta de correr", "Bicicleta estática", "Elíptica", "Remo ergómetro"]
A_CORPORAL = [
    "Dominadas",
    "Fondos en paralelas",
    "Elevación de piernas colgado",
    "Hiperextensiones",
    "Russian twist",
    "Puente de glúteo",
]
A_TIEMPO = ["Plancha", "Paseo del granjero"]
NUEVOS_POR_TIPO = [
    ("Flexiones", "Pecho", "corporal"),
    ("Crunch abdominal", "Abdomen", "corporal"),
    ("Plancha lateral", "Oblicuos", "tiempo"),
]


def test_cada_test_arranca_sin_ejercicios_propios(cliente, grupo_muscular_id):
    """La limpieza entre tests funciona: este crea uno y el siguiente no lo verá.
    Los predefinidos, en cambio, siguen ahí.
    """
    assert propios(cliente) == []
    crear_ejercicio(cliente, grupo_muscular_id)
    assert len(propios(cliente)) == 1


def test_el_ejercicio_del_test_anterior_ya_no_esta(cliente):
    assert propios(cliente) == []
    assert len(cliente.get("/ejercicios").json()) == 66


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
    assert len(cliente.get("/grupos-musculares").json()) == 18
    assert len([e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]) == 66
    assert cliente.post("/rutinas", json={"nombre": "Push"}).status_code == 201


# --- Lo sembrado, tal como queda en la última migración -------------------------


def _tipos_de_los_predefinidos(cliente) -> dict:
    grupos = {g["id"]: g["nombre"] for g in cliente.get("/grupos-musculares").json()}
    return {
        e["nombre"]: (e["tipo_registro"], grupos[e["grupo_muscular_id"]])
        for e in cliente.get("/ejercicios").json()
        if e["es_predefinido"]
    }


def test_la_siembra_deja_66_predefinidos_con_los_tipos_esperados(cliente):
    tipos = _tipos_de_los_predefinidos(cliente)
    assert len(tipos) == 66

    for nombre, grupo, tipo in NUEVOS_POR_TIPO:
        assert tipos[nombre] == (tipo, grupo)
    # Exactamente los de la lista, ni uno más de cada tipo.
    assert {n for n, (t, _) in tipos.items() if t == "corporal"} == set(A_CORPORAL) | {
        "Flexiones",
        "Crunch abdominal",
    }
    assert {n for n, (t, _) in tipos.items() if t == "tiempo"} == set(A_TIEMPO) | {
        "Plancha lateral"
    }
    # Los cuatro de cardio, en su grupo, y ningún otro en él.
    assert {n for n, (t, _) in tipos.items() if t == "cardio"} == set(CARDIO_PREDEFINIDOS)
    assert {n for n, (_, g) in tipos.items() if g == "Cardio"} == set(CARDIO_PREDEFINIDOS)
    # Parecidos que se quedan como estaban.
    for nombre in ["Zancadas", "Sentadilla búlgara", "Crunch en polea", "Hip thrust"]:
        assert tipos[nombre][0] == "peso_reps", nombre
    talones = [(n, t) for n, (t, _) in tipos.items() if n.startswith("Elevación de talones")]
    assert len(talones) == 2
    assert {t for _, t in talones} == {"peso_reps"}
