/**
 * Tests del backend que no se portan al móvil, con el motivo y, si lo hay, el test del
 * móvil que hace su papel. Lo lee tests/inventario.test.ts.
 *
 * La clave es el nombre del test sin «test_». Si el mismo nombre está en dos archivos del
 * backend, va con el archivo delante: «resumen:siempre_hace_las_mismas_consultas» es
 * test_siempre_hace_las_mismas_consultas de test_resumen.py.
 */
export const noAplica: Record<string, string> = {
  // test_borrados.py
  el_aviso_de_un_ejercicio_hace_las_mismas_consultas_con_poco_que_con_mucho:
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  // test_datos.py
  cada_texto_que_llega_por_la_api_o_en_un_archivo_cabe_en_su_columna:
    'Compara los esquemas de Pydantic con las columnas de SQLAlchemy. En el móvil no hay esquemas aparte: lo cubren ningun_texto_mas_largo_que_su_columna_llega_a_la_base (crud.test.ts) y los CHECK de longitud del esquema.',
  el_nombre_del_archivo_lleva_el_dia_de_madrid_y_no_el_de_utc:
    'Comprueba la cabecera HTTP content-disposition. En el móvil el nombre del archivo lo pone la pantalla de exportar (H1.3), que tendrá que usar el día del teléfono.',
  exportar_hace_las_mismas_consultas_con_poco_que_con_mucho:
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  un_archivo_que_no_es_json_da_el_mismo_422_en_espanol:
    'En el móvil no hay HTTP ni bytes que leer como JSON. La pantalla de importar (src/pantallas/TusDatos.tsx) hace JSON.parse del archivo elegido y, si falla, dice «Ese archivo no es una copia de los datos de Training Life.», igual que la web.',
  un_json_mal_formado_en_otro_endpoint_sigue_dando_el_422_de_fastapi:
    'Comprueba el 422 json_invalid de FastAPI en un endpoint que no es importar. En el móvil no hay cuerpos HTTP que analizar, las pantallas llaman a la lógica con objetos.',
  el_resumen_hace_las_mismas_consultas_sin_datos_con_poco_y_con_mucho:
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  borrar_hace_las_mismas_consultas_sin_datos_con_poco_y_con_mucho:
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  // test_ejercicios.py
  donde_se_usa_hace_las_mismas_consultas_con_un_uso_que_con_muchos:
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  // test_infraestructura.py
  la_api_responde:
    'Comprueba que el servidor HTTP responde en /health. En el móvil no hay servidor ni HTTP.',
  cada_test_arranca_sin_ejercicios_propios:
    'Comprueba el TRUNCATE entre tests. En el móvil cada test abre su propia base en memoria (tests/apoyo/baseNueva.ts), así que no puede quedar nada del anterior.',
  el_ejercicio_del_test_anterior_ya_no_esta:
    'Comprueba el TRUNCATE entre tests. En el móvil cada test abre su propia base en memoria (tests/apoyo/baseNueva.ts), así que no puede quedar nada del anterior.',
  la_base_de_tests_tiene_el_esquema_de_los_modelos:
    'Compara la base de Postgres con los modelos de SQLAlchemy. Lo sustituye esquema.test.ts (tablas, claves ajenas con su ON DELETE y restricciones frente a los modelos del backend).',
  la_cadena_de_migraciones_baja_hasta_el_principio_y_vuelve_a_subir_entera:
    'Recorre la cadena de Alembic hacia abajo y hacia arriba. El móvil solo sube, desde 0: lo sustituye migraciones.test.ts.',
  bajar_y_subir_los_renombrados_conserva_sus_ids_y_lo_que_los_usa:
    'Baja y sube la migración de Alembic que renombra predefinidos. En el móvil no hay bajadas y los predefinidos se sincronizan con shared/predefinidos.json. Lo sustituyen un_nombre_que_solo_cambia_en_mayusculas_o_tildes_se_actualiza_en_el_mismo y el_tipo_de_un_predefinido_sin_uso_cambia (siembra.test.ts).',
  no_se_baja_si_un_ejercicio_anadido_se_usa_y_no_cambia_nada:
    'Bajada de una migración de Alembic. En el móvil no hay bajadas, y un predefinido que desaparece de la lista se queda (un_predefinido_que_desaparece_de_la_lista_se_queda_como_estaba, siembra.test.ts).',
  un_propio_con_el_nombre_de_un_predefinido_no_impide_subir_y_los_dos_conviven:
    'Subida de una migración de siembra de Alembic. Lo sustituyen un_propio_que_se_llama_como_un_predefinido_nuevo_convive_y_no_se_toca y un_propio_que_se_llama_como_un_predefinido_que_cambia_no_se_toca (siembra.test.ts).',
  si_falta_un_predefinido_viejo_no_se_sube_ni_se_renombra_ningun_otro:
    'Subida a medias de una migración de siembra de Alembic. Lo sustituyen una_lista_con_un_grupo_que_no_esta_lanza_y_no_escribe_nada (siembra.test.ts) y si_un_paso_falla_a_mitad_la_base_queda_en_la_version_que_tenia (migraciones.test.ts).',
  // test_programas.py
  listar_programas_hace_las_mismas_consultas_con_uno_que_con_cinco:
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  // test_resumen.py
  'resumen:siempre_hace_las_mismas_consultas':
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  // test_rutinas.py
  listar_rutinas_hace_las_mismas_consultas_con_una_que_con_cinco:
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
  // test_seguimiento.py
  'seguimiento:siempre_hace_las_mismas_consultas':
    'Cuenta las consultas SQL (consultas_de) para cazar el N+1 de SQLAlchemy. En el móvil no hay ORM que cargue relaciones a escondidas y SQLite corre en el mismo proceso.',
}
