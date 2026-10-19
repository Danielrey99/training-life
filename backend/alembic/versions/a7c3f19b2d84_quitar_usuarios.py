"""quitar usuarios

Revision ID: a7c3f19b2d84
Revises: c96823b23d81
Create Date: 2026-10-19 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3f19b2d84'
down_revision: Union[str, None] = 'c96823b23d81'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# El único usuario con el que la API ha podido escribir (USUARIO_SEMBRADO_ID). Escrito
# aquí a mano para que la migración no dependa del código de la app.
USUARIO_UNICO = 1

# Tablas donde usuario_id es obligatorio (en ejercicios es nulo para los predefinidos).
TABLAS_CON_USUARIO = (
    'notas_usuario_ejercicio',
    'rutinas',
    'entrenamientos',
    'programas',
    'programa_periodos',
    'excepciones_del_plan',
)


def upgrade() -> None:
    conexion = op.get_bind()
    # Sin usuarios, los datos de otro no tendrían dueño ni se sabría qué hacer con
    # ellos: se para y se dice cuántos hay, en vez de borrar sin avisar.
    ajenos = []
    for tabla in TABLAS_CON_USUARIO:
        cuantos = conexion.execute(
            sa.text(f'SELECT count(*) FROM {tabla} WHERE usuario_id <> :uno'),
            {'uno': USUARIO_UNICO},
        ).scalar()
        if cuantos:
            ajenos.append(f'{tabla} {cuantos}')
    cuantos = conexion.execute(
        sa.text('SELECT count(*) FROM ejercicios WHERE usuario_id <> :uno'),
        {'uno': USUARIO_UNICO},
    ).scalar()
    if cuantos:
        ajenos.append(f'ejercicios {cuantos}')
    if ajenos:
        raise RuntimeError(
            'Hay datos de otro usuario que no es el 1 (' + ', '.join(ajenos) + '). Sin usuarios'
            ' no se sabría de quién son. Si es la base de tests, bórrala (se vuelve a crear'
            ' sola); si no, bórralos o pásalos al usuario 1 y vuelve a migrar.'
        )
    # es_predefinido pasa a ser lo único que distingue un ejercicio predefinido de uno
    # propio, así que tiene que coincidir con lo que decía usuario_id.
    incoherentes = conexion.execute(
        sa.text('SELECT count(*) FROM ejercicios WHERE es_predefinido <> (usuario_id IS NULL)')
    ).scalar()
    if incoherentes:
        raise RuntimeError(
            f'Hay {incoherentes} ejercicios donde es_predefinido no coincide con usuario_id'
            ' nulo. Corrígelos y vuelve a migrar.'
        )

    # Lo que dependía de usuario_id, por su nombre.
    op.drop_constraint('entrenamientos_usuario_id_fecha_key', 'entrenamientos', type_='unique')
    op.drop_constraint(
        'entrenamientos_usuario_id_cubre_fecha_key', 'entrenamientos', type_='unique'
    )
    op.drop_constraint(
        'excepciones_del_plan_usuario_id_fecha_key', 'excepciones_del_plan', type_='unique'
    )
    op.drop_index(
        'ix_programa_periodos_usuario_abierto',
        table_name='programa_periodos',
        postgresql_where=sa.text('hasta IS NULL'),
    )
    for tabla in ('ejercicios', *TABLAS_CON_USUARIO):
        op.drop_constraint(f'{tabla}_usuario_id_fkey', tabla, type_='foreignkey')
        op.drop_column(tabla, 'usuario_id')
    op.drop_column('ejercicios', 'visibilidad')

    # Ahora, globales.
    op.create_unique_constraint('entrenamientos_fecha_key', 'entrenamientos', ['fecha'])
    op.create_unique_constraint(
        'entrenamientos_cubre_fecha_key', 'entrenamientos', ['cubre_fecha']
    )
    op.create_unique_constraint(
        'excepciones_del_plan_fecha_key', 'excepciones_del_plan', ['fecha']
    )
    # Una expresión constante entre los abiertos: como mucho uno. El autogenerate no
    # ve los índices sobre expresiones.
    op.create_index(
        'ix_programa_periodos_abierto',
        'programa_periodos',
        [sa.text('(hasta IS NULL)')],
        unique=True,
        postgresql_where=sa.text('hasta IS NULL'),
    )
    op.drop_table('usuarios')


def downgrade() -> None:
    # Todo era de una sola persona, así que todo vuelve al usuario 1.
    op.create_table(
        'usuarios',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=100), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email', name='usuarios_email_key'),
    )
    op.execute(
        "INSERT INTO usuarios (id, nombre, email, password_hash, created_at) "
        f"VALUES ({USUARIO_UNICO}, 'Daniel', 'usuario@example.com', "
        "'placeholder-sin-login-real', now())"
    )
    op.execute(f"SELECT setval('usuarios_id_seq', {USUARIO_UNICO})")

    op.drop_index(
        'ix_programa_periodos_abierto',
        table_name='programa_periodos',
        postgresql_where=sa.text('hasta IS NULL'),
    )
    op.drop_constraint('entrenamientos_fecha_key', 'entrenamientos', type_='unique')
    op.drop_constraint('entrenamientos_cubre_fecha_key', 'entrenamientos', type_='unique')
    op.drop_constraint('excepciones_del_plan_fecha_key', 'excepciones_del_plan', type_='unique')

    for tabla in TABLAS_CON_USUARIO:
        op.add_column(tabla, sa.Column('usuario_id', sa.Integer(), nullable=True))
        op.execute(f'UPDATE {tabla} SET usuario_id = {USUARIO_UNICO}')
        op.alter_column(tabla, 'usuario_id', nullable=False)
        op.create_foreign_key(f'{tabla}_usuario_id_fkey', tabla, 'usuarios', ['usuario_id'], ['id'])
    # En ejercicios, solo los propios tienen usuario; los predefinidos siguen sin él.
    op.add_column('ejercicios', sa.Column('usuario_id', sa.Integer(), nullable=True))
    op.execute(f'UPDATE ejercicios SET usuario_id = {USUARIO_UNICO} WHERE NOT es_predefinido')
    op.create_foreign_key(
        'ejercicios_usuario_id_fkey', 'ejercicios', 'usuarios', ['usuario_id'], ['id']
    )
    op.add_column(
        'ejercicios',
        sa.Column('visibilidad', sa.String(length=20), nullable=False, server_default='privado'),
    )
    op.alter_column('ejercicios', 'visibilidad', server_default=None)

    op.create_unique_constraint(
        'entrenamientos_usuario_id_fecha_key', 'entrenamientos', ['usuario_id', 'fecha']
    )
    op.create_unique_constraint(
        'entrenamientos_usuario_id_cubre_fecha_key',
        'entrenamientos',
        ['usuario_id', 'cubre_fecha'],
    )
    op.create_unique_constraint(
        'excepciones_del_plan_usuario_id_fecha_key',
        'excepciones_del_plan',
        ['usuario_id', 'fecha'],
    )
    op.create_index(
        'ix_programa_periodos_usuario_abierto',
        'programa_periodos',
        ['usuario_id'],
        unique=True,
        postgresql_where=sa.text('hasta IS NULL'),
    )
