"""Tests de lo que se hace con una rutina entera: duplicarla, reordenar sus
huecos y listarlas.

Duplicar es la forma de que una rutina diverja sin cambiar los programas donde
está; reordenar existe porque con PUT sueltos intercambiar dos huecos choca a
medias con `UNIQUE(rutina_id, orden)`.
"""

import pytest

from app.fechas import hoy
from app.models import Rutina
from tests.ayudas import consultas_de, entrenar, hueco_en_bd, rutina_en_bd

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


def crear_hueco(cliente, rutina_id, ejercicio_id, orden, series=4, reps=(6, 10)) -> int:
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": orden,
            "series_objetivo": series,
            "reps_min": reps[0],
            "reps_max": reps[1],
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def anadir_comodin(cliente, rutina_id, slot_id, ejercicio_id) -> None:
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": ejercicio_id}
    )
    assert respuesta.status_code in (200, 201), respuesta.text


def ocultar_hueco(cliente, rutina_id, slot_id) -> None:
    respuesta = cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}?modo=ocultar")
    assert respuesta.status_code == 204


def duplicar(cliente, rutina_id):
    return cliente.post(f"/rutinas/{rutina_id}/duplicar")


def nombre_de_la_copia(cliente, rutina_id) -> str:
    respuesta = duplicar(cliente, rutina_id)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["nombre"]


def ordenar(cliente, rutina_id, slot_ids):
    return cliente.put(f"/rutinas/{rutina_id}/orden", json={"slot_ids": slot_ids})


def ordenes(cliente, rutina_id) -> dict[int, int]:
    """El `orden` de cada hueco de la rutina, también de los ocultos."""
    return {h["id"]: h["orden"] for h in cliente.get(f"/rutinas/{rutina_id}").json()["slots"]}


def lo_que_tiene(rutina) -> list[tuple]:
    """Lo que se copia de cada hueco, sin ids: para comparar original y copia."""
    return [
        (
            hueco["orden"],
            hueco["ejercicio_principal"]["id"],
            hueco["series_objetivo"],
            hueco["reps_min"],
            hueco["reps_max"],
            [comodin["id"] for comodin in hueco["alternativas"]],
        )
        for hueco in rutina["slots"]
    ]


# --- Duplicar: el nombre --------------------------------------------------


def test_duplicar_numera_las_copias_como_windows(cliente):
    push = crear_rutina(cliente, "Push")

    nombres = [nombre_de_la_copia(cliente, push) for _ in range(3)]

    assert nombres == ["Push - copia", "Push - copia (2)", "Push - copia (3)"]


def test_duplicar_una_copia_le_anade_otro_sufijo(cliente):
    copia = duplicar(cliente, crear_rutina(cliente, "Push")).json()["id"]

    assert nombre_de_la_copia(cliente, copia) == "Push - copia - copia"


def test_el_nombre_de_la_copia_no_distingue_mayusculas(cliente):
    push = crear_rutina(cliente, "Push")
    crear_rutina(cliente, "PUSH - COPIA")

    assert nombre_de_la_copia(cliente, push) == "Push - copia (2)"


def test_el_nombre_de_la_copia_no_repite_el_de_una_rutina_oculta(cliente):
    """Si no, al volver a mostrar la oculta habría dos rutinas con el mismo nombre."""
    push = crear_rutina(cliente, "Push")
    oculta = crear_rutina(cliente, "Push - copia")
    assert cliente.delete(f"/rutinas/{oculta}?modo=ocultar").status_code == 204

    assert nombre_de_la_copia(cliente, push) == "Push - copia (2)"


def test_un_nombre_de_100_caracteres_se_recorta_y_conserva_el_sufijo(cliente):
    larga = crear_rutina(cliente, "a" * 100)

    primera, segunda = nombre_de_la_copia(cliente, larga), nombre_de_la_copia(cliente, larga)

    assert primera == "a" * 92 + " - copia"
    assert segunda == "a" * 88 + " - copia (2)"
    assert len(primera) == len(segunda) == 100


def test_al_recortar_el_nombre_no_queda_un_espacio_antes_del_sufijo(cliente):
    """El corte cae justo detrás de un espacio: sin el `rstrip` saldría
    «aaa  - copia», con dos espacios.
    """
    rutina = crear_rutina(cliente, "a" * 91 + " " + "b" * 8)

    assert nombre_de_la_copia(cliente, rutina) == "a" * 91 + " - copia"


# --- Duplicar: qué se copia -------------------------------------------------


