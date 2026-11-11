/**
 * Tests del backend que aún no están portados al móvil, con el hito del plan en que se
 * portarán. Lo lee tests/inventario.test.ts, que falla si uno de aquí ya está portado: al
 * portar un test, se quita de esta lista. Al cerrar la app móvil tiene que quedar vacía.
 *
 * La clave es el nombre del test sin «test_» (el mismo que lleva al portarlo). Si el mismo
 * nombre está en dos archivos del backend, va con el archivo delante («resumen:…»).
 *
 * El hito es una estimación. En los archivos que se portan por partes, van a H2 o H3 los
 * que tocan avisos de borrado, borrado definitivo de rutinas, huecos o ejercicios,
 * duplicar, notas o «dónde se usa»; si al portar uno resulta que llega antes, se porta antes.
 */
export type Hito = 'H1.1' | 'H1.2' | 'H1.3' | 'H1.4' | 'H1.5' | 'H2' | 'H3' | 'H4' | 'H5'

export const pendientes: Record<string, Hito> = {
  // test_borrados.py
  // test_crud.py
  // test_cubre_fecha.py
  // test_datos.py
  // test_ejercicios.py
  // test_guardar_un_dia.py
  // test_historial.py
  // test_hoy.py
  // test_huecos.py
  // test_intercambiar.py
  // test_medidas.py
  // test_nombres_de_rutinas_y_programas.py
  // test_objetivos.py
  // test_plan.py
  // test_programas.py
  // test_replanificar.py
  // test_resumen.py
  // test_rutinas.py
  // test_seguimiento.py
  // test_sesiones.py
  // test_tramos_ocultos.py
}
