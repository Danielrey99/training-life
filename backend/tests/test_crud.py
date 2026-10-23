"""Camino feliz de cada CRUD, más las validaciones de entrada que sí protegen algo.

Cada test suelto cubre poco riesgo; en conjunto son la red que avisa si un
refactor rompe algo básico sin que te des cuenta.
"""

from decimal import Decimal
from types import SimpleNamespace

import pytest

from tests.ayudas import crear_ejercicio, crear_rutina, entrenar, serie_en
from tests.ayudas import cuerpo_de_serie as _serie

FECHA = "2026-09-04"


def _hueco(ejercicio_id, orden=1, series=4, reps=(6, 10)) -> dict:
    """El cuerpo de un hueco sin comodines, con `orden` (el PUT lo exige)."""
    return {
        "ejercicio_principal_id": ejercicio_id,
        "orden": orden,
        "series_objetivo": series,
        "reps_min": reps[0],
        "reps_max": reps[1],
    }


def test_crear_y_editar_un_ejercicio(cliente, grupo_muscular_id):
    creado = cliente.post(
        "/ejercicios",
        json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
    )
    assert creado.status_code == 201, creado.text
    creado = creado.json()

    assert creado["es_predefinido"] is False  # lo decide el backend, no el cliente
    assert creado["oculto_desde"] is None

    editado = cliente.put(
        f"/ejercicios/{creado['id']}",
        json={
            "nombre": "Press banca con barra",
            "grupo_muscular_id": grupo_muscular_id,
        },
    )
    assert editado.status_code == 200, editado.text
    assert cliente.get(f"/ejercicios/{creado['id']}").json()["nombre"] == "Press banca con barra"


def test_una_rutina_devuelve_sus_huecos_y_comodines_ya_resueltos(cliente, grupo_muscular_id):
    """RutinaSlotOut trae los ejercicios completos, no solo sus ids: así el
    frontend no tiene que cruzar datos contra /ejercicios.
    """
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    comodin = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id = crear_rutina(cliente)
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots", json={**_hueco(principal), "alternativa_ids": [comodin]}
    )
    assert respuesta.status_code == 201, respuesta.text

    rutina = cliente.get(f"/rutinas/{rutina_id}").json()
    hueco = rutina["slots"][0]

    assert hueco["ejercicio_principal"]["nombre"] == "Press banca"
    assert [alternativa["nombre"] for alternativa in hueco["alternativas"]] == ["Press en máquina"]


def test_registrar_un_entrenamiento_con_sus_series(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Sentadilla")
    entrenamiento_id = entrenar(cliente, FECHA, notas="Buen día").json()["id"]

    for numero in (1, 2):
        respuesta = serie_en(cliente, entrenamiento_id, ejercicio_id, numero=numero, peso=60.5)
        assert respuesta.status_code == 201

    entrenamiento = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()
    assert len(entrenamiento["series"]) == 2
    assert entrenamiento["series"][0]["ejercicio"]["nombre"] == "Sentadilla"


def test_el_peso_conserva_los_decimales_exactos(cliente, grupo_muscular_id):
    """Es Numeric (Decimal), no float: 100.25 debe volver como 100.25 exacto."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Peso muerto")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]

    serie = serie_en(cliente, entrenamiento_id, ejercicio_id, peso=100.25, repeticiones=5).json()

    assert Decimal(str(serie["peso"])) == Decimal("100.25")


def test_una_serie_con_rpe_se_acepta_y_el_rpe_no_vuelve_en_ninguna_respuesta(
    cliente, grupo_muscular_id
):
    """El RPE se quitó: si un cliente viejo lo sigue mandando (la web enviaba
    `rpe: null` en cada serie), se ignora en vez de dar 422, y no sale ni en la
    serie, ni en la sesión, ni en los dos historiales.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Press militar")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]

    creada = serie_en(cliente, entrenamiento_id, ejercicio_id, peso=40, rpe=8)
    assert creada.status_code == 201, creada.text
    serie = creada.json()
    assert "rpe" not in serie

    editada = cliente.put(
        f"/entrenamientos/{entrenamiento_id}/series/{serie['id']}",
        json={**_serie(cliente, entrenamiento_id, ejercicio_id, peso=42.5), "rpe": 8},
    )
    assert editada.status_code == 200, editada.text
    assert "rpe" not in editada.json()
    assert Decimal(str(editada.json()["peso"])) == Decimal("42.5")

    sesion = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()
    assert [s["id"] for s in sesion["series"]] == [serie["id"]]
    assert "rpe" not in sesion["series"][0]

    del_ejercicio = cliente.get(f"/ejercicios/{ejercicio_id}/historial").json()
    rutina_id = sesion["rutina_id"]
    del_hueco = cliente.get(f"/rutinas/{rutina_id}/slots/{serie['slot_id']}/historial").json()
    for historial in (del_ejercicio, del_hueco):
        series = [s for dia in historial for s in dia["series"]]
        assert [s["id"] for s in series] == [serie["id"]]
        assert "rpe" not in series[0]


def _falta_o_es_nulo(respuesta, campo) -> bool:
    """El 422 es justo por ese campo (ausente o nulo), no por otro del cuerpo."""
    return respuesta.status_code == 422 and [e["loc"] for e in respuesta.json()["detail"]] == [
        ["body", campo]
    ]


@pytest.mark.parametrize("sin_rutina", [{}, {"rutina_id": None}], ids=["ausente", "nula"])
def test_un_entrenamiento_no_se_admite_sin_rutina(cliente, sin_rutina):
    """Toda sesión es de una rutina: sin ella, el cuerpo ni siquiera es válido."""
    respuesta = cliente.post("/entrenamientos", json={"fecha": FECHA, **sin_rutina})

    assert _falta_o_es_nulo(respuesta, "rutina_id"), respuesta.text
    assert cliente.get("/entrenamientos").json() == []


@pytest.mark.parametrize(
    "rutina_del_put, con_series",
    [
        pytest.param("ausente", False, id="ausente"),
        pytest.param("nula", False, id="nula"),
        pytest.param("otra", False, id="otra-en-una-sesion-vacia"),
        pytest.param("otra", True, id="otra-en-una-sesion-con-series"),
        pytest.param("oculta", False, id="oculta"),
    ],
)
def test_el_put_corrige_fecha_y_notas_e_ignora_la_rutina(
    cliente, grupo_muscular_id, rutina_del_put, con_series
):
    """La rutina se fija al crear la sesión, como `cubre_fecha`: el PUT solo corrige
    la fecha y las notas, y la `rutina_id` que traiga se ignora sin dar error.

    - Nula no la deja sin rutina (hace tiempo la convertía en un entrenamiento libre).
    - Otra no la cambia ni en una sesión vacía: antes, sin series ni `cubre_fecha`,
      el PUT sí la cambiaba. Con series, el historial de su hueco sigue igual (si
      cambiara, enseñaría la sesión con el nombre de otra rutina).
    - Una oculta tampoco da 404: no es "elegir algo oculto", porque no se elige.
    """
    entrenamiento = entrenar(cliente, FECHA).json()
    if con_series:
        serie = serie_en(
            cliente, entrenamiento["id"], crear_ejercicio(cliente, grupo_muscular_id, "Remo")
        )
        assert serie.status_code == 201, serie.text
        historial = (
            f"/rutinas/{entrenamiento['rutina_id']}/slots/{serie.json()['slot_id']}/historial"
        )
        historial_antes = cliente.get(historial).json()
    otra = crear_rutina(cliente, "Pull")
    if rutina_del_put == "oculta":
        assert cliente.delete(f"/rutinas/{otra}?modo=ocultar").status_code == 204
    rutina = {"ausente": {}, "nula": {"rutina_id": None}}.get(rutina_del_put, {"rutina_id": otra})

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento['id']}",
        json={"fecha": "2026-09-03", "notas": "Corregida", **rutina},
    )

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["rutina_id"] == entrenamiento["rutina_id"]
    guardado = cliente.get(f"/entrenamientos/{entrenamiento['id']}").json()
    assert (guardado["rutina_id"], guardado["fecha"], guardado["notas"]) == (
        entrenamiento["rutina_id"],
        "2026-09-03",
        "Corregida",
    )
    if con_series:
        # Lo único que cambia en el historial es la fecha corregida.
        [dia] = cliente.get(historial).json()
        assert {**dia, "fecha": FECHA} == historial_antes[0]


