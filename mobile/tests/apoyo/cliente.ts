/**
 * El cliente falso de los tests portados: hace con la URL y el cuerpo lo mismo que el
 * `TestClient` de FastAPI en `backend/tests/conftest.py`, pero llamando a `despachar`
 * (`src/logica/rutas.ts`), el mismo camino que usa la app.
 *
 * Es síncrono, como el cliente de Python: cada test se porta casi línea a línea. Un error
 * que no es de la app (un fallo de programación, un CHECK de SQLite que salta) no se
 * convierte en nada: sale como excepción y el test falla, que es lo que en el backend es un 500.
 */
import type { Bd } from '../../src/logica/bd/bd'
import type { Contexto, Reloj } from '../../src/logica/contexto'
import { despachar, type Metodo } from '../../src/logica/rutas'
import { hoyEn } from '../../src/logica/reglas/zonas'
import { baseNueva } from './baseNueva'

export const ZONA = 'Europe/Madrid'

// --- El reloj -----------------------------------------------------------------------------

/** Las 12:00 de ese día en Madrid, en milisegundos (10:00 UTC en verano, 11:00 en invierno). */
function mediodiaEnMadrid(iso: string): number {
  const [anio, mes, dia] = iso.split('-').map(Number)
  const tentativo = Date.UTC(anio, mes - 1, dia, 12)
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: 'numeric', hourCycle: 'h23' }).format(
      tentativo,
    ),
  )
  return tentativo - (hora - 12) * 3_600_000
}

/**
 * El reloj de un test. Sin fijar es el real (el día de hoy en Madrid); con `fijar(iso)` es
 * el `hoy_es` de `conftest.py`: «hoy» es ese día y «ahora», su mediodía en Madrid, a lo
 * largo de todo el test (se puede fijar otra vez para que pasen los días).
 *
 * `ahora()` nunca da dos veces el mismo instante: cada llamada lleva un milisegundo más que
 * la anterior. En el backend, PostgreSQL guarda microsegundos y dos filas seguidas casi
 * nunca empatan; con un reloj congelado empatarían todas, y un orden por `created_at`
 * dejaría de ser un orden.
 */
export class RelojDeTest implements Reloj {
  private dia: string | null = null
  private ultimo = -Infinity

  /** Congela «hoy» en ese día. */
  fijar(iso: string): void {
    if (this.dia !== iso) this.ultimo = -Infinity
    this.dia = iso
  }

  /** Vuelve al reloj real. */
  soltar(): void {
    this.dia = null
  }

  hoy(): string {
    return this.dia ?? hoyEn(ZONA)
  }

  ahora(): string {
    let ms = this.dia === null ? Date.now() : mediodiaEnMadrid(this.dia)
    if (ms <= this.ultimo) ms = this.ultimo + 1
    this.ultimo = ms
    return new Date(ms).toISOString()
  }
}

// El reloj del cliente creado más recientemente. Los ayudantes que escriben fechas en
// textos (`en_texto`) lo necesitan para saber si una lleva año, como `fecha_en_texto` del
// backend lo saca del reloj global: así tienen la misma firma que los de Python.
let relojActual: RelojDeTest | null = null

/** El «hoy» del cliente actual (el de `app.fechas.hoy()` en los tests del backend). */
export function hoy(): string {
  if (relojActual === null) throw new Error('Antes de usar hoy() hay que crear un cliente.')
  return relojActual.hoy()
}

// --- El cliente ---------------------------------------------------------------------------

export interface RespuestaDeTest {
  status_code: number
  /** El JSON de la respuesta; `null` en un 204. */
  json(): any
  /** El JSON como texto, para el mensaje de un `assert` que falla. */
  text: string
}

type Parametro = string | number | boolean | null | undefined

interface OpcionesDeConsulta {
  params?: Record<string, Parametro | Parametro[]>
}

interface OpcionesDeCuerpo extends OpcionesDeConsulta {
  json?: unknown
}

/** Los parámetros como los pone httpx: `true` es «true», `null` se omite, una lista repite la clave. */
function consulta(params: Record<string, Parametro | Parametro[]> = {}): string {
  const pares: string[] = []
  for (const [clave, valor] of Object.entries(params)) {
    for (const uno of Array.isArray(valor) ? valor : [valor]) {
      if (uno === null || uno === undefined) continue
      pares.push(`${encodeURIComponent(clave)}=${encodeURIComponent(String(uno))}`)
    }
  }
  return pares.join('&')
}

export class ClienteDeTest {
  constructor(private readonly ctx: Contexto) {}

  private llamar(metodo: Metodo, url: string, opciones: OpcionesDeCuerpo): RespuestaDeTest {
    const texto = consulta(opciones.params)
    const destino = texto === '' ? url : `${url}${url.includes('?') ? '&' : '?'}${texto}`
    // Por JSON, como viajaría: lo que no se puede serializar (un `undefined`) no llega.
    const cuerpo =
      opciones.json === undefined ? undefined : JSON.parse(JSON.stringify(opciones.json))
    const { estado, cuerpo: devuelto } = despachar(this.ctx, metodo, destino, cuerpo)
    return {
      status_code: estado,
      json: () => devuelto,
      text: JSON.stringify(devuelto),
    }
  }

  get(url: string, opciones: OpcionesDeConsulta = {}): RespuestaDeTest {
    return this.llamar('GET', url, opciones)
  }

  post(url: string, opciones: OpcionesDeCuerpo = {}): RespuestaDeTest {
    return this.llamar('POST', url, opciones)
  }

  put(url: string, opciones: OpcionesDeCuerpo = {}): RespuestaDeTest {
    return this.llamar('PUT', url, opciones)
  }

  delete(url: string, opciones: OpcionesDeConsulta = {}): RespuestaDeTest {
    return this.llamar('DELETE', url, opciones)
  }
}

export interface Entorno {
  cliente: ClienteDeTest
  reloj: RelojDeTest
  bd: Bd
}

/** Una instalación nueva: base con migraciones y siembra, un reloj sin fijar y su cliente. */
export function crearCliente(): Entorno {
  const bd = baseNueva()
  const reloj = new RelojDeTest()
  relojActual = reloj
  const cliente = new ClienteDeTest({ bd, reloj, zona: () => ZONA })
  return { cliente, reloj, bd }
}
