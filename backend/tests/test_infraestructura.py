"""Comprueba que el andamiaje de los tests está bien montado.

No prueba lógica de negocio: verifica que las migraciones se aplicaron sobre la
base de tests y que los datos sembrados están donde deben, y que las migraciones
que pueden negarse a aplicarse se niegan cuando toca.
"""

import os
from pathlib import Path

import pytest
from sqlalchemy import text

from tests.ayudas import (
    alternativa,
    crear_ejercicio,
    objetivo,
    objetivo_de,
    poner_alternativas,
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


def test_las_migraciones_sembraron_los_grupos_musculares(cliente):
    nombres = [grupo["nombre"] for grupo in cliente.get("/grupos-musculares").json()]
    assert len(nombres) == 17
    assert {"Pecho", "Trapecio", "Aductores", "Abductores"} <= set(nombres)


def propios(cliente) -> list:
    """Los ejercicios propios: los predefinidos están siempre, sembrados."""
    return [e for e in cliente.get("/ejercicios").json() if not e["es_predefinido"]]


SIEMBRA_POR_TIPO = "e8c4d1b97a36"
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


def test_las_migraciones_sembraron_los_ejercicios_predefinidos(cliente):
    predefinidos = [e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]
    assert len(predefinidos) == 62
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
    assert len(cliente.get("/ejercicios").json()) == 62


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
            } <= columnas
            assert {
                "ejercicios_tipo_registro_check",
                "series_medidas_check",
                "series_peso_check",
                "series_duracion_check",
                "series_peso_corporal_check",
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
            assert {"peso", "repeticiones", "duracion_s", "peso_corporal"} <= nulables
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
    assert len([e for e in cliente.get("/ejercicios").json() if e["es_predefinido"]]) == 62
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


def test_renombrar_las_notas_y_volver_atras_no_pierde_ninguna(
    cliente, sesion_bd, ejercicio_predefinido_id
):
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
    # La fixture del predefinido deja abierta una transacción que lee `ejercicios`: el
    # ALTER TABLE de la migración de los tipos, que se baja por el camino, la esperaría
    # para siempre.
    sesion_bd.close()
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


# --- La migración de los tipos de ejercicio --------------------------------
#
# `c5a91e7d3b24` da un tipo a cada ejercicio (el que ya había, peso y repeticiones,
# por defecto) y deja el peso y las repeticiones de una serie poder ir nulos. Al
# bajar, una serie por tiempo o con una carga de ayuda no cabe en las columnas de
# antes: se niega, contando cuántas hay, y no toca nada.

ANTES_DE_LOS_TIPOS = "b4e81d2c6f07"
LOS_TIPOS = "c5a91e7d3b24"


@pytest.mark.parametrize(
    "tipo, medidas",
    [
        pytest.param("tiempo", {"duracion_s": 45}, id="una-serie-por-tiempo"),
        pytest.param("corporal", {"peso": -20, "repeticiones": 8}, id="una-serie-con-ayuda"),
    ],
)
def test_quitar_los_tipos_se_niega_si_hay_series_que_no_caben_y_no_toca_nada(
    cliente, grupo_muscular_id, tipo, medidas
):
    """Con una serie que no cabe y otra de peso y repeticiones que sí: la migración
    cuenta solo la que no cabe, la base sigue en su versión y las dos series siguen
    tal cual.

    La que no cabe se apunta con una alternativa que después se quita del hueco (la
    serie se queda): un hueco o una alternativa con el objetivo en segundos harían
    que se negara antes la migración del objetivo por ejercicio, que va encima, y no
    se llegaría a esta.
    """
    from alembic import command
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    from app.database import engine

    press = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo")
    otro = crear_ejercicio(cliente, grupo_muscular_id, "Otro", tipo=tipo)
    rutina = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    sesion = cliente.post("/entrenamientos", json={"rutina_id": rutina, "fecha": "2026-09-04"})
    ruta = f"/entrenamientos/{sesion.json()['id']}/series"
    del_otro = alternativa(otro, duracion=(30, 60) if tipo == "tiempo" else None)
    for orden, (principal, alternativas, ejercicio, cuerpo) in enumerate(
        [
            (press, [], press, {"peso": 60, "repeticiones": 8}),
            (remo, [del_otro], otro, medidas),
        ],
        start=1,
    ):
        respuesta = cliente.post(
            f"/rutinas/{rutina}/slots",
            json={
                "ejercicio_principal_id": principal,
                "orden": orden,
                **objetivo(3, (6, 10)),
                "alternativas": alternativas,
            },
        )
        assert respuesta.status_code == 201, respuesta.text
        hueco = respuesta.json()["id"]
        serie = {"ejercicio_id": ejercicio, "slot_id": hueco, "numero_serie": 1, **cuerpo}
        assert cliente.post(ruta, json=serie).status_code == 201
    poner_alternativas(cliente, rutina, hueco, [])
    antes = cliente.get(f"/entrenamientos/{sesion.json()['id']}").json()
    configuracion = _configuracion_de_alembic()
    engine.dispose()
    try:
        with pytest.raises(RuntimeError) as error:
            command.downgrade(configuracion, ANTES_DE_LOS_TIPOS)

        assert "No se puede deshacer: hay 1 serie(s) que no son" in str(error.value)
        # La bajada entera va en una transacción: tampoco se deshacen las migraciones
        # de encima, que sí podían bajar. La base sigue en la última.
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
        assert version == ScriptDirectory.from_config(configuracion).get_current_head()
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    assert cliente.get(f"/entrenamientos/{sesion.json()['id']}").json() == antes


def test_subir_los_tipos_con_datos_deja_cada_ejercicio_de_peso_y_repeticiones(cliente):
    """El `server_default` rellena los ejercicios que ya existían (propios y
    predefinidos) y las series de antes siguen igual, sin duración ni peso corporal.
    Se baja a la versión anterior, se meten los datos con el esquema de entonces y se
    vuelve a subir.
    """
    from alembic import command
    from sqlalchemy import text

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, ANTES_DE_LOS_TIPOS)
    try:
        with engine.begin() as conexion:

            def fila(sql, **valores):
                return conexion.scalar(text(sql + " RETURNING id"), valores)

            grupo = conexion.scalar(text("SELECT min(id) FROM grupos_musculares"))
            remo = fila(
                "INSERT INTO ejercicios (nombre, grupo_muscular_id, es_predefinido, created_at, "
                "updated_at) VALUES ('Remo', :g, false, now(), now())",
                g=grupo,
            )
            rutina = fila(
                "INSERT INTO rutinas (nombre, created_at, updated_at) VALUES ('Pull', now(), now())"
            )
            hueco = fila(
                "INSERT INTO rutina_slots (rutina_id, ejercicio_principal_id, orden, "
                "series_objetivo, reps_min, reps_max, created_at, updated_at) "
                "VALUES (:r, :e, 1, 3, 6, 10, now(), now())",
                r=rutina,
                e=remo,
            )
            sesion = fila(
                "INSERT INTO entrenamientos (rutina_id, fecha, created_at, updated_at) "
                "VALUES (:r, '2026-09-04', now(), now())",
                r=rutina,
            )
            fila(
                "INSERT INTO series (entrenamiento_id, slot_id, ejercicio_id, numero_serie, peso, "
                "repeticiones, created_at, updated_at) VALUES (:s, :h, :e, 1, 60, 8, now(), now())",
                s=sesion,
                h=hueco,
                e=remo,
            )

        engine.dispose()
        command.upgrade(configuracion, "head")
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    ejercicios = cliente.get("/ejercicios").json()
    # Los predefinidos que la siembra posterior re-tipa dejan de ser de peso y repeticiones;
    # todo lo demás (el propio y el resto de predefinidos) sí.
    re_tipados = set(A_CORPORAL) | set(A_TIEMPO) | {n for n, _, _ in NUEVOS_POR_TIPO}
    assert {e["tipo_registro"] for e in ejercicios if e["nombre"] not in re_tipados} == {
        "peso_reps"
    }
    assert [e["nombre"] for e in ejercicios if not e["es_predefinido"]] == ["Remo"]
    [serie] = cliente.get(f"/entrenamientos/{sesion}").json()["series"]
    assert (serie["peso"], serie["repeticiones"], serie["duracion_s"], serie["peso_corporal"]) == (
        "60.00",
        8,
        None,
        None,
    )


