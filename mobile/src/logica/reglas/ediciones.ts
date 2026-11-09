/**
 * Las cuentas de *Guardar* en los modos de editar: qué cambia de lo guardado a lo pedido,
 * sin escribir nada. Copia de `backend/app/ediciones.py`.
 *
 * Guardar la semana de un programa, una rutina o un día del historial es una sola llamada
 * que se valida entera antes de escribir: o se guarda todo, o nada. Estas funciones deciden
 * qué cambia y si lo pedido cuadra; los servicios cargan, las llaman y escriben.
 */
import { fechaEnTexto } from './fechas'

/** Lo que se compara de una serie para saber si cambió. */
export const CAMPOS_DE_SERIE = [
  'ejercicio_id',
  'slot_id',
  'numero_serie',
  'peso',
  'repeticiones',
  'duracion_s',
  'distancia_m',
  'peso_corporal',
  'variante',
] as const

export type SerieComparable = { [K in (typeof CAMPOS_DE_SERIE)[number]]: unknown } & {
  id?: number | null
}

/**
 * Los días de la semana (1-7) cuya rutina cambia, con la nueva (null: descanso).
 *
 * `vigentes` y `pedidos` van de día a rutina y solo llevan los días con rutina: un día que
 * falta es descanso. Un día que llega igual no cambia, aunque su rutina esté oculta.
 */
export function diasQueCambian(
  vigentes: ReadonlyMap<number, number>,
  pedidos: ReadonlyMap<number, number>,
): [number, number | null][] {
  const cambian: [number, number | null][] = []
  for (let dia = 1; dia <= 7; dia++) {
    const pedido = pedidos.get(dia) ?? null
    if (pedido !== (vigentes.get(dia) ?? null)) cambian.push([dia, pedido])
  }
  return cambian
}

/**
 * El orden nuevo de cada hueco visible, de hueco a orden.
 *
 * Los visibles se reparten los `orden` que ya tenían, en el orden pedido, y los ocultos
 * conservan el suyo. `null` si `slotIds` no son exactamente los visibles, cada uno una vez;
 * vacío si el orden pedido es el de ahora.
 */
export function repartoDelOrden(
  visibles: ReadonlyMap<number, number>,
  slotIds: readonly number[],
): Map<number, number> | null {
  const pedidos = [...slotIds].sort((a, b) => a - b)
  const actuales = [...visibles.keys()].sort((a, b) => a - b)
  if (pedidos.length !== actuales.length || pedidos.some((id, i) => id !== actuales[i])) {
    return null
  }
  const ordenes = [...visibles.values()].sort((a, b) => a - b)
  const reparto = new Map(slotIds.map((id, i) => [id, ordenes[i]] as [number, number]))
  if ([...reparto].every(([id, orden]) => visibles.get(id) === orden)) return new Map()
  return reparto
}

/**
 * Qué hacer con las series de un día para dejarlo como `pedidas`, que es su estado final
 * completo: `[aBorrar, aCambiar, aCrear, ajenas]`. Una serie que llega igual no se toca.
 *
 * Los valores se comparan como los compara Python: los pesos ya llegan normalizados (en
 * centésimas) por quien llama.
 */
export function cambiosDeSeries<S extends SerieComparable>(
  guardadas: ReadonlyMap<number, SerieComparable>,
  pedidas: readonly S[],
): [number[], S[], S[], number[]] {
  const pedidosIds = new Set(
    pedidas.map((s) => s.id).filter((id): id is number => id !== null && id !== undefined),
  )
  const aBorrar = [...guardadas.keys()].filter((id) => !pedidosIds.has(id))
  const aCambiar: S[] = []
  const aCrear: S[] = []
  const ajenas: number[] = []
  for (const serie of pedidas) {
    const id = serie.id
    if (id === null || id === undefined) {
      aCrear.push(serie)
    } else if (!guardadas.has(id)) {
      ajenas.push(id)
    } else {
      const guardada = guardadas.get(id)!
      if (CAMPOS_DE_SERIE.some((campo) => (serie[campo] ?? null) !== (guardada[campo] ?? null))) {
        aCambiar.push(serie)
      }
    }
  }
  return [aBorrar, aCambiar, aCrear, ajenas]
}

/**
 * Si en alguno de los huecos `tocados` quedan series de dos ejercicios, los dos primeros
 * que se encuentran; si no, null. `finales` son los [hueco, ejercicio] de todas las series
 * como quedarían.
 */
export function mezclaEnHueco(
  finales: readonly [number, number][],
  tocados: ReadonlySet<number>,
): [number, number] | null {
  const primero = new Map<number, number>()
  for (const [hueco, ejercicio] of finales) {
    if (!tocados.has(hueco)) continue
    const visto = primero.get(hueco)
    if (visto === undefined) primero.set(hueco, ejercicio)
    else if (visto !== ejercicio) return [visto, ejercicio]
  }
  return null
}

/**
 * Por qué una sesión no puede moverse a `nueva`, con las palabras de la app. La sesión
 * cuenta como la de `contado`, que se entrena entre `lunes` y `ultimo` (su plazo).
 */
export function motivoDeLaFecha(
  rutina: string,
  contado: string,
  nueva: string,
  lunes: string,
  ultimo: string,
  hoy: string,
): string {
  const texto = (fecha: string) => fechaEnTexto(fecha, hoy)
  if (lunes <= nueva && nueva <= ultimo) {
    return (
      `Este ${rutina} cuenta como el del ${texto(contado)}, y el` +
      ` ${texto(nueva)} no seguías el mismo programa que ese día. Solo se puede` +
      ' mover a un día en que lo siguieras.'
    )
  }
  const [limite, hacia] = nueva > contado ? [ultimo, 'hasta'] : [lunes, 'desde']
  return (
    `Este ${rutina} cuenta como el del ${texto(contado)}, así que solo puede ir` +
    ` ${hacia} el ${texto(limite)}.`
  )
}
