"""Tests del *Guardar* de un día del historial y de cambiar de ejercicio en la sesión.

«H2 · Un día» guarda la fecha, la nota y todas las series de una vez:
`PUT /entrenamientos/{id}` con `series`, que es el estado final completo (la guardada
que no llega se borra, la que llega sin `id` se crea). Todo se valida antes de
escribir, así que o se guarda todo o nada. Solo se valida lo que cambia: una serie que
llega igual vale aunque su ejercicio o su hueco ya no se pudieran elegir.

Cambiar de ejercicio en la sesión en curso borra de una vez las series de ese hueco:
`DELETE /entrenamientos/{id}/series?slot_id=N`.

El reloj está congelado en el miércoles 16 de septiembre de 2026 (`tests/semana.py`)
y la rutina no está en ningún programa, así que las sesiones no cuentan ningún día
(salvo las que lo piden al moverse muy lejos) y la fecha solo choca con el futuro o
con otra sesión.
"""

from datetime import date

import pytest

from app.models import Serie
from tests.ayudas import (
    SERIE_DEL_DIA_YA_NO_EXISTE,
    ejercicio_oculto,
    bajo_la_fecha,
    crear_ejercicio,
    crear_hueco,
    crear_rutina,
    dejar_planificado,
    en_texto,
    ocultar_ejercicio,
    ocultar_hueco,
    poner_alternativas,
    todavia_no_ha_llegado,
)
from tests.semana import DOMINGO_13, HOY, JUEVES_17, LUNES_14, MARTES_15, sesion

CAMPOS = (
    "ejercicio_id",
    "slot_id",
    "numero_serie",
    "peso",
    "repeticiones",
    "duracion_s",
    "distancia_m",
    "peso_corporal",
    "variante",
)

PESO_NEGATIVO = "El peso no puede ser negativo. Solo los ejercicios de peso corporal admiten ayuda."
NO_ES_DEL_HUECO = "Ese ejercicio no es ni el de la rutina ni una de sus alternativas."
NO_ESTA_EN_LA_RUTINA = "Ese ejercicio no está en la rutina de esta sesión."


# --- El escenario ----------------------------------------------------------------


@pytest.fixture
def push(cliente, grupo_muscular_id, hoy_es) -> dict:
    """La rutina Push: el hueco `a` (Press banca, con Press inclinado de alternativa)
    y el hueco `b` (Fondos). Con el reloj en el miércoles 16.
    """
    hoy_es(HOY)
    press, inclinado, fondos = (
        crear_ejercicio(cliente, grupo_muscular_id, nombre)
        for nombre in ("Press banca", "Press inclinado", "Fondos")
    )
    rutina = crear_rutina(cliente, "Push")
    a = crear_hueco(cliente, rutina, press)
    poner_alternativas(cliente, rutina, a, [inclinado])
    b = crear_hueco(cliente, rutina, fondos)
    return {
        "rutina": rutina,
        "press": press,
        "inclinado": inclinado,
        "fondos": fondos,
        "a": a,
        "b": b,
    }


def serie(ejercicio_id, slot_id, numero=1, peso=60, repeticiones=8, **campos) -> dict:
    """El cuerpo de una serie (sin `id`: nueva)."""
    return {
        "ejercicio_id": ejercicio_id,
        "slot_id": slot_id,
        "numero_serie": numero,
        "peso": peso,
        "repeticiones": repeticiones,
        **campos,
    }


def dia_con(cliente, push, fecha=MARTES_15, series=None, cubre_fecha=None) -> int:
    """Una sesión de Push en esa fecha con sus series (por defecto, dos de Press banca
    en `a` y una de Fondos en `b`), apuntadas una a una. Devuelve su id.
    """
    respuesta = sesion(cliente, fecha, push["rutina"], cubre_fecha)
    assert respuesta.status_code == 201, respuesta.text
    sesion_id = respuesta.json()["id"]
    if series is None:
        series = [
            serie(push["press"], push["a"], 1, 60),
            serie(push["press"], push["a"], 2, "62.5"),
            serie(push["fondos"], push["b"], 1, 10, 10),
        ]
    for cuerpo in series:
        creada = cliente.post(f"/entrenamientos/{sesion_id}/series", json=cuerpo)
        assert creada.status_code == 201, creada.text
    return sesion_id


