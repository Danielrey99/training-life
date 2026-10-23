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


def crear_hueco(cliente, rutina_id, ejercicio_id, orden=None, series=4, reps=(6, 10)) -> int:
    """Un hueco nuevo en la rutina, con ese ejercicio de principal y sin comodines.
    Sin `orden`, el backend lo pone al final. Devuelve su id.
    """
    cuerpo = {
        "ejercicio_principal_id": ejercicio_id,
        "series_objetivo": series,
        "reps_min": reps[0],
        "reps_max": reps[1],
    }
    if orden is not None:
        cuerpo["orden"] = orden
    respuesta = cliente.post(f"/rutinas/{rutina_id}/slots", json=cuerpo)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def cambiar_alternativas(cliente, rutina_id, slot_id, ids):
    """PUT del hueco con esa lista de alternativas (comodines) y el resto de sus
    campos tal cual: la lista sustituye a la que tenía. Es la única forma de
    cambiarlas en un hueco que ya existe. Devuelve la respuesta entera, para mirar
    el código; para montar datos, `poner_alternativas`.
    """
    [hueco] = [
        h for h in cliente.get(f"/rutinas/{rutina_id}").json()["slots"] if h["id"] == slot_id
    ]
    return cliente.put(
        f"/rutinas/{rutina_id}/slots/{slot_id}",
        json={
            "ejercicio_principal_id": hueco["ejercicio_principal"]["id"],
            "orden": hueco["orden"],
            "series_objetivo": hueco["series_objetivo"],
            "reps_min": hueco["reps_min"],
            "reps_max": hueco["reps_max"],
            "alternativa_ids": list(ids),
        },
    )


def poner_alternativas(cliente, rutina_id, slot_id, ids) -> dict:
    """Deja en el hueco justo esas alternativas, en ese orden (`cambiar_alternativas`).
    Falla si la API no da 200; devuelve el hueco.
    """
    respuesta = cambiar_alternativas(cliente, rutina_id, slot_id, ids)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


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
    respuesta = cliente.post(
        f"/rutinas/{rutina_id}/slots",
        json={
            "ejercicio_principal_id": ejercicio_id,
            "orden": max((h["orden"] for h in huecos), default=0) + 1,
            "series_objetivo": 3,
            "reps_min": 6,
            "reps_max": 12,
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
