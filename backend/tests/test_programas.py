"""Tests de los programas y sus días: `/programas` y `/programas/{id}/dias/{dia}`.

Lo que más importa aquí es lo que el diseño decidió con cuidado: una rutina se
reutiliza en varios días y en varios programas (no pertenece a ninguno), un día
tiene como mucho una rutina, y ocultar una rutina no la quita de los días que ya
la tenían.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.fechas import hoy
from app.models import Programa, ProgramaDia, ProgramaPeriodo, Rutina, Usuario

# --- Ayudantes -----------------------------------------------------------


def crear_rutina(cliente, nombre="Push") -> int:
    respuesta = cliente.post("/rutinas", json={"nombre": nombre})
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def crear_programa(cliente, nombre="Push Pull Leg", dias=()) -> dict:
    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": nombre,
            "dias": [{"dia_semana": dia, "rutina_id": rutina} for dia, rutina in dias],
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def rutinas_por_dia(programa) -> dict:
    return {dia["dia_semana"]: dia["rutina"]["nombre"] for dia in programa["dias"]}


def ocultar_programa_a_mano(sesion_bd, programa_id):
    """Ocultar un programa por la API llega en el siguiente paso; de momento, a mano."""
    sesion_bd.execute(
        update(Programa).where(Programa.id == programa_id).values(oculto_desde=date(2026, 9, 1))
    )
    sesion_bd.commit()


@pytest.fixture
def otro_usuario_id(sesion_bd) -> int:
    email = "otro@example.com"
    usuario = sesion_bd.scalar(select(Usuario).where(Usuario.email == email))
    if usuario is None:
        usuario = Usuario(nombre="Otro", email=email, password_hash="sin-login")
        sesion_bd.add(usuario)
        sesion_bd.commit()
    return usuario.id


# --- Crear ---------------------------------------------------------------


def test_crear_un_programa_con_sus_dias(cliente):
    push, pull, leg = (
        crear_rutina(cliente, "Push"),
        crear_rutina(cliente, "Pull"),
        crear_rutina(cliente, "Leg"),
    )

    programa = crear_programa(cliente, dias=[(5, leg), (1, push), (3, pull)])

    assert programa["nombre"] == "Push Pull Leg"
    # Ordenados por día, aunque lleguen desordenados. Los que faltan son descanso.
    assert rutinas_por_dia(programa) == {1: "Push", 3: "Pull", 5: "Leg"}
    assert programa["activo"] is False
    assert programa["activo_desde"] is None
    assert programa["oculto_desde"] is None


def test_un_programa_sin_dias_es_toda_la_semana_de_descanso(cliente):
    assert crear_programa(cliente)["dias"] == []


def test_un_dia_no_puede_tener_dos_rutinas(cliente):
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")

    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": "Repetido",
            "dias": [{"dia_semana": 1, "rutina_id": push}, {"dia_semana": 1, "rutina_id": pull}],
        },
    )

    assert respuesta.status_code == 422


@pytest.mark.parametrize("dia", [0, 8])
def test_el_dia_de_la_semana_va_de_1_a_7(cliente, dia):
    push = crear_rutina(cliente)

    respuesta = cliente.post(
        "/programas", json={"nombre": "Mal", "dias": [{"dia_semana": dia, "rutina_id": push}]}
    )

    assert respuesta.status_code == 422


def test_crear_con_una_rutina_oculta_falla_y_no_guarda_nada(cliente):
    """Lo oculto deja de ofrecerse para elegir. Y crear es todo o nada: si una
    rutina falla, no queda un programa a medias.
    """
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    assert cliente.delete(f"/rutinas/{pull}?modo=ocultar").status_code == 204

    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": "PPL",
            "dias": [{"dia_semana": 1, "rutina_id": push}, {"dia_semana": 3, "rutina_id": pull}],
        },
    )

    assert respuesta.status_code == 404
    assert cliente.get("/programas").json() == []


def test_crear_con_una_rutina_de_otro_usuario_da_404(cliente, sesion_bd, otro_usuario_id):
    ajena = Rutina(usuario_id=otro_usuario_id, nombre="De otro")
    sesion_bd.add(ajena)
    sesion_bd.commit()

    respuesta = cliente.post(
        "/programas", json={"nombre": "PPL", "dias": [{"dia_semana": 1, "rutina_id": ajena.id}]}
    )

    assert respuesta.status_code == 404


# --- Reutilizar rutinas --------------------------------------------------


def test_una_rutina_puede_estar_en_varios_dias_y_en_varios_programas(cliente):
    full_body = crear_rutina(cliente, "Full body")

    crear_programa(cliente, "Dos días", dias=[(2, full_body), (4, full_body)])
    crear_programa(cliente, "Tres días", dias=[(1, full_body)])

    [rutina] = cliente.get("/rutinas").json()
    assert rutina["num_programas"] == 2


def test_num_programas_no_cuenta_los_programas_ocultos(cliente, sesion_bd):
    push = crear_rutina(cliente)
    crear_programa(cliente, "Visible", dias=[(1, push)])
    oculto = crear_programa(cliente, "Oculto", dias=[(1, push)])
    ocultar_programa_a_mano(sesion_bd, oculto["id"])

    assert cliente.get(f"/rutinas/{push}").json()["num_programas"] == 1


# --- Leer, editar y los días ---------------------------------------------


def test_listar_separa_los_programas_visibles_de_los_ocultos(cliente, sesion_bd):
    crear_programa(cliente, "Visible")
    oculto = crear_programa(cliente, "Oculto")
    ocultar_programa_a_mano(sesion_bd, oculto["id"])

    visibles = [programa["nombre"] for programa in cliente.get("/programas").json()]
    ocultos = [programa["nombre"] for programa in cliente.get("/programas?ocultos=true").json()]

    assert visibles == ["Visible"]
    assert ocultos == ["Oculto"]
    # Oculto se puede abrir igual: tiene su propia vista.
    assert cliente.get(f"/programas/{oculto['id']}").status_code == 200


def test_cambiar_el_nombre(cliente):
    programa = crear_programa(cliente)

    respuesta = cliente.put(f"/programas/{programa['id']}", json={"nombre": "PPL de 5 días"})

    assert respuesta.json()["nombre"] == "PPL de 5 días"


def test_poner_una_rutina_en_un_dia_de_descanso_y_sustituir_otra(cliente):
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, dias=[(1, push)])
    ruta = f"/programas/{programa['id']}/dias"

    cliente.put(f"{ruta}/3", json={"rutina_id": pull})
    respuesta = cliente.put(f"{ruta}/1", json={"rutina_id": pull})

    assert respuesta.status_code == 200
    assert rutinas_por_dia(respuesta.json()) == {1: "Pull", 3: "Pull"}


def test_quitar_la_rutina_de_un_dia_lo_deja_en_descanso(cliente):
    push = crear_rutina(cliente)
    programa = crear_programa(cliente, dias=[(1, push)])
    ruta = f"/programas/{programa['id']}/dias/1"

    assert cliente.delete(ruta).status_code == 204
    assert cliente.get(f"/programas/{programa['id']}").json()["dias"] == []
    # Ya era descanso: no hay nada que quitar.
    assert cliente.delete(ruta).status_code == 404


def test_un_dia_fuera_de_rango_en_la_ruta_da_422(cliente):
    push = crear_rutina(cliente)
    programa = crear_programa(cliente)

    respuesta = cliente.put(f"/programas/{programa['id']}/dias/8", json={"rutina_id": push})

    assert respuesta.status_code == 422


def test_un_programa_oculto_no_se_puede_editar(cliente, sesion_bd):
    push = crear_rutina(cliente)
    programa = crear_programa(cliente)
    ocultar_programa_a_mano(sesion_bd, programa["id"])
    ruta = f"/programas/{programa['id']}"

    assert cliente.put(ruta, json={"nombre": "Otro"}).status_code == 409
    assert cliente.put(f"{ruta}/dias/1", json={"rutina_id": push}).status_code == 409


def test_un_programa_de_otro_usuario_no_se_ve_ni_se_edita(cliente, sesion_bd, otro_usuario_id):
    ajeno = Programa(usuario_id=otro_usuario_id, nombre="De otro")
    sesion_bd.add(ajeno)
    sesion_bd.commit()

    assert cliente.get(f"/programas/{ajeno.id}").status_code == 404
    assert cliente.put(f"/programas/{ajeno.id}", json={"nombre": "Mío"}).status_code == 403
    assert cliente.get("/programas").json() == []


# --- Las rutinas ocultas o borradas y sus días ---------------------------


def test_ocultar_una_rutina_no_la_quita_de_los_dias_que_la_tienen(cliente):
    """Así ocultar sigue siendo reversible: al volver a mostrarla, el día está
    como estaba. El día la enseña con su fecha de oculta, para pintarla en gris.
    """
    push = crear_rutina(cliente)
    programa = crear_programa(cliente, dias=[(1, push)])

    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    [dia] = cliente.get(f"/programas/{programa['id']}").json()["dias"]
    assert dia["rutina"]["id"] == push
    assert dia["rutina"]["oculto_desde"] is not None


def test_borrar_una_rutina_sin_historial_la_quita_de_sus_dias(cliente):
    """Estar en un programa no bloquea el borrado: el día pasa a descanso."""
    push = crear_rutina(cliente)
    programa = crear_programa(cliente, dias=[(1, push), (4, push)])

    assert cliente.delete(f"/rutinas/{push}").status_code == 204

    assert cliente.get(f"/programas/{programa['id']}").json()["dias"] == []


def test_el_aviso_al_borrar_una_rutina_con_huecos_cuenta_sus_dias(cliente, grupo_muscular_id):
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    push = crear_rutina(cliente)
    cliente.post(
        f"/rutinas/{push}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    )
    crear_programa(cliente, dias=[(1, push), (4, push)])

    respuesta = cliente.delete(f"/rutinas/{push}")

    assert respuesta.status_code == 409
    assert "2 días de programa" in respuesta.json()["detail"]


# --- Activar y desactivar ------------------------------------------------
#
# Qué programa está activo se guarda en periodos de `desde` a `hasta` (sin
# incluirlo). Los escenarios con un periodo que empezó hace días se montan
# insertándolo a mano, porque por la API todo empieza hoy.


def activo_desde_hace(sesion_bd, programa_id, dias) -> None:
    sesion_bd.add(
        ProgramaPeriodo(programa_id=programa_id, usuario_id=1, desde=hoy() - timedelta(days=dias))
    )
    sesion_bd.commit()


def periodos(sesion_bd, programa_id) -> list[tuple]:
    sesion_bd.expire_all()
    return [
        (periodo.desde, periodo.hasta)
        for periodo in sesion_bd.scalars(
            select(ProgramaPeriodo)
            .where(ProgramaPeriodo.programa_id == programa_id)
            .order_by(ProgramaPeriodo.desde)
        )
    ]


def test_crear_un_programa_activo(cliente):
    respuesta = cliente.post("/programas", json={"nombre": "PPL", "activar": True})

    assert respuesta.json()["activo"] is True
    assert respuesta.json()["activo_desde"] == hoy().isoformat()


def test_activar_otro_programa_cierra_hoy_el_periodo_del_anterior(cliente, sesion_bd):
    anterior = crear_programa(cliente, "Anterior")
    activo_desde_hace(sesion_bd, anterior["id"], 30)
    nuevo = crear_programa(cliente, "Nuevo")

    respuesta = cliente.post(f"/programas/{nuevo['id']}/activar")

    assert respuesta.json()["activo_desde"] == hoy().isoformat()
    assert cliente.get(f"/programas/{anterior['id']}").json()["activo"] is False
    # Hoy ya le toca al nuevo: el anterior cubre hasta ayer.
    assert periodos(sesion_bd, anterior["id"]) == [(hoy() - timedelta(days=30), hoy())]


def test_nunca_hay_dos_programas_activos(cliente):
    for nombre in ("A", "B", "C"):
        cliente.post("/programas", json={"nombre": nombre, "activar": True})

    activos = [p["nombre"] for p in cliente.get("/programas").json() if p["activo"]]

    assert activos == ["C"]


def test_activar_y_desactivar_el_mismo_dia_no_deja_rastro(cliente, sesion_bd):
    """Un periodo que no llegó a cubrir ningún día se borra en vez de cerrarse."""
    programa = crear_programa(cliente)

    cliente.post(f"/programas/{programa['id']}/activar")
    respuesta = cliente.post(f"/programas/{programa['id']}/desactivar")

    assert respuesta.json()["activo"] is False
    assert periodos(sesion_bd, programa["id"]) == []


def test_volver_a_activar_el_mismo_dia_reabre_el_periodo(cliente, sesion_bd):
    """Desactivar por error y corregirlo no parte el periodo en dos."""
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 10)

    cliente.post(f"/programas/{programa['id']}/desactivar")
    cliente.post(f"/programas/{programa['id']}/activar")

    assert periodos(sesion_bd, programa["id"]) == [(hoy() - timedelta(days=10), None)]


def test_activar_el_que_ya_esta_activo_no_hace_nada(cliente, sesion_bd):
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 5)

    cliente.post(f"/programas/{programa['id']}/activar")

    assert periodos(sesion_bd, programa["id"]) == [(hoy() - timedelta(days=5), None)]


def test_desactivar_uno_que_no_esta_activo_no_hace_nada(cliente, sesion_bd):
    programa = crear_programa(cliente)

    respuesta = cliente.post(f"/programas/{programa['id']}/desactivar")

    assert respuesta.status_code == 200
    assert periodos(sesion_bd, programa["id"]) == []


def test_un_programa_oculto_no_se_puede_activar(cliente, sesion_bd):
    programa = crear_programa(cliente)
    ocultar_programa_a_mano(sesion_bd, programa["id"])

    assert cliente.post(f"/programas/{programa['id']}/activar").status_code == 409


def test_la_base_de_datos_no_admite_dos_periodos_abiertos_del_mismo_usuario(cliente, sesion_bd):
    """La red por debajo de la comprobación del endpoint: el índice único parcial."""
    uno, otro = crear_programa(cliente, "Uno"), crear_programa(cliente, "Otro")
    activo_desde_hace(sesion_bd, uno["id"], 3)

    sesion_bd.add(ProgramaPeriodo(programa_id=otro["id"], usuario_id=1, desde=hoy()))
    with pytest.raises(IntegrityError):
        sesion_bd.commit()
    sesion_bd.rollback()


def test_activar_un_programa_ajeno_da_403(cliente, sesion_bd, otro_usuario_id):
    ajeno = Programa(usuario_id=otro_usuario_id, nombre="De otro")
    sesion_bd.add(ajeno)
    sesion_bd.commit()

    assert cliente.post(f"/programas/{ajeno.id}/activar").status_code == 403


# --- Ocultar, mostrar y borrar -------------------------------------------


def test_ocultar_el_programa_activo_lo_desactiva_y_mostrarlo_no_lo_reactiva(cliente):
    programa = cliente.post("/programas", json={"nombre": "PPL", "activar": True}).json()
    ruta = f"/programas/{programa['id']}"

    assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 204
    oculto = cliente.get(ruta).json()
    mostrado = cliente.post(f"{ruta}/mostrar").json()

    assert (oculto["activo"], oculto["oculto_desde"]) == (False, hoy().isoformat())
    assert (mostrado["activo"], mostrado["oculto_desde"]) == (False, None)


def test_un_programa_que_nunca_estuvo_activo_se_borra_directo(cliente):
    programa = crear_programa(cliente, dias=[(1, crear_rutina(cliente))])

    assert cliente.delete(f"/programas/{programa['id']}").status_code == 204
    assert cliente.get(f"/programas/{programa['id']}").status_code == 404


def test_borrar_un_programa_que_estuvo_activo_pide_elegir_y_dice_cuando(cliente, sesion_bd):
    """Sus periodos son el historial: sin ellos el calendario no sabe qué tocaba."""
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 20)

    respuesta = cliente.delete(f"/programas/{programa['id']}")

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["periodos"] == [
        {"desde": (hoy() - timedelta(days=20)).isoformat(), "hasta": None}
    ]


def test_borrar_en_definitivo_un_programa_se_lleva_sus_dias_y_periodos(cliente, sesion_bd):
    """Sin passive_deletes en sus dos relaciones, SQLAlchemy intentaría poner a
    NULL la FK de los días y periodos antes de borrarlo, y fallaría con un 500.
    """
    programa = crear_programa(cliente, dias=[(1, crear_rutina(cliente))])
    activo_desde_hace(sesion_bd, programa["id"], 20)

    respuesta = cliente.delete(f"/programas/{programa['id']}?modo=definitivo")

    assert respuesta.status_code == 204
    for tabla in (ProgramaDia, ProgramaPeriodo):
        assert sesion_bd.scalar(select(func.count()).select_from(tabla)) == 0


def test_un_programa_oculto_se_puede_borrar(cliente, sesion_bd):
    programa = crear_programa(cliente)
    ocultar_programa_a_mano(sesion_bd, programa["id"])

    assert cliente.delete(f"/programas/{programa['id']}").status_code == 204
