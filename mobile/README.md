# Móvil 📱

App móvil del proyecto, construida con **React Native** usando **Expo** (SDK 58, Expo Router y TypeScript).

> 🚧 Empezada. Por ahora es la base: el proyecto, la firma y el camino hasta un APK instalado en el teléfono, comprobado también al actualizar encima sin perder nada. Lo siguiente es la base de datos del teléfono y la lógica, con sus tests.

Es donde se va a usar la app de verdad, en el gimnasio: **solo Android**, repartida como APK, sin pasar por la tienda.

- **Cada teléfono, sus datos.** Sin servidor, sin conexión y sin cuentas: los datos se guardan en el propio móvil (SQLite), así que funciona sin cobertura y cada persona que la instala tiene los suyos.
- **La misma lógica que el backend, dentro de la app.** Qué toca cada día, recuperar y adelantar, el seguimiento del plan y el resumen se escriben en TypeScript, y los tests del backend sirven de especificación para no perder ningún caso.
- **El archivo de exportación hace de puente**: lo que se prepara en la [web](../web) (por ejemplo, las rutinas) se exporta y se importa en el móvil, y sirve también de copia de seguridad o para cambiar de teléfono.
- **Las mismas pantallas que la web**: la app se diseñó en móvil primero, y los [bocetos](../docs/bocetos-movil-training-life.png) son la referencia.
- **Los ejercicios predefinidos salen de [`shared/predefinidos.json`](../shared/predefinidos.json)**, la misma lista que usa el backend. Metro la ve gracias a `watchFolders` en `metro.config.js`.

## Construir el APK

Se construye en local, sin cuenta de Expo ni servicios en la nube.

**Lo que hace falta una vez**: Node 22, un JDK (17 o posterior) y el Android SDK con `platforms/android-37.0`, `build-tools/37.0.0`, `platform-tools` y `ndk/27.1.12297006`, con `ANDROID_HOME` apuntando a él.

**La firma.** Android solo deja actualizar una app si el APK nuevo está firmado con la misma clave que el instalado; si no, hay que desinstalarla y se pierden los datos del teléfono. La clave no está en el repositorio: Gradle lee su ruta y sus contraseñas de `~/.gradle/gradle.properties`:

```properties
TRAINING_LIFE_STORE_FILE=C:/ruta/a/training-life.jks
TRAINING_LIFE_KEY_ALIAS=training-life
TRAINING_LIFE_STORE_PASSWORD=...
TRAINING_LIFE_KEY_PASSWORD=...
```

El plugin [`plugins/firma.js`](plugins/firma.js) añade esa firma al `build.gradle` cada vez que Expo genera la carpeta `android/`, que no se sube a git.

**Cada versión**: subir `version` y `android.versionCode` en `app.json`, y después:

```bash
npm install
npx expo prebuild -p android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

El APK sale en `android/app/build/outputs/apk/release/app-release.apk`. Se pasa al teléfono (cable, Drive…) y se instala desde allí.

> **En Windows**, el `ninja` 1.10 que trae el CMake del SDK no admite rutas largas y la compilación de C++ falla con `mkdir(...): No such file or directory`. Se arregla sustituyendo `cmake/3.22.1/bin/ninja.exe` por una versión 1.12 o posterior (con las rutas largas activadas en Windows).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | Servidor de desarrollo de Expo |
| `npm run android` | Compila e instala en un teléfono conectado o en el emulador |
| `npm run tipos` | Comprueba los tipos con TypeScript |
| `npm run lint` | Lint de Expo |
