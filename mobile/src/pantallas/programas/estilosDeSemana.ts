/**
 * Los estilos de los siete días (`semana.css` de la web), comunes a la semana de un programa
 * y a los días que se están escribiendo (al editarla y en el programa nuevo).
 */
import { StyleSheet } from 'react-native'

import { RADIO, type Colores } from '../../tema'

export function useEstilosDeSemana(c: Colores) {
  return StyleSheet.create({
    dias: {
      paddingHorizontal: 16,
      backgroundColor: c.superficie,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: RADIO,
    },
    dia: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8 },
    diaNombre: { width: 84, flexShrink: 0, fontSize: 14, color: c.textoTenue },
    diaRutina: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
    // Las filas de una sola línea de la semana cortan el nombre con «…» (regla de los textos
    // largos); lo de al lado no se encoge.
    nombre: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: c.texto },
    extra: { flexShrink: 0, fontSize: 13, color: c.textoTenue },
    descanso: { fontSize: 14, fontStyle: 'italic', color: c.textoTenue },
    vacia: { fontSize: 15, color: c.textoTenue },
    punto: { width: 8, height: 8, flexShrink: 0, borderRadius: 999, backgroundColor: c.borde },
    etiquetaChica: {
      flexShrink: 0,
      fontSize: 11,
      color: c.textoTenue,
      borderWidth: 1,
      borderColor: c.borde,
      borderRadius: 999,
      paddingVertical: 1,
      paddingHorizontal: 7,
    },
    // La ✕ y la › juntas, cada una con sus 44 px para el dedo; la última, pegada al borde.
    icono: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    iconoUltimo: { marginRight: -14, marginLeft: -8 },
  })
}