@pytest.mark.parametrize("sin_hueco", [{}, {"slot_id": None}], ids=["ausente", "nulo"])
def test_una_serie_no_se_admite_sin_hueco(cliente, grupo_muscular_id, sin_hueco):
    """Toda serie va en un hueco de la rutina de su sesión."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Curl")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={
            "ejercicio_id": ejercicio_id,
            "numero_serie": 1,
            "peso": 20,
            "repeticiones": 10,
            **sin_hueco,
        },
    )

    assert _falta_o_es_nulo(respuesta, "slot_id"), respuesta.text
    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"] == []


@pytest.mark.parametrize("sin_hueco", [{}, {"slot_id": None}], ids=["ausente", "nulo"])
def test_a_una_serie_no_se_le_puede_quitar_el_hueco(cliente, grupo_muscular_id, sin_hueco):
    """Corregir una serie sin mandar su hueco se rechaza y la deja como estaba."""
    curl = crear_ejercicio(cliente, grupo_muscular_id, "Curl")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]
    serie = serie_en(cliente, entrenamiento_id, curl).json()
    cuerpo = _serie(cliente, entrenamiento_id, curl, peso=80)
    del cuerpo["slot_id"]

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}/series/{serie['id']}", json={**cuerpo, **sin_hueco}
    )

    assert _falta_o_es_nulo(respuesta, "slot_id"), respuesta.text
    [guardada] = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"]
    assert (guardada["slot_id"], guardada["peso"]) == (serie["slot_id"], serie["peso"])


def test_un_hueco_no_admite_reps_max_menor_que_reps_min(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Remo")
    rutina_id = crear_rutina(cliente, "Pull")

    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots", json=_hueco(ejercicio_id, series=4, reps=(12, 8))
    )

    assert respuesta.status_code == 422
    assert "reps_max no puede ser menor que reps_min" in str(respuesta.json()["detail"])
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"] == []


def test_no_puede_haber_dos_huecos_con_el_mismo_orden(cliente, grupo_muscular_id):
    """`UNIQUE(rutina_id, orden)`: el endpoint lo comprueba antes y da un 409 legible,
    no el 500 de la base.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Fondos")
    rutina_id = crear_rutina(cliente)
    hueco = _hueco(ejercicio_id, orden=1)

    assert cliente.post(f"/rutinas/{rutina_id}/slots", json=hueco).status_code == 201
    repetido = cliente.post(f"/rutinas/{rutina_id}/slots", json=hueco)

    assert repetido.status_code == 409
    assert repetido.json()["detail"] == "Ya hay un hueco con orden=1 en esta rutina"
    assert len(cliente.get(f"/rutinas/{rutina_id}").json()["slots"]) == 1


def test_no_se_puede_usar_un_grupo_muscular_inexistente(cliente, grupo_muscular_id):
    """Al crear y al editar: 404 con su mensaje, y nada cambia."""
    creado = cliente.post("/ejercicios", json={"nombre": "X", "grupo_muscular_id": 9999})
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo")
    editado = cliente.put(f"/ejercicios/{remo}", json={"nombre": "Y", "grupo_muscular_id": 9999})

    for respuesta in (creado, editado):
        assert respuesta.status_code == 404
        assert respuesta.json()["detail"] == "No existe ningún grupo muscular con id 9999"
    guardado = cliente.get(f"/ejercicios/{remo}").json()
    assert (guardado["nombre"], guardado["grupo_muscular_id"]) == ("Remo", grupo_muscular_id)


def test_un_nombre_formado_solo_por_espacios_no_se_acepta(cliente, grupo_muscular_id):
    """`min_length=1` mide sin recortar, así que "   " lo esquivaría y se
    guardaría un ejercicio (o una rutina, o un programa) sin nombre visible.
    """
    respuestas = [
        cliente.post("/ejercicios", json={"nombre": "   ", "grupo_muscular_id": grupo_muscular_id}),
        cliente.post("/rutinas", json={"nombre": "  \n "}),
        cliente.post("/programas", json={"nombre": "\t"}),
    ]

    for respuesta in respuestas:
        assert respuesta.status_code == 422
        assert [error["loc"] for error in respuesta.json()["detail"]] == [["body", "nombre"]]


# --- Notas sobre un ejercicio -------------------------------------------


def test_se_pueden_acumular_varias_notas_sobre_el_mismo_ejercicio(cliente, grupo_muscular_id):
    """No hay `UNIQUE` sobre el ejercicio a propósito: cada nota es una
    fila independiente, no se sobreescriben entre ellas. Se listan de la más
    reciente a la más antigua.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)

    for texto in ("Primera", "Segunda", "Tercera"):
        assert (
            cliente.post(f"/ejercicios/{ejercicio_id}/notas", json={"nota": texto}).status_code
            == 201
        )

    notas = cliente.get(f"/ejercicios/{ejercicio_id}/notas").json()
    assert [nota["nota"] for nota in notas] == ["Tercera", "Segunda", "Primera"]


def test_las_notas_de_un_ejercicio_no_se_mezclan_con_las_de_otro(cliente, grupo_muscular_id):
    press = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo")

    cliente.post(f"/ejercicios/{press}/notas", json={"nota": "Del press"})
    cliente.post(f"/ejercicios/{remo}/notas", json={"nota": "Del remo"})

    assert [n["nota"] for n in cliente.get(f"/ejercicios/{press}/notas").json()] == ["Del press"]
    assert [n["nota"] for n in cliente.get(f"/ejercicios/{remo}/notas").json()] == ["Del remo"]


def test_una_nota_en_blanco_no_se_acepta(cliente, grupo_muscular_id):
    """Una nota vacía se rechaza por `min_length`, pero `"   "` lo esquivaría
    si el texto no se recortara antes de medirlo. Al crearla y al editarla.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    nota_id = cliente.post(f"/ejercicios/{ejercicio_id}/notas", json={"nota": "Buena"}).json()["id"]
    ruta = f"/ejercicios/{ejercicio_id}/notas"

    respuestas = [
        cliente.post(ruta, json={"nota": ""}),
        cliente.post(ruta, json={"nota": "   "}),
        cliente.put(f"{ruta}/{nota_id}", json={"nota": " \n "}),
    ]

    assert [r.status_code for r in respuestas] == [422, 422, 422]
    assert [n["nota"] for n in cliente.get(ruta).json()] == ["Buena"]


