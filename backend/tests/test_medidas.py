"""Tests de las medidas de una serie según el tipo de su ejercicio (`app/medidas.py`).

Cada ejercicio dice cómo se apunta, y eso decide qué medidas lleva cada serie suya:

- peso y repeticiones (`peso_reps`): peso (0 o más) y repeticiones;
- peso corporal (`corporal`): repeticiones y carga (0 sin carga, positiva de lastre,
  negativa de ayuda), y si se quiere el peso corporal de quien la hizo;
- tiempo (`tiempo`): duración y, si se quiere, peso (0 o más).

Lo que falta o sobra da 422 con el nombre del ejercicio, al apuntar y al corregir
(con el ejercicio final: cambiar a una alternativa de otro tipo exige sus medidas).
La base de datos solo comprueba la forma de la serie, con sus CHECK.

El escenario: la rutina tiene un hueco A de Press banca con Dominadas y Plancha de
alternativas (los tres tipos en un hueco), un hueco B de Dominadas y un C de Plancha.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from tests.ayudas import crear_ejercicio, crear_rutina, objetivo

FECHA = "2026-09-04"
NEGATIVO = "El peso no puede ser negativo: solo los ejercicios de peso corporal admiten ayuda."
MEDIDAS = ("peso", "repeticiones", "duracion_s", "peso_corporal")


def peso_corporal_de_otro_tipo(nombre: str) -> str:
    return (
        "El peso corporal solo se guarda en las series de ejercicios de peso corporal, "
        f"y {nombre} no lo es."
    )


@pytest.fixture
def e(cliente, grupo_muscular_id) -> SimpleNamespace:
    ids = {
        "press": crear_ejercicio(cliente, grupo_muscular_id, "Press banca"),
        "dominadas": crear_ejercicio(cliente, grupo_muscular_id, "Dominadas", tipo="corporal"),
        "plancha": crear_ejercicio(cliente, grupo_muscular_id, "Plancha", tipo="tiempo"),
    }
    rutina = crear_rutina(cliente, "Mixta")

    def objetivo_de(nombre) -> dict:
        # Plancha es de tiempo: su objetivo va en segundos; el de los demás, en reps.
        return objetivo(3, (6, 10), (30, 60) if nombre == "plancha" else None)

    def hueco(principal, orden, *alternativas) -> int:
        respuesta = cliente.post(
            f"/rutinas/{rutina}/slots",
            json={
                "ejercicio_principal_id": ids[principal],
                "orden": orden,
                **objetivo_de(principal),
                "alternativas": [{"ejercicio_id": ids[a], **objetivo_de(a)} for a in alternativas],
            },
        )
        assert respuesta.status_code == 201, respuesta.text
        return respuesta.json()["id"]

    a = hueco("press", 1, "dominadas", "plancha")
    b = hueco("dominadas", 2)
    c = hueco("plancha", 3)
    sesion = cliente.post("/entrenamientos", json={"rutina_id": rutina, "fecha": FECHA})
    assert sesion.status_code == 201, sesion.text
    return SimpleNamespace(
        ids=ids,
        rutina=rutina,
        a=a,
        b=b,
        c=c,
        sesion=sesion.json()["id"],
        # El hueco donde cada uno es el principal.
        hueco_de={"press": a, "dominadas": b, "plancha": c},
    )


def cuerpo(e, ejercicio, numero=1, slot_id=None, **medidas) -> dict:
    return {
        "ejercicio_id": e.ids[ejercicio],
        "slot_id": slot_id if slot_id is not None else e.hueco_de[ejercicio],
        "numero_serie": numero,
        **medidas,
    }


def apuntar(cliente, e, ejercicio, numero=1, slot_id=None, **medidas):
    return cliente.post(
        f"/entrenamientos/{e.sesion}/series",
        json=cuerpo(e, ejercicio, numero, slot_id, **medidas),
    )


def apuntada(cliente, e, ejercicio, numero=1, slot_id=None, **medidas) -> dict:
    respuesta = apuntar(cliente, e, ejercicio, numero, slot_id, **medidas)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def corregir(cliente, e, serie, ejercicio, slot_id=None, **medidas):
    """PUT de la serie con ese ejercicio y esas medidas (y nada más: lo que no se
    mande queda nulo, como la variante).
    """
    return cliente.put(
        f"/entrenamientos/{e.sesion}/series/{serie['id']}",
        json=cuerpo(e, ejercicio, serie["numero_serie"], slot_id or serie["slot_id"], **medidas),
    )


def series_de(cliente, e) -> list[dict]:
    return cliente.get(f"/entrenamientos/{e.sesion}").json()["series"]


def medidas_de(serie) -> dict:
    return {campo: serie[campo] for campo in MEDIDAS}


def es_de_pydantic_por(respuesta, campo) -> bool:
    """El 422 es el del esquema y justo por ese campo, no el de las medidas."""
    detalle = respuesta.json()["detail"]
    return isinstance(detalle, list) and [error["loc"] for error in detalle] == [["body", campo]]


# --- Una serie válida de cada tipo ----------------------------------------------


@pytest.mark.parametrize(
    "ejercicio, medidas, guardado",
    [
        pytest.param(
            "press",
            {"peso": 60, "repeticiones": 8},
            {"peso": "60.00", "repeticiones": 8, "duracion_s": None, "peso_corporal": None},
            id="peso-y-repeticiones",
        ),
        pytest.param(
            "press",
            {"peso": 0, "repeticiones": 12},
            {"peso": "0.00", "repeticiones": 12, "duracion_s": None, "peso_corporal": None},
            id="peso-y-repeticiones-con-0-kg",
        ),
        pytest.param(
            "dominadas",
            {"peso": 0, "repeticiones": 10},
            {"peso": "0.00", "repeticiones": 10, "duracion_s": None, "peso_corporal": None},
            id="corporal-sin-carga",
        ),
        pytest.param(
            "dominadas",
            {"peso": 15, "repeticiones": 6, "peso_corporal": "78.5"},
            {"peso": "15.00", "repeticiones": 6, "duracion_s": None, "peso_corporal": "78.50"},
            id="corporal-con-lastre-y-peso-corporal",
        ),
        pytest.param(
            "dominadas",
            {"peso": -20, "repeticiones": 8},
            {"peso": "-20.00", "repeticiones": 8, "duracion_s": None, "peso_corporal": None},
            id="corporal-con-ayuda",
        ),
        pytest.param(
            "plancha",
            {"duracion_s": 45},
            {"peso": None, "repeticiones": None, "duracion_s": 45, "peso_corporal": None},
            id="tiempo-sin-peso",
        ),
        pytest.param(
            "plancha",
            {"duracion_s": 60, "peso": 10},
            {"peso": "10.00", "repeticiones": None, "duracion_s": 60, "peso_corporal": None},
            id="tiempo-con-peso",
        ),
        pytest.param(
            "plancha",
            {"duracion_s": 60, "peso": 0},
            {"peso": "0.00", "repeticiones": None, "duracion_s": 60, "peso_corporal": None},
            id="tiempo-con-0-kg",
        ),
    ],
)
def test_una_serie_con_las_medidas_de_su_tipo_se_guarda_tal_cual(
    cliente, e, ejercicio, medidas, guardado
):
    respuesta = apuntar(cliente, e, ejercicio, **medidas)

    assert respuesta.status_code == 201, respuesta.text
    assert medidas_de(respuesta.json()) == guardado
    [leida] = series_de(cliente, e)
    assert medidas_de(leida) == guardado


def test_una_serie_trae_todas_sus_medidas_y_su_ejercicio_con_el_tipo(cliente, e):
    """El contrato de `SerieOut`: las cuatro medidas siempre (nulas si no van) y el
    ejercicio entero, con su tipo.
    """
    serie = apuntada(cliente, e, "plancha", duracion_s=30)

    assert set(serie) == {
        "id",
        "entrenamiento_id",
        "ejercicio_id",
        "slot_id",
        "numero_serie",
        *MEDIDAS,
        "variante",
        "created_at",
        "updated_at",
        "ejercicio",
    }
    assert serie["ejercicio"]["tipo_registro"] == "tiempo"


# --- Lo que falta o sobra -------------------------------------------------------


@pytest.mark.parametrize(
    "ejercicio, medidas, mensaje",
    [
        pytest.param(
            "press",
            {"repeticiones": 8},
            "Press banca se apunta con peso y repeticiones: falta el peso.",
            id="peso-y-repeticiones-sin-peso",
        ),
        pytest.param(
            "press",
            {},
            "Press banca se apunta con peso y repeticiones: faltan el peso y las repeticiones.",
            id="peso-y-repeticiones-sin-nada",
        ),
        pytest.param(
            "press",
            {"peso": 60, "repeticiones": 8, "duracion_s": 30},
            "Press banca se apunta con peso y repeticiones: sobra la duración.",
            id="peso-y-repeticiones-con-duracion",
        ),
        pytest.param(
            "press",
            {"duracion_s": 30},
            "Press banca se apunta con peso y repeticiones: faltan el peso y las repeticiones"
            " y sobra la duración.",
            id="peso-y-repeticiones-por-tiempo",
        ),
        pytest.param(
            "dominadas",
            {"repeticiones": 8},
            "Dominadas se apunta con repeticiones y carga: falta el peso.",
            id="corporal-sin-carga-nula",
        ),
        pytest.param(
            "dominadas",
            {"peso": 0, "repeticiones": 8, "duracion_s": 20},
            "Dominadas se apunta con repeticiones y carga: sobra la duración.",
            id="corporal-con-duracion",
        ),
        pytest.param(
            "plancha",
            {},
            "Plancha se apunta por tiempo: falta la duración.",
            id="tiempo-sin-nada",
        ),
        pytest.param(
            "plancha",
            {"peso": 10},
            "Plancha se apunta por tiempo: falta la duración.",
            id="tiempo-solo-con-peso",
        ),
    ],
)
def test_una_medida_que_falta_o_sobra_da_422_con_el_nombre_del_ejercicio(
    cliente, e, ejercicio, medidas, mensaje
):
    respuesta = apuntar(cliente, e, ejercicio, **medidas)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == mensaje
    assert series_de(cliente, e) == []


@pytest.mark.parametrize(
    "ejercicio, medidas, mensaje",
    [
        pytest.param(
            "plancha",
            {"peso": 0, "repeticiones": 8},
            "Plancha se apunta por tiempo: falta la duración y sobran las repeticiones.",
            id="tiempo-por-repeticiones",
        ),
        pytest.param(
            "plancha",
            {"duracion_s": 30, "repeticiones": 8},
            "Plancha se apunta por tiempo: sobran las repeticiones.",
            id="tiempo-con-repeticiones",
        ),
        pytest.param(
            "press",
            {"peso": 60},
            "Press banca se apunta con peso y repeticiones: faltan las repeticiones.",
            id="peso-y-repeticiones-sin-repeticiones",
        ),
        pytest.param(
            "dominadas",
            {"peso": 0},
            "Dominadas se apunta con repeticiones y carga: faltan las repeticiones.",
            id="corporal-sin-repeticiones",
        ),
    ],
)
def test_las_repeticiones_que_faltan_o_sobran_se_dicen_en_plural(
    cliente, e, ejercicio, medidas, mensaje
):
    """El verbo concuerda con el campo, no con cuántos son: «faltan las repeticiones»
    aunque sea solo una cosa. El primer caso es, palabra por palabra, el ejemplo del
    plan de los tipos.

    Bug real: decía «falta las repeticiones» y «sobra las repeticiones».
    """
    respuesta = apuntar(cliente, e, ejercicio, **medidas)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == mensaje


@pytest.mark.parametrize(
    "ejercicio, medidas",
    [
        pytest.param("press", {"peso": -10, "repeticiones": 8}, id="peso-y-repeticiones"),
        pytest.param("plancha", {"duracion_s": 30, "peso": -5}, id="tiempo"),
    ],
)
def test_un_peso_negativo_solo_vale_en_peso_corporal(cliente, e, ejercicio, medidas):
    """La ayuda (carga negativa) solo existe en los ejercicios de peso corporal; en
    ellos se apunta bien (en el test de las series válidas).
    """
    respuesta = apuntar(cliente, e, ejercicio, **medidas)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == NEGATIVO
    assert series_de(cliente, e) == []


def test_la_ayuda_admite_hasta_lo_que_cabe_en_la_columna_y_no_mas(cliente, e):
    """El peso va de −9999,99 a 9999,99 (NUMERIC(6,2)): uno más llegaría a Postgres
    y sería un 500.
    """
    justo = apuntar(cliente, e, "dominadas", peso="-9999.99", repeticiones=1)
    pasado = apuntar(cliente, e, "dominadas", numero=2, peso="-10000", repeticiones=1)

    assert justo.status_code == 201, justo.text
    assert justo.json()["peso"] == "-9999.99"
    assert pasado.status_code == 422
    assert es_de_pydantic_por(pasado, "peso"), pasado.text


@pytest.mark.parametrize(
    "duracion, codigo",
    [(1, 201), (86400, 201), (86401, 422), (0, 422), (-30, 422)],
)
def test_la_duracion_va_de_un_segundo_a_un_dia(cliente, e, duracion, codigo):
    respuesta = apuntar(cliente, e, "plancha", duracion_s=duracion)

    assert respuesta.status_code == codigo, respuesta.text
    if codigo == 422:
        assert es_de_pydantic_por(respuesta, "duracion_s"), respuesta.text
        assert series_de(cliente, e) == []


# --- El orden de las comprobaciones -----------------------------------------------
#
# 404 (sesión, ejercicio oculto) → 404/422 del hueco → 422 de las medidas → 409 de
# mezclar ejercicios en un hueco: una petición mal hecha nunca choca con el estado.


def test_unas_medidas_mal_puestas_dan_su_422_antes_que_el_409_de_mezclar(cliente, e):
    """El hueco A ya tiene press en esta sesión: la plancha mal apuntada da el 422
    de sus medidas (no se arregla borrando nada), y bien apuntada, el 409.
    """
    press = apuntada(cliente, e, "press", peso=60, repeticiones=8)

    mal = apuntar(cliente, e, "plancha", numero=2, slot_id=e.a, peso=60, repeticiones=8)
    bien = apuntar(cliente, e, "plancha", numero=2, slot_id=e.a, duracion_s=30)

    assert mal.status_code == 422, mal.text
    assert mal.json()["detail"].startswith("Plancha se apunta por tiempo:")
    assert bien.status_code == 409, bien.text
    assert series_de(cliente, e) == [press]


def test_un_ejercicio_que_no_es_del_hueco_se_dice_antes_que_sus_medidas(cliente, e):
    """La plancha no está en el hueco B: 422 del hueco, aunque sus medidas tampoco
    cuadren.
    """
    respuesta = apuntar(cliente, e, "plancha", slot_id=e.b, peso=60, repeticiones=8)

    assert respuesta.status_code == 422, respuesta.text
    assert (
        respuesta.json()["detail"]
        == "Ese ejercicio no es ni el principal ni un comodín de este hueco"
    )


def test_un_ejercicio_oculto_da_404_antes_que_sus_medidas(cliente, e):
    assert cliente.delete(f"/ejercicios/{e.ids['plancha']}?modo=ocultar").status_code == 204

    respuesta = apuntar(cliente, e, "plancha", peso=60, repeticiones=8)

    assert respuesta.status_code == 404, respuesta.text
    assert respuesta.json()["detail"] == "Ejercicio no encontrado"


# --- Corregir una serie ---------------------------------------------------------


def test_cambiar_a_una_alternativa_de_otro_tipo_exige_sus_medidas(cliente, e):
    """La única serie del hueco A es de press. Pasarla a plancha con peso y reps da
    el 422 de la plancha y la serie no cambia; con su duración, vale, y el peso y
    las repeticiones quedan nulos.
    """
    serie = apuntada(cliente, e, "press", peso=60, repeticiones=8)

    mal = corregir(cliente, e, serie, "plancha", peso=60, repeticiones=8)
    assert mal.status_code == 422, mal.text
    assert mal.json()["detail"].startswith("Plancha se apunta por tiempo:")
    assert series_de(cliente, e) == [serie]

    bien = corregir(cliente, e, serie, "plancha", duracion_s=40)
    assert bien.status_code == 200, bien.text
    assert bien.json()["ejercicio_id"] == e.ids["plancha"]
    assert medidas_de(bien.json()) == {
        "peso": None,
        "repeticiones": None,
        "duracion_s": 40,
        "peso_corporal": None,
    }


def test_la_ayuda_se_valida_con_el_ejercicio_final_y_no_con_el_de_antes(cliente, e):
    """De press (donde no vale) a dominadas (donde sí): lo que cuenta es el ejercicio
    al que pasa la serie. Y al revés: de vuelta a press con la ayuda, 422.
    """
    serie = apuntada(cliente, e, "press", peso=60, repeticiones=8)

    a_dominadas = corregir(cliente, e, serie, "dominadas", peso=-10, repeticiones=6)
    assert a_dominadas.status_code == 200, a_dominadas.text
    assert a_dominadas.json()["peso"] == "-10.00"

    a_press = corregir(cliente, e, serie, "press", peso=-10, repeticiones=6)
    assert a_press.status_code == 422, a_press.text
    assert a_press.json()["detail"] == NEGATIVO
    assert series_de(cliente, e)[0]["ejercicio_id"] == e.ids["dominadas"]


def test_de_tiempo_a_peso_y_repeticiones_sin_sus_medidas_da_422(cliente, e):
    serie = apuntada(cliente, e, "plancha", slot_id=e.a, duracion_s=45)

    respuesta = corregir(cliente, e, serie, "press", duracion_s=45)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == (
        "Press banca se apunta con peso y repeticiones: faltan el peso y las repeticiones"
        " y sobra la duración."
    )
    assert series_de(cliente, e) == [serie]


def test_corregir_la_duracion_o_quitar_el_peso_de_una_serie_por_tiempo(cliente, e):
    serie = apuntada(cliente, e, "plancha", duracion_s=45, peso=10)

    respuesta = corregir(cliente, e, serie, "plancha", duracion_s=50)

    assert respuesta.status_code == 200, respuesta.text
    assert (respuesta.json()["duracion_s"], respuesta.json()["peso"]) == (50, None)


def test_corregir_una_serie_sin_sus_medidas_da_422_y_no_la_toca(cliente, e):
    serie = apuntada(cliente, e, "press", peso=60, repeticiones=8)

    respuesta = corregir(cliente, e, serie, "press", peso=62.5)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"].startswith("Press banca se apunta con peso y repeticiones:")
    assert series_de(cliente, e) == [serie]


# --- Peso corporal --------------------------------------------------------------
#
# Cuánto pesaba quien hizo una serie de peso corporal. Es un dato de la serie, como
# la variante: opcional, y el PUT copia el cuerpo entero (si no llega, queda nulo).


def test_el_peso_corporal_se_guarda_y_se_devuelve_en_la_sesion(cliente, e):
    serie = apuntada(cliente, e, "dominadas", peso=0, repeticiones=10, peso_corporal="78.5")

    assert serie["peso_corporal"] == "78.50"
    assert series_de(cliente, e)[0]["peso_corporal"] == "78.50"


@pytest.mark.parametrize("sin", [{}, {"peso_corporal": None}], ids=["ausente", "nulo"])
def test_sin_peso_corporal_queda_nulo(cliente, e, sin):
    serie = apuntada(cliente, e, "dominadas", peso=0, repeticiones=10, **sin)

    assert serie["peso_corporal"] is None


@pytest.mark.parametrize(
    "ejercicio, medidas, nombre",
    [
        pytest.param("press", {"peso": 60, "repeticiones": 8}, "Press banca", id="peso-y-reps"),
        pytest.param("plancha", {"duracion_s": 30}, "Plancha", id="tiempo"),
    ],
)
def test_el_peso_corporal_en_otro_tipo_da_422(cliente, e, ejercicio, medidas, nombre):
    respuesta = apuntar(cliente, e, ejercicio, peso_corporal=80, **medidas)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == peso_corporal_de_otro_tipo(nombre)
    assert series_de(cliente, e) == []


VALIDOS = [("0.01", "0.01"), ("500", "500.00")]
INVALIDOS = ["0", "0.001", "-1", "500.01"]


@pytest.mark.parametrize("valor, guardado", VALIDOS)
def test_el_peso_corporal_va_de_un_centimo_a_500_kg_al_apuntar(cliente, e, valor, guardado):
    serie = apuntada(cliente, e, "dominadas", peso=0, repeticiones=10, peso_corporal=valor)

    assert serie["peso_corporal"] == guardado


@pytest.mark.parametrize("valor", INVALIDOS)
def test_un_peso_corporal_fuera_de_rango_da_422_al_apuntar(cliente, e, valor):
    """0,001 tiene que fallar aquí: NUMERIC(5,2) lo redondearía a 0,00, el CHECK de
    la base lo rechazaría y sería un 500.
    """
    respuesta = apuntar(cliente, e, "dominadas", peso=0, repeticiones=10, peso_corporal=valor)

    assert respuesta.status_code == 422, respuesta.text
    assert es_de_pydantic_por(respuesta, "peso_corporal"), respuesta.text
    assert series_de(cliente, e) == []


@pytest.mark.parametrize("valor, guardado", VALIDOS)
def test_el_peso_corporal_va_de_un_centimo_a_500_kg_al_corregir(cliente, e, valor, guardado):
    serie = apuntada(cliente, e, "dominadas", peso=0, repeticiones=10, peso_corporal=80)

    respuesta = corregir(
        cliente, e, serie, "dominadas", peso=0, repeticiones=10, peso_corporal=valor
    )

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["peso_corporal"] == guardado


@pytest.mark.parametrize("valor", INVALIDOS)
def test_un_peso_corporal_fuera_de_rango_da_422_al_corregir(cliente, e, valor):
    serie = apuntada(cliente, e, "dominadas", peso=0, repeticiones=10, peso_corporal=80)

    respuesta = corregir(
        cliente, e, serie, "dominadas", peso=0, repeticiones=10, peso_corporal=valor
    )

    assert respuesta.status_code == 422, respuesta.text
    assert es_de_pydantic_por(respuesta, "peso_corporal"), respuesta.text
    assert series_de(cliente, e) == [serie]


@pytest.mark.parametrize(
    "en_el_cuerpo, queda",
    [
        pytest.param({}, None, id="ausente-lo-deja-nulo"),
        pytest.param({"peso_corporal": None}, None, id="nulo-lo-borra"),
        pytest.param({"peso_corporal": 81}, "81.00", id="con-valor-lo-cambia"),
    ],
)
def test_corregir_una_serie_copia_el_peso_corporal_del_cuerpo_como_la_variante(
    cliente, e, en_el_cuerpo, queda
):
    """El contrato del plan: el PUT copia el cuerpo entero. Un peso corporal que no
    llega no se conserva: queda nulo, igual que una variante que no llega (la web lo
    manda siempre en las series de peso corporal).
    """
    serie = apuntada(
        cliente, e, "dominadas", peso=0, repeticiones=10, peso_corporal=80, variante="pronas"
    )

    respuesta = corregir(cliente, e, serie, "dominadas", peso=0, repeticiones=12, **en_el_cuerpo)

    assert respuesta.status_code == 200, respuesta.text
    assert (respuesta.json()["peso_corporal"], respuesta.json()["variante"]) == (queda, None)
    assert series_de(cliente, e)[0]["peso_corporal"] == queda


def test_un_peso_corporal_sin_peso_corporal_previo_se_pone_al_corregir(cliente, e):
    serie = apuntada(cliente, e, "dominadas", peso=0, repeticiones=10)

    respuesta = corregir(cliente, e, serie, "dominadas", peso=0, repeticiones=10, peso_corporal=77)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["peso_corporal"] == "77.00"


def test_pasar_a_una_alternativa_de_otro_tipo_con_peso_corporal_da_422_y_no_cambia_nada(cliente, e):
    """Dominadas en el hueco A (alternativa) con su peso corporal; pasarla a plancha
    con su duración pero conservando el peso corporal: 422 que nombra la plancha.
    """
    serie = apuntada(
        cliente, e, "dominadas", slot_id=e.a, peso=0, repeticiones=10, peso_corporal=80
    )

    respuesta = corregir(cliente, e, serie, "plancha", duracion_s=30, peso_corporal=80)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == peso_corporal_de_otro_tipo("Plancha")
    assert series_de(cliente, e) == [serie]


def test_el_peso_corporal_de_una_serie_de_un_ejercicio_oculto_se_puede_corregir(cliente, e):
    """Corregir sí, elegir algo oculto no: las dominadas ya no se ofrecen (apuntar
    otra da 404), pero lo ya apuntado con ellas se corrige.
    """
    serie = apuntada(cliente, e, "dominadas", peso=0, repeticiones=10, peso_corporal=80)
    assert cliente.delete(f"/ejercicios/{e.ids['dominadas']}?modo=ocultar").status_code == 204

    otra = apuntar(cliente, e, "dominadas", numero=2, peso=0, repeticiones=10)
    corregida = corregir(cliente, e, serie, "dominadas", peso=0, repeticiones=10, peso_corporal=82)

    assert otra.status_code == 404, otra.text
    assert corregida.status_code == 200, corregida.text
    assert corregida.json()["peso_corporal"] == "82.00"


# --- Historial ------------------------------------------------------------------


def test_el_historial_trae_la_duracion_y_no_el_peso_corporal(cliente, e):
    """Las series del historial (de un ejercicio y de un hueco) traen el peso y las
    repeticiones nulos de una serie por tiempo sin peso, y su duración. El peso
    corporal no va: ninguna pantalla que lee el historial lo enseña.
    """
    apuntada(cliente, e, "plancha", slot_id=e.a, duracion_s=45)
    otra = cliente.post("/entrenamientos", json={"rutina_id": e.rutina, "fecha": "2026-09-05"})
    cliente.post(
        f"/entrenamientos/{otra.json()['id']}/series",
        json=cuerpo(e, "dominadas", slot_id=e.a, peso=-10, repeticiones=8, peso_corporal=80),
    ).raise_for_status()

    del_ejercicio = cliente.get(f"/ejercicios/{e.ids['plancha']}/historial").json()
    del_hueco = cliente.get(f"/rutinas/{e.rutina}/slots/{e.a}/historial").json()

    [[de_plancha]] = [dia["series"] for dia in del_ejercicio]
    assert (de_plancha["peso"], de_plancha["repeticiones"], de_plancha["duracion_s"]) == (
        None,
        None,
        45,
    )
    assert [dia["fecha"] for dia in del_hueco] == ["2026-09-05", FECHA]
    [[de_dominadas], [en_el_hueco]] = [dia["series"] for dia in del_hueco]
    assert {**en_el_hueco, "ejercicio": None} == {**de_plancha, "ejercicio": None}
    assert en_el_hueco["ejercicio"] == {
        "id": e.ids["plancha"],
        "nombre": "Plancha",
        "tipo_registro": "tiempo",
    }
    assert (de_dominadas["peso"], de_dominadas["duracion_s"]) == ("-10.00", None)
    assert de_dominadas["ejercicio"]["tipo_registro"] == "corporal"
    for serie in (de_plancha, en_el_hueco, de_dominadas):
        assert "peso_corporal" not in serie


# --- Las restricciones de la base -------------------------------------------------
#
# Solo comprueban la forma de una serie (la regla por tipo está en otra tabla y la
# pone el endpoint). Cada caso rompe una sola, para ver que salta la que toca: si
# faltara, una serie así se colaría desde cualquier camino que no fuera la API.


@pytest.mark.parametrize(
    "medidas, restriccion",
    [
        pytest.param({"peso": 10}, "series_medidas_check", id="ni-repeticiones-ni-duracion"),
        pytest.param({"repeticiones": 8}, "series_medidas_check", id="repeticiones-sin-peso"),
        pytest.param(
            {"peso": 0, "repeticiones": 8, "duracion_s": 30},
            "series_medidas_check",
            id="repeticiones-y-duracion",
        ),
        pytest.param(
            {"peso": -5, "duracion_s": 30}, "series_peso_check", id="carga-negativa-sin-reps"
        ),
        pytest.param({"duracion_s": 0}, "series_duracion_check", id="duracion-cero"),
        pytest.param(
            {"duracion_s": 30, "peso_corporal": 70},
            "series_peso_corporal_check",
            id="peso-corporal-sin-repeticiones",
        ),
        pytest.param(
            {"peso": 0, "repeticiones": 8, "peso_corporal": 0},
            "series_peso_corporal_check",
            id="peso-corporal-cero",
        ),
    ],
)
def test_la_base_rechaza_una_serie_con_una_forma_imposible(
    cliente, sesion_bd, e, medidas, restriccion
):
    from app.models import Serie

    sesion_bd.add(
        Serie(
            entrenamiento_id=e.sesion,
            slot_id=e.a,
            ejercicio_id=e.ids["press"],
            numero_serie=1,
            **medidas,
        )
    )

    with pytest.raises(IntegrityError) as error:
        sesion_bd.flush()

    assert error.value.orig.diag.constraint_name == restriccion
    sesion_bd.rollback()


@pytest.mark.parametrize(
    "medidas",
    [
        pytest.param({"peso": -5, "repeticiones": 8, "peso_corporal": 70}, id="ayuda"),
        pytest.param({"duracion_s": 30}, id="tiempo-sin-peso"),
        pytest.param({"duracion_s": 30, "peso": 0}, id="tiempo-con-0-kg"),
    ],
)
def test_la_base_admite_cada_forma_que_la_api_deja_apuntar(cliente, sesion_bd, e, medidas):
    """El otro lado: un CHECK demasiado estricto convertiría una serie válida en un 500."""
    from app.models import Serie

    sesion_bd.add(
        Serie(
            entrenamiento_id=e.sesion,
            slot_id=e.a,
            ejercicio_id=e.ids["press"],
            numero_serie=1,
            **medidas,
        )
    )
    sesion_bd.flush()
    sesion_bd.rollback()


@pytest.mark.parametrize("tipo", ["cardio", "PESO_REPS", ""])
def test_la_base_rechaza_un_tipo_de_ejercicio_que_no_existe(sesion_bd, grupo_muscular_id, tipo):
    from app.models import Ejercicio

    sesion_bd.add(
        Ejercicio(nombre="Cinta", grupo_muscular_id=grupo_muscular_id, tipo_registro=tipo)
    )

    with pytest.raises(IntegrityError) as error:
        sesion_bd.flush()

    assert error.value.orig.diag.constraint_name == "ejercicios_tipo_registro_check"
    sesion_bd.rollback()


def test_un_ejercicio_creado_en_la_base_sin_tipo_es_de_peso_y_repeticiones(
    sesion_bd, grupo_muscular_id
):
    """El valor por defecto también está en la base (`server_default`): un INSERT que
    no lo nombre, como haría la app móvil al copiar el esquema, no falla.
    """
    from sqlalchemy import text

    tipo = sesion_bd.scalar(
        text(
            "INSERT INTO ejercicios (nombre, grupo_muscular_id, es_predefinido, created_at,"
            " updated_at) VALUES ('Remo', :g, false, now(), now()) RETURNING tipo_registro"
        ),
        {"g": grupo_muscular_id},
    )

    assert tipo == "peso_reps"
    sesion_bd.rollback()
