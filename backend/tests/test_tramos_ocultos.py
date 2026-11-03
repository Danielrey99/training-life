"""Tests de los tramos en que una rutina estuvo oculta (`rutina_periodos_ocultos`).

Ocultar una rutina deja de ponerla en el plan desde ese día: sus días cuentan como
descanso. Mostrarla después no reescribe el pasado: los días que le tocaban mientras
estuvo oculta siguen siendo descanso, y para eso se guarda cada tramo ya cerrado
(`[desde, hasta)`, sin incluir el día en que se volvió a mostrar). Lo que ya contaba
una sesión de esa rutina antes de ocultarla (hecho ese día o adelantado) sigue
contando, oculta o no.

Todos parten de la semana de `tests/semana.py`: hoy es el miércoles 16 de
septiembre de 2026, con Push los lunes, Pull los miércoles y Leg los viernes, desde el
lunes 31 de agosto. Los saltos de reloj, con `hoy_es`.
"""

from datetime import date

from sqlalchemy import select

from app.fechas import fecha_en_texto
from app.models import Entrenamiento, ExcepcionDelPlan, RutinaPeriodoOculto
from app.plan import dias_del_plan
from tests.ayudas import planificar
from tests.semana import (
    HOY,
    LUNES_7,
    LUNES_14,
    MARTES_15,
    SABADO_19,
    VIERNES_18,
    cubre,
    hecha,
    sesion,
    sin_dia_para_ella,
)

LUNES_31 = date(2026, 8, 31)
MARTES_1 = date(2026, 9, 1)
MIERCOLES_2 = date(2026, 9, 2)
SABADO_5 = date(2026, 9, 5)
MIERCOLES_9 = date(2026, 9, 9)
VIERNES_11 = date(2026, 9, 11)
SABADO_12 = date(2026, 9, 12)
VIERNES_25 = date(2026, 9, 25)
DOMINGO_27 = date(2026, 9, 27)


# --- Ayudas -------------------------------------------------------------------


def ocultar(cliente, rutina_id) -> None:
    respuesta = cliente.delete(f"/rutinas/{rutina_id}", params={"modo": "ocultar"})
    assert respuesta.status_code == 204, respuesta.text


def mostrar(cliente, rutina_id) -> dict:
    respuesta = cliente.post(f"/rutinas/{rutina_id}/mostrar")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def oculta_entre(cliente, hoy_es, rutina_id, desde, hasta) -> None:
    """Oculta la rutina el día `desde` y la vuelve a mostrar el día `hasta`, y deja
    el reloj otra vez en el miércoles 16.
    """
    hoy_es(desde)
    ocultar(cliente, rutina_id)
    hoy_es(hasta)
    mostrar(cliente, rutina_id)
    hoy_es(HOY)


def tramos(sesion_bd, rutina_id=None) -> list[tuple[date, date]]:
    sesion_bd.expire_all()
    consulta = select(RutinaPeriodoOculto.desde, RutinaPeriodoOculto.hasta).order_by(
        RutinaPeriodoOculto.desde
    )
    if rutina_id is not None:
        consulta = consulta.where(RutinaPeriodoOculto.rutina_id == rutina_id)
    return [tuple(fila) for fila in sesion_bd.execute(consulta)]


def oculto_desde(cliente, rutina_id) -> str | None:
    return cliente.get(f"/rutinas/{rutina_id}").json()["oculto_desde"]


def seguimiento(cliente, desde, hasta=None) -> dict:
    """Los días pedidos del seguimiento, por fecha."""
    respuesta = cliente.get(
        "/plan/seguimiento",
        params={"desde": desde.isoformat(), "hasta": (hasta or desde).isoformat()},
    )
    assert respuesta.status_code == 200, respuesta.text
    return {date.fromisoformat(dia["fecha"]): dia for dia in respuesta.json()}


def estado(cliente, fecha) -> tuple[str, bool]:
    """El estado del día en el seguimiento y si es descanso."""
    dia = seguimiento(cliente, fecha)[fecha]
    return dia["estado"], dia["descanso"]


