from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
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


# Cómo se apunta un ejercicio (ver `app/medidas.py`). Se elige al crearlo y no cambia.
TipoRegistro = Literal["peso_reps", "corporal", "tiempo", "cardio"]


class EjercicioBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar un ejercicio.

    Deliberadamente no incluye es_predefinido ni oculto_desde: los decide el
    backend, no el cliente.
    """

    nombre: Nombre
    grupo_muscular_id: int
    descripcion: TextoOpcional = Field(default=None, max_length=500)


class EjercicioCreate(EjercicioBase):
    tipo_registro: TipoRegistro = "peso_reps"


class EjercicioUpdate(EjercicioBase):
    # Sin `tipo_registro`: no se cambia. Si llega, Pydantic lo ignora.
    pass


class EjercicioOut(EjercicioBase):
    """Ejercicio tal y como se devuelve al cliente, incluyendo los campos
    gestionados por el backend.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    es_predefinido: bool
    tipo_registro: TipoRegistro
    oculto_desde: date | None
    created_at: datetime
    updated_at: datetime


class NotaBase(BaseModel):
    """El único campo que el cliente envía al crear o editar una nota.

    ejercicio_id viene de la ruta, así que no se declara aquí.
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
    ejercicio_id: int
    created_at: datetime
    updated_at: datetime


class ObjetivoBase(BaseModel):
    """El objetivo de un ejercicio en un hueco: series, y repeticiones o duración.

    Exactamente un par, completo. De cuál es lo decide el tipo del ejercicio (lo
    comprueba el endpoint, que es quien conoce el ejercicio).
    """

    # Los topes no son de la base de datos (que admite mucho más), sino de lo que
    # tiene sentido: un número fuera de ellos solo puede ser un error al teclear.
    series_objetivo: int = Field(gt=0, le=50)
    reps_min: int | None = Field(None, gt=0, le=1000)
    reps_max: int | None = Field(None, gt=0, le=1000)
    duracion_min_s: int | None = Field(None, gt=0, le=86400)
    duracion_max_s: int | None = Field(None, gt=0, le=86400)

    @model_validator(mode="after")
    def _validar_objetivo(self):
        con_reps = (self.reps_min is not None, self.reps_max is not None)
        con_duracion = (self.duracion_min_s is not None, self.duracion_max_s is not None)
        if len(set(con_reps)) != 1 or len(set(con_duracion)) != 1 or con_reps[0] == con_duracion[0]:
            raise ValueError(
                "El objetivo lleva repeticiones (reps_min y reps_max) o duración "
                "(duracion_min_s y duracion_max_s): uno de los dos, completo"
            )
        if con_reps[0] and self.reps_max < self.reps_min:
            raise ValueError("reps_max no puede ser menor que reps_min")
        if con_duracion[0] and self.duracion_max_s < self.duracion_min_s:
            raise ValueError("duracion_max_s no puede ser menor que duracion_min_s")
        return self


class RutinaSlotBase(ObjetivoBase):
    """Campos de un hueco que valen igual al crearlo que al editarlo.

    Sin `orden`: al crear es opcional (el backend lo pone al final) y al editar es
    obligatorio, así que cada esquema lo declara a su manera.
    """

    ejercicio_principal_id: int


class AlternativaDeHueco(ObjetivoBase):
    """Una alternativa de un hueco al crearlo o editarlo, con su propio objetivo."""

    ejercicio_id: int


def _validar_comodines(principal_id: int, alternativas: list[AlternativaDeHueco] | None) -> None:
    """Lo incoherente dentro del propio cuerpo es un 422, no un 409: no choca con
    nada guardado (como `_validar_dias_sin_repetir` de `ProgramaCreate`).
    """
    if alternativas is None:
        return
    ids = [alternativa.ejercicio_id for alternativa in alternativas]
    if principal_id in ids:
        raise ValueError("Un comodín no puede ser el ejercicio principal del hueco")
    if len(set(ids)) != len(ids):
        raise ValueError("Hay comodines repetidos")


class SlotDeRutinaNueva(RutinaSlotBase):
    """Un hueco dentro de `RutinaCreate`: su orden es su posición en la lista."""

    alternativas: list[AlternativaDeHueco] = []

    @model_validator(mode="after")
    def _validar_alternativas(self):
        _validar_comodines(self.ejercicio_principal_id, self.alternativas)
        return self


class RutinaSlotCreate(SlotDeRutinaNueva):
    # Sin él, el hueco va al final (máximo de todos, también los ocultos, + 1).
    orden: int | None = Field(None, gt=0, le=100)


class RutinaSlotUpdate(RutinaSlotBase):
    orden: int = Field(gt=0, le=100)
    # Sin ella (o nula), los comodines no se tocan; una lista sustituye a la actual.
    alternativas: list[AlternativaDeHueco] | None = None

    @model_validator(mode="after")
    def _validar_alternativas(self):
        _validar_comodines(self.ejercicio_principal_id, self.alternativas)
        return self


class AlternativaOut(ObjetivoBase):
    """Una alternativa de un hueco: el ejercicio y su objetivo en él."""

    model_config = ConfigDict(from_attributes=True)

    ejercicio: EjercicioOut


class RutinaSlotOut(RutinaSlotBase):
    """Un hueco tal y como se devuelve al cliente — con el ejercicio
    principal y los comodines ya resueltos (no solo sus ids), para no
    obligar al cliente a cruzar datos con /ejercicios.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    rutina_id: int
    orden: int
    oculto_desde: date | None
    created_at: datetime
    updated_at: datetime
    ejercicio_principal: EjercicioOut
    alternativas: list[AlternativaOut] = Field(validation_alias="slot_alternativas")


class RutinaBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar una rutina.

    No incluye los huecos (slots): al editar se gestionan aparte, con sus propios
    endpoints anidados bajo /rutinas/{id}/slots.
    """

    nombre: Nombre


class RutinaCreate(RutinaBase):
    """Una rutina nueva, opcionalmente con sus huecos y comodines de una vez: la
    pantalla de rutina nueva no guarda nada hasta pulsar Guardar, y crearlo todo en
    una sola petición evita que un fallo a medias deje una rutina a medias.

    `slots` va aquí y no en `RutinaBase`: el PUT copia todo el cuerpo a la rutina y
    acabaría asignando diccionarios a la relación.
    """

    # El tope coincide con el de `orden`.
    slots: list[SlotDeRutinaNueva] = Field(default=[], max_length=100)


class RutinaUpdate(RutinaBase):
    pass


class RutinaOut(RutinaBase):
    """Una rutina tal y como se devuelve al cliente, con sus huecos anidados."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    oculto_desde: date | None
    # En cuántos programas visibles aparece: la lista de rutinas lo enseña.
    num_programas: int
    created_at: datetime
    updated_at: datetime
    slots: list[RutinaSlotOut]


class OrdenDeHuecos(BaseModel):
    """Body para reordenar los huecos de una rutina: todos los visibles, cada uno
    una vez, en el orden nuevo.
    """

    slot_ids: list[int]

    @model_validator(mode="after")
    def _validar_sin_repetir(self):
        if len(self.slot_ids) != len(set(self.slot_ids)):
            raise ValueError("Hay huecos repetidos")
        return self


class AvisoDeBorrarRutinaOut(BaseModel):
    """Lo que se perdería al borrar una rutina, para el diálogo de confirmar.

    Es lo único que cuenta lo que se perdería: el 409 del DELETE solo pide elegir
    `modo`, y sin historial el DELETE la borraría sin preguntar.
    """

    # Si el DELETE sin `modo` daría 409.
    con_historial: bool
    # Todos, también los ocultos.
    huecos: int
    # Las que tienen alguna serie. La de hoy vacía la dice `sesion_en_curso`; las
    # canceladas no cuentan.
    sesiones: int
    # Días vigentes de cualquier programa, que pasarían a descanso.
    dias_de_programa: int
    # Días planificados a mano con ella, que volverían a lo que diga el programa.
    dias_planificados: int
    # Si tocó días que ya pasaron, que en el calendario pasarían a descanso.
    toco_dias_pasados: bool
    # Si hay una sesión de esta rutina abierta hoy, con o sin series: se borraría con
    # ella. Si es verdadero, `con_historial` también (una en curso no está cancelada).
    sesion_en_curso: bool


