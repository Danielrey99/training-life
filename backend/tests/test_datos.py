"""Tests de exportar, importar y borrar todos los datos (`/datos`).

Importar **sustituye todo** por lo del archivo, así que lo que más importa es que la
copia sea idéntica (nada se pierde por el camino, ni una fecha de creación, ni el
orden de los comodines), que un archivo malo no toque nada y que nada de esto
alcance a los ejercicios predefinidos, que vienen con la app y no son datos de nadie.
"""

import copy
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.database import Base
from app.models import (
    Ejercicio,
    Entrenamiento,
    ExcepcionDelPlan,
    GrupoMuscular,
    NotaEjercicio,
    Programa,
    ProgramaDia,
    ProgramaPeriodo,
    Rutina,
    RutinaSlot,
    Serie,
    SlotAlternativa,
)
from app.schemas import (
    ArchivoDeDatos,
    DiaDeArchivo,
    EjercicioDeArchivo,
    EntrenamientoDeArchivo,
    ExcepcionDeArchivo,
    NotaDeArchivo,
    PeriodoDeArchivo,
    ProgramaDeArchivo,
    RutinaDeArchivo,
    SerieDeArchivo,
    SlotDeArchivo,
)
from tests.ayudas import consultas_de, crear_ejercicio, entrenar, serie_en

HOY = date(2026, 9, 16)

NO_ES_UNA_COPIA = "Este archivo no es una copia de los datos de Training Life."
MAS_NUEVA = "Este archivo es de una versión más nueva de la app. Actualízala para cargarlo."
DANADO = "El archivo está dañado."
_AHORA = "2026-09-16T10:00:00+00:00"
NO_SE_CAMBIA_NADA = "No se puede cargar el archivo: no se ha cambiado nada."
# Lo que dicen `GET /datos/resumen` y la comprobación de importar sin datos.
CERO = {
    "ejercicios": 0,
    "notas": 0,
    "rutinas": 0,
    "programas": 0,
    "sesiones": 0,
    "series": 0,
    "primera_sesion": None,
    "ultima_sesion": None,
}


def instante(texto: str) -> datetime:
    return datetime.fromisoformat(texto)


# --- El escenario ------------------------------------------------------------


def _predefinidos(sesion_bd, cuantos: int) -> list[tuple[int, str]]:
    """Predefinidos sembrados (id, nombre), sin la sentadilla de la fixture."""
    return [
        tuple(fila)
        for fila in sesion_bd.execute(
            select(Ejercicio.id, Ejercicio.nombre)
            .where(
                Ejercicio.es_predefinido.is_(True),
                Ejercicio.nombre != "Sentadilla con barra",
            )
            .order_by(Ejercicio.id)
            .limit(cuantos)
        )
    ]


def montar_datos(sesion_bd, sentadilla_id, sesiones_extra=0) -> dict:
    """Todo lo que pueden tener los datos, directamente en la base y con cada campo
    opcional relleno en algún sitio (si no, una ida y vuelta que perdiera ese campo
    pasaría igual): ejercicios propios (uno oculto), notas (una de un predefinido que
    no se usa en nada más), una rutina visible con un hueco oculto y comodines en un
    orden que no es el de sus ids, una rutina oculta, un programa activo con un
    periodo cerrado y un día cambiado de rutina (fila cerrada), otro programa oculto,
    excepciones (una de descanso), sesiones terminadas, una cancelada y la de hoy en
    curso. Las marcas de tiempo llevan microsegundos para ver que se conservan.

    Los predefinidos: la sentadilla es principal; `comodin` solo comodín; `de_nota`
    solo tiene una nota; `de_serie` solo aparece en una serie (un comodín que se
    quitó) y `sin_usar` no lo usa nada.

    En una sesión, cada hueco se hace con un solo ejercicio (si no, importar su
    propio archivo daría 422): el press, el remo (comodín) y `de_serie` van cada uno
    en un hueco o una sesión distintos.
    """
    (comodin, de_nota, de_serie, sin_usar) = _predefinidos(sesion_bd, 4)
    grupo_id, grupo = sesion_bd.execute(
        select(GrupoMuscular.id, GrupoMuscular.nombre).order_by(GrupoMuscular.id)
    ).first()

    def ejercicio(nombre, **campos):
        fila = Ejercicio(
            nombre=nombre,
            grupo_muscular_id=grupo_id,
            created_at=instante("2026-08-01T09:15:00.123456+00:00"),
            updated_at=instante("2026-08-02T10:20:30.654321+00:00"),
            **campos,
        )
        sesion_bd.add(fila)
        sesion_bd.flush()
        return fila.id

    press = ejercicio("Press inclinado con mancuernas", descripcion="Banco a 30 grados")
    remo = ejercicio("Remo en máquina vieja", oculto_desde=date(2026, 8, 20))

    sesion_bd.add_all(
        [
            NotaEjercicio(
                ejercicio_id=press,
                nota="El banco del fondo cojea",
                created_at=instante("2026-08-03T08:00:00.000001+00:00"),
                updated_at=instante("2026-08-04T08:00:00.000002+00:00"),
            ),
            NotaEjercicio(
                ejercicio_id=de_nota[0],
                nota="Asiento en el 4",
                created_at=instante("2026-08-05T08:00:00+00:00"),
                updated_at=instante("2026-08-05T08:00:00+00:00"),
            ),
        ]
    )

    def rutina(nombre, **campos):
        fila = Rutina(
            nombre=nombre,
            created_at=instante("2026-08-06T07:00:00.111111+00:00"),
            updated_at=instante("2026-08-07T07:00:00.222222+00:00"),
            **campos,
        )
        sesion_bd.add(fila)
        sesion_bd.flush()
        return fila.id

    push = rutina("Push")
    pull = rutina("Pull", oculto_desde=date(2026, 9, 14))

    def hueco(rutina_id, principal, orden, **campos):
        fila = RutinaSlot(
            rutina_id=rutina_id,
            ejercicio_principal_id=principal,
            orden=orden,
            series_objetivo=4,
            reps_min=6,
            reps_max=10,
            created_at=instante("2026-08-08T06:00:00.333333+00:00"),
            updated_at=instante("2026-08-09T06:00:00.444444+00:00"),
            **campos,
        )
        sesion_bd.add(fila)
        sesion_bd.flush()
        return fila.id

    h1 = hueco(push, press, 1)
    h2 = hueco(push, sentadilla_id, 2)
    h3 = hueco(push, remo, 3, oculto_desde=date(2026, 9, 1))
    h4 = hueco(pull, press, 1)
    # El remo (id alto, propio) antes que el predefinido (id bajo): el orden de los
    # comodines es el de sus filas, no el de los ids de sus ejercicios.
    sesion_bd.add(SlotAlternativa(slot_id=h1, ejercicio_id=remo))
    sesion_bd.flush()
    sesion_bd.add(SlotAlternativa(slot_id=h1, ejercicio_id=comodin[0]))
    sesion_bd.flush()

    ppl = Programa(
        nombre="PPL",
        created_at=instante("2026-07-30T12:00:00.5+00:00"),
        updated_at=instante("2026-09-07T12:00:00.5+00:00"),
    )
    viejo = Programa(
        nombre="Viejo",
        oculto_desde=date(2026, 9, 1),
        created_at=instante("2026-07-01T12:00:00+00:00"),
        updated_at=instante("2026-09-01T12:00:00+00:00"),
    )
    sesion_bd.add_all([ppl, viejo])
    sesion_bd.flush()
    sesion_bd.add_all(
        [
            ProgramaDia(programa_id=ppl.id, dia_semana=1, rutina_id=push),
            ProgramaDia(programa_id=ppl.id, dia_semana=3, rutina_id=pull, hasta=date(2026, 9, 7)),
            ProgramaDia(programa_id=ppl.id, dia_semana=3, rutina_id=push, desde=date(2026, 9, 7)),
            ProgramaDia(programa_id=viejo.id, dia_semana=5, rutina_id=pull),
        ]
    )
    sesion_bd.flush()
    sesion_bd.add_all(
        [
            ProgramaPeriodo(
                programa_id=ppl.id,
                desde=date(2026, 8, 1),
                hasta=date(2026, 8, 15),
            ),
            ProgramaPeriodo(programa_id=ppl.id, desde=date(2026, 8, 31)),
            ProgramaPeriodo(
                programa_id=viejo.id,
                desde=date(2026, 8, 15),
                hasta=date(2026, 8, 31),
            ),
        ]
    )
    sesion_bd.flush()
    sesion_bd.add_all(
        [
            ExcepcionDelPlan(
                fecha=date(2026, 9, 12),
                rutina_id=push,
                created_at=instante("2026-09-10T20:00:00.777777+00:00"),
                updated_at=instante("2026-09-11T20:00:00.888888+00:00"),
            ),
            ExcepcionDelPlan(
                fecha=date(2026, 9, 13),
                rutina_id=None,
                created_at=instante("2026-09-10T20:00:00+00:00"),
                updated_at=instante("2026-09-10T20:00:00+00:00"),
            ),
        ]
    )
    sesion_bd.flush()

    def sesion(fecha, rutina_id, series=(), **campos):
        fila = Entrenamiento(
            rutina_id=rutina_id,
            fecha=fecha,
            created_at=datetime(fecha.year, fecha.month, fecha.day, 16, 0, 0, 1, timezone.utc),
            updated_at=datetime(fecha.year, fecha.month, fecha.day, 18, 0, 0, 2, timezone.utc),
            **campos,
        )
        sesion_bd.add(fila)
        sesion_bd.flush()
        for slot_id, ejercicio_id, numero, peso, reps, *resto in series:
            sesion_bd.add(
                Serie(
                    entrenamiento_id=fila.id,
                    slot_id=slot_id,
                    ejercicio_id=ejercicio_id,
                    numero_serie=numero,
                    peso=Decimal(peso),
                    repeticiones=reps,
                    created_at=instante("2026-09-07T17:01:02.030405+00:00"),
                    updated_at=instante("2026-09-07T17:05:06.070809+00:00"),
                    **(resto[0] if resto else {}),
                )
            )
            sesion_bd.flush()
        return fila.id

    terminada = instante("2026-09-07T18:30:12.345678+00:00")
    sesion(
        date(2026, 9, 7),
        push,
        [
            (h1, press, 1, "60", 8, {"variante": "agarre cerrado"}),
            (h2, sentadilla_id, 1, "100", 5),
            # Un comodín que se quitó, en el hueco del remo (el oculto).
            (h3, de_serie[0], 1, "40", 12),
        ],
        cubre_fecha=date(2026, 9, 7),
        notas="Buen día",
        terminada_en=terminada,
    )
    sesion(
        date(2026, 9, 9),
        push,
        # La sentadilla, la primera: los archivos malos de abajo estropean esa serie.
        [(h2, sentadilla_id, 1, "102.5", 5), (h1, remo, 1, "50", 10)],
        cubre_fecha=date(2026, 9, 9),
        terminada_en=terminada,
    )
    # Cancelada: terminó sin series.
    sesion(date(2026, 9, 10), pull, terminada_en=terminada)
    sesion(date(2026, 9, 11), pull, [(h4, press, 1, "62.5", 6)], terminada_en=terminada)
    for extra in range(sesiones_extra):
        sesion(date(2026, 6, 1 + extra), push, [(h2, sentadilla_id, 1, "90", 5)])
    # La de hoy, en curso.
    sesion(HOY, push, [(h1, press, 1, "62", 8)], cubre_fecha=HOY)
    sesion_bd.commit()

    return {
        "push": push,
        "pull": pull,
        "press": press,
        "remo": remo,
        "huecos": (h1, h2, h3, h4),
        "grupo": grupo,
        "comodin": comodin,
        "de_nota": de_nota,
        "de_serie": de_serie,
        "sin_usar": sin_usar,
        "ppl": ppl.id,
        "viejo": viejo.id,
    }