def del_plan(sesion_bd, fecha) -> tuple[str | None, bool]:
    """Lo que toca ese día según el plan (`dias_del_plan`, en el que se apoyan
    recuperar, adelantar e intercambiar): la rutina y si es descanso. Es lo que toca,
    no lo que pasó.
    """
    sesion_bd.expire_all()
    [dia] = dias_del_plan(sesion_bd, fecha, fecha)
    return (dia.rutina.nombre if dia.rutina else None), dia.descanso


def por_recuperar(cliente) -> list[tuple[str, str]]:
    respuesta = cliente.get("/plan/hoy")
    assert respuesta.status_code == 200, respuesta.text
    return [(r["fecha"], r["rutina"]["nombre"]) for r in respuesta.json()["por_recuperar"]]


def constancia_de_septiembre(cliente) -> tuple[int, int, int]:
    """Entrenados, planificados y por llegar de septiembre en `GET /resumen`."""
    respuesta = cliente.get("/resumen", params={"mes": "2026-09"})
    assert respuesta.status_code == 200, respuesta.text
    mes = respuesta.json()["constancia"]["meses"][8]
    assert mes["mes"].startswith("2026-09")
    return mes["entrenados"], mes["planificados"], mes["por_llegar"]


# --- Lo que guardan ocultar y mostrar ------------------------------------------


def test_mostrar_guarda_el_tramo_en_que_estuvo_oculta(cliente, sesion_bd, hoy_es, ppl):
    hoy_es(MIERCOLES_2)
    ocultar(cliente, ppl["Push"])
    assert tramos(sesion_bd) == []
    hoy_es(SABADO_12)

    assert mostrar(cliente, ppl["Push"])["oculto_desde"] is None

    assert tramos(sesion_bd, ppl["Push"]) == [(MIERCOLES_2, SABADO_12)]


def test_ocultar_y_mostrar_el_mismo_dia_no_guarda_nada(cliente, sesion_bd, ppl):
    """El tramo estaría vacío (el CHECK `hasta > desde` daría un 500), y nada cambia:
    el lunes 14 sigue sin hacer.
    """
    ocultar(cliente, ppl["Push"])
    mostrar(cliente, ppl["Push"])

    assert tramos(sesion_bd) == []
    assert estado(cliente, LUNES_14) == ("sin_hacer", False)
    assert estado(cliente, HOY) == ("pendiente", False)


def test_volver_a_ocultar_el_dia_en_que_se_mostro_reabre_el_tramo(cliente, sesion_bd, hoy_es, ppl):
    """Oculta el 1, mostrada el 5 y oculta otra vez el 5: un solo tramo abierto desde
    el 1 («Oculta desde el 1 de septiembre»), sin dejar dos tramos pegados. Mostrarla
    el 9 guarda `[1, 9)`.
    """
    hoy_es(MARTES_1)
    ocultar(cliente, ppl["Push"])
    hoy_es(SABADO_5)
    mostrar(cliente, ppl["Push"])
    assert tramos(sesion_bd) == [(MARTES_1, SABADO_5)]

    ocultar(cliente, ppl["Push"])

    assert oculto_desde(cliente, ppl["Push"]) == MARTES_1.isoformat()
    assert tramos(sesion_bd) == []
    hoy_es(MIERCOLES_9)
    mostrar(cliente, ppl["Push"])
    assert tramos(sesion_bd) == [(MARTES_1, MIERCOLES_9)]


def test_ocultar_otro_dia_no_toca_los_tramos_de_antes(cliente, sesion_bd, hoy_es, ppl):
    oculta_entre(cliente, hoy_es, ppl["Push"], MARTES_1, SABADO_5)

    hoy_es(MIERCOLES_9)
    ocultar(cliente, ppl["Push"])

    assert oculto_desde(cliente, ppl["Push"]) == MIERCOLES_9.isoformat()
    assert tramos(sesion_bd) == [(MARTES_1, SABADO_5)]


