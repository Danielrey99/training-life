"""Tests del borrado con historial: `?modo=ocultar` y `?modo=definitivo`.

Es la parte más delicada del backend y donde han aparecido los tres bugs reales
del proyecto, así que es la primera que se cubre.
"""

from sqlalchemy import func, select

from app.fechas import hoy
from app.models import NotaUsuarioEjercicio, Serie

FECHA = "2026-09-04"


# --- Ayudantes para montar escenarios ------------------------------------


def crear_ejercicio(cliente, grupo_muscular_id, nombre="Press banca"):
    respuesta = cliente.post(
        "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    )
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def crear_rutina_con_hueco(cliente, ejercicio_id):
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    slot_id = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    ).json()["id"]
    return rutina_id, slot_id


def registrar_serie(cliente, rutina_id, slot_id, ejercicio_id):
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA}
    ).json()["id"]
    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={
            "ejercicio_id": ejercicio_id,
            "slot_id": slot_id,
            "numero_serie": 1,
            "peso": 60.5,
            "repeticiones": 8,
        },
    )
    assert respuesta.status_code == 201
    return entrenamiento_id


# --- Ejercicio -----------------------------------------------------------


def test_un_ejercicio_sin_usar_se_borra_directo(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    assert cliente.delete(f"/ejercicios/{ejercicio_id}").status_code == 204
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 404


def test_un_ejercicio_en_uso_no_se_borra_sin_modo_y_dice_donde_se_usa(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, _ = crear_rutina_con_hueco(cliente, ejercicio_id)

    respuesta = cliente.delete(f"/ejercicios/{ejercicio_id}")

    assert respuesta.status_code == 409
    usos = respuesta.json()["detail"]["usos"]
    assert usos[0]["rol"] == "principal"
    assert usos[0]["rutina_id"] == rutina_id


def test_ocultar_un_ejercicio_lo_saca_del_listado_pero_se_puede_volver_a_mostrar(
    cliente, grupo_muscular_id
):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    crear_rutina_con_hueco(cliente, ejercicio_id)

    assert cliente.delete(f"/ejercicios/{ejercicio_id}?modo=ocultar").status_code == 204
    assert cliente.get("/ejercicios").json() == []
    assert len(cliente.get("/ejercicios?ocultos=true").json()) == 1

    assert cliente.post(f"/ejercicios/{ejercicio_id}/mostrar").status_code == 200
    assert len(cliente.get("/ejercicios").json()) == 1


def test_ocultar_guarda_desde_cuando_y_mostrar_lo_borra(cliente, grupo_muscular_id):
    """La app enseña "oculto desde el …": esa fecha es la de hoy al ocultar, y
    vuelve a ser nula al mostrar. Igual para ejercicios, rutinas y huecos.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    rutas = [
        (f"/ejercicios/{ejercicio_id}", "/ejercicios?ocultos=true"),
        (f"/rutinas/{rutina_id}", "/rutinas?ocultas=true"),
    ]

    for ruta, listado_de_ocultos in rutas:
        assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 204
        [oculto] = cliente.get(listado_de_ocultos).json()
        assert oculto["oculto_desde"] == hoy().isoformat()

        mostrado = cliente.post(f"{ruta}/mostrar").json()
        assert mostrado["oculto_desde"] is None

    assert cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}?modo=ocultar").status_code == 204
    [hueco] = cliente.get(f"/rutinas/{rutina_id}").json()["slots"]
    assert hueco["oculto_desde"] == hoy().isoformat()


def test_borrar_un_ejercicio_en_definitivo_arrastra_los_huecos_que_lo_usan(
    cliente, grupo_muscular_id
):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, _ = crear_rutina_con_hueco(cliente, ejercicio_id)

    assert cliente.delete(f"/ejercicios/{ejercicio_id}?modo=definitivo").status_code == 204
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 404
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"] == []


def test_borrar_un_ejercicio_en_definitivo_arrastra_tambien_sus_series(cliente, grupo_muscular_id):
    """El 409 promete que `?modo=definitivo` "borra también los huecos,
    comodines y series registradas que lo usan": con series de por medio tiene
    que terminar en 204, no en un error.

    Test de regresión: devolvía un 500 (`ForeignKeyViolation: update or delete
    on table "rutina_slots" violates foreign key constraint
    "series_slot_id_fkey"`). `borrar_ejercicio` marcaba para borrar las series
    antes que los huecos, pero ambas cosas viajaban en el mismo flush y
    SQLAlchemy ordena los DELETE por las relaciones que conoce — y no hay
    ninguna `relationship()` entre Serie y RutinaSlot, así que emitía el DELETE
    del hueco primero. Se arregló con un `db.flush()` entre los dos bucles.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

    respuesta = cliente.delete(f"/ejercicios/{ejercicio_id}?modo=definitivo")

    assert respuesta.status_code == 204, f"esperaba 204, llegó {respuesta.status_code}"
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 404
    # El entrenamiento sobrevive (es historial propio), pero se queda sin series
    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"] == []


# --- Hueco (slot) --------------------------------------------------------


def test_un_hueco_con_series_registradas_no_se_borra_sin_modo(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

    assert cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}").status_code == 409


def test_borrar_en_definitivo_un_hueco_con_series_borra_tambien_las_series(
    cliente, sesion_bd, grupo_muscular_id
):
    """Test de regresión: sin un flush entre borrar las series y borrar el hueco,
    SQLAlchemy mandaba primero el DELETE del hueco y Postgres lo rechazaba (500),
    igual que pasó con los ejercicios.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

    respuesta = cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}?modo=definitivo")

    assert respuesta.status_code == 204
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"] == []
    assert sesion_bd.scalar(select(func.count()).select_from(Serie)) == 0


# --- Rutina: el caso que destapó el bug de passive_deletes ---------------


def test_borrar_en_definitivo_una_rutina_con_entrenamientos_y_series(cliente, grupo_muscular_id):
    """Test de regresión del bug de `passive_deletes`.

    Antes de arreglarlo, este mismo escenario devolvía un 500 (`IntegrityError:
    null value in column "entrenamiento_id"`): SQLAlchemy intentaba desvincular
    las series poniendo su FK a NULL en vez de confiar en el ON DELETE CASCADE.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)

    respuesta = cliente.delete(f"/rutinas/{rutina_id}?modo=definitivo")

    assert respuesta.status_code == 204, f"esperaba 204, llegó {respuesta.status_code}"
    assert cliente.get(f"/rutinas/{rutina_id}").status_code == 404
    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").status_code == 404
    # El ejercicio NO se borra: no era suyo el historial, solo estaba referenciado
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 200


# --- Notas: se van con el ejercicio, pero solo con el suyo ---------------


def crear_nota(cliente, ejercicio_id, texto):
    respuesta = cliente.post(f"/ejercicios/{ejercicio_id}/notas", json={"nota": texto})
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def contar_notas(sesion_bd, ejercicio_id):
    """Cuenta contra la base, no contra la API: tras borrar el ejercicio, sus
    notas ya no son consultables por HTTP aunque siguieran existiendo.
    """
    return sesion_bd.scalar(
        select(func.count())
        .select_from(NotaUsuarioEjercicio)
        .where(NotaUsuarioEjercicio.ejercicio_id == ejercicio_id)
    )


def test_borrar_en_definitivo_un_ejercicio_en_uso_se_lleva_tambien_sus_notas(
    cliente, sesion_bd, grupo_muscular_id
):
    """El ejercicio se usa como principal en un hueco (lo que obliga a
    `?modo=definitivo`) y además está anotado.

    Las notas no bloquean el borrado (su FK es CASCADE, no RESTRICT), pero
    tienen que desaparecer con el ejercicio en vez de quedar huérfanas o
    hacer reventar el borrado.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    crear_rutina_con_hueco(cliente, ejercicio_id)
    crear_nota(cliente, ejercicio_id, "El asiento va en el 4")
    crear_nota(cliente, ejercicio_id, "Mejor con agarre cerrado")

    otro_ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, nombre="Remo")
    crear_nota(cliente, otro_ejercicio_id, "Nota que no debe tocarse")

    # El hueco sí lo bloquea: sin modo, 409. (Las notas por sí solas no
    # bloquean nada: un ejercicio que solo tiene notas se borra directo.)
    assert cliente.delete(f"/ejercicios/{ejercicio_id}").status_code == 409

    respuesta = cliente.delete(f"/ejercicios/{ejercicio_id}?modo=definitivo")

    assert respuesta.status_code == 204, f"esperaba 204, llegó {respuesta.status_code}"
    assert contar_notas(sesion_bd, ejercicio_id) == 0
    # El radio del borrado no se pasa de largo: las notas de otro ejercicio siguen ahí
    assert contar_notas(sesion_bd, otro_ejercicio_id) == 1


def test_ocultar_un_ejercicio_conserva_sus_notas_y_mostrarlo_las_devuelve(
    cliente, sesion_bd, grupo_muscular_id
):
    """`?modo=ocultar` es reversible y no debe perder nada: las notas siguen
    en la base mientras el ejercicio está oculto, y vuelven a ser accesibles
    en cuanto se reactiva.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    crear_rutina_con_hueco(cliente, ejercicio_id)
    crear_nota(cliente, ejercicio_id, "El asiento va en el 4")

    assert cliente.delete(f"/ejercicios/{ejercicio_id}?modo=ocultar").status_code == 204
    assert contar_notas(sesion_bd, ejercicio_id) == 1

    assert cliente.post(f"/ejercicios/{ejercicio_id}/mostrar").status_code == 200
    notas = cliente.get(f"/ejercicios/{ejercicio_id}/notas").json()
    assert [nota["nota"] for nota in notas] == ["El asiento va en el 4"]


def test_el_aviso_de_borrado_dice_cuantas_notas_se_perderian(cliente, grupo_muscular_id):
    """Las notas no bloquean el borrado, pero cuando otra cosa sí lo bloquea,
    el aviso enumera lo que se perdería con `?modo=definitivo` — y las notas
    forman parte de esa cuenta, aunque no sean el motivo del 409.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    crear_rutina_con_hueco(cliente, ejercicio_id)
    crear_nota(cliente, ejercicio_id, "El asiento va en el 4")
    crear_nota(cliente, ejercicio_id, "Mejor con agarre cerrado")

    detalle = cliente.delete(f"/ejercicios/{ejercicio_id}").json()["detail"]

    assert detalle["notas_que_se_perderian"] == 2
    assert "notas" in detalle["mensaje"]


def test_sin_notas_el_aviso_de_borrado_no_las_menciona(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    crear_rutina_con_hueco(cliente, ejercicio_id)

    detalle = cliente.delete(f"/ejercicios/{ejercicio_id}").json()["detail"]

    assert detalle["notas_que_se_perderian"] == 0
    assert "notas" not in detalle["mensaje"]