def test_editar_una_nota_no_la_cambia_de_ejercicio(cliente, grupo_muscular_id):
    """`nota` es el único campo editable: un `ejercicio_id` en el cuerpo se ignora y
    la nota sigue en el ejercicio de su ruta.
    """
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo")
    jalon = crear_ejercicio(cliente, grupo_muscular_id, "Jalón")
    nota_id = cliente.post(f"/ejercicios/{remo}/notas", json={"nota": "Original"}).json()["id"]

    respuesta = cliente.put(
        f"/ejercicios/{remo}/notas/{nota_id}", json={"nota": "Editada", "ejercicio_id": jalon}
    )

    assert respuesta.status_code == 200, respuesta.text
    assert (respuesta.json()["nota"], respuesta.json()["ejercicio_id"]) == ("Editada", remo)
    assert [n["id"] for n in cliente.get(f"/ejercicios/{remo}/notas").json()] == [nota_id]
    assert cliente.get(f"/ejercicios/{jalon}/notas").json() == []


# --- Editar y borrar: rutinas, huecos y comodines ------------------------


def test_cambiar_el_nombre_de_una_rutina(cliente):
    rutina_id = crear_rutina(cliente)

    respuesta = cliente.put(f"/rutinas/{rutina_id}", json={"nombre": "Empuje"})

    assert respuesta.status_code == 200
    assert cliente.get(f"/rutinas/{rutina_id}").json()["nombre"] == "Empuje"


def test_editar_un_hueco_cambia_su_ejercicio_y_su_objetivo(cliente, grupo_muscular_id):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    maquina = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id = crear_rutina(cliente)
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
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = crear_rutina(cliente)
    cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca, orden=1))
    segundo = cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca, orden=2)).json()

    respuesta = cliente.put(
        f"/rutinas/{rutina_id}/slots/{segundo['id']}", json=_hueco(banca, orden=1)
    )

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"] == "Ya hay un hueco con orden=1 en esta rutina"
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"][1]["orden"] == 2


def test_un_ejercicio_oculto_no_se_puede_usar_en_un_hueco_nuevo(cliente, grupo_muscular_id):
    """Ocultar significa que deja de ofrecerse para usarlo."""
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    assert cliente.delete(f"/ejercicios/{banca}?modo=ocultar").status_code == 204
    rutina_id = crear_rutina(cliente)

    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca))

    assert respuesta.status_code == 404
    assert respuesta.json()["detail"] == "Ejercicio no encontrado"
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"] == []


# --- Editar y borrar: entrenamientos y series ----------------------------


def test_corregir_una_serie(cliente, grupo_muscular_id):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"
    serie_id = cliente.post(ruta, json=_serie(cliente, entrenamiento_id, banca)).json()["id"]

    respuesta = cliente.put(
        f"{ruta}/{serie_id}",
        json={
            **_serie(cliente, entrenamiento_id, banca, peso=62.5, repeticiones=7),
            "variante": "agarre cerrado",
        },
    )

    assert respuesta.status_code == 200
    corregida = respuesta.json()
    assert Decimal(corregida["peso"]) == Decimal("62.5")
    assert (corregida["repeticiones"], corregida["variante"]) == (7, "agarre cerrado")


def test_borrar_una_serie_deja_las_demas(cliente, grupo_muscular_id):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"
    primera = cliente.post(ruta, json=_serie(cliente, entrenamiento_id, banca, numero=1)).json()[
        "id"
    ]
    cliente.post(ruta, json=_serie(cliente, entrenamiento_id, banca, numero=2))

    assert cliente.delete(f"{ruta}/{primera}").status_code == 204

    series = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"]
    assert [serie["numero_serie"] for serie in series] == [2]
    assert cliente.delete(f"{ruta}/{primera}").status_code == 404


def test_una_serie_no_se_alcanza_por_la_ruta_de_otro_entrenamiento(cliente, grupo_muscular_id):
    """La serie tiene que ser de la sesión de la ruta: si no, da 404 en el PUT y en
    el DELETE y no se toca. Las dos sesiones son de la misma rutina, así que el
    cuerpo del PUT sería válido en cualquiera de ellas: el 404 solo puede ser por la ruta.
    """
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    uno = entrenar(cliente, FECHA).json()["id"]
    otro = entrenar(cliente, "2026-09-05").json()["id"]
    serie = cliente.post(f"/entrenamientos/{uno}/series", json=_serie(cliente, uno, banca)).json()
    cambiada = _serie(cliente, otro, banca, peso=90, slot_id=serie["slot_id"])

    assert (
        cliente.put(f"/entrenamientos/{otro}/series/{serie['id']}", json=cambiada).status_code
        == 404
    )
    assert cliente.delete(f"/entrenamientos/{otro}/series/{serie['id']}").status_code == 404
    assert cliente.get(f"/entrenamientos/{uno}").json()["series"] == [serie]
    assert cliente.get(f"/entrenamientos/{otro}").json()["series"] == []


def test_cancelar_una_sesion_la_borra_con_sus_series(cliente, grupo_muscular_id):
    """Es el Cancelar sesión del diseño: como si no se hubiera empezado."""
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]
    cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json=_serie(cliente, entrenamiento_id, banca)
    )

    assert cliente.delete(f"/entrenamientos/{entrenamiento_id}").status_code == 204

    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").status_code == 404
    assert cliente.get(f"/ejercicios/{banca}/historial").json() == []