def leer(cliente, sesion_id) -> dict:
    respuesta = cliente.get(f"/entrenamientos/{sesion_id}")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def como_van(cliente, sesion_id) -> list[dict]:
    """Las series guardadas tal y como las manda la web al guardar: con su `id`. Por
    hueco y número (la API las da solo por número): `a` va antes que `b`.
    """
    return sorted(
        (
            {"id": s["id"], **{campo: s[campo] for campo in CAMPOS}}
            for s in leer(cliente, sesion_id)["series"]
        ),
        key=lambda s: (s["slot_id"], s["numero_serie"]),
    )


def foto(cliente, sesion_id) -> tuple:
    """Todo lo que el *Guardar* puede cambiar, para comprobar que no cambió nada."""
    dia = leer(cliente, sesion_id)
    return (
        dia["fecha"],
        dia["notas"],
        sorted(
            (
                s["id"],
                s["ejercicio_id"],
                s["slot_id"],
                s["numero_serie"],
                s["peso"],
                s["updated_at"],
            )
            for s in dia["series"]
        ),
    )


def guardar(cliente, sesion_id, series, fecha=None, notas=None):
    """El PUT de «H2 · Un día»; sin `fecha`, la que ya tiene."""
    if fecha is None:
        fecha = leer(cliente, sesion_id)["fecha"]
    return cliente.put(
        f"/entrenamientos/{sesion_id}",
        json={"fecha": str(fecha), "notas": notas, "series": series},
    )


# --- Guardar todo de una vez -----------------------------------------------------


def test_guardar_cambia_la_fecha_la_nota_y_las_series_en_una_peticion(cliente, push):
    """Una borrada, una cambiada, una nueva y otra que llega igual, con la fecha y la
    nota nuevas.
    """
    dia = dia_con(cliente, push)
    primera, segunda, fondos = como_van(cliente, dia)
    segunda["repeticiones"] = 6

    respuesta = guardar(
        cliente,
        dia,
        [primera, segunda, serie(push["press"], push["a"], 3, 65, 5)],
        fecha=LUNES_14,
        notas="Hombro cargado",
    )

    assert respuesta.status_code == 200, respuesta.text
    guardado = leer(cliente, dia)
    assert (guardado["fecha"], guardado["notas"]) == (LUNES_14.isoformat(), "Hombro cargado")
    assert sorted(
        (s["slot_id"], s["numero_serie"], s["peso"], s["repeticiones"]) for s in guardado["series"]
    ) == [(push["a"], 1, "60.00", 8), (push["a"], 2, "62.50", 6), (push["a"], 3, "65.00", 5)]
    # La que llegó igual y la cambiada conservan su id; la de Fondos ya no está.
    ids = {s["id"] for s in guardado["series"]}
    assert {primera["id"], segunda["id"]} <= ids
    assert fondos["id"] not in ids
    # Lo devuelto es lo guardado: la web lo pinta sin volver a pedirlo.
    assert respuesta.json() == guardado


def test_una_serie_que_llega_igual_no_se_toca(cliente, push):
    """El peso llega como número (62.5) y está guardado como 62,50: es el mismo, y la
    serie no se reescribe (su `updated_at` no cambia).
    """
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    series = como_van(cliente, dia)
    for cuerpo in series:
        cuerpo["peso"] = float(cuerpo["peso"])

    respuesta = guardar(cliente, dia, series)

    assert respuesta.status_code == 200, respuesta.text
    assert foto(cliente, dia) == antes


def test_sin_series_no_se_tocan_y_con_la_lista_vacia_se_borran_todas(cliente, push):
    """Quitar todas las series no borra la sesión: la web, para guardar un día sin
    series, borra la sesión con su `DELETE`.
    """
    dia = dia_con(cliente, push)

    solo_la_nota = cliente.put(
        f"/entrenamientos/{dia}", json={"fecha": MARTES_15.isoformat(), "notas": "Bien"}
    )
    assert solo_la_nota.status_code == 200, solo_la_nota.text
    assert len(leer(cliente, dia)["series"]) == 3

    respuesta = guardar(cliente, dia, [], notas="Bien")

    assert respuesta.status_code == 200, respuesta.text
    assert (leer(cliente, dia)["series"], leer(cliente, dia)["notas"]) == ([], "Bien")


# --- Todo o nada -------------------------------------------------------------------