# --- La migración del objetivo por ejercicio --------------------------------
#
# `d7b3c2e91a58` da a cada alternativa su propio objetivo (hasta entonces usaba el
# de su principal, así que se le copia) y deja el objetivo ir en segundos. Al bajar,
# un hueco con el objetivo en segundos no cabe en las columnas de antes: se niega,
# contando cuántos hay, y no toca nada.

OBJETIVO_POR_EJERCICIO = "d7b3c2e91a58"


def test_subir_el_objetivo_por_ejercicio_copia_a_cada_alternativa_el_de_su_principal(cliente):
    """Se baja a la versión anterior, se mete un hueco con su objetivo y dos
    alternativas con el esquema de entonces (sin objetivo) y otro hueco con otro
    objetivo y una, y se vuelve a subir: cada alternativa tiene el de su hueco.
    """
    from alembic import command
    from sqlalchemy import text

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, LOS_TIPOS)
    try:
        with engine.begin() as conexion:

            def fila(sql, **valores):
                return conexion.scalar(text(sql + " RETURNING id"), valores)

            grupo = conexion.scalar(text("SELECT min(id) FROM grupos_musculares"))
            press, remo, fondos = (
                fila(
                    "INSERT INTO ejercicios (nombre, grupo_muscular_id, es_predefinido, "
                    "created_at, updated_at) VALUES (:n, :g, false, now(), now())",
                    n=nombre,
                    g=grupo,
                )
                for nombre in ("Press", "Remo", "Fondos")
            )
            rutina = fila(
                "INSERT INTO rutinas (nombre, created_at, updated_at) VALUES ('Push', now(), now())"
            )

            def hueco(principal, orden, series, reps_min, reps_max):
                return fila(
                    "INSERT INTO rutina_slots (rutina_id, ejercicio_principal_id, orden, "
                    "series_objetivo, reps_min, reps_max, created_at, updated_at) "
                    "VALUES (:r, :e, :o, :s, :rmin, :rmax, now(), now())",
                    r=rutina,
                    e=principal,
                    o=orden,
                    s=series,
                    rmin=reps_min,
                    rmax=reps_max,
                )

            a = hueco(press, 1, 4, 6, 8)
            b = hueco(fondos, 2, 2, 12, 15)
            for slot, ejercicio in ((a, remo), (a, fondos), (b, press)):
                fila(
                    "INSERT INTO slot_alternativas (slot_id, ejercicio_id) VALUES (:s, :e)",
                    s=slot,
                    e=ejercicio,
                )

        engine.dispose()
        command.upgrade(configuracion, "head")
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    huecos = {h["id"]: h for h in cliente.get(f"/rutinas/{rutina}").json()["slots"]}
    assert [(a["ejercicio"]["id"], objetivo_de(a)) for a in huecos[a]["alternativas"]] == [
        (remo, objetivo(4, (6, 8))),
        (fondos, objetivo(4, (6, 8))),
    ]
    assert [(a["ejercicio"]["id"], objetivo_de(a)) for a in huecos[b]["alternativas"]] == [
        (press, objetivo(2, (12, 15)))
    ]
    assert objetivo_de(huecos[a]) == objetivo(4, (6, 8))


