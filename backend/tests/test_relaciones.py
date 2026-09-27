"""Tests de cómo se comportan las relaciones uno-a-muchos al borrar al padre con
la lista de hijos ya cargada en memoria.

Es un caso que ningún endpoint provoca hoy, pero que ya dio un 500 real con los
programas: con los hijos cargados, `passive_deletes=True` no impide que
SQLAlchemy intente poner su FK a NULL. Se prueba a nivel de ORM, cargando la
lista a propósito antes de borrar, para que el día que un endpoint lo haga no
aparezca el mismo fallo.
"""

import psycopg2.errors
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import Entrenamiento, Rutina, RutinaSlot, Serie, SlotAlternativa


@pytest.fixture
def rutina_con_hueco(cliente, grupo_muscular_id):
    """Una rutina con un hueco que tiene un comodín, y una sesión con una serie."""

    def ejercicio(nombre):
        return cliente.post(
            "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
        ).json()["id"]

    principal, comodin = ejercicio("Press banca"), ejercicio("Press en máquina")
    rutina_id = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    slot_id = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": principal,
            "orden": 1,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    ).json()["id"]
    cliente.post(
        f"/rutinas/{rutina_id}/slots/{slot_id}/alternativas", json={"ejercicio_id": comodin}
    )
    entrenamiento_id = cliente.post("/entrenamientos", json={"fecha": "2026-09-01"}).json()["id"]
    cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={"ejercicio_id": principal, "numero_serie": 1, "peso": 60, "repeticiones": 8},
    )
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
    hueco = sesion_bd.get(RutinaSlot, rutina_con_hueco["slot_id"])
    assert len(hueco.slot_alternativas) == 1

    sesion_bd.delete(hueco)
    sesion_bd.commit()

    assert contar(sesion_bd, SlotAlternativa) == 0


def test_borrar_una_rutina_con_sus_huecos_cargados_lo_sigue_impidiendo_la_base(
    sesion_bd, rutina_con_hueco
):
    """Los huecos no se borran con su rutina: su FK es RESTRICT a propósito, y el
    endpoint los borra antes, explícitamente. Con la lista cargada o sin cargar,
    quien decide tiene que ser esa restricción, y no un intento de SQLAlchemy de
    dejar los huecos sin rutina.
    """
    rutina = sesion_bd.get(Rutina, rutina_con_hueco["rutina_id"])
    assert len(rutina.slots) == 1

    sesion_bd.delete(rutina)
    with pytest.raises(IntegrityError) as error:
        sesion_bd.commit()
    sesion_bd.rollback()

    assert isinstance(error.value.orig, psycopg2.errors.ForeignKeyViolation)
