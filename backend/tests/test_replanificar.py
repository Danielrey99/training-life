"""Tests de replanificar con días ya hechos por adelantado.

Si el Leg del viernes se hizo el martes y en Planificar se mueve el Leg al sábado,
la sesión del martes pasa a contar el sábado: lo hecho sigue a su rutina. Si el
cambio la dejara sin ningún día de esta semana con su rutina, no se permite (409)
y no se guarda nada. Al editar el programa, en cambio, el día ya hecho se queda
como estaba y el cambio empieza la semana siguiente.

Todos parten de la semana de `tests/semana.py`: hoy es el miércoles 16 de
septiembre de 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
"""

from datetime import date

from sqlalchemy import select

from app.models import Entrenamiento, ProgramaDia, ProgramaPeriodo, Rutina
from tests.semana import HOY, JUEVES_17, LUNES_14, MARTES_15, VIERNES_18, hecha, sesion

SABADO_19 = date(2026, 9, 19)


def planificar(cliente, fecha, rutina_id):
    return cliente.put(f"/plan/excepciones/{fecha.isoformat()}", json={"rutina_id": rutina_id})


def cubre(cliente, entrenamiento_id) -> str | None:
    return cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["cubre_fecha"]


def leg_adelantado(cliente, ppl, grupo_muscular_id) -> int:
    """El Leg del viernes, hecho el martes."""
    return hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=VIERNES_18)


# --- Lo hecho sigue a su rutina ------------------------------------------


def test_al_mover_la_rutina_a_otro_dia_la_sesion_la_sigue(cliente, ppl, grupo_muscular_id):
    adelantada = leg_adelantado(cliente, ppl, grupo_muscular_id)

    assert planificar(cliente, SABADO_19, ppl["Leg"]).status_code == 200
    # El sábado ya toca Leg, pero la sesión sigue contando el viernes.
    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()
    assert planificar(cliente, VIERNES_18, None).status_code == 200

    assert cubre(cliente, adelantada) == SABADO_19.isoformat()
    sabado = cliente.get(
        "/plan/seguimiento", params={"desde": "2026-09-19", "hasta": "2026-09-19"}
    ).json()[0]
    assert sabado["estado"] == "movido"


def test_si_la_rutina_se_queda_sin_dia_no_se_guarda_nada(cliente, ppl, grupo_muscular_id):
    adelantada = leg_adelantado(cliente, ppl, grupo_muscular_id)

    respuesta = planificar(cliente, VIERNES_18, None)

    assert respuesta.status_code == 409
    detalle = respuesta.json()["detail"]
    assert detalle["entrenamiento_id"] == adelantada
    assert detalle["fecha"] == MARTES_15.isoformat()
    assert "Leg" in detalle["mensaje"]
    # Ni la sesión ni el plan cambiaron.
    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()
    assert cliente.get("/plan/excepciones").json() == []


def test_cambiar_hoy_despues_de_entrenar_lleva_la_sesion_a_otro_dia(cliente, ppl):
    """Se empezó el Pull de hoy y después se replanifica hoy como Leg, con otro
    Pull el sábado: la sesión pasa a contar el sábado.
    """
    empezada = sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY).json()["id"]
    assert planificar(cliente, SABADO_19, ppl["Pull"]).status_code == 200

    assert planificar(cliente, HOY, ppl["Leg"]).status_code == 200

    assert cubre(cliente, empezada) == SABADO_19.isoformat()


def test_restablecer_un_dia_reubica_lo_que_contaba(cliente, ppl, grupo_muscular_id):
    """El jueves se cambió a Leg y se adelantó; al restablecerlo, el Leg vuelve a
    ser solo el del viernes, y la sesión pasa a contarlo.
    """
    assert planificar(cliente, JUEVES_17, ppl["Leg"]).status_code == 200
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=JUEVES_17)

    assert cliente.delete(f"/plan/excepciones/{JUEVES_17.isoformat()}").status_code == 204

    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()


def test_restablecer_la_semana_reubica_lo_que_contaba(cliente, ppl, grupo_muscular_id):
    assert planificar(cliente, JUEVES_17, ppl["Leg"]).status_code == 200
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=JUEVES_17)

    respuesta = cliente.delete(
        "/plan/excepciones", params={"desde": LUNES_14.isoformat(), "hasta": "2026-09-20"}
    )

    assert respuesta.status_code == 204
    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()


def test_intercambiar_reubica_lo_que_contaba(cliente, ppl, grupo_muscular_id):
    """Hoy (Pull) se intercambia con el viernes (Leg, ya adelantado): el Leg pasa a
    hoy, y la sesión del martes con él.
    """
    adelantada = leg_adelantado(cliente, ppl, grupo_muscular_id)

    respuesta = cliente.post(
        "/plan/intercambiar",
        json={"fecha_a": HOY.isoformat(), "fecha_b": VIERNES_18.isoformat()},
    )

    assert respuesta.status_code == 200, respuesta.text
    assert cubre(cliente, adelantada) == HOY.isoformat()


