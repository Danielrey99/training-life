"""Tests de la sesión en curso: `terminada_en`, `en_curso`, `POST .../terminar`,
los filtros del listado y la regla de una sesión por día.

"En curso" depende de qué día es hoy, así que todo el archivo congela el reloj del
backend (`app.fechas`) en `HOY`. Calcularlo con `hoy()` al importar el módulo
fallaría si la tanda cruzara la medianoche.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app import fechas
from tests.ayudas import crear_ejercicio, crear_rutina, entrenar, rutina_en_bd, serie_en
from tests.semana import HOY

AYER = HOY - timedelta(days=1)


@pytest.fixture(autouse=True)
def reloj_congelado(hoy_es):
    hoy_es(HOY)


def empezar(cliente, fecha=HOY) -> dict:
    respuesta = entrenar(cliente, fecha)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def terminar(cliente, entrenamiento_id) -> dict:
    respuesta = cliente.post(f"/entrenamientos/{entrenamiento_id}/terminar")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


# --- En curso y terminada ------------------------------------------------


def test_terminar_la_saca_de_en_curso_y_terminar_dos_veces_conserva_la_primera_hora(cliente):
    """`terminada_en` es el instante real en que se termina (con su zona), no la
    fecha congelada de los tests: el reloj de `app.fechas` solo decide el día.
    """
    empezada = empezar(cliente)
    assert (empezada["terminada_en"], empezada["en_curso"]) == (None, True)

    antes = datetime.now(timezone.utc)
    primera = terminar(cliente, empezada["id"])
    despues = datetime.now(timezone.utc)
    segunda = terminar(cliente, empezada["id"])

    terminada_en = datetime.fromisoformat(primera["terminada_en"])
    assert terminada_en.tzinfo is not None
    assert antes <= terminada_en <= despues
    assert primera["en_curso"] is False
    assert segunda["terminada_en"] == primera["terminada_en"]


def test_una_sesion_de_ayer_sin_terminar_no_esta_en_curso(cliente):
    """Una sesión que se quedó abierta de un día para otro cuenta como terminada,
    sin que nadie tenga que cerrarla.
    """
    sesion = empezar(cliente, AYER)

    assert sesion["terminada_en"] is None
    assert sesion["en_curso"] is False


def test_una_sesion_terminada_admite_mas_series(cliente, grupo_muscular_id):
    """Terminada no es cerrada: corregir un día ya pasado añade o cambia series."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    sesion_id = terminar(cliente, empezar(cliente)["id"])["id"]

    respuesta = serie_en(cliente, sesion_id, ejercicio_id)

    assert respuesta.status_code == 201


# --- Una sesión por día --------------------------------------------------


