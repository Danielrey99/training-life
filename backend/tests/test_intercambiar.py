"""Tests de intercambiar y empezar en una sola petición: `POST /entrenamientos` con
`intercambiar_con`.

En la pantalla de hoy, *Intercambiar* trae a hoy lo que toca otro día y empieza
la sesión. Antes eran dos llamadas (`POST /plan/intercambiar` y después crear la
sesión): si la segunda fallaba, el plan se quedaba cambiado sin sesión. Ahora es
todo o nada, en una transacción: lo que más importa aquí es que **ningún error
deja el plan cambiado**.

Orden de las comprobaciones: 422 fecha futura → 404 rutina → 422 del intercambio
→ 409 si hoy ya hay sesión (antes de tocar el plan) → intercambio (puede dar el
409 de reubicar lo adelantado) → el día que cuenta → 201.

Todos parten de la semana de `tests/semana.py`: hoy es el miércoles 16 de
septiembre de 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
"""

import pytest
from sqlalchemy import func, select

from app.models import Entrenamiento, ExcepcionDelPlan
from tests.ayudas import dejar_planificado
from tests.semana import (
    HOY,
    JUEVES_17,
    LUNES_14,
    LUNES_21,
    MARTES_15,
    SABADO_19,
    VIERNES_18,
    cubre,
    hecha,
)


# --- Ayudantes -----------------------------------------------------------


def empezar_intercambiando(cliente, rutina_id, otro, fecha=HOY, cubre=HOY, **campos):
    """POST /entrenamientos con `intercambiar_con`; devuelve la respuesta entera.
    Con `cubre=None` se manda `cubre_fecha` nula.
    """
    cuerpo = {
        "rutina_id": rutina_id,
        "fecha": fecha.isoformat(),
        "cubre_fecha": None if cubre is None else cubre.isoformat(),
        "intercambiar_con": otro.isoformat(),
        **campos,
    }
    return cliente.post("/entrenamientos", json=cuerpo)


def dia(cliente, fecha) -> dict:
    """El día del seguimiento del plan: qué toca, de dónde sale y quién lo cuenta."""
    respuesta = cliente.get(
        "/plan/seguimiento", params={"desde": fecha.isoformat(), "hasta": fecha.isoformat()}
    )
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()[0]


def lo_que_toca(cliente, fecha) -> tuple:
    """`(origen, rutina o None, descanso)` de ese día."""
    d = dia(cliente, fecha)
    return d["origen"], d["rutina"]["nombre"] if d["rutina"] else None, d["descanso"]


def cuantas(sesion_bd, modelo) -> int:
    sesion_bd.expire_all()
    return sesion_bd.scalar(select(func.count()).select_from(modelo))


# --- Lo que hace ---------------------------------------------------------


def test_intercambiar_y_empezar_trae_a_hoy_lo_de_ese_dia(cliente, ppl):
    """Hoy Pull y el viernes Leg: se empieza Leg intercambiando con el viernes. Los
    dos días quedan cambiados a mano, cada uno con lo del otro, y la sesión cuenta
    hoy. `intercambiar_con` no se guarda: la sesión no lo devuelve.
    """
    respuesta = empezar_intercambiando(cliente, ppl["Leg"], VIERNES_18)

    assert respuesta.status_code == 201, respuesta.text
    sesion = respuesta.json()
    assert (sesion["rutina_id"], sesion["fecha"], sesion["cubre_fecha"]) == (
        ppl["Leg"],
        HOY.isoformat(),
        HOY.isoformat(),
    )
    assert "intercambiar_con" not in sesion
    assert lo_que_toca(cliente, HOY) == ("excepcion", "Leg", False)
    assert lo_que_toca(cliente, VIERNES_18) == ("excepcion", "Pull", False)
    assert dia(cliente, HOY)["cubierto_por"]["entrenamiento_id"] == sesion["id"]


def test_intercambiar_con_un_dia_ya_cambiado_a_mano(cliente, ppl):
    """El sábado (descanso en el programa) se planificó Push: al intercambiarlo, hoy
    pasa a Push y el sábado a Pull, lo de hoy salga del programa o de una excepción.
    """
    dejar_planificado(cliente, SABADO_19, ppl["Push"])

    respuesta = empezar_intercambiando(cliente, ppl["Push"], SABADO_19)

    assert respuesta.status_code == 201, respuesta.text
    assert lo_que_toca(cliente, HOY) == ("excepcion", "Push", False)
    assert lo_que_toca(cliente, SABADO_19) == ("excepcion", "Pull", False)


def test_un_descanso_de_hoy_se_lleva_al_otro_dia(cliente, ppl):
    """Hoy se cambió a descanso: al traer el Leg del viernes, el viernes se queda en
    descanso.
    """
    dejar_planificado(cliente, HOY, None)

    respuesta = empezar_intercambiando(cliente, ppl["Leg"], VIERNES_18)

    assert respuesta.status_code == 201, respuesta.text
    assert lo_que_toca(cliente, HOY) == ("excepcion", "Leg", False)
    assert lo_que_toca(cliente, VIERNES_18) == ("excepcion", None, True)


