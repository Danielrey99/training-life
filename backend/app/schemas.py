from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

# Texto que tiene que decir algo: se recorta ANTES de medir la longitud, porque
# con min_length a secas una cadena de solo espacios ("   ") pasaría el filtro.
Nombre = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
TextoNota = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


def _vacio_a_nulo(valor):
    if isinstance(valor, str):
        return valor.strip() or None
    return valor


# Texto que se puede dejar en blanco: recortado y, si no queda nada, nulo. Así
# "" o "   " no se guardan como si dijeran algo, y "sin variante" es siempre null.
TextoOpcional = Annotated[str | None, BeforeValidator(_vacio_a_nulo)]


class GrupoMuscularOut(BaseModel):
    """Grupo muscular tal y como se devuelve al cliente. Sin CRUD propio: es
    un catálogo fijo, sembrado por migración.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str


class EjercicioBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar un ejercicio.

    Deliberadamente no incluye usuario_id, es_predefinido, visibilidad ni
    oculto_desde: esos los decide el backend, no el cliente.
    """

    nombre: Nombre
    grupo_muscular_id: int
    descripcion: TextoOpcional = Field(default=None, max_length=500)


class EjercicioCreate(EjercicioBase):
    pass


class EjercicioUpdate(EjercicioBase):
    pass


class EjercicioOut(EjercicioBase):
    """Ejercicio tal y como se devuelve al cliente, incluyendo los campos
    gestionados por el backend.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    es_predefinido: bool
    usuario_id: int | None
    visibilidad: str
    oculto_desde: date | None
    created_at: datetime
    updated_at: datetime


class NotaBase(BaseModel):
    """El único campo que el cliente envía al crear o editar una nota.

    usuario_id lo decide el backend y ejercicio_id viene de la ruta, así que
    ninguno de los dos se declara aquí.
    """

    nota: TextoNota


class NotaCreate(NotaBase):
    pass


class NotaUpdate(NotaBase):
    pass


class NotaOut(NotaBase):
    """Una nota tal y como se devuelve al cliente.

    No resuelve el ejercicio completo (a diferencia de SerieOut): quien pide
    las notas ya sabe de qué ejercicio son, está en la propia ruta.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    usuario_id: int
    ejercicio_id: int
    created_at: datetime
    updated_at: datetime


class RutinaSlotBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar un hueco."""

    ejercicio_principal_id: int
    # Los topes no son de la base de datos (que admite mucho más), sino de lo que
    # tiene sentido: un número fuera de ellos solo puede ser un error al teclear.
    orden: int = Field(gt=0, le=100)
    series_objetivo: int = Field(gt=0, le=50)
    reps_min: int = Field(gt=0, le=1000)
    reps_max: int = Field(gt=0, le=1000)

    @model_validator(mode="after")
    def _validar_rango_reps(self):
        if self.reps_max < self.reps_min:
            raise ValueError("reps_max no puede ser menor que reps_min")
        return self


class RutinaSlotCreate(RutinaSlotBase):
    pass


class RutinaSlotUpdate(RutinaSlotBase):
    pass


class RutinaSlotOut(RutinaSlotBase):
    """Un hueco tal y como se devuelve al cliente — con el ejercicio
    principal y los comodines ya resueltos (no solo sus ids), para no
    obligar al cliente a cruzar datos con /ejercicios.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    rutina_id: int
    oculto_desde: date | None
    created_at: datetime
    updated_at: datetime
    ejercicio_principal: EjercicioOut
    alternativas: list[EjercicioOut]


class RutinaBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar una rutina.

    No incluye los huecos (slots): se gestionan aparte, con sus propios
    endpoints anidados bajo /rutinas/{id}/slots.
    """

    nombre: Nombre


class RutinaCreate(RutinaBase):
    pass


class RutinaUpdate(RutinaBase):
    pass


class RutinaOut(RutinaBase):
    """Una rutina tal y como se devuelve al cliente, con sus huecos anidados."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    usuario_id: int
    oculto_desde: date | None
    # En cuántos programas visibles aparece: la lista de rutinas lo enseña.
    num_programas: int
    created_at: datetime
    updated_at: datetime
    slots: list[RutinaSlotOut]


class ComodinCreate(BaseModel):
    """Body para añadir un ejercicio comodín a un hueco."""

    ejercicio_id: int


class SerieBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar una serie."""

    ejercicio_id: int
    slot_id: int | None = None
    numero_serie: int = Field(gt=0, le=100)
    # 9999,99 es lo que cabe en la columna (NUMERIC(6,2)): sin este tope, un peso
    # mayor llegaba a la base de datos y la respuesta era un 500.
    peso: Decimal = Field(ge=0, le=Decimal("9999.99"))
    repeticiones: int = Field(gt=0, le=1000)
    rpe: Decimal | None = Field(default=None, ge=0, le=10)
    variante: TextoOpcional = Field(default=None, max_length=100)


class SerieCreate(SerieBase):
    pass


class SerieUpdate(SerieBase):
    pass


class SerieOut(SerieBase):
    """Una serie tal y como se devuelve al cliente, con el ejercicio ya resuelto."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    entrenamiento_id: int
    created_at: datetime
    updated_at: datetime
    ejercicio: EjercicioOut


