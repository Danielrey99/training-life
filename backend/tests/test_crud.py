"""Camino feliz de cada CRUD, más las validaciones de entrada que sí protegen algo.

Cada test suelto cubre poco riesgo; en conjunto son la red que avisa si un
refactor rompe algo básico sin que te des cuenta.
"""

from decimal import Decimal

import pytest

FECHA = "2026-09-04"


def test_crear_editar_y_listar_un_ejercicio(cliente, grupo_muscular_id):
    creado = cliente.post(
        "/ejercicios",
        json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
    ).json()

    assert creado["es_predefinido"] is False  # lo decide el backend, no el cliente
    assert creado["oculto_desde"] is None

    cliente.put(
        f"/ejercicios/{creado['id']}",
        json={
            "nombre": "Press banca con barra",
            "grupo_muscular_id": grupo_muscular_id,
        },
    )
    assert cliente.get(f"/ejercicios/{creado['id']}").json()["nombre"] == "Press banca con barra"


def test_una_rutina_devuelve_sus_huecos_y_comodines_ya_resueltos(cliente, grupo_muscular_id):
    """RutinaSlotOut trae los ejercicios completos, no solo sus ids: así el
    frontend no tiene que cruzar datos contra /ejercicios.
    """
    principal = cliente.post(
        "/ejercicios",
        json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
    ).json()["id"]
    comodin = cliente.post(
        "/ejercicios",
        json={"nombre": "Press en máquina", "grupo_muscular_id": grupo_muscular_id},
    ).json()["id"]

    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
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
    cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas",
        json={"ejercicio_id": comodin},
    )

    rutina = cliente.get(f"/rutinas/{rutina_id}").json()
    hueco = rutina["slots"][0]

    assert hueco["ejercicio_principal"]["nombre"] == "Press banca"
    assert [alternativa["nombre"] for alternativa in hueco["alternativas"]] == ["Press en máquina"]


def test_registrar_un_entrenamiento_con_sus_series(cliente, grupo_muscular_id):
    ejercicio_id = cliente.post(
        "/ejercicios",
        json={"nombre": "Sentadilla", "grupo_muscular_id": grupo_muscular_id},
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
        "/ejercicios",
        json={"nombre": "Peso muerto", "grupo_muscular_id": grupo_muscular_id},
    ).json()["id"]
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    serie = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={
            "ejercicio_id": ejercicio_id,
            "numero_serie": 1,
            "peso": 100.25,
            "repeticiones": 5,
            "rpe": 8.5,
        },
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
        json={
            "ejercicio_id": ejercicio_id,
            "slot_id": 1,
            "numero_serie": 1,
            "peso": 20,
            "repeticiones": 10,
        },
    )
    # 422 y no 409: son datos incoherentes, no un choque con el estado de algo.
    assert respuesta.status_code == 422


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


def test_un_nombre_formado_solo_por_espacios_no_se_acepta(cliente, grupo_muscular_id):
    """`min_length=1` mide sin recortar, así que "   " lo esquivaría y se
    guardaría un ejercicio (o una rutina) sin nombre visible.
    """
    respuesta = cliente.post(
        "/ejercicios", json={"nombre": "   ", "grupo_muscular_id": grupo_muscular_id}
    )
    assert respuesta.status_code == 422
    assert cliente.post("/rutinas", json={"nombre": "  \n "}).status_code == 422


# --- Notas del usuario sobre un ejercicio --------------------------------


def test_se_pueden_acumular_varias_notas_sobre_el_mismo_ejercicio(cliente, grupo_muscular_id):
    """No hay `UNIQUE(usuario_id, ejercicio_id)` a propósito: cada nota es una
    fila independiente, no se sobreescriben entre ellas. Se listan de la más
    reciente a la más antigua.
    """
    ejercicio_id = cliente.post(
        "/ejercicios",
        json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
    ).json()["id"]

    for texto in ("Primera", "Segunda", "Tercera"):
        assert (
            cliente.post(f"/ejercicios/{ejercicio_id}/notas", json={"nota": texto}).status_code
            == 201
        )

    notas = cliente.get(f"/ejercicios/{ejercicio_id}/notas").json()
    assert [nota["nota"] for nota in notas] == ["Tercera", "Segunda", "Primera"]