def con_una_serie(cliente, grupo_muscular_id, sesion_id) -> None:
    """Una sesión con algo hecho: sin series contaría como cancelada."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    respuesta = serie_en(cliente, sesion_id, ejercicio_id)
    assert respuesta.status_code == 201


def test_con_una_sesion_en_curso_no_se_puede_empezar_otra_hoy(cliente):
    abierta = empezar(cliente)

    respuesta = entrenar(cliente, HOY)

    assert respuesta.status_code == 409
    # Dice cuál es y que está en curso, para que la pantalla ofrezca continuarla.
    assert respuesta.json()["detail"]["entrenamiento_id"] == abierta["id"]
    assert respuesta.json()["detail"]["en_curso"] is True


def test_terminada_la_sesion_de_hoy_no_se_puede_empezar_otra(cliente, grupo_muscular_id):
    """Se entrena una rutina al día: terminar la de hoy no deja el día libre."""
    sesion = empezar(cliente)
    con_una_serie(cliente, grupo_muscular_id, sesion["id"])
    terminar(cliente, sesion["id"])

    respuesta = entrenar(cliente, HOY)

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["entrenamiento_id"] == sesion["id"]
    assert respuesta.json()["detail"]["en_curso"] is False


def test_una_sesion_de_hoy_terminada_sin_series_no_ocupa_el_dia(cliente):
    """Sin nada hecho cuenta como cancelada: el día queda libre y se borra al
    empezar otra.
    """
    vacia = terminar(cliente, empezar(cliente)["id"])

    assert entrenar(cliente, HOY).status_code == 201
    assert cliente.get(f"/entrenamientos/{vacia['id']}").status_code == 404


def test_una_sesion_pasada_sin_series_no_ocupa_su_dia(cliente):
    vacia = empezar(cliente, AYER)

    assert entrenar(cliente, AYER).status_code == 201
    assert cliente.get(f"/entrenamientos/{vacia['id']}").status_code == 404


def test_una_sesion_en_curso_no_impide_apuntar_un_dia_pasado(cliente):
    """Registrar lo que se hizo otro día no es empezar a entrenar."""
    empezar(cliente)

    assert entrenar(cliente, AYER).status_code == 201


def test_una_sesion_de_ayer_sin_terminar_no_impide_empezar_hoy(cliente):
    empezar(cliente, AYER)

    assert entrenar(cliente, HOY).status_code == 201


def test_no_se_puede_mover_una_sesion_a_un_dia_que_ya_tiene_otra(cliente, grupo_muscular_id):
    """La de hoy está vacía, pero en curso: ocupa el día. El 409 dice cuál es."""
    de_hoy = empezar(cliente)
    de_ayer = empezar(cliente, AYER)
    con_una_serie(cliente, grupo_muscular_id, de_ayer["id"])

    respuesta = cliente.put(
        f"/entrenamientos/{de_ayer['id']}",
        json={"fecha": HOY.isoformat()},
    )

    assert respuesta.status_code == 409
    detalle = respuesta.json()["detail"]
    assert (detalle["entrenamiento_id"], detalle["en_curso"]) == (de_hoy["id"], True)
    assert cliente.get(f"/entrenamientos/{de_ayer['id']}").json()["fecha"] == AYER.isoformat()


def test_mover_una_sesion_al_dia_de_una_cancelada_borra_la_cancelada(cliente, grupo_muscular_id):
    """Una sesión sin series de un día pasado está cancelada y no ocupa su fecha,
    tampoco al corregir la fecha de otra: se borra para dejar sitio, como al crear
    una nueva (y no sale el 500 de `entrenamientos_fecha_key`).
    """
    cancelada = empezar(cliente, AYER)
    otra = empezar(cliente, AYER - timedelta(days=1))
    con_una_serie(cliente, grupo_muscular_id, otra["id"])

    respuesta = cliente.put(f"/entrenamientos/{otra['id']}", json={"fecha": AYER.isoformat()})

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["fecha"] == AYER.isoformat()
    assert len(respuesta.json()["series"]) == 1
    assert cliente.get(f"/entrenamientos/{cancelada['id']}").status_code == 404


def test_editar_la_propia_sesion_en_curso_no_choca_consigo_misma(cliente):
    sesion = empezar(cliente)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion['id']}",
        json={"fecha": HOY.isoformat(), "notas": "Buen día"},
    )

    assert respuesta.status_code == 200


def test_la_base_no_admite_dos_sesiones_el_mismo_dia(sesion_bd):
    """La regla vive también en la base, por si algo se salta la API. Sin
    `cubre_fecha` (nulas): lo que choca es la fecha, no el día que cuentan.
    """
    from sqlalchemy.exc import IntegrityError

    from app.models import Entrenamiento

    rutina_id = rutina_en_bd(sesion_bd)
    sesion_bd.add_all([Entrenamiento(rutina_id=rutina_id, fecha=AYER) for _ in range(2)])
    with pytest.raises(IntegrityError) as error:
        sesion_bd.commit()
    sesion_bd.rollback()
    assert "entrenamientos_fecha_key" in str(error.value)


def test_la_base_admite_varias_sesiones_que_no_cuentan_ningun_dia(sesion_bd):
    """`cubre_fecha` es única, pero las nulas no chocan entre sí: una sesión que
    no cuenta ningún día (suelta, o que soltó el suyo) es lo normal.
    """
    from sqlalchemy import func, select

    from app.models import Entrenamiento

    rutina_id = rutina_en_bd(sesion_bd)
    sesion_bd.add_all(
        [Entrenamiento(rutina_id=rutina_id, fecha=HOY - timedelta(days=n)) for n in (1, 2, 3)]
    )
    sesion_bd.commit()

    assert sesion_bd.scalar(select(func.count()).select_from(Entrenamiento)) == 3


# --- Filtros del listado -------------------------------------------------


def test_el_listado_sin_terminar_da_las_de_dias_pasados_abiertas_con_series_o_vacias(
    cliente, ejercicio_predefinido_id
):
    """Las de un día pasado que se quedaron sin terminar: las que tienen algo
    apuntado (quizá se dejaron a medias) y también las vacías (quizá se abrieron
    para apuntar un día pasado y se olvidaron; E1 las marca como *vacía*). Antes
    las vacías no salían. Ni la de hoy (sigue en curso) ni las terminadas. De la
    más reciente a la más antigua.
    """

    def con_serie(sesion):
        serie_en(cliente, sesion["id"], ejercicio_predefinido_id, peso=40, repeticiones=10)
        return sesion

    a_medias = con_serie(empezar(cliente, AYER))
    terminar(cliente, con_serie(empezar(cliente, HOY - timedelta(days=2)))["id"])
    vacia = empezar(cliente, HOY - timedelta(days=3))
    con_serie(empezar(cliente))

    respuesta = cliente.get("/entrenamientos", params={"sin_terminar": True})

    assert [sesion["id"] for sesion in respuesta.json()] == [a_medias["id"], vacia["id"]]
    assert respuesta.json()[1]["series"] == []


def test_el_listado_sin_terminar_no_da_la_vacia_terminada_ni_la_vacia_de_hoy(cliente):
    terminar(cliente, empezar(cliente, AYER)["id"])
    empezar(cliente)

    assert cliente.get("/entrenamientos", params={"sin_terminar": True}).json() == []


def test_cancelada_y_en_curso_dicen_lo_mismo_en_sql_que_en_python(
    cliente, sesion_bd, ejercicio_predefinido_id
):
    """`cancelada_sql` y `en_curso_sql` (para un WHERE) van en pareja con
    `esta_cancelada` y `Entrenamiento.en_curso`. Si una regla cambia y la otra no,
    borrar una rutina, el aviso y el seguimiento dirían cosas distintas de la misma
    sesión. Se comparan con todos los casos: con y sin series, de hoy y de días
    pasados, terminadas y sin terminar.

    Son seis, pero la de hoy abierta y vacía y la de hoy terminada y vacía no caben a
    la vez (una sesión al día): se compara con la de hoy abierta, se termina y se
    vuelve a comparar.
    """
    from sqlalchemy import select

    from app.models import Entrenamiento
    from app.seguimiento import cancelada_sql, en_curso_sql, esta_cancelada

    def comparar() -> tuple[set, set]:
        sesion_bd.expire_all()
        sesiones = sesion_bd.scalars(select(Entrenamiento)).all()
        canceladas = set(sesion_bd.scalars(select(Entrenamiento.id).where(cancelada_sql())))
        en_curso = set(sesion_bd.scalars(select(Entrenamiento.id).where(en_curso_sql())))
        assert len(sesiones) == 5
        assert canceladas == {s.id for s in sesiones if esta_cancelada(s)}
        assert en_curso == {s.id for s in sesiones if s.en_curso}
        # Que la comparación no sea trivial: hay sesiones de las dos clases.
        assert 0 < len(canceladas) < len(sesiones)
        return canceladas, en_curso

    ids = {}
    for dias_atras, series, terminada in [
        (0, False, False),
        (1, False, False),
        (2, False, True),
        (3, True, False),
        (4, True, True),
    ]:
        sesion = empezar(cliente, HOY - timedelta(days=dias_atras))
        ids[dias_atras] = sesion["id"]
        if series:
            serie_en(cliente, sesion["id"], ejercicio_predefinido_id)
        if terminada:
            terminar(cliente, sesion["id"])

    # Con la de hoy abierta y vacía: en curso, no cancelada.
    canceladas, en_curso = comparar()
    assert en_curso == {ids[0]}
    assert ids[0] not in canceladas

    # Con la de hoy terminada y vacía: ya no está en curso, así que es cancelada.
    terminar(cliente, ids[0])
    canceladas, en_curso = comparar()
    assert en_curso == set()
    assert ids[0] in canceladas


def test_el_listado_por_rutina_con_limite_da_sus_ultimas_sesiones(cliente):
    """Lo que usa el día del historial para comparar su volumen con la sesión
    anterior de la misma rutina, sin pedir todo el historial.
    """
    push, pull = crear_rutina(cliente, "Push"), crear_rutina(cliente, "Pull")

    def sesion(rutina_id, dias_atras):
        fecha = (HOY - timedelta(days=dias_atras)).isoformat()
        respuesta = cliente.post("/entrenamientos", json={"fecha": fecha, "rutina_id": rutina_id})
        assert respuesta.status_code == 201, respuesta.text
        return respuesta.json()["id"]

    antigua = sesion(push, 9)
    sesion(pull, 5)
    reciente = sesion(push, 2)

    todas = cliente.get("/entrenamientos", params={"rutina_id": push}).json()
    una = cliente.get("/entrenamientos", params={"rutina_id": push, "limite": 1}).json()

    assert [s["id"] for s in todas] == [reciente, antigua]
    assert [s["id"] for s in una] == [reciente]


@pytest.mark.parametrize("limite", [0, 501])
def test_el_listado_admite_un_limite_de_1_a_500(cliente, limite):
    respuesta = cliente.get("/entrenamientos", params={"limite": limite})

    assert respuesta.status_code == 422
    assert [e["loc"] for e in respuesta.json()["detail"]] == [["query", "limite"]]


def test_el_listado_filtra_por_rango_de_fechas_incluidos_los_extremos(cliente):
    for dias in (0, 1, 2, 3):
        empezar(cliente, HOY - timedelta(days=dias + 10))

    respuesta = cliente.get(
        "/entrenamientos",
        params={
            "desde": (HOY - timedelta(days=12)).isoformat(),
            "hasta": (HOY - timedelta(days=11)).isoformat(),
        },
    )

    fechas = [sesion["fecha"] for sesion in respuesta.json()]
    assert fechas == [
        (HOY - timedelta(days=11)).isoformat(),
        (HOY - timedelta(days=12)).isoformat(),
    ]


def test_el_listado_con_el_rango_invertido_da_422(cliente):
    respuesta = cliente.get(
        "/entrenamientos", params={"desde": HOY.isoformat(), "hasta": AYER.isoformat()}
    )

    assert respuesta.status_code == 422
    assert "invertido" in respuesta.json()["detail"]


# --- El futuro no se registra --------------------------------------------


def test_no_se_puede_apuntar_un_entrenamiento_en_el_futuro(cliente):
    """El futuro se planifica, no se apunta. Y una sesión de mañana sin terminar
    pasaría sola a estar en curso al llegar el día, sin que nadie la empezara.
    """
    manana = HOY + timedelta(days=1)

    respuesta = entrenar(cliente, manana)

    assert respuesta.status_code == 422
    assert "todavía no ha llegado" in respuesta.json()["detail"]
    assert cliente.get("/entrenamientos").json() == []


def test_no_se_puede_mover_un_entrenamiento_al_futuro(cliente):
    sesion = empezar(cliente, AYER)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion['id']}",
        json={"fecha": (HOY + timedelta(days=1)).isoformat()},
    )

    assert respuesta.status_code == 422
    assert "todavía no ha llegado" in respuesta.json()["detail"]
    assert cliente.get(f"/entrenamientos/{sesion['id']}").json()["fecha"] == AYER.isoformat()


# --- "Hoy" es el de Madrid, no el del servidor ----------------------------
#
# El contenedor corre en UTC. Entre medianoche y la 1 o las 2 de la madrugada
# (según el horario de verano), en España ya es el día siguiente y en UTC todavía
# no: si el backend usara la fecha del servidor, la sesión de las 00:30 quedaría
# en el día anterior o se rechazaría por "futura". Se congela el reloj de
# `app.fechas` en uno de esos instantes; todo lo que pasa por `hoy()` lo ve.

# 30 de junio de 2025, 22:30 en UTC = 1 de julio, 00:30 en Madrid (CEST, UTC+2). Lejos
# de la fecha real a propósito: si `hoy()` dejara de pasar por el reloj de Madrid,
# estos tests no podrían acertar por casualidad.
INSTANTE_UTC = datetime(2025, 6, 30, 22, 30, tzinfo=timezone.utc)


@pytest.fixture
def madrugada_en_madrid(monkeypatch):
    class RelojCongelado(datetime):
        @classmethod
        def now(cls, tz=None):
            return INSTANTE_UTC.astimezone(tz)

    monkeypatch.setattr(fechas, "datetime", RelojCongelado)


def test_a_las_00_30_en_espana_se_empieza_la_sesion_del_dia_nuevo(cliente, madrugada_en_madrid):
    """Ni "futura" (422) ni en el día anterior: es la sesión en curso de hoy."""
    respuesta = entrenar(cliente, "2025-07-01")

    assert respuesta.status_code == 201
    assert respuesta.json()["en_curso"] is True
    manana = entrenar(cliente, "2025-07-02")
    assert manana.status_code == 422
    assert "todavía no ha llegado" in manana.json()["detail"]
