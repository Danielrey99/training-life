# training-life

App de entrenamiento de gimnasio para uso personal, pensada también como proyecto para reactivar GitHub y mostrar en portfolio.

> Nombre provisional del proyecto/app: "Training Life" (repo: `training-life`, minúsculas y guiones — convención estándar de GitHub). Puede cambiarse más adelante sin problema (renombrar el repo en GitHub no rompe URLs antiguas, redirigen automáticamente).

**Índice:** Convención de documentación · Objetivo del proyecto · Estructura del repositorio · Orden de desarrollo · Stack elegido · Infraestructura/Docker · Backend: decisiones técnicas · **Esquema de base de datos** · Sincronización móvil↔PC · Instalación app móvil · Funcionalidades · Contexto del autor.

## Convención de documentación

- **README.md** (raíz y uno por carpeta en `backend/`, `web/`, `mobile/`) es documentación para **humanos** (reclutadores, colaboradores, el propio autor más adelante). Debe ser siempre autocontenido: nunca debe remitir a este CLAUDE.md para completar información.
- **CLAUDE.md** (este archivo) es contexto interno para Claude Code: decisiones técnicas, alternativas descartadas y el porqué. No es documentación de cara al lector del repo, así que ni los README ni los comentarios/docstrings del código deben enlazarlo ni decir "ver CLAUDE.md para más detalle" — los comentarios de código son para quien lea ese código (igual que los README), y deben quedar autocontenidos o remitir como mucho a otro archivo del propio proyecto (otro módulo, otra función), nunca a este archivo.
- Cada vez que se haga un cambio relevante en el proyecto, se refleja en el/los README correspondientes (bien explicado, cuidando la redacción de cara a portfolio). Si además hace falta guardar contexto o una decisión no obvia para el propio Claude Code, se añade aquí, en CLAUDE.md — nunca mezclando ambas cosas en el mismo sitio.

## Objetivo del proyecto

- Reactivar el perfil de GitHub del autor con un proyecto real y mantenido con commits genuinos.
- Sustituir el bloc de notas que el autor usa actualmente para apuntar sus entrenamientos.
- Uso personal real: el autor entrena en el gimnasio y quiere usar esta app en vez de papel/notas.
- El PC del autor hace de servidor: quiere que los datos estén compartidos entre la web (PC) y la app móvil, sincronizados cuando ambos estén en la misma red WiFi de casa.

## Estructura del repositorio (monorepo)

Un único repositorio (`training-life`) con esta estructura:

```
training-life/
├── backend/          (FastAPI)
├── web/              (React)
├── mobile/           (React Native + Expo)
├── docker-compose.yml
├── .gitignore
├── CLAUDE.md
└── README.md
```

Se eligió monorepo (no repos separados) porque backend, web y móvil están muy acoplados (un cambio en un endpoint afecta a los dos frontends), un único `docker-compose.yml` puede levantar todo el entorno con un solo comando, y para portfolio da una imagen más clara y completa que varios repos sueltos.

El árbol de arriba es solo ilustrativo (se escribió antes de implementar nada) — para el árbol de archivos real y actualizado, ver el [README raíz](README.md). El `.gitignore` ya existe como archivo real en la raíz del repo; ignora por carpeta lo típico de cada parte del stack (`__pycache__`/`.venv` en backend, `node_modules`/builds en web y mobile) más los `.env` de cada uno.

## Orden de desarrollo

1. **Backend primero** (FastAPI + PostgreSQL + Docker Compose): construir y probar el CRUD del MVP de forma aislada (usando la documentación automática de FastAPI en /docs, o Postman/Thunder Client) antes de tocar ningún frontend.
2. **Web (React) después**: consumir esa API ya funcional, validándola con una interfaz real.
3. **Móvil (React Native) al final**: para entonces la API ya está probada y estable, y se puede reutilizar bastante lógica (llamadas HTTP, tipos de datos) del proyecto web.

No se desarrollan web y móvil en paralelo desde el principio: no tiene sentido diseñar la API "a ciegas" para dos frontends a la vez sin backend maduro.

## Stack elegido

- **Backend:** FastAPI (Python) + PostgreSQL. Expone una API REST; ningún frontend accede a la base de datos directamente.
- **Frontend web:** React.
- **Frontend móvil:** React Native, usando **Expo** como herramienta de desarrollo.
- **Conexión:** siempre frontend → API REST (HTTP) → backend → base de datos. Nunca acceso directo del frontend a PostgreSQL.

Se descartaron explícitamente (tras comparar alternativas): Flutter/Dart (por las issues abiertas en su repo y la complejidad de Dart), Kotlin Multiplatform (soporte web aún poco maduro) y la opción de apps 100% nativas separadas (Kotlin + Swift, descartada por triple carga de trabajo y tener que aprender Swift desde cero). El autor eligió React + React Native como punto de partida, dejando la puerta abierta a explorar Kotlin/Swift nativos más adelante si le apetece profundizar en ello.

## Infraestructura / Docker