def test_dos_adelantos_que_se_intercambian_el_dia(cliente, ppl, grupo_muscular_id):
    """El Push del jueves (cambiado a mano) se hizo el lunes y el Leg del viernes el
    martes. Al intercambiar jueves y viernes, cada sesión pasa al día de la otra.
    """
    assert planificar(cliente, JUEVES_17, ppl["Push"]).status_code == 200
    push = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Push"], cubre_fecha=JUEVES_17)
    leg = leg_adelantado(cliente, ppl, grupo_muscular_id)

    respuesta = cliente.post(
        "/plan/intercambiar",
        json={"fecha_a": JUEVES_17.isoformat(), "fecha_b": VIERNES_18.isoformat()},
    )

    assert respuesta.status_code == 200, respuesta.text
    assert cubre(cliente, push) == VIERNES_18.isoformat()
    assert cubre(cliente, leg) == JUEVES_17.isoformat()


def test_cambiar_un_dia_que_ya_estaba_cambiado_a_mano(cliente, ppl, grupo_muscular_id):
    """El jueves se cambió a Leg y se adelantó; cambiarlo ahora a Push deja el Leg
    solo en el viernes, y la sesión pasa a contarlo.
    """
    assert planificar(cliente, JUEVES_17, ppl["Leg"]).status_code == 200
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=JUEVES_17)

    assert planificar(cliente, JUEVES_17, ppl["Push"]).status_code == 200

    assert cubre(cliente, adelantada) == VIERNES_18.isoformat()


def test_no_va_a_un_dia_que_ya_cuenta_otra_sesion(cliente, ppl, grupo_muscular_id):
    """Leg el viernes, el sábado y el domingo, y los dos primeros ya adelantados:
    al quitar el del viernes, su sesión pasa al domingo, no al sábado.
    """
    domingo = date(2026, 9, 20)
    for dia in (SABADO_19, domingo):
        assert planificar(cliente, dia, ppl["Leg"]).status_code == 200
    viernes = leg_adelantado(cliente, ppl, grupo_muscular_id)
    sabado = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Leg"], cubre_fecha=SABADO_19)

    assert planificar(cliente, VIERNES_18, None).status_code == 200

    assert cubre(cliente, viernes) == domingo.isoformat()
    assert cubre(cliente, sabado) == SABADO_19.isoformat()


# --- Editar el programa ---------------------------------------------------
#
# Cambiar la rutina de un día de la semana en el programa no mueve lo hecho por
# adelantado: ese día se queda como estaba, y el cambio empieza al día siguiente.

VIERNES_25 = date(2026, 9, 25)


def programa_id(cliente) -> int:
    return cliente.get("/programas").json()[0]["id"]


def rutinas_del_plan(cliente, desde, hasta) -> dict:
    dias = cliente.get(
        "/plan/seguimiento", params={"desde": desde.isoformat(), "hasta": hasta.isoformat()}
    ).json()
    return {
        dia["fecha"]: (dia["rutina"]["nombre"] if dia["rutina"] else None, dia["estado"])
        for dia in dias
    }


def test_cambiar_un_dia_del_programa_ya_adelantado_empieza_la_semana_siguiente(
    cliente, ppl, grupo_muscular_id
):
    leg_adelantado(cliente, ppl, grupo_muscular_id)

    respuesta = cliente.put(
        f"/programas/{programa_id(cliente)}/dias/5", json={"rutina_id": ppl["Push"]}
    )

    assert respuesta.status_code == 200, respuesta.text
    plan = rutinas_del_plan(cliente, VIERNES_18, VIERNES_25)
    assert plan["2026-09-18"] == ("Leg", "movido")
    assert plan["2026-09-25"] == ("Push", "proximo")


def test_sin_nada_adelantado_el_cambio_empieza_hoy_mismo(cliente, ppl):
    cliente.put(f"/programas/{programa_id(cliente)}/dias/5", json={"rutina_id": ppl["Push"]})

    assert rutinas_del_plan(cliente, VIERNES_18, VIERNES_18)["2026-09-18"] == (
        "Push",
        "proximo",
    )


def test_dejar_en_descanso_un_dia_ya_adelantado_tambien_lo_respeta(cliente, ppl, grupo_muscular_id):
    leg_adelantado(cliente, ppl, grupo_muscular_id)

    respuesta = cliente.delete(f"/programas/{programa_id(cliente)}/dias/5")

    assert respuesta.status_code == 204
    plan = rutinas_del_plan(cliente, VIERNES_18, VIERNES_25)
    assert plan["2026-09-18"] == ("Leg", "movido")
    assert plan["2026-09-25"] == (None, "descanso")


def test_cambiar_el_dia_de_hoy_despues_de_entrenar_lo_deja_como_estaba(cliente, ppl):
    """Hoy se empezó el Pull; pasar los miércoles a Leg empieza el miércoles 23."""
    sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY)

    cliente.put(f"/programas/{programa_id(cliente)}/dias/3", json={"rutina_id": ppl["Leg"]})

    plan = rutinas_del_plan(cliente, HOY, date(2026, 9, 23))
    assert plan["2026-09-16"] == ("Pull", "hecho")
    assert plan["2026-09-23"] == ("Leg", "proximo")


