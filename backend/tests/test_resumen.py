"""Tests de la pantalla de resumen: `GET /resumen?mes=AAAA-MM`.

Dos cosas que calcula el backend: la gráfica de volumen, por semana y por mes, y
la constancia del año del mes pedido. Cada vista trae ocho barras terminadas
(decisión del autor: una semana o un mes a medias no se compara con uno entero)
y, si el periodo de hoy cae en la ventana del mes pedido, la barra en curso con
lo que va de él. Cada barra lleva su cambio sobre el último periodo anterior con
volumen, aunque quede fuera de la gráfica (`comparado_con`), y su desglose
(volumen por rutina y series por grupo muscular), que es lo que la pantalla
enseña al elegirla. No hay filtros de rutina.

Casi todos congelan el reloj con `hoy_es`. Fechas de referencia: el 16 de
septiembre de 2026 es miércoles; el 1 de octubre, jueves; el 6 de octubre,
martes. Pidiendo septiembre el 6 de octubre, las semanas van del lunes 10 de
agosto al domingo 4 de octubre y los meses de febrero a septiembre, sin barra en
curso; pidiendo octubre ese día, las mismas barras terminadas y, en curso, la
semana del 5 al 11 de octubre y el mes de octubre.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event

from app.database import engine
from app.models import Entrenamiento, Programa, ProgramaDia, ProgramaPeriodo, Serie
from tests.ayudas import ejercicio_de_prueba, hueco_en_bd, rutina_en_bd, serie_en
from tests.semana import HOY, LUNES_7, LUNES_14, MARTES_15, VIERNES_18

SEPTIEMBRE = "2026-09"
OCTUBRE = "2026-10"
MARTES_6_OCT = date(2026, 10, 6)
# La primera semana de la gráfica pidiendo septiembre u octubre el 6 de octubre.
LUNES_10_AGO = date(2026, 8, 10)


# --- Ayudas -----------------------------------------------------------------


def pedir(cliente, mes=None) -> dict:
    """El resumen del mes (o el de hoy, sin `mes`); falla si no da 200."""
    respuesta = cliente.get("/resumen", params={"mes": mes} if mes else None)
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def rutina(cliente, nombre) -> int:
    respuesta = cliente.post("/rutinas", json={"nombre": nombre})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def sesion_con_series(cliente, fecha, rutina_id, ejercicio_id, *series, cubre_fecha=None, **campos):
    """Una sesión con sus series, cada una `(peso, repeticiones)`. Devuelve su id.

    `campos` pasa a cada serie (por ejemplo, `slot_id` para apuntarla a un comodín).
    """
    cuerpo = {"rutina_id": rutina_id, "fecha": fecha.isoformat()}
    if cubre_fecha is not None:
        cuerpo["cubre_fecha"] = cubre_fecha.isoformat()
    respuesta = cliente.post("/entrenamientos", json=cuerpo)
    assert respuesta.status_code == 201, respuesta.text
    entrenamiento_id = respuesta.json()["id"]
    for numero, (peso, repeticiones) in enumerate(series, start=1):
        respuesta = serie_en(
            cliente,
            entrenamiento_id,
            ejercicio_id,
            numero=numero,
            peso=peso,
            repeticiones=repeticiones,
            **campos,
        )
        assert respuesta.status_code == 201, respuesta.text
    return entrenamiento_id


def volumenes(evolucion) -> list[Decimal]:
    """Los volúmenes de las barras terminadas (sin la en curso)."""
    return [Decimal(periodo["volumen"]) for periodo in evolucion["periodos"]]


def fechas(evolucion) -> list[tuple[date, date]]:
    """El `desde` y el `hasta` de las barras terminadas (sin la en curso)."""
    return [
        (date.fromisoformat(periodo["desde"]), date.fromisoformat(periodo["hasta"]))
        for periodo in evolucion["periodos"]
    ]


def barra(evolucion, desde: date) -> dict:
    """La barra que empieza en `desde`, terminada o en curso."""
    barras = evolucion["periodos"] + ([evolucion["en_curso"]] if evolucion["en_curso"] else [])
    return next(periodo for periodo in barras if periodo["desde"] == desde.isoformat())


def todas_las_barras(evolucion) -> list[dict]:
    return evolucion["periodos"] + ([evolucion["en_curso"]] if evolucion["en_curso"] else [])


def cambio(periodo) -> tuple:
    """`(cambio, comparado_con)` de una barra, con la fecha como `date`."""
    comparado = periodo["comparado_con"]
    return periodo["cambio"], date.fromisoformat(comparado) if comparado else None


def por_rutina(periodo) -> list[tuple[str, str]]:
    return [(fila["rutina"]["nombre"], fila["volumen"]) for fila in periodo["volumen_por_rutina"]]


def por_grupo(periodo) -> list[tuple[int, int]]:
    return [(fila["grupo_muscular"]["id"], fila["series"]) for fila in periodo["series_por_grupo"]]


def ultimo_dia(primero: date) -> date:
    siguiente = date(primero.year + primero.month // 12, primero.month % 12 + 1, 1)
    return siguiente - timedelta(days=1)


@pytest.fixture
def ejercicio_id(cliente, grupo_muscular_id) -> int:
    return ejercicio_de_prueba(cliente, grupo_muscular_id, "Press banca")


# --- El parámetro `mes` -----------------------------------------------------


@pytest.mark.parametrize(
    "mes",
    ["2026-13", "2026-00", "2026-9", "septiembre", "1999-01", "2100-01", "2026-09-01", ""],
)
def test_un_mes_mal_escrito_da_422(cliente, hoy_es, mes):
    """El formato es `AAAA-MM`, con años de 2000 a 2099: más allá, restar meses
    para la ventana se saldría del calendario.
    """
    hoy_es(HOY)

    respuesta = cliente.get(f"/resumen?mes={mes}")

    assert respuesta.status_code == 422


@pytest.mark.parametrize(
    "mes, nombre",
    [("2026-10", "Octubre de 2026"), ("2027-01", "Enero de 2027")],
)
def test_un_mes_que_no_ha_llegado_da_422_con_su_mensaje(cliente, hoy_es, mes, nombre):
    hoy_es(date(2026, 9, 30))

    respuesta = cliente.get("/resumen", params={"mes": mes})

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == (
        f"{nombre} todavía no ha llegado: el resumen es de lo ya entrenado."
    )


def test_el_mes_actual_se_puede_pedir_desde_su_dia_1(cliente, hoy_es):
    hoy_es(date(2026, 10, 1))

    assert pedir(cliente, OCTUBRE)["mes"] == "2026-10-01"


def test_el_primer_mes_admitido_no_se_sale_del_calendario(cliente, hoy_es):
    """Enero de 2000 resta siete meses y llega a 1999 para la gráfica mensual."""
    hoy_es(HOY)

    datos = pedir(cliente, "2000-01")

    assert fechas(datos["por_mes"])[0] == (date(1999, 6, 1), date(1999, 6, 30))


def test_sin_mes_es_el_de_hoy(cliente, hoy_es):
    hoy_es(HOY)

    assert pedir(cliente) == pedir(cliente, SEPTIEMBRE)
    assert pedir(cliente)["mes"] == "2026-09-01"


def test_un_usuario_sin_nada_recibe_todo_a_cero(cliente, hoy_es):
    """El 16 de septiembre, pidiendo septiembre: hay barra en curso en las dos
    vistas, y sale aunque esté vacía.
    """
    hoy_es(HOY)

    datos = pedir(cliente)

    assert set(datos) == {"mes", "por_semana", "por_mes", "constancia"}
    for vista in (datos["por_semana"], datos["por_mes"]):
        assert len(vista["periodos"]) == 8
        assert vista["en_curso"] is not None
        for periodo in todas_las_barras(vista):
            assert periodo["volumen"] == "0.00"
            assert (periodo["cambio"], periodo["comparado_con"]) == (None, None)
            assert periodo["volumen_por_rutina"] == []
            assert periodo["series_por_grupo"] == []
    constancia = datos["constancia"]
    assert [m["mes"] for m in constancia["meses"]] == [
        date(2026, n, 1).isoformat() for n in range(1, 13)
    ]
    assert all(
        (m["entrenados"], m["planificados"], m["por_llegar"]) == (0, 0, 0)
        for m in constancia["meses"]
    )
    assert (constancia["entrenados"], constancia["planificados"]) == (0, 0)


# --- Las ventanas: ocho terminadas y la en curso ----------------------------


@pytest.mark.parametrize(
    "hoy, mes, ultima_semana, primer_mes, ultimo_mes, semana_en_curso, mes_en_curso",
    [
        pytest.param(
            HOY,
            SEPTIEMBRE,
            LUNES_7,
            date(2026, 1, 1),
            date(2026, 8, 1),
            LUNES_14,
            date(2026, 9, 1),
            id="mes-actual:-la-ultima-semana-acabada-y-el-mes-anterior",
        ),
        pytest.param(
            HOY,
            "2026-08",
            date(2026, 8, 31),
            date(2026, 1, 1),
            date(2026, 8, 1),
            None,
            None,
            id="mes-pasado:-la-semana-de-su-ultimo-dia-aunque-cruce-de-mes",
        ),
        pytest.param(
            date(2026, 10, 4),
            SEPTIEMBRE,
            date(2026, 9, 21),
            date(2026, 2, 1),
            date(2026, 9, 1),
            date(2026, 9, 28),
            None,
            id="hoy-domingo:-su-semana-no-ha-acabado-y-es-la-en-curso",
        ),
        pytest.param(
            date(2026, 10, 5),
            SEPTIEMBRE,
            date(2026, 9, 28),
            date(2026, 2, 1),
            date(2026, 9, 1),
            None,
            None,
            id="hoy-lunes:-la-semana-acabo-ayer",
        ),
        pytest.param(
            date(2026, 10, 1),
            OCTUBRE,
            date(2026, 9, 21),
            date(2026, 2, 1),
            date(2026, 9, 1),
            date(2026, 9, 28),
            date(2026, 10, 1),
            id="dia-1-del-mes-actual",
        ),
        pytest.param(
            HOY,
            "2026-02",
            date(2026, 2, 23),
            date(2025, 7, 1),
            date(2026, 2, 1),
            None,
            None,
            id="meses-que-cruzan-de-año",
        ),
        pytest.param(
            date(2026, 1, 15),
            "2026-01",
            date(2026, 1, 5),
            date(2025, 5, 1),
            date(2025, 12, 1),
            date(2026, 1, 12),
            date(2026, 1, 1),
            id="enero-actual:-los-meses-acaban-en-diciembre-del-año-anterior",
        ),
    ],
)
def test_las_graficas_traen_periodos_terminados_y_el_en_curso(
    cliente, hoy_es, hoy, mes, ultima_semana, primer_mes, ultimo_mes, semana_en_curso, mes_en_curso
):
    hoy_es(hoy)

    datos = pedir(cliente, mes)

    semanas = fechas(datos["por_semana"])
    assert len(semanas) == 8
    assert semanas[-1] == (ultima_semana, ultima_semana + timedelta(days=6))
    for (desde, hasta), (siguiente, _) in zip(semanas, semanas[1:] + [(None, None)]):
        assert desde.weekday() == 0 and hasta == desde + timedelta(days=6)
        assert siguiente is None or siguiente == hasta + timedelta(days=1)
    assert semanas[-1][1] < hoy

    meses = fechas(datos["por_mes"])
    assert len(meses) == 8
    assert meses[0][0] == primer_mes
    assert meses[-1][0] == ultimo_mes
    for (desde, hasta), (siguiente, _) in zip(meses, meses[1:] + [(None, None)]):
        assert desde.day == 1 and hasta == ultimo_dia(desde)
        assert siguiente is None or siguiente == hasta + timedelta(days=1)
    assert meses[-1][1] < hoy

    en_curso = datos["por_semana"]["en_curso"]
    if semana_en_curso is None:
        assert en_curso is None
    else:
        desde = date.fromisoformat(en_curso["desde"])
        assert desde == semana_en_curso
        assert date.fromisoformat(en_curso["hasta"]) == desde + timedelta(days=6)
        assert desde <= hoy <= desde + timedelta(days=6)
        # Va justo detrás de la última terminada.
        assert desde == semanas[-1][1] + timedelta(days=1)

    en_curso = datos["por_mes"]["en_curso"]
    if mes_en_curso is None:
        assert en_curso is None
    else:
        desde = date.fromisoformat(en_curso["desde"])
        assert desde == mes_en_curso
        assert date.fromisoformat(en_curso["hasta"]) == ultimo_dia(desde)
        assert desde == meses[-1][1] + timedelta(days=1)


def test_las_claves_de_la_respuesta(cliente, hoy_es):
    """Decisión del autor: con solo periodos terminados, `completo` sobra. Sin
    filtros de rutina, la evolución no lleva `rutina_id`, y el cambio va en cada
    barra.
    """
    hoy_es(HOY)

    vista = pedir(cliente)["por_semana"]

    assert set(vista) == {"periodos", "en_curso"}
    for periodo in (vista["periodos"][0], vista["en_curso"]):
        assert set(periodo) == {
            "desde",
            "hasta",
            "volumen",
            "cambio",
            "comparado_con",
            "volumen_por_rutina",
            "series_por_grupo",
        }


def test_septiembre_pedido_el_1_de_octubre_trae_la_semana_en_curso_y_no_el_mes(
    cliente, hoy_es, ejercicio_id
):
    """La semana del 28 de septiembre al 4 de octubre sigue en marcha y cae en la
    ventana de septiembre: es su barra en curso, con lo de los dos meses.
    Septiembre ya acabó, así que es su última barra terminada y no hay mes en curso.
    """
    hoy_es(date(2026, 9, 29))
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 9, 29), push, ejercicio_id, (100, 1))
    hoy_es(date(2026, 10, 1))
    sesion_con_series(cliente, date(2026, 10, 1), push, ejercicio_id, (50, 2))

    datos = pedir(cliente, SEPTIEMBRE)

    semana = datos["por_semana"]["en_curso"]
    assert (semana["desde"], semana["hasta"]) == ("2026-09-28", "2026-10-04")
    assert semana["volumen"] == "200.00"
    assert por_rutina(semana) == [("Push", "200.00")]
    assert semana["series_por_grupo"][0]["series"] == 2
    assert fechas(datos["por_semana"])[-1] == (date(2026, 9, 21), date(2026, 9, 27))
    assert datos["por_mes"]["en_curso"] is None
    septiembre = barra(datos["por_mes"], date(2026, 9, 1))
    assert septiembre is datos["por_mes"]["periodos"][-1]
    assert septiembre["volumen"] == "100.00"


def test_la_constancia_es_del_año_del_mes_pedido(cliente, hoy_es):
    hoy_es(date(2026, 1, 15))

    datos = pedir(cliente, "2025-11")

    assert datos["constancia"]["meses"][0]["mes"] == "2025-01-01"
    assert datos["constancia"]["meses"][-1]["mes"] == "2025-12-01"


# --- Volumen -----------------------------------------------------------------


def test_el_volumen_es_la_suma_de_peso_por_repeticiones(cliente, hoy_es, ejercicio_id):
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 9, 22), push, ejercicio_id, (22.5, 10), (20, 8))
    # Una serie sin peso cuenta como serie, pero no suma volumen.
    sesion_con_series(cliente, date(2026, 9, 24), push, ejercicio_id, (0, 12))

    datos = pedir(cliente, SEPTIEMBRE)

    semanas = datos["por_semana"]
    assert fechas(semanas)[-2] == (date(2026, 9, 21), date(2026, 9, 27))
    assert [p["volumen"] for p in semanas["periodos"]] == ["0.00"] * 6 + ["385.00", "0.00"]
    semana = barra(semanas, date(2026, 9, 21))
    assert semana["volumen_por_rutina"] == [
        {"rutina": {"id": push, "nombre": "Push", "oculto_desde": None}, "volumen": "385.00"}
    ]
    assert semana["series_por_grupo"][0]["series"] == 3
    assert semanas["en_curso"] is None
    assert datos["por_mes"]["en_curso"] is None


def test_la_semana_que_cruza_de_mes_se_cuenta_entera(cliente, hoy_es, ejercicio_id):
    """La última semana de septiembre va del 28 al 4 de octubre: suma lo de los dos
    meses, mientras que la gráfica mensual separa cada mes.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 9, 29), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 10, 2), push, ejercicio_id, (50, 1))

    pasado = pedir(cliente, SEPTIEMBRE)
    actual = pedir(cliente, OCTUBRE)

    for datos in (pasado, actual):
        assert fechas(datos["por_semana"])[-1] == (date(2026, 9, 28), date(2026, 10, 4))
        assert volumenes(datos["por_semana"])[-1] == Decimal("150")
        assert por_rutina(datos["por_semana"]["periodos"][-1]) == [("Push", "150.00")]
        # Octubre no ha acabado: el último mes terminado de las dos es septiembre.
        assert fechas(datos["por_mes"])[-1] == (date(2026, 9, 1), date(2026, 9, 30))
        assert volumenes(datos["por_mes"])[-1] == Decimal("100")
        assert por_rutina(datos["por_mes"]["periodos"][-1]) == [("Push", "100.00")]
    octubre = actual["por_mes"]["en_curso"]
    assert octubre["volumen"] == "50.00"
    assert por_rutina(octubre) == [("Push", "50.00")]
    semana = actual["por_semana"]["en_curso"]
    assert (semana["desde"], semana["hasta"]) == ("2026-10-05", "2026-10-11")
    assert semana["volumen"] == "0.00"
    assert semana["volumen_por_rutina"] == semana["series_por_grupo"] == []