class SesionQueSeVaciaOut(BaseModel):
    """Una sesión cuyas series están todas en el hueco que se va a borrar: se
    borraría con él.
    """

    entrenamiento_id: int
    fecha: date
    cubre_fecha: date | None


class AvisoDeBorrarHuecoOut(BaseModel):
    """Lo que se perdería al borrar un hueco, para el diálogo de confirmar."""

    series: int
    # La primera fecha con series en el hueco; nula si no tiene.
    desde: date | None
    # Se quedan sin ninguna serie y se borran con el hueco; si contaban un día del
    # plan, ese día vuelve a quedar sin hacer. No incluye la sesión en curso de hoy,
    # que sigue abierta.
    sesiones_que_se_vacian: list[SesionQueSeVaciaOut]


class SerieBase(BaseModel):
    """Campos que el cliente puede enviar al crear o editar una serie."""

    ejercicio_id: int
    slot_id: int
    numero_serie: int = Field(gt=0, le=100)
    # Qué medidas lleva cada serie lo decide el tipo de su ejercicio (`app/medidas.py`):
    # aquí solo los rangos. 9999,99 es lo que cabe en la columna (NUMERIC(6,2)); el peso
    # puede ser negativo porque la ayuda de las dominadas se guarda así.
    peso: Decimal | None = Field(default=None, ge=Decimal("-9999.99"), le=Decimal("9999.99"))
    repeticiones: int | None = Field(default=None, gt=0, le=1000)
    # En segundos, hasta un día.
    duracion_s: int | None = Field(default=None, gt=0, le=86400)
    # En metros, hasta mil kilómetros.
    distancia_m: int | None = Field(default=None, gt=0, le=1_000_000)
    # `ge` y no `gt`: con 0,001 pasaría la validación y NUMERIC(5,2) lo redondea a 0,00.
    peso_corporal: Decimal | None = Field(default=None, ge=Decimal("0.01"), le=Decimal("500"))
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


class SerieHistorial(BaseModel):
    """Una serie dentro del historial.

    No repite la fecha ni el ejercicio: los trae la sesión que la agrupa.
    `slot_id` sí viene, porque el mismo ejercicio puede ocupar dos huecos de la
    rutina (principal en uno, comodín en otro) y entonces un mismo día trae dos
    tandas de series que solo se distinguen por ahí.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    slot_id: int
    numero_serie: int
    peso: Decimal | None
    repeticiones: int | None
    duracion_s: int | None
    distancia_m: int | None
    variante: str | None


class SesionHistorial(BaseModel):
    """Un día de entrenamiento con las series que tocaron ese ejercicio.

    `rutina` es el nombre de la rutina que se siguió.
    """

    entrenamiento_id: int
    fecha: date
    rutina: str
    series: list[SerieHistorial]


class EntrenamientoBase(BaseModel):
    """Campos que el cliente puede enviar al crear o corregir un entrenamiento.

    No incluye las series: se gestionan aparte, con sus propios endpoints
    anidados bajo /entrenamientos/{id}/series.
    """

    fecha: date
    notas: TextoOpcional = Field(default=None, max_length=1000)


class EntrenamientoCreate(EntrenamientoBase):
    # La rutina y el día del plan que cuenta la sesión se deciden al empezarla (el
    # botón pulsado: Empezar, Recuperar, Adelantar) y no cambian después. No van en
    # la base común: el PUT copia todos sus campos y los sobrescribiría. Para apuntar
    # otra rutina se borra el día y se registra de nuevo.
    rutina_id: int
    cubre_fecha: date | None = None
    # Solo al empezar hoy lo que toca otro día: antes de crear la sesión, lo de hoy y
    # lo de ese día se intercambian, todo en una sola transacción (ver
    # `crear_entrenamiento`). No se guarda: la sesión no lo recuerda.
    intercambiar_con: date | None = None


class EntrenamientoUpdate(EntrenamientoBase):
    pass


class EntrenamientoOut(EntrenamientoBase):
    """Un entrenamiento tal y como se devuelve al cliente, con sus series anidadas."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    rutina_id: int
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


