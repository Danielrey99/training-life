// Firma el APK de release con la clave propia del autor, sin cuenta de Expo.
//
// La carpeta android/ la genera `expo prebuild` y no va a git, así que la firma no se puede
// escribir a mano en su build.gradle: este plugin la añade cada vez que se genera. La ruta y
// las contraseñas no están en el repo: Gradle las lee de ~/.gradle/gradle.properties
// (TRAINING_LIFE_STORE_FILE, _KEY_ALIAS, _STORE_PASSWORD y _KEY_PASSWORD). Sin ellas, el
// release se queda con la firma de depuración y el build avisa.
//
// Perder esa clave obliga a desinstalar la app para instalar la siguiente versión, y
// desinstalar borra los datos del teléfono.
const { withAppBuildGradle } = require('expo/config-plugins')

const MARCA = '// firma: training-life'

const FIRMA = `
        release {
            ${MARCA}
            if (project.hasProperty('TRAINING_LIFE_STORE_FILE')) {
                storeFile file(TRAINING_LIFE_STORE_FILE)
                storePassword TRAINING_LIFE_STORE_PASSWORD
                keyAlias TRAINING_LIFE_KEY_ALIAS
                keyPassword TRAINING_LIFE_KEY_PASSWORD
            }
        }`

module.exports = function conFirma(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents
    if (gradle.includes(MARCA)) return config

    // Añade la configuración de firma junto a la de depuración que trae la plantilla.
    gradle = gradle.replace(/signingConfigs\s*\{/, (inicio) => inicio + FIRMA)
    // Y el tipo release deja de firmar con la clave de depuración.
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    )
    if (!gradle.includes(MARCA) || !gradle.includes('signingConfigs.release')) {
      throw new Error('plugins/firma.js: el build.gradle no tiene la forma esperada')
    }
    config.modResults.contents = gradle
    return config
  })
}
