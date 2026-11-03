/* ==========================================================================
   Chroma Key Pro — Motor de chroma key
   --------------------------------------------------------------------------
   Pipeline por fotograma:
     1. Distancia de color por píxel  -> D[]  (distancia a la clave más cercana)
     2. Suavizado opcional            -> D[]
     3. Falloff smootherstep          -> A[]  (alfa 0..1)
     4. Erosión / difuminado          -> A[]
     5. Estabilidad temporal         -> mezcla con P[] (fotograma anterior)
     6. Desderrame de color + alfa final -> capa de sujeto (keyc)

   NOTAS DE RENDIMIENTO:
   - Los valores de los sliders se cachean en `settings` y sólo se releen
     cuando el usuario los mueve (antes se leía el DOM en cada fotograma).
   - `prepKeys()` se memoiza: sólo se recalcula si cambian los colores clave.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * @typedef {{cb:number,cr:number,kCb:number,kCr:number,mag:number,mag2:number,
 *            minMag2:number,invMag:number,y:number,wl:number,dom:number}} KeyProfile
 * @typedef {{r:number,g:number,b:number}} Rgb
 */

/**
 * Motor de composición de imagen.
 * @readonly
 */
CK.engine = (() => {
  const { $ } = CK.dom;

  /** Canvas de salida visible. */
  const out = /** @type {HTMLCanvasElement} */ ($('out'));
  /** Ctx del canvas de salida. */
  const octx = out.getContext('2d');

  /** Copia del fotograma de cámara. */
  const raw = document.createElement('canvas');
  const rctx = raw.getContext('2d', { willReadFrequently: true });

  /** Capa de sujeto con transparencia. */
  const keyc = document.createElement('canvas');
  const kctx = keyc.getContext('2d');

  /** Capa inferior (color sólido + fondo nuevo). */
  const bgLayer = document.createElement('canvas');
  const bgctx = bgLayer.getContext('2d');

  /** Buffers de trabajo por píxel. */
  let D = new Float32Array(0);   // distancia a la clave
  let T = new Float32Array(0);   // buffer temporal (blur/erode)
  let A = new Float32Array(0);   // alfa actual
  let P = new Float32Array(0);   // alfa del fotograma anterior (estabilidad)
  let KI = new Uint8Array(0);    // índice de la clave más cercana

  /** Perfiles de las claves, memoizados. @type {KeyProfile[]|null} */
  let keyProfiles = null;

  /**
   * Ajustes cacheados de la interfaz. Se actualizan en `syncSettings()`.
   * @type {ChromaSettings}
   */
  const settings = {
    tol: 30, soft: 15, noise: 2, choke: 1, feather: 1, spill: 60, temp: 35,
  };

  /**回调 de invalidação de la máscara de segmentación. @type {(() => void)|null} */
  let onMaskInvalidated = null;

  /**
   * Callback invocado cuando el alfa de color del fotograma está listo.
   * Permite que la segmentación analice el borde sin acoplarse al motor.
   * @type {((width:number,height:number,alpha:Float32Array)=>void)|null}
   */
  let onAlphaReady = null;

  /**
   * Normaliza un color a perfil de trabajo en el espacio CbCr.
   * @param {Rgb} key
   * @returns {KeyProfile}
   */
  const buildProfile = (key) => {
    const cb = 128 - .168736 * key.r - .331264 * key.g + .5 * key.b;
    const cr = 128 + .5 * key.r - .418688 * key.g - .081312 * key.b;
    const kCb = cb - 128;
    const kCr = cr - 128;
    const mag = Math.hypot(kCb, kCr);
    const channels = [key.r, key.g, key.b];
    let dominant = -1;
    for (let i = 0; i < 3; i++) {
      const others = Math.max(channels[(i + 1) % 3], channels[(i + 2) % 3]);
      if (channels[i] - others > 30) dominant = i;
    }
    return {
      cb, cr, kCb, kCr, mag,
      mag2: mag * mag,
      minMag2: mag * mag * .49,
      invMag: mag > 1 ? 1 / mag : 0,
      y: .299 * key.r + .587 * key.g + .114 * key.b,
      wl: Math.max(0, Math.min(1, 1 - mag / 50)),
      dom: dominant,
    };
  };

  /**
   * Perfiles de las claves activas. Se recalcula sólo si cambian.
   * @param {Rgb[]} keys
   * @returns {KeyProfile[]}
   */
  const prepareKeys = (keys) => {
    if (keyProfiles && keyProfiles.length === keys.length) return keyProfiles;
    keyProfiles = keys.map(buildProfile);
    return keyProfiles;
  };

  /** Fuerza el recálculo de perfiles (tras añadir/quitar/editar un color). */
  const invalidateKeys = () => { keyProfiles = null; };

  /**
   * Copia los valores de los sliders al objeto cacheado.
   * Se llama en cada cambio de la interfaz, no en cada fotograma.
   */
  const syncSettings = () => {
    settings.tol = +$('tol').value;
    settings.soft = +$('soft').value;
    settings.noise = +$('noise').value;
    settings.choke = +$('choke').value;
    settings.feather = +$('feather').value;
    settings.spill = +$('spill').value;
    settings.temp = +$('temp').value;
  };

  /**
   * Desenfoque separable (caja) en dos pasadas.
   * @param {Float32Array} data
   * @param {number} width
   * @param {number} height
   * @param {number} radius
   * @param {Float32Array} scratch
   */
  const blur = (data, width, height, radius, scratch) => {
    const size = 2 * radius + 1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        sum += data[row + Math.min(width - 1, Math.max(0, x))];
      }
      for (let x = 0; x < width; x++) {
        scratch[row + x] = sum / size;
        sum += data[row + Math.min(width - 1, x + radius + 1)]
             - data[row + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        sum += scratch[Math.min(height - 1, Math.max(0, y)) * width + x];
      }
      for (let y = 0; y < height; y++) {
        data[y * width + x] = sum / size;
        sum += scratch[Math.min(height - 1, y + radius + 1) * width + x]
             - scratch[Math.max(0, y - radius) * width + x];
      }
    }
  };

  /**
   * Erosión (mínimo local) en dos pasadas.
   * @param {Float32Array} data
   * @param {number} width
   * @param {number} height
   * @param {number} radius
   * @param {Float32Array} scratch
   */
  const erode = (data, width, height, radius, scratch) => {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let min = 1;
        for (let k = -radius; k <= radius; k++) {
          const value = data[row + Math.min(width - 1, Math.max(0, x + k))];
          if (value < min) min = value;
        }
        scratch[row + x] = min;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let min = 1;
        for (let k = -radius; k <= radius; k++) {
          const value = scratch[Math.min(height - 1, Math.max(0, y + k)) * width + x];
          if (value < min) min = value;
        }
        data[y * width + x] = min;
      }
    }
  };

  /**
   * Afina el alfa final: núcleo opaco, fondo transparente y transición suave.
   * @param {number} alpha
   * @returns {number}
   */
  const cleanAlpha = (alpha) => {
    if (alpha <= 0.30) return 0;
    if (alpha >= 0.70) return 1;
    const t = (alpha - 0.30) / 0.40;
    return t * t * (3 - 2 * t);
  };

  /**
   * Redimensiona todos los canvas y reasigna los buffers.
   * @param {number} width
   * @param {number} height
   */
  const resize = (width, height) => {
    out.width = raw.width = keyc.width = bgLayer.width = width;
    out.height = raw.height = keyc.height = bgLayer.height = height;
    const size = width * height;
    D = new Float32Array(size);
    T = new Float32Array(size);
    A = new Float32Array(size);
    P = new Float32Array(size);
    KI = new Uint8Array(size);
    onMaskInvalidated?.();
  };

  /**
   * Distancia mínima de un píxel al conjunto de claves.
   * @param {Uint8ClampedArray} data
   * @param {KeyProfile[]} profiles
   * @param {number} count
   */
  const computeDistances = (data, profiles, count) => {
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const y = .299 * r + .587 * g + .114 * b;
      const cb = 128 - .168736 * r - .331264 * g + .5 * b;
      const cr = 128 + .5 * r - .418688 * g - .081312 * b;
      const pCb = cb - 128, pCr = cr - 128;
      const pMag2 = pCb * pCb + pCr * pCr;

      let best = 1e9;
      let bestIndex = 0;

      for (let j = 0; j < profiles.length; j++) {
        const key = profiles[j];
        const luma = (y - key.y) * key.wl * .6;
        let value;

        if (key.mag > 40) {
          // Clave saturada: distancia de tono (perpendicular al croma de la
          // clave) + diferencia de saturación suavizada. Así las sombras y los
          // cambios de iluminación del fondo no dejan bordes duros.
          if (pMag2 < key.minMag2) {
            // Demasiado gris o desaturado para una pantalla saturada: se usa la
            // distancia euclídea para no keyear la piel ni la ropa del sujeto.
            const dCb = cb - key.cb, dCr = cr - key.cr;
            value = dCb * dCb + dCr * dCr + luma * luma;
          } else {
            const perp = (pCb * key.kCr - pCr * key.kCb) * key.invMag;
            const proj = (pCb * key.kCb + pCr * key.kCr) * key.invMag;
            const dmag = (proj - key.mag) * .45;
            value = perp * perp + dmag * dmag + luma * luma;
          }
        } else {
          // Claves grises o poco saturadas: distancia euclídea Cb/Cr + luminancia.
          const dCb = cb - key.cb, dCr = cr - key.cr;
          value = dCb * dCb + dCr * dCr + luma * luma;
        }

        if (value < best) { best = value; bestIndex = j; }
      }

      D[i] = Math.sqrt(best);
      KI[i] = bestIndex;
    }
  };

  /**
   * Procesa el fotograma actual y compone la salida.
   * @param {number} width
   * @param {number} height
   * @param {Rgb[]} keys
   * @param {'result'|'matte'|'orig'} view
   * @param {{data:Uint8ClampedArray|null, valid:boolean,
   *          border?:{avg:number,checked:boolean}}|null} segmentation
   */
  const process = (width, height, keys, view, segmentation) => {
    const image = rctx.getImageData(0, 0, width, height);
    const pixels = image.data;
    const count = width * height;
    const profiles = prepareKeys(keys);

    const tol = settings.tol * 1.5;
    const soft = Math.max(1, settings.soft * 1.5);
    const spill = settings.spill / 100;

    computeDistances(pixels, profiles, count);

    if (settings.noise) blur(D, width, height, settings.noise, T);

    // Falloff smootherstep con un mínimo de suavizado: nunca un corte binario,
    // ni siquiera con el control de borde a 0.
    const softEff = Math.max(soft, tol * .35, 6);
    for (let i = 0; i < count; i++) {
      let t = (D[i] - tol) / softEff;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      A[i] = t * t * t * (t * (t * 6 - 15) + 10);
    }

    if (settings.choke) erode(A, width, height, settings.choke, T);
    if (settings.feather) blur(A, width, height, settings.feather, T);

    const stability = settings.temp / 100;
    if (stability) {
      for (let i = 0; i < count; i++) A[i] = P[i] * stability + A[i] * (1 - stability);
    }
    P.set(A);
    onAlphaReady?.(width, height, A);

    // Máscara definitiva del sujeto: IA si está lista y es fiable; si no, color.
    // 255 = persona visible, 0 = fondo eliminado. La polaridad NUNCA se invierte.
    const useSeg = Boolean(
      segmentation?.valid && segmentation.data?.length === count * 4
    );
    const segData = useSeg ? segmentation.data : null;

    let opaque = 0;
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      const rawAlpha = segData ? segData[p] / 255 : A[i];
      const alpha = segData ? rawAlpha : cleanAlpha(rawAlpha);
      if (alpha > 0.5) opaque++;

      if (view === 'matte') {
        pixels[p] = pixels[p + 1] = pixels[p + 2] = alpha * 255;
        pixels[p + 3] = 255;
        continue;
      }

      if (spill > 0) {
        const dominant = profiles[KI[i]].dom;
        if (dominant >= 0) {
          const p1 = (dominant + 1) % 3;
          const p2 = (dominant + 2) % 3;
          const value = pixels[p + dominant];
          const limit = Math.max(pixels[p + p1], pixels[p + p2]);
          if (value > limit) {
            const excess = value - limit;
            // El halo se ve sobre todo en el borde y en derrames intensos:
            // ahí se aplica más despill que en el interior.
            const boost = (rawAlpha > 0.03 && rawAlpha < 0.97) || excess > 24;
            const strength = Math.min(1, spill * (boost ? 1.5 : 1));
            pixels[p + dominant] = limit + excess * (1 - strength);
          }
        }
      }

      pixels[p + 3] = alpha * 255;
    }

    if (view === 'matte') {
      octx.putImageData(image, 0, 0);
      return;
    }

    // Si la IA borró casi todo el sujeto, se recupera el alfa del chroma key:
    // el sujeto vuelve a opaco y sólo se elimina el color de fondo elegido.
    if (useSeg && opaque < count * 0.05) {
      for (let i = 0, p = 3; i < count; i++, p += 4) pixels[p] = cleanAlpha(A[i]) * 255;
    }

    // Red de seguridad: si la máscara dejara a la persona totalmente
    // transparente, se pinta la cámara sin recorte para que el fondo NUNCA
    // la oculte.
    const border = segmentation?.border;
    if (border?.checked && border.avg > 0.5 && opaque < count * 0.002) {
      for (let p = 3; p < pixels.length; p += 4) pixels[p] = 255;
    }

    kctx.putImageData(image, 0, 0);   // sujeto con transparencia (capa superior)
  };

  /**
   * Compone fondo + sujeto sobre el canvas de salida.
   * @param {number} width
   * @param {number} height
   * @param {(w:number,h:number)=>void} drawBackgroundFn
   */
  const compose = (width, height, drawBackgroundFn) => {
    drawBackgroundFn(width, height);
    octx.save();
    octx.globalAlpha = 1;
    octx.globalCompositeOperation = 'source-over';
    octx.clearRect(0, 0, out.width, out.height);
    octx.drawImage(bgLayer, 0, 0);   // Capa 0: fondo
    octx.drawImage(keyc, 0, 0);      // Capa 1: sujeto
    octx.restore();
  };

  /**
   * Dibuja el fotograma original sin procesar.
   * @param {number} width
   * @param {number} height
   */
  const drawOriginal = (width, height) => {
    octx.drawImage(raw, 0, 0);
  };

  return {
    out, raw, rctx, bgLayer, bgctx, kctx,
    settings, resize, process, compose, drawOriginal,
    syncSettings, invalidateKeys, cleanAlpha,
    onMaskInvalidated: (fn) => { onMaskInvalidated = fn; },
    onAlphaReady: (fn) => { onAlphaReady = fn; },
  };
})();
