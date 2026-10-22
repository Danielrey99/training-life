"""Tests de cómo se comportan las relaciones uno-a-muchos al borrar al padre con
la lista de hijos ya cargada en memoria.

Ya dio un 500 real con los programas (`borrar_programa` lee sus periodos antes de
borrarlo): con los hijos cargados, `passive_deletes=True` no impide que SQLAlchemy
intente poner su FK a NULL. Se prueba a nivel de ORM, cargando la lista a propósito
antes de borrar, para cada relación: así el día que otro endpoint cargue una lista
antes de borrar al padre no aparece el mismo fallo.
"""

from datetime import date

import psycopg2.errors
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Entrenamiento,
    Programa,
    ProgramaDia,
    ProgramaPeriodo,
    Rutina,
    RutinaSlot,
    Serie,
    SlotAlternativa,
)
from tests.ayudas import crear_ejercicio, crear_hueco, crear_rutina, entrenar, serie_en


@pytest.fixture
def rutina_con_hueco(cliente, grupo_muscular_id):
    """Una rutina con un hueco que tiene un comodín, y una sesión con una serie."""
    principal = crear_ejercicio(cliente, grupo_muscular_id, "Press banca")
    comodin = crear_ejercicio(cliente, grupo_muscular_id, "Press en máquina")
    rutina_id = crear_rutina(cliente)
    slot_id = crear_hueco(cliente, rutina_id, principal)
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin}
    )
    assert respuesta.status_code == 201, respuesta.text
    entrenamiento_id = entrenar(cliente, "2026-09-01", rutina_id).json()["id"]
    assert serie_en(cliente, entrenamiento_id, principal).status_code == 201
    return {"rutina_id": rutina_id, "slot_id": slot_id, "entrenamiento_id": entrenamiento_id}


def contar(sesion_bd, modelo) -> int:
    return sesion_bd.scalar(select(func.count()).select_from(modelo))


def test_borrar_un_entrenamiento_con_sus_series_cargadas_las_borra(sesion_bd, rutina_con_hueco):
    entrenamiento = sesion_bd.get(Entrenamiento, rutina_con_hueco["entrenamiento_id"])
    assert len(entrenamiento.series) == 1  # la lista, cargada a propósito

    sesion_bd.delete(entrenamiento)
    sesion_bd.commit()

    assert contar(sesion_bd, Serie) == 0


def test_borrar_un_hueco_con_sus_comodines_cargados_los_borra(sesion_bd, rutina_con_hueco):
    # Sin su sesión no quedan series en el hueco: con ellas, su FK (RESTRICT) lo impide.
    sesion_bd.delete(sesion_bd.get(Entrenamiento, rutina_con_hueco["entrenamiento_id"]))
    sesion_bd.commit()
    hueco = sesion_bd.get(RutinaSlot, rutina_con_hueco["slot_id"])
    assert len(hueco.slot_alternativas) == 1

    sesion_bd.delete(hueco)
    sesion_bd.commit()

    assert contar(sesion_bd, SlotAlternativa) == 0


def test_borrar_un_programa_con_sus_dias_y_periodos_cargados_los_borra(cliente, sesion_bd):
    """Las dos listas a la vez, con una fila de día cerrada y un periodo cerrado
    además de los vigentes: el CASCADE de la base no llega a actuar, los borra el
    `cascade="all, delete-orphan"` de cada relación.
    """
    push = crear_rutina(cliente)
    programa = cliente.post(
        "/programas", json={"nombre": "PPL", "dias": [{"dia_semana": 1, "rutina_id": push}]}
    ).json()["id"]
    sesion_bd.add_all(
        [
            ProgramaDia(
                programa_id=programa,
                dia_semana=2,
                rutina_id=push,
                desde=date(2026, 8, 1),
                hasta=date(2026, 9, 1),
            ),
            ProgramaPeriodo(programa_id=programa, desde=date(2026, 8, 1), hasta=date(2026, 9, 1)),
            ProgramaPeriodo(programa_id=programa, desde=date(2026, 9, 7)),
        ]
    )
    sesion_bd.commit()
    cargado = sesion_bd.get(Programa, programa)
    assert (len(cargado.filas_dias), len(cargado.periodos)) == (2, 2)

    sesion_bd.delete(cargado)
    sesion_bd.commit()

    assert (contar(sesion_bd, ProgramaDia), contar(sesion_bd, ProgramaPeriodo)) == (0, 0)


def test_borrar_una_rutina_con_sus_huecos_cargados_lo_sigue_impidiendo_la_base(
    sesion_bd, rutina_con_hueco
):
    """Los huecos no se borran con su rutina: su FK es RESTRICT a propósito, y el
    endpoint los borra antes, explícitamente. Con la lista cargada o sin cargar,
    quien decide tiene que ser esa restricción, y no un intento de SQLAlchemy de
    dejar los huecos sin rutina.
    """
    # Sin su sesión, que también la referencia (RESTRICT): así lo que bloquea es el
    # hueco y no el entrenamiento.
    sesion_bd.delete(sesion_bd.get(Entrenamiento, rutina_con_hueco["entrenamiento_id"]))
    sesion_bd.commit()
    rutina = sesion_bd.get(Rutina, rutina_con_hueco["rutina_id"])
    assert len(rutina.slots) == 1

    sesion_bd.delete(rutina)
    with pytest.raises(IntegrityError) as error:
        sesion_bd.commit()
    sesion_bd.rollback()

    assert isinstance(error.value.orig, psycopg2.errors.ForeignKeyViolation)
    assert error.value.orig.diag.table_name == "rutina_slots"