def test_lo_de_la_semana_y_el_mes_en_curso_sale_solo_en_la_barra_en_curso(
    cliente, hoy_es, ejercicio_id
):
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 10, 5), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, MARTES_6_OCT, push, ejercicio_id, (100, 1))

    datos = pedir(cliente, OCTUBRE)

    for vista, desde in ((datos["por_semana"], "2026-10-05"), (datos["por_mes"], "2026-10-01")):
        assert sum(volumenes(vista)) == 0
        en_curso = vista["en_curso"]
        assert en_curso["desde"] == desde
        assert en_curso["volumen"] == "200.00"
        assert por_rutina(en_curso) == [("Push", "200.00")]
        assert en_curso["series_por_grupo"][0]["series"] == 2
        assert cambio(en_curso) == (None, None)


def test_los_meses_de_la_grafica_cruzan_de_año(cliente, hoy_es, ejercicio_id):
    hoy_es(HOY)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2025, 7, 1), push, ejercicio_id, (10, 1))
    sesion_con_series(cliente, date(2025, 12, 31), push, ejercicio_id, (20, 1))
    sesion_con_series(cliente, date(2026, 2, 28), push, ejercicio_id, (30, 1))
    # Justo fuera de la ventana: no suma en ninguna barra, pero es con lo que se
    # compara la primera.
    sesion_con_series(cliente, date(2025, 6, 30), push, ejercicio_id, (1000, 1))

    meses = pedir(cliente, "2026-02")["por_mes"]

    assert volumenes(meses) == [Decimal(n) for n in (10, 0, 0, 0, 0, 20, 0, 30)]
    assert cambio(meses["periodos"][0]) == (-99.0, date(2025, 6, 1))
    assert cambio(meses["periodos"][5]) == (100.0, date(2025, 7, 1))
    assert cambio(meses["periodos"][7]) == (50.0, date(2025, 12, 1))


