"""Qué día del plan cuenta cada sesión, y cuándo lo cuenta de verdad.

Cada sesión guarda el día que cuenta (`Entrenamiento.cubre_fecha`), según el
botón con el que se empezó: *Empezar* cuenta hoy, *Recuperar* un día pasado y
*Adelantar* uno de esta semana que aún no ha llegado. Así no hay que adivinar
después qué día cubría cada sesión.

Lo usan la creación de sesiones y, más adelante, el estado de cada día (hecho,
movido, sin hacer) y la pantalla de hoy, así que vive aparte y no en un router.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from app.fechas import hoy
from app.models import Entrenamiento, Rutina, Serie
from app.plan import DiaPlan, resolver_dias, validar_rango_del_plan

# Lo más lejos que puede quedar una sesión del día que cuenta (ver `plazo`).
MARGEN = timedelta(days=6)


def plazo(dia: date) -> tuple[date, date]:
    """Las fechas en que se puede entrenar lo que tocaba `dia`, las dos incluidas.

    Hacia atrás, desde el lunes de su semana (adelantar). Hacia delante, hasta el
    día antes del mismo día de la semana siguiente (recuperar): lo del lunes se
    recupera hasta el domingo.
    """
    return dia - timedelta(days=dia.weekday()), dia + timedelta(days=6)


def esta_cancelada(sesion: Entrenamiento, vacia: bool | None = None) -> bool:
    """Una sesión sin ninguna serie que ya no está en curso: no se hizo nada.

    No cuenta para ningún día ni ocupa su fecha, y se borra en cuanto otra sesión
    necesita su fecha o su día. La que está en curso sí cuenta aunque esté vacía:
    se acaba de empezar.

    `vacia` es para quien ya sabe si tiene series sin cargarlas (el seguimiento,
    que lo pregunta para todas las sesiones en la misma consulta).
    """
    if vacia is None:
        vacia = not sesion.series
    return not sesion.en_curso and vacia


def cuenta(sesion: Entrenamiento, dia: DiaPlan, vacia: bool | None = None) -> bool:
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
        and not esta_cancelada(sesion, vacia)
    )


# --- El estado de cada día -----------------------------------------------

Estado = Literal["descanso", "hecho", "movido", "sin_hacer", "pendiente", "proximo"]


@dataclass
class SesionDelDia:
    """Lo que se hizo un día, cuente o no para alguno."""

    entrenamiento_id: int
    rutina: Rutina | None
    en_curso: bool
    vacia: bool
    cubre_fecha: date | None
    # Si cuenta de verdad para `cubre_fecha` (ver `cuenta`).
    cuenta: bool


@dataclass
class Cobertura:
    """La sesión que cuenta un día: de ese mismo día si se hizo cuando tocaba, de
    otro si se recuperó o se adelantó.
    """

    entrenamiento_id: int
    fecha: date


@dataclass
class DiaSeguimiento(DiaPlan):
    """Un día del plan con lo que pasó: qué tocaba (lo de `DiaPlan`), si alguna
    sesión lo cuenta, y qué se hizo ese día. Con las tres cosas se componen todas
    las marcas del calendario, también las combinadas (se hizo otra rutina y la
    suya otro día, o sigue sin hacer).
    """

    estado: Estado
    cubierto_por: Cobertura | None
    sesion: SesionDelDia | None


def seguimiento(db: Session, usuario_id: int, desde: date, hasta: date) -> list[DiaSeguimiento]:
    """El estado de cada día de `desde` a `hasta`, los dos incluidos.

    - `descanso`: no tocaba nada (o tocaba una rutina que ese día estaba oculta).
    - `hecho`: lo cuenta una sesión de ese mismo día.
    - `movido`: lo cuenta una sesión de otro día (recuperado o adelantado).
    - `sin_hacer`, `pendiente` o `proximo`: nadie lo cuenta, y es pasado, hoy o
      futuro.

    Las sesiones canceladas (vacías y ya fuera de curso) no salen: no se hizo nada.

    El plan se resuelve con `MARGEN` días de más a cada lado, porque la sesión de
    un día puede contar otro que cae fuera del rango pedido, y saber si lo cuenta
    de verdad pide el plan de ese otro día. Así el resultado de un día no depende
    del rango en que se pida. Siempre son las mismas consultas, sea cual sea el
    rango: seis para el plan y dos para las sesiones.
    """
    validar_rango_del_plan(desde, hasta)
    plan = {dia.fecha: dia for dia in resolver_dias(db, usuario_id, desde - MARGEN, hasta + MARGEN)}

    tiene_series = select(Serie.id).where(Serie.entrenamiento_id == Entrenamiento.id).exists()
    filas = db.execute(
        select(Entrenamiento, tiene_series)
        .where(
            Entrenamiento.usuario_id == usuario_id,
            or_(
                # Las de los días pedidos y las que pueden contarlos...
                and_(Entrenamiento.fecha >= desde - MARGEN, Entrenamiento.fecha <= hasta + MARGEN),
                # ...y cualquiera que diga contarlos, aunque quede más lejos.
                and_(Entrenamiento.cubre_fecha >= desde, Entrenamiento.cubre_fecha <= hasta),
            ),
        )
        .options(selectinload(Entrenamiento.rutina))
    ).all()

    del_dia: dict[date, SesionDelDia] = {}
    cuentan: dict[date, Cobertura] = {}
    for sesion, con_series in filas:
        vacia = not con_series
        if esta_cancelada(sesion, vacia):
            continue
        dia_que_cubre = plan.get(sesion.cubre_fecha) if sesion.cubre_fecha else None
        cuenta_de_verdad = dia_que_cubre is not None and cuenta(sesion, dia_que_cubre, vacia)
        del_dia[sesion.fecha] = SesionDelDia(
            sesion.id, sesion.rutina, sesion.en_curso, vacia, sesion.cubre_fecha, cuenta_de_verdad
        )
        if cuenta_de_verdad:
            cuentan[sesion.cubre_fecha] = Cobertura(sesion.id, sesion.fecha)

    resultado = []
    fecha, hoy_ = desde, hoy()
    while fecha <= hasta:
        dia = plan[fecha]
        cubierto_por = cuentan.get(fecha)
        if dia.descanso:
            estado = "descanso"
        elif cubierto_por is not None:
            estado = "hecho" if cubierto_por.fecha == fecha else "movido"
        elif fecha < hoy_:
            estado = "sin_hacer"
        else:
            estado = "pendiente" if fecha == hoy_ else "proximo"
        resultado.append(
            DiaSeguimiento(
                dia.fecha,
                dia.origen,
                dia.programa_id,
                dia.rutina,
                dia.descanso,
                estado=estado,
                cubierto_por=cubierto_por,
                sesion=del_dia.get(fecha),
            )
        )
        fecha += timedelta(days=1)
    return resultado


# --- La pantalla de hoy --------------------------------------------------

Situacion = Literal[
    "en_curso", "hecho", "primera_vez", "sin_programa", "movido", "descanso", "entrenamiento"
]
Accion = Literal["intercambiar", "adelantar", "sin_contar"]

# Hasta dónde se busca el próximo entrenamiento.
HORIZONTE = timedelta(days=14)


@dataclass
class Recuperable:
    """Un día que se quedó sin hacer y aún está en plazo."""

    fecha: date
    rutina: Rutina
    # El último día en que se puede recuperar.
    plazo: date
    # Falso si ese día ya hay sesión: la lista se enseña, pero sin botón.
    se_puede_hoy: bool


@dataclass
class Ofrecida:
    """Una rutina de la lista de abajo de la pantalla de hoy, con lo que haría:
    intercambiarla con el día `fecha`, adelantar lo de ese día, o entrenarla sin
    que cuente para ninguno (`fecha` nula).
    """

    accion: Accion
    rutina: Rutina
    fecha: date | None


@dataclass
class UltimaSesion:
    entrenamiento_id: int
    fecha: date
    rutina: Rutina | None


@dataclass
class ResumenDeHoy:
    fecha: date
    situacion: Situacion
    semana: list[DiaSeguimiento]
    sesion: SesionDelDia | None
    proximo: DiaSeguimiento | None
    por_recuperar: list[Recuperable]
    ofrecidas: list[Ofrecida]
    ultima_sesion: UltimaSesion | None


def _situacion(dia: DiaSeguimiento, hay_rutinas: bool) -> Situacion:
    """La primera que encaje, en este orden."""
    if dia.sesion is not None:
        return "en_curso" if dia.sesion.en_curso else "hecho"
    if dia.origen == "sin_programa":
        return "sin_programa" if hay_rutinas else "primera_vez"
    if dia.estado == "movido":
        # Lo de hoy ya se hizo otro día: se comporta como un descanso.
        return "movido"
    return "descanso" if dia.descanso else "entrenamiento"


def _una_por_rutina(dias: list[DiaSeguimiento]) -> list[DiaSeguimiento]:
    """El primer día de cada rutina: ofrecer dos veces la misma no aporta nada."""
    vistas, primeros = set(), []
    for dia in dias:
        if dia.rutina.id not in vistas:
            vistas.add(dia.rutina.id)
            primeros.append(dia)
    return primeros


def resumen_de_hoy(db: Session, usuario_id: int, fecha: date) -> ResumenDeHoy:
    """Todo lo que necesita la pantalla de hoy para el día `fecha`, que es hoy en
    la pantalla de Entrenar y un día pasado en la hoja de registrar un día del
    calendario (que ofrece lo que habría ofrecido la pantalla de hoy ese día).

    Qué manda el cliente al pulsar cada botón (`POST /entrenamientos`):
    - *Empezar*: la rutina del día, con `cubre_fecha` = `fecha`.
    - *Recuperar*: la rutina, con `cubre_fecha` = el día que se recupera.
    - *Adelantar*: la rutina, con `cubre_fecha` = el día ofrecido.
    - *Intercambiar*: primero `POST /plan/intercambiar` y después *Empezar*.
    - Una rutina `sin_contar`: sin `cubre_fecha`.
    """
    lunes = fecha - timedelta(days=fecha.weekday())
    domingo = lunes + timedelta(days=6)
    # Una sola vez, de lo más antiguo que aún se puede recuperar al próximo
    # entrenamiento más lejano que se busca.
    dias = {
        dia.fecha: dia for dia in seguimiento(db, usuario_id, fecha - MARGEN, fecha + HORIZONTE)
    }
    dia = dias[fecha]
    rutinas = db.scalars(
        select(Rutina)
        .where(Rutina.usuario_id == usuario_id, Rutina.oculto_desde.is_(None))
        .order_by(Rutina.nombre, Rutina.id)
    ).all()
    visibles = {rutina.id for rutina in rutinas}
    situacion = _situacion(dia, bool(rutinas))

    def sin_contar(dia_: DiaSeguimiento) -> bool:
        # Un día con rutina que ninguna sesión cuenta, de una rutina que aún se
        # puede elegir.
        return not dia_.descanso and dia_.cubierto_por is None and dia_.rutina.id in visibles

    siguientes = [dias[fecha + timedelta(days=n)] for n in range(1, HORIZONTE.days + 1)]
    proximo = next((d for d in siguientes if sin_contar(d)), None)

    # Lo faltado de los seis días anteriores, con el mismo programa que este día:
    # lo que tocaba con un programa que ya no está activo no se recupera.
    anteriores = [dias[fecha - timedelta(days=n)] for n in range(MARGEN.days, 0, -1)]
    candidatos = [d for d in anteriores if sin_contar(d) and d.programa_id == dia.programa_id]
    # Hoy mismo, si ya se entrenó otra cosa y lo suyo sigue sin hacer.
    if dia.sesion is not None and sin_contar(dia):
        candidatos.append(dia)
    por_recuperar = [
        Recuperable(d.fecha, d.rutina, d.fecha + MARGEN, se_puede_hoy=dia.sesion is None)
        for d in candidatos
    ]

    ofrecidas: list[Ofrecida] = []
    if dia.sesion is None:
        esta_semana = [d for d in siguientes if d.fecha <= domingo and sin_contar(d)]
        if situacion == "entrenamiento" and fecha == hoy():
            ofrecidas = [
                Ofrecida("intercambiar", d.rutina, d.fecha)
                for d in _una_por_rutina(esta_semana)
                if d.rutina.id != dia.rutina.id
            ]
        elif situacion in ("descanso", "movido"):
            ofrecidas = [
                Ofrecida("adelantar", d.rutina, d.fecha) for d in _una_por_rutina(esta_semana)
            ]
        # Sin programa se puede entrenar cualquier rutina, y un día pasado admite
        # apuntar la que se hizo aunque no cuente para ninguno.
        if situacion in ("sin_programa", "primera_vez") or fecha < hoy():
            ya_ofrecidas = {o.rutina.id for o in ofrecidas} | {r.rutina.id for r in por_recuperar}
            if situacion == "entrenamiento":
                ya_ofrecidas.add(dia.rutina.id)
            ofrecidas += [
                Ofrecida("sin_contar", rutina, None)
                for rutina in rutinas
                if rutina.id not in ya_ofrecidas
            ]

    tiene_series = select(Serie.id).where(Serie.entrenamiento_id == Entrenamiento.id).exists()
    ultima = db.scalar(
        select(Entrenamiento)
        .where(Entrenamiento.usuario_id == usuario_id, Entrenamiento.fecha < fecha, tiene_series)
        .order_by(Entrenamiento.fecha.desc())
        .limit(1)
    )

    return ResumenDeHoy(
        fecha=fecha,
        situacion=situacion,
        semana=[dias[lunes + timedelta(days=n)] for n in range(7)],
        sesion=dia.sesion,
        proximo=proximo,
        por_recuperar=por_recuperar,
        ofrecidas=ofrecidas,
        ultima_sesion=(
            UltimaSesion(ultima.id, ultima.fecha, ultima.rutina) if ultima is not None else None
        ),
    )
