"""Qué se puede hacer con algo oculto.

La regla, igual para ejercicios, rutinas y huecos: **leer** no mira si algo está
oculto (su vista "está oculto" necesita abrirlo), **borrarlo o volver a mostrarlo**
tampoco (se hace precisamente desde esa vista), pero **editarlo o usarlo** sí: lo
oculto deja de ofrecerse, y cambiarlo sin mostrarlo antes no tendría sentido.
"""

from fastapi import HTTPException, status

from app.models import Ocultable


def exigir_visible(objeto: Ocultable, mensaje: str) -> None:
    """409 si `objeto` está oculto. No 404: el GET sí lo devuelve, así que para
    quien llama existe, y lo que falla es la acción, no la búsqueda.
    """
    if objeto.oculto:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=mensaje)
