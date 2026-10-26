# Móvil 📱

App móvil del proyecto, construida con **React Native** usando **Expo**.

> 🚧 Sin empezar. El [backend](../backend) y la [web](../web) ya están hechos para una sola persona por instalación, con los cuatro tipos de ejercicio (peso y repeticiones, peso corporal, tiempo y cardio), y el diseño y el código están repasados. Es lo siguiente.

Es donde se va a usar la app de verdad, en el gimnasio: **solo Android**, repartida como APK, sin pasar por la tienda.

- **Cada teléfono, sus datos.** Sin servidor, sin conexión y sin cuentas: los datos se guardan en el propio móvil (SQLite), así que funciona sin cobertura y cada persona que la instala tiene los suyos.
- **La misma lógica que el backend, dentro de la app.** Qué toca cada día, recuperar y adelantar, el seguimiento del plan y el resumen se escriben en TypeScript, y los tests del backend sirven de especificación para no perder ningún caso.
- **El archivo de exportación hace de puente**: lo que se prepara en la [web](../web) (por ejemplo, las rutinas) se exporta y se importa en el móvil, y sirve también de copia de seguridad o para cambiar de teléfono.
- **Las mismas pantallas que la web**: la app se diseñó en móvil primero, y los [bocetos](../docs/bocetos-movil-training-life.png) son la referencia.

Cómo se reparte el código por carpetas se decidirá al empezarla.
