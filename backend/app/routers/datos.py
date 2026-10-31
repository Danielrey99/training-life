from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.database import get_db
from app.datos import (
    MAXIMO_DE_ERRORES,
    borrar_todo,
    cargar,
    exportar,
    resumir_actual,
    resumir_archivo,
    validar,
)
from app.fechas import hoy
from app.schemas import ComprobacionDeImportar, ArchivoDeDatos, ResumenDeDatos

router = APIRouter(prefix="/datos", tags=["datos"])

NO_ES_UNA_COPIA = "Este archivo no es una copia de los datos de Training Life."


def _no_se_puede(mensaje: str, errores: list[str] | None = None) -> HTTPException:
    detalle: dict = {"mensaje": mensaje}
    if errores:
        detalle["errores"] = errores
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detalle)


@router.get("/exportar", response_model=ArchivoDeDatos)
def exportar_datos(
    response: Response,
    db: Session = Depends(get_db),
):
    """Todos tus datos en un archivo, para pasarlos a otro dispositivo o guardarlos
    como copia. Se descarga como `training-life-<fecha>.json`.
    """
    response.headers["Content-Disposition"] = (
        f'attachment; filename="training-life-{hoy().isoformat()}.json"'
    )
    return exportar(db)


@router.get("/resumen", response_model=ResumenDeDatos)
def resumen_de_datos(
    db: Session = Depends(get_db),
):
    """Cuánto hay, para la confirmación de exportar y de borrar: las mismas cifras que
    `actual` en la comprobación de importar. (No es `GET /resumen`, el resumen semanal
    de H5.)
    """
    return resumir_actual(db)


@router.post(
    "/importar",
    response_model=ComprobacionDeImportar | ResumenDeDatos,
)
def importar_datos(
    # Cualquier JSON y no el modelo (ni siquiera un dict): con un tipo, FastAPI
    # contestaría su propio 422, en inglés y sin decir qué hacer, antes de llegar aquí.
    archivo: Any = Body(...),
    comprobar: bool = False,
    db: Session = Depends(get_db),
):
    """**Sustituye todos tus datos** por los del archivo, en una sola transacción: si
    algo del archivo no vale, no se toca nada y el 422 dice qué.

    Con `comprobar=true` no cambia nada: dice qué hay en el archivo y qué hay ahora,
    para que la confirmación cuente qué se sustituye por qué.
    """
    if not isinstance(archivo, dict) or archivo.get("formato") != "training-life":
        raise _no_se_puede(NO_ES_UNA_COPIA)
    version = archivo.get("version")
    # En Python `True == 1`: sin esto, `"version": true` diría que es de una versión anterior.
    if isinstance(version, bool):
        version = None
    if isinstance(version, int) and version > 2:
        raise _no_se_puede(
            "Este archivo es de una versión más nueva de la app. Actualízala para cargarlo."
        )
    if version == 1:
        # Sin tipos de ejercicio: no se convierte, la app todavía no se usaba (decisión del autor).
        raise _no_se_puede(
            "Este archivo es de una versión anterior de la app y ya no se puede cargar."
        )
    if version != 2:
        raise _no_se_puede(NO_ES_UNA_COPIA)
    try:
        datos = ArchivoDeDatos.model_validate(archivo)
    except ValidationError as fallo:
        errores = [
            f"{'.'.join(str(parte) for parte in error['loc'])}: {error['msg']}"
            for error in fallo.errors()
        ]
        raise _no_se_puede("El archivo está dañado.", errores[:MAXIMO_DE_ERRORES])

    errores, mapas = validar(db, datos)
    if errores:
        raise _no_se_puede(
            "No se puede cargar el archivo, así que no se ha cambiado nada.", errores
        )

    if comprobar:
        return ComprobacionDeImportar(
            exportado_en=datos.exportado_en,
            archivo=resumir_archivo(datos),
            actual=resumir_actual(db),
        )

    borrar_todo(db)
    cargar(db, datos, mapas)
    # Un único commit: si algo falla antes, `get_db` cierra sin confirmar y no queda
    # nada a medias.
    db.commit()
    return resumir_actual(db)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def borrar_datos(
    db: Session = Depends(get_db),
):
    """**Borra todos tus datos** (rutinas, programas, sesiones, notas y tus ejercicios)
    para empezar de cero. Los ejercicios de la app no se tocan. No se puede deshacer: lo
    que cuenta `GET /datos/resumen` es lo que se pierde.
    """
    borrar_todo(db)
    db.commit()