@pytest.mark.parametrize(
    "en_segundos, cuantos",
    [
        pytest.param({"hueco"}, 1, id="un-hueco"),
        pytest.param({"alternativa"}, 1, id="una-alternativa"),
        pytest.param({"hueco", "alternativa"}, 2, id="los-dos"),
    ],
)
def test_quitar_el_objetivo_por_ejercicio_se_niega_con_algo_en_segundos_y_no_toca_nada(
    cliente, grupo_muscular_id, en_segundos, cuantos
):
    """Un hueco o una alternativa con el objetivo en segundos no caben en las columnas
    de antes. Con la alternativa sola, antes del arreglo bajaba sin decir nada y, al
    volver a subir, se le copiaba el objetivo en repeticiones de su principal: un
    ejercicio de tiempo con objetivo en repeticiones, que hacía que exportar e
    importar la propia copia diera 422.

    Junto a lo que está en segundos, un hueco y una alternativa en repeticiones, que
    no se cuentan. La base sigue en esta versión y la rutina, igual.
    """
    from alembic import command
    from sqlalchemy import text

    from app.database import engine

    press = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo")
    plancha = crear_ejercicio(cliente, grupo_muscular_id, "Plancha", tipo="tiempo")
    huecos = [
        {
            "ejercicio_principal_id": press,
            **objetivo(4, (6, 10)),
            "alternativas": [alternativa(remo, 3, (8, 12))]
            + ([alternativa(plancha, duracion=(20, 40))] if "alternativa" in en_segundos else []),
        }
    ]
    if "hueco" in en_segundos:
        huecos.append({"ejercicio_principal_id": plancha, **objetivo(3, duracion=(30, 60))})
    respuesta = cliente.post("/rutinas", json={"nombre": "Core", "slots": huecos})
    assert respuesta.status_code == 201, respuesta.text
    antes = cliente.get(f"/rutinas/{respuesta.json()['id']}").json()
    configuracion = _configuracion_de_alembic()
    engine.dispose()
    try:
        with pytest.raises(RuntimeError) as error:
            command.downgrade(configuracion, LOS_TIPOS)

        assert (
            f"No se puede deshacer: hay {cuantos} hueco(s) o alternativa(s) con el objetivo"
            " en duración" in str(error.value)
        )
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
        # La bajada entera va en una transacción: tampoco se deshace la siembra de encima.
        assert version == SIEMBRA_POR_TIPO
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    assert cliente.get(f"/rutinas/{respuesta.json()['id']}").json() == antes


