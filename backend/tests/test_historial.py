"""Tests del historial de progresión: `/ejercicios/{id}/historial` y
`/rutinas/{id}/slots/{slot_id}/historial`.

Los dos endpoints comparten la consulta (`app/historial.py`), así que lo que se
prueba aquí es sobre todo esa parte común: que la agrupación por sesión no mezcla
días ni entrenamientos, que `?limite=` recorta sesiones enteras (nunca series
sueltas), que el rango de fechas incluye sus dos extremos, y que nada de otro
usuario se cuela por el camino.
"""

import pytest

from app.models import Ejercicio, Entrenamiento, Rutina, RutinaSlot, Serie

# --- Ayudantes para montar escenarios ------------------------------------


def crear_ejercicio(cliente, grupo_muscular_id, nombre="Press banca") -> int:
    respuesta = cliente.post(
        "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    )
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def crear_rutina(cliente, nombre="Push") -> int:
    return cliente.post("/rutinas", json={"nombre": nombre}).json()["id"]


def crear_hueco(cliente, rutina_id, ejercicio_id, orden=1) -> int:
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": orden,
            "series_objetivo": 4,
            "reps_min": 6,
            "reps_max": 10,
        },
    )
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def crear_entrenamiento(cliente, fecha, rutina_id=None) -> int:
    respuesta = cliente.post("/entrenamientos", json={"rutina_id": rutina_id, "fecha": fecha})
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def registrar_serie(
    cliente, entrenamiento_id, ejercicio_id, numero_serie=1, peso=60, slot_id=None
) -> int:
    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={
            "ejercicio_id": ejercicio_id,
            "slot_id": slot_id,
            "numero_serie": numero_serie,
            "peso": peso,
            "repeticiones": 8,
        },
    )
    assert respuesta.status_code == 201
    return respuesta.json()["id"]


def entrenar(cliente, fecha, ejercicio_id, rutina_id=None, slot_id=None, series=1) -> int:
    """Un día completo: la sesión y sus series, todas del mismo ejercicio/hueco."""
    entrenamiento_id = crear_entrenamiento(cliente, fecha, rutina_id)
    for numero in range(1, series + 1):
        registrar_serie(cliente, entrenamiento_id, ejercicio_id, numero, slot_id=slot_id)
    return entrenamiento_id


@pytest.fixture
def escenario(cliente, grupo_muscular_id):
    """Lo mínimo para tener historial: un ejercicio, una rutina y un hueco suyo."""
    ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id)
    rutina_id = crear_rutina(cliente)
    slot_id = crear_hueco(cliente, rutina_id, ejercicio_id)
    return {"ejercicio_id": ejercicio_id, "rutina_id": rutina_id, "slot_id": slot_id}


def historial_de_ejercicio(cliente, ejercicio_id, **filtros):
    respuesta = cliente.get(f"/ejercicios/{ejercicio_id}/historial", params=filtros)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def historial_de_hueco(cliente, rutina_id, slot_id, **filtros):
    respuesta = cliente.get(f"/rutinas/{rutina_id}/slots/{slot_id}/historial", params=filtros)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


# --- Agrupación por sesión -----------------------------------------------


def test_un_ejercicio_sin_series_tiene_el_historial_vacio(cliente, escenario):
    assert historial_de_ejercicio(cliente, escenario["ejercicio_id"]) == []
    assert historial_de_hueco(cliente, escenario["rutina_id"], escenario["slot_id"]) == []


def test_cada_dia_es_una_entrada_y_van_de_la_mas_reciente_a_la_mas_antigua(cliente, escenario):
    entrenar(
        cliente,
        "2026-09-01",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=3,
    )
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=2,
    )

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-05", "2026-09-01"]
    assert [len(sesion["series"]) for sesion in historial] == [2, 3]
    assert [sesion["rutina"] for sesion in historial] == ["Push", "Push"]


def test_un_entrenamiento_libre_aparece_en_el_historial_con_rutina_nula(cliente, escenario):
    """Sin plantilla detrás no hay nombre de rutina que mostrar, pero la sesión
    cuenta igual para la progresión del ejercicio.
    """
    entrenar(cliente, "2026-09-05", escenario["ejercicio_id"], rutina_id=None, series=1)

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert len(historial) == 1
    assert historial[0]["rutina"] is None


