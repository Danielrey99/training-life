"""Tests de la ficha de un ejercicio: `GET /ejercicios/{id}/donde-se-usa`
(«Rutinas donde se usa»), y que una nota solo se alcanza por la ruta de su ejercicio.

El aviso y el borrado de un ejercicio están en `test_borrados.py`, y lo que no se
ve de otro usuario, en `test_aislamiento_por_usuario.py`.
"""

from datetime import date

import pytest

from app.models import ProgramaDia
from tests.ayudas import consultas_de
from tests.semana import HOY

# --- Ayudantes ---------------------------------------------------------------


def crear_ejercicio(cliente, grupo_muscular_id, nombre) -> int:
    respuesta = cliente.post(
        "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def hueco(principal, *comodines) -> dict:
    return {
        "ejercicio_principal_id": principal,
        "series_objetivo": 3,
        "reps_min": 6,
        "reps_max": 10,
        "alternativa_ids": list(comodines),
    }


def crear_rutina(cliente, nombre, *huecos) -> tuple[int, list[int]]:
    """La rutina con sus huecos, en ese orden; devuelve su id y los de los huecos."""
    respuesta = cliente.post("/rutinas", json={"nombre": nombre, "slots": list(huecos)})
    assert respuesta.status_code == 201, respuesta.text
    rutina = respuesta.json()
    return rutina["id"], [slot["id"] for slot in sorted(rutina["slots"], key=lambda s: s["orden"])]


def ocultar_hueco(cliente, rutina_id, slot_id) -> None:
    ruta = f"/rutinas/{rutina_id}/slots/{slot_id}?modo=ocultar"
    assert cliente.delete(ruta).status_code == 204


def crear_programa(cliente, nombre, dias: dict[int, int], activar=False) -> int:
    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": nombre,
            "activar": activar,
            "dias": [{"dia_semana": d, "rutina_id": r} for d, r in dias.items()],
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def donde_se_usa(cliente, ejercicio_id) -> list[dict]:
    respuesta = cliente.get(f"/ejercicios/{ejercicio_id}/donde-se-usa")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


@pytest.fixture
def ejercicios(cliente, grupo_muscular_id) -> dict[str, int]:
    return {
        nombre: crear_ejercicio(cliente, grupo_muscular_id, nombre)
        for nombre in ("Press banca", "Press en máquina", "Fondos", "Remo")
    }


# --- La ficha: donde-se-usa ----------------------------------------------------


def test_sale_cada_hueco_donde_es_principal_o_alternativa_ordenado_por_rutina(cliente, ejercicios):
    """Push se crea antes que Pull para que el orden por nombre no salga gratis del
    de los ids.
    """
    press, maquina, remo = (
        ejercicios["Press banca"],
        ejercicios["Press en máquina"],
        ejercicios["Remo"],
    )
    push, [hueco_push] = crear_rutina(cliente, "Push", hueco(press, maquina))
    pull, [hueco_pull] = crear_rutina(cliente, "Pull", hueco(remo, press))

    usos = donde_se_usa(cliente, press)

    assert usos == [
        {
            "rutina": {"id": pull, "nombre": "Pull", "oculto_desde": None},
            "slot_id": hueco_pull,
            "rol": "comodin",
            "posicion": 1,
            "hueco_oculto_desde": None,
            "oculto": False,
            "programas": [],
        },
        {
            "rutina": {"id": push, "nombre": "Push", "oculto_desde": None},
            "slot_id": hueco_push,
            "rol": "principal",
            "posicion": 1,
            "hueco_oculto_desde": None,
            "oculto": False,
            "programas": [],
        },
    ]
    assert [uso["rol"] for uso in donde_se_usa(cliente, maquina)] == ["comodin"]


def test_dos_huecos_en_una_rutina_son_dos_filas_y_la_posicion_solo_cuenta_los_visibles(
    cliente, hoy_es, ejercicios
):
    """Push: Remo (oculto), Press, Fondos, Press y Press (oculto). El número de cada
    hueco es su sitio entre los visibles (1 y 3), no su `orden` (2 y 4); el oculto no
    tiene número y va plegado.
    """
    hoy_es(HOY)
    press, fondos, remo = ejercicios["Press banca"], ejercicios["Fondos"], ejercicios["Remo"]
    push, huecos = crear_rutina(
        cliente, "Push", hueco(remo), hueco(press), hueco(fondos), hueco(press), hueco(press)
    )
    ocultar_hueco(cliente, push, huecos[0])
    ocultar_hueco(cliente, push, huecos[4])

    usos = donde_se_usa(cliente, press)

    assert [
        (uso["slot_id"], uso["posicion"], uso["hueco_oculto_desde"], uso["oculto"]) for uso in usos
    ] == [
        (huecos[1], 1, None, False),
        (huecos[3], 3, None, False),
        (huecos[4], None, "2026-09-16", True),
    ]


def test_un_hueco_de_una_rutina_oculta_va_plegado_pero_conserva_su_numero(
    cliente, hoy_es, ejercicios
):
    hoy_es(HOY)
    press, fondos = ejercicios["Press banca"], ejercicios["Fondos"]
    push, huecos = crear_rutina(cliente, "Push", hueco(fondos), hueco(press))
    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    [uso] = donde_se_usa(cliente, press)

    assert uso["rutina"]["oculto_desde"] == "2026-09-16"
    assert (uso["posicion"], uso["hueco_oculto_desde"], uso["oculto"]) == (2, None, True)


def test_cada_uso_dice_en_que_programas_esta_su_rutina_y_sus_dias(
    cliente, sesion_bd, hoy_es, ejercicios
):
    """Salen los programas visibles con algún día vigente de la rutina, por nombre,
    con sus días ordenados y si es el activo. No salen uno oculto, ni uno donde la
    rutina solo estuvo (fila cerrada), ni uno con otra rutina.
    """
    hoy_es(HOY)
    press, remo = ejercicios["Press banca"], ejercicios["Remo"]
    push, _ = crear_rutina(cliente, "Push", hueco(press))
    pull, _ = crear_rutina(cliente, "Pull", hueco(remo))
    # Los días se mandan desordenados: el orden tiene que ponerlo la API.
    activo = crear_programa(cliente, "B activo", {5: push, 1: push, 3: pull}, activar=True)
    sin_activar = crear_programa(cliente, "A sin activar", {2: push})
    oculto = crear_programa(cliente, "C oculto", {4: push})
    assert cliente.delete(f"/programas/{oculto}?modo=ocultar").status_code == 204
    crear_programa(cliente, "D solo Pull", {6: pull})
    ya_no = crear_programa(cliente, "E ya no", {6: pull})
    sesion_bd.add(
        ProgramaDia(programa_id=ya_no, dia_semana=2, rutina_id=push, hasta=date(2026, 9, 1))
    )
    sesion_bd.commit()

    [uso] = donde_se_usa(cliente, press)

    assert uso["programas"] == [
        {"id": sin_activar, "nombre": "A sin activar", "activo": False, "dias_semana": [2]},
        {"id": activo, "nombre": "B activo", "activo": True, "dias_semana": [1, 5]},
    ]


def test_un_ejercicio_oculto_y_uno_predefinido_tienen_ficha(
    cliente, ejercicios, ejercicio_predefinido_id
):
    press = ejercicios["Press banca"]
    _, [hueco_propio] = crear_rutina(cliente, "Push", hueco(press))
    _, [hueco_predefinido] = crear_rutina(cliente, "Leg", hueco(ejercicio_predefinido_id))
    assert cliente.delete(f"/ejercicios/{press}?modo=ocultar").status_code == 204

    assert [uso["slot_id"] for uso in donde_se_usa(cliente, press)] == [hueco_propio]
    usos_predefinido = donde_se_usa(cliente, ejercicio_predefinido_id)
    assert [uso["slot_id"] for uso in usos_predefinido] == [hueco_predefinido]


def test_un_ejercicio_sin_usar_no_sale_en_ninguna_rutina(cliente, ejercicios):
    crear_rutina(cliente, "Push", hueco(ejercicios["Press banca"], ejercicios["Fondos"]))

    assert donde_se_usa(cliente, ejercicios["Remo"]) == []


def test_la_ficha_de_un_ejercicio_inexistente_da_404(cliente):
    assert cliente.get("/ejercicios/999999/donde-se-usa").status_code == 404


def test_donde_se_usa_hace_las_mismas_consultas_con_un_uso_que_con_muchos(
    cliente, hoy_es, ejercicios
):
    """Sin una consulta por uso, por rutina ni por programa."""
    hoy_es(HOY)
    press, fondos = ejercicios["Press banca"], ejercicios["Fondos"]
    primera, _ = crear_rutina(cliente, "Rutina 0", hueco(press))
    crear_programa(cliente, "Programa 0", {1: primera}, activar=True)
    con_uno = consultas_de(lambda: cliente.get(f"/ejercicios/{press}/donde-se-usa"))

    for numero in range(1, 5):
        rutina, huecos = crear_rutina(
            cliente, f"Rutina {numero}", hueco(fondos, press), hueco(press), hueco(fondos)
        )
        ocultar_hueco(cliente, rutina, huecos[2])
        crear_programa(cliente, f"Programa {numero}", {1: rutina, 2: primera, 3: rutina})
    assert len(donde_se_usa(cliente, press)) == 9
    con_muchos = consultas_de(lambda: cliente.get(f"/ejercicios/{press}/donde-se-usa"))

    assert con_uno == con_muchos


# --- Notas: la ruta tiene que cuadrar ------------------------------------------


def test_una_nota_de_otro_ejercicio_no_se_alcanza_por_la_ruta_de_este(cliente, ejercicios):
    """La ruta lleva el ejercicio y la nota: si no cuadran entre sí, da 404 y la
    nota no se toca, aunque los dos ejercicios existan y se puedan anotar.
    """
    press, remo = ejercicios["Press banca"], ejercicios["Remo"]
    nota = cliente.post(f"/ejercicios/{press}/notas", json={"nota": "Agarre cerrado"}).json()

    editada = cliente.put(f"/ejercicios/{remo}/notas/{nota['id']}", json={"nota": "Cambiada"})
    borrada = cliente.delete(f"/ejercicios/{remo}/notas/{nota['id']}")

    assert (editada.status_code, borrada.status_code) == (404, 404)
    assert cliente.get(f"/ejercicios/{press}/notas").json() == [nota]
    assert cliente.get(f"/ejercicios/{remo}/notas").json() == []
