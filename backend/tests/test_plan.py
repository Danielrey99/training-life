"""Tests de `GET /plan`: qué toca cada día según el programa activo en esa fecha.

La idea que más importa es que cada día se resuelve con el programa que estaba
activo **ese día**: un mes pasado se compara con el plan de entonces, no con el
de hoy. Los periodos que empiezan antes de hoy se insertan a mano, porque por la
API todo empieza hoy.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import select, update

from app.fechas import hoy
from app.models import ExcepcionDelPlan, Programa, ProgramaPeriodo, Rutina, Usuario

HOY = hoy()


def crear_rutina(cliente, nombre) -> int:
    return cliente.post("/rutinas", json={"nombre": nombre}).json()["id"]


def crear_programa(cliente, nombre, dias) -> int:
    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": nombre,
            "dias": [{"dia_semana": dia, "rutina_id": rutina} for dia, rutina in dias],
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def periodo(sesion_bd, programa_id, desde, hasta=None, usuario_id=1) -> None:
    sesion_bd.add(
        ProgramaPeriodo(programa_id=programa_id, usuario_id=usuario_id, desde=desde, hasta=hasta)
    )
    sesion_bd.commit()


def plan(cliente, desde, hasta) -> dict:
    respuesta = cliente.get(
        "/plan", params={"desde": desde.isoformat(), "hasta": hasta.isoformat()}
    )
    assert respuesta.status_code == 200, respuesta.text
    return {dia["fecha"]: dia for dia in respuesta.json()}


def rutina_de(dia) -> str | None:
    return dia["rutina"]["nombre"] if dia["rutina"] else None


def test_sin_programa_activo_no_toca_nada(cliente):
    dias = plan(cliente, HOY, HOY + timedelta(days=6))

    assert len(dias) == 7
    assert {(d["origen"], d["rutina"], d["descanso"]) for d in dias.values()} == {
        ("sin_programa", None, True)
    }


def test_con_un_programa_activo_cada_dia_de_la_semana_toma_su_rutina(cliente):
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, "PPL", [(1, push), (3, pull)])
    cliente.post(f"/programas/{programa}/activar")

    dias = plan(cliente, HOY, HOY + timedelta(days=13))

    for fecha_iso, dia in dias.items():
        esperado = {1: "Push", 3: "Pull"}.get(date.fromisoformat(fecha_iso).isoweekday())
        assert rutina_de(dia) == esperado
        assert dia["descanso"] is (esperado is None)
        assert (dia["origen"], dia["programa_id"]) == ("programa", programa)


def test_un_dia_pasado_se_compara_con_el_programa_de_entonces(cliente, sesion_bd):
    """Hasta hace 10 días estaba activo el viejo (todo Push); desde entonces, el
    nuevo (todo Pull). Antes de hace 20 días no había ninguno.
    """
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    viejo = crear_programa(cliente, "Viejo", [(d, push) for d in range(1, 8)])
    nuevo = crear_programa(cliente, "Nuevo", [(d, pull) for d in range(1, 8)])
    periodo(sesion_bd, viejo, HOY - timedelta(days=20), HOY - timedelta(days=10))
    periodo(sesion_bd, nuevo, HOY - timedelta(days=10))

    dias = plan(cliente, HOY - timedelta(days=25), HOY + timedelta(days=5))

    def en(dias_atras):
        return dias[(HOY - timedelta(days=dias_atras)).isoformat()]

    assert en(21)["origen"] == "sin_programa"
    assert rutina_de(en(20)) == "Push"
    assert rutina_de(en(11)) == "Push"
    # El periodo del viejo no incluye su `hasta`: ese día ya le toca al nuevo.
    assert rutina_de(en(10)) == "Pull"
    assert rutina_de(en(-5)) == "Pull"


def test_una_rutina_oculta_es_descanso_desde_que_se_oculto_pero_no_antes(cliente, sesion_bd):
    push = crear_rutina(cliente, "Push")
    programa = crear_programa(cliente, "Todo Push", [(d, push) for d in range(1, 8)])
    periodo(sesion_bd, programa, HOY - timedelta(days=10))
    sesion_bd.execute(
        update(Rutina).where(Rutina.id == push).values(oculto_desde=HOY - timedelta(days=3))
    )
    sesion_bd.commit()

    dias = plan(cliente, HOY - timedelta(days=5), HOY)
    antes = dias[(HOY - timedelta(days=4)).isoformat()]
    despues = dias[(HOY - timedelta(days=3)).isoformat()]

    assert (rutina_de(antes), antes["descanso"]) == ("Push", False)
    # La rutina viene igual, para pintarla en gris, pero ese día no se entrena.
    assert (rutina_de(despues), despues["descanso"]) == ("Push", True)


def test_un_programa_oculto_sigue_contando_para_los_dias_en_que_estuvo_activo(cliente, sesion_bd):
    push = crear_rutina(cliente, "Push")
    programa = crear_programa(cliente, "Viejo", [(d, push) for d in range(1, 8)])
    periodo(sesion_bd, programa, HOY - timedelta(days=10), HOY - timedelta(days=5))
    sesion_bd.execute(update(Programa).where(Programa.id == programa).values(oculto_desde=HOY))
    sesion_bd.commit()

    dias = plan(cliente, HOY - timedelta(days=7), HOY - timedelta(days=7))

    assert rutina_de(dias[(HOY - timedelta(days=7)).isoformat()]) == "Push"


def test_los_programas_de_otro_usuario_no_cuentan(cliente, sesion_bd):
    # La tabla de usuarios no se vacía entre tests: se reutiliza si ya existe.
    otro = sesion_bd.scalar(select(Usuario).where(Usuario.email == "otro@example.com"))
    if otro is None:
        otro = Usuario(nombre="Otro", email="otro@example.com", password_hash="sin-login")
        sesion_bd.add(otro)
        sesion_bd.flush()
    ajeno = Programa(usuario_id=otro.id, nombre="De otro")
    sesion_bd.add(ajeno)
    sesion_bd.flush()
    periodo(sesion_bd, ajeno.id, HOY - timedelta(days=3), usuario_id=otro.id)

    dias = plan(cliente, HOY, HOY)

    assert dias[HOY.isoformat()]["origen"] == "sin_programa"


def test_el_rango_invertido_da_422(cliente):
    respuesta = cliente.get(
        "/plan", params={"desde": HOY.isoformat(), "hasta": (HOY - timedelta(days=1)).isoformat()}
    )

    assert respuesta.status_code == 422


def test_el_rango_no_puede_pasar_de_400_dias(cliente):
    def pedir(dias):
        return cliente.get(
            "/plan",
            params={
                "desde": HOY.isoformat(),
                "hasta": (HOY + timedelta(days=dias - 1)).isoformat(),
            },
        )

    assert pedir(400).status_code == 200
    assert pedir(401).status_code == 422


# --- Excepciones: días cambiados a mano ----------------------------------


def planificar(cliente, fecha, rutina_id):
    return cliente.put(f"/plan/excepciones/{fecha.isoformat()}", json={"rutina_id": rutina_id})


def excepcion_a_mano(sesion_bd, fecha, rutina_id) -> None:
    """Para días ya pasados, que por la API no se pueden planificar."""
    sesion_bd.add(ExcepcionDelPlan(usuario_id=1, fecha=fecha, rutina_id=rutina_id))
    sesion_bd.commit()


@pytest.fixture
def semana_push(cliente):
    """Un programa activo con Push todos los días, y una rutina Pull suelta."""
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, "Todo Push", [(d, push) for d in range(1, 8)])
    cliente.post(f"/programas/{programa}/activar")
    return {"push": push, "pull": pull, "programa": programa}


def test_un_dia_cambiado_manda_sobre_el_programa(cliente, semana_push):
    manana = HOY + timedelta(days=1)

    assert planificar(cliente, manana, semana_push["pull"]).status_code == 200
    dias = plan(cliente, HOY, manana)

    assert rutina_de(dias[HOY.isoformat()]) == "Push"
    cambiado = dias[manana.isoformat()]
    assert (cambiado["origen"], rutina_de(cambiado)) == ("excepcion", "Pull")
    # Sigue diciendo qué programa estaba activo, aunque ese día no mande.
    assert cambiado["programa_id"] == semana_push["programa"]


def test_un_dia_se_puede_cambiar_a_descanso(cliente, semana_push):
    planificar(cliente, HOY, None)

    dia = plan(cliente, HOY, HOY)[HOY.isoformat()]

    assert (dia["origen"], dia["rutina"], dia["descanso"]) == ("excepcion", None, True)


def test_cambiar_un_dia_otra_vez_lo_sustituye(cliente, semana_push):
    planificar(cliente, HOY, semana_push["pull"])
    planificar(cliente, HOY, None)

    [excepcion] = cliente.get("/plan/excepciones").json()

    assert (excepcion["fecha"], excepcion["rutina"]) == (HOY.isoformat(), None)


def test_elegir_a_mano_la_rutina_de_siempre_deja_el_dia_marcado(cliente, semana_push):
    """No es lo mismo que restablecerlo: queda como cambiado."""
    planificar(cliente, HOY, semana_push["push"])

    assert plan(cliente, HOY, HOY)[HOY.isoformat()]["origen"] == "excepcion"


def test_un_dia_se_puede_cambiar_aunque_no_haya_programa(cliente):
    push = crear_rutina(cliente, "Push")
    planificar(cliente, HOY, push)

    dia = plan(cliente, HOY, HOY)[HOY.isoformat()]

    assert (dia["origen"], rutina_de(dia), dia["programa_id"]) == ("excepcion", "Push", None)


def test_el_pasado_no_se_planifica(cliente, semana_push):
    ayer = HOY - timedelta(days=1)

    assert planificar(cliente, ayer, semana_push["pull"]).status_code == 422
    assert cliente.delete(f"/plan/excepciones/{ayer.isoformat()}").status_code == 422


def test_no_se_puede_planificar_una_rutina_oculta(cliente, semana_push):
    cliente.delete(f"/rutinas/{semana_push['pull']}?modo=ocultar")

    assert planificar(cliente, HOY, semana_push["pull"]).status_code == 404


def test_restablecer_un_dia_lo_devuelve_al_programa(cliente, semana_push):
    planificar(cliente, HOY, semana_push["pull"])
    ruta = f"/plan/excepciones/{HOY.isoformat()}"

    assert cliente.delete(ruta).status_code == 204
    assert plan(cliente, HOY, HOY)[HOY.isoformat()]["origen"] == "programa"
    # Ya no estaba cambiado: no hay nada que restablecer.
    assert cliente.delete(ruta).status_code == 404


def test_restablecer_la_semana_no_toca_los_dias_pasados(cliente, sesion_bd, semana_push):
    ayer = HOY - timedelta(days=1)
    excepcion_a_mano(sesion_bd, ayer, semana_push["pull"])
    for dias in (0, 1, 2):
        planificar(cliente, HOY + timedelta(days=dias), semana_push["pull"])
    fuera = HOY + timedelta(days=10)
    planificar(cliente, fuera, semana_push["pull"])

    respuesta = cliente.delete(
        "/plan/excepciones",
        params={"desde": ayer.isoformat(), "hasta": (HOY + timedelta(days=6)).isoformat()},
    )

    assert respuesta.status_code == 204
    quedan = [excepcion["fecha"] for excepcion in cliente.get("/plan/excepciones").json()]
    assert quedan == [ayer.isoformat(), fuera.isoformat()]


def test_intercambiar_dos_dias_cruza_lo_que_toca_cada_uno(cliente, semana_push):
    """Hoy Push (del programa) y pasado mañana Pull (cambiado): quedan al revés."""
    pasado = HOY + timedelta(days=2)
    planificar(cliente, pasado, semana_push["pull"])

    respuesta = cliente.post(
        "/plan/intercambiar", json={"fecha_a": HOY.isoformat(), "fecha_b": pasado.isoformat()}
    )

    assert respuesta.status_code == 200
    assert [rutina_de(dia) for dia in respuesta.json()] == ["Pull", "Push"]
    dias = plan(cliente, HOY, pasado)
    assert rutina_de(dias[HOY.isoformat()]) == "Pull"
    assert rutina_de(dias[pasado.isoformat()]) == "Push"


def test_intercambiar_con_un_descanso_lo_mueve(cliente, semana_push):
    manana = HOY + timedelta(days=1)
    planificar(cliente, manana, None)

    cliente.post(
        "/plan/intercambiar", json={"fecha_a": HOY.isoformat(), "fecha_b": manana.isoformat()}
    )
    dias = plan(cliente, HOY, manana)

    assert dias[HOY.isoformat()]["descanso"] is True
    assert rutina_de(dias[manana.isoformat()]) == "Push"


def test_intercambiar_pide_dos_dias_distintos_y_de_hoy_en_adelante(cliente, semana_push):
    ayer = HOY - timedelta(days=1)

    def intercambiar(a, b):
        return cliente.post(
            "/plan/intercambiar", json={"fecha_a": a.isoformat(), "fecha_b": b.isoformat()}
        )

    assert intercambiar(HOY, HOY).status_code == 422
    assert intercambiar(ayer, HOY).status_code == 422


def test_activar_otro_programa_quitando_lo_planificado_solo_borra_desde_hoy(
    cliente, sesion_bd, semana_push
):
    ayer = HOY - timedelta(days=1)
    excepcion_a_mano(sesion_bd, ayer, semana_push["pull"])
    planificar(cliente, HOY + timedelta(days=3), semana_push["pull"])
    otro = crear_programa(cliente, "Otro", [])

    cliente.post(f"/programas/{otro}/activar", json={"quitar_excepciones": True})

    quedan = [excepcion["fecha"] for excepcion in cliente.get("/plan/excepciones").json()]
    assert quedan == [ayer.isoformat()]


def test_activar_otro_programa_sin_pedirlo_conserva_lo_planificado(cliente, semana_push):
    planificar(cliente, HOY + timedelta(days=3), semana_push["pull"])
    otro = crear_programa(cliente, "Otro", [])

    cliente.post(f"/programas/{otro}/activar")

    assert len(cliente.get("/plan/excepciones").json()) == 1


def test_borrar_una_rutina_devuelve_sus_dias_planificados_al_programa(cliente, semana_push):
    planificar(cliente, HOY, semana_push["pull"])

    assert cliente.delete(f"/rutinas/{semana_push['pull']}").status_code == 204

    dia = plan(cliente, HOY, HOY)[HOY.isoformat()]
    assert (dia["origen"], rutina_de(dia)) == ("programa", "Push")


def test_el_aviso_al_borrar_una_rutina_con_huecos_cuenta_sus_dias_planificados(
    cliente, grupo_muscular_id, semana_push
):
    ejercicio = cliente.post(
        "/ejercicios", json={"nombre": "Dominadas", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    cliente.post(
        f"/rutinas/{semana_push['pull']}/slots",
        json={
            "ejercicio_principal_id": ejercicio,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    )
    planificar(cliente, HOY, semana_push["pull"])

    respuesta = cliente.delete(f"/rutinas/{semana_push['pull']}")

    assert respuesta.status_code == 409
    assert (
        "está en 1 día planificado a mano, que volvería a lo que diga el programa"
        in (respuesta.json()["detail"])
    )
