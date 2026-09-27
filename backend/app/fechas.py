"""La fecha de "hoy" tal y como la vive quien entrena, no el servidor."""

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

# El contenedor corre en UTC: a las 00:30 en España, date.today() todavía diría
# que es ayer, y una sesión empezada a esa hora quedaría en el día equivocado.
ZONA_HORARIA = ZoneInfo(os.getenv("ZONA_HORARIA", "Europe/Madrid"))


def hoy() -> date:
    """El día de hoy en la zona horaria del usuario.

    Todo lo que dependa de "hoy" en el backend (la sesión en curso, las fechas que
    no se pueden planificar hacia atrás, cuándo empieza o acaba un programa activo)
    tiene que pasar por aquí, nunca por `date.today()`.
    """
    return datetime.now(ZONA_HORARIA).date()
