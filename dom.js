/* ==========================================================================
   Chroma Key Pro — Utilidades de DOM
   --------------------------------------------------------------------------
   Caché de referencias a elementos y avisos al usuario. Concentra aquí todo
   el acceso al DOM para que el resto de módulos no manipulen nodos directly.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * Acceso memoizado al DOM.
 * @readonly
 */
CK.dom = (() => {
  /** @type {Map<string, HTMLElement>} */
  const cache = new Map();

  /**
   * Devuelve (y cachea) un elemento por id.
   * @param {string} id
   * @returns {HTMLElement|null}
   */
  const $ = (id) => {
    if (!cache.has(id)) cache.set(id, document.getElementById(id));
    return cache.get(id);
  };

  /**
   * Registra un listener y devuelve el elemento asociado.
   * @param {string} id
   * @param {string} event
   * @param {EventListener} handler
   * @param {boolean|AddEventListenerOptions} [options]
   * @returns {HTMLElement|null}
   */
  const on = (id, event, handler, options) => {
    const el = $(id);
    if (el) el.addEventListener(event, handler, options);
    return el;
  };

  /**
   * Muestra un aviso en la interfaz normal y, si existe, en la capa flotante
   * del Modo OBS (donde la interfaz principal está oculta).
   * @param {string} [text]
   * @param {boolean} [isError]
   */
  const notify = (text, isError) => {
    const bar = $('msg');
    if (bar) {
      bar.textContent = text || '';
      bar.className = isError ? 'err' : '';
    }
    const overlay = $('obsMsg');
    if (overlay) {
      overlay.textContent = text || '';
      overlay.classList.toggle('show', Boolean(text));
      overlay.classList.toggle('err', Boolean(isError));
    }
  };

  /**
   * Convierte `#rrggbb` a componentes RGB.
   * @param {string} hex
   * @returns {Rgb}
   */
  const hexToRgb = (hex) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });

  /**
   * Convierte componentes RGB a `#rrggbb`.
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @returns {string}
   */
  const rgbToHex = (r, g, b) => '#' + [r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('');

  /** Limpia la caché de elementos (tras recargar contenido dinámico). */
  const invalidate = () => cache.clear();

  return { $, on, notify, hexToRgb, rgbToHex, invalidate };
})();
