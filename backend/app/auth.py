"""Marcador de posición para autenticación.

Mientras no exista JWT (roadmap "nivel medio"), toda la API trabaja con un
único usuario — la fila sembrada por la migración `32c0db792aa1` (ver
CLAUDE.md, sección "Esquema de base de datos"). Los endpoints dependen de
`get_usuario_actual_id` en vez de usar el id directamente, para que al
implementar JWT solo haya que cambiar esta función (que pasará a extraer el
usuario real del token) sin tocar el resto del código.
"""

USUARIO_SEMBRADO_ID = 1


def get_usuario_actual_id() -> int:
    return USUARIO_SEMBRADO_ID
