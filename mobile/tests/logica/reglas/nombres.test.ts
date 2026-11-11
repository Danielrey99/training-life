/**
 * La clave con la que se compara si un nombre ya existe. Puerto de los tests de
 * `clave_de_nombre` de `backend/tests/test_ejercicios.py`.
 */
import { claveDeNombre } from '../../../src/logica/reglas/nombres'

test.each([
  ['PRESS BANCA', 'press banca'],
  ['ÁÉÍÓÚ àèìòù âêîôû äëïöü ÄËÏÖÜ', 'aeiou aeiou aeiou aeiou aeiou'],
  ['  Press \t  banca\n inclinado  ', 'press banca inclinado'],
])('la_clave_de_un_nombre_ignora_mayusculas_tildes_y_espacios (%j)', (nombre, clave) => {
  expect(claveDeNombre(nombre)).toBe(clave)
})

test('la_clave_de_un_nombre_distingue_la_enie_y_la_cedilla', () => {
  // La ñ y la ç son letras, no una n o una c con tilde: «Año» y «Ano» son nombres distintos
  // (por eso la clave usa una tabla y no NFD, que las quitaría).
  expect(claveDeNombre('AÑO')).toBe('año')
  expect(claveDeNombre('Año')).toBe('año')
  expect(claveDeNombre('Año')).not.toBe(claveDeNombre('Ano'))
  expect(claveDeNombre('Ç')).toBe('ç')
  expect(claveDeNombre('Ç')).not.toBe(claveDeNombre('c'))
})

test('la_clave_parte_por_los_mismos_espacios_que_python', () => {
  // Propio del móvil: `str.split()` parte por \x1c y \x85, y no por el BOM (U+FEFF).
  expect(claveDeNombre('Press\x1cBanca\x85 Plano')).toBe('press banca plano')
  expect(claveDeNombre('Press\ufeffBanca')).toBe('press\ufeffbanca')
})
