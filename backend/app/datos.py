"""Exportar, importar y borrar todos los datos.

Exportar e importar sirven para pasar los datos de un dispositivo a otro (la web y el
móvil no se conectan entre sí) y como copia de seguridad. Importar **sustituye todo**:
se borra todo lo que hay y se carga lo del archivo, en una sola transacción. Borrar es
empezar de cero.

Los ids del archivo solo enlazan cosas dentro del archivo: al importar se asignan otros
(las secuencias siguen donde estaban). Los ejercicios predefinidos y los
grupos musculares van por nombre, porque los siembra una migración y su id cambia de
una instalación a otra.
"""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    Ejercicio,
    Entrenamiento,
    ExcepcionDelPlan,
    GrupoMuscular,
    NotaUsuarioEjercicio,
    Programa,
    ProgramaDia,
    ProgramaPeriodo,
    Rutina,
    RutinaSlot,
    Serie,
    SlotAlternativa,
)
from app.schemas import DatosDeUsuario, ResumenDeDatos

# Más no ayudan a arreglar nada y alargan la respuesta.
MAXIMO_DE_ERRORES = 20


# --- Exportar --------------------------------------------------------------------


def exportar(db: Session) -> DatosDeUsuario:
    """Todo lo que hay, cada lista por id. Un número fijo de consultas. De los
    ejercicios, solo los propios: los predefinidos vienen con la app.
    """
    ejercicios = db.scalars(
        select(Ejercicio).where(Ejercicio.es_predefinido.is_(False)).order_by(Ejercicio.id)
    ).all()
    notas = db.scalars(select(NotaUsuarioEjercicio).order_by(NotaUsuarioEjercicio.id)).all()
    rutinas = db.scalars(select(Rutina).order_by(Rutina.id)).all()
    huecos = db.scalars(select(RutinaSlot).order_by(RutinaSlot.id)).all()
    alternativas = db.scalars(select(SlotAlternativa).order_by(SlotAlternativa.id)).all()
    programas = db.scalars(select(Programa).order_by(Programa.id)).all()
    dias = db.scalars(select(ProgramaDia).order_by(ProgramaDia.id)).all()
    periodos = db.scalars(select(ProgramaPeriodo).order_by(ProgramaPeriodo.id)).all()
    excepciones = db.scalars(select(ExcepcionDelPlan).order_by(ExcepcionDelPlan.id)).all()
    sesiones = db.scalars(select(Entrenamiento).order_by(Entrenamiento.id)).all()
    series = db.scalars(select(Serie).order_by(Serie.id)).all()
    grupos = dict(db.execute(select(GrupoMuscular.id, GrupoMuscular.nombre)).all())

    # Solo los predefinidos que usa algo: los demás vienen con la app.
    usados = (
        {hueco.ejercicio_principal_id for hueco in huecos}
        | {alternativa.ejercicio_id for alternativa in alternativas}
        | {serie.ejercicio_id for serie in series}
        | {nota.ejercicio_id for nota in notas}
    )
    predefinidos = db.scalars(
        select(Ejercicio)
        .where(Ejercicio.id.in_(usados), Ejercicio.es_predefinido.is_(True))
        .order_by(Ejercicio.id)
    ).all()

    alternativas_de: dict[int, list[int]] = {}
    for alternativa in alternativas:
        alternativas_de.setdefault(alternativa.slot_id, []).append(alternativa.ejercicio_id)
    huecos_de: dict[int, list[dict]] = {}
    for hueco in huecos:
        huecos_de.setdefault(hueco.rutina_id, []).append(
            {
                "id": hueco.id,
                "ejercicio_principal_id": hueco.ejercicio_principal_id,
                "orden": hueco.orden,
                "series_objetivo": hueco.series_objetivo,
                "reps_min": hueco.reps_min,
                "reps_max": hueco.reps_max,
                "alternativa_ids": alternativas_de.get(hueco.id, []),
                "oculto_desde": hueco.oculto_desde,
                "created_at": hueco.created_at,
                "updated_at": hueco.updated_at,
            }
        )
    dias_de: dict[int, list[dict]] = {}
    for dia in dias:
        dias_de.setdefault(dia.programa_id, []).append(
            {
                "dia_semana": dia.dia_semana,
                "rutina_id": dia.rutina_id,
                "desde": dia.desde,
                "hasta": dia.hasta,
            }
        )
    periodos_de: dict[int, list[dict]] = {}
    for periodo in periodos:
        periodos_de.setdefault(periodo.programa_id, []).append(
            {"desde": periodo.desde, "hasta": periodo.hasta}
        )
    series_de: dict[int, list[dict]] = {}
    for serie in series:
        series_de.setdefault(serie.entrenamiento_id, []).append(
            {
                "ejercicio_id": serie.ejercicio_id,
                "slot_id": serie.slot_id,
                "numero_serie": serie.numero_serie,
                "peso": serie.peso,
                "repeticiones": serie.repeticiones,
                "variante": serie.variante,
                "created_at": serie.created_at,
                "updated_at": serie.updated_at,
            }
        )

    return DatosDeUsuario.model_validate(
        {
            "exportado_en": datetime.now(timezone.utc),
            "predefinidos": [{"id": e.id, "nombre": e.nombre} for e in predefinidos],
            "ejercicios": [
                {
                    "id": e.id,
                    "nombre": e.nombre,
                    "grupo_muscular": grupos[e.grupo_muscular_id],
                    "descripcion": e.descripcion,
                    "oculto_desde": e.oculto_desde,
                    "created_at": e.created_at,
                    "updated_at": e.updated_at,
                }
                for e in ejercicios
            ],
            "notas": [
                {
                    "ejercicio_id": n.ejercicio_id,
                    "nota": n.nota,
                    "created_at": n.created_at,
                    "updated_at": n.updated_at,
                }
                for n in notas
            ],
            "rutinas": [
                {
                    "id": r.id,
                    "nombre": r.nombre,
                    "oculto_desde": r.oculto_desde,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                    "slots": huecos_de.get(r.id, []),
                }
                for r in rutinas
            ],
            "programas": [
                {
                    "nombre": p.nombre,
                    "oculto_desde": p.oculto_desde,
                    "created_at": p.created_at,
                    "updated_at": p.updated_at,
                    "dias": dias_de.get(p.id, []),
                    "periodos": periodos_de.get(p.id, []),
                }
                for p in programas
            ],
            "excepciones": [
                {
                    "fecha": x.fecha,
                    "rutina_id": x.rutina_id,
                    "created_at": x.created_at,
                    "updated_at": x.updated_at,
                }
                for x in excepciones
            ],
            "entrenamientos": [
                {
                    "rutina_id": s.rutina_id,
                    "fecha": s.fecha,
                    "cubre_fecha": s.cubre_fecha,
                    "notas": s.notas,
                    "terminada_en": s.terminada_en,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                    "series": series_de.get(s.id, []),
                }
                for s in sesiones
            ],
        }
    )