def exportado(cliente) -> dict:
    respuesta = cliente.get("/datos/exportar")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def sin_marca(archivo: dict) -> dict:
    """El archivo sin `exportado_en`, que cambia en cada exportación."""
    return {clave: valor for clave, valor in archivo.items() if clave != "exportado_en"}


def importar(cliente, archivo, **params):
    return cliente.post("/datos/importar", json=archivo, params=params)


def _foto(sesion_bd) -> dict:
    """Cada fila de las 11 tablas de datos, enteras y con todas sus columnas. De los
    ejercicios, solo los propios: los predefinidos no son datos de nadie.
    """
    sesion_bd.expire_all()

    def todo(modelo, *condiciones):
        consulta = select(*modelo.__table__.columns).where(*condiciones).order_by(modelo.id)
        return [tuple(fila) for fila in sesion_bd.execute(consulta)]

    return {
        "ejercicios": todo(Ejercicio, Ejercicio.es_predefinido.is_(False)),
        "notas": todo(NotaEjercicio),
        "rutinas": todo(Rutina),
        "huecos": todo(RutinaSlot),
        "comodines": todo(SlotAlternativa),
        "programas": todo(Programa),
        "dias": todo(ProgramaDia),
        "periodos": todo(ProgramaPeriodo),
        "excepciones": todo(ExcepcionDelPlan),
        "sesiones": todo(Entrenamiento),
        "series": todo(Serie),
    }


def _nada(sesion_bd) -> bool:
    return all(filas == [] for filas in _foto(sesion_bd).values())


# --- Comparar sin los ids ----------------------------------------------------
#
# Importar asigna ids nuevos, así que dos exportaciones (o dos respuestas de /plan)
# solo se comparan cambiando cada id por su orden de aparición, por separado para
# cada clase de cosa: así dos copias son iguales si y solo si enlazan lo mismo con
# lo mismo.

ESPACIO_DE_CLAVE = {
    "ejercicio_id": "ejercicio",
    "ejercicio_principal_id": "ejercicio",
    "alternativa_ids": "ejercicio",
    "rutina_id": "rutina",
    "slot_id": "hueco",
}
ESPACIO_DEL_ID = {
    "ejercicios": "ejercicio",
    "predefinidos": "ejercicio",
    "ejercicio": "ejercicio",
    "ejercicio_principal": "ejercicio",
    "alternativas": "ejercicio",
    "rutinas": "rutina",
    "rutina": "rutina",
    "slots": "hueco",
}


def sin_ids(datos):
    vistos: dict[tuple[str, int], int] = {}

    def renumerar(espacio, valor):
        if not isinstance(valor, int) or isinstance(valor, bool):
            return valor
        return vistos.setdefault((espacio, valor), len(vistos))

    def recorrer(valor, padre):
        if isinstance(valor, list):
            return [recorrer(elemento, padre) for elemento in valor]
        if not isinstance(valor, dict):
            return valor
        resultado = {}
        for clave, dentro in valor.items():
            if clave == "exportado_en":
                continue
            if clave == "id":
                resultado[clave] = renumerar(ESPACIO_DEL_ID.get(padre, padre), dentro)
            elif clave.endswith("_id") or clave.endswith("_ids"):
                espacio = ESPACIO_DE_CLAVE.get(clave, clave.removesuffix("s").removesuffix("_id"))
                if isinstance(dentro, list):
                    resultado[clave] = [renumerar(espacio, x) for x in dentro]
                else:
                    resultado[clave] = renumerar(espacio, dentro)
            else:
                resultado[clave] = recorrer(dentro, clave)
        return resultado

    return recorrer(datos, None)


def lo_que_se_ve(cliente) -> dict:
    """Lo que enseñan las pantallas que dependen de todo a la vez: el plan, el
    seguimiento del calendario y el resumen del mes.
    """
    rango = {"desde": "2026-07-27", "hasta": "2026-09-27"}
    respuestas = {
        "plan": cliente.get("/plan", params=rango),
        "seguimiento": cliente.get("/plan/seguimiento", params=rango),
        "resumen": cliente.get("/resumen", params={"mes": "2026-09"}),
        "hoy": cliente.get("/plan/hoy"),
        "rutinas": cliente.get("/rutinas"),
        "rutinas_ocultas": cliente.get("/rutinas", params={"ocultas": True}),
        "programas": cliente.get("/programas"),
        "programas_ocultos": cliente.get("/programas", params={"ocultos": True}),
    }
    for nombre, respuesta in respuestas.items():
        assert respuesta.status_code == 200, (nombre, respuesta.text)
    return sin_ids({nombre: respuesta.json() for nombre, respuesta in respuestas.items()})


@pytest.fixture
def datos(sesion_bd, hoy_es, ejercicio_predefinido_id) -> dict:
    hoy_es(HOY)
    return montar_datos(sesion_bd, ejercicio_predefinido_id)


# --- 1. Exportar sin datos -------------------------------------------------------


def test_exportar_sin_datos_da_el_formato_con_las_listas_vacias(cliente, hoy_es):
    hoy_es(HOY)

    respuesta = cliente.get("/datos/exportar")

    assert respuesta.status_code == 200
    archivo = respuesta.json()
    assert sin_marca(archivo) == {
        "formato": "training-life",
        "version": 1,
        "predefinidos": [],
        "ejercicios": [],
        "notas": [],
        "rutinas": [],
        "programas": [],
        "excepciones": [],
        "entrenamientos": [],
    }
    # Con zona: sin ella, al importar se rechazaría su propio archivo.
    assert instante(archivo["exportado_en"]).tzinfo is not None
    assert respuesta.headers["content-disposition"] == (
        'attachment; filename="training-life-2026-09-16.json"'
    )


def test_el_nombre_del_archivo_lleva_el_dia_de_madrid_y_no_el_de_utc(cliente, monkeypatch):
    """A las 00:30 del 17 en Madrid son las 22:30 del 16 en UTC."""
    from app import fechas

    instante_madrid = datetime(2026, 9, 17, 0, 30, tzinfo=fechas.ZONA_HORARIA)

    class Reloj(datetime):
        @classmethod
        def now(cls, tz=None):
            return instante_madrid.astimezone(tz)

    monkeypatch.setattr(fechas, "datetime", Reloj)

    respuesta = cliente.get("/datos/exportar")

    assert 'filename="training-life-2026-09-17.json"' in respuesta.headers["content-disposition"]


# --- 2. Exportar con datos ---------------------------------------------------


def test_se_exporta_lo_oculto_lo_cancelado_y_lo_cerrado(cliente, datos):
    archivo = exportado(cliente)

    ejercicios = {e["nombre"]: e for e in archivo["ejercicios"]}
    assert ejercicios["Remo en máquina vieja"]["oculto_desde"] == "2026-08-20"
    assert ejercicios["Press inclinado con mancuernas"]["descripcion"] == "Banco a 30 grados"
    assert ejercicios["Press inclinado con mancuernas"]["grupo_muscular"] == datos["grupo"]

    rutinas = {r["nombre"]: r for r in archivo["rutinas"]}
    assert rutinas["Pull"]["oculto_desde"] == "2026-09-14"
    assert [h["oculto_desde"] for h in rutinas["Push"]["slots"]] == [None, None, "2026-09-01"]

    programas = {p["nombre"]: p for p in archivo["programas"]}
    assert programas["Viejo"]["oculto_desde"] == "2026-09-01"
    assert programas["PPL"]["periodos"] == [
        {"desde": "2026-08-01", "hasta": "2026-08-15"},
        {"desde": "2026-08-31", "hasta": None},
    ]
    assert {"dia_semana": 3, "rutina_id": datos["pull"], "desde": None, "hasta": "2026-09-07"} in (
        programas["PPL"]["dias"]
    )

    assert [x["rutina_id"] for x in archivo["excepciones"]] == [datos["push"], None]

    sesiones = {s["fecha"]: s for s in archivo["entrenamientos"]}
    assert sesiones["2026-09-10"]["series"] == []
    assert sesiones["2026-09-10"]["terminada_en"] is not None
    assert sesiones[HOY.isoformat()]["terminada_en"] is None
    assert len(archivo["entrenamientos"]) == 5


