"""Comprueba que el andamiaje de los tests está bien montado.

No prueba lógica de negocio: verifica que las migraciones se aplicaron sobre la
base de tests y que los datos sembrados están donde deben, y que las migraciones
que pueden negarse a aplicarse se niegan cuando toca.
"""

import os
from pathlib import Path

import pytest

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
    assert len(nombres) == 17
    assert {"Pecho", "Trapecio", "Aductores", "Abductores"} <= set(nombres)


def propios(cliente) -> list:
    """Los ejercicios propios: los predefinidos están siempre, sembrados."""
    return [e for e in cliente.get("/ejercicios").json() if not e["es_predefinido"]]


def test_las_migraciones_sembraron_los_ejercicios_predefinidos(cliente):
    predefinidos = [e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]
    assert len(predefinidos) == 59
    assert "Press banca con barra" in [e["nombre"] for e in predefinidos]


def test_cada_test_arranca_sin_ejercicios_propios(cliente, grupo_muscular_id):
    """La limpieza entre tests funciona: este crea uno y el siguiente no lo verá.
    Los predefinidos, en cambio, siguen ahí.
    """
    assert propios(cliente) == []
    crear_ejercicio(cliente, grupo_muscular_id)
    assert len(propios(cliente)) == 1


def test_el_ejercicio_del_test_anterior_ya_no_esta(cliente):
    assert propios(cliente) == []
    assert len(cliente.get("/ejercicios").json()) == 59


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
    assert len(cliente.get("/grupos-musculares").json()) == 17
    assert len([e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]) == 59
    assert cliente.post("/rutinas", json={"nombre": "Push"}).status_code == 201


# --- La migración que quitó el entrenamiento libre ------------------------


