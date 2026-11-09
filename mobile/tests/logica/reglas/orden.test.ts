/**
 * El orden alfabético de las listas (`reglas/orden.ts`). Propio del móvil: el backend
 * ordena en PostgreSQL; aquí, en español con `Intl.Collator`.
 */
import { ordenarPorNombre } from '../../../src/logica/reglas/orden'

test('ordena_en_espanol_sin_distinguir_mayusculas_ni_tildes', () => {
  const lista = ['Zancadas', 'abdominales', 'Ñandú', 'árbol', 'Nube'].map((nombre, i) => ({
    nombre,
    id: i + 1,
  }))

  expect(ordenarPorNombre(lista).map((x) => x.nombre)).toEqual([
    'abdominales',
    'árbol',
    'Nube',
    'Ñandú',
    'Zancadas',
  ])
})

test('a_igual_nombre_ordena_por_id', () => {
  const lista = [
    { nombre: 'Remo', id: 9 },
    { nombre: 'Curl', id: 4 },
    { nombre: 'Remo', id: 2 },
    { nombre: 'Remo', id: 5 },
  ]

  expect(ordenarPorNombre(lista).map((x) => x.id)).toEqual([4, 2, 5, 9])
})

test('no_cambia_la_lista_que_recibe', () => {
  const lista = [
    { nombre: 'B', id: 1 },
    { nombre: 'A', id: 2 },
  ]

  ordenarPorNombre(lista)

  expect(lista.map((x) => x.id)).toEqual([1, 2])
})