def test_las_marcas_de_tiempo_se_exportan_exactas_y_con_zona(cliente, datos):
    archivo = exportado(cliente)

    sesion = next(s for s in archivo["entrenamientos"] if s["fecha"] == "2026-09-07")
    assert instante(sesion["terminada_en"]) == instante("2026-09-07T18:30:12.345678+00:00")
    assert instante(sesion["created_at"]) == datetime(2026, 9, 7, 16, 0, 0, 1, timezone.utc)
    serie = sesion["series"][0]
    assert instante(serie["created_at"]) == instante("2026-09-07T17:01:02.030405+00:00")
    assert instante(serie["updated_at"]) == instante("2026-09-07T17:05:06.070809+00:00")
    nota = archivo["notas"][0]
    assert instante(nota["updated_at"]) == instante("2026-08-04T08:00:00.000002+00:00")
    for marca in (sesion["terminada_en"], serie["created_at"], nota["created_at"]):
        assert instante(marca).tzinfo is not None


def test_se_exportan_solo_los_predefinidos_que_usa_algo(cliente, datos, ejercicio_predefinido_id):
    """Principal, comodín, solo una serie y solo una nota cuentan; uno que no usa
    nada no se exporta (viene con la app).
    """
    archivo = exportado(cliente)

    esperados = sorted(
        [
            (ejercicio_predefinido_id, "Sentadilla con barra"),
            datos["comodin"],
            datos["de_nota"],
            datos["de_serie"],
        ]
    )
    assert [(p["id"], p["nombre"]) for p in archivo["predefinidos"]] == esperados
    assert datos["sin_usar"][0] not in {p["id"] for p in archivo["predefinidos"]}


def test_el_archivo_no_lleva_campos_internos(cliente, datos):
    """Ni el `es_predefinido` (lo dice estar en `predefinidos` o en `ejercicios`) ni
    el id del grupo (va por nombre): los dos son de esta instalación.
    """
    prohibidas = {"es_predefinido", "grupo_muscular_id"}

    def claves(valor):
        if isinstance(valor, dict):
            for clave, dentro in valor.items():
                yield clave
                yield from claves(dentro)
        elif isinstance(valor, list):
            for dentro in valor:
                yield from claves(dentro)

    assert not prohibidas & set(claves(exportado(cliente)))


def test_cada_lista_va_por_id_tambien_dentro_de_cada_padre(cliente, datos):
    archivo = exportado(cliente)

    for lista in ("predefinidos", "ejercicios", "rutinas"):
        ids = [x["id"] for x in archivo[lista]]
        assert ids == sorted(ids), lista
    huecos = [h["id"] for r in archivo["rutinas"] for h in r["slots"]]
    assert huecos == sorted(huecos)
    push = next(r for r in archivo["rutinas"] if r["nombre"] == "Push")
    # Los comodines, en el orden de sus filas: el remo se añadió antes.
    assert push["slots"][0]["alternativa_ids"] == [datos["remo"], datos["comodin"][0]]


def test_exportar_hace_las_mismas_consultas_con_poco_que_con_mucho(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id
):
    hoy_es(HOY)
    montar_datos(sesion_bd, ejercicio_predefinido_id)
    con_poco = consultas_de(lambda: cliente.get("/datos/exportar"))

    # Se vacía y se monta el mismo escenario con diez sesiones más.
    vacio = {"formato": "training-life", "version": 1, "exportado_en": _AHORA}
    assert importar(cliente, vacio).status_code == 200
    montar_datos(sesion_bd, ejercicio_predefinido_id, sesiones_extra=10)
    con_mucho = consultas_de(lambda: cliente.get("/datos/exportar"))

    assert con_mucho == con_poco


# --- 3. Ida y vuelta ---------------------------------------------------------


def test_exportar_importar_y_exportar_da_el_mismo_archivo(cliente, datos):
    a = exportado(cliente)

    respuesta = importar(cliente, a)
    assert respuesta.status_code == 200, respuesta.text
    b = exportado(cliente)

    assert sin_ids(b) == sin_ids(a)
    # Los ids sí cambian: si no, la comparación de arriba no probaría nada.
    assert {r["id"] for r in b["rutinas"]}.isdisjoint({r["id"] for r in a["rutinas"]})


def test_el_escenario_rellena_cada_campo_del_formato(cliente, datos):
    """Si un campo saliera siempre nulo o vacío, la ida y vuelta no vería que se
    pierde. Esto obliga a que el escenario lo rellene en algún sitio.
    """
    archivo = exportado(cliente)
    rellenos: dict[str, bool] = {}

    def mirar(valor, ruta):
        if isinstance(valor, dict):
            for clave, dentro in valor.items():
                mirar(dentro, f"{ruta}.{clave}")
        elif isinstance(valor, list):
            rellenos.setdefault(ruta, False)
            if valor:
                rellenos[ruta] = True
            for dentro in valor:
                mirar(dentro, ruta)
        else:
            rellenos[ruta] = rellenos.get(ruta, False) or valor is not None

    mirar(archivo, "")

    assert [ruta for ruta, relleno in rellenos.items() if not relleno] == []


def test_la_ida_y_vuelta_no_cambia_el_plan_el_calendario_ni_el_resumen(cliente, datos):
    antes = lo_que_se_ve(cliente)
    # Que la comparación no sea entre dos listas de descansos: hay de todo.
    origenes = {dia["origen"] for dia in antes["plan"]}
    assert origenes == {"excepcion", "programa", "sin_programa"}
    assert {"hecho", "sin_hacer", "descanso", "proximo"} <= {
        dia["estado"] for dia in antes["seguimiento"]
    }

    assert importar(cliente, exportado(cliente)).status_code == 200

    assert lo_que_se_ve(cliente) == antes


def test_la_ida_y_vuelta_conserva_el_orden_de_los_comodines(cliente, datos):
    archivo = exportado(cliente)
    assert importar(cliente, archivo).status_code == 200

    push = next(r for r in cliente.get("/rutinas").json() if r["nombre"] == "Push")
    hueco = next(h for h in push["slots"] if h["orden"] == 1)
    assert [e["nombre"] for e in hueco["alternativas"]] == [
        "Remo en máquina vieja",
        datos["comodin"][1],
    ]


def test_la_ida_y_vuelta_conserva_las_marcas_de_tiempo_en_la_base(cliente, sesion_bd, datos):
    """No basta con que el archivo diga lo mismo: lo guardado tiene que ser el mismo
    instante, sin que el insert lo pise con la hora de ahora.
    """
    assert importar(cliente, exportado(cliente)).status_code == 200

    sesion_bd.expire_all()
    sesion = sesion_bd.scalar(
        select(Entrenamiento).where(
            Entrenamiento.fecha == date(2026, 9, 7),
        )
    )
    assert sesion.terminada_en == instante("2026-09-07T18:30:12.345678+00:00")
    assert sesion.created_at == datetime(2026, 9, 7, 16, 0, 0, 1, timezone.utc)
    assert sesion.updated_at == datetime(2026, 9, 7, 18, 0, 0, 2, timezone.utc)
    hueco = sesion_bd.scalar(
        select(RutinaSlot).join(Rutina, Rutina.id == RutinaSlot.rutina_id).order_by(RutinaSlot.id)
    )
    assert hueco.updated_at == instante("2026-08-09T06:00:00.444444+00:00")
    alternativas = sesion_bd.scalar(
        select(func.count()).select_from(SlotAlternativa).where(SlotAlternativa.slot_id == hueco.id)
    )
    assert alternativas == 2


def test_la_sesion_en_curso_sigue_en_curso_tras_la_ida_y_vuelta(cliente, datos):
    assert importar(cliente, exportado(cliente)).status_code == 200

    en_curso = cliente.get("/entrenamientos", params={"en_curso": True}).json()
    assert [s["fecha"] for s in en_curso] == [HOY.isoformat()]


def test_importar_acepta_horas_con_otra_zona_y_guarda_el_mismo_instante(cliente, sesion_bd, hoy_es):
    hoy_es(HOY)
    archivo = {
        "formato": "training-life",
        "version": 1,
        "exportado_en": _AHORA,
        "rutinas": [
            {
                "id": 7,
                "nombre": "Push",
                "created_at": "2026-09-01T20:00:00.5+02:00",
                "updated_at": "2026-09-01T18:00:00.5Z",
            }
        ],
    }

    assert importar(cliente, archivo).status_code == 200

    rutina = sesion_bd.scalar(select(Rutina))
    assert rutina.created_at == rutina.updated_at == instante("2026-09-01T18:00:00.5+00:00")


# --- 4. Importar sustituye ---------------------------------------------------


