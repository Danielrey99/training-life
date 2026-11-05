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

from datetime import date

from app.fechas import fecha_en_texto

NOMBRE_DE_PRUEBA = "Rutina de prueba"

# El 409 del DELETE sin `modo` de lo que tiene historial: una frase fija que solo
# pide elegir `modo`. Lo que se perdería lo cuenta su aviso de borrado.
PIDE_MODO = {
    "ejercicio": "Este ejercicio está en uso. Repite la petición con ?modo=ocultar (conserva "
    "todo) o ?modo=definitivo (lo borra con todo lo que lo usa, sin poder deshacerlo).",
    "rutina": "Esta rutina tiene historial. Repite la petición con ?modo=ocultar (conserva "
    "todo) o ?modo=definitivo (la borra con todo lo que la usa, sin poder deshacerlo).",
    "hueco": "Este ejercicio de la rutina tiene series apuntadas. Repite la petición con "
    "?modo=ocultar (conserva todo) o ?modo=definitivo (lo borra con sus series, sin poder "
    "deshacerlo).",
    "programa": "Este programa ha estado activo. Repite la petición con ?modo=ocultar "
    "(conserva todo) o ?modo=definitivo (lo borra con sus días y periodos, sin poder "
    "deshacerlo).",
}


# Los 404 con las palabras de la app. Lo que falta por la ruta dice «ya no existe»; lo
# elegido en el cuerpo se nombra si existe (oculto), y si no, no se puede: solo hay id.

EJERCICIO_YA_NO_EXISTE = "Este ejercicio ya no existe. Puede que lo hayas borrado."
ELEGIDO_YA_NO_EXISTE = "Uno de los ejercicios que has elegido ya no existe. Elige otro en su lugar."
SERIE_YA_NO_EXISTE = "Esa serie ya no existe. Puede que la hayas borrado."
SERIE_DEL_DIA_YA_NO_EXISTE = (
    "Una de las series de este día ya no existe. Pulsa Cancelar y vuelve a editar el día."
)


def ejercicio_oculto(nombre) -> str:
    """El 404 de elegir un ejercicio oculto."""
    return (
        f"«{nombre}» está oculto, así que no se puede elegir. Muéstralo desde la pestaña"
        " Ejercicios o elige otro."
    )


def nombre_repetido(mensaje) -> dict:
    """El `detail` del 409 de un nombre repetido: marcado con `campo` para enseñarlo bajo
    el nombre. El de editar algo oculto, en cambio, es un texto sin más.
    """
    return {"mensaje": mensaje, "campo": "nombre"}


# Los 422 de fechas que salen en más de un endpoint, con el texto exacto: comparar
# solo un trozo dejaría pasar una frase rota. Las fechas van como las escribe la web
# («martes 15 de septiembre»), con `fecha_en_texto`, que tiene sus propios tests con
# el texto literal en `test_fechas.py`.


def en_texto(fecha) -> str:
    """`fecha_en_texto` también para una fecha escrita como «2026-09-14»."""
    return fecha_en_texto(date.fromisoformat(fecha) if isinstance(fecha, str) else fecha)


def rango_invertido(desde, hasta) -> str:
    return f"Las fechas están al revés. El {en_texto(desde)} va después del {en_texto(hasta)}."


def todavia_no_ha_llegado(fecha) -> str:
    return f"El {en_texto(fecha)} todavía no ha llegado. Solo se apuntan días de hoy hacia atrás."


def fuera_de_plazo(cubre, desde, hasta) -> str:
    return (
        f"Lo del {en_texto(cubre)} solo se puede entrenar entre el {en_texto(desde)}"
        f" y el {en_texto(hasta)}. Se adelanta dentro de su semana y se recupera hasta el"
        " día antes del mismo día de la semana siguiente."
    )


# Al mover la fecha de un día del historial, los avisos son los que la web enseña bajo
# la fecha: van marcados con `campo` y hablan de la sesión que se mueve.


def bajo_la_fecha(mensaje) -> dict:
    """El `detail` de un fallo al mover la fecha de un día del historial."""
    return {"mensaje": mensaje, "campo": "fecha"}


