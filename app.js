/* ==========================================================================
   Chroma Key Pro — Controlador de la aplicación
   --------------------------------------------------------------------------
   Orquesta los módulos: estado de la interfaz (claves, vista, calidad),
   bucle de render y feedback al usuario.

   Este archivo NO contiene lógica de imagen: el procesamiento vive en
   CK.engine, el fondo en CK.background y la IA en CK.segmentation.
   ========================================================================== */
window.CK = window.CK || {};

CK.app = (() => {
  const { $, on, notify, hexToRgb, rgbToHex } = CK.dom;

  /** Colores a eliminar. @type {Rgb[]} */
  let keys = [{ ...CK.config.keys.initial }];
  /** Índice del color seleccionado. */
  let activeKey = 0;
  /** Vista activa. @type {'result'|'matte'|'orig'} */
  let view = 'result';
  /** ¿Está activo el bucle de render? */
  let running = false;
  /** Ancho máximo de trabajo. Cacheado: no leer el DOM en cada fotograma. */
  let quality = 960;
  /** Marca del último error mostrado (para el throttle del bucle). */
  let lastErrorAt = -Infinity;
  /** Fotogramas contados en la ventana actual de FPS. */
  let frameCount = 0;
  /** Inicio de la ventana de FPS. */
  let fpsWindowStart = 0;

  /* -------------------------------------------------------------- Sliders */

  /**
   * Genera los sliders de ajuste fino y los enlaza con el motor.
   * Se construyen con APIs del DOM (no innerHTML): sin inyección de HTML y
   * con referencias directas a los nodos creados.
   */
  const buildSliders = () => {
    const host = $('sl');
    if (!host) return;

    CK.config.sliders.forEach((slider) => {
      const row = document.createElement('div');
      row.className = 'ctl';

      const label = document.createElement('span');
      label.textContent = slider.label;

      const input = document.createElement('input');
      input.type = 'range';
      input.id = slider.id;
      input.min = String(slider.min);
      input.max = String(slider.max);
      input.value = String(slider.value);

      const readout = document.createElement('span');
      readout.id = slider.id + 'V';
      readout.textContent = String(slider.value);

      input.addEventListener('input', () => {
        readout.textContent = input.value;
        // El motor trabaja con valores cacheados: se sincroniza al mover.
        CK.engine.syncSettings();
      });

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(readout);
      host.appendChild(row);
    });

    CK.engine.syncSettings();
  };

  /* --------------------------------------------------------------- Claves */

  /**
   * Dibuja los chips de colores y refleja el color activo en el selector.
   */
  const renderKeys = () => {
    const host = $('chips');
    if (!host) return;

    host.replaceChildren();
    keys.forEach((key, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (index === activeKey ? ' on' : '');
      chip.style.background = rgbToHex(key.r, key.g, key.b);
      chip.title = 'Color ' + (index + 1);
      chip.addEventListener('click', () => {
        activeKey = index;
        renderKeys();
      });
      host.appendChild(chip);
    });

    const current = keys[activeKey];
    const picker = $('color');
    if (picker && current) picker.value = rgbToHex(current.r, current.g, current.b);
  };

  /**
   * Aplica un color a la clave activa y fuerza el recálculo de perfiles.
   * @param {Rgb} color
   */
  const setKey = (color) => {
    if (!color || !keys[activeKey]) return;
    keys[activeKey] = { r: color.r, g: color.g, b: color.b };
    CK.engine.invalidateKeys();
    renderKeys();
  };

  /* ------------------------------------------------------ Detección "Auto" */

  /**
   * Detecta el color de fondo muestreando el borde del encuadre.
   * Se usa un histograma grueso (5 bits por canal) para no ser sensible al
   * ruido de compresión, y se promedia el bin más poblado.
   */
  const detectBorderColor = () => {
    const { raw, rctx } = CK.engine;
    if (!raw.width) {
      notify('Activa la cámara primero.', true);
      return;
    }

    const width = raw.width;
    const height = raw.height;
    const margin = Math.round(Math.min(width, height) * 0.08);
    const pixels = rctx.getImageData(0, 0, width, height).data;

    /** @type {Map<number, number[]>} */
    const bins = new Map();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isBorder = x < margin || x >= width - margin || y < margin || y >= height - margin;
        if (!isBorder) continue;

        const i = (y * width + x) * 4;
        const bin = ((pixels[i] >> 5) << 6) | ((pixels[i + 1] >> 5) << 3) | (pixels[i + 2] >> 5);
        let accumulator = bins.get(bin);
        if (!accumulator) {
          accumulator = [0, 0, 0, 0];
          bins.set(bin, accumulator);
        }
        accumulator[0] += pixels[i];
        accumulator[1] += pixels[i + 1];
        accumulator[2] += pixels[i + 2];
        accumulator[3] += 1;
      }
    }

    /** @type {number[]|null} */
    let best = null;
    bins.forEach((accumulator) => {
      if (!best || accumulator[3] > best[3]) best = accumulator;
    });

    if (best) {
      setKey({ r: best[0] / best[3], g: best[1] / best[3], b: best[2] / best[3] });
    }
  };

  /* -------------------------------------------------------- Muestreo manual */

  /**
   * Toma el color exacto del punto pulsado sobre el canvas.
   * @param {MouseEvent} event
   */
  const sampleCanvasColor = (event) => {
    const { raw, rctx, out } = CK.engine;
    if (!raw.width) return;

    const rect = out.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = Math.floor(((event.clientX - rect.left) / rect.width) * raw.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * raw.height);

    const radius = 4;
    const sx = Math.max(0, Math.min(raw.width - 1, x - radius));
    const sy = Math.max(0, Math.min(raw.height - 1, y - radius));
    const sw = Math.min(raw.width - sx, radius * 2);
    const sh = Math.min(raw.height - sy, radius * 2);
    if (sw <= 0 || sh <= 0) return;

    const data = rctx.getImageData(sx, sy, sw, sh).data;
    let r = 0, g = 0, b = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }

    setKey({ r: r / count, g: g / count, b: b / count });
  };

  /* --------------------------------------------------------- Estado de UI */

  /**
   * Refleja el estado de la fuente de vídeo en los controles.
   * @param {{kind:string}} state
   */
  const syncCameraUi = (state) => {
    const button = $('btnCam');
    const flip = $('btnFlip');

    if (button && state.kind === 'camera') button.textContent = 'Cámara activa ✓';
    if (flip) flip.disabled = state.kind !== 'camera';

    if (state.kind === 'camera' || state.kind === 'file') markReady();
  };

  /**
   * Refleja el estado del espejo en el botón.
   */
  const syncMirrorUi = () => {
    const button = $('btnMirror');
    if (button) button.textContent = 'Espejo: ' + (CK.camera.isMirrored() ? 'sí' : 'no');
  };

  /**
   * Prepara la interfaz para renderizar y arranca el bucle si hace falta.
   */
  const markReady = () => {
    const placeholder = $('ph');
    if (placeholder) placeholder.style.display = 'none';
    ['btnShot', 'btnRec'].forEach((id) => {
      const element = $(id);
      if (element) element.disabled = false;
    });
    startRendering();
  };

  /* ------------------------------------------------------- Bucle de render */

  /**
   * Arranca el bucle de render (idempotente).
   */
  const startRendering = () => {
    if (running) return;
    running = true;
    fpsWindowStart = performance.now();
    requestAnimationFrame(loop);
  };

  /**
   * Compone un fotograma: captura -> segmentación -> composición.
   */
  const renderFrame = () => {
    const video = CK.camera.video;

    if (!(video.videoWidth && video.readyState >= 2)) {
      if (CK.camera.getState().stream) {
        const badge = $('badge');
        if (badge) {
          badge.textContent = 'Sin imagen · esperando ' + (video.readyState < 2 ? 'datos' : 'cuadros');
        }
      }
      return;
    }

    const scale = Math.min(1, quality / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    if (width !== CK.engine.raw.width || height !== CK.engine.raw.height) {
      CK.engine.resize(width, height);
      const stage = $('stage');
      if (stage) stage.style.aspectRatio = width + '/' + height;
    }

    // Copia del fotograma al canvas de trabajo (con espejo opcional).
    const rctx = CK.engine.rctx;
    rctx.save();
    if (CK.camera.isMirrored()) {
      rctx.translate(width, 0);
      rctx.scale(-1, 1);
    }
    rctx.drawImage(video, 0, 0, width, height);
    rctx.restore();

    // Mantiene la máscara de IA al día (si el modo segmentación está activo).
    CK.segmentation.feed(performance.now());

    if (view === 'orig') {
      CK.engine.drawOriginal(width, height);
    } else {
      const mask = CK.segmentation.getMask();
      const border = CK.segmentation.getBorderState();
      CK.engine.process(width, height, keys, view, { data: mask.data, valid: mask.valid, border });
      if (view !== 'matte') {
        CK.engine.compose(width, height, (w, h) => CK.background.draw(w, h, CK.engine.bgctx));
      }
    }

    frameCount += 1;
    const now = performance.now();
    if (now - fpsWindowStart > 1000) {
      const badge = $('badge');
      if (badge) badge.textContent = width + '×' + height + ' · ' + frameCount + ' fps';
      frameCount = 0;
      fpsWindowStart = now;
    }
  };

  /**
   * Bucle de render. Los errores se notifican con throttle para no
   * inundar el DOM si falla de forma persistente.
   */
  const loop = () => {
    try {
      renderFrame();
    } catch (error) {
      const now = performance.now();
      if (now - lastErrorAt >= CK.config.render.errorThrottleMs) {
        lastErrorAt = now;
        notify('Error al procesar la imagen: ' + (error?.message || 'error desconocido'), true);
        console.error(error);
      }
    }
    requestAnimationFrame(loop);
  };

  /* ------------------------------------------------------------- Arranque */

  /**
   * Enlaza todos los controles de la interfaz.
   */
  const init = () => {
    buildSliders();
    renderKeys();
    syncMirrorUi();

    // Vistas (Resultado / Máscara / Original).
    const viewButtons = document.querySelectorAll('[data-v]');
    viewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        view = /** @type {'result'|'matte'|'orig'} */ (button.getAttribute('data-v'));
        viewButtons.forEach((other) => other.classList.toggle('on', other === button));
      });
    });

    // Colores a quitar.
    on('color', 'input', (event) => {
      const input = /** @type {HTMLInputElement} */ (event.target);
      setKey(hexToRgb(input.value));
    });
    document.querySelectorAll('[data-p]').forEach((button) => {
      button.addEventListener('click', () => {
        const hex = button.getAttribute('data-p') || '#000000';
        setKey(hexToRgb(hex));
      });
    });
    on('btnAdd', 'click', () => {
      if (keys.length >= CK.config.keys.max) return;
      keys.push({ ...keys[activeKey] });
      activeKey = keys.length - 1;
      CK.engine.invalidateKeys();
      renderKeys();
    });
    on('btnDel', 'click', () => {
      if (keys.length <= 1) return;
      keys.splice(activeKey, 1);
      activeKey = Math.max(0, activeKey - 1);
      CK.engine.invalidateKeys();
      renderKeys();
    });
    on('btnAuto', 'click', detectBorderColor);

    // Muestreo de color al hacer clic en el canvas.
    CK.engine.out.addEventListener('click', sampleCanvasColor);

    // Calidad: se cachea para no leer el DOM en cada fotograma.
    const qualitySelect = $('q');
    quality = +(qualitySelect && qualitySelect.value) || 960;
    on('q', 'change', (event) => {
      const input = /** @type {HTMLSelectElement} */ (event.target);
      quality = +input.value || 960;
    });

    // Espejo.
    on('btnMirror', 'click', () => {
      CK.camera.setMirrored();
      syncMirrorUi();
    });

    // Reacción a los cambios de fuente de vídeo (cámara / archivo).
    CK.camera.onSourceChange((state) => {
      syncCameraUi(state);
      syncMirrorUi();
    });

    // La segmentación analiza el alfa de color cuando el motor lo produce.
    CK.engine.onAlphaReady((w, h, alpha) => CK.segmentation.updateMatteMode(w, h, alpha));
    // Al cambiar el tamaño del fotograma la máscara de IA deja de ser válida.
    CK.engine.onMaskInvalidated(() => CK.segmentation.invalidateMask());

    CK.camera.init();
    CK.background.init();
    CK.capture.init();
    CK.obs.init();
  };

  /**
   * Estado actual de la aplicación (para depuración y pruebas).
   */
  const getState = () => ({
    keys: keys.map((key) => ({ ...key })),
    activeKey,
    view,
    running,
    quality,
  });

  // Los scripts se cargan al final de <body>: el DOM ya está disponible y no
  // hace falta esperar a DOMContentLoaded (que retrasaría el primer render).
  init();

  return { getState };
})();
