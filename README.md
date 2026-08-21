# Training Life 🏋️

App de entrenamiento de gimnasio para uso personal — pensada para sustituir el bloc de notas donde apunto mis entrenamientos, con web y app móvil sincronizadas a través de un backend propio.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | FastAPI (Python) + PostgreSQL |
| Web | React |
| Móvil | React Native + Expo |
| Infraestructura | Docker Compose |

Frontend (web y móvil) siempre habla con el backend a través de API REST — nunca acceden directamente a la base de datos.

## Estructura del repositorio

Monorepo: backend, web y móvil viven en un único repo porque están acoplados entre sí (un cambio en un endpoint afecta a los dos frontends) y porque un único `docker-compose.yml` levanta todo el entorno de golpe.

```
training-life/
├── backend/          # API REST (FastAPI + PostgreSQL)
├── web/              # Frontend web (React)
├── mobile/           # App móvil (React Native + Expo)
├── docker-compose.yml
├── .gitignore
├── CLAUDE.md
└── README.md
```

## Estado actual

🚧 Proyecto en fase inicial: estructura de carpetas creada, aún sin código.

- [x] Estructura de carpetas del monorepo (`backend/`, `web/`, `mobile/`)
- [x] `.gitignore` del monorepo
- [ ] Backend: FastAPI + PostgreSQL + Docker Compose (CRUD del MVP)
- [ ] Web: React consumiendo la API
- [ ] Móvil: React Native + Expo
- [ ] Sincronización offline-first móvil ↔ PC

El orden de desarrollo es intencional: primero el backend, probado de forma aislada (FastAPI genera una documentación interactiva en `/docs` donde se puede probar cada endpoint sin necesidad de frontend), después la web, y al final el móvil, cuando la API ya esté madura y estable.

## Cómo levantar el proyecto

Todavía no disponible — se documentará aquí en cuanto exista el primer `docker-compose.yml` funcional con el backend.

## Roadmap de funcionalidades

**MVP**
- Registro de entrenamientos por día (ejercicio, series, repeticiones, peso, RPE)
- Biblioteca de ejercicios
- Historial de progresión por ejercicio
- CRUD de rutinas/plantillas reutilizables

**Nivel medio**
- Gráficas de progresión y volumen semanal
- Calculadora de 1RM estimado
- Autenticación (JWT)
- Vista de calendario semanal

**Nivel avanzado**
- Sugerencias automáticas de progresión de carga
- Exportar/backup de datos
- Sincronización offline-first móvil ↔ PC