def solo_puede_ir(rutina, contado, hacia, limite) -> str:
    """Fuera del plazo del día que cuenta: hasta (o desde) dónde puede ir."""
    return (
        f"Este {rutina} cuenta como el del {en_texto(contado)}, así que solo puede ir"
        f" {hacia} el {en_texto(limite)}."
    )


def no_seguias_el_programa(rutina, contado, nueva) -> str:
    """Dentro del plazo, pero en un día de otro programa (o sin programa)."""
    return (
        f"Este {rutina} cuenta como el del {en_texto(contado)}, y el {en_texto(nueva)} no"
        " seguías el mismo programa que ese día. Solo se puede mover a un día en que lo"
        " siguieras."
    )


# --- Crear lo básico por la API -------------------------------------------
# Siempre crean uno nuevo y fallan si la API no da 201: un test que monta su
# escenario con ellas no puede seguir con un id que no existe. Dos ejercicios no
# pueden llamarse igual, ni uno propio como un predefinido: cada test que cree más de
# uno les pone nombre.


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
    """Si el objetivo de ese ejercicio va en segundos (los de tiempo y los de cardio).
    Uno que no existe, no: así el test que lo usa a propósito recibe el 404 de la API
    y no un fallo de aquí.
    """
    respuesta = cliente.get(f"/ejercicios/{ejercicio_id}")
    return respuesta.status_code == 200 and respuesta.json()["tipo_registro"] in (
        "tiempo",
        "cardio",
    )


def cuerpo_de_hueco(ejercicio_id, orden=1, series=4, reps=(6, 10)) -> dict:
    """El cuerpo de un hueco de repeticiones sin comodines, con `orden` (el PUT lo exige)."""
    return {"ejercicio_principal_id": ejercicio_id, "orden": orden, **objetivo(series, reps)}


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


def ocultar_hueco(cliente, rutina_id, slot_id) -> None:
    """Oculta el hueco (`?modo=ocultar`); falla si la API no da 204."""
    respuesta = cliente.delete(f"/rutinas/{rutina_id}/slots/{slot_id}?modo=ocultar")
    assert respuesta.status_code == 204, respuesta.text


def ocultar_ejercicio(cliente, ejercicio_id) -> None:
    """Oculta el ejercicio (`?modo=ocultar`); falla si la API no da 204."""
    respuesta = cliente.delete(f"/ejercicios/{ejercicio_id}?modo=ocultar")
    assert respuesta.status_code == 204, respuesta.text


# --- Programas -------------------------------------------------------------


