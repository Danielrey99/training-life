"""Tests de `GET /plan`: qué toca cada día según el programa activo en esa fecha.

La idea que más importa es que cada día se resuelve con el programa que estaba
activo **ese día**: un mes pasado se compara con el plan de entonces, no con el
de hoy. Los periodos que empiezan antes de hoy se insertan a mano, porque por la
API todo empieza hoy.
"""

from datetime import date, timedelta

from sqlalchemy import select, update

from app.fechas import hoy
from app.models import Programa, ProgramaPeriodo, Rutina, Usuario

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
