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
from sqlalchemy import select

from app.models import Entrenamiento, Rutina

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
    """Lo que hace hoy la web provisional: la sesión se guarda igual."""
    respuesta = sesion(cliente, HOY, ppl["Pull"])

    assert respuesta.status_code == 201
    assert respuesta.json()["cubre_fecha"] is None


def test_recuperar_hoy_lo_que_tocaba_el_lunes(cliente, ppl):
    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["cubre_fecha"] == LUNES_14.isoformat()


def test_lo_del_lunes_se_recupera_hasta_el_domingo(cliente, ppl):
    assert sesion(cliente, DOMINGO_13, ppl["Push"], cubre_fecha=LUNES_7).status_code == 201


def test_el_lunes_siguiente_ya_no_se_recupera_lo_del_lunes_anterior(cliente, ppl):
    respuesta = sesion(cliente, LUNES_14, ppl["Push"], cubre_fecha=LUNES_7)

    assert respuesta.status_code == 422
    assert "hasta el día antes" in respuesta.json()["detail"]


def test_adelantar_lo_del_viernes(cliente, ppl):
    """Un día que todavía no ha llegado se puede contar, aunque la sesión no."""
    respuesta = sesion(cliente, HOY, ppl["Leg"], cubre_fecha=VIERNES_18)

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["cubre_fecha"] == VIERNES_18.isoformat()


def test_se_adelanta_desde_el_lunes_de_la_misma_semana(cliente, ppl):
    assert sesion(cliente, LUNES_14, ppl["Leg"], cubre_fecha=VIERNES_18).status_code == 201


def test_no_se_adelanta_lo_de_la_semana_siguiente(cliente, ppl):
    assert sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_21).status_code == 422


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


def test_un_entrenamiento_libre_no_cuenta_para_ningun_dia(cliente, ppl):
    respuesta = sesion(cliente, HOY, None, cubre_fecha=HOY)

    assert respuesta.status_code == 422
    assert "libre" in respuesta.json()["detail"]


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

    assert sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=MARTES_15).status_code == 422


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
        sesion_bd.add(
            Entrenamiento(usuario_id=1, rutina_id=ppl["Push"], fecha=fecha, cubre_fecha=LUNES_14)
        )
    with pytest.raises(IntegrityError):
        sesion_bd.commit()
    sesion_bd.rollback()


# --- Aislamiento ---------------------------------------------------------


def test_lo_que_cuenta_otro_usuario_no_estorba(cliente, ppl, sesion_bd, otro_usuario_id):
    """Ni da 409 ni se suelta: cada usuario tiene su propio plan."""
    rutina_ajena = Rutina(usuario_id=otro_usuario_id, nombre="Push")
    sesion_bd.add(rutina_ajena)
    sesion_bd.flush()
    ajena = Entrenamiento(
        usuario_id=otro_usuario_id, rutina_id=rutina_ajena.id, fecha=MARTES_15, cubre_fecha=LUNES_14
    )
    sesion_bd.add(ajena)
    sesion_bd.commit()

    assert sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14).status_code == 201

    sesion_bd.expire_all()
    assert (
        sesion_bd.scalar(select(Entrenamiento.cubre_fecha).where(Entrenamiento.id == ajena.id))
        == LUNES_14
    )


# --- Corregir la fecha (PUT) ---------------------------------------------
#
# La sesión sigue contando el mismo día aunque cambie su fecha, así que solo se
# mueve dentro del plazo de ese día. Estos tests pasan una semana, al miércoles
# 23, para tener días pasados a los dos lados del plazo.

DOMINGO_20 = date(2026, 9, 20)
MIERCOLES_23 = date(2026, 9, 23)


def corregir(cliente, entrenamiento_id, fecha, rutina_id, notas=None):
    """PUT /entrenamientos/{id}. El PUT sustituye todos los campos, así que la
    rutina se manda siempre: sin ella, la sesión pasaría a ser libre.
    """
    return cliente.put(
        f"/entrenamientos/{entrenamiento_id}",
        json={"fecha": fecha.isoformat(), "rutina_id": rutina_id, "notas": notas},
    )


def test_una_sesion_recuperada_se_mueve_hasta_el_ultimo_dia_de_su_plazo(cliente, ppl, hoy_es):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    hoy_es(MIERCOLES_23)

    respuesta = corregir(cliente, recuperada, DOMINGO_20, ppl["Push"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["fecha"] == DOMINGO_20.isoformat()
    assert respuesta.json()["cubre_fecha"] == LUNES_14.isoformat()


def test_no_se_mueve_mas_alla_del_plazo_de_su_dia(cliente, ppl, hoy_es):
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    hoy_es(MIERCOLES_23)

    respuesta = corregir(cliente, recuperada, LUNES_21, ppl["Push"])

    assert respuesta.status_code == 422
    # El texto dice hasta dónde se puede mover.
    assert "del 2026-09-14 al 2026-09-20" in respuesta.json()["detail"]


def test_una_sesion_adelantada_se_mueve_hasta_el_lunes_de_su_semana(cliente, ppl, hoy_es):
    adelantada = sesion(cliente, HOY, ppl["Leg"], cubre_fecha=VIERNES_18).json()["id"]
    hoy_es(MIERCOLES_23)

    assert corregir(cliente, adelantada, LUNES_14, ppl["Leg"]).status_code == 200
    assert corregir(cliente, adelantada, DOMINGO_13, ppl["Leg"]).status_code == 422


def test_una_fecha_futura_se_rechaza_antes_que_el_plazo(cliente, ppl):
    """El 17 está dentro del plazo del lunes 14, pero todavía no ha llegado."""
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]

    respuesta = corregir(cliente, recuperada, JUEVES_17, ppl["Push"])

    assert respuesta.status_code == 422
    assert "todavía no ha llegado" in respuesta.json()["detail"]


def test_una_sesion_que_no_cuenta_ningun_dia_se_mueve_a_cualquier_fecha_libre(cliente, ppl, hoy_es):
    suelta = sesion(cliente, MARTES_15, ppl["Push"]).json()["id"]
    hoy_es(MIERCOLES_23)

    assert corregir(cliente, suelta, date(2026, 8, 3), ppl["Push"]).status_code == 200


def test_corregir_solo_las_notas_no_mira_el_plazo(cliente, ppl, hoy_es):
    """Aunque hoy ya no se pudiera recuperar lo del lunes, la sesión sigue en su
    fecha, que es la que tenía.
    """
    recuperada = sesion(cliente, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14).json()["id"]
    hoy_es(date(2026, 10, 15))

    respuesta = corregir(cliente, recuperada, MARTES_15, ppl["Push"], notas="Hombro cargado")

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["notas"] == "Hombro cargado"


def test_a_una_sesion_que_cuenta_un_dia_no_se_le_cambia_la_rutina(cliente, ppl):
    """Para apuntar otra rutina se borra el día y se registra de nuevo."""
    empezada = sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY).json()["id"]

    respuesta = corregir(cliente, empezada, HOY, ppl["Push"])

    assert respuesta.status_code == 409
    assert "borra el día" in respuesta.json()["detail"]
    # Tampoco se puede pasar a libre: sería otra forma de cambiarle la rutina.
    assert corregir(cliente, empezada, HOY, None).status_code == 409


def test_a_una_sesion_que_no_cuenta_ningun_dia_si_se_le_cambia_la_rutina(cliente, ppl):
    suelta = sesion(cliente, HOY, ppl["Pull"]).json()["id"]

    respuesta = corregir(cliente, suelta, HOY, ppl["Push"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["rutina_id"] == ppl["Push"]