def crear_programa(cliente, nombre="Push Pull Leg", dias=(), activar=False) -> dict:
    """Un programa nuevo con esos días, cada uno `(dia_semana, rutina_id)`; activo
    desde hoy si se pide. Devuelve el programa de la API.
    """
    respuesta = cliente.post(
        "/programas",
        json={
            "nombre": nombre,
            "activar": activar,
            "dias": [{"dia_semana": dia, "rutina_id": rutina} for dia, rutina in dias],
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def cambiar_dias(cliente, programa_id, cambios, nombre=None):
    """El *Guardar* de la semana, como lo manda la web: `PUT /programas/{id}` con el
    nombre y la semana entera, que es la de ahora con los `cambios` (de día a rutina;
    None, descanso). Devuelve la respuesta entera, para mirar el código.
    """
    programa = cliente.get(f"/programas/{programa_id}")
    assert programa.status_code == 200, programa.text
    programa = programa.json()
    dias = {dia["dia_semana"]: dia["rutina"]["id"] for dia in programa["dias"]} | cambios
    return cliente.put(
        f"/programas/{programa_id}",
        json={
            "nombre": programa["nombre"] if nombre is None else nombre,
            "dias": [
                {"dia_semana": dia, "rutina_id": rutina}
                for dia, rutina in sorted(dias.items())
                if rutina is not None
            ],
        },
    )


def importar_rutinas_y_programas(cliente, rutinas=(), programas=()) -> tuple[list, list]:
    """Sustituye los datos por un archivo con estas rutinas y programas (sin huecos ni
    días), cada uno un nombre o un (nombre, oculto_desde en ISO). Es la única forma de
    tener dos con el mismo nombre: la API no deja crearlos, importar no lo mira.

    Devuelve los ids nuevos de cada lista, en el orden del archivo: se insertan en ese
    orden, así que es el de sus ids.
    """
    marca = {"created_at": "2026-09-01T10:00:00+00:00", "updated_at": "2026-09-01T10:00:00+00:00"}

    def filas(lista):
        return [x if isinstance(x, tuple) else (x, None) for x in lista]

    archivo = {
        "formato": "training-life",
        "version": 3,
        "exportado_en": marca["created_at"],
        "rutinas": [
            {"id": n + 1, "nombre": nombre, "oculto_desde": oculto, **marca}
            for n, (nombre, oculto) in enumerate(filas(rutinas))
        ],
        "programas": [
            {"nombre": nombre, "oculto_desde": oculto, **marca}
            for nombre, oculto in filas(programas)
        ],
    }
    respuesta = cliente.post("/datos/importar", json=archivo)
    assert respuesta.status_code == 200, respuesta.text

    def ids(ruta, parametro):
        todos = cliente.get(ruta).json() + cliente.get(ruta, params={parametro: True}).json()
        return sorted(x["id"] for x in todos)

    return ids("/rutinas", "ocultas"), ids("/programas", "ocultos")


# --- El plan: días cambiados a mano ---------------------------------------


def planificar(cliente, fecha, rutina_id):
    """PUT de la excepción de ese día (`rutina_id` nulo: descanso); devuelve la
    respuesta entera, para mirar el código. Para montar datos, `dejar_planificado`.
    """
    return cliente.put(f"/plan/excepciones/{fecha.isoformat()}", json={"rutina_id": rutina_id})


def dejar_planificado(cliente, fecha, rutina_id) -> None:
    """Como `planificar`, pero falla si la API no da 200."""
    respuesta = planificar(cliente, fecha, rutina_id)
    assert respuesta.status_code == 200, respuesta.text


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
        f"El hueco del ejercicio {ejercicio_id} en la rutina {rutina_id} está oculto, así que "
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


def sesiones_en_curso(cliente) -> list[dict]:
    """Las sesiones del listado que dicen estar en curso (de hoy y sin terminar).

    El listado tuvo un filtro `?en_curso=true` que se quitó: FastAPI ignora un
    parámetro desconocido, así que pedirlo devolvería todas sin dar error. Por
    eso se filtra aquí, por el campo `en_curso` de cada una.
    """
    respuesta = cliente.get("/entrenamientos")
    assert respuesta.status_code == 200, respuesta.text
    return [sesion for sesion in respuesta.json() if sesion["en_curso"]]


# --- Lo mismo, directamente en la base ------------------------------------
# Para montar lo que la API no deja crear (por ejemplo, dos sesiones el mismo día).


def rutina_en_bd(sesion_bd, nombre=NOMBRE_DE_PRUEBA) -> int:
    """Una rutina creada directamente en la base."""
    from app.models import Rutina

    rutina = Rutina(nombre=nombre)
    sesion_bd.add(rutina)
    sesion_bd.flush()
    return rutina.id


# --- Contar consultas -----------------------------------------------------


def cuantas_filas(sesion_bd, *modelos) -> tuple[int, ...]:
    """Cuántas filas tiene cada modelo en toda la base, también las ocultas: para ver
    que un fallo no ha dejado nada a medias.
    """
    from sqlalchemy import func, select

    sesion_bd.expire_all()
    return tuple(sesion_bd.scalar(select(func.count()).select_from(modelo)) for modelo in modelos)


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


# --- Lo que deja la siembra -----------------------------------------------


def lista_de_predefinidos() -> dict:
    """`shared/predefinidos.json`: los grupos y los ejercicios predefinidos que deja
    la siembra. Para contar los predefinidos sin fijar el número en cada test.
    """
    import json
    from pathlib import Path

    ruta = Path(__file__).resolve().parents[2] / "shared" / "predefinidos.json"
    return json.loads(ruta.read_text(encoding="utf-8"))
