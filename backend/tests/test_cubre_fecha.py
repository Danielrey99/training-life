"""Tests de qué día del plan cuenta cada sesión (`cubre_fecha`).

Lo decide el botón que se pulsa: *Empezar* cuenta hoy, *Recuperar* un día pasado
y *Adelantar* uno de esta semana. Al crear la sesión, el backend comprueba que ese
día toque esa rutina, que esté en plazo y que no lo cuente ya otra sesión. Al
corregir su fecha, el día que cuenta no cambia, así que solo se mueve dentro de
su plazo.

Todos parten de la semana de `tests/semana.py`, con el reloj congelado para que el
día de la semana no dependa de cuándo se ejecuten.
"""

from datetime import date

import pytest

from app.models import Entrenamiento

from tests.semana import (
    DOMINGO_13,
    HOY,
    JUEVES_17,
    LUNES_14,
    LUNES_21,
    LUNES_7,
    MARTES_15,
    VIERNES_18,
    con_una_serie,
    sesion,
)


# --- Empezar, recuperar y adelantar --------------------------------------


def test_empezar_lo_que_toca_hoy_cuenta_hoy(cliente, ppl):
    respuesta = sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY)

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["cubre_fecha"] == HOY.isoformat()


def test_sin_cubre_fecha_la_sesion_no_cuenta_para_ningun_dia(cliente, ppl):
    """Es entrenar una rutina «sin contar»: la sesión se guarda igual."""
    respuesta = sesion(cliente, HOY, ppl["Pull"])

    assert respuesta.status_code == 201
    assert respuesta.json()["cubre_fecha"] is None


def test_lo_del_lunes_se_recupera_hasta_el_domingo(cliente, ppl):
    assert sesion(cliente, DOMINGO_13, ppl["Push"], cubre_fecha=LUNES_7).status_code == 201


def test_el_lunes_siguiente_ya_no_se_recupera_lo_del_lunes_anterior(cliente, ppl):
    respuesta = sesion(cliente, LUNES_14, ppl["Push"], cubre_fecha=LUNES_7)

    assert respuesta.status_code == 422
    assert "hasta el día antes" in respuesta.json()["detail"]


def test_se_adelanta_desde_el_lunes_de_la_misma_semana(cliente, ppl):
    """El lunes 14 ya es pasado: la hoja de registrar un día pasado no ofrece
    adelantar, pero el POST se sigue aceptando. El backend valida que los datos
    sean coherentes, no qué botones enseña cada pantalla, y una sesión pasada que
    cuenta un día posterior se produce por otros caminos (un adelanto de hoy es
    mañana una sesión pasada; un PUT que la mueve atrás; el importador).
    """
    assert sesion(cliente, LUNES_14, ppl["Leg"], cubre_fecha=VIERNES_18).status_code == 201


def test_no_se_adelanta_lo_de_la_semana_siguiente(cliente, ppl):
    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_21)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"].startswith(
        "Lo del 2026-09-21 solo se puede entrenar del 2026-09-21 al 2026-09-27:"
    )
    assert cliente.get("/entrenamientos").json() == []


def test_lo_del_ultimo_dia_que_existe_da_422_por_el_plazo(cliente, ppl):
    """Antes daba 500: el plazo acababa seis días después del 9999-12-31, una fecha
    que no existe (`OverflowError` en `plazo()`). Su plazo acaba en ese mismo día.
    """
    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=date(9999, 12, 31))

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"].startswith(
        "Lo del 9999-12-31 solo se puede entrenar del 9999-12-27 al 9999-12-31:"
    )
    assert cliente.get("/entrenamientos").json() == []


def test_un_dia_cambiado_a_mano_se_adelanta_con_su_rutina_nueva(cliente, ppl):
    """Las excepciones de Planificar cuentan como días planificados."""
    respuesta = cliente.put(
        f"/plan/excepciones/{JUEVES_17.isoformat()}", json={"rutina_id": ppl["Push"]}
    )
    assert respuesta.status_code == 200, respuesta.text

    assert sesion(cliente, HOY, ppl["Push"], cubre_fecha=JUEVES_17).status_code == 201


# --- Días que no se pueden contar ----------------------------------------


@pytest.mark.parametrize(
    "rutina, dia",
    [
        pytest.param("Push", MARTES_15, id="descanso"),
        pytest.param("Pull", LUNES_14, id="toca-otra-rutina"),
        pytest.param("Push", date(2026, 8, 30), id="sin-programa"),
    ],
)
def test_un_dia_que_no_toca_esa_rutina_no_se_cuenta(cliente, ppl, rutina, dia):
    respuesta = sesion(cliente, dia, ppl[rutina], cubre_fecha=dia)

    assert respuesta.status_code == 422
    assert "no toca esa rutina" in respuesta.json()["detail"]


