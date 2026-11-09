// El mismo preset que usa Expo por defecto; hace falta escrito para que lo vea Jest.
module.exports = function (api) {
  api.cache(true)
  return { presets: ['babel-preset-expo'] }
}
