/**
 * Fechas en el formato en que viajan por la API (`"2026-09-14"`) y en el que se
 * leen en pantalla ("Lunes 14", "martes 8", "26 de agosto").
 *
 * Se trabaja con el texto ISO y no con `Date` en todo lo posible: una fecha sin
 * hora convertida a `Date` se interpreta en UTC, y de noche en España eso la
 * mueve al día anterior.
 */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/** Hoy, en ISO y en la hora del dispositivo. */
export function hoy(): string {
  return aIso(new Date())
}

// A mano y no con toISOString(), que pasa antes por UTC: entrenando de noche
// eso devolvería el día anterior.
function aIso(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

/** El texto ISO como fecha local a mediodía, lejos de cualquier cambio de hora. */
function aFecha(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return new Date(anio, mes - 1, dia, 12)
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000)
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * Para una cabecera: "Lunes 14" si es de este mes, "Jueves 10 de septiembre" si
 * no, y con el año si tampoco es de este año.
 */
export function fechaTitulo(iso: string): string {
  const fecha = aFecha(iso)
  const ahora = aFecha(hoy())
  let texto = `${mayuscula(DIAS[fecha.getDay()])} ${fecha.getDate()}`
  if (fecha.getMonth() !== ahora.getMonth() || fecha.getFullYear() !== ahora.getFullYear()) {
    texto += ` de ${MESES[fecha.getMonth()]}`
  }
  if (fecha.getFullYear() !== ahora.getFullYear()) texto += ` de ${fecha.getFullYear()}`
  return texto
}

/**
 * Para una referencia dentro de una frase ("Última vez · martes 8"): el día de la
 * semana si fue en los últimos seis días, que es como se piensa en una semana de
 * gimnasio; si no, el día y el mes ("26 de agosto").
 */
export function fechaCorta(iso: string): string {
  const fecha = aFecha(iso)
  const dias = diasEntre(iso, hoy())
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias > 0 && dias < 7) return `${DIAS[fecha.getDay()]} ${fecha.getDate()}`
  let texto = `${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
  if (fecha.getFullYear() !== aFecha(hoy()).getFullYear()) texto += ` de ${fecha.getFullYear()}`
  return texto
}

/** La fecha `dias` días después (o antes, si es negativo). */
export function sumarDias(iso: string, dias: number): string {
  const fecha = aFecha(iso)
  fecha.setDate(fecha.getDate() + dias)
  return aIso(fecha)
}

/** 1 = lunes … 7 = domingo, como `dia_semana` en la API. */
export function diaDeLaSemana(iso: string): number {
  return ((aFecha(iso).getDay() + 6) % 7) + 1
}

/** "lunes", "miércoles"… */
export function nombreDelDia(iso: string): string {
  return DIAS[aFecha(iso).getDay()]
}

/** Para la cabecera de Hoy: "Lunes 14 de septiembre", siempre con el mes. */
export function fechaLarga(iso: string): string {
  const fecha = aFecha(iso)
  return `${mayuscula(DIAS[fecha.getDay()])} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
}

/**
 * Dentro de una frase ("del miércoles 9", "hasta el domingo 20", "Leg · hoy"):
 * hoy, ayer o mañana si lo es; el día de la semana y el número si está a menos de
 * dos semanas (con el mes si es de otro y está a más de una semana); y si no, el día y el mes.
 */
export function fechaEnFrase(iso: string): string {
  const dias = diasEntre(hoy(), iso)
  if (dias === 0) return 'hoy'
  if (dias === -1) return 'ayer'
  if (dias === 1) return 'mañana'
  const fecha = aFecha(iso)
  const ahora = aFecha(hoy())
  if (Math.abs(dias) < 14) {
    let texto = `${DIAS[fecha.getDay()]} ${fecha.getDate()}`
    // A menos de una semana, el día de la semana ya dice cuál es: el mes sobra.
    if (Math.abs(dias) >= 7 && fecha.getMonth() !== ahora.getMonth()) {
      texto += ` de ${MESES[fecha.getMonth()]}`
    }
    return texto
  }
  let texto = `${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
  if (fecha.getFullYear() !== ahora.getFullYear()) texto += ` de ${fecha.getFullYear()}`
  return texto
}

/** "el miércoles 2", "el 26 de junio"; sin artículo para hoy, ayer y mañana. */
export function conArticulo(iso: string): string {
  const texto = fechaEnFrase(iso)
  return ['hoy', 'ayer', 'mañana'].includes(texto) ? texto : `el ${texto}`
}
