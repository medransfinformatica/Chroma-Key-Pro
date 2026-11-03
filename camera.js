/* ==========================================================================
   Chroma Key Pro — Gestión de cámara y fuentes de vídeo
   --------------------------------------------------------------------------
   Encapsula getUserMedia, la enumeración de dispositivos y la carga de vídeo
   local. Expone un estado consultable para que el resto de módulos no toque
   el elemento <video> directamente.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * @typedef {'camera'|'file'|'none'} SourceKind
 * @typedef {{kind:SourceKind, stream:MediaStream|null}} CameraState
 */

/**
 * Módulo de cámara.
 * @readonly
 */
CK.camera = (() => {
  const { $, on, notify } = CK.dom;
  const cfg = CK.config.camera;

  /** @type {HTMLVideoElement} */
  const video = $('cam');

  /** @type {MediaStream|null} */
  let stream = null;
  /** @type {string} */
  let facing = cfg.facingModes[0];
  /** Evita dos getUserMedia simultáneos. */
  let starting = false;
  /** @type {SourceKind} */
  let kind = 'none';
  /** URL del vídeo local; se revoca al sustituirlo. @type {string|null} */
  let fileUrl = null;
  /** Espejo de la fuente. El vídeo local nunca se espeja. */
  let mirrored = true;
  /** Aviso de cambio de fuente. @type {((state:CameraState)=>void)|null} */
  let onSourceChange = null;

  /**
   * Notifica un cambio de fuente de vídeo.
   */
  const emitSourceChange = () => {
    try { onSourceChange?.(getState()); } catch (error) { console.error(error); }
  };

  /**
   * Detiene todas las pistas de un stream y lo libera.
   * @param {MediaStream|null} target
   */
  const stopTracks = (target) => {
    if (!target) return;
    target.getTracks().forEach((track) => track.stop());
  };

  /**
   * Libera la fuente de vídeo local actual (revocando su object URL).
   */
  const releaseFileSource = () => {
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
      fileUrl = null;
    }
    video.removeAttribute('src');
    try { video.load(); } catch (_) { /* algunos navegadores no soportan load() */ }
  };

  /**
   * Estado actual de la fuente de vídeo.
   * @returns {CameraState}
   */
  const getState = () => ({ kind, stream });

  /**
   * ¿Hay alguna fuente de vídeo utilizable?
   * @returns {boolean}
   */
  const isActive = () => kind !== 'none' || Boolean(video.srcObject || video.src);

  /**
   * ¿La fuente se dibuja en espejo?
   * @returns {boolean}
   */
  const isMirrored = () => mirrored;

  /**
   * Activa o desactiva el espejo de la fuente.
   * @param {boolean} [value]
   * @returns {boolean} el nuevo valor.
   */
  const setMirrored = (value) => {
    mirrored = typeof value === 'boolean' ? value : !mirrored;
    emitSourceChange();
    return mirrored;
  };

  /**
   * Enumera las cámaras disponibles y las muestra en el selector.
   * @returns {Promise<void>}
   */
  const listDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput');
      const select = $('camList');
      if (!select) return;

      const previous = select.value;
      select.replaceChildren();

      const fallback = document.createElement('option');
      fallback.value = '';
      fallback.textContent = cameras.length ? 'Cámara predeterminada' : 'No se detectaron cámaras';
      select.appendChild(fallback);

      cameras.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Cámara ${index + 1}`;
        select.appendChild(option);
      });

      const activeTrack = stream?.getVideoTracks()[0];
      const activeId = activeTrack ? activeTrack.getSettings().deviceId : null;
      if (activeId && cameras.some((c) => c.deviceId === activeId)) {
        select.value = activeId;
      } else if (previous && cameras.some((c) => c.deviceId === previous)) {
        select.value = previous;
      }
    } catch (_) {
      // enumerateDevices puede fallar sin permisos: la lista queda vacía.
    }
  };

  /**
   * Traduce un error de getUserMedia a un mensaje accionable.
   * @param {DOMException} error
   * @returns {string}
   */
  const describeError = (error) => {
    const inFrame = window.self !== window.top;
    switch (error?.name) {
      case 'NotAllowedError':
        return inFrame
          ? 'La cámara está bloqueada dentro de la vista previa. Descarga el archivo y ábrelo desde tu equipo.'
          : 'Permiso denegado. Permite la cámara con el candado junto a la dirección y recarga.';
      case 'NotFoundError':
        return 'No se encontró ninguna cámara.';
      case 'NotReadableError':
        return 'Otra aplicación está usando la cámara. Ciérrala e inténtalo de nuevo.';
      case 'OverconstrainedError':
        return 'La cámara seleccionada ya no está disponible. Elige otra.';
      default:
        return 'No se pudo activar la cámara: ' + (error?.message || 'error desconocido');
    }
  };

  /**
   * Arranca la cámara. Si ya hay una petición en curso se ignora la llamada.
   * @returns {Promise<boolean>} true si la cámara quedó activa.
   */
  const start = async () => {
    if (starting) return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('Tu navegador no permite la cámara aquí. Abre el archivo desde tu equipo o con https.', true);
      return false;
    }

    const selectedDeviceId = $('camList')?.value || '';
    const constraints = selectedDeviceId
      ? { video: { deviceId: { exact: selectedDeviceId } }, audio: false }
      : {
          video: {
            facingMode: facing,
            width: { ideal: cfg.idealWidth },
            height: { ideal: cfg.idealHeight },
          },
          audio: false,
        };

    starting = true;
    try {
      // Se detiene el stream anterior DESPUÉS de conseguir el nuevo: si el
      // permiso se deniega, la cámara que ya funcionaba no se pierde.
      const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
      const previousStream = stream;

      stream = nextStream;
      kind = 'camera';
      video.srcObject = nextStream;
      video.muted = true;
      releaseFileSource();

      stopTracks(previousStream);

      // Un fallo de autoplay no debe invalidar un stream ya conseguido.
      try { await video.play(); } catch (_) { /* se reintenta con el primer gesto */ }

      notify('');
      await listDevices();
      emitSourceChange();
      return true;
    } catch (error) {
      notify(describeError(error), true);
      if (error?.name === 'NotAllowedError' && window.self !== window.top) {
        const tab = $('btnTab');
        if (tab) tab.style.display = '';
      }
      return false;
    } finally {
      starting = false;
    }
  };

  /**
   * Alterna entre la cámara frontal y la trasera.
   * @returns {Promise<boolean>}
   */
  const flip = async () => {
    const index = cfg.facingModes.indexOf(facing);
    facing = cfg.facingModes[(index + 1) % cfg.facingModes.length];
    return start();
  };

  /**
   * Usa un vídeo local como fuente en lugar de la cámara.
   * @param {File} file
   * @returns {Promise<boolean>}
   */
  const useFile = async (file) => {
    if (!file) return false;
    stopTracks(stream);
    stream = null;
    kind = 'file';

    releaseFileSource();
    fileUrl = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = fileUrl;
    video.loop = true;
    mirrored = false;   // un vídeo local no se espeja

    try { await video.play(); } catch (_) { /* se reintenta con el primer gesto */ }
    notify('Usando un video como fuente.');
    emitSourceChange();
    return true;
  };

  /**
   * Libera la cámara y detiene el stream.
   */
  const stop = () => {
    stopTracks(stream);
    stream = null;
    kind = 'none';
    video.srcObject = null;
    releaseFileSource();
    emitSourceChange();
  };

  /**
   * Registra los listeners de la interfaz de cámara.
   */
  const init = () => {
    on('btnCam', 'click', () => { start(); });
    on('btnFlip', 'click', () => { flip(); });
    on('camList', 'change', () => { start(); });
    on('vidSrc', 'change', (event) => {
      const input = /** @type {HTMLInputElement} */ (event.target);
      const file = input.files?.[0];
      if (file) useFile(file);
    });
    on('btnTab', 'click', () => window.open(location.href, '_blank', 'noopener'));

    navigator.mediaDevices?.addEventListener?.('devicechange', listDevices);
    listDevices();
  };

  return {
    init, start, flip, stop, listDevices, getState, isActive, isMirrored,
    setMirrored, onSourceChange: (fn) => { onSourceChange = fn; }, video,
  };
})();
