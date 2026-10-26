"""Tests del historial de progresión de un ejercicio: `/ejercicios/{id}/historial`.

Lo que se prueba es la consulta de `app/historial.py`: que la agrupación por sesión
no mezcla días ni entrenamientos, que `?limite=` recorta sesiones enteras (nunca
series sueltas), que el rango de fechas incluye sus dos extremos, que cruza rutinas
y papeles (principal o comodín) y que ocultar algo no esconde lo que se hizo.

El historial de un hueco (`/rutinas/{id}/slots/{slot_id}/historial`) existió y se
quitó por no tener uso: que la ruta ya no responde, al final.
"""

import pytest

from tests.ayudas import crear_ejercicio, crear_hueco, crear_rutina, poner_alternativas, serie_en
from tests.ayudas import entrenar as entrenar_en

# --- Ayudantes para montar escenarios ------------------------------------


def crear_entrenamiento(cliente, fecha, rutina_id=None) -> int:
    """De la rutina que se diga o, si no, de una rutina de prueba."""
    respuesta = entrenar_en(cliente, fecha, rutina_id)
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def registrar_serie(
    cliente, entrenamiento_id, ejercicio_id, numero_serie=1, peso=60, slot_id=None
) -> int:
    # Sin hueco que se diga, en uno de la rutina de la sesión con ese ejercicio.
    campos = {} if slot_id is None else {"slot_id": slot_id}
    respuesta = serie_en(
        cliente, entrenamiento_id, ejercicio_id, numero=numero_serie, peso=peso, **campos
    )
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def entrenar(cliente, fecha, ejercicio_id, rutina_id=None, slot_id=None, series=1) -> int:
    """Un día completo: la sesión y sus series, todas del mismo ejercicio/hueco."""
    entrenamiento_id = crear_entrenamiento(cliente, fecha, rutina_id)
    for numero in range(1, series + 1):
        registrar_serie(cliente, entrenamiento_id, ejercicio_id, numero, slot_id=slot_id)
    return entrenamiento_id