class ProgramaDeUnUsoOut(BaseModel):
    """Un programa donde está la rutina de un uso, para decir en cuál está."""

    id: int
    nombre: str
    # Si es el programa en uso ahora.
    activo: bool


class UsoEnRutinaOut(BaseModel):
    """Un hueco donde aparece un ejercicio, para «Rutinas donde se usa»
    y para el aviso de borrarlo.
    """

    rutina: RutinaMinima
    slot_id: int
    # En ASCII, como el resto de valores fijos de la API.
    rol: Literal["principal", "comodin"]
    # Su número entre los huecos visibles de la rutina, desde 1; nulo si el hueco
    # está oculto (un hueco oculto no es un ejercicio de la rutina).
    posicion: int | None
    # El hueco o su rutina están ocultos: la ficha lo enseña aparte, plegado. Lo
    # decide la API para que la web y el móvil no repitan la regla.
    oculto: bool
    # Los visibles donde la rutina tiene algún día vigente.
    programas: list[ProgramaDeUnUsoOut]


class AvisoDeBorrarEjercicioOut(BaseModel):
    """Lo que se perdería al borrar un ejercicio, para el diálogo de confirmar.

    Es lo único que cuenta lo que se perdería: el 409 del DELETE solo pide elegir
    `modo`, y sin historial el DELETE lo borraría sin preguntar.
    """

    # Si el DELETE sin `modo` daría 409. Las notas no cuentan: no lo bloquean.
    con_historial: bool
    # Todas las que se borrarían: las suyas y las de los huecos donde es el principal.
    series: int
    # Sesiones distintas con alguna de esas series.
    sesiones: int
    # La primera fecha con alguna de esas series; nula si no hay.
    desde: date | None
    notas: int
    # Principal: el hueco se borra. Comodín: deja de ser alternativa en él.
    huecos: list[UsoEnRutinaOut]
    # Se quedan sin ninguna serie y se borran con él; no incluye la sesión en curso
    # de hoy, que sigue abierta.
    sesiones_que_se_vacian: list[SesionQueSeVaciaOut]


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
    # Con `activar`: quita además los días cambiados a mano de hoy en adelante (como en
    # `ActivarPrograma`). Sin `activar` no tiene sentido y da 422.
    quitar_excepciones: bool = False

    @model_validator(mode="after")
    def _validar_dias_sin_repetir(self):
        dias = [dia.dia_semana for dia in self.dias]
        if len(dias) != len(set(dias)):
            raise ValueError("Un día no puede tener dos rutinas: hay días repetidos")
        return self

    @model_validator(mode="after")
    def _validar_quitar_con_activar(self):
        if self.quitar_excepciones and not self.activar:
            raise ValueError("Solo se quitan los días cambiados a mano al activar el programa")
        return self


class ProgramaUpdate(BaseModel):
    """Solo el nombre: los días se cambian uno a uno, con sus propios endpoints."""

    nombre: Nombre


class PeriodoOut(BaseModel):
    """Un tramo en que un programa estuvo activo, de `desde` a `hasta` (sin
    incluirlo); `hasta` nulo si sigue activo.
    """

    model_config = ConfigDict(from_attributes=True)

    desde: date
    hasta: date | None


class ProgramaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    oculto_desde: date | None
    # Se deduce de sus periodos (ver Programa.activo).
    activo: bool
    # El abierto si está activo, si no el último que se cerró; nulo si nunca se usó.
    ultimo_periodo: PeriodoOut | None
    created_at: datetime
    updated_at: datetime
    dias: list[ProgramaDiaOut]


# --- Plan ----------------------------------------------------------------