@pytest.mark.parametrize(
    "anterior, ultimo, esperado",
    [
        pytest.param(300, 400, (33.3, date(2026, 9, 21)), id="sube"),
        pytest.param(200, 150, (-25.0, date(2026, 9, 21)), id="baja"),
        pytest.param(100, 100, (0.0, date(2026, 9, 21)), id="igual"),
        pytest.param(0, 100, (None, None), id="sin-anterior"),
        pytest.param(100, 0, (None, None), id="sin-ultimo"),
        pytest.param(0, 0, (None, None), id="sin-nada"),
    ],
)
def test_el_cambio_compara_el_ultimo_periodo_con_el_anterior(
    cliente, hoy_es, ejercicio_id, anterior, ultimo, esperado
):
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    # Las dos últimas semanas: la del 21 y la del 28 de septiembre.
    if anterior:
        sesion_con_series(cliente, date(2026, 9, 22), push, ejercicio_id, (anterior, 1))
    if ultimo:
        sesion_con_series(cliente, date(2026, 9, 29), push, ejercicio_id, (ultimo, 1))

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    assert volumenes(semanas)[-2:] == [Decimal(anterior), Decimal(ultimo)]
    assert cambio(semanas["periodos"][-1]) == esperado


@pytest.mark.parametrize(
    "anterior, ultimo, esperado",
    [
        pytest.param(160, 170, 6.3, id="sube-6,25"),
        pytest.param(160, 150, -6.3, id="baja-6,25"),
    ],
)
def test_el_cambio_redondea_las_medias_decimas_hacia_fuera(
    cliente, hoy_es, ejercicio_id, anterior, ultimo, esperado
):
    """De 160 a 170 kg es un 6,25 % exacto: sale 6,3, el redondeo de siempre.

    Antes se redondeaba con `round(float(...), 1)`, que en los empates va al par, y
    salía 6,2 (y −6,2 al bajar).
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 9, 22), push, ejercicio_id, (anterior, 1))
    sesion_con_series(cliente, date(2026, 9, 29), push, ejercicio_id, (ultimo, 1))

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    assert cambio(semanas["periodos"][-1]) == (esperado, date(2026, 9, 21))


def test_el_cambio_mensual_usa_los_dos_ultimos_meses_terminados(cliente, hoy_es, ejercicio_id):
    """En el mes actual, el último mes terminado es el anterior: lo de octubre va en
    la barra en curso, que se compara con septiembre.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 8, 3), push, ejercicio_id, (200, 1))
    sesion_con_series(cliente, date(2026, 9, 7), push, ejercicio_id, (300, 1))
    sesion_con_series(cliente, date(2026, 10, 1), push, ejercicio_id, (1000, 1))

    octubre = pedir(cliente, OCTUBRE)["por_mes"]
    septiembre = pedir(cliente, SEPTIEMBRE)["por_mes"]

    assert cambio(octubre["periodos"][-1]) == (50.0, date(2026, 8, 1))
    assert octubre["en_curso"]["volumen"] == "1000.00"
    assert cambio(octubre["en_curso"]) == (233.3, date(2026, 9, 1))
    assert cambio(septiembre["periodos"][-1]) == (50.0, date(2026, 8, 1))
    assert septiembre["en_curso"] is None


