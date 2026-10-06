"""Comprueba que el andamiaje de los tests está bien montado.

No prueba lógica de negocio: verifica que las migraciones se aplicaron sobre la
base de tests y que los datos sembrados están donde deben, y que las migraciones
que pueden negarse a aplicarse se niegan cuando toca.
"""

import os
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_la_api_responde(cliente):
    respuesta = cliente.get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"status": "ok"}


def test_las_migraciones_sembraron_los_grupos_musculares(cliente):
    nombres = [grupo["nombre"] for grupo in cliente.get("/grupos-musculares").json()]
    assert len(nombres) == 17
    assert {"Pecho", "Trapecio", "Aductores", "Abductores"} <= set(nombres)


def propios(cliente) -> list:
    """Los ejercicios del usuario: los predefinidos están siempre, sembrados."""
    return [e for e in cliente.get("/ejercicios").json() if not e["es_predefinido"]]


def test_las_migraciones_sembraron_los_ejercicios_predefinidos(cliente):
    predefinidos = [e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]
    assert len(predefinidos) == 59
    assert all(e["usuario_id"] is None for e in predefinidos)
    assert "Press banca con barra" in [e["nombre"] for e in predefinidos]


def test_cada_test_arranca_sin_ejercicios_propios(cliente, grupo_muscular_id):
    """La limpieza entre tests funciona: este crea uno y el siguiente no lo verá.
    Los predefinidos, en cambio, siguen ahí.
    """
    assert propios(cliente) == []
    cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    )
    assert len(propios(cliente)) == 1


def test_el_ejercicio_del_test_anterior_ya_no_esta(cliente):
    assert propios(cliente) == []
    assert len(cliente.get("/ejercicios").json()) == 59


# --- La migración que quitó el entrenamiento libre ------------------------


def test_la_migracion_que_exige_rutina_y_hueco_se_niega_si_quedan_datos_libres():
    """`entrenamientos.rutina_id` y `series.slot_id` pasaron a NOT NULL. Si quedan
    una sesión sin rutina o una serie sin hueco, la migración no las borra ni se
    inventa nada: se para y dice cuáles son. Se comprueba bajando la base a la
    versión anterior y volviendo a subirla con esos datos dentro.
    """
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from app.auth import USUARIO_SEMBRADO_ID
    from app.database import engine

    # Bajar y subir versiones es destructivo: solo contra la base de tests.
    assert os.environ["DATABASE_URL"].endswith("/training_life_test")
    configuracion = Config(str(BACKEND_DIR / "alembic.ini"))
    configuracion.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    engine.dispose()
    command.downgrade(configuracion, "0a3efc993007")
    try:
        with engine.begin() as conexion:
            libre = conexion.scalar(
                text(
                    "INSERT INTO entrenamientos (usuario_id, fecha, created_at, updated_at) "
                    "VALUES (:usuario, '2026-09-01', now(), now()) RETURNING id"
                ),
                {"usuario": USUARIO_SEMBRADO_ID},
            )
            ejercicio = conexion.scalar(
                text("SELECT id FROM ejercicios WHERE es_predefinido LIMIT 1")
            )
            suelta = conexion.scalar(
                text(
                    "INSERT INTO series (entrenamiento_id, ejercicio_id, numero_serie, peso, "
                    "repeticiones, created_at, updated_at) VALUES (:e, :ej, 1, 60, 8, now(), now()) RETURNING id"
                ),
                {"e": libre, "ej": ejercicio},
            )

        with pytest.raises(RuntimeError) as error:
            command.upgrade(configuracion, "head")

        mensaje = str(error.value)
        assert f"sesiones sin rutina: id {libre} (2026-09-01)" in mensaje
        assert f"series sin hueco: id {suelta} (sesión {libre})" in mensaje
        with engine.connect() as conexion:
            quedan = conexion.execute(
                text("SELECT (SELECT count(*) FROM entrenamientos), (SELECT count(*) FROM series)")
            ).one()
        assert tuple(quedan) == (1, 1)
    finally:
        engine.dispose()
        with engine.begin() as conexion:
            conexion.execute(text("TRUNCATE series, entrenamientos RESTART IDENTITY CASCADE"))
        command.upgrade(configuracion, "head")