def _archivo_pequeno(predefinido_id: int, predefinido_nombre: str, grupo: str) -> dict:
    marca = {"created_at": _AHORA, "updated_at": _AHORA}
    return {
        "formato": "training-life",
        "version": 1,
        "exportado_en": _AHORA,
        "predefinidos": [{"id": predefinido_id, "nombre": predefinido_nombre}],
        "ejercicios": [{"id": 500, "nombre": "Fondos lastrados", "grupo_muscular": grupo, **marca}],
        "notas": [{"ejercicio_id": 500, "nota": "Con cinturón", **marca}],
        "rutinas": [
            {
                "id": 1,
                "nombre": "Torso",
                **marca,
                "slots": [
                    {
                        "id": 10,
                        "ejercicio_principal_id": 500,
                        "orden": 1,
                        "series_objetivo": 3,
                        "reps_min": 5,
                        "reps_max": 8,
                        "alternativa_ids": [predefinido_id],
                        **marca,
                    }
                ],
            }
        ],
        "entrenamientos": [
            {
                "rutina_id": 1,
                "fecha": "2026-09-14",
                "terminada_en": _AHORA,
                **marca,
                "series": [
                    {
                        "ejercicio_id": 500,
                        "slot_id": 10,
                        "numero_serie": 1,
                        "peso": "20.00",
                        "repeticiones": 8,
                        **marca,
                    }
                ],
            }
        ],
    }


def test_importar_sustituye_todo_lo_que_habia(cliente, sesion_bd, datos):
    comodin_id, comodin_nombre = datos["comodin"]
    archivo = _archivo_pequeno(comodin_id, comodin_nombre, datos["grupo"])

    respuesta = importar(cliente, archivo)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json() == {
        "ejercicios": 1,
        "notas": 1,
        "rutinas": 1,
        "programas": 0,
        "sesiones": 1,
        "series": 1,
        "primera_sesion": "2026-09-14",
        "ultima_sesion": "2026-09-14",
    }
    # El archivo pasado por el formato, para que tenga sus valores por defecto y las
    # horas escritas igual que al exportar.
    normalizado = ArchivoDeDatos.model_validate(archivo).model_dump(mode="json")
    assert sin_ids(exportado(cliente)) == sin_ids(normalizado)
    # Nada de lo de antes, tampoco la nota del predefinido que no se usaba en nada
    # (no se iría con ningún ejercicio).
    assert [r["nombre"] for r in cliente.get("/rutinas").json()] == ["Torso"]
    assert cliente.get("/rutinas", params={"ocultas": True}).json() == []
    assert cliente.get("/programas", params={"ocultos": True}).json() == []
    assert cliente.get(f"/ejercicios/{datos['de_nota'][0]}/notas").json() == []
    assert (
        cliente.get(
            "/plan/excepciones", params={"desde": "2026-09-01", "hasta": "2026-09-30"}
        ).json()
        == []
    )


def test_importar_un_archivo_vacio_lo_deja_todo_vacio(cliente, sesion_bd, datos):
    vacio = {"formato": "training-life", "version": 1, "exportado_en": _AHORA}

    respuesta = importar(cliente, vacio)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["rutinas"] == respuesta.json()["series"] == 0
    assert sin_marca(exportado(cliente)) == {
        **sin_marca(vacio),
        "predefinidos": [],
        "ejercicios": [],
        "notas": [],
        "rutinas": [],
        "programas": [],
        "excepciones": [],
        "entrenamientos": [],
    }
    sesion_bd.expire_all()
    assert _nada(sesion_bd)


def test_importar_dos_veces_el_mismo_archivo_no_duplica_nada(cliente, datos):
    archivo = exportado(cliente)

    assert importar(cliente, archivo).status_code == 200
    assert importar(cliente, archivo).status_code == 200

    assert sin_ids(exportado(cliente)) == sin_ids(archivo)


def test_un_ejercicio_propio_con_el_nombre_de_un_predefinido_sigue_siendo_propio(
    cliente, sesion_bd, hoy_es, grupo_muscular_id
):
    hoy_es(HOY)
    grupo = cliente.get("/grupos-musculares").json()[0]["nombre"]
    marca = {"created_at": _AHORA, "updated_at": _AHORA}
    archivo = {
        "formato": "training-life",
        "version": 1,
        "exportado_en": _AHORA,
        "ejercicios": [
            {"id": 3, "nombre": "Sentadilla con barra", "grupo_muscular": grupo, **marca}
        ],
    }

    assert importar(cliente, archivo).status_code == 200

    propios = cliente.get("/ejercicios").json()
    con_ese_nombre = [e for e in propios if e["nombre"] == "Sentadilla con barra"]
    assert sorted(e["es_predefinido"] for e in con_ese_nombre) == [False, True]


@pytest.mark.parametrize("accion", ["desactivarlo", "activar otro", "ocultarlo"])
@pytest.mark.xfail(
    strict=True,
    reason=(
        "Fallo del código: importar acepta un periodo abierto que empieza después de hoy,"
        " y `_cerrar_periodo_abierto` (routers/programas.py) le pone `hasta = hoy`, que"
        " viola `programa_periodos_rango_check` (hasta >= desde): IntegrityError, un 500."
    ),
)
def test_un_programa_importado_que_empieza_despues_de_hoy_se_puede_sacar_de_uso(
    cliente, hoy_es, accion
):
    """Importar no valida a propósito las fechas futuras (una copia de un teléfono con
    otra fecha), pero un periodo abierto con `desde` posterior a hoy deja el programa
    activo sin que se pueda desactivar, activar otro ni ocultarlo: los tres cierran
    el periodo con `hasta = hoy`. Lo esperado (regla «toda restricción de la base con
    su comprobación») es que funcione igual que con uno que empezó hoy, que se borra
    al cerrarse porque no llegó a cubrir ningún día, o un 409/422 legible; nunca un 500.
    """
    hoy_es(HOY)
    marca = {"created_at": _AHORA, "updated_at": _AHORA}
    archivo = {
        "formato": "training-life",
        "version": 1,
        "exportado_en": _AHORA,
        "programas": [
            {"nombre": "PPL", **marca, "periodos": [{"desde": "2026-09-20", "hasta": None}]},
            {"nombre": "Otro", **marca},
        ],
    }
    assert importar(cliente, archivo).status_code == 200
    ids = {p["nombre"]: p["id"] for p in cliente.get("/programas").json()}

    ruta = f"/programas/{ids['PPL']}"
    peticion, codigo = {
        "desactivarlo": (lambda: cliente.post(f"{ruta}/desactivar"), 200),
        "activar otro": (lambda: cliente.post(f"/programas/{ids['Otro']}/activar"), 200),
        "ocultarlo": (lambda: cliente.delete(f"{ruta}?modo=ocultar"), 204),
    }[accion]

    respuesta = peticion()

    assert respuesta.status_code == codigo, respuesta.text
    assert cliente.get(ruta).json()["activo"] is False


# --- El RPE de los archivos viejos -------------------------------------------
#
# Las series tenían RPE y se quitó sin subir la versión del formato: un archivo
# exportado antes sigue siendo de la versión 1 y trae `rpe` en cada serie.


def test_un_archivo_viejo_con_rpe_se_importa_sin_perder_nada_mas(cliente, datos):
    """Un archivo de antes de quitar el RPE se carga igual (y se comprueba igual):
    el `rpe` se descarta, incluso uno que ya entonces estaba fuera de rango (11) o
    nulo, y el resto de cada serie queda tal cual. Lo que se exporta después ya no
    lo lleva.
    """
    archivo = _archivo_pequeno(*datos["comodin"], datos["grupo"])
    marca = {"created_at": _AHORA, "updated_at": _AHORA}
    serie = {"ejercicio_id": 500, "slot_id": 10, **marca}
    archivo["entrenamientos"][0]["series"] = [
        {
            **serie,
            "numero_serie": 1,
            "peso": "20.50",
            "repeticiones": 8,
            "rpe": 8.5,
            "variante": "agarre cerrado",
        },
        {**serie, "numero_serie": 2, "peso": "22.50", "repeticiones": 6, "rpe": None},
        {**serie, "numero_serie": 3, "peso": "25.00", "repeticiones": 4, "rpe": 11},
    ]

    comprobado = importar(cliente, archivo, comprobar=True)
    assert comprobado.status_code == 200, comprobado.text
    assert comprobado.json()["archivo"]["series"] == 3

    respuesta = importar(cliente, archivo)
    assert respuesta.status_code == 200, respuesta.text

    series = [s for sesion in exportado(cliente)["entrenamientos"] for s in sesion["series"]]
    assert [
        (s["numero_serie"], Decimal(s["peso"]), s["repeticiones"], s["variante"]) for s in series
    ] == [
        (1, Decimal("20.50"), 8, "agarre cerrado"),
        (2, Decimal("22.50"), 6, None),
        (3, Decimal("25.00"), 4, None),
    ]
    assert not any("rpe" in s for s in series)


# --- 5. Un archivo malo no toca nada -----------------------------------------


def _sesion(archivo, fecha):
    return next(s for s in archivo["entrenamientos"] if s["fecha"] == fecha)


def _rutina(archivo, nombre):
    return next(r for r in archivo["rutinas"] if r["nombre"] == nombre)


def _programa(archivo, nombre):
    return next(p for p in archivo["programas"] if p["nombre"] == nombre)


def _sin_formato(a):
    del a["formato"]


def _otro_formato(a):
    a["formato"] = "otra-app"


def _version_2(a):
    a["version"] = 2


def _version_0(a):
    a["version"] = 0


def _version_texto(a):
    a["version"] = "1"


def _peso_roto(a):
    _sesion(a, "2026-09-07")["series"][0]["peso"] = "mucho"


def _hora_sin_zona(a):
    _rutina(a, "Push")["created_at"] = "2026-08-06T07:00:00"