def test_corregir_una_serie_no_la_pasa_a_un_hueco_de_otra_rutina(cliente, grupo_muscular_id):
    """El hueco de una serie tiene que ser de la rutina de su sesión (si no, el
    historial de ese hueco mostraría una sesión de otra rutina), también al
    corregirla y aunque el ejercicio sea el principal de los dos huecos. 404 y la
    serie se queda donde estaba. Al apuntarla, en
    `test_un_ejercicio_oculto_o_un_hueco_de_otra_rutina_dan_404_y_no_409`.
    """
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    push = crear_rutina(cliente)
    pull = crear_rutina(cliente, "Pull")
    hueco_de_pull = cliente.post(f"/rutinas/{pull}/slots", json=_hueco(banca)).json()["id"]
    sesion = cliente.post("/entrenamientos", json={"rutina_id": push, "fecha": FECHA}).json()["id"]
    serie = serie_en(cliente, sesion, banca).json()

    respuesta = cliente.put(
        f"/entrenamientos/{sesion}/series/{serie['id']}",
        json=_serie(cliente, sesion, banca, peso=90, slot_id=hueco_de_pull),
    )

    assert respuesta.status_code == 404
    assert "en la rutina de este entrenamiento" in respuesta.json()["detail"]
    assert cliente.get(f"/entrenamientos/{sesion}").json()["series"] == [serie]


def test_un_entrenamiento_no_puede_ser_de_una_rutina_oculta(cliente):
    push = crear_rutina(cliente)
    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    respuesta = cliente.post("/entrenamientos", json={"rutina_id": push, "fecha": FECHA})

    assert respuesta.status_code == 404
    assert respuesta.json()["detail"] == f"No existe ninguna rutina con id {push}"
    assert cliente.get("/entrenamientos").json() == []


# --- Un solo ejercicio por hueco y sesión ---------------------------------
#
# En una sesión, todas las series de un hueco son del mismo ejercicio: apuntar o
# mover una de otro da 409 y no guarda nada. Push tiene dos huecos: el A, de
# Crunch en polea con Plancha de comodín, y el B, de Rueda abdominal con Crunch en
# polea de comodín (para poder mover una serie de crunch de A a B).


@pytest.fixture
def abdominales(cliente, grupo_muscular_id) -> dict:
    crunch = crear_ejercicio(cliente, grupo_muscular_id, "Crunch en polea")
    plancha = crear_ejercicio(cliente, grupo_muscular_id, "Plancha")
    rueda = crear_ejercicio(cliente, grupo_muscular_id, "Rueda abdominal")
    push = crear_rutina(cliente)
    a = cliente.post(
        f"/rutinas/{push}/slots", json={**_hueco(crunch, orden=1), "alternativa_ids": [plancha]}
    ).json()["id"]
    b = cliente.post(
        f"/rutinas/{push}/slots", json={**_hueco(rueda, orden=2), "alternativa_ids": [crunch]}
    ).json()["id"]

    def sesion(fecha=FECHA) -> int:
        respuesta = cliente.post("/entrenamientos", json={"rutina_id": push, "fecha": fecha})
        assert respuesta.status_code == 201, respuesta.text
        return respuesta.json()["id"]

    return SimpleNamespace(
        crunch=crunch, plancha=plancha, rueda=rueda, push=push, a=a, b=b, sesion=sesion
    )


def _apuntar(cliente, sesion, ejercicio_id, slot_id, numero=1, peso=20):
    return cliente.post(
        f"/entrenamientos/{sesion}/series",
        json=_serie(cliente, sesion, ejercicio_id, numero=numero, peso=peso, slot_id=slot_id),
    )


def _apuntadas(cliente, sesion, ejercicio_id, slot_id, cuantas) -> list[dict]:
    series = []
    for numero in range(1, cuantas + 1):
        respuesta = _apuntar(cliente, sesion, ejercicio_id, slot_id, numero=numero)
        assert respuesta.status_code == 201, respuesta.text
        series.append(respuesta.json())
    return series


def _series_de(cliente, sesion) -> list[dict]:
    return cliente.get(f"/entrenamientos/{sesion}").json()["series"]


def test_no_se_apunta_una_serie_de_otro_ejercicio_en_un_hueco_que_ya_tiene_series(
    cliente, abdominales
):
    """Con la serie del crunch apuntada, la plancha (comodín del mismo hueco) ya no
    cabe en esa sesión: 409 con el texto que enseña la web, y no se guarda.
    """
    e = abdominales
    sesion = e.sesion()
    [crunch] = _apuntadas(cliente, sesion, e.crunch, e.a, 1)

    respuesta = _apuntar(cliente, sesion, e.plancha, e.a, numero=2)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"] == (
        "Esta sesión ya tiene la serie de Crunch en polea en ese ejercicio de la rutina, y en "
        "cada uno se hace un solo ejercicio por sesión: borra antes esas series para apuntar "
        "Plancha."
    )
    assert _series_de(cliente, sesion) == [crunch]


def test_el_409_de_mezclar_cuenta_las_series_en_plural(cliente, abdominales):
    e = abdominales
    sesion = e.sesion()
    _apuntadas(cliente, sesion, e.crunch, e.a, 3)

    respuesta = _apuntar(cliente, sesion, e.plancha, e.a, numero=4)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"].startswith(
        "Esta sesión ya tiene las 3 series de Crunch en polea en ese ejercicio de la rutina,"
    )
    assert respuesta.json()["detail"].endswith("para apuntar Plancha.")
    assert len(_series_de(cliente, sesion)) == 3


def test_mas_series_del_mismo_ejercicio_en_el_hueco_si_se_apuntan(cliente, abdominales):
    e = abdominales
    sesion = e.sesion()

    _apuntadas(cliente, sesion, e.plancha, e.a, 3)

    assert [s["ejercicio_id"] for s in _series_de(cliente, sesion)] == [e.plancha] * 3


def test_el_mismo_hueco_admite_otro_ejercicio_en_otra_sesion(cliente, abdominales):
    """La regla es por sesión, y mira la de la ruta: el 5 se hace con plancha
    aunque el 4 se hiciera con crunch, y después el crunch ya no cabe en la del 5
    aunque sí estuviera en la del 4.
    """
    e = abdominales
    dia_4, dia_5 = e.sesion("2026-09-04"), e.sesion("2026-09-05")
    _apuntadas(cliente, dia_4, e.crunch, e.a, 2)

    con_plancha = _apuntar(cliente, dia_5, e.plancha, e.a)
    con_crunch = _apuntar(cliente, dia_5, e.crunch, e.a, numero=2)

    assert con_plancha.status_code == 201, con_plancha.text
    assert con_crunch.status_code == 409, con_crunch.text
    assert "la serie de Plancha" in con_crunch.json()["detail"]


def test_otro_hueco_de_la_misma_sesion_admite_otro_ejercicio(cliente, abdominales):
    """La regla es por hueco: el crunch en A y la rueda en B conviven."""
    e = abdominales
    sesion = e.sesion()
    _apuntadas(cliente, sesion, e.crunch, e.a, 1)

    respuesta = _apuntar(cliente, sesion, e.rueda, e.b)

    assert respuesta.status_code == 201, respuesta.text