def test_las_series_de_cada_dia_salen_ordenadas_por_numero_de_serie(cliente, escenario):
    """Se registran desordenadas a propósito: el orden lo pone la consulta, no
    el orden de inserción.
    """
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    for numero in (3, 1, 2):
        registrar_serie(
            cliente,
            entrenamiento_id,
            escenario["ejercicio_id"],
            numero_serie=numero,
            slot_id=escenario["slot_id"],
        )

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert [serie["numero_serie"] for serie in historial[0]["series"]] == [1, 2, 3]


def test_una_sesion_solo_trae_las_series_de_ese_ejercicio_no_el_entrenamiento_entero(
    cliente, escenario, grupo_muscular_id
):
    """El mismo día se hicieron dos ejercicios: el historial de uno no puede
    arrastrar las series del otro.
    """
    otro_ejercicio_id = crear_ejercicio(cliente, grupo_muscular_id, "Fondos")
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    registrar_serie(
        cliente, entrenamiento_id, escenario["ejercicio_id"], 1, slot_id=escenario["slot_id"]
    )
    registrar_serie(cliente, entrenamiento_id, otro_ejercicio_id, 2)

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"])

    assert len(historial) == 1
    assert [serie["numero_serie"] for serie in historial[0]["series"]] == [1]


def test_una_serie_sin_hueco_cuenta_para_el_ejercicio_pero_no_para_el_hueco(cliente, escenario):
    """Un día de entrenamiento libre es progresión del ejercicio, pero no de un
    hueco de rutina: la serie no apunta a ninguno (`slot_id` nulo).
    """
    entrenar(
        cliente,
        "2026-09-01",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )
    entrenar(cliente, "2026-09-05", escenario["ejercicio_id"], rutina_id=None, series=1)

    del_ejercicio = historial_de_ejercicio(cliente, escenario["ejercicio_id"])
    del_hueco = historial_de_hueco(cliente, escenario["rutina_id"], escenario["slot_id"])

    assert [sesion["fecha"] for sesion in del_ejercicio] == ["2026-09-05", "2026-09-01"]
    assert [sesion["fecha"] for sesion in del_hueco] == ["2026-09-01"]


def test_el_mismo_ejercicio_en_dos_huecos_cuenta_entero_para_el_ejercicio_y_por_separado_por_hueco(
    cliente, escenario
):
    """Un ejercicio puede ocupar dos huecos de la misma rutina. Su historial
    junta las series de ambos; el de cada hueco solo trae las suyas.
    """
    segundo_slot_id = crear_hueco(
        cliente, escenario["rutina_id"], escenario["ejercicio_id"], orden=2
    )
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    registrar_serie(
        cliente,
        entrenamiento_id,
        escenario["ejercicio_id"],
        1,
        peso=60,
        slot_id=escenario["slot_id"],
    )
    registrar_serie(
        cliente, entrenamiento_id, escenario["ejercicio_id"], 1, peso=25, slot_id=segundo_slot_id
    )

    del_ejercicio = historial_de_ejercicio(cliente, escenario["ejercicio_id"])
    del_primer_hueco = historial_de_hueco(cliente, escenario["rutina_id"], escenario["slot_id"])

    assert len(del_ejercicio) == 1
    assert sorted(float(serie["peso"]) for serie in del_ejercicio[0]["series"]) == [25.0, 60.0]
    assert [float(serie["peso"]) for serie in del_primer_hueco[0]["series"]] == [60.0]

    # Las dos series numeran desde 1, así que sin el slot_id no habría forma de
    # saber cuál pertenece a cada hueco.
    por_hueco = {serie["slot_id"]: float(serie["peso"]) for serie in del_ejercicio[0]["series"]}
    assert por_hueco == {escenario["slot_id"]: 60.0, segundo_slot_id: 25.0}


# --- Filtro por ejercicio en el historial de un hueco --------------------
#
# Al entrenar se compara con la última vez que se hizo ESE ejercicio en ESE
# hueco, no con la última sesión del hueco: si la semana pasada tocó el comodín,
# sus pesos no sirven de referencia para el principal.