# --- La migración que siembra los ejercicios por tipo -----------------------
#
# `e8c4d1b97a36` añade tres predefinidos (Flexiones, Crunch abdominal, Plancha lateral) y
# cambia el tipo de ocho de los que ya había. Pasar Plancha y Paseo del granjero a tiempo
# no se puede deducir si tienen repeticiones apuntadas, y quitar los nuevos o devolver
# los corporales a peso y repeticiones pierde datos: en esos casos se niega, cuenta lo
# que hay y no toca nada.


def _tipos_de_los_predefinidos(cliente) -> dict:
    grupos = {g["id"]: g["nombre"] for g in cliente.get("/grupos-musculares").json()}
    return {
        e["nombre"]: (e["tipo_registro"], grupos[e["grupo_muscular_id"]])
        for e in cliente.get("/ejercicios").json()
        if e["es_predefinido"]
    }


def test_la_siembra_deja_62_predefinidos_con_los_tipos_esperados(cliente):
    tipos = _tipos_de_los_predefinidos(cliente)
    assert len(tipos) == 62

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
    # Parecidos que se quedan como estaban.
    for nombre in ["Zancadas", "Sentadilla búlgara", "Crunch en polea", "Hip thrust"]:
        assert tipos[nombre][0] == "peso_reps", nombre
    talones = [(n, t) for n, (t, _) in tipos.items() if n.startswith("Elevación de talones")]
    assert len(talones) == 2
    assert {t for _, t in talones} == {"peso_reps"}


