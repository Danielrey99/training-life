"""La fecha de "hoy" tal y como la vive quien entrena, no el servidor.

Quien usa la app manda su zona horaria en cada petición (la cabecera `X-Zona-Horaria`,
que fija el middleware de `app/main.py`): si el servidor va dos horas por delante, a las
23:00 del lunes en el teléfono ya sería martes en el servidor, y la sesión de esa noche
contaría para el día equivocado. Sin cabecera (Swagger, curl), vale `ZONA_HORARIA`.
"""

import os
from contextvars import ContextVar, Token
from datetime import date, datetime
from functools import cache
from zoneinfo import ZoneInfo, available_timezones

# El contenedor corre en UTC: a las 00:30 en España, date.today() todavía diría
# que es ayer, y una sesión empezada a esa hora quedaría en el día equivocado.
ZONA_HORARIA = ZoneInfo(os.getenv("ZONA_HORARIA", "Europe/Madrid"))

# La zona de quien hace la petición en curso. Una `ContextVar` y no una variable global:
# cada petición tiene la suya aunque lleguen varias a la vez.
_zona_de_la_peticion: ContextVar[ZoneInfo] = ContextVar("zona_de_la_peticion", default=ZONA_HORARIA)


def zona_actual() -> ZoneInfo:
    """La zona horaria de quien hace la petición, o `ZONA_HORARIA` si no la ha dicho."""
    return _zona_de_la_peticion.get()


def fijar_zona(nombre: str | None) -> Token[ZoneInfo]:
    """Fija la zona de la petición en curso a partir de su cabecera. Una cabecera que
    falta o no vale no es un error: se usa `ZONA_HORARIA`, como sin cabecera.
    """
    zona = zona_horaria(nombre) if nombre and len(nombre) <= 64 else None
    return _zona_de_la_peticion.set(zona or ZONA_HORARIA)


def soltar_zona(token: Token[ZoneInfo]) -> None:
    """Deja la zona como estaba antes de `fijar_zona`, al acabar la petición."""
    _zona_de_la_peticion.reset(token)


def hoy() -> date:
    """El día de hoy en la zona horaria de quien usa la app (`zona_actual`).

    Todo lo que dependa de "hoy" en el backend (la sesión en curso, las fechas que
    no se pueden planificar hacia atrás, cuándo empieza o acaba un programa activo)
    tiene que pasar por aquí, nunca por `date.today()`.
    """
    return hoy_en(zona_actual())


MESES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)

DIAS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")


def nombre_del_dia(dia_semana: int) -> str:
    """«lunes» para el 1 y «domingo» para el 7, como `dia_semana` en la API."""
    return DIAS[dia_semana - 1]


def fecha_en_texto(fecha: date) -> str:
    """Una fecha para leerla en un mensaje, como la escribe la web: «martes 27 de
    octubre», y con el año si no es el de hoy («jueves 1 de octubre de 2025»).
    """
    texto = f"{DIAS[fecha.weekday()]} {fecha.day} de {MESES[fecha.month - 1]}"
    return texto if fecha.year == hoy().year else f"{texto} de {fecha.year}"


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