def test_el_cambio_salta_las_barras_vacias(cliente, hoy_es, ejercicio_id):
    """Volumen solo en la segunda y la quinta semana: la quinta se compara con la
    segunda, y las vacías no tienen cambio.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 8, 18), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 9, 8), push, ejercicio_id, (150, 1))

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    assert fechas(semanas)[1][0] == date(2026, 8, 17)
    assert fechas(semanas)[4][0] == date(2026, 9, 7)
    assert [cambio(p) for p in semanas["periodos"]] == [
        (None, None),
        (None, None),  # la segunda: no hay nada antes
        (None, None),
        (None, None),
        (50.0, date(2026, 8, 17)),
        (None, None),
        (None, None),
        (None, None),
    ]


def test_una_barra_a_cero_entre_dos_con_volumen_no_tiene_cambio(cliente, hoy_es, ejercicio_id):
    """Julio sin entrenar, entre junio y agosto: julio sin cambio (no es −100 %) y
    agosto comparado con junio.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 6, 10), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 8, 10), push, ejercicio_id, (300, 1))

    meses = pedir(cliente, SEPTIEMBRE)["por_mes"]

    assert cambio(barra(meses, date(2026, 7, 1))) == (None, None)
    assert cambio(barra(meses, date(2026, 8, 1))) == (200.0, date(2026, 6, 1))
    assert cambio(barra(meses, date(2026, 9, 1))) == (None, None)


def test_la_primera_barra_se_compara_con_una_semana_de_hace_un_año(cliente, hoy_es, ejercicio_id):
    """Sin límite de antigüedad: lo último entrenado antes de la gráfica fue el
    martes 12 de agosto de 2025; `comparado_con` es el lunes de esa semana.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2025, 8, 12), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, LUNES_10_AGO, push, ejercicio_id, (120, 1))

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    assert fechas(semanas)[0][0] == LUNES_10_AGO
    assert cambio(semanas["periodos"][0]) == (20.0, date(2025, 8, 11))


def test_la_referencia_anterior_suma_la_semana_entera(cliente, hoy_es, ejercicio_id):
    """Dos sesiones de rutinas distintas en la semana del 3 de agosto, antes de la
    gráfica: la referencia es su suma (200), no una de ellas.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    pull = rutina(cliente, "Pull")
    sesion_con_series(cliente, date(2026, 8, 4), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 8, 6), pull, ejercicio_id, (50, 2))
    sesion_con_series(cliente, LUNES_10_AGO, push, ejercicio_id, (300, 1))

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    assert cambio(semanas["periodos"][0]) == (50.0, date(2026, 8, 3))


