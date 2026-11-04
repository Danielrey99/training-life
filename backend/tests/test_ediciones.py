"""Tests unitarios de `app/ediciones.py`: las cuentas del *Guardar* de los modos de
editar (la semana, la rutina y el día del historial), sin API ni base de datos.

Son Python puro y el móvil las porta tal cual: estos tests son su especificación. Lo
que pasa por la API (códigos, todo o nada), en `test_programas.py`, `test_rutinas.py`
y `test_guardar_un_dia.py`.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.ediciones import (
    cambios_de_series,
    dias_que_cambian,
    mezcla_en_hueco,
    motivo_de_la_fecha,
    reparto_del_orden,
)
from tests.ayudas import no_seguias_el_programa, solo_puede_ir

# --- dias_que_cambian ------------------------------------------------------------


def test_dias_que_cambian_da_los_cambiados_los_nuevos_y_los_que_pasan_a_descanso():
    vigentes = {1: 10, 3: 20, 5: 30}
    pedidos = {1: 11, 3: 20, 6: 30}

    assert dias_que_cambian(vigentes, pedidos) == [(1, 11), (5, None), (6, 30)]


@pytest.mark.parametrize("semana", [{}, {1: 10, 7: 10}])
def test_dias_que_cambian_con_la_misma_semana_no_da_ninguno(semana):
    assert dias_que_cambian(semana, dict(semana)) == []


def test_dias_que_cambian_va_del_lunes_al_domingo():
    """En orden: el router los cambia en ese orden, uno detrás de otro."""
    assert dias_que_cambian({}, {7: 1, 2: 1, 5: 1}) == [(2, 1), (5, 1), (7, 1)]


# --- reparto_del_orden ---------------------------------------------------------


def test_reparto_del_orden_reparte_los_orden_que_ya_tenian():
    """Los visibles tienen 1, 2 y 5 (el 3 y el 4 son de ocultos): se los reparten en
    el orden pedido, y nadie toca el 3 ni el 4.
    """
    assert reparto_del_orden({7: 1, 8: 2, 9: 5}, [9, 7, 8]) == {9: 1, 7: 2, 8: 5}


@pytest.mark.parametrize("visibles", [{}, {7: 1, 8: 2, 9: 5}])
def test_reparto_del_orden_sin_cambios_es_vacio(visibles):
    assert reparto_del_orden(visibles, sorted(visibles, key=visibles.get)) == {}


@pytest.mark.parametrize(
    "slot_ids",
    [[7, 8], [7, 8, 9, 10], [7, 7, 9], [7, 8, 9, 9], [10, 8, 9]],
    ids=["falta uno", "sobra uno", "repetido en vez de otro", "repetido de más", "uno ajeno"],
)
def test_reparto_del_orden_sin_ser_exactamente_los_visibles_es_none(slot_ids):
    assert reparto_del_orden({7: 1, 8: 2, 9: 5}, slot_ids) is None


# --- cambios_de_series ---------------------------------------------------------


def guardada(ejercicio=1, hueco=1, numero=1, peso="60.00", reps=8, **campos) -> dict:
    """Una serie como la lee el router de la base: el peso, `Decimal` con dos decimales."""
    return {
        "ejercicio_id": ejercicio,
        "slot_id": hueco,
        "numero_serie": numero,
        "peso": None if peso is None else Decimal(peso),
        "repeticiones": reps,
        "duracion_s": None,
        "distancia_m": None,
        "peso_corporal": None,
        "variante": None,
        **campos,
    }


def test_cambios_de_series_separa_borrar_cambiar_crear_y_ajenas():
    guardadas = {1: guardada(numero=1), 2: guardada(numero=2), 3: guardada(numero=3)}
    igual = {"id": 1, **guardada(numero=1)}
    cambiada = {"id": 2, **guardada(numero=2, reps=6)}
    nueva = {"id": None, **guardada(numero=4)}
    ajena = {"id": 99, **guardada(numero=5)}

    assert cambios_de_series(guardadas, [igual, cambiada, nueva, ajena]) == (
        [3],
        [cambiada],
        [nueva],
        [99],
    )


def test_una_serie_sin_la_clave_id_es_nueva():
    nueva = guardada()

    assert cambios_de_series({}, [nueva]) == ([], [], [nueva], [])


@pytest.mark.parametrize(
    "campo, valor",
    [
        ("ejercicio_id", 2),
        ("slot_id", 2),
        ("numero_serie", 2),
        ("peso", Decimal("60.5")),
        ("repeticiones", 9),
        ("duracion_s", 30),
        ("distancia_m", 100),
        ("peso_corporal", Decimal("80")),
        ("variante", "Agarre cerrado"),
    ],
)
def test_cualquier_campo_distinto_cambia_la_serie(campo, valor):
    pedida = {"id": 1, **guardada(), campo: valor}

    assert cambios_de_series({1: guardada()}, [pedida]) == ([], [pedida], [], [])


def test_el_peso_se_compara_como_numero():
    """62,5 pedido y 62,50 guardado son el mismo peso."""
    pedida = {"id": 1, **guardada(peso="62.5")}

    assert cambios_de_series({1: guardada(peso="62.50")}, [pedida]) == ([], [], [], [])


def test_sin_series_pedidas_se_borran_todas():
    assert cambios_de_series({1: guardada(), 2: guardada()}, []) == ([1, 2], [], [], [])


# --- mezcla_en_hueco -----------------------------------------------------------


def test_sin_mezcla_es_none():
    assert mezcla_en_hueco([(1, 10), (1, 10), (2, 20)], {1, 2}) is None


def test_la_mezcla_en_un_hueco_tocado_da_los_dos_primeros_ejercicios():
    assert mezcla_en_hueco([(2, 20), (1, 10), (1, 11), (1, 12)], {1}) == (10, 11)


def test_la_mezcla_en_un_hueco_que_no_se_toca_no_cuenta():
    """Una sesión ya mezclada en la que solo se corrige un peso no se bloquea."""
    assert mezcla_en_hueco([(1, 10), (1, 11), (2, 20)], {2}) is None
    assert mezcla_en_hueco([(1, 10), (1, 11)], set()) is None


# --- motivo_de_la_fecha --------------------------------------------------------

# Lo del lunes 14 de septiembre se entrena del lunes 14 al domingo 20.
LUNES = date(2026, 9, 14)
DOMINGO = date(2026, 9, 20)


def test_despues_del_plazo_dice_hasta_donde_puede_ir():
    assert motivo_de_la_fecha("Push", LUNES, date(2026, 9, 21), LUNES, DOMINGO) == solo_puede_ir(
        "Push", LUNES, "hasta", DOMINGO
    )


def test_antes_del_plazo_dice_desde_donde_puede_ir():
    """Lo del viernes 18 se adelanta como mucho hasta el lunes 14 de su semana."""
    viernes = date(2026, 9, 18)

    assert motivo_de_la_fecha(
        "Leg", viernes, date(2026, 9, 13), LUNES, date(2026, 9, 24)
    ) == solo_puede_ir("Leg", viernes, "desde", LUNES)


@pytest.mark.parametrize("nueva", [LUNES, date(2026, 9, 16), DOMINGO])
def test_dentro_del_plazo_el_motivo_es_el_programa(nueva):
    """Los dos extremos del plazo cuentan como dentro."""
    assert motivo_de_la_fecha("Push", LUNES, nueva, LUNES, DOMINGO) == no_seguias_el_programa(
        "Push", LUNES, nueva
    )