def test_la_migracion_que_exige_rutina_y_hueco_se_niega_si_quedan_datos_libres():
    """`entrenamientos.rutina_id` y `series.slot_id` pasaron a NOT NULL. Si quedan
    una sesión sin rutina o una serie sin hueco, la migración no las borra ni se
    inventa nada: se para y dice cuáles son. Se comprueba bajando la base a la
    versión anterior y volviendo a subirla con esos datos dentro.
    """
    from alembic import command
    from sqlalchemy import text

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, "0a3efc993007")
    try:
        with engine.begin() as conexion:
            libre = conexion.scalar(
                text(
                    "INSERT INTO entrenamientos (usuario_id, fecha, created_at, updated_at) "
                    "VALUES (1, '2026-09-01', now(), now()) RETURNING id"
                ),
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


# --- La migración que quitó los usuarios -----------------------------------
#
# Antes de `a7c3f19b2d84` todo tenía `usuario_id` y había una tabla `usuarios`. Al
# quitarlos, todo pasa a ser «los datos», y al bajar todo vuelve al usuario 1, el
# único con el que la API pudo escribir.

ANTES_DE_QUITAR_USUARIOS = "c96823b23d81"
# Los nombres de entonces: las notas se llamaban `notas_usuario_ejercicio` hasta
# `b4e81d2c6f07`, que va por encima.
TABLAS_CON_USUARIO = (
    "notas_usuario_ejercicio",
    "rutinas",
    "entrenamientos",
    "programas",
    "programa_periodos",
    "excepciones_del_plan",
)


def test_quitar_los_usuarios_y_volver_a_ponerlos_no_pierde_nada(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id
):
    """Con todo lo que pueden tener los datos (el escenario de `test_datos.py`: un
    ejercicio propio oculto, notas en un propio y en un predefinido, rutinas con
    huecos y comodines, sesiones con series, un programa con su periodo abierto y
    excepciones): al bajar, todo es del usuario 1 y los predefinidos de nadie; al
    volver a subir, la exportación sale idéntica, ids incluidos.
    """
    from alembic import command
    from sqlalchemy import text

    from app.database import engine
    from tests.test_datos import HOY, exportado, montar_datos, sin_marca

    hoy_es(HOY)
    montar_datos(sesion_bd, ejercicio_predefinido_id)
    # Sin transacciones abiertas que bloqueen los ALTER TABLE de la migración.
    sesion_bd.close()
    antes = exportado(cliente)
    configuracion = _configuracion_de_alembic()
    engine.dispose()
    try:
        command.downgrade(configuracion, ANTES_DE_QUITAR_USUARIOS)
        with engine.connect() as conexion:

            def valor(sql):
                return conexion.scalar(text(sql))

            assert valor("SELECT array_agg(id) FROM usuarios") == [1]
            # La siguiente fila de usuarios no chocaría con la 1.
            assert valor("SELECT last_value FROM usuarios_id_seq") == 1
            for tabla in TABLAS_CON_USUARIO:
                assert valor(f"SELECT count(*) FROM {tabla}") > 0, tabla
                assert valor(f"SELECT count(*) FROM {tabla} WHERE usuario_id <> 1") == 0, tabla
            propios_sin_el_1 = (
                "SELECT count(*) FROM ejercicios "
                "WHERE NOT es_predefinido AND usuario_id IS DISTINCT FROM 1"
            )
            assert valor("SELECT count(*) FROM ejercicios WHERE NOT es_predefinido") == 2
            assert valor(propios_sin_el_1) == 0
            predefinidos_con_dueno = (
                "SELECT count(*) FROM ejercicios WHERE es_predefinido AND usuario_id IS NOT NULL"
            )
            assert valor("SELECT count(*) FROM ejercicios WHERE es_predefinido") == 59
            assert valor(predefinidos_con_dueno) == 0
            assert valor("SELECT count(*) FROM ejercicios WHERE visibilidad <> 'privado'") == 0
            # Las restricciones vuelven con su nombre de entonces.
            restricciones = valor(
                "SELECT count(*) FROM pg_constraint WHERE conname IN ("
                "'entrenamientos_usuario_id_fecha_key', "
                "'entrenamientos_usuario_id_cubre_fecha_key', "
                "'excepciones_del_plan_usuario_id_fecha_key')"
            )
            assert restricciones == 3
            indice = valor(
                "SELECT count(*) FROM pg_indexes "
                "WHERE indexname = 'ix_programa_periodos_usuario_abierto'"
            )
            assert indice == 1

        engine.dispose()
        command.upgrade(configuracion, "head")
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    assert sin_marca(exportado(cliente)) == sin_marca(antes)


@pytest.mark.parametrize(
    "caso",
    ["rutina de otro usuario", "ejercicio de otro usuario", "predefinido con dueño"],
)
def test_quitar_los_usuarios_se_niega_si_hay_datos_que_no_son_del_usuario_1(caso):
    """Sin usuarios no se sabría de quién son: la migración no los borra ni los
    reparte, se para y lo dice, y la base se queda como estaba. Lo mismo con un
    ejercicio que se dice predefinido pero tiene dueño: `es_predefinido` pasa a ser
    lo único que los distingue.
    """
    from alembic import command
    from sqlalchemy import text

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, ANTES_DE_QUITAR_USUARIOS)
    try:
        with engine.begin() as conexion:
            otro = conexion.scalar(
                text(
                    "INSERT INTO usuarios (nombre, email, password_hash, created_at) "
                    "VALUES ('Otro', 'otro@example.com', 'x', now()) RETURNING id"
                )
            )
            assert otro != 1
            grupo = conexion.scalar(text("SELECT min(id) FROM grupos_musculares"))
            if caso == "rutina de otro usuario":
                conexion.execute(
                    text(
                        "INSERT INTO rutinas (usuario_id, nombre, created_at, updated_at) "
                        "VALUES (:u, 'Ajena', now(), now())"
                    ),
                    {"u": otro},
                )
                esperado = "rutinas 1"
            else:
                # Uno propio de otro, o uno «predefinido» del 1 (pasa la primera
                # comprobación y tiene que saltar la segunda).
                de_otro = caso == "ejercicio de otro usuario"
                conexion.execute(
                    text(
                        "INSERT INTO ejercicios (nombre, grupo_muscular_id, es_predefinido, "
                        "usuario_id, visibilidad, created_at, updated_at) "
                        "VALUES ('Raro', :g, :predefinido, :u, 'privado', now(), now())"
                    ),
                    {"g": grupo, "predefinido": not de_otro, "u": otro if de_otro else 1},
                )
                if de_otro:
                    esperado = "ejercicios 1"
                else:
                    esperado = "1 ejercicios donde es_predefinido no coincide"

        engine.dispose()
        with pytest.raises(RuntimeError) as error:
            command.upgrade(configuracion, "head")

        assert esperado in str(error.value)
        with engine.connect() as conexion:
            # Nada ha cambiado: sigue en la versión de antes, con sus usuarios.
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
            assert version == ANTES_DE_QUITAR_USUARIOS
            usuarios = conexion.scalar(text("SELECT count(*) FROM usuarios"))
            assert usuarios == 2
    finally:
        engine.dispose()
        with engine.begin() as conexion:
            conexion.execute(text("DELETE FROM rutinas WHERE nombre = 'Ajena'"))
            conexion.execute(text("DELETE FROM ejercicios WHERE nombre = 'Raro'"))
            conexion.execute(text("DELETE FROM usuarios WHERE id <> 1"))
        command.upgrade(configuracion, "head")


