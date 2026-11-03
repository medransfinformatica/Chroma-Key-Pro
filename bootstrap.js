/* ==========================================================================
   Chroma Key Pro — Arranque
   --------------------------------------------------------------------------
   Detecta el parámetro ?obs=1 y deja la ventana en modo limpio ANTES del
   primer pintado: sólo queda el canvas, listo para que OBS lo capture.

   Se ejecuta de forma síncrona al final de <body>, por lo que el DOM ya
   está parseado y la interfaz oculta nunca llega a mostrarse.
   ========================================================================== */
window.CK = window.CK || {};

(() => {
  const cfg = CK.config.obs;
  const isPopup = new URLSearchParams(window.location.search).get(cfg.queryParam) === cfg.queryValue;
  if (!isPopup) return;

  const body = document.body;
  if (!body) return;

  // Oculta la interfaz de inmediato.
  body.classList.add('obs-mode-active');

  // El canvas se lleva a <body> para poder fijarlo a pantalla completa con
  // position:fixed. Se guarda su posición original para poder restaurarla.
  const canvas = document.getElementById('out');
  if (canvas && canvas.parentNode !== body) {
    CK.obs.anchors.canvasHome = canvas.parentNode;
    CK.obs.anchors.canvasNext = canvas.nextSibling;
    body.appendChild(canvas);
  }
})();
