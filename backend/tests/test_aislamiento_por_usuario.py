"""Un usuario no puede ver ni tocar los datos de otro.

Hoy la API trabaja con un único usuario hardcodeado (`app/auth.py`), así que los
datos ajenos se insertan directamente en la base: es la única forma de probar
esto antes de que exista JWT. Cuando llegue la autenticación real, estos tests
son la red que avisa si el aislamiento se rompe.
"""

import pytest
from sqlalchemy import select

from app.auth import USUARIO_SEMBRADO_ID
from app.models import Rutina, Usuario


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
    rutina = cliente.post(
        "/rutinas", json={"nombre": "Push", "usuario_id": otro_usuario_id}
    ).json()
    assert rutina["usuario_id"] == USUARIO_SEMBRADO_ID
