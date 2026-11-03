"""Tests de la ficha de un ejercicio: `GET /ejercicios/{id}/donde-se-usa`
(«Rutinas donde se usa»), que una nota solo se alcanza por la ruta de su ejercicio,
su tipo de registro (cómo se apunta: se elige al crearlo y no cambia), que dos
ejercicios no se llamen igual y el orden de dos con el mismo nombre en los listados.

El aviso y el borrado de un ejercicio están en `test_borrados.py`; las medidas que
pide cada tipo a sus series, en `test_medidas.py`.
"""

from datetime import date

import pytest

from app.models import ProgramaDia
from tests.ayudas import (
    alternativa,
    consultas_de,
    crear_ejercicio,
    crear_programa,
    objetivo,
    ocultar_hueco,
)
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
    activo = crear_programa(cliente, "B activo", [(5, push), (1, push), (3, pull)], activar=True)[
        "id"
    ]
    sin_activar = crear_programa(cliente, "A sin activar", [(2, push)])["id"]
    oculto = crear_programa(cliente, "C oculto", [(4, push)])["id"]
    assert cliente.delete(f"/programas/{oculto}?modo=ocultar").status_code == 204
    crear_programa(cliente, "D solo Pull", [(6, pull)])
    ya_no = crear_programa(cliente, "E ya no", [(6, pull)])["id"]
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
    crear_programa(cliente, "Programa 0", [(1, primera)], activar=True)
    con_uno = consultas_de(lambda: cliente.get(f"/ejercicios/{press}/donde-se-usa"))

    for numero in range(1, 5):
        rutina, huecos = rutina_con_huecos(
            cliente, f"Rutina {numero}", hueco(fondos, press), hueco(press), hueco(fondos)
        )
        ocultar_hueco(cliente, rutina, huecos[2])
        crear_programa(cliente, f"Programa {numero}", [(1, rutina), (2, primera), (3, rutina)])
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
    # Lo decide el backend, no el cliente: nace propio y visible.
    assert (creado.json()["es_predefinido"], creado.json()["oculto_desde"]) == (False, None)
    ejercicio_id = creado.json()["id"]
    assert cliente.get(f"/ejercicios/{ejercicio_id}").json()["tipo_registro"] == tipo
    [en_la_lista] = [e for e in cliente.get("/ejercicios").json() if e["id"] == ejercicio_id]
    assert en_la_lista["tipo_registro"] == tipo


def test_sin_tipo_un_ejercicio_es_de_peso_y_repeticiones(cliente, grupo_muscular_id):
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)

    assert cliente.get(f"/ejercicios/{ejercicio_id}").json()["tipo_registro"] == "peso_reps"


@pytest.mark.parametrize("tipo", ["natación", "Cardio", None])
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


@pytest.mark.parametrize("otro", ["tiempo", "natación"])
def test_editar_un_ejercicio_no_cambia_su_tipo_aunque_lo_traiga_el_cuerpo(
    cliente, grupo_muscular_id, otro
):
    """El PUT da 200 y cambia el nombre, pero el tipo se ignora: ni otro válido ni
    uno que no existe (que tampoco da 422, porque el campo no es del PUT).
    """
    ejercicio_id = crear_ejercicio(
        cliente, grupo_muscular_id, "Dominadas en anillas", tipo="corporal"
    )

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


def test_el_tipo_sale_con_el_ejercicio_en_rutinas_y_series(cliente, grupo_muscular_id):
    """Donde se devuelve un ejercicio, va su tipo: en el principal y los comodines
    de un hueco y en el ejercicio de cada serie (una sesión puede mezclar tipos: el
    cliente tiene que saber cómo pintar cada serie sin cruzar datos).
    """
    press = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    plancha = crear_ejercicio(cliente, grupo_muscular_id, "Plancha con lastre", tipo="tiempo")
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


# --- Nombres que no se repiten ---------------------------------------------------
#
# Un ejercicio nuevo o renombrado no puede llamarse como otro (predefinido, propio o
# propio oculto), sin distinguir mayúsculas, tildes ni espacios. Solo lo comprueba la
# API: la base no lo impide, y un archivo importado puede traer dos que se llamen igual.