def test_la_copia_lleva_los_huecos_visibles_con_sus_comodines(cliente, grupo_muscular_id):
    """Los ocultos no se copian. Un ejercicio oculto (de principal o de comodín) sí:
    la copia es fiel a lo que se ve (decisión del autor).
    """
    ejercicio = {
        nombre: crear_ejercicio(cliente, grupo_muscular_id, nombre)
        for nombre in ("Press", "Aperturas", "Fondos", "Cruces", "Elevaciones")
    }
    push = crear_rutina(cliente, "Push")
    primero = crear_hueco(cliente, push, ejercicio["Press"], orden=1, series=5, reps=(3, 5))
    anadir_comodin(cliente, push, primero, ejercicio["Aperturas"])
    oculto = crear_hueco(cliente, push, ejercicio["Fondos"], orden=2)
    anadir_comodin(cliente, push, oculto, ejercicio["Aperturas"])
    ocultar_hueco(cliente, push, oculto)
    tercero = crear_hueco(cliente, push, ejercicio["Cruces"], orden=3, series=3, reps=(12, 15))
    anadir_comodin(cliente, push, tercero, ejercicio["Elevaciones"])
    anadir_comodin(cliente, push, tercero, ejercicio["Aperturas"])
    for nombre in ("Cruces", "Elevaciones"):
        assert cliente.delete(f"/ejercicios/{ejercicio[nombre]}?modo=ocultar").status_code == 204

    respuesta = duplicar(cliente, push)

    assert respuesta.status_code == 201, respuesta.text
    copia = respuesta.json()
    assert lo_que_tiene(copia) == [
        (1, ejercicio["Press"], 5, 3, 5, [ejercicio["Aperturas"]]),
        (3, ejercicio["Cruces"], 3, 12, 15, [ejercicio["Elevaciones"], ejercicio["Aperturas"]]),
    ]
    assert all(hueco["oculto_desde"] is None for hueco in copia["slots"])
    assert {h["id"] for h in copia["slots"]}.isdisjoint({primero, oculto, tercero})
    # El original, intacto: con su hueco oculto.
    assert len(cliente.get(f"/rutinas/{push}").json()["slots"]) == 3


def test_la_copia_sale_sin_usar(cliente, grupo_muscular_id):
    """Ni en los días del programa, ni con las sesiones ni los días planificados
    del original.
    """
    press = crear_ejercicio(cliente, grupo_muscular_id, "Press")
    push = crear_rutina(cliente, "Push")
    hueco = crear_hueco(cliente, push, press, orden=1)
    programa = cliente.post(
        "/programas", json={"nombre": "PPL", "dias": [{"dia_semana": 1, "rutina_id": push}]}
    ).json()
    sesion = entrenar(cliente, hoy(), push).json()["id"]
    serie = {
        "ejercicio_id": press,
        "slot_id": hueco,
        "numero_serie": 1,
        "peso": 60,
        "repeticiones": 8,
    }
    assert cliente.post(f"/entrenamientos/{sesion}/series", json=serie).status_code == 201

    copia = duplicar(cliente, push).json()

    assert copia["num_programas"] == 0
    assert copia["oculto_desde"] is None
    assert cliente.get("/entrenamientos", params={"rutina_id": copia["id"]}).json() == []
    assert [
        d["rutina"]["id"] for d in cliente.get(f"/programas/{programa['id']}").json()["dias"]
    ] == [push]
    assert cliente.get(f"/rutinas/{push}").json()["num_programas"] == 1
    aviso = cliente.get(f"/rutinas/{copia['id']}/aviso-de-borrado").json()
    assert (aviso["sesiones"], aviso["dias_de_programa"], aviso["toco_dias_pasados"]) == (
        0,
        0,
        False,
    )


def test_editar_la_copia_no_cambia_el_original(cliente, grupo_muscular_id):
    press = crear_ejercicio(cliente, grupo_muscular_id, "Press")
    aperturas = crear_ejercicio(cliente, grupo_muscular_id, "Aperturas")
    fondos = crear_ejercicio(cliente, grupo_muscular_id, "Fondos")
    push = crear_rutina(cliente, "Push")
    hueco = crear_hueco(cliente, push, press, orden=1)
    anadir_comodin(cliente, push, hueco, aperturas)
    antes = cliente.get(f"/rutinas/{push}").json()
    copia = duplicar(cliente, push).json()
    ruta = f"/rutinas/{copia['id']}"
    hueco_copia = copia["slots"][0]["id"]

    assert cliente.put(ruta, json={"nombre": "Push B"}).status_code == 200
    assert (
        cliente.put(
            f"{ruta}/slots/{hueco_copia}",
            json={
                "ejercicio_principal_id": fondos,
                "orden": 2,
                "series_objetivo": 2,
                "reps_min": 1,
                "reps_max": 2,
            },
        ).status_code
        == 200
    )
    assert cliente.delete(f"{ruta}/slots/{hueco_copia}/alternativas/{aperturas}").status_code == 204
    crear_hueco(cliente, copia["id"], press, orden=1)

    despues = cliente.get(f"/rutinas/{push}").json()
    assert (despues["nombre"], lo_que_tiene(despues)) == (antes["nombre"], lo_que_tiene(antes))


