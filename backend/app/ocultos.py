"""Qué se puede hacer con algo oculto.

La regla, igual para ejercicios, rutinas, huecos y programas: **leer** no mira si
algo está oculto (su vista "está oculto" necesita abrirlo), **borrarlo o volver a
mostrarlo** tampoco (se hace precisamente desde esa vista), pero **editarlo** sí:
cambiar algo oculto sin mostrarlo antes no tendría sentido. Eso da 409, con
`exigir_visible`.

**Elegir algo oculto en otro sitio** (un ejercicio oculto para una serie nueva, una
rutina oculta para un día del programa) da en cambio **404**, y no lo decide este
módulo sino el ayudante de cada recurso (`obtener_ejercicio_visible`,
`obtener_rutina_visible`…): lo oculto deja de ofrecerse, así que para elegirlo es
como si no existiera. Lo que ya se registró con algo oculto sí se puede corregir.
"""

from fastapi import HTTPException, status

from app.models import Ocultable


def exigir_visible(objeto: Ocultable, mensaje: str) -> None:
    """409 si `objeto` está oculto. No 404: el GET sí lo devuelve, así que para
    quien llama existe, y lo que falla es la acción, no la búsqueda.
    """
    if objeto.oculto:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=mensaje)
