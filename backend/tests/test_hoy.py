"""Tests de lo que necesita la pantalla de hoy: `GET /plan/hoy`.

En qué situación está el día, la semana, lo que se puede recuperar, lo que se
ofrece entrenar, el próximo entrenamiento y la última sesión. Con `fecha` (un día
pasado) sirve también para la hoja de registrar un día desde el calendario.

Todos parten de la semana de `tests/semana.py`: hoy es el miércoles 16 de
septiembre de 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
"""

from datetime import date

from tests.ayudas import serie_en
from tests.semana import (
    DOMINGO_13,
    HOY,
    LUNES_7,
    LUNES_14,
    LUNES_21,
    MARTES_15,
    VIERNES_18,
    hecha,
    sesion,
)

VIERNES_4 = date(2026, 9, 4)
MARTES_8 = date(2026, 9, 8)
MIERCOLES_9 = date(2026, 9, 9)
JUEVES_10 = date(2026, 9, 10)
VIERNES_11 = date(2026, 9, 11)
SABADO_19 = date(2026, 9, 19)
DOMINGO_20 = date(2026, 9, 20)


def hoy(cliente, fecha=None) -> dict:
    params = {"fecha": fecha.isoformat()} if fecha else {}
    respuesta = cliente.get("/plan/hoy", params=params)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def recuperables(resumen) -> list[tuple]:
    return [
        (r["fecha"], r["rutina"]["nombre"], r["plazo"], r["se_puede_hoy"])
        for r in resumen["por_recuperar"]
    ]


def ofrecidas(resumen) -> list[tuple]:
    return [
        (o["accion"], o["rutina"]["nombre"], o["fecha"], o["se_puede_hoy"])
        for o in resumen["ofrecidas"]
    ]


def terminada(cliente, entrenamiento_id) -> None:
    respuesta = cliente.post(f"/entrenamientos/{entrenamiento_id}/terminar")
    assert respuesta.status_code == 200, respuesta.text


# --- Situaciones ---------------------------------------------------------


def test_un_dia_de_entrenamiento(cliente, ppl):
    """Toca Pull, y el viernes toca Leg. La semana pasada y el lunes no se entrenó
    nada: del viernes 11 y del lunes 14 aún se está en plazo.
    """
    resumen = hoy(cliente)

    assert resumen["fecha"] == HOY.isoformat()
    assert resumen["situacion"] == "entrenamiento"
    assert [dia["fecha"] for dia in resumen["semana"]] == [f"2026-09-{n}" for n in range(14, 21)]
    # En un día de entrenamiento también se recupera directamente.
    assert recuperables(resumen) == [
        ("2026-09-11", "Leg", "2026-09-17", True),
        ("2026-09-14", "Push", "2026-09-20", True),
    ]
    # Intercambiar solo hasta el domingo: el Push del lunes 21 ya es otra semana.
    assert ofrecidas(resumen) == [("intercambiar", "Leg", "2026-09-18", True)]
    assert resumen["proximo"]["fecha"] == VIERNES_18.isoformat()
    assert resumen["sesion"] is None


def test_con_la_sesion_en_curso_lo_que_queda_de_semana_sale_sin_boton(cliente, ppl):
    empezada = sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY).json()["id"]

    resumen = hoy(cliente)

    assert resumen["situacion"] == "en_curso"
    assert resumen["sesion"]["entrenamiento_id"] == empezada
    # Como recordatorio: siempre adelantar (intercambiar tocaría el plan de hoy).
    assert ofrecidas(resumen) == [("adelantar", "Leg", "2026-09-18", False)]
    # La lista de lo pendiente se enseña, pero sin botón.
    assert recuperables(resumen) == [
        ("2026-09-11", "Leg", "2026-09-17", False),
        ("2026-09-14", "Push", "2026-09-20", False),
    ]