def _usar(conexion, nombre, donde, tiempo=False):
    """Mete, con SQL y sobre el esquema actual, un uso del predefinido `nombre`: como
    `hueco` (principal), `alternativa`, `serie` o `nota`. Con `tiempo`, el objetivo y la
    serie van en segundos; si no, en repeticiones (y la serie con peso, como las de un
    ejercicio de peso y repeticiones).
    """

    def fila(sql, **valores):
        return conexion.scalar(text(sql + " RETURNING id"), valores)

    ejercicio = conexion.scalar(
        text("SELECT id FROM ejercicios WHERE es_predefinido AND nombre = :n"), {"n": nombre}
    )
    assert ejercicio is not None, nombre
    if donde == "nota":
        fila(
            "INSERT INTO notas_ejercicio (ejercicio_id, nota, created_at, updated_at) "
            "VALUES (:e, 'una nota', now(), now())",
            e=ejercicio,
        )
        return
    grupo = conexion.scalar(text("SELECT min(id) FROM grupos_musculares"))
    remo = fila(
        "INSERT INTO ejercicios (nombre, grupo_muscular_id, es_predefinido, created_at, "
        "updated_at) VALUES ('Remo', :g, false, now(), now())",
        g=grupo,
    )
    rutina = fila(
        "INSERT INTO rutinas (nombre, created_at, updated_at) VALUES ('Core', now(), now())"
    )
    objetivo_sql = (
        {"s": 3, "rmin": None, "rmax": None, "dmin": 30, "dmax": 60}
        if tiempo
        else {"s": 3, "rmin": 6, "rmax": 10, "dmin": None, "dmax": None}
    )
    hueco = fila(
        "INSERT INTO rutina_slots (rutina_id, ejercicio_principal_id, orden, series_objetivo, "
        "reps_min, reps_max, duracion_min_s, duracion_max_s, created_at, updated_at) "
        "VALUES (:r, :e, 1, :s, :rmin, :rmax, :dmin, :dmax, now(), now())",
        r=rutina,
        e=ejercicio if donde == "hueco" else remo,
        **objetivo_sql,
    )
    if donde == "alternativa":
        fila(
            "INSERT INTO slot_alternativas (slot_id, ejercicio_id, series_objetivo, reps_min, "
            "reps_max, duracion_min_s, duracion_max_s) VALUES (:h, :e, :s, :rmin, :rmax, :dmin, "
            ":dmax)",
            h=hueco,
            e=ejercicio,
            **objetivo_sql,
        )
    if donde == "serie":
        sesion = fila(
            "INSERT INTO entrenamientos (rutina_id, fecha, created_at, updated_at) "
            "VALUES (:r, '2026-09-04', now(), now())",
            r=rutina,
        )
        medidas = "NULL, NULL, 45" if tiempo else "20, 10, NULL"
        fila(
            "INSERT INTO series (entrenamiento_id, slot_id, ejercicio_id, numero_serie, peso, "
            f"repeticiones, duracion_s, created_at, updated_at) VALUES (:s, :h, :e, 1, {medidas}, "
            "now(), now())",
            s=sesion,
            h=hueco,
            e=ejercicio,
        )


@pytest.mark.parametrize(
    "donde, cuenta",
    [
        pytest.param("hueco", "1 huecos como principal", id="en-un-hueco"),
        pytest.param("alternativa", "1 huecos como alternativa", id="como-alternativa"),
        pytest.param("serie", "1 series", id="con-una-serie"),
    ],
)
def test_subir_la_siembra_se_niega_si_plancha_tiene_algo_apuntado_y_no_toca_nada(
    cliente, donde, cuenta
):
    """Plancha pasa a tiempo: con repeticiones apuntadas (en un hueco, como
    alternativa o en una serie) no se puede deducir cuántos segundos son. La base sigue
    en la versión anterior, sin los nuevos y con Plancha de peso y repeticiones.
    """
    from alembic import command

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, OBJETIVO_POR_EJERCICIO)
    try:
        with engine.begin() as conexion:
            _usar(conexion, "Plancha", donde)

        engine.dispose()
        with pytest.raises(RuntimeError) as error:
            command.upgrade(configuracion, "head")

        assert "Plancha o Paseo del granjero ya se usan" in str(error.value)
        assert cuenta in str(error.value)
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
            plancha = conexion.scalar(
                text("SELECT tipo_registro FROM ejercicios WHERE nombre = 'Plancha'")
            )
            predefinidos = conexion.scalar(
                text("SELECT count(*) FROM ejercicios WHERE es_predefinido")
            )
        assert version == OBJETIVO_POR_EJERCICIO
        assert plancha == "peso_reps"
        assert predefinidos == 59
    finally:
        # Con el dato dentro la subida se negaría otra vez: se vacía lo del usuario.
        engine.dispose()
        with engine.begin() as conexion:
            conexion.execute(text("TRUNCATE rutinas, entrenamientos, notas_ejercicio CASCADE"))
        engine.dispose()
        command.upgrade(configuracion, "head")

    assert len(_tipos_de_los_predefinidos(cliente)) == 62