# --- Validar -----------------------------------------------------------------------


@dataclass
class Mapas:
    """Lo que `validar` resuelve y `cargar` necesita: a qué id de esta instalación
    corresponde cada predefinido del archivo y cada grupo por su nombre.
    """

    predefinidos: dict[int, int] = field(default_factory=dict)
    grupos: dict[str, int] = field(default_factory=dict)


def _repetidos(valores) -> list:
    return [valor for valor, veces in Counter(valores).items() if veces > 1]


def validar(db: Session, datos: DatosDeUsuario) -> tuple[list[str], Mapas]:
    """Todo lo que impediría cargar el archivo tal cual, para decirlo de una vez y no
    tocar nada: ids repetidos, referencias a algo que no está en el archivo,
    predefinidos o grupos que no existen aquí y las restricciones de la base.

    No se valida a propósito lo que no rompe nada y podría venir de una copia legítima
    (periodos solapados, sesiones con fecha futura, el plazo de `cubre_fecha`).
    """
    errores: list[str] = []
    mapas = Mapas()

    # Ids repetidos.
    ids_de_ejercicio = [e.id for e in datos.ejercicios] + [p.id for p in datos.predefinidos]
    for id_ in _repetidos(ids_de_ejercicio):
        errores.append(f"Hay dos ejercicios con el id {id_}.")
    for id_ in _repetidos(r.id for r in datos.rutinas):
        errores.append(f"Hay dos rutinas con el id {id_}.")
    huecos = [(rutina, hueco) for rutina in datos.rutinas for hueco in rutina.slots]
    for id_ in _repetidos(hueco.id for _, hueco in huecos):
        errores.append(f"Hay dos ejercicios de rutina con el id {id_}.")

    # Predefinidos y grupos de esta instalación, por nombre.
    nombres = {p.nombre for p in datos.predefinidos}
    existentes: dict[str, int] = {}
    for id_, nombre in db.execute(
        select(Ejercicio.id, Ejercicio.nombre)
        .where(
            Ejercicio.es_predefinido.is_(True),
            Ejercicio.nombre.in_(nombres),
        )
        .order_by(Ejercicio.id)
    ):
        # Si hubiera dos con el mismo nombre, el más antiguo.
        existentes.setdefault(nombre, id_)
    for predefinido in datos.predefinidos:
        if predefinido.nombre in existentes:
            mapas.predefinidos[predefinido.id] = existentes[predefinido.nombre]
        else:
            errores.append(
                f'El ejercicio predefinido "{predefinido.nombre}" no existe en esta versión'
                " de la app."
            )
    mapas.grupos = {
        nombre: id_ for id_, nombre in db.execute(select(GrupoMuscular.id, GrupoMuscular.nombre))
    }
    for ejercicio in datos.ejercicios:
        if ejercicio.grupo_muscular not in mapas.grupos:
            errores.append(
                f'El grupo muscular "{ejercicio.grupo_muscular}" del ejercicio'
                f' "{ejercicio.nombre}" no existe en esta versión de la app.'
            )

    # Referencias dentro del archivo.
    ejercicios = set(ids_de_ejercicio)
    rutinas = {r.id: r for r in datos.rutinas}
    rutina_del_hueco = {hueco.id: rutina for rutina, hueco in huecos}
    for nota in datos.notas:
        if nota.ejercicio_id not in ejercicios:
            errores.append(
                f"Una nota es de un ejercicio que no está en el archivo ({nota.ejercicio_id})."
            )
    for rutina, hueco in huecos:
        for ejercicio_id in [hueco.ejercicio_principal_id, *hueco.alternativa_ids]:
            if ejercicio_id not in ejercicios:
                errores.append(
                    f'La rutina "{rutina.nombre}" usa un ejercicio que no está en el archivo'
                    f" ({ejercicio_id})."
                )
    # UNIQUE(rutina_id, orden).
    for rutina in datos.rutinas:
        for orden in _repetidos(hueco.orden for hueco in rutina.slots):
            errores.append(
                f'La rutina "{rutina.nombre}" tiene dos ejercicios en la posición {orden}.'
            )
    for programa in datos.programas:
        for dia in programa.dias:
            if dia.rutina_id not in rutinas:
                errores.append(
                    f'El programa "{programa.nombre}" usa una rutina que no está en el archivo'
                    f" ({dia.rutina_id})."
                )
        # Una sola fila vigente por día.
        for dia_semana in _repetidos(d.dia_semana for d in programa.dias if d.hasta is None):
            errores.append(
                f'El programa "{programa.nombre}" tiene dos rutinas a la vez el día {dia_semana}'
                " de la semana."
            )
    abiertos = [
        p.nombre for p in datos.programas for periodo in p.periodos if periodo.hasta is None
    ]
    if len(abiertos) > 1:
        errores.append("Hay más de un programa activo a la vez.")
    for excepcion in datos.excepciones:
        if excepcion.rutina_id is not None and excepcion.rutina_id not in rutinas:
            errores.append(
                f"El día {excepcion.fecha} tiene una rutina que no está en el archivo"
                f" ({excepcion.rutina_id})."
            )
    for fecha in _repetidos(x.fecha for x in datos.excepciones):
        errores.append(f"El día {fecha} está cambiado dos veces.")

    for sesion in datos.entrenamientos:
        rutina = rutinas.get(sesion.rutina_id)
        if rutina is None:
            errores.append(
                f"La sesión del {sesion.fecha} es de una rutina que no está en el archivo"
                f" ({sesion.rutina_id})."
            )
        for serie in sesion.series:
            if serie.ejercicio_id not in ejercicios:
                errores.append(
                    f"La sesión del {sesion.fecha} tiene una serie de un ejercicio que no está"
                    f" en el archivo ({serie.ejercicio_id})."
                )
            # Toda serie va en un hueco de la rutina de su sesión.
            if rutina is not None and rutina_del_hueco.get(serie.slot_id) is not rutina:
                errores.append(
                    f"La sesión del {sesion.fecha} tiene una serie fuera de los ejercicios de"
                    f' "{rutina.nombre}".'
                )
    for fecha in _repetidos(s.fecha for s in datos.entrenamientos):
        errores.append(f"Hay dos sesiones el {fecha}.")
    for fecha in _repetidos(s.cubre_fecha for s in datos.entrenamientos if s.cubre_fecha):
        errores.append(f"Hay dos sesiones que cuentan como la del {fecha}.")

    # Sin repetir un mismo error (una sesión con varias series malas).
    return list(dict.fromkeys(errores))[:MAXIMO_DE_ERRORES], mapas