class DiaPlanOut(BaseModel):
    """Qué toca un día. `descanso` es verdadero si no hay rutina o si la que hay
    estaba oculta ese día: entonces la rutina viene igual, para enseñarla en gris.
    """

    model_config = ConfigDict(from_attributes=True)

    fecha: date
    origen: Literal["excepcion", "programa", "sin_programa"]
    rutina: RutinaMinima | None
    descanso: bool


class CoberturaOut(BaseModel):
    """La sesión que cuenta un día, y en qué fecha se hizo."""

    model_config = ConfigDict(from_attributes=True)

    entrenamiento_id: int
    fecha: date


class SesionDelDiaOut(BaseModel):
    """Lo que se hizo un día, cuente o no para alguno. `cuenta` dice si cuenta de
    verdad para `cubre_fecha`: el plan de ese día sigue siendo su rutina y la
    sesión no está cancelada.
    """

    model_config = ConfigDict(from_attributes=True)

    entrenamiento_id: int
    rutina: RutinaMinima
    en_curso: bool
    cubre_fecha: date | None
    cuenta: bool


class DiaSeguimientoOut(DiaPlanOut):
    """Un día del plan con lo que pasó. `estado` es de lo que tocaba ese día;
    `sesion`, de lo que se hizo, que puede ser otra cosa: con los dos se pintan las
    marcas combinadas del calendario.
    """

    estado: Literal["descanso", "hecho", "movido", "sin_hacer", "pendiente", "proximo"]
    cubierto_por: CoberturaOut | None
    sesion: SesionDelDiaOut | None


class RecuperableOut(BaseModel):
    """Un día que se quedó sin hacer y aún está en plazo. `se_puede_hoy` es falso
    si ese día ya hay sesión: la lista se enseña, pero sin botón.
    """

    model_config = ConfigDict(from_attributes=True)

    fecha: date
    rutina: RutinaMinima
    plazo: date
    se_puede_hoy: bool


class OfrecidaOut(BaseModel):
    """Una rutina de la lista de abajo de la pantalla de hoy: intercambiarla con el
    día `fecha`, adelantar lo de ese día, o entrenarla sin que cuente para ninguno
    (`fecha` nula). `se_puede_hoy` es falso si ese día ya hay sesión: la lista se
    enseña, pero sin botón.
    """

    model_config = ConfigDict(from_attributes=True)

    accion: Literal["intercambiar", "adelantar", "sin_contar"]
    rutina: RutinaMinima
    fecha: date | None
    se_puede_hoy: bool


class UltimaSesionOut(BaseModel):
    """La última sesión con algo apuntado, sin contar la que está a medias.
    `cubre_fecha` dice si recuperaba o adelantaba otro día.
    """

    model_config = ConfigDict(from_attributes=True)

    entrenamiento_id: int
    fecha: date
    rutina: RutinaMinima
    cubre_fecha: date | None
    series: int
    ejercicios: int