def _nombre_vacio(a):
    _rutina(a, "Push")["nombre"] = "   "


def _rutina_con_id_repetido(a):
    _rutina(a, "Pull")["id"] = _rutina(a, "Push")["id"]


def _ejercicio_con_el_id_de_un_predefinido(a):
    a["ejercicios"][0]["id"] = a["predefinidos"][0]["id"]


def _hueco_con_id_repetido(a):
    _rutina(a, "Pull")["slots"][0]["id"] = _rutina(a, "Push")["slots"][0]["id"]


def _nota_de_un_ejercicio_que_no_esta(a):
    a["notas"][0]["ejercicio_id"] = 999_999


def _principal_que_no_esta(a):
    _rutina(a, "Push")["slots"][1]["ejercicio_principal_id"] = 999_999


def _comodin_que_no_esta(a):
    _rutina(a, "Push")["slots"][0]["alternativa_ids"].append(999_999)


def _dia_de_una_rutina_que_no_esta(a):
    _programa(a, "PPL")["dias"][0]["rutina_id"] = 999_999


def _excepcion_de_una_rutina_que_no_esta(a):
    a["excepciones"][0]["rutina_id"] = 999_999


def _sesion_de_una_rutina_que_no_esta(a):
    _sesion(a, "2026-09-10")["rutina_id"] = 999_999


def _serie_de_un_ejercicio_que_no_esta(a):
    _sesion(a, "2026-09-09")["series"][0]["ejercicio_id"] = 999_999


def _serie_en_un_hueco_de_otra_rutina(a):
    # La sesión es de Push; el hueco, de Pull.
    _sesion(a, "2026-09-09")["series"][0]["slot_id"] = _rutina(a, "Pull")["slots"][0]["id"]


def _serie_en_un_hueco_que_no_esta(a):
    _sesion(a, "2026-09-09")["series"][0]["slot_id"] = 999_999


def _dos_ejercicios_en_un_hueco(a):
    # La del 9 tiene la sentadilla en su hueco y el remo en el del press: la
    # sentadilla pasa al del remo.
    sentadilla, remo = _sesion(a, "2026-09-09")["series"]
    sentadilla["slot_id"], sentadilla["numero_serie"] = remo["slot_id"], 2


def _predefinido_que_no_existe(a):
    a["predefinidos"][0]["nombre"] = "Press con kettlebell de cristal"


def _grupo_que_no_existe(a):
    a["ejercicios"][0]["grupo_muscular"] = "Orejas"


def _sesiones_el_mismo_dia(a):
    _sesion(a, "2026-09-11")["fecha"] = "2026-09-10"


def _cubre_fecha_repetida(a):
    _sesion(a, "2026-09-11")["cubre_fecha"] = "2026-09-07"


def _excepcion_repetida(a):
    a["excepciones"][1]["fecha"] = a["excepciones"][0]["fecha"]


def _dos_periodos_abiertos_en_dos_programas(a):
    _programa(a, "Viejo")["periodos"][0]["hasta"] = None


def _dos_periodos_abiertos_en_un_programa(a):
    _programa(a, "PPL")["periodos"][0]["hasta"] = None


def _dos_filas_vigentes_el_mismo_dia(a):
    _programa(a, "PPL")["dias"][1]["hasta"] = None


def _orden_repetido(a):
    _rutina(a, "Push")["slots"][2]["orden"] = 1


def _comodin_repetido(a):
    hueco = _rutina(a, "Push")["slots"][0]
    hueco["alternativa_ids"].append(hueco["alternativa_ids"][0])


def _comodin_igual_al_principal(a):
    hueco = _rutina(a, "Push")["slots"][0]
    hueco["alternativa_ids"].append(hueco["ejercicio_principal_id"])


def _dia_con_vigencia_invertida(a):
    dia = _programa(a, "PPL")["dias"][1]
    dia["desde"], dia["hasta"] = "2026-09-07", "2026-09-07"


def _periodo_invertido(a):
    _programa(a, "PPL")["periodos"][0]["hasta"] = "2026-07-01"


def _dia_semana_8(a):
    _programa(a, "PPL")["dias"][0]["dia_semana"] = 8


def _reps_al_reves(a):
    hueco = _rutina(a, "Push")["slots"][0]
    hueco["reps_min"], hueco["reps_max"] = 12, 6


MALOS = [
    (_sin_formato, NO_ES_UNA_COPIA, None),
    (_otro_formato, NO_ES_UNA_COPIA, None),
    (_version_2, MAS_NUEVA, None),
    (_version_0, NO_ES_UNA_COPIA, None),
    (_version_texto, NO_ES_UNA_COPIA, None),
    (_peso_roto, DANADO, "entrenamientos.0.series.0.peso"),
    (_hora_sin_zona, DANADO, "rutinas.0.created_at"),
    (_nombre_vacio, DANADO, "rutinas.0.nombre"),
    (_rutina_con_id_repetido, NO_SE_CAMBIA_NADA, "Hay dos rutinas con el id"),
    (_ejercicio_con_el_id_de_un_predefinido, NO_SE_CAMBIA_NADA, "Hay dos ejercicios con el id"),
    (_hueco_con_id_repetido, NO_SE_CAMBIA_NADA, "Hay dos ejercicios de rutina con el id"),
    (_nota_de_un_ejercicio_que_no_esta, NO_SE_CAMBIA_NADA, "Una nota es de un ejercicio"),
    (_principal_que_no_esta, NO_SE_CAMBIA_NADA, 'La rutina "Push" usa un ejercicio'),
    (_comodin_que_no_esta, NO_SE_CAMBIA_NADA, 'La rutina "Push" usa un ejercicio'),
    (_dia_de_una_rutina_que_no_esta, NO_SE_CAMBIA_NADA, 'El programa "PPL" usa una rutina'),
    (_excepcion_de_una_rutina_que_no_esta, NO_SE_CAMBIA_NADA, "El día 2026-09-12 tiene una"),
    (_sesion_de_una_rutina_que_no_esta, NO_SE_CAMBIA_NADA, "La sesión del 2026-09-10 es de"),
    (_serie_de_un_ejercicio_que_no_esta, NO_SE_CAMBIA_NADA, "una serie de un ejercicio"),
    (_serie_en_un_hueco_de_otra_rutina, NO_SE_CAMBIA_NADA, 'fuera de los ejercicios de "Push"'),
    (_serie_en_un_hueco_que_no_esta, NO_SE_CAMBIA_NADA, 'fuera de los ejercicios de "Push"'),
    # Dos ejercicios en un hueco de una sesión: en sus propios tests, con la frase entera.
    (_predefinido_que_no_existe, NO_SE_CAMBIA_NADA, '"Press con kettlebell de cristal" no'),
    (_grupo_que_no_existe, NO_SE_CAMBIA_NADA, 'El grupo muscular "Orejas"'),
    (_sesiones_el_mismo_dia, NO_SE_CAMBIA_NADA, "Hay dos sesiones el 2026-09-10"),
    (_cubre_fecha_repetida, NO_SE_CAMBIA_NADA, "cuentan como la del 2026-09-07"),
    (_excepcion_repetida, NO_SE_CAMBIA_NADA, "El día 2026-09-12 está cambiado dos veces"),
    (_dos_periodos_abiertos_en_dos_programas, NO_SE_CAMBIA_NADA, "más de un programa activo"),
    (_dos_periodos_abiertos_en_un_programa, NO_SE_CAMBIA_NADA, "más de un programa activo"),
    (_dos_filas_vigentes_el_mismo_dia, NO_SE_CAMBIA_NADA, "dos rutinas a la vez el día 3"),
    (_orden_repetido, NO_SE_CAMBIA_NADA, 'La rutina "Push" tiene dos ejercicios en la posición 1'),
    (_comodin_repetido, DANADO, "rutinas.0.slots.0"),
    (_comodin_igual_al_principal, DANADO, "rutinas.0.slots.0"),
    (_dia_con_vigencia_invertida, DANADO, "programas.0.dias.1"),
    (_periodo_invertido, DANADO, "programas.0.periodos.0"),
    (_dia_semana_8, DANADO, "programas.0.dias.0.dia_semana"),
    (_reps_al_reves, DANADO, "rutinas.0.slots.0"),
]


@pytest.mark.parametrize("comprobar", [False, True], ids=["importar", "comprobar"])
@pytest.mark.parametrize(
    "estropear, mensaje, error", MALOS, ids=[f.__name__.lstrip("_") for f, *_ in MALOS]
)
def test_un_archivo_malo_da_422_en_espanol_y_no_cambia_nada(
    cliente, datos, estropear, mensaje, error, comprobar
):
    antes = exportado(cliente)
    archivo = copy.deepcopy(antes)
    estropear(archivo)

    respuesta = importar(cliente, archivo, comprobar=comprobar)

    assert respuesta.status_code == 422, respuesta.text
    detalle = respuesta.json()["detail"]
    assert detalle["mensaje"] == mensaje
    if error is None:
        assert "errores" not in detalle
    else:
        assert any(error in e for e in detalle["errores"]), detalle["errores"]
    assert sin_marca(exportado(cliente)) == sin_marca(antes)


def test_los_errores_se_dicen_todos_de_una_vez(cliente, datos):
    archivo = exportado(cliente)
    _grupo_que_no_existe(archivo)
    _sesiones_el_mismo_dia(archivo)
    _orden_repetido(archivo)

    detalle = importar(cliente, archivo).json()["detail"]

    assert len(detalle["errores"]) == 3, detalle


