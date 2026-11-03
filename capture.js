/* ==========================================================================
   Chroma Key Pro — Captura de foto y grabación de vídeo
   --------------------------------------------------------------------------
   Ambas capturas parten del canvas de salida (`out.captureStream()`), de modo
   que el archivo resultante ya incluye el fondo nuevo y el recorte.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * Módulo de captura.
 * @readonly
 */
CK.capture = (() => {
  const { $, on, notify } = CK.dom;
  const cfg = CK.config.recorder;

  /** @type {MediaRecorder|null} */
  let recorder = null;
  /** @type {Blob[]} */
  let chunks = [];

  /**
   * Descarga un blob y revoca su object URL (evita fugas de memoria).
   * @param {Blob} blob
   * @param {string} filename
   */
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // La descarga es asíncrona: se revoca en el siguiente turno para no
    // romperla, pero sin dejar el blob retenido indefinidamente.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  /**
   * Captura el fotograma actual como PNG.
   */
  const takePhoto = () => {
    const canvas = CK.engine.out;
    if (!canvas.width) return;
    try {
      const anchor = document.createElement('a');
      anchor.href = canvas.toDataURL('image/png');
      anchor.download = 'chroma-key.png';
      anchor.click();
    } catch (error) {
      notify('No se pudo guardar la foto: ' + error.message, true);
    }
  };

  /**
   * Alterna entre grabar y detener la grabación.
   */
  const toggleRecording = () => {
    if (recorder) {
      recorder.stop();
      return;
    }

    const canvas = CK.engine.out;
    if (!window.MediaRecorder || !canvas.captureStream) {
      notify('Tu navegador no permite grabar.', true);
      return;
    }

    const mimeType = cfg.mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    chunks = [];

    try {
      recorder = new MediaRecorder(
        canvas.captureStream(cfg.fps),
        mimeType ? { mimeType } : undefined
      );
    } catch (error) {
      recorder = null;
      notify('No se pudo iniciar la grabación: ' + error.message, true);
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const type = recorder?.mimeType || mimeType || 'video/webm';
      const extension = type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(new Blob(chunks, { type }), 'chroma-key.' + extension);
      chunks = [];
      recorder = null;
      const button = $('btnRec');
      if (button) button.textContent = '● Grabar';
    };
    recorder.onerror = (event) => {
      notify('Error durante la grabación: ' + (event.error?.message || 'desconocido'), true);
    };

    recorder.start();
    const button = $('btnRec');
    if (button) button.textContent = '■ Detener';
  };

  /**
   * Registra los listeners de captura.
   */
  const init = () => {
    on('btnShot', 'click', takePhoto);
    on('btnRec', 'click', toggleRecording);
  };

  return { init, takePhoto, toggleRecording };
})();
