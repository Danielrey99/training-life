"""descripciones y un nombre de los predefinidos

Revision ID: f1f0031b966e
Revises: 0a3bcd928c7e
Create Date: 2026-10-30 03:05:26.166686

Pone a cada uno de los 146 predefinidos una descripción que explica cómo se hace: cómo te
colocas, el movimiento y un punto clave de técnica. La lista viva está en
shared/predefinidos.json. Pisa siempre lo que haya, no solo donde está vacía: nadie puede
editar un predefinido, así que lo que tengan solo pudo ponerlo una migración.

Cambia además el nombre de «Sentadilla con peso corporal» a «Sentadilla». Se conserva su id,
así que sus series, huecos y notas siguen en su sitio; pero un archivo exportado antes con el
nombre viejo ya no se puede importar, porque los predefinidos viajan por su nombre.

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1f0031b966e"
down_revision: Union[str, None] = "0a3bcd928c7e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tabla ligera declarada aquí y no importada de app.models: los modelos cambian con el tiempo
# y romperían esta migración antigua.
ejercicios = sa.table(
    "ejercicios",
    sa.column("id"),
    sa.column("nombre"),
    sa.column("es_predefinido"),
    sa.column("descripcion"),
    sa.column("updated_at"),
)

# (nombre viejo, nombre nuevo).
RENOMBRES = [("Sentadilla con peso corporal", "Sentadilla")]
VIEJOS = [viejo for viejo, _ in RENOMBRES]
DESTINOS = [nuevo for _, nuevo in RENOMBRES]

# Congelada aquí y no leída de shared/predefinidos.json: la lista puede cambiar después y esta
# migración tiene que poner siempre lo mismo. Va por el nombre nuevo de los renombrados.
DESCRIPCIONES = {
    "Aperturas con mancuernas": (
        "Túmbate en un banco plano con una mancuerna en cada mano, los brazos extendidos "
        "sobre el pecho, las palmas mirándose y los codos un poco flexionados. Abre los "
        "brazos hacia los lados hasta que las mancuernas lleguen a la altura del pecho y "
        "vuelve a juntarlas, sin cambiar el ángulo de los codos."
    ),
    "Contractor de pecho": (
        "Siéntate con la espalda pegada al respaldo y los agarres a la altura del pecho. "
        "Junta los brazos delante apretando el pecho, con los codos un poco flexionados y "
        "fijos, y vuelve despacio hasta notar el estiramiento sin que los hombros se vayan "
        "hacia delante."
    ),
    "Cruce de poleas": (
        "De pie entre dos poleas altas, con un pie adelantado y el tronco algo inclinado. "
        "Lleva los agarres hacia abajo y hacia el centro en arco hasta juntarlos delante de "
        "la cadera, con los codos un poco flexionados, y vuelve controlando el peso."
    ),
    "Flexiones": (
        "Apoya las manos algo más abiertas que los hombros y mantén el cuerpo recto de la "
        "cabeza a los talones. Baja hasta casi tocar el suelo con el pecho, con los codos a "
        "unos 45 grados del cuerpo, y empuja sin dejar que la cadera se hunda."
    ),
    "Press banca con barra": (
        "Túmbate con los ojos bajo la barra, los pies firmes en el suelo y los omóplatos "
        "juntos, y agárrala algo más abierta que los hombros. Bájala controlada hasta rozar "
        "la parte baja del pecho y empújala hasta estirar los brazos sin despegar la espalda "
        "alta del banco."
    ),
    "Press banca con mancuernas": (
        "Túmbate en un banco plano con las mancuernas a los lados del pecho, los pies firmes "
        "en el suelo y los omóplatos juntos. Empújalas hacia arriba hasta casi tocarse y "
        "bájalas despacio hasta notar el estiramiento del pecho."
    ),
    "Press banca en máquina": (
        "Ajusta el asiento para que los agarres queden a la altura de la mitad del pecho. Con "
        "la espalda pegada al respaldo y los omóplatos juntos, empuja hasta casi estirar los "
        "brazos y vuelve despacio hasta notar el estiramiento del pecho."
    ),
    "Press banca en multipower": (
        "Coloca un banco plano centrado bajo la barra guiada, de forma que baje a la parte "
        "baja del pecho. Desengancha la barra girando las muñecas, bájala controlada y "
        "empújala hasta estirar los brazos."
    ),
    "Press declinado con barra": (
        "Túmbate en el banco declinado con las piernas bien sujetas y los omóplatos juntos, y "
        "agarra la barra algo más abierta que los hombros. Bájala controlada hasta la parte "
        "baja del pecho y empújala hasta estirar los brazos sin despegar la espalda del "
        "banco."
    ),
    "Press declinado con mancuernas": (
        "Túmbate en el banco declinado con las piernas sujetas y las mancuernas a los lados "
        "de la parte baja del pecho. Empújalas hacia arriba hasta casi juntarlas y bájalas "
        "despacio."
    ),
    "Press inclinado con barra": (
        "En un banco inclinado a unos 30-45 grados, con los pies firmes y los omóplatos "
        "juntos. Baja la barra hasta la parte alta del pecho, justo bajo las clavículas, y "
        "empújala hasta estirar los brazos sin despegar la espalda del respaldo."
    ),
    "Press inclinado con mancuernas": (
        "En un banco inclinado a unos 30-45 grados, con las mancuernas a la altura de la "
        "parte alta del pecho. Empújalas hacia arriba hasta casi juntarlas y bájalas despacio "
        "hasta notar el estiramiento, sin despegar los omóplatos del respaldo."
    ),
    "Press inclinado en máquina": (
        "Ajusta el asiento para que los agarres queden a la altura de la parte alta del "
        "pecho. Con la espalda pegada al respaldo, empuja hacia arriba y adelante hasta casi "
        "estirar los brazos y vuelve despacio, sin que los hombros se adelanten."
    ),
    "Press inclinado en multipower": (
        "Coloca un banco inclinado a unos 30-45 grados bajo la barra guiada, de forma que "
        "baje a la parte alta del pecho. Desengancha la barra, bájala controlada y empújala "
        "hasta casi estirar los brazos, sin despegar la espalda del respaldo."
    ),
    "Dominadas": (
        "Cuélgate de la barra con las palmas hacia delante, algo más abiertas que los "
        "hombros. Tira llevando los codos hacia abajo hasta pasar la barbilla por encima de "
        "la barra y baja hasta estirar los brazos del todo, sin balancearte ni dar impulso "
        "con las piernas."
    ),
    "Dominadas supinas": (
        "Cuélgate de la barra con las palmas mirando hacia ti, a la anchura de los hombros. "
        "Sube hasta pasar la barbilla por encima de la barra, llevando los codos hacia las "
        "costillas, y baja controlando hasta estirar los brazos, sin balancearte."
    ),
    "Jalón en máquina": (
        "Siéntate con los muslos sujetos bajo el rodillo y agarra las asas. Tira hacia abajo "
        "llevando los codos hacia los costados, con el pecho alto, hasta que las manos queden "
        "a la altura de los hombros. Sube despacio hasta estirar los brazos."
    ),
    "Jalón en polea con agarre abierto": (
        "Siéntate con los muslos sujetos y agarra la barra larga más abierta que los hombros. "
        "Tira hasta la parte alta del pecho llevando los codos hacia abajo, con el tronco "
        "apenas inclinado hacia atrás, y sube controlando hasta estirar los brazos."
    ),
    "Jalón en polea con agarre cerrado": (
        "Siéntate con los muslos sujetos y agarra el asa o la barra con las manos más juntas "
        "que los hombros. Tira hasta la parte baja del pecho pegando los codos al cuerpo y "
        "sacando el pecho, y sube despacio hasta estirar los brazos."
    ),
    "Muscle-up": (
        "Cuélgate de la barra y tira con fuerza y de forma explosiva hasta llevarla a la "
        "altura del pecho. Gira las muñecas por encima de ella pasando el pecho sobre la "
        "barra y termina empujando hasta estirar los brazos. Baja controlando hasta volver a "
        "colgarte."
    ),
    "Peso muerto": (
        "De pie con los pies a la anchura de la cadera y la barra en el suelo, pegada a las "
        "espinillas. Agárrala por fuera de las piernas, baja la cadera y saca el pecho con la "
        "espalda recta. Levántala empujando el suelo con los pies y la barra pegada a las "
        "piernas, hasta quedar de pie, y bájala por el mismo camino."
    ),
    "Peso muerto con mancuernas": (
        "De pie, con una mancuerna en cada mano delante de los muslos. Echa la cadera atrás y "
        "dobla las rodillas, con la espalda recta y las mancuernas pegadas a las piernas, "
        "hasta que lleguen a la mitad de las espinillas. Sube empujando el suelo con los pies "
        "y aprieta los glúteos arriba."
    ),
    "Pullover con mancuerna": (
        "Túmbate en un banco plano con una mancuerna sujeta con las dos manos sobre el pecho. "
        "Llévala en arco por detrás de la cabeza con los codos un poco flexionados hasta "
        "notar el estiramiento y vuelve por el mismo camino."
    ),
    "Pullover en polea": (
        "De pie frente a una polea alta, con una barra o cuerda y el tronco algo inclinado. "
        "Con los brazos casi estirados, baja el agarre en arco hasta los muslos apretando la "
        "espalda y vuelve despacio sin doblar más los codos."
    ),
    "Remo con barra": (
        "Inclina el tronco hacia delante con la espalda recta y las rodillas un poco "
        "flexionadas, con la barra colgando a la altura de las rodillas. Tira hacia el "
        "ombligo llevando los codos atrás y junta los omóplatos arriba; baja controlando sin "
        "incorporarte."
    ),
    "Remo con mancuerna": (
        "Apoya una rodilla y la mano del mismo lado en un banco, con la espalda recta y la "
        "mancuerna en la otra mano. Tira de ella hacia la cadera llevando el codo atrás y "
        "pegado al cuerpo, y bájala hasta estirar el brazo sin girar el tronco."
    ),
    "Remo con mancuernas en banco inclinado": (
        "Túmbate boca abajo en un banco inclinado, con una mancuerna en cada mano y los "
        "brazos colgando. Tira llevando los codos hacia atrás hasta juntar los omóplatos y "
        "baja despacio hasta estirar los brazos, sin despegar el pecho del banco."
    ),
    "Remo en máquina": (
        "Siéntate con el pecho contra el apoyo y agarra las asas con los brazos estirados. "
        "Tira llevando los codos hacia atrás hasta juntar los omóplatos y vuelve despacio "
        "hasta estirar los brazos, sin separar el pecho del apoyo."
    ),
    "Remo en máquina unilateral": (
        "Siéntate con el pecho contra el apoyo y agarra un asa con un brazo estirado. Tira "
        "llevando el codo hacia atrás, pegado al cuerpo, hasta que la mano llegue al costado, "
        "y vuelve despacio hasta estirar el brazo, sin girar el tronco. Haz luego el otro "
        "brazo."
    ),
    "Remo en polea baja": (
        "Siéntate con los pies apoyados y las rodillas un poco flexionadas, y agarra el asa "
        "con los brazos estirados. Tira hacia el abdomen llevando los codos atrás y juntando "
        "los omóplatos, con la espalda recta, y vuelve despacio sin balancear el tronco."
    ),
    "Remo en polea baja unilateral": (
        "Sentado frente a la polea baja con un asa de una mano, tira hacia la cadera llevando "
        "el codo atrás y vuelve hasta estirar el brazo. Mantén el tronco quieto y de frente, "
        "sin girarlo para ayudarte."
    ),
    "Remo en T": (
        "Con la barra entre las piernas y el agarre en el extremo, inclina el tronco con la "
        "espalda recta y las rodillas flexionadas. Tira hacia el pecho llevando los codos "
        "atrás y baja despacio sin incorporarte ni redondear la espalda."
    ),
    "Remo invertido": (
        "Túmbate bajo una barra fija a la altura de la cadera y agárrala con los brazos "
        "estirados, el cuerpo recto y los talones en el suelo. Tira hasta llevar el pecho a "
        "la barra juntando los omóplatos y baja despacio, sin que la cadera se hunda."
    ),
    "Contractor inverso": (
        "Siéntate mirando al respaldo de la máquina, con el pecho apoyado y los agarres "
        "delante a la altura de los hombros. Abre los brazos hacia atrás con los codos un "
        "poco flexionados hasta quedar en cruz y vuelve despacio."
    ),
    "Elevaciones frontales con mancuernas": (
        "De pie, con una mancuerna en cada mano delante de los muslos. Sube los brazos hacia "
        "delante, casi estirados, hasta la altura de los hombros y bájalos despacio, sin "
        "balancear el tronco."
    ),
    "Elevaciones frontales en polea": (
        "De espaldas a una polea baja, con el cable entre las piernas y el agarre delante de "
        "los muslos. Sube el brazo o la barra hacia delante, casi estirado, hasta la altura "
        "de los hombros y baja despacio, sin balancear el tronco."
    ),
    "Elevaciones laterales con mancuernas": (
        "De pie, con una mancuerna en cada mano a los lados y los codos un poco flexionados. "
        "Sube los brazos hacia los lados hasta la altura de los hombros, guiando con los "
        "codos, y bájalos despacio, sin encoger los hombros ni balancearte."
    ),
    "Elevaciones laterales en máquina": (
        "Colócate en la máquina, sentado o de pie según el modelo, con los brazos o las manos "
        "en los apoyos y los hombros alineados con el eje de giro. Sube los brazos hacia los "
        "lados hasta la altura de los hombros y bájalos despacio, sin encogerlos."
    ),
    "Elevaciones laterales en polea": (
        "De lado a una polea baja, agarra el asa con la mano más alejada. Sube el brazo hacia "
        "el lado hasta la altura del hombro, con el codo un poco flexionado, y baja despacio "
        "sin inclinar el tronco."
    ),
    "Face pull": (
        "Con una cuerda en la polea a la altura de la cara, tira hacia la frente separando "
        "las manos y llevando los codos altos y hacia atrás. Aguanta un momento con los "
        "omóplatos juntos y vuelve despacio hasta estirar los brazos."
    ),
    "Flexiones en pica": (
        "Apoya manos y pies en el suelo y sube la cadera hasta formar una V invertida. Dobla "
        "los codos bajando la cabeza hacia el suelo entre las manos y empuja hasta estirar "
        "los brazos, sin bajar la cadera."
    ),
    "Pájaros con mancuernas": (
        "Inclina el tronco hacia delante con la espalda recta y una mancuerna en cada mano "
        "colgando. Abre los brazos hacia los lados con los codos un poco flexionados hasta la "
        "altura de los hombros y baja despacio, sin incorporarte."
    ),
    "Pájaros en polea": (
        "Entre dos poleas a la altura de los hombros, cruza los cables y agarra cada uno con "
        "la mano contraria. Abre los brazos hacia atrás hasta quedar en cruz, con los codos "
        "un poco flexionados, y vuelve despacio sin mover el tronco."
    ),
    "Press Arnold": (
        "Sentado, empieza con las mancuernas delante de la cara y las palmas mirándote. "
        "Empújalas hacia arriba girando las muñecas para que acaben mirando hacia delante, y "
        "baja deshaciendo el giro hasta la posición de partida."
    ),
    "Press militar con barra": (
        "De pie, con la barra apoyada sobre la parte alta del pecho y las manos algo más "
        "abiertas que los hombros. Aprieta abdomen y glúteos y empuja la barra en línea recta "
        "sobre la cabeza, apartando la cara al subir, y bájala controlada sin arquear la "
        "espalda."
    ),
    "Press militar con mancuernas": (
        "Sentado con respaldo, o de pie, con las mancuernas a la altura de los hombros y los "
        "codos un poco por delante del cuerpo. Empújalas hacia arriba hasta casi juntarlas y "
        "baja despacio hasta la altura de las orejas, sin arquear la espalda."
    ),
    "Press militar en máquina": (
        "Ajusta el asiento para que los agarres queden a la altura de los hombros. Con la "
        "espalda pegada al respaldo, empuja hacia arriba hasta casi estirar los brazos y baja "
        "despacio hasta la altura de los hombros, sin arquear la espalda."
    ),
    "Remo al mentón": (
        "De pie, con una barra o mancuernas delante de los muslos y las manos a la anchura de "
        "los hombros. Tira hacia arriba llevando los codos por encima de las manos hasta la "
        "altura del pecho, no más alto, y baja despacio."
    ),
    "Curl con barra": (
        "De pie, con la barra agarrada por debajo a la anchura de los hombros y los codos "
        "pegados al cuerpo. Sube la barra doblando los codos sin moverlos hacia delante y "
        "bájala despacio hasta estirar los brazos, sin balancear el tronco."
    ),
    "Curl con mancuernas": (
        "De pie o sentado, con una mancuerna en cada mano y las palmas hacia delante. Sube "
        "doblando los codos, a la vez o un brazo cada vez, sin separarlos del cuerpo, y baja "
        "despacio hasta estirar el brazo del todo."
    ),
    "Curl concentrado": (
        "Sentado, apoya la parte de atrás del brazo en el interior del muslo con la mancuerna "
        "colgando. Sube la mancuerna hacia el hombro doblando el codo, sin mover el brazo, y "
        "baja despacio hasta estirarlo del todo."
    ),
    "Curl en máquina": (
        "Ajusta el asiento para que los codos queden apoyados y alineados con el eje de la "
        "máquina. Sube doblando los codos hasta arriba y baja despacio hasta casi estirar los "
        "brazos, sin despegar los brazos del apoyo."
    ),
    "Curl en polea": (
        "De pie frente a una polea baja, con una barra o cuerda y los codos pegados al "
        "cuerpo. Sube doblando los codos sin moverlos hacia delante y baja despacio hasta "
        "estirar los brazos."
    ),
    "Curl inclinado con mancuernas": (
        "Sentado en un banco inclinado hacia atrás, con una mancuerna en cada mano y los "
        "brazos colgando por detrás del cuerpo. Sube las mancuernas doblando los codos sin "
        "adelantarlos y baja hasta estirar los brazos del todo."
    ),
    "Curl martillo": (
        "De pie, con una mancuerna en cada mano y las palmas mirándose. Sube doblando los "
        "codos sin girar las muñecas y sin separar los codos del cuerpo, y baja despacio "
        "hasta estirar los brazos."
    ),
    "Curl predicador": (
        "Siéntate con la parte de atrás de los brazos apoyada en el banco inclinado y la "
        "barra o las mancuernas en las manos. Sube doblando los codos y baja despacio casi "
        "hasta estirarlos del todo, sin despegar los brazos del apoyo."
    ),
    "Extensión de tríceps en máquina": (
        "Siéntate con los codos apoyados y alineados con el eje de la máquina. Empuja "
        "estirando los brazos del todo y vuelve despacio hasta que los codos queden doblados, "
        "sin despegarlos del apoyo."
    ),
    "Extensión de tríceps en polea": (
        "De pie frente a una polea alta, con una barra o cuerda y los codos pegados a los "
        "costados. Estira los brazos hacia abajo hasta bloquear los codos y vuelve despacio "
        "hasta que los antebrazos queden paralelos al suelo, sin mover los codos de su sitio."
    ),
    "Extensión de tríceps sobre la cabeza": (
        "Con una mancuerna sujeta con las dos manos, o una cuerda en la polea, lleva los "
        "brazos por encima de la cabeza. Baja el peso por detrás de la cabeza doblando los "
        "codos, que apuntan hacia arriba, y estíralos de nuevo sin abrirlos."
    ),
    "Flexiones diamante": (
        "Apoya las manos juntas bajo el pecho, tocándose los pulgares y los índices, con el "
        "cuerpo recto de la cabeza a los talones. Baja con los codos pegados al cuerpo hasta "
        "casi tocar las manos con el pecho y empuja hasta estirar los brazos."
    ),
    "Fondos en banco": (
        "Sentado en el borde de un banco, apoya las manos a los lados de la cadera y adelanta "
        "los pies. Baja doblando los codos hacia atrás hasta que queden casi en ángulo recto "
        "y sube estirándolos, con la espalda cerca del banco."
    ),
    "Fondos en máquina": (
        "Siéntate con los agarres a los lados y la espalda contra el respaldo. Empuja hacia "
        "abajo hasta estirar los brazos y sube despacio hasta que los codos queden doblados, "
        "sin dejar que los hombros se vayan hacia delante."
    ),
    "Fondos en paralelas": (
        "Sujétate en las paralelas con los brazos estirados. Baja doblando los codos hasta "
        "que los hombros queden a la altura de los codos y sube hasta estirarlos, sin "
        "balancear las piernas."
    ),
    "Patada de tríceps": (
        "Con una mancuerna en una mano, apoya la otra mano y la rodilla del mismo lado en un "
        "banco, con la espalda recta. Pega el codo al costado con el brazo paralelo al suelo "
        "y estira el codo hacia atrás hasta tener el brazo recto; vuelve despacio moviendo "
        "solo el antebrazo."
    ),
    "Press banca con agarre cerrado": (
        "Túmbate en un banco plano con la barra agarrada a la anchura de los hombros, los "
        "pies firmes y los omóplatos juntos. Baja la barra hasta la parte baja del pecho con "
        "los codos pegados al cuerpo y empújala hasta estirar los brazos."
    ),
    "Press francés": (
        "Tumbado en un banco, con una barra Z o mancuernas sobre el pecho y los brazos "
        "estirados. Baja el peso hacia la frente doblando solo los codos, que apuntan al "
        "techo, y estíralos de nuevo sin abrirlos ni moverlos hacia atrás."
    ),
    "Colgarse de la barra": (
        "Cuélgate de una barra con los brazos estirados y las manos a la anchura de los "
        "hombros. Aguanta el tiempo que te marques con los hombros bajados, lejos de las "
        "orejas, y sin balancearte."
    ),
    "Curl de muñeca": (
        "Sentado, con una barra o una mancuerna en las manos, apoya los antebrazos en los "
        "muslos o en un banco con las palmas hacia arriba y las muñecas por fuera. Baja el "
        "peso doblando la muñeca y súbelo todo lo que puedas, moviendo solo la muñeca."
    ),
    "Curl inverso": (
        "De pie, con una barra agarrada por encima, las palmas hacia abajo. Sube doblando los "
        "codos sin separarlos del cuerpo ni girar las muñecas, y baja despacio hasta estirar "
        "los brazos."
    ),
    "Extensión de muñeca": (
        "Sentado, con una barra o una mancuerna en las manos, apoya los antebrazos en los "
        "muslos o en un banco con las palmas hacia abajo y las muñecas por fuera. Sube el "
        "dorso de la mano todo lo que puedas y baja despacio, moviendo solo la muñeca."
    ),
    "Paseo del granjero": (
        "Coge una mancuerna o pesa rusa en cada mano y camina con pasos cortos, el tronco "
        "erguido y los hombros atrás. Aguanta el tiempo que te marques sin dejar que el peso "
        "te incline hacia un lado."
    ),
    "Extensión de cuádriceps": (
        "Siéntate con la espalda pegada al respaldo y el rodillo sobre los tobillos, con las "
        "rodillas alineadas con el eje de la máquina. Estira las piernas del todo, aguanta un "
        "instante arriba y baja despacio."
    ),
    "Prensa de piernas": (
        "Siéntate con la espalda y la cadera pegadas al respaldo y los pies a la anchura de "
        "los hombros en la plataforma. Baja doblando las rodillas hasta que la cadera vaya a "
        "despegarse y empuja sin bloquear las rodillas del todo arriba."
    ),
    "Sentadilla": (
        "De pie y sin peso, con los pies algo más abiertos que la cadera y los brazos al "
        "frente. Baja como si te sentaras en una silla, con la espalda recta y los talones en "
        "el suelo, hasta que los muslos queden paralelos al suelo, y sube."
    ),
    "Sentadilla búlgara": (
        "De espaldas a un banco, apoya en él el empeine del pie de atrás y adelanta bien el "
        "otro pie. Baja doblando la rodilla de delante hasta que el muslo quede casi paralelo "
        "al suelo y sube empujando con ese pie, con el tronco erguido."
    ),
    "Sentadilla con barra": (
        "Con la barra apoyada en la parte alta de la espalda y los pies algo más abiertos que "
        "la cadera. Baja echando la cadera atrás y abajo, con el pecho alto y las rodillas "
        "siguiendo la línea de los pies, hasta que los muslos queden paralelos al suelo, y "
        "sube empujando el suelo."
    ),
    "Sentadilla con salto": (
        "Baja en sentadilla con la espalda recta y, al subir, salta con fuerza estirando todo "
        "el cuerpo. Cae suave sobre la parte delantera de los pies, doblando las rodillas "
        "para amortiguar, y encadena la siguiente."
    ),
    "Sentadilla en multipower": (
        "Con la barra guiada sobre la parte alta de la espalda y los pies un poco adelantados "
        "respecto a ella. Baja con la espalda recta hasta que los muslos queden paralelos al "
        "suelo y sube empujando con todo el pie."
    ),
    "Sentadilla frontal": (
        "Con la barra apoyada delante de los hombros, sujeta con los dedos y los codos altos. "
        "Baja con el tronco muy erguido hasta que los muslos queden paralelos al suelo y sube "
        "manteniendo los codos arriba para que la barra no se vaya hacia delante."
    ),
    "Sentadilla goblet": (
        "Sujeta una mancuerna o pesa rusa pegada al pecho con las dos manos. Baja con el "
        "tronco erguido, abriendo las rodillas entre los codos, hasta abajo del todo, y sube "
        "empujando con todo el pie."
    ),
    "Sentadilla hack": (
        "En la máquina, con la espalda contra el respaldo, los hombros bajo las almohadillas "
        "y los pies en la plataforma. Baja doblando las rodillas todo lo que puedas sin "
        "despegar la espalda y sube empujando con todo el pie."
    ),
    "Subidas al cajón": (
        "Pon un pie entero encima de un cajón o banco. Sube empujando con esa pierna hasta "
        "quedar de pie encima, sin impulsarte con la de abajo, y baja despacio."
    ),
    "Zancadas": (
        "De pie, da un paso largo hacia delante y baja hasta que las dos rodillas queden casi "
        "en ángulo recto, sin que la de atrás toque el suelo. Vuelve empujando con el pie de "
        "delante, con el tronco erguido."
    ),
    "Curl femoral sentado": (
        "Siéntate con el rodillo detrás de los tobillos y el de sujeción sobre los muslos. "
        "Dobla las rodillas llevando los talones hacia abajo y atrás todo lo que puedas y "
        "vuelve despacio hasta casi estirarlas."
    ),
    "Curl femoral tumbado": (
        "Túmbate boca abajo con el rodillo detrás de los tobillos y las rodillas justo fuera "
        "del banco. Lleva los talones hacia los glúteos sin despegar la cadera del banco y "
        "baja despacio."
    ),
    "Curl nórdico": (
        "De rodillas, con los tobillos sujetos por un compañero o un apoyo. Déjate caer hacia "
        "delante con el cuerpo recto de las rodillas a la cabeza, frenando todo lo que "
        "puedas, y apóyate con las manos al final para volver."
    ),
    "Peso muerto a una pierna": (
        "De pie sobre una pierna, con una mancuerna en la mano del otro lado. Inclina el "
        "tronco hacia delante mientras la pierna libre sube estirada por detrás, con la "
        "espalda recta, hasta notar el estiramiento detrás del muslo, y vuelve."
    ),
    "Peso muerto rumano": (
        "De pie, con la barra delante de los muslos y las rodillas un poco flexionadas. Echa "
        "la cadera atrás bajando la barra pegada a las piernas hasta notar el estiramiento "
        "detrás del muslo, con la espalda recta, y vuelve apretando los glúteos."
    ),
    "Peso muerto rumano con mancuernas": (
        "De pie, con una mancuerna en cada mano delante de los muslos y las rodillas un poco "
        "flexionadas. Echa la cadera atrás bajando las mancuernas pegadas a las piernas hasta "
        "notar el estiramiento detrás del muslo, con la espalda recta, y vuelve apretando los "
        "glúteos."
    ),
    "Hip thrust": (
        "Siéntate en el suelo con la parte alta de la espalda apoyada en un banco, la barra "
        "sobre la cadera y los pies en el suelo con las rodillas dobladas. Sube la cadera "
        "hasta que el tronco quede recto desde los hombros a las rodillas, aprieta los "
        "glúteos arriba y baja despacio."
    ),
    "Hip thrust en máquina": (
        "En la máquina, con la espalda contra el apoyo y el cinturón sobre la cadera. Sube la "
        "cadera hasta quedar recto desde los hombros a las rodillas, aprieta los glúteos un "
        "instante y baja despacio."
    ),
    "Patada de glúteo en máquina": (
        "Apoya el pecho o los brazos en la máquina y la planta del pie en la plataforma. "
        "Empuja la pierna hacia atrás y arriba apretando el glúteo, sin arquear la zona "
        "lumbar, y vuelve despacio."
    ),
    "Patada de glúteo en polea": (
        "Con la tobillera enganchada a una polea baja y las manos apoyadas delante. Lleva la "
        "pierna hacia atrás, casi estirada, apretando el glúteo, sin arquear la espalda, y "
        "vuelve despacio."
    ),
    "Peso muerto sumo": (
        "Con los pies muy abiertos, las puntas hacia fuera y la barra en el suelo pegada a "
        "las espinillas, agárrala por dentro de las piernas. Baja la cadera con el pecho alto "
        "y sube empujando el suelo hacia los lados y apretando los glúteos, con la barra "
        "pegada al cuerpo."
    ),
    "Puente de glúteo": (
        "Tumbado boca arriba con las rodillas dobladas y los pies apoyados cerca de los "
        "glúteos. Sube la cadera hasta quedar recto desde los hombros a las rodillas, aprieta "
        "los glúteos arriba y baja despacio."
    ),
    "Elevación de talones de pie": (
        "De pie, con la punta de los pies en un escalón y los talones por fuera. Baja los "
        "talones todo lo que puedas y sube hasta quedar de puntillas, con las rodillas casi "
        "estiradas, aguantando un instante arriba."
    ),
    "Elevación de talones en prensa": (
        "En la prensa de piernas, con solo la punta de los pies en el borde bajo de la "
        "plataforma y las rodillas casi estiradas. Empuja con las puntas hasta estirar los "
        "tobillos del todo y vuelve despacio hasta notar el estiramiento."
    ),
    "Elevación de talones sentado": (
        "Sentado en la máquina, con las almohadillas sobre los muslos y la punta de los pies "
        "en el apoyo. Baja los talones hasta notar el estiramiento y sube todo lo que puedas, "
        "aguantando un instante arriba."
    ),
    "Abdominales en V": (
        "Tumbado boca arriba con brazos y piernas estirados. Sube a la vez el tronco y las "
        "piernas hasta intentar tocar los pies con las manos, formando una V, y baja despacio "
        "sin llegar a apoyarte del todo."
    ),
    "Crunch abdominal": (
        "Tumbado boca arriba con las rodillas dobladas y las manos junto a la cabeza. Despega "
        "los hombros del suelo llevando el pecho hacia las rodillas, con la zona lumbar "
        "apoyada, y baja despacio. No tires del cuello con las manos."
    ),
    "Crunch bicicleta": (
        "Tumbado boca arriba, con las manos junto a la cabeza y las piernas en el aire. Lleva "
        "un codo hacia la rodilla contraria mientras estiras la otra pierna y alterna los "
        "lados con calma, sin tirar del cuello."
    ),
    "Crunch en máquina": (
        "Siéntate con los pies sujetos y los agarres o almohadillas a la altura del pecho. "
        "Dobla el tronco hacia delante llevando el pecho hacia las rodillas y vuelve "
        "despacio, sin empujar con los brazos."
    ),
    "Crunch en polea": (
        "De rodillas frente a una polea alta, con la cuerda junto a la cabeza. Dobla el "
        "tronco hacia abajo llevando los codos hacia los muslos, sin bajar la cadera, y "
        "vuelve despacio."
    ),
    "Crunch inverso": (
        "Tumbado boca arriba con las piernas dobladas en el aire y los brazos en el suelo. "
        "Despega la cadera del suelo llevando las rodillas hacia el pecho y baja despacio, "
        "sin impulso."
    ),
    "Elevación de piernas colgado": (
        "Colgado de una barra, con el cuerpo quieto. Sube las piernas, estiradas o dobladas, "
        "hasta al menos la altura de la cadera, curvando la pelvis hacia arriba, y bájalas "
        "despacio sin balancearte."
    ),
    "Elevación de piernas tumbado": (
        "Tumbado boca arriba con las piernas estiradas y las manos bajo la cadera. Sube las "
        "piernas hasta la vertical y bájalas despacio sin llegar a tocar el suelo, sin que la "
        "zona lumbar se despegue."
    ),
    "Elevación de rodillas en paralelas": (
        "Sujétate en las paralelas con los brazos estirados y el cuerpo quieto. Sube las "
        "rodillas hacia el pecho y bájalas despacio, sin balancear las piernas."
    ),
    "Hollow hold": (
        "Tumbado boca arriba, pega la zona lumbar al suelo y despega a la vez los hombros y "
        "las piernas estiradas, con los brazos por encima de la cabeza. Aguanta el cuerpo en "
        "forma de barca sin que la zona lumbar se levante."
    ),
    "Plancha": (
        "Apoya los antebrazos, con los codos bajo los hombros, y las puntas de los pies. "
        "Mantén el cuerpo recto de la cabeza a los talones, apretando abdomen y glúteos, sin "
        "que la cadera se hunda ni suba."
    ),
    "Rueda abdominal": (
        "De rodillas, con la rueda en el suelo delante. Rueda hacia delante estirando el "
        "cuerpo todo lo que puedas sin que la zona lumbar se hunda y vuelve tirando con el "
        "abdomen."
    ),
    "Sit-ups": (
        "Tumbado boca arriba con las rodillas dobladas y los pies sujetos o apoyados. Sube el "
        "tronco entero hasta quedar sentado y baja despacio hasta apoyar la espalda, sin dar "
        "tirones con los brazos."
    ),
    "Encogimientos con barra": (
        "De pie, con la barra delante de los muslos y los brazos estirados. Sube los hombros "
        "hacia las orejas, aguanta un instante arriba y baja despacio, sin girarlos ni doblar "
        "los codos."
    ),
    "Encogimientos con mancuernas": (
        "De pie, con una mancuerna en cada mano a los lados y los brazos estirados. Sube los "
        "hombros hacia las orejas, aguanta un instante arriba y baja despacio, sin girarlos "
        "ni doblar los codos."
    ),
    "Encogimientos en máquina": (
        "En la máquina, con los agarres a los lados y los brazos estirados. Sube los hombros "
        "hacia las orejas, aguanta un momento y baja despacio, sin doblar los codos."
    ),
    "Buenos días": (
        "Con la barra apoyada en la parte alta de la espalda y las rodillas un poco "
        "flexionadas. Inclina el tronco hacia delante echando la cadera atrás, con la espalda "
        "recta, hasta notar el estiramiento detrás del muslo, y vuelve."
    ),
    "Hiperextensiones": (
        "En el banco de hiperextensiones, con la cadera en el borde del apoyo y los pies "
        "sujetos. Baja el tronco doblando la cadera y sube hasta quedar en línea con las "
        "piernas, sin pasarte arqueando la espalda."
    ),
    "Flexión lateral con mancuerna": (
        "De pie, con una mancuerna en una mano y la otra en la cintura. Inclina el tronco "
        "hacia el lado de la mancuerna y vuelve hasta quedar recto, sin girar el cuerpo ni "
        "echarlo hacia delante. Haz luego el otro lado."
    ),
    "Leñador en polea": (
        "De lado a una polea alta, agarra el asa con las dos manos. Llévala en diagonal hacia "
        "la rodilla contraria girando el tronco, con los brazos casi estirados, y vuelve "
        "despacio."
    ),
    "Plancha lateral": (
        "Túmbate de lado apoyado en un antebrazo, con el codo bajo el hombro y los pies uno "
        "sobre otro. Sube la cadera hasta que el cuerpo quede recto y aguanta sin dejarla "
        "caer."
    ),
    "Russian twist": (
        "Sentado, con las rodillas dobladas, los pies en el suelo y el tronco inclinado hacia "
        "atrás con la espalda recta. Gira el tronco de un lado a otro llevando las manos "
        "juntas hasta el suelo junto a la cadera."
    ),
    "Máquina de aductores": (
        "Sentado, con las almohadillas por dentro de las rodillas y las piernas abiertas. "
        "Junta las piernas apretando la parte interior de los muslos y vuelve a abrirlas "
        "despacio, sin dejar que el peso choque."
    ),
    "Máquina de abductores": (
        "Sentado, con las almohadillas por fuera de las rodillas y las piernas juntas. "
        "Ábrelas apretando la parte de fuera de la cadera y vuelve a cerrarlas despacio, sin "
        "dejar que el peso choque."
    ),
    "Flexión de cuello con disco": (
        "Tumbado boca arriba en un banco, con la cabeza por fuera y un disco sobre la frente, "
        "sujeto con las manos y protegido con una toalla. Baja la cabeza despacio y súbela "
        "llevando la barbilla al pecho."
    ),
    "Bicicleta al aire libre": (
        "Ajusta el sillín para que la pierna quede casi estirada con el pedal abajo. Lleva "
        "casco, pedalea con la espalda recta y los brazos un poco doblados, a un ritmo que "
        "puedas sostener."
    ),
    "Bicicleta de aire": (
        "Siéntate con los pies en los pedales y las manos en los manillares móviles. Pedalea "
        "a la vez que empujas y tiras de los manillares con los brazos, con la espalda recta "
        "y a un ritmo que puedas sostener."
    ),
    "Bicicleta estática": (
        "Ajusta el sillín para que la rodilla quede apenas doblada con el pedal abajo y el "
        "manillar a una altura cómoda. Pedalea con la espalda recta y una resistencia que te "
        "deje mantener el ritmo."
    ),
    "Caminar": (
        "Camina a paso ligero, con la espalda erguida y la mirada al frente, apoyando primero "
        "el talón y moviendo los brazos al ritmo de los pasos."
    ),
    "Cinta de correr": (
        "Empieza caminando unos minutos y ve subiendo la velocidad. Corre cerca del centro de "
        "la cinta, con el tronco erguido y sin agarrarte a las barras."
    ),
    "Comba": (
        "Salta con la parte delantera de los pies, a poca altura, girando la cuerda con las "
        "muñecas y los codos cerca del cuerpo. Mantén el tronco erguido y aterriza suave, con "
        "las rodillas un poco flexionadas."
    ),
    "Correr al aire libre": (
        "Empieza a un ritmo suave para calentar y corre con zancadas cortas, los pies cayendo "
        "bajo el cuerpo, el tronco erguido y los brazos relajados."
    ),
    "Elíptica": (
        "Pedalea empujando con todo el pie, sin despegar los talones, y mueve los brazos con "
        "las barras. Mantén la espalda recta sin apoyar el peso en los brazos."
    ),
    "Escaladora": (
        "Sube los peldaños apoyando todo el pie, con el tronco erguido y las manos en las "
        "barras solo para equilibrarte, sin colgarte de ellas."
    ),
    "Natación": (
        "Nada al estilo que prefieras a un ritmo que puedas mantener, con el cuerpo estirado "
        "en el agua y respirando con regularidad."
    ),
    "Remo ergómetro": (
        "Siéntate con los pies sujetos en los apoyos y agarra el asa con los brazos "
        "estirados. Empuja primero con las piernas, luego echa el tronco un poco atrás y "
        "termina tirando del asa hacia el abdomen. Para volver, al revés: brazos, tronco y "
        "piernas."
    ),
    "Arrancada": (
        "Con la barra en el suelo y un agarre muy abierto, súbela de un solo movimiento "
        "explosivo desde el suelo hasta encima de la cabeza, metiéndote debajo en sentadilla "
        "con los brazos estirados, y levántate con ella arriba."
    ),
    "Burpees": (
        "De pie, baja a apoyar las manos en el suelo, lleva los pies atrás y haz una flexión. "
        "Recoge los pies junto a las manos y salta estirando el cuerpo con los brazos arriba."
    ),
    "Cargada de potencia": (
        "Con la barra en el suelo y las manos algo más abiertas que los hombros, súbela con "
        "un tirón explosivo de piernas y cadera y recíbela apoyada delante de los hombros, "
        "con los codos altos y las rodillas un poco dobladas."
    ),
    "Cuerdas de batalla": (
        "De pie, con las rodillas un poco dobladas y una cuerda en cada mano. Mueve los "
        "brazos arriba y abajo con fuerza, alternos o a la vez, para hacer ondas, aguantando "
        "el tiempo marcado sin perder la postura."
    ),
    "Dos tiempos": (
        "Sube la barra del suelo a los hombros con un tirón explosivo y, desde ahí, llévala "
        "por encima de la cabeza con un empuje de piernas, metiéndote debajo con un pie "
        "adelante y otro atrás. Junta los pies con la barra arriba."
    ),
    "Empuje de trineo": (
        "Agarra las barras del trineo con los brazos casi estirados y el cuerpo inclinado. "
        "Empuja con pasos cortos y potentes, apoyando la parte delantera del pie, manteniendo "
        "la espalda recta durante el tiempo marcado."
    ),
    "Kettlebell swing": (
        "Con la pesa rusa entre los pies, échala atrás entre las piernas doblando la cadera y "
        "lánzala hacia delante hasta la altura del pecho con un golpe de cadera, apretando "
        "los glúteos y con los brazos relajados."
    ),
    "Levantamiento turco": (
        "Tumbado con una pesa rusa en un brazo estirado hacia el techo, ponte de pie paso a "
        "paso sin bajar el brazo ni dejar de mirar la pesa, y vuelve a tumbarte deshaciendo "
        "los pasos."
    ),
    "Mountain climbers": (
        "En posición de flexión con los brazos estirados, lleva una rodilla hacia el pecho y "
        "cambia de pierna rápidamente, como si corrieras, sin subir la cadera. Mantén el "
        "ritmo el tiempo marcado."
    ),
    "Saltos al cajón": (
        "De pie frente a un cajón estable, salta con los dos pies a la vez y cae suave "
        "encima, con las rodillas dobladas. Ponte de pie arriba y baja andando, no saltando "
        "hacia atrás."
    ),
    "Thruster": (
        "Con la barra o las mancuernas delante de los hombros, baja en sentadilla con el "
        "tronco erguido y, al subir, aprovecha el impulso para empujar el peso por encima de "
        "la cabeza en un solo movimiento."
    ),
    "Wall ball": (
        "Frente a una pared, con un balón medicinal sujeto delante del pecho. Baja en "
        "sentadilla y, al subir, lanza el balón a un punto alto de la pared; recógelo y "
        "encadena la siguiente sentadilla."
    ),
}


def _predefinidos_no_unicos(conexion, nombres: list[str]) -> list[str]:
    """De esos nombres, los que no están exactamente una vez como predefinido."""
    cuantos = dict(
        conexion.execute(
            sa.text(
                "SELECT nombre, count(*) FROM ejercicios"
                " WHERE es_predefinido AND nombre = ANY(:nombres) GROUP BY nombre"
            ),
            {"nombres": nombres},
        ).all()
    )
    return [nombre for nombre in nombres if cuantos.get(nombre) != 1]


def _ya_usados(conexion, nombres: list[str]) -> list[str]:
    """Los ejercicios, propios o predefinidos, que ya se llaman así sin mirar mayúsculas."""
    return (
        conexion.execute(
            sa.text("SELECT nombre FROM ejercicios WHERE lower(nombre) = ANY(:nombres)"),
            {"nombres": [nombre.lower() for nombre in nombres]},
        )
        .scalars()
        .all()
    )


def _renombrar(pares: list[tuple[str, str]]) -> None:
    # op.execute no pasa por el onupdate del ORM: updated_at se pone a mano.
    ahora = datetime.now(timezone.utc)
    for desde, hasta in pares:
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre == desde)
            .values(nombre=hasta, updated_at=ahora)
        )


def upgrade() -> None:
    conexion = op.get_bind()

    # Primero se comprueba todo y solo después se escribe: si algo no cuadra, mejor un error
    # que lo diga que unas descripciones a medias.
    antes = [VIEJOS[DESTINOS.index(n)] if n in DESTINOS else n for n in DESCRIPCIONES]
    no_unicos = _predefinidos_no_unicos(conexion, antes)
    if no_unicos:
        raise RuntimeError(
            "No se pueden poner las descripciones ni el nombre de los predefinidos: falta o está "
            f"repetido {', '.join(no_unicos)}."
        )
    existentes = _ya_usados(conexion, DESTINOS)
    if existentes:
        raise RuntimeError(
            f"Ya hay un ejercicio llamado {', '.join(existentes)}: cámbiale el nombre antes de "
            "actualizar."
        )

    _renombrar(RENOMBRES)

    ahora = datetime.now(timezone.utc)
    for nombre, texto in DESCRIPCIONES.items():
        op.execute(
            ejercicios.update()
            .where(ejercicios.c.es_predefinido.is_(True), ejercicios.c.nombre == nombre)
            .values(descripcion=texto, updated_at=ahora)
        )


def downgrade() -> None:
    conexion = op.get_bind()

    no_unicos = _predefinidos_no_unicos(conexion, list(DESCRIPCIONES))
    if no_unicos:
        raise RuntimeError(
            "No se pueden quitar las descripciones de los predefinidos: falta o está repetido "
            f"{', '.join(no_unicos)}."
        )
    existentes = _ya_usados(conexion, VIEJOS)
    if existentes:
        raise RuntimeError(
            "No se puede deshacer el cambio de nombre: ya hay un ejercicio llamado "
            f"{', '.join(existentes)}. Cámbiale el nombre antes."
        )

    # Antes de esta migración ningún predefinido tenía descripción.
    op.execute(
        ejercicios.update()
        .where(
            ejercicios.c.es_predefinido.is_(True),
            ejercicios.c.nombre.in_(list(DESCRIPCIONES)),
        )
        .values(descripcion=None, updated_at=datetime.now(timezone.utc))
    )
    # Obligatorio: el downgrade de la migración anterior busca este ejercicio por el nombre viejo.
    _renombrar([(nuevo, viejo) for viejo, nuevo in RENOMBRES])