@pytest.mark.parametrize("comprobar", [False, True], ids=["importar", "comprobar"])
def test_una_sesion_con_dos_ejercicios_en_un_hueco_no_se_importa(cliente, datos, comprobar):
    """En una sesión, cada hueco se hace con un solo ejercicio, también en un
    archivo: 422 y no se cambia nada. La frase nombra los dos ejercicios (aquí uno
    propio y uno predefinido), en el orden de sus series, y la rutina.
    """
    antes = exportado(cliente)
    archivo = copy.deepcopy(antes)
    _dos_ejercicios_en_un_hueco(archivo)

    respuesta = importar(cliente, archivo, comprobar=comprobar)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"] == {
        "mensaje": NO_SE_CAMBIA_NADA,
        "errores": [
            'La sesión del 2026-09-09 tiene series de "Sentadilla con barra" y de "Remo en'
            ' máquina vieja" en el mismo ejercicio de "Push": en una sesión, cada uno se hace'
            " con un solo ejercicio."
        ],
    }
    assert sin_marca(exportado(cliente)) == sin_marca(antes)


@pytest.mark.parametrize("comprobar", [False, True], ids=["importar", "comprobar"])
def test_una_sesion_con_tres_ejercicios_en_un_hueco_los_nombra_con_comas(cliente, datos, comprobar):
    """Con tres o más ejercicios en el mismo hueco, la frase los separa con comas
    y pone «y» solo antes del último, cada uno con su «de», en el orden de sus series.
    """
    archivo = exportado(cliente)
    _dos_ejercicios_en_un_hueco(archivo)
    series = _sesion(archivo, "2026-09-09")["series"]
    press = copy.deepcopy(series[1])
    press["ejercicio_id"], press["numero_serie"] = datos["press"], 3
    series.append(press)

    respuesta = importar(cliente, archivo, comprobar=comprobar)

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["detail"]["errores"] == [
        'La sesión del 2026-09-09 tiene series de "Sentadilla con barra", de "Remo en máquina'
        ' vieja" y de "Press inclinado con mancuernas" en el mismo ejercicio de "Push": en una'
        " sesión, cada uno se hace con un solo ejercicio."
    ]


def test_el_mismo_hueco_con_otro_ejercicio_en_otra_sesion_si_se_importa(cliente, datos):
    """El otro lado del anterior: el hueco del press se hizo con press el 7 y con el
    remo el 9 (y en la del 7, cada hueco con el suyo). El escenario ya lo tiene, y
    esto lo fija para que nadie lo «arregle» juntándolos.
    """
    archivo = exportado(cliente)
    hueco_del_press = _rutina(archivo, "Push")["slots"][0]["id"]

    def ejercicios_en(fecha):
        return {
            s["ejercicio_id"]
            for s in _sesion(archivo, fecha)["series"]
            if s["slot_id"] == hueco_del_press
        }

    assert ejercicios_en("2026-09-07") == {datos["press"]}
    assert ejercicios_en("2026-09-09") == {datos["remo"]}
    assert importar(cliente, archivo).status_code == 200


def test_como_mucho_se_dicen_veinte_errores(cliente, hoy_es):
    hoy_es(HOY)
    marca = {"created_at": _AHORA, "updated_at": _AHORA}
    archivo = {
        "formato": "training-life",
        "version": 1,
        "exportado_en": _AHORA,
        "notas": [{"ejercicio_id": 1000 + n, "nota": "x", **marca} for n in range(30)],
    }

    detalle = importar(cliente, archivo).json()["detail"]

    assert detalle["mensaje"] == NO_SE_CAMBIA_NADA
    assert len(detalle["errores"]) == 20


@pytest.mark.parametrize(
    "cuerpo", [[], "training-life", 1], ids=["una lista", "un texto", "un número"]
)
def test_un_archivo_que_no_es_un_objeto_da_el_mismo_422_en_espanol(cliente, cuerpo):
    """Quien elige un .json cualquiera puede mandar una lista o un texto.

    Bug real: el cuerpo se declaraba `dict = Body(...)` y FastAPI lo rechazaba antes
    de llegar al endpoint, con su 422 en inglés y `detail` como lista.
    """
    respuesta = cliente.post("/datos/importar", json=cuerpo)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == {"mensaje": NO_ES_UNA_COPIA}


def test_un_archivo_que_no_es_json_da_el_mismo_422_en_espanol(cliente):
    """Bug real: un archivo que ni siquiera es JSON daba el 422 `json_invalid` de
    FastAPI, en inglés, en vez del mensaje de que no es una copia.
    """
    respuesta = cliente.post(
        "/datos/importar", content=b"esto no es json", headers={"content-type": "application/json"}
    )

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == {"mensaje": NO_ES_UNA_COPIA}


def test_un_json_mal_formado_en_otro_endpoint_sigue_dando_el_422_de_fastapi(cliente):
    """El mensaje de "no es una copia" es solo para importar: el manejador de errores
    de validación es global y no debe cambiar el 422 del resto de la API.
    """
    respuesta = cliente.post(
        "/rutinas", content=b"esto no es json", headers={"content-type": "application/json"}
    )

    assert respuesta.status_code == 422
    detalle = respuesta.json()["detail"]
    assert isinstance(detalle, list)
    assert any(fallo["type"] == "json_invalid" for fallo in detalle)


# --- 6. Comprobar ------------------------------------------------------------


def test_comprobar_dice_que_hay_en_el_archivo_y_que_hay_ahora_sin_cambiar_nada(cliente, datos):
    antes = exportado(cliente)
    archivo = _archivo_pequeno(*datos["comodin"], datos["grupo"])

    respuesta = importar(cliente, archivo, comprobar=True)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json() == {
        "exportado_en": "2026-09-16T10:00:00Z",
        "archivo": {
            "ejercicios": 1,
            "notas": 1,
            "rutinas": 1,
            "programas": 0,
            "sesiones": 1,
            "series": 1,
            "primera_sesion": "2026-09-14",
            "ultima_sesion": "2026-09-14",
        },
        # Las sesiones son las que tienen series: la cancelada del 10 no cuenta,
        # la de hoy en curso sí.
        "actual": {
            "ejercicios": 2,
            "notas": 2,
            "rutinas": 2,
            "programas": 2,
            "sesiones": 4,
            "series": 7,
            "primera_sesion": "2026-09-07",
            "ultima_sesion": HOY.isoformat(),
        },
    }
    assert sin_marca(exportado(cliente)) == sin_marca(antes)


def test_comprobar_sin_datos_da_ceros_y_fechas_nulas(cliente, hoy_es):
    hoy_es(HOY)
    vacio = {"formato": "training-life", "version": 1, "exportado_en": _AHORA}

    respuesta = importar(cliente, vacio, comprobar=True).json()

    assert respuesta["archivo"] == respuesta["actual"] == CERO


# --- 7. El resumen antes de exportar -----------------------------------------
#
# `GET /datos/resumen` es lo que dice el diálogo de exportar: tiene que dar las
# mismas cifras que `actual` en la comprobación de importar, y contar lo que de
# verdad se guarda (lo oculto sí; los predefinidos no, que vienen con la app; una
# sesión sin series tampoco, ni sus fechas).


def resumen(cliente) -> dict:
    respuesta = cliente.get("/datos/resumen")
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def test_el_resumen_sin_datos_da_ceros_y_fechas_nulas(cliente, hoy_es):
    hoy_es(HOY)

    assert resumen(cliente) == CERO


def test_el_resumen_coincide_con_la_comprobacion_de_importar_su_propio_archivo(cliente, datos):
    comprobacion = importar(cliente, exportado(cliente), comprobar=True).json()

    propio = resumen(cliente)

    assert propio == comprobacion["actual"] == comprobacion["archivo"]
    # Que no coincidan por estar todo a cero.
    assert propio["sesiones"] == 4 and propio["series"] == 7


def test_el_resumen_cuenta_lo_oculto_y_no_los_predefinidos_ni_las_sesiones_sin_series(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id, grupo_muscular_id
):
    """Las sesiones sin series (canceladas o vacías) quedan antes y después de las
    que tienen series: si contaran para las fechas, la primera y la última se
    moverían. La de hoy, en curso y vacía, tampoco cuenta.
    """
    hoy_es(HOY)
    oculto = Ejercicio(
        nombre="Remo viejo",
        grupo_muscular_id=grupo_muscular_id,
        oculto_desde=date(2026, 9, 1),
    )
    rutina = Rutina(nombre="Pull", oculto_desde=date(2026, 9, 14))
    sesion_bd.add_all(
        [
            oculto,
            rutina,
            Programa(nombre="Viejo", oculto_desde=date(2026, 9, 1)),
            NotaEjercicio(ejercicio_id=ejercicio_predefinido_id, nota="Asiento en el 4"),
        ]
    )
    sesion_bd.flush()
    # El predefinido es principal de un hueco y tiene series: aun así no se cuenta.
    del_predefinido = RutinaSlot(
        rutina_id=rutina.id,
        ejercicio_principal_id=ejercicio_predefinido_id,
        orden=1,
        series_objetivo=3,
        reps_min=5,
        reps_max=8,
    )
    del_oculto = RutinaSlot(
        rutina_id=rutina.id,
        ejercicio_principal_id=oculto.id,
        orden=2,
        series_objetivo=3,
        reps_min=5,
        reps_max=8,
    )
    sesion_bd.add_all([del_predefinido, del_oculto])
    sesion_bd.flush()
    terminada = instante("2026-09-01T18:00:00+00:00")

    def sesion(dia, series=(), **campos):
        fila = Entrenamiento(rutina_id=rutina.id, fecha=date(2026, 9, dia), **campos)
        sesion_bd.add(fila)
        sesion_bd.flush()
        for numero, (hueco, ejercicio_id) in enumerate(series, start=1):
            sesion_bd.add(
                Serie(
                    entrenamiento_id=fila.id,
                    slot_id=hueco.id,
                    ejercicio_id=ejercicio_id,
                    numero_serie=numero,
                    peso=Decimal("60"),
                    repeticiones=8,
                )
            )
        sesion_bd.flush()

    sesion(1, terminada_en=terminada)  # cancelada, antes
    sesion(2)  # vacía sin terminar, antes
    sesion(
        5,
        [(del_predefinido, ejercicio_predefinido_id), (del_oculto, oculto.id)],
        terminada_en=terminada,
    )
    sesion(8, [(del_oculto, oculto.id)], terminada_en=terminada)
    sesion(12, terminada_en=terminada)  # cancelada, después
    sesion(14)  # vacía sin terminar, después
    sesion(HOY.day)  # la de hoy, en curso y vacía
    sesion_bd.commit()

    assert resumen(cliente) == {
        "ejercicios": 1,
        "notas": 1,
        "rutinas": 1,
        "programas": 1,
        "sesiones": 2,
        "series": 3,
        "primera_sesion": "2026-09-05",
        "ultima_sesion": "2026-09-08",
    }


