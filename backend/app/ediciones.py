"""Las cuentas de *Guardar* en los modos de editar: qué cambia de lo guardado a lo
pedido, sin escribir nada.

Guardar la semana de un programa, una rutina o un día del historial es una sola
petición que se valida entera antes de escribir: o se guarda todo, o nada. Estas
funciones deciden qué cambia y si lo pedido cuadra; los routers cargan, las llaman,
convierten el resultado en su código HTTP y escriben.

Python puro, sin FastAPI ni SQLAlchemy, como `medidas.py`: el móvil las porta tal cual,
cada operación en una transacción de SQLite.
"""

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

from app.fechas import fecha_en_texto

# Lo que se compara de una serie para saber si cambió.
CAMPOS_DE_SERIE = (
    "ejercicio_id",
    "slot_id",
    "numero_serie",
    "peso",
    "repeticiones",
    "duracion_s",
    "distancia_m",
    "peso_corporal",
    "variante",
)


def dias_que_cambian(
    vigentes: Mapping[int, int], pedidos: Mapping[int, int]
) -> list[tuple[int, int | None]]:
    """Los días de la semana (1-7) cuya rutina cambia, con la nueva (None: descanso).

    `vigentes` y `pedidos` van de día a rutina y solo llevan los días con rutina: un
    día que falta es descanso. Un día que llega igual no cambia, aunque su rutina esté
    oculta: no se elige nada nuevo.
    """
    return [(dia, pedidos.get(dia)) for dia in range(1, 8) if pedidos.get(dia) != vigentes.get(dia)]


def reparto_del_orden(
    visibles: Mapping[int, int], slot_ids: Sequence[int]
) -> dict[int, int] | None:
    """El orden nuevo de cada hueco visible, de hueco a orden.

    Los visibles se reparten los `orden` que ya tenían, en el orden pedido, y los
    ocultos conservan el suyo: así no chocan, y al mostrarlos vuelven a su sitio.
    `None` si `slot_ids` no son exactamente los visibles, cada uno una vez; vacío si el
    orden pedido es el de ahora.
    """
    if sorted(slot_ids) != sorted(visibles):
        return None
    reparto = dict(zip(slot_ids, sorted(visibles.values()), strict=True))
    if all(visibles[slot_id] == orden for slot_id, orden in reparto.items()):
        return {}
    return reparto


def cambios_de_series(
    guardadas: Mapping[int, Mapping[str, Any]], pedidas: Sequence[Mapping[str, Any]]
) -> tuple[list[int], list[Mapping[str, Any]], list[Mapping[str, Any]], list[int]]:
    """Qué hacer con las series de un día para dejarlo como `pedidas`, que es su estado
    final completo.

    Devuelve `(a_borrar, a_cambiar, a_crear, ajenas)`: los ids guardados que no
    llegan; las pedidas con id cuyo contenido cambia; las pedidas sin id; y los ids
    pedidos que no son de este día. Una serie que llega igual no se toca: corregir lo
    que ya se apuntó no es elegir nada nuevo.
    """
    pedidos_ids = {serie["id"] for serie in pedidas if serie.get("id") is not None}
    a_borrar = [id_ for id_ in guardadas if id_ not in pedidos_ids]
    a_cambiar, a_crear, ajenas = [], [], []
    for serie in pedidas:
        id_ = serie.get("id")
        if id_ is None:
            a_crear.append(serie)
        elif id_ not in guardadas:
            ajenas.append(id_)
        elif any(serie[campo] != guardadas[id_][campo] for campo in CAMPOS_DE_SERIE):
            a_cambiar.append(serie)
    return a_borrar, a_cambiar, a_crear, ajenas


def mezcla_en_hueco(
    finales: Sequence[tuple[int, int]], tocados: set[int]
) -> tuple[int, int] | None:
    """Si en alguno de los huecos `tocados` quedan series de dos ejercicios, los dos
    primeros que se encuentran; si no, None.

    `finales` son los (hueco, ejercicio) de todas las series como quedarían. Solo se
    miran los huecos tocados: una sesión ya mezclada en la que solo se corrige un peso
    no se bloquea.
    """
    primero: dict[int, int] = {}
    for hueco, ejercicio in finales:
        if hueco not in tocados:
            continue
        if hueco not in primero:
            primero[hueco] = ejercicio
        elif primero[hueco] != ejercicio:
            return primero[hueco], ejercicio
    return None


def motivo_de_la_fecha(rutina: str, contado: date, nueva: date, lunes: date, ultimo: date) -> str:
    """Por qué una sesión no puede moverse a `nueva`, con las palabras de la app.

    La sesión cuenta como la de `contado`, que se entrena entre `lunes` y `ultimo` (su
    plazo). Fuera de él, dice hasta o desde dónde puede ir; dentro, el motivo solo puede
    ser que ese día se seguía otro programa.
    """
    if lunes <= nueva <= ultimo:
        return (
            f"Este {rutina} cuenta como el del {fecha_en_texto(contado)}, y el"
            f" {fecha_en_texto(nueva)} no seguías el mismo programa que ese día. Solo se puede"
            " mover a un día en que lo siguieras."
        )
    limite, hacia = (ultimo, "hasta") if nueva > contado else (lunes, "desde")
    return (
        f"Este {rutina} cuenta como el del {fecha_en_texto(contado)}, así que solo puede ir"
        f" {hacia} el {fecha_en_texto(limite)}."
    )