def test_ya_entrenado_hoy_con_otra_rutina_lo_de_hoy_queda_por_recuperar(
    cliente, ppl, grupo_muscular_id
):
    recuperada = hecha(cliente, grupo_muscular_id, HOY, ppl["Push"], cubre_fecha=LUNES_14)
    cliente.post(f"/entrenamientos/{recuperada}/terminar")

    resumen = hoy(cliente)

    assert resumen["situacion"] == "hecho"
    assert recuperables(resumen) == [
        ("2026-09-11", "Leg", "2026-09-17", False),
        ("2026-09-16", "Pull", "2026-09-22", False),
    ]
    assert ofrecidas(resumen) == [("adelantar", "Leg", "2026-09-18", False)]


def test_un_dia_de_descanso_ofrece_adelantar_lo_que_queda_de_semana(cliente, ppl, hoy_es):
    hoy_es(MARTES_15)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "descanso"
    assert ofrecidas(resumen) == [
        ("adelantar", "Pull", "2026-09-16", True),
        ("adelantar", "Leg", "2026-09-18", True),
    ]
    # El Pull del miércoles 9 se recupera hasta hoy mismo.
    assert recuperables(resumen) == [
        ("2026-09-09", "Pull", "2026-09-15", True),
        ("2026-09-11", "Leg", "2026-09-17", True),
        ("2026-09-14", "Push", "2026-09-20", True),
    ]


def test_lo_ya_hecho_esta_semana_no_se_ofrece(cliente, ppl, grupo_muscular_id, hoy_es):
    """El lunes se adelantó el Leg del viernes: el martes solo queda el Pull."""
    hoy_es(LUNES_14)
    hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Leg"], cubre_fecha=VIERNES_18)
    hoy_es(MARTES_15)

    assert ofrecidas(hoy(cliente)) == [("adelantar", "Pull", "2026-09-16", True)]


def test_un_dia_hecho_por_adelantado_se_comporta_como_un_descanso(
    cliente, ppl, grupo_muscular_id, hoy_es
):
    hoy_es(MARTES_15)
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Leg"], cubre_fecha=VIERNES_18)
    hoy_es(VIERNES_18)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "movido"
    viernes = resumen["semana"][4]
    assert viernes["cubierto_por"] == {
        "entrenamiento_id": adelantada,
        "fecha": MARTES_15.isoformat(),
    }
    # Nada más que adelantar esta semana; el Push y el Pull, por recuperar.
    assert resumen["ofrecidas"] == []
    assert [r[:2] for r in recuperables(resumen)] == [
        ("2026-09-14", "Push"),
        ("2026-09-16", "Pull"),
    ]


def test_una_rutina_que_toca_dos_dias_se_ofrece_una_vez_el_primero(cliente, ppl, hoy_es):
    """El sábado también es Leg (planificado a mano): ofrecer dos veces la misma
    rutina no aporta nada, ni al adelantar ni al intercambiar.
    """
    hoy_es(MARTES_15)
    respuesta = cliente.put("/plan/excepciones/2026-09-19", json={"rutina_id": ppl["Leg"]})
    assert respuesta.status_code == 200, respuesta.text

    adelantar = ofrecidas(hoy(cliente))
    hoy_es(HOY)
    intercambiar = ofrecidas(hoy(cliente))

    assert adelantar == [
        ("adelantar", "Pull", "2026-09-16", True),
        ("adelantar", "Leg", "2026-09-18", True),
    ]
    assert intercambiar == [("intercambiar", "Leg", "2026-09-18", True)]


def test_la_primera_vez_sin_rutinas(cliente, hoy_es):
    hoy_es(HOY)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "primera_vez"
    assert resumen["ofrecidas"] == []
    assert resumen["proximo"] is None
    assert resumen["ultima_sesion"] is None


def test_sin_programa_se_ofrecen_todas_las_rutinas_sin_contar(cliente, hoy_es):
    hoy_es(HOY)
    for nombre in ("Push", "Leg"):
        cliente.post("/rutinas", json={"nombre": nombre})

    resumen = hoy(cliente)

    assert resumen["situacion"] == "sin_programa"
    assert ofrecidas(resumen) == [
        ("sin_contar", "Leg", None, True),
        ("sin_contar", "Push", None, True),
    ]


