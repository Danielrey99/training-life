/**
 * Genera las bases congeladas de la versión 1 que usa `migrar_base_congelada.test.ts`. Solo
 * corre con `CONGELAR=1`; sin ella, se salta:
 *
 *   CONGELAR=1 npx jest tests/logica/congelar_bases.test.ts
 *
 * - `tests/fijos/base_v1.sql`: una base sintética con datos variados en todas las tablas,
 *   montada con la api del móvil sobre una base nueva. Va a git.
 * - `.claude/datos_reales/base_v1_real_2026_11_10.sql`: los datos reales del autor, importados
 *   de `copia_2026_11_10.json`. Es local y nunca va a git.
 *
 * Se generan una sola vez, mientras la base del teléfono está en la versión 1: después ya no
 * habría forma de crear una base v1 con el código del momento. No se regeneran nunca; si
 * esto se ejecuta con otra versión, falla antes de escribir nada.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { VERSION_ACTUAL } from '../../src/logica/bd/migraciones'
import { esperar_estado } from '../apoyo/ayudas'
import { crearCliente, type ClienteDeTest, type RelojDeTest } from '../apoyo/cliente'
import { BASE_V1, BASE_V1_REAL, volcar } from '../apoyo/volcado'

const COPIA_REAL = join(
  __dirname,
  '..',
  '..',
  '..',
  '.claude',
  'datos_reales',
  'copia_2026_11_10.json',
)

const congelar = process.env.CONGELAR === '1'
const siCongelar = congelar ? test : test.skip

function escribir(ruta: string, sql: string): void {
  if (VERSION_ACTUAL !== 1) {
    throw new Error(
      `La base del teléfono ya está en la versión ${VERSION_ACTUAL}: la v1 no se regenera.`,
    )
  }
  mkdirSync(dirname(ruta), { recursive: true })
  // Tal cual, con LF: el volcado ya lleva solo «\n».
  writeFileSync(ruta, sql, 'utf8')
}

// --- La base sintética ----------------------------------------------------------------------

function post(cliente: ClienteDeTest, url: string, json: unknown, estado = 201): any {
  const respuesta = cliente.post(url, { json })
  esperar_estado(respuesta, estado)
  return respuesta.json()
}

function put(cliente: ClienteDeTest, url: string, json: unknown): any {
  const respuesta = cliente.put(url, { json })
  esperar_estado(respuesta, 200)
  return respuesta.json()
}

function borrar(cliente: ClienteDeTest, url: string): void {
  esperar_estado(cliente.delete(url), 204)
}

const REPS = (series: number, min: number, max: number) => ({
  series_objetivo: series,
  reps_min: min,
  reps_max: max,
  duracion_min_s: null,
  duracion_max_s: null,
})

const SEGUNDOS = (series: number, min: number, max: number) => ({
  series_objetivo: series,
  reps_min: null,
  reps_max: null,
  duracion_min_s: min,
  duracion_max_s: max,
})

/**
 * Monta, día a día, lo que haría alguien en un mes de uso: de todo y en todas las tablas.
 * Deja también huecos en los ids (filas borradas), para que las secuencias vayan por delante.
 */
