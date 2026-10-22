"""Tests del plan: qué toca cada día según el programa activo en esa fecha (se mira
en `GET /plan/seguimiento`), y los días cambiados a mano.

La idea que más importa es que cada día se resuelve con el programa que estaba
activo **ese día**: un mes pasado se compara con el plan de entonces, no con el
de hoy. Los periodos que empiezan antes de hoy se insertan a mano, porque por la
API todo empieza hoy.

Todo el archivo congela el reloj del backend en `HOY`: calcularlo con `hoy()` al
importar el módulo fallaría si la tanda cruzara la medianoche.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import update

from app.models import ExcepcionDelPlan, Programa, ProgramaPeriodo, Rutina
from tests.ayudas import crear_ejercicio, crear_hueco, crear_rutina
from tests.semana import HOY


@pytest.fixture(autouse=True)
def reloj_congelado(hoy_es):
    hoy_es(HOY)


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


def periodo(sesion_bd, programa_id, desde, hasta=None) -> None:
    sesion_bd.add(ProgramaPeriodo(programa_id=programa_id, desde=desde, hasta=hasta))
    sesion_bd.commit()


def plan(cliente, desde, hasta) -> dict:
    """Qué toca cada día del rango, por fecha (lo que trae el seguimiento del plan)."""
    respuesta = cliente.get(
        "/plan/seguimiento", params={"desde": desde.isoformat(), "hasta": hasta.isoformat()}
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
        assert dia["origen"] == "programa"


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


# --- Excepciones: días cambiados a mano ----------------------------------


def planificar(cliente, fecha, rutina_id):
    return cliente.put(f"/plan/excepciones/{fecha.isoformat()}", json={"rutina_id": rutina_id})


def excepcion_a_mano(sesion_bd, fecha, rutina_id) -> None:
    """Para días ya pasados, que por la API no se pueden planificar."""
    sesion_bd.add(ExcepcionDelPlan(fecha=fecha, rutina_id=rutina_id))
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

    assert (dia["origen"], rutina_de(dia)) == ("excepcion", "Push")


def test_el_pasado_no_se_planifica(cliente, sesion_bd, semana_push):
    """Ni cambiar un día pasado ni restablecerlo, aunque esté cambiado: 422 y no se toca."""
    ayer = HOY - timedelta(days=1)
    excepcion_a_mano(sesion_bd, ayer, semana_push["pull"])

    for respuesta in (
        planificar(cliente, ayer, None),
        cliente.delete(f"/plan/excepciones/{ayer.isoformat()}"),
    ):
        assert respuesta.status_code == 422
        assert "ya ha pasado" in respuesta.json()["detail"]
    [excepcion] = cliente.get("/plan/excepciones").json()
    assert (excepcion["fecha"], excepcion["rutina"]["id"]) == (
        ayer.isoformat(),
        semana_push["pull"],
    )


def test_no_se_puede_planificar_una_rutina_oculta(cliente, semana_push):
    assert cliente.delete(f"/rutinas/{semana_push['pull']}?modo=ocultar").status_code == 204

    respuesta = planificar(cliente, HOY, semana_push["pull"])

    assert respuesta.status_code == 404
    assert respuesta.json()["detail"] == f"No existe ninguna rutina con id {semana_push['pull']}"
    assert cliente.get("/plan/excepciones").json() == []


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


def test_restablecer_un_rango_invertido_da_422_y_no_borra_nada(cliente, semana_push):
    """Igual que en el resto de los rangos: un `desde` posterior a `hasta` solo
    puede ser un error de quien llama, y aquí además un borrado silencioso.
    """
    manana = HOY + timedelta(days=1)
    planificar(cliente, manana, semana_push["pull"])

    respuesta = cliente.delete(
        "/plan/excepciones",
        params={"desde": (HOY + timedelta(days=6)).isoformat(), "hasta": HOY.isoformat()},
    )

    assert respuesta.status_code == 422
    assert [e["fecha"] for e in cliente.get("/plan/excepciones").json()] == [manana.isoformat()]


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


# Lo mismo al crear un programa ya activado: `POST /programas` con `activar` acepta
# también `quitar_excepciones`, que hace lo mismo que al activar uno que ya existe.


def crear_activado(cliente, rutina_id, **extra):
    """POST /programas con `activar` y Pull todos los días; devuelve la respuesta."""
    return cliente.post(
        "/programas",
        json={
            "nombre": "Nuevo",
            "activar": True,
            "dias": [{"dia_semana": d, "rutina_id": rutina_id} for d in range(1, 8)],
            **extra,
        },
    )


def fechas_cambiadas(cliente) -> list[str]:
    return [excepcion["fecha"] for excepcion in cliente.get("/plan/excepciones").json()]


def nombres_de_programas(cliente) -> list[str]:
    return sorted(programa["nombre"] for programa in cliente.get("/programas").json())


def test_crear_un_programa_activado_quitando_lo_planificado_solo_borra_desde_hoy(
    cliente, hoy_es, semana_push
):
    """Los días se cambian por la API y luego pasa un día: el que ya ha pasado se
    queda; el de hoy (incluido) y los siguientes desaparecen.
    """
    for dias in (0, 1, 3):
        assert (
            planificar(cliente, HOY + timedelta(days=dias), semana_push["pull"]).status_code == 200
        )
    hoy_es(HOY + timedelta(days=1))

    respuesta = crear_activado(cliente, semana_push["pull"], quitar_excepciones=True)

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["activo"] is True
    assert cliente.get(f"/programas/{semana_push['programa']}").json()["activo"] is False
    assert fechas_cambiadas(cliente) == [HOY.isoformat()]
    # Desde hoy, lo que toca es lo del programa nuevo, no lo cambiado a mano.
    dia = plan(cliente, HOY + timedelta(days=3), HOY + timedelta(days=3))
    assert [(d["origen"], rutina_de(d)) for d in dia.values()] == [("programa", "Pull")]


@pytest.mark.parametrize("extra", [{}, {"quitar_excepciones": False}])
def test_crear_un_programa_activado_sin_pedirlo_conserva_lo_planificado(
    cliente, sesion_bd, semana_push, extra
):
    ayer = HOY - timedelta(days=1)
    excepcion_a_mano(sesion_bd, ayer, semana_push["pull"])
    planificar(cliente, HOY, None)
    planificar(cliente, HOY + timedelta(days=3), semana_push["pull"])

    respuesta = crear_activado(cliente, semana_push["pull"], **extra)

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["activo"] is True
    assert fechas_cambiadas(cliente) == [
        ayer.isoformat(),
        HOY.isoformat(),
        (HOY + timedelta(days=3)).isoformat(),
    ]


@pytest.mark.parametrize("activar", [None, False])
def test_quitar_lo_planificado_sin_activar_da_422_y_no_crea_ni_borra_nada(
    cliente, semana_push, activar
):
    planificar(cliente, HOY + timedelta(days=3), semana_push["pull"])
    cuerpo = {
        "nombre": "Nuevo",
        "dias": [{"dia_semana": 1, "rutina_id": semana_push["pull"]}],
        "quitar_excepciones": True,
    }
    if activar is not None:
        cuerpo["activar"] = activar

    respuesta = cliente.post("/programas", json=cuerpo)

    assert respuesta.status_code == 422
    assert "Solo se quitan los días cambiados a mano al activar el programa" in respuesta.text
    assert nombres_de_programas(cliente) == ["Todo Push"]
    assert cliente.get(f"/programas/{semana_push['programa']}").json()["activo"] is True
    assert fechas_cambiadas(cliente) == [(HOY + timedelta(days=3)).isoformat()]


def test_crear_un_programa_con_una_rutina_inexistente_no_quita_lo_planificado(cliente, semana_push):
    """El 404 de la rutina llega antes de activar nada: ni se crea el programa, ni
    deja de estar activo el anterior, ni se borra ningún día cambiado.
    """
    planificar(cliente, HOY, semana_push["pull"])
    planificar(cliente, HOY + timedelta(days=3), semana_push["pull"])

    respuesta = crear_activado(cliente, 999_999, quitar_excepciones=True)

    assert respuesta.status_code == 404
    assert nombres_de_programas(cliente) == ["Todo Push"]
    assert cliente.get(f"/programas/{semana_push['programa']}").json()["activo"] is True
    assert fechas_cambiadas(cliente) == [HOY.isoformat(), (HOY + timedelta(days=3)).isoformat()]


def test_crear_un_programa_con_una_rutina_oculta_no_quita_lo_planificado(cliente, semana_push):
    planificar(cliente, HOY + timedelta(days=3), semana_push["push"])
    assert cliente.delete(f"/rutinas/{semana_push['pull']}?modo=ocultar").status_code == 204

    respuesta = crear_activado(cliente, semana_push["pull"], quitar_excepciones=True)

    assert respuesta.status_code == 404
    assert nombres_de_programas(cliente) == ["Todo Push"]
    assert fechas_cambiadas(cliente) == [(HOY + timedelta(days=3)).isoformat()]


def test_borrar_una_rutina_devuelve_sus_dias_planificados_al_programa(cliente, semana_push):
    planificar(cliente, HOY, semana_push["pull"])

    assert cliente.delete(f"/rutinas/{semana_push['pull']}").status_code == 204

    dia = plan(cliente, HOY, HOY)[HOY.isoformat()]
    assert (dia["origen"], rutina_de(dia)) == ("programa", "Push")


def test_el_aviso_al_borrar_una_rutina_con_huecos_cuenta_sus_dias_planificados(
    cliente, grupo_muscular_id, semana_push
):
    dominadas = crear_ejercicio(cliente, grupo_muscular_id, "Dominadas")
    crear_hueco(cliente, semana_push["pull"], dominadas)
    assert planificar(cliente, HOY, semana_push["pull"]).status_code == 200

    respuesta = cliente.delete(f"/rutinas/{semana_push['pull']}")

    assert respuesta.status_code == 409
    assert (
        "está en 1 día planificado a mano, que volvería a lo que diga el programa"
        in (respuesta.json()["detail"])
    )


def test_los_dias_planificados_se_pueden_filtrar_por_fechas(cliente, semana_push):
    """Con `desde` = hoy son los que se perderían al activar otro programa."""
    for dias in (0, 2, 5):
        planificar(cliente, HOY + timedelta(days=dias), semana_push["pull"])

    def fechas(**filtros):
        params = {clave: valor.isoformat() for clave, valor in filtros.items()}
        return [e["fecha"] for e in cliente.get("/plan/excepciones", params=params).json()]

    en_medio = [(HOY + timedelta(days=2)).isoformat()]
    assert fechas(desde=HOY + timedelta(days=1), hasta=HOY + timedelta(days=4)) == en_medio
    assert len(fechas(desde=HOY + timedelta(days=1))) == 2
    assert len(fechas(hasta=HOY + timedelta(days=2))) == 2
    respuesta = cliente.get(
        "/plan/excepciones",
        params={"desde": HOY.isoformat(), "hasta": (HOY - timedelta(days=1)).isoformat()},
    )
    assert respuesta.status_code == 422


def test_la_base_de_datos_no_admite_dos_dias_planificados_la_misma_fecha(
    cliente, sesion_bd, semana_push
):
    """La red por debajo del PUT, que sustituye el día en vez de añadir otro: sin
    `excepciones_del_plan_fecha_key`, el plan no sabría cuál de los dos manda.
    """
    from sqlalchemy.exc import IntegrityError

    sesion_bd.add_all(
        [
            ExcepcionDelPlan(fecha=HOY, rutina_id=semana_push["push"]),
            ExcepcionDelPlan(fecha=HOY, rutina_id=None),
        ]
    )
    with pytest.raises(IntegrityError) as error:
        sesion_bd.commit()
    sesion_bd.rollback()
    assert "excepciones_del_plan_fecha_key" in str(error.value)


# --- Bordes y combinaciones con lo oculto --------------------------------


def test_un_periodo_cubre_su_ultimo_dia_aunque_el_rango_empiece_justo_ahi(cliente, sesion_bd):
    """Un rango de un solo día en el último día de un periodo, y otro en su `hasta`:
    el primero es del programa viejo, el segundo ya del nuevo. Así se comprueba
    también el filtro de la consulta, no solo el recorrido día a día.
    """
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    viejo = crear_programa(cliente, "Viejo", [(d, pull) for d in range(1, 8)])
    nuevo = crear_programa(cliente, "Nuevo", [(d, push) for d in range(1, 8)])
    cambio = HOY - timedelta(days=5)
    periodo(sesion_bd, viejo, HOY - timedelta(days=10), cambio)
    periodo(sesion_bd, nuevo, cambio)

    ultimo_del_viejo = cambio - timedelta(days=1)
    dia_viejo = plan(cliente, ultimo_del_viejo, ultimo_del_viejo)[ultimo_del_viejo.isoformat()]
    dia_nuevo = plan(cliente, cambio, cambio)[cambio.isoformat()]
    antes_de_todo = HOY - timedelta(days=11)

    assert (dia_viejo["origen"], rutina_de(dia_viejo)) == ("programa", "Pull")
    assert (dia_nuevo["origen"], rutina_de(dia_nuevo)) == ("programa", "Push")
    assert plan(cliente, antes_de_todo, antes_de_todo)[antes_de_todo.isoformat()]["origen"] == (
        "sin_programa"
    )


def test_ocultar_el_programa_activo_deja_hoy_sin_programa_pero_respeta_lo_planificado(
    cliente, semana_push
):
    """Las excepciones no son del programa: sobreviven a que el programa deje de
    estar activo.
    """
    manana = HOY + timedelta(days=1)
    planificar(cliente, manana, semana_push["pull"])

    cliente.delete(f"/programas/{semana_push['programa']}?modo=ocultar")
    dias = plan(cliente, HOY, manana)

    assert dias[HOY.isoformat()]["origen"] == "sin_programa"
    assert (dias[manana.isoformat()]["origen"], rutina_de(dias[manana.isoformat()])) == (
        "excepcion",
        "Pull",
    )
