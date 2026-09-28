"""Tests del borrado con historial: `?modo=ocultar` y `?modo=definitivo`.

Es la parte más delicada del backend y donde han aparecido los tres bugs reales
del proyecto, así que es la primera que se cubre.
"""

from datetime import date, timedelta

from sqlalchemy import func, select, update

from app.fechas import hoy
from app.models import Ejercicio, NotaUsuarioEjercicio, Serie

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

    def ids(ruta):
        return [ejercicio["id"] for ejercicio in cliente.get(ruta).json()]

    assert cliente.delete(f"/ejercicios/{ejercicio_id}?modo=ocultar").status_code == 204
    assert ejercicio_id not in ids("/ejercicios")
    assert ids("/ejercicios?ocultos=true") == [ejercicio_id]

    assert cliente.post(f"/ejercicios/{ejercicio_id}/mostrar").status_code == 200
    assert ejercicio_id in ids("/ejercicios")


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


# --- Lo oculto: se puede abrir, borrar y mostrar, pero no editar ---------
#
# Cada cosa oculta tiene su vista "está oculta", con Mostrar y Borrar. Para eso
# tiene que poder abrirse (GET por id), borrarse y mostrarse; lo que no se puede
# es editarla o usarla sin mostrarla antes (409, no 404: el GET sí la devuelve).


def ocultar(cliente, ruta):
    assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 204


def test_un_ejercicio_y_una_rutina_ocultos_se_pueden_abrir(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, _ = crear_rutina_con_hueco(cliente, ejercicio_id)
    ocultar(cliente, f"/ejercicios/{ejercicio_id}")
    ocultar(cliente, f"/rutinas/{rutina_id}")

    for ruta in (f"/ejercicios/{ejercicio_id}", f"/rutinas/{rutina_id}"):
        respuesta = cliente.get(ruta)
        assert respuesta.status_code == 200
        assert respuesta.json()["oculto_desde"] == hoy().isoformat()


def test_las_notas_de_un_ejercicio_oculto_se_pueden_leer_y_escribir(cliente, grupo_muscular_id):
    """Las notas no usan el ejercicio: son del usuario, y un buen sitio para
    apuntar por qué se ocultó.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    ruta = f"/ejercicios/{ejercicio_id}/notas"
    vieja_id = cliente.post(ruta, json={"nota": "Codos pegados"}).json()["id"]
    ocultar(cliente, f"/ejercicios/{ejercicio_id}")

    nueva = cliente.post(ruta, json={"nota": "Oculto: me molesta el hombro"})
    editada = cliente.put(f"{ruta}/{nueva.json()['id']}", json={"nota": "Oculto por el hombro"})
    borrada = cliente.delete(f"{ruta}/{vieja_id}")

    assert (nueva.status_code, editada.status_code, borrada.status_code) == (201, 200, 204)
    assert [nota["nota"] for nota in cliente.get(ruta).json()] == ["Oculto por el hombro"]


def test_editar_algo_oculto_da_409(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(
        cliente, crear_ejercicio(cliente, grupo_muscular_id)
    )
    hueco = {
        "ejercicio_principal_id": ejercicio_id,
        "orden": 1,
        "series_objetivo": 3,
        "reps_min": 8,
        "reps_max": 12,
    }
    ocultar(cliente, f"/ejercicios/{ejercicio_id}")
    ocultar(cliente, f"/rutinas/{rutina_id}/slots/{slot_id}")

    editar_ejercicio = cliente.put(
        f"/ejercicios/{ejercicio_id}",
        json={"nombre": "Otro nombre", "grupo_muscular_id": grupo_muscular_id},
    )
    editar_hueco = cliente.put(f"/rutinas/{rutina_id}/slots/{slot_id}", json=hueco)

    assert editar_ejercicio.status_code == 409
    assert editar_hueco.status_code == 409


def test_en_una_rutina_oculta_no_se_puede_editar_nada(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    comodin_id = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    ocultar(cliente, f"/rutinas/{rutina_id}")
    hueco = {
        "ejercicio_principal_id": ejercicio_id,
        "orden": 2,
        "series_objetivo": 3,
        "reps_min": 8,
        "reps_max": 12,
    }

    assert cliente.put(f"/rutinas/{rutina_id}", json={"nombre": "Pull"}).status_code == 409
    assert cliente.post(f"/rutinas/{rutina_id}/slots", json=hueco).status_code == 409
    assert (
        cliente.post(
            f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas",
            json={"ejercicio_id": comodin_id},
        ).status_code
        == 409
    )


def test_algo_oculto_se_puede_borrar_en_definitivo(cliente, grupo_muscular_id):
    """Es el Borrar de la vista "está oculto"."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
    ocultar(cliente, f"/rutinas/{rutina_id}/slots/{slot_id}")
    ocultar(cliente, f"/rutinas/{rutina_id}")
    ocultar(cliente, f"/ejercicios/{ejercicio_id}")

    for ruta in (
        f"/rutinas/{rutina_id}/slots/{slot_id}",
        f"/rutinas/{rutina_id}",
        f"/ejercicios/{ejercicio_id}",
    ):
        assert cliente.delete(f"{ruta}?modo=definitivo").status_code == 204

    assert cliente.get(f"/rutinas/{rutina_id}").status_code == 404
    assert cliente.get(f"/ejercicios/{ejercicio_id}").status_code == 404


def test_un_hueco_oculto_se_puede_volver_a_mostrar(cliente, grupo_muscular_id):
    rutina_id, slot_id = crear_rutina_con_hueco(
        cliente, crear_ejercicio(cliente, grupo_muscular_id)
    )
    ocultar(cliente, f"/rutinas/{rutina_id}/slots/{slot_id}")

    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots/{slot_id}/mostrar")

    assert respuesta.status_code == 200
    assert respuesta.json()["oculto_desde"] is None


def test_ocultar_algo_ya_oculto_conserva_desde_cuando(cliente, sesion_bd, grupo_muscular_id):
    """La fecha es la de la primera vez: volver a ocultar no la mueve."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    ocultar(cliente, f"/ejercicios/{ejercicio_id}")
    sesion_bd.execute(
        update(Ejercicio).where(Ejercicio.id == ejercicio_id).values(oculto_desde=date(2026, 1, 15))
    )
    sesion_bd.commit()

    ocultar(cliente, f"/ejercicios/{ejercicio_id}")

    assert cliente.get(f"/ejercicios/{ejercicio_id}").json()["oculto_desde"] == "2026-01-15"


# --- Los predefinidos no son de nadie ------------------------------------


def test_un_ejercicio_predefinido_no_se_puede_editar_ocultar_ni_borrar(
    cliente, ejercicio_predefinido_id, grupo_muscular_id
):
    """Vienen con la app y los comparten todos los usuarios: cambiarlos o
    borrarlos afectaría a todos. 403, porque existen pero no son tuyos.
    """
    ruta = f"/ejercicios/{ejercicio_predefinido_id}"

    editar = cliente.put(ruta, json={"nombre": "Otra cosa", "grupo_muscular_id": grupo_muscular_id})

    assert editar.status_code == 403
    assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 403
    assert cliente.delete(f"{ruta}?modo=definitivo").status_code == 403
    assert cliente.get(ruta).json()["nombre"] == "Sentadilla con barra"


# --- Borrar un ejercicio que es comodín ----------------------------------


def test_borrar_en_definitivo_un_ejercicio_lo_quita_de_comodin_sin_tocar_el_hueco(
    cliente, grupo_muscular_id
):
    """Un comodín es un accesorio del hueco: el ejercicio se va y el hueco se
    queda con su principal. Es distinto de borrar el principal, que se lleva el
    hueco entero.
    """
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    comodin = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, principal)
    cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin}
    )

    sin_modo = cliente.delete(f"/ejercicios/{comodin}")
    definitivo = cliente.delete(f"/ejercicios/{comodin}?modo=definitivo")

    assert sin_modo.status_code == 409
    assert sin_modo.json()["detail"]["usos"][0]["rol"] == "comodín"
    assert definitivo.status_code == 204
    [hueco] = cliente.get(f"/rutinas/{rutina_id}").json()["slots"]
    assert hueco["ejercicio_principal"]["id"] == principal
    assert hueco["alternativas"] == []


# --- Lo oculto y lo que ya se registró con ello ---------------------------
#
# Ocultar deja de ofrecer algo para lo nuevo, pero el historial se queda. Por eso
# usar algo oculto en una serie *nueva* se rechaza, pero corregir lo que ya se
# apuntó con ello (una serie vieja, las notas de un día pasado) no debería.


def serie_de(ejercicio_id, slot_id, numero=1, repeticiones=8) -> dict:
    return {
        "ejercicio_id": ejercicio_id,
        "slot_id": slot_id,
        "numero_serie": numero,
        "peso": 60,
        "repeticiones": repeticiones,
    }


def test_un_hueco_oculto_no_se_puede_usar_en_una_serie_nueva(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
    ocultar(cliente, f"/rutinas/{rutina_id}/slots/{slot_id}")

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json=serie_de(ejercicio_id, slot_id, 2)
    )

    # 404 y no 409: lo oculto deja de ofrecerse, así que para elegirlo es como si no
    # existiera, igual que un ejercicio oculto en una serie nueva.
    assert respuesta.status_code == 404
    assert len(cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"]) == 1


def test_una_serie_de_un_hueco_oculto_se_puede_corregir_sin_cambiarle_el_hueco(
    cliente, grupo_muscular_id
):
    """Corregir lo que ya se apuntó no es elegir nada nuevo: el hueco oculto que la
    serie ya tenía no estorba.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
    [serie] = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"]
    ocultar(cliente, f"/rutinas/{rutina_id}/slots/{slot_id}")

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}/series/{serie['id']}",
        json={**serie_de(ejercicio_id, slot_id, 1), "repeticiones": 6},
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["repeticiones"] == 6