def test_lo_que_tocaba_con_el_programa_anterior_no_se_recupera(cliente, ppl):
    """Se activa hoy otro programa con el mismo Push los lunes: el del lunes 14
    lo planificaba el anterior, y lo faltado con él ya no se ofrece.
    """
    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": "Otro",
            "activar": True,
            "dias": [{"dia_semana": 1, "rutina_id": ppl["Push"]}],
        },
    )
    assert respuesta.status_code == 201

    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 422
    assert "otro programa" in respuesta.json()["detail"]


def test_una_fecha_futura_se_rechaza_antes_que_el_dia_que_cuenta(cliente, ppl):
    respuesta = sesion(cliente, JUEVES_17, ppl["Pull"], cubre_fecha=MARTES_15)

    assert respuesta.status_code == 422
    assert "todavía no ha llegado" in respuesta.json()["detail"]


def test_un_dia_que_no_se_puede_contar_da_422_aunque_la_fecha_este_ocupada(
    cliente, ppl, grupo_muscular_id
):
    """El error de la petición va antes que el choque con otra sesión."""
    ocupada = sesion(cliente, MARTES_15, ppl["Push"]).json()["id"]
    con_una_serie(cliente, grupo_muscular_id, ocupada)

    respuesta = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=MARTES_15)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        422,
        "El 2026-09-15 no toca esa rutina.",
    )
    assert cliente.get(f"/entrenamientos/{ocupada}").json()["series"] != []


def test_una_peticion_mal_hecha_no_borra_la_cancelada_que_ocupaba_la_fecha(cliente, ppl):
    """El POST valida en dos fases para que una petición que no vale nunca borre
    nada: los 422 van antes de mirar la fecha, que es lo que borra una cancelada.
    El martes es descanso, así que no se puede contar. (Que el error deshaga la
    transacción también la salvaría: este test solo cae si fallan las dos cosas.)
    """
    cancelada = sesion(cliente, MARTES_15, ppl["Push"]).json()["id"]

    respuesta = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=MARTES_15)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        422,
        "El 2026-09-15 no toca esa rutina.",
    )
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 200


def test_un_409_por_el_dia_que_cuenta_no_borra_la_cancelada_que_ocupaba_la_fecha(
    cliente, ppl, grupo_muscular_id
):
    """Aquí el orden no basta: la fecha ocupada por una cancelada se mira (y la
    cancelada se borra) antes de saber que el día ya lo cuenta otra sesión. Lo que
    la salva es que el 409 deshace la transacción entera.
    """
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    con_una_serie(cliente, grupo_muscular_id, recuperada)
    # La del propio lunes, vacía y de un día pasado: cancelada.
    cancelada = sesion(cliente, LUNES_14, ppl["Push"]).json()["id"]

    respuesta = sesion(cliente, LUNES_14, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["entrenamiento_id"] == recuperada
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 200


# --- Un día lo cuenta una sesión como mucho ------------------------------


def test_un_dia_ya_recuperado_no_se_recupera_otra_vez(cliente, ppl, grupo_muscular_id):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    con_una_serie(cliente, grupo_muscular_id, recuperada)

    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["entrenamiento_id"] == recuperada


def test_la_sesion_en_curso_cuenta_su_dia_aunque_este_vacia(cliente, ppl):
    """Se acaba de empezar: no está cancelada."""
    en_curso = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14).json()
    assert en_curso["en_curso"] is True

    respuesta = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["entrenamiento_id"] == en_curso["id"]


def test_una_sesion_cancelada_suelta_su_dia_y_se_borra(cliente, ppl):
    """Sin series y ya fuera de curso: no se hizo nada, así que lo del lunes sigue
    sin hacer y se puede recuperar. La cancelada desaparece.
    """
    cancelada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]

    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 201, respuesta.text
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 404


def test_una_sesion_de_otra_rutina_suelta_el_dia_pero_se_queda_en_el_historial(
    cliente, ppl, grupo_muscular_id, sesion_bd
):
    """Una sesión que retiene un día cuyo plan ya es otra rutina no lo cuenta. Se
    monta directamente en la base: con la API, el plan de un día pasado ya no cambia.
    """
    antigua = sesion(cliente, MARTES_15, ppl["Leg"]).json()["id"]
    con_una_serie(cliente, grupo_muscular_id, antigua)
    sesion_bd.get(Entrenamiento, antigua).cubre_fecha = LUNES_14
    sesion_bd.commit()

    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 201, respuesta.text
    antigua = cliente.get(f"/entrenamientos/{antigua}").json()
    assert antigua["cubre_fecha"] is None
    assert len(antigua["series"]) == 1