PREDEFINIDO_CON_TILDE = "Press banca en máquina"
MARCA = {"created_at": "2026-09-01T10:00:00+00:00", "updated_at": "2026-09-01T10:00:00+00:00"}


def choca_con_predefinido(nombre) -> str:
    return (
        f"Ya hay un ejercicio predefinido que se llama «{nombre}». Búscalo en la pestaña"
        " Ejercicios o elige otro nombre."
    )


def choca_con_propio(nombre) -> str:
    return f"Ya tienes un ejercicio que se llama «{nombre}». Elige otro nombre."


def choca_con_oculto(nombre) -> str:
    return (
        f"Ya tienes un ejercicio oculto que se llama «{nombre}». Muéstralo desde la pestaña"
        " Ejercicios o elige otro nombre."
    )


def nuevo(cliente, nombre, grupo_muscular_id):
    cuerpo = {"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    return cliente.post("/ejercicios", json=cuerpo)


def editado(cliente, ejercicio_id, nombre, grupo_muscular_id, descripcion=None):
    cuerpo = {"nombre": nombre, "grupo_muscular_id": grupo_muscular_id, "descripcion": descripcion}
    return cliente.put(f"/ejercicios/{ejercicio_id}", json=cuerpo)


def todos_los_ejercicios(cliente) -> list[dict]:
    return cliente.get("/ejercicios").json() + cliente.get("/ejercicios?ocultos=true").json()


def propios(cliente) -> list[tuple[str, int]]:
    """Los propios, visibles y ocultos, como (nombre, id)."""
    return sorted(
        (e["nombre"], e["id"]) for e in todos_los_ejercicios(cliente) if not e["es_predefinido"]
    )


def ocultar_en_la_base(sesion_bd, ejercicio_id) -> None:
    from app.models import Ejercicio

    sesion_bd.get(Ejercicio, ejercicio_id).oculto_desde = date(2026, 9, 1)
    sesion_bd.commit()


def importar_propios(cliente, grupo_muscular_id, *ejercicios) -> list[int]:
    """Sustituye los datos por un archivo con estos propios, cada uno un nombre o un
    (nombre, oculto_desde). Devuelve sus ids nuevos, en el orden del archivo.
    """
    grupos = {g["id"]: g["nombre"] for g in cliente.get("/grupos-musculares").json()}
    filas = [e if isinstance(e, tuple) else (e, None) for e in ejercicios]
    archivo = {
        "formato": "training-life",
        "version": 2,
        "exportado_en": MARCA["created_at"],
        "ejercicios": [
            {
                "id": n + 1,
                "nombre": nombre,
                "grupo_muscular": grupos[grupo_muscular_id],
                "tipo_registro": "peso_reps",
                "oculto_desde": oculto,
                # Para encontrar cada uno después, aunque se llamen igual.
                "descripcion": f"fila {n}",
                **MARCA,
            }
            for n, (nombre, oculto) in enumerate(filas)
        ],
    }
    respuesta = cliente.post("/datos/importar", json=archivo)
    assert respuesta.status_code == 200, respuesta.text
    por_fila = {
        e["descripcion"]: e["id"] for e in todos_los_ejercicios(cliente) if not e["es_predefinido"]
    }
    return [por_fila[f"fila {n}"] for n in range(len(filas))]


@pytest.mark.parametrize(
    "nombre, clave",
    [
        ("Press banca", "press banca"),
        ("PRESS BANCA", "press banca"),
        ("Elevación lateral", "elevacion lateral"),
        ("ÁÉÍÓÚ àèìòù âêîôû äëïöü ÄËÏÖÜ", "aeiou aeiou aeiou aeiou aeiou"),
        ("Pingüino", "pinguino"),
        ("  Press \t  banca\n inclinado  ", "press banca inclinado"),
    ],
)
def test_la_clave_de_un_nombre_ignora_mayusculas_tildes_y_espacios(nombre, clave):
    from app.nombres import clave_de_nombre

    assert clave_de_nombre(nombre) == clave


def test_la_clave_de_un_nombre_distingue_la_enie_y_la_cedilla():
    """La ñ y la ç son letras, no una n o una c con tilde: «Año» y «Ano» son nombres
    distintos (por eso la clave usa una tabla y no NFD, que las quitaría).
    """
    from app.nombres import clave_de_nombre

    assert clave_de_nombre("AÑO") == clave_de_nombre("Año") == "año"
    assert clave_de_nombre("Año") != clave_de_nombre("Ano")
    assert clave_de_nombre("Ç") == "ç"
    assert clave_de_nombre("Ç") != clave_de_nombre("c")


@pytest.mark.parametrize(
    "nombre, guardado",
    [
        ("SENTADILLA  CON   BARRA", "Sentadilla con barra"),
        ("press banca en maquina", PREDEFINIDO_CON_TILDE),
    ],
)
def test_no_se_crea_un_ejercicio_con_el_nombre_de_un_predefinido(
    cliente, grupo_muscular_id, ejercicio_predefinido_id, nombre, guardado
):
    """En mayúsculas, con espacios dobles o sin tildes sigue siendo el mismo nombre. El
    mensaje lo nombra como está guardado.
    """
    respuesta = nuevo(cliente, nombre, grupo_muscular_id)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"] == choca_con_predefinido(guardado)
    assert propios(cliente) == []


def test_no_se_crea_un_ejercicio_con_el_nombre_de_uno_propio(cliente, grupo_muscular_id):
    existente = crear_ejercicio(cliente, grupo_muscular_id, "Curl con cuerda")

    respuesta = nuevo(cliente, "curl  con CUERDA", grupo_muscular_id)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"] == choca_con_propio("Curl con cuerda")
    assert propios(cliente) == [("Curl con cuerda", existente)]


def test_no_se_crea_un_ejercicio_con_el_nombre_de_uno_oculto(cliente, sesion_bd, grupo_muscular_id):
    """Uno oculto no se ve en la lista, así que el mensaje dice dónde está."""
    existente = crear_ejercicio(cliente, grupo_muscular_id, "Curl con cuerda")
    ocultar_en_la_base(sesion_bd, existente)

    respuesta = nuevo(cliente, "Curl con cuerda", grupo_muscular_id)

    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["detail"] == choca_con_oculto("Curl con cuerda")
    assert propios(cliente) == [("Curl con cuerda", existente)]


def test_con_enie_frente_a_n_son_dos_nombres_distintos(cliente, grupo_muscular_id):
    crear_ejercicio(cliente, grupo_muscular_id, "Giro de muñeca con palo")

    assert nuevo(cliente, "Giro de muneca con palo", grupo_muscular_id).status_code == 201


def test_un_grupo_que_no_existe_da_404_antes_que_el_nombre_repetido(
    cliente, ejercicio_predefinido_id
):
    respuesta = nuevo(cliente, "Sentadilla con barra", 999_999)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        404,
        "Ese grupo muscular no existe.",
    )
    assert propios(cliente) == []


