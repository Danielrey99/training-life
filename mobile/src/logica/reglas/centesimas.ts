/**
 * Los pesos exactos. La API los da y los recibe como en el backend (un número o un texto
 * con decimales, `Decimal` en Python), y la base los guarda en centésimas enteras.
 *
 * Nunca se pasa por una multiplicación de coma flotante: 22,505 × 100 da 2250,4999… y
 * redondearía mal. Se lee el texto del número cifra a cifra con `BigInt` y se redondea
 * como PostgreSQL al guardar en NUMERIC(n, 2): la mitad se aleja del cero (22,505 → 22,51,
 * −22,505 → −22,51).
 */

const NUMERO = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$|^([+-]?)\.(\d+)(?:[eE]([+-]?\d+))?$/

/** Un peso de la API (número o texto) en centésimas, redondeado; `null` si no es un número. */
export function aCentesimas(valor: number | string): number | null {
  const texto = typeof valor === 'number' ? numeroATexto(valor) : valor.trim()
  if (texto === null) return null
  const m = NUMERO.exec(texto)
  if (!m) return null
  const signo = (m[1] ?? m[5]) === '-' ? -1n : 1n
  const entera = m[2] ?? '0'
  const decimales = m[3] ?? m[6] ?? ''
  const exponente = Number(m[4] ?? m[7] ?? 0)
  // Todas las cifras como un entero, y la coma desplazada por el exponente.
  let cifras = BigInt(entera + decimales)
  let escala = decimales.length - exponente
  // Lo que se quiere es escala 2 (centésimas).
  if (escala < 2) {
    cifras *= 10n ** BigInt(2 - escala)
    escala = 2
  }
  const sobran = escala - 2
  let centesimas: bigint
  if (sobran === 0) {
    centesimas = cifras
  } else {
    const divisor = 10n ** BigInt(sobran)
    centesimas = cifras / divisor
    // La mitad, hacia arriba (en valor absoluto).
    if ((cifras % divisor) * 2n >= divisor) centesimas += 1n
  }
  const resultado = signo * centesimas
  if (resultado > BigInt(Number.MAX_SAFE_INTEGER) || resultado < -BigInt(Number.MAX_SAFE_INTEGER)) {
    return signo > 0 ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER
  }
  // Sin el -0: 0 en centésimas es 0.
  return Number(resultado) || 0
}

function numeroATexto(n: number): string | null {
  if (!Number.isFinite(n)) return null
  // `String(n)` da la representación más corta que vuelve al mismo número (0.1 → "0.1"),
  // que es la que leería Python de ese mismo JSON.
  return String(n)
}

/** Centésimas a texto con dos decimales, como serializa el backend un NUMERIC(n, 2): «80.00». */
export function aTexto(centesimas: number): string {
  const signo = centesimas < 0 ? '-' : ''
  const abs = Math.abs(centesimas)
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Compara un peso de la API con un tope sin pasar por coma flotante. */
export function comparar(a: number | string, b: number | string): number {
  const ca = valorExacto(a)
  const cb = valorExacto(b)
  if (ca === null || cb === null) throw new Error('No es un número')
  // Las dos a la misma escala, y se comparan los enteros.
  const izquierda = ca.cifras * 10n ** BigInt(cb.escala)
  const derecha = cb.cifras * 10n ** BigInt(ca.escala)
  return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0
}

/**
 * El valor exacto como texto canónico, para saber si dos pesos son el mismo número como lo
 * sabe `Decimal` en Python: «80», 80 y «80.00» dan lo mismo; 22,505 y 22,51, no. Las
 * centésimas guardadas se comparan pasándolas antes por `aTexto`.
 */
export function claveExacta(valor: number | string): string {
  const exacto = valorExacto(valor)
  if (exacto === null) throw new Error('No es un número')
  let { cifras, escala } = exacto
  while (escala > 0 && cifras % 10n === 0n) {
    cifras /= 10n
    escala -= 1
  }
  return `${cifras}e-${escala}`
}

/** El número exacto, sin redondear: cifras × 10^−escala. */
export function valorExacto(valor: number | string): { cifras: bigint; escala: number } | null {
  const texto = typeof valor === 'number' ? numeroATexto(valor) : valor.trim()
  if (texto === null) return null
  const m = NUMERO.exec(texto)
  if (!m) return null
  const signo = (m[1] ?? m[5]) === '-' ? -1n : 1n
  const decimales = m[3] ?? m[6] ?? ''
  const exponente = Number(m[4] ?? m[7] ?? 0)
  let cifras = signo * BigInt((m[2] ?? '0') + decimales)
  let escala = decimales.length - exponente
  if (escala < 0) {
    cifras *= 10n ** BigInt(-escala)
    escala = 0
  }
  return { cifras, escala }
}
