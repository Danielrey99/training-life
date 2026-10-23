"""Qué medidas lleva una serie según cómo se apunta su ejercicio.

Cada ejercicio tiene un tipo (`Ejercicio.tipo_registro`) que se elige al crearlo y no
cambia, y el tipo decide qué medidas lleva cada serie suya:

| tipo        | peso                              | repeticiones | duración    | peso corporal |
|-------------|-----------------------------------|--------------|-------------|---------------|
| `peso_reps` | obligatorio, 0 o más              | obligatorio  | no          | no            |
| `corporal`  | obligatorio: 0 sin carga, + lastre, − ayuda | obligatorio | no     | opcional      |
| `tiempo`    | opcional, 0 o más                 | no           | obligatoria | no            |

«Sin carga» es 0 y no nulo: una sola forma de decirlo, y «mejoró por carga» compara
números. La base de datos solo comprueba la forma de la serie (`series_medidas_check`):
qué pide cada ejercicio lo comprueba esta regla, porque el tipo está en otra tabla.

Esta es la especificación que copiará la app móvil, así que no usa nada de FastAPI.
"""

from collections.abc import Mapping
from decimal import Decimal
from typing import Any

# Cómo se dice cada tipo en un mensaje: «Plancha se apunta por tiempo: …».
COMO_SE_APUNTA = {
    "peso_reps": "con peso y repeticiones",
    "corporal": "con repeticiones y carga",
    "tiempo": "por tiempo",
}

# Qué campos son obligatorios (True), opcionales (None) o no valen (False) en cada tipo.
REGLA: dict[str, dict[str, bool | None]] = {
    "peso_reps": {"peso": True, "repeticiones": True, "duracion_s": False, "peso_corporal": False},
    "corporal": {"peso": True, "repeticiones": True, "duracion_s": False, "peso_corporal": None},
    "tiempo": {"peso": None, "repeticiones": False, "duracion_s": True, "peso_corporal": False},
}

# Los campos que se dicen en plural («las repeticiones»), para conjugar el verbo.
PLURALES = {"repeticiones"}

# Cómo se nombra cada campo en un mensaje, con su artículo.
NOMBRE_DEL_CAMPO = {
    "peso": "el peso",
    "repeticiones": "las repeticiones",
    "duracion_s": "la duración",
    "peso_corporal": "el peso corporal",
}


def _unir(partes: list[str]) -> str:
    if len(partes) <= 1:
        return "".join(partes)
    return f"{', '.join(partes[:-1])} y {partes[-1]}"


def _verbo(verbo: str, campos: list[str]) -> str:
    """«falta la duración», «faltan las repeticiones», «faltan el peso y las repeticiones»:
    en plural si son varios o si el único que es se dice en plural.
    """
    return verbo + ("n" if len(campos) > 1 or campos[0] in PLURALES else "")


def validar_medidas(nombre: str, tipo: str, datos: Mapping[str, Any]) -> str | None:
    """El texto de un 422 si las medidas de la serie no cuadran con el tipo del
    ejercicio, o `None` si valen. `datos` son los valores finales de la serie.
    """
    regla = REGLA[tipo]
    faltan = [campo for campo, pide in regla.items() if pide is True and datos.get(campo) is None]
    sobran = [
        campo
        for campo, pide in regla.items()
        if pide is False and datos.get(campo) is not None and campo != "peso_corporal"
    ]
    if faltan or sobran:
        detalle = []
        if faltan:
            detalle.append(
                f"{_verbo('falta', faltan)} {_unir([NOMBRE_DEL_CAMPO[c] for c in faltan])}"
            )
        if sobran:
            detalle.append(
                f"{_verbo('sobra', sobran)} {_unir([NOMBRE_DEL_CAMPO[c] for c in sobran])}"
            )
        return f"{nombre} se apunta {COMO_SE_APUNTA[tipo]}: {_unir(detalle)}."
    peso = datos.get("peso")
    if peso is not None and Decimal(peso) < 0 and tipo != "corporal":
        return "El peso no puede ser negativo: solo los ejercicios de peso corporal admiten ayuda."
    if datos.get("peso_corporal") is not None and tipo != "corporal":
        return (
            "El peso corporal solo se guarda en las series de ejercicios de peso corporal, "
            f"y {nombre} no lo es."
        )
    return None
