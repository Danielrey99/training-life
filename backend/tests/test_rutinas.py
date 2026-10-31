"""Tests de lo que se hace con una rutina entera: crearla con sus huecos,
duplicarla, reordenar sus huecos y listarlas.

Crearla de una vez existe porque la pantalla de rutina nueva no guarda nada hasta
Guardar: un fallo a medias no puede dejar una rutina a medias. Duplicar es la
forma de que una rutina diverja sin cambiar los programas donde está; reordenar
existe porque con PUT sueltos intercambiar dos huecos choca a medias con
`UNIQUE(rutina_id, orden)`.
"""

import pytest
from sqlalchemy import func, select

from app.fechas import hoy
from app.models import Rutina, RutinaSlot, SlotAlternativa
from tests.ayudas import (
    alternativa,
    consultas_de,
    crear_ejercicio,
    crear_hueco,
    crear_rutina,
    entrenar,
    ids_de_alternativas,
    objetivo,
    ocultar_hueco,
    poner_alternativas,
)

# --- Ayudantes -----------------------------------------------------------


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
            ids_de_alternativas(hueco),
        )
        for hueco in rutina["slots"]
    ]


def hueco_nuevo(principal, comodines=(), series=4, reps=(6, 10), duracion=None) -> dict:
    """Un hueco dentro del cuerpo de `POST /rutinas`: sin `orden`, que es su posición.
    Cada comodín, un id (con objetivo de repeticiones) o el cuerpo de su alternativa.
    """
    return {
        "ejercicio_principal_id": principal,
        "alternativas": [c if isinstance(c, dict) else alternativa(c) for c in comodines],
        **objetivo(series, reps, duracion),
    }


def filas_guardadas(sesion_bd) -> tuple[int, int, int]:
    """Cuántas rutinas, huecos y comodines hay en la base, también los ocultos:
    para ver que un fallo no ha dejado nada a medias.
    """
    sesion_bd.expire_all()
    return tuple(
        sesion_bd.scalar(select(func.count()).select_from(modelo))
        for modelo in (Rutina, RutinaSlot, SlotAlternativa)
    )


# --- Crear una rutina con sus huecos ----------------------------------------


def test_una_rutina_nueva_sin_huecos_sigue_creandose_vacia(cliente):
    respuesta = cliente.post("/rutinas", json={"nombre": "Push"})

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["slots"] == []
    assert cliente.get(f"/rutinas/{respuesta.json()['id']}").json()["slots"] == []


def test_una_rutina_nueva_guarda_sus_huecos_en_el_orden_de_la_lista(cliente, grupo_muscular_id):
    """El orden sale de la posición en la lista, no de los ids: los ejercicios se
    crean en un orden y se mandan en otro, y los comodines igual.
    """
    a, b, c, d, e, f = (
        crear_ejercicio(cliente, grupo_muscular_id, nombre)
        for nombre in ("Press", "Aperturas", "Fondos", "Cruces", "Elevaciones", "Remo")
    )
    cuerpo = {
        "nombre": "Push",
        "slots": [
            hueco_nuevo(c, comodines=[f, d], series=5, reps=(3, 5)),
            hueco_nuevo(a, series=3, reps=(8, 12)),
            hueco_nuevo(b, comodines=[e], series=2, reps=(15, 20)),
        ],
    }

    respuesta = cliente.post("/rutinas", json=cuerpo)

    assert respuesta.status_code == 201, respuesta.text
    rutina = respuesta.json()
    esperado = [
        (1, c, 5, 3, 5, [f, d]),
        (2, a, 3, 8, 12, []),
        (3, b, 2, 15, 20, [e]),
    ]
    assert lo_que_tiene(rutina) == esperado
    assert rutina["num_programas"] == 0
    assert rutina["oculto_desde"] is None
    assert all(
        h["oculto_desde"] is None and h["rutina_id"] == rutina["id"] for h in rutina["slots"]
    )
    # Y se ha guardado así, no solo respondido.
    assert lo_que_tiene(cliente.get(f"/rutinas/{rutina['id']}").json()) == esperado