@pytest.mark.parametrize("cual", ["nueva", "cambiada"])
def test_una_serie_con_medidas_malas_da_422_y_no_guarda_nada(cliente, push, cual):
    """La serie mala va la última: la fecha, la nota, la borrada y la cambiada que van
    antes tampoco se guardan. Una guardada que se corrige se valida igual que una nueva.
    """
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    primera, segunda, _ = como_van(cliente, dia)
    primera["peso"] = 70
    if cual == "nueva":
        mala = serie(push["press"], push["a"], 3, peso=-5)
    else:
        mala = {**segunda, "peso": -5}

    respuesta = guardar(cliente, dia, [primera, mala], fecha=LUNES_14, notas="Hombro cargado")

    assert (respuesta.status_code, respuesta.json()["detail"]) == (422, PESO_NEGATIVO)
    assert foto(cliente, dia) == antes


def test_con_el_dia_nuevo_ocupado_da_409_y_no_guarda_nada(cliente, push):
    """El 409 del día ocupado es lo último que se mira, después de todas las series."""
    ocupado = dia_con(cliente, push, LUNES_14)
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    primera, _, fondos = como_van(cliente, dia)

    respuesta = guardar(
        cliente,
        dia,
        [primera, fondos, serie(push["press"], push["a"], 2, 70)],
        fecha=LUNES_14,
        notas="Hombro cargado",
    )

    assert respuesta.status_code == 409
    assert respuesta.json()["detail"] == {
        "mensaje": f"El {en_texto(LUNES_14)} ya tiene una sesión, y solo se hace una por día."
        " Para usar ese día, cambia antes la fecha de esa sesión desde su día en la pestaña"
        " Historial.",
        "campo": "fecha",
        "entrenamiento_id": ocupado,
        "en_curso": False,
    }
    assert foto(cliente, dia) == antes


def test_un_422_de_una_serie_no_borra_la_cancelada_del_dia_nuevo(cliente, push):
    """Mirar si el día nuevo está libre borra la sesión cancelada (sin series) que lo
    ocupa: un 422 posterior no puede dejarla borrada.
    """
    cancelada = dia_con(cliente, push, LUNES_14, series=[])
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)

    respuesta = guardar(
        cliente,
        dia,
        [*como_van(cliente, dia), serie(push["press"], push["a"], 3, peso=-5)],
        fecha=LUNES_14,
    )

    assert (respuesta.status_code, respuesta.json()["detail"]) == (422, PESO_NEGATIVO)
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 200
    assert foto(cliente, dia) == antes


def test_con_el_dia_ocupado_y_una_serie_mala_gana_el_422_de_la_serie(cliente, push):
    """El día libre es lo último que se mira: el aviso que sale es el de la serie."""
    dia_con(cliente, push, LUNES_14)
    dia = dia_con(cliente, push)

    respuesta = guardar(
        cliente,
        dia,
        [*como_van(cliente, dia), serie(push["press"], push["a"], 3, peso=-5)],
        fecha=LUNES_14,
    )

    assert (respuesta.status_code, respuesta.json()["detail"]) == (422, PESO_NEGATIVO)


def test_mover_al_dia_de_una_cancelada_con_series_nuevas_la_borra(cliente, push):
    """El camino bueno del anterior: la cancelada deja sitio y todo se guarda."""
    cancelada = dia_con(cliente, push, LUNES_14, series=[])
    dia = dia_con(cliente, push)

    respuesta = guardar(
        cliente,
        dia,
        [*como_van(cliente, dia), serie(push["press"], push["a"], 3, 65)],
        fecha=LUNES_14,
    )

    assert respuesta.status_code == 200, respuesta.text
    assert cliente.get(f"/entrenamientos/{cancelada}").status_code == 404
    assert (leer(cliente, dia)["fecha"], len(leer(cliente, dia)["series"])) == (
        LUNES_14.isoformat(),
        4,
    )


def test_la_fecha_se_valida_antes_que_las_series(cliente, push):
    """Una fecha futura y una serie de otra sesión: el aviso es el de la fecha, y la
    sesión no se mueve al futuro.
    """
    otra = dia_con(cliente, push, LUNES_14)
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    ajena = {**como_van(cliente, otra)[0]}

    respuesta = guardar(cliente, dia, [ajena], fecha=JUEVES_17)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == bajo_la_fecha(todavia_no_ha_llegado(JUEVES_17))
    assert foto(cliente, dia) == antes