def test_sin_programa_un_descanso_planificado_a_mano_no_cuenta_como_descanso(cliente, ppl):
    """Se planificó hoy como descanso y después se desactivó el programa sin quitar lo
    planificado: sin programa no hay semana que seguir, así que se ofrece todo.
    """
    cliente.put(f"/plan/excepciones/{HOY.isoformat()}", json={"rutina_id": None})
    programa = cliente.get("/programas").json()[0]["id"]
    cliente.post(f"/programas/{programa}/desactivar")

    resumen = hoy(cliente)

    assert resumen["situacion"] == "sin_programa"
    assert [o[0] for o in ofrecidas(resumen)] == ["sin_contar"] * 3


def test_sin_programa_una_rutina_planificada_a_mano_si_se_entrena(cliente, ppl):
    cliente.put(f"/plan/excepciones/{HOY.isoformat()}", json={"rutina_id": ppl["Leg"]})
    programa = cliente.get("/programas").json()[0]["id"]
    cliente.post(f"/programas/{programa}/desactivar")

    resumen = hoy(cliente)

    assert resumen["situacion"] == "entrenamiento"
    assert sesion(cliente, HOY, ppl["Leg"], cubre_fecha=HOY).status_code == 201


# --- Lo que queda de semana, con sesión hoy ------------------------------


def test_hecho_hoy_lo_que_queda_de_semana_sale_sin_boton(cliente, ppl, grupo_muscular_id):
    """Hecho el Pull de hoy: queda el Leg del viernes, como recordatorio. El Push del
    lunes 21 ya es otra semana.
    """
    terminada(cliente, hecha(cliente, grupo_muscular_id, HOY, ppl["Pull"], cubre_fecha=HOY))

    resumen = hoy(cliente)

    assert resumen["situacion"] == "hecho"
    assert ofrecidas(resumen) == [("adelantar", "Leg", "2026-09-18", False)]


def test_un_descanso_en_que_se_adelanto_solo_recuerda_lo_que_falta(
    cliente, ppl, grupo_muscular_id, hoy_es
):
    """El martes se adelantó el Pull del miércoles: el propio Pull ya no sale."""
    hoy_es(MARTES_15)
    adelantada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Pull"], cubre_fecha=HOY)
    terminada(cliente, adelantada)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "hecho"
    assert ofrecidas(resumen) == [("adelantar", "Leg", "2026-09-18", False)]


def test_la_rutina_de_hoy_sigue_pendiente_si_vuelve_a_tocar_esta_semana(
    cliente, ppl, grupo_muscular_id
):
    """El sábado también es Pull (planificado a mano). Sin sesión, intercambiar quita
    la rutina de hoy; el recordatorio no, porque el Pull del sábado sigue sin hacer.
    """
    respuesta = cliente.put(
        f"/plan/excepciones/{SABADO_19.isoformat()}", json={"rutina_id": ppl["Pull"]}
    )
    assert respuesta.status_code == 200, respuesta.text
    terminada(cliente, hecha(cliente, grupo_muscular_id, HOY, ppl["Pull"], cubre_fecha=HOY))

    assert ofrecidas(hoy(cliente)) == [
        ("adelantar", "Leg", "2026-09-18", False),
        ("adelantar", "Pull", "2026-09-19", False),
    ]


