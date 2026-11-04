"""La semana de ejemplo que comparten los tests del seguimiento del plan.

Hoy es el **miércoles 16 de septiembre de 2026**, y el programa Push (lunes), Pull
(miércoles) y Leg (viernes) está activo desde el lunes 31 de agosto. La fixture
`ppl` de `conftest.py` lo monta y congela el reloj en ese día.
"""

from datetime import date

from app.fechas import fecha_en_texto
from tests.ayudas import ejercicio_de_prueba, serie_en

# Los días de alrededor, con su día de la semana para leer los tests de un vistazo.
LUNES_31 = date(2026, 8, 31)
MARTES_1 = date(2026, 9, 1)
MIERCOLES_2 = date(2026, 9, 2)
VIERNES_4 = date(2026, 9, 4)
SABADO_5 = date(2026, 9, 5)
LUNES_7 = date(2026, 9, 7)
MARTES_8 = date(2026, 9, 8)
MIERCOLES_9 = date(2026, 9, 9)
JUEVES_10 = date(2026, 9, 10)
VIERNES_11 = date(2026, 9, 11)
SABADO_12 = date(2026, 9, 12)
DOMINGO_13 = date(2026, 9, 13)
LUNES_14 = date(2026, 9, 14)
MARTES_15 = date(2026, 9, 15)
HOY = date(2026, 9, 16)  # miércoles
JUEVES_17 = date(2026, 9, 17)
VIERNES_18 = date(2026, 9, 18)
SABADO_19 = date(2026, 9, 19)
DOMINGO_20 = date(2026, 9, 20)
LUNES_21 = date(2026, 9, 21)
MIERCOLES_23 = date(2026, 9, 23)
VIERNES_25 = date(2026, 9, 25)
DOMINGO_27 = date(2026, 9, 27)


def sesion(cliente, fecha, rutina_id, cubre_fecha=None):
    """POST /entrenamientos; devuelve la respuesta entera, para mirar el código."""
    cuerpo = {"fecha": fecha.isoformat(), "rutina_id": rutina_id}
    if cubre_fecha is not None:
        cuerpo["cubre_fecha"] = cubre_fecha.isoformat()
    return cliente.post("/entrenamientos", json=cuerpo)


def seguimiento(cliente, desde, hasta=None) -> dict:
    """`GET /plan/seguimiento` de los días pedidos (uno solo, sin `hasta`), por fecha."""
    respuesta = cliente.get(
        "/plan/seguimiento",
        params={"desde": desde.isoformat(), "hasta": (hasta or desde).isoformat()},
    )
    assert respuesta.status_code == 200, respuesta.text
    return {date.fromisoformat(dia["fecha"]): dia for dia in respuesta.json()}


def cubre(cliente, entrenamiento_id) -> str | None:
    """El día que cuenta la sesión (`cubre_fecha`), o `None` si no cuenta ninguno."""
    return cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["cubre_fecha"]


def con_una_serie(cliente, grupo_muscular_id, entrenamiento_id) -> None:
    """Una sesión sin series que ya no está en curso cuenta como cancelada: para
    que cuente, tiene que tener algo apuntado.
    """
    # En un hueco que la rutina ya tenga, para no cambiarle los ejercicios; si no tiene
    # ninguno, se le añade uno.
    rutina_id = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["rutina_id"]
    visibles = [
        hueco
        for hueco in cliente.get(f"/rutinas/{rutina_id}").json()["slots"]
        if hueco["oculto_desde"] is None
    ]
    if visibles:
        ejercicio = visibles[0]["ejercicio_principal"]["id"]
    else:
        # Reutilizado si ya existe: con dos rutinas sin huecos en el mismo test, las dos
        # usan el mismo ejercicio en vez de crear otro igual.
        ejercicio = ejercicio_de_prueba(cliente, grupo_muscular_id, "Press banca")
    respuesta = serie_en(cliente, entrenamiento_id, ejercicio, repeticiones=10)
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


def sin_dia_para_ella(fecha, cubre_fecha, rutina, entrenamiento_id, oculta=False) -> dict:
    """El 409 de replanificar cuando lo hecho por adelantado se queda sin ningún día
    de esta semana con su rutina: dice qué sesión es, para poder abrirla. Si la rutina
    está oculta, lo dice y pide mostrarla: ningún día puede tenerla mientras lo esté.
    """
    sin_dia = (
        f"La sesión del {fecha_en_texto(fecha)} cuenta como lo del"
        f" {fecha_en_texto(cubre_fecha)}, y con este cambio ya no queda ningún día de esta"
        f" semana con «{rutina}» para ella"
    )
    if oculta:
        mensaje = (
            f"{sin_dia}, porque «{rutina}» está oculta. Muestra «{rutina}» desde la pestaña"
            " Programas o borra antes esa sesión."
        )
    else:
        mensaje = f"{sin_dia}. Deja algún día con esa rutina o borra antes esa sesión."
    return {
        "mensaje": mensaje,
        "entrenamiento_id": entrenamiento_id,
        "fecha": fecha.isoformat(),
    }