def test_cambiar_solo_mayusculas_o_tildes_del_nombre_se_guarda(cliente, grupo_muscular_id):
    """Es el mismo nombre: no choca consigo mismo, y queda la forma nueva."""
    ejercicio = crear_ejercicio(cliente, grupo_muscular_id, "elevacion frontal con disco")

    for nombre in ("Elevación frontal con disco", "ELEVACIÓN FRONTAL CON DISCO"):
        respuesta = editado(cliente, ejercicio, nombre, grupo_muscular_id)

        assert respuesta.status_code == 200, respuesta.text
        assert cliente.get(f"/ejercicios/{ejercicio}").json()["nombre"] == nombre


def test_renombrar_un_ejercicio_con_el_nombre_de_otro_da_409_y_no_cambia_nada(
    cliente, grupo_muscular_id, ejercicio_predefinido_id
):
    curl = crear_ejercicio(cliente, grupo_muscular_id, "Curl con cuerda")
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo con cuerda")

    contra_propio = editado(cliente, remo, "CURL con cuerda", grupo_muscular_id, "x")
    contra_predefinido = editado(cliente, remo, "sentadilla con barra", grupo_muscular_id, "x")

    assert (contra_propio.status_code, contra_propio.json()["detail"]) == (
        409,
        choca_con_propio("Curl con cuerda"),
    )
    assert (contra_predefinido.status_code, contra_predefinido.json()["detail"]) == (
        409,
        choca_con_predefinido("Sentadilla con barra"),
    )
    guardado = cliente.get(f"/ejercicios/{remo}").json()
    assert (guardado["nombre"], guardado["descripcion"]) == ("Remo con cuerda", None)
    assert propios(cliente) == [("Curl con cuerda", curl), ("Remo con cuerda", remo)]