def test_una_rutina_nueva_admite_predefinidos_y_el_mismo_ejercicio_en_dos_huecos(
    cliente, grupo_muscular_id, ejercicio_predefinido_id
):
    propio = crear_ejercicio(cliente, grupo_muscular_id, "Prensa")
    cuerpo = {
        "nombre": "Leg",
        "slots": [
            hueco_nuevo(ejercicio_predefinido_id, comodines=[propio]),
            hueco_nuevo(propio, comodines=[ejercicio_predefinido_id]),
            hueco_nuevo(ejercicio_predefinido_id),
        ],
    }

    respuesta = cliente.post("/rutinas", json=cuerpo)

    assert respuesta.status_code == 201, respuesta.text
    assert lo_que_tiene(respuesta.json()) == [
        (1, ejercicio_predefinido_id, 4, 6, 10, [propio]),
        (2, propio, 4, 6, 10, [ejercicio_predefinido_id]),
        (3, ejercicio_predefinido_id, 4, 6, 10, []),
    ]


def test_una_rutina_nueva_admite_100_huecos_justos(cliente, ejercicio_predefinido_id):
    cuerpo = {"nombre": "Larga", "slots": [hueco_nuevo(ejercicio_predefinido_id)] * 100}

    respuesta = cliente.post("/rutinas", json=cuerpo)

    assert respuesta.status_code == 201, respuesta.text
    assert [h["orden"] for h in respuesta.json()["slots"]] == list(range(1, 101))


def test_una_rutina_nueva_con_mas_de_100_huecos_da_422_y_no_crea_nada(
    cliente, sesion_bd, grupo_muscular_id, ejercicio_predefinido_id
):
    """El tope es de `POST /rutinas`. Cada hueco de la lista se valida con el mismo
    esquema que uno suelto: sus datos incoherentes (objetivo, comodines), en
    `test_huecos.py` y `test_objetivos.py`.
    """
    propio = crear_ejercicio(cliente, grupo_muscular_id, "Prensa")
    bien = hueco_nuevo(ejercicio_predefinido_id, comodines=[propio])

    respuesta = cliente.post("/rutinas", json={"nombre": "Push", "slots": [bien] * 101})

    assert respuesta.status_code == 422
    assert "at most 100" in str(respuesta.json()["detail"])
    assert filas_guardadas(sesion_bd) == (0, 0, 0)


@pytest.mark.parametrize("caso", ["principal inexistente", "comodín oculto en el último hueco"])
def test_una_rutina_nueva_con_un_ejercicio_que_no_vale_da_404_y_no_crea_nada(
    cliente, sesion_bd, grupo_muscular_id, ejercicio_predefinido_id, caso
):
    """La atomicidad: los huecos de antes del que falla eran válidos, y aun así no
    puede quedar ni la rutina ni ninguno de ellos.
    """
    propio = crear_ejercicio(cliente, grupo_muscular_id, "Prensa")
    oculto = crear_ejercicio(cliente, grupo_muscular_id, "Hack")
    assert cliente.delete(f"/ejercicios/{oculto}?modo=ocultar").status_code == 204
    bien = hueco_nuevo(ejercicio_predefinido_id, comodines=[propio])
    huecos = {
        "principal inexistente": [hueco_nuevo(999_999), bien],
        "comodín oculto en el último hueco": [
            bien,
            bien,
            hueco_nuevo(propio, comodines=[ejercicio_predefinido_id, oculto]),
        ],
    }[caso]

    respuesta = cliente.post("/rutinas", json={"nombre": "Leg", "slots": huecos})

    assert (respuesta.status_code, respuesta.json()["detail"]) == (404, "Ejercicio no encontrado")
    assert filas_guardadas(sesion_bd) == (0, 0, 0)
    assert cliente.get("/rutinas").json() == []


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
    poner_alternativas(cliente, push, primero, [ejercicio["Aperturas"]])
    oculto = crear_hueco(cliente, push, ejercicio["Fondos"], orden=2)
    poner_alternativas(cliente, push, oculto, [ejercicio["Aperturas"]])
    ocultar_hueco(cliente, push, oculto)
    tercero = crear_hueco(cliente, push, ejercicio["Cruces"], orden=3, series=3, reps=(12, 15))
    poner_alternativas(cliente, push, tercero, [ejercicio["Elevaciones"], ejercicio["Aperturas"]])
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
    poner_alternativas(cliente, push, hueco, [aperturas])
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
    assert poner_alternativas(cliente, copia["id"], hueco_copia, [])["alternativas"] == []
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
    ["falta uno", "sobra uno de otra rutina", "uno oculto"],
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

    respuesta = ordenar(cliente, rutina, [c, b, a])

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"] == "Esta rutina está oculta. Muéstrala antes de cambiarla."
    assert ordenes(cliente, rutina) == {a: 1, b: 2, c: 3}


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
            poner_alternativas(cliente, rutina, hueco, [comodin])
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