# --- Resumir ------------------------------------------------------------------------


def resumir_archivo(datos: DatosDeUsuario) -> ResumenDeDatos:
    con_series = [s for s in datos.entrenamientos if s.series]
    fechas = [s.fecha for s in con_series]
    return ResumenDeDatos(
        ejercicios=len(datos.ejercicios),
        notas=len(datos.notas),
        rutinas=len(datos.rutinas),
        programas=len(datos.programas),
        sesiones=len(con_series),
        series=sum(len(s.series) for s in datos.entrenamientos),
        primera_sesion=min(fechas, default=None),
        ultima_sesion=max(fechas, default=None),
    )


def resumir_actual(db: Session) -> ResumenDeDatos:
    def contar(modelo, *condiciones):
        return db.scalar(select(func.count()).select_from(modelo).where(*condiciones))

    sesiones, primera, ultima = db.execute(
        select(
            func.count(func.distinct(Entrenamiento.id)),
            func.min(Entrenamiento.fecha),
            func.max(Entrenamiento.fecha),
        ).join(Serie, Serie.entrenamiento_id == Entrenamiento.id)
    ).one()
    series = contar(Serie)
    return ResumenDeDatos(
        # Solo los propios: los predefinidos vienen con la app y no se pierden al importar.
        ejercicios=contar(Ejercicio, Ejercicio.es_predefinido.is_(False)),
        notas=contar(NotaUsuarioEjercicio),
        rutinas=contar(Rutina),
        programas=contar(Programa),
        sesiones=sesiones,
        series=series,
        primera_sesion=primera,
        ultima_sesion=ultima,
    )


