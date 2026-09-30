"""La semana de ejemplo que comparten los tests del seguimiento del plan.

Hoy es el **miércoles 16 de septiembre de 2026**, y el programa Push (lunes), Pull
(miércoles) y Leg (viernes) está activo desde el lunes 31 de agosto. La fixture
`ppl` de `conftest.py` lo monta y congela el reloj en ese día.
"""

from datetime import date

LUNES_7 = date(2026, 9, 7)
DOMINGO_13 = date(2026, 9, 13)
LUNES_14 = date(2026, 9, 14)
MARTES_15 = date(2026, 9, 15)
HOY = date(2026, 9, 16)  # miércoles
JUEVES_17 = date(2026, 9, 17)
VIERNES_18 = date(2026, 9, 18)
LUNES_21 = date(2026, 9, 21)


def sesion(cliente, fecha, rutina_id, cubre_fecha=None):
    """POST /entrenamientos; devuelve la respuesta entera, para mirar el código."""
    cuerpo = {"fecha": fecha.isoformat(), "rutina_id": rutina_id}
    if cubre_fecha is not None:
        cuerpo["cubre_fecha"] = cubre_fecha.isoformat()
    return cliente.post("/entrenamientos", json=cuerpo)


def con_una_serie(cliente, grupo_muscular_id, entrenamiento_id) -> None:
    """Una sesión sin series que ya no está en curso cuenta como cancelada: para
    que cuente, tiene que tener algo apuntado.
    """
    ejercicio = cliente.post(
        "/ejercicios", json={"nombre": "Press banca", "grupo_muscular_id": grupo_muscular_id}
    ).json()["id"]
    respuesta = cliente.post(
        f"/entrenamientos/{entrenamiento_id}/series",
        json={"ejercicio_id": ejercicio, "numero_serie": 1, "peso": 60, "repeticiones": 10},
    )
    assert respuesta.status_code == 201, respuesta.text


def hecha(cliente, grupo_muscular_id, fecha, rutina_id, cubre_fecha=None) -> int:
    """Una sesión con una serie apuntada: sin series, ya fuera de curso, sería una
    sesión cancelada. Devuelve su id.
    """
    respuesta = sesion(cliente, fecha, rutina_id, cubre_fecha)
    assert respuesta.status_code == 201, respuesta.text
    entrenamiento_id = respuesta.json()["id"]
    con_una_serie(cliente, grupo_muscular_id, entrenamiento_id)
    return entrenamiento_id