# --- Mover la fecha muy lejos ------------------------------------------------------
#
# El plan se pide como mucho de 400 días. Una fecha fuera del plazo ya no lo necesita:
# antes se pedía igual, y mover una sesión tan lejos daba el 422 del tope del plan, que
# hablaba de otra cosa, en vez de decir hasta dónde puede ir.

HACE_MAS_DE_400_DIAS = date(2025, 3, 3)  # lunes


def test_una_sesion_que_cuenta_un_dia_no_se_mueve_a_mas_de_400_dias_atras(cliente, push):
    """Cuenta el miércoles 16 porque ese día se planificó Push a mano."""
    dejar_planificado(cliente, HOY, push["rutina"])
    dia = dia_con(cliente, push, HOY, cubre_fecha=HOY)
    antes = foto(cliente, dia)

    respuesta = guardar(cliente, dia, como_van(cliente, dia), fecha=HACE_MAS_DE_400_DIAS)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == {
        "mensaje": "Este Push cuenta como el del miércoles 16 de septiembre, así que solo puede"
        " ir desde el lunes 14 de septiembre.",
        "campo": "fecha",
    }
    assert foto(cliente, dia) == antes


def test_una_sesion_antigua_que_cuenta_un_dia_no_se_mueve_a_hoy(cliente, push, hoy_es):
    """Más de 400 días hacia delante, y el texto lleva el año del día que cuenta."""
    hoy_es(HACE_MAS_DE_400_DIAS)
    dejar_planificado(cliente, HACE_MAS_DE_400_DIAS, push["rutina"])
    dia = dia_con(cliente, push, HACE_MAS_DE_400_DIAS, cubre_fecha=HACE_MAS_DE_400_DIAS)
    hoy_es(HOY)
    antes = foto(cliente, dia)

    respuesta = guardar(cliente, dia, como_van(cliente, dia), fecha=HOY)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == {
        "mensaje": "Este Push cuenta como el del lunes 3 de marzo de 2025, así que solo puede"
        " ir hasta el domingo 9 de marzo de 2025.",
        "campo": "fecha",
    }
    assert foto(cliente, dia) == antes


def test_una_sesion_que_no_cuenta_ningun_dia_se_mueve_a_cualquier_fecha(cliente, push):
    """Sin día que contar no hay plazo: la fecha solo choca con el futuro o con otra."""
    dia = dia_con(cliente, push, HOY)

    respuesta = guardar(cliente, dia, como_van(cliente, dia), fecha=HACE_MAS_DE_400_DIAS)

    assert respuesta.status_code == 200, respuesta.text
    assert leer(cliente, dia)["fecha"] == HACE_MAS_DE_400_DIAS.isoformat()


# --- Ids de series que no son de este día ----------------------------------------


def test_una_serie_de_otra_sesion_da_404_y_no_toca_ninguna_de_las_dos(cliente, push):
    """Con su id, la serie de otro día se cambiaría (o se movería a este) por la ruta
    de una sesión que no es la suya.
    """
    otra = dia_con(cliente, push, LUNES_14)
    dia = dia_con(cliente, push)
    antes = (foto(cliente, dia), foto(cliente, otra))
    ajena = como_van(cliente, otra)[0]
    ajena["peso"] = 100

    respuesta = guardar(cliente, dia, [*como_van(cliente, dia), ajena])

    assert (respuesta.status_code, respuesta.json()["detail"]) == (404, SERIE_DEL_DIA_YA_NO_EXISTE)
    assert (foto(cliente, dia), foto(cliente, otra)) == antes


def test_una_serie_repetida_da_422(cliente, push):
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    primera, segunda, _ = como_van(cliente, dia)

    respuesta = guardar(cliente, dia, [primera, segunda, {**primera, "peso": 90}])

    assert respuesta.status_code == 422
    assert [e["msg"] for e in respuesta.json()["detail"]] == ["Value error, Hay series repetidas."]
    assert foto(cliente, dia) == antes


def test_varias_series_nuevas_sin_id_no_son_repetidas(cliente, push):
    dia = dia_con(cliente, push, series=[])

    respuesta = guardar(
        cliente,
        dia,
        [serie(push["press"], push["a"], n, 60) for n in (1, 2)]
        + [{**serie(push["fondos"], push["b"]), "id": None}],
    )

    assert respuesta.status_code == 200, respuesta.text
    assert len(leer(cliente, dia)["series"]) == 3


