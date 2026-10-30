"""La fecha de "hoy" tal y como la vive quien entrena, no el servidor."""

import os
from datetime import date, datetime
from functools import cache
from zoneinfo import ZoneInfo, available_timezones

# El contenedor corre en UTC: a las 00:30 en España, date.today() todavía diría
# que es ayer, y una sesión empezada a esa hora quedaría en el día equivocado.
ZONA_HORARIA = ZoneInfo(os.getenv("ZONA_HORARIA", "Europe/Madrid"))


def hoy() -> date:
    """El día de hoy en la zona horaria del usuario.

    Todo lo que dependa de "hoy" en el backend (la sesión en curso, las fechas que
    no se pueden planificar hacia atrás, cuándo empieza o acaba un programa activo)
    tiene que pasar por aquí, nunca por `date.today()`.
    """
    return hoy_en(ZONA_HORARIA)


def hoy_en(zona: ZoneInfo) -> date:
    """El día de hoy en otra zona: la de quien exportó un archivo que se importa."""
    return datetime.now(zona).date()


def zona_horaria(nombre: str) -> ZoneInfo | None:
    """La zona con ese nombre (`Europe/Madrid`), o `None` si esta instalación no la
    conoce o el nombre no es válido.
    """
    # Solo las de la lista, y no lo que ZoneInfo acierte a abrir: "Europe" es una carpeta y
    # daría un OSError distinto en Windows y en Linux, y Windows aceptaría "Europe\Madrid".
    return ZoneInfo(nombre) if nombre in _zonas_conocidas() else None


@cache
def _zonas_conocidas() -> set[str]:
    """Los nombres de zona que conoce esta instalación (calcularlos cuesta, se guardan)."""
    return available_timezones()