def test_un_dia_movido_en_que_se_entreno_recuerda_lo_que_queda(
    cliente, ppl, grupo_muscular_id, hoy_es
):
    """El Pull de hoy se adelantó al martes, y hoy se recupera el Push del lunes."""
    hoy_es(MARTES_15)
    terminada(cliente, hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Pull"], cubre_fecha=HOY))
    hoy_es(HOY)
    assert hoy(cliente)["situacion"] == "movido"
    hecha(cliente, grupo_muscular_id, HOY, ppl["Push"], cubre_fecha=LUNES_14)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "en_curso"
    assert ofrecidas(resumen) == [("adelantar", "Leg", "2026-09-18", False)]


def test_el_domingo_con_sesion_no_queda_nada_de_semana(cliente, ppl, grupo_muscular_id, hoy_es):
    hoy_es(DOMINGO_20)
    hecha(cliente, grupo_muscular_id, DOMINGO_20, ppl["Push"], cubre_fecha=LUNES_14)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "en_curso"
    assert resumen["ofrecidas"] == []


def test_sin_programa_con_sesion_hoy_no_se_recuerda_nada(cliente, ppl, grupo_muscular_id):
    """Sin programa no hay semana que seguir, aunque quede una rutina planificada a
    mano el viernes (que sin sesión tampoco se ofrecería para adelantar).
    """
    respuesta = cliente.put(
        f"/plan/excepciones/{VIERNES_18.isoformat()}", json={"rutina_id": ppl["Leg"]}
    )
    assert respuesta.status_code == 200, respuesta.text
    programa = cliente.get("/programas").json()[0]["id"]
    assert cliente.post(f"/programas/{programa}/desactivar").status_code == 200
    hecha(cliente, grupo_muscular_id, HOY, ppl["Push"])

    resumen = hoy(cliente)

    assert resumen["situacion"] == "en_curso"
    assert resumen["ofrecidas"] == []


def test_la_sesion_de_hoy_cancelada_no_cuenta_y_se_puede_intercambiar(cliente, ppl):
    """Terminada sin series es una sesión cancelada: el día vuelve a estar por hacer
    y la lista vuelve a tener botón.
    """
    cancelada = sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY).json()["id"]
    terminada(cliente, cancelada)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "entrenamiento"
    assert ofrecidas(resumen) == [("intercambiar", "Leg", "2026-09-18", True)]


# --- Por recuperar -------------------------------------------------------


def test_el_ultimo_dia_de_plazo_se_ofrece_y_al_siguiente_ya_no(cliente, ppl, hoy_es):
    """El domingo caduca lo del lunes (la web lo pinta en ámbar cuando `plazo` es
    hoy); el lunes siguiente ya no se ofrece.
    """
    hoy_es(DOMINGO_20)
    assert recuperables(hoy(cliente))[0] == ("2026-09-14", "Push", "2026-09-20", True)

    hoy_es(LUNES_21)
    assert "2026-09-14" not in [r[0] for r in recuperables(hoy(cliente))]


def test_lo_ya_recuperado_no_se_ofrece(cliente, ppl, grupo_muscular_id, hoy_es):
    hoy_es(MARTES_15)
    hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14)
    hoy_es(HOY)

    assert [r[:2] for r in recuperables(hoy(cliente))] == [("2026-09-11", "Leg")]


def test_una_rutina_oculta_no_se_ofrece_para_recuperar(cliente, ppl):
    assert cliente.delete(f"/rutinas/{ppl['Push']}?modo=ocultar").status_code == 204

    assert [r[:2] for r in recuperables(hoy(cliente))] == [("2026-09-11", "Leg")]


def test_lo_que_tocaba_con_el_programa_anterior_no_se_ofrece(cliente, ppl):
    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": "Otro",
            "activar": True,
            "dias": [{"dia_semana": 1, "rutina_id": ppl["Push"]}],
        },
    )
    assert respuesta.status_code == 201

    assert recuperables(hoy(cliente)) == []


# --- Última sesión -------------------------------------------------------


def test_la_ultima_sesion_es_la_anterior_con_algo_apuntado(cliente, ppl, grupo_muscular_id):
    anterior = hecha(cliente, grupo_muscular_id, LUNES_7, ppl["Push"], cubre_fecha=LUNES_7)
    # Cancelada: sin series y de un día pasado.
    sesion(cliente, JUEVES_10, ppl["Pull"])

    ultima = hoy(cliente)["ultima_sesion"]

    assert ultima["entrenamiento_id"] == anterior
    assert ultima["fecha"] == LUNES_7.isoformat()
    assert ultima["rutina"]["nombre"] == "Push"