def test_cambiar_el_ejercicio_de_la_unica_serie_del_hueco_si_se_puede(cliente, abdominales):
    """No mezcla nada: la propia serie no cuenta. Después, el hueco es de plancha
    en esa sesión, y el crunch ya no cabe.
    """
    e = abdominales
    sesion = e.sesion()
    [serie] = _apuntadas(cliente, sesion, e.crunch, e.a, 1)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion}/series/{serie['id']}",
        json=_serie(cliente, sesion, e.plancha, slot_id=e.a),
    )

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["ejercicio_id"] == e.plancha
    assert _apuntar(cliente, sesion, e.crunch, e.a, numero=2).status_code == 409


def test_cambiar_el_ejercicio_de_una_serie_con_mas_del_anterior_da_409(cliente, abdominales):
    """Quedarían las otras dos de crunch con una de plancha: 409, que cuenta las
    que quedan (no la que se cambia), y la serie se relee igual.
    """
    e = abdominales
    sesion = e.sesion()
    primera, *_ = _apuntadas(cliente, sesion, e.crunch, e.a, 3)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion}/series/{primera['id']}",
        json=_serie(cliente, sesion, e.plancha, peso=99, slot_id=e.a),
    )

    assert respuesta.status_code == 409, respuesta.text
    assert "ya tiene las 2 series de Crunch en polea" in respuesta.json()["detail"]
    assert respuesta.json()["detail"].endswith("para apuntar Plancha.")
    assert _series_de(cliente, sesion)[0] == primera


def test_mover_una_serie_a_un_hueco_con_series_de_otro_ejercicio_da_409(cliente, abdominales):
    """El crunch es comodín de B, así que el hueco vale (no es un 422), pero B ya
    tiene la rueda en esa sesión. Se mira el hueco de destino, no el de origen.
    """
    e = abdominales
    sesion = e.sesion()
    [crunch] = _apuntadas(cliente, sesion, e.crunch, e.a, 1)
    _apuntadas(cliente, sesion, e.rueda, e.b, 1)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion}/series/{crunch['id']}",
        json=_serie(cliente, sesion, e.crunch, slot_id=e.b),
    )

    assert respuesta.status_code == 409, respuesta.text
    assert "la serie de Rueda abdominal" in respuesta.json()["detail"]
    assert respuesta.json()["detail"].endswith("para apuntar Crunch en polea.")
    assert _series_de(cliente, sesion)[0] == crunch


def test_mover_una_serie_a_un_hueco_vacio_o_con_su_ejercicio_si_se_puede(cliente, abdominales):
    """El otro lado del anterior: en B solo hay crunch (o nada), así que mover una
    serie de crunch de A a B no mezcla nada, aunque A siga teniendo más crunch.
    """
    e = abdominales
    sesion = e.sesion()
    primera, segunda = _apuntadas(cliente, sesion, e.crunch, e.a, 2)
    ruta = f"/entrenamientos/{sesion}/series"

    a_vacio = cliente.put(
        f"{ruta}/{primera['id']}", json=_serie(cliente, sesion, e.crunch, slot_id=e.b)
    )
    con_crunch = cliente.put(
        f"{ruta}/{segunda['id']}", json=_serie(cliente, sesion, e.crunch, numero=2, slot_id=e.b)
    )

    assert a_vacio.status_code == 200, a_vacio.text
    assert con_crunch.status_code == 200, con_crunch.text
    assert {s["slot_id"] for s in _series_de(cliente, sesion)} == {e.b}


def test_corregir_peso_reps_o_variante_de_una_serie_no_mira_el_hueco(cliente, abdominales):
    e = abdominales
    sesion = e.sesion()
    primera, _ = _apuntadas(cliente, sesion, e.crunch, e.a, 2)
    _apuntadas(cliente, sesion, e.rueda, e.b, 1)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion}/series/{primera['id']}",
        json={
            **_serie(cliente, sesion, e.crunch, peso=25, repeticiones=15, slot_id=e.a),
            "variante": "con cuerda",
        },
    )

    assert respuesta.status_code == 200, respuesta.text
    corregida = respuesta.json()
    assert (Decimal(corregida["peso"]), corregida["repeticiones"], corregida["variante"]) == (
        Decimal("25"),
        15,
        "con cuerda",
    )


def test_una_sesion_mezclada_de_antes_del_blindaje_se_sigue_pudiendo_corregir(
    cliente, sesion_bd, abdominales
):
    """Datos de antes de la regla (la API ya no deja montarlos, así que van a mano
    en la base): corregir el peso de una serie sin cambiar su hueco ni su ejercicio
    no es mezclar nada nuevo, así que no da 409. Es lo único que distingue que el
    PUT solo mire la regla cuando cambia el par (hueco, ejercicio).
    """
    from app.models import Serie

    e = abdominales
    sesion = e.sesion()
    [crunch] = _apuntadas(cliente, sesion, e.crunch, e.a, 1)
    sesion_bd.add(
        Serie(
            entrenamiento_id=sesion,
            slot_id=e.a,
            ejercicio_id=e.plancha,
            numero_serie=2,
            peso=Decimal("0"),
            repeticiones=30,
        )
    )
    sesion_bd.commit()

    respuesta = cliente.put(
        f"/entrenamientos/{sesion}/series/{crunch['id']}",
        json=_serie(cliente, sesion, e.crunch, peso=22.5, slot_id=e.a),
    )

    assert respuesta.status_code == 200, respuesta.text
    assert Decimal(respuesta.json()["peso"]) == Decimal("22.5")


def test_un_ejercicio_que_no_es_del_hueco_da_422_y_no_409(cliente, grupo_muscular_id, abdominales):
    """El orden de las comprobaciones: que el ejercicio no sea del hueco se dice
    antes que la mezcla, al apuntar y al corregir. Si no, la web enseñaría «borra
    antes esas series» para algo que no se arregla borrando nada.
    """
    e = abdominales
    curl = crear_ejercicio(cliente, grupo_muscular_id, "Curl")
    sesion = e.sesion()
    [crunch] = _apuntadas(cliente, sesion, e.crunch, e.a, 1)
    _apuntadas(cliente, sesion, e.rueda, e.b, 1)

    al_apuntar = _apuntar(cliente, sesion, curl, e.a, numero=2)
    # La rueda no es del hueco A (que tiene crunch): 422, no el 409 de la mezcla.
    al_corregir = cliente.put(
        f"/entrenamientos/{sesion}/series/{crunch['id']}",
        json=_serie(cliente, sesion, e.rueda, slot_id=e.a),
    )

    assert al_apuntar.status_code == 422, al_apuntar.text
    assert al_corregir.status_code == 422, al_corregir.text
    assert _series_de(cliente, sesion)[0] == crunch


