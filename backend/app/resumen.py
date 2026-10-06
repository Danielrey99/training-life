"""Las cifras de la pantalla de resumen: volumen, series por grupo y constancia.

Se calculan aquí y no en la web porque la app móvil enseñará lo mismo, y porque
la constancia sale del seguimiento del plan, que solo conoce el backend. Todo va
en una sola respuesta: cambiar entre semanas y meses o elegir una barra no pide
nada más.

La gráfica de volumen tiene, por semana y por mes, ocho barras ya terminadas y,
si el periodo de hoy cae en la ventana del mes pedido, una más con lo que va de
él (la barra en curso). Cada barra trae su desglose (volumen por rutina y series
por grupo muscular), que es lo que la pantalla enseña al elegirla, y su cambio
sobre el último periodo anterior con volumen, aunque quede fuera de la gráfica:
una semana sin entrenar no deja a la siguiente sin con qué compararse.

Qué cuenta en cada cifra:

- **Volumen** (Σ peso × repeticiones, como en el día del historial) y **series**:
  todas las sesiones del usuario por su fecha real, no por el día del plan que
  cuentan. También las que siguen abiertas, las que no cuentan para ningún día y
  las de rutinas o ejercicios ocultos: es historial. Las canceladas no tienen
  series, así que no suman sin necesidad de filtrarlas.
- **Constancia**, día a día del plan: **entrenados** son los `hecho` y los
  `movido`, en el mes del día que tocaban (lo recuperado y lo adelantado cuentan
  en el mes de su día, no en el de la sesión); **planificados**, los entrenados
  más los `sin_hacer` (hoy sin hacer todavía no es una falta); **por llegar**, los
  `pendiente` y los `proximo`. Descansos, días con una rutina oculta y sesiones
  que no cuentan para ningún día no entran en ninguna.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy import TIMESTAMP, Date, cast, func, select
from sqlalchemy.orm import Session

from app.fechas import hoy
from app.models import Ejercicio, Entrenamiento, GrupoMuscular, Rutina, Serie
from app.seguimiento import seguimiento

# Cuántas barras terminadas tiene la gráfica de volumen, en semanas o en meses.
PERIODOS = 8

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

CENTIMOS = Decimal("0.01")
DECIMA = Decimal("0.1")

Unidad = Literal["week", "month"]
Rango = tuple[date, date]


@dataclass
class VolumenDeRutina:
    rutina: Rutina
    volumen: Decimal


@dataclass
class SeriesDeGrupo:
    grupo_muscular: GrupoMuscular
    series: int


@dataclass
class PeriodoDeVolumen:
    """Una barra de la gráfica: una semana de lunes a domingo o un mes entero, con
    su desglose y su cambio en tanto por ciento sobre `comparado_con`, el último
    periodo anterior con volumen. Los dos son nulos si la barra no tiene volumen o
    si no hay ningún periodo anterior con él.
    """

    desde: date
    hasta: date
    volumen: Decimal
    cambio: float | None
    comparado_con: date | None
    volumen_por_rutina: list[VolumenDeRutina]
    series_por_grupo: list[SeriesDeGrupo]


@dataclass
class EvolucionDeVolumen:
    """Las barras terminadas, de la más antigua a la última, y la en curso si la hay."""

    periodos: list[PeriodoDeVolumen]
    en_curso: PeriodoDeVolumen | None


@dataclass
class MesDeConstancia:
    mes: date
    entrenados: int
    planificados: int
    por_llegar: int


@dataclass
class Constancia:
    meses: list[MesDeConstancia]
    entrenados: int
    planificados: int


@dataclass
class Resumen:
    mes: date
    por_semana: EvolucionDeVolumen
    por_mes: EvolucionDeVolumen
    constancia: Constancia


@dataclass
class _Ventana:
    """Las barras de una vista: las terminadas y la en curso, si cae en la ventana."""

    unidad: Unidad
    terminados: list[Rango]
    en_curso: Rango | None

    @property
    def barras(self) -> list[Rango]:
        return self.terminados + ([self.en_curso] if self.en_curso else [])

    def indice(self, fecha: date) -> int | None:
        """La barra en la que cae `fecha`, o nada si cae fuera de la gráfica."""
        inicio = self.terminados[0][0]
        if self.unidad == "week":
            indice = (fecha - inicio).days // 7
        else:
            indice = (fecha.year * 12 + fecha.month) - (inicio.year * 12 + inicio.month)
        return indice if 0 <= indice < len(self.barras) else None


@dataclass
class _Barra:
    """Lo que se va sumando de una barra mientras se recorren las filas."""

    volumen: Decimal = Decimal(0)
    rutinas: dict[int, VolumenDeRutina] = field(default_factory=dict)
    grupos: dict[int, SeriesDeGrupo] = field(default_factory=dict)


def nombre_del_mes(primero: date) -> str:
    """ "Septiembre de 2026"."""
    return f"{MESES[primero.month - 1].capitalize()} de {primero.year}"


def sumar_meses(primero: date, n: int) -> date:
    """El día 1 del mes que queda `n` meses después (o antes, si es negativo)."""
    anio, mes = divmod(primero.year * 12 + primero.month - 1 + n, 12)
    return date(anio, mes + 1, 1)


def _ultimo_dia(primero: date) -> date:
    return sumar_meses(primero, 1) - timedelta(days=1)


def _ventanas(primero: date, hoy_: date) -> tuple[_Ventana, _Ventana]:
    """Las semanas y los meses de la gráfica de volumen, del más antiguo al último.

    Las barras terminadas: la última semana es la del último día del mes si ya
    acabó; si no, la última acabada. El último mes es el pedido si ya acabó; si es
    el actual, el anterior. Así una semana o un mes a medias no se comparan con
    uno entero.

    La barra en curso (decisión del autor: también quiere ver lo que lleva) es la
    semana de hoy si la semana del último día del mes pedido aún no ha terminado
    (el mes actual, o uno pasado cuya última semana sigue en marcha), y el mes de
    hoy si el pedido es el actual. Siempre va justo detrás de la última terminada.
    """
    ultimo = _ultimo_dia(primero)
    lunes_hoy = hoy_ - timedelta(days=hoy_.weekday())
    domingo = min(ultimo + timedelta(days=6 - ultimo.weekday()), lunes_hoy - timedelta(days=1))
    semanas = [
        (domingo - timedelta(days=7 * n + 6), domingo - timedelta(days=7 * n))
        for n in range(PERIODOS - 1, -1, -1)
    ]
    ultimo_mes = primero if ultimo < hoy_ else sumar_meses(primero, -1)
    meses = [
        (inicio, _ultimo_dia(inicio))
        for inicio in (sumar_meses(ultimo_mes, -n) for n in range(PERIODOS - 1, -1, -1))
    ]
    semana_en_curso = (lunes_hoy, lunes_hoy + timedelta(days=6)) if ultimo >= lunes_hoy else None
    mes_en_curso = (primero, ultimo) if ultimo >= hoy_ else None
    return _Ventana("week", semanas, semana_en_curso), _Ventana("month", meses, mes_en_curso)


def _referencia(
    db: Session, usuario_id: int, unidad: Unidad, antes_de: date
) -> tuple[date, Decimal] | None:
    """El último periodo anterior a `antes_de` con volumen, y su volumen.

    Es con lo que se compara la primera barra con volumen de la gráfica, aunque
    quede muy atrás: la gráfica solo enseña ocho barras, pero el entrenamiento
    viene de antes.
    """
    # `date_trunc` sobre un `timestamp` sin zona: con el `date` tal cual, Postgres
    # lo pasaría a `timestamptz` y el resultado dependería de la zona de la sesión.
    # 'week' empieza en lunes, como las semanas de la gráfica.
    series = (
        select(
            cast(func.date_trunc(unidad, cast(Entrenamiento.fecha, TIMESTAMP)), Date).label(
                "desde"
            ),
            (Serie.peso * Serie.repeticiones).label("volumen"),
        )
        .join(Serie, Serie.entrenamiento_id == Entrenamiento.id)
        .where(Entrenamiento.usuario_id == usuario_id, Entrenamiento.fecha < antes_de)
        .subquery()
    )
    # Se agrupa fuera de la subconsulta: dentro, la unidad iría como parámetro en el
    # SELECT y en el GROUP BY, y Postgres no los reconocería como la misma expresión.
    suma = func.sum(series.c.volumen)
    fila = db.execute(
        select(series.c.desde, suma)
        .group_by(series.c.desde)
        .having(suma > 0)
        .order_by(series.c.desde.desc())
        .limit(1)
    ).first()
    return (fila[0], fila[1]) if fila else None


def _evolucion(
    ventana: _Ventana, barras: list[_Barra], referencia: tuple[date, Decimal] | None
) -> EvolucionDeVolumen:
    periodos = []
    for (desde, hasta), barra in zip(ventana.barras, barras):
        cambio = comparado_con = None
        if barra.volumen > 0:
            if referencia is not None:
                anterior_desde, anterior = referencia
                # Redondeo de siempre (6,25 → 6,3): `round()` redondea al par y daría 6,2.
                cambio = float(
                    ((barra.volumen - anterior) / anterior * 100).quantize(
                        DECIMA, rounding=ROUND_HALF_UP
                    )
                )
                comparado_con = anterior_desde
            referencia = (desde, barra.volumen)
        rutinas = sorted(
            barra.rutinas.values(),
            key=lambda fila: (-fila.volumen, fila.rutina.nombre.casefold(), fila.rutina.id),
        )
        for fila in rutinas:
            fila.volumen = fila.volumen.quantize(CENTIMOS)
        periodos.append(
            PeriodoDeVolumen(
                desde,
                hasta,
                barra.volumen.quantize(CENTIMOS),
                cambio,
                comparado_con,
                rutinas,
                sorted(
                    barra.grupos.values(),
                    key=lambda fila: (-fila.series, fila.grupo_muscular.nombre.casefold()),
                ),
            )
        )
    en_curso = periodos.pop() if ventana.en_curso else None
    return EvolucionDeVolumen(periodos, en_curso)


def _constancia(db: Session, usuario_id: int, anio: int) -> Constancia:
    meses = [MesDeConstancia(date(anio, n, 1), 0, 0, 0) for n in range(1, 13)]
    for dia in seguimiento(db, usuario_id, date(anio, 1, 1), date(anio, 12, 31)):
        mes = meses[dia.fecha.month - 1]
        if dia.estado in ("hecho", "movido"):
            mes.entrenados += 1
            mes.planificados += 1
        elif dia.estado == "sin_hacer":
            mes.planificados += 1
        elif dia.estado in ("pendiente", "proximo"):
            mes.por_llegar += 1
    return Constancia(
        meses,
        entrenados=sum(mes.entrenados for mes in meses),
        planificados=sum(mes.planificados for mes in meses),
    )


def resumen(db: Session, usuario_id: int, primero: date) -> Resumen:
    """Todo lo de la pantalla de resumen para el mes que empieza en `primero`.

    Las mismas consultas tenga los datos que tenga, sin una por sesión, por rutina
    ni por barra: una para el volumen y las series, dos para el periodo anterior a
    cada gráfica y las del seguimiento del año (que se ahorra una si no hay ninguna
    sesión).
    """
    vistas = _ventanas(primero, hoy())
    desde = min(vista.terminados[0][0] for vista in vistas)
    hasta = max(vista.barras[-1][1] for vista in vistas)

    # Una fila por sesión y grupo muscular (solo hay una sesión por día). El grupo
    # es el del ejercicio que se hizo en cada serie, no el del principal del hueco:
    # un comodín de otro grupo trabaja el suyo.
    filas = db.execute(
        select(
            Entrenamiento.fecha,
            Rutina,
            GrupoMuscular,
            func.sum(Serie.peso * Serie.repeticiones),
            func.count(Serie.id),
        )
        .join(Serie, Serie.entrenamiento_id == Entrenamiento.id)
        .join(Rutina, Rutina.id == Entrenamiento.rutina_id)
        .join(Ejercicio, Ejercicio.id == Serie.ejercicio_id)
        .join(GrupoMuscular, GrupoMuscular.id == Ejercicio.grupo_muscular_id)
        .where(
            Entrenamiento.usuario_id == usuario_id,
            Entrenamiento.fecha >= desde,
            Entrenamiento.fecha <= hasta,
        )
        .group_by(Entrenamiento.fecha, Rutina.id, GrupoMuscular.id)
    ).all()

    evoluciones = []
    for vista in vistas:
        barras = [_Barra() for _ in vista.barras]
        for fecha, rutina, grupo, volumen, series in filas:
            indice = vista.indice(fecha)
            if indice is None:
                continue
            barra = barras[indice]
            barra.volumen += volumen
            barra.rutinas.setdefault(
                rutina.id, VolumenDeRutina(rutina, Decimal(0))
            ).volumen += volumen
            barra.grupos.setdefault(grupo.id, SeriesDeGrupo(grupo, 0)).series += series
        referencia = _referencia(db, usuario_id, vista.unidad, vista.terminados[0][0])
        evoluciones.append(_evolucion(vista, barras, referencia))

    return Resumen(
        mes=primero,
        por_semana=evoluciones[0],
        por_mes=evoluciones[1],
        constancia=_constancia(db, usuario_id, primero.year),
    )
