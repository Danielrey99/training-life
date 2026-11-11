/**
 * Las cifras de la pantalla de resumen: volumen, series por grupo y constancia. Puerto de
 * `backend/app/resumen.py` y de `backend/app/routers/resumen.py`.
 *
 * La gráfica de volumen tiene, por semana y por mes, ocho barras ya terminadas y, si el
 * periodo de hoy cae en la ventana del mes pedido, una más con lo que va de él (la barra en
 * curso). Cada barra trae su desglose (volumen por rutina y series por grupo muscular) y su
 * cambio sobre el último periodo anterior con volumen, aunque quede fuera de la gráfica.
 *
 * Qué cuenta en cada cifra:
 * - **Volumen** (Σ peso × repeticiones, solo de los ejercicios de peso y repeticiones) y
 *   **series** (de todos los tipos): todas las sesiones por su fecha real, también las
 *   abiertas, las que no cuentan para ningún día y las de rutinas o ejercicios ocultos.
 * - **Constancia**, día a día del plan: entrenados son los `hecho` y los `movido`, en el mes
 *   del día que tocaban; planificados, los entrenados más los `sin_hacer`; por llegar, los
 *   `pendiente` y los `proximo`.
 *
 * Diferencias con el backend, por no tener PostgreSQL:
 * - Los pesos se guardan en centésimas, así que el volumen se suma en enteros (centésimas de
 *   kg × repeticiones) y es exacto, como el `Decimal` de allí.
 * - `date_trunc('week' | 'month')` se hace con `lunesDe` y `primeroDelMes` de `dias.ts`.
 * - El cambio se redondea con aritmética entera: la mitad se aleja del cero (−6,25 → −6,3),
 *   como `ROUND_HALF_UP`; `Math.round` daría −6,2.
 */
import type { Contexto } from '../contexto'
import { noValido } from '../fallos'
import { aTexto } from '../reglas/centesimas'
import {
  aOrdinal,
  componer,
  diaDeLaSemana,
  diasDelMes,
  lunesDe,
  partes,
  primeroDelMes,
  sumarDias,
} from '../reglas/dias'
import { MESES } from '../reglas/fechas'
import type { EvolucionDeVolumen, MesDeConstancia, PeriodoDeVolumen, Resumen } from '../tipos'
import { seguimiento } from './seguimiento'

/** Cuántas barras terminadas tiene la gráfica de volumen, en semanas o en meses. */
const PERIODOS = 8

type Unidad = 'week' | 'month'
type Rango = [string, string]