def test_un_ejercicio_oculto_o_un_hueco_de_otra_rutina_dan_404_y_no_409(
    cliente, grupo_muscular_id, abdominales
):
    """Una serie nueva no puede ir en un hueco de otra rutina (el historial de ese
    hueco enseñaría una sesión que no es suya) ni ser de un ejercicio oculto (lo
    oculto deja de ofrecerse): 404, también cuando además mezclaría ejercicios en
    un hueco, porque lo que no se puede elegir se dice antes que la mezcla.
    """
    e = abdominales
    sesion = e.sesion()
    [crunch] = _apuntadas(cliente, sesion, e.crunch, e.a, 1)
    pull = crear_rutina(cliente, "Pull")
    hueco_de_pull = cliente.post(f"/rutinas/{pull}/slots", json=_hueco(e.plancha)).json()["id"]

    de_otra_rutina = _apuntar(cliente, sesion, e.plancha, hueco_de_pull, numero=2)
    assert cliente.delete(f"/ejercicios/{e.plancha}?modo=ocultar").status_code == 204
    oculto = _apuntar(cliente, sesion, e.plancha, e.a, numero=2)

    assert de_otra_rutina.status_code == 404, de_otra_rutina.text
    assert "en la rutina de este entrenamiento" in de_otra_rutina.json()["detail"]
    assert oculto.status_code == 404, oculto.text
    assert oculto.json()["detail"] == "Ejercicio no encontrado"
    assert _series_de(cliente, sesion) == [crunch]


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
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json=_serie(cliente, entrenamiento_id, banca, peso="9999.99"),
    )

    assert respuesta.status_code == 201
    assert Decimal(respuesta.json()["peso"]) == Decimal("9999.99")


@pytest.mark.parametrize(
    "campo, valor", [("peso", 10000), ("repeticiones", DEMASIADO), ("numero_serie", DEMASIADO)]
)
def test_una_serie_con_un_numero_que_no_cabe_da_422(cliente, grupo_muscular_id, campo, valor):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={**_serie(cliente, entrenamiento_id, banca), campo: valor},
    )

    assert respuesta.status_code == 422
    assert [error["loc"] for error in respuesta.json()["detail"]] == [["body", campo]]


@pytest.mark.parametrize("campo", ["orden", "series_objetivo", "reps_max"])
def test_un_hueco_con_un_numero_que_no_cabe_da_422(cliente, grupo_muscular_id, campo):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = crear_rutina(cliente)

    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots", json={**_hueco(banca), campo: DEMASIADO}
    )

    assert respuesta.status_code == 422


@pytest.mark.parametrize(
    "campo, tope",
    [("numero_serie", 100), ("repeticiones", 1000), ("peso", Decimal("9999.99"))],
)
def test_una_serie_admite_su_tope_justo_y_no_uno_mas(cliente, grupo_muscular_id, campo, tope):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"
    paso = Decimal("0.01") if campo == "peso" else 1

    justo = cliente.post(ruta, json={**_serie(cliente, entrenamiento_id, banca), campo: str(tope)})
    pasado = cliente.post(
        ruta, json={**_serie(cliente, entrenamiento_id, banca), campo: str(tope + paso)}
    )

    assert (justo.status_code, pasado.status_code) == (201, 422)
    assert [error["loc"] for error in pasado.json()["detail"]] == [["body", campo]]


@pytest.mark.parametrize(
    "campo, tope", [("orden", 100), ("series_objetivo", 50), ("reps_max", 1000)]
)
def test_un_hueco_admite_su_tope_justo_y_no_uno_mas(cliente, grupo_muscular_id, campo, tope):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = crear_rutina(cliente)
    ruta = f"/rutinas/{rutina_id}/slots"

    pasado = cliente.post(ruta, json={**_hueco(banca), campo: tope + 1})
    justo = cliente.post(ruta, json={**_hueco(banca), campo: tope})

    assert (justo.status_code, pasado.status_code) == (201, 422)


def test_reps_min_tambien_tiene_tope(cliente, grupo_muscular_id):
    """No se puede probar con el código solo: un `reps_min` de más de 1000 obliga a un
    `reps_max` igual de alto (o salta el rango), y ese ya da 422 por su cuenta. Se
    mira que el error nombre también a `reps_min`.
    """
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = crear_rutina(cliente)

    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots", json=_hueco(banca, reps=(1001, 1001)))

    assert respuesta.status_code == 422
    campos = {error["loc"][-1] for error in respuesta.json()["detail"]}
    assert campos == {"reps_min", "reps_max"}


@pytest.mark.parametrize("campo, valor", [("repeticiones", 0), ("numero_serie", 0)])
def test_una_serie_con_un_numero_sin_sentido_da_422(cliente, grupo_muscular_id, campo, valor):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={**_serie(cliente, entrenamiento_id, banca), campo: valor},
    )

    assert respuesta.status_code == 422
    assert [error["loc"] for error in respuesta.json()["detail"]] == [["body", campo]]


def test_un_peso_negativo_en_peso_y_repeticiones_da_422_con_su_mensaje(cliente, grupo_muscular_id):
    """Antes lo rechazaba el esquema (`ge=0`); ahora el esquema admite negativos (la
    ayuda de los ejercicios de peso corporal) y el 422 es el de las medidas del tipo.
    """
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json=_serie(cliente, entrenamiento_id, banca, peso=-1),
    )

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == (
        "El peso no puede ser negativo: solo los ejercicios de peso corporal admiten ayuda."
    )
    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"] == []


@pytest.mark.parametrize("campo", ["orden", "series_objetivo", "reps_min"])
def test_un_hueco_con_un_cero_da_422(cliente, grupo_muscular_id, campo):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = crear_rutina(cliente)

    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots", json={**_hueco(banca), campo: 0})

    assert respuesta.status_code == 422


# --- Textos que no caben en su columna -----------------------------------
#
# Mismo riesgo que con los números: cada texto tiene su longitud máxima en la
# base de datos, y si el esquema no la repite, uno más largo llega a Postgres y
# la respuesta es un 500 en vez de un 422.


def test_ningun_texto_mas_largo_que_su_columna_llega_a_la_base(cliente, grupo_muscular_id):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id = crear_rutina(cliente)
    programa_id = cliente.post("/programas", json={"nombre": "PPL"}).json()["id"]
    entrenamiento_id = entrenar(cliente, FECHA).json()["id"]
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
        (
            "post",
            "/entrenamientos",
            {"rutina_id": rutina_id, "fecha": "2026-09-01", "notas": "x" * 1001},
        ),
        (
            "put",
            f"/entrenamientos/{entrenamiento_id}",
            {"fecha": FECHA, "notas": "x" * 1001},
        ),
        (
            "post",
            f"/entrenamientos/{entrenamiento_id}/series",
            {**_serie(cliente, entrenamiento_id, banca), "variante": "x" * 101},
        ),
    ]

    for metodo, ruta, cuerpo in peticiones:
        respuesta = getattr(cliente, metodo)(ruta, json=cuerpo)
        assert respuesta.status_code == 422, f"{metodo.upper()} {ruta}: {respuesta.status_code}"
        # El 422 tiene que ser por el texto largo, no por un campo obligatorio que
        # le falte al cuerpo: así pasaba antes con los entrenamientos sin rutina_id.
        tipos = {error["type"] for error in respuesta.json()["detail"]}
        assert tipos == {"string_too_long"}, f"{metodo.upper()} {ruta}: {tipos}"


