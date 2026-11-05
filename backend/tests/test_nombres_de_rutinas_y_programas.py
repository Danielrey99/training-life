"""Tests de los nombres de rutinas y programas: no se repiten.

La API no deja crear ni renombrar una rutina con el nombre de otra, ni un programa con
el de otro, sin distinguir mayúsculas, tildes ni espacios (`app/nombres.py`). Las
ocultas cuentan igual, con otro mensaje que pide mostrarla. Cada tipo se compara solo
con los suyos: una rutina y un programa sí pueden llamarse igual. La base no lo impide,
a propósito: un archivo importado puede traer dos que ya convivían, y tiene que poder
cargarse; esos se pueden seguir editando y mostrando.

Lo de duplicar una rutina (que nunca da 409: busca un nombre libre), en `test_rutinas.py`.
"""

import pytest
from sqlalchemy import select

from app.models import Programa, Rutina, RutinaSlot
from tests.ayudas import (
    crear_ejercicio,
    crear_rutina,
    cuantas_filas,
    ejercicio_oculto,
    importar_rutinas_y_programas,
    nombre_repetido,
    objetivo,
)

# Lo que cambia entre rutinas y programas: la ruta, el parámetro de la lista de ocultos,
# el modelo y los textos (rutina es femenino y programa masculino).
TIPOS = {
    "rutina": {
        "ruta": "/rutinas",
        "ocultos": "ocultas",
        "modelo": Rutina,
        "visible": "Ya tienes una rutina que se llama «{}». Elige otro nombre.",
        "oculto": (
            "Ya tienes una rutina oculta que se llama «{}». Muéstrala desde la pestaña"
            " Programas o elige otro nombre."
        ),
        "editar_oculto": "Esta rutina está oculta. Muéstrala antes de cambiarla.",
    },
    "programa": {
        "ruta": "/programas",
        "ocultos": "ocultos",
        "modelo": Programa,
        "visible": "Ya tienes un programa que se llama «{}». Elige otro nombre.",
        "oculto": (
            "Ya tienes un programa oculto que se llama «{}». Muéstralo desde la pestaña"
            " Programas o elige otro nombre."
        ),
        "editar_oculto": "Este programa está oculto. Muéstralo antes de cambiarlo.",
    },
}

por_tipo = pytest.mark.parametrize("tipo", list(TIPOS))


# --- Ayudas -------------------------------------------------------------------


def crear(cliente, tipo, nombre):
    return cliente.post(TIPOS[tipo]["ruta"], json={"nombre": nombre})


def creado(cliente, tipo, nombre) -> int:
    respuesta = crear(cliente, tipo, nombre)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def renombrar(cliente, tipo, objeto_id, nombre):
    return cliente.put(f"{TIPOS[tipo]['ruta']}/{objeto_id}", json={"nombre": nombre})


def ocultar(cliente, tipo, objeto_id) -> None:
    respuesta = cliente.delete(f"{TIPOS[tipo]['ruta']}/{objeto_id}", params={"modo": "ocultar"})
    assert respuesta.status_code == 204, respuesta.text


def mostrar(cliente, tipo, objeto_id):
    return cliente.post(f"{TIPOS[tipo]['ruta']}/{objeto_id}/mostrar")


def nombres(sesion_bd, tipo) -> list[str]:
    """Todos los nombres guardados de ese tipo, también los ocultos, por id."""
    sesion_bd.expire_all()
    modelo = TIPOS[tipo]["modelo"]
    return list(sesion_bd.scalars(select(modelo.nombre).order_by(modelo.id)))


def choca(tipo, nombre) -> dict:
    return nombre_repetido(TIPOS[tipo]["visible"].format(nombre))


def choca_con_oculto(tipo, nombre) -> dict:
    return nombre_repetido(TIPOS[tipo]["oculto"].format(nombre))


def importar(cliente, tipo, *filas) -> list[int]:
    """Sustituye los datos por un archivo con estas filas del tipo; devuelve sus ids."""
    if tipo == "rutina":
        return importar_rutinas_y_programas(cliente, rutinas=filas)[0]
    return importar_rutinas_y_programas(cliente, programas=filas)[1]


# --- Crear ----------------------------------------------------------------------