- **Todo dockerizado con Docker Compose**: backend (FastAPI) + PostgreSQL, ambos definidos en docker-compose.yml en la raíz del monorepo. Se eligió esta opción (en vez de solo dockerizar la BD) porque el PC va a actuar como servidor real para la sincronización con el móvil, y conviene poder levantar todo con un solo comando de forma reproducible.
- El autor tiene PostgreSQL 17 instalado de forma nativa en Windows como servicio (postgresql-x64-17), ocupando el puerto 5432 por defecto. Para evitar conflicto con el contenedor del proyecto, mapear el contenedor de PostgreSQL a otro puerto del host (ej. 5433:5432), o bien parar y poner en manual el servicio nativo si no se va a usar.
- Cliente de base de datos: el autor usa **DBeaver** para inspeccionar/consultar la base de datos del contenedor.

## Backend: decisiones técnicas

- **Esquema de base de datos:** el diseño completo del modelo de datos (tablas, relaciones, estrategia de borrado) vive más abajo, en la sección "Esquema de base de datos" de este mismo archivo — consultarlo antes de crear o modificar modelos de SQLAlchemy. `Usuario`, `GrupoMuscular`, `Ejercicio` (actualizado al diseño final), `Rutina`, `RutinaSlot`, `SlotAlternativa`, `Entrenamiento` y `Serie` ya están implementados y migrados en `backend/app/models.py` — el esquema completo del MVP está construido. Solo `notas_usuario_ejercicio` sigue sin implementar (no forma parte del MVP). `GrupoMuscular` ya tiene sembrados los 11 grupos musculares reales del autor (migración `4cb2b149bf00`, pensada para su rutina Push/Pull/Leg): Pecho, Espalda, Hombro, Bíceps, Tríceps, Antebrazo, Cuádriceps, Isquiotibiales, Glúteo, Pantorrilla, Abdomen. Los ejercicios predefinidos, en cambio, no se siembran por migración — de momento la biblioteca solo tiene los ejercicios que se creen a mano vía `POST /ejercicios` (que siempre son propios del usuario, nunca predefinidos — ver la nota de "Backend: decisiones técnicas" más abajo).
- **Gestor de dependencias Python: pip + requirements.txt** (no Poetry ni uv). Elegido por simplicidad y porque es lo más estándar/conocido, priorizando que el autor no tenga que aprender una herramienta adicional para un proyecto personal.
- **ORM: SQLAlchemy 2.0** (API moderna con `Mapped`/`mapped_column`, no el estilo antiguo).
- **Migraciones: Alembic**, no `Base.metadata.create_all()`. Se eligió explícitamente por ser la práctica real en proyectos serios (historial de cambios de esquema versionado) y porque queda mejor de cara a portfolio, aunque para un proyecto personal en solitario `create_all()` habría sido más rápido de montar.
- **El backend aplica las migraciones automáticamente al arrancar**: el `CMD` del `Dockerfile` ejecuta `alembic upgrade head` antes de lanzar `uvicorn`. Así `docker compose up` deja la base de datos siempre al día sin pasos manuales — importante dado que el autor quiere poder levantar el proyecto sin fricción cada vez que entrena.
- **Doble archivo `.env` para PostgreSQL**, con propósitos distintos (no es redundancia):
  - `.env` en la **raíz**: credenciales que usa `docker-compose.yml` para crear el usuario/BD de Postgres y para construir el `DATABASE_URL` que recibe el contenedor del backend (host interno `postgres`, puerto `5432`).
  - `backend/.env`: mismo `DATABASE_URL` pero apuntando a `localhost:5433` (el puerto publicado al host) — solo se usa para ejecutar el backend o Alembic **fuera de Docker**, con el venv local. Dentro del contenedor este archivo no existe y no interfiere.