function montarBaseSintetica(cliente: ClienteDeTest, reloj: RelojDeTest): void {
  const grupos: { id: number; nombre: string }[] = cliente.get('/grupos-musculares').json()
  const grupo = (nombre: string) => grupos.find((g) => g.nombre === nombre)!.id
  const predefinido = (nombre: string): number =>
    cliente
      .get('/ejercicios')
      .json()
      .find((e: any) => e.es_predefinido && e.nombre === nombre).id

  // Martes 1 de septiembre: los ejercicios propios, las rutinas y el programa.
  reloj.fijar('2026-09-01')
  const press = post(cliente, '/ejercicios', {
    nombre: "Press d'Alembert",
    grupo_muscular_id: grupo('Pecho'),
    tipo_registro: 'peso_reps',
    descripcion: "Con «comillas», tildes (áéíóúñ) y un apóstrofo: l'ejercici.",
  }).id
  const fondos = post(cliente, '/ejercicios', {
    nombre: 'Fondos lastrados',
    grupo_muscular_id: grupo('Tríceps'),
    tipo_registro: 'corporal',
  }).id
  const plancha = post(cliente, '/ejercicios', {
    nombre: 'Plancha con toalla',
    grupo_muscular_id: grupo('Abdomen'),
    tipo_registro: 'tiempo',
  }).id
  const bici = post(cliente, '/ejercicios', {
    nombre: 'Bici del garaje',
    grupo_muscular_id: grupo('Cardio'),
    tipo_registro: 'cardio',
  }).id
  const curl = post(cliente, '/ejercicios', {
    nombre: 'Curl en barra Z casero',
    grupo_muscular_id: grupo('Bíceps'),
  }).id
  // Uno que se borra sin historial: deja un hueco en los ids de los ejercicios.
  const sobra = post(cliente, '/ejercicios', {
    nombre: 'Ejercicio que se borra',
    grupo_muscular_id: grupo('Cuello'),
  }).id
  borrar(cliente, `/ejercicios/${sobra}`)

  const sentadilla = predefinido('Sentadilla con barra')
  const pressMancuernas = predefinido('Press banca con mancuernas')
  const remo = predefinido('Remo con barra')

  post(cliente, `/ejercicios/${press}/notas`, {
    nota: 'Codos a 45 grados.\nNo bloquear arriba, y la barra al pecho.',
  })
  post(cliente, `/ejercicios/${sentadilla}/notas`, {
    nota: "Cinturón desde 100 kg; 'rodillas fuera'",
  })
  const notaQueSeBorra = post(cliente, `/ejercicios/${bici}/notas`, { nota: 'Se borra' }).id
  borrar(cliente, `/ejercicios/${bici}/notas/${notaQueSeBorra}`)

  const torso = post(cliente, '/rutinas', { nombre: 'Torso' }).id
  const huecoPress = post(cliente, `/rutinas/${torso}/slots`, {
    ejercicio_principal_id: press,
    ...REPS(4, 6, 10),
    alternativas: [
      { ejercicio_id: pressMancuernas, ...REPS(3, 8, 12) },
      { ejercicio_id: fondos, ...REPS(3, 6, 12) },
    ],
  }).id
  const huecoFondos = post(cliente, `/rutinas/${torso}/slots`, {
    ejercicio_principal_id: fondos,
    ...REPS(3, 8, 15),
  }).id
  post(cliente, `/rutinas/${torso}/slots`, {
    ejercicio_principal_id: remo,
    ...REPS(4, 8, 10),
  })

  const pierna = post(cliente, '/rutinas', { nombre: 'Pierna y core' }).id
  const huecoSentadilla = post(cliente, `/rutinas/${pierna}/slots`, {
    ejercicio_principal_id: sentadilla,
    ...REPS(5, 3, 5),
  }).id
  const huecoPlancha = post(cliente, `/rutinas/${pierna}/slots`, {
    ejercicio_principal_id: plancha,
    ...SEGUNDOS(3, 30, 60),
    alternativas: [{ ejercicio_id: bici, ...SEGUNDOS(1, 600, 1200) }],
  }).id
  const huecoBici = post(cliente, `/rutinas/${pierna}/slots`, {
    ejercicio_principal_id: bici,
    ...SEGUNDOS(1, 900, 1800),
  }).id

  const antigua = post(cliente, '/rutinas', { nombre: 'Brazos (la de antes)' }).id
  const huecoCurl = post(cliente, `/rutinas/${antigua}/slots`, {
    ejercicio_principal_id: curl,
    ...REPS(3, 10, 12),
  }).id
  post(cliente, '/rutinas', { nombre: 'Rutina sin ejercicios' })

  const programa = post(cliente, '/programas', {
    nombre: 'Torso y pierna',
    activar: true,
    dias: [
      { dia_semana: 2, rutina_id: torso },
      { dia_semana: 4, rutina_id: pierna },
    ],
  }).id
  post(cliente, '/programas', {
    nombre: 'Programa sin usar',
    activar: false,
    dias: [{ dia_semana: 1, rutina_id: antigua }],
  })

  /** Una sesión de ese día con esas series (`[hueco, ejercicio, medidas]`), terminada si se dice. */
  const sesion = (
    fecha: string,
    rutina_id: number,
    series: [number, number, Record<string, unknown>][],
    { terminar = true, notas }: { terminar?: boolean; notas?: string } = {},
  ): { id: number; series: number[] } => {
    reloj.fijar(fecha)
    const id = post(cliente, '/entrenamientos', {
      rutina_id,
      fecha,
      ...(notas ? { notas } : {}),
    }).id
    const ids = series.map(
      ([slot_id, ejercicio_id, medidas], n) =>
        post(cliente, `/entrenamientos/${id}/series`, {
          slot_id,
          ejercicio_id,
          numero_serie: n + 1,
          ...medidas,
        }).id,
    )
    if (terminar) post(cliente, `/entrenamientos/${id}/terminar`, undefined, 200)
    return { id, series: ids }
  }

  sesion(
    '2026-09-01',
    torso,
    [
      [huecoPress, press, { peso: 60.5, repeticiones: 8 }],
      [huecoPress, press, { peso: 60.5, repeticiones: 7 }],
      [huecoPress, press, { peso: 57.25, repeticiones: 10 }],
      [huecoFondos, fondos, { peso: 0, repeticiones: 12 }],
      [huecoFondos, fondos, { peso: 5, repeticiones: 9 }],
    ],
    { notas: 'Buen día.\nHombro algo cargado' },
  )
  sesion('2026-09-03', pierna, [
    [huecoSentadilla, sentadilla, { peso: 100, repeticiones: 5 }],
    [huecoSentadilla, sentadilla, { peso: 102.5, repeticiones: 4 }],
    [huecoPlancha, plancha, { duracion_s: 60 }],
    [huecoPlancha, plancha, { duracion_s: 45, peso: 10 }],
    [huecoBici, bici, { duracion_s: 1200, distancia_m: 8000 }],
  ])
  sesion('2026-09-05', antigua, [
    [huecoCurl, curl, { peso: 25, repeticiones: 12 }],
    [huecoCurl, curl, { peso: 27.5, repeticiones: 10 }],
  ])

  // La rutina antigua se oculta el 6 y se vuelve a mostrar el 10: deja un tramo oculto.
  reloj.fijar('2026-09-06')
  borrar(cliente, `/rutinas/${antigua}?modo=ocultar`)

  // En la sesión del 8, el press con su alternativa, y una serie que se apunta y se borra.
  const del8 = sesion('2026-09-08', torso, [
    [huecoPress, pressMancuernas, { peso: 24, repeticiones: 12 }],
    [huecoPress, pressMancuernas, { peso: 26, repeticiones: 9 }],
    [huecoFondos, fondos, { peso: 7.5, repeticiones: 8, peso_corporal: 78.4, variante: 'En paralelas' }],
    [huecoFondos, fondos, { peso: 7.5, repeticiones: 1 }],
  ])
  borrar(cliente, `/entrenamientos/${del8.id}/series/${del8.series[3]}`)

  reloj.fijar('2026-09-10')
  post(cliente, `/rutinas/${antigua}/mostrar`, undefined, 200)
  // Días cambiados a mano: el sábado 12 toca pierna y el martes 15, descanso.
  put(cliente, '/plan/excepciones/2026-09-12', { rutina_id: pierna })
  put(cliente, '/plan/excepciones/2026-09-15', { rutina_id: null })

  // El viernes 11 se recupera la pierna del jueves 10.
  reloj.fijar('2026-09-11')
  const recuperada = post(cliente, '/entrenamientos', {
    rutina_id: pierna,
    fecha: '2026-09-11',
    cubre_fecha: '2026-09-10',
  }).id
  post(cliente, `/entrenamientos/${recuperada}/series`, {
    slot_id: huecoSentadilla,
    ejercicio_id: sentadilla,
    numero_serie: 1,
    peso: 95,
    repeticiones: 5,
  })
  post(cliente, `/entrenamientos/${recuperada}/terminar`, undefined, 200)

  sesion('2026-09-12', pierna, [
    [huecoSentadilla, sentadilla, { peso: 105, repeticiones: 3 }],
    [huecoPlancha, bici, { duracion_s: 900 }],
  ])

  // Una sesión que se borra entera: deja un hueco en los ids de las sesiones.
  const borrada = sesion('2026-09-14', torso, [[huecoPress, press, { peso: 50, repeticiones: 5 }]])
  borrar(cliente, `/entrenamientos/${borrada.id}`)

  // El 17, el hueco de los fondos se oculta (tiene series) y el curl también.
  reloj.fijar('2026-09-17')
  borrar(cliente, `/rutinas/${torso}/slots/${huecoFondos}?modo=ocultar`)
  borrar(cliente, `/ejercicios/${curl}?modo=ocultar`)

  // El 20 se deja el programa y se oculta otra vez la rutina antigua; el 28, se vuelve a él.
  reloj.fijar('2026-09-20')
  post(cliente, `/programas/${programa}/desactivar`, undefined, 200)
  borrar(cliente, `/rutinas/${antigua}?modo=ocultar`)
  reloj.fijar('2026-09-28')
  post(cliente, `/programas/${programa}/activar`, undefined, 200)

  sesion('2026-09-29', torso, [
    [huecoPress, press, { peso: 62.5, repeticiones: 6 }],
    [huecoPress, press, { peso: 62.5, repeticiones: 6 }],
  ])
  // El 30, la pierna pasa del jueves al viernes: el día del jueves queda cerrado.
  reloj.fijar('2026-09-30')
  put(cliente, `/programas/${programa}`, {
    nombre: 'Torso y pierna',
    dias: [
      { dia_semana: 2, rutina_id: torso },
      { dia_semana: 5, rutina_id: pierna },
    ],
  })
  // La última, sin terminar: en curso el jueves 1 de octubre.
  sesion('2026-10-01', pierna, [[huecoSentadilla, sentadilla, { peso: 107.5, repeticiones: 2 }]], {
    terminar: false,
  })
}

siCongelar('congela_la_base_v1_sintetica', () => {
  const { cliente, reloj, bd } = crearCliente()
  montarBaseSintetica(cliente, reloj)

  // Que no falte ninguna tabla: la base congelada tiene que tener filas en todas.
  const vacias = bd
    .todas<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .map((t) => t.name)
    .filter((tabla) => bd.una(`SELECT 1 FROM ${tabla} LIMIT 1`) === undefined)
  expect(vacias).toEqual([])

  escribir(BASE_V1, volcar(bd))
})

siCongelar('congela_la_base_v1_real', () => {
  if (!existsSync(COPIA_REAL)) {
    throw new Error(`Falta la copia real en ${COPIA_REAL}.`)
  }
  const { cliente, reloj, bd } = crearCliente()
  // El día en que se exportó: «hoy» al importar es el de ese día.
  reloj.fijar('2026-11-10')
  const archivo = JSON.parse(readFileSync(COPIA_REAL, 'utf8'))
  esperar_estado(cliente.post('/datos/importar', { json: archivo }), 200)

  escribir(BASE_V1_REAL, volcar(bd))
})
