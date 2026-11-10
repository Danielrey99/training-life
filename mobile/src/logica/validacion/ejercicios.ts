/**
 * Los cuerpos de los ejercicios y sus notas: `EjercicioCreate`, `EjercicioUpdate` y
 * `NotaCreate`/`NotaUpdate` de `backend/app/schemas.py`. Los campos se leen en el orden
 * en que los declara Pydantic, que es el orden de sus errores.
 */
import { TIPOS, type TipoRegistro } from '../reglas/medidas'
import { entero, literal, textoObligatorio, textoOpcional, type Loc, type Validador } from './base'

export interface DatosDeEjercicio {
  nombre: string
  grupo_muscular_id: number
  descripcion: string | null
}

export interface EjercicioNuevo extends DatosDeEjercicio {
  tipo_registro: TipoRegistro
}

function campos(v: Validador, d: Record<string, unknown>, loc: Loc): Partial<DatosDeEjercicio> {
  return {
    nombre: textoObligatorio(v, d, 'nombre', loc, 100) ?? undefined,
    grupo_muscular_id: entero(v, d, 'grupo_muscular_id', loc) ?? undefined,
    descripcion: textoOpcional(v, d, 'descripcion', loc, 500),
  }
}

/** `EjercicioCreate`: sin `tipo_registro`, de peso y repeticiones. */
export function ejercicioNuevo(v: Validador, d: Record<string, unknown>, loc: Loc): EjercicioNuevo {
  const base = campos(v, d, loc)
  const tipo = literal(v, d, 'tipo_registro', loc, TIPOS, { porDefecto: 'peso_reps' })
  return { ...base, tipo_registro: tipo } as EjercicioNuevo
}

/** `EjercicioUpdate`: el tipo no se cambia, y si llega se ignora. */
export function cambiosDeEjercicio(
  v: Validador,
  d: Record<string, unknown>,
  loc: Loc,
): DatosDeEjercicio {
  return campos(v, d, loc) as DatosDeEjercicio
}

/** `NotaCreate` y `NotaUpdate`: el texto de la nota. */
export function textoDeNota(v: Validador, d: Record<string, unknown>, loc: Loc): string {
  return textoObligatorio(v, d, 'nota', loc, 1000) as string
}
