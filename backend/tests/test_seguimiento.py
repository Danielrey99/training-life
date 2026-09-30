"""Tests del estado de cada día del plan: `GET /plan/seguimiento`.

Cada día dice qué tocaba y qué pasó: hecho, movido a otro día, sin hacer,
pendiente (hoy) o próximo, qué sesión lo cuenta y qué se hizo ese día. De ahí
salen las marcas del calendario, también las combinadas.

Todos parten de la semana de `tests/semana.py`: hoy es el miércoles 16 de
septiembre de 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import event

from app.database import engine
from app.models import Entrenamiento, Rutina
from tests.semana import HOY, LUNES_7, LUNES_14, MARTES_15, VIERNES_18, con_una_serie, sesion

MARTES_8 = date(2026, 9, 8)
MIERCOLES_9 = date(2026, 9, 9)
JUEVES_10 = date(2026, 9, 10)
VIERNES_11 = date(2026, 9, 11)


def hecha(cliente, grupo_muscular_id, fecha, rutina_id, cubre_fecha=None) -> int:
    """Una sesión con una serie apuntada: sin series, ya fuera de curso, sería una
    sesión cancelada.
    """
    respuesta = sesion(cliente, fecha, rutina_id, cubre_fecha)
    assert respuesta.status_code == 201, respuesta.text
    entrenamiento_id = respuesta.json()["id"]
    con_una_serie(cliente, grupo_muscular_id, entrenamiento_id)
    return entrenamiento_id


def seguimiento(cliente, desde, hasta=None) -> dict:
    """Los días pedidos, por fecha."""
    respuesta = cliente.get(
        "/plan/seguimiento",
        params={"desde": desde.isoformat(), "hasta": (hasta or desde).isoformat()},
    )
    assert respuesta.status_code == 200, respuesta.text
    return {date.fromisoformat(dia["fecha"]): dia for dia in respuesta.json()}


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


def test_un_dia_adelantado_esta_movido_aunque_no_haya_llegado(cliente, ppl, grupo_muscular_id):
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=VIERNES_18)

    dia = seguimiento(cliente, VIERNES_18)[VIERNES_18]

    assert dia["estado"] == "movido"
    assert dia["cubierto_por"]["entrenamiento_id"] == adelantada


def test_los_dias_sin_programa_son_descanso(cliente, ppl):
    dia = seguimiento(cliente, date(2026, 8, 30))[date(2026, 8, 30)]

    assert dia["estado"] == "descanso"
    assert dia["origen"] == "sin_programa"


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
        "vacia": True,
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


def test_un_entrenamiento_libre_sale_como_sesion_sin_contar(cliente, ppl, grupo_muscular_id):
    libre = hecha(cliente, grupo_muscular_id, MARTES_15, None)

    dia = seguimiento(cliente, MARTES_15)[MARTES_15]

    assert dia["estado"] == "descanso"
    assert dia["sesion"]["entrenamiento_id"] == libre
    assert dia["sesion"]["rutina"] is None
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
    "desde, hasta",
    [
        pytest.param(HOY, LUNES_14, id="invertido"),
        pytest.param(HOY, HOY + timedelta(days=400), id="mas-de-400-dias"),
    ],
)
def test_un_rango_invalido_da_422(cliente, ppl, desde, hasta):
    respuesta = cliente.get(
        "/plan/seguimiento", params={"desde": desde.isoformat(), "hasta": hasta.isoformat()}
    )

    assert respuesta.status_code == 422


def test_siempre_hace_las_mismas_consultas(cliente, ppl, grupo_muscular_id):
    """Una por día o por sesión haría lento el resumen del año: tienen que ser las
    mismas pida lo que pida y haya lo que haya.
    """

    def consultas(desde, hasta) -> int:
        contador = []

        def contar(*_):
            contador.append(1)

        event.listen(engine, "before_cursor_execute", contar)
        try:
            seguimiento(cliente, desde, hasta)
        finally:
            event.remove(engine, "before_cursor_execute", contar)
        return len(contador)

    hecha(cliente, grupo_muscular_id, LUNES_7, ppl["Push"], cubre_fecha=LUNES_7)
    con_pocas = consultas(LUNES_7, LUNES_7)
    for fecha, rutina in ((MIERCOLES_9, "Pull"), (VIERNES_11, "Leg"), (LUNES_14, "Push")):
        hecha(cliente, grupo_muscular_id, fecha, ppl[rutina], cubre_fecha=fecha)
    # Rutinas que no están en el programa: las del plan ya vienen cargadas, y sin
    # estas no se notaría que la de cada sesión se pidiera aparte.
    for fecha, nombre in ((MARTES_8, "Brazos"), (JUEVES_10, "Core")):
        rutina = cliente.post("/rutinas", json={"nombre": nombre}).json()["id"]
        hecha(cliente, grupo_muscular_id, fecha, rutina)
    con_mas = consultas(LUNES_7 - timedelta(days=300), VIERNES_18)

    assert con_mas == con_pocas <= 8


# --- Aislamiento ---------------------------------------------------------


def test_las_sesiones_de_otro_usuario_no_salen_ni_cuentan(cliente, ppl, sesion_bd, otro_usuario_id):
    """La ajena es de hoy y sin terminar: está en curso, así que no se queda fuera
    por cancelada, sino por ser de otro.
    """
    rutina_ajena = Rutina(usuario_id=otro_usuario_id, nombre="Push")
    sesion_bd.add(rutina_ajena)
    sesion_bd.flush()
    sesion_bd.add(
        Entrenamiento(
            usuario_id=otro_usuario_id,
            rutina_id=rutina_ajena.id,
            fecha=HOY,
            cubre_fecha=HOY,
        )
    )
    sesion_bd.commit()

    dia = seguimiento(cliente, HOY)[HOY]

    assert dia["estado"] == "pendiente"
    assert dia["cubierto_por"] is None
    assert dia["sesion"] is None
