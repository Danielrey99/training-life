/**
 * El esquema de la base del teléfono: las 13 tablas del backend en SQLite.
 *
 * Copia `backend/app/models.py` (cabeza de Alembic `e3f7a1c92b04`) con estas diferencias:
 * - Tablas STRICT: un 80.5 en una columna INTEGER es un error y no se guarda en silencio.
 * - Ids AUTOINCREMENT: un id borrado no se reutiliza, como con las secuencias de PostgreSQL.
 * - Fechas en TEXT 'YYYY-MM-DD' (se ordenan como texto) e instantes en TEXT ISO con zona.
 * - Booleanos en INTEGER 0/1.
 * - Los pesos, en centésimas enteras (`peso_centesimas`): 80,5 kg es 8050. Así no hay
 *   decimales de coma flotante, y los topes de NUMERIC(6,2) y NUMERIC(5,2) son números.
 * - Los String(n) pasan a CHECK (length(col) <= n), porque SQLite no los hace cumplir.
 * - `updated_at` lo pone un disparador, que solo actúa si cambió otra columna (como el
 *   `onupdate` del ORM, que no escribe nada si nada cambia).
 * - Índices en las claves ajenas hijas: solo rendimiento, no cambian ningún resultado.
 *
 * Los CHECK y los UNIQUE llevan el mismo nombre que en PostgreSQL.
 *
 * Esto es la versión 1. Una vez publicada en un APK no se edita: un cambio va en un paso
 * nuevo de `migraciones.ts`.
 */

// El objetivo de un ejercicio en un hueco: o repeticiones o duración, cada par completo.
const OBJETIVO_CHECK =
  '(reps_min IS NULL) = (reps_max IS NULL)' +
  ' AND (duracion_min_s IS NULL) = (duracion_max_s IS NULL)' +
  ' AND (reps_min IS NULL) <> (duracion_min_s IS NULL)'

