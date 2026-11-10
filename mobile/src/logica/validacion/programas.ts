/**
 * Los cuerpos de los programas: `ProgramaCreate`, `ProgramaUpdate` y `ActivarPrograma` de
 * `backend/app/schemas.py`, con los campos en el orden de Pydantic.
 */
import {
  booleano,
  entero,
  lista,
  submodelo,
  textoObligatorio,
  type Loc,
  type Validador,
} from './base'

export interface DiaPedido {
  dia_semana: number
  rutina_id: number
}

export interface ProgramaNuevo {
  nombre: string
  dias: DiaPedido[]
  activar: boolean
  quitar_excepciones: boolean
}

export interface CambiosDePrograma {
  nombre: string
  dias: DiaPedido[] | null
}

function dia(v: Validador, valor: unknown, loc: Loc): DiaPedido | undefined {
  const d = submodelo(v, valor, loc, 'ProgramaDiaCreate')
  if (d === null) return undefined
  return {
    dia_semana: entero(v, d, 'dia_semana', loc, { ge: 1, le: 7 }) as number,
    rutina_id: entero(v, d, 'rutina_id', loc) as number,
  }
}

function dias(
  v: Validador,
  d: Record<string, unknown>,
  loc: Loc,
  nula: boolean,
): DiaPedido[] | null {
  const crudos = lista(
    v,
    d,
    'dias',
    loc,
    undefined,
    nula ? { porDefecto: null, nulo: true } : { porDefecto: [] },
  )
  if (!crudos) return null
  return crudos.map((x, i) => dia(v, x, [...loc, 'dias', i])) as DiaPedido[]
}

/** `_validar_dias_sin_repetir`: un día no puede tener dos rutinas. */
function validarDiasSinRepetir(v: Validador, lista: DiaPedido[], loc: Loc): boolean {
  const numeros = lista.map((x) => x.dia_semana)
  if (new Set(numeros).size !== numeros.length) {
    v.errorDeValor(loc, 'Hay días repetidos, y un día no puede tener dos rutinas.')
    return false
  }
  return true
}

/** `ProgramaCreate`. */
export function programaNuevo(v: Validador, d: Record<string, unknown>, loc: Loc): ProgramaNuevo {
  const antes = v.errores.length
  const nombre = textoObligatorio(v, d, 'nombre', loc, 100) as string
  const losDias = dias(v, d, loc, false) ?? []
  const activar = booleano(v, d, 'activar', loc, { porDefecto: false }) as boolean
  const quitar = booleano(v, d, 'quitar_excepciones', loc, { porDefecto: false }) as boolean
  if (v.errores.length === antes && validarDiasSinRepetir(v, losDias, loc) && quitar && !activar) {
    v.errorDeValor(loc, 'Solo se quitan los días cambiados a mano al activar el programa.')
  }
  return { nombre, dias: losDias, activar, quitar_excepciones: quitar }
}

/** `ProgramaUpdate`: sin `dias`, los días no se tocan. */
export function cambiosDePrograma(
  v: Validador,
  d: Record<string, unknown>,
  loc: Loc,
): CambiosDePrograma {
  const antes = v.errores.length
  const nombre = textoObligatorio(v, d, 'nombre', loc, 100) as string
  const losDias = dias(v, d, loc, true)
  if (v.errores.length === antes && losDias !== null) validarDiasSinRepetir(v, losDias, loc)
  return { nombre, dias: losDias }
}

/** `ActivarPrograma`: si quita los días cambiados a mano de hoy en adelante. */
export function activarPrograma(v: Validador, d: Record<string, unknown>, loc: Loc): boolean {
  return booleano(v, d, 'quitar_excepciones', loc, { porDefecto: false }) as boolean
}