@pytest.mark.parametrize("que", ["el mismo archivo", "uno pequeño", "uno vacío"])
def test_tras_importar_el_resumen_coincide_con_la_respuesta_de_importar(cliente, datos, que):
    if que == "el mismo archivo":
        archivo = exportado(cliente)
    elif que == "uno pequeño":
        archivo = _archivo_pequeno(*datos["comodin"], datos["grupo"])
    else:
        archivo = {"formato": "training-life", "version": 1, "exportado_en": _AHORA}

    respuesta = importar(cliente, archivo)

    assert respuesta.status_code == 200, respuesta.text
    assert resumen(cliente) == respuesta.json()


def test_el_resumen_hace_las_mismas_consultas_sin_datos_con_poco_y_con_mucho(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id
):
    hoy_es(HOY)
    sin_datos = consultas_de(lambda: cliente.get("/datos/resumen"))
    montar_datos(sesion_bd, ejercicio_predefinido_id)
    con_poco = consultas_de(lambda: cliente.get("/datos/resumen"))

    vacio = {"formato": "training-life", "version": 1, "exportado_en": _AHORA}
    assert importar(cliente, vacio).status_code == 200
    montar_datos(sesion_bd, ejercicio_predefinido_id, sesiones_extra=10)
    con_mucho = consultas_de(lambda: cliente.get("/datos/resumen"))

    assert sin_datos == con_poco == con_mucho
    assert resumen(cliente)["sesiones"] == 14


# --- 8. Predefinidos ---------------------------------------------------------


def _predefinidos_en_bd(sesion_bd) -> list[tuple]:
    sesion_bd.expire_all()
    return sesion_bd.execute(
        select(
            Ejercicio.id,
            Ejercicio.nombre,
            Ejercicio.grupo_muscular_id,
            Ejercicio.descripcion,
            Ejercicio.oculto_desde,
            Ejercicio.updated_at,
        )
        .where(Ejercicio.es_predefinido.is_(True))
        .order_by(Ejercicio.id)
    ).all()


@pytest.mark.parametrize("que", ["el mismo archivo", "uno vacío"])
def test_importar_no_toca_los_predefinidos(cliente, sesion_bd, datos, que):
    antes = _predefinidos_en_bd(sesion_bd)
    archivo = exportado(cliente)
    if que == "uno vacío":
        archivo = {"formato": "training-life", "version": 1, "exportado_en": _AHORA}

    assert importar(cliente, archivo).status_code == 200

    despues = _predefinidos_en_bd(sesion_bd)
    assert len(despues) == 59
    assert despues == antes


def test_los_predefinidos_del_archivo_van_por_nombre_y_no_por_id(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id
):
    """El archivo puede venir de otra instalación, donde el mismo predefinido tiene
    otro id: se busca por nombre y no se crea ninguno.
    """
    hoy_es(HOY)
    marca = {"created_at": _AHORA, "updated_at": _AHORA}
    archivo = {
        "formato": "training-life",
        "version": 1,
        "exportado_en": _AHORA,
        "predefinidos": [{"id": 4242, "nombre": "Sentadilla con barra"}],
        "notas": [{"ejercicio_id": 4242, "nota": "Barra baja", **marca}],
        "rutinas": [
            {
                "id": 1,
                "nombre": "Pierna",
                **marca,
                "slots": [
                    {
                        "id": 1,
                        "ejercicio_principal_id": 4242,
                        "orden": 1,
                        "series_objetivo": 5,
                        "reps_min": 5,
                        "reps_max": 5,
                        **marca,
                    }
                ],
            }
        ],
    }
    antes = _predefinidos_en_bd(sesion_bd)

    assert importar(cliente, archivo).status_code == 200

    rutina = cliente.get("/rutinas").json()[0]
    assert rutina["slots"][0]["ejercicio_principal"]["id"] == ejercicio_predefinido_id
    notas = cliente.get(f"/ejercicios/{ejercicio_predefinido_id}/notas").json()
    assert [n["nota"] for n in notas] == ["Barra baja"]
    assert _predefinidos_en_bd(sesion_bd) == antes


def test_la_lista_de_ejercicios_del_archivo_solo_trae_los_propios(cliente, sesion_bd, datos):
    """Los predefinidos van aparte, en `predefinidos`, y solo los que se usan. Si
    salieran en `ejercicios`, importar el archivo los duplicaría como propios.
    """
    archivo = exportado(cliente)

    assert [e["nombre"] for e in archivo["ejercicios"]] == [
        "Press inclinado con mancuernas",
        "Remo en máquina vieja",
    ]
    predefinidos = {fila.id for fila in _predefinidos_en_bd(sesion_bd)}
    assert predefinidos.isdisjoint(e["id"] for e in archivo["ejercicios"])


def test_sin_ejercicios_propios_el_archivo_no_trae_ninguno(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id
):
    """El caso en que un filtro perdido más se notaría: solo hay una nota en un
    predefinido, y la lista de propios tiene que salir vacía, no con los 59.
    """
    hoy_es(HOY)
    cliente.post(f"/ejercicios/{ejercicio_predefinido_id}/notas", json={"nota": "Barra baja"})

    archivo = exportado(cliente)

    assert archivo["ejercicios"] == []
    assert [p["id"] for p in archivo["predefinidos"]] == [ejercicio_predefinido_id]
    assert resumen(cliente)["ejercicios"] == 0


def test_un_predefinido_del_archivo_no_se_confunde_con_un_propio_del_mismo_nombre(
    cliente, sesion_bd, hoy_es, grupo_muscular_id
):
    """Un predefinido del archivo se busca por nombre solo entre los predefinidos.
    Si se buscara entre todos, encontraría el propio que importar va a borrar, y la
    carga apuntaría a un ejercicio que ya no existe (un 500 en vez del 422).
    """
    hoy_es(HOY)
    propio = crear_ejercicio(cliente, grupo_muscular_id, "Press del autor")
    marca = {"created_at": _AHORA, "updated_at": _AHORA}
    archivo = {
        "formato": "training-life",
        "version": 1,
        "exportado_en": _AHORA,
        "predefinidos": [{"id": 7, "nombre": "Press del autor"}],
        "notas": [{"ejercicio_id": 7, "nota": "Con pausa", **marca}],
    }

    respuesta = importar(cliente, archivo)

    assert respuesta.status_code == 422, respuesta.text
    assert '"Press del autor" no existe' in str(respuesta.json()["detail"])
    assert cliente.get(f"/ejercicios/{propio}").status_code == 200
    assert cliente.get(f"/ejercicios/{propio}/notas").json() == []


# --- 9. Guarda de columnas ---------------------------------------------------
#
# Si se añade una columna a una tabla que se exporta y no se lleva al archivo, la
# copia la perdería en silencio. Cada columna tiene que estar en su modelo del
# formato o en la lista de lo que no se exporta a propósito (y entonces se piensa).

FORMATO_DE = {
    Ejercicio: EjercicioDeArchivo,
    NotaEjercicio: NotaDeArchivo,
    Rutina: RutinaDeArchivo,
    RutinaSlot: SlotDeArchivo,
    Programa: ProgramaDeArchivo,
    ProgramaDia: DiaDeArchivo,
    ProgramaPeriodo: PeriodoDeArchivo,
    ExcepcionDelPlan: ExcepcionDeArchivo,
    Entrenamiento: EntrenamientoDeArchivo,
    Serie: SerieDeArchivo,
}

# Columna → por qué no está con ese nombre en el formato.
NO_SE_EXPORTA = {
    Ejercicio: {
        "es_predefinido": "los propios nunca lo son; los predefinidos van aparte",
        "grupo_muscular_id": "va por nombre, en grupo_muscular",
    },
    NotaEjercicio: {"id": "nada la referencia"},
    RutinaSlot: {"rutina_id": "va dentro de su rutina"},
    Programa: {"id": "nada la referencia"},
    ProgramaDia: {"id": "nada la referencia", "programa_id": "va dentro de su programa"},
    ProgramaPeriodo: {"id": "nada la referencia", "programa_id": "va dentro de su programa"},
    ExcepcionDelPlan: {"id": "nada la referencia"},
    Entrenamiento: {"id": "nada la referencia"},
    Serie: {"id": "nada la referencia", "entrenamiento_id": "va dentro de su sesión"},
    # De los comodines solo cuenta el ejercicio, en `alternativa_ids` de su hueco.
    SlotAlternativa: {"id": "", "slot_id": "", "ejercicio_id": ""},
}

