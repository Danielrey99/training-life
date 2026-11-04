"""Tests del estado de cada día del plan: `GET /plan/seguimiento`.

Cada día dice qué tocaba y qué pasó: hecho, movido a otro día, sin hacer,
pendiente (hoy) o próximo, qué sesión lo cuenta y qué se hizo ese día. De ahí
salen las marcas del calendario, también las combinadas.

Todos parten de la semana de `tests/semana.py`: hoy es el miércoles 16 de
septiembre de 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
"""

from datetime import date, timedelta

import pytest

from app.models import Entrenamiento, ExcepcionDelPlan, RutinaPeriodoOculto
from tests.ayudas import consultas_de, rango_invertido
from tests.semana import (
    HOY,
    JUEVES_10,
    LUNES_14,
    LUNES_7,
    MARTES_15,
    MARTES_8,
    MIERCOLES_9,
    VIERNES_11,
    VIERNES_18,
    hecha,
    seguimiento,
    sesion,
)


# --- Los estados ---------------------------------------------------------


def test_cada_dia_tiene_el_estado_de_lo_que_tocaba(cliente, ppl, grupo_muscular_id):
    hecha(cliente, grupo_muscular_id, LUNES_7, ppl["Push"], cubre_fecha=LUNES_7)
    recuperada = hecha(cliente, grupo_muscular_id, JUEVES_10, ppl["Pull"], cubre_fecha=MIERCOLES_9)

    dias = seguimiento(cliente, LUNES_7, VIERNES_18)

    estados = {fecha: dia["estado"] for fecha, dia in dias.items() if not dia["descanso"]}
    assert estados == {
        LUNES_7: "hecho",
        MIERCOLES_9: "movido",
        VIERNES_11: "sin_hacer",
        LUNES_14: "sin_hacer",
        HOY: "pendiente",
        VIERNES_18: "proximo",
    }
    assert dias[MARTES_8]["estado"] == "descanso"
    assert dias[MIERCOLES_9]["cubierto_por"] == {
        "entrenamiento_id": recuperada,
        "fecha": JUEVES_10.isoformat(),
    }
    # El jueves no tocaba nada, pero ese día se entrenó: lo dice `sesion`.
    assert dias[JUEVES_10]["estado"] == "descanso"
    assert dias[JUEVES_10]["sesion"]["cubre_fecha"] == MIERCOLES_9.isoformat()
    assert dias[JUEVES_10]["sesion"]["cuenta"] is True


# --- Sesiones vacías ------------------------------------------------------


def test_una_sesion_cancelada_no_cuenta_ni_sale(cliente, ppl):
    """Sin series y ya fuera de curso: no se hizo nada."""
    sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14)

    dias = seguimiento(cliente, LUNES_14, MARTES_15)

    assert dias[LUNES_14]["estado"] == "sin_hacer"
    assert dias[LUNES_14]["cubierto_por"] is None
    assert dias[MARTES_15]["sesion"] is None


def test_la_sesion_en_curso_cuenta_aunque_este_vacia(cliente, ppl):
    empezada = sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY).json()["id"]

    dia = seguimiento(cliente, HOY)[HOY]

    assert dia["estado"] == "hecho"
    assert dia["sesion"] == {
        "entrenamiento_id": empezada,
        "rutina": {"id": ppl["Pull"], "nombre": "Pull", "oculto_desde": None},
        "en_curso": True,
        "cubre_fecha": HOY.isoformat(),
        "cuenta": True,
    }


# --- Lo que se hizo frente a lo que tocaba --------------------------------


def test_otra_rutina_el_dia_que_tocaba_una_que_sigue_sin_hacer(cliente, ppl, grupo_muscular_id):
    """La marca ●○: el lunes se hizo Leg sin contar ningún día, y el Push del lunes
    sigue sin hacer.
    """
    hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Leg"])

    dia = seguimiento(cliente, LUNES_14)[LUNES_14]

    assert dia["estado"] == "sin_hacer"
    assert dia["sesion"]["rutina"]["nombre"] == "Leg"
    assert dia["sesion"]["cuenta"] is False


def test_otra_rutina_el_dia_que_tocaba_una_hecha_otro_dia(cliente, ppl, grupo_muscular_id):
    """La marca ←● / ●→: el lunes se adelantó el Leg del viernes, y el Push del
    lunes se recuperó el martes.
    """
    hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Leg"], cubre_fecha=VIERNES_18)
    recuperada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14)

    dia = seguimiento(cliente, LUNES_14)[LUNES_14]

    assert dia["estado"] == "movido"
    assert dia["cubierto_por"]["entrenamiento_id"] == recuperada
    assert dia["sesion"]["rutina"]["nombre"] == "Leg"
    assert dia["sesion"]["cubre_fecha"] == VIERNES_18.isoformat()
    assert dia["sesion"]["cuenta"] is True