def test_borrar_en_definitivo_una_rutina_usada_en_programa_y_plan_con_historial(
    cliente, grupo_muscular_id
):
    """El escenario completo: la rutina tiene huecos, series, está en el programa
    activo y en un día planificado a mano. Todo se va, sin chocar con ningún
    RESTRICT, y los días vuelven a descanso o al programa.
    """
    hoy_ = hoy().isoformat()
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
    otra = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]
    programa = cliente.post(
        "/programas",
        json={
            "nombre": "PPL",
            "activar": True,
            "dias": [{"dia_semana": d, "rutina_id": rutina_id} for d in range(1, 8)],
        },
    ).json()["id"]
    cliente.put(f"/plan/excepciones/{hoy_}", json={"rutina_id": rutina_id})
    manana = (hoy() + timedelta(days=1)).isoformat()
    cliente.put(f"/plan/excepciones/{manana}", json={"rutina_id": otra})

    respuesta = cliente.delete(f"/rutinas/{rutina_id}?modo=definitivo")

    assert respuesta.status_code == 204, respuesta.text
    assert cliente.get(f"/programas/{programa}").json()["dias"] == []
    dias = cliente.get("/plan", params={"desde": hoy_, "hasta": manana}).json()
    assert [(d["origen"], d["descanso"]) for d in dias] == [
        ("programa", True),
        ("excepcion", False),
    ]
    assert cliente.get("/entrenamientos").json() == []