# Tablas que no se exportan enteras.
TABLAS_FUERA = {"grupos_musculares", "alembic_version"}


@pytest.mark.parametrize("modelo", list(FORMATO_DE), ids=lambda m: m.__name__)
def test_cada_columna_de_una_tabla_exportada_esta_en_el_formato_o_excluida(modelo):
    columnas = set(modelo.__table__.columns.keys())
    en_formato = set(FORMATO_DE[modelo].model_fields)
    excluidas = set(NO_SE_EXPORTA.get(modelo, {}))

    assert columnas - en_formato - excluidas == set()
    # Una exclusión que ya está en el formato (o que ya no es columna) sobra.
    assert excluidas & en_formato == set()
    assert excluidas <= columnas


def test_cada_tabla_esta_en_el_formato_o_fuera_a_proposito():
    exportadas = {modelo.__tablename__ for modelo in (*FORMATO_DE, SlotAlternativa)}

    assert set(Base.metadata.tables) - exportadas - TABLAS_FUERA == set()


def test_el_formato_de_alto_nivel_tiene_una_lista_por_cada_cosa():
    assert set(ArchivoDeDatos.model_fields) == {
        "formato",
        "version",
        "exportado_en",
        "predefinidos",
        "ejercicios",
        "notas",
        "rutinas",
        "programas",
        "excepciones",
        "entrenamientos",
    }


# --- 10. Borrar todo (`DELETE /datos`) ----------------------------------------
#
# Usa el mismo `borrar_todo` que importar, con sentencias directas y sin ids
# concretos: un `WHERE` mal puesto en los ejercicios se llevaría los predefinidos, y
# uno de menos dejaría algo colgado. Tras borrar se tiene que poder empezar de cero
# sin chocar con nada que quedara (un periodo abierto, la sesión de hoy, un nombre
# de rutina).


def borrar(cliente):
    respuesta = cliente.delete("/datos")
    assert respuesta.status_code == 204, respuesta.text
    assert respuesta.content == b""


def test_borrar_sin_datos_da_204_sin_cuerpo_y_el_resumen_sigue_a_cero(cliente, hoy_es):
    hoy_es(HOY)

    borrar(cliente)

    assert resumen(cliente) == CERO


def test_borrar_lo_deja_todo_vacio_en_la_api(cliente, sesion_bd, datos):
    predefinidos_visibles = sorted(
        fila.id for fila in _predefinidos_en_bd(sesion_bd) if fila.oculto_desde is None
    )
    assert resumen(cliente) != CERO

    borrar(cliente)

    assert sin_marca(exportado(cliente)) == {
        "formato": "training-life",
        "version": 1,
        "predefinidos": [],
        "ejercicios": [],
        "notas": [],
        "rutinas": [],
        "programas": [],
        "excepciones": [],
        "entrenamientos": [],
    }
    assert resumen(cliente) == CERO
    assert cliente.get("/rutinas").json() == []
    assert cliente.get("/rutinas", params={"ocultas": True}).json() == []
    assert cliente.get("/programas").json() == []
    assert cliente.get("/programas", params={"ocultos": True}).json() == []
    assert cliente.get("/ejercicios", params={"ocultos": True}).json() == []
    ejercicios = cliente.get("/ejercicios").json()
    assert all(e["es_predefinido"] for e in ejercicios)
    assert sorted(e["id"] for e in ejercicios) == predefinidos_visibles
    assert cliente.get("/entrenamientos").json() == []
    rango = {"desde": "2026-09-01", "hasta": "2026-09-30"}
    assert cliente.get("/plan/excepciones", params=rango).json() == []
    assert cliente.get(f"/ejercicios/{datos['de_nota'][0]}/notas").json() == []


def test_borrar_no_deja_ninguna_fila_ni_hijos_sueltos(cliente, sesion_bd, datos):
    """Se mira cada tabla entera, no a través de su padre: un hijo que se quedara
    sin él (un hueco, un comodín, un día, una serie) también saldría.
    """
    antes = _foto(sesion_bd)
    # Que no pase por estar ya vacío: el escenario llena las 11 tablas.
    assert all(antes.values()), [tabla for tabla, filas in antes.items() if not filas]

    borrar(cliente)

    assert _foto(sesion_bd) == {tabla: [] for tabla in antes}


def test_borrar_se_lleva_tambien_lo_que_el_resumen_no_cuenta(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id
):
    """El resumen puede decir casi nada y aun así haber cosas: sesiones sin series
    (una cancelada, una sin terminar de otro día, la de hoy en curso y vacía), una
    sesión sin terminar con series, una excepción de descanso (sin rutina) y una nota
    de un predefinido (no se iría con ningún ejercicio propio).
    """
    hoy_es(HOY)
    rutina = Rutina(nombre="Pierna")
    sesion_bd.add_all(
        [
            rutina,
            NotaEjercicio(ejercicio_id=ejercicio_predefinido_id, nota="Barra baja"),
            ExcepcionDelPlan(fecha=date(2026, 9, 18), rutina_id=None),
        ]
    )
    sesion_bd.flush()
    hueco = RutinaSlot(
        rutina_id=rutina.id,
        ejercicio_principal_id=ejercicio_predefinido_id,
        orden=1,
        series_objetivo=3,
        reps_min=5,
        reps_max=8,
    )
    terminada = instante("2026-09-10T18:00:00+00:00")
    con_series = Entrenamiento(rutina_id=rutina.id, fecha=date(2026, 9, 15))
    sesion_bd.add_all(
        [
            hueco,
            con_series,
            Entrenamiento(rutina_id=rutina.id, fecha=date(2026, 9, 10), terminada_en=terminada),
            Entrenamiento(rutina_id=rutina.id, fecha=date(2026, 9, 14)),
            Entrenamiento(rutina_id=rutina.id, fecha=HOY),
        ]
    )
    sesion_bd.flush()
    sesion_bd.add(
        Serie(
            entrenamiento_id=con_series.id,
            slot_id=hueco.id,
            ejercicio_id=ejercicio_predefinido_id,
            numero_serie=1,
            peso=Decimal("100"),
            repeticiones=5,
        )
    )
    sesion_bd.commit()
    assert resumen(cliente)["sesiones"] == 1
    assert len(cliente.get("/entrenamientos").json()) == 4

    borrar(cliente)

    assert _nada(sesion_bd)
    assert cliente.get("/entrenamientos").json() == []
    assert cliente.get(f"/ejercicios/{ejercicio_predefinido_id}/notas").json() == []
    rango = {"desde": "2026-09-01", "hasta": "2026-09-30"}
    assert cliente.get("/plan/excepciones", params=rango).json() == []


def test_borrar_no_toca_los_predefinidos(cliente, sesion_bd, datos):
    antes = _predefinidos_en_bd(sesion_bd)

    borrar(cliente)

    despues = _predefinidos_en_bd(sesion_bd)
    assert len(despues) == 59
    assert despues == antes


def test_borrar_dos_veces_da_204_las_dos(cliente, sesion_bd, datos):
    borrar(cliente)
    borrar(cliente)

    assert resumen(cliente) == CERO
    assert _nada(sesion_bd)


def test_tras_borrar_se_puede_empezar_de_cero(cliente, datos, ejercicio_predefinido_id):
    """El escenario tenía una rutina «Push», un periodo abierto y la sesión de hoy en
    curso: si algo de eso quedara, crear la rutina, activar un programa o empezar hoy
    chocaría con sus restricciones.
    """
    borrar(cliente)

    rutina = cliente.post("/rutinas", json={"nombre": "Push"})
    assert rutina.status_code == 201, rutina.text
    rutina_id = rutina.json()["id"]
    programa = cliente.post(
        "/programas",
        json={
            "nombre": "PPL",
            "activar": True,
            "dias": [{"dia_semana": HOY.isoweekday(), "rutina_id": rutina_id}],
        },
    )
    assert programa.status_code == 201, programa.text
    hoy = cliente.get("/plan/hoy").json()
    assert hoy["sesion"] is None
    assert hoy["situacion"] != "sin_programa"

    sesion = entrenar(cliente, HOY, rutina_id)
    assert sesion.status_code == 201, sesion.text
    serie = serie_en(cliente, sesion.json()["id"], ejercicio_predefinido_id)
    assert serie.status_code == 201, serie.text

    assert resumen(cliente) == {
        **CERO,
        "rutinas": 1,
        "programas": 1,
        "sesiones": 1,
        "series": 1,
        "primera_sesion": HOY.isoformat(),
        "ultima_sesion": HOY.isoformat(),
    }


def test_borrar_hace_las_mismas_consultas_sin_datos_con_poco_y_con_mucho(
    cliente, sesion_bd, hoy_es, ejercicio_predefinido_id
):
    """Sentencias directas, una por tabla: si `borrar_todo` pasara a cargar y borrar
    objeto a objeto, crecería con los datos.
    """
    hoy_es(HOY)

    def borrar_y_contar() -> int:
        def peticion():
            borrar(cliente)
            # `consultas_de` espera un 200; el 204 ya lo ha comprobado `borrar`.
            return SimpleNamespace(status_code=200, text="")

        return consultas_de(peticion)

    sin_datos = borrar_y_contar()
    montar_datos(sesion_bd, ejercicio_predefinido_id)
    con_poco = borrar_y_contar()
    sesion_bd.expire_all()
    montar_datos(sesion_bd, ejercicio_predefinido_id, sesiones_extra=10)
    con_mucho = borrar_y_contar()

    assert sin_datos == con_poco == con_mucho
    assert resumen(cliente) == CERO