def test_un_nombre_se_guarda_sin_los_espacios_de_los_lados(cliente, grupo_muscular_id):
    creado = cliente.post(
        "/ejercicios", json={"nombre": "  Press banca  ", "grupo_muscular_id": grupo_muscular_id}
    ).json()

    assert creado["nombre"] == "Press banca"


# --- Textos opcionales ---------------------------------------------------


def test_los_textos_opcionales_en_blanco_se_guardan_como_nulos(cliente, grupo_muscular_id):
    """ "Sin descripción" o "sin variante" es siempre null, nunca "" ni unos espacios
    que no dicen nada. Lo que sí dice algo se guarda recortado.
    """
    en_blanco = cliente.post(
        "/ejercicios",
        json={"nombre": "Curl", "grupo_muscular_id": grupo_muscular_id, "descripcion": "   "},
    ).json()
    con_texto = cliente.post(
        "/ejercicios",
        json={
            "nombre": "Remo",
            "grupo_muscular_id": grupo_muscular_id,
            "descripcion": "  Con barra  ",
        },
    ).json()
    entrenamiento = entrenar(cliente, FECHA, notas="").json()
    serie = serie_en(cliente, entrenamiento["id"], en_blanco["id"], peso=20, variante="  ").json()

    assert en_blanco["descripcion"] is None
    assert con_texto["descripcion"] == "Con barra"
    assert entrenamiento["notas"] is None
    assert serie["variante"] is None


# --- Los listados ----------------------------------------------------------


def test_rutinas_programas_y_ejercicios_se_listan_por_nombre(cliente, grupo_muscular_id):
    """Por orden alfabético (decisión del autor), no por orden de creación: se crean
    en otro orden para que el de los ids no lo dé hecho. También los ocultos.
    """
    for nombre in ("Push", "Leg", "Pull"):
        crear_rutina(cliente, nombre)
        cliente.post("/programas", json={"nombre": f"{nombre} semanal"})
    for nombre in ("Zancada búlgara propia", "Abdominal propio", "Máquina propia"):
        crear_ejercicio(cliente, grupo_muscular_id, nombre)
    for nombre in ("Torso", "Brazos"):
        rutina = crear_rutina(cliente, nombre)
        assert cliente.delete(f"/rutinas/{rutina}?modo=ocultar").status_code == 204

    def nombres(ruta, **params):
        return [x["nombre"] for x in cliente.get(ruta, params=params).json()]

    assert nombres("/rutinas") == ["Leg", "Pull", "Push"]
    assert nombres("/rutinas", ocultas=True) == ["Brazos", "Torso"]
    assert nombres("/programas") == ["Leg semanal", "Pull semanal", "Push semanal"]
    propios = [n for n in nombres("/ejercicios") if n.endswith(("propia", "propio"))]
    assert propios == ["Abdominal propio", "Máquina propia", "Zancada búlgara propia"]


# --- Lo que no existe ----------------------------------------------------
#
# Escribir sobre un id que no existe da 404 (el 403 es solo para los predefinidos). Se
# mira también el texto: un 404 de una ruta mal escrita diría "Not Found".

INEXISTENTE = 999_999


