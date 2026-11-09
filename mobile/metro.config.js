// Metro solo ve lo que hay dentro de mobile/. La lista de ejercicios predefinidos vive en
// shared/, junto a la web y el backend, así que se le añade esa carpeta.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../shared')]

module.exports = config
