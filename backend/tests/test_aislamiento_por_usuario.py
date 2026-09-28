"""Un usuario no puede ver ni tocar los datos de otro.

Hoy la API trabaja con un único usuario hardcodeado (`app/auth.py`), así que los
datos ajenos se insertan directamente en la base: es la única forma de probar
esto antes de que exista JWT. Cuando llegue la autenticación real, estos tests
son la red que avisa si el aislamiento se rompe.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.auth import USUARIO_SEMBRADO_ID
from app.fechas import hoy
from app.models import (
    Ejercicio,
    Entrenamiento,
    ExcepcionDelPlan,
    NotaUsuarioEjercicio,
    Programa,
    ProgramaDia,
    ProgramaPeriodo,
    Rutina,
    Serie,
    Usuario,
)


@pytest.fixture
def otro_usuario_id(sesion_bd) -> int:
    """Un segundo usuario, distinto del que usa la API."""
    email = "otro@example.com"
    usuario = sesion_bd.scalar(select(Usuario).where(Usuario.email == email))
    if usuario is None:
        usuario = Usuario(nombre="Otro", email=email, password_hash="sin-login")
        sesion_bd.add(usuario)
        sesion_bd.commit()
    assert usuario.id != USUARIO_SEMBRADO_ID
    return usuario.id


@pytest.fixture
def rutina_ajena_id(sesion_bd, otro_usuario_id) -> int:
    rutina = Rutina(usuario_id=otro_usuario_id, nombre="Rutina de otro")
    sesion_bd.add(rutina)
    sesion_bd.commit()
    return rutina.id


def test_el_listado_no_incluye_rutinas_de_otro_usuario(cliente, rutina_ajena_id):
    assert cliente.get("/rutinas").json() == []


def test_no_se_puede_consultar_una_rutina_ajena(cliente, rutina_ajena_id):
    assert cliente.get(f"/rutinas/{rutina_ajena_id}").status_code == 404


def test_no_se_puede_editar_una_rutina_ajena(cliente, rutina_ajena_id):
    respuesta = cliente.put(f"/rutinas/{rutina_ajena_id}", json={"nombre": "Secuestrada"})
    assert respuesta.status_code == 403


def test_no_se_puede_borrar_una_rutina_ajena(cliente, rutina_ajena_id):
    assert cliente.delete(f"/rutinas/{rutina_ajena_id}").status_code == 403


def test_mandar_usuario_id_en_el_body_no_sirve_para_suplantar(cliente, otro_usuario_id):
    """Pydantic ignora los campos que no declara, así que el dueño lo decide el backend."""
    rutina = cliente.post("/rutinas", json={"nombre": "Push", "usuario_id": otro_usuario_id}).json()
    assert rutina["usuario_id"] == USUARIO_SEMBRADO_ID


# --- Notas sobre ejercicios ----------------------------------------------
#
# Las notas son el primer recurso anidado del proyecto donde validar el padre
# NO demuestra propiedad: un ejercicio predefinido es compartido por todos los
# usuarios, así que dos personas pueden tener notas sobre el mismo ejercicio.
# El dueño hay que comprobarlo en la propia fila (`nota.usuario_id`).


@pytest.fixture
def ejercicio_compartido_id(ejercicio_predefinido_id) -> int:
    """Un ejercicio predefinido: visible para todos, de nadie en concreto."""
    return ejercicio_predefinido_id


@pytest.fixture
def nota_ajena_id(sesion_bd, otro_usuario_id, ejercicio_compartido_id) -> int:
    """Una nota de otro usuario sobre el ejercicio que ambos comparten."""
    nota = NotaUsuarioEjercicio(
        usuario_id=otro_usuario_id,
        ejercicio_id=ejercicio_compartido_id,
        nota="El asiento va en el 4",
    )
    sesion_bd.add(nota)
    sesion_bd.commit()
    return nota.id


def _texto_de_la_nota(sesion_bd, nota_id: int) -> str | None:
    """Lee la nota directamente de la base, sin pasar por la API ni por lo que
    la sesión tuviera cacheado.
    """
    sesion_bd.expire_all()
    return sesion_bd.scalar(
        select(NotaUsuarioEjercicio.nota).where(NotaUsuarioEjercicio.id == nota_id)
    )


def test_las_notas_de_otro_usuario_no_se_listan_aunque_el_ejercicio_sea_compartido(
    cliente, ejercicio_compartido_id, nota_ajena_id
):
    """Un ejercicio predefinido lo ven los dos usuarios, pero cada uno solo
    debe ver sus propias notas: son privadas, no comentarios públicos.
    """
    cliente.post(f"/ejercicios/{ejercicio_compartido_id}/notas", json={"nota": "La mía"})

    notas = cliente.get(f"/ejercicios/{ejercicio_compartido_id}/notas").json()

    assert [nota["nota"] for nota in notas] == ["La mía"]


def test_el_listado_de_notas_esta_vacio_si_las_unicas_notas_son_ajenas(
    cliente, ejercicio_compartido_id, nota_ajena_id
):
    assert cliente.get(f"/ejercicios/{ejercicio_compartido_id}/notas").json() == []


def test_no_se_puede_editar_la_nota_de_otro_usuario(
    cliente, sesion_bd, ejercicio_compartido_id, nota_ajena_id
):
    respuesta = cliente.put(
        f"/ejercicios/{ejercicio_compartido_id}/notas/{nota_ajena_id}",
        json={"nota": "Secuestrada"},
    )

    assert respuesta.status_code == 403
    assert _texto_de_la_nota(sesion_bd, nota_ajena_id) == "El asiento va en el 4"


def test_no_se_puede_borrar_la_nota_de_otro_usuario(
    cliente, sesion_bd, ejercicio_compartido_id, nota_ajena_id
):
    respuesta = cliente.delete(f"/ejercicios/{ejercicio_compartido_id}/notas/{nota_ajena_id}")

    assert respuesta.status_code == 403
    assert _texto_de_la_nota(sesion_bd, nota_ajena_id) is not None


def test_una_nota_ajena_no_se_alcanza_colandola_por_un_ejercicio_propio(
    cliente, sesion_bd, grupo_muscular_id, nota_ajena_id
):
    """La ruta lleva ejercicio_id y nota_id: si no cuadran entre sí, la nota
    no se toca ni aunque el ejercicio de la ruta sí sea del usuario.
    """
    ejercicio_propio_id = cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]

    assert (
        cliente.put(
            f"/ejercicios/{ejercicio_propio_id}/notas/{nota_ajena_id}",
            json={"nota": "Secuestrada"},
        ).status_code
        == 404
    )
    assert (
        cliente.delete(f"/ejercicios/{ejercicio_propio_id}/notas/{nota_ajena_id}").status_code
        == 404
    )
    assert _texto_de_la_nota(sesion_bd, nota_ajena_id) == "El asiento va en el 4"


def test_no_se_puede_anotar_ni_leer_un_ejercicio_privado_de_otro_usuario(
    cliente, sesion_bd, otro_usuario_id, grupo_muscular_id
):
    """Un ejercicio propio de otro usuario no es visible, así que ni siquiera
    se llega a la parte de las notas.
    """
    ejercicio = Ejercicio(
        nombre="Ejercicio de otro",
        grupo_muscular_id=grupo_muscular_id,
        usuario_id=otro_usuario_id,
    )
    sesion_bd.add(ejercicio)
    sesion_bd.commit()

    assert cliente.get(f"/ejercicios/{ejercicio.id}/notas").status_code == 404
    assert cliente.post(f"/ejercicios/{ejercicio.id}/notas", json={"nota": "x"}).status_code == 404


def test_mandar_usuario_id_en_el_body_no_crea_la_nota_a_nombre_de_otro(
    cliente, ejercicio_compartido_id, otro_usuario_id
):
    creada = cliente.post(
        f"/ejercicios/{ejercicio_compartido_id}/notas",
        json={"nota": "Mía", "usuario_id": otro_usuario_id},
    ).json()

    assert creada["usuario_id"] == USUARIO_SEMBRADO_ID


def test_editar_una_nota_no_permite_cambiarle_el_dueno_ni_el_ejercicio(
    cliente, grupo_muscular_id, otro_usuario_id
):
    """`nota` es el único campo editable: ni el dueño ni el ejercicio al que
    pertenece se pueden mover desde el body.
    """
    ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Remo", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    otro_ejercicio_id = cliente.post(
        "/ejercicios", json={"nombre": "Jalón", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    nota_id = cliente.post(f"/ejercicios/{ejercicio_id}/notas", json={"nota": "Original"}).json()[
        "id"
    ]

    editada = cliente.put(
        f"/ejercicios/{ejercicio_id}/notas/{nota_id}",
        json={
            "nota": "Editada",
            "usuario_id": otro_usuario_id,
            "ejercicio_id": otro_ejercicio_id,
        },
    ).json()

    assert editada["nota"] == "Editada"
    assert editada["usuario_id"] == USUARIO_SEMBRADO_ID
    assert editada["ejercicio_id"] == ejercicio_id


# --- Entrenamientos y series ---------------------------------------------
#
# Las series se protegen protegiendo su entrenamiento: basta con que el dueño se
# compruebe ahí, pero hay que ver que se comprueba en cada endpoint.


@pytest.fixture
def entrenamiento_ajeno(sesion_bd, otro_usuario_id, ejercicio_predefinido_id) -> dict:
    """Un entrenamiento de otro usuario, con una serie de un ejercicio compartido."""
    entrenamiento = Entrenamiento(usuario_id=otro_usuario_id, fecha=date(2026, 9, 1))
    sesion_bd.add(entrenamiento)
    sesion_bd.flush()
    serie = Serie(
        entrenamiento_id=entrenamiento.id,
        ejercicio_id=ejercicio_predefinido_id,
        numero_serie=1,
        peso=100,
        repeticiones=5,
    )
    sesion_bd.add(serie)
    sesion_bd.commit()
    return {"id": entrenamiento.id, "serie_id": serie.id, "ejercicio_id": ejercicio_predefinido_id}


def test_el_listado_no_incluye_entrenamientos_de_otro_usuario(cliente, entrenamiento_ajeno):
    assert cliente.get("/entrenamientos").json() == []


def test_no_se_puede_ver_editar_ni_borrar_un_entrenamiento_ajeno(cliente, entrenamiento_ajeno):
    ruta = f"/entrenamientos/{entrenamiento_ajeno['id']}"

    # 404 y no 403 al leer, como el resto de los GET: no delata que el id existe.
    assert cliente.get(ruta).status_code == 404
    assert cliente.put(ruta, json={"fecha": "2026-09-02"}).status_code == 403
    assert cliente.post(f"{ruta}/terminar").status_code == 403
    assert cliente.delete(ruta).status_code == 403


def test_no_se_pueden_tocar_las_series_de_un_entrenamiento_ajeno(cliente, entrenamiento_ajeno):
    ruta = f"/entrenamientos/{entrenamiento_ajeno['id']}/series"
    serie = {
        "ejercicio_id": entrenamiento_ajeno["ejercicio_id"],
        "numero_serie": 2,
        "peso": 20,
        "repeticiones": 10,
    }

    assert cliente.post(ruta, json=serie).status_code == 403
    assert cliente.put(f"{ruta}/{entrenamiento_ajeno['serie_id']}", json=serie).status_code == 403
    assert cliente.delete(f"{ruta}/{entrenamiento_ajeno['serie_id']}").status_code == 403


def test_una_serie_ajena_no_se_alcanza_por_un_entrenamiento_propio(
    cliente, sesion_bd, entrenamiento_ajeno
):
    """El dueño se comprueba en el entrenamiento de la ruta; la serie, además,
    tiene que ser de ese entrenamiento. Si no, un id de serie ajeno se colaría.
    """
    propio = cliente.post("/entrenamientos", json={"fecha": "2026-09-03"}).json()["id"]

    respuesta = cliente.delete(f"/entrenamientos/{propio}/series/{entrenamiento_ajeno['serie_id']}")

    assert respuesta.status_code == 404
    assert sesion_bd.get(Serie, entrenamiento_ajeno["serie_id"]) is not None


def test_no_se_puede_empezar_un_entrenamiento_con_una_rutina_ajena(cliente, rutina_ajena_id):
    respuesta = cliente.post(
        "/entrenamientos", json={"rutina_id": rutina_ajena_id, "fecha": "2026-09-03"}
    )

    assert respuesta.status_code == 404


# --- Programas y plan ----------------------------------------------------
#
# Lo que más riesgo tiene aquí no es leer datos ajenos, sino las operaciones que
# tocan varias filas a la vez sin un id concreto (cerrar "el" periodo abierto,
# borrar las excepciones "de hoy en adelante"): si una pierde el filtro por
# usuario, arrasa con las de todos.


@pytest.fixture
def programa_ajeno_activo(sesion_bd, otro_usuario_id, rutina_ajena_id) -> dict:
    """Un programa de otro usuario, activo desde hace una semana, con un día y un
    día planificado a mano mañana.
    """
    programa = Programa(usuario_id=otro_usuario_id, nombre="De otro")
    sesion_bd.add(programa)
    sesion_bd.flush()
    sesion_bd.add(ProgramaDia(programa_id=programa.id, dia_semana=1, rutina_id=rutina_ajena_id))
    sesion_bd.add(
        ProgramaPeriodo(
            programa_id=programa.id, usuario_id=otro_usuario_id, desde=hoy() - timedelta(days=7)
        )
    )
    sesion_bd.add(
        ExcepcionDelPlan(
            usuario_id=otro_usuario_id,
            fecha=hoy() + timedelta(days=1),
            rutina_id=rutina_ajena_id,
        )
    )
    sesion_bd.commit()
    return {"id": programa.id, "usuario_id": otro_usuario_id}


def _estado_ajeno(sesion_bd, programa) -> tuple:
    sesion_bd.expire_all()
    abiertos = sesion_bd.scalars(
        select(ProgramaPeriodo.hasta).where(ProgramaPeriodo.programa_id == programa["id"])
    ).all()
    excepciones = sesion_bd.scalars(
        select(ExcepcionDelPlan.fecha).where(ExcepcionDelPlan.usuario_id == programa["usuario_id"])
    ).all()
    dias = sesion_bd.scalars(
        select(ProgramaDia.dia_semana).where(ProgramaDia.programa_id == programa["id"])
    ).all()
    return abiertos, excepciones, dias, sesion_bd.get(Programa, programa["id"]).nombre


def test_activar_un_programa_propio_no_desactiva_el_de_otro_usuario(
    cliente, sesion_bd, programa_ajeno_activo
):
    antes = _estado_ajeno(sesion_bd, programa_ajeno_activo)
    propio = cliente.post("/programas", json={"nombre": "Mío"}).json()["id"]

    respuesta = cliente.post(f"/programas/{propio}/activar", json={"quitar_excepciones": True})

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is True
    # Ni su periodo abierto se cierra ni su día planificado se borra.
    assert _estado_ajeno(sesion_bd, programa_ajeno_activo) == antes
    assert antes[0] == [None]


def test_restablecer_mis_dias_no_borra_los_de_otro_usuario(
    cliente, sesion_bd, programa_ajeno_activo
):
    antes = _estado_ajeno(sesion_bd, programa_ajeno_activo)

    respuesta = cliente.delete(
        "/plan/excepciones",
        params={"desde": hoy().isoformat(), "hasta": (hoy() + timedelta(days=6)).isoformat()},
    )

    assert respuesta.status_code == 204
    assert _estado_ajeno(sesion_bd, programa_ajeno_activo) == antes


def test_ningun_verbo_de_un_programa_ajeno_lo_modifica(cliente, sesion_bd, programa_ajeno_activo):
    """El clásico: un GET protegido y un verbo de escritura que no. Cada uno por
    separado, y comprobando que de verdad no ha cambiado nada.
    """
    antes = _estado_ajeno(sesion_bd, programa_ajeno_activo)
    propia = cliente.post("/rutinas", json={"nombre": "Mía"}).json()["id"]
    ruta = f"/programas/{programa_ajeno_activo['id']}"

    assert cliente.post(f"{ruta}/desactivar").status_code == 403
    assert cliente.post(f"{ruta}/mostrar").status_code == 403
    assert cliente.put(f"{ruta}/dias/2", json={"rutina_id": propia}).status_code == 403
    assert cliente.delete(f"{ruta}/dias/1").status_code == 403
    assert cliente.delete(f"{ruta}?modo=ocultar").status_code == 403
    assert cliente.delete(f"{ruta}?modo=definitivo").status_code == 403
    assert _estado_ajeno(sesion_bd, programa_ajeno_activo) == antes


def test_no_se_puede_poner_una_rutina_ajena_en_un_dia_de_un_programa_propio(
    cliente, rutina_ajena_id
):
    propio = cliente.post("/programas", json={"nombre": "Mío"}).json()["id"]

    respuesta = cliente.put(f"/programas/{propio}/dias/1", json={"rutina_id": rutina_ajena_id})

    assert respuesta.status_code == 404
    assert cliente.get(f"/programas/{propio}").json()["dias"] == []


def test_no_se_puede_planificar_un_dia_con_una_rutina_ajena(cliente, rutina_ajena_id):
    respuesta = cliente.put(
        f"/plan/excepciones/{hoy().isoformat()}", json={"rutina_id": rutina_ajena_id}
    )

    assert respuesta.status_code == 404
    assert cliente.get("/plan/excepciones").json() == []


def test_el_plan_de_otro_usuario_no_se_cuela_al_intercambiar(cliente, programa_ajeno_activo):
    """Intercambiar lee qué toca cada día: si leyera el plan de otro, me pondría su
    rutina (el lunes de su programa, o su día planificado de mañana).
    """
    manana = hoy() + timedelta(days=1)
    lunes = hoy() + timedelta(days=(7 - hoy().isoweekday()) % 7 + 1)

    for fecha in (manana, lunes):
        respuesta = cliente.post(
            "/plan/intercambiar",
            json={"fecha_a": hoy().isoformat(), "fecha_b": fecha.isoformat()},
        )
        assert respuesta.status_code == 200
        assert [dia["rutina"] for dia in respuesta.json()] == [None, None]