def _bajar_la_siembra_y_comprobar_que_se_niega(cliente, texto):
    """Intenta bajar la siembra: se niega con `texto`, la base sigue en su versión y los
    predefinidos, con los mismos tipos.
    """
    from alembic import command

    from app.database import engine

    antes = _tipos_de_los_predefinidos(cliente)
    configuracion = _configuracion_de_alembic()
    engine.dispose()
    try:
        with pytest.raises(RuntimeError) as error:
            command.downgrade(configuracion, OBJETIVO_POR_EJERCICIO)
        assert texto in str(error.value)
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
        assert version == SIEMBRA_POR_TIPO
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")
    assert _tipos_de_los_predefinidos(cliente) == antes


@pytest.mark.parametrize("nuevo", ["Flexiones", "Crunch abdominal", "Plancha lateral"])
@pytest.mark.parametrize("donde", ["hueco", "alternativa", "serie", "nota"])
def test_bajar_la_siembra_se_niega_si_un_ejercicio_nuevo_se_usa_y_no_toca_nada(
    cliente, nuevo, donde
):
    from app.database import engine

    with engine.begin() as conexion:
        _usar(conexion, nuevo, donde, tiempo=nuevo == "Plancha lateral")

    _bajar_la_siembra_y_comprobar_que_se_niega(cliente, "los ejercicios nuevos ya se usan")


@pytest.mark.parametrize("donde", ["hueco", "alternativa", "serie"])
def test_bajar_la_siembra_se_niega_si_plancha_se_usa_por_tiempo(cliente, donde):
    """Plancha ya es de tiempo: con un objetivo o una serie en segundos no cabe como
    ejercicio de peso y repeticiones.
    """
    from app.database import engine

    with engine.begin() as conexion:
        _usar(conexion, "Plancha", donde, tiempo=True)

    _bajar_la_siembra_y_comprobar_que_se_niega(cliente, "Plancha o Paseo del granjero ya se usan")


@pytest.mark.parametrize(
    "peso, peso_corporal",
    [
        pytest.param(-20, None, id="con-carga-de-ayuda"),
        pytest.param(0, 80, id="con-peso-corporal"),
    ],
)
def test_bajar_la_siembra_se_niega_si_una_serie_corporal_no_cabe_como_peso_y_reps(
    cliente, peso, peso_corporal
):
    """Una serie de Dominadas con ayuda (peso negativo) o con el peso corporal apuntado
    no cabe en un ejercicio de peso y repeticiones.
    """
    from app.database import engine

    with engine.begin() as conexion:
        _usar(conexion, "Dominadas", "serie")
        conexion.execute(
            text("UPDATE series SET peso = :p, peso_corporal = :c"),
            {"p": peso, "c": peso_corporal},
        )

    _bajar_la_siembra_y_comprobar_que_se_niega(cliente, "1 serie(s) de ejercicios de peso")


def test_bajar_la_siembra_devuelve_los_tipos_a_peso_y_repeticiones_y_borra_los_nuevos(cliente):
    """Una serie de Dominadas sin ayuda ni peso corporal sí cabe: la bajada devuelve los
    ocho re-tipados a peso y repeticiones, borra los tres nuevos y deja la serie. Al
    volver a subir, la siembra queda como antes.
    """
    from alembic import command

    from app.database import engine

    with engine.begin() as conexion:
        _usar(conexion, "Dominadas", "serie")
        conexion.execute(text("UPDATE series SET peso = 0, repeticiones = 8"))

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, OBJETIVO_POR_EJERCICIO)
    try:
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
            tipos = dict(
                conexion.execute(
                    text("SELECT nombre, tipo_registro FROM ejercicios WHERE es_predefinido")
                ).all()
            )
            series = conexion.scalar(text("SELECT count(*) FROM series"))
        assert version == OBJETIVO_POR_EJERCICIO
        assert len(tipos) == 59
        assert {n for n, _, _ in NUEVOS_POR_TIPO}.isdisjoint(tipos)
        assert set(tipos.values()) == {"peso_reps"}
        assert series == 1
    finally:
        engine.dispose()
        command.upgrade(configuracion, "head")

    tipos = _tipos_de_los_predefinidos(cliente)
    assert len(tipos) == 62
    assert tipos["Dominadas"][0] == "corporal"