- **`backend/.venv` (venv local, fuera de Docker)**: no es para ejecutar la app en desarrollo día a día (eso lo hace el contenedor, con hot-reload vía bind mount de toda la carpeta `backend/`, ver más abajo) — es para herramientas de desarrollo que conviene correr directamente desde Windows/el editor, sobre todo generar migraciones de Alembic (`alembic revision --autogenerate`) y, más adelante, tests o linters.
- **⚠️ Trampa real ya sufrida (solucionada): el bind mount del backend cubre toda la carpeta, no solo `app/`.** Originalmente el `docker-compose.yml` solo montaba `./backend/app:/app/app` — una migración generada y aplicada con el venv local (contra `localhost:5433`) no llegaba al contenedor (`alembic/` solo se copiaba a la imagen en build). Funcionaba mientras `uvicorn` no se reiniciara, pero en cuanto el contenedor se reiniciaba (con `restart: unless-stopped` puede pasar solo), volvía a ejecutar `alembic upgrade head` con archivos que no conocían la migración ya aplicada en la base de datos real → `Can't locate revision identified by '...'` → bucle de reinicio fallido. Se solucionó cambiando el mount a `./backend:/app` (toda la carpeta) — ahora una migración generada con el venv llega al contenedor al instante, sin reconstruir. Verificado en real: se generó una migración de prueba, se aplicó solo con el venv, y se forzó `docker restart` — arrancó limpio. Solo `requirements.txt` sigue necesitando `docker compose up -d --build` (cambia qué paquetes están instalados, no un archivo que se pueda montar).
  - Montar toda la carpeta trae también `backend/.venv` (el venv de Windows, miles de archivos que el contenedor nunca usa — tiene su propio Python del sistema) y `backend/.env` (con un `DATABASE_URL` distinto, para uso fuera de Docker). Para `.venv` se añadió un volumen anónimo (`/app/.venv`) que lo "tapa" con una carpeta vacía dentro del contenedor — evita que `--reload` tenga que vigilar esa carpeta de más. Para `.env` no hizo falta hacer nada: `load_dotenv()` (en `database.py` y `alembic/env.py`) no sobreescribe variables que ya existen en el entorno, así que aunque el archivo llegue montado, la `DATABASE_URL` real sigue siendo la que inyecta `docker-compose.yml` — verificado con `docker exec ... printenv DATABASE_URL`.
  - **Pendiente para más adelante:** esto trae también, sin necesidad, `Dockerfile`, `README.md`, `requirements.txt`, `.dockerignore` y `.env.example` — inofensivos (no pesan, no son sensibles), pero de más. Se decidió conscientemente mantener el mount de toda la carpeta mientras el proyecto siga cambiando de forma (menos mantenimiento, inmune a "me olvidé de añadir esta carpeta nueva al mount", que es justo lo que causó el bug de `alembic/`). Cuando el backend esté más asentado y se sepa con certeza qué carpetas/archivos concretos necesita el contenedor en caliente, cambiar a una lista explícita (`./backend/app:/app/app`, `./backend/alembic:/app/alembic`, `./backend/alembic.ini:/app/alembic.ini`) para que quede más limpio.
