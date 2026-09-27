from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

# Texto que tiene que decir algo: se recorta ANTES de medir la longitud, porque
# con min_length a secas una cadena de solo espacios ("   ") pasaría el filtro.
Nombre = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
TextoNota = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


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
    descripcion: str | None = Field(default=None, max_length=500)


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
    orden: int = Field(gt=0)
    series_objetivo: int = Field(gt=0)
    reps_min: int = Field(gt=0)
    reps_max: int = Field(gt=0)

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
    dia_habitual: str | None = Field(default=None, max_length=20)


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
    numero_serie: int = Field(gt=0)
    peso: Decimal = Field(ge=0)
    repeticiones: int = Field(gt=0)
    rpe: Decimal | None = Field(default=None, ge=0, le=10)
    variante: str | None = Field(default=None, max_length=100)


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
    notas: str | None = Field(default=None, max_length=1000)


class EntrenamientoCreate(EntrenamientoBase):
    pass


class EntrenamientoUpdate(EntrenamientoBase):
    pass


class EntrenamientoOut(EntrenamientoBase):
    """Un entrenamiento tal y como se devuelve al cliente, con sus series anidadas."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    usuario_id: int
    # Las dos las decide el servidor: terminada_en se pone con POST .../terminar,
    # y en_curso se calcula al leer (ver Entrenamiento.en_curso).
    terminada_en: datetime | None
    en_curso: bool
    created_at: datetime
    updated_at: datetime
    series: list[SerieOut]
