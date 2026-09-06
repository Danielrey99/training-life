"""Un usuario no puede ver ni tocar los datos de otro.

Hoy la API trabaja con un único usuario hardcodeado (`app/auth.py`), así que los
datos ajenos se insertan directamente en la base: es la única forma de probar
esto antes de que exista JWT. Cuando llegue la autenticación real, estos tests
son la red que avisa si el aislamiento se rompe.
"""

import pytest
from sqlalchemy import select

from app.auth import USUARIO_SEMBRADO_ID
from app.models import Ejercicio, NotaUsuarioEjercicio, Rutina, Usuario


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
def ejercicio_compartido_id(sesion_bd, grupo_muscular_id) -> int:
    """Un ejercicio predefinido: visible para todos, de nadie en concreto.

    Se inserta a mano porque `POST /ejercicios` nunca crea predefinidos.
    """
    ejercicio = Ejercicio(
        nombre="Sentadilla (predefinida)",
        grupo_muscular_id=grupo_muscular_id,
        es_predefinido=True,
        usuario_id=None,
    )
    sesion_bd.add(ejercicio)
    sesion_bd.commit()
    return ejercicio.id


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
    la sesión tuviera cacheado."""
    sesion_bd.expire_all()
    return sesion_bd.scalar(
        select(NotaUsuarioEjercicio.nota).where(NotaUsuarioEjercicio.id == nota_id)
    )


def test_las_notas_de_otro_usuario_no_se_listan_aunque_el_ejercicio_sea_compartido(
    cliente, ejercicio_compartido_id, nota_ajena_id
):
    """Un ejercicio predefinido lo ven los dos usuarios, pero cada uno solo
    debe ver sus propias notas: son privadas, no comentarios públicos."""
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
    no se toca ni aunque el ejercicio de la ruta sí sea del usuario."""
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
    se llega a la parte de las notas."""
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
    pertenece se pueden mover desde el body."""
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