# --- La migración que renombró las notas -----------------------------------
#
# Sin usuarios, `notas_usuario_ejercicio` pasó a llamarse `notas_ejercicio`.
# `rename_table` no toca la secuencia ni las restricciones: la migración las
# renombra aparte, y al bajar tienen que volver con su nombre de antes.

ANTES_DE_RENOMBRAR_NOTAS = "a7c3f19b2d84"


def _nombres_de_las_notas(conexion, tabla: str) -> dict:
    """Si existe la tabla, su secuencia y sus dos restricciones con el nombre que
    les toca a `tabla`.
    """
    from sqlalchemy import text

    def existe(sql, nombre):
        return conexion.scalar(text(sql), {"n": nombre}) == 1

    return {
        "tabla": existe("SELECT count(*) FROM pg_tables WHERE tablename = :n", tabla),
        "secuencia": existe(
            "SELECT count(*) FROM pg_sequences WHERE sequencename = :n", f"{tabla}_id_seq"
        ),
        "pkey": existe("SELECT count(*) FROM pg_constraint WHERE conname = :n", f"{tabla}_pkey"),
        "fkey": existe(
            "SELECT count(*) FROM pg_constraint WHERE conname = :n",
            f"{tabla}_ejercicio_id_fkey",
        ),
    }


TODO_CON_ESE_NOMBRE = {"tabla": True, "secuencia": True, "pkey": True, "fkey": True}
NADA_CON_ESE_NOMBRE = {"tabla": False, "secuencia": False, "pkey": False, "fkey": False}


def test_renombrar_las_notas_y_volver_atras_no_pierde_ninguna(cliente, ejercicio_predefinido_id):
    """Al bajar, la tabla, su secuencia y sus restricciones recuperan el nombre de
    `notas_usuario_ejercicio`, con la nota dentro; al volver a subir, todo se llama
    `notas_ejercicio`, la nota sigue y se puede escribir otra (la secuencia renombrada
    es la que usa la columna `id`).
    """
    from alembic import command
    from sqlalchemy import text

    from app.database import engine

    ruta = f"/ejercicios/{ejercicio_predefinido_id}/notas"
    creada = cliente.post(ruta, json={"nota": "Asiento en el 4"})
    assert creada.status_code == 201
    nota = creada.json()
    configuracion = _configuracion_de_alembic()
    engine.dispose()
    try:
        command.downgrade(configuracion, ANTES_DE_RENOMBRAR_NOTAS)
        with engine.connect() as conexion:
            assert _nombres_de_las_notas(conexion, "notas_usuario_ejercicio") == (
                TODO_CON_ESE_NOMBRE
            )
            assert _nombres_de_las_notas(conexion, "notas_ejercicio") == NADA_CON_ESE_NOMBRE
            filas = conexion.execute(
                text("SELECT id, ejercicio_id, nota FROM notas_usuario_ejercicio")
            ).all()
            assert [tuple(fila) for fila in filas] == [
                (nota["id"], ejercicio_predefinido_id, "Asiento en el 4")
            ]
            # La secuencia sigue siendo la de la columna, no una suelta con otro nombre.
            secuencia = conexion.scalar(
                text("SELECT pg_get_serial_sequence('notas_usuario_ejercicio', 'id')")
            )
            assert secuencia == "public.notas_usuario_ejercicio_id_seq"

        engine.dispose()
        command.upgrade(configuracion, "head")
        with engine.connect() as conexion:
            assert _nombres_de_las_notas(conexion, "notas_ejercicio") == TODO_CON_ESE_NOMBRE
            assert _nombres_de_las_notas(conexion, "notas_usuario_ejercicio") == (
                NADA_CON_ESE_NOMBRE
            )
            secuencia = conexion.scalar(
                text("SELECT pg_get_serial_sequence('notas_ejercicio', 'id')")
            )
            assert secuencia == "public.notas_ejercicio_id_seq"
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    otra = cliente.post(ruta, json={"nota": "Barra baja"})
    assert otra.status_code == 201
    assert otra.json()["id"] > nota["id"]
    textos = [n["nota"] for n in cliente.get(ruta).json()]
    assert sorted(textos) == ["Asiento en el 4", "Barra baja"]
