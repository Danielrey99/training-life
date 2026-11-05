"""Tests de cómo se escriben las fechas y los días en los mensajes (`app/fechas.py`).

Los mensajes del servidor dicen las fechas como la web («martes 27 de octubre»), con
el año solo si no es el de hoy. Los demás tests construyen sus mensajes esperados con
`fecha_en_texto`; aquí se fija su salida literal.
"""

from datetime import date

import pytest

from app.fechas import fecha_en_texto, nombre_del_dia


def test_una_fecha_de_otro_anio_lleva_el_anio(hoy_es):
    hoy_es(date(2026, 10, 27))

    assert fecha_en_texto(date(2025, 10, 1)) == "miércoles 1 de octubre de 2025"
    assert fecha_en_texto(date(2027, 1, 4)) == "lunes 4 de enero de 2027"


def test_el_anio_que_manda_es_el_de_hoy_y_no_el_del_reloj_real(hoy_es):
    """Con «hoy» en 2025, una fecha de 2025 va sin año y una de 2026 lo lleva."""
    hoy_es(date(2025, 12, 31))

    assert fecha_en_texto(date(2025, 12, 31)) == "miércoles 31 de diciembre"
    assert fecha_en_texto(date(2026, 1, 1)) == "jueves 1 de enero de 2026"


def test_los_bordes_del_calendario_no_dan_error(hoy_es):
    """No suma días: el primero y el último día que existen se escriben sin más."""
    hoy_es(date(2026, 10, 27))

    assert fecha_en_texto(date(1, 1, 1)) == "lunes 1 de enero de 1"
    assert fecha_en_texto(date(9999, 12, 31)) == "viernes 31 de diciembre de 9999"


@pytest.mark.parametrize(
    "dia_semana, nombre",
    [(1, "lunes"), (3, "miércoles"), (6, "sábado"), (7, "domingo")],
)
def test_el_dia_de_la_semana_va_del_lunes_al_domingo(dia_semana, nombre):
    """Del 1 al 7, como `dia_semana` en la API: el 1 es el lunes y el 7 el domingo."""
    assert nombre_del_dia(dia_semana) == nombre