- **Estructura de la app (routers + `auth.py`)**: los endpoints viven en `app/routers/` (un archivo por entidad: `ejercicios.py`, `grupos_musculares.py`, `rutinas.py`), no todos en `main.py`, pensando en que el proyecto seguirá creciendo (entrenamientos, series). El usuario hardcodeado (mientras no exista JWT) no se referencia como una constante suelta en cada endpoint, sino a través de una dependencia de FastAPI, `get_usuario_actual_id()` en `app/auth.py` — así, al implementar JWT, solo cambia la implementación de esa función (pasa a leer el usuario del token), sin tocar ningún endpoint.
- **`POST /ejercicios` nunca crea predefinidos**: siempre crea un ejercicio propio del usuario actual (`es_predefinido=False`). No se expone `es_predefinido`/`usuario_id`/`visibilidad`/`activo` como campos editables por el cliente en `EjercicioCreate`/`EjercicioUpdate` — los decide el backend. Si en el futuro hace falta una biblioteca de ejercicios predefinidos más amplia, se sembraría por migración (como `grupos_musculares`), no a través de este endpoint.
- **`PUT /ejercicios/{id}` devuelve 403 (no 404) si el ejercicio existe pero no es del usuario actual** (incluye los predefinidos, que no tienen dueño editable) — 404 solo si no existe o no es visible en absoluto (`GET` sí usa 404 en ambos casos, por simplicidad, ya que ahí no hay ninguna acción que el usuario pudiera "tener permiso de más" para hacer).
- **`DELETE /ejercicios/{id}` implementa la estrategia de borrado de la sección "Esquema de base de datos"** vía un parámetro de query `?modo=ocultar|definitivo`: sin uso dependiente, borra directamente (sin necesidad de `modo`); en uso, exige `modo` explícito y si no lo recibe devuelve `409` (ver la nota de `_usos_de_ejercicio()` más abajo). Probado en real: un ejercicio en uso da `409` sin `modo`, y `?modo=definitivo` borra también el hueco y sus comodines antes que el ejercicio (porque esas FK son RESTRICT). Solo falta añadir `series` a la comprobación cuando exista esa tabla.
- **`Rutina`/`RutinaSlot`/`SlotAlternativa` siguen el mismo patrón que `Ejercicio`** (`app/routers/rutinas.py`), anidados por REST (`/rutinas/{id}/slots/{slot_id}/alternativas/{ejercicio_id}`) en vez de recursos planos, porque un hueco no existe sin su rutina ni un comodín sin su hueco. `SlotAlternativa.slot_id → rutina_slots` es `ON DELETE CASCADE` (a diferencia del resto de FK hacia `ejercicios`/`rutinas`, que son `RESTRICT`) porque un comodín no es historial, no tiene sentido guardarlo huérfano. El borrado definitivo de una `Rutina` borra antes sus `rutina_slots` (cuyos comodines se van solos, en cascada) — probado en real, primera vez que el borrado en cascada de la estrategia se ejercita de verdad (con `Ejercicio` nunca había nada que perder, porque nada lo referenciaba todavía). La validación de que un `ejercicio_id` (principal o comodín) es visible para el usuario reutiliza `obtener_ejercicio_visible()` de `app/routers/ejercicios.py` (se hizo pública, sin `_`, para poder importarla desde otro router).
- **El aviso de `409` al borrar un `Ejercicio` en uso dice dónde se usa**, no solo "está en uso": `_usos_de_ejercicio()` devuelve una lista `{rol, slot_id, rutina_id, rutina_nombre}` (una entrada por hueco donde aparece, como principal o comodín), y el `detail` del `HTTPException` es un objeto JSON (`{"mensaje": ..., "usos": [...]}`), no solo texto — `HTTPException.detail` acepta cualquier valor serializable, no hace falta que sea un string.
- **`?ocultos=true` en `GET /ejercicios` y `?ocultas=true` en `GET /rutinas`, más `POST /{id}/reactivar`** en ambos routers: sin esto, un ejercicio/rutina ocultado con `?modo=ocultar` quedaba invisible para siempre vía API (el listado normal filtra `activo=true` a nivel de SQL) — no había forma de que el usuario los volviera a ver ni de deshacer el ocultar. `reactivar` simplemente pone `activo=True`; no comprueba nada más (a diferencia del borrado, reactivar nunca puede romper una FK).
- **Validaciones añadidas a `RutinaSlot`**: `reps_max >= reps_min` (con `@model_validator` en el esquema, no en el modelo — es una regla de entrada, no de negocio persistente) y `UniqueConstraint(rutina_id, orden)` a nivel de base de datos, con una comprobación previa en el router (`_validar_orden_disponible`) para devolver un `409` legible en vez de dejar que la restricción de la base de datos reviente como un error crudo — mismo escarmiento que con `_tiene_historial` desactualizada: cualquier restricción nueva de la base de datos necesita su comprobación explícita en el endpoint correspondiente, si no se deja para que Postgres la descubra con un `500`.
- **Aislamiento por usuario, revisado explícitamente (sin fallos encontrados):** cada endpoint de `rutinas.py`/`entrenamientos.py` que lee/edita/borra remonta la comprobación de dueño hasta `usuario_id` (los huecos se protegen protegiendo su rutina; los comodines, su hueco; las series, su entrenamiento) — mismo patrón repetido en las tres entidades. Tampoco hay riesgo de inyección SQL en ningún router: todas las consultas usan el query builder de SQLAlchemy (`select().where(...)`), que siempre parametriza los valores — nunca se concatena texto de la petición dentro de una sentencia SQL. Y mandar campos de más en el body (ej. `usuario_id` en un `POST /rutinas`) no sirve para nada: los esquemas Pydantic no los declaran, y por defecto Pydantic ignora silenciosamente cualquier campo no declarado.
- **`Entrenamiento`/`Serie` no tienen borrado lógico (`activo`)**, a diferencia de `Ejercicio`/`Rutina`/`RutinaSlot`: son el propio historial, no algo que otras tablas referencien y haya que proteger — nada depende de un entrenamiento o serie concretos. `DELETE /entrenamientos/{id}` y `DELETE /entrenamientos/{id}/series/{serie_id}` son directos, sin `?modo`. `Serie.entrenamiento_id → entrenamientos` es `ON DELETE CASCADE` (borrar el entrenamiento borra sus series, tienen sentido); `Serie.slot_id → rutina_slots` y `Serie.ejercicio_id → ejercicios` son `RESTRICT` (si son historial real que otras tablas deben proteger, ver más abajo).
- **`_usos_de_ejercicio()`, `_tiene_dependientes()` (Rutina) y `_tiene_historial_slot()` (RutinaSlot) ya comprueban `series` de verdad**, cerrando los huecos "falta series" que quedaron pendientes al construir `Ejercicio`/`Rutina`. `borrar_slot` ganó el mismo patrón `?modo=ocultar/definitivo` que `Ejercicio`/`Rutina` (antes borraba siempre directo, porque no había nada que pudiera bloquearlo). El borrado definitivo de una `Rutina` borra ahora también sus `entrenamientos` (cuyas series se van en cascada) **antes** que sus `rutina_slots` — importa el orden: si se borraran los huecos primero, una serie que los referencia (`RESTRICT`) lo impediría.
- **⚠️ Trampa real ya sufrida (solucionada): SQLAlchemy intenta poner a `NULL` la FK de los hijos al borrar el padre, si la `relationship()` no tiene `passive_deletes=True`.** Al borrar una `Rutina` con `?modo=definitivo` (con un `Entrenamiento` propio, con series), saltó un `500`: `IntegrityError: null value in column "entrenamiento_id" ... violates not-null constraint`. Causa: aunque `Serie.entrenamiento_id → entrenamientos` ya es `ON DELETE CASCADE` a nivel de base de datos, el `relationship()` de `Entrenamiento.series` (sin configurar) hace que SQLAlchemy, al hacer `db.delete(entrenamiento)`, intente por su cuenta desvincular las series en Python (poniendo su FK a `NULL`) en vez de confiar en la base de datos — y como `entrenamiento_id` no admite `NULL`, revienta. No pasaba con `Rutina.slots`/`RutinaSlot.slot_alternativas` en los mismos escenarios de antes por pura casualidad de qué estaba cargado en cada caso, no porque estuviera bien resuelto. Se arregló añadiendo `passive_deletes=True` a las tres relaciones uno-a-muchos que dependen de un `ON DELETE` real de la base de datos (`Rutina.slots`, `RutinaSlot.slot_alternativas`, `Entrenamiento.series`) — le dice a SQLAlchemy "no gestiones tú los hijos al borrar, confía en la base de datos". Regla práctica: **cualquier `relationship()` uno-a-muchos cuyos hijos se borren vía `ON DELETE CASCADE` (o manualmente, en un bucle) necesita `passive_deletes=True`**, si no, SQLAlchemy puede intentar desvincularlos en vez de dejarlos borrar.

