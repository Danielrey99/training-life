"""Tests del objetivo de cada ejercicio de un hueco: el principal y cada alternativa
llevan el suyo, en la unidad de su tipo.

El objetivo son unas series y un par mínimo-máximo: de repeticiones (`reps_min` y
`reps_max`) para los ejercicios de peso y repeticiones o de peso corporal, o de
duración en segundos (`duracion_min_s` y `duracion_max_s`) para los de tiempo y los
de cardio.
Exactamente un par, y completo (el esquema da 422, y la base tiene un CHECK por si
acaso). Qué par toca lo decide el tipo del ejercicio: lo comprueba el endpoint, con
un 422 que nombra el ejercicio, después de los 404 y antes de los 409.

El objetivo de una alternativa vive en su fila de `slot_alternativas`: el PUT de un
hueco la actualiza en su sitio (si la borrara y la volviera a crear, el
`UNIQUE(slot_id, ejercicio_id)` daría un 500) y sin lista no la toca.

Importar y exportar, en `test_datos.py`.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.fechas import hoy
from app.models import RutinaSlot, SlotAlternativa
from tests.ayudas import (
    CAMPOS_DEL_OBJETIVO,
    alternativa,
    crear_ejercicio,
    crear_rutina,
    entrenar,
    objetivo,
    objetivo_de,
)

UNO_DE_LOS_DOS = (
    "El objetivo lleva repeticiones (reps_min y reps_max) o duración "
    "(duracion_min_s y duracion_max_s): uno de los dos, completo"
)
EN_SEGUNDOS = (
    "El objetivo de Plancha va en segundos (duracion_min_s y duracion_max_s), no en "
    "repeticiones: Plancha se apunta por tiempo."
)
EN_REPETICIONES = (
    "El objetivo de Dominadas va en repeticiones (reps_min y reps_max), no en duración: "
    "Dominadas se apunta con repeticiones y carga."
)
EN_SEGUNDOS_CARDIO = (
    "El objetivo de Cinta va en segundos (duracion_min_s y duracion_max_s), no en "
    "repeticiones: Cinta se apunta por tiempo y, si se quiere, distancia."
)
EN_REPETICIONES_PRESS = (
    "El objetivo de Press banca va en repeticiones (reps_min y reps_max), no en duración: "
    "Press banca se apunta con peso y repeticiones."
)
EN_SEGUNDOS_OBJ = objetivo(3, duracion=(30, 60))
EN_REPS_OBJ = objetivo(3, (6, 10))


# --- Ayudantes -----------------------------------------------------------


@pytest.fixture
def e(cliente, grupo_muscular_id) -> SimpleNamespace:
    """Un ejercicio de cada tipo (y otro de peso y repeticiones) y una rutina vacía."""
    return SimpleNamespace(
        press=crear_ejercicio(cliente, grupo_muscular_id, "Press banca"),
        remo=crear_ejercicio(cliente, grupo_muscular_id, "Remo"),
        dominadas=crear_ejercicio(cliente, grupo_muscular_id, "Dominadas", tipo="corporal"),
        plancha=crear_ejercicio(cliente, grupo_muscular_id, "Plancha", tipo="tiempo"),
        cinta=crear_ejercicio(cliente, grupo_muscular_id, "Cinta", tipo="cardio"),
        rutina=crear_rutina(cliente, "Mixta"),
    )


def cuerpo(principal, obj=EN_REPS_OBJ, alternativas=None, **campos) -> dict:
    resultado = {"ejercicio_principal_id": principal, **obj, **campos}
    if alternativas is not None:
        resultado["alternativas"] = alternativas
    return resultado


def anadir(cliente, rutina, **kwargs):
    return cliente.post(f"/rutinas/{rutina}/slots", json=cuerpo(**kwargs))


def anadido(cliente, rutina, **kwargs) -> dict:
    respuesta = anadir(cliente, rutina, **kwargs)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def editar(cliente, rutina, slot, orden=1, **kwargs):
    return cliente.put(f"/rutinas/{rutina}/slots/{slot}", json=cuerpo(orden=orden, **kwargs))


def hueco_guardado(cliente, rutina, slot) -> dict:
    return next(h for h in cliente.get(f"/rutinas/{rutina}").json()["slots"] if h["id"] == slot)


def alternativas_de(hueco) -> list[tuple]:
    """(ejercicio, objetivo) de cada alternativa de un hueco de la API, en su orden."""
    return [(a["ejercicio"]["id"], objetivo_de(a)) for a in hueco["alternativas"]]


def filas(sesion_bd, slot_id) -> dict[int, tuple]:
    """`ejercicio_id → (id de la fila, objetivo)` de las alternativas del hueco, leídas
    de la base: para ver si una fila se conservó o se volvió a crear.
    """
    sesion_bd.expire_all()
    return {
        fila.ejercicio_id: (fila.id, tuple(getattr(fila, c) for c in CAMPOS_DEL_OBJETIVO))
        for fila in sesion_bd.scalars(
            select(SlotAlternativa).where(SlotAlternativa.slot_id == slot_id)
        )
    }


def cuantos(sesion_bd) -> tuple[int, int]:
    """Cuántos huecos y cuántas alternativas hay en toda la base."""
    sesion_bd.expire_all()
    return tuple(
        sesion_bd.scalar(select(func.count()).select_from(modelo))
        for modelo in (RutinaSlot, SlotAlternativa)
    )


# --- El esquema: un par, y completo -------------------------------------------

SIN_PAR = {"series_objetivo": 3}
MAL_FORMADOS = [
    pytest.param(SIN_PAR, UNO_DE_LOS_DOS, id="sin-par"),
    pytest.param(
        {**SIN_PAR, "reps_min": 6, "reps_max": 10, "duracion_min_s": 30, "duracion_max_s": 60},
        UNO_DE_LOS_DOS,
        id="los-dos-pares",
    ),
    pytest.param({**SIN_PAR, "reps_min": 6}, UNO_DE_LOS_DOS, id="reps-sin-maximo"),
    pytest.param({**SIN_PAR, "duracion_max_s": 60}, UNO_DE_LOS_DOS, id="duracion-sin-minimo"),
    pytest.param(
        {**SIN_PAR, "reps_min": 10, "reps_max": 6},
        "reps_max no puede ser menor que reps_min",
        id="reps-al-reves",
    ),
    pytest.param(
        {**SIN_PAR, "duracion_min_s": 60, "duracion_max_s": 30},
        "duracion_max_s no puede ser menor que duracion_min_s",
        id="duracion-al-reves",
    ),
    pytest.param(
        {**SIN_PAR, "duracion_min_s": 0, "duracion_max_s": 30},
        "greater than 0",
        id="duracion-0",
    ),
    pytest.param(
        {**SIN_PAR, "duracion_min_s": 30, "duracion_max_s": 86_401},
        "less than or equal to 86400",
        id="duracion-de-mas-de-un-dia",
    ),
]
# Las series objetivo a 0, en `test_crud.py` (`test_un_hueco_con_un_cero_da_422`).


@pytest.mark.parametrize(
    "obj, lo_que_dice, donde",
    [
        *(
            pytest.param(*caso.values, "principal", id=f"{caso.id}-principal")
            for caso in MAL_FORMADOS
        ),
        # La alternativa usa el mismo esquema del objetivo: con un caso se ve que lo usa.
        pytest.param(SIN_PAR, UNO_DE_LOS_DOS, "alternativa", id="sin-par-alternativa"),
    ],
)
def test_un_objetivo_mal_formado_da_422_del_esquema_y_no_crea_nada(
    cliente, sesion_bd, e, obj, lo_que_dice, donde
):
    """El 422 es el del esquema (una lista de errores de Pydantic) y por lo que se
    prueba: así no se confunde con el de la familia, que daría la Plancha con reps.
    """
    if donde == "principal":
        respuesta = anadir(cliente, e.rutina, principal=e.plancha, obj=obj)
    else:
        respuesta = anadir(
            cliente,
            e.rutina,
            principal=e.press,
            alternativas=[{"ejercicio_id": e.plancha, **obj}],
        )

    assert respuesta.status_code == 422
    assert isinstance(respuesta.json()["detail"], list)
    assert lo_que_dice in str(respuesta.json()["detail"])
    assert cuantos(sesion_bd) == (0, 0)


@pytest.mark.parametrize("duracion", [(1, 1), (1, 86_400), (86_400, 86_400)])
def test_la_duracion_del_objetivo_va_de_un_segundo_a_un_dia(cliente, e, duracion):
    hueco = anadido(
        cliente,
        e.rutina,
        principal=e.plancha,
        obj=objetivo(1, duracion=duracion),
        alternativas=[alternativa(e.press)],
    )

    assert objetivo_de(hueco) == objetivo(1, duracion=duracion)


# --- La familia del ejercicio decide el par -------------------------------------


def _por_post_de_rutina(cliente, e, principal, obj, alternativas):
    return cliente.post(
        "/rutinas",
        json={
            "nombre": "Otra",
            # El primer hueco está bien: el fallo del segundo no puede dejarlo creado.
            "slots": [cuerpo(e.press), cuerpo(principal, obj, alternativas)],
        },
    )


def _por_post_de_hueco(cliente, e, principal, obj, alternativas):
    return anadir(cliente, e.rutina, principal=principal, obj=obj, alternativas=alternativas)


def _por_put_de_hueco(cliente, e, principal, obj, alternativas):
    return editar(
        cliente, e.rutina, e.existente, principal=principal, obj=obj, alternativas=alternativas
    )


VIAS = [
    pytest.param(_por_post_de_rutina, id="POST-rutinas"),
    pytest.param(_por_post_de_hueco, id="POST-slots"),
    pytest.param(_por_put_de_hueco, id="PUT-slots"),
]


def _equivocados(e) -> dict:
    """(principal, objetivo, alternativas, mensaje) de cada forma de equivocarse."""
    return {
        "principal-de-tiempo-en-reps": (e.plancha, EN_REPS_OBJ, [], EN_SEGUNDOS),
        "principal-corporal-en-segundos": (e.dominadas, EN_SEGUNDOS_OBJ, [], EN_REPETICIONES),
        "alternativa-de-tiempo-en-reps": (
            e.press,
            EN_REPS_OBJ,
            [alternativa(e.remo), alternativa(e.plancha)],
            EN_SEGUNDOS,
        ),
        "alternativa-corporal-en-segundos": (
            e.plancha,
            EN_SEGUNDOS_OBJ,
            [alternativa(e.dominadas, duracion=(30, 60))],
            EN_REPETICIONES,
        ),
        "principal-de-cardio-en-reps": (e.cinta, EN_REPS_OBJ, [], EN_SEGUNDOS_CARDIO),
        "alternativa-de-cardio-en-reps": (
            e.press,
            EN_REPS_OBJ,
            [alternativa(e.cinta)],
            EN_SEGUNDOS_CARDIO,
        ),
        # Peso y repeticiones tiene su propia entrada en `FAMILIA`: no basta con que
        # el corporal esté bien.
        "principal-de-peso-y-reps-en-segundos": (
            e.press,
            EN_SEGUNDOS_OBJ,
            [],
            EN_REPETICIONES_PRESS,
        ),
        "alternativa-de-peso-y-reps-en-segundos": (
            e.cinta,
            objetivo(1, duracion=(600, 900)),
            [alternativa(e.press, duracion=(30, 60))],
            EN_REPETICIONES_PRESS,
        ),
    }


TODOS_LOS_CASOS = [
    "principal-de-tiempo-en-reps",
    "principal-corporal-en-segundos",
    "alternativa-de-tiempo-en-reps",
    "alternativa-corporal-en-segundos",
    "principal-de-cardio-en-reps",
    "alternativa-de-cardio-en-reps",
    "principal-de-peso-y-reps-en-segundos",
    "alternativa-de-peso-y-reps-en-segundos",
]
# Las tres vías llaman a la misma comprobación: cada familia, por una; en las otras
# dos, un principal y una alternativa, para ver que la usan y no dejan nada a medias.
CASOS_POR_VIA = [
    *(pytest.param(_por_post_de_hueco, caso, id=f"POST-slots-{caso}") for caso in TODOS_LOS_CASOS),
    pytest.param(
        _por_post_de_rutina, "principal-corporal-en-segundos", id="POST-rutinas-principal"
    ),
    pytest.param(
        _por_post_de_rutina, "alternativa-de-cardio-en-reps", id="POST-rutinas-alternativa"
    ),
    pytest.param(_por_put_de_hueco, "principal-de-cardio-en-reps", id="PUT-slots-principal"),
    pytest.param(_por_put_de_hueco, "alternativa-corporal-en-segundos", id="PUT-slots-alternativa"),
]


@pytest.mark.parametrize("via, caso", CASOS_POR_VIA)
def test_un_objetivo_de_otra_familia_da_422_que_nombra_el_ejercicio_y_no_cambia_nada(
    cliente, sesion_bd, e, via, caso
):
    # El hueco que edita el PUT: Remo con Press de alternativa, en repeticiones.
    e.existente = anadido(
        cliente, e.rutina, principal=e.remo, alternativas=[alternativa(e.press)], orden=1
    )["id"]
    antes = cliente.get("/rutinas", params={"ocultas": True}).json()
    principal, obj, alternativas, mensaje = _equivocados(e)[caso]

    respuesta = via(cliente, e, principal, obj, alternativas)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == mensaje
    assert cliente.get("/rutinas", params={"ocultas": True}).json() == antes


@pytest.mark.parametrize(
    "via, rol",
    [
        *(pytest.param(via.values[0], "principal", id=f"{via.id}-principal") for via in VIAS),
        # La alternativa pasa por la misma comprobación en las tres vías: con una basta.
        pytest.param(_por_post_de_hueco, "alternativa", id="POST-slots-alternativa"),
    ],
)
def test_un_objetivo_en_segundos_vale_para_un_ejercicio_de_cardio_y_se_guarda(
    cliente, sesion_bd, e, via, rol
):
    """Cardio es de la familia de la duración, como tiempo: su objetivo va en segundos,
    de principal (con una alternativa de peso y repeticiones) y de alternativa (de un
    hueco de peso y repeticiones).
    """
    e.existente = anadido(cliente, e.rutina, principal=e.remo, orden=1)["id"]
    if rol == "principal":
        principal, obj = e.cinta, objetivo(1, duracion=(900, 1800))
        alternativas = [alternativa(e.press)]
        esperadas = [(e.press, objetivo(3, (6, 10)))]
    else:
        principal, obj = e.press, objetivo(3, (6, 10))
        alternativas = [alternativa(e.cinta, 1, duracion=(600, 1200))]
        esperadas = [(e.cinta, objetivo(1, duracion=(600, 1200)))]

    respuesta = via(cliente, e, principal, obj, alternativas)

    assert respuesta.status_code == (200 if via is _por_put_de_hueco else 201), respuesta.text
    # POST /rutinas crea otra rutina: se busca el hueco nuevo en todas.
    [hueco] = [
        h
        for r in cliente.get("/rutinas").json()
        for h in r["slots"]
        if h["ejercicio_principal"]["id"] == principal
    ]
    assert objetivo_de(hueco) == obj
    assert alternativas_de(hueco) == esperadas
    tipos = [hueco["ejercicio_principal"]["tipo_registro"]]
    tipos += [a["ejercicio"]["tipo_registro"] for a in hueco["alternativas"]]
    assert "cardio" in tipos


def test_una_alternativa_de_otra_familia_con_su_propio_objetivo_se_crea(cliente, e):
    """Un hueco de tiempo con alternativas de repeticiones, y uno de repeticiones con
    una de tiempo: cada una con el suyo, que no es el del principal.
    """
    plancha = anadido(
        cliente,
        e.rutina,
        principal=e.plancha,
        obj=objetivo(3, duracion=(30, 45)),
        alternativas=[
            alternativa(e.dominadas, 2, (5, 8)),
            alternativa(e.press, 4, (10, 12)),
        ],
    )
    press = anadido(
        cliente,
        e.rutina,
        principal=e.press,
        obj=objetivo(5, (3, 5)),
        alternativas=[alternativa(e.plancha, 2, duracion=(60, 90))],
    )

    for creado in (plancha, press):
        assert hueco_guardado(cliente, e.rutina, creado["id"]) == creado
    assert objetivo_de(plancha) == objetivo(3, duracion=(30, 45))
    assert alternativas_de(plancha) == [
        (e.dominadas, objetivo(2, (5, 8))),
        (e.press, objetivo(4, (10, 12))),
    ]
    assert objetivo_de(press) == objetivo(5, (3, 5))
    assert alternativas_de(press) == [(e.plancha, objetivo(2, duracion=(60, 90)))]
    # Cada alternativa trae su ejercicio entero, con su tipo.
    assert [a["ejercicio"]["tipo_registro"] for a in plancha["alternativas"]] == [
        "corporal",
        "peso_reps",
    ]


def test_una_rutina_nueva_guarda_el_objetivo_de_cada_alternativa(cliente, e):
    respuesta = cliente.post(
        "/rutinas",
        json={
            "nombre": "Core",
            "slots": [
                cuerpo(
                    e.plancha,
                    objetivo(3, duracion=(30, 45)),
                    [alternativa(e.dominadas, 2, (5, 8))],
                ),
                cuerpo(e.press, objetivo(4, (6, 10)), [alternativa(e.plancha, duracion=(20, 40))]),
            ],
        },
    )

    assert respuesta.status_code == 201, respuesta.text
    [uno, dos] = cliente.get(f"/rutinas/{respuesta.json()['id']}").json()["slots"]
    assert (objetivo_de(uno), alternativas_de(uno)) == (
        objetivo(3, duracion=(30, 45)),
        [(e.dominadas, objetivo(2, (5, 8)))],
    )
    assert (objetivo_de(dos), alternativas_de(dos)) == (
        objetivo(4, (6, 10)),
        [(e.plancha, objetivo(3, duracion=(20, 40)))],
    )


# --- El orden de los errores: 404, luego 422 de objetivo, luego 409 ------------


@pytest.mark.parametrize("via", ["POST", "PUT"])
def test_un_ejercicio_que_no_existe_da_404_antes_que_un_objetivo_equivocado(
    cliente, sesion_bd, e, via
):
    slot = anadido(cliente, e.rutina, principal=e.press, orden=1)["id"]
    antes = cuantos(sesion_bd)
    malas = [alternativa(e.plancha), alternativa(999_999)]

    if via == "POST":
        respuesta = anadir(cliente, e.rutina, principal=e.remo, alternativas=malas)
    else:
        respuesta = editar(cliente, e.rutina, slot, principal=e.press, alternativas=malas)

    assert respuesta.status_code == 404, respuesta.text
    assert cuantos(sesion_bd) == antes


@pytest.mark.parametrize("via", ["POST", "PUT"])
def test_un_objetivo_equivocado_da_422_antes_que_el_409_del_orden(cliente, sesion_bd, e, via):
    """El orden 2 ya está ocupado: aun así, lo primero que se dice es el objetivo."""
    slot = anadido(cliente, e.rutina, principal=e.press, orden=1)["id"]
    anadido(cliente, e.rutina, principal=e.remo, orden=2)
    antes = cuantos(sesion_bd)

    if via == "POST":
        respuesta = anadir(cliente, e.rutina, principal=e.plancha, orden=2)
    else:
        respuesta = editar(cliente, e.rutina, slot, orden=2, principal=e.plancha)

    assert (respuesta.status_code, respuesta.json()["detail"]) == (422, EN_SEGUNDOS)
    assert cuantos(sesion_bd) == antes


def test_un_objetivo_equivocado_da_422_antes_que_el_409_de_ya_es_comodin(cliente, e):
    """Sin lista, pasar a principal un comodín es un 409; si además su objetivo no es
    de su familia, lo primero es el 422.
    """
    slot = anadido(
        cliente,
        e.rutina,
        principal=e.press,
        alternativas=[alternativa(e.plancha, duracion=(30, 60))],
    )["id"]

    con_reps = editar(cliente, e.rutina, slot, principal=e.plancha)
    en_segundos = editar(cliente, e.rutina, slot, principal=e.plancha, obj=EN_SEGUNDOS_OBJ)

    assert (con_reps.status_code, con_reps.json()["detail"]) == (422, EN_SEGUNDOS)
    assert en_segundos.status_code == 409
    assert "ya es comodín" in en_segundos.json()["detail"]


# --- PUT con lista: se actualiza en su sitio ------------------------------------


def test_cambiar_el_objetivo_de_una_alternativa_conserva_su_fila(cliente, sesion_bd, e):
    """La trampa del `UNIQUE(slot_id, ejercicio_id)`: con el objetivo dentro de la
    fila, la tentación es borrarla y volverla a crear con el nuevo, y SQLAlchemy
    insertaría antes de borrar (un 500). La fila sigue siendo la misma, con el id de
    antes y el objetivo nuevo, y la otra alternativa no cambia.
    """
    slot = anadido(
        cliente,
        e.rutina,
        principal=e.press,
        alternativas=[alternativa(e.remo, 3, (8, 12)), alternativa(e.plancha, duracion=(30, 45))],
    )["id"]
    antes = filas(sesion_bd, slot)

    respuesta = editar(
        cliente,
        e.rutina,
        slot,
        principal=e.press,
        alternativas=[
            alternativa(e.remo, 3, (8, 12)),
            alternativa(e.plancha, 5, duracion=(60, 90)),
        ],
    )

    assert respuesta.status_code == 200, respuesta.text
    assert alternativas_de(respuesta.json()) == [
        (e.remo, objetivo(3, (8, 12))),
        (e.plancha, objetivo(5, duracion=(60, 90))),
    ]
    despues = filas(sesion_bd, slot)
    assert {k: fila_id for k, (fila_id, _) in despues.items()} == {
        k: fila_id for k, (fila_id, _) in antes.items()
    }
    assert despues[e.remo] == antes[e.remo]
    assert hueco_guardado(cliente, e.rutina, slot) == respuesta.json()


def test_una_lista_quita_anade_e_intercambia_principal_y_alternativa_a_la_vez(
    cliente, sesion_bd, e
):
    """Press (reps) con Plancha (segundos) y Dominadas de alternativas pasa a Plancha
    de principal, con Press de alternativa y Remo nuevo: Dominadas se va, Plancha
    deja de ser alternativa y Press lo pasa a ser, cada uno con el objetivo que se
    manda (no el que tenía en su otro papel).
    """
    slot = anadido(
        cliente,
        e.rutina,
        principal=e.press,
        obj=objetivo(4, (6, 8)),
        alternativas=[alternativa(e.plancha, duracion=(30, 45)), alternativa(e.dominadas)],
    )["id"]

    respuesta = editar(
        cliente,
        e.rutina,
        slot,
        principal=e.plancha,
        obj=objetivo(3, duracion=(45, 60)),
        alternativas=[alternativa(e.press, 2, (10, 12)), alternativa(e.remo, 3, (8, 10))],
    )

    assert respuesta.status_code == 200, respuesta.text
    hueco = respuesta.json()
    assert hueco["ejercicio_principal"]["id"] == e.plancha
    assert objetivo_de(hueco) == objetivo(3, duracion=(45, 60))
    assert alternativas_de(hueco) == [
        (e.press, objetivo(2, (10, 12))),
        (e.remo, objetivo(3, (8, 10))),
    ]
    assert set(filas(sesion_bd, slot)) == {e.press, e.remo}
    assert hueco_guardado(cliente, e.rutina, slot) == hueco


def test_el_objetivo_de_una_alternativa_que_se_conserva_tambien_se_valida(cliente, sesion_bd, e):
    """Su objetivo viene en el cuerpo, así que se mira aunque no se añada: mandarla
    con el par de otra familia da 422 y no cambia nada, ni lo bueno de la petición.
    """
    slot = anadido(
        cliente,
        e.rutina,
        principal=e.press,
        alternativas=[alternativa(e.plancha, duracion=(30, 45))],
    )["id"]
    antes = filas(sesion_bd, slot)

    respuesta = editar(
        cliente,
        e.rutina,
        slot,
        principal=e.press,
        obj=objetivo(9, (1, 2)),
        alternativas=[alternativa(e.plancha), alternativa(e.remo)],
    )

    assert (respuesta.status_code, respuesta.json()["detail"]) == (422, EN_SEGUNDOS)
    assert filas(sesion_bd, slot) == antes
    assert objetivo_de(hueco_guardado(cliente, e.rutina, slot)) == objetivo(3, (6, 10))


def test_se_puede_cambiar_el_objetivo_de_una_alternativa_ya_oculta(cliente, sesion_bd, e):
    """Conservarla no es elegirla («corregir sí, elegir algo oculto no»): su objetivo
    se puede corregir.
    """
    slot = anadido(cliente, e.rutina, principal=e.press, alternativas=[alternativa(e.remo)])["id"]
    assert cliente.delete(f"/ejercicios/{e.remo}?modo=ocultar").status_code == 204
    [fila_antes] = [fila_id for fila_id, _ in filas(sesion_bd, slot).values()]

    respuesta = editar(
        cliente, e.rutina, slot, principal=e.press, alternativas=[alternativa(e.remo, 5, (1, 3))]
    )

    assert respuesta.status_code == 200, respuesta.text
    assert alternativas_de(respuesta.json()) == [(e.remo, objetivo(5, (1, 3)))]
    assert filas(sesion_bd, slot) == {e.remo: (fila_antes, tuple(objetivo(5, (1, 3)).values()))}


# --- PUT sin lista: las alternativas no se tocan --------------------------------


@pytest.mark.parametrize("lista", ["sin-el-campo", "nula"])
def test_editar_un_hueco_sin_lista_no_toca_las_alternativas_ni_sus_objetivos(
    cliente, sesion_bd, e, lista
):
    """Regresión de G1 (hallazgo del repaso): el PUT copia el cuerpo al hueco campo a
    campo, y con el `exclude` del nombre viejo de la lista (`alternativa_ids`) copiaba
    también `alternativas` encima de la propiedad de solo lectura del modelo: un
    `AttributeError`, un 500, en todos los PUT de un hueco, con lista o sin ella.

    Aquí cambian el principal y su objetivo, y las alternativas siguen igual, en su
    orden (no se les copia el objetivo del principal), en las mismas filas.
    """
    slot = anadido(
        cliente,
        e.rutina,
        principal=e.press,
        alternativas=[alternativa(e.remo, 2, (12, 15)), alternativa(e.plancha, duracion=(30, 45))],
    )["id"]
    antes = filas(sesion_bd, slot)
    extra = {"alternativas": None} if lista == "nula" else {}

    respuesta = editar(
        cliente, e.rutina, slot, principal=e.dominadas, obj=objetivo(5, (3, 5)), **extra
    )

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["ejercicio_principal"]["id"] == e.dominadas
    assert objetivo_de(respuesta.json()) == objetivo(5, (3, 5))
    assert alternativas_de(respuesta.json()) == [
        (e.remo, objetivo(2, (12, 15))),
        (e.plancha, objetivo(3, duracion=(30, 45))),
    ]
    assert filas(sesion_bd, slot) == antes


def test_cambiar_el_principal_por_uno_de_otra_familia_pide_su_par_y_borra_el_otro(
    cliente, sesion_bd, e
):
    """El PUT es completo: el par que no llega queda nulo. Con el par de antes (reps
    para la Plancha) es un 422 y no cambia nada.
    """
    slot = anadido(cliente, e.rutina, principal=e.press, alternativas=[alternativa(e.remo)])["id"]

    con_reps = editar(cliente, e.rutina, slot, principal=e.plancha)
    assert (con_reps.status_code, con_reps.json()["detail"]) == (422, EN_SEGUNDOS)
    assert hueco_guardado(cliente, e.rutina, slot)["ejercicio_principal"]["id"] == e.press

    respuesta = editar(
        cliente, e.rutina, slot, principal=e.plancha, obj=objetivo(2, duracion=(20, 30))
    )

    assert respuesta.status_code == 200, respuesta.text
    assert objetivo_de(respuesta.json()) == objetivo(2, duracion=(20, 30))
    sesion_bd.expire_all()
    guardado = sesion_bd.get(RutinaSlot, slot)
    assert (guardado.reps_min, guardado.reps_max) == (None, None)
    assert alternativas_de(respuesta.json()) == [(e.remo, objetivo(3, (6, 10)))]


# --- La trampa de la propiedad `alternativas` -------------------------------


def test_una_serie_con_una_alternativa_se_valida_por_el_ejercicio_y_no_por_la_fila(
    cliente, sesion_bd, e
):
    """Regresión de la trampa del plan: `_validar_slot` mira los ejercicios del hueco
    con la propiedad `RutinaSlot.alternativas`, que devuelve ejercicios. Si pasara a
    devolver filas de `slot_alternativas` (que ahora tienen su objetivo, y la
    tentación es grande), compararía ids de fila con ids de ejercicio sin dar ningún
    error.

    Para que se note, la fila de la alternativa (Remo) lleva a propósito el id de
    otro ejercicio (Dominadas) que no está en el hueco: con ids de fila, Remo daría 422
    y Dominadas colaría.
    """
    slot = anadido(cliente, e.rutina, principal=e.press)["id"]
    sesion_bd.add(
        SlotAlternativa(id=e.dominadas, slot_id=slot, ejercicio_id=e.remo, **objetivo(3, (6, 10)))
    )
    sesion_bd.commit()
    assert e.dominadas != e.remo
    sesion = entrenar(cliente, hoy(), e.rutina).json()["id"]
    ruta = f"/entrenamientos/{sesion}/series"
    base = {"slot_id": slot, "numero_serie": 1, "peso": 0, "repeticiones": 8}

    intrusa = cliente.post(ruta, json={**base, "ejercicio_id": e.dominadas})
    con_la_alternativa = cliente.post(ruta, json={**base, "ejercicio_id": e.remo, "peso": 40})

    assert intrusa.status_code == 422, intrusa.text
    assert (
        intrusa.json()["detail"]
        == "Ese ejercicio no es ni el principal ni un comodín de este hueco"
    )
    assert con_la_alternativa.status_code == 201, con_la_alternativa.text


# --- Duplicar -----------------------------------------------------------------


def test_duplicar_copia_el_objetivo_del_principal_y_de_cada_alternativa(cliente, sesion_bd, e):
    anadido(
        cliente,
        e.rutina,
        principal=e.plancha,
        obj=objetivo(3, duracion=(30, 45)),
        alternativas=[alternativa(e.dominadas, 2, (5, 8)), alternativa(e.press, 4, (10, 12))],
    )
    anadido(
        cliente,
        e.rutina,
        principal=e.press,
        obj=objetivo(5, (3, 5)),
        alternativas=[alternativa(e.plancha, 1, duracion=(60, 120))],
    )
    original = cliente.get(f"/rutinas/{e.rutina}").json()

    respuesta = cliente.post(f"/rutinas/{e.rutina}/duplicar")

    assert respuesta.status_code == 201, respuesta.text

    def lo_que_tiene(rutina):
        return [
            (h["orden"], h["ejercicio_principal"]["id"], objetivo_de(h), alternativas_de(h))
            for h in rutina["slots"]
        ]

    assert lo_que_tiene(respuesta.json()) == lo_que_tiene(original)
    # Filas nuevas, no las del original.
    copia = [h["id"] for h in respuesta.json()["slots"]]
    sesion_bd.expire_all()
    ids_de_filas = sesion_bd.scalars(
        select(SlotAlternativa.slot_id).where(SlotAlternativa.slot_id.in_(copia))
    ).all()
    assert len(ids_de_filas) == 3


# --- Los CHECK de la base -------------------------------------------------------

MAL_EN_LA_BASE = [
    pytest.param({"series_objetivo": 3}, id="sin-par"),
    pytest.param(
        {
            "series_objetivo": 3,
            "reps_min": 6,
            "reps_max": 10,
            "duracion_min_s": 30,
            "duracion_max_s": 60,
        },
        id="los-dos-pares",
    ),
    pytest.param({"series_objetivo": 3, "reps_min": 6}, id="reps-sin-maximo"),
    pytest.param({"series_objetivo": 3, "duracion_min_s": 30}, id="duracion-sin-maximo"),
]


@pytest.mark.parametrize("obj", MAL_EN_LA_BASE)
@pytest.mark.parametrize("tabla", ["rutina_slots", "slot_alternativas"])
def test_la_base_rechaza_un_objetivo_sin_exactamente_un_par_completo(
    cliente, sesion_bd, e, tabla, obj
):
    """Lo que la API ya no deja pasar, metido a mano: el CHECK de cada tabla lo para."""
    slot = anadido(cliente, e.rutina, principal=e.press, orden=1)["id"]
    if tabla == "rutina_slots":
        fila = RutinaSlot(rutina_id=e.rutina, ejercicio_principal_id=e.remo, orden=2, **obj)
    else:
        fila = SlotAlternativa(slot_id=slot, ejercicio_id=e.remo, **obj)
    sesion_bd.add(fila)

    with pytest.raises(IntegrityError) as error:
        sesion_bd.flush()

    assert f"{tabla}_objetivo_check" in str(error.value)
    sesion_bd.rollback()


@pytest.mark.parametrize("tabla", ["rutina_slots", "slot_alternativas"])
@pytest.mark.parametrize("obj", [EN_REPS_OBJ, EN_SEGUNDOS_OBJ], ids=["reps", "segundos"])
def test_la_base_acepta_un_par_completo_de_cada_clase(cliente, sesion_bd, e, tabla, obj):
    """El otro lado: la base no sabe de tipos, solo de la forma."""
    slot = anadido(cliente, e.rutina, principal=e.press, orden=1)["id"]
    if tabla == "rutina_slots":
        fila = RutinaSlot(rutina_id=e.rutina, ejercicio_principal_id=e.remo, orden=2, **obj)
    else:
        fila = SlotAlternativa(slot_id=slot, ejercicio_id=e.remo, **obj)
    sesion_bd.add(fila)
    sesion_bd.commit()

    sesion_bd.expire_all()
    guardada = sesion_bd.get(type(fila), fila.id)
    assert tuple(getattr(guardada, c) for c in CAMPOS_DEL_OBJETIVO) == tuple(obj.values())


def test_una_alternativa_sin_series_objetivo_no_entra_en_la_base(cliente, sesion_bd, e):
    slot = anadido(cliente, e.rutina, principal=e.press)["id"]
    sesion_bd.add(SlotAlternativa(slot_id=slot, ejercicio_id=e.remo, reps_min=6, reps_max=10))

    with pytest.raises(IntegrityError) as error:
        sesion_bd.flush()

    assert "series_objetivo" in str(error.value)
    sesion_bd.rollback()