# --- Borrar e importar -------------------------------------------------------------


def borrar_todo(db: Session) -> None:
    """Borra todo lo que hay, menos los ejercicios predefinidos. La usan
    importar y `DELETE /datos`: un cambio aquí cambia los dos.

    Sentencias directas, en el orden que piden las FK: lo que es RESTRICT hacia algo se
    borra antes que ese algo (series → huecos, rutinas y ejercicios; huecos → rutinas
    y ejercicios). Lo que es CASCADE se va solo (días y periodos con su programa,
    series con su sesión, comodines con su hueco).
    """
    db.execute(delete(ExcepcionDelPlan))
    db.execute(delete(Programa))
    db.execute(delete(Entrenamiento))
    # También las notas de predefinidos, que no se irían con ningún ejercicio.
    db.execute(delete(NotaUsuarioEjercicio))
    db.execute(delete(RutinaSlot))
    db.execute(delete(Rutina))
    # ⚠️ Solo los propios: sin esta condición se borrarían también los predefinidos.
    db.execute(delete(Ejercicio).where(Ejercicio.es_predefinido.is_(False)))
    # Las sentencias directas no pasan por la sesión del ORM: lo que tuviera cargado
    # de esas filas ya no existe.
    db.expire_all()


def cargar(db: Session, datos: DatosDeUsuario, mapas: Mapas) -> None:
    """Inserta el archivo, nivel a nivel y en su orden, con ids nuevos. Cada nivel hace
    `flush()` para tener los ids que necesita el siguiente. Las fechas de creación y
    de cambio se conservan: la copia es idéntica a lo exportado.
    """
    ejercicio_nuevo = dict(mapas.predefinidos)
    ejercicios = []
    for e in datos.ejercicios:
        nuevo = Ejercicio(
            nombre=e.nombre,
            grupo_muscular_id=mapas.grupos[e.grupo_muscular],
            descripcion=e.descripcion,
            es_predefinido=False,
            oculto_desde=e.oculto_desde,
            created_at=e.created_at,
            updated_at=e.updated_at,
        )
        ejercicios.append((e.id, nuevo))
    db.add_all(nuevo for _, nuevo in ejercicios)
    db.flush()
    ejercicio_nuevo.update({viejo: nuevo.id for viejo, nuevo in ejercicios})

    db.add_all(
        NotaUsuarioEjercicio(
            ejercicio_id=ejercicio_nuevo[n.ejercicio_id],
            nota=n.nota,
            created_at=n.created_at,
            updated_at=n.updated_at,
        )
        for n in datos.notas
    )

    rutinas = [
        (
            r,
            Rutina(
                nombre=r.nombre,
                oculto_desde=r.oculto_desde,
                created_at=r.created_at,
                updated_at=r.updated_at,
            ),
        )
        for r in datos.rutinas
    ]
    db.add_all(nueva for _, nueva in rutinas)
    db.flush()
    rutina_nueva = {r.id: nueva.id for r, nueva in rutinas}

    huecos = [
        (
            h,
            RutinaSlot(
                rutina_id=rutina_nueva[r.id],
                ejercicio_principal_id=ejercicio_nuevo[h.ejercicio_principal_id],
                orden=h.orden,
                series_objetivo=h.series_objetivo,
                reps_min=h.reps_min,
                reps_max=h.reps_max,
                oculto_desde=h.oculto_desde,
                created_at=h.created_at,
                updated_at=h.updated_at,
            ),
        )
        for r, _ in rutinas
        for h in r.slots
    ]
    db.add_all(nuevo for _, nuevo in huecos)
    db.flush()
    hueco_nuevo = {h.id: nuevo.id for h, nuevo in huecos}
    db.add_all(
        SlotAlternativa(slot_id=hueco_nuevo[h.id], ejercicio_id=ejercicio_nuevo[ejercicio_id])
        for h, _ in huecos
        for ejercicio_id in h.alternativa_ids
    )

    programas = [
        (
            p,
            Programa(
                nombre=p.nombre,
                oculto_desde=p.oculto_desde,
                created_at=p.created_at,
                updated_at=p.updated_at,
            ),
        )
        for p in datos.programas
    ]
    db.add_all(nuevo for _, nuevo in programas)
    db.flush()
    for p, nuevo in programas:
        db.add_all(
            ProgramaDia(
                programa_id=nuevo.id,
                dia_semana=d.dia_semana,
                rutina_id=rutina_nueva[d.rutina_id],
                desde=d.desde,
                hasta=d.hasta,
            )
            for d in p.dias
        )
        db.add_all(
            ProgramaPeriodo(programa_id=nuevo.id, desde=x.desde, hasta=x.hasta) for x in p.periodos
        )

    db.add_all(
        ExcepcionDelPlan(
            fecha=x.fecha,
            rutina_id=None if x.rutina_id is None else rutina_nueva[x.rutina_id],
            created_at=x.created_at,
            updated_at=x.updated_at,
        )
        for x in datos.excepciones
    )

    sesiones = [
        (
            s,
            Entrenamiento(
                rutina_id=rutina_nueva[s.rutina_id],
                fecha=s.fecha,
                cubre_fecha=s.cubre_fecha,
                notas=s.notas,
                terminada_en=s.terminada_en,
                created_at=s.created_at,
                updated_at=s.updated_at,
            ),
        )
        for s in datos.entrenamientos
    ]
    db.add_all(nueva for _, nueva in sesiones)
    db.flush()
    db.add_all(
        Serie(
            entrenamiento_id=nueva.id,
            slot_id=hueco_nuevo[x.slot_id],
            ejercicio_id=ejercicio_nuevo[x.ejercicio_id],
            numero_serie=x.numero_serie,
            peso=x.peso,
            repeticiones=x.repeticiones,
            variante=x.variante,
            created_at=x.created_at,
            updated_at=x.updated_at,
        )
        for s, nueva in sesiones
        for x in s.series
    )
    db.flush()