def test_un_propio_que_ya_se_llama_como_un_predefinido_se_sigue_pudiendo_editar(
    cliente, grupo_muscular_id, ejercicio_predefinido_id
):
    """Un archivo importado (o un predefinido que llegó después) puede dejar un propio
    que se llama como un predefinido. Solo se valida lo que cambia: su descripción y
    las mayúsculas de su nombre se cambian sin un 409.
    """
    [propio] = importar_propios(cliente, grupo_muscular_id, "Sentadilla con barra")

    con_descripcion = editado(
        cliente, propio, "Sentadilla con barra", grupo_muscular_id, "Con barra baja"
    )
    con_mayusculas = editado(cliente, propio, "SENTADILLA con barra", grupo_muscular_id)

    assert con_descripcion.status_code == 200, con_descripcion.text
    assert con_mayusculas.status_code == 200, con_mayusculas.text
    assert cliente.get(f"/ejercicios/{propio}").json()["nombre"] == "SENTADILLA con barra"


def test_al_editar_un_oculto_con_nombre_repetido_manda_el_409_de_oculto(
    cliente, sesion_bd, grupo_muscular_id
):
    crear_ejercicio(cliente, grupo_muscular_id, "Curl con cuerda")
    oculto = crear_ejercicio(cliente, grupo_muscular_id, "Remo con cuerda")
    ocultar_en_la_base(sesion_bd, oculto)

    respuesta = editado(cliente, oculto, "Curl con cuerda", grupo_muscular_id)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        "Este ejercicio está oculto. Muéstralo antes de editarlo.",
    )


def test_al_editar_un_predefinido_con_nombre_repetido_manda_el_403(
    cliente, grupo_muscular_id, ejercicio_predefinido_id
):
    crear_ejercicio(cliente, grupo_muscular_id, "Curl con cuerda")

    respuesta = editado(cliente, ejercicio_predefinido_id, "Curl con cuerda", grupo_muscular_id)

    assert respuesta.status_code == 403, respuesta.text
    guardado = cliente.get(f"/ejercicios/{ejercicio_predefinido_id}").json()
    assert guardado["nombre"] == "Sentadilla con barra"


def test_al_editar_con_un_grupo_que_no_existe_y_nombre_repetido_manda_el_404(
    cliente, grupo_muscular_id
):
    crear_ejercicio(cliente, grupo_muscular_id, "Curl con cuerda")
    remo = crear_ejercicio(cliente, grupo_muscular_id, "Remo con cuerda")

    respuesta = editado(cliente, remo, "Curl con cuerda", 999_999)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        404,
        "Ese grupo muscular no existe.",
    )


def test_si_varios_se_llaman_igual_el_mensaje_nombra_el_predefinido(
    cliente, grupo_muscular_id, ejercicio_predefinido_id
):
    """Un propio importado con el nombre de un predefinido: conviven, y al crear otro
    igual se nombra el predefinido, que es el que hay que buscar.
    """
    importar_propios(cliente, grupo_muscular_id, "sentadilla CON barra")

    respuesta = nuevo(cliente, "Sentadilla con barra", grupo_muscular_id)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        choca_con_predefinido("Sentadilla con barra"),
    )