def test_ocultar_una_ya_oculta_y_mostrar_una_visible_no_tocan_los_tramos(
    cliente, sesion_bd, hoy_es, ppl
):
    oculta_entre(cliente, hoy_es, ppl["Push"], MARTES_1, SABADO_5)
    hoy_es(MIERCOLES_9)
    ocultar(cliente, ppl["Push"])
    hoy_es(SABADO_12)

    ocultar(cliente, ppl["Push"])

    assert oculto_desde(cliente, ppl["Push"]) == MIERCOLES_9.isoformat()
    assert tramos(sesion_bd) == [(MARTES_1, SABADO_5)]
    # Pull no está oculta: mostrarla no guarda nada.
    mostrar(cliente, ppl["Pull"])
    assert tramos(sesion_bd, ppl["Pull"]) == []


def test_mostrar_con_el_reloj_hacia_atras_no_guarda_nada_ni_da_500(cliente, sesion_bd, hoy_es, ppl):
    """Oculta el 16 y mostrada con el reloj en el 14: `[16, 14)` no es un tramo."""
    ocultar(cliente, ppl["Push"])
    hoy_es(LUNES_14)

    assert mostrar(cliente, ppl["Push"])["oculto_desde"] is None

    assert tramos(sesion_bd) == []


def test_ocultar_con_el_reloj_hacia_atras_reabre_el_tramo_que_acaba_despues(
    cliente, sesion_bd, hoy_es, ppl
):
    """Un tramo `[1, 9)` y el reloj vuelve al 5: ocultar reabre ese tramo desde el 1
    en vez de dejar un tramo y un `oculto_desde` solapados.
    """
    oculta_entre(cliente, hoy_es, ppl["Push"], MARTES_1, MIERCOLES_9)
    hoy_es(SABADO_5)

    ocultar(cliente, ppl["Push"])

    assert oculto_desde(cliente, ppl["Push"]) == MARTES_1.isoformat()
    assert tramos(sesion_bd) == []


# --- Los días del tramo en el plan -------------------------------------------


def test_los_dias_en_que_estuvo_oculta_siguen_siendo_descanso_tras_mostrarla(cliente, hoy_es, ppl):
    """Regresión del punto G1 del repaso: Push oculta del miércoles 2 al sábado 12.
    Antes, al mostrarla se borraba `oculto_desde` sin guardar nada, y el lunes 7
    volvía a ser un día «sin hacer» que además se ofrecía para recuperar.
    """
    hoy_es(MIERCOLES_2)
    ocultar(cliente, ppl["Push"])
    hoy_es(SABADO_12)
    mostrar(cliente, ppl["Push"])

    lunes = seguimiento(cliente, LUNES_7)[LUNES_7]
    # La rutina sigue saliendo ese día (en gris), pero no se entrena.
    assert (lunes["estado"], lunes["descanso"], lunes["rutina"]["nombre"]) == (
        "descanso",
        True,
        "Push",
    )
    # Del lunes 7 aún se estaría en plazo; del miércoles 9 y el viernes 11, también.
    assert por_recuperar(cliente) == [("2026-09-09", "Pull"), ("2026-09-11", "Leg")]


def test_antes_del_tramo_y_desde_que_se_muestra_todo_sigue_igual(cliente, hoy_es, ppl):
    """Oculta del lunes 7 al lunes 14: el lunes 31, antes, sigue sin hacer; el 7, el
    día en que se ocultó, es descanso porque nada lo cuenta; el 14, el día en que se
    volvió a mostrar, ya no es del tramo.
    """
    oculta_entre(cliente, hoy_es, ppl["Push"], LUNES_7, LUNES_14)

    assert estado(cliente, LUNES_31) == ("sin_hacer", False)
    assert estado(cliente, LUNES_7) == ("descanso", True)
    assert estado(cliente, LUNES_14) == ("sin_hacer", False)


