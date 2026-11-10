/**
 * Reconoce los nombres de los tests de un archivo de Jest, para el inventario. Busca cada
 * `test(`, `it(`, `test.skip(`, `test.failing(`… y también `test.each(...)(` y
 * test.each`tabla`(`, saltando el argumento de `.each` contando paréntesis (sin mirar los
 * que van dentro de cadenas, plantillas ni comentarios), y lee la cadena que sigue.
 */

const INICIO = /\b(?:test|it)((?:\.[A-Za-z]+)*)/g
const NOMBRE = /['"`]([\p{Ll}\p{N}_]+)/uy

/** Posición justo después de la cadena o comentario que empieza en `i`, o `i` si no hay. */
function saltarCadenaOComentario(t: string, i: number): number {
  const c = t[i]
  if (c === '/' && t[i + 1] === '/') {
    const fin = t.indexOf('\n', i)
    return fin === -1 ? t.length : fin
  }
  if (c === '/' && t[i + 1] === '*') {
    const fin = t.indexOf('*/', i + 2)
    return fin === -1 ? t.length : fin + 2
  }
  if (c === "'" || c === '"' || c === '`') {
    let j = i + 1
    while (j < t.length && t[j] !== c) j += t[j] === '\\' ? 2 : 1
    return j + 1
  }
  return i
}

/** Dado el índice de un «(», el de lo que viene tras su «)» pareja. */
function saltarParentesis(t: string, i: number): number {
  let profundidad = 0
  let j = i
  while (j < t.length) {
    const despues = saltarCadenaOComentario(t, j)
    if (despues !== j) {
      j = despues
      continue
    }
    if (t[j] === '(') profundidad++
    else if (t[j] === ')' && --profundidad === 0) return j + 1
    j++
  }
  return t.length
}

function saltarBlancos(t: string, i: number): number {
  while (i < t.length && /\s/.test(t[i])) i++
  return i
}

/** Los nombres de test (la parte que es un identificador) que declara el texto. */
export function nombresDeTests(texto: string): string[] {
  const nombres: string[] = []
  for (const m of texto.matchAll(INICIO)) {
    let p = saltarBlancos(texto, m.index + m[0].length)
    if (m[1].split('.').includes('each')) {
      if (texto[p] === '(') p = saltarParentesis(texto, p)
      else if (texto[p] === '`') p = saltarCadenaOComentario(texto, p)
      else continue
      p = saltarBlancos(texto, p)
    }
    if (texto[p] !== '(') continue
    p = saltarBlancos(texto, p + 1)
    NOMBRE.lastIndex = p
    const nombre = NOMBRE.exec(texto)
    if (nombre) nombres.push(nombre[1])
  }
  return nombres
}
