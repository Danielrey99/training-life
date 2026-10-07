"""Tests del borrado con historial: `?modo=ocultar` y `?modo=definitivo`.

Es la parte más delicada del backend y donde han aparecido la mayoría de los bugs
reales del proyecto (el `passive_deletes` que faltaba y el `flush()` olvidado,
tres veces), así que es la primera que se cubre.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select, update

from app.fechas import hoy
from app.models import (
    Ejercicio,
    NotaUsuarioEjercicio,
    Programa,
    Rutina,
    RutinaSlot,
    Serie,
    SlotAlternativa,
)
from tests.semana import HOY, JUEVES_17, LUNES_14, LUNES_21, MARTES_15, VIERNES_18, hecha

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
    en la base mientras el ejercicio está oculto, y se siguen viendo al volver a
    mostrarlo.
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
# es editarla sin mostrarla antes (409, no 404: el GET sí la devuelve). Elegirla
# en otro sitio (un ejercicio oculto para una serie nueva) es otra cosa: da 404,
# porque lo oculto deja de ofrecerse.


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
    borrarlos afectaría a todos. 403, porque existen pero no son tuyos. Tampoco
    se pueden "mostrar": nunca están ocultos, y no son del usuario.
    """
    ruta = f"/ejercicios/{ejercicio_predefinido_id}"

    editar = cliente.put(ruta, json={"nombre": "Otra cosa", "grupo_muscular_id": grupo_muscular_id})

    assert editar.status_code == 403
    assert cliente.delete(ruta).status_code == 403
    assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 403
    assert cliente.delete(f"{ruta}?modo=definitivo").status_code == 403
    assert cliente.post(f"{ruta}/mostrar").status_code == 403
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


def test_un_comodin_con_series_dice_en_que_sesiones_y_el_definitivo_se_las_lleva(
    cliente, grupo_muscular_id
):
    """Las series hechas con un comodín son historial: el aviso las enumera por
    sesión, y `?modo=definitivo` se las lleva dejando la sesión y el hueco.
    """
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    comodin = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, principal)
    cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin}
    )
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, comodin)

    sin_modo = cliente.delete(f"/ejercicios/{comodin}")
    definitivo = cliente.delete(f"/ejercicios/{comodin}?modo=definitivo")

    assert sin_modo.status_code == 409
    assert sin_modo.json()["detail"]["usos"] == [
        {"rol": "comodín", "slot_id": slot_id, "rutina_id": rutina_id, "rutina_nombre": "Push"},
        {"rol": "serie registrada", "entrenamiento_id": entrenamiento_id, "fecha": FECHA},
    ]
    assert definitivo.status_code == 204
    assert cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"] == []
    assert len(cliente.get(f"/rutinas/{rutina_id}").json()["slots"]) == 1


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


def test_se_puede_corregir_una_serie_ya_registrada_de_un_ejercicio_oculto(
    cliente, grupo_muscular_id
):
    """El README promete que una sesión terminada admite series corregidas "para
    poder editar un día ya pasado", y ocultar promete conservar el historial.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
    [serie] = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"]
    ocultar(cliente, f"/ejercicios/{ejercicio_id}")

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}/series/{serie['id']}",
        json=serie_de(ejercicio_id, slot_id, repeticiones=10),
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["repeticiones"] == 10


def test_se_pueden_editar_las_notas_de_un_dia_cuya_rutina_se_oculto_despues(
    cliente, grupo_muscular_id
):
    """Corregir una sesión ya registrada no es elegir su rutina otra vez: el PUT
    ni siquiera la recibe (se fija al crear la sesión), así que una rutina oculta
    después no estorba. Hubo un tiempo en que el PUT revalidaba la rutina y esto
    daba 404.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, ejercicio_id)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, ejercicio_id)
    ocultar(cliente, f"/rutinas/{rutina_id}")

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}",
        json={"fecha": FECHA, "notas": "Me dolía el hombro"},
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["notas"] == "Me dolía el hombro"


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


def test_una_serie_no_se_puede_cambiar_a_otro_ejercicio_oculto(cliente, grupo_muscular_id):
    """Corregir sí, elegir algo oculto no: cambiar el ejercicio de una serie es
    elegir uno, y lo oculto no se ofrece.
    """
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    maquina = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, banca)
    entrenamiento_id = registrar_serie(cliente, rutina_id, slot_id, banca)
    [serie] = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["series"]
    ocultar(cliente, f"/ejercicios/{maquina}")

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}/series/{serie['id']}",
        json=serie_de(maquina, slot_id, 1),
    )

    assert respuesta.status_code == 404


def test_el_put_de_una_sesion_ignora_una_rutina_oculta(cliente):
    """La rutina de una sesión no se elige en el PUT (se fija al crearla), así
    que una rutina oculta que llegue ahí no es "elegir algo oculto": se ignora,
    sin 404, y se aplica lo demás.
    """
    push = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    pull = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": push, "fecha": FECHA}
    ).json()["id"]
    ocultar(cliente, f"/rutinas/{pull}")

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}",
        json={"rutina_id": pull, "fecha": FECHA, "notas": "Corregida"},
    )

    assert respuesta.status_code == 200, respuesta.text
    guardado = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()
    assert (guardado["rutina_id"], guardado["notas"]) == (push, "Corregida")


# --- Lo que no bloquea el borrado, y lo que sí ----------------------------


