// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    // android/ la genera `expo prebuild` y no va a git.
    ignores: ['dist/*', 'android/*'],
  },
])