# --- Un ejercicio por hueco --------------------------------------------------------

MEZCLA = (
    "En un mismo ejercicio de la rutina hay series de «{}» y de «{}», y en cada uno se hace"
    " un solo ejercicio por sesión. Deja solo las de uno."
)


def test_cambiar_de_ejercicio_un_hueco_en_una_sola_peticion_vale(cliente, push):
    """Quitar las de Press banca y poner las de Press inclinado a la vez: con series
    sueltas, la primera nueva chocaría con las viejas (409).
    """
    dia = dia_con(cliente, push)
    *_, fondos = como_van(cliente, dia)

    respuesta = guardar(
        cliente,
        dia,
        [fondos, *(serie(push["inclinado"], push["a"], n, 50) for n in (1, 2))],
    )

    assert respuesta.status_code == 200, respuesta.text
    assert sorted((s["slot_id"], s["ejercicio_id"]) for s in leer(cliente, dia)["series"]) == [
        (push["a"], push["inclinado"]),
        (push["a"], push["inclinado"]),
        (push["b"], push["fondos"]),
    ]


def test_cambiar_el_ejercicio_de_todas_las_series_de_un_hueco_vale(cliente, push):
    dia = dia_con(cliente, push)
    primera, segunda, fondos = como_van(cliente, dia)

    respuesta = guardar(
        cliente,
        dia,
        [
            {**primera, "ejercicio_id": push["inclinado"]},
            {**segunda, "ejercicio_id": push["inclinado"]},
            fondos,
        ],
    )

    assert respuesta.status_code == 200, respuesta.text
    assert [(s["id"], s["ejercicio_id"]) for s in como_van(cliente, dia)] == [
        (primera["id"], push["inclinado"]),
        (segunda["id"], push["inclinado"]),
        (fondos["id"], push["fondos"]),
    ]


@pytest.mark.parametrize("como", ["serie nueva", "serie cambiada"])
def test_mezclar_dos_ejercicios_en_un_hueco_da_422_y_no_guarda_nada(cliente, push, como):
    """422 y no el 409 de apuntar una serie suelta: el choque está dentro de lo que se
    manda, no con lo guardado.
    """
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    primera, segunda, fondos = como_van(cliente, dia)
    if como == "serie nueva":
        series = [primera, segunda, fondos, serie(push["inclinado"], push["a"], 3, 50)]
    else:
        series = [primera, {**segunda, "ejercicio_id": push["inclinado"]}, fondos]

    respuesta = guardar(cliente, dia, series)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == MEZCLA.format("Press banca", "Press inclinado")
    assert foto(cliente, dia) == antes


def test_una_sesion_ya_mezclada_se_corrige_si_no_se_toca_el_hueco(cliente, push, sesion_bd):
    """Una sesión de antes del blindaje (o importada) con dos ejercicios en un hueco:
    corregir un peso no la bloquea; añadir una serie a ese hueco, sí.
    """
    dia = dia_con(cliente, push)
    sesion_bd.add(
        Serie(
            entrenamiento_id=dia,
            ejercicio_id=push["inclinado"],
            slot_id=push["a"],
            numero_serie=3,
            peso=50,
            repeticiones=8,
        )
    )
    sesion_bd.commit()
    series = como_van(cliente, dia)
    series[0]["peso"] = 61

    corregida = guardar(cliente, dia, series)
    con_otra = guardar(cliente, dia, [*series, serie(push["press"], push["a"], 4, 60)])

    assert corregida.status_code == 200, corregida.text
    assert con_otra.status_code == 422
    assert con_otra.json()["detail"] == MEZCLA.format("Press banca", "Press inclinado")


def test_mover_una_serie_a_un_hueco_con_otro_ejercicio_da_422_y_no_guarda_nada(cliente, push):
    """Press banca es también alternativa de `b`, así que la serie puede ir allí; pero
    `b` ya tiene la de Fondos. El hueco al que llega cuenta como tocado, no solo el
    que deja.
    """
    poner_alternativas(cliente, push["rutina"], push["b"], [push["press"]])
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    primera, segunda, fondos = como_van(cliente, dia)

    respuesta = guardar(cliente, dia, [primera, {**segunda, "slot_id": push["b"]}, fondos])

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        422,
        MEZCLA.format("Fondos", "Press banca"),
    )
    assert foto(cliente, dia) == antes