def test_subir_la_siembra_se_niega_si_paseo_del_granjero_tiene_una_serie(cliente):
    """Igual que Plancha: Paseo del granjero pasa a tiempo y sus repeticiones no se
    pueden convertir en segundos.
    """
    from alembic import command

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, OBJETIVO_POR_EJERCICIO)
    try:
        with engine.begin() as conexion:
            _usar(conexion, "Paseo del granjero", "serie")

        engine.dispose()
        with pytest.raises(RuntimeError) as error:
            command.upgrade(configuracion, "head")

        assert "Plancha o Paseo del granjero ya se usan (1 series)" in str(error.value)
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
            tipo = conexion.scalar(
                text("SELECT tipo_registro FROM ejercicios WHERE nombre = 'Paseo del granjero'")
            )
        assert version == OBJETIVO_POR_EJERCICIO
        assert tipo == "peso_reps"
    finally:
        engine.dispose()
        with engine.begin() as conexion:
            conexion.execute(text("TRUNCATE rutinas, entrenamientos, notas_ejercicio CASCADE"))
        engine.dispose()
        command.upgrade(configuracion, "head")


def test_bajar_la_siembra_se_niega_si_paseo_del_granjero_tiene_una_serie_de_tiempo(cliente):
    from app.database import engine

    with engine.begin() as conexion:
        _usar(conexion, "Paseo del granjero", "serie", tiempo=True)

    _bajar_la_siembra_y_comprobar_que_se_niega(cliente, "Plancha o Paseo del granjero ya se usan")


def test_subir_la_siembra_se_niega_si_ya_hay_un_ejercicio_propio_con_el_nombre_de_un_nuevo(
    cliente,
):
    """Un propio llamado «Flexiones» chocaría con el predefinido nuevo: la migración se
    niega nombrándolo, no inserta ninguno de los tres y no cambia ningún tipo.
    """
    from alembic import command

    from app.database import engine

    configuracion = _configuracion_de_alembic()
    engine.dispose()
    command.downgrade(configuracion, OBJETIVO_POR_EJERCICIO)
    try:
        with engine.begin() as conexion:
            conexion.execute(
                text(
                    "INSERT INTO ejercicios (nombre, grupo_muscular_id, es_predefinido, "
                    "created_at, updated_at) VALUES ('Flexiones', "
                    "(SELECT min(id) FROM grupos_musculares), false, now(), now())"
                )
            )

        engine.dispose()
        with pytest.raises(RuntimeError) as error:
            command.upgrade(configuracion, "head")

        assert "Flexiones" in str(error.value)
        with engine.connect() as conexion:
            version = conexion.scalar(text("SELECT version_num FROM alembic_version"))
            nombres = set(conexion.scalars(text("SELECT nombre FROM ejercicios")).all())
            tipos = set(
                conexion.scalars(
                    text("SELECT tipo_registro FROM ejercicios WHERE es_predefinido")
                ).all()
            )
        assert version == OBJETIVO_POR_EJERCICIO
        assert "Crunch abdominal" not in nombres and "Plancha lateral" not in nombres
        assert tipos == {"peso_reps"}
    finally:
        engine.dispose()
        with engine.begin() as conexion:
            conexion.execute(text("DELETE FROM ejercicios WHERE nombre = 'Flexiones'"))
        engine.dispose()
        command.upgrade(configuracion, "head")