def test_las_notas_de_un_ejercicio_no_se_mezclan_con_las_de_otro(cliente, grupo_muscular_id):
    press = cliente.post(
        "/ejercicios",
        json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
    ).json()["id"]
    remo = cliente.post(
        "/ejercicios", json={"nombre": "Remo", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]

    cliente.post(f"/ejercicios/{press}/notas", json={"nota": "Del press"})
    cliente.post(f"/ejercicios/{remo}/notas", json={"nota": "Del remo"})

    assert [n["nota"] for n in cliente.get(f"/ejercicios/{press}/notas").json()] == ["Del press"]
    assert [n["nota"] for n in cliente.get(f"/ejercicios/{remo}/notas").json()] == ["Del remo"]


def test_una_nota_en_blanco_no_se_acepta(cliente, grupo_muscular_id):
    """Una nota vacía se rechaza por `min_length`, pero `"   "` lo esquivaría
    si el texto no se recortara antes de medirlo.
    """
    ejercicio_id = cliente.post(
        "/ejercicios",
        json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
    ).json()["id"]

    assert cliente.post(f"/ejercicios/{ejercicio_id}/notas", json={"nota": ""}).status_code == 422
    assert (
        cliente.post(f"/ejercicios/{ejercicio_id}/notas", json={"nota": "   "}).status_code == 422
    )


# --- Editar y borrar: rutinas, huecos y comodines ------------------------


def _ejercicio(cliente, grupo_muscular_id, nombre) -> int:
    return cliente.post(
        "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]


def _hueco(ejercicio_id, orden=1, series=4, reps=(6, 10)) -> dict:
    return {
        "ejercicio_principal_id": ejercicio_id,
        "orden": orden,
        "series_objetivo": series,
        "reps_min": reps[0],
        "reps_max": reps[1],
    }


def test_cambiar_el_nombre_de_una_rutina(cliente):
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]

    respuesta = cliente.put(f"/rutinas/{rutina_id}", json={"nombre": "Empuje"})

    assert respuesta.status_code == 200
    assert cliente.get(f"/rutinas/{rutina_id}").json()["nombre"] == "Empuje"


def test_editar_un_hueco_cambia_su_ejercicio_y_su_objetivo(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    maquina = _ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    slot_id = cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca)).json()["id"]

    # Mismo orden que ya tenía: no choca consigo mismo.
    respuesta = cliente.put(
        f"/rutinas/{rutina_id}/slots/{slot_id}", json=_hueco(maquina, series=3, reps=(8, 12))
    )

    assert respuesta.status_code == 200
    hueco = respuesta.json()
    assert hueco["ejercicio_principal"]["nombre"] == "Press en máquina"
    assert (hueco["series_objetivo"], hueco["reps_min"], hueco["reps_max"]) == (3, 8, 12)


def test_mover_un_hueco_al_orden_de_otro_da_409(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca, orden=1))
    segundo = cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca, orden=2)).json()

    respuesta = cliente.put(
        f"/rutinas/{rutina_id}/slots/{segundo['id']}", json=_hueco(banca, orden=1)
    )

    assert respuesta.status_code == 409


def test_quitar_un_comodin_y_no_poder_repetirlo(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    maquina = _ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    slot_id = cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca)).json()["id"]
    ruta = f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas"

    assert cliente.post(ruta, json={"ejercicio_id": maquina}).status_code == 201
    # El mismo ejercicio dos veces como comodín del mismo hueco no tiene sentido.
    assert cliente.post(ruta, json={"ejercicio_id": maquina}).status_code == 409

    assert cliente.delete(f"{ruta}/{maquina}").status_code == 204
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"][0]["alternativas"] == []
    # Ya no era comodín: no hay nada que quitar.
    assert cliente.delete(f"{ruta}/{maquina}").status_code == 404


def test_un_ejercicio_oculto_no_se_puede_usar_en_un_hueco_nuevo(cliente, grupo_muscular_id):
    """Ocultar significa que deja de ofrecerse para usarlo."""
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    cliente.delete(f"/ejercicios/{banca}?modo=ocultar")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]

    assert cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca)).status_code == 404


# --- Editar y borrar: entrenamientos y series ----------------------------


def _serie(ejercicio_id, numero=1, peso=60, repeticiones=8, slot_id=None) -> dict:
    return {
        "ejercicio_id": ejercicio_id,
        "slot_id": slot_id,
        "numero_serie": numero,
        "peso": peso,
        "repeticiones": repeticiones,
    }


