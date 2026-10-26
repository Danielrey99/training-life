"""Tests de la ficha de un ejercicio: `GET /ejercicios/{id}/donde-se-usa`
(«Rutinas donde se usa»), que una nota solo se alcanza por la ruta de su ejercicio,
y su tipo de registro (cómo se apunta: se elige al crearlo y no cambia).

El aviso y el borrado de un ejercicio están en `test_borrados.py`; las medidas que
pide cada tipo a sus series, en `test_medidas.py`.
"""

from datetime import date

import pytest

from app.models import ProgramaDia
from tests.ayudas import alternativa, consultas_de, crear_ejercicio, objetivo, ocultar_hueco
from tests.semana import HOY

# --- Ayudantes ---------------------------------------------------------------


def hueco(principal, *comodines) -> dict:
    """Un hueco de repeticiones. Cada comodín, un id (con objetivo de repeticiones) o
    el cuerpo entero de su alternativa (`alternativa(...)`).
    """
    return {
        "ejercicio_principal_id": principal,
        **objetivo(3, (6, 10)),
        "alternativas": [c if isinstance(c, dict) else alternativa(c) for c in comodines],
    }


def rutina_con_huecos(cliente, nombre, *huecos) -> tuple[int, list[int]]:
    """La rutina con sus huecos, en ese orden; devuelve su id y los de los huecos."""
    respuesta = cliente.post("/rutinas", json={"nombre": nombre, "slots": list(huecos)})
    assert respuesta.status_code == 201, respuesta.text
    rutina = respuesta.json()
    return rutina["id"], [slot["id"] for slot in sorted(rutina["slots"], key=lambda s: s["orden"])]


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
    push, [hueco_push] = rutina_con_huecos(cliente, "Push", hueco(press, maquina))
    pull, [hueco_pull] = rutina_con_huecos(cliente, "Pull", hueco(remo, press))

    usos = donde_se_usa(cliente, press)

    assert usos == [
        {
            "rutina": {"id": pull, "nombre": "Pull", "oculto_desde": None},
            "slot_id": hueco_pull,
            "rol": "comodin",
            "posicion": 1,
            "oculto": False,
            "programas": [],
        },
        {
            "rutina": {"id": push, "nombre": "Push", "oculto_desde": None},
            "slot_id": hueco_push,
            "rol": "principal",
            "posicion": 1,
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
    push, huecos = rutina_con_huecos(
        cliente, "Push", hueco(remo), hueco(press), hueco(fondos), hueco(press), hueco(press)
    )
    ocultar_hueco(cliente, push, huecos[0])
    ocultar_hueco(cliente, push, huecos[4])

    usos = donde_se_usa(cliente, press)

    assert [(uso["slot_id"], uso["posicion"], uso["oculto"]) for uso in usos] == [
        (huecos[1], 1, False),
        (huecos[3], 3, False),
        (huecos[4], None, True),
    ]


def test_un_hueco_de_una_rutina_oculta_va_plegado_pero_conserva_su_numero(
    cliente, hoy_es, ejercicios
):
    hoy_es(HOY)
    press, fondos = ejercicios["Press banca"], ejercicios["Fondos"]
    push, huecos = rutina_con_huecos(cliente, "Push", hueco(fondos), hueco(press))
    assert cliente.delete(f"/rutinas/{push}?modo=ocultar").status_code == 204

    [uso] = donde_se_usa(cliente, press)

    assert uso["rutina"]["oculto_desde"] == "2026-09-16"
    assert (uso["posicion"], uso["oculto"]) == (2, True)


def test_cada_uso_dice_en_que_programas_esta_su_rutina(cliente, sesion_bd, hoy_es, ejercicios):
    """Salen los programas visibles con algún día vigente de la rutina, por nombre,
    una vez cada uno aunque la tenga en varios días, y si es el activo. No salen uno
    oculto, ni uno donde la rutina solo estuvo (fila cerrada), ni uno con otra rutina.
    """
    hoy_es(HOY)
    press, remo = ejercicios["Press banca"], ejercicios["Remo"]
    push, _ = rutina_con_huecos(cliente, "Push", hueco(press))
    pull, _ = rutina_con_huecos(cliente, "Pull", hueco(remo))
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
        {"id": sin_activar, "nombre": "A sin activar", "activo": False},
        {"id": activo, "nombre": "B activo", "activo": True},
    ]


def test_un_ejercicio_oculto_y_uno_predefinido_tienen_ficha(
    cliente, ejercicios, ejercicio_predefinido_id
):
    press = ejercicios["Press banca"]
    _, [hueco_propio] = rutina_con_huecos(cliente, "Push", hueco(press))
    _, [hueco_predefinido] = rutina_con_huecos(cliente, "Leg", hueco(ejercicio_predefinido_id))
    assert cliente.delete(f"/ejercicios/{press}?modo=ocultar").status_code == 204

    assert [uso["slot_id"] for uso in donde_se_usa(cliente, press)] == [hueco_propio]
    usos_predefinido = donde_se_usa(cliente, ejercicio_predefinido_id)
    assert [uso["slot_id"] for uso in usos_predefinido] == [hueco_predefinido]


def test_un_ejercicio_sin_usar_no_sale_en_ninguna_rutina(cliente, ejercicios):
    rutina_con_huecos(cliente, "Push", hueco(ejercicios["Press banca"], ejercicios["Fondos"]))

    assert donde_se_usa(cliente, ejercicios["Remo"]) == []


def test_donde_se_usa_hace_las_mismas_consultas_con_un_uso_que_con_muchos(
    cliente, hoy_es, ejercicios
):
    """Sin una consulta por uso, por rutina ni por programa."""
    hoy_es(HOY)
    press, fondos = ejercicios["Press banca"], ejercicios["Fondos"]
    primera, _ = rutina_con_huecos(cliente, "Rutina 0", hueco(press))
    crear_programa(cliente, "Programa 0", {1: primera}, activar=True)
    con_uno = consultas_de(lambda: cliente.get(f"/ejercicios/{press}/donde-se-usa"))

    for numero in range(1, 5):
        rutina, huecos = rutina_con_huecos(
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

    for respuesta in (editada, borrada):
        assert (respuesta.status_code, respuesta.json()["detail"]) == (404, "Nota no encontrada")
    assert cliente.get(f"/ejercicios/{press}/notas").json() == [nota]
    assert cliente.get(f"/ejercicios/{remo}/notas").json() == []


# --- El tipo de registro ---------------------------------------------------------
#
# Cada ejercicio dice cómo se apuntan sus series: peso y repeticiones, peso corporal,
# tiempo o cardio. Se elige al crearlo y no cambia (una serie ya apuntada no se puede
# reinterpretar): el PUT no lo toca aunque llegue en el cuerpo.

TIPOS = ["peso_reps", "corporal", "tiempo", "cardio"]


@pytest.mark.parametrize("tipo", TIPOS)
def test_un_ejercicio_se_crea_con_cada_tipo_y_lo_dice_en_la_ficha_y_en_la_lista(
    cliente, grupo_muscular_id, tipo
):
    creado = cliente.post(
        "/ejercicios",
        json={"nombre": "Ejercicio", "grupo_muscular_id": grupo_muscular_id, "tipo_registro": tipo},
    )

    assert creado.status_code == 201, creado.text
    assert creado.json()["tipo_registro"] == tipo
    ejercicio_id = creado.json()["id"]
    assert cliente.get(f"/ejercicios/{ejercicio_id}").json()["tipo_registro"] == tipo
    [en_la_lista] = [e for e in cliente.get("/ejercicios").json() if e["id"] == ejercicio_id]
    assert en_la_lista["tipo_registro"] == tipo


def test_sin_tipo_un_ejercicio_es_de_peso_y_repeticiones(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)

    assert cliente.get(f"/ejercicios/{ejercicio_id}").json()["tipo_registro"] == "peso_reps"


@pytest.mark.parametrize("tipo", ["natación", "Cardio", "Tiempo", "", None, 1])
def test_un_tipo_que_no_existe_da_422_y_no_crea_nada(cliente, grupo_muscular_id, tipo):
    """Solo valen los cuatro tipos, tal cual (ni «Cardio» con mayúscula), y un nulo no es
    «el de por defecto»: el campo se omite o trae uno de los tipos.
    """
    respuesta = cliente.post(
        "/ejercicios",
        json={"nombre": "Cinta", "grupo_muscular_id": grupo_muscular_id, "tipo_registro": tipo},
    )

    assert respuesta.status_code == 422, respuesta.text
    assert [error["loc"] for error in respuesta.json()["detail"]] == [["body", "tipo_registro"]]
    assert [e for e in cliente.get("/ejercicios").json() if not e["es_predefinido"]] == []


@pytest.mark.parametrize("otro", ["peso_reps", "tiempo", "cardio", "natación"])
def test_editar_un_ejercicio_no_cambia_su_tipo_aunque_lo_traiga_el_cuerpo(
    cliente, grupo_muscular_id, otro
):
    """El PUT da 200 y cambia el nombre, pero el tipo se ignora: ni otro válido ni
    uno que no existe (que tampoco da 422, porque el campo no es del PUT).
    """
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Dominadas", tipo="corporal")

    respuesta = cliente.put(
        f"/ejercicios/{ejercicio_id}",
        json={
            "nombre": "Dominadas pronas",
            "grupo_muscular_id": grupo_muscular_id,
            "tipo_registro": otro,
        },
    )

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["tipo_registro"] == "corporal"
    guardado = cliente.get(f"/ejercicios/{ejercicio_id}").json()
    assert (guardado["nombre"], guardado["tipo_registro"]) == ("Dominadas pronas", "corporal")


def test_un_predefinido_sigue_sin_poder_editarse_tambien_con_tipo(
    cliente, grupo_muscular_id, ejercicio_predefinido_id
):
    antes = cliente.get(f"/ejercicios/{ejercicio_predefinido_id}").json()

    respuesta = cliente.put(
        f"/ejercicios/{ejercicio_predefinido_id}",
        json={"nombre": "Otra", "grupo_muscular_id": grupo_muscular_id, "tipo_registro": "tiempo"},
    )

    assert respuesta.status_code == 403, respuesta.text
    assert respuesta.json()["detail"] == "Los ejercicios predefinidos no se pueden editar."
    assert cliente.get(f"/ejercicios/{ejercicio_predefinido_id}").json() == antes
    assert antes["tipo_registro"] == "peso_reps"


def test_el_tipo_sale_con_el_ejercicio_en_rutinas_y_series(cliente, grupo_muscular_id):
    """Donde se devuelve un ejercicio, va su tipo: en el principal y los comodines
    de un hueco y en el ejercicio de cada serie (una sesión puede mezclar tipos: el
    cliente tiene que saber cómo pintar cada serie sin cruzar datos).
    """
    press = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    plancha = crear_ejercicio(cliente, grupo_muscular_id, "Plancha", tipo="tiempo")
    rutina, [slot] = rutina_con_huecos(
        cliente, "Core", hueco(press, alternativa(plancha, duracion=(30, 45)))
    )
    sesiones = [
        cliente.post("/entrenamientos", json={"rutina_id": rutina, "fecha": fecha}).json()["id"]
        for fecha in ("2026-09-01", "2026-09-02")
    ]
    cuerpo = {"slot_id": slot, "numero_serie": 1}
    con_press = cliente.post(
        f"/entrenamientos/{sesiones[0]}/series",
        json={**cuerpo, "ejercicio_id": press, "peso": 60, "repeticiones": 8},
    )
    con_plancha = cliente.post(
        f"/entrenamientos/{sesiones[1]}/series",
        json={**cuerpo, "ejercicio_id": plancha, "duracion_s": 45},
    )
    assert con_press.status_code == con_plancha.status_code == 201, con_plancha.text

    [en_la_rutina] = cliente.get(f"/rutinas/{rutina}").json()["slots"]
    sesion = cliente.get(f"/entrenamientos/{sesiones[1]}").json()

    assert en_la_rutina["ejercicio_principal"]["tipo_registro"] == "peso_reps"
    assert [a["ejercicio"]["tipo_registro"] for a in en_la_rutina["alternativas"]] == ["tiempo"]
    assert con_press.json()["ejercicio"]["tipo_registro"] == "peso_reps"
    assert sesion["series"][0]["ejercicio"]["tipo_registro"] == "tiempo"