@pytest.fixture
def escenario(cliente, grupo_muscular_id):
    """Lo mínimo para tener historial: un ejercicio, una rutina y un hueco suyo."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id = crear_rutina(cliente)
    slot_id = crear_hueco(cliente, rutina_id, ejercicio_id)
    return {"ejercicio_id": ejercicio_id, "rutina_id": rutina_id, "slot_id": slot_id}


def historial_de_ejercicio(cliente, ejercicio_id, **filtros):
    respuesta = cliente.get(f"/ejercicios/{ejercicio_id}/historial", params=filtros)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


# --- Agrupación por sesión -----------------------------------------------


def test_un_ejercicio_sin_series_tiene_el_historial_vacio(cliente, escenario):
    assert historial_de_ejercicio(cliente, escenario["ejercicio_id"]) == []


def test_cada_dia_es_una_entrada_y_van_de_la_mas_reciente_a_la_mas_antigua(cliente, escenario):
    entrenar(
        cliente,
        "2026-09-01",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=3,
    )
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=2,
    )

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-05", "2026-09-01"]
    assert [len(sesion["series"]) for sesion in historial] == [2, 3]
    assert [sesion["rutina"] for sesion in historial] == ["Push", "Push"]


def test_las_series_de_cada_dia_salen_ordenadas_por_numero_de_serie(cliente, escenario):
    """Se registran desordenadas a propósito: el orden lo pone la consulta, no
    el orden de inserción.
    """
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    for numero in (3, 1, 2):
        registrar_serie(
            cliente,
            entrenamiento_id,
            escenario["ejercicio_id"],
            numero_serie=numero,
            slot_id=escenario["slot_id"],
        )

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert [serie["numero_serie"] for serie in historial[0]["series"]] == [1, 2, 3]


def test_una_sesion_solo_trae_las_series_de_ese_ejercicio_no_el_entrenamiento_entero(
    cliente, escenario, grupo_muscular_id
):
    """El mismo día se hicieron dos ejercicios: el historial de uno no puede
    arrastrar las series del otro.
    """
    otro_ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Fondos")
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    registrar_serie(
        cliente, entrenamiento_id, escenario["ejercicio_id"], 1, slot_id=escenario["slot_id"]
    )
    registrar_serie(cliente, entrenamiento_id, otro_ejercicio_id, 2)

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert len(historial) == 1
    assert [serie["numero_serie"] for serie in historial[0]["series"]] == [1]


def test_el_mismo_ejercicio_en_dos_huecos_junta_en_su_historial_las_series_de_ambos(
    cliente, escenario
):
    """Un ejercicio puede ocupar dos huecos de la misma rutina. Su historial
    junta las series de ambos, y cada una dice de qué hueco es.
    """
    segundo_slot_id = crear_hueco(
        cliente, escenario["rutina_id"], escenario["ejercicio_id"], orden=2
    )
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    registrar_serie(
        cliente,
        entrenamiento_id,
        escenario["ejercicio_id"],
        1,
        peso=60,
        slot_id=escenario["slot_id"],
    )
    registrar_serie(
        cliente, entrenamiento_id, escenario["ejercicio_id"], 1, peso=25, slot_id=segundo_slot_id
    )

    del_ejercicio = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert len(del_ejercicio) == 1
    assert sorted(float(serie["peso"]) for serie in del_ejercicio[0]["series"]) == [25.0, 60.0]

    # Las dos series numeran desde 1, así que sin el slot_id no habría forma de
    # saber cuál pertenece a cada hueco.
    por_hueco = {serie["slot_id"]: float(serie["peso"]) for serie in del_ejercicio[0]["series"]}
    assert por_hueco == {escenario["slot_id"]: 60.0, segundo_slot_id: 25.0}


# --- La "última vez" de un ejercicio -------------------------------------
#
# Al entrenar se compara con la última vez que se hizo ESE ejercicio, no con la
# última sesión del hueco: si la semana pasada tocó el comodín, sus pesos no
# sirven de referencia para el principal.


@pytest.fixture
def hueco_con_comodin(cliente, grupo_muscular_id, escenario):
    """El escenario de siempre, con un comodín en el hueco y tres días: el
    principal el 1, el comodín el 8 y otra vez el principal el 15.
    """
    comodin_id = crear_ejercicio(cliente, grupo_muscular_id, "Press banca en máquina")
    poner_alternativas(cliente, escenario["rutina_id"], escenario["slot_id"], [comodin_id])
    for fecha, ejercicio_id in [
        ("2026-09-01", escenario["ejercicio_id"]),
        ("2026-09-08", comodin_id),
        ("2026-09-15", escenario["ejercicio_id"]),
    ]:
        entrenar(cliente, fecha, ejercicio_id, escenario["rutina_id"], escenario["slot_id"])
    return {**escenario, "comodin_id": comodin_id}


def test_la_ultima_vez_de_un_ejercicio_cruza_rutinas_y_papeles(
    cliente, grupo_muscular_id, hueco_con_comodin
):
    """La consulta con la que la sesión compara cada ejercicio: su historial hasta el
    día de la sesión, dos días (uno puede ser la propia sesión), en la rutina que fuera
    y fuera principal o alternativa.

    El press del escenario es principal en Push y alternativa en Pull; se hizo en Pull
    el 10 y hoy, el 15, otra vez en Push. La última vez antes de hoy es la de Pull,
    aunque en Push la última fuera el 1 (el 8 tocó el comodín).
    """
    press = hueco_con_comodin["ejercicio_id"]
    pull = crear_rutina(cliente, "Pull")
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo")
    hueco_de_pull = crear_hueco(cliente, pull, remo)
    poner_alternativas(cliente, pull, hueco_de_pull, [press])
    en_pull = entrenar(cliente, "2026-09-10", press, pull, hueco_de_pull)
    hoy_en_push = historial_de_ejercicio(cliente, press, hasta="2026-09-15", limite=1)[0]

    ultima_vez = historial_de_ejercicio(cliente, press, hasta="2026-09-15", limite=2)

    assert [(s["entrenamiento_id"], s["fecha"], s["rutina"]) for s in ultima_vez] == [
        (hoy_en_push["entrenamiento_id"], "2026-09-15", "Push"),
        (en_pull, "2026-09-10", "Pull"),
    ]
    assert [serie["slot_id"] for serie in ultima_vez[1]["series"]] == [hueco_de_pull]
    # Con `hasta` en el día de Pull, ese día sale: `hasta` incluye su día.
    assert [s["fecha"] for s in historial_de_ejercicio(cliente, press, hasta="2026-09-10")] == [
        "2026-09-10",
        "2026-09-01",
    ]


# --- El límite cuenta sesiones, no series --------------------------------


def test_el_limite_devuelve_sesiones_completas_no_series_sueltas(cliente, escenario):
    """`?limite=2` con días de 3 series debe dar 2 días enteros (6 series), no
    las 2 series más recientes: cortar por series partiría un día por la mitad.
    """
    for fecha in ("2026-09-01", "2026-09-03", "2026-09-05"):
        entrenar(
            cliente,
            fecha,
            escenario["ejercicio_id"],
            escenario["rutina_id"],
            escenario["slot_id"],
            series=3,
        )

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"], limite=2)

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-05", "2026-09-03"]
    assert [len(sesion["series"]) for sesion in historial] == [3, 3]


def test_el_limite_recorta_despues_de_filtrar_por_fecha_no_antes(cliente, escenario):
    """Con `hasta=` puesto, `limite=1` debe dar la sesión más reciente *dentro
    del rango*, no la más reciente de todas descartada luego por la fecha.
    """
    for fecha in ("2026-09-01", "2026-09-03", "2026-09-05"):
        entrenar(
            cliente,
            fecha,
            escenario["ejercicio_id"],
            escenario["rutina_id"],
            escenario["slot_id"],
            series=1,
        )

    historial = historial_de_ejercicio(
        cliente, escenario["ejercicio_id"], hasta="2026-09-03", limite=1
    )

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-03"]


# --- Rango de fechas -----------------------------------------------------


def test_el_rango_de_fechas_incluye_sus_dos_extremos(cliente, escenario):
    for fecha in ("2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05"):
        entrenar(
            cliente,
            fecha,
            escenario["ejercicio_id"],
            escenario["rutina_id"],
            escenario["slot_id"],
            series=1,
        )

    historial = historial_de_ejercicio(
        cliente, escenario["ejercicio_id"], desde="2026-09-02", hasta="2026-09-04"
    )

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-04", "2026-09-02"]


def test_un_rango_de_un_solo_dia_devuelve_ese_dia(cliente, escenario):
    entrenar(
        cliente,
        "2026-09-04",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )

    historial = historial_de_ejercicio(
        cliente, escenario["ejercicio_id"], desde="2026-09-04", hasta="2026-09-04"
    )

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-04"]


def test_un_rango_invertido_se_rechaza(cliente, escenario):
    """`desde` posterior a `hasta` solo puede ser un error de quien llama: no
    existe ninguna sesión que cumpla ese rango.

    Devolver una lista vacía disimularía el fallo, así que se rechaza con 422,
    igual que un hueco con `reps_max` menor que `reps_min`.
    """
    entrenar(
        cliente,
        "2026-09-03",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )

    respuesta = cliente.get(
        f"/ejercicios/{escenario['ejercicio_id']}/historial",
        params={"desde": "2026-09-05", "hasta": "2026-09-01"},
    )

    assert respuesta.status_code == 422
    assert "invertido" in respuesta.json()["detail"]


# --- Historial de lo que se ha ocultado ----------------------------------
#
# `?modo=ocultar` existe precisamente para conservar el historial ("deja de
# aparecer para entrenamientos nuevos, pero el historial existente queda
# intacto"). Si al ocultar algo su historial deja de poder consultarse, ese
# historial se conserva en la base pero es inalcanzable por la API — el mismo
# agujero que ya obligó a añadir `?ocultos=true` y `POST /{id}/mostrar`.


def test_el_historial_de_un_ejercicio_ocultado_se_sigue_pudiendo_consultar(cliente, escenario):
    """Ocultar un ejercicio es lo que se hace con la máquina que ya no se usa;
    sus series siguen en la base y son parte de la progresión pasada.
    """
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=2,
    )
    assert (
        cliente.delete(f"/ejercicios/{escenario['ejercicio_id']}?modo=ocultar").status_code == 204
    )

    respuesta = cliente.get(f"/ejercicios/{escenario['ejercicio_id']}/historial")

    assert respuesta.status_code == 200
    assert len(respuesta.json()[0]["series"]) == 2


def test_ocultar_el_hueco_y_la_rutina_no_esconde_el_historial_del_ejercicio(cliente, escenario):
    """Retirar un hueco o la rutina entera (`Push v1`) es el caso más habitual de
    ocultar, y es justo cuando más interesa poder mirar atrás lo que se levantó en
    ella: el día sigue saliendo, con el nombre de su rutina.
    """
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=2,
    )
    ruta_del_hueco = f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}"
    assert cliente.delete(f"{ruta_del_hueco}?modo=ocultar").status_code == 204
    assert cliente.delete(f"/rutinas/{escenario['rutina_id']}?modo=ocultar").status_code == 204

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert [(sesion["fecha"], sesion["rutina"]) for sesion in historial] == [("2026-09-05", "Push")]
    assert len(historial[0]["series"]) == 2


# --- Los valores admitidos de `?limite=` ---------------------------------


@pytest.mark.parametrize("limite, codigo", [(0, 422), (1, 200), (500, 200), (501, 422)])
def test_el_limite_va_de_1_a_500_sesiones(cliente, escenario, limite, codigo):
    respuesta = cliente.get(
        f"/ejercicios/{escenario['ejercicio_id']}/historial", params={"limite": limite}
    )

    assert respuesta.status_code == codigo
    if codigo == 422:
        assert [e["loc"] for e in respuesta.json()["detail"]] == [["query", "limite"]]


# --- El historial de un hueco ya no existe --------------------------------


def test_el_historial_de_un_hueco_ya_no_responde(cliente, escenario):
    """`GET /rutinas/{id}/slots/{slot_id}/historial` se quitó por no tener uso (la
    sesión compara con el historial del ejercicio). Antes daba 200 con este mismo
    hueco y su serie; que dé 404 asegura que no queda vivo por error.
    """
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
    )
    ruta_del_hueco = f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}"
    assert cliente.get(f"/rutinas/{escenario['rutina_id']}").status_code == 200

    respuesta = cliente.get(f"{ruta_del_hueco}/historial")

    assert respuesta.status_code == 404
    # El 404 de una ruta que no existe, no el «Hueco no encontrado» de un id malo.
    assert respuesta.json()["detail"] == "Not Found"
