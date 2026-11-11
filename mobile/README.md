# Móvil 📱

App móvil del proyecto, construida con **React Native** usando **Expo** (SDK 58, Expo Router y TypeScript).

> 🚧 En construcción. Hecho: el APK firmado e instalado en el teléfono, la base de datos del teléfono, toda la lógica del backend en TypeScript (salvo el resumen) con sus tests portados, importar y exportar tus datos, las pantallas de entrenar (qué toca hoy y la sesión) el historial (el calendario, apuntar un día pasado y ver o corregir cada día) y las rutinas y programas, que ya se crean y se editan en el propio teléfono. Lo siguiente es la biblioteca de ejercicios.

Es donde se va a usar la app de verdad, en el gimnasio: **solo Android**, repartida como APK, sin pasar por la tienda.

- **Cada teléfono, sus datos.** Sin servidor, sin conexión y sin cuentas: los datos se guardan en el propio móvil (SQLite), así que funciona sin cobertura y cada persona que la instala tiene los suyos.
- **La misma lógica que el backend, dentro de la app.** Qué toca cada día, recuperar y adelantar, el seguimiento del plan y el resumen se escriben en TypeScript, y los tests del backend sirven de especificación para no perder ningún caso.
- **El archivo de exportación hace de puente**: lo que se apunta en la [web](../web) se exporta y se importa en el móvil, y sirve también de copia de seguridad o para cambiar de teléfono. En el móvil, exportar abre el menú de compartir de Android (Drive, correo, WhatsApp…), e importar, el selector de archivos; antes de sustituir nada, dice qué hay en el archivo y qué hay ahora.
- **Las mismas pantallas que la web**: la app se diseñó en móvil primero, y los [bocetos](../docs/bocetos-movil-training-life.png) son la referencia.
- **Los ejercicios predefinidos salen de [`shared/predefinidos.json`](../shared/predefinidos.json)**, la misma lista que usa el backend. Metro la ve gracias a `watchFolders` en `metro.config.js`.

## Cómo está organizada

```
mobile/
  src/
    app/            rutas de Expo Router: qué pantalla va en cada dirección y en qué pestaña
    pantallas/      las pantallas, puertos de las de la web con sus mismos textos
    componentes/    las piezas que comparten: botones, diálogos, hojas, campos con − y +…
    utiles/         copias de las de la web: fechas, números, medidas, colores, ajustes
    reglasDePantalla/  las cuentas de las pantallas sin React, para probarlas en Node
    logica/         la lógica del backend en TypeScript puro, sin React ni Expo
      bd/           la base: interfaz, esquema SQLite, migraciones y siembra
      reglas/       fechas, zonas, pesos, textos, nombres, medidas, ediciones, orden
      validacion/   lo que valida Pydantic en el backend, con sus mismos mensajes
      servicios/    un archivo por router del backend: ejercicios, rutinas, sesiones, plan…
      rutas.ts      las rutas de la API, dentro del teléfono
      api.ts        los mismos métodos que el cliente de la web
    plataforma/     lo único que toca el teléfono: SQLite de Expo, el reloj, el arranque
  tests/            Jest en Node
```

**La lógica no depende del teléfono.** `src/logica/` no importa nada de React, React Native, Expo ni Node (lo impide una regla de ESLint): recibe la base y el reloj desde fuera. Así la misma lógica corre en el teléfono con expo-sqlite y en los tests con el SQLite de Node.

**La API, sin servidor.** No hay backend en el teléfono, pero la lógica se llama igual que si lo hubiera: `rutas.ts` recibe un método, una URL y un cuerpo (`POST /entrenamientos`) y contesta con el mismo código y el mismo JSON que la API, incluidos los errores de validación. Cada llamada es una transacción, así que un *Guardar* que falla no deja nada a medias. `api.ts` tiene los mismos métodos que el cliente de la web, para que sus pantallas se porten sin tocar sus llamadas, y los tests mandan las mismas peticiones que los del backend: lo que se prueba es lo que usa la app.

**La base de datos copia la del backend** con las adaptaciones de SQLite: las 13 tablas con las mismas restricciones y los mismos nombres; tablas `STRICT`, para que un decimal no se cuele en una columna de enteros; los pesos en centésimas enteras (80,5 kg es 8050), para que no haya errores de coma flotante; y `updated_at` lo pone un disparador. Las versiones del esquema van en `PRAGMA user_version`, como las migraciones de Alembic, y los ejercicios predefinidos se ponen al día al arrancar si la lista de `shared/` cambió.

**Comprobado en el teléfono.** Los tests corren en Node, con otro SQLite y otro motor de JavaScript. Una pantalla oculta (se llega tocando la versión) repite en el teléfono, sobre una base en memoria, las comprobaciones que los tests dan por hechas: claves ajenas, borrados en cascada y prohibidos, restricciones, transacciones, zonas horarias y orden alfabético en español.

## Tests

```bash
npm test         # Jest
npm run tipos    # TypeScript, la app y los tests por separado
npm run lint     # ESLint
```

**Los tests del backend son la especificación.** Cada uno se porta con el mismo nombre, los mismos casos y los mismos textos de error, y un test de inventario lee los del backend y falla si alguno no está portado, ni apuntado como pendiente (con la etapa en que se portará) ni como que no aplica (con su motivo; por ejemplo, los que cuentan consultas a PostgreSQL). Además, el móvil tiene los suyos propios: el esquema, las migraciones, la siembra, las cuentas de fechas en los bordes del calendario y lo que calculan las pantallas (la mejora de cada ejercicio, los textos de las series, los números en kilos y en libras, los objetivos de cada ejercicio de una rutina y lo que avisa que se pierde al borrar).

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
| `npm test` | Tests con Jest |
| `npm run tipos` | Comprueba los tipos con TypeScript |
| `npm run lint` | ESLint |
