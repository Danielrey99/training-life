"""Tests de lo que necesita la pantalla de hoy: `GET /plan/hoy`.

En qué situación está el día, la semana, lo que se puede recuperar, lo que se
ofrece entrenar, el próximo entrenamiento y la última sesión. Con `fecha` (un día
pasado) sirve también para la hoja de registrar un día desde el calendario.

Todos parten de la semana de `tests/semana.py`: hoy es el miércoles 16 de
septiembre de 2026, con Push los lunes, Pull los miércoles y Leg los viernes.
"""

from datetime import date

from app.models import Entrenamiento, Rutina, Serie
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

MIERCOLES_9 = date(2026, 9, 9)
JUEVES_10 = date(2026, 9, 10)
VIERNES_11 = date(2026, 9, 11)
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
    return [(o["accion"], o["rutina"]["nombre"], o["fecha"]) for o in resumen["ofrecidas"]]


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
    assert ofrecidas(resumen) == [("intercambiar", "Leg", "2026-09-18")]
    assert resumen["proximo"]["fecha"] == VIERNES_18.isoformat()
    assert resumen["sesion"] is None


def test_con_la_sesion_en_curso_no_se_ofrece_nada(cliente, ppl):
    empezada = sesion(cliente, HOY, ppl["Pull"], cubre_fecha=HOY).json()["id"]

    resumen = hoy(cliente)

    assert resumen["situacion"] == "en_curso"
    assert resumen["sesion"]["entrenamiento_id"] == empezada
    assert resumen["ofrecidas"] == []
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
    assert resumen["ofrecidas"] == []


def test_un_dia_de_descanso_ofrece_adelantar_lo_que_queda_de_semana(cliente, ppl, hoy_es):
    hoy_es(MARTES_15)

    resumen = hoy(cliente)

    assert resumen["situacion"] == "descanso"
    assert ofrecidas(resumen) == [
        ("adelantar", "Pull", "2026-09-16"),
        ("adelantar", "Leg", "2026-09-18"),
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

    assert ofrecidas(hoy(cliente)) == [("adelantar", "Pull", "2026-09-16")]


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
    assert ofrecidas(resumen) == [("sin_contar", "Leg", None), ("sin_contar", "Push", None)]


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
        cliente.post(
            f"/entrenamientos/{recuperada}/series",
            json={"ejercicio_id": otro, "numero_serie": numero, "peso": 20, "repeticiones": 8},
        )

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


def test_un_descanso_pasado_ofrece_lo_de_aquel_dia_y_el_resto_sin_contar(cliente, ppl):
    cliente.post("/rutinas", json={"nombre": "Brazos"})

    resumen = hoy(cliente, MARTES_15)

    assert resumen["situacion"] == "descanso"
    assert [r[:2] for r in recuperables(resumen)] == [
        ("2026-09-09", "Pull"),
        ("2026-09-11", "Leg"),
        ("2026-09-14", "Push"),
    ]
    assert ofrecidas(resumen) == [
        ("adelantar", "Pull", "2026-09-16"),
        ("adelantar", "Leg", "2026-09-18"),
        ("sin_contar", "Brazos", None),
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
    assert ofrecidas(resumen) == [("sin_contar", "Brazos", None)]


def test_un_dia_pasado_con_sesion(cliente, ppl, grupo_muscular_id):
    hecha(cliente, grupo_muscular_id, DOMINGO_13, ppl["Leg"])

    resumen = hoy(cliente, DOMINGO_13)

    assert resumen["situacion"] == "hecho"
    assert resumen["ofrecidas"] == []


def test_una_fecha_futura_da_422(cliente, ppl):
    assert cliente.get("/plan/hoy", params={"fecha": "2026-09-17"}).status_code == 422


# --- Aislamiento ---------------------------------------------------------


def test_lo_de_otro_usuario_ni_se_ofrece_ni_es_la_ultima_sesion(
    cliente, hoy_es, sesion_bd, otro_usuario_id, ejercicio_predefinido_id
):
    hoy_es(HOY)
    cliente.post("/rutinas", json={"nombre": "Push"})
    rutina_ajena = Rutina(usuario_id=otro_usuario_id, nombre="Ajena")
    sesion_bd.add(rutina_ajena)
    sesion_bd.flush()
    ajena = Entrenamiento(usuario_id=otro_usuario_id, rutina_id=rutina_ajena.id, fecha=MARTES_15)
    sesion_bd.add(ajena)
    sesion_bd.flush()
    sesion_bd.add(
        Serie(
            entrenamiento_id=ajena.id,
            ejercicio_id=ejercicio_predefinido_id,
            numero_serie=1,
            peso=50,
            repeticiones=5,
        )
    )
    sesion_bd.commit()

    resumen = hoy(cliente)

    assert ofrecidas(resumen) == [("sin_contar", "Push", None)]
    assert resumen["ultima_sesion"] is None