def test_la_referencia_anterior_respeta_los_limites_de_semana_y_de_mes(
    cliente, hoy_es, ejercicio_id
):
    """El domingo 9 de agosto es de la semana del lunes 3, no de la del 10 (la
    semana de Postgres empieza en lunes, como la de la gráfica). El 31 de enero es
    de enero, no de febrero, primer mes de la gráfica.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 1, 31), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 2, 1), push, ejercicio_id, (150, 1))
    sesion_con_series(cliente, date(2026, 8, 9), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, LUNES_10_AGO, push, ejercicio_id, (200, 1))

    datos = pedir(cliente, SEPTIEMBRE)

    semanas, meses = datos["por_semana"], datos["por_mes"]
    assert volumenes(semanas)[0] == Decimal("200")
    assert cambio(semanas["periodos"][0]) == (100.0, date(2026, 8, 3))
    assert fechas(meses)[0][0] == date(2026, 2, 1)
    assert volumenes(meses)[0] == Decimal("150")
    assert cambio(meses["periodos"][0]) == (50.0, date(2026, 1, 1))


def test_una_barra_solo_con_series_sin_peso(cliente, hoy_es, ejercicio_id, grupo_muscular_id):
    """Sus series cuentan y su rutina sale con 0 kg, pero no tiene cambio ni sirve
    de referencia: la siguiente se compara con una anterior a ella.
    """
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 8, 18), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 9, 1), push, ejercicio_id, (0, 10), (0, 10))
    sesion_con_series(cliente, date(2026, 9, 8), push, ejercicio_id, (150, 1))

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    vacia = barra(semanas, date(2026, 8, 31))
    assert vacia["volumen"] == "0.00"
    assert cambio(vacia) == (None, None)
    assert por_rutina(vacia) == [("Push", "0.00")]
    assert por_grupo(vacia) == [(grupo_muscular_id, 2)]
    assert cambio(barra(semanas, date(2026, 9, 7))) == (50.0, date(2026, 8, 17))


def test_la_referencia_anterior_salta_los_periodos_solo_con_series_sin_peso(
    cliente, hoy_es, ejercicio_id
):
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 7, 21), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 8, 4), push, ejercicio_id, (0, 10))
    sesion_con_series(cliente, LUNES_10_AGO, push, ejercicio_id, (150, 1))

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    assert cambio(semanas["periodos"][0]) == (50.0, date(2026, 7, 20))


def test_comparado_con_cruza_de_año(cliente, hoy_es, ejercicio_id):
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2025, 12, 30), push, ejercicio_id, (100, 1))
    sesion_con_series(cliente, date(2026, 1, 6), push, ejercicio_id, (200, 1))

    datos = pedir(cliente, "2026-01")

    assert cambio(barra(datos["por_semana"], date(2026, 1, 5))) == (100.0, date(2025, 12, 29))
    assert cambio(barra(datos["por_mes"], date(2026, 1, 1))) == (100.0, date(2025, 12, 1))


def test_una_sesion_de_rutina_y_ejercicio_ocultos_sirve_de_referencia(
    cliente, hoy_es, grupo_muscular_id
):
    hoy_es(MARTES_6_OCT)
    antigua = rutina(cliente, "Antigua")
    push = rutina(cliente, "Push")
    retirado = ejercicio_de_prueba(cliente, grupo_muscular_id, "Ejercicio retirado")
    press = ejercicio_de_prueba(cliente, grupo_muscular_id, "Press banca")
    sesion_con_series(cliente, date(2026, 8, 4), antigua, retirado, (100, 1))
    sesion_con_series(cliente, LUNES_10_AGO, push, press, (150, 1))
    assert cliente.delete(f"/ejercicios/{retirado}?modo=ocultar").status_code == 204
    assert cliente.delete(f"/rutinas/{antigua}?modo=ocultar").status_code == 204

    semanas = pedir(cliente, SEPTIEMBRE)["por_semana"]

    assert cambio(semanas["periodos"][0]) == (50.0, date(2026, 8, 3))


@pytest.mark.parametrize(
    "sesiones, esperado",
    [
        pytest.param(
            [(date(2026, 9, 15), 100), (MARTES_6_OCT, 150)],
            (50.0, date(2026, 9, 14)),
            id="con-la-ultima-terminada-con-volumen",
        ),
        pytest.param(
            [(date(2026, 8, 4), 100), (MARTES_6_OCT, 120)],
            (20.0, date(2026, 8, 3)),
            id="con-las-ocho-vacias,-con-la-anterior-a-la-grafica",
        ),
        pytest.param(
            [(date(2026, 9, 15), 100)],
            (None, None),
            id="en-curso-vacia",
        ),
        pytest.param(
            [(date(2026, 9, 15), 100), (MARTES_6_OCT, 0)],
            (None, None),
            id="en-curso-solo-sin-peso",
        ),
    ],
)
def test_el_cambio_de_la_barra_en_curso(cliente, hoy_es, ejercicio_id, sesiones, esperado):
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    for fecha, peso in sesiones:
        sesion_con_series(cliente, fecha, push, ejercicio_id, (peso, 1))

    semanas = pedir(cliente, OCTUBRE)["por_semana"]

    assert semanas["en_curso"]["desde"] == "2026-10-05"
    assert cambio(semanas["en_curso"]) == esperado


def test_el_volumen_cuenta_lo_oculto_y_lo_sin_terminar(cliente, hoy_es, grupo_muscular_id):
    """Volumen es historial: cuentan las sesiones sin terminar, las que no cuentan
    para ningún día y las de rutinas o ejercicios ya ocultos. La rutina oculta sale
    en el desglose con su `oculto_desde`.
    """
    hoy_es(MARTES_6_OCT)
    antigua = rutina(cliente, "Antigua")
    push = rutina(cliente, "Push")
    retirado = ejercicio_de_prueba(cliente, grupo_muscular_id, "Ejercicio retirado")
    press = ejercicio_de_prueba(cliente, grupo_muscular_id, "Press banca")
    sesion_con_series(cliente, date(2026, 8, 12), antigua, retirado, (50, 10))
    sesion_con_series(cliente, date(2026, 9, 23), antigua, retirado, (40, 10), (40, 8))
    sesion_con_series(cliente, date(2026, 9, 30), push, press, (60, 5))
    terminada = sesion_con_series(cliente, date(2026, 10, 2), push, press, (70, 5))
    assert cliente.post(f"/entrenamientos/{terminada}/terminar").status_code == 200
    assert cliente.delete(f"/ejercicios/{retirado}?modo=ocultar").status_code == 204
    assert cliente.delete(f"/rutinas/{antigua}?modo=ocultar").status_code == 204

    datos = pedir(cliente, SEPTIEMBRE)

    assert volumenes(datos["por_semana"])[-2:] == [Decimal("720"), Decimal("650")]
    assert volumenes(datos["por_mes"])[-2:] == [Decimal("500"), Decimal("1020")]
    for vista in (datos["por_semana"], datos["por_mes"]):
        for periodo in todas_las_barras(vista):
            suma = sum(Decimal(fila["volumen"]) for fila in periodo["volumen_por_rutina"])
            assert suma == Decimal(periodo["volumen"])
    septiembre = barra(datos["por_mes"], date(2026, 9, 1))
    assert septiembre["volumen_por_rutina"] == [
        {
            "rutina": {
                "id": antigua,
                "nombre": "Antigua",
                "oculto_desde": MARTES_6_OCT.isoformat(),
            },
            "volumen": "720.00",
        },
        {"rutina": {"id": push, "nombre": "Push", "oculto_desde": None}, "volumen": "300.00"},
    ]


def test_la_sesion_abierta_de_hoy_cuenta_en_la_barra_en_curso(cliente, hoy_es, ejercicio_id):
    hoy_es(MARTES_6_OCT)
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, MARTES_6_OCT, push, ejercicio_id, (80, 5), (80, 5))
    assert cliente.get("/entrenamientos", params={"en_curso": True}).json()

    datos = pedir(cliente, OCTUBRE)

    for vista in (datos["por_semana"], datos["por_mes"]):
        assert por_rutina(vista["en_curso"]) == [("Push", "800.00")]
        assert vista["en_curso"]["series_por_grupo"][0]["series"] == 2


def test_el_volumen_va_por_la_fecha_real_y_la_constancia_por_el_dia_que_cuenta(
    cliente, hoy_es, ppl, grupo_muscular_id
):
    """El miércoles 30 de septiembre se adelanta el Leg del viernes 2 de octubre: su
    volumen y sus series son de septiembre, pero el día entrenado es de octubre.
    """
    hoy_es(date(2026, 9, 30))
    press = ejercicio_de_prueba(cliente, grupo_muscular_id, "Press banca")
    sesion_con_series(
        cliente, date(2026, 9, 30), ppl["Leg"], press, (100, 5), cubre_fecha=date(2026, 10, 2)
    )
    hoy_es(MARTES_6_OCT)

    septiembre = pedir(cliente, SEPTIEMBRE)
    octubre = pedir(cliente, OCTUBRE)

    mes = barra(septiembre["por_mes"], date(2026, 9, 1))
    assert por_rutina(mes) == [("Leg", "500.00")]
    assert mes["series_por_grupo"][0]["series"] == 1
    assert octubre["por_mes"]["en_curso"]["volumen_por_rutina"] == []
    assert octubre["por_mes"]["en_curso"]["series_por_grupo"] == []
    meses = septiembre["constancia"]["meses"]
    assert meses[9]["entrenados"] == 1  # octubre
    # El 30 tocaba Pull y no se hizo: falta en septiembre.
    assert meses[8]["entrenados"] == 0


# --- Desglose de cada barra --------------------------------------------------


def test_el_volumen_por_rutina_es_de_la_barra_y_de_mayor_a_menor(cliente, hoy_es, ejercicio_id):
    """Empates por nombre sin mirar mayúsculas."""
    hoy_es(MARTES_6_OCT)
    ids = {nombre: rutina(cliente, nombre) for nombre in ("Push", "Pull", "Leg", "Core", "Abs")}
    for fecha, nombre, peso in (
        (date(2026, 8, 31), "Leg", 5000),  # Agosto, aunque cae en la semana del 31.
        (date(2026, 9, 1), "Push", 100),
        (date(2026, 9, 2), "Pull", 150),
        (date(2026, 9, 3), "Pull", 150),
        (date(2026, 9, 4), "Core", 100),
        (date(2026, 9, 5), "Abs", 100),
        (date(2026, 10, 1), "Push", 5000),
    ):
        sesion_con_series(cliente, fecha, ids[nombre], ejercicio_id, (peso, 1))

    datos = pedir(cliente, SEPTIEMBRE)

    assert por_rutina(barra(datos["por_mes"], date(2026, 9, 1))) == [
        ("Pull", "300.00"),
        ("Abs", "100.00"),
        ("Core", "100.00"),
        ("Push", "100.00"),
    ]
    assert por_rutina(barra(datos["por_semana"], date(2026, 8, 31))) == [
        ("Leg", "5000.00"),
        ("Pull", "300.00"),
        ("Abs", "100.00"),
        ("Core", "100.00"),
        ("Push", "100.00"),
    ]
    assert por_rutina(barra(datos["por_semana"], date(2026, 9, 28))) == [("Push", "5000.00")]


def test_las_series_van_al_grupo_del_ejercicio_que_se_hizo(cliente, hoy_es):
    """Un comodín de otro grupo trabaja el suyo, no el del principal del hueco."""
    hoy_es(MARTES_6_OCT)
    grupos = cliente.get("/grupos-musculares").json()
    pecho, espalda = grupos[0], grupos[1]
    principal = ejercicio_de_prueba(cliente, pecho["id"], "Press banca")
    comodin = ejercicio_de_prueba(cliente, espalda["id"], "Remo")
    push = rutina(cliente, "Push")
    respuesta = cliente.post(
        f"/rutinas/{push}/slots",
        json={
            "ejercicio_principal_id": principal,
            "orden": 1,
            "series_objetivo": 3,
            "reps_min": 6,
            "reps_max": 12,
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    hueco = respuesta.json()["id"]
    respuesta = cliente.post(
        f"/rutinas/{push}/slots/{hueco}/alternativas", json={"ejercicio_id": comodin}
    )
    assert respuesta.status_code == 201, respuesta.text
    sesion_con_series(cliente, date(2026, 9, 1), push, principal, (60, 8), (0, 8), slot_id=hueco)
    sesion_con_series(
        cliente, date(2026, 9, 2), push, comodin, (50, 8), (50, 8), (50, 8), slot_id=hueco
    )
    # Agosto, pero de la semana del 31.
    sesion_con_series(cliente, date(2026, 8, 31), push, principal, *[(60, 8)] * 5, slot_id=hueco)

    datos = pedir(cliente, SEPTIEMBRE)

    septiembre = barra(datos["por_mes"], date(2026, 9, 1))
    assert por_grupo(septiembre) == [(espalda["id"], 3), (pecho["id"], 2)]
    assert septiembre["series_por_grupo"][0]["grupo_muscular"] == espalda
    semana = barra(datos["por_semana"], date(2026, 8, 31))
    assert por_grupo(semana) == [(pecho["id"], 7), (espalda["id"], 3)]


# --- Constancia --------------------------------------------------------------


def test_la_constancia_cuenta_cada_dia_en_el_mes_que_tocaba(cliente, ppl, hoy_es, ejercicio_id):
    """Hoy es el miércoles 16 de septiembre; Push lunes, Pull miércoles, Leg viernes
    desde el lunes 31 de agosto.

    - El Push del 31 de agosto se recupera el 1 de septiembre: cuenta en agosto.
    - Pull del 2 y Push del 7, hechos; el Leg del 18 se adelanta al 15.
    - El 4, 9, 11 y 14 se faltan. El Pull de hoy aún no es falta: está por llegar.
    - Una sesión el jueves 10 sin contar ningún día no entra.
    """
    hoy_es(date(2026, 9, 1))
    sesion_con_series(
        cliente, date(2026, 9, 1), ppl["Push"], ejercicio_id, (50, 5), cubre_fecha=date(2026, 8, 31)
    )
    hoy_es(HOY)
    for fecha, nombre, cubre in (
        (date(2026, 9, 2), "Pull", date(2026, 9, 2)),
        (LUNES_7, "Push", LUNES_7),
        (date(2026, 9, 10), "Leg", None),
        (MARTES_15, "Leg", VIERNES_18),
    ):
        sesion_con_series(cliente, fecha, ppl[nombre], ejercicio_id, (50, 5), cubre_fecha=cubre)

    constancia = pedir(cliente, SEPTIEMBRE)["constancia"]

    cifras = [(m["entrenados"], m["planificados"], m["por_llegar"]) for m in constancia["meses"]]
    assert cifras == [(0, 0, 0)] * 7 + [
        (1, 1, 0),  # agosto
        (3, 7, 6),  # septiembre: 2, 7, 18 entrenados; 4, 9, 11, 14 faltados; 16 y 5 más
        (0, 0, 13),  # octubre
        (0, 0, 13),  # noviembre
        (0, 0, 13),  # diciembre
    ]
    assert (constancia["entrenados"], constancia["planificados"]) == (4, 8)


def test_hoy_hecho_cuenta_como_entrenado(cliente, ppl, ejercicio_id):
    sesion_con_series(cliente, HOY, ppl["Pull"], ejercicio_id, (50, 5), cubre_fecha=HOY)

    septiembre = pedir(cliente, SEPTIEMBRE)["constancia"]["meses"][8]

    # Faltados el 2, 4, 7, 9, 11 y 14; por llegar del 18 al 30.
    assert (septiembre["entrenados"], septiembre["planificados"]) == (1, 1 + 6)
    assert septiembre["por_llegar"] == 6


def test_los_dias_de_una_rutina_oculta_no_cuentan(cliente, ppl, ejercicio_id):
    """Leg se oculta hoy: los viernes que quedan pasan a descanso, y los que ya
    pasaron siguen contando como faltados.
    """
    sesion_con_series(cliente, MARTES_15, ppl["Leg"], ejercicio_id, (50, 5))
    assert cliente.delete(f"/rutinas/{ppl['Leg']}?modo=ocultar").status_code == 204

    meses = pedir(cliente, SEPTIEMBRE)["constancia"]["meses"]

    # Septiembre: lunes 7 y 14, miércoles 2 y 9, viernes 4 y 11 faltados; hoy, 21, 23,
    # 28 y 30 por llegar; los viernes 18 y 25 ya no cuentan.
    assert (meses[8]["entrenados"], meses[8]["planificados"], meses[8]["por_llegar"]) == (0, 6, 5)
    assert meses[9]["por_llegar"] == 8  # octubre, sin sus cinco viernes


def test_la_constancia_coincide_con_el_seguimiento_del_plan(cliente, ppl, hoy_es, ejercicio_id):
    """Es la misma cuenta que hace el calendario con `/plan/seguimiento`."""
    hoy_es(date(2026, 9, 1))
    sesion_con_series(
        cliente, date(2026, 9, 1), ppl["Push"], ejercicio_id, (50, 5), cubre_fecha=date(2026, 8, 31)
    )
    hoy_es(HOY)
    sesion_con_series(cliente, LUNES_14, ppl["Push"], ejercicio_id, (50, 5), cubre_fecha=LUNES_14)
    sesion_con_series(cliente, MARTES_15, ppl["Leg"], ejercicio_id, (50, 5), cubre_fecha=VIERNES_18)

    constancia = pedir(cliente, SEPTIEMBRE)["constancia"]
    dias = cliente.get(
        "/plan/seguimiento", params={"desde": "2026-01-01", "hasta": "2026-12-31"}
    ).json()

    for mes in constancia["meses"]:
        del_mes = [d["estado"] for d in dias if d["fecha"][:7] == mes["mes"][:7]]
        entrenados = sum(e in ("hecho", "movido") for e in del_mes)
        assert mes["entrenados"] == entrenados
        assert mes["planificados"] == entrenados + del_mes.count("sin_hacer")
        assert mes["por_llegar"] == sum(e in ("pendiente", "proximo") for e in del_mes)
    assert constancia["entrenados"] == sum(m["entrenados"] for m in constancia["meses"])
    assert constancia["planificados"] == sum(m["planificados"] for m in constancia["meses"])


def test_en_un_año_pasado_no_hay_nada_por_llegar(cliente, ppl, hoy_es):
    hoy_es(date(2027, 1, 10))

    constancia = pedir(cliente, "2026-12")["constancia"]

    assert all(m["por_llegar"] == 0 for m in constancia["meses"])
    # 31 de agosto, y trece días de septiembre a diciembre, todos faltados.
    assert constancia["planificados"] == 1 + 13 * 4
    assert constancia["entrenados"] == 0


# --- Aislamiento y consultas -------------------------------------------------


def sesion_ajena(sesion_bd, usuario_id, rutina_id, hueco_id, ejercicio_id, fecha) -> None:
    entrenamiento = Entrenamiento(
        usuario_id=usuario_id, rutina_id=rutina_id, fecha=fecha, cubre_fecha=fecha
    )
    sesion_bd.add(entrenamiento)
    sesion_bd.flush()
    sesion_bd.add(
        Serie(
            entrenamiento_id=entrenamiento.id,
            slot_id=hueco_id,
            ejercicio_id=ejercicio_id,
            numero_serie=1,
            peso=Decimal("100"),
            repeticiones=10,
        )
    )


def test_lo_de_otro_usuario_no_sale_en_ninguna_tarjeta(
    cliente, hoy_es, ejercicio_id, sesion_bd, otro_usuario_id, ejercicio_predefinido_id
):
    """El otro tiene un programa activo y sesiones con series en las mismas fechas
    (una de hoy, en curso) y otra de hace casi un año, que no puede servir de
    referencia para el cambio.
    """
    hoy_es(MARTES_6_OCT)
    rutina_ajena = rutina_en_bd(sesion_bd, otro_usuario_id, "Push")
    hueco = hueco_en_bd(sesion_bd, rutina_ajena, ejercicio_predefinido_id)
    programa = Programa(usuario_id=otro_usuario_id, nombre="Ajeno")
    sesion_bd.add(programa)
    sesion_bd.flush()
    sesion_bd.add_all(
        [
            ProgramaDia(programa_id=programa.id, dia_semana=dia, rutina_id=rutina_ajena)
            for dia in range(1, 8)
        ]
        + [
            ProgramaPeriodo(
                programa_id=programa.id, usuario_id=otro_usuario_id, desde=date(2026, 1, 1)
            )
        ]
    )
    for fecha in (
        date(2025, 12, 1),
        date(2026, 8, 20),
        date(2026, 9, 29),
        date(2026, 10, 2),
        MARTES_6_OCT,
    ):
        sesion_ajena(
            sesion_bd, otro_usuario_id, rutina_ajena, hueco, ejercicio_predefinido_id, fecha
        )
    sesion_bd.commit()

    for mes in (SEPTIEMBRE, OCTUBRE, "2026-08"):
        datos = pedir(cliente, mes)
        if mes == OCTUBRE:
            assert datos["por_semana"]["en_curso"] and datos["por_mes"]["en_curso"]
        for vista in (datos["por_semana"], datos["por_mes"]):
            for periodo in todas_las_barras(vista):
                assert periodo["volumen"] == "0.00"
                assert cambio(periodo) == (None, None)
                assert periodo["volumen_por_rutina"] == periodo["series_por_grupo"] == []
        assert all(
            (m["entrenados"], m["planificados"], m["por_llegar"]) == (0, 0, 0)
            for m in datos["constancia"]["meses"]
        )

    # Con una sesión propia, la ajena de diciembre no le da con qué compararse.
    push = rutina(cliente, "Push")
    sesion_con_series(cliente, date(2026, 9, 22), push, ejercicio_id, (100, 1))
    datos = pedir(cliente, SEPTIEMBRE)
    semana = barra(datos["por_semana"], date(2026, 9, 21))
    assert semana["volumen"] == "100.00"
    assert cambio(semana) == (None, None)
    assert cambio(barra(datos["por_mes"], date(2026, 9, 1))) == (None, None)


def test_siempre_hace_las_mismas_consultas(cliente, ppl, hoy_es, grupo_muscular_id):
    """Una consulta por rutina, por periodo o por sesión haría lenta la pantalla:
    tienen que ser las mismas haya lo que haya. Son 11: el volumen y las series, la
    referencia anterior de cada vista y las del seguimiento del año.
    """

    def consultas(mes) -> int:
        contador = []

        def contar(*_):
            contador.append(1)

        event.listen(engine, "before_cursor_execute", contar)
        try:
            pedir(cliente, mes)
        finally:
            event.remove(engine, "before_cursor_execute", contar)
        return len(contador)

    grupos = [g["id"] for g in cliente.get("/grupos-musculares").json()[:3]]
    ejercicios = [
        ejercicio_de_prueba(cliente, grupo, f"Ejercicio {n}") for n, grupo in enumerate(grupos)
    ]
    # Con una sesión, no con ninguna: sin sesiones, SQLAlchemy se ahorra la carga de
    # sus rutinas en el seguimiento y sale una consulta menos.
    sesion_con_series(cliente, date(2026, 9, 2), ppl["Pull"], ejercicios[0], (20, 10))
    con_pocas = consultas(SEPTIEMBRE)

    otras = [rutina(cliente, nombre) for nombre in ("Brazos", "Core", "Hombro")]
    todas = [ppl["Push"], ppl["Pull"], ppl["Leg"], *otras]
    for n in range(12):
        fecha = date(2026, 3, 2) + timedelta(days=15 * n)
        sesion_con_series(
            cliente, fecha, todas[n % len(todas)], ejercicios[n % 3], (20, 10), (25, 8)
        )
    # Antes de las dos gráficas (la mensual empieza en enero de 2026): referencias.
    for n in range(4):
        fecha = date(2025, 10, 6) + timedelta(days=17 * n)
        sesion_con_series(cliente, fecha, todas[n], ejercicios[n % 3], (30, 10))
    # En la semana en curso (del 14 al 20 de septiembre).
    sesion_con_series(cliente, MARTES_15, ppl["Leg"], ejercicios[1], (40, 10))
    assert cliente.delete(f"/rutinas/{otras[0]}?modo=ocultar").status_code == 204
    con_muchas = consultas(SEPTIEMBRE)

    assert con_muchas == con_pocas <= 11
