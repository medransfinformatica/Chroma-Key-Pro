/* ==========================================================================
   Chroma Key Pro — Capa de fondo (inferior)
   --------------------------------------------------------------------------
   Gestiona el color sólido y la imagen/vídeo de fondo. El <video> se mantiene
   en el DOM (oculto a 1px) porque algunos navegadores no decodifican vídeos
   que no están insertados en el documento.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * Módulo de fondo.
 * @readonly
 */
CK.background = (() => {
  const { $, on } = CK.dom;

  /** @type {HTMLVideoElement} */
  const video = document.createElement('video');
  video.id = 'bgVideo';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);

  /** @type {HTMLImageElement|HTMLVideoElement|null} */
  let source = null;
  /** @type {'image'|'video'|null} */
  let sourceType = null;
  /** Object URL del recurso actual; se revoca al reemplazarlo. @type {string|null} */
  let objectUrl = null;
  /** Token de generación: invalida cargas asíncronas obsoletas. */
  let token = 0;

  /**
   * Detiene y libera el vídeo de fondo.
   */
  const stopVideo = () => {
    video.onloadeddata = video.oncanplay = null;
    try { video.pause(); } catch (_) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (_) { /* ignore */ }
  };

  /**
   * Elimina el fondo actual y libera sus recursos.
   */
  const clear = () => {
    token++;                                   // invalida cargas pendientes
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    stopVideo();
    source = null;
    sourceType = null;
  };

  /**
   * Aplica un archivo como fondo.
   * @param {File} file
   */
  const setFile = (file) => {
    clear();
    const currentToken = token;
    const url = URL.createObjectURL(file);
    objectUrl = url;

    if (file.type.startsWith('video')) {
      source = video;
      sourceType = 'video';
      const play = () => {
        if (currentToken === token) video.play().catch(() => {});
      };
      video.onloadeddata = play;
      video.oncancanplay = undefined;
      video.oncanplay = play;
      video.src = url;
      try { video.load(); } catch (_) { /* ignore */ }
      play();
    } else {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (currentToken === token) {
          source = image;
          sourceType = 'image';
        }
      };
      image.src = url;
    }
  };

  /**
   * Tamaño intrínseco del fondo actual.
   * @returns {[number,number]|null}
   */
  const sourceSize = () => {
    if (!source) return null;
    if (sourceType === 'video') {
      const media = /** @type {HTMLVideoElement} */ (source);
      if (!media.videoWidth || !media.videoHeight || media.readyState < 2) return null;
      return [media.videoWidth, media.videoHeight];
    }
    const image = /** @type {HTMLImageElement} */ (source);
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
    return [image.naturalWidth, image.naturalHeight];
  };

  /**
   * Pinta la capa inferior: color sólido + fondo nuevo (cover, sin deformar).
   * @param {number} width
   * @param {number} height
   * @param {CanvasRenderingContext2D} ctx
   */
  const draw = (width, height, ctx) => {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = $('bgc')?.value || '#1d1d1f';
    ctx.fillRect(0, 0, width, height);

    const size = sourceSize();
    if (size) {
      const [bgWidth, bgHeight] = size;
      const scale = Math.max(width / bgWidth, height / bgHeight);
      const drawWidth = bgWidth * scale;
      const drawHeight = bgHeight * scale;
      try {
        ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      } catch (_) {
        // El recurso puede no estar listo aún: se mantiene el color sólido.
      }
    }
    ctx.restore();
  };

  /**
   * Registra los listeners de la interfaz de fondo.
   */
  const init = () => {
    on('file', 'change', (event) => {
      const input = /** @type {HTMLInputElement} */ (event.target);
      const file = input.files?.[0];
      if (file) setFile(file);
      input.value = '';   // permite volver a elegir el mismo archivo
    });
    on('btnClear', 'click', () => {
      clear();
      const input = /** @type {HTMLInputElement} */ ($('file'));
      if (input) input.value = '';
    });
  };

  return { init, draw, clear, setFile };
})();