def test_una_rutina_oculta_de_hoy_se_lleva_como_descanso(cliente, ppl):
    """Hoy toca Pull, pero está oculta: cuenta como descanso, y así se lleva al
    viernes. Lo oculto no se vuelve a planificar.
    """
    assert cliente.delete(f"/rutinas/{ppl['Pull']}?modo=ocultar").status_code == 204

    respuesta = empezar_intercambiando(cliente, ppl["Leg"], VIERNES_18)

    assert respuesta.status_code == 201, respuesta.text
    assert lo_que_toca(cliente, HOY) == ("excepcion", "Leg", False)
    assert lo_que_toca(cliente, VIERNES_18) == ("excepcion", None, True)


def test_lo_de_hoy_hecho_por_adelantado_se_va_con_su_rutina(cliente, ppl, grupo_muscular_id):
    """El Pull de hoy se hizo el lunes. Al traer el Leg del viernes, el Pull pasa al
    viernes y la sesión del lunes con él; la nueva cuenta hoy.
    """
    adelantada = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Pull"], cubre_fecha=HOY)

    respuesta = empezar_intercambiando(cliente, ppl["Leg"], VIERNES_18)

    assert respuesta.status_code == 201, respuesta.text
    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()
    assert respuesta.json()["cubre_fecha"] == HOY.isoformat()


def test_una_sesion_cancelada_de_hoy_se_borra_y_se_crea_la_nueva(cliente, ppl):
    """Se empezó el Pull de hoy y se terminó sin apuntar nada: está cancelada, no
    ocupa el día.
    """
    cancelada = cliente.post(
        "/entrenamientos", json={"rutina_id": ppl["Pull"], "fecha": HOY.isoformat()}
    ).json()["id"]
    assert cliente.post(f"/entrenamientos/{cancelada}/terminar").status_code == 200

    respuesta = empezar_intercambiando(cliente, ppl["Leg"], VIERNES_18)

    assert respuesta.status_code == 201, respuesta.text
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 404
    assert lo_que_toca(cliente, HOY) == ("excepcion", "Leg", False)


def test_sin_intercambiar_con_no_se_toca_el_plan(cliente, sesion_bd, ppl):
    respuesta = cliente.post(
        "/entrenamientos",
        json={
            "rutina_id": ppl["Pull"],
            "fecha": HOY.isoformat(),
            "cubre_fecha": HOY.isoformat(),
        },
    )

    assert respuesta.status_code == 201, respuesta.text
    assert cuantas(sesion_bd, ExcepcionDelPlan) == 0


# --- Errores de la petición: 422 y 404, sin tocar nada ---------------------


@pytest.mark.parametrize(
    "rutina, otro, fecha, cubre_, mensaje",
    [
        pytest.param(
            "Leg",
            VIERNES_18,
            MARTES_15,
            MARTES_15,
            "Solo se intercambia al empezar la sesión de hoy.",
            id="un-dia-pasado",
        ),
        pytest.param(
            "Pull",
            HOY,
            HOY,
            HOY,
            "Para intercambiar hacen falta dos días distintos.",
            id="el-mismo-dia",
        ),
        pytest.param(
            "Push",
            LUNES_14,
            HOY,
            HOY,
            "El 2026-09-14 ya ha pasado: solo se puede intercambiar con un día de hoy en adelante.",
            id="con-un-dia-pasado",
        ),
        pytest.param(
            "Leg",
            VIERNES_18,
            HOY,
            VIERNES_18,
            "Al intercambiar, la sesión cuenta como la de hoy: cubre_fecha tiene que ser"
            " 2026-09-16.",
            id="cuenta-otro-dia",
        ),
        pytest.param(
            "Leg",
            VIERNES_18,
            HOY,
            None,
            "Al intercambiar, la sesión cuenta como la de hoy: cubre_fecha tiene que ser"
            " 2026-09-16.",
            id="sin-cubre-fecha",
        ),
        pytest.param(
            "Push",
            VIERNES_18,
            HOY,
            HOY,
            "El 2026-09-18 no toca esa rutina: intercambiar trae a hoy lo que toca ese día.",
            id="otra-rutina",
        ),
        pytest.param(
            "Leg",
            JUEVES_17,
            HOY,
            HOY,
            "El 2026-09-17 no toca esa rutina: intercambiar trae a hoy lo que toca ese día.",
            id="un-descanso",
        ),
    ],
)
def test_un_intercambio_mal_pedido_da_422_y_no_cambia_nada(
    cliente, sesion_bd, ppl, rutina, otro, fecha, cubre_, mensaje
):
    respuesta = empezar_intercambiando(cliente, ppl[rutina], otro, fecha=fecha, cubre=cubre_)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == mensaje
    assert cuantas(sesion_bd, ExcepcionDelPlan) == 0
    assert cuantas(sesion_bd, Entrenamiento) == 0


def test_una_fecha_futura_da_su_422_antes_que_el_del_intercambio(cliente, sesion_bd, ppl):
    respuesta = empezar_intercambiando(
        cliente, ppl["Leg"], VIERNES_18, fecha=JUEVES_17, cubre=JUEVES_17
    )

    assert respuesta.status_code == 422
    assert "todavía no ha llegado" in respuesta.json()["detail"]
    assert cuantas(sesion_bd, ExcepcionDelPlan) == 0


