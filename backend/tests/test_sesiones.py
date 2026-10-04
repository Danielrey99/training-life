"""Tests de la sesión en curso: `terminada_en`, `en_curso`, `POST .../terminar`,
los filtros del listado y la regla de una sesión por día.

"En curso" depende de qué día es hoy, así que las fechas de estos tests se
calculan con `app.fechas.hoy()`, la misma función que usa el backend, en vez de
escribirse a mano.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from app import fechas
from app.fechas import hoy

HOY = hoy()
AYER = HOY - timedelta(days=1)


def empezar(cliente, fecha=HOY) -> dict:
    respuesta = cliente.post("/entrenamientos", json={"fecha": fecha.isoformat()})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def terminar(cliente, entrenamiento_id) -> dict:
    respuesta = cliente.post(f"/entrenamientos/{entrenamiento_id}/terminar")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


# --- En curso y terminada ------------------------------------------------


def test_una_sesion_recien_empezada_hoy_esta_en_curso(cliente):
    sesion = empezar(cliente)

    assert sesion["terminada_en"] is None
    assert sesion["en_curso"] is True


def test_terminar_una_sesion_la_saca_de_en_curso(cliente):
    sesion = terminar(cliente, empezar(cliente)["id"])

    assert sesion["terminada_en"] is not None
    assert sesion["en_curso"] is False


def test_terminar_dos_veces_conserva_la_hora_de_la_primera(cliente):
    sesion_id = empezar(cliente)["id"]

    primera = terminar(cliente, sesion_id)["terminada_en"]
    segunda = terminar(cliente, sesion_id)["terminada_en"]

    assert segunda == primera


def test_una_sesion_de_ayer_sin_terminar_no_esta_en_curso(cliente):
    """Una sesión que se quedó abierta de un día para otro cuenta como terminada,
    sin que nadie tenga que cerrarla.
    """
    sesion = empezar(cliente, AYER)

    assert sesion["terminada_en"] is None
    assert sesion["en_curso"] is False


def test_una_sesion_terminada_admite_mas_series(cliente, grupo_muscular_id):
    """Terminada no es cerrada: corregir un día ya pasado añade o cambia series."""
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    sesion_id = terminar(cliente, empezar(cliente)["id"])["id"]

    respuesta = cliente.post(
        f"/entrenamientos/{sesion_id}/series",
        json={"ejercicio_id": ejercicio_id, "numero_serie": 1, "peso": 60, "repeticiones": 8},
    )

    assert respuesta.status_code == 201


def test_no_se_puede_terminar_una_sesion_que_no_existe(cliente):
    assert cliente.post("/entrenamientos/999999/terminar").status_code == 404


# --- Una sesión por día --------------------------------------------------


def con_una_serie(cliente, grupo_muscular_id, sesion_id) -> None:
    """Una sesión con algo hecho: sin series contaría como cancelada."""
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    respuesta = cliente.post(
        f"/entrenamientos/{sesion_id}/series",
        json={"ejercicio_id": ejercicio_id, "numero_serie": 1, "peso": 60, "repeticiones": 8},
    )
    assert respuesta.status_code == 201


def test_con_una_sesion_en_curso_no_se_puede_empezar_otra_hoy(cliente):
    abierta = empezar(cliente)

    respuesta = cliente.post("/entrenamientos", json={"fecha": HOY.isoformat()})

    assert respuesta.status_code == 409
    # Dice cuál es y que está en curso, para que la pantalla ofrezca continuarla.
    assert respuesta.json()["detail"]["entrenamiento_id"] == abierta["id"]
    assert respuesta.json()["detail"]["en_curso"] is True


def test_terminada_la_sesion_de_hoy_no_se_puede_empezar_otra(cliente, grupo_muscular_id):
    """Se entrena una rutina al día: terminar la de hoy no deja el día libre."""
    sesion = empezar(cliente)
    con_una_serie(cliente, grupo_muscular_id, sesion["id"])
    terminar(cliente, sesion["id"])

    respuesta = cliente.post("/entrenamientos", json={"fecha": HOY.isoformat()})

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["entrenamiento_id"] == sesion["id"]
    assert respuesta.json()["detail"]["en_curso"] is False


def test_una_sesion_de_hoy_terminada_sin_series_no_ocupa_el_dia(cliente):
    """Sin nada hecho cuenta como cancelada: el día queda libre y se borra al
    empezar otra.
    """
    vacia = terminar(cliente, empezar(cliente)["id"])

    assert cliente.post("/entrenamientos", json={"fecha": HOY.isoformat()}).status_code == 201
    assert cliente.get(f"/entrenamientos/{vacia['id']}").status_code == 404


def test_un_dia_pasado_con_sesion_no_admite_otra(cliente, grupo_muscular_id):
    sesion = empezar(cliente, AYER)
    con_una_serie(cliente, grupo_muscular_id, sesion["id"])

    respuesta = cliente.post("/entrenamientos", json={"fecha": AYER.isoformat()})

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"]["en_curso"] is False


def test_una_sesion_pasada_sin_series_no_ocupa_su_dia(cliente):
    vacia = empezar(cliente, AYER)

    assert cliente.post("/entrenamientos", json={"fecha": AYER.isoformat()}).status_code == 201
    assert cliente.get(f"/entrenamientos/{vacia['id']}").status_code == 404


def test_una_sesion_en_curso_no_impide_apuntar_un_dia_pasado(cliente):
    """Registrar lo que se hizo otro día no es empezar a entrenar."""
    empezar(cliente)

    assert cliente.post("/entrenamientos", json={"fecha": AYER.isoformat()}).status_code == 201


def test_una_sesion_de_ayer_sin_terminar_no_impide_empezar_hoy(cliente):
    empezar(cliente, AYER)

    assert cliente.post("/entrenamientos", json={"fecha": HOY.isoformat()}).status_code == 201


def test_no_se_puede_mover_una_sesion_a_un_dia_que_ya_tiene_otra(cliente, grupo_muscular_id):
    empezar(cliente)
    de_ayer = empezar(cliente, AYER)
    con_una_serie(cliente, grupo_muscular_id, de_ayer["id"])

    respuesta = cliente.put(f"/entrenamientos/{de_ayer['id']}", json={"fecha": HOY.isoformat()})

    assert respuesta.status_code == 409
    assert cliente.get(f"/entrenamientos/{de_ayer['id']}").json()["fecha"] == AYER.isoformat()


def test_una_sesion_se_puede_mover_a_un_dia_libre(cliente):
    de_ayer = empezar(cliente, AYER)
    otro_dia = (AYER - timedelta(days=1)).isoformat()

    respuesta = cliente.put(f"/entrenamientos/{de_ayer['id']}", json={"fecha": otro_dia})

    assert respuesta.status_code == 200
    assert respuesta.json()["fecha"] == otro_dia


def test_editar_la_propia_sesion_en_curso_no_choca_consigo_misma(cliente):
    sesion = empezar(cliente)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion['id']}", json={"fecha": HOY.isoformat(), "notas": "Buen día"}
    )

    assert respuesta.status_code == 200


def test_la_base_no_admite_dos_sesiones_del_mismo_usuario_el_mismo_dia(sesion_bd):
    """La regla vive también en la base, por si algo se salta la API."""
    from sqlalchemy.exc import IntegrityError

    from app.auth import get_usuario_actual_id
    from app.models import Entrenamiento

    usuario_id = get_usuario_actual_id()
    sesion_bd.add_all([Entrenamiento(usuario_id=usuario_id, fecha=AYER) for _ in range(2)])
    with pytest.raises(IntegrityError):
        sesion_bd.commit()
    sesion_bd.rollback()


def test_la_sesion_de_otro_usuario_no_ocupa_mi_dia(cliente, sesion_bd, otro_usuario_id):
    from app.models import Entrenamiento

    sesion_bd.add(Entrenamiento(usuario_id=otro_usuario_id, fecha=HOY))
    sesion_bd.commit()

    assert cliente.post("/entrenamientos", json={"fecha": HOY.isoformat()}).status_code == 201


# --- Filtros del listado -------------------------------------------------


def test_el_listado_con_en_curso_devuelve_solo_la_sesion_abierta_de_hoy(cliente):
    terminar(cliente, empezar(cliente, AYER)["id"])
    empezar(cliente, HOY - timedelta(days=2))
    abierta = empezar(cliente)

    respuesta = cliente.get("/entrenamientos", params={"en_curso": True})

    assert [sesion["id"] for sesion in respuesta.json()] == [abierta["id"]]


def test_el_listado_con_en_curso_sin_ninguna_abierta_esta_vacio(cliente):
    terminar(cliente, empezar(cliente)["id"])

    assert cliente.get("/entrenamientos", params={"en_curso": True}).json() == []


def test_el_listado_sin_terminar_da_las_de_dias_pasados_abiertas_y_con_series(
    cliente, ejercicio_predefinido_id
):
    """Las que se dejaron a medias: de un día pasado, sin terminar y con algo
    apuntado. Ni la de hoy (sigue en curso), ni las terminadas, ni las vacías (ya
    cuentan como canceladas).
    """

    def con_serie(sesion):
        cliente.post(
            f"/entrenamientos/{sesion['id']}/series",
            json={
                "ejercicio_id": ejercicio_predefinido_id,
                "numero_serie": 1,
                "peso": 40,
                "repeticiones": 10,
            },
        )
        return sesion

    a_medias = con_serie(empezar(cliente, AYER))
    terminar(cliente, con_serie(empezar(cliente, HOY - timedelta(days=2)))["id"])
    empezar(cliente, HOY - timedelta(days=3))
    con_serie(empezar(cliente))

    respuesta = cliente.get("/entrenamientos", params={"sin_terminar": True})

    assert [sesion["id"] for sesion in respuesta.json()] == [a_medias["id"]]


def test_el_listado_sin_terminar_no_da_las_de_otro_usuario(
    cliente, sesion_bd, otro_usuario_id, ejercicio_predefinido_id
):
    from app.models import Entrenamiento, Serie

    ajena = Entrenamiento(usuario_id=otro_usuario_id, fecha=AYER)
    sesion_bd.add(ajena)
    sesion_bd.flush()
    sesion_bd.add(
        Serie(
            entrenamiento_id=ajena.id,
            ejercicio_id=ejercicio_predefinido_id,
            numero_serie=1,
            peso=40,
            repeticiones=10,
        )
    )
    sesion_bd.commit()

    assert cliente.get("/entrenamientos", params={"sin_terminar": True}).json() == []


def test_el_listado_por_rutina_con_limite_da_sus_ultimas_sesiones(cliente):
    """Lo que usa el día del historial para comparar su volumen con la sesión
    anterior de la misma rutina, sin pedir todo el historial.
    """
    push = cliente.post("/rutinas", json={"nombre": "Push"}).json()["id"]
    pull = cliente.post("/rutinas", json={"nombre": "Pull"}).json()["id"]

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


def test_el_listado_rechaza_un_limite_que_no_es_positivo(cliente):
    assert cliente.get("/entrenamientos", params={"limite": 0}).status_code == 422


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


# --- El futuro no se registra --------------------------------------------


def test_no_se_puede_apuntar_un_entrenamiento_en_el_futuro(cliente):
    """El futuro se planifica, no se apunta. Y una sesión de mañana sin terminar
    pasaría sola a estar en curso al llegar el día, sin que nadie la empezara.
    """
    manana = HOY + timedelta(days=1)

    respuesta = cliente.post("/entrenamientos", json={"fecha": manana.isoformat()})

    assert respuesta.status_code == 422
    assert cliente.get("/entrenamientos").json() == []


def test_no_se_puede_mover_un_entrenamiento_al_futuro(cliente):
    sesion = empezar(cliente, AYER)

    respuesta = cliente.put(
        f"/entrenamientos/{sesion['id']}", json={"fecha": (HOY + timedelta(days=1)).isoformat()}
    )

    assert respuesta.status_code == 422
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


def test_hoy_es_la_fecha_de_madrid_aunque_en_utc_siga_siendo_ayer(madrugada_en_madrid):
    assert INSTANTE_UTC.date() == date(2025, 6, 30)
    assert fechas.hoy() == date(2025, 7, 1)


def test_a_las_00_30_en_espana_se_empieza_la_sesion_del_dia_nuevo(cliente, madrugada_en_madrid):
    """Ni "futura" (422) ni en el día anterior: es la sesión en curso de hoy."""
    respuesta = cliente.post("/entrenamientos", json={"fecha": "2025-07-01"})

    assert respuesta.status_code == 201
    assert respuesta.json()["en_curso"] is True
    assert cliente.post("/entrenamientos", json={"fecha": "2025-07-02"}).status_code == 422
