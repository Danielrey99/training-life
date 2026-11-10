// Copia de lo que usa el móvil de `web/src/paginas/programas/textos.ts`. Si cambia allí, se
// cambia aquí.

/** «a, b y c». */
export function enumerar(partes: string[]) {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}