/** «Septiembre de 2026». */
export function nombreDelMes(primero: string): string {
  const { anio, mes } = partesSeguras(primero)
  const nombre = MESES[mes - 1]
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} de ${anio}`
}

function partesSeguras(iso: string) {
  const p = partes(iso)
  if (!p) throw new Error(`No es una fecha: ${iso}`)
  return p
}

/** El día 1 del mes que queda `n` meses después (o antes, si es negativo). */
export function sumarMeses(primero: string, n: number): string {
  const { anio, mes } = partesSeguras(primero)
  const total = anio * 12 + mes - 1 + n
  return componer(Math.floor(total / 12), (total % 12) + 1, 1)
}

function ultimoDia(primero: string): string {
  const { anio, mes } = partesSeguras(primero)
  return componer(anio, mes, diasDelMes(anio, mes))
}

/** El mes de una fecha como número de meses desde el año 0, para restar meses. */
function numeroDeMes(iso: string): number {
  const { anio, mes } = partesSeguras(iso)
  return anio * 12 + mes
}

/** Las barras de una vista: las terminadas y la en curso, si cae en la ventana. */
class Ventana {
  constructor(
    readonly unidad: Unidad,
    readonly terminados: Rango[],
    readonly enCurso: Rango | null,
  ) {}

  get barras(): Rango[] {
    return this.enCurso ? [...this.terminados, this.enCurso] : this.terminados
  }

  /** La barra en la que cae `fecha`, o `null` si cae fuera de la gráfica. */
  indice(fecha: string): number | null {
    const inicio = this.terminados[0][0]
    const indice =
      this.unidad === 'week'
        ? Math.floor((aOrdinal(fecha) - aOrdinal(inicio)) / 7)
        : numeroDeMes(fecha) - numeroDeMes(inicio)
    return indice >= 0 && indice < this.barras.length ? indice : null
  }
}

/**
 * Las semanas y los meses de la gráfica de volumen, del más antiguo al último.
 *
 * Las barras terminadas: la última semana es la del último día del mes si ya acabó; si no,
 * la última acabada. El último mes es el pedido si ya acabó; si es el actual, el anterior.
 * La barra en curso es la semana de hoy si la semana del último día del mes pedido aún no
 * ha terminado, y el mes de hoy si el pedido es el actual.
 */
function ventanas(primero: string, hoy: string): [Ventana, Ventana] {
  const ultimo = ultimoDia(primero)
  const lunesHoy = lunesDe(hoy)
  const domingoDelUltimo = sumarDias(ultimo, 7 - diaDeLaSemana(ultimo))
  const ayerDelLunes = sumarDias(lunesHoy, -1)
  const domingo = domingoDelUltimo < ayerDelLunes ? domingoDelUltimo : ayerDelLunes
  const semanas: Rango[] = []
  for (let n = PERIODOS - 1; n >= 0; n--) {
    semanas.push([sumarDias(domingo, -(7 * n + 6)), sumarDias(domingo, -7 * n)])
  }
  const ultimoMes = ultimo < hoy ? primero : sumarMeses(primero, -1)
  const meses: Rango[] = []
  for (let n = PERIODOS - 1; n >= 0; n--) {
    const inicio = sumarMeses(ultimoMes, -n)
    meses.push([inicio, ultimoDia(inicio)])
  }
  const semanaEnCurso: Rango | null = ultimo >= lunesHoy ? [lunesHoy, sumarDias(lunesHoy, 6)] : null
  const mesEnCurso: Rango | null = ultimo >= hoy ? [primero, ultimo] : null
  return [new Ventana('week', semanas, semanaEnCurso), new Ventana('month', meses, mesEnCurso)]
}

/**
 * El último periodo anterior a `antesDe` con volumen, y su volumen en centésimas.
 *
 * Es con lo que se compara la primera barra con volumen de la gráfica, aunque quede muy
 * atrás. Se suma por día en SQL y se agrupa por semana o por mes aquí (en SQLite no hay
 * `date_trunc`).
 */
function referencia(ctx: Contexto, unidad: Unidad, antesDe: string): [string, number] | null {
  const dias = ctx.bd.todas<{ fecha: string; volumen: number }>(
    'SELECT entrenamientos.fecha, SUM(series.peso_centesimas * series.repeticiones) AS volumen' +
      ' FROM entrenamientos' +
      ' JOIN series ON series.entrenamiento_id = entrenamientos.id' +
      ' JOIN ejercicios ON ejercicios.id = series.ejercicio_id' +
      " WHERE entrenamientos.fecha < ? AND ejercicios.tipo_registro = 'peso_reps'" +
      ' GROUP BY entrenamientos.fecha ORDER BY entrenamientos.fecha',
    antesDe,
  )
  const porPeriodo = new Map<string, number>()
  for (const { fecha, volumen } of dias) {
    const desde = unidad === 'week' ? lunesDe(fecha) : primeroDelMes(fecha)
    porPeriodo.set(desde, (porPeriodo.get(desde) ?? 0) + volumen)
  }
  let mejor: [string, number] | null = null
  for (const [desde, volumen] of porPeriodo) {
    if (volumen > 0 && (mejor === null || desde > mejor[0])) mejor = [desde, volumen]
  }
  return mejor
}

/**
 * `(volumen − anterior) / anterior × 100` con un decimal, la mitad lejos del cero. En
 * enteros: las décimas son `(volumen − anterior) × 1000 / anterior`, redondeadas.
 */
export function cambioEnPorCiento(volumen: number, anterior: number): number {
  const numerador = (BigInt(volumen) - BigInt(anterior)) * 1000n
  const denominador = BigInt(anterior)
  const negativo = numerador < 0n !== denominador < 0n
  const n = numerador < 0n ? -numerador : numerador
  const d = denominador < 0n ? -denominador : denominador
  let decimas = n / d
  if ((n % d) * 2n >= d) decimas += 1n
  // Una bajada de menos de 0,05 % da 0 (un `BigInt` no tiene −0); el backend daría −0.0,
  // que en pantalla es lo mismo.
  return Number(negativo ? -decimas : decimas) / 10
}

interface FilaDelResumen {
  fecha: string
  rutina_id: number
  rutina_nombre: string
  rutina_oculto_desde: string | null
  grupo_id: number
  grupo_nombre: string
  volumen: number
  series: number
}

interface VolumenDeRutina {
  rutina: { id: number; nombre: string; oculto_desde: string | null }
  volumen: number
}

interface SeriesDeGrupo {
  grupo_muscular: { id: number; nombre: string }
  series: number
}

/** Lo que se va sumando de una barra mientras se recorren las filas. */
interface Barra {
  volumen: number
  rutinas: Map<number, VolumenDeRutina>
  grupos: Map<number, SeriesDeGrupo>
}

/** El `casefold()` de Python para ordenar: en minúsculas y comparando por puntos de código. */
function compararPlegados(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

function evolucion(
  ventana: Ventana,
  barras: Barra[],
  referenciaInicial: [string, number] | null,
): EvolucionDeVolumen {
  let ref = referenciaInicial
  const periodos: PeriodoDeVolumen[] = ventana.barras.map(([desde, hasta], i) => {
    const barra = barras[i]
    let cambio: number | null = null
    let comparadoCon: string | null = null
    if (barra.volumen > 0) {
      if (ref !== null) {
        cambio = cambioEnPorCiento(barra.volumen, ref[1])
        comparadoCon = ref[0]
      }
      ref = [desde, barra.volumen]
    }
    const rutinas = [...barra.rutinas.values()].sort(
      (a, b) =>
        b.volumen - a.volumen ||
        compararPlegados(a.rutina.nombre, b.rutina.nombre) ||
        a.rutina.id - b.rutina.id,
    )
    const grupos = [...barra.grupos.values()].sort(
      (a, b) =>
        b.series - a.series || compararPlegados(a.grupo_muscular.nombre, b.grupo_muscular.nombre),
    )
    return {
      desde,
      hasta,
      volumen: aTexto(barra.volumen),
      cambio,
      comparado_con: comparadoCon,
      volumen_por_rutina: rutinas.map((r) => ({ rutina: r.rutina, volumen: aTexto(r.volumen) })),
      series_por_grupo: grupos,
    }
  })
  const enCurso = ventana.enCurso ? (periodos.pop() ?? null) : null
  return { periodos, en_curso: enCurso }
}

function constancia(ctx: Contexto, anio: number): Resumen['constancia'] {
  const meses: MesDeConstancia[] = Array.from({ length: 12 }, (_, i) => ({
    mes: componer(anio, i + 1, 1),
    entrenados: 0,
    planificados: 0,
    por_llegar: 0,
  }))
  for (const dia of seguimiento(ctx, componer(anio, 1, 1), componer(anio, 12, 31))) {
    const mes = meses[partesSeguras(dia.fecha).mes - 1]
    if (dia.estado === 'hecho' || dia.estado === 'movido') {
      mes.entrenados += 1
      mes.planificados += 1
    } else if (dia.estado === 'sin_hacer') {
      mes.planificados += 1
    } else if (dia.estado === 'pendiente' || dia.estado === 'proximo') {
      mes.por_llegar += 1
    }
  }
  return {
    meses,
    entrenados: meses.reduce((suma, m) => suma + m.entrenados, 0),
    planificados: meses.reduce((suma, m) => suma + m.planificados, 0),
  }
}

/** Todo lo de la pantalla de resumen para el mes que empieza en `primero`. */
function calcular(ctx: Contexto, primero: string): Resumen {
  const vistas = ventanas(primero, ctx.reloj.hoy())
  const desde = vistas.map((v) => v.terminados[0][0]).reduce((a, b) => (a < b ? a : b))
  const hasta = vistas
    .map((v) => v.barras[v.barras.length - 1][1])
    .reduce((a, b) => (a > b ? a : b))

  // Una fila por sesión y grupo muscular. El grupo es el del ejercicio que se hizo en cada
  // serie, no el del principal del hueco: una alternativa de otro grupo trabaja el suyo.
  const filas = ctx.bd.todas<FilaDelResumen>(
    'SELECT entrenamientos.fecha, rutinas.id AS rutina_id, rutinas.nombre AS rutina_nombre,' +
      ' rutinas.oculto_desde AS rutina_oculto_desde,' +
      ' grupos_musculares.id AS grupo_id, grupos_musculares.nombre AS grupo_nombre,' +
      " COALESCE(SUM(CASE WHEN ejercicios.tipo_registro = 'peso_reps'" +
      ' THEN series.peso_centesimas * series.repeticiones END), 0) AS volumen,' +
      ' COUNT(series.id) AS series' +
      ' FROM entrenamientos' +
      ' JOIN series ON series.entrenamiento_id = entrenamientos.id' +
      ' JOIN rutinas ON rutinas.id = entrenamientos.rutina_id' +
      ' JOIN ejercicios ON ejercicios.id = series.ejercicio_id' +
      ' JOIN grupos_musculares ON grupos_musculares.id = ejercicios.grupo_muscular_id' +
      ' WHERE entrenamientos.fecha >= ? AND entrenamientos.fecha <= ?' +
      ' GROUP BY entrenamientos.fecha, rutinas.id, grupos_musculares.id' +
      ' ORDER BY entrenamientos.fecha, rutinas.id, grupos_musculares.id',
    desde,
    hasta,
  )

  const [porSemana, porMes] = vistas.map((vista) => {
    const barras: Barra[] = vista.barras.map(() => ({
      volumen: 0,
      rutinas: new Map(),
      grupos: new Map(),
    }))
    for (const fila of filas) {
      const indice = vista.indice(fila.fecha)
      if (indice === null) continue
      const barra = barras[indice]
      barra.volumen += fila.volumen
      // Una rutina sin ningún ejercicio de peso y repeticiones en el periodo no sale.
      if (fila.volumen > 0) {
        const r = barra.rutinas.get(fila.rutina_id) ?? {
          rutina: {
            id: fila.rutina_id,
            nombre: fila.rutina_nombre,
            oculto_desde: fila.rutina_oculto_desde,
          },
          volumen: 0,
        }
        r.volumen += fila.volumen
        barra.rutinas.set(fila.rutina_id, r)
      }
      const g = barra.grupos.get(fila.grupo_id) ?? {
        grupo_muscular: { id: fila.grupo_id, nombre: fila.grupo_nombre },
        series: 0,
      }
      g.series += fila.series
      barra.grupos.set(fila.grupo_id, g)
    }
    return evolucion(vista, barras, referencia(ctx, vista.unidad, vista.terminados[0][0]))
  })

  return {
    mes: primero,
    por_semana: porSemana,
    por_mes: porMes,
    constancia: constancia(ctx, partesSeguras(primero).anio),
  }
}

/**
 * El resumen del mes `mes` ('2026-09'; sin él, el de hoy). Un mes que aún no ha empezado da
 * 422: el resumen es de lo ya entrenado. El formato del mes lo valida la ruta.
 */
export function obtenerResumen(ctx: Contexto, mes: string | null): Resumen {
  const hoy = ctx.reloj.hoy()
  const primero = mes ? `${mes}-01` : primeroDelMes(hoy)
  if (primero > hoy) {
    throw noValido(
      `${nombreDelMes(primero)} todavía no ha llegado. El resumen es de lo ya entrenado.`,
    )
  }
  return calcular(ctx, primero)
}
