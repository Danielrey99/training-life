/**
 * El orden alfabético de las listas (ejercicios, rutinas, programas).
 *
 * El backend ordena en PostgreSQL con la intercalación de su imagen; el teléfono no la
 * tiene. Aquí se ordena en español con `Intl.Collator` («Ñandú» después de «Nube», sin
 * distinguir mayúsculas ni tildes al primer nivel) y, a igualdad, por id, para que el
 * orden no dependa de en qué orden lleguen las filas.
 */
const COLADOR = new Intl.Collator('es', { sensitivity: 'variant', numeric: false })

export function compararNombres(a: string, b: string): number {
  return COLADOR.compare(a, b)
}

/** Ordena por nombre y, a igualdad, por id. Devuelve una lista nueva. */
export function ordenarPorNombre<T extends { nombre: string; id: number }>(
  lista: readonly T[],
): T[] {
  return [...lista].sort((a, b) => compararNombres(a.nombre, b.nombre) || a.id - b.id)
}