@pytest.fixture
def hueco_con_comodin(cliente, grupo_muscular_id, escenario):
    """El escenario de siempre, con un comodín en el hueco y tres días: el
    principal el 1, el comodín el 8 y otra vez el principal el 15.
    """
    comodin_id = crear_ejercicio(cliente, grupo_muscular_id, "Press banca en máquina")
    respuesta = cliente.post(
        f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}/alternativas",
        json={"ejercicio_id": comodin_id},
    )
    assert respuesta.status_code == 201
    for fecha, ejercicio_id in [
        ("2026-09-01", escenario["ejercicio_id"]),
        ("2026-09-08", comodin_id),
        ("2026-09-15", escenario["ejercicio_id"]),
    ]:
        entrenar(cliente, fecha, ejercicio_id, escenario["rutina_id"], escenario["slot_id"])
    return {**escenario, "comodin_id": comodin_id}


def test_el_filtro_por_ejercicio_separa_el_principal_del_comodin(cliente, hueco_con_comodin):
    rutina_id, slot_id = hueco_con_comodin["rutina_id"], hueco_con_comodin["slot_id"]

    todo = historial_de_hueco(cliente, rutina_id, slot_id)
    principal = historial_de_hueco(
        cliente, rutina_id, slot_id, ejercicio_id=hueco_con_comodin["ejercicio_id"]
    )
    comodin = historial_de_hueco(
        cliente, rutina_id, slot_id, ejercicio_id=hueco_con_comodin["comodin_id"]
    )

    assert [sesion["fecha"] for sesion in todo] == ["2026-09-15", "2026-09-08", "2026-09-01"]
    assert [sesion["fecha"] for sesion in principal] == ["2026-09-15", "2026-09-01"]
    assert [sesion["fecha"] for sesion in comodin] == ["2026-09-08"]


def test_la_ultima_vez_de_un_ejercicio_salta_los_dias_en_que_toco_el_comodin(
    cliente, hueco_con_comodin
):
    """Es la consulta de la "última vez": el día anterior como tope y una sola
    sesión. Sin el filtro devolvería el día del comodín.
    """
    ultima_vez = historial_de_hueco(
        cliente,
        hueco_con_comodin["rutina_id"],
        hueco_con_comodin["slot_id"],
        ejercicio_id=hueco_con_comodin["ejercicio_id"],
        hasta="2026-09-14",
        limite=1,
    )

    assert [sesion["fecha"] for sesion in ultima_vez] == ["2026-09-01"]


def test_el_filtro_acepta_un_ejercicio_ocultado(cliente, hueco_con_comodin):
    """Ocultar un ejercicio no esconde lo que se hizo con él."""
    assert (
        cliente.delete(f"/ejercicios/{hueco_con_comodin['comodin_id']}?modo=ocultar").status_code
        == 204
    )

    comodin = historial_de_hueco(
        cliente,
        hueco_con_comodin["rutina_id"],
        hueco_con_comodin["slot_id"],
        ejercicio_id=hueco_con_comodin["comodin_id"],
    )

    assert [sesion["fecha"] for sesion in comodin] == ["2026-09-08"]


def test_el_filtro_con_un_ejercicio_ajeno_o_inexistente_da_404(
    cliente, sesion_bd, grupo_muscular_id, otro_usuario_id, escenario
):
    ajeno = Ejercicio(
        nombre="Press de otro", grupo_muscular_id=grupo_muscular_id, usuario_id=otro_usuario_id
    )
    sesion_bd.add(ajeno)
    sesion_bd.commit()
    ruta = f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}/historial"

    assert cliente.get(ruta, params={"ejercicio_id": ajeno.id}).status_code == 404
    assert cliente.get(ruta, params={"ejercicio_id": 999999}).status_code == 404


# --- El límite cuenta sesiones, no series --------------------------------


def test_el_limite_devuelve_sesiones_completas_no_series_sueltas(cliente, escenario):
    """`?limite=2` con días de 3 series debe dar 2 días enteros (6 series), no
    las 2 series más recientes: cortar por series partiría un día por la mitad.
    """
    for fecha in ("2026-09-01", "2026-09-03", "2026-09-05"):
        entrenar(
            cliente,
            fecha,
            escenario["ejercicio_id"],
            escenario["rutina_id"],
            escenario["slot_id"],
            series=3,
        )

    historial = historial_de_ejercicio(cliente, escenario["ejercicio_id"], limite=2)

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-05", "2026-09-03"]
    assert [len(sesion["series"]) for sesion in historial] == [3, 3]


