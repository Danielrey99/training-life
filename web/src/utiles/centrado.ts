/**
 * La regla de los textos explicativos: **una frase corta va centrada; si alguna no cabe
 * en una línea, el texto pasa a párrafo alineado a la izquierda** (en un bloque más
 * estrecho si va suelto). Si no, una frase partida queda con la segunda línea centrada
 * y colgando. Lo que cabe depende del ancho de la pantalla, así que se mide, como hace
 * el diálogo con su texto.
 *
 * Se vigila desde un solo sitio (`App`) con la lista de clases de esos textos: las
 * pantallas no tienen que hacer nada, y un texto nuevo solo necesita estar en la lista.
 */

// Los textos explicativos centrados de la app (pies, leyendas, vacíos, avisos).
const TEXTOS = [
  '.dia-leyenda',
  '.cifras-pie',
  '.hoja-subtitulo',
  '.planificar-ayuda',
  '.resumen-vacio',
  '.resumen-pie',
  '.entrada-pie',
  '.tarjeta-hoy p',
  '.ejercicio-hoja-pie',
  '.programas-vacio',
  '.programas-pie',
  '.rutina-vacio',
  '.rutina-leyenda',
  '.semana-oculto',
  '.semana-leyenda',
].join(', ')

/** El alto de una línea de ese elemento, en píxeles. */
function alturaDeLinea(elemento: Element) {
  const estilo = getComputedStyle(elemento)
  const alto = parseFloat(estilo.lineHeight)
  return Number.isNaN(alto) ? parseFloat(estilo.fontSize) * 1.5 : alto
}

/** Si alguna frase ocupa más de una línea. */
function seParte(elemento: HTMLElement) {
  const estilo = getComputedStyle(elemento)
  // Una frase por hijo (`.semana-oculto`, en columna): cada uno se mide por su cuenta.
  if (estilo.display === 'flex' && estilo.flexDirection === 'column') {
    return [...elemento.children].some(
      (hijo) => hijo.getBoundingClientRect().height > alturaDeLinea(hijo) * 1.5,
    )
  }
  // Frases separadas por <br>: hay tantas líneas como frases si ninguna se parte.
  const lineas = Math.round(elemento.getBoundingClientRect().height / alturaDeLinea(elemento))
  return lineas > elemento.querySelectorAll('br').length + 1
}

// Lo último medido de cada elemento: si no ha cambiado ni el ancho ni el texto, no se
// vuelve a medir (cambiar la clase lo redimensiona y avisaría otra vez).
const medido = new WeakMap<HTMLElement, string>()

function ajustar(elemento: HTMLElement) {
  const clave = `${elemento.parentElement?.clientWidth}|${elemento.textContent}`
  if (medido.get(elemento) === clave) return
  medido.set(elemento, clave)
  // Se mide centrado y a lo ancho, que es como se vería si cabe.
  elemento.classList.remove('en-parrafo', 'estrecho')
  if (!seParte(elemento)) return
  elemento.classList.add('en-parrafo')
  // Suelto, en un bloque más estrecho; dentro de una caja con borde, a su ancho.
  if (getComputedStyle(elemento).borderTopStyle === 'none') elemento.classList.add('estrecho')
}

/** Empieza a vigilar los textos: los que ya hay y los que aparezcan. Devuelve cómo parar. */
export function vigilarTextosCentrados(raiz: HTMLElement) {
  const tamano = new ResizeObserver((entradas) => {
    for (const entrada of entradas) ajustar(entrada.target as HTMLElement)
  })
  const vigilados = new WeakSet<Element>()
  const buscar = () => {
    for (const elemento of raiz.querySelectorAll<HTMLElement>(TEXTOS)) {
      if (vigilados.has(elemento)) {
        ajustar(elemento)
        continue
      }
      vigilados.add(elemento)
      tamano.observe(elemento)
    }
  }
  const cambios = new MutationObserver(buscar)
  cambios.observe(raiz, { childList: true, subtree: true, characterData: true })
  buscar()
  return () => {
    cambios.disconnect()
    tamano.disconnect()
  }
}