## Esquema de base de datos

Diseño acordado para el modelo de datos del MVP, basado en la rutina real del autor (Push/Leg/Pull con ejercicios comodín y variantes de agarre).

Existe también [`esquema_base_datos.svg`](esquema_base_datos.svg) en la raíz del repo: diagrama visual de las 8 tablas implementadas y sus FK (quién es padre/hijo, `CASCADE` vs `RESTRICT` vs sin `ondelete`, y qué tablas tienen borrado lógico `activo` vs cuáles son historial puro). No está enlazado desde ningún README — es material de apoyo, no documentación de portfolio.

### Tablas

**`usuarios`**
```
id              INTEGER PK
nombre          VARCHAR
email           VARCHAR (único)
password_hash   VARCHAR
created_at      TIMESTAMP
```
La tabla ya se incluye desde ahora aunque la autenticación (JWT) llegue más adelante ("nivel medio" del roadmap) — añadirla más tarde obligaría a migrar `usuario_id` en casi todas las tablas ya existentes. Mientras no exista login real, el backend trabaja con un único usuario "sembrado" (una fila fija creada por migración/script) y un `usuario_id` hardcodeado en el código — al implementar JWT, ese hardcodeo se sustituye por el usuario del token, sin tocar el esquema.

Ya implementada: la fila se siembra dentro de la propia migración de Alembic (`backend/alembic/versions/32c0db792aa1_...py`), con datos placeholder (`nombre="Daniel"`, `email="usuario@example.com"`, `password_hash="placeholder-sin-login-real"`) — a propósito, para no dejar datos reales committeados en un repo público. Se sustituirán por un registro/login real al implementar JWT.

**`grupos_musculares`**
```
id              INTEGER PK
nombre          VARCHAR (ej. "Pecho", "Espalda", "Pierna"...)
```
Tabla separada para evitar inconsistencias de texto libre (ej. "pecho" vs "Pecho" vs "pectoral") y poder agrupar/filtrar de forma fiable en estadísticas futuras.

**`ejercicios`**
```
id                    INTEGER PK
nombre                VARCHAR
grupo_muscular_id     INTEGER FK → grupos_musculares
descripcion           TEXT (opcional) — info general/objetiva del ejercicio (cómo ejecutarlo, máquina necesaria)
es_predefinido        BOOLEAN
usuario_id            INTEGER FK → usuarios (NULL si es predefinido)
visibilidad           VARCHAR (default "privado") — pensado para una futura función social, sin implementar todavía
activo                BOOLEAN (default true) — borrado lógico, ver sección "Borrado de datos"
created_at            TIMESTAMP
updated_at            TIMESTAMP
```
Biblioteca combinada: ejercicios predefinidos (cargados como seed data inicial) + ejercicios creados por cada usuario, en la misma tabla, distinguidos por `usuario_id`. Sin restricción de `nombre` único: dos usuarios distintos deben poder llamar igual a su propio ejercicio (la propia lógica de "cada usuario ve solo los suyos + los predefinidos" ya evita ambigüedad, no hace falta forzarlo en la base de datos).

`grupo_muscular_id` es una relación muchos-a-uno: **cada ejercicio tiene un único grupo muscular** (el "principal"), no varios. Se eligió esta opción simple (Opción A) para el MVP en vez de permitir varios grupos musculares por ejercicio (Opción B, ver más abajo), ya que es más rápida de implementar y de mostrar en la interfaz.

Foto/vídeo (mencionado en el MVP original) se aplaza a futuro — no se añade columna todavía, ver "Decisiones descartadas / aplazadas".

**`notas_usuario_ejercicio`**
```
id              INTEGER PK
usuario_id      INTEGER FK → usuarios
ejercicio_id    INTEGER FK → ejercicios
nota            TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP
```
Comentarios/notas personales que cada usuario añade a cualquier ejercicio (predefinido o propio), visibles solo para él. Separado de `descripcion` porque esta última es información general del ejercicio (no editable si es predefinido), mientras que las notas son subjetivas y privadas por usuario.

