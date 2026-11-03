/* ==========================================================================
   Chroma Key Pro — Segmentación de sujeto con IA
   --------------------------------------------------------------------------
   Usa MediaPipe Selfie Segmentation como respaldo cuando el fondo no es de un
   color uniforme (detectable porque el borde del encuadre no se elimina con
   el chroma key). La polaridad de la máscara NUNCA se invierte de forma
   silenciosa: sólo se acepta una silueta coherente.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * Módulo de segmentación IA.
 * @readonly
 */
CK.segmentation = (() => {
  const cfg = CK.config.segmentation;

  /** @type {SelfieSegmentation|null} */
  let engine = null;
  let ready = false;
  let busy = false;
  let tried = false;
  let mode = false;

  /** @type {Uint8ClampedArray|null} */
  let maskData = null;
  let valid = false;

  let lastSend = 0;
  let probe = 0;
  let solidRun = 0;
  let complexRun = 0;
  let borderAvg = 0;
  let checked = false;

  /** Canvas auxiliar para leer la máscara del modelo. */
  const scratch = document.createElement('canvas');
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });

  /**
   * Carga perezosa del script del modelo (sólo si hace falta).
   */
  const ensureEngine = () => {
    if (engine || tried) return;
    tried = true;

    const script = document.createElement('script');
    script.src = cfg.baseUrl + 'selfie_segmentation.js';
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      try {
        const instance = new SelfieSegmentation({
          locateFile: (file) => cfg.baseUrl + file,
        });
        instance.setOptions({
          modelSelection: cfg.modelSelection,
          selfieMode: cfg.selfieMode,
        });
        instance.onResults(handleResults);
        instance.initialize()
          .then(() => { ready = true; })
          .catch(() => { engine = null; ready = false; });
        engine = instance;
      } catch (_) {
        engine = null;
        ready = false;
      }
    };
    script.onerror = () => { engine = null; ready = false; };
    document.head.appendChild(script);
  };

  /**
   * Procesa el resultado del modelo: valida la máscara y corrige polaridad.
   * @param {{segmentationMask:CanvasImageSource|null}} results
   */
  const handleResults = (results) => {
    busy = false;
    const mask = results?.segmentationMask;
    if (!mask) {
      maskData = null;
      valid = false;
      return;
    }

    try {
      const width = CK.engine.raw.width || 1;
      const height = CK.engine.raw.height || 1;
      if (scratch.width !== width || scratch.height !== height) {
        scratch.width = width;
        scratch.height = height;
      }
      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.drawImage(mask, 0, 0, width, height);
      const data = scratchCtx.getImageData(0, 0, width, height).data;

      /**
       * Estadísticas de la máscara: cobertura total, centro (sujeto) y borde.
       * @returns {{coverage:number,center:number,border:number}}
       */
      const stats = () => {
        let sum = 0, total = 0, center = 0, centerCount = 0, border = 0, borderCount = 0;
        const x0 = Math.floor(width * 0.30), x1 = Math.ceil(width * 0.70);
        const y0 = Math.floor(height * 0.15), y1 = Math.ceil(height * 0.85);
        const bx = Math.max(1, Math.floor(width * 0.08));
        const by = Math.max(1, Math.floor(height * 0.08));
        for (let y = 0; y < height; y += 4) {
          for (let x = 0; x < width; x += 4) {
            const value = data[(y * width + x) * 4];
            sum += value; total++;
            if (x >= x0 && x < x1 && y >= y0 && y < y1) { center += value; centerCount++; }
            if (x < bx || x >= width - bx || y < by || y >= height - by) { border += value; borderCount++; }
          }
        }
        return {
          coverage: total ? sum / (255 * total) : 0,
          center: centerCount ? center / (255 * centerCount) : 0,
          border: borderCount ? border / (255 * borderCount) : 0,
        };
      };

      let summary = stats();
      // Si la máscara llega claramente invertida (fondo blanco, persona negra),
      // se invierte explícitamente.
      if (summary.center < 0.15 && summary.border > 0.7) {
        for (let i = 0; i < data.length; i += 4) {
          const value = 255 - data[i];
          data[i] = data[i + 1] = data[i + 2] = value;
        }
        summary = stats();
      }

      maskData = data;
      // Sólo se usa la IA si es una silueta coherente: persona en el centro,
      // fondo oscuro en los bordes y cobertura razonable. Nunca al revés.
      valid = summary.coverage > 0.02 && summary.coverage < 0.92 &&
              summary.center > 0.15 && summary.center >= summary.border * 0.8;
    } catch (_) {
      maskData = null;
      valid = false;
    }
  };

  /**
   * Envía el fotograma actual al modelo si toca.
   * @param {number} now
   */
  const feed = (now) => {
    if (!mode) return;
    ensureEngine();
    if (!engine || !ready || !CK.engine.raw.width) return;

    if (busy) {
      if (now - lastSend < cfg.busyTimeoutMs) return;
      busy = false;
    }
    if (now - lastSend < cfg.minIntervalMs) return;

    busy = true;
    lastSend = now;
    try {
      const promise = engine.send({ image: CK.engine.raw });
      promise?.catch?.(() => { busy = false; });
    } catch (_) {
      busy = false;
    }
  };

  /**
   * Analiza el borde del matte: si el fondo no se eliminó, conviene IA.
   * Usa histéresis para no parpadear entre modos.
   * @param {number} width
   * @param {number} height
   * @param {Float32Array} alpha
   */
  const updateMatteMode = (width, height, alpha) => {
    if ((++probe % cfg.probeEvery) !== 0) return;

    const margin = Math.max(2, Math.round(Math.min(width, height) * 0.05));
    const stepX = Math.max(1, Math.round(width / 80));
    const stepY = Math.max(1, Math.round(height / 80));
    let sum = 0;
    let count = 0;

    for (let y = 0; y < margin; y += stepY) {
      for (let x = 0; x < width; x += stepX) { sum += alpha[y * width + x]; count++; }
    }
    for (let y = height - margin; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) { sum += alpha[y * width + x]; count++; }
    }
    for (let x = 0; x < margin; x += stepX) {
      for (let y = margin; y < height - margin; y += stepY) { sum += alpha[y * width + x]; count++; }
    }
    for (let x = width - margin; x < width; x += stepX) {
      for (let y = margin; y < height - margin; y += stepY) { sum += alpha[y * width + x]; count++; }
    }
    if (!count) return;

    borderAvg = sum / count;
    checked = true;

    if (borderAvg > cfg.borderThreshold) { complexRun++; solidRun = 0; }
    else { solidRun++; complexRun = 0; }

    if (complexRun >= cfg.hysteresis && !mode) {
      mode = true;
      ensureEngine();
    } else if (solidRun >= cfg.hysteresis && mode) {
      mode = false;
    }
  };

  /**
   * Máscara actual disponible para el motor.
   * La máscara sólo se considera válida si el modo segmentación está activo:
   * en modo color la IA no debe interferir.
   * @returns {{data:Uint8ClampedArray|null, valid:boolean}}
   */
  const getMask = () => ({ data: maskData, valid: valid && mode });

  /**
   * Estado del borde, para las redes de seguridad del motor.
   * @returns {{avg:number, checked:boolean}}
   */
  const getBorderState = () => ({ avg: borderAvg, checked });

  /** Invalida la máscara (el tamaño del fotograma cambió). */
  const invalidateMask = () => {
    maskData = null;
    valid = false;
    busy = false;
  };

  return { feed, updateMatteMode, getMask, getBorderState, invalidateMask };
})();