class EjercicioMinimo(BaseModel):
    """Lo justo para saber qué ejercicio fue, sin arrastrar EjercicioOut entero.

    En el historial de un hueco esto se repite en cada serie de cada día, así que
    devolver el ejercicio completo multiplicaría el tamaño de la respuesta.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str


class SerieHistorial(BaseModel):
    """Una serie dentro del historial.

    No repite la fecha ni el ejercicio: los trae la sesión que la agrupa.
    `slot_id` sí viene, porque el mismo ejercicio puede ocupar dos huecos de la
    rutina (principal en uno, comodín en otro) y entonces un mismo día trae dos
    tandas de series que solo se distinguen por ahí. Es `null` si el
    entrenamiento fue libre.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    slot_id: int | None
    numero_serie: int
    peso: Decimal
    repeticiones: int
    rpe: Decimal | None
    variante: str | None


class SerieHistorialHueco(SerieHistorial):
    """En el historial de un hueco sí importa con qué ejercicio se hizo cada serie:
    puede ser el principal un día y un comodín otro.
    """

    ejercicio: EjercicioMinimo


class SesionHistorial(BaseModel):
    """Un día de entrenamiento con las series que tocaron ese ejercicio o ese hueco.

    `rutina` es el nombre de la rutina que se siguió, o `null` si fue un
    entrenamiento libre.
    """

    entrenamiento_id: int
    fecha: date
    rutina: str | None
    series: list[SerieHistorial]


class SesionHistorialHueco(SesionHistorial):
    series: list[SerieHistorialHueco]


class EntrenamientoBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar un entrenamiento.

    No incluye las series: se gestionan aparte, con sus propios endpoints
    anidados bajo /entrenamientos/{id}/series.
    """

    rutina_id: int | None = None
    fecha: date
    notas: TextoOpcional = Field(default=None, max_length=1000)


class EntrenamientoCreate(EntrenamientoBase):
    # Qué día del plan cuenta la sesión: lo decide el botón pulsado (Empezar,
    # Recuperar, Adelantar), así que solo se manda al crear. No va en la base
    # común: el PUT copia todos los campos, y lo pondría a nulo en cada edición.
    cubre_fecha: date | None = None


class EntrenamientoUpdate(EntrenamientoBase):
    pass


class EntrenamientoOut(EntrenamientoBase):
    """Un entrenamiento tal y como se devuelve al cliente, con sus series anidadas."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    usuario_id: int
    cubre_fecha: date | None
    # Las dos las decide el servidor: terminada_en se pone con POST .../terminar,
    # y en_curso se calcula al leer (ver Entrenamiento.en_curso).
    terminada_en: datetime | None
    en_curso: bool
    created_at: datetime
    updated_at: datetime
    series: list[SerieOut]


# --- Programas -----------------------------------------------------------


class RutinaMinima(BaseModel):
    """Lo justo de una rutina para pintarla en un día del programa, incluido si
    está oculta: un día con una rutina oculta se enseña en gris y cuenta como
    descanso.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    oculto_desde: date | None


DiaSemana = Annotated[int, Field(ge=1, le=7, description="1 = lunes … 7 = domingo")]


class ProgramaDiaCreate(BaseModel):
    dia_semana: DiaSemana
    rutina_id: int


class ProgramaDiaUpdate(BaseModel):
    """Body para poner una rutina en un día. El día va en la ruta."""

    rutina_id: int


class ProgramaDiaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    dia_semana: int
    rutina: RutinaMinima


class ProgramaCreate(BaseModel):
    """Un programa nuevo con sus días de una vez: la pantalla de crear programa
    no guarda nada hasta pulsar Crear. Los días que no se manden son descanso.
    """

    nombre: Nombre
    dias: list[ProgramaDiaCreate] = []
    # "Activarlo al crearlo": deja de estar activo el que lo fuera hasta ahora.
    activar: bool = False

    @model_validator(mode="after")
    def _validar_dias_sin_repetir(self):
        dias = [dia.dia_semana for dia in self.dias]
        if len(dias) != len(set(dias)):
            raise ValueError("Un día no puede tener dos rutinas: hay días repetidos")
        return self


class ProgramaUpdate(BaseModel):
    """Solo el nombre: los días se cambian uno a uno, con sus propios endpoints."""

    nombre: Nombre


class ProgramaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    usuario_id: int
    nombre: str
    oculto_desde: date | None
    # Los dos se deducen de sus periodos (ver Programa.activo).
    activo: bool
    activo_desde: date | None
    created_at: datetime
    updated_at: datetime
    dias: list[ProgramaDiaOut]


class PeriodoOut(BaseModel):
    """Un tramo en que un programa estuvo activo, de `desde` a `hasta` (sin
    incluirlo); `hasta` nulo si sigue activo.
    """

    model_config = ConfigDict(from_attributes=True)

    desde: date
    hasta: date | None


# --- Plan ----------------------------------------------------------------


class DiaPlanOut(BaseModel):
    """Qué toca un día. `descanso` es verdadero si no hay rutina o si la que hay
    estaba oculta ese día: entonces la rutina viene igual, para enseñarla en gris.
    """

    model_config = ConfigDict(from_attributes=True)

    fecha: date
    origen: Literal["excepcion", "programa", "sin_programa"]
    programa_id: int | None
    rutina: RutinaMinima | None
    descanso: bool


class ExcepcionUpdate(BaseModel):
    """Qué toca un día concreto en vez de lo que diga el programa. `rutina_id`
    nulo es descanso. La fecha va en la ruta.
    """

    rutina_id: int | None


class ExcepcionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fecha: date
    rutina: RutinaMinima | None


class IntercambioCreate(BaseModel):
    """Dos días que intercambian lo que les toca: lo de uno pasa al otro."""

    fecha_a: date
    fecha_b: date


class ActivarPrograma(BaseModel):
    # Al cambiar de programa, lo que se planificó a mano para los próximos días
    # se hizo pensando en el anterior; la pantalla ofrece quitarlo.
    quitar_excepciones: bool = False