@por_tipo
def test_no_se_crea_con_el_nombre_de_otro_sin_distinguir_mayusculas_tildes_ni_espacios(
    cliente, sesion_bd, tipo
):
    """El mensaje nombra el otro tal como está guardado, no como se ha escrito. Cada
    forma de escribirlo, en `test_la_clave_de_un_nombre_ignora_mayusculas_tildes_y_espacios`.
    """
    creado(cliente, tipo, "Glúteos y femoral")

    respuesta = crear(cliente, tipo, "  GLUTEOS   y  femoral ")

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        choca(tipo, "Glúteos y femoral"),
    )
    assert nombres(sesion_bd, tipo) == ["Glúteos y femoral"]


@por_tipo
def test_no_se_crea_con_el_nombre_de_uno_oculto_y_el_mensaje_pide_mostrarlo(
    cliente, sesion_bd, tipo
):
    ocultar(cliente, tipo, creado(cliente, tipo, "Torso"))

    respuesta = crear(cliente, tipo, "torso")

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        choca_con_oculto(tipo, "Torso"),
    )
    assert nombres(sesion_bd, tipo) == ["Torso"]


def test_una_rutina_y_un_programa_pueden_llamarse_igual(cliente, sesion_bd):
    """Un programa de una sola rutina se llama como ella con naturalidad, y nunca
    salen en el mismo selector: cada tipo se compara solo con los suyos.
    """
    assert crear(cliente, "rutina", "Full body").status_code == 201
    assert crear(cliente, "programa", "FULL BODY").status_code == 201
    programa = creado(cliente, "programa", "Otro")
    choque = renombrar(cliente, "programa", programa, "full body ")
    assert (choque.status_code, choque.json()["detail"]) == (409, choca("programa", "FULL BODY"))
    assert renombrar(cliente, "programa", programa, "Otro programa").status_code == 200
    assert nombres(sesion_bd, "rutina") == ["Full body"]
    assert nombres(sesion_bd, "programa") == ["FULL BODY", "Otro programa"]


# --- Crear una rutina con sus huecos: el orden de los fallos ---------------------


def hueco(ejercicio_id, **objetivo_del_hueco) -> dict:
    return {
        "ejercicio_principal_id": ejercicio_id,
        "alternativas": [],
        **(objetivo_del_hueco or objetivo()),
    }


def filas_guardadas(sesion_bd) -> tuple[int, int]:
    return cuantas_filas(sesion_bd, Rutina, RutinaSlot)


def test_una_rutina_con_huecos_y_nombre_repetido_da_409_y_no_crea_nada(
    cliente, sesion_bd, ejercicio_predefinido_id
):
    crear_rutina(cliente, "Pierna")

    respuesta = cliente.post(
        "/rutinas", json={"nombre": "PIERNA", "slots": [hueco(ejercicio_predefinido_id)]}
    )

    assert (respuesta.status_code, respuesta.json()["detail"]) == (409, choca("rutina", "Pierna"))
    assert filas_guardadas(sesion_bd) == (1, 0)


def test_con_un_ejercicio_oculto_y_nombre_repetido_gana_el_404_del_ejercicio(
    cliente, sesion_bd, grupo_muscular_id
):
    """Orden del plan: 422 de forma, 404 de los ejercicios, 422 de los objetivos y,
    por último, el 409 del nombre.
    """
    crear_rutina(cliente, "Pierna")
    oculto = crear_ejercicio(cliente, grupo_muscular_id, "Ejercicio oculto de prueba")
    assert cliente.delete(f"/ejercicios/{oculto}", params={"modo": "ocultar"}).status_code == 204

    respuesta = cliente.post("/rutinas", json={"nombre": "Pierna", "slots": [hueco(oculto)]})

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        404,
        ejercicio_oculto("Ejercicio oculto de prueba"),
    )
    assert filas_guardadas(sesion_bd) == (1, 0)


def test_con_un_objetivo_mal_puesto_y_nombre_repetido_gana_el_422_del_objetivo(
    cliente, sesion_bd, grupo_muscular_id
):
    crear_rutina(cliente, "Pierna")
    # De peso y repeticiones, con el objetivo en segundos.
    ejercicio = crear_ejercicio(cliente, grupo_muscular_id, "Ejercicio de prueba")
    mal = hueco(ejercicio, **objetivo(duracion=(30, 60)))

    respuesta = cliente.post("/rutinas", json={"nombre": "Pierna", "slots": [mal]})

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        422,
        "El objetivo de «Ejercicio de prueba» va en repeticiones y no en tiempo, porque"
        " «Ejercicio de prueba» se apunta con peso y repeticiones.",
    )
    assert filas_guardadas(sesion_bd) == (1, 0)