def test_con_el_dia_cambiado_a_mano_el_programa_cambia_desde_hoy(
    cliente, ppl, grupo_muscular_id, sesion_bd
):
    """El viernes lo decide una excepción de Planificar, no el programa: cambiar el
    programa no le afecta, así que no hay por qué esperar al viernes siguiente. El
    plan que se ve es el mismo; lo que cambia es desde cuándo vale la fila nueva.
    """
    assert planificar(cliente, VIERNES_18, ppl["Leg"]).status_code == 200
    leg_adelantado(cliente, ppl, grupo_muscular_id)
    id_ = programa_id(cliente)

    cliente.put(f"/programas/{id_}/dias/5", json={"rutina_id": ppl["Push"]})

    assert rutinas_del_plan(cliente, VIERNES_18, VIERNES_18)["2026-09-18"] == ("Leg", "movido")
    vigente = sesion_bd.scalar(
        select(ProgramaDia).where(
            ProgramaDia.programa_id == id_,
            ProgramaDia.dia_semana == 5,
            ProgramaDia.hasta.is_(None),
        )
    )
    assert (vigente.rutina_id, vigente.desde) == (ppl["Push"], HOY)


def test_editar_otro_programa_no_mira_lo_adelantado_del_activo(
    cliente, ppl, grupo_muscular_id, sesion_bd
):
    """El viernes adelantado es del programa activo: editar otro, que estuvo activo
    en agosto, cambia desde hoy.
    """
    leg_adelantado(cliente, ppl, grupo_muscular_id)
    otro = cliente.post(
        "/programas",
        json={"nombre": "Viejo", "dias": [{"dia_semana": 5, "rutina_id": ppl["Leg"]}]},
    ).json()["id"]
    sesion_bd.add(
        ProgramaPeriodo(
            programa_id=otro, usuario_id=1, desde=date(2026, 8, 1), hasta=date(2026, 8, 31)
        )
    )
    sesion_bd.commit()

    cliente.put(f"/programas/{otro}/dias/5", json={"rutina_id": ppl["Push"]})

    vigente = sesion_bd.scalar(
        select(ProgramaDia).where(
            ProgramaDia.programa_id == otro,
            ProgramaDia.dia_semana == 5,
            ProgramaDia.hasta.is_(None),
        )
    )
    assert (vigente.rutina_id, vigente.desde) == (ppl["Push"], HOY)


# --- Lo que no se reubica ------------------------------------------------


def test_una_sesion_que_ya_no_contaba_no_se_mueve(cliente, ppl, grupo_muscular_id, sesion_bd):
    """Un Push que dice contar el viernes (Leg) no lo contaba: dejar el viernes en
    descanso no le afecta, ni da 409.
    """
    push = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Push"])
    sesion_bd.get(Entrenamiento, push).cubre_fecha = VIERNES_18
    sesion_bd.commit()

    assert planificar(cliente, VIERNES_18, None).status_code == 200
    assert cubre(cliente, push) == VIERNES_18.isoformat()


def test_una_sesion_cancelada_ni_se_mueve_ni_estorba(cliente, ppl, grupo_muscular_id, sesion_bd):
    """La cancelada del lunes retenía el sábado: se borra cuando el sábado le hace
    falta a la que sí contaba. Y la que no cuenta nada no da 409.
    """
    adelantada = leg_adelantado(cliente, ppl, grupo_muscular_id)
    cancelada = sesion(cliente, LUNES_14, ppl["Leg"]).json()["id"]
    sesion_bd.get(Entrenamiento, cancelada).cubre_fecha = SABADO_19
    sesion_bd.commit()
    assert planificar(cliente, SABADO_19, ppl["Leg"]).status_code == 200

    assert planificar(cliente, VIERNES_18, None).status_code == 200

    assert cubre(cliente, adelantada) == SABADO_19.isoformat()
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 404


# --- Aislamiento ---------------------------------------------------------


def test_lo_de_otro_usuario_no_se_toca(cliente, ppl, grupo_muscular_id, sesion_bd, otro_usuario_id):
    """La sesión ajena que cuenta el sábado de su propio plan no se suelta cuando
    la nuestra pasa a contar nuestro sábado.
    """
    rutina_ajena = Rutina(usuario_id=otro_usuario_id, nombre="Leg")
    sesion_bd.add(rutina_ajena)
    sesion_bd.flush()
    ajena = Entrenamiento(
        usuario_id=otro_usuario_id, rutina_id=rutina_ajena.id, fecha=HOY, cubre_fecha=SABADO_19
    )
    sesion_bd.add(ajena)
    sesion_bd.commit()
    adelantada = leg_adelantado(cliente, ppl, grupo_muscular_id)
    assert planificar(cliente, SABADO_19, ppl["Leg"]).status_code == 200

    assert planificar(cliente, VIERNES_18, None).status_code == 200

    assert cubre(cliente, adelantada) == SABADO_19.isoformat()
    sesion_bd.expire_all()
    assert sesion_bd.get(Entrenamiento, ajena.id).cubre_fecha == SABADO_19