def test_entre_dos_tramos_los_dias_son_normales(cliente, sesion_bd, hoy_es, ppl):
    oculta_entre(cliente, hoy_es, ppl["Push"], LUNES_31, MIERCOLES_2)
    oculta_entre(cliente, hoy_es, ppl["Push"], LUNES_14, HOY)
    assert tramos(sesion_bd) == [(LUNES_31, MIERCOLES_2), (LUNES_14, HOY)]

    assert estado(cliente, LUNES_31) == ("descanso", True)
    assert estado(cliente, LUNES_7) == ("sin_hacer", False)
    assert estado(cliente, LUNES_14) == ("descanso", True)


def test_no_se_recupera_un_dia_en_que_la_rutina_estuvo_oculta(cliente, sesion_bd, hoy_es, ppl):
    oculta_entre(cliente, hoy_es, ppl["Push"], LUNES_14, MARTES_15)

    respuesta = sesion(cliente, HOY, ppl["Push"], cubre_fecha=LUNES_14)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == f"El {fecha_en_texto(LUNES_14)} no toca esa rutina."
    sesion_bd.expire_all()
    assert sesion_bd.scalars(select(Entrenamiento)).all() == []


def test_la_constancia_no_cuenta_los_dias_del_tramo(cliente, hoy_es, ppl):
    """Septiembre, con Push oculta del 7 al 14: el lunes 7 no está entre los
    planificados (sin el tramo serían seis: lunes 7 y 14, miércoles 2 y 9, viernes 4
    y 11). Por llegar: hoy, 18, 21, 23, 25, 28 y 30.
    """
    oculta_entre(cliente, hoy_es, ppl["Push"], LUNES_7, LUNES_14)

    assert constancia_de_septiembre(cliente) == (0, 5, 7)


def test_borrar_la_rutina_en_definitivo_se_lleva_sus_tramos(cliente, sesion_bd, hoy_es, ppl):
    oculta_entre(cliente, hoy_es, ppl["Push"], LUNES_7, LUNES_14)
    oculta_entre(cliente, hoy_es, ppl["Pull"], MIERCOLES_2, MIERCOLES_9)

    respuesta = cliente.delete(f"/rutinas/{ppl['Push']}", params={"modo": "definitivo"})

    assert respuesta.status_code == 204, respuesta.text
    assert tramos(sesion_bd) == [(MIERCOLES_2, MIERCOLES_9)]
    assert tramos(sesion_bd, ppl["Pull"]) == [(MIERCOLES_2, MIERCOLES_9)]


# --- Lo que ya contaba sigue contando ----------------------------------------


def test_lo_entrenado_el_dia_en_que_se_oculta_sigue_hecho(
    cliente, sesion_bd, hoy_es, ppl, grupo_muscular_id
):
    """Push se entrena el lunes 14 y se oculta ese mismo día. Antes, el lunes pasaba a
    descanso (y la sesión dejaba de contar): ocultar deshacía lo ya hecho. Ahora sigue
    hecho mientras está oculta y después de mostrarla; el plan sigue diciendo lo que
    toca (descanso), no lo que pasó.
    """
    hoy_es(LUNES_14)
    entrenada = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Push"], cubre_fecha=LUNES_14)
    ocultar(cliente, ppl["Push"])

    oculta = seguimiento(cliente, LUNES_14)[LUNES_14]
    hoy_es(MARTES_15)
    mostrar(cliente, ppl["Push"])
    hoy_es(HOY)
    mostrada = seguimiento(cliente, LUNES_14)[LUNES_14]

    for dia in (oculta, mostrada):
        assert (dia["estado"], dia["descanso"]) == ("hecho", False)
        assert dia["cubierto_por"] == {
            "entrenamiento_id": entrenada,
            "fecha": LUNES_14.isoformat(),
        }
    assert del_plan(sesion_bd, LUNES_14) == ("Push", True)


