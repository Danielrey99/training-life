"""Tests de «hoy» en la zona de quien pide: la cabecera `X-Zona-Horaria`.

La web manda la zona de su navegador en cada petición, y el backend calcula «hoy» con
ella durante esa petición (`app/fechas.py`, middleware de `app/main.py`). Sin cabecera, o
con una que no vale, «hoy» es el de `ZONA_HORARIA` (Madrid), sin error.

El escenario de todos: las 23:30 del miércoles 16 en Madrid, que en Tokio ya son las 6:30
del jueves 17.
"""

from datetime import date, time

import pytest

from tests.ayudas import crear_programa, crear_rutina, entrenar

DIA_EN_MADRID = date(2026, 9, 16)
DIA_EN_TOKIO = date(2026, 9, 17)
TOKIO = {"X-Zona-Horaria": "Asia/Tokyo"}


@pytest.fixture
def a_las_23_30_en_madrid(hoy_es):
    hoy_es(DIA_EN_MADRID, time(23, 30))


def fecha_de_hoy(cliente, cabeceras=None) -> str:
    respuesta = cliente.get("/plan/hoy", headers=cabeceras)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()["fecha"]


def entrenar_con(cliente, fecha, cabeceras):
    return cliente.post(
        "/entrenamientos",
        json={"rutina_id": crear_rutina(cliente), "fecha": fecha.isoformat()},
        headers=cabeceras,
    )


def test_hoy_es_el_dia_de_la_zona_que_manda_quien_pide(cliente, a_las_23_30_en_madrid):
    """Y la zona no se queda pegada: la petición siguiente, sin cabecera, vuelve a Madrid."""
    assert fecha_de_hoy(cliente, TOKIO) == DIA_EN_TOKIO.isoformat()
    assert fecha_de_hoy(cliente) == DIA_EN_MADRID.isoformat()
    assert fecha_de_hoy(cliente, TOKIO) == DIA_EN_TOKIO.isoformat()


def test_una_sesion_del_dia_siguiente_de_madrid_se_apunta_si_en_esa_zona_ya_ha_llegado(
    cliente, a_las_23_30_en_madrid
):
    sin_cabecera = entrenar(cliente, DIA_EN_TOKIO)
    assert sin_cabecera.status_code == 422
    assert "todavía no ha llegado" in sin_cabecera.json()["detail"]

    respuesta = entrenar_con(cliente, DIA_EN_TOKIO, TOKIO)

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["en_curso"] is True


def test_una_sesion_esta_en_curso_segun_la_zona_con_que_se_lee(cliente, a_las_23_30_en_madrid):
    """La de hoy en Madrid, leída desde Tokio, ya es de ayer: no está en curso."""
    sesion_id = entrenar(cliente, DIA_EN_MADRID).json()["id"]

    assert cliente.get(f"/entrenamientos/{sesion_id}").json()["en_curso"] is True
    assert cliente.get(f"/entrenamientos/{sesion_id}", headers=TOKIO).json()["en_curso"] is False


@pytest.mark.parametrize(
    "zona",
    [
        "Marte/Olympus",
        # Una carpeta, no una zona.
        "Asia",
        # Con otras mayúsculas: en Windows el archivo se abriría igual.
        "asia/tokyo",
        "Asia\\Tokyo",
        "",
        "A" * 200,
    ],
    ids=["inexistente", "carpeta", "minusculas", "barra-de-windows", "vacia", "200-caracteres"],
)
def test_una_cabecera_de_zona_que_no_vale_es_como_no_mandarla(cliente, a_las_23_30_en_madrid, zona):
    cabeceras = {"X-Zona-Horaria": zona}

    assert fecha_de_hoy(cliente, cabeceras) == DIA_EN_MADRID.isoformat()
    assert entrenar_con(cliente, DIA_EN_MADRID, cabeceras).status_code == 201


def test_exportar_escribe_la_zona_de_quien_pide_y_nombra_el_archivo_con_su_dia(
    cliente, a_las_23_30_en_madrid
):
    respuesta = cliente.get("/datos/exportar", headers=TOKIO)

    assert respuesta.status_code == 200
    assert respuesta.json()["zona_horaria"] == "Asia/Tokyo"
    assert respuesta.headers["content-disposition"] == (
        'attachment; filename="training-life-2026-09-17.json"'
    )


def test_ocultar_y_activar_usan_el_dia_de_la_zona_de_quien_pide(cliente, a_las_23_30_en_madrid):
    rutina_id = crear_rutina(cliente)
    programa_id = crear_programa(cliente)["id"]

    activado = cliente.post(f"/programas/{programa_id}/activar", headers=TOKIO)
    ocultada = cliente.delete(f"/rutinas/{rutina_id}?modo=ocultar", headers=TOKIO)

    assert activado.status_code == 200, activado.text
    assert activado.json()["ultimo_periodo"]["desde"] == DIA_EN_TOKIO.isoformat()
    assert ocultada.status_code == 204, ocultada.text
    rutina = cliente.get(f"/rutinas/{rutina_id}").json()
    assert rutina["oculto_desde"] == DIA_EN_TOKIO.isoformat()
