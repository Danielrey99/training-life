// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    // android/ la genera `expo prebuild` y no va a git.
    ignores: ['dist/*', 'android/*'],
  },
  {
    // La lógica es TypeScript puro: corre en Node en los tests y algún día podría pasar a
    // shared/. Lo que toca el teléfono va en src/plataforma.
    files: ['src/logica/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'react/*', 'expo', 'expo-*', '@expo/*'],
              message: 'src/logica no importa React ni Expo.',
            },
            {
              group: ['**/plataforma/**', '**/pantallas/**', '**/componentes/**'],
              message: 'src/logica no depende de la app.',
            },
            { group: ['node:*'], message: 'src/logica no importa módulos de Node.' },
          ],
        },
      ],
    },
  },
])