def test_la_pantalla_de_hoy_da_por_hecho_lo_entrenado_antes_de_ocultar(
    cliente, hoy_es, ppl, grupo_muscular_id
):
    hoy_es(LUNES_14)
    entrenada = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Push"], cubre_fecha=LUNES_14)
    assert cliente.post(f"/entrenamientos/{entrenada}/terminar").status_code == 200
    ocultar(cliente, ppl["Push"])

    assert cliente.get("/plan/hoy").json()["situacion"] == "hecho"
    hoy_es(MARTES_15)
    assert ("2026-09-14", "Push") not in por_recuperar(cliente)


def test_la_constancia_cuenta_lo_entrenado_antes_de_ocultar(
    cliente, hoy_es, ppl, grupo_muscular_id
):
    """Septiembre: el lunes 14, hecho, es entrenado y planificado; con el lunes 7,
    los miércoles 2 y 9 y los viernes 4 y 11, sin hacer, son seis.
    """
    hoy_es(LUNES_14)
    hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Push"], cubre_fecha=LUNES_14)
    ocultar(cliente, ppl["Push"])
    hoy_es(MARTES_15)
    mostrar(cliente, ppl["Push"])
    hoy_es(HOY)

    entrenados, planificados, _ = constancia_de_septiembre(cliente)

    assert (entrenados, planificados) == (1, 6)


def test_una_sesion_cancelada_no_salva_el_dia_en_que_se_oculta(cliente, hoy_es, ppl):
    """Sin series y ya fuera de su día, está cancelada: no cuenta, y el lunes 14 es
    descanso como cualquier día de la rutina oculta.
    """
    hoy_es(LUNES_14)
    assert sesion(cliente, LUNES_14, ppl["Push"], cubre_fecha=LUNES_14).status_code == 201
    ocultar(cliente, ppl["Push"])
    hoy_es(MARTES_15)

    dia = seguimiento(cliente, LUNES_14)[LUNES_14]

    assert (dia["estado"], dia["descanso"], dia["cubierto_por"]) == ("descanso", True, None)


def test_lo_adelantado_antes_de_ocultar_sigue_contando_y_el_resto_del_tramo_no(
    cliente, sesion_bd, hoy_es, ppl, grupo_muscular_id
):
    """El Leg del viernes 18 se hizo el martes 15; Leg se oculta el 16 y se vuelve a
    mostrar el 27. El viernes 18 sigue movido (oculta y mostrada); el viernes 25, del
    tramo y sin sesión, es descanso.
    """
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=VIERNES_18)
    ocultar(cliente, ppl["Leg"])
    assert estado(cliente, VIERNES_18) == ("movido", False)

    hoy_es(DOMINGO_27)
    mostrar(cliente, ppl["Leg"])
    dias = seguimiento(cliente, VIERNES_18, VIERNES_25)

    assert (dias[VIERNES_18]["estado"], dias[VIERNES_18]["descanso"]) == ("movido", False)
    assert dias[VIERNES_18]["cubierto_por"]["entrenamiento_id"] == adelantada
    assert (dias[VIERNES_25]["estado"], dias[VIERNES_25]["descanso"]) == ("descanso", True)
    assert del_plan(sesion_bd, VIERNES_18) == ("Leg", True)


def test_replanificar_no_lleva_lo_adelantado_a_un_dia_de_la_rutina_oculta(
    cliente, sesion_bd, ppl, grupo_muscular_id
):
    """Caso raro aceptado por el autor: el Leg del viernes se hizo el martes, el
    sábado también toca Leg, y Leg se oculta. Dejar el viernes en descanso pediría
    llevar la sesión al sábado, pero ese día Leg está oculta: 409 y nada cambia. Con
    Leg visible, la sesión pasaría al sábado.
    """
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=VIERNES_18)
    assert planificar(cliente, SABADO_19, ppl["Leg"]).status_code == 200
    ocultar(cliente, ppl["Leg"])

    respuesta = planificar(cliente, VIERNES_18, None)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"] == sin_dia_para_ella(MARTES_15, VIERNES_18, "Leg", adelantada)
    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()
    sesion_bd.expire_all()
    assert [e.fecha for e in sesion_bd.scalars(select(ExcepcionDelPlan))] == [SABADO_19]
