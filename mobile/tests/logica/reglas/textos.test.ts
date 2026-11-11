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
  expect(recortar('\u3000\xa0a\t\n')).toBe('a')
  expect(recortar('   ')).toBe('')
})

test('recortar_no_quita_el_bom_como_python', () => {
  // '\ufeffa\ufeff'.strip() (el BOM) lo deja igual; `trim()` de JavaScript lo quitaría.
  expect(recortar('\ufeffa\ufeff')).toBe('\ufeffa\ufeff')
})

test('la_longitud_cuenta_un_emoji_como_uno', () => {
  expect(longitud('💪')).toBe(1)
  expect(longitud('a💪b')).toBe(3)
  expect(longitud('💪'.repeat(100))).toBe(100)
})

test('palabras_parte_como_split_de_python', () => {
  // 'a\x1cb  c\x85d\u3000e\u{feff}f'.split() == ['a', 'b', 'c', 'd', 'e\u{feff}f']
  expect(palabras('a\x1cb  c\x85d\u3000e\u{feff}f')).toEqual(['a', 'b', 'c', 'd', 'e\u{feff}f'])
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

/** Cada carácter rodeando una «a», recortado: lo que da para cada uno. */
const conCadaUno = (puntos: number[]) =>
  puntos.map((punto) => {
    const c = String.fromCodePoint(punto)
    return {
      punto: `U+${punto.toString(16).padStart(4, '0')}`,
      c,
      recortado: recortarComoPydantic(`${c}a${c}`),
    }
  })

// Un test por lista y no uno por carácter: si falla, la lista dice cuáles.
test('recortar_como_pydantic_quita_todos_los_espacios_que_quita_pydantic', () => {
  const noQuitados = conCadaUno(QUITA_PYDANTIC).filter((x) => x.recortado !== 'a')

  expect(noQuitados.map((x) => x.punto)).toEqual([])
})

test('recortar_como_pydantic_deja_los_que_pydantic_no_quita', () => {
  const quitados = conCadaUno(DEJA_PYDANTIC).filter((x) => x.recortado !== `${x.c}a${x.c}`)

  expect(quitados.map((x) => x.punto)).toEqual([])
})

test('recortar_y_recortar_como_pydantic_solo_difieren_en_los_separadores', () => {
  // str.strip() quita \x1c-\x1f; strip_whitespace de Pydantic, no. En lo demás, igual.
  expect(recortar('\x1c a \x1f')).toBe('a')
  expect(recortarComoPydantic('\x1c a \x1f')).toBe('\x1c a \x1f')
  expect(recortarComoPydantic(' \x1c ')).toBe('\x1c')
  expect(recortar('\x85\u3000a\u2028')).toBe('a')
  expect(recortarComoPydantic('\x85\u3000a\u2028')).toBe('a')
  expect(recortarComoPydantic('   ')).toBe('')
})