@pytest.mark.parametrize(
    "metodo, ruta, cuerpo, detalle",
    [
        pytest.param(
            "put", "/ejercicios/{id}", "ejercicio", "Ejercicio no encontrado", id="ejercicio-put"
        ),
        pytest.param(
            "delete", "/ejercicios/{id}", None, "Ejercicio no encontrado", id="ejercicio-delete"
        ),
        pytest.param(
            "post",
            "/ejercicios/{id}/mostrar",
            None,
            "Ejercicio no encontrado",
            id="ejercicio-mostrar",
        ),
        pytest.param(
            "put", "/programas/{id}", "programa", "Programa no encontrado", id="programa-put"
        ),
        pytest.param(
            "delete", "/programas/{id}", None, "Programa no encontrado", id="programa-delete"
        ),
        pytest.param(
            "post", "/programas/{id}/activar", None, "Programa no encontrado", id="programa-activar"
        ),
        pytest.param(
            "post",
            "/programas/{id}/desactivar",
            None,
            "Programa no encontrado",
            id="programa-desactivar",
        ),
        pytest.param(
            "post", "/programas/{id}/mostrar", None, "Programa no encontrado", id="programa-mostrar"
        ),
        pytest.param(
            "put",
            "/programas/{id}/dias/1",
            "dia",
            "Programa no encontrado",
            id="programa-poner-dia",
        ),
        pytest.param(
            "delete",
            "/programas/{id}/dias/1",
            None,
            "Programa no encontrado",
            id="programa-quitar-dia",
        ),
    ],
)
def test_modificar_un_ejercicio_o_un_programa_que_no_existe_da_404(
    cliente, grupo_muscular_id, metodo, ruta, cuerpo, detalle
):
    cuerpos = {
        "ejercicio": lambda: {"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id},
        "programa": lambda: {"nombre": "PPL"},
        # Una rutina que sí existe: el 404 tiene que ser por el programa.
        "dia": lambda: {"rutina_id": crear_rutina(cliente)},
    }
    argumentos = {} if cuerpo is None else {"json": cuerpos[cuerpo]()}

    respuesta = getattr(cliente, metodo)(ruta.format(id=INEXISTENTE), **argumentos)

    assert respuesta.status_code == 404, respuesta.text
    assert respuesta.json()["detail"] == detalle


@pytest.fixture
def lo_que_existe(cliente, grupo_muscular_id) -> dict:
    """Un ejercicio, una rutina con su hueco y una sesión de esa rutina: los padres
    que sí existen cuando lo que falta es el hijo.
    """
    ejercicio = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina = crear_rutina(cliente)
    hueco = cliente.post(f"/rutinas/{rutina}/slots", json=_hueco(ejercicio)).json()["id"]
    sesion = cliente.post("/entrenamientos", json={"rutina_id": rutina, "fecha": FECHA}).json()
    return {"ejercicio": ejercicio, "rutina": rutina, "hueco": hueco, "sesion": sesion["id"]}


NO_HAY_EJERCICIO = "Ejercicio no encontrado"
NO_HAY_RUTINA = "Rutina no encontrada"
NO_HAY_HUECO = "Hueco no encontrado"
NO_HAY_SESION = "Entrenamiento no encontrado"


@pytest.mark.parametrize(
    "metodo, ruta, cuerpo, detalle",
    [
        ("get", "/ejercicios/{X}", None, NO_HAY_EJERCICIO),
        ("get", "/ejercicios/{X}/historial", None, NO_HAY_EJERCICIO),
        ("get", "/ejercicios/{X}/donde-se-usa", None, NO_HAY_EJERCICIO),
        ("get", "/ejercicios/{X}/aviso-de-borrado", None, NO_HAY_EJERCICIO),
        ("get", "/ejercicios/{X}/notas", None, NO_HAY_EJERCICIO),
        ("post", "/ejercicios/{X}/notas", "nota", NO_HAY_EJERCICIO),
        ("put", "/ejercicios/{X}/notas/1", "nota", NO_HAY_EJERCICIO),
        ("delete", "/ejercicios/{X}/notas/1", None, NO_HAY_EJERCICIO),
        ("put", "/ejercicios/{ejercicio}/notas/{X}", "nota", "Nota no encontrada"),
        ("delete", "/ejercicios/{ejercicio}/notas/{X}", None, "Nota no encontrada"),
        ("get", "/rutinas/{X}", None, NO_HAY_RUTINA),
        ("get", "/rutinas/{X}/aviso-de-borrado", None, NO_HAY_RUTINA),
        ("put", "/rutinas/{X}", "rutina", NO_HAY_RUTINA),
        ("delete", "/rutinas/{X}", None, NO_HAY_RUTINA),
        ("post", "/rutinas/{X}/mostrar", None, NO_HAY_RUTINA),
        ("post", "/rutinas/{X}/duplicar", None, NO_HAY_RUTINA),
        ("put", "/rutinas/{X}/orden", "orden", NO_HAY_RUTINA),
        ("post", "/rutinas/{X}/slots", "hueco", NO_HAY_RUTINA),
        ("put", "/rutinas/{X}/slots/{hueco}", "hueco", NO_HAY_RUTINA),
        ("delete", "/rutinas/{X}/slots/{hueco}", None, NO_HAY_RUTINA),
        ("post", "/rutinas/{X}/slots/{hueco}/mostrar", None, NO_HAY_RUTINA),
        ("get", "/rutinas/{X}/slots/{hueco}/historial", None, NO_HAY_RUTINA),
        ("get", "/rutinas/{X}/slots/{hueco}/aviso-de-borrado", None, NO_HAY_RUTINA),
        ("put", "/rutinas/{rutina}/slots/{X}", "hueco", NO_HAY_HUECO),
        ("delete", "/rutinas/{rutina}/slots/{X}", None, NO_HAY_HUECO),
        ("post", "/rutinas/{rutina}/slots/{X}/mostrar", None, NO_HAY_HUECO),
        ("get", "/rutinas/{rutina}/slots/{X}/historial", None, NO_HAY_HUECO),
        ("get", "/rutinas/{rutina}/slots/{X}/aviso-de-borrado", None, NO_HAY_HUECO),
        ("get", "/programas/{X}", None, "Programa no encontrado"),
        ("get", "/entrenamientos/{X}", None, NO_HAY_SESION),
        ("put", "/entrenamientos/{X}", "sesion", NO_HAY_SESION),
        ("delete", "/entrenamientos/{X}", None, NO_HAY_SESION),
        ("post", "/entrenamientos/{X}/terminar", None, NO_HAY_SESION),
        ("post", "/entrenamientos/{X}/series", "serie", NO_HAY_SESION),
        ("put", "/entrenamientos/{X}/series/1", "serie", NO_HAY_SESION),
        ("delete", "/entrenamientos/{X}/series/1", None, NO_HAY_SESION),
        ("put", "/entrenamientos/{sesion}/series/{X}", "serie", "Serie no encontrada"),
        ("delete", "/entrenamientos/{sesion}/series/{X}", None, "Serie no encontrada"),
    ],
)
def test_leer_o_modificar_algo_que_no_existe_da_404_con_su_mensaje(
    cliente, lo_que_existe, metodo, ruta, cuerpo, detalle
):
    """Lo mismo para el resto de recursos y sus hijos: con el padre inexistente, el
    404 es el del padre; con el padre bien y el hijo inexistente, el del hijo. El
    cuerpo es válido, para que el 404 no pueda ser un 422 de otra cosa. Un hijo que
    existe pero es de otro padre, en el test de cada recurso (busca «la ruta de»).
    """
    hay = lo_que_existe
    cuerpos = {
        "nota": {"nota": "Agarre cerrado"},
        "rutina": {"nombre": "Empuje"},
        "orden": {"slot_ids": []},
        "hueco": _hueco(hay["ejercicio"], orden=2),
        "sesion": {"fecha": FECHA},
        "serie": {
            "ejercicio_id": hay["ejercicio"],
            "slot_id": hay["hueco"],
            "numero_serie": 1,
            "peso": 60,
            "repeticiones": 8,
        },
    }
    argumentos = {} if cuerpo is None else {"json": cuerpos[cuerpo]}

    respuesta = getattr(cliente, metodo)(ruta.format(X=INEXISTENTE, **hay), **argumentos)

    assert respuesta.status_code == 404, respuesta.text
    assert respuesta.json()["detail"] == detalle


@pytest.mark.parametrize("donde", ["sesion", "dia de programa", "dia planificado", "serie"])
def test_elegir_algo_que_no_existe_da_404_y_no_guarda_nada(
    cliente, sesion_bd, lo_que_existe, donde
):
    """Un id que llega en el cuerpo y no existe se trata como uno oculto: 404, porque
    no se puede elegir, y nada se queda a medias.
    """
    from sqlalchemy import func, select

    from app.fechas import hoy
    from app.models import Entrenamiento, ExcepcionDelPlan, ProgramaDia, Serie

    hay = lo_que_existe
    if donde == "sesion":
        respuesta = cliente.post(
            "/entrenamientos", json={"rutina_id": INEXISTENTE, "fecha": "2026-09-05"}
        )
        tabla, cuantas = Entrenamiento, 1
    elif donde == "dia de programa":
        programa = cliente.post("/programas", json={"nombre": "PPL"}).json()["id"]
        respuesta = cliente.put(f"/programas/{programa}/dias/1", json={"rutina_id": INEXISTENTE})
        tabla, cuantas = ProgramaDia, 0
    elif donde == "dia planificado":
        respuesta = cliente.put(
            f"/plan/excepciones/{hoy().isoformat()}", json={"rutina_id": INEXISTENTE}
        )
        tabla, cuantas = ExcepcionDelPlan, 0
    else:
        respuesta = cliente.post(
            f"/entrenamientos/{hay['sesion']}/series",
            json={
                "ejercicio_id": INEXISTENTE,
                "slot_id": hay["hueco"],
                "numero_serie": 1,
                "peso": 60,
                "repeticiones": 8,
            },
        )
        tabla, cuantas = Serie, 0

    assert respuesta.status_code == 404, respuesta.text
    esperado = (
        NO_HAY_EJERCICIO if donde == "serie" else f"No existe ninguna rutina con id {INEXISTENTE}"
    )
    assert respuesta.json()["detail"] == esperado
    assert sesion_bd.scalar(select(func.count()).select_from(tabla)) == cuantas