# --- Corregir sí, elegir algo oculto no --------------------------------------------


@pytest.mark.parametrize("que", ["ejercicio oculto", "hueco oculto", "ya no es alternativa"])
def test_una_serie_guardada_se_sigue_guardando_aunque_ya_no_se_pudiera_elegir(cliente, push, que):
    """Las series de Press inclinado en `a`, y después el ejercicio se oculta, el hueco
    se oculta o deja de ser alternativa. Guardar el día con ellas (una con otro peso y
    otra igual) vale: no se elige nada nuevo.
    """
    dia = dia_con(
        cliente,
        push,
        series=[serie(push["inclinado"], push["a"], n, 50) for n in (1, 2)]
        + [serie(push["fondos"], push["b"], 1, 10, 10)],
    )
    if que == "ejercicio oculto":
        ocultar_ejercicio(cliente, push["inclinado"])
    elif que == "hueco oculto":
        ocultar_hueco(cliente, push["rutina"], push["a"])
    else:
        poner_alternativas(cliente, push["rutina"], push["a"], [])
    series = como_van(cliente, dia)
    series[0]["peso"] = 55

    respuesta = guardar(cliente, dia, series, notas="Corregido")

    assert respuesta.status_code == 200, respuesta.text
    assert [s["peso"] for s in como_van(cliente, dia)[:2]] == ["55.00", "50.00"]


@pytest.mark.parametrize(
    "que, esperado",
    [
        ("ejercicio oculto", (404, ejercicio_oculto("Press inclinado"))),
        ("hueco oculto", (404, NO_ESTA_EN_LA_RUTINA)),
        ("hueco de otra rutina", (404, NO_ESTA_EN_LA_RUTINA)),
        ("ejercicio que no es del hueco", (422, NO_ES_DEL_HUECO)),
    ],
)
def test_una_serie_nueva_valida_como_al_apuntarla_suelta(cliente, push, que, esperado):
    """Usa las mismas comprobaciones: un ejercicio o un hueco que no existen, en
    `test_elegir_algo_que_no_existe_da_404_y_no_guarda_nada`.
    """
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    nueva = serie(push["inclinado"], push["a"], 3, 50)
    if que == "ejercicio oculto":
        ocultar_ejercicio(cliente, push["inclinado"])
    elif que == "hueco oculto":
        ocultar_hueco(cliente, push["rutina"], push["b"])
        nueva = serie(push["fondos"], push["b"], 2, 10, 10)
    elif que == "hueco de otra rutina":
        otra = crear_rutina(cliente, "Pull")
        nueva = serie(push["fondos"], crear_hueco(cliente, otra, push["fondos"]), 2, 10, 10)
    else:
        nueva = serie(push["fondos"], push["a"], 3, 10, 10)
    # Sin las series que ya había en ese hueco: el fallo no puede ser el de mezclar.
    series = [s for s in como_van(cliente, dia) if s["slot_id"] != nueva["slot_id"]]

    respuesta = guardar(cliente, dia, [*series, nueva])

    assert (respuesta.status_code, respuesta.json()["detail"]) == esperado
    assert foto(cliente, dia) == antes


def test_el_dia_de_una_rutina_oculta_se_sigue_guardando_con_series_nuevas(cliente, push):
    """Corregir sí: la sesión ya era de esa rutina, y sus huecos siguen a la vista. Es
    lo que hace la edición de un día pasado de una rutina que después se ocultó.
    """
    dia = dia_con(cliente, push)
    respuesta = cliente.delete(f"/rutinas/{push['rutina']}", params={"modo": "ocultar"})
    assert respuesta.status_code == 204, respuesta.text

    respuesta = guardar(
        cliente, dia, [*como_van(cliente, dia), serie(push["press"], push["a"], 3, 65)]
    )

    assert respuesta.status_code == 200, respuesta.text
    assert len(leer(cliente, dia)["series"]) == 4


def test_una_serie_cambiada_a_otro_ejercicio_oculto_da_404(cliente, push):
    """Cambiar el ejercicio de una serie sí es elegir: el nuevo tiene que estar a la vista."""
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    ocultar_ejercicio(cliente, push["inclinado"])
    primera, segunda, fondos = como_van(cliente, dia)

    respuesta = guardar(
        cliente,
        dia,
        [
            {**primera, "ejercicio_id": push["inclinado"]},
            {**segunda, "ejercicio_id": push["inclinado"]},
            fondos,
        ],
    )

    assert (respuesta.status_code, respuesta.json()["detail"]) == (
        404,
        ejercicio_oculto("Press inclinado"),
    )
    assert foto(cliente, dia) == antes