const TABLAS = `
CREATE TABLE meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
) STRICT;

CREATE TABLE grupos_musculares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(nombre) <= 50),
  -- Como restricción de tabla y no de columna: si no, SQLite le pone este nombre también al
  -- CHECK de la longitud, y un nombre largo parecería un nombre repetido.
  CONSTRAINT grupos_musculares_nombre_key UNIQUE (nombre)
) STRICT;

CREATE TABLE ejercicios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(nombre) <= 100),
  grupo_muscular_id INTEGER NOT NULL REFERENCES grupos_musculares (id),
  descripcion TEXT CHECK (length(descripcion) <= 500),
  es_predefinido INTEGER NOT NULL DEFAULT 0 CHECK (es_predefinido IN (0, 1)),
  tipo_registro TEXT NOT NULL DEFAULT 'peso_reps' CONSTRAINT ejercicios_tipo_registro_check
    CHECK (tipo_registro IN ('peso_reps', 'corporal', 'tiempo', 'cardio')),
  oculto_desde TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE notas_ejercicio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ejercicio_id INTEGER NOT NULL REFERENCES ejercicios (id) ON DELETE CASCADE,
  nota TEXT NOT NULL CHECK (length(nota) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE rutinas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(nombre) <= 100),
  oculto_desde TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE rutina_periodos_ocultos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rutina_id INTEGER NOT NULL REFERENCES rutinas (id) ON DELETE CASCADE,
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  CONSTRAINT rutina_periodos_ocultos_rango_check CHECK (hasta > desde)
) STRICT;

CREATE TABLE rutina_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rutina_id INTEGER NOT NULL REFERENCES rutinas (id) ON DELETE RESTRICT,
  ejercicio_principal_id INTEGER NOT NULL REFERENCES ejercicios (id) ON DELETE RESTRICT,
  orden INTEGER NOT NULL,
  series_objetivo INTEGER NOT NULL,
  reps_min INTEGER,
  reps_max INTEGER,
  duracion_min_s INTEGER,
  duracion_max_s INTEGER,
  oculto_desde TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT rutina_slots_rutina_id_orden_key UNIQUE (rutina_id, orden),
  CONSTRAINT rutina_slots_objetivo_check CHECK (${OBJETIVO_CHECK})
) STRICT;

CREATE TABLE slot_alternativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL REFERENCES rutina_slots (id) ON DELETE CASCADE,
  ejercicio_id INTEGER NOT NULL REFERENCES ejercicios (id) ON DELETE RESTRICT,
  series_objetivo INTEGER NOT NULL,
  reps_min INTEGER,
  reps_max INTEGER,
  duracion_min_s INTEGER,
  duracion_max_s INTEGER,
  CONSTRAINT slot_alternativas_slot_id_ejercicio_id_key UNIQUE (slot_id, ejercicio_id),
  CONSTRAINT slot_alternativas_objetivo_check CHECK (${OBJETIVO_CHECK})
) STRICT;

CREATE TABLE entrenamientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rutina_id INTEGER NOT NULL REFERENCES rutinas (id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL CONSTRAINT entrenamientos_fecha_key UNIQUE,
  -- Los NULL no chocan entre sí, igual que en PostgreSQL.
  cubre_fecha TEXT CONSTRAINT entrenamientos_cubre_fecha_key UNIQUE,
  notas TEXT CHECK (length(notas) <= 1000),
  terminada_en TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- NUMERIC(6,2) del peso: de -9999,99 a 9999,99. NUMERIC(5,2) del peso corporal: hasta 999,99.
CREATE TABLE series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entrenamiento_id INTEGER NOT NULL REFERENCES entrenamientos (id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL REFERENCES rutina_slots (id) ON DELETE RESTRICT,
  ejercicio_id INTEGER NOT NULL REFERENCES ejercicios (id) ON DELETE RESTRICT,
  numero_serie INTEGER NOT NULL,
  peso_centesimas INTEGER CHECK (peso_centesimas BETWEEN -999999 AND 999999),
  repeticiones INTEGER,
  duracion_s INTEGER,
  distancia_m INTEGER,
  peso_corporal_centesimas INTEGER CHECK (peso_corporal_centesimas <= 99999),
  variante TEXT CHECK (length(variante) <= 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT series_medidas_check CHECK (
    (repeticiones IS NOT NULL AND peso_centesimas IS NOT NULL AND duracion_s IS NULL
      AND distancia_m IS NULL)
    OR (repeticiones IS NULL AND duracion_s IS NOT NULL
      AND (peso_centesimas IS NULL OR distancia_m IS NULL))),
  CONSTRAINT series_peso_check CHECK (
    peso_centesimas IS NULL OR peso_centesimas >= 0 OR repeticiones IS NOT NULL),
  CONSTRAINT series_duracion_check CHECK (duracion_s IS NULL OR duracion_s > 0),
  CONSTRAINT series_distancia_check CHECK (distancia_m IS NULL OR distancia_m > 0),
  CONSTRAINT series_peso_corporal_check CHECK (peso_corporal_centesimas IS NULL
    OR (peso_corporal_centesimas > 0 AND repeticiones IS NOT NULL))
) STRICT;

CREATE TABLE programas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(nombre) <= 100),
  oculto_desde TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE programa_dias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  programa_id INTEGER NOT NULL REFERENCES programas (id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CONSTRAINT programa_dias_dia_semana_check
    CHECK (dia_semana BETWEEN 1 AND 7),
  rutina_id INTEGER NOT NULL REFERENCES rutinas (id) ON DELETE CASCADE,
  desde TEXT,
  hasta TEXT,
  CONSTRAINT programa_dias_vigencia_check CHECK (desde IS NULL OR hasta IS NULL OR hasta > desde)
) STRICT;
CREATE UNIQUE INDEX ix_programa_dias_programa_dia_abierto
  ON programa_dias (programa_id, dia_semana) WHERE hasta IS NULL;

CREATE TABLE programa_periodos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  programa_id INTEGER NOT NULL REFERENCES programas (id) ON DELETE CASCADE,
  desde TEXT NOT NULL,
  hasta TEXT,
  CONSTRAINT programa_periodos_rango_check CHECK (hasta IS NULL OR hasta >= desde)
) STRICT;
-- Un solo periodo abierto en toda la tabla: un solo programa activo a la vez.
CREATE UNIQUE INDEX ix_programa_periodos_abierto
  ON programa_periodos ((hasta IS NULL)) WHERE hasta IS NULL;

CREATE TABLE excepciones_del_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL CONSTRAINT excepciones_del_plan_fecha_key UNIQUE,
  rutina_id INTEGER REFERENCES rutinas (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`

