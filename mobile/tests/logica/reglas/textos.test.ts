/**
 * Los textos como los trata Python (`reglas/textos.ts`). Propios del móvil: lo esperado
 * sale de `str.strip()`, `len()` y `str.split()` de Python.
 */
import {
  longitud,
  palabras,
  recortar,
  recortarComoPydantic,
} from '../../../src/logica/reglas/textos'

test('recortar_quita_los_separadores_que_quita_python', () => {
  // '\x1c a \x85'.strip() == 'a' en Python; `trim()` de JavaScript dejaría los dos.
  expect(recortar('\x1c a \x85')).toBe('a')
  expect(recortar('　\xa0a\t\n')).toBe('a')
  expect(recortar('   ')).toBe('')
})

test('recortar_no_quita_el_bom_como_python', () => {
  // '﻿a﻿'.strip() lo deja igual; `trim()` de JavaScript lo quitaría.
  expect(recortar('﻿a﻿')).toBe('﻿a﻿')
})

test('la_longitud_cuenta_un_emoji_como_uno', () => {
  expect(longitud('💪')).toBe(1)
  expect(longitud('a💪b')).toBe(3)
  expect(longitud('💪'.repeat(100))).toBe(100)
})

test('palabras_parte_como_split_de_python', () => {
  // 'a\x1cb  c\x85d　e﻿f'.split() == ['a', 'b', 'c', 'd', 'e﻿f']
  expect(palabras('a\x1cb  c\x85d　e﻿f')).toEqual(['a', 'b', 'c', 'd', 'e﻿f'])
  expect(palabras('')).toEqual([])
  expect(palabras(' \t ')).toEqual([])
  expect(palabras('  Press \t  banca\n ')).toEqual(['Press', 'banca'])
})

// Los espacios que quita `strip_whitespace` de Pydantic (`Nombre`, `TextoNota`), sacados de
// Pydantic probando todos los caracteres para los que `str.isspace()` da True, más el BOM,
// el U+180E y el U+200B.
const QUITA_PYDANTIC = [
  0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]
const DEJA_PYDANTIC = [0x1c, 0x1d, 0x1e, 0x1f, 0x180e, 0x200b, 0xfeff]

test.each(QUITA_PYDANTIC)('recortar_como_pydantic_quita_el_%s', (punto) => {
  const c = String.fromCodePoint(punto)
  expect(recortarComoPydantic(`${c}a${c}`)).toBe('a')
})

test.each(DEJA_PYDANTIC)('recortar_como_pydantic_deja_el_%s', (punto) => {
  const c = String.fromCodePoint(punto)
  expect(recortarComoPydantic(`${c}a${c}`)).toBe(`${c}a${c}`)
})

test('recortar_y_recortar_como_pydantic_solo_difieren_en_los_separadores', () => {
  // str.strip() quita -; strip_whitespace de Pydantic, no. En lo demás, igual.
  expect(recortar(' a ')).toBe('a')
  expect(recortarComoPydantic(' a ')).toBe(' a ')
  expect(recortarComoPydantic('  ')).toBe('')
  expect(recortar('　a ')).toBe('a')
  expect(recortarComoPydantic('　a ')).toBe('a')
  expect(recortarComoPydantic('   ')).toBe('')
})
