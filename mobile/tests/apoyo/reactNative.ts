/**
 * El mínimo de `react-native` que necesita `src/utiles/ajustes.ts` (importa `Appearance`) para
 * cargarse en Node. Se usa con
 * `jest.mock('react-native', () => jest.requireActual('../apoyo/reactNative').falso)`.
 */
export const falso = {
  Appearance: {
    getColorScheme: () => 'dark',
    addChangeListener: () => ({ remove: () => undefined }),
  },
}