def test_el_limite_del_historial_de_un_hueco_tambien_cuenta_sesiones(cliente, escenario):
    for fecha in ("2026-09-01", "2026-09-03", "2026-09-05"):
        entrenar(
            cliente,
            fecha,
            escenario["ejercicio_id"],
            escenario["rutina_id"],
            escenario["slot_id"],
            series=2,
        )

    historial = historial_de_hueco(cliente, escenario["rutina_id"], escenario["slot_id"], limite=1)

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-05"]
    assert len(historial[0]["series"]) == 2


def test_el_limite_recorta_despues_de_filtrar_por_fecha_no_antes(cliente, escenario):
    """Con `hasta=` puesto, `limite=1` debe dar la sesión más reciente *dentro
    del rango*, no la más reciente de todas descartada luego por la fecha.
    """
    for fecha in ("2026-09-01", "2026-09-03", "2026-09-05"):
        entrenar(
            cliente,
            fecha,
            escenario["ejercicio_id"],
            escenario["rutina_id"],
            escenario["slot_id"],
            series=1,
        )

    historial = historial_de_ejercicio(
        cliente, escenario["ejercicio_id"], hasta="2026-09-03", limite=1
    )

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-03"]


# --- Rango de fechas -----------------------------------------------------


def test_el_rango_de_fechas_incluye_sus_dos_extremos(cliente, escenario):
    for fecha in ("2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05"):
        entrenar(
            cliente,
            fecha,
            escenario["ejercicio_id"],
            escenario["rutina_id"],
            escenario["slot_id"],
            series=1,
        )

    historial = historial_de_ejercicio(
        cliente, escenario["ejercicio_id"], desde="2026-09-02", hasta="2026-09-04"
    )

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-04", "2026-09-02"]


def test_un_rango_de_un_solo_dia_devuelve_ese_dia(cliente, escenario):
    entrenar(
        cliente,
        "2026-09-04",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )

    historial = historial_de_ejercicio(
        cliente, escenario["ejercicio_id"], desde="2026-09-04", hasta="2026-09-04"
    )

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-04"]


def test_un_rango_invertido_se_rechaza(cliente, escenario):
    """`desde` posterior a `hasta` solo puede ser un error de quien llama: no
    existe ninguna sesión que cumpla ese rango.

    Devolver una lista vacía disimularía el fallo, así que se rechaza con 422,
    igual que un hueco con `reps_max` menor que `reps_min`.
    """
    entrenar(
        cliente,
        "2026-09-03",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )

    respuesta = cliente.get(
        f"/ejercicios/{escenario['ejercicio_id']}/historial",
        params={"desde": "2026-09-05", "hasta": "2026-09-01"},
    )

    assert respuesta.status_code == 422
    assert "invertido" in respuesta.json()["detail"]


# --- Aislamiento por usuario ---------------------------------------------
#
# Como todavía no hay JWT (`app/auth.py` devuelve un id fijo), los datos ajenos
# se insertan directamente en la base: es la única forma de montar el escenario.


def registrar_serie_ajena(sesion_bd, usuario_id, ejercicio_id, fecha, slot_id=None) -> None:
    """Un entrenamiento de otro usuario con una serie dentro, insertado a mano."""
    entrenamiento = Entrenamiento(usuario_id=usuario_id, fecha=fecha)
    sesion_bd.add(entrenamiento)
    sesion_bd.flush()
    sesion_bd.add(
        Serie(
            entrenamiento_id=entrenamiento.id,
            slot_id=slot_id,
            ejercicio_id=ejercicio_id,
            numero_serie=1,
            peso=99,
            repeticiones=1,
        )
    )
    sesion_bd.commit()


