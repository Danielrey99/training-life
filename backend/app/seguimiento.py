"""Qué día del plan cuenta cada sesión, y cuándo lo cuenta de verdad.

Cada sesión guarda el día que cuenta (`Entrenamiento.cubre_fecha`), según el
botón con el que se empezó: *Empezar* cuenta hoy, *Recuperar* un día pasado y
*Adelantar* uno de esta semana que aún no ha llegado. Así no hay que adivinar
después qué día cubría cada sesión.

Lo usan la creación de sesiones y, más adelante, el estado de cada día (hecho,
movido, sin hacer) y la pantalla de hoy, así que vive aparte y no en un router.
"""

from datetime import date, timedelta

from app.models import Entrenamiento
from app.plan import DiaPlan


def plazo(dia: date) -> tuple[date, date]:
    """Las fechas en que se puede entrenar lo que tocaba `dia`, las dos incluidas.

    Hacia atrás, desde el lunes de su semana (adelantar). Hacia delante, hasta el
    día antes del mismo día de la semana siguiente (recuperar): lo del lunes se
    recupera hasta el domingo.
    """
    return dia - timedelta(days=dia.weekday()), dia + timedelta(days=6)


def esta_cancelada(sesion: Entrenamiento) -> bool:
    """Una sesión sin ninguna serie que ya no está en curso: no se hizo nada.

    No cuenta para ningún día ni ocupa su fecha, y se borra en cuanto otra sesión
    necesita su fecha o su día. La que está en curso sí cuenta aunque esté vacía:
    se acaba de empezar.
    """
    return not sesion.en_curso and not sesion.series


def cuenta(sesion: Entrenamiento, dia: DiaPlan) -> bool:
    """Si la sesión cuenta de verdad para `dia`.

    No basta con que lo diga `cubre_fecha`: el plan de ese día tiene que seguir
    siendo su rutina (se puede haber cambiado el programa u ocultado la rutina
    después), y la sesión no puede estar cancelada. Si falla algo de eso, la sesión
    no cuenta, pero sigue reteniendo el día: si el plan vuelve a ser el de antes,
    vuelve a contar.
    """
    return (
        sesion.cubre_fecha == dia.fecha
        and not dia.descanso
        and dia.rutina.id == sesion.rutina_id
        and not esta_cancelada(sesion)
    )