def test_una_sesion_sin_cubrir_ningun_dia_sale_como_sesion_sin_contar(
    cliente, ppl, grupo_muscular_id
):
    suelta = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"])

    dia = seguimiento(cliente, MARTES_15)[MARTES_15]

    assert dia["estado"] == "descanso"
    assert dia["sesion"]["entrenamiento_id"] == suelta
    assert dia["sesion"]["rutina"]["id"] == ppl["Leg"]
    assert dia["sesion"]["cuenta"] is False


def test_una_sesion_de_una_rutina_que_ese_dia_ya_no_toca_no_lo_cuenta(
    cliente, ppl, grupo_muscular_id, sesion_bd
):
    """Se monta en la base: con la API, el plan de un día pasado ya no cambia."""
    antigua = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"])
    sesion_bd.get(Entrenamiento, antigua).cubre_fecha = LUNES_14
    sesion_bd.commit()

    dias = seguimiento(cliente, LUNES_14, MARTES_15)

    assert dias[LUNES_14]["estado"] == "sin_hacer"
    assert dias[MARTES_15]["sesion"]["cubre_fecha"] == LUNES_14.isoformat()
    assert dias[MARTES_15]["sesion"]["cuenta"] is False


def test_un_dia_sale_igual_lo_pida_solo_o_dentro_de_un_rango(cliente, ppl, grupo_muscular_id):
    """Saber si la sesión del jueves cuenta pide el plan del miércoles, que queda
    fuera si se pide solo el jueves: el seguimiento resuelve unos días de margen.
    """
    hecha(cliente, grupo_muscular_id, JUEVES_10, ppl["Pull"], cubre_fecha=MIERCOLES_9)
    hecha(cliente, grupo_muscular_id, VIERNES_11, ppl["Leg"], cubre_fecha=VIERNES_11)

    en_rango = seguimiento(cliente, LUNES_7, VIERNES_18)

    for fecha in (MIERCOLES_9, JUEVES_10, VIERNES_11):
        assert seguimiento(cliente, fecha)[fecha] == en_rango[fecha]
    assert seguimiento(cliente, JUEVES_10)[JUEVES_10]["sesion"]["cuenta"] is True


# --- Rango y consultas ---------------------------------------------------


@pytest.mark.parametrize(
    "desde, hasta, lo_que_dice",
    [
        pytest.param(HOY, LUNES_14, rango_invertido(HOY, LUNES_14), id="invertido"),
        pytest.param(
            HOY,
            HOY + timedelta(days=400),
            "Como mucho se piden 400 días de una vez.",
            id="mas-de-400-dias",
        ),
    ],
)
def test_un_rango_invalido_da_422(cliente, ppl, desde, hasta, lo_que_dice):
    respuesta = cliente.get(
        "/plan/seguimiento", params={"desde": desde.isoformat(), "hasta": hasta.isoformat()}
    )

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == lo_que_dice


def test_un_rango_de_justo_400_dias_vale(cliente, ppl):
    """El borde del anterior: el tope incluye el día 400."""
    respuesta = cliente.get(
        "/plan/seguimiento",
        params={"desde": HOY.isoformat(), "hasta": (HOY + timedelta(days=399)).isoformat()},
    )

    assert respuesta.status_code == 200, respuesta.text
    assert len(respuesta.json()) == 400


@pytest.mark.parametrize(
    "ruta, params, fechas",
    [
        pytest.param(
            "/plan/seguimiento",
            {"desde": "0001-01-01", "hasta": "0001-01-02"},
            ["0001-01-01", "0001-01-02"],
            id="seguimiento-primeros-dias",
        ),
        pytest.param(
            "/plan/seguimiento",
            {"desde": "9999-12-30", "hasta": "9999-12-31"},
            ["9999-12-30", "9999-12-31"],
            id="seguimiento-ultimos-dias",
        ),
        pytest.param("/plan/hoy", {"fecha": "0001-01-08"}, ["0001-01-08"], id="hoja-de-un-dia"),
    ],
)
def test_los_dias_del_borde_del_calendario_no_dan_500(cliente, ppl, ruta, params, fechas):
    """El rango es válido (no invertido, de menos de 400 días, y la hoja de un día
    pasado), así que se responde. Antes daba 500 (OverflowError): el seguimiento y
    /plan/hoy sumaban y restaban su margen sin acotarlo al calendario.
    """
    respuesta = cliente.get(ruta, params=params)

    assert respuesta.status_code == 200, respuesta.text
    cuerpo = respuesta.json()
    dias = cuerpo if ruta == "/plan/seguimiento" else [cuerpo]
    assert [dia["fecha"] for dia in dias] == fechas