Sin restricción `UNIQUE(usuario_id, ejercicio_id)` a propósito: un usuario puede añadir varias notas independientes al mismo ejercicio a lo largo del tiempo (ej. una observación distinta cada semana), no solo una nota fija que se sobreescribe. Cada nota es su propia fila, con su propio `id`, editable o borrable por separado.

**`rutinas`**
```
id              INTEGER PK
usuario_id      INTEGER FK → usuarios
nombre          VARCHAR (ej. "Push", "Leg", "Pull")
dia_habitual    VARCHAR (opcional, ej. "Lunes") — solo informativo/orientativo, no vinculante
activo          BOOLEAN (default true) — borrado lógico, ver sección "Borrado de datos"
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

**`rutina_slots`** (cada "hueco" dentro de una rutina, no un ejercicio fijo)
```
id                      INTEGER PK
rutina_id               INTEGER FK → rutinas
ejercicio_principal_id  INTEGER FK → ejercicios
orden                   INTEGER
series_objetivo         INTEGER
reps_min                INTEGER
reps_max                INTEGER
activo                  BOOLEAN (default true) — borrado lógico, ver sección "Borrado de datos"
created_at              TIMESTAMP
updated_at              TIMESTAMP
```

**`slot_alternativas`** (ejercicios comodín de cada hueco)
```
id            INTEGER PK
slot_id       INTEGER FK → rutina_slots
ejercicio_id  INTEGER FK → ejercicios
```
`UNIQUE(slot_id, ejercicio_id)`: evita añadir el mismo ejercicio dos veces como comodín del mismo hueco. No entra en conflicto con las variantes de agarre/posición (ej. "agarre cerrado"), porque esas se anotan en el campo `variante` de `series` sobre el mismo `ejercicio_id` — no se modelan como ejercicios ni comodines distintos.

Se mantiene como tabla relacional separada (no como array de IDs dentro de `rutina_slots`) para conservar integridad referencial (FKs reales, borrado en cascada) y permitir consultas simples tipo "¿en qué huecos aparece este ejercicio como comodín?".

**`entrenamientos`** (sesión real de un día concreto)
```
id              INTEGER PK
usuario_id      INTEGER FK → usuarios
rutina_id       INTEGER FK → rutinas (NULL si es entrenamiento libre sin plantilla)
fecha           DATE
notas           TEXT (opcional)
created_at      TIMESTAMP
updated_at      TIMESTAMP
```
La `fecha` es siempre la real del día que se entrena, independientemente del `dia_habitual` de la rutina — permite mover el Push del lunes a otro día sin perder el registro real. (`created_at`/`updated_at` son metadatos técnicos del registro, no sustituyen a `fecha`, que es el dato de negocio real.)

**`series`** (lo que realmente se hizo, serie a serie)
```
id                  INTEGER PK
entrenamiento_id    INTEGER FK → entrenamientos
slot_id             INTEGER FK → rutina_slots (NULL si el entrenamiento es libre)
ejercicio_id        INTEGER FK → ejercicios (el ejercicio realmente realizado: principal o comodín)
numero_serie        INTEGER
peso                DECIMAL
repeticiones        INTEGER
rpe                 DECIMAL (opcional)
variante            VARCHAR (opcional, ej. "agarre cerrado", "abductores internos")
created_at          TIMESTAMP
updated_at          TIMESTAMP
```
`slot_id` conecta con el hueco de la rutina (para ver progresión "por hueco", ej. empuje horizontal en general), y `ejercicio_id` guarda el ejercicio concreto que se hizo ese día (principal o comodín), permitiendo también ver progresión de un ejercicio específico. El campo `variante` cubre casos como agarre abierto/cerrado o abductores internos/externos, sin necesitar ejercicios ni tablas separadas para cada variante.

### Relaciones

```
usuarios 1─N ejercicios (los creados por él)
usuarios 1─N notas_usuario_ejercicio
usuarios 1─N rutinas
usuarios 1─N entrenamientos

grupos_musculares 1─N ejercicios

ejercicios 1─N notas_usuario_ejercicio
ejercicios 1─N rutina_slots (como ejercicio_principal_id)
ejercicios 1─N slot_alternativas (como comodín)
ejercicios 1─N series (el que se hizo realmente)

rutinas 1─N rutina_slots
rutinas 1─N entrenamientos

rutina_slots 1─N slot_alternativas
rutina_slots 1─N series