def test_corregir_una_serie(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"
    serie_id = cliente.post(ruta, json=_serie(banca)).json()["id"]

    respuesta = cliente.put(
        f"{ruta}/{serie_id}",
        json={**_serie(banca, peso=62.5, repeticiones=7), "variante": "agarre cerrado"},
    )

    assert respuesta.status_code == 200
    corregida = respuesta.json()
    assert Decimal(corregida["peso"]) == Decimal("62.5")
    assert (corregida["repeticiones"], corregida["variante"]) == (7, "agarre cerrado")


def test_borrar_una_serie_deja_las_demas(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"
    primera = cliente.post(ruta, json=_serie(banca, numero=1)).json()["id"]
    cliente.post(ruta, json=_serie(banca, numero=2))

    assert cliente.delete(f"{ruta}/{primera}").status_code == 204

    series = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"]
    assert [serie["numero_serie"] for serie in series] == [2]
    assert cliente.delete(f"{ruta}/{primera}").status_code == 404


def test_una_serie_no_se_alcanza_por_la_ruta_de_otro_entrenamiento(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    uno = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]
    otro = cliente.post("/entrenamientos", json={"fecha": "2026-09-05"}).json()["id"]
    serie_id = cliente.post(f"/entrenamientos/{uno}/series", json=_serie(banca)).json()["id"]

    assert cliente.delete(f"/entrenamientos/{otro}/series/{serie_id}").status_code == 404


def test_cancelar_una_sesion_la_borra_con_sus_series(cliente, grupo_muscular_id):
    """Es el Cancelar sesión del diseño: como si no se hubiera empezado."""
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]
    cliente.post(f"/entrenamientos/{entrenamiento_id}/series", json=_serie(banca))

    assert cliente.delete(f"/entrenamientos/{entrenamiento_id}").status_code == 204

    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").status_code == 404
    assert cliente.get(f"/ejercicios/{banca}/historial").json() == []


def test_una_serie_no_puede_apuntar_a_un_hueco_de_otra_rutina(cliente, grupo_muscular_id):
    """El hueco tiene que ser de la rutina de ese entrenamiento: si no, el
    historial de ese hueco mostraría una sesión de otra rutina.
    """
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    push = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    pull = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]
    hueco_de_pull = cliente.post(f"/rutinas/{pull}/slots", json=_hueco(banca)).json()["id"]
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": push, "fecha": FECHA}
    ).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json=_serie(banca, slot_id=hueco_de_pull)
    )

    assert respuesta.status_code == 404


def test_un_entrenamiento_no_puede_ser_de_una_rutina_oculta(cliente):
    push = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    cliente.delete(f"/rutinas/{push}?modo=ocultar")

    respuesta = cliente.post("/entrenamientos", json={"rutina_id": push, "fecha": FECHA})

    assert respuesta.status_code == 404


def test_un_ejercicio_oculto_no_se_puede_usar_en_una_serie_nueva(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    cliente.delete(f"/ejercicios/{banca}?modo=ocultar")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    respuesta = cliente.post(f"/entrenamientos/{entrenamiento_id}/series", json=_serie(banca))

    assert respuesta.status_code == 404


# --- Límites de los números ----------------------------------------------
#
# La base de datos tiene sus propios máximos (`peso` es NUMERIC(6, 2), hasta
# 9999.99; los enteros son INTEGER, hasta 2**31 - 1), y un número que no cabía
# llegaba hasta Postgres y reventaba con un 500. Ahora los esquemas ponen topes
# por debajo: el peso, lo que cabe en la columna; el resto, de sentido común
# (repeticiones y reps ≤ 1000, número de serie y orden ≤ 100, series objetivo
# ≤ 50). Los primeros tests comprueban que nada llega a Postgres; los de los
# bordes, que los topes son los decididos.

DEMASIADO = 2**31


def test_el_peso_maximo_que_cabe_se_guarda(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json=_serie(banca, peso="9999.99")
    )

    assert respuesta.status_code == 201
    assert Decimal(respuesta.json()["peso"]) == Decimal("9999.99")


@pytest.mark.parametrize(
    "campo, valor", [("peso", 10000), ("repeticiones", DEMASIADO), ("numero_serie", DEMASIADO)]
)
def test_una_serie_con_un_numero_que_no_cabe_da_422(cliente, grupo_muscular_id, campo, valor):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json={**_serie(banca), campo: valor}
    )

    assert respuesta.status_code == 422


@pytest.mark.parametrize("campo", ["orden", "series_objetivo", "reps_max"])
def test_un_hueco_con_un_numero_que_no_cabe_da_422(cliente, grupo_muscular_id, campo):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]

    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots", json={**_hueco(banca), campo: DEMASIADO}
    )

    assert respuesta.status_code == 422


