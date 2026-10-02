# Convenciones de código del backend

Cómo se comenta y se formatea el código de esta API. No son reglas heredadas de ningún manual: cada una responde a algo concreto que pasa en este proyecto.

**Índice:** [Comentario o docstring](#comentario-o-docstring-no-es-cuestión-de-longitud) ·
[Formato del docstring](#formato-del-docstring) · [Cuándo se escribe uno](#cuándo-se-escribe-uno) ·
[Lo más corto que se entienda](#lo-más-corto-que-se-entienda) ·
[Reglas de los comentarios](#reglas-de-los-comentarios) · [Formato del código](#formato-del-código)

## Comentario o docstring: no es cuestión de longitud

No se eligen según lo largo que sea el texto, sino según dónde van y para qué sirven:

| | Dónde va | Qué es |
|---|---|---|
| **Docstring** `"""..."""` | La **primera línea** de un módulo, una clase o una función | Documentación de verdad: Python la guarda en `__doc__`, el editor la enseña al pasar el ratón y **FastAPI publica la de cada endpoint como su descripción en `/docs`** |
| **Comentario** `#` | Cualquier otro sitio | Una nota para quien lea el código. Puede ocupar cinco líneas seguidas sin dejar por ello de ser un comentario |

Un `"""..."""` colocado fuera de esa primera posición no documenta nada: es un texto que Python construye y tira acto seguido.

Cada uno responde además a una pregunta distinta:

- **El docstring dice qué es esto y por qué existe**, para quien lo usa sin abrirlo por dentro.
- **El comentario dice por qué esta línea está así**, para quien vaya a modificarla.

Por eso conviven sin pisarse:

```python
class NotaUsuarioEjercicio(Base):
    """Una nota personal y privada de un usuario sobre un ejercicio, propio o
    predefinido (ej. "en esta máquina el asiento va en el 4").
    """

    __tablename__ = "notas_usuario_ejercicio"

    # CASCADE (a diferencia de rutina_slots, slot_alternativas y series hacia
    # ejercicios, que son RESTRICT): una nota no es historial de progresión
    # que haya que proteger, es un accesorio del ejercicio.
    ejercicio_id: Mapped[int] = mapped_column(ForeignKey("ejercicios.id", ondelete="CASCADE"))
```

## Formato del docstring

Se sigue [PEP 257](https://peps.python.org/pep-0257/), la guía oficial de Python:

- Termina siempre en punto.
- De una línea, todo junto: `"""Visible si es predefinido o si es del usuario actual."""`
- De varias líneas, el `"""` de cierre **baja a su propia línea**, para marcar dónde acaba la explicación y empieza el código.
- Escrito en español. Las clases se describen con un sustantivo ("Un hueco dentro de una rutina..."); las funciones, en tercera persona ("Devuelve...", "Crea...").

No se usan formatos con secciones (`Args:`, `Returns:`, estilo Google o NumPy): los tipos ya están en la firma de la función y FastAPI genera la documentación de la API a partir de los esquemas, así que repetirlos en prosa solo añade texto que se queda desactualizado.

## Cuándo se escribe uno

La regla de fondo es que **un docstring que repite el nombre en prosa es ruido**: poner `"""Crea una nota."""` encima de `def crear_nota()` no le cuenta nada a nadie.

- **Módulo**: solo si el archivo tiene algo que contar que no se deduzca de su nombre. `models.py` no lo necesita; `tests/conftest.py` sí, porque explica contra qué base de datos corren los tests.
- **Clase**: siempre que represente una entidad del dominio, para dejar claro qué es y en qué se diferencia de sus vecinas.
- **Función**: cuando el nombre no baste — una decisión de diseño, un código de estado que sorprende, una trampa conocida. Las funciones evidentes se quedan sin él.
- **Test**: cuando el nombre no explique **por qué existe** ese test. Si cubre un fallo real que ya ocurrió, el docstring cuenta cuál era.

## Lo más corto que se entienda

Un comentario existe para ahorrarle tiempo a quien lee, así que cada palabra de más juega en su contra. La prueba es sencilla: **si al quitar media frase el motivo sigue estando claro, sobraba; si al quitarla desaparece la razón, tenía que ser así de largo.**

Esto no es un límite de líneas ni una invitación a amputar. Un porqué complicado necesita las líneas que necesite — lo que no puede es repetirse, adornarse ni explicar lo que el código ya dice:

```python
# Antes (seis líneas, dice dos veces lo mismo):
    # flush obligatorio antes de tocar los huecos: series.slot_id → rutina_slots
    # es RESTRICT, y marcar los borrados en el orden correcto no basta. Sin
    # este flush todo viaja junto al commit, y SQLAlchemy ordena los DELETE
    # según las relationship() que conoce — entre Serie y RutinaSlot no hay
    # ninguna, así que emite el del hueco primero y la base de datos lo
    # rechaza. El flush fuerza a que las series ya no existan.

# Después (tres líneas, mismo porqué):
    # flush obligatorio: sin él los DELETE viajan juntos al commit y SQLAlchemy
    # los ordena por las relationship() que conoce — no hay ninguna entre Serie y
    # RutinaSlot, así que borraría el hueco antes que sus series (RESTRICT).
```

## Reglas de los comentarios

- Explican **por qué**, nunca **qué**: el qué ya lo dice el código de al lado.
- Van en su propia línea, justo encima de aquello que comentan.
- Al final de una línea de código solo caben apostillas de cuatro o cinco palabras, separadas por dos espacios (`# noqa` y similares son instrucciones para las herramientas, no comentarios).
- **Los banners de sección son la excepción a todo lo anterior**: no explican ningún porqué, parten un archivo largo en bloques. Se usan cuando un archivo agrupa varios recursos —`ejercicios.py` reúne los endpoints de ejercicios y los de sus notas; `rutinas.py`, los de rutinas, huecos y comodines— y se escriben con el nombre del bloque y guiones de relleno hasta la columna 75:

```python
# --- Comodines (slot_alternativas) -----------------------------------------
```

- El mejor comentario es el que **justifica que una línea exista**:

```python
    # flush obligatorio antes de tocar los huecos: series.slot_id → rutina_slots
    # es RESTRICT, y marcar los borrados en el orden correcto no basta.
    db.flush()
```

Sin esas dos líneas, `db.flush()` parece prescindible y acaba desapareciendo en el primer refactor, devolviendo al backend un error 500 que ya se había arreglado una vez.

## Formato del código

Lo aplica [ruff](https://docs.astral.sh/ruff/) (viene en `requirements-dev.txt`), con la configuración de `ruff.toml`: **100 columnas**, y las migraciones de `alembic/versions/` excluidas, porque las genera Alembic con su propio estilo y reformatearlas solo ensucia los diffs.

```bash
.venv\Scripts\python -m ruff format .   # formatea
.venv\Scripts\python -m ruff check .    # busca imports sin usar y similares
```

Nada de lo anterior lo comprueba una herramienta: que un comentario explique el *porqué* y no repita el nombre de la función no es verificable automáticamente, así que estas convenciones se sostienen al revisar el código, no en el linter.