def test_si_varios_propios_se_llaman_igual_el_mensaje_nombra_el_visible(cliente, grupo_muscular_id):
    """Uno oculto y uno visible importados con el mismo nombre: el visible es el que se
    encuentra en la lista, así que es el que se nombra, aunque el oculto vaya antes.
    """
    importar_propios(
        cliente, grupo_muscular_id, ("CURL con cuerda", "2026-08-01"), "Curl con cuerda"
    )

    respuesta = nuevo(cliente, "curl con cuerda", grupo_muscular_id)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        choca_con_propio("Curl con cuerda"),
    )


def test_mostrar_un_oculto_no_mira_el_nombre_y_conviven_los_dos(
    cliente, grupo_muscular_id, ejercicio_predefinido_id
):
    """Decisión del autor: mostrar solo deshace el ocultar. Uno oculto que se llama como
    uno propio visible, o como un predefinido, vuelve a la lista sin un 409 y conviven.
    """
    oculto_propio, visible, oculto_como_predefinido = importar_propios(
        cliente,
        grupo_muscular_id,
        ("CURL con cuerda", "2026-08-01"),
        "Curl con cuerda",
        ("sentadilla con barra", "2026-08-01"),
    )

    for ejercicio in (oculto_propio, oculto_como_predefinido):
        respuesta = cliente.post(f"/ejercicios/{ejercicio}/mostrar")
        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.json()["oculto_desde"] is None

    visibles = {e["id"]: e["nombre"] for e in cliente.get("/ejercicios").json()}
    assert visibles[oculto_propio] == "CURL con cuerda"
    assert visibles[visible] == "Curl con cuerda"
    assert visibles[oculto_como_predefinido] == "sentadilla con barra"
    assert visibles[ejercicio_predefinido_id] == "Sentadilla con barra"


def test_importar_no_mira_los_nombres_y_la_copia_se_vuelve_a_cargar(cliente, grupo_muscular_id):
    """Dos propios con el mismo nombre en el archivo se cargan los dos, y la copia de
    esa instalación vuelve a cargarse: una copia propia nunca puede quedar rechazada.
    """
    ids = importar_propios(cliente, grupo_muscular_id, "Curl con cuerda", "curl  con CUERDA")
    assert len(set(ids)) == 2

    copia = cliente.get("/datos/exportar").json()
    respuesta = cliente.post("/datos/importar", json=copia)

    assert respuesta.status_code == 200, respuesta.text
    assert [nombre for nombre, _ in propios(cliente)] == ["Curl con cuerda", "curl  con CUERDA"]


# --- Dos con el mismo nombre salen siempre en el mismo orden ---------------------


def tocar(sesion_bd, tabla, fila_id) -> None:
    """Reescribe la fila sin cambiar nada: en Postgres pasa al final de la tabla, así
    que sin desempate por id podría salir detrás de la otra.
    """
    from sqlalchemy import text

    sesion_bd.execute(text(f"UPDATE {tabla} SET nombre = nombre WHERE id = :id"), {"id": fila_id})
    sesion_bd.commit()


def test_dos_ejercicios_con_el_mismo_nombre_salen_por_id(cliente, sesion_bd, grupo_muscular_id):
    ids = importar_propios(cliente, grupo_muscular_id, "Curl con cuerda", "Curl con cuerda")
    tocar(sesion_bd, "ejercicios", min(ids))

    lista = cliente.get("/ejercicios").json()

    assert [e["id"] for e in lista if e["nombre"] == "Curl con cuerda"] == sorted(ids)


@pytest.mark.parametrize("ruta, tabla", [("/rutinas", "rutinas"), ("/programas", "programas")])
def test_dos_rutinas_o_programas_con_el_mismo_nombre_salen_por_id(cliente, sesion_bd, ruta, tabla):
    ids = [cliente.post(ruta, json={"nombre": "Igual"}).json()["id"] for _ in range(2)]
    tocar(sesion_bd, tabla, ids[0])

    lista = cliente.get(ruta).json()

    assert [x["id"] for x in lista if x["nombre"] == "Igual"] == sorted(ids)
