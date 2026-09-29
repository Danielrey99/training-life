"""Tests de los programas y sus días: `/programas` y `/programas/{id}/dias/{dia}`.

Lo que más importa aquí es lo que el diseño decidió con cuidado: una rutina se
reutiliza en varios días y en varios programas (no pertenece a ninguno), un día
tiene como mucho una rutina, y ocultar una rutina no la quita de los días que ya
la tenían.
"""

from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.fechas import hoy
from app.models import Programa, ProgramaDia, ProgramaPeriodo, Rutina

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


def ocultar_programa(cliente, programa_id):
    assert cliente.delete(f"/programas/{programa_id}?modo=ocultar").status_code == 204


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
    ocultar_programa(cliente, oculto["id"])

    assert cliente.get(f"/rutinas/{push}").json()["num_programas"] == 1


# --- Leer, editar y los días ---------------------------------------------


def test_listar_separa_los_programas_visibles_de_los_ocultos(cliente, sesion_bd):
    crear_programa(cliente, "Visible")
    oculto = crear_programa(cliente, "Oculto")
    ocultar_programa(cliente, oculto["id"])

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


def test_un_programa_oculto_no_se_puede_editar(cliente):
    push = crear_rutina(cliente)
    programa = crear_programa(cliente, dias=[(1, push)])
    ocultar_programa(cliente, programa["id"])
    ruta = f"/programas/{programa['id']}"

    assert cliente.put(ruta, json={"nombre": "Otro"}).status_code == 409
    assert cliente.put(f"{ruta}/dias/2", json={"rutina_id": push}).status_code == 409
    # Dejar un día en descanso también es editar.
    assert cliente.delete(f"{ruta}/dias/1").status_code == 409
    assert rutinas_por_dia(cliente.get(ruta).json()) == {1: "Push"}


def test_no_se_puede_poner_una_rutina_oculta_en_un_dia(cliente):
    """Elegir algo oculto en otro sitio da 404: deja de ofrecerse."""
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, dias=[(1, push)])
    assert cliente.delete(f"/rutinas/{pull}?modo=ocultar").status_code == 204

    respuesta = cliente.put(f"/programas/{programa['id']}/dias/3", json={"rutina_id": pull})

    assert respuesta.status_code == 404
    assert rutinas_por_dia(cliente.get(f"/programas/{programa['id']}").json()) == {1: "Push"}


