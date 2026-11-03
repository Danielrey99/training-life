"""La forma de un nombre de ejercicio con la que se compara si ya existe otro igual.

Python puro, sin FastAPI ni SQLAlchemy: el móvil la porta tal cual y una migración
que siembre predefinidos puede copiarla.
"""

# Una tabla explícita y no `unicodedata.normalize("NFD")`: NFD también quitaría la tilde
# de la ñ y la cedilla de la ç, y «Año» y «Ano» son nombres distintos. El móvil lleva la
# misma tabla.
_SIN_TILDES = str.maketrans("áàâäéèêëíìîïóòôöúùûü", "aaaaeeeeiiiioooouuuu")


def clave_de_nombre(nombre: str) -> str:
    """«Press  Banca» y «press banca» son el mismo nombre: sin bordes, con los espacios
    seguidos como uno, en minúsculas y sin tildes ni diéresis.
    """
    return " ".join(nombre.split()).lower().translate(_SIN_TILDES)