class RutinaDeHoyOut(BaseModel):
    """Cada rutina visible con lo que la pantalla de hoy dice de ella: cuántos
    ejercicios (huecos visibles) tiene y cuándo se hizo por última vez.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    ejercicios: int
    ultima_vez: date | None


class HoyOut(BaseModel):
    """Todo lo que necesita la pantalla de hoy (o la hoja de registrar un día
    pasado) en una sola respuesta.
    """

    model_config = ConfigDict(from_attributes=True)

    fecha: date
    situacion: Literal[
        "en_curso", "hecho", "primera_vez", "sin_programa", "movido", "descanso", "entrenamiento"
    ]
    semana: list[DiaSeguimientoOut]
    sesion: SesionDelDiaOut | None
    proximo: DiaSeguimientoOut | None
    por_recuperar: list[RecuperableOut]
    ofrecidas: list[OfrecidaOut]
    ultima_sesion: UltimaSesionOut | None
    rutinas: list[RutinaDeHoyOut]


class VolumenDeRutinaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rutina: RutinaMinima
    volumen: Decimal


class SeriesDeGrupoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    grupo_muscular: GrupoMuscularOut
    series: int


class PeriodoDeVolumenOut(BaseModel):
    """Una barra de la gráfica de volumen: una semana de lunes a domingo o un mes
    entero. `volumen` en kg (Σ peso × repeticiones). `cambio` es el tanto por
    ciento sobre `comparado_con`, el `desde` del último periodo anterior con
    volumen (puede quedar fuera de la gráfica); los dos son nulos si la barra no
    tiene volumen o si no hay ningún periodo anterior con él. El desglose (por
    rutina y por grupo muscular) es de esta barra; vacío si no hubo series.
    """

    model_config = ConfigDict(from_attributes=True)

    desde: date
    hasta: date
    volumen: Decimal
    cambio: float | None
    comparado_con: date | None
    volumen_por_rutina: list[VolumenDeRutinaOut]
    series_por_grupo: list[SeriesDeGrupoOut]


class EvolucionDeVolumenOut(BaseModel):
    """Las ocho barras terminadas, de la más antigua a la última, y la del periodo
    de hoy (`en_curso`) si cae en la ventana del mes pedido.
    """

    model_config = ConfigDict(from_attributes=True)

    periodos: list[PeriodoDeVolumenOut]
    en_curso: PeriodoDeVolumenOut | None


class MesDeConstanciaOut(BaseModel):
    """Los días de un mes con rutina en el plan: los entrenados, los planificados
    hasta hoy (entrenados más faltados) y los que aún no han llegado.
    """

    model_config = ConfigDict(from_attributes=True)

    mes: date
    entrenados: int
    planificados: int
    por_llegar: int


class ConstanciaOut(BaseModel):
    """Los doce meses del año y sus totales hasta hoy."""

    model_config = ConfigDict(from_attributes=True)

    meses: list[MesDeConstanciaOut]
    entrenados: int
    planificados: int


class ResumenOut(BaseModel):
    """Todo lo que necesita la pantalla de resumen de un mes: las barras de volumen
    por semana y por mes, cada una con su desglose, y la constancia de su año.
    """

    model_config = ConfigDict(from_attributes=True)

    mes: date
    por_semana: EvolucionDeVolumenOut
    por_mes: EvolucionDeVolumenOut
    constancia: ConstanciaOut


class ExcepcionUpdate(BaseModel):
    """Qué toca un día concreto en vez de lo que diga el programa. `rutina_id`
    nulo es descanso. La fecha va en la ruta.
    """

    rutina_id: int | None


class ExcepcionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fecha: date
    rutina: RutinaMinima | None


class ActivarPrograma(BaseModel):
    # Al cambiar de programa, lo que se planificó a mano para los próximos días
    # se hizo pensando en el anterior; la pantalla ofrece quitarlo.
    quitar_excepciones: bool = False


# --- Datos: exportar e importar -------------------------------------------------
#
# Un solo formato para la ida y la vuelta: el mismo modelo es el `response_model` al
# exportar y el validador al importar, así que no pueden divergir. Los ids del archivo
# son los de la base que lo exportó y solo sirven para enlazar cosas dentro del propio
# archivo: al importar se asignan otros. Las fechas con hora llevan zona (sin ella se
# interpretarían con la del servidor).


class PredefinidoDeArchivo(BaseModel):
    """Un ejercicio predefinido que usa algo del archivo. Va por nombre: su id cambia
    de una instalación a otra, porque lo siembra una migración.
    """

    id: int
    nombre: str


class EjercicioDeArchivo(BaseModel):
    id: int
    nombre: Nombre
    # Por nombre, como los predefinidos: el catálogo de grupos es de cada instalación.
    grupo_muscular: str
    # Obligatorio: sin compatibilidad con archivos de antes de los tipos, un valor por
    # defecto solo escondería un archivo mal hecho.
    tipo_registro: TipoRegistro
    descripcion: TextoOpcional = Field(default=None, max_length=500)
    oculto_desde: date | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class NotaDeArchivo(BaseModel):
    ejercicio_id: int
    nota: TextoNota
    created_at: AwareDatetime
    updated_at: AwareDatetime


class SlotDeArchivo(RutinaSlotBase):
    id: int
    orden: int = Field(gt=0, le=100)
    alternativas: list[AlternativaDeHueco] = []
    oculto_desde: date | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def _validar_alternativas(self):
        _validar_comodines(self.ejercicio_principal_id, self.alternativas)
        return self


class RutinaDeArchivo(BaseModel):
    id: int
    nombre: Nombre
    oculto_desde: date | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime
    slots: list[SlotDeArchivo] = []


class DiaDeArchivo(BaseModel):
    dia_semana: DiaSemana
    rutina_id: int
    desde: date | None = None
    hasta: date | None = None

    @model_validator(mode="after")
    def _validar_vigencia(self):
        # El mismo CHECK de la base (`programa_dias_vigencia_check`).
        if self.desde is not None and self.hasta is not None and self.hasta <= self.desde:
            raise ValueError("la vigencia de un día termina antes de empezar")
        return self


class PeriodoDeArchivo(BaseModel):
    desde: date
    hasta: date | None = None

    @model_validator(mode="after")
    def _validar_rango(self):
        # El mismo CHECK de la base (`programa_periodos_rango_check`).
        if self.hasta is not None and self.hasta < self.desde:
            raise ValueError("un periodo termina antes de empezar")
        return self


class ProgramaDeArchivo(BaseModel):
    nombre: Nombre
    oculto_desde: date | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime
    dias: list[DiaDeArchivo] = []
    periodos: list[PeriodoDeArchivo] = []


class ExcepcionDeArchivo(BaseModel):
    fecha: date
    # Nula: ese día es descanso.
    rutina_id: int | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class SerieDeArchivo(SerieBase):
    # Pydantic ignora los campos que no declara, y ningún modelo del formato lleva
    # `extra="forbid"`: lo que sobre en un archivo no impide cargarlo.
    created_at: AwareDatetime
    updated_at: AwareDatetime


class EntrenamientoDeArchivo(BaseModel):
    rutina_id: int
    fecha: date
    cubre_fecha: date | None = None
    notas: TextoOpcional = Field(default=None, max_length=1000)
    terminada_en: AwareDatetime | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime
    series: list[SerieDeArchivo] = []


class ArchivoDeDatos(BaseModel):
    """Todos los datos, para pasarlos a otro dispositivo o guardarlos
    como copia. Cada lista va por id, también dentro de cada padre: se inserta en ese
    orden, y así se conserva el orden relativo de los ids (el de los comodines y el
    desempate de las series dependen de él).
    """

    formato: Literal["training-life"] = "training-life"
    version: Literal[2] = 2
    exportado_en: AwareDatetime
    # La zona horaria de quien exportó (`Europe/Madrid`): al importar, una fecha de
    # mañana aquí puede ser de hoy allí. Opcional: un archivo sin ella vale igual.
    zona_horaria: str | None = Field(default=None, max_length=64)
    predefinidos: list[PredefinidoDeArchivo] = []
    ejercicios: list[EjercicioDeArchivo] = []
    notas: list[NotaDeArchivo] = []
    rutinas: list[RutinaDeArchivo] = []
    programas: list[ProgramaDeArchivo] = []
    excepciones: list[ExcepcionDeArchivo] = []
    entrenamientos: list[EntrenamientoDeArchivo] = []


class ResumenDeDatos(BaseModel):
    """Cuánto hay: para que el diálogo de exportar diga qué se va a guardar, y el de
    importar, qué se sustituye por qué.
    """

    ejercicios: int
    notas: int
    rutinas: int
    programas: int
    # Las que tienen alguna serie: una cancelada no es algo que se pierda.
    sesiones: int
    series: int
    primera_sesion: date | None
    ultima_sesion: date | None


class ComprobacionDeImportar(BaseModel):
    """`POST /datos/importar?comprobar=true`: el archivo vale y esto es lo que cambiaría."""

    exportado_en: datetime
    archivo: ResumenDeDatos
    actual: ResumenDeDatos
