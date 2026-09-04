"""Tests del borrado con historial: `?modo=ocultar` y `?modo=definitivo`.

Es la parte más delicada del backend y donde han aparecido los dos únicos bugs
reales del proyecto, así que es la primera que se cubre.
"""

FECHA = "2026-09-04"


# --- Ayudantes para montar escenarios ------------------------------------


def crear_ejercicio(cliente, grupo_muscular_id, nombre="Press banca"):
    respuesta = cliente.post(
        "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    )
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def crear_rutina_con_hueco(cliente, ejercicio_id):
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    slot_id = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    ).json()["id"]
    return rutina_id, slot_id


def registrar_serie(cliente, rutina_id, slot_id, ejercicio_id):
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA}
    ).json()["id"]
    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={
            "ejercicio_id": ejercicio_id,
            "slot_id": slot_id,
            "numero_serie": 1,
            "peso": 60.5,
            "repeticiones": 8,
        },
    )
    assert respuesta.status_code == 201
    return entrenamiento_id


# --- Ejercicio -----------------------------------------------------------


def test_un_ejercicio_sin_usar_se_borra_directo(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    assert cliente.delete(f"/ejercicios/{ejercicio_id}").status_code == 204
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 404


def test_un_ejercicio_en_uso_no_se_borra_sin_modo_y_dice_donde_se_usa(
    cliente, grupo_muscular_id
):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, _ = crear_rutina_con_hueco(cliente, ejercicio_id)

    respuesta = cliente.delete(f"/ejercicios/{ejercicio_id}")

    assert respuesta.status_code == 409
    usos = respuesta.json()["detail"]["usos"]
    assert usos[0]["rol"] == "principal"
    assert usos[0]["rutina_id"] == rutina_id


def test_ocultar_un_ejercicio_lo_saca_del_listado_pero_se_puede_reactivar(
    cliente, grupo_muscular_id
):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    crear_rutina_con_hueco(cliente, ejercicio_id)

    assert cliente.delete(f"/ejercicios/{ejercicio_id}?modo=ocultar").status_code == 204
    assert cliente.get("/ejercicios").json() == []
    assert len(cliente.get("/ejercicios?ocultos=true").json()) == 1

    assert cliente.post(f"/ejercicios/{ejercicio_id}/reactivar").status_code == 200
    assert len(cliente.get("/ejercicios").json()) == 1


def test_borrar_un_ejercicio_en_definitivo_arrastra_los_huecos_que_lo_usan(
    cliente, grupo_muscular_id
):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, _ = crear_rutina_con_hueco(cliente, ejercicio_id)

    assert (
        cliente.delete(f"/ejercicios/{ejercicio_id}?modo=definitivo").status_code == 204
    )
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 404
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"] == []


# --- Hueco (slot) --------------------------------------------------------


def test_un_hueco_con_series_registradas_no_se_borra_sin_modo(
    cliente, grupo_muscular_id
):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

    assert cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}").status_code == 409


# --- Rutina: el caso que destapó el bug de passive_deletes ---------------


def test_borrar_en_definitivo_una_rutina_con_entrenamientos_y_series(
    cliente, grupo_muscular_id
):
    """Test de regresión del bug de `passive_deletes`.

    Antes de arreglarlo, este mismo escenario devolvía un 500 (`IntegrityError:
    null value in column "entrenamiento_id"`): SQLAlchemy intentaba desvincular
    las series poniendo su FK a NULL en vez de confiar en el ON DELETE CASCADE.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

    respuesta = cliente.delete(f"/rutinas/{rutina_id}?modo=definitivo")

    assert respuesta.status_code == 204, f"esperaba 204, llegó {respuesta.status_code}"
    assert cliente.get(f"/rutinas/{rutina_id}").status_code == 404
    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").status_code == 404
    # El ejercicio NO se borra: no era suyo el historial, solo estaba referenciado
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 200
