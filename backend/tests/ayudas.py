"""Ayudas que comparten los tests para montar sus escenarios.

Las `crear_*` crean un ejercicio, una rutina o un hueco por la API, siempre nuevos.

Toda sesión es de una rutina y toda serie va en un hueco de esa rutina, así que
para apuntar una serie hace falta antes una rutina con su hueco. `entrenar`,
`serie_en` y compañía lo montan a demanda y sin repetirlo: si la rutina o el hueco
ya existen, los usan.

Ojo con lo que se monta a demanda: si el ejercicio no es el principal de ningún
hueco visible de la rutina, `hueco_para` le añade uno, y eso cambia lo que la
rutina tiene. Un test que cuente huecos o ejercicios de una rutina debe pasar el
`slot_id` explícito.
"""

NOMBRE_DE_PRUEBA = "Rutina de prueba"


# --- Crear lo básico por la API -------------------------------------------
# Siempre crean uno nuevo (aunque ya exista otro con ese nombre) y fallan si la API
# no da 201: un test que monta su escenario con ellas no puede seguir con un id
# que no existe.


def crear_ejercicio(cliente, grupo_muscular_id, nombre="Press banca", tipo=None) -> int:
    """Un ejercicio propio nuevo; devuelve su id. Sin `tipo`, el de la API por
    defecto (peso y repeticiones).
    """
    cuerpo = {"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    if tipo is not None:
        cuerpo["tipo_registro"] = tipo
    respuesta = cliente.post("/ejercicios", json=cuerpo)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def crear_rutina(cliente, nombre="Push") -> int:
    """Una rutina nueva, sin huecos; devuelve su id."""
    respuesta = cliente.post("/rutinas", json={"nombre": nombre})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


# --- El objetivo de cada ejercicio en un hueco ------------------------------
# Va en repeticiones o en segundos según la familia del tipo del ejercicio: los de
# tiempo, en segundos; los demás, en repeticiones (`app/medidas.py`).

CAMPOS_DEL_OBJETIVO = (
    "series_objetivo",
    "reps_min",
    "reps_max",
    "duracion_min_s",
    "duracion_max_s",
)
DURACION_POR_DEFECTO = (30, 60)


def objetivo(series=4, reps=(6, 10), duracion=None) -> dict:
    """Los cinco campos del objetivo: con `duracion`, en segundos; si no, en repeticiones."""
    if duracion is not None:
        return {
            "series_objetivo": series,
            "reps_min": None,
            "reps_max": None,
            "duracion_min_s": duracion[0],
            "duracion_max_s": duracion[1],
        }
    return {
        "series_objetivo": series,
        "reps_min": reps[0],
        "reps_max": reps[1],
        "duracion_min_s": None,
        "duracion_max_s": None,
    }


def objetivo_de(fila: dict) -> dict:
    """Los cinco campos del objetivo de un hueco o de una alternativa de la API."""
    return {campo: fila[campo] for campo in CAMPOS_DEL_OBJETIVO}


def alternativa(ejercicio_id, series=3, reps=(6, 10), duracion=None) -> dict:
    """Una alternativa para el cuerpo de un hueco, con su objetivo."""
    return {"ejercicio_id": ejercicio_id, **objetivo(series, reps, duracion)}


def es_de_tiempo(cliente, ejercicio_id) -> bool:
    """Si el objetivo de ese ejercicio va en segundos. Uno que no existe, no: así el
    test que lo usa a propósito recibe el 404 de la API y no un fallo de aquí.
    """
    respuesta = cliente.get(f"/ejercicios/{ejercicio_id}")
    return respuesta.status_code == 200 and respuesta.json()["tipo_registro"] == "tiempo"


def crear_hueco(
    cliente, rutina_id, ejercicio_id, orden=None, series=4, reps=(6, 10), duracion=None
) -> int:
    """Un hueco nuevo en la rutina, con ese ejercicio de principal y sin comodines.
    Sin `orden`, el backend lo pone al final. El objetivo va en repeticiones, salvo
    que se pase `duracion` o el ejercicio sea de tiempo (entonces, en segundos).
    Devuelve su id.
    """
    if duracion is None and es_de_tiempo(cliente, ejercicio_id):
        duracion = DURACION_POR_DEFECTO
    cuerpo = {"ejercicio_principal_id": ejercicio_id, **objetivo(series, reps, duracion)}
    if orden is not None:
        cuerpo["orden"] = orden
    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots", json=cuerpo)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def cambiar_alternativas(cliente, rutina_id, slot_id, alternativas):
    """PUT del hueco con esa lista de alternativas (comodines) y el resto de sus
    campos tal cual: la lista sustituye a la que tenía. Es la única forma de
    cambiarlas en un hueco que ya existe. Devuelve la respuesta entera, para mirar
    el código; para montar datos, `poner_alternativas`.

    Cada alternativa es un cuerpo entero (`alternativa(...)`) o solo un id de
    ejercicio. Con solo el id: si ya es alternativa del hueco, conserva su objetivo;
    si no, lleva el del principal cuando es de su misma unidad (repeticiones o
    segundos), y uno por defecto cuando no.
    """
    [hueco] = [
        h for h in cliente.get(f"/rutinas/{rutina_id}").json()["slots"] if h["id"] == slot_id
    ]
    actuales = {a["ejercicio"]["id"]: objetivo_de(a) for a in hueco["alternativas"]}
    principal_en_segundos = hueco["duracion_min_s"] is not None

    def cuerpo_de(elegida):
        if isinstance(elegida, dict):
            return elegida
        if elegida in actuales:
            return {"ejercicio_id": elegida, **actuales[elegida]}
        en_segundos = es_de_tiempo(cliente, elegida)
        if en_segundos == principal_en_segundos:
            return {"ejercicio_id": elegida, **objetivo_de(hueco)}
        return alternativa(elegida, duracion=DURACION_POR_DEFECTO if en_segundos else None)

    return cliente.put(
        f"/rutinas/{rutina_id}/slots/{slot_id}",
        json={
            "ejercicio_principal_id": hueco["ejercicio_principal"]["id"],
            "orden": hueco["orden"],
            **objetivo_de(hueco),
            "alternativas": [cuerpo_de(elegida) for elegida in alternativas],
        },
    )


def poner_alternativas(cliente, rutina_id, slot_id, alternativas) -> dict:
    """Deja en el hueco justo esas alternativas, en ese orden (`cambiar_alternativas`).
    Falla si la API no da 200; devuelve el hueco.
    """
    respuesta = cambiar_alternativas(cliente, rutina_id, slot_id, alternativas)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def ids_de_alternativas(hueco: dict) -> list[int]:
    """Los ids de ejercicio de las alternativas de un hueco de la API, en su orden."""
    return [a["ejercicio"]["id"] for a in hueco["alternativas"]]


# --- Lo que se busca o se crea a demanda ------------------------------------


def rutina_de_prueba(cliente, nombre=NOMBRE_DE_PRUEBA) -> int:
    """El id de la rutina con ese nombre; la crea si todavía no existe."""
    for rutina in cliente.get("/rutinas").json():
        if rutina["nombre"] == nombre:
            return rutina["id"]
    respuesta = cliente.post("/rutinas", json={"nombre": nombre})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def ejercicio_de_prueba(cliente, grupo_muscular_id, nombre) -> int:
    """El id del ejercicio propio con ese nombre; lo crea si todavía no existe."""
    for ejercicio in cliente.get("/ejercicios").json():
        if ejercicio["nombre"] == nombre and not ejercicio["es_predefinido"]:
            return ejercicio["id"]
    respuesta = cliente.post(
        "/ejercicios", json={"nombre": nombre, "grupo_muscular_id": grupo_muscular_id}
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def entrenar(cliente, fecha, rutina_id=None, **campos):
    """POST /entrenamientos de la rutina que se diga o, sin ella, de la rutina de
    prueba (no hay forma de mandar `rutina_id` nulo con esta función: para eso, el
    POST a mano). Devuelve la respuesta entera, para mirar el código.
    """
    cuerpo = {
        "rutina_id": rutina_id if rutina_id is not None else rutina_de_prueba(cliente),
        "fecha": fecha if isinstance(fecha, str) else fecha.isoformat(),
        **campos,
    }
    return cliente.post("/entrenamientos", json=cuerpo)


def hueco_para(cliente, rutina_id, ejercicio_id) -> int:
    """El hueco visible de la rutina cuyo ejercicio principal es ese; lo añade si
    no hay ninguno.

    Si el único que hay está oculto, falla en vez de elegirlo (la serie daría un
    404 que parecería del test) o de añadir otro a escondidas: ese test tiene que
    decir el hueco que quiere.
    """
    huecos = cliente.get(f"/rutinas/{rutina_id}").json()["slots"]
    del_ejercicio = [h for h in huecos if h["ejercicio_principal"]["id"] == ejercicio_id]
    for hueco in del_ejercicio:
        if hueco["oculto_desde"] is None:
            return hueco["id"]
    assert not del_ejercicio, (
        f"El hueco del ejercicio {ejercicio_id} en la rutina {rutina_id} está oculto: "
        "pasa el slot_id explícito."
    )
    duracion = DURACION_POR_DEFECTO if es_de_tiempo(cliente, ejercicio_id) else None
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": max((h["orden"] for h in huecos), default=0) + 1,
            **objetivo(series=3, reps=(6, 12), duracion=duracion),
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def cuerpo_de_serie(
    cliente, entrenamiento_id, ejercicio_id, numero=1, peso=60, repeticiones=8, **campos
):
    """El cuerpo de una serie en el hueco de la rutina de esa sesión.

    Con `slot_id` en `campos` se usa ese tal cual y no se busca ni se crea nada:
    así se puede apuntar a un hueco de comodín, de otra rutina u oculto sin que la
    rutina gane un hueco por el camino.
    """
    if "slot_id" not in campos:
        rutina_id = cliente.get(f"/entrenamientos/{entrenamiento_id}").json()["rutina_id"]
        campos["slot_id"] = hueco_para(cliente, rutina_id, ejercicio_id)
    return {
        "ejercicio_id": ejercicio_id,
        "numero_serie": numero,
        "peso": peso,
        "repeticiones": repeticiones,
        **campos,
    }


def serie_en(cliente, entrenamiento_id, ejercicio_id, **campos):
    """POST de una serie en esa sesión; devuelve la respuesta entera."""
    cuerpo = cuerpo_de_serie(cliente, entrenamiento_id, ejercicio_id, **campos)
    return cliente.post(f"/entrenamientos/{entrenamiento_id}/series", json=cuerpo)


# --- Lo mismo, directamente en la base ------------------------------------
# Para montar lo que la API no deja crear (por ejemplo, dos sesiones el mismo día).


def rutina_en_bd(sesion_bd, nombre=NOMBRE_DE_PRUEBA) -> int:
    """Una rutina creada directamente en la base."""
    from app.models import Rutina

    rutina = Rutina(nombre=nombre)
    sesion_bd.add(rutina)
    sesion_bd.flush()
    return rutina.id


def hueco_en_bd(sesion_bd, rutina_id, ejercicio_id) -> int:
    """Un hueco de esa rutina con ese ejercicio de principal, creado en la base,
    detrás de los que ya tenga (el orden es único dentro de la rutina).
    """
    from sqlalchemy import func, select

    from app.models import RutinaSlot

    ultimo = sesion_bd.scalar(
        select(func.max(RutinaSlot.orden)).where(RutinaSlot.rutina_id == rutina_id)
    )
    hueco = RutinaSlot(
        rutina_id=rutina_id,
        ejercicio_principal_id=ejercicio_id,
        orden=(ultimo or 0) + 1,
        series_objetivo=3,
        reps_min=5,
        reps_max=8,
    )
    sesion_bd.add(hueco)
    sesion_bd.flush()
    return hueco.id


# --- Contar consultas -----------------------------------------------------


def consultas_de(peticion) -> int:
    """Cuántas consultas manda a la base `peticion()` (una función sin argumentos
    que hace la llamada a la API). Para comprobar que un listado hace las mismas
    con un elemento que con muchos, y no una por elemento.
    """
    from sqlalchemy import event

    from app.database import engine

    contador = []

    def contar(*_):
        contador.append(1)

    event.listen(engine, "before_cursor_execute", contar)
    try:
        respuesta = peticion()
    finally:
        event.remove(engine, "before_cursor_execute", contar)
    assert respuesta.status_code == 200, respuesta.text
    return len(contador)