def test_la_ultima_sesion_trae_sus_cifras_y_el_dia_que_recuperaba(cliente, ppl, grupo_muscular_id):
    recuperada = hecha(cliente, grupo_muscular_id, MARTES_15, ppl["Push"], cubre_fecha=LUNES_14)
    otro = cliente.post(
        "/ejercicios", json={"nombre": "Fondos", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    for numero in (2, 3):
        serie_en(cliente, recuperada, otro, numero=numero, peso=20)

    ultima = hoy(cliente)["ultima_sesion"]

    assert (ultima["series"], ultima["ejercicios"]) == (3, 2)
    assert ultima["cubre_fecha"] == LUNES_14.isoformat()


def test_la_de_hoy_es_la_ultima_cuando_ya_esta_terminada(cliente, ppl, grupo_muscular_id):
    """A medias sale la anterior; terminada, la de hoy (la pantalla de "ya entrenado")."""
    anterior = hecha(cliente, grupo_muscular_id, LUNES_7, ppl["Push"], cubre_fecha=LUNES_7)
    de_hoy = hecha(cliente, grupo_muscular_id, HOY, ppl["Pull"], cubre_fecha=HOY)

    assert hoy(cliente)["ultima_sesion"]["entrenamiento_id"] == anterior

    cliente.post(f"/entrenamientos/{de_hoy}/terminar")

    assert hoy(cliente)["ultima_sesion"]["entrenamiento_id"] == de_hoy


# --- Las rutinas ---------------------------------------------------------


def test_cada_rutina_dice_sus_ejercicios_y_cuando_se_hizo_por_ultima_vez(
    cliente, ppl, grupo_muscular_id
):
    """Los huecos ocultos no cuentan, ni las sesiones canceladas ni las de hoy."""
    ejercicio = cliente.post(
        "/ejercicios", json={"nombre": "Remo", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    huecos = [
        cliente.post(
            f"/rutinas/{ppl['Pull']}/slots",
            json={
                "ejercicio_principal_id": ejercicio,
                "orden": orden,
                "series_objetivo": 3,
                "reps_min": 8,
                "reps_max": 12,
            },
        ).json()["id"]
        for orden in (1, 2, 3)
    ]
    cliente.delete(f"/rutinas/{ppl['Pull']}/slots/{huecos[2]}?modo=ocultar")
    hecha(cliente, grupo_muscular_id, MIERCOLES_9, ppl["Pull"], cubre_fecha=MIERCOLES_9)
    sesion(cliente, VIERNES_11, ppl["Pull"])  # cancelada
    hecha(cliente, grupo_muscular_id, HOY, ppl["Pull"], cubre_fecha=HOY)

    rutinas = {r["nombre"]: r for r in hoy(cliente)["rutinas"]}

    assert list(rutinas) == ["Leg", "Pull", "Push"]
    assert (rutinas["Pull"]["ejercicios"], rutinas["Pull"]["ultima_vez"]) == (
        2,
        MIERCOLES_9.isoformat(),
    )
    assert (rutinas["Push"]["ejercicios"], rutinas["Push"]["ultima_vez"]) == (0, None)


def test_una_rutina_oculta_no_sale_entre_las_rutinas(cliente, ppl):
    cliente.delete(f"/rutinas/{ppl['Leg']}?modo=ocultar")

    assert [r["nombre"] for r in hoy(cliente)["rutinas"]] == ["Pull", "Push"]


# --- Registrar un día pasado ---------------------------------------------


def test_un_descanso_pasado_ofrece_recuperar_y_el_resto_sin_contar_sin_adelantar(cliente, ppl):
    """La hoja de registrar un día pasado es para apuntar de ese día hacia atrás:
    ofrece recuperar lo que estaba en plazo y, el resto, sin contar. Antes ofrecía
    también adelantar el Pull del miércoles y el Leg del viernes, como la pantalla
    de Entrenar; adelantar queda solo para hoy.
    """
    cliente.post("/rutinas", json={"nombre": "Brazos"})

    resumen = hoy(cliente, MARTES_15)

    assert resumen["situacion"] == "descanso"
    assert [r[:2] for r in recuperables(resumen)] == [
        ("2026-09-09", "Pull"),
        ("2026-09-11", "Leg"),
        ("2026-09-14", "Push"),
    ]
    # Pull, Leg y Push ya salen para recuperar: no se repiten sin contar.
    assert ofrecidas(resumen) == [("sin_contar", "Brazos", None, True)]


def test_un_descanso_pasado_sin_nada_por_recuperar_no_adelanta_lo_que_queda(
    cliente, ppl, grupo_muscular_id
):
    """Todo lo anterior al martes 15 está hecho, y quedan el Pull del miércoles y el
    Leg del viernes. Antes salían para adelantar; ahora salen sin contar, como
    cualquier otra rutina.
    """
    for fecha, rutina in ((MIERCOLES_9, "Pull"), (VIERNES_11, "Leg"), (LUNES_14, "Push")):
        hecha(cliente, grupo_muscular_id, fecha, ppl[rutina], cubre_fecha=fecha)

    resumen = hoy(cliente, MARTES_15)

    assert resumen["situacion"] == "descanso"
    assert recuperables(resumen) == []
    assert ofrecidas(resumen) == [
        ("sin_contar", "Leg", None, True),
        ("sin_contar", "Pull", None, True),
        ("sin_contar", "Push", None, True),
    ]


def test_un_dia_pasado_movido_no_adelanta_lo_que_queda(cliente, ppl, grupo_muscular_id):
    """El Pull del miércoles 9 se adelantó al martes 8, y el viernes 11 tocaba Leg.
    Antes, la hoja del miércoles 9 ofrecía adelantar ese Leg; ahora sale sin contar,
    igual que el Pull. El Push del lunes 7 sigue para recuperar.
    """
    # El Leg del viernes 4 hecho, para que no salga entre lo que se recupera.
    hecha(cliente, grupo_muscular_id, VIERNES_4, ppl["Leg"], cubre_fecha=VIERNES_4)
    hecha(cliente, grupo_muscular_id, MARTES_8, ppl["Pull"], cubre_fecha=MIERCOLES_9)

    resumen = hoy(cliente, MIERCOLES_9)

    assert resumen["situacion"] == "movido"
    assert [r[:2] for r in recuperables(resumen)] == [("2026-09-07", "Push")]
    assert ofrecidas(resumen) == [
        ("sin_contar", "Leg", None, True),
        ("sin_contar", "Pull", None, True),
    ]


def test_un_dia_de_entrenamiento_pasado_no_ofrece_intercambiar(cliente, ppl):
    """Intercambiar cambia el plan, y el pasado no se planifica."""
    cliente.post("/rutinas", json={"nombre": "Brazos"})

    resumen = hoy(cliente, LUNES_14)

    assert resumen["situacion"] == "entrenamiento"
    assert [r[:2] for r in recuperables(resumen)] == [
        ("2026-09-09", "Pull"),
        ("2026-09-11", "Leg"),
    ]
    assert ofrecidas(resumen) == [("sin_contar", "Brazos", None, True)]


def test_un_dia_pasado_con_sesion(cliente, ppl, grupo_muscular_id):
    hecha(cliente, grupo_muscular_id, DOMINGO_13, ppl["Leg"])

    resumen = hoy(cliente, DOMINGO_13)

    assert resumen["situacion"] == "hecho"
    assert resumen["ofrecidas"] == []


def test_una_fecha_futura_da_422(cliente, ppl):
    assert cliente.get("/plan/hoy", params={"fecha": "2026-09-17"}).status_code == 422