def test_un_ejercicio_que_solo_tiene_notas_se_borra_directo_y_se_las_lleva(
    cliente, sesion_bd, grupo_muscular_id
):
    """Decisión del autor: las notas son un accesorio del ejercicio (su FK es
    CASCADE), no historial. Un ejercicio que solo tiene notas se borra sin 409 ni
    `?modo`, y sus notas se van con él.
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    crear_nota(cliente, ejercicio_id, "El asiento va en el 4")

    assert cliente.delete(f"/ejercicios/{ejercicio_id}").status_code == 204
    assert contar_notas(sesion_bd, ejercicio_id) == 0


def test_un_hueco_sin_series_se_borra_directo_y_sus_comodines_con_el(
    cliente, sesion_bd, grupo_muscular_id
):
    """Sin series no hay nada que perder: sin `?modo`. Los comodines son accesorios
    del hueco (CASCADE) y se van con él; los ejercicios, no.
    """
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    comodin = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, principal)
    cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin}
    )

    assert cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}").status_code == 204

    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"] == []
    assert sesion_bd.scalar(select(func.count()).select_from(SlotAlternativa)) == 0
    assert cliente.get(f"/ejercicios/{comodin}").status_code == 200


def test_una_rutina_con_solo_sesiones_canceladas_se_borra_directa_y_se_las_lleva(cliente, hoy_es):
    """Una sesión vacía que ya no está en curso está cancelada (`esta_cancelada`):
    no se hizo nada en ella y no es historial. Ni la de un día pasado que se quedó
    sin terminar ni la de hoy ya terminada bloquean el borrado.

    Antes, cualquier sesión pedía `modo`. Y hay que llevárselas igualmente: con
    `entrenamientos.rutina_id` en RESTRICT, si el camino directo no las borrara
    daría un 500.
    """
    hoy_es(HOY)
    rutina_id = cliente.post("/rutinas", json={"nombre": "Brazos"}).json()["id"]
    olvidada = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA}
    ).json()["id"]
    de_hoy = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": HOY.isoformat()}
    ).json()["id"]
    assert cliente.post(f"/entrenamientos/{de_hoy}/terminar").status_code == 200

    assert aviso_de_rutina(cliente, rutina_id) == {
        "con_historial": False,
        "huecos": 0,
        "sesiones": 0,
        "dias_de_programa": 0,
        "dias_planificados": 0,
        "toco_dias_pasados": False,
        "sesion_en_curso": False,
    }
    assert cliente.delete(f"/rutinas/{rutina_id}").status_code == 204
    assert cliente.get(f"/rutinas/{rutina_id}").status_code == 404
    assert cliente.get(f"/entrenamientos/{olvidada}").status_code == 404
    assert cliente.get(f"/entrenamientos/{de_hoy}").status_code == 404


def test_una_rutina_con_huecos_y_una_sesion_cancelada_pide_modo_y_el_definitivo_se_lo_lleva_todo(
    cliente, grupo_muscular_id, hoy_es
):
    """La cancelada no bloquea, pero los huecos sí. El 409 dice «sesiones
    registradas» (antes, «historial de entrenamientos»).
    """
    hoy_es(HOY)
    rutina_id, slot_id = crear_rutina_con_hueco(
        cliente, crear_ejercicio(cliente, grupo_muscular_id)
    )
    cancelada = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA}
    ).json()["id"]

    respuesta = cliente.delete(f"/rutinas/{rutina_id}")

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"].startswith("Esta rutina tiene huecos o sesiones registradas.")
    assert "historial de entrenamientos" not in respuesta.json()["detail"]
    assert cliente.delete(f"/rutinas/{rutina_id}?modo=definitivo").status_code == 204
    assert cliente.get(f"/rutinas/{rutina_id}").status_code == 404
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 404


def test_una_rutina_sin_huecos_con_una_sesion_vacia_abierta_hoy_pide_modo(cliente, hoy_es):
    """La sesión de hoy recién empezada no está cancelada aunque no tenga series:
    se acaba de empezar. Cuenta como historial, el aviso lo dice con
    `sesion_en_curso` (aunque `sesiones`, que cuenta las que tienen series, dé 0) y
    `?modo=definitivo` se la lleva.
    """
    hoy_es(HOY)
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    abierta = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": HOY.isoformat()}
    ).json()["id"]

    aviso = aviso_de_rutina(cliente, rutina_id)
    respuesta = cliente.delete(f"/rutinas/{rutina_id}")

    assert (aviso["con_historial"], aviso["sesion_en_curso"], aviso["sesiones"]) == (True, True, 0)
    assert respuesta.status_code == 409
    assert "tiene huecos o sesiones registradas" in respuesta.json()["detail"]
    assert cliente.delete(f"/rutinas/{rutina_id}?modo=definitivo").status_code == 204
    assert cliente.get(f"/entrenamientos/{abierta}").status_code == 404


def test_borrar_en_definitivo_el_principal_de_un_hueco_con_series_del_comodin(
    cliente, grupo_muscular_id
):
    """El hueco se entrenó con el comodín, nunca con el principal. Borrar el
    principal en definitivo se lleva el hueco entero (así lo promete el 409), así
    que tiene que acabar en 204, no en un error de la base de datos.
    """
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    comodin = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, principal)
    cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin}
    )
    registrar_serie(cliente, rutina_id, slot_id, comodin)

    assert cliente.delete(f"/ejercicios/{principal}").status_code == 409
    respuesta = cliente.delete(f"/ejercicios/{principal}?modo=definitivo")

    assert respuesta.status_code == 204
    assert cliente.get(f"/rutinas/{rutina_id}").json()["slots"] == []


# --- Más sobre lo oculto -------------------------------------------------


@pytest.mark.parametrize("que", ["rutina", "hueco", "programa"])
def test_volver_a_ocultar_conserva_desde_cuando_en_rutinas_huecos_y_programas(
    cliente, sesion_bd, grupo_muscular_id, que
):
    """Lo mismo que con un ejercicio: la fecha es la de la primera vez."""
    rutina_id, slot_id = crear_rutina_con_hueco(
        cliente, crear_ejercicio(cliente, grupo_muscular_id)
    )
    programa_id = cliente.post("/programas", json={"nombre": "PPL"}).json()["id"]
    modelo, fila, ruta = {
        "rutina": (Rutina, rutina_id, f"/rutinas/{rutina_id}"),
        "hueco": (RutinaSlot, slot_id, f"/rutinas/{rutina_id}/slots/{slot_id}"),
        "programa": (Programa, programa_id, f"/programas/{programa_id}"),
    }[que]
    ocultar(cliente, ruta)
    sesion_bd.execute(
        update(modelo).where(modelo.id == fila).values(oculto_desde=date(2026, 1, 15))
    )
    sesion_bd.commit()

    ocultar(cliente, ruta)

    if que == "hueco":
        [leido] = cliente.get(f"/rutinas/{rutina_id}").json()["slots"]
    else:
        leido = cliente.get(ruta).json()
    assert leido["oculto_desde"] == "2026-01-15"


def test_los_comodines_de_un_hueco_oculto_no_se_pueden_cambiar(cliente, grupo_muscular_id):
    """Añadir o quitar un comodín es editar el hueco: 409 si está oculto él o su
    rutina, igual que el PUT del hueco.
    """
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    maquina = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    mancuernas = crear_ejercicio(cliente, grupo_muscular_id, "Press con mancuernas")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, principal)
    ruta = f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas"
    cliente.post(ruta, json={"ejercicio_id": maquina})

    ocultar(cliente, f"/rutinas/{rutina_id}/slots/{slot_id}")
    assert cliente.post(ruta, json={"ejercicio_id": mancuernas}).status_code == 409
    assert cliente.delete(f"{ruta}/{maquina}").status_code == 409

    cliente.post(f"/rutinas/{rutina_id}/slots/{slot_id}/mostrar")
    ocultar(cliente, f"/rutinas/{rutina_id}")
    assert cliente.delete(f"{ruta}/{maquina}").status_code == 409

    [hueco] = cliente.get(f"/rutinas/{rutina_id}").json()["slots"]
    assert [comodin["id"] for comodin in hueco["alternativas"]] == [maquina]


def test_un_ejercicio_oculto_no_se_puede_elegir_como_comodin(cliente, grupo_muscular_id):
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    maquina = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, principal)
    ocultar(cliente, f"/ejercicios/{maquina}")

    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": maquina}
    )

    assert respuesta.status_code == 404


def test_un_hueco_no_puede_cambiar_su_principal_a_un_ejercicio_oculto(cliente, grupo_muscular_id):
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    maquina = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, banca)
    ocultar(cliente, f"/ejercicios/{maquina}")
    hueco = {
        "ejercicio_principal_id": maquina,
        "orden": 1,
        "series_objetivo": 4,
        "reps_min": 6,
        "reps_max": 10,
    }

    assert cliente.put(f"/rutinas/{rutina_id}/slots/{slot_id}", json=hueco).status_code == 404


def test_un_hueco_cuyo_principal_se_oculto_se_puede_editar_sin_cambiarlo(
    cliente, grupo_muscular_id
):
    """Ocultar el ejercicio no lo saca del hueco (el hueco lo enseña en gris). Si
    luego se quiere cambiar el objetivo del hueco, mandar el mismo principal no
    es elegir nada nuevo: es la regla "corregir sí, elegir algo oculto no" que ya
    siguen las series y los entrenamientos.
    """
    banca = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, banca)
    ocultar(cliente, f"/ejercicios/{banca}")
    hueco = {
        "ejercicio_principal_id": banca,
        "orden": 1,
        "series_objetivo": 5,
        "reps_min": 6,
        "reps_max": 10,
    }

    respuesta = cliente.put(f"/rutinas/{rutina_id}/slots/{slot_id}", json=hueco)

    assert respuesta.status_code == 200
    assert respuesta.json()["series_objetivo"] == 5


# --- Coherencia entre huecos, comodines y series -------------------------


def con_comodin(cliente, grupo_muscular_id):
    """Un hueco con Press banca de principal y Press en máquina de comodín."""
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    comodin = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, principal)
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin}
    )
    assert respuesta.status_code == 201
    return principal, comodin, rutina_id, slot_id


def serie(ejercicio_id, slot_id, peso=60):
    return {
        "ejercicio_id": ejercicio_id,
        "slot_id": slot_id,
        "numero_serie": 1,
        "peso": peso,
        "repeticiones": 8,
    }


def test_el_aviso_de_borrar_un_principal_cuenta_las_series_hechas_con_el_comodin(
    cliente, grupo_muscular_id
):
    """Borrar el principal en definitivo se lleva el hueco entero, también lo que se
    hizo en él con el comodín: el aviso tiene que decirlo antes.
    """
    principal, comodin, rutina_id, slot_id = con_comodin(cliente, grupo_muscular_id)
    registrar_serie(cliente, rutina_id, slot_id, comodin)

    respuesta = cliente.delete(f"/ejercicios/{principal}")

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["series_de_comodines_que_se_perderian"] == 1


def test_un_ejercicio_no_puede_ser_comodin_de_su_propio_hueco(cliente, grupo_muscular_id):
    principal, _, rutina_id, slot_id = con_comodin(cliente, grupo_muscular_id)

    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": principal}
    )

    assert respuesta.status_code == 409


def test_un_comodin_no_puede_pasar_a_principal_de_su_mismo_hueco(cliente, grupo_muscular_id):
    """El camino contrario al anterior: acabaría siendo las dos cosas a la vez."""
    _, comodin, rutina_id, slot_id = con_comodin(cliente, grupo_muscular_id)

    respuesta = cliente.put(
        f"/rutinas/{rutina_id}/slots/{slot_id}",
        json={
            "ejercicio_principal_id": comodin,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    )

    assert respuesta.status_code == 409


def test_una_serie_de_un_hueco_solo_admite_su_principal_o_sus_comodines(cliente, grupo_muscular_id):
    """Si no, el historial del hueco mezclaría ejercicios que no son suyos."""
    principal, comodin, rutina_id, slot_id = con_comodin(cliente, grupo_muscular_id)
    otro = crear_ejercicio(cliente, grupo_muscular_id, "Curl")
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA}
    ).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"

    assert cliente.post(ruta, json=serie(otro, slot_id)).status_code == 422
    assert cliente.post(ruta, json=serie(principal, slot_id)).status_code == 201
    assert cliente.post(ruta, json=serie(comodin, slot_id)).status_code == 201


def test_una_serie_se_puede_corregir_aunque_su_ejercicio_ya_no_sea_comodin(
    cliente, grupo_muscular_id
):
    """Corregir lo que ya se apuntó no es elegir nada nuevo. Pero cambiarla a un
    ejercicio que no es del hueco sigue sin valer.
    """
    _, comodin, rutina_id, slot_id = con_comodin(cliente, grupo_muscular_id)
    otro = crear_ejercicio(cliente, grupo_muscular_id, "Curl")
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA}
    ).json()["id"]
    ruta = f"/entrenamientos/{entrenamiento_id}/series"
    serie_id = cliente.post(ruta, json=serie(comodin, slot_id)).json()["id"]
    cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas/{comodin}")

    corregida = cliente.put(f"{ruta}/{serie_id}", json=serie(comodin, slot_id, peso=65))
    cambiada = cliente.put(f"{ruta}/{serie_id}", json=serie(otro, slot_id))

    assert corregida.status_code == 200
    assert corregida.json()["peso"] == "65.00"
    assert cambiada.status_code == 422


def test_en_una_sesion_de_una_rutina_ya_oculta_se_pueden_seguir_apuntando_series(
    cliente, grupo_muscular_id
):
    """La sesión ya estaba empezada: completarla es corregir, no elegir la rutina
    oculta de nuevo (decisión del autor).
    """
    principal, _, rutina_id, slot_id = con_comodin(cliente, grupo_muscular_id)
    entrenamiento_id = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA}
    ).json()["id"]
    ocultar(cliente, f"/rutinas/{rutina_id}")

    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series", json=serie(principal, slot_id)
    )

    assert respuesta.status_code == 201


# --- Una rutina que ya estuvo en el plan -----------------------------------
#
# Borrarla se lleva en cascada sus días de programa y sus días planificados,
# también los pasados, y el calendario los pintaría como descanso. Por eso pide
# `modo` aunque no tenga huecos ni sesiones. Parten de la semana de
# `tests/semana.py` (hoy, miércoles 16; Push/Pull/Leg activo desde el 31 de agosto).


def plan_del_dia(cliente, fecha) -> dict:
    return cliente.get(
        "/plan", params={"desde": fecha.isoformat(), "hasta": fecha.isoformat()}
    ).json()[0]


def test_borrar_una_rutina_que_ya_toco_dias_pasados_pide_modo(cliente, ppl):
    respuesta = cliente.delete(f"/rutinas/{ppl['Push']}")

    assert respuesta.status_code == 409
    assert "días que han pasado" in respuesta.json()["detail"]


def test_borrarla_en_definitivo_deja_esos_dias_en_descanso(cliente, ppl):
    assert cliente.delete(f"/rutinas/{ppl['Push']}?modo=definitivo").status_code == 204

    assert plan_del_dia(cliente, LUNES_14)["descanso"] is True


def test_ocultarla_conserva_los_dias_pasados(cliente, ppl):
    assert cliente.delete(f"/rutinas/{ppl['Push']}?modo=ocultar").status_code == 204

    lunes = plan_del_dia(cliente, LUNES_14)
    assert (lunes["rutina"]["nombre"], lunes["descanso"]) == ("Push", False)
    assert plan_del_dia(cliente, LUNES_21)["descanso"] is True


def test_una_rutina_quitada_del_programa_tambien_cuenta(cliente, ppl):
    """Su fila del programa está cerrada, pero valió para los viernes pasados."""
    programa = cliente.get("/programas").json()[0]["id"]
    assert cliente.delete(f"/programas/{programa}/dias/5").status_code == 204

    assert cliente.delete(f"/rutinas/{ppl['Leg']}").status_code == 409


def test_una_rutina_planificada_a_mano_para_un_dia_pasado_tambien_cuenta(cliente, ppl, hoy_es):
    brazos = cliente.post("/rutinas", json={"nombre": "Brazos"}).json()["id"]
    hoy_es(MARTES_15)
    assert (
        cliente.put(f"/plan/excepciones/{MARTES_15.isoformat()}", json={"rutina_id": brazos})
    ).status_code == 200
    hoy_es(HOY)

    assert cliente.delete(f"/rutinas/{brazos}").status_code == 409


def test_si_su_dia_aun_no_ha_llegado_con_el_programa_activo_se_borra_directa(cliente, hoy_es):
    """El programa se activó ayer, martes: el Push de los lunes nunca tocó un día
    pasado con él activo, y el Pull de los martes sí.
    """

    push = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    pull = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]
    hoy_es(MARTES_15)
    cliente.post(
        "/programas",
        json={
            "nombre": "Dos días",
            "activar": True,
            "dias": [{"dia_semana": 1, "rutina_id": push}, {"dia_semana": 2, "rutina_id": pull}],
        },
    )
    hoy_es(HOY)

    assert cliente.delete(f"/rutinas/{push}").status_code == 204
    assert cliente.delete(f"/rutinas/{pull}").status_code == 409


def test_en_un_programa_que_nunca_estuvo_activo_se_borra_directa(cliente, hoy_es):
    hoy_es(HOY)
    push = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    cliente.post(
        "/programas", json={"nombre": "Sin usar", "dias": [{"dia_semana": 1, "rutina_id": push}]}
    )

    assert cliente.delete(f"/rutinas/{push}").status_code == 204


# --- El aviso de borrar un hueco ---------------------------------------------
#
# `GET /rutinas/{id}/slots/{slot_id}/aviso-de-borrado`: lo que el diálogo de
# confirmar cuenta antes de borrar. Las fechas son de la semana de
# `tests/semana.py`; hoy es el miércoles 16.

PRIMERO_DE_SEPTIEMBRE = date(2026, 9, 1)
CUATRO_DE_SEPTIEMBRE = date(2026, 9, 4)
OCHO_DE_SEPTIEMBRE = date(2026, 9, 8)
DIEZ_DE_SEPTIEMBRE = date(2026, 9, 10)


def aviso_de_hueco(cliente, rutina_id, slot_id):
    return cliente.get(f"/rutinas/{rutina_id}/slots/{slot_id}/aviso-de-borrado")


def segundo_hueco(cliente, rutina_id, ejercicio_id) -> int:
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": 2,
            "series_objetivo": 3,
            "reps_min": 8,
            "reps_max": 12,
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def sesion_con_series(cliente, rutina_id, fecha, *series) -> int:
    """Una sesión de la rutina con una serie por cada `(slot_id, ejercicio_id)`."""
    respuesta = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_id, "fecha": fecha.isoformat()}
    )
    assert respuesta.status_code == 201, respuesta.text
    entrenamiento_id = respuesta.json()["id"]
    for numero, (slot_id, ejercicio_id) in enumerate(series, start=1):
        serie = cliente.post(
            f"/entrenamientos/{entrenamiento_id}/series",
            json={
                "ejercicio_id": ejercicio_id,
                "slot_id": slot_id,
                "numero_serie": numero,
                "peso": 50,
                "repeticiones": 10,
            },
        )
        assert serie.status_code == 201, serie.text
    return entrenamiento_id


@pytest.fixture
def push_con_dos_huecos(cliente, grupo_muscular_id, hoy_es) -> dict:
    """Push con el hueco del press (A) y el de fondos (B), y cuatro sesiones:

    - la del 10, solo con dos series de A (se crea la primera, para que el orden
      por fecha no salga gratis del orden de los ids);
    - la del 1, solo con una de A;
    - la del 4, con una de A y una de B;
    - la del 8, solo con una de B.

    Ninguna está terminada, y todas son de días pasados (hoy es el 16).
    """
    hoy_es(HOY)
    press = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    fondos = crear_ejercicio(cliente, grupo_muscular_id, "Fondos")
    rutina_id, a = crear_rutina_con_hueco(cliente, press)
    b = segundo_hueco(cliente, rutina_id, fondos)
    sesiones = {
        "dia_10": sesion_con_series(cliente, rutina_id, DIEZ_DE_SEPTIEMBRE, (a, press), (a, press)),
        "dia_1": sesion_con_series(cliente, rutina_id, PRIMERO_DE_SEPTIEMBRE, (a, press)),
        "dia_4": sesion_con_series(
            cliente, rutina_id, CUATRO_DE_SEPTIEMBRE, (a, press), (b, fondos)
        ),
        "dia_8": sesion_con_series(cliente, rutina_id, OCHO_DE_SEPTIEMBRE, (b, fondos)),
    }
    return {"rutina_id": rutina_id, "a": a, "b": b, "press": press, **sesiones}


def test_el_aviso_de_un_hueco_cuenta_sus_series_y_desde_cuando(cliente, push_con_dos_huecos):
    escenario = push_con_dos_huecos

    aviso = aviso_de_hueco(cliente, escenario["rutina_id"], escenario["a"])

    assert aviso.status_code == 200, aviso.text
    assert (aviso.json()["series"], aviso.json()["desde"]) == (4, "2026-09-01")


def test_solo_se_vacian_las_sesiones_sin_series_en_otro_hueco(cliente, push_con_dos_huecos):
    """La del 4 tiene series en los dos huecos: borrar uno no la deja vacía."""
    escenario = push_con_dos_huecos
    rutina_id = escenario["rutina_id"]

    del_a = aviso_de_hueco(cliente, rutina_id, escenario["a"]).json()["sesiones_que_se_vacian"]
    del_b = aviso_de_hueco(cliente, rutina_id, escenario["b"]).json()["sesiones_que_se_vacian"]

    assert del_a == [
        {"entrenamiento_id": escenario["dia_1"], "fecha": "2026-09-01", "cubre_fecha": None},
        {"entrenamiento_id": escenario["dia_10"], "fecha": "2026-09-10", "cubre_fecha": None},
    ]
    assert [s["entrenamiento_id"] for s in del_b] == [escenario["dia_8"]]


def test_una_sesion_que_se_vacia_dice_que_dia_del_plan_contaba(cliente, ppl, grupo_muscular_id):
    """Es lo que la web enseña: ese día pasaría a sin hacer."""
    sesion = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Push"], cubre_fecha=LUNES_14)
    hueco = cliente.get(f"/rutinas/{ppl['Push']}").json()["slots"][0]["id"]

    aviso = aviso_de_hueco(cliente, ppl["Push"], hueco).json()

    assert aviso["sesiones_que_se_vacian"] == [
        {"entrenamiento_id": sesion, "fecha": "2026-09-14", "cubre_fecha": "2026-09-14"}
    ]


def test_el_aviso_de_un_hueco_sin_series_va_vacio(cliente, grupo_muscular_id):
    rutina_id, slot_id = crear_rutina_con_hueco(
        cliente, crear_ejercicio(cliente, grupo_muscular_id)
    )

    aviso = aviso_de_hueco(cliente, rutina_id, slot_id)

    assert aviso.status_code == 200
    assert aviso.json() == {"series": 0, "desde": None, "sesiones_que_se_vacian": []}


def test_el_aviso_de_un_hueco_oculto_se_puede_leer(cliente, push_con_dos_huecos):
    """P4 oculto ofrece Borrar: el diálogo tiene que poder contar lo que se pierde,
    también con la rutina oculta.
    """
    escenario = push_con_dos_huecos
    rutina_id, a = escenario["rutina_id"], escenario["a"]
    assert cliente.delete(f"/rutinas/{rutina_id}/slots/{a}?modo=ocultar").status_code == 204
    assert cliente.delete(f"/rutinas/{rutina_id}?modo=ocultar").status_code == 204

    aviso = aviso_de_hueco(cliente, rutina_id, a)

    assert aviso.status_code == 200
    assert aviso.json()["series"] == 4
    assert len(aviso.json()["sesiones_que_se_vacian"]) == 2


def test_el_aviso_de_un_hueco_inexistente_o_de_otra_rutina_da_404(cliente, push_con_dos_huecos):
    escenario = push_con_dos_huecos
    otra = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]

    assert aviso_de_hueco(cliente, escenario["rutina_id"], 999_999).status_code == 404
    assert aviso_de_hueco(cliente, otra, escenario["a"]).status_code == 404
    assert aviso_de_hueco(cliente, 999_999, escenario["a"]).status_code == 404


def test_el_409_de_borrar_un_hueco_dice_cuantas_sesiones_se_borraran(cliente, push_con_dos_huecos):
    """En plural y en singular. Antes decía que se quedarían «sin ninguna serie»: ahora
    esas sesiones se borran con el hueco.
    """
    escenario = push_con_dos_huecos
    ruta = f"/rutinas/{escenario['rutina_id']}/slots"

    del_a = cliente.delete(f"{ruta}/{escenario['a']}")
    del_b = cliente.delete(f"{ruta}/{escenario['b']}")

    assert (del_a.status_code, del_b.status_code) == (409, 409)
    assert del_a.json()["detail"].endswith(
        "sin poder deshacerlo). Además, se borrarán 2 sesiones que solo tenían series de "
        "este hueco."
    )
    assert del_b.json()["detail"].endswith(
        "sin poder deshacerlo). Además, se borrará 1 sesión que solo tenía series de este hueco."
    )


def test_el_409_de_borrar_un_hueco_no_habla_de_sesiones_si_ninguna_se_vacia(
    cliente, grupo_muscular_id
):
    press = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    fondos = crear_ejercicio(cliente, grupo_muscular_id, "Fondos")
    rutina_id, a = crear_rutina_con_hueco(cliente, press)
    b = segundo_hueco(cliente, rutina_id, fondos)
    sesion_con_series(cliente, rutina_id, date.fromisoformat(FECHA), (a, press), (b, fondos))

    respuesta = cliente.delete(f"/rutinas/{rutina_id}/slots/{a}")

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"].startswith("Este hueco tiene series registradas.")
    assert "Además" not in respuesta.json()["detail"]


def series_de(cliente, entrenamiento_id) -> list[dict] | None:
    """Las series de la sesión, o `None` si ya no existe."""
    respuesta = cliente.get(f"/entrenamientos/{entrenamiento_id}")
    if respuesta.status_code == 404:
        return None
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()["series"]


def test_borrar_en_definitivo_un_hueco_se_lleva_las_sesiones_que_vacia_y_deja_las_demas(
    cliente, push_con_dos_huecos
):
    """Las sesiones que solo tenían series del hueco se quedarían sin ninguna, que
    es estar canceladas: se borran con él. Antes se quedaban vacías. La del 4
    conserva la serie del otro hueco y la del 8, que no lo usaba, ni se toca.
    """
    escenario = push_con_dos_huecos
    ruta = f"/rutinas/{escenario['rutina_id']}/slots/{escenario['a']}"

    assert cliente.delete(f"{ruta}?modo=definitivo").status_code == 204

    assert series_de(cliente, escenario["dia_1"]) is None
    assert series_de(cliente, escenario["dia_10"]) is None
    assert [s["slot_id"] for s in series_de(cliente, escenario["dia_4"])] == [escenario["b"]]
    assert [s["slot_id"] for s in series_de(cliente, escenario["dia_8"])] == [escenario["b"]]


def test_la_sesion_que_se_borra_con_el_hueco_deja_su_dia_sin_hacer(cliente, ppl, grupo_muscular_id):
    """Contaba el lunes 14 del plan; al irse con el hueco, ese día vuelve a quedar
    sin hacer.
    """
    sesion = hecha(cliente, grupo_muscular_id, LUNES_14, ppl["Push"], cubre_fecha=LUNES_14)
    hueco = cliente.get(f"/rutinas/{ppl['Push']}").json()["slots"][0]["id"]

    def estado_del_lunes():
        respuesta = cliente.get(
            "/plan/seguimiento",
            params={"desde": LUNES_14.isoformat(), "hasta": LUNES_14.isoformat()},
        )
        assert respuesta.status_code == 200, respuesta.text
        return respuesta.json()[0]["estado"]

    assert estado_del_lunes() == "hecho"
    respuesta = cliente.delete(f"/rutinas/{ppl['Push']}/slots/{hueco}?modo=definitivo")

    assert respuesta.status_code == 204
    assert cliente.get(f"/entrenamientos/{sesion}").status_code == 404
    assert estado_del_lunes() == "sin_hacer"


def test_la_sesion_abierta_hoy_no_se_borra_con_el_hueco_aunque_se_quede_vacia(
    cliente, push_con_dos_huecos
):
    """No está cancelada aunque se quede sin series, y puede estar abierta en E2:
    borrarla daría un 404 a mitad de entrenamiento. Ni el aviso ni la frase del
    409 la cuentan; sigue abierta, vacía y en curso.
    """
    escenario = push_con_dos_huecos
    rutina_id, a = escenario["rutina_id"], escenario["a"]
    abierta = sesion_con_series(cliente, rutina_id, HOY, (a, escenario["press"]))

    aviso = aviso_de_hueco(cliente, rutina_id, a).json()
    conflicto = cliente.delete(f"/rutinas/{rutina_id}/slots/{a}")
    borrado = cliente.delete(f"/rutinas/{rutina_id}/slots/{a}?modo=definitivo")

    assert aviso["series"] == 5
    assert abierta not in [s["entrenamiento_id"] for s in aviso["sesiones_que_se_vacian"]]
    assert "se borrarán 2 sesiones" in conflicto.json()["detail"]
    assert borrado.status_code == 204
    assert series_de(cliente, abierta) == []
    en_curso = cliente.get("/entrenamientos", params={"en_curso": True}).json()
    assert [s["id"] for s in en_curso] == [abierta]


def test_la_sesion_de_hoy_ya_terminada_si_se_borra_con_el_hueco(cliente, push_con_dos_huecos):
    """Ya no está en curso: sin series se quedaría cancelada, como las de días pasados."""
    escenario = push_con_dos_huecos
    rutina_id, a = escenario["rutina_id"], escenario["a"]
    terminada = sesion_con_series(cliente, rutina_id, HOY, (a, escenario["press"]))
    assert cliente.post(f"/entrenamientos/{terminada}/terminar").status_code == 200

    aviso = aviso_de_hueco(cliente, rutina_id, a).json()["sesiones_que_se_vacian"]
    borrado = cliente.delete(f"/rutinas/{rutina_id}/slots/{a}?modo=definitivo")

    assert [s["entrenamiento_id"] for s in aviso] == [
        escenario["dia_1"],
        escenario["dia_10"],
        terminada,
    ]
    assert borrado.status_code == 204
    assert series_de(cliente, terminada) is None


def test_una_sesion_que_ya_estaba_vacia_no_sale_en_el_aviso_del_hueco_ni_se_toca(
    cliente, push_con_dos_huecos
):
    """No tiene series de ese hueco: borrarlo no la vacía, ya lo estaba."""
    escenario = push_con_dos_huecos
    rutina_id, a = escenario["rutina_id"], escenario["a"]
    ya_vacia = sesion_con_series(cliente, rutina_id, date(2026, 9, 12))

    aviso = aviso_de_hueco(cliente, rutina_id, a).json()["sesiones_que_se_vacian"]
    borrado = cliente.delete(f"/rutinas/{rutina_id}/slots/{a}?modo=definitivo")

    assert ya_vacia not in [s["entrenamiento_id"] for s in aviso]
    assert borrado.status_code == 204
    assert series_de(cliente, ya_vacia) == []


def test_borrar_un_hueco_en_definitivo_se_lleva_justo_las_sesiones_del_aviso(
    cliente, push_con_dos_huecos
):
    """Regresión del orden en `borrar_slot`: la lista de las sesiones que se vacían
    se calcula antes de borrar las series del hueco. Calculada después, el «tiene
    series en este hueco» ya no se cumple, sale vacía y el borrado deja esas
    sesiones canceladas sin dar ningún error.

    En una sola petición, con sesiones que se van y otras que se quedan (la del 4,
    la del 8, una ya vacía y la abierta hoy): se borran exactamente las del aviso.
    """
    escenario = push_con_dos_huecos
    rutina_id, a = escenario["rutina_id"], escenario["a"]
    ya_vacia = sesion_con_series(cliente, rutina_id, date(2026, 9, 12))
    abierta = sesion_con_series(cliente, rutina_id, HOY, (a, escenario["press"]))
    todas = [escenario[dia] for dia in ("dia_1", "dia_4", "dia_8", "dia_10")]
    todas += [ya_vacia, abierta]

    anunciadas = {
        s["entrenamiento_id"]
        for s in aviso_de_hueco(cliente, rutina_id, a).json()["sesiones_que_se_vacian"]
    }
    respuesta = cliente.delete(f"/rutinas/{rutina_id}/slots/{a}?modo=definitivo")

    assert respuesta.status_code == 204, respuesta.text
    borradas = {sesion for sesion in todas if series_de(cliente, sesion) is None}
    assert borradas == anunciadas == {escenario["dia_1"], escenario["dia_10"]}


# --- El aviso de borrar una rutina -------------------------------------------
#
# `GET /rutinas/{id}/aviso-de-borrado`. `con_historial` tiene que coincidir con
# que el DELETE sin `modo` dé 409: si no, la web enseñaría un diálogo y el DELETE
# haría otra cosa.


def aviso_de_rutina(cliente, rutina_id) -> dict:
    respuesta = cliente.get(f"/rutinas/{rutina_id}/aviso-de-borrado")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def _rutina_vacia(cliente, request, grupo_muscular_id) -> int:
    return cliente.post("/rutinas", json={"nombre": "Brazos"}).json()["id"]


def _rutina_con_un_hueco(cliente, request, grupo_muscular_id) -> int:
    rutina_id, _ = crear_rutina_con_hueco(cliente, crear_ejercicio(cliente, grupo_muscular_id))
    return rutina_id


def _rutina_con_una_sesion_cancelada(cliente, request, grupo_muscular_id) -> int:
    """Vacía, de un día pasado y sin terminar: cancelada, no es historial."""
    request.getfixturevalue("hoy_es")(HOY)
    rutina_id = _rutina_vacia(cliente, request, grupo_muscular_id)
    cliente.post("/entrenamientos", json={"rutina_id": rutina_id, "fecha": FECHA})
    return rutina_id


def _rutina_con_una_sesion_en_curso(cliente, request, grupo_muscular_id) -> int:
    """Vacía pero abierta hoy: se acaba de empezar, sí es historial."""
    request.getfixturevalue("hoy_es")(HOY)
    rutina_id = _rutina_vacia(cliente, request, grupo_muscular_id)
    cliente.post("/entrenamientos", json={"rutina_id": rutina_id, "fecha": HOY.isoformat()})
    return rutina_id


def _rutina_que_solo_toco_dias_pasados(cliente, request, grupo_muscular_id) -> int:
    return request.getfixturevalue("ppl")["Push"]


def _rutina_en_un_programa_sin_activar(cliente, request, grupo_muscular_id) -> int:
    rutina_id = _rutina_vacia(cliente, request, grupo_muscular_id)
    cliente.post(
        "/programas",
        json={"nombre": "Sin usar", "dias": [{"dia_semana": 1, "rutina_id": rutina_id}]},
    )
    return rutina_id


@pytest.mark.parametrize(
    "montar, con_historial",
    [
        pytest.param(_rutina_vacia, False, id="vacia"),
        pytest.param(_rutina_con_un_hueco, True, id="con-un-hueco"),
        pytest.param(_rutina_con_una_sesion_cancelada, False, id="con-una-sesion-cancelada"),
        pytest.param(_rutina_con_una_sesion_en_curso, True, id="con-una-sesion-en-curso"),
        pytest.param(_rutina_que_solo_toco_dias_pasados, True, id="solo-dias-pasados"),
        pytest.param(_rutina_en_un_programa_sin_activar, False, id="programa-sin-activar"),
    ],
)
def test_con_historial_coincide_con_que_el_delete_pida_modo(
    cliente, request, grupo_muscular_id, montar, con_historial
):
    rutina_id = montar(cliente, request, grupo_muscular_id)

    aviso = aviso_de_rutina(cliente, rutina_id)
    borrado = cliente.delete(f"/rutinas/{rutina_id}")

    assert aviso["con_historial"] is con_historial
    assert borrado.status_code == (409 if con_historial else 204)


def test_el_aviso_dice_que_la_rutina_toco_dias_pasados(cliente, ppl):
    """El caso que el diálogo de P3 no reflejaba: sin huecos ni sesiones, pero con
    días pasados en el plan.
    """
    aviso = aviso_de_rutina(cliente, ppl["Push"])

    assert aviso == {
        "con_historial": True,
        "huecos": 0,
        "sesiones": 0,
        "dias_de_programa": 1,
        "dias_planificados": 0,
        "toco_dias_pasados": True,
        "sesion_en_curso": False,
    }


def test_el_aviso_de_una_rutina_no_cuenta_las_sesiones_vacias(cliente, grupo_muscular_id):
    """Una sesión sin series ya fuera de curso está cancelada: no es algo que se
    pierda.
    """
    press = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id, slot_id = crear_rutina_con_hueco(cliente, press)
    sesion_con_series(cliente, rutina_id, PRIMERO_DE_SEPTIEMBRE, (slot_id, press))
    sesion_con_series(cliente, rutina_id, CUATRO_DE_SEPTIEMBRE, (slot_id, press), (slot_id, press))
    sesion_con_series(cliente, rutina_id, OCHO_DE_SEPTIEMBRE)

    aviso = aviso_de_rutina(cliente, rutina_id)

    assert (aviso["sesiones"], aviso["huecos"]) == (2, 1)


# Cada uno monta una sesión en la rutina Push (o en Pull, la otra) a partir del
# hueco del press. Hoy es el miércoles 16.


def _abierta_hoy_con_series(cliente, push, pull, slot_id, press):
    sesion_con_series(cliente, push, HOY, (slot_id, press))


def _de_ayer_sin_terminar(cliente, push, pull, slot_id, press):
    """La que crea H1b al apuntar un día pasado: vacía y sin terminar."""
    sesion_con_series(cliente, push, MARTES_15)


def _de_hoy_ya_terminada(cliente, push, pull, slot_id, press):
    sesion = sesion_con_series(cliente, push, HOY, (slot_id, press))
    assert cliente.post(f"/entrenamientos/{sesion}/terminar").status_code == 200


def _abierta_hoy_de_otra_rutina(cliente, push, pull, slot_id, press):
    sesion_con_series(cliente, pull, HOY)


@pytest.mark.parametrize(
    "montar, en_curso",
    [
        pytest.param(_abierta_hoy_con_series, True, id="abierta-hoy-con-series"),
        pytest.param(_de_ayer_sin_terminar, False, id="de-ayer-sin-terminar"),
        pytest.param(_de_hoy_ya_terminada, False, id="de-hoy-ya-terminada"),
        pytest.param(_abierta_hoy_de_otra_rutina, False, id="abierta-hoy-de-otra-rutina"),
    ],
)
def test_el_aviso_de_una_rutina_dice_si_hay_una_sesion_suya_abierta_hoy(
    cliente, grupo_muscular_id, hoy_es, montar, en_curso
):
    """Es lo que hace que P3 diga «También se cancelará la sesión que tienes
    abierta hoy». Una sesión de un día pasado sin terminar no está en curso. Y si
    hay una abierta, `con_historial` también es verdadero: la frase solo sale en el
    diálogo completo.
    """
    hoy_es(HOY)
    press = crear_ejercicio(cliente, grupo_muscular_id)
    push, slot_id = crear_rutina_con_hueco(cliente, press)
    pull = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]
    montar(cliente, push, pull, slot_id, press)

    aviso = aviso_de_rutina(cliente, push)

    assert aviso["sesion_en_curso"] is en_curso
    if en_curso:
        assert aviso["con_historial"] is True


def test_el_aviso_de_una_rutina_cuenta_los_huecos_ocultos(cliente, grupo_muscular_id):
    """Borrarla en definitivo también se los lleva. Se puede leer con la rutina oculta."""
    rutina_id, oculto = crear_rutina_con_hueco(cliente, crear_ejercicio(cliente, grupo_muscular_id))
    segundo_hueco(cliente, rutina_id, crear_ejercicio(cliente, grupo_muscular_id, "Fondos"))
    assert cliente.delete(f"/rutinas/{rutina_id}/slots/{oculto}?modo=ocultar").status_code == 204
    assert cliente.delete(f"/rutinas/{rutina_id}?modo=ocultar").status_code == 204

    assert aviso_de_rutina(cliente, rutina_id)["huecos"] == 2


def test_el_aviso_de_una_rutina_cuenta_sus_dias_vigentes_y_planificados(cliente, ppl):
    """El lunes del PPL deja de ser Push (su fila se cierra y ya no cuenta), el
    martes pasa a serlo, y está en otro programa sin activar en dos días: 3 días de
    programa. Más dos días planificados a mano. Las cuentas son las del 409.
    """
    programa = cliente.get("/programas").json()[0]["id"]
    for dia, rutina in ((1, "Leg"), (2, "Push")):
        respuesta = cliente.put(
            f"/programas/{programa}/dias/{dia}", json={"rutina_id": ppl[rutina]}
        )
        assert respuesta.status_code == 200, respuesta.text
    cliente.post(
        "/programas",
        json={
            "nombre": "Otro",
            "dias": [{"dia_semana": dia, "rutina_id": ppl["Push"]} for dia in (4, 6)],
        },
    )
    for fecha in (JUEVES_17, VIERNES_18):
        respuesta = cliente.put(
            f"/plan/excepciones/{fecha.isoformat()}", json={"rutina_id": ppl["Push"]}
        )
        assert respuesta.status_code == 200, respuesta.text

    aviso = aviso_de_rutina(cliente, ppl["Push"])
    detalle = cliente.delete(f"/rutinas/{ppl['Push']}").json()["detail"]

    assert (aviso["dias_de_programa"], aviso["dias_planificados"]) == (3, 2)
    assert aviso["toco_dias_pasados"] is True
    assert "3 días de programa" in detalle
    assert "2 días planificados a mano" in detalle


def test_el_aviso_de_una_rutina_inexistente_da_404(cliente):
    assert cliente.get("/rutinas/999999/aviso-de-borrado").status_code == 404