def test_asignar_otra_rutina_a_un_dia_con_una_rutina_oculta_la_sustituye(cliente):
    """Un día, una rutina: la nueva sustituye a la oculta, que sigue en la
    biblioteca (oculta) pero pierde ese día.
    """
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")
    programa = crear_programa(cliente, dias=[(6, push)])
    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    respuesta = cliente.put(f"/programas/{programa['id']}/dias/6", json={"rutina_id": pull})

    assert respuesta.status_code == 200
    assert rutinas_por_dia(respuesta.json()) == {6: "Pull"}
    assert cliente.get(f"/rutinas/{push}").json()["oculto_desde"] is not None


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
    """Ni en él ni en el que sí está activo: cerrar "el periodo abierto" del
    usuario sin mirar de qué programa es desactivaría el otro.
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
    """Test de regresión: daba un 500 (`NotNullViolation` en
    `programa_periodos.programa_id`). El endpoint lee `programa.periodos` para
    decidir si pedir `modo`, y con esa lista ya cargada `passive_deletes=True` no
    basta: SQLAlchemy intentaba poner a NULL la FK de los periodos en vez de
    borrarlos. Se arregló con `cascade="all, delete-orphan"` en las dos relaciones.
    """
    programa = crear_programa(cliente, dias=[(1, crear_rutina(cliente))])
    activo_desde_hace(sesion_bd, programa["id"], 20)

    respuesta = cliente.delete(f"/programas/{programa['id']}?modo=definitivo")

    assert respuesta.status_code == 204
    for tabla in (ProgramaDia, ProgramaPeriodo):
        assert sesion_bd.scalar(select(func.count()).select_from(tabla)) == 0


def test_un_programa_oculto_se_puede_borrar(cliente):
    programa = crear_programa(cliente)
    ocultar_programa(cliente, programa["id"])

    assert cliente.delete(f"/programas/{programa['id']}").status_code == 204


def test_un_programa_oculto_que_estuvo_activo_sigue_pidiendo_modo_para_borrarlo(cliente, sesion_bd):
    """Estar oculto no quita el historial: sus periodos siguen protegidos."""
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 20)
    ocultar_programa(cliente, programa["id"])
    ruta = f"/programas/{programa['id']}"

    assert cliente.delete(ruta).status_code == 409
    assert cliente.delete(f"{ruta}?modo=definitivo").status_code == 204
    assert cliente.get(ruta).status_code == 404


# --- Editar un programa no cambia el pasado ------------------------------
#
# Cada día de programa tiene vigencia: cambiarlo cierra la fila de antes y abre
# otra desde hoy. Se comprueba mirando lo que devuelve /plan para los días
# pasados, que es lo que pinta el calendario.


def rutina_del_dia(cliente, fecha):
    dia = cliente.get(
        "/plan", params={"desde": fecha.isoformat(), "hasta": fecha.isoformat()}
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
    cliente.post(f"/programas/{programa['id']}/activar")

    cliente.put(f"/programas/{programa['id']}/dias/{dia}", json={"rutina_id": leg})

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) == "Push"
    assert rutina_del_dia(cliente, hoy()) == "Leg"
    assert rutina_del_dia(cliente, hoy() + timedelta(days=7)) == "Leg"


def test_dejar_en_descanso_un_dia_no_cambia_los_dias_pasados(cliente, sesion_bd):
    push = crear_rutina(cliente, "Push")
    dia = hoy().isoweekday()
    programa = crear_programa(cliente, dias=[(dia, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    assert cliente.delete(f"/programas/{programa['id']}/dias/{dia}").status_code == 204

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) == "Push"
    assert rutina_del_dia(cliente, hoy()) is None
    # Ya es descanso: quitarlo otra vez da 404, aunque quede su fila cerrada.
    assert cliente.delete(f"/programas/{programa['id']}/dias/{dia}").status_code == 404


def test_anadir_un_dia_no_cambia_los_dias_pasados(cliente, sesion_bd):
    push = crear_rutina(cliente, "Push")
    dia = hoy().isoweekday()
    programa = crear_programa(cliente)
    activo_desde_hace(sesion_bd, programa["id"], 14)

    cliente.put(f"/programas/{programa['id']}/dias/{dia}", json={"rutina_id": push})

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) is None
    assert rutina_del_dia(cliente, hoy()) == "Push"


def test_un_programa_que_ya_no_esta_activo_conserva_su_pasado_al_editarlo(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    dia = hoy().isoweekday()
    programa = crear_programa(cliente, dias=[(dia, push)])
    sesion_bd.add(
        ProgramaPeriodo(
            programa_id=programa["id"],
            usuario_id=1,
            desde=hoy() - timedelta(days=14),
            hasta=hoy() - timedelta(days=3),
        )
    )
    sesion_bd.commit()

    cliente.put(f"/programas/{programa['id']}/dias/{dia}", json={"rutina_id": leg})

    assert rutina_del_dia(cliente, mismo_dia_de_la_semana_pasada()) == "Push"


def test_editar_un_programa_que_nunca_estuvo_activo_no_guarda_historial(cliente, sesion_bd):
    """Sin pasado que conservar, la fila se sustituye: no se acumulan filas cerradas."""
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push)])

    cliente.put(f"/programas/{programa['id']}/dias/1", json={"rutina_id": leg})

    assert filas_del_dia(sesion_bd, programa["id"], 1) == [(leg, None, None)]


def test_cambiar_dos_veces_el_mismo_dia_hoy_no_deja_filas_vacias(cliente, sesion_bd):
    """La fila abierta hoy no llegó a valer para ningún día: se sustituye, no se
    cierra en el mismo día que empezó.
    """
    push, pull, leg = (crear_rutina(cliente, nombre) for nombre in ("Push", "Pull", "Leg"))
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    cliente.put(f"/programas/{programa['id']}/dias/1", json={"rutina_id": pull})
    cliente.put(f"/programas/{programa['id']}/dias/1", json={"rutina_id": leg})

    assert filas_del_dia(sesion_bd, programa["id"], 1) == [
        (push, None, hoy()),
        (leg, hoy(), None),
    ]


def test_poner_la_misma_rutina_no_parte_el_dia(cliente, sesion_bd):
    push = crear_rutina(cliente, "Push")
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    cliente.put(f"/programas/{programa['id']}/dias/1", json={"rutina_id": push})

    assert filas_del_dia(sesion_bd, programa["id"], 1) == [(push, None, None)]


def test_el_programa_solo_ensena_sus_dias_vigentes(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push), (3, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    cliente.put(f"/programas/{programa['id']}/dias/1", json={"rutina_id": leg})
    cliente.delete(f"/programas/{programa['id']}/dias/3")

    assert rutinas_por_dia(cliente.get(f"/programas/{programa['id']}").json()) == {1: "Leg"}


def test_num_programas_solo_cuenta_dias_vigentes(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)

    cliente.put(f"/programas/{programa['id']}/dias/1", json={"rutina_id": leg})

    assert cliente.get(f"/rutinas/{push}").json()["num_programas"] == 0
    assert cliente.get(f"/rutinas/{leg}").json()["num_programas"] == 1


def test_borrar_en_definitivo_un_programa_se_lleva_tambien_las_filas_viejas(cliente, sesion_bd):
    push, leg = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Leg")
    programa = crear_programa(cliente, dias=[(1, push)])
    activo_desde_hace(sesion_bd, programa["id"], 14)
    cliente.put(f"/programas/{programa['id']}/dias/1", json={"rutina_id": leg})

    assert cliente.delete(f"/programas/{programa['id']}?modo=definitivo").status_code == 204
    assert filas_del_dia(sesion_bd, programa["id"], 1) == []


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
    with pytest.raises(IntegrityError):
        sesion_bd.commit()
    sesion_bd.rollback()
