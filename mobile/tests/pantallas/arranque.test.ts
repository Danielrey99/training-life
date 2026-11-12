/**
 * Los textos de la pantalla que sale cuando no se pueden abrir los datos al arrancar. Quien la
 * ve no sabe cómo funciona la app: tiene que entender qué ha pasado, que no debe desinstalarla
 * y qué hacer. Los textos son los decididos con el autor, palabra por palabra.
 */
import type { MotivoDelFallo } from '../../src/logica/bd/abrir'
import {
  ANTES_DEL_DETALLE,
  FALLO_AL_COMPARTIR,
  textosDelArranqueFallido,
} from '../../src/reglasDePantalla/arranque'

const COMPARTIR = 'Compartir el archivo de tus datos'
const REINTENTAR = 'Volver a intentarlo'
const COMUN =
  'No desinstales la app, porque al desinstalarla se borran tus datos. Pulsa Compartir el ' +
  'archivo de tus datos y mándalo, por ejemplo por WhatsApp o por correo, a quien te pasó la ' +
  'app para que lo revise.'

const MOTIVOS: MotivoDelFallo[] = ['al_poner_al_dia', 'otro', 'sin_copia', 'base_mas_nueva']

test.each([
  [
    'al_poner_al_dia' as const,
    {
      titulo: 'No se han podido abrir tus datos',
      parrafos: [
        'Esta versión de la app tenía que poner al día tus datos y no ha podido. Se han quedado ' +
          'como estaban, no se ha borrado nada.',
        COMUN,
      ],
      botones: [
        { accion: 'compartir', texto: COMPARTIR, variante: 'principal' },
        { accion: 'reintentar', texto: REINTENTAR, variante: 'secundaria' },
      ],
    },
  ],
  [
    'otro' as const,
    {
      titulo: 'No se han podido abrir tus datos',
      parrafos: ['La app no ha podido abrir tus datos. Siguen guardados en el teléfono.', COMUN],
      botones: [
        { accion: 'compartir', texto: COMPARTIR, variante: 'principal' },
        { accion: 'reintentar', texto: REINTENTAR, variante: 'secundaria' },
      ],
    },
  ],
  [
    'sin_copia' as const,
    {
      titulo: 'No se ha podido guardar una copia de tus datos',
      parrafos: [
        'Antes de poner al día tus datos, la app guarda una copia en el teléfono por si algo ' +
          'sale mal, y esta vez no ha podido. Puede que el teléfono no tenga espacio libre. No se ' +
          'ha cambiado nada.',
        'Libera espacio y pulsa Volver a intentarlo. Si sigue sin funcionar, pulsa Compartir el ' +
          'archivo de tus datos y mándalo a quien te pasó la app.',
      ],
      botones: [
        { accion: 'reintentar', texto: REINTENTAR, variante: 'principal' },
        { accion: 'compartir', texto: COMPARTIR, variante: 'secundaria' },
      ],
    },
  ],
  [
    'base_mas_nueva' as const,
    {
      titulo: 'Tus datos son de una versión más nueva de la app',
      parrafos: [
        'Esta versión de la app es más antigua que la que guardó tus datos y no sabe abrirlos. ' +
          'Instala la última versión para volver a verlos. No se ha borrado nada.',
        'No desinstales la app, porque al desinstalarla se borran tus datos.',
      ],
      botones: [{ accion: 'compartir', texto: COMPARTIR, variante: 'normal' }],
    },
  ],
])('los_textos_de_%s', (motivo, textos) => {
  expect(textosDelArranqueFallido(motivo)).toEqual(textos)
})

test('los_textos_del_pie_y_del_fallo_al_compartir', () => {
  expect(ANTES_DEL_DETALLE).toBe('Si te preguntan qué ha fallado, este es el aviso de la app.')
  expect(FALLO_AL_COMPARTIR).toBe('No se ha podido crear el archivo. Vuelve a intentarlo.')
})

test.each(MOTIVOS)('ningun_texto_lleva_dos_puntos_ni_punto_y_coma (%s)', (motivo) => {
  const { titulo, parrafos, botones } = textosDelArranqueFallido(motivo)
  const todos = [
    titulo,
    ...parrafos,
    ...botones.map((b) => b.texto),
    ANTES_DEL_DETALLE,
    FALLO_AL_COMPARTIR,
  ]

  expect(todos.filter((texto) => /[:;]/.test(texto))).toEqual([])
})

test.each(MOTIVOS)('como_mucho_un_boton_verde_y_siempre_se_puede_compartir (%s)', (motivo) => {
  const { botones } = textosDelArranqueFallido(motivo)

  expect(botones.filter((b) => b.variante === 'principal').length).toBeLessThanOrEqual(1)
  expect(botones.filter((b) => b.accion === 'compartir')).toHaveLength(1)
  // Sin botones repetidos.
  expect(new Set(botones.map((b) => b.accion)).size).toBe(botones.length)
})

test('con_una_base_mas_nueva_no_se_ofrece_volver_a_intentarlo', () => {
  // Volver a intentarlo no serviría de nada: solo instalar la última versión.
  const { botones, parrafos } = textosDelArranqueFallido('base_mas_nueva')

  expect(botones.map((b) => b.accion)).toEqual(['compartir'])
  expect(botones.some((b) => b.variante === 'principal')).toBe(false)
  expect(parrafos.join(' ')).not.toContain(REINTENTAR)
})

test.each(MOTIVOS)('se_avisa_de_no_desinstalar_salvo_sin_copia (%s)', (motivo) => {
  // Salvo sin copia, donde no se ha tocado nada y basta liberar espacio.
  const texto = textosDelArranqueFallido(motivo).parrafos.join(' ')
  if (motivo === 'sin_copia') expect(texto).toContain('No se ha cambiado nada.')
  else expect(texto).toContain('No desinstales la app')
})