def test_se_puede_duplicar_una_rutina_oculta_y_la_copia_sale_visible(cliente, grupo_muscular_id):
    push = crear_rutina(cliente, "Push")
    crear_hueco(cliente, push, crear_ejercicio(cliente, grupo_muscular_id, "Press"), orden=1)
    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    respuesta = duplicar(cliente, push)

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["oculto_desde"] is None
    assert len(respuesta.json()["slots"]) == 1
    assert [r["nombre"] for r in cliente.get("/rutinas").json()] == ["Push - copia"]
    assert cliente.get(f"/rutinas/{push}").json()["oculto_desde"] == hoy().isoformat()


def test_duplicar_una_rutina_inexistente_da_404(cliente):
    assert duplicar(cliente, 999_999).status_code == 404


# --- Reordenar los huecos ---------------------------------------------------


@pytest.fixture
def tres_huecos(cliente, grupo_muscular_id) -> tuple[int, list[int]]:
    """Una rutina con tres huecos visibles, de orden 1, 2 y 3."""
    rutina = crear_rutina(cliente, "Push")
    huecos = [
        crear_hueco(cliente, rutina, crear_ejercicio(cliente, grupo_muscular_id, nombre), orden)
        for orden, nombre in enumerate(("Press", "Aperturas", "Fondos"), start=1)
    ]
    return rutina, huecos


def test_intercambiar_dos_huecos_seguidos(cliente, tres_huecos):
    """Con dos PUT sueltos daría 409: el primero choca con el orden del otro."""
    rutina, (a, b, c) = tres_huecos

    respuesta = ordenar(cliente, rutina, [b, a, c])

    assert respuesta.status_code == 200, respuesta.text
    assert [(h["id"], h["orden"]) for h in respuesta.json()["slots"]] == [(b, 1), (a, 2), (c, 3)]
    assert ordenes(cliente, rutina) == {b: 1, a: 2, c: 3}


def test_la_respuesta_llega_en_el_orden_nuevo(cliente, tres_huecos):
    rutina, (a, b, c) = tres_huecos

    respuesta = ordenar(cliente, rutina, [c, a, b])

    assert [h["id"] for h in respuesta.json()["slots"]] == [c, a, b]


def test_reordenar_con_huecos_ocultos_los_deja_en_su_sitio(cliente, grupo_muscular_id):
    """Los visibles se reparten los `orden` que ya tenían; el oculto conserva el
    suyo, así que al mostrarlo no choca con nadie.
    """
    rutina = crear_rutina(cliente, "Push")
    a, oculto, b, c = (
        crear_hueco(cliente, rutina, crear_ejercicio(cliente, grupo_muscular_id, nombre), orden)
        for orden, nombre in ((1, "Press"), (2, "Fondos"), (5, "Aperturas"), (7, "Cruces"))
    )
    ocultar_hueco(cliente, rutina, oculto)

    respuesta = ordenar(cliente, rutina, [c, b, a])

    assert respuesta.status_code == 200, respuesta.text
    assert ordenes(cliente, rutina) == {c: 1, oculto: 2, b: 5, a: 7}
    assert cliente.post(f"/rutinas/{rutina}/slots/{oculto}/mostrar").status_code == 200
    assert [h["id"] for h in cliente.get(f"/rutinas/{rutina}").json()["slots"]] == [
        c,
        oculto,
        b,
        a,
    ]


def test_reordenar_una_rutina_sin_huecos_no_hace_nada(cliente):
    rutina = crear_rutina(cliente)

    respuesta = ordenar(cliente, rutina, [])

    assert respuesta.status_code == 200
    assert respuesta.json()["slots"] == []


MENSAJE_DE_ORDEN = "Manda todos los huecos visibles de la rutina, cada uno una vez"


@pytest.mark.parametrize(
    "caso",
    ["falta uno", "sobra uno de otra rutina", "uno oculto", "uno que no existe"],
)
def test_reordenar_sin_mandar_exactamente_los_visibles_da_422_y_no_cambia_nada(
    cliente, grupo_muscular_id, caso
):
    rutina = crear_rutina(cliente, "Push")
    a, b, oculto = (
        crear_hueco(cliente, rutina, crear_ejercicio(cliente, grupo_muscular_id, nombre), orden)
        for orden, nombre in ((1, "Press"), (2, "Aperturas"), (3, "Fondos"))
    )
    ocultar_hueco(cliente, rutina, oculto)
    otra = crear_rutina(cliente, "Pull")
    de_otra = crear_hueco(cliente, otra, crear_ejercicio(cliente, grupo_muscular_id, "Remo"), 1)
    slot_ids = {
        "falta uno": [b],
        "sobra uno de otra rutina": [b, a, de_otra],
        "uno oculto": [b, a, oculto],
        "uno que no existe": [b, a, 999_999],
    }[caso]
    antes = ordenes(cliente, rutina)

    respuesta = ordenar(cliente, rutina, slot_ids)

    assert respuesta.status_code == 422
    # El 422 del endpoint, no uno de validación del body.
    assert respuesta.json()["detail"] == MENSAJE_DE_ORDEN
    assert ordenes(cliente, rutina) == antes
    assert ordenes(cliente, otra) == {de_otra: 1}