def test_la_base_de_datos_impide_que_dos_sesiones_cuenten_el_mismo_dia(cliente, ppl, sesion_bd):
    from sqlalchemy.exc import IntegrityError

    for fecha in (MARTES_15, HOY):
        sesion_bd.add(Entrenamiento(rutina_id=ppl["Push"], fecha=fecha, cubre_fecha=LUNES_14))
    with pytest.raises(IntegrityError) as error:
        sesion_bd.commit()
    sesion_bd.rollback()
    # Que salte la restricción que se prueba y no otra.
    assert "entrenamientos_cubre_fecha_key" in str(error.value)


# --- Corregir la fecha (PUT) ---------------------------------------------
#
# La sesión sigue contando el mismo día aunque cambie su fecha, así que solo se
# mueve dentro del plazo de ese día. Estos tests pasan una semana, al miércoles
# 23, para tener días pasados a los dos lados del plazo.

DOMINGO_20 = date(2026, 9, 20)
MIERCOLES_23 = date(2026, 9, 23)


def corregir(cliente, entrenamiento_id, fecha, notas=None):
    """PUT /entrenamientos/{id}. Solo corrige la fecha y las notas: la rutina y el
    día que cuenta se fijan al crear la sesión.
    """
    return cliente.put(
        f"/entrenamientos/{entrenamiento_id}",
        json={"fecha": fecha.isoformat(), "notas": notas},
    )


def test_una_sesion_recuperada_se_mueve_hasta_el_ultimo_dia_de_su_plazo(cliente, ppl, hoy_es):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    hoy_es(MIERCOLES_23)

    respuesta = corregir(cliente, recuperada, DOMINGO_20)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["fecha"] == DOMINGO_20.isoformat()
    assert respuesta.json()["cubre_fecha"] == LUNES_14.isoformat()


def test_no_se_mueve_mas_alla_del_plazo_de_su_dia(cliente, ppl, hoy_es):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    hoy_es(MIERCOLES_23)

    respuesta = corregir(cliente, recuperada, LUNES_21)

    assert respuesta.status_code == 422
    # El texto dice hasta dónde se puede mover.
    assert "del 2026-09-14 al 2026-09-20" in respuesta.json()["detail"]


def test_una_sesion_adelantada_se_mueve_hasta_el_lunes_de_su_semana(cliente, ppl, hoy_es):
    adelantada = sesion(cliente, HOY, ppl["Leg"], cubre_fecha=VIERNES_18).json()["id"]
    hoy_es(MIERCOLES_23)

    assert corregir(cliente, adelantada, LUNES_14).status_code == 200
    al_domingo = corregir(cliente, adelantada, DOMINGO_13)
    assert al_domingo.status_code == 422
    assert (
        "Lo del 2026-09-18 solo se puede entrenar del 2026-09-14 al 2026-09-24"
        in (al_domingo.json()["detail"])
    )
    assert cliente.get(f"/entrenamientos/{adelantada}").json()["fecha"] == "2026-09-14"


def test_una_fecha_futura_se_rechaza_antes_que_el_plazo(cliente, ppl):
    """El 17 está dentro del plazo del lunes 14, pero todavía no ha llegado."""
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]

    respuesta = corregir(cliente, recuperada, JUEVES_17)

    assert respuesta.status_code == 422
    assert "todavía no ha llegado" in respuesta.json()["detail"]


def test_una_sesion_que_no_cuenta_ningun_dia_se_mueve_a_cualquier_fecha_libre(cliente, ppl, hoy_es):
    suelta = sesion(cliente, MARTES_15, ppl["Push"]).json()["id"]
    hoy_es(MIERCOLES_23)

    assert corregir(cliente, suelta, date(2026, 8, 3)).status_code == 200


def test_corregir_solo_las_notas_no_mira_el_plazo(cliente, ppl, hoy_es):
    """Aunque hoy ya no se pudiera recuperar lo del lunes, la sesión sigue en su
    fecha, que es la que tenía.
    """
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    hoy_es(date(2026, 10, 15))

    respuesta = corregir(cliente, recuperada, MARTES_15, notas="Hombro cargado")

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["notas"] == "Hombro cargado"


# --- Corregir la fecha entre programas (PUT) -----------------------------
#
# Como al crearla, la fecha de la sesión y el día que cuenta tienen que caer en el
# mismo programa. En estos tests el programa viejo (`ppl`) llega hasta el martes 15 y
# desde hoy, miércoles 16, manda otro.

