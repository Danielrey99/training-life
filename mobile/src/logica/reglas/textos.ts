/**
 * Los textos como los trata el backend (Python), que no es como los trata JavaScript.
 *
 * - `str.strip()` quita un conjunto de espacios distinto del de `String.trim()`: Python
 *   cuenta como espacio los separadores \x1c-\x1f y \x85, que JavaScript no; JavaScript
 *   cuenta el ﻿, que Python no.
 * - `len()` cuenta puntos de código, y `.length` cuenta unidades UTF-16: un emoji es 1 en
 *   Python y 2 en JavaScript. Los topes de longitud (100, 500, 1000) se miden como Python.
 */

// Los caracteres para los que `str.isspace()` da True.
const ESPACIOS = '\t\n\v\f\r \x1c\x1d\x1e\x1f\x85\xa0                　'

export function esEspacio(letra: string): boolean {
  return letra.length === 1 && ESPACIOS.includes(letra)
}

/** `texto.strip()` de Python. */
export function recortar(texto: string): string {
  let inicio = 0
  let fin = texto.length
  while (inicio < fin && esEspacio(texto[inicio])) inicio++
  while (fin > inicio && esEspacio(texto[fin - 1])) fin--
  return texto.slice(inicio, fin)
}

// Los espacios de Unicode (`char::is_whitespace` de Rust), que es lo que quita
// `strip_whitespace` de Pydantic: los de Python menos los separadores \x1c-\x1f.
const ESPACIOS_DE_PYDANTIC = ESPACIOS.replace(/[\x1c-\x1f]/g, '')

/**
 * Lo que recorta `StringConstraints(strip_whitespace=True)` de Pydantic (en `Nombre` y
 * `TextoNota`), que no es lo mismo que `str.strip()` (en `TextoOpcional`).
 */
export function recortarComoPydantic(texto: string): string {
  let inicio = 0
  let fin = texto.length
  while (inicio < fin && ESPACIOS_DE_PYDANTIC.includes(texto[inicio])) inicio++
  while (fin > inicio && ESPACIOS_DE_PYDANTIC.includes(texto[fin - 1])) fin--
  return texto.slice(inicio, fin)
}

/** `len(texto)` de Python: los puntos de código, no las unidades UTF-16. */
export function longitud(texto: string): number {
  return Array.from(texto).length
}

/** `texto.split()` de Python: las palabras, partiendo por cualquier tanda de espacios. */
export function palabras(texto: string): string[] {
  const lista: string[] = []
  let actual = ''
  for (const letra of texto) {
    if (esEspacio(letra)) {
      if (actual) lista.push(actual)
      actual = ''
    } else {
      actual += letra
    }
  }
  if (actual) lista.push(actual)
  return lista
}
