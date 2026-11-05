"""Tests de los programas y sus días: `/programas`. Los días se cambian con el *Guardar*
de la semana, `PUT /programas/{id}` con la semana entera.

Lo que más importa aquí es lo que el diseño decidió con cuidado: una rutina se
reutiliza en varios días y en varios programas (no pertenece a ninguno), un día
tiene como mucho una rutina, y ocultar una rutina no la quita de los días que ya
la tenían.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.fechas import hoy
from app.models import ProgramaDia, ProgramaPeriodo
from tests.ayudas import (
    PIDE_MODO,
    cambiar_dias,
    consultas_de,
    crear_programa,
    crear_rutina,
    nombre_repetido,
)
from tests.semana import HOY

# --- Ayudantes -----------------------------------------------------------


def rutinas_por_dia(programa) -> dict:
    return {dia["dia_semana"]: dia["rutina"]["nombre"] for dia in programa["dias"]}


def ocultar_programa(cliente, programa_id):
    assert cliente.delete(f"/programas/{programa_id}?modo=ocultar").status_code == 204


PROGRAMA_OCULTO = "Este programa está oculto. Muéstralo antes de cambiarlo."


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
    assert programa["ultimo_periodo"] is None
    assert programa["oculto_desde"] is None


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
    assert respuesta.json()["detail"][0]["msg"] == (
        "Value error, Hay días repetidos, y un día no puede tener dos rutinas."
    )
    assert cliente.get("/programas").json() == []


@pytest.mark.parametrize("dia", [0, 8])
def test_el_dia_de_la_semana_va_de_1_a_7(cliente, dia):
    push = crear_rutina(cliente)

    respuesta = cliente.post(
        "/programas", json={"nombre": "Mal", "dias": [{"dia_semana": dia, "rutina_id": push}]}
    )

    assert respuesta.status_code == 422
    assert [e["loc"] for e in respuesta.json()["detail"]] == [["body", "dias", 0, "dia_semana"]]
    assert cliente.get("/programas").json() == []


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
    assert respuesta.json()["detail"] == "Esa rutina no existe o está oculta."
    assert cliente.get("/programas").json() == []


# --- Reutilizar rutinas --------------------------------------------------


def test_una_rutina_puede_estar_en_varios_dias_y_en_varios_programas(cliente):
    full_body = crear_rutina(cliente, "Full body")

    crear_programa(cliente, "Dos días", dias=[(2, full_body), (4, full_body)])
    crear_programa(cliente, "Tres días", dias=[(1, full_body)])

    [rutina] = cliente.get("/rutinas").json()
    assert rutina["num_programas"] == 2


def test_num_programas_no_cuenta_los_programas_ocultos(cliente):
    push = crear_rutina(cliente)
    crear_programa(cliente, "Visible", dias=[(1, push)])
    oculto = crear_programa(cliente, "Oculto", dias=[(1, push)])
    ocultar_programa(cliente, oculto["id"])

    assert cliente.get(f"/rutinas/{push}").json()["num_programas"] == 1


# --- Leer, editar y los días ---------------------------------------------


def test_listar_separa_los_programas_visibles_de_los_ocultos(cliente):
    crear_programa(cliente, "Visible")
    oculto = crear_programa(cliente, "Oculto")
    ocultar_programa(cliente, oculto["id"])

    visibles = [programa["nombre"] for programa in cliente.get("/programas").json()]
    ocultos = [programa["nombre"] for programa in cliente.get("/programas?ocultos=true").json()]

    assert visibles == ["Visible"]
    assert ocultos == ["Oculto"]
    # Oculto se puede abrir igual: tiene su propia vista.
    assert cliente.get(f"/programas/{oculto['id']}").status_code == 200


def test_un_programa_oculto_no_se_puede_editar(cliente):
    push = crear_rutina(cliente)
    programa = crear_programa(cliente, dias=[(1, push)])
    ocultar_programa(cliente, programa["id"])
    ruta = f"/programas/{programa['id']}"

    respuestas = [
        cliente.put(ruta, json={"nombre": "Otro"}),
        cliente.put(
            ruta,
            json={
                "nombre": "Push Pull Leg",
                "dias": [{"dia_semana": dia, "rutina_id": push} for dia in (1, 2)],
            },
        ),
        # Dejar un día en descanso también es editar.
        cliente.put(ruta, json={"nombre": "Push Pull Leg", "dias": []}),
    ]

    for respuesta in respuestas:
        assert (respuesta.status_code, respuesta.json()["detail"]) == (409, PROGRAMA_OCULTO)
    guardado = cliente.get(ruta).json()
    assert (guardado["nombre"], rutinas_por_dia(guardado)) == ("Push Pull Leg", {1: "Push"})


def test_asignar_otra_rutina_a_un_dia_con_una_rutina_oculta_la_sustituye(cliente):
    """Un día, una rutina: la nueva sustituye a la oculta, que sigue en la
    biblioteca (oculta) pero pierde ese día.
    """
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, dias=[(6, push)])
    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    respuesta = cambiar_dias(cliente, programa["id"], {6: pull})

    assert respuesta.status_code == 200
    assert rutinas_por_dia(respuesta.json()) == {6: "Pull"}
    assert cliente.get(f"/rutinas/{push}").json()["oculto_desde"] == hoy().isoformat()


# --- Guardar la semana de una vez ------------------------------------------
#
# El *Guardar* de la semana manda el nombre y los siete días en una sola petición
# (`PUT /programas/{id}` con `dias`): todo se valida antes de escribir, así que o se
# guarda todo o nada. Solo se valida lo que cambia.

NO_SE_PUEDE_ELEGIR = "Esa rutina no existe o está oculta."


def guardar_semana(cliente, programa_id, nombre, dias):
    """El PUT con el nombre y la semana entera, cada día `(dia_semana, rutina_id)`."""
    return cliente.put(
        f"/programas/{programa_id}",
        json={
            "nombre": nombre,
            "dias": [{"dia_semana": dia, "rutina_id": rutina} for dia, rutina in dias],
        },
    )


def como_esta(cliente, programa_id) -> tuple[str, dict]:
    programa = cliente.get(f"/programas/{programa_id}").json()
    return programa["nombre"], rutinas_por_dia(programa)


def test_guardar_el_nombre_y_varios_dias_de_una_vez(cliente):
    push, pull, leg = (crear_rutina(cliente, nombre) for nombre in ("Push", "Pull", "Leg"))
    programa = crear_programa(cliente, dias=[(1, push), (3, pull)])["id"]

    # El lunes cambia, el miércoles pasa a descanso y el viernes se estrena.
    respuesta = guardar_semana(cliente, programa, "PPL nuevo", [(1, pull), (5, leg)])

    assert respuesta.status_code == 200, respuesta.text
    assert (respuesta.json()["nombre"], rutinas_por_dia(respuesta.json())) == (
        "PPL nuevo",
        {1: "Pull", 5: "Leg"},
    )
    assert como_esta(cliente, programa) == ("PPL nuevo", {1: "Pull", 5: "Leg"})


@pytest.mark.parametrize("cual", ["oculta", "inexistente"])
def test_una_rutina_que_no_se_puede_elegir_da_404_y_no_guarda_nada(cliente, cual):
    """Los días buenos que van antes que el malo tampoco se guardan, ni el nombre."""
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, dias=[(1, push)])["id"]
    if cual == "oculta":
        mala = crear_rutina(cliente, "Leg")
        assert cliente.delete(f"/rutinas/{mala}?modo=ocultar").status_code == 204
    else:
        mala = 999_999

    respuesta = guardar_semana(cliente, programa, "Otro", [(1, pull), (2, push), (3, mala)])

    assert (respuesta.status_code, respuesta.json()["detail"]) == (404, NO_SE_PUEDE_ELEGIR)
    assert como_esta(cliente, programa) == ("Push Pull Leg", {1: "Push"})


def test_un_nombre_repetido_da_409_y_no_cambia_los_dias(cliente):
    crear_programa(cliente, "Torso pierna")
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, dias=[(1, push)])["id"]

    respuesta = guardar_semana(cliente, programa, "TORSO PIERNA", [(1, pull), (4, push)])

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        nombre_repetido("Ya tienes un programa que se llama «Torso pierna». Elige otro nombre."),
    )
    assert como_esta(cliente, programa) == ("Push Pull Leg", {1: "Push"})


def test_con_una_rutina_oculta_y_el_nombre_repetido_gana_el_404_de_la_rutina(cliente):
    """El 409 del nombre va el último, como al crear el programa."""
    crear_programa(cliente, "Torso pierna")
    push, oculta = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    assert cliente.delete(f"/rutinas/{oculta}?modo=ocultar").status_code == 204
    programa = crear_programa(cliente, dias=[(1, push)])["id"]

    respuesta = guardar_semana(cliente, programa, "Torso pierna", [(1, oculta)])

    assert (respuesta.status_code, respuesta.json()["detail"]) == (404, NO_SE_PUEDE_ELEGIR)
    assert como_esta(cliente, programa) == ("Push Pull Leg", {1: "Push"})


def test_un_dia_que_no_cambia_vale_aunque_su_rutina_este_oculta(cliente):
    """La web manda la semana entera: si un día con una rutina oculta bloqueara el
    guardado, no se podría cambiar ningún otro día sin perder ese.
    """
    push, pull, leg = (crear_rutina(cliente, nombre) for nombre in ("Push", "Pull", "Leg"))
    programa = crear_programa(cliente, dias=[(1, push), (3, pull)])["id"]
    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    respuesta = guardar_semana(cliente, programa, "Push Pull Leg", [(1, push), (3, leg)])

    assert respuesta.status_code == 200, respuesta.text
    assert rutinas_por_dia(respuesta.json()) == {1: "Push", 3: "Leg"}


def test_dias_repetidos_al_guardar_dan_422_y_no_cambian_nada(cliente):
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, dias=[(1, push)])["id"]

    respuesta = guardar_semana(cliente, programa, "Otro", [(2, push), (2, pull)])

    assert respuesta.status_code == 422
    assert [e["msg"] for e in respuesta.json()["detail"]] == [
        "Value error, Hay días repetidos, y un día no puede tener dos rutinas."
    ]
    assert como_esta(cliente, programa) == ("Push Pull Leg", {1: "Push"})


def test_sin_dias_solo_cambia_el_nombre(cliente):
    """Sin `dias` no se tocan; con `dias: []`, la semana entera pasa a descanso."""
    push = crear_rutina(cliente, "Push")
    programa = crear_programa(cliente, dias=[(1, push), (4, push)])["id"]

    respuesta = cliente.put(f"/programas/{programa}", json={"nombre": "Otro", "dias": None})

    assert respuesta.status_code == 200, respuesta.text
    assert como_esta(cliente, programa) == ("Otro", {1: "Push", 4: "Push"})
    assert guardar_semana(cliente, programa, "Otro", []).status_code == 200
    assert como_esta(cliente, programa) == ("Otro", {})


def test_guardar_varios_dias_de_un_programa_que_nunca_estuvo_activo_no_cierra_filas(
    cliente, sesion_bd
):
    """Sin pasado que conservar, cada día que cambia sustituye su fila o la quita."""
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push), (3, push)])["id"]

    respuesta = guardar_semana(cliente, programa, "Push Pull Leg", [(1, leg), (5, leg)])

    assert respuesta.status_code == 200, respuesta.text
    assert {dia: filas_del_dia(sesion_bd, programa, dia) for dia in (1, 3, 5)} == {
        1: [(leg, None, None)],
        3: [],
        5: [(leg, None, None)],
    }


def test_guardar_varios_dias_de_un_programa_activo_los_cambia_desde_hoy(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push), (3, push)])["id"]
    activo_desde_hace(sesion_bd, programa, 14)

    respuesta = guardar_semana(cliente, programa, "Push Pull Leg", [(1, leg), (5, leg)])

    assert respuesta.status_code == 200, respuesta.text
    assert {dia: filas_del_dia(sesion_bd, programa, dia) for dia in (1, 3, 5)} == {
        1: [(push, None, hoy()), (leg, hoy(), None)],
        3: [(push, None, hoy())],
        5: [(leg, hoy(), None)],
    }


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
    assert dia["rutina"]["oculto_desde"] == hoy().isoformat()


def test_borrar_una_rutina_sin_historial_la_quita_de_sus_dias(cliente):
    """Estar en un programa no bloquea el borrado: el día pasa a descanso."""
    push = crear_rutina(cliente)
    programa = crear_programa(cliente, dias=[(1, push), (4, push)])

    assert cliente.delete(f"/rutinas/{push}").status_code == 204

    assert cliente.get(f"/programas/{programa['id']}").json()["dias"] == []


# --- Activar y desactivar ------------------------------------------------
#
# Qué programa está activo se guarda en periodos de `desde` a `hasta` (sin
# incluirlo). Los escenarios con un periodo que empezó hace días se montan
# insertándolo a mano, porque por la API todo empieza hoy.


def activo_desde_hace(sesion_bd, programa_id, dias) -> None:
    sesion_bd.add(
        ProgramaPeriodo(
            programa_id=programa_id,
            desde=hoy() - timedelta(days=dias),
        )
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
    assert respuesta.json()["ultimo_periodo"] == {"desde": hoy().isoformat(), "hasta": None}


def test_activar_otro_programa_cierra_hoy_el_periodo_del_anterior(cliente, sesion_bd):
    anterior = crear_programa(cliente, "Anterior")
    activo_desde_hace(sesion_bd, anterior["id"], 30)
    nuevo = crear_programa(cliente, "Nuevo")

    respuesta = cliente.post(f"/programas/{nuevo['id']}/activar")

    assert respuesta.json()["ultimo_periodo"] == {"desde": hoy().isoformat(), "hasta": None}
    assert cliente.get(f"/programas/{anterior['id']}").json()["activo"] is False
    # Hoy ya le toca al nuevo: el anterior cubre hasta ayer.
    assert periodos(sesion_bd, anterior["id"]) == [(hoy() - timedelta(days=30), hoy())]


def test_nunca_hay_dos_programas_activos(cliente):
    for nombre in ("A", "B", "C"):
        cliente.post("/programas", json={"nombre": nombre, "activar": True})

    activos = [p["nombre"] for p in cliente.get("/programas").json() if p["activo"]]

    assert activos == ["C"]


def test_volver_a_activar_el_mismo_dia_reabre_el_periodo(cliente, sesion_bd):
    """Desactivar por error y corregirlo no parte el periodo en dos: se reabre, en la
    base y en lo que responde cada paso.
    """
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 10)

    desactivado = cliente.post(f"/programas/{programa['id']}/desactivar").json()
    reactivado = cliente.post(f"/programas/{programa['id']}/activar").json()

    assert desactivado["ultimo_periodo"] == periodo(10, 0)
    assert reactivado["ultimo_periodo"] == periodo(10)
    assert periodos(sesion_bd, programa["id"]) == [(hoy() - timedelta(days=10), None)]


def test_activar_el_que_ya_esta_activo_no_hace_nada(cliente, sesion_bd):
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 5)

    cliente.post(f"/programas/{programa['id']}/activar")

    assert periodos(sesion_bd, programa["id"]) == [(hoy() - timedelta(days=5), None)]


def test_desactivar_uno_que_no_esta_activo_no_hace_nada(cliente, sesion_bd):
    """Ni en él ni en el que sí está activo: cerrar "el periodo abierto" sin
    mirar de qué programa es desactivaría el otro.
    """
    activo = crear_programa(cliente, "Activo")
    activo_desde_hace(sesion_bd, activo["id"], 5)
    programa = crear_programa(cliente, "Inactivo")

    respuesta = cliente.post(f"/programas/{programa['id']}/desactivar")

    assert respuesta.status_code == 200
    assert periodos(sesion_bd, programa["id"]) == []
    assert periodos(sesion_bd, activo["id"]) == [(hoy() - timedelta(days=5), None)]


def test_un_programa_oculto_no_se_puede_activar(cliente, sesion_bd):
    programa = crear_programa(cliente)
    ocultar_programa(cliente, programa["id"])

    respuesta = cliente.post(f"/programas/{programa['id']}/activar")

    assert (respuesta.status_code, respuesta.json()["detail"]) == (409, PROGRAMA_OCULTO)
    assert periodos(sesion_bd, programa["id"]) == []


@pytest.mark.parametrize("accion", ["desactivarlo", "activar otro", "ocultarlo"])
def test_un_programa_activo_que_empieza_despues_de_hoy_se_puede_sacar_de_uso(
    cliente, sesion_bd, hoy_es, accion
):
    """Un periodo abierto con `desde` posterior a hoy ya no entra por importar (422),
    pero puede salir de un reloj que va hacia atrás (en el móvil, al cambiar la
    fecha del teléfono): se mete directamente en la base. Desactivar, activar otro u
    ocultar cierran el periodo, y cerrarlo hoy dejaría `hasta < desde`, que viola
    `programa_periodos_rango_check`: antes daba un 500. Como no llegó a cubrir ningún
    día, se borra, igual que uno que empezó hoy.
    """
    hoy_es(HOY)
    ids = {
        nombre: cliente.post("/programas", json={"nombre": nombre}).json()["id"]
        for nombre in ("PPL", "Otro")
    }
    sesion_bd.add(ProgramaPeriodo(programa_id=ids["PPL"], desde=date(2026, 9, 20)))
    sesion_bd.commit()
    ruta = f"/programas/{ids['PPL']}"
    assert cliente.get(ruta).json()["activo"] is True

    peticion, codigo = {
        "desactivarlo": (lambda: cliente.post(f"{ruta}/desactivar"), 200),
        "activar otro": (lambda: cliente.post(f"/programas/{ids['Otro']}/activar"), 200),
        "ocultarlo": (lambda: cliente.delete(f"{ruta}?modo=ocultar"), 204),
    }[accion]

    respuesta = peticion()

    assert respuesta.status_code == codigo, respuesta.text
    assert cliente.get(ruta).json()["activo"] is False
    sesion_bd.expire_all()
    periodos = sesion_bd.execute(
        select(ProgramaPeriodo.programa_id, ProgramaPeriodo.desde, ProgramaPeriodo.hasta)
    ).all()
    esperado = [(ids["Otro"], HOY, None)] if accion == "activar otro" else []
    assert [tuple(p) for p in periodos] == esperado


def test_la_base_de_datos_no_admite_dos_periodos_abiertos(cliente, sesion_bd):
    """La red por debajo de la comprobación del endpoint: el índice único parcial
    `ix_programa_periodos_abierto`, sobre la expresión `(hasta IS NULL)`. Es su
    única red: ningún endpoint deja llegar a dos abiertos.
    """
    uno, otro = crear_programa(cliente, "Uno"), crear_programa(cliente, "Otro")
    activo_desde_hace(sesion_bd, uno["id"], 3)

    sesion_bd.add(ProgramaPeriodo(programa_id=otro["id"], desde=hoy()))
    with pytest.raises(IntegrityError) as error:
        sesion_bd.commit()
    sesion_bd.rollback()
    assert "ix_programa_periodos_abierto" in str(error.value)


# --- Ocultar, mostrar y borrar -------------------------------------------


def test_ocultar_el_programa_activo_lo_desactiva_y_mostrarlo_no_lo_reactiva(cliente):
    programa = cliente.post("/programas", json={"nombre": "PPL", "activar": True}).json()
    ruta = f"/programas/{programa['id']}"

    assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 204
    oculto = cliente.get(ruta).json()
    mostrado = cliente.post(f"{ruta}/mostrar").json()

    assert (oculto["activo"], oculto["oculto_desde"]) == (False, hoy().isoformat())
    assert (mostrado["activo"], mostrado["oculto_desde"]) == (False, None)


def test_ocultar_un_programa_que_no_esta_activo_no_desactiva_el_activo(cliente, sesion_bd):
    """Ocultar el activo lo desactiva; ocultar otro no toca al activo."""
    activo = crear_programa(cliente, "Activo")
    activo_desde_hace(sesion_bd, activo["id"], 5)
    otro = crear_programa(cliente, "Otro")

    ocultar_programa(cliente, otro["id"])

    assert cliente.get(f"/programas/{activo['id']}").json()["activo"] is True
    assert periodos(sesion_bd, activo["id"]) == [(hoy() - timedelta(days=5), None)]


def test_un_programa_que_nunca_estuvo_activo_se_borra_directo(cliente):
    programa = crear_programa(cliente, dias=[(1, crear_rutina(cliente))])

    assert cliente.delete(f"/programas/{programa['id']}").status_code == 204
    assert cliente.get(f"/programas/{programa['id']}").status_code == 404


def test_borrar_en_definitivo_un_programa_se_lleva_sus_dias_y_periodos(cliente, sesion_bd):
    """Test de regresión: daba un 500 (`NotNullViolation` en
    `programa_periodos.programa_id`). El endpoint lee `programa.periodos` para
    decidir si pedir `modo`, y con esa lista ya cargada `passive_deletes=True` no
    basta: SQLAlchemy intentaba poner a NULL la FK de los periodos en vez de
    borrarlos. Se arregló con `cascade="all, delete-orphan"` en las dos relaciones.

    El lunes cambia de rutina antes de borrar: también se van las filas ya cerradas.
    """
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 20)
    assert cambiar_dias(cliente, programa["id"], {1: leg}).status_code == 200
    assert len(filas_del_dia(sesion_bd, programa["id"], 1)) == 2

    respuesta = cliente.delete(f"/programas/{programa['id']}?modo=definitivo")

    assert respuesta.status_code == 204
    for tabla in (ProgramaDia, ProgramaPeriodo):
        assert sesion_bd.scalar(select(func.count()).select_from(tabla)) == 0


def test_un_programa_oculto_se_puede_borrar(cliente):
    programa = crear_programa(cliente)
    ocultar_programa(cliente, programa["id"])

    assert cliente.delete(f"/programas/{programa['id']}").status_code == 204
    assert cliente.get(f"/programas/{programa['id']}").status_code == 404


def test_un_programa_oculto_que_estuvo_activo_sigue_pidiendo_modo_para_borrarlo(cliente, sesion_bd):
    """Estar oculto no quita el historial: sus periodos siguen protegidos."""
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 20)
    ocultar_programa(cliente, programa["id"])
    ruta = f"/programas/{programa['id']}"

    sin_modo = cliente.delete(ruta)
    assert (sin_modo.status_code, sin_modo.json()["detail"]) == (409, PIDE_MODO["programa"])
    assert cliente.delete(f"{ruta}?modo=definitivo").status_code == 204
    assert cliente.get(ruta).status_code == 404


# --- Editar un programa no cambia el pasado ------------------------------
#
# Cada día de programa tiene vigencia: cambiarlo cierra la fila de antes y abre
# otra desde hoy. Se comprueba mirando lo que devuelve /plan/seguimiento para los días
# pasados, que es lo que pinta el calendario.


def rutina_del_dia(cliente, fecha):
    dia = cliente.get(
        "/plan/seguimiento", params={"desde": fecha.isoformat(), "hasta": fecha.isoformat()}
    ).json()[0]
    return dia["rutina"]["nombre"] if dia["rutina"] else None


def mismo_dia_de_la_semana_pasada():
    """Hace una semana: el mismo día de la semana que hoy, ya en el pasado."""
    return hoy() - timedelta(days=7)


def filas_del_dia(sesion_bd, programa_id, dia_semana) -> list[tuple]:
    sesion_bd.expire_all()
    return [
        (fila.rutina_id, fila.desde, fila.hasta)
        for fila in sesion_bd.scalars(
            select(ProgramaDia)
            .where(ProgramaDia.programa_id == programa_id, ProgramaDia.dia_semana == dia_semana)
            .order_by(ProgramaDia.id)
        )
    ]


def test_cambiar_un_dia_de_un_programa_activo_no_cambia_los_dias_pasados(cliente, sesion_bd):
    """El que caza que el plan se resuelva con la plantilla de hoy en vez de con
    la fila vigente cada día.
    """
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    dia = hoy().isoweekday()
    programa = crear_programa(cliente, dias=[(dia, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    assert cambiar_dias(cliente, programa["id"], {dia: leg}).status_code == 200

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) == "Push"
    assert rutina_del_dia(cliente, hoy()) == "Leg"
    assert rutina_del_dia(cliente, hoy() + timedelta(days=7)) == "Leg"


def test_dejar_en_descanso_un_dia_no_cambia_los_dias_pasados(cliente, sesion_bd):
    push = crear_rutina(cliente, "Push")
    dia = hoy().isoweekday()
    programa = crear_programa(cliente, dias=[(dia, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    assert cambiar_dias(cliente, programa["id"], {dia: None}).status_code == 200

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) == "Push"
    assert rutina_del_dia(cliente, hoy()) is None
    # Ya es descanso: quitarlo otra vez no cambia nada, aunque quede su fila cerrada.
    assert cambiar_dias(cliente, programa["id"], {dia: None}).status_code == 200
    assert filas_del_dia(sesion_bd, programa["id"], dia) == [(push, None, hoy())]


def test_anadir_un_dia_no_cambia_los_dias_pasados(cliente, sesion_bd):
    push = crear_rutina(cliente, "Push")
    dia = hoy().isoweekday()
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 14)

    assert cambiar_dias(cliente, programa["id"], {dia: push}).status_code == 200

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) is None
    assert rutina_del_dia(cliente, hoy()) == "Push"


def test_un_programa_que_ya_no_esta_activo_conserva_su_pasado_al_editarlo(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    dia = hoy().isoweekday()
    programa = crear_programa(cliente, dias=[(dia, push)])
    sesion_bd.add(
        ProgramaPeriodo(
            programa_id=programa["id"],
            desde=hoy() - timedelta(days=14),
            hasta=hoy() - timedelta(days=3),
        )
    )
    sesion_bd.commit()

    assert cambiar_dias(cliente, programa["id"], {dia: leg}).status_code == 200

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) == "Push"


def test_cambiar_dos_veces_el_mismo_dia_hoy_no_deja_filas_vacias(cliente, sesion_bd):
    """La fila abierta hoy no llegó a valer para ningún día: se sustituye, no se
    cierra en el mismo día que empezó.
    """
    push, pull, leg = (crear_rutina(cliente, nombre) for nombre in ("Push", "Pull", "Leg"))
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    assert cambiar_dias(cliente, programa["id"], {1: pull}).status_code == 200
    assert cambiar_dias(cliente, programa["id"], {1: leg}).status_code == 200

    assert filas_del_dia(sesion_bd, programa["id"], 1) == [
        (push, None, hoy()),
        (leg, hoy(), None),
    ]


@pytest.mark.parametrize("dia", [1, 3], ids=["la misma rutina", "otra vez descanso"])
def test_un_dia_que_llega_igual_no_parte_el_dia(cliente, sesion_bd, dia):
    """El lunes con Push y el miércoles de descanso llegan como estaban: no se abre ni
    se cierra ninguna fila (antes, quitar otra vez un día de descanso daba 404).
    """
    push = crear_rutina(cliente, "Push")
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    respuesta = cambiar_dias(cliente, programa["id"], {dia: push if dia == 1 else None})

    assert respuesta.status_code == 200, respuesta.text
    assert {d: filas_del_dia(sesion_bd, programa["id"], d) for d in (1, 3)} == {
        1: [(push, None, None)],
        3: [],
    }


def test_el_programa_solo_ensena_sus_dias_vigentes(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push), (3, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    assert cambiar_dias(cliente, programa["id"], {1: leg}).status_code == 200
    assert cambiar_dias(cliente, programa["id"], {3: None}).status_code == 200

    assert rutinas_por_dia(cliente.get(f"/programas/{programa['id']}").json()) == {1: "Leg"}


def test_num_programas_solo_cuenta_dias_vigentes(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    assert cambiar_dias(cliente, programa["id"], {1: leg}).status_code == 200

    assert cliente.get(f"/rutinas/{push}").json()["num_programas"] == 0
    assert cliente.get(f"/rutinas/{leg}").json()["num_programas"] == 1


def test_la_base_no_admite_dos_filas_vigentes_del_mismo_dia(cliente, sesion_bd):
    """Las cerradas sí conviven; dos abiertas del mismo día, no."""
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push)])

    sesion_bd.add(
        ProgramaDia(
            programa_id=programa["id"],
            dia_semana=1,
            rutina_id=leg,
            desde=hoy() - timedelta(days=30),
            hasta=hoy() - timedelta(days=20),
        )
    )
    sesion_bd.commit()
    sesion_bd.add(ProgramaDia(programa_id=programa["id"], dia_semana=1, rutina_id=leg))
    with pytest.raises(IntegrityError) as error:
        sesion_bd.commit()
    sesion_bd.rollback()
    # Que salte el índice que se prueba y no otra restricción.
    assert "ix_programa_dias_programa_dia_abierto" in str(error.value)


# --- El último periodo de uso (lo que pinta la lista de programas) ---------
#
# `ultimo_periodo` es el abierto si está activo; si no, el último que se cerró;
# nulo si nunca se usó. Además de la fecha, le dice a la pantalla del programa
# qué diálogo de borrar enseñar (nulo = se borra directo).


def periodo(desde_hace, hasta_hace=None) -> dict:
    """El periodo como sale en la API, con las fechas contadas en días hacia atrás."""
    hasta = None if hasta_hace is None else (hoy() - timedelta(days=hasta_hace)).isoformat()
    return {"desde": (hoy() - timedelta(days=desde_hace)).isoformat(), "hasta": hasta}


def periodo_cerrado(sesion_bd, programa_id, desde_hace, hasta_hace) -> None:
    sesion_bd.add(
        ProgramaPeriodo(
            programa_id=programa_id,
            desde=hoy() - timedelta(days=desde_hace),
            hasta=hoy() - timedelta(days=hasta_hace),
        )
    )
    sesion_bd.commit()


def test_con_dos_periodos_cerrados_el_ultimo_es_el_mas_reciente(cliente, sesion_bd):
    """El más reciente se inserta primero, con el id más bajo: el último es el de
    `desde` mayor, no el último que se guardó.
    """
    programa = crear_programa(cliente)
    periodo_cerrado(sesion_bd, programa["id"], desde_hace=30, hasta_hace=10)
    periodo_cerrado(sesion_bd, programa["id"], desde_hace=90, hasta_hace=60)

    respuesta = cliente.get(f"/programas/{programa['id']}").json()

    assert respuesta["activo"] is False
    assert respuesta["ultimo_periodo"] == periodo(30, 10)


def test_activar_y_desactivar_el_mismo_dia_no_deja_rastro(cliente, sesion_bd):
    """El periodo que no llegó a cubrir ningún día se borra en vez de cerrarse:
    también tiene que desaparecer de la respuesta del propio desactivar, no solo al
    volver a leerlo.
    """
    programa = crear_programa(cliente)
    activado = cliente.post(f"/programas/{programa['id']}/activar").json()

    desactivado = cliente.post(f"/programas/{programa['id']}/desactivar").json()

    assert activado["ultimo_periodo"] == periodo(0)
    assert (desactivado["activo"], desactivado["ultimo_periodo"]) == (False, None)
    assert cliente.get(f"/programas/{programa['id']}").json()["ultimo_periodo"] is None
    assert periodos(sesion_bd, programa["id"]) == []


def test_ocultar_el_activo_cierra_su_ultimo_periodo_el_dia_en_que_se_oculta(cliente, sesion_bd):
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 10)

    ocultar_programa(cliente, programa["id"])

    assert cliente.get(f"/programas/{programa['id']}").json()["ultimo_periodo"] == periodo(10, 0)


def test_el_ultimo_periodo_sale_en_los_listados_y_en_el_detalle(cliente, sesion_bd):
    """Cada programa con el suyo, y no el de otro: el listado los carga todos de
    una vez y se podrían cruzar.
    """
    activo = cliente.post("/programas", json={"nombre": "A activo", "activar": True}).json()
    usado = crear_programa(cliente, "B usado")
    periodo_cerrado(sesion_bd, usado["id"], desde_hace=40, hasta_hace=20)
    crear_programa(cliente, "C sin usar")
    oculto = crear_programa(cliente, "D oculto")
    periodo_cerrado(sesion_bd, oculto["id"], desde_hace=80, hasta_hace=50)
    ocultar_programa(cliente, oculto["id"])

    visibles = {p["nombre"]: p["ultimo_periodo"] for p in cliente.get("/programas").json()}
    ocultos = cliente.get("/programas", params={"ocultos": True}).json()

    assert visibles == {
        "A activo": periodo(0),
        "B usado": periodo(40, 20),
        "C sin usar": None,
    }
    assert [(p["nombre"], p["ultimo_periodo"]) for p in ocultos] == [("D oculto", periodo(80, 50))]
    for programa, esperado in ((activo, periodo(0)), (usado, periodo(40, 20))):
        detalle = cliente.get(f"/programas/{programa['id']}").json()
        assert detalle["ultimo_periodo"] == esperado


# --- Consultas del listado ------------------------------------------------


def test_listar_programas_hace_las_mismas_consultas_con_uno_que_con_cinco(cliente, sesion_bd):
    """Sin cargarlos por lotes, serializar los periodos, los días y la rutina de
    cada día haría una consulta por programa (y por rutina).
    """

    def programa_completo(numero) -> None:
        rutinas = [crear_rutina(cliente, f"Rutina {numero}-{dia}") for dia in (1, 3)]
        programa = crear_programa(cliente, f"Programa {numero}", dias=zip((1, 3), rutinas))
        periodo_cerrado(sesion_bd, programa["id"], desde_hace=90, hasta_hace=80 - numero)
        periodo_cerrado(sesion_bd, programa["id"], desde_hace=40, hasta_hace=30 + numero)

    programa_completo(1)
    con_uno = consultas_de(lambda: cliente.get("/programas"))
    for numero in range(2, 6):
        programa_completo(numero)
    con_cinco = consultas_de(lambda: cliente.get("/programas"))

    assert len(cliente.get("/programas").json()) == 5
    assert con_cinco == con_uno <= 4