# --- Cambiar de ejercicio en la sesión: DELETE de las series de un hueco ----------


def borrar_del_hueco(cliente, sesion_id, slot_id):
    return cliente.delete(f"/entrenamientos/{sesion_id}/series", params={"slot_id": slot_id})


def test_borrar_las_series_de_un_hueco_deja_las_de_los_demas(cliente, push):
    dia = dia_con(cliente, push)
    *_, fondos = como_van(cliente, dia)

    respuesta = borrar_del_hueco(cliente, dia, push["a"])

    assert respuesta.status_code == 204, respuesta.text
    assert [s["id"] for s in como_van(cliente, dia)] == [fondos["id"]]


def test_borrar_las_de_un_hueco_no_toca_las_de_otra_sesion_en_ese_hueco(cliente, push):
    otra = dia_con(cliente, push, LUNES_14)
    dia = dia_con(cliente, push)
    antes = foto(cliente, otra)

    assert borrar_del_hueco(cliente, dia, push["a"]).status_code == 204

    assert foto(cliente, otra) == antes


def test_borrar_las_de_un_hueco_de_otra_rutina_da_404_y_no_borra_nada(cliente, push):
    """El hueco existe, pero no es de la rutina de esta sesión: por la ruta de otro
    padre, 404. Tiene una serie en otra sesión, que tampoco se toca. Un hueco que no
    existe, en `test_crud.py`.
    """
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)
    otra = crear_rutina(cliente, "Pull")
    hueco = crear_hueco(cliente, otra, push["press"])
    otra_sesion = dia_con(
        cliente, {**push, "rutina": otra}, DOMINGO_13, [serie(push["press"], hueco)]
    )
    antes_otra = foto(cliente, otra_sesion)

    respuesta = borrar_del_hueco(cliente, dia, hueco)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (404, NO_ESTA_EN_LA_RUTINA)
    assert (foto(cliente, dia), foto(cliente, otra_sesion)) == (antes, antes_otra)


def test_borrar_las_de_un_hueco_sin_decir_cual_da_422_y_no_borra_nada(cliente, push):
    """Sin `slot_id` borraría todas las series del día."""
    dia = dia_con(cliente, push)
    antes = foto(cliente, dia)

    respuesta = cliente.delete(f"/entrenamientos/{dia}/series")

    assert respuesta.status_code == 422
    assert [e["loc"] for e in respuesta.json()["detail"]] == [["query", "slot_id"]]
    assert foto(cliente, dia) == antes


def test_borrar_las_de_un_hueco_oculto_vale(cliente, push):
    """Quitar lo apuntado no es elegir nada."""
    dia = dia_con(cliente, push)
    ocultar_hueco(cliente, push["rutina"], push["b"])

    assert borrar_del_hueco(cliente, dia, push["b"]).status_code == 204
    assert {s["slot_id"] for s in leer(cliente, dia)["series"]} == {push["a"]}


def test_borrar_las_de_un_hueco_sin_series_da_204(cliente, push):
    dia = dia_con(cliente, push, series=[serie(push["press"], push["a"])])
    antes = foto(cliente, dia)

    assert borrar_del_hueco(cliente, dia, push["b"]).status_code == 204
    assert foto(cliente, dia) == antes


@pytest.mark.parametrize("cuando", ["hoy, en curso", "un día pasado"])
def test_borrar_las_unicas_series_deja_la_sesion_vacia_sin_borrarla(cliente, push, cuando):
    """Cambiar de ejercicio en la sesión borra las del hueco y enseguida se apuntan las
    del otro: si la sesión se borrara al quedarse vacía, la siguiente serie no tendría
    dónde ir.
    """
    fecha = HOY if cuando == "hoy, en curso" else MARTES_15
    dia = dia_con(cliente, push, fecha, series=[serie(push["press"], push["a"])])

    assert borrar_del_hueco(cliente, dia, push["a"]).status_code == 204

    guardado = leer(cliente, dia)
    assert (guardado["fecha"], guardado["series"]) == (fecha.isoformat(), [])
    assert guardado["en_curso"] is (cuando == "hoy, en curso")
