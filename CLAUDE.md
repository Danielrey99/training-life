# training-life

App de entrenamiento de gimnasio para uso personal, pensada también como proyecto para reactivar GitHub y mostrar en portfolio.

> Nombre provisional del proyecto/app: "Training Life" (repo: `training-life`, minúsculas y guiones — convención estándar de GitHub). Puede cambiarse más adelante sin problema (renombrar el repo en GitHub no rompe URLs antiguas, redirigen automáticamente).

## Convención de documentación

- **README.md** (raíz y uno por carpeta en `backend/`, `web/`, `mobile/`) es documentación para **humanos** (reclutadores, colaboradores, el propio autor más adelante). Debe ser siempre autocontenido: nunca debe remitir a este CLAUDE.md para completar información.
- **CLAUDE.md** (este archivo) es contexto interno para Claude Code: decisiones técnicas, alternativas descartadas y el porqué. No es documentación de cara al lector del repo, así que los README nunca deben enlazarlo ni decir "ver CLAUDE.md para más detalle".
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

### .gitignore recomendado (raíz del monorepo)

```gitignore
# Backend (Python/FastAPI)
backend/__pycache__/
backend/**/__pycache__/
backend/.venv/
backend/venv/
backend/*.pyc
backend/.env

# Web (React)
web/node_modules/
web/dist/
web/build/
web/.env

# Mobile (React Native/Expo)
mobile/node_modules/
mobile/.expo/
mobile/dist/
mobile/*.apk
mobile/*.aab
mobile/.env

# Docker
docker-compose.override.yml

# Editor / SO
.vscode/
.DS_Store
Thumbs.db

# Variables de entorno generales
.env
.env.local
```

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

## Sincronización móvil ↔ PC y modo offline

- **Alcance actual (fase inicial):** la sincronización entre la app móvil y el backend (en el PC) solo funciona cuando ambos están en la **misma red WiFi de casa**. Por ahora se descarta Tailscale u otras soluciones de acceso remoto (quedan como posible mejora futura, no prioritaria).
- **Modo offline-first en el móvil:** la app React Native debe guardar los datos en una base de datos local en el propio dispositivo (SQLite / WatermelonDB o similar), de forma que la app **nunca dependa del PC para abrirse ni para funcionar día a día** (por ejemplo, en el gimnasio, sin PC cerca).
  - Cada cambio (nuevo entrenamiento, serie añadida, etc.) se guarda primero en local, marcado como "pendiente de sincronizar".
  - La app intenta conectar periódicamente con la API del PC; si lo consigue, sube los cambios pendientes y descarga los que falten.
  - Si no hay conexión con el PC, la app sigue funcionando en local sin bloquear nada, y reintenta más tarde.
  - Al ser un único usuario (no hay edición concurrente por varias personas), no hace falta resolución de conflictos compleja: basta con estrategia "gana el cambio más reciente" (last-write-wins, comparando por fecha de modificación).

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