def test_junto_a_los_bordes_del_calendario_lo_hecho_cuenta_y_se_planifica(
    cliente, sesion_bd, ppl, grupo_muscular_id
):
    """El anterior, con algo dentro: lo del 1-1-0001, recuperado el día 3, cuenta
    y lo ven el seguimiento y la hoja de ese día; el 31-12-9999 se planifica, sale
    en el seguimiento y se restablece. Antes del arreglo, el margen de seis días a
    cada lado se salía del calendario (500).
    """
    primero, tercero, ultimo = date(1, 1, 1), date(1, 1, 3), date(9999, 12, 31)
    # El pasado no se planifica por la API: el día cambiado se mete en la base.
    sesion_bd.add(ExcepcionDelPlan(fecha=primero, rutina_id=ppl["Push"]))
    sesion_bd.commit()
    recuperada = hecha(cliente, grupo_muscular_id, tercero, ppl["Push"], cubre_fecha=primero)

    principio = seguimiento(cliente, primero, date(1, 1, 7))
    hoja = cliente.get("/plan/hoy", params={"fecha": tercero.isoformat()})
    assert cliente.put(f"/plan/excepciones/{ultimo}", json={"rutina_id": ppl["Leg"]}).json() == {
        "fecha": ultimo.isoformat(),
        "rutina": {"id": ppl["Leg"], "nombre": "Leg", "oculto_desde": None},
    }
    final = seguimiento(cliente, date(9999, 12, 25), ultimo)
    restablecer = cliente.delete(
        "/plan/excepciones", params={"desde": HOY.isoformat(), "hasta": ultimo.isoformat()}
    )

    assert principio[primero]["estado"] == "movido"
    assert principio[primero]["cubierto_por"] == {
        "entrenamiento_id": recuperada,
        "fecha": tercero.isoformat(),
    }
    assert principio[tercero]["sesion"]["entrenamiento_id"] == recuperada
    assert hoja.status_code == 200, hoja.text
    assert hoja.json()["semana"][2]["sesion"]["entrenamiento_id"] == recuperada
    assert (final[ultimo]["origen"], final[ultimo]["rutina"]["id"]) == ("excepcion", ppl["Leg"])
    assert final[ultimo]["estado"] == "proximo"
    assert restablecer.status_code == 204
    assert cliente.get("/plan/excepciones").json() == [
        {
            "fecha": primero.isoformat(),
            "rutina": {"id": ppl["Push"], "nombre": "Push", "oculto_desde": None},
        }
    ]


def test_siempre_hace_las_mismas_consultas(cliente, sesion_bd, ppl, grupo_muscular_id):
    """Una por día o por sesión haría lento el resumen del año: tienen que ser las
    mismas pida lo que pida y haya lo que haya, también con tramos en que alguna
    rutina estuvo oculta (siete para el plan y dos para las sesiones, como mucho).
    """

    def consultas(desde, hasta) -> int:
        params = {"desde": desde.isoformat(), "hasta": hasta.isoformat()}
        return consultas_de(lambda: cliente.get("/plan/seguimiento", params=params))

    hecha(cliente, grupo_muscular_id, LUNES_7, ppl["Push"], cubre_fecha=LUNES_7)
    con_pocas = consultas(LUNES_7, LUNES_7)
    for fecha, rutina in ((MIERCOLES_9, "Pull"), (VIERNES_11, "Leg"), (LUNES_14, "Push")):
        hecha(cliente, grupo_muscular_id, fecha, ppl[rutina], cubre_fecha=fecha)
    # Rutinas que no están en el programa: las del plan ya vienen cargadas, y sin
    # estas no se notaría que la de cada sesión se pidiera aparte.
    for fecha, nombre in ((MARTES_8, "Brazos"), (JUEVES_10, "Core")):
        rutina = cliente.post("/rutinas", json={"nombre": nombre}).json()["id"]
        hecha(cliente, grupo_muscular_id, fecha, rutina)
        # Tramos ya cerrados en que estuvo oculta, dentro del rango: una consulta por
        # rutina o por tramo se notaría aquí.
        sesion_bd.add_all(
            RutinaPeriodoOculto(rutina_id=rutina, desde=desde, hasta=desde + timedelta(days=3))
            for desde in (date(2026, 3, 2), date(2026, 6, 1))
        )
    sesion_bd.add(
        RutinaPeriodoOculto(rutina_id=ppl["Push"], desde=date(2026, 7, 6), hasta=date(2026, 7, 8))
    )
    sesion_bd.commit()
    con_mas = consultas(LUNES_7 - timedelta(days=300), VIERNES_18)

    assert con_mas == con_pocas <= 9