AVISO_OTRO_PROGRAMA = (
    "El 2026-09-14 lo planificaba otro programa: lo que tocaba con un programa que ya"
    " no está activo no se recupera."
)


def activar_otro_programa(cliente, ppl) -> None:
    """Activa hoy un programa nuevo con el mismo Push los lunes: lo anterior al 16
    queda en el programa viejo y lo posterior, en este.
    """
    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": "Otro",
            "activar": True,
            "dias": [{"dia_semana": 1, "rutina_id": ppl["Push"]}],
        },
    )
    assert respuesta.status_code == 201, respuesta.text


def fecha_guardada(cliente, entrenamiento_id) -> str:
    return cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["fecha"]


def test_no_se_mueve_a_un_dia_de_otro_programa_el_dia_que_se_recuperaba(cliente, ppl):
    """Sin esta comprobación, el PUT dejaba mover a hoy (programa nuevo) una sesión que
    cuenta el lunes del programa viejo, algo que el POST rechaza.
    """
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    activar_otro_programa(cliente, ppl)

    respuesta = corregir(cliente, recuperada, HOY)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == AVISO_OTRO_PROGRAMA
    assert fecha_guardada(cliente, recuperada) == MARTES_15.isoformat()


def test_se_mueve_dentro_del_mismo_programa_aunque_haya_otro_activo(cliente, ppl):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    activar_otro_programa(cliente, ppl)

    respuesta = corregir(cliente, recuperada, LUNES_14)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["fecha"] == LUNES_14.isoformat()


def test_una_sesion_sin_dia_que_contar_se_mueve_de_un_programa_a_otro(cliente, ppl):
    suelta = sesion(cliente, MARTES_15, ppl["Push"]).json()["id"]
    activar_otro_programa(cliente, ppl)

    respuesta = corregir(cliente, suelta, HOY)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["fecha"] == HOY.isoformat()


def test_no_se_mueve_a_un_dia_sin_programa_lo_que_contaba_el_programa_desactivado(cliente, ppl):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    programa = cliente.get("/programas").json()[0]["id"]
    assert cliente.post(f"/programas/{programa}/desactivar").status_code == 200

    respuesta = corregir(cliente, recuperada, HOY)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == AVISO_OTRO_PROGRAMA
    assert fecha_guardada(cliente, recuperada) == MARTES_15.isoformat()


def test_una_sesion_que_ya_cruzaba_programas_se_sigue_pudiendo_mover(cliente, ppl):
    """Un adelanto del viernes 18 apuntado el martes 15, y después se activa otro
    programa: la fecha (15) es del viejo y el día que cuenta (18), del nuevo. Moverla
    entre dos días del viejo dentro del plazo no empeora nada, así que se permite.
    """
    adelantada = sesion(cliente, MARTES_15, ppl["Leg"], cubre_fecha=VIERNES_18).json()["id"]
    activar_otro_programa(cliente, ppl)

    respuesta = corregir(cliente, adelantada, LUNES_14)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["fecha"] == LUNES_14.isoformat()
    assert respuesta.json()["cubre_fecha"] == VIERNES_18.isoformat()


def test_fuera_de_plazo_y_de_otro_programa_el_aviso_es_el_del_plazo(cliente, ppl, hoy_es):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    activar_otro_programa(cliente, ppl)
    hoy_es(MIERCOLES_23)

    respuesta = corregir(cliente, recuperada, LUNES_21)

    assert respuesta.status_code == 422
    assert "del 2026-09-14 al 2026-09-20" in respuesta.json()["detail"]
    assert fecha_guardada(cliente, recuperada) == MARTES_15.isoformat()


def test_de_otro_programa_y_con_el_dia_ocupado_es_422_y_no_toca_la_otra_sesion(cliente, ppl):
    """El programa se mira antes que el día libre: un 409 invitaría a hacer sitio en
    un día al que la sesión no puede ir de todas formas.
    """
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    activar_otro_programa(cliente, ppl)
    ocupante = sesion(cliente, HOY, ppl["Pull"]).json()["id"]

    respuesta = corregir(cliente, recuperada, HOY)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == AVISO_OTRO_PROGRAMA
    assert fecha_guardada(cliente, recuperada) == MARTES_15.isoformat()
    ocupante_ahora = cliente.get(f"/entrenamientos/{ocupante}").json()
    assert ocupante_ahora["fecha"] == HOY.isoformat()
    assert ocupante_ahora["rutina_id"] == ppl["Pull"]