def test_el_historial_de_un_ejercicio_predefinido_no_muestra_series_de_otro_usuario(
    cliente, sesion_bd, ejercicio_predefinido_id, otro_usuario_id
):
    """Un ejercicio predefinido lo comparten todos los usuarios, así que el
    filtro por dueño no puede estar en el ejercicio: tiene que estar en el
    entrenamiento al que pertenece cada serie.
    """
    registrar_serie_ajena(sesion_bd, otro_usuario_id, ejercicio_predefinido_id, "2026-09-05")
    entrenar(cliente, "2026-09-01", ejercicio_predefinido_id, series=1)

    historial = historial_de_ejercicio(cliente, ejercicio_predefinido_id)

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-01"]
    assert [float(serie["peso"]) for serie in historial[0]["series"]] == [60.0]


def test_no_se_puede_ver_el_historial_de_un_ejercicio_privado_de_otro_usuario(
    cliente, sesion_bd, grupo_muscular_id, otro_usuario_id
):
    ejercicio = Ejercicio(
        nombre="Ejercicio de otro",
        grupo_muscular_id=grupo_muscular_id,
        usuario_id=otro_usuario_id,
    )
    sesion_bd.add(ejercicio)
    sesion_bd.commit()

    assert cliente.get(f"/ejercicios/{ejercicio.id}/historial").status_code == 404


def test_el_historial_de_un_hueco_no_muestra_series_de_otro_usuario(
    cliente, sesion_bd, escenario, otro_usuario_id
):
    """Nada impide en la base que la serie de otro usuario apunte a un hueco
    ajeno, así que el filtro por dueño del entrenamiento es lo único que separa
    los dos historiales.
    """
    registrar_serie_ajena(
        sesion_bd,
        otro_usuario_id,
        escenario["ejercicio_id"],
        "2026-09-05",
        slot_id=escenario["slot_id"],
    )
    entrenar(
        cliente,
        "2026-09-01",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=1,
    )

    historial = historial_de_hueco(cliente, escenario["rutina_id"], escenario["slot_id"])

    assert [sesion["fecha"] for sesion in historial] == ["2026-09-01"]


def test_no_se_puede_ver_el_historial_de_un_hueco_de_una_rutina_ajena(
    cliente, sesion_bd, grupo_muscular_id, otro_usuario_id
):
    """404, como el resto de GET del proyecto: una rutina ajena no existe para
    quien la pide, y un 403 confirmaría que ese id existe.
    """
    ejercicio = Ejercicio(
        nombre="Press de otro", grupo_muscular_id=grupo_muscular_id, usuario_id=otro_usuario_id
    )
    rutina = Rutina(usuario_id=otro_usuario_id, nombre="Rutina de otro")
    sesion_bd.add_all([ejercicio, rutina])
    sesion_bd.flush()
    hueco = RutinaSlot(
        rutina_id=rutina.id,
        ejercicio_principal_id=ejercicio.id,
        orden=1,
        series_objetivo=4,
        reps_min=6,
        reps_max=10,
    )
    sesion_bd.add(hueco)
    sesion_bd.commit()

    respuesta = cliente.get(f"/rutinas/{rutina.id}/slots/{hueco.id}/historial")

    assert respuesta.status_code == 404


def test_un_hueco_no_se_alcanza_por_la_ruta_de_otra_rutina(cliente, escenario):
    """La ruta lleva rutina_id y slot_id: si no cuadran entre sí, 404 — aunque
    las dos rutinas sean del mismo usuario.
    """
    otra_rutina_id = crear_rutina(cliente, "Pull")

    respuesta = cliente.get(f"/rutinas/{otra_rutina_id}/slots/{escenario['slot_id']}/historial")

    assert respuesta.status_code == 404


# --- Historial de lo que se ha ocultado ----------------------------------
#
# `?modo=ocultar` existe precisamente para conservar el historial ("deja de
# aparecer para entrenamientos nuevos, pero el historial existente queda
# intacto"). Si al ocultar algo su historial deja de poder consultarse, ese
# historial se conserva en la base pero es inalcanzable por la API — el mismo
# agujero que ya obligó a añadir `?ocultos=true` y `POST /{id}/mostrar`.