const INDICES = `
CREATE INDEX ix_series_entrenamiento_id ON series (entrenamiento_id);
CREATE INDEX ix_series_slot_id ON series (slot_id);
CREATE INDEX ix_series_ejercicio_id ON series (ejercicio_id);
CREATE INDEX ix_rutina_slots_ejercicio_principal_id ON rutina_slots (ejercicio_principal_id);
CREATE INDEX ix_slot_alternativas_ejercicio_id ON slot_alternativas (ejercicio_id);
CREATE INDEX ix_notas_ejercicio_ejercicio_id ON notas_ejercicio (ejercicio_id);
CREATE INDEX ix_programa_dias_programa_id ON programa_dias (programa_id);
CREATE INDEX ix_programa_dias_rutina_id ON programa_dias (rutina_id);
CREATE INDEX ix_programa_periodos_programa_id ON programa_periodos (programa_id);
CREATE INDEX ix_rutina_periodos_ocultos_rutina_id ON rutina_periodos_ocultos (rutina_id);
CREATE INDEX ix_excepciones_del_plan_rutina_id ON excepciones_del_plan (rutina_id);
CREATE INDEX ix_entrenamientos_rutina_id ON entrenamientos (rutina_id);
`

/** Las tablas con `updated_at` y las columnas cuyo cambio lo actualiza. */
export const COLUMNAS_CON_UPDATED_AT: Record<string, string[]> = {
  ejercicios: [
    'nombre',
    'grupo_muscular_id',
    'descripcion',
    'es_predefinido',
    'tipo_registro',
    'oculto_desde',
    'created_at',
  ],
  notas_ejercicio: ['ejercicio_id', 'nota', 'created_at'],
  rutinas: ['nombre', 'oculto_desde', 'created_at'],
  rutina_slots: [
    'rutina_id',
    'ejercicio_principal_id',
    'orden',
    'series_objetivo',
    'reps_min',
    'reps_max',
    'duracion_min_s',
    'duracion_max_s',
    'oculto_desde',
    'created_at',
  ],
  entrenamientos: ['rutina_id', 'fecha', 'cubre_fecha', 'notas', 'terminada_en', 'created_at'],
  series: [
    'entrenamiento_id',
    'slot_id',
    'ejercicio_id',
    'numero_serie',
    'peso_centesimas',
    'repeticiones',
    'duracion_s',
    'distancia_m',
    'peso_corporal_centesimas',
    'variante',
    'created_at',
  ],
  programas: ['nombre', 'oculto_desde', 'created_at'],
  excepciones_del_plan: ['fecha', 'rutina_id', 'created_at'],
}

function disparador(tabla: string, columnas: string[]): string {
  // Solo si quien actualiza no ha puesto él mismo `updated_at` y algo ha cambiado de verdad.
  const cambio = columnas.map((c) => `NEW.${c} IS NOT OLD.${c}`).join(' OR ')
  return (
    `CREATE TRIGGER ${tabla}_updated_at AFTER UPDATE ON ${tabla} FOR EACH ROW` +
    ` WHEN NEW.updated_at IS OLD.updated_at AND (${cambio})` +
    ` BEGIN UPDATE ${tabla} SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` +
    ` WHERE id = NEW.id; END;`
  )
}

const DISPARADORES = Object.entries(COLUMNAS_CON_UPDATED_AT)
  .map(([tabla, columnas]) => disparador(tabla, columnas))
  .join('\n')

/** El esquema entero de la versión 1. */
export const ESQUEMA_V1 = [TABLAS, INDICES, DISPARADORES].join('\n')