def test_reordenar_con_un_hueco_repetido_da_422(cliente, tres_huecos):
    """Lo para el body: con el conjunto de ids no se notaría la repetición."""
    rutina, (a, b, c) = tres_huecos

    respuesta = ordenar(cliente, rutina, [a, b, c, a])

    assert respuesta.status_code == 422
    assert "repetidos" in str(respuesta.json()["detail"])
    assert ordenes(cliente, rutina) == {a: 1, b: 2, c: 3}


def test_una_rutina_oculta_no_se_puede_reordenar(cliente, tres_huecos):
    rutina, (a, b, c) = tres_huecos
    assert cliente.delete(f"/rutinas/{rutina}?modo=ocultar").status_code == 204

    assert ordenar(cliente, rutina, [c, b, a]).status_code == 409
    assert ordenes(cliente, rutina) == {a: 1, b: 2, c: 3}


def test_reordenar_una_rutina_inexistente_da_404(cliente):
    assert ordenar(cliente, 999_999, []).status_code == 404


# --- Consultas del listado ------------------------------------------------


def test_listar_rutinas_hace_las_mismas_consultas_con_una_que_con_cinco(cliente, grupo_muscular_id):
    """Sin cargarlos por lotes, serializar los huecos, sus ejercicios, sus
    comodines y en qué programas está haría consultas por cada rutina y cada hueco.
    Cada rutina usa ejercicios suyos: con los mismos, el mapa de identidad de
    SQLAlchemy taparía las consultas de más.
    """

    def rutina_completa(numero) -> None:
        rutina = crear_rutina(cliente, f"Rutina {numero}")
        for orden in (1, 2):
            principal = crear_ejercicio(cliente, grupo_muscular_id, f"Principal {numero}-{orden}")
            comodin = crear_ejercicio(cliente, grupo_muscular_id, f"Comodín {numero}-{orden}")
            hueco = crear_hueco(cliente, rutina, principal, orden)
            anadir_comodin(cliente, rutina, hueco, comodin)
        cliente.post(
            "/programas",
            json={"nombre": f"Programa {numero}", "dias": [{"dia_semana": 1, "rutina_id": rutina}]},
        )

    rutina_completa(1)
    con_una = consultas_de(lambda: cliente.get("/rutinas"))
    for numero in range(2, 6):
        rutina_completa(numero)
    con_cinco = consultas_de(lambda: cliente.get("/rutinas"))

    listado = cliente.get("/rutinas").json()
    assert len(listado) == 5
    assert all(r["num_programas"] == 1 and len(r["slots"]) == 2 for r in listado)
    assert con_cinco == con_una


# --- Datos de otro usuario --------------------------------------------------
# El resto del aislamiento de estos endpoints, en test_aislamiento_por_usuario.py.


def test_duplicar_no_cuenta_los_nombres_de_las_rutinas_de_otro_usuario(
    cliente, sesion_bd, otro_usuario_id
):
    """El nombre se busca libre solo entre las mías: si mirara las de todos, se
    sabría qué nombres usa otro usuario.
    """
    rutina_en_bd(sesion_bd, otro_usuario_id, "Push - copia")
    sesion_bd.commit()
    push = crear_rutina(cliente, "Push")

    assert nombre_de_la_copia(cliente, push) == "Push - copia"


def test_reordenar_con_un_hueco_de_otro_usuario_da_422_sin_tocarlo(
    cliente, sesion_bd, otro_usuario_id, tres_huecos, ejercicio_predefinido_id
):
    """422 y no 404: no confirma que ese id exista."""
    rutina, (a, b, c) = tres_huecos
    ajena = rutina_en_bd(sesion_bd, otro_usuario_id)
    hueco_ajeno = hueco_en_bd(sesion_bd, ajena, ejercicio_predefinido_id)
    sesion_bd.commit()

    respuesta = ordenar(cliente, rutina, [c, b, a, hueco_ajeno])

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == MENSAJE_DE_ORDEN
    sesion_bd.expire_all()
    assert sesion_bd.get(Rutina, ajena).slots[0].orden == 1
    assert ordenes(cliente, rutina) == {a: 1, b: 2, c: 3}
