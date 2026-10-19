"""Tests de un hueco suelto: dónde cae cuando no se dice su `orden` y cómo se
sustituye su lista de comodines de una vez.

El `orden` automático existe para que la web no calcule un dato que el backend
tiene a mano (y que exige mirar también los huecos ocultos). La lista de
comodines en el PUT existe para que *Guardar* en P4 sea una sola petición; su
trampa es el `UNIQUE(slot_id, ejercicio_id)`: si se reconstruye la lista entera en
vez de conservar las filas que siguen, SQLAlchemy inserta antes de borrar y la
base lo rechaza.

El resto del CRUD de huecos está en test_crud.py, y lo de otros usuarios en
test_aislamiento_por_usuario.py.
"""

import pytest
from sqlalchemy import func, select

from app.fechas import hoy
from app.models import RutinaSlot, Serie, SlotAlternativa
from tests.ayudas import entrenar

# --- Ayudantes -----------------------------------------------------------


def crear_rutina(cliente, nombre="Push") -> int:
    respuesta = cliente.post("/rutinas", json={"nombre": nombre})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def crear_ejercicio(cliente, grupo_muscular_id, nombre) -> int:
    respuesta = cliente.post(
        "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def ocultar_ejercicio(cliente, ejercicio_id) -> None:
    assert cliente.delete(f"/ejercicios/{ejercicio_id}?modo=ocultar").status_code == 204


def cuerpo_de_hueco(principal, series=4, reps=(6, 10), **campos) -> dict:
    """Sin `orden` ni `alternativa_ids` salvo que vengan en `campos`."""
    return {
        "ejercicio_principal_id": principal,
        "series_objetivo": series,
        "reps_min": reps[0],
        "reps_max": reps[1],
        **campos,
    }


def anadir_hueco(cliente, rutina_id, principal, **campos):
    """POST del hueco; devuelve la respuesta entera, para mirar el código."""
    return cliente.post(f"/rutinas/{rutina_id}/slots", json=cuerpo_de_hueco(principal, **campos))


def hueco_creado(cliente, rutina_id, principal, **campos) -> dict:
    respuesta = anadir_hueco(cliente, rutina_id, principal, **campos)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def editar_hueco(cliente, rutina_id, slot_id, principal, orden=1, **campos):
    return cliente.put(
        f"/rutinas/{rutina_id}/slots/{slot_id}",
        json=cuerpo_de_hueco(principal, orden=orden, **campos),
    )


def comodines(cliente, rutina_id, slot_id) -> list[int]:
    """Los comodines del hueco, en el orden en que los devuelve la API."""
    hueco = next(
        h for h in cliente.get(f"/rutinas/{rutina_id}").json()["slots"] if h["id"] == slot_id
    )
    return [c["id"] for c in hueco["alternativas"]]


def filas_de_comodines(sesion_bd, slot_id) -> dict[int, int]:
    """`ejercicio_id → id de la fila` de los comodines del hueco, leídos de la base:
    para saber si una fila se conservó o se borró y se volvió a crear.
    """
    sesion_bd.expire_all()
    return dict(
        sesion_bd.execute(
            select(SlotAlternativa.ejercicio_id, SlotAlternativa.id).where(
                SlotAlternativa.slot_id == slot_id
            )
        ).all()
    )


def huecos_guardados(sesion_bd) -> tuple[int, int]:
    """Cuántos huecos y cuántos comodines hay en la base, de quien sea."""
    sesion_bd.expire_all()
    return tuple(
        sesion_bd.scalar(select(func.count()).select_from(modelo))
        for modelo in (RutinaSlot, SlotAlternativa)
    )


@pytest.fixture
def ejercicios(cliente, grupo_muscular_id) -> dict[str, int]:
    """Cinco ejercicios propios, por nombre."""
    return {
        nombre: crear_ejercicio(cliente, grupo_muscular_id, nombre)
        for nombre in ("Press", "Aperturas", "Fondos", "Cruces", "Elevaciones")
    }


# --- POST: el orden automático ----------------------------------------------


@pytest.mark.parametrize("campos", [{}, {"orden": None}], ids=["sin orden", "orden nulo"])
def test_sin_orden_el_primer_hueco_de_una_rutina_va_el_1(cliente, ejercicios, campos):
    rutina = crear_rutina(cliente)

    hueco = hueco_creado(cliente, rutina, ejercicios["Press"], **campos)

    assert hueco["orden"] == 1


def test_sin_orden_el_hueco_va_detras_tambien_de_los_ocultos(cliente, ejercicios):
    """Si contara solo los visibles, saldría el 3 y chocaría con el oculto (o, al
    mostrarlo, habría dos en el mismo sitio).
    """
    rutina = crear_rutina(cliente)
    hueco_creado(cliente, rutina, ejercicios["Press"], orden=1)
    hueco_creado(cliente, rutina, ejercicios["Aperturas"], orden=2)
    oculto = hueco_creado(cliente, rutina, ejercicios["Fondos"], orden=3)["id"]
    assert cliente.delete(f"/rutinas/{rutina}/slots/{oculto}?modo=ocultar").status_code == 204

    nuevo = hueco_creado(cliente, rutina, ejercicios["Cruces"])

    assert nuevo["orden"] == 4
    assert cliente.post(f"/rutinas/{rutina}/slots/{oculto}/mostrar").status_code == 200
    assert [h["orden"] for h in cliente.get(f"/rutinas/{rutina}").json()["slots"]] == [1, 2, 3, 4]


def test_sin_orden_el_hueco_va_detras_del_mayor_aunque_haya_hueco_libre_antes(cliente, ejercicios):
    rutina = crear_rutina(cliente)
    hueco_creado(cliente, rutina, ejercicios["Press"], orden=5)

    assert hueco_creado(cliente, rutina, ejercicios["Aperturas"])["orden"] == 6


def test_con_orden_explicito_se_respeta_y_choca_tambien_con_un_oculto(cliente, ejercicios):
    rutina = crear_rutina(cliente)
    oculto = hueco_creado(cliente, rutina, ejercicios["Press"], orden=7)["id"]
    assert cliente.delete(f"/rutinas/{rutina}/slots/{oculto}?modo=ocultar").status_code == 204

    assert hueco_creado(cliente, rutina, ejercicios["Aperturas"], orden=3)["orden"] == 3
    respuesta = anadir_hueco(cliente, rutina, ejercicios["Fondos"], orden=7)
    assert respuesta.status_code == 409
    assert "orden=7" in respuesta.json()["detail"]


@pytest.mark.parametrize("oculto", [False, True], ids=["visible", "oculto"])
def test_sin_orden_con_el_100_ocupado_da_409_y_no_crea_nada(cliente, sesion_bd, ejercicios, oculto):
    """Si diera 101, ese hueco ya no se podría editar: el PUT exige `orden <= 100`."""
    rutina = crear_rutina(cliente)
    ultimo = hueco_creado(cliente, rutina, ejercicios["Press"], orden=100)["id"]
    if oculto:
        assert cliente.delete(f"/rutinas/{rutina}/slots/{ultimo}?modo=ocultar").status_code == 204

    respuesta = anadir_hueco(
        cliente, rutina, ejercicios["Aperturas"], alternativa_ids=[ejercicios["Fondos"]]
    )

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"] == "Esta rutina no admite más ejercicios"
    assert huecos_guardados(sesion_bd) == (1, 0)


def test_una_rutina_creada_con_100_huecos_no_admite_otro_sin_orden(
    cliente, sesion_bd, ejercicio_predefinido_id
):
    """El tope de `POST /rutinas` y el del orden automático encajan: lleno es lleno."""
    hueco = cuerpo_de_hueco(ejercicio_predefinido_id)
    rutina = cliente.post("/rutinas", json={"nombre": "Larga", "slots": [hueco] * 100}).json()

    assert anadir_hueco(cliente, rutina["id"], ejercicio_predefinido_id).status_code == 409
    assert huecos_guardados(sesion_bd) == (100, 0)


def test_el_orden_automatico_no_cuenta_los_huecos_de_otra_rutina(cliente, ejercicios):
    """Pull tiene un hueco en el 100: si contara, Push estaría «llena» y daría 409."""
    pull = crear_rutina(cliente, "Pull")
    hueco_creado(cliente, pull, ejercicios["Press"], orden=100)
    push = crear_rutina(cliente, "Push")

    assert hueco_creado(cliente, push, ejercicios["Aperturas"])["orden"] == 1


# --- La ruta tiene que cuadrar -------------------------------------------------


def test_un_hueco_no_se_modifica_por_la_ruta_de_otra_rutina(cliente, sesion_bd, ejercicios):
    """El hueco es de Push: si la ruta no se comprobara, se podría editar o borrar
    "desde" Pull.
    """
    push = crear_rutina(cliente, "Push")
    pull = crear_rutina(cliente, "Pull")
    hueco = hueco_creado(cliente, push, ejercicios["Press"], orden=1)

    editado = editar_hueco(cliente, pull, hueco["id"], ejercicios["Aperturas"], series=2)
    borrado = cliente.delete(f"/rutinas/{pull}/slots/{hueco['id']}")

    assert (editado.status_code, borrado.status_code) == (404, 404)
    [guardado] = cliente.get(f"/rutinas/{push}").json()["slots"]
    assert (guardado["id"], guardado["ejercicio_principal"]["id"], guardado["series_objetivo"]) == (
        hueco["id"],
        ejercicios["Press"],
        4,
    )
    assert cliente.get(f"/rutinas/{pull}").json()["slots"] == []


# --- POST: con sus comodines --------------------------------------------------


def test_un_hueco_nuevo_se_crea_con_sus_comodines_en_el_orden_enviado(
    cliente, ejercicios, ejercicio_predefinido_id
):
    rutina = crear_rutina(cliente)
    lista = [ejercicios["Fondos"], ejercicio_predefinido_id, ejercicios["Aperturas"]]

    hueco = hueco_creado(cliente, rutina, ejercicios["Press"], alternativa_ids=lista)

    assert [c["id"] for c in hueco["alternativas"]] == lista
    assert comodines(cliente, rutina, hueco["id"]) == lista


@pytest.mark.parametrize("caso", ["oculto", "inexistente"])
def test_un_hueco_nuevo_con_un_comodin_que_no_vale_da_404_y_no_se_crea(
    cliente, sesion_bd, ejercicios, caso
):
    rutina = crear_rutina(cliente)
    malo = 999_999
    if caso == "oculto":
        malo = ejercicios["Cruces"]
        ocultar_ejercicio(cliente, malo)

    respuesta = anadir_hueco(
        cliente, rutina, ejercicios["Press"], alternativa_ids=[ejercicios["Fondos"], malo]
    )

    assert respuesta.status_code == 404
    assert huecos_guardados(sesion_bd) == (0, 0)


@pytest.mark.parametrize(
    "caso, lo_que_dice",
    [
        ("igual al principal", "Un comodín no puede ser el ejercicio principal"),
        ("repetido", "Hay comodines repetidos"),
    ],
)
def test_un_hueco_nuevo_con_comodines_incoherentes_da_422(
    cliente, sesion_bd, ejercicios, caso, lo_que_dice
):
    rutina = crear_rutina(cliente)
    press, fondos = ejercicios["Press"], ejercicios["Fondos"]
    lista = {"igual al principal": [fondos, press], "repetido": [fondos, fondos]}[caso]

    respuesta = anadir_hueco(cliente, rutina, press, alternativa_ids=lista)

    assert respuesta.status_code == 422
    assert lo_que_dice in str(respuesta.json()["detail"])
    assert huecos_guardados(sesion_bd) == (0, 0)


# --- PUT: sin lista de comodines, como antes -------------------------------


@pytest.mark.parametrize("campos", [{}, {"alternativa_ids": None}], ids=["sin lista", "nula"])
def test_editar_un_hueco_sin_lista_de_comodines_no_los_toca(cliente, sesion_bd, ejercicios, campos):
    rutina = crear_rutina(cliente)
    lista = [ejercicios["Fondos"], ejercicios["Cruces"]]
    slot = hueco_creado(cliente, rutina, ejercicios["Press"], alternativa_ids=lista)["id"]
    filas = filas_de_comodines(sesion_bd, slot)

    respuesta = editar_hueco(cliente, rutina, slot, ejercicios["Aperturas"], series=2, **campos)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["series_objetivo"] == 2
    assert [c["id"] for c in respuesta.json()["alternativas"]] == lista
    assert filas_de_comodines(sesion_bd, slot) == filas


def test_con_la_lista_nula_sigue_sin_poder_pasar_un_comodin_a_principal(cliente, ejercicios):
    """Sin lista nueva, el comodín seguiría ahí: acabaría siendo las dos cosas. (Sin
    el campo lo cubre `test_un_comodin_no_puede_pasar_a_principal_de_su_mismo_hueco`.)
    """
    rutina = crear_rutina(cliente)
    fondos = ejercicios["Fondos"]
    slot = hueco_creado(cliente, rutina, ejercicios["Press"], alternativa_ids=[fondos])["id"]

    respuesta = editar_hueco(cliente, rutina, slot, fondos, alternativa_ids=None)

    assert respuesta.status_code == 409
    assert "ya es comodín" in respuesta.json()["detail"]
    assert comodines(cliente, rutina, slot) == [fondos]


# --- PUT: con lista de comodines ----------------------------------------------


def test_la_lista_quita_conserva_y_anade_comodines(cliente, sesion_bd, ejercicios):
    """Salen en orden de alta: primero el conservado y después el nuevo, aunque la
    lista los mande al revés.
    """
    rutina = crear_rutina(cliente)
    aperturas, fondos, cruces = ejercicios["Aperturas"], ejercicios["Fondos"], ejercicios["Cruces"]
    slot = hueco_creado(cliente, rutina, ejercicios["Press"], alternativa_ids=[aperturas, fondos])[
        "id"
    ]
    fila_de_fondos = filas_de_comodines(sesion_bd, slot)[fondos]

    respuesta = editar_hueco(
        cliente, rutina, slot, ejercicios["Press"], alternativa_ids=[cruces, fondos]
    )

    assert respuesta.status_code == 200, respuesta.text
    assert [c["id"] for c in respuesta.json()["alternativas"]] == [fondos, cruces]
    assert comodines(cliente, rutina, slot) == [fondos, cruces]
    filas = filas_de_comodines(sesion_bd, slot)
    assert set(filas) == {fondos, cruces}
    assert filas[fondos] == fila_de_fondos


def test_la_lista_vacia_quita_todos_los_comodines(cliente, sesion_bd, ejercicios):
    rutina = crear_rutina(cliente)
    lista = [ejercicios["Aperturas"], ejercicios["Fondos"]]
    slot = hueco_creado(cliente, rutina, ejercicios["Press"], alternativa_ids=lista)["id"]

    respuesta = editar_hueco(cliente, rutina, slot, ejercicios["Press"], alternativa_ids=[])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["alternativas"] == []
    assert filas_de_comodines(sesion_bd, slot) == {}


def test_intercambiar_principal_y_comodin_en_una_sola_peticion(cliente, ejercicios):
    """Con la lista nueva el comodín deja de serlo en la misma petición: el 409 de
    "ya es comodín" no aplica.
    """
    rutina = crear_rutina(cliente)
    press, fondos = ejercicios["Press"], ejercicios["Fondos"]
    slot = hueco_creado(cliente, rutina, press, alternativa_ids=[fondos])["id"]

    respuesta = editar_hueco(cliente, rutina, slot, fondos, alternativa_ids=[press])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["ejercicio_principal"]["id"] == fondos
    assert [c["id"] for c in respuesta.json()["alternativas"]] == [press]


@pytest.mark.parametrize("al_reves", [False, True], ids=["misma lista", "misma lista al revés"])
def test_mandar_los_mismos_comodines_conserva_sus_filas(cliente, sesion_bd, ejercicios, al_reves):
    """La trampa del `UNIQUE(slot_id, ejercicio_id)`: si el endpoint reconstruyera
    la lista (`slot.slot_alternativas = [SlotAlternativa(...) ...]`), SQLAlchemy
    insertaría las filas nuevas antes de borrar las viejas y la base daría un 500.
    Y si alguien lo arreglara reconstruyéndola con un `flush()` en medio, ya no
    habría 500, pero las filas cambiarían de id: lo caza la última comprobación.
    """
    rutina = crear_rutina(cliente)
    lista = [ejercicios["Aperturas"], ejercicios["Fondos"], ejercicios["Cruces"]]
    slot = hueco_creado(cliente, rutina, ejercicios["Press"], alternativa_ids=lista)["id"]
    filas = filas_de_comodines(sesion_bd, slot)

    respuesta = editar_hueco(
        cliente,
        rutina,
        slot,
        ejercicios["Press"],
        series=5,
        alternativa_ids=lista[::-1] if al_reves else lista,
    )

    assert respuesta.status_code == 200, respuesta.text
    # El orden de la lista no reordena los que ya estaban.
    assert [c["id"] for c in respuesta.json()["alternativas"]] == lista
    assert respuesta.json()["series_objetivo"] == 5
    assert filas_de_comodines(sesion_bd, slot) == filas


def test_un_comodin_ya_oculto_se_conserva_pero_no_se_puede_volver_a_poner(
    cliente, sesion_bd, ejercicios
):
    """ "Corregir sí, elegir algo oculto no": conservarlo no es elegirlo, pero
    volver a ponerlo después de quitarlo sí.
    """
    rutina = crear_rutina(cliente)
    press, fondos, cruces = ejercicios["Press"], ejercicios["Fondos"], ejercicios["Cruces"]
    slot = hueco_creado(cliente, rutina, press, alternativa_ids=[fondos])["id"]
    ocultar_ejercicio(cliente, fondos)

    conservado = editar_hueco(cliente, rutina, slot, press, alternativa_ids=[fondos, cruces])
    assert conservado.status_code == 200, conservado.text
    assert [c["id"] for c in conservado.json()["alternativas"]] == [fondos, cruces]

    quitado = editar_hueco(cliente, rutina, slot, press, alternativa_ids=[cruces])
    assert quitado.status_code == 200, quitado.text

    repuesto = editar_hueco(cliente, rutina, slot, press, alternativa_ids=[cruces, fondos])
    assert repuesto.status_code == 404
    assert comodines(cliente, rutina, slot) == [cruces]


def test_con_el_principal_oculto_se_le_puede_anadir_un_comodin(cliente, ejercicios):
    rutina = crear_rutina(cliente)
    press = ejercicios["Press"]
    slot = hueco_creado(cliente, rutina, press)["id"]
    ocultar_ejercicio(cliente, press)

    respuesta = editar_hueco(cliente, rutina, slot, press, alternativa_ids=[ejercicios["Fondos"]])

    assert respuesta.status_code == 200, respuesta.text
    assert [c["id"] for c in respuesta.json()["alternativas"]] == [ejercicios["Fondos"]]


def test_quitar_un_comodin_con_series_no_borra_las_series(cliente, sesion_bd, ejercicios):
    """Las series apuntan al ejercicio y al hueco, no a la fila del comodín."""
    rutina = crear_rutina(cliente)
    press, fondos = ejercicios["Press"], ejercicios["Fondos"]
    slot = hueco_creado(cliente, rutina, press, alternativa_ids=[fondos])["id"]
    sesion = entrenar(cliente, hoy(), rutina).json()["id"]
    serie = {"ejercicio_id": fondos, "slot_id": slot, "numero_serie": 1, "peso": 40}
    respuesta = cliente.post(f"/entrenamientos/{sesion}/series", json={**serie, "repeticiones": 10})
    assert respuesta.status_code == 201, respuesta.text
    serie_id = respuesta.json()["id"]

    respuesta = editar_hueco(cliente, rutina, slot, press, alternativa_ids=[])

    assert respuesta.status_code == 200, respuesta.text
    sesion_bd.expire_all()
    guardada = sesion_bd.get(Serie, serie_id)
    assert (guardada.slot_id, guardada.ejercicio_id) == (slot, fondos)
    assert len(cliente.get(f"/entrenamientos/{sesion}").json()["series"]) == 1


@pytest.mark.parametrize("que", ["hueco", "rutina"])
def test_no_se_cambian_los_comodines_de_un_hueco_oculto_ni_de_una_rutina_oculta(
    cliente, sesion_bd, ejercicios, que
):
    rutina = crear_rutina(cliente)
    press, fondos = ejercicios["Press"], ejercicios["Fondos"]
    slot = hueco_creado(cliente, rutina, press, alternativa_ids=[fondos])["id"]
    ruta = f"/rutinas/{rutina}/slots/{slot}" if que == "hueco" else f"/rutinas/{rutina}"
    assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 204
    filas = filas_de_comodines(sesion_bd, slot)

    for lista in ([], [ejercicios["Cruces"]]):
        assert editar_hueco(cliente, rutina, slot, press, alternativa_ids=lista).status_code == 409

    assert filas_de_comodines(sesion_bd, slot) == filas


@pytest.mark.parametrize(
    "caso, lo_que_dice",
    [
        ("igual al principal", "Un comodín no puede ser el ejercicio principal"),
        ("repetido", "Hay comodines repetidos"),
    ],
)
def test_editar_con_comodines_incoherentes_da_422(
    cliente, sesion_bd, ejercicios, caso, lo_que_dice
):
    rutina = crear_rutina(cliente)
    press, fondos = ejercicios["Press"], ejercicios["Fondos"]
    slot = hueco_creado(cliente, rutina, press, alternativa_ids=[fondos])["id"]
    filas = filas_de_comodines(sesion_bd, slot)
    lista = {"igual al principal": [fondos, press], "repetido": [fondos, fondos]}[caso]

    respuesta = editar_hueco(cliente, rutina, slot, press, alternativa_ids=lista)

    assert respuesta.status_code == 422
    assert lo_que_dice in str(respuesta.json()["detail"])
    assert filas_de_comodines(sesion_bd, slot) == filas


def test_un_comodin_que_no_vale_en_la_lista_no_cambia_nada_del_hueco(
    cliente, sesion_bd, ejercicios
):
    """Ni los comodines buenos de la misma lista ni el resto de campos: el 404
    tiene que llegar antes de tocar nada.
    """
    rutina = crear_rutina(cliente)
    press, fondos = ejercicios["Press"], ejercicios["Fondos"]
    slot = hueco_creado(cliente, rutina, press, alternativa_ids=[fondos])["id"]
    filas = filas_de_comodines(sesion_bd, slot)

    respuesta = editar_hueco(
        cliente, rutina, slot, press, series=9, alternativa_ids=[ejercicios["Cruces"], 999_999]
    )

    assert respuesta.status_code == 404
    assert filas_de_comodines(sesion_bd, slot) == filas
    assert cliente.get(f"/rutinas/{rutina}").json()["slots"][0]["series_objetivo"] == 4
