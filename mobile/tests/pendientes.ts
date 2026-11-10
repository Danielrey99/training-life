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
  un_archivo_que_no_es_json_da_el_mismo_422_en_espanol: 'H1.3',
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
  un_mes_mal_escrito_da_422: 'H4',
  un_mes_que_no_ha_llegado_da_422_con_su_mensaje: 'H4',
  el_primer_mes_admitido_no_se_sale_del_calendario: 'H4',
  sin_mes_es_el_de_hoy: 'H4',
  sin_datos_todo_sale_a_cero: 'H4',
  las_graficas_traen_periodos_terminados_y_el_en_curso: 'H4',
  septiembre_pedido_el_1_de_octubre_trae_la_semana_en_curso_y_no_el_mes: 'H4',
  la_constancia_es_del_año_del_mes_pedido: 'H4',
  el_volumen_es_la_suma_de_peso_por_repeticiones: 'H4',
  la_semana_que_cruza_de_mes_se_cuenta_entera: 'H4',
  lo_de_la_semana_y_el_mes_en_curso_sale_solo_en_la_barra_en_curso: 'H4',
  los_meses_de_la_grafica_cruzan_de_año: 'H4',
  el_mismo_volumen_que_el_periodo_anterior_es_un_cambio_de_cero: 'H4',
  el_cambio_redondea_las_medias_decimas_hacia_fuera: 'H4',
  el_cambio_mensual_usa_los_dos_ultimos_meses_terminados: 'H4',
  el_cambio_salta_las_barras_vacias: 'H4',
  la_primera_barra_se_compara_con_una_semana_de_hace_un_año: 'H4',
  la_referencia_anterior_suma_la_semana_entera: 'H4',
  la_referencia_anterior_respeta_los_limites_de_semana_y_de_mes: 'H4',
  una_barra_solo_con_series_sin_peso: 'H4',
  la_referencia_anterior_salta_los_periodos_solo_con_series_sin_peso: 'H4',
  una_sesion_de_rutina_y_ejercicio_ocultos_sirve_de_referencia: 'H4',
  el_cambio_de_la_barra_en_curso: 'H4',
  el_volumen_cuenta_lo_oculto_y_lo_sin_terminar: 'H4',
  el_volumen_va_por_la_fecha_real_y_la_constancia_por_el_dia_que_cuenta: 'H4',
  el_volumen_por_rutina_es_de_la_barra_y_de_mayor_a_menor: 'H4',
  las_series_van_al_grupo_del_ejercicio_que_se_hizo: 'H4',
  una_semana_solo_de_series_por_tiempo_tiene_volumen_cero_y_no_da_un_500: 'H4',
  el_peso_corporal_y_el_tiempo_no_suman_volumen_pero_sus_series_cuentan: 'H4',
  la_referencia_anterior_solo_mira_el_volumen_de_peso_y_repeticiones: 'H4',
  la_constancia_cuenta_cada_dia_en_el_mes_que_tocaba: 'H4',
  hoy_hecho_cuenta_como_entrenado: 'H4',
  los_dias_de_una_rutina_oculta_no_cuentan: 'H4',
  en_un_año_pasado_no_hay_nada_por_llegar: 'H4',
  // test_rutinas.py
  // test_seguimiento.py
  // test_sesiones.py
  // test_tramos_ocultos.py
  la_constancia_no_cuenta_los_dias_del_tramo: 'H4',
  la_constancia_cuenta_lo_entrenado_antes_de_ocultar: 'H4',
}
