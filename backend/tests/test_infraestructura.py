"""Comprueba que el andamiaje de los tests está bien montado.

No prueba lógica de negocio: verifica que las migraciones se aplicaron sobre la
base de tests y que los datos sembrados están donde deben.
"""


def test_la_api_responde(cliente):
    respuesta = cliente.get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"status": "ok"}


def test_las_migraciones_sembraron_los_grupos_musculares(cliente):
    nombres = [grupo["nombre"] for grupo in cliente.get("/grupos-musculares").json()]
    assert len(nombres) == 17
    assert {"Pecho", "Trapecio", "Aductores", "Abductores"} <= set(nombres)


def test_cada_test_arranca_sin_ejercicios(cliente, grupo_muscular_id):
    """El TRUNCATE entre tests funciona: este crea uno y el siguiente no lo verá."""
    assert cliente.get("/ejercicios").json() == []
    cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    )
    assert len(cliente.get("/ejercicios").json()) == 1


def test_el_ejercicio_del_test_anterior_ya_no_esta(cliente):
    assert cliente.get("/ejercicios").json() == []