def test_el_historial_de_un_ejercicio_ocultado_se_sigue_pudiendo_consultar(cliente, escenario):
    """Ocultar un ejercicio es lo que se hace con la máquina que ya no se usa;
    sus series siguen en la base y son parte de la progresión pasada.
    """
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=2,
    )
    assert (
        cliente.delete(f"/ejercicios/{escenario['ejercicio_id']}?modo=ocultar").status_code == 204
    )

    respuesta = cliente.get(f"/ejercicios/{escenario['ejercicio_id']}/historial")

    assert respuesta.status_code == 200
    assert len(respuesta.json()[0]["series"]) == 2


def test_el_historial_de_un_hueco_ocultado_se_sigue_pudiendo_consultar(cliente, escenario):
    """Mismo caso que el ejercicio ocultado, pero por el otro endpoint: el hueco
    se retira de la rutina y su progresión pasada debe seguir consultándose.
    """
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=2,
    )
    borrado = cliente.delete(
        f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}?modo=ocultar"
    )
    assert borrado.status_code == 204

    respuesta = cliente.get(
        f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}/historial"
    )

    assert respuesta.status_code == 200
    assert len(respuesta.json()[0]["series"]) == 2


def test_el_historial_de_los_huecos_de_una_rutina_ocultada_se_sigue_pudiendo_consultar(
    cliente, escenario
):
    """Retirar una rutina entera (`Push v1`) es el caso más habitual de ocultar,
    y es justo cuando más interesa poder mirar atrás lo que se levantó en ella.
    """
    entrenar(
        cliente,
        "2026-09-05",
        escenario["ejercicio_id"],
        escenario["rutina_id"],
        escenario["slot_id"],
        series=2,
    )
    assert cliente.delete(f"/rutinas/{escenario['rutina_id']}?modo=ocultar").status_code == 204

    respuesta = cliente.get(
        f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}/historial"
    )

    assert respuesta.status_code == 200
    assert len(respuesta.json()[0]["series"]) == 2


# --- Lo que protege la coherencia del historial ---------------------------


def test_no_se_puede_mover_de_rutina_un_entrenamiento_con_series_en_huecos(cliente, escenario):
    """Cambiar la rutina dejaría las series apuntando a huecos de la anterior, y
    el historial de esos huecos mostraría una sesión con el nombre de otra
    rutina. Se avisa con un 409 en vez de romper el historial en silencio.
    """
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    registrar_serie(
        cliente, entrenamiento_id, escenario["ejercicio_id"], slot_id=escenario["slot_id"]
    )
    otra_rutina_id = crear_rutina(cliente, nombre="Pull")

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}",
        json={"rutina_id": otra_rutina_id, "fecha": "2026-09-05"},
    )

    assert respuesta.status_code == 409
    assert "huecos" in respuesta.json()["detail"]


def test_un_entrenamiento_libre_si_puede_pasar_a_seguir_una_rutina(cliente, escenario):
    """Sus series no referencian ningún hueco, así que no hay nada que romper."""
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05")
    registrar_serie(cliente, entrenamiento_id, escenario["ejercicio_id"])

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}",
        json={"rutina_id": escenario["rutina_id"], "fecha": "2026-09-05"},
    )

    assert respuesta.status_code == 200


def test_no_se_puede_pasar_a_libre_un_entrenamiento_con_series_en_huecos(cliente, escenario):
    """Quitarle la rutina es otra forma de cambiársela: las series seguirían
    apuntando a huecos de una rutina que la sesión ya no dice seguir.
    """
    entrenamiento_id = crear_entrenamiento(cliente, "2026-09-05", escenario["rutina_id"])
    registrar_serie(
        cliente, entrenamiento_id, escenario["ejercicio_id"], slot_id=escenario["slot_id"]
    )

    respuesta = cliente.put(
        f"/entrenamientos/{entrenamiento_id}", json={"rutina_id": None, "fecha": "2026-09-05"}
    )

    assert respuesta.status_code == 409
    assert (
        cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["rutina_id"]
        == (escenario["rutina_id"])
    )


@pytest.mark.parametrize("limite", [0, 501])
def test_el_limite_va_de_1_a_500_sesiones(cliente, escenario, limite):
    rutas = [
        f"/ejercicios/{escenario['ejercicio_id']}/historial",
        f"/rutinas/{escenario['rutina_id']}/slots/{escenario['slot_id']}/historial",
    ]

    for ruta in rutas:
        assert cliente.get(ruta, params={"limite": limite}).status_code == 422