def test_un_programa_con_una_rutina_oculta_y_nombre_repetido_da_el_404_de_la_rutina(
    cliente, sesion_bd
):
    creado(cliente, "programa", "Torso pierna")
    oculta = crear_rutina(cliente, "Torso")
    ocultar(cliente, "rutina", oculta)

    respuesta = cliente.post(
        "/programas",
        json={"nombre": "Torso pierna", "dias": [{"dia_semana": 1, "rutina_id": oculta}]},
    )

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        404,
        "Esa rutina no existe o está oculta.",
    )
    assert nombres(sesion_bd, "programa") == ["Torso pierna"]


# --- Renombrar -------------------------------------------------------------------
#
# Con el nombre de otro visible: `test_un_nombre_repetido_da_409_y_no_cambia_los_dias`
# (`test_programas.py`) y `test_un_nombre_repetido_al_guardar_da_409_y_el_orden_no_cambia`
# (`test_rutinas.py`).


@por_tipo
def test_renombrar_cambiando_solo_mayusculas_tildes_o_espacios_vale(cliente, sesion_bd, tipo):
    """El nombre no cambia de clave: no choca consigo mismo, y queda la forma nueva."""
    objeto = creado(cliente, tipo, "Glúteos")

    respuesta = renombrar(cliente, tipo, objeto, " GLUTEOS ")

    assert respuesta.status_code == 200, respuesta.text
    assert nombres(sesion_bd, tipo) == ["GLUTEOS"]


@por_tipo
def test_renombrar_con_el_nombre_de_uno_oculto_da_el_409_de_oculto(cliente, sesion_bd, tipo):
    ocultar(cliente, tipo, creado(cliente, tipo, "Torso"))
    pierna = creado(cliente, tipo, "Pierna")

    respuesta = renombrar(cliente, tipo, pierna, "torso")

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        choca_con_oculto(tipo, "Torso"),
    )
    assert nombres(sesion_bd, tipo) == ["Torso", "Pierna"]


@por_tipo
def test_renombrar_uno_oculto_con_nombre_repetido_da_el_409_de_que_esta_oculto(
    cliente, sesion_bd, tipo
):
    """Primero se mira que se pueda editar: el nombre, después. Por eso es un texto sin
    más, sin `campo`: no es un fallo del nombre.
    """
    creado(cliente, tipo, "Torso")
    pierna = creado(cliente, tipo, "Pierna")
    ocultar(cliente, tipo, pierna)

    respuesta = renombrar(cliente, tipo, pierna, "Torso")

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        409,
        TIPOS[tipo]["editar_oculto"],
    )


# --- Los que ya convivían, importados ----------------------------------------------


@por_tipo
def test_con_dos_iguales_importados_el_mensaje_nombra_el_visible(cliente, tipo):
    """El oculto va primero en el archivo: aun así, se nombra el visible, que es el que
    se encuentra en la lista.
    """
    importar(cliente, tipo, ("Push", "2026-09-01"), "PUSH")

    respuesta = crear(cliente, tipo, "push")

    assert (respuesta.status_code, respuesta.json()["detail"]) == (409, choca(tipo, "PUSH"))


@por_tipo
def test_dos_iguales_importados_se_pueden_seguir_editando_y_mostrando(cliente, sesion_bd, tipo):
    """Importar no mira los nombres: la copia de esta instalación siempre se carga, y lo
    cargado no se queda bloqueado.
    """
    oculto, visible = importar(cliente, tipo, ("Push", "2026-09-01"), "Push")

    renombrado = renombrar(cliente, tipo, visible, "PUSH")
    mostrado = mostrar(cliente, tipo, oculto)

    assert renombrado.status_code == 200, renombrado.text
    assert mostrado.status_code == 200, mostrado.text
    assert nombres(sesion_bd, tipo) == ["Push", "PUSH"]
    ids = [x["id"] for x in cliente.get(TIPOS[tipo]["ruta"]).json()]
    assert sorted(ids) == sorted([oculto, visible])