entrenamientos 1─N series
```

### Ejemplo recorrido (con datos reales del autor)

Este ejemplo ilustra cómo interactúan las tablas entre sí, usando el "Push" real del autor (ejercicio: Press banca con barra, comodín: Press banca en máquina).

1. **Ejercicios ya existentes en la biblioteca:**
   - `ejercicios`: `id=1 "Press banca con barra"`, `id=2 "Press banca en máquina"` (comodín)

2. **Se crea la rutina** (el "tipo de día", sin fecha fija):
   - `rutinas`: `id=1, nombre="Push", dia_habitual="Lunes"`

3. **Se define el hueco (slot) del press banca dentro de esa rutina** — el plan, no un entrenamiento concreto:
   - `rutina_slots`: `id=1, rutina_id=1, ejercicio_principal_id=1 (Press banca con barra), orden=1, series_objetivo=4, reps_min=6, reps_max=10`

4. **Se registra el comodín de ese hueco:**
   - `slot_alternativas`: `slot_id=1, ejercicio_id=2 (Press banca en máquina)`

5. **El autor entrena un día real** (aunque su Push habitual sea lunes, puede entrenar cualquier día — la fecha manda, no `dia_habitual`):
   - `entrenamientos`: `id=1, usuario_id=autor, rutina_id=1 (Push), fecha=2026-08-25`

6. **Se registran las series reales de ese entrenamiento.** Si ese día hizo el ejercicio principal:
   - `series`: `entrenamiento_id=1, slot_id=1, ejercicio_id=1 (Press banca con barra), numero_serie=1, peso=15, repeticiones=10`
   - (y así una fila por cada serie realizada)

   Si en cambio esa semana no pudo hacer el principal y usó el comodín, la fila apunta al comodín pero mantiene el mismo `slot_id` (para que siga contando como "el hueco de press banca del Push" a efectos de historial del hueco):
   - `series`: `entrenamiento_id=5, slot_id=1, ejercicio_id=2 (Press banca en máquina), numero_serie=1, peso=40, repeticiones=10`

7. **Variantes de agarre/posición** (ej. jalón en polea con agarre abierto/cerrado) se anotan en el campo `variante` de `series`, sin crear ejercicios ni tablas nuevas para cada variante:
   - `series`: `..., ejercicio_id=X (Jalón en polea), ..., variante="agarre cerrado"`

**Por qué `slot_id` Y `ejercicio_id` van juntos en `series`:** `slot_id` permite ver la progresión "del hueco" (ej. cómo evoluciona el empuje horizontal en el Push, sea con barra o con máquina), mientras que `ejercicio_id` permite ver la progresión de un ejercicio concreto (ej. solo las veces que se hizo específicamente con barra). Son dos formas de consulta distintas sobre los mismos datos, y ninguna sustituye a la otra.

### Borrado de datos

Las FK de `series`, `rutina_slots` y `slot_alternativas` hacia `ejercicios` (y de `entrenamientos`/`rutina_slots` hacia `rutinas`) son `ON DELETE RESTRICT`, no `CASCADE` — un `DELETE` directo falla si hay historial dependiente, en vez de arrastrar borrados en cascada por accidente.

La lógica real de borrado vive en el backend, con dos casos:

- **Sin historial dependiente** (el ejercicio/rutina/slot nunca se ha usado en ningún `series`/`entrenamiento`): se borra de verdad (`DELETE`) sin preguntar nada — no hay nada que perder.
- **Con historial dependiente**: se avisa al usuario con dos opciones explícitas:
  - **Ocultar** (borrado lógico: `activo = false`). Deja de aparecer para entrenamientos nuevos, pero el historial existente queda intacto.
  - **Borrar definitivamente**: transacción explícita en el backend que borra primero las filas dependientes (`series`, `slot_alternativas`, etc.) y después la fila principal. Se avisa de que el historial asociado se pierde y no se puede deshacer.

Por eso `ejercicios`, `rutinas` y `rutina_slots` tienen columna `activo` — son las tres tablas que otras (`series`, `entrenamientos`, `slot_alternativas`) pueden referenciar con historial real.

### Mejora futura: múltiples grupos musculares por ejercicio (Opción B)

Actualmente cada ejercicio solo tiene un grupo muscular (`grupo_muscular_id` en `ejercicios`, Opción A). Si en el futuro interesa reflejar que un ejercicio trabaja varios músculos (ej. el press banca también implica tríceps y hombro), se puede migrar a una relación muchos-a-muchos con una tabla intermedia:

```
ejercicio_grupos_musculares
ejercicio_id        INTEGER FK → ejercicios
grupo_muscular_id   INTEGER FK → grupos_musculares
es_principal         BOOLEAN
```

Esta migración sería sencilla y sin pérdida de datos: se crea la tabla nueva, se migran automáticamente los datos existentes (por cada ejercicio, se inserta una fila en la tabla intermedia con su `grupo_muscular_id` actual marcado como `es_principal=true`), y opcionalmente se elimina la columna `grupo_muscular_id` de `ejercicios`. Todo esto se haría como una migración de Alembic. No es prioritario implementarlo ahora — solo tendría sentido si se necesita calcular estadísticas de volumen por grupo muscular incluyendo trabajo secundario.

### Decisiones descartadas / aplazadas

- **Administradores:** no se implementa por ahora (un único usuario, sin necesidad de moderar contenido de otros). Si en el futuro hiciera falta, la recomendación es añadir un campo simple `rol` (VARCHAR, "usuario"/"admin") en `usuarios`, no una tabla de roles aparte — solo se justificaría un sistema más complejo (RBAC) si hubiera muchos roles con permisos combinables, que no es el caso aquí.
- **`rutina_alternativas`** (rutinas completas de repuesto): descartada — no es necesaria, los comodines se gestionan a nivel de ejercicio con `slot_alternativas`.
- **Array de IDs en `rutina_slots` en vez de `slot_alternativas`:** descartado por romper integridad referencial (FKs), complicar las consultas, y por ahorro insignificante dado el volumen de datos real del proyecto.
- **Foto/vídeo en `ejercicios`:** mencionado en el MVP original, aplazado a una iteración futura — no se añade columna todavía.

## Sincronización móvil ↔ PC y modo offline

- **Alcance actual (fase inicial):** la sincronización entre la app móvil y el backend (en el PC) solo funciona cuando ambos están en la **misma red WiFi de casa**. Por ahora se descarta Tailscale u otras soluciones de acceso remoto (quedan como posible mejora futura, no prioritaria).
- **Modo offline-first en el móvil:** la app React Native debe guardar los datos en una base de datos local en el propio dispositivo (SQLite / WatermelonDB o similar), de forma que la app **nunca dependa del PC para abrirse ni para funcionar día a día** (por ejemplo, en el gimnasio, sin PC cerca).
  - Cada cambio (nuevo entrenamiento, serie añadida, etc.) se guarda primero en local, marcado como "pendiente de sincronizar".
  - La app intenta conectar periódicamente con la API del PC; si lo consigue, sube los cambios pendientes y descarga los que falten.
  - Si no hay conexión con el PC, la app sigue funcionando en local sin bloquear nada, y reintenta más tarde.
  - Al ser un único usuario (no hay edición concurrente por varias personas), no hace falta resolución de conflictos compleja: basta con estrategia "gana el cambio más reciente" (last-write-wins, comparando por fecha de modificación real del cambio en el dispositivo, no por cuándo llegó a sincronizarse — para eso las tablas editables llevan columna `updated_at`).

## Instalación de la app móvil (aclaración importante)

- El repo (o la carpeta mobile/) **no se instala tal cual** en el móvil — se clona el monorepo completo en el PC y se trabaja desde la carpeta correspondiente.
- **Durante desarrollo:** usar `npx expo start` desde mobile/ y la app **Expo Go** (instalada desde Play Store) para escanear el QR y probar la app en caliente mientras el móvil esté en la misma WiFi que el PC. Este modo es solo para desarrollo: si se cierra el proceso en el PC, la app deja de abrir.
- **Para uso real en el gimnasio:** generar un APK instalable de verdad con `eas build` (herramienta de Expo). Ese APK se instala como cualquier app normal, se abre sin depender del PC, y solo necesita el PC encendido y en la misma WiFi en el momento puntual de sincronizar datos nuevos (gracias al modo offline-first).

## Funcionalidades

### MVP (núcleo, prioridad para empezar)
- Registro de entrenamientos por día: ejercicio, series, repeticiones, peso, sensación/RPE.
- Biblioteca de ejercicios (nombre, grupo muscular, foto/vídeo opcional).
- Historial por ejercicio para ver progresión en el tiempo.
- CRUD de rutinas/plantillas reutilizables (ej. rutina "empuje/tirón/pierna").

### Nivel medio
- Gráficas de progresión (peso levantado, volumen semanal, etc.).
- Calculadora de 1RM estimado.
- Autenticación de usuarios (JWT).
- Vista de calendario/semana de entrenamientos.
- Planificación por bloques/mesociclos.

### Nivel avanzado
- Sugerencias automáticas de progresión de carga.
- Exportar/backup de datos (CSV/PDF).
- PWA para uso desde el móvil en el gimnasio (evaluar si sigue teniendo sentido una vez exista la app React Native nativa).
- Sincronización móvil-PC offline-first (ver sección específica arriba) — fase posterior al MVP funcionando en web y móvil por separado.
- Comparativas de rendimiento (peso corporal vs peso levantado, etc.).
- Acceso remoto fuera de la red WiFi de casa (ej. mediante Tailscale) — mejora futura, no prioritaria.

### Etapa final (idea, NO decidida ni fija todavía)
- Posibilidad de convertir la app en una red social (compartir entrenamientos, seguir a otros usuarios, etc.). Esto es una idea a futuro, no un requisito confirmado — no diseñar el resto del sistema asumiendo que esto se hará, pero tenerlo en cuenta como posible dirección a largo plazo.

## Contexto del autor (relevante para sugerencias de Claude Code)

- Formación: ciclos DAW y DAM, bootcamp fullstack con Imatia.
- Stack ya conocido (por si ayuda a explicar analogías o decisiones): Java, C#, Python, JavaScript, Kotlin, MySQL, SQL Server, SQLite, Room, Angular, Docker, Odoo, Spring Boot, HTML, CSS, Scrum.
- Busca activamente entrar en el mundo laboral como programador — el proyecto también sirve como pieza de portfolio, así que conviene cuidar estructura, README y commits con mensajes claros.