@pytest.mark.parametrize(
    "campo, tope",
    [("numero_serie", 100), ("repeticiones", 1000), ("peso", Decimal("9999.99"))],
)
def test_una_serie_admite_su_tope_justo_y_no_uno_mas(cliente, grupo_muscular_id, campo, tope):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"
    paso = Decimal("0.01") if campo == "peso" else 1

    justo = cliente.post(ruta, json={**_serie(banca), campo: str(tope)})
    pasado = cliente.post(ruta, json={**_serie(banca), campo: str(tope + paso)})

    assert (justo.status_code, pasado.status_code) == (201, 422)


@pytest.mark.parametrize(
    "campo, tope", [("orden", 100), ("series_objetivo", 50), ("reps_max", 1000)]
)
def test_un_hueco_admite_su_tope_justo_y_no_uno_mas(cliente, grupo_muscular_id, campo, tope):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    ruta = f"/rutinas/{rutina_id}/slots"

    pasado = cliente.post(ruta, json={**_hueco(banca), campo: tope + 1})
    justo = cliente.post(ruta, json={**_hueco(banca), campo: tope})

    assert (justo.status_code, pasado.status_code) == (201, 422)


def test_reps_min_tambien_tiene_tope(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]

    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca, reps=(1001, 1001)))

    assert respuesta.status_code == 422


def test_el_peso_puede_ser_cero_para_los_ejercicios_con_el_propio_cuerpo(
    cliente, grupo_muscular_id
):
    """Dominadas o fondos sin lastre: 0 kg es un dato válido, no un error."""
    dominadas = _ejercicio(cliente, grupo_muscular_id, "Dominadas")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json=_serie(dominadas, peso=0)
    )

    assert respuesta.status_code == 201


@pytest.mark.parametrize(
    "campo, valor",
    [("peso", -1), ("repeticiones", 0), ("numero_serie", 0), ("rpe", 11), ("rpe", -1)],
)
def test_una_serie_con_un_numero_sin_sentido_da_422(cliente, grupo_muscular_id, campo, valor):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json={**_serie(banca), campo: valor}
    )

    assert respuesta.status_code == 422


@pytest.mark.parametrize("campo", ["orden", "series_objetivo", "reps_min"])
def test_un_hueco_con_un_cero_da_422(cliente, grupo_muscular_id, campo):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]

    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots", json={**_hueco(banca), campo: 0})

    assert respuesta.status_code == 422


# --- Textos que no caben en su columna -----------------------------------
#
# Mismo riesgo que con los números: cada texto tiene su longitud máxima en la
# base de datos, y si el esquema no la repite, uno más largo llega a Postgres y
# la respuesta es un 500 en vez de un 422.


def test_ningun_texto_mas_largo_que_su_columna_llega_a_la_base(cliente, grupo_muscular_id):
    banca = _ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    programa_id = cliente.post("/programas", json={"nombre": "PPL"}).json()["id"]
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": FECHA}).json()["id"]
    grupo = grupo_muscular_id

    peticiones = [
        ("post", "/ejercicios", {"nombre": "x" * 101, "grupo_muscular_id": grupo}),
        ("put", f"/ejercicios/{banca}", {"nombre": "x" * 101, "grupo_muscular_id": grupo}),
        (
            "post",
            "/ejercicios",
            {"nombre": "Remo", "grupo_muscular_id": grupo, "descripcion": "x" * 501},
        ),
        ("post", f"/ejercicios/{banca}/notas", {"nota": "x" * 1001}),
        ("post", "/rutinas", {"nombre": "x" * 101}),
        ("put", f"/rutinas/{rutina_id}", {"nombre": "x" * 101}),
        ("post", "/programas", {"nombre": "x" * 101}),
        ("put", f"/programas/{programa_id}", {"nombre": "x" * 101}),
        ("post", "/entrenamientos", {"fecha": "2026-09-01", "notas": "x" * 1001}),
        ("put", f"/entrenamientos/{entrenamiento_id}", {"fecha": FECHA, "notas": "x" * 1001}),
        (
            "post",
            f"/entrenamientos/{entrenamiento_id}/series",
            {**_serie(banca), "variante": "x" * 101},
        ),
    ]

    for metodo, ruta, cuerpo in peticiones:
        respuesta = getattr(cliente, metodo)(ruta, json=cuerpo)
        assert respuesta.status_code == 422, f"{metodo.upper()} {ruta}: {respuesta.status_code}"


def test_un_nombre_se_guarda_sin_los_espacios_de_los_lados(cliente, grupo_muscular_id):
    creado = cliente.post(
        "/ejercicios", json={"nombre": "  Press banca  ", "grupo_muscular_id": grupo_muscular_id}
    ).json()

    assert creado["nombre"] == "Press banca"