def test_una_rutina_oculta_da_404_antes_que_nada_y_no_cambia_el_plan(cliente, sesion_bd, ppl):
    """El 404 de la rutina va antes que los 422 del intercambio: el mismo día dos
    veces sería un 422, y sale el 404.
    """
    assert cliente.delete(f"/rutinas/{ppl['Leg']}?modo=ocultar").status_code == 204

    respuesta = empezar_intercambiando(cliente, ppl["Leg"], HOY)

    assert respuesta.status_code == 404
    assert respuesta.json()["detail"] == f"No existe ninguna rutina con id {ppl['Leg']}"
    assert cuantas(sesion_bd, ExcepcionDelPlan) == 0


def test_un_422_del_intercambio_no_borra_la_cancelada_de_hoy(cliente, sesion_bd, ppl):
    """Los errores de la petición van antes que liberar el día."""
    cancelada = cliente.post(
        "/entrenamientos", json={"rutina_id": ppl["Pull"], "fecha": HOY.isoformat()}
    ).json()["id"]
    assert cliente.post(f"/entrenamientos/{cancelada}/terminar").status_code == 200

    respuesta = empezar_intercambiando(cliente, ppl["Push"], VIERNES_18)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        422,
        "El 2026-09-18 no toca esa rutina: intercambiar trae a hoy lo que toca ese día.",
    )
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 200


# --- Choques con lo que ya hay: 409, y el plan como estaba ---------------------


@pytest.mark.parametrize("terminada", [False, True], ids=["en-curso", "terminada-con-series"])
def test_si_hoy_ya_hay_sesion_da_409_y_el_plan_no_cambia(
    cliente, sesion_bd, ppl, grupo_muscular_id, terminada
):
    """Se entrena una rutina al día: con una sesión de hoy (en curso, o terminada con
    algo apuntado), 409 con su id, y el intercambio no se hace.
    """
    hoy_id = hecha(cliente, grupo_muscular_id, HOY, ppl["Pull"], cubre_fecha=HOY)
    if terminada:
        assert cliente.post(f"/entrenamientos/{hoy_id}/terminar").status_code == 200

    respuesta = empezar_intercambiando(cliente, ppl["Leg"], VIERNES_18)

    assert respuesta.status_code == 409
    detalle = respuesta.json()["detail"]
    assert (detalle["entrenamiento_id"], detalle["en_curso"]) == (hoy_id, not terminada)
    assert cuantas(sesion_bd, ExcepcionDelPlan) == 0
    assert cuantas(sesion_bd, Entrenamiento) == 1
    assert lo_que_toca(cliente, HOY) == ("programa", "Pull", False)


def test_si_lo_adelantado_se_queda_sin_dia_da_409_y_no_se_crea_nada(
    cliente, sesion_bd, ppl, grupo_muscular_id
):
    """El Pull de hoy se hizo el lunes, y se trae el Push del lunes que viene: el Pull
    se iría a la semana siguiente, y en esta no queda ningún otro día con Pull para
    la sesión del lunes. Es el 409 de reubicar lo adelantado: ni la sesión nueva ni
    los días cambiados.
    """
    adelantada = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Pull"], cubre_fecha=HOY)

    respuesta = empezar_intercambiando(cliente, ppl["Push"], LUNES_21)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"]["entrenamiento_id"] == adelantada
    assert cuantas(sesion_bd, ExcepcionDelPlan) == 0
    assert cuantas(sesion_bd, Entrenamiento) == 1
    assert cubre(cliente, adelantada) == HOY.isoformat()


def test_si_lo_del_otro_dia_ya_se_hizo_da_409_y_lo_deshace_todo(
    cliente, sesion_bd, ppl, grupo_muscular_id
):
    """El Leg del viernes se hizo el martes, y se intenta traerlo a hoy. El
    intercambio lleva esa sesión a hoy (sigue a su rutina), y entonces hoy ya está
    hecho: 409 cuando el plan ya se ha cambiado y la cancelada de hoy ya se ha
    borrado. La transacción tiene que deshacerlo todo: ni días cambiados, ni la
    sesión del martes movida, ni la cancelada borrada, ni sesión nueva.
    """
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=VIERNES_18)
    cancelada = cliente.post(
        "/entrenamientos", json={"rutina_id": ppl["Pull"], "fecha": HOY.isoformat()}
    ).json()["id"]
    assert cliente.post(f"/entrenamientos/{cancelada}/terminar").status_code == 200

    respuesta = empezar_intercambiando(cliente, ppl["Leg"], VIERNES_18)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"]["entrenamiento_id"] == adelantada
    assert cuantas(sesion_bd, ExcepcionDelPlan) == 0
    assert cuantas(sesion_bd, Entrenamiento) == 2
    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 200
    assert lo_que_toca(cliente, HOY) == ("programa", "Pull", False)
    assert lo_que_toca(cliente, VIERNES_18) == ("programa", "Leg", False)
