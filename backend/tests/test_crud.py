"""Camino feliz de cada CRUD, más las validaciones de entrada que sí protegen algo.

Cada test suelto cubre poco riesgo; en conjunto son la red que avisa si un
refactor rompe algo básico sin que te des cuenta.
"""

from decimal import Decimal

FECHA = "2026-09-04"


def test_crear_editar_y_listar_un_ejercicio(cliente, grupo_muscular_id):
    creado = cliente.post(
        "/ejercicios",
        json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
    ).json()

    assert creado["es_predefinido"] is False  # lo decide el backend, no el cliente
    assert creado["activo"] is True

    cliente.put(
        f"/ejercicios/{creado['id']}",
        json={"nombre": "Press banca con barra", "grupo_muscular_id": grupo_muscular_id},
    )
    assert cliente.get(f"/ejercicios/{creado['id']}").json()["nombre"] == "Press banca con barra"


def test_una_rutina_devuelve_sus_huecos_y_comodines_ya_resueltos(cliente, grupo_muscular_id):
    """RutinaSlotOut trae los ejercicios completos, no solo sus ids: así el
    frontend no tiene que cruzar datos contra /ejercicios."""
    principal = cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    comodin = cliente.post(
        "/ejercicios", json={"nombre": "Press en máquina", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]

    rutina_id = cliente.post("/rutinas", json={"nombre": "Push", "dia_habitual": "Lunes"}).json()["id"]
    slot_id = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": principal,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    ).json()["id"]
    cliente.post(f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin})

    rutina = cliente.get(f"/rutinas/{rutina_id}").json()
    hueco = rutina["slots"][0]

    assert hueco["ejercicio_principal"]["nombre"] == "Press banca"
    assert [alternativa["nombre"] for alternativa in hueco["alternativas"]] == ["Press en máquina"]


def test_registrar_un_entrenamiento_con_sus_series(cliente, grupo_muscular_id):
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Sentadilla", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": None, "fecha": FECHA, "notas": "Buen día"}
    ).json()["id"]

    for numero in (1, 2):
        respuesta = cliente.post(
            f"/entrenamientos/{entrenamiento_id}/series",
            json={
                "ejercicio_id": ejercicio_id,
                "numero_serie": numero,
                "peso": 60.5,
                "repeticiones": 8,
                "rpe": 7.5,
            },
        )
        assert respuesta.status_code == 201

    entrenamiento = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()
    assert len(entrenamiento["series"]) == 2
    assert entrenamiento["series"][0]["ejercicio"]["nombre"] == "Sentadilla"


def test_el_peso_y_el_rpe_conservan_los_decimales_exactos(cliente, grupo_muscular_id):
    """Son Numeric (Decimal), no float: 60.5 debe volver como 60.5 exacto."""
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Peso muerto", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    serie = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={"ejercicio_id": ejercicio_id, "numero_serie": 1, "peso": 100.25, "repeticiones": 5, "rpe": 8.5},
    ).json()

    assert Decimal(str(serie["peso"])) == Decimal("100.25")
    assert Decimal(str(serie["rpe"])) == Decimal("8.5")


def test_un_entrenamiento_libre_no_admite_slot_id(cliente, grupo_muscular_id):
    """Sin rutina no hay huecos a los que apuntar."""
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Curl", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={"ejercicio_id": ejercicio_id, "slot_id": 1, "numero_serie": 1, "peso": 20, "repeticiones": 10},
    )
    assert respuesta.status_code == 409


def test_un_hueco_no_admite_reps_max_menor_que_reps_min(cliente, grupo_muscular_id):
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Remo", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    rutina_id = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]

    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 12,
            "reps_max": 8,
        },
    )
    assert respuesta.status_code == 422


def test_no_puede_haber_dos_huecos_con_el_mismo_orden(cliente, grupo_muscular_id):
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Fondos", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    hueco = {
        "ejercicio_principal_id": ejercicio_id,
        "orden": 1,
        "series_objetivo": 3,
        "reps_min": 8,
        "reps_max": 12,
    }

    assert cliente.post(f"/rutinas/{rutina_id}/slots", json=hueco).status_code == 201
    assert cliente.post(f"/rutinas/{rutina_id}/slots", json=hueco).status_code == 409


def test_no_se_puede_usar_un_grupo_muscular_inexistente(cliente):
    respuesta = cliente.post("/ejercicios", json={"nombre": "X", "grupo_muscular_id": 9999})
    assert respuesta.status_code == 404
