/* ==========================================================================
   Chroma Key Pro — Modo OBS (ventana emergente dedicada)
   --------------------------------------------------------------------------
   La ventana principal NUNCA se oculta: el botón abre un popup limpio
   (location + '?obs=1') sin barra de direcciones, pestañas ni barras de
   herramientas. Dentro del popup, la interfaz se oculta desde el inicio y
   sólo queda el canvas a pantalla completa.

   La detección del parámetro ?obs=1 se hace en el bootstrap (bootstrap.js)
   para ocultar la interfaz antes del primer pintado. Este módulo gestiona el
   ciclo de vida: abrir, preparar, salir.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * Módulo del Modo OBS.
 * @readonly
 */
CK.obs = (() => {
  const { $, on, notify } = CK.dom;
  const cfg = CK.config.obs;

  /** ¿Estamos en la ventana emergente dedicada? */
  const isPopup = new URLSearchParams(window.location.search).get(cfg.queryParam) === cfg.queryValue;

  /** Estado del modo limpio dentro de esta ventana. */
  let active = false;
  /** Referencia a la ventana emergente (sólo en la ventana principal). */
  /** @type {Window|null} */
  let popupWindow = null;
  /**
   * Posición original del canvas, para restaurarla al salir.
   * El bootstrap la rellena si ya movió el canvas a <body>.
   * @type {{canvasHome:Node|null, canvasNext:Node|null}}
   */
  const anchors = { canvasHome: null, canvasNext: null };
  let previousTitle = '';
  /** Temporizador del desvanecido del botón de salida. */
  let fadeTimer = 0;
  /** ¿La Fullscreen API está pendiente de un gesto del usuario? */
  let fullscreenPending = false;
  /** ¿Ya se registró un listener de reintento? */
  let fullscreenArmed = false;

  /* ---------------------------------------------------------------- Botón */
  const exitButton = document.createElement('button');
  exitButton.id = 'obsExitBtn';
  exitButton.type = 'button';
  exitButton.textContent = '✕ Cerrar Modo OBS (Esc)';
  exitButton.title = 'Salir de Modo OBS y recuperar los controles';
  exitButton.setAttribute('aria-label', 'Cerrar Modo OBS');
  document.body.appendChild(exitButton);

  /* ---------------------------------------------- Capa de avisos flotante */
  const messageOverlay = document.createElement('div');
  messageOverlay.id = 'obsMsg';
  messageOverlay.setAttribute('role', 'status');
  messageOverlay.setAttribute('aria-live', 'polite');
  document.body.appendChild(messageOverlay);

  /* ------------------------------------------------------------ Fullscreen */
  /**
   * ¿Estamos en pantalla completa? (con prefijos de proveedor)
   * @returns {boolean}
   */
  const isFullscreen = () => Boolean(
    document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement
  );

  /**
   * Solicita pantalla completa real (oculta barra de direcciones y pestañas).
   */
  const requestFullscreen = () => {
    const element = document.documentElement;
    const request = element.requestFullscreen
      || element.webkitRequestFullscreen
      || element.msRequestFullscreen;
    if (!request) {
      console.warn('Este navegador no soporta la Fullscreen API.');
      return;
    }
    try {
      const promise = request.call(element);
      promise?.catch?.((error) => {
        console.error('No se pudo activar pantalla completa:', error);
        fullscreenPending = true;
        armFullscreenOnGesture();
      });
    } catch (error) {
      console.error('No se pudo activar pantalla completa:', error);
      fullscreenPending = true;
      armFullscreenOnGesture();
    }
  };

  /**
   * La Fullscreen API exige un gesto del usuario: si se pidió al cargar y el
   * navegador la rechazó, se reintenta con el primer clic o tecla.
   */
  const armFullscreenOnGesture = () => {
    if (fullscreenArmed) return;
    fullscreenArmed = true;

    const retry = (event) => {
      if (!active || isFullscreen()) return;
      // Escape sirve para SALIR del Modo OBS: no debe activar pantalla completa.
      if (event?.key === 'Escape' || event?.key === 'Esc' || event?.keyCode === 27) return;
      fullscreenPending = false;
      requestFullscreen();
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('keydown', retry, true);
      fullscreenArmed = false;
    };

    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
  };

  /**
   * Sale de la pantalla completa (si la hay).
   */
  const exitFullscreen = () => {
    const exit = document.exitFullscreen
      || document.webkitExitFullscreen
      || document.msExitFullscreen;
    if (!exit || !isFullscreen()) return;
    try {
      const promise = exit.call(document);
      promise?.catch?.(() => {});
    } catch (_) { /* ignore */ }
  };

  /* ------------------------------------------------------ Entrada / salida */
  /**
   * Muestra el botón de salida y programa su desvanecido.
   */
  const showExitButton = () => {
    if (!active) return;
    exitButton.classList.remove('obs-exit-hidden');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      if (active) exitButton.classList.add('obs-exit-hidden');
    }, cfg.exitFadeMs);
  };

  /**
   * Prepara el Modo OBS limpio en ESTA ventana: mueve el canvas a <body>
   * (para poder fijarlo a pantalla completa) y oculta la interfaz.
   */
  const start = () => {
    if (active) return;
    const canvas = CK.engine.out;

    // El bootstrap pudo mover el canvas antes; en ese caso se reutiliza la
    // posición original guardada para poder restaurarla al salir.
    if (canvas.parentNode !== document.body) {
      anchors.canvasHome = canvas.parentNode;
      anchors.canvasNext = canvas.nextSibling;
      document.body.appendChild(canvas);
    }

    if (!previousTitle) previousTitle = document.title;
    document.body.classList.add('obs-mode-active');
    document.title = cfg.title;
    active = true;
    showExitButton();
  };

  /**
   * Restaura la interfaz normal: devuelve el canvas a su sitio y quita la clase.
   */
  const stop = () => {
    if (!active) return;
    active = false;
    clearTimeout(fadeTimer);

    // Devolver el canvas a su sitio ANTES de quitar la clase (evita parpadeos).
    const canvas = CK.engine.out;
    if (anchors.canvasHome) {
      try {
        if (anchors.canvasNext && anchors.canvasNext.parentNode === anchors.canvasHome) {
          anchors.canvasHome.insertBefore(canvas, anchors.canvasNext);
        } else {
          anchors.canvasHome.appendChild(canvas);
        }
      } catch (_) {
        try { anchors.canvasHome.appendChild(canvas); } catch (__) { /* ignore */ }
      }
    }

    document.body.classList.remove('obs-mode-active');
    document.title = previousTitle || 'Chroma Key Pro';
    exitButton.classList.add('obs-exit-hidden');
    messageOverlay.classList.remove('show');
    messageOverlay.textContent = '';
    anchors.canvasHome = null;
    anchors.canvasNext = null;
  };

  /**
   * Sale del Modo OBS. En la ventana emergente lo lógico es cerrarla.
   */
  const exit = () => {
    if (isPopup) {
      exitFullscreen();
      try { window.close(); } catch (_) { /* ignore */ }
      stop();
      return;
    }
    stop();
    exitFullscreen();
  };

  /* ------------------------------------------------------------- Popup URL */
  /**
   * Construye la URL de la ventanaemergente preservando ruta y parámetros.
   * `location.pathname` no sirve con file:// (produce rutas inválidas).
   * @returns {string}
   */
  const buildPopupUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set(cfg.queryParam, cfg.queryValue);
    url.hash = '';
    return url.href;
  };

  /**
   * Abre la ventana emergente dedicada. Si ya existe, la enfoca.
   */
  const openPopup = () => {
    if (popupWindow && !popupWindow.closed) {
      try { popupWindow.focus(); } catch (_) { /* ignore */ }
      return;
    }

    const width = cfg.width;
    const height = cfg.height;
    const left = (window.screen?.width - width) / 2;
    const top = (window.screen?.height - height) / 2;
    const features = [
      `width=${width}`, `height=${height}`,
      `top=${Math.max(0, top)}`, `left=${Math.max(0, left)}`,
      'menubar=no', 'toolbar=no', 'location=no', 'status=no', 'personalbar=no',
    ].join(',');

    popupWindow = window.open(buildPopupUrl(), cfg.windowName, features);

    if (!popupWindow) {
      notify('El navegador bloqueó la ventana emergente. Permite los pop-ups para este sitio y vuelve a intentarlo.', true);
      return;
    }

    // Si el usuario cierra el popup a mano, se limpia la referencia.
    const watcher = setInterval(() => {
      if (!popupWindow || popupWindow.closed) {
        clearInterval(watcher);
        popupWindow = null;
      }
    }, 700);
  };

  /* ---------------------------------------------------------- Arranque auto */
  /**
   * Arranque en la ventana emergente: modo limpio + cámara automática.
   */
  const autoStart = () => {
    if (!isPopup || active) return;
    start();
    // Sólo se enciende la cámara si no hay ya ninguna fuente de vídeo activa.
    if (!CK.camera.isActive()) CK.camera.start();
    // Pantalla completa: el navegador la rechazará sin gesto del usuario, así
    // que se reintenta con el primer clic o tecla.
    requestFullscreen();
  };

  /**
   * Registra listeners y arranca el popup si corresponde.
   */
  const init = () => {
    on('btnObs', 'click', openPopup);

    exitButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      exit();
    });

    document.addEventListener('mousemove', () => { if (active) showExitButton(); }, { passive: true });
    document.addEventListener('touchstart', () => { if (active) showExitButton(); }, { passive: true });

    window.addEventListener('keydown', (event) => {
      if (!active) return;
      const isEscape = event.key === 'Escape' || event.key === 'Esc' || event.keyCode === 27;
      if (isEscape) {
        event.preventDefault();
        exit();
      }
    });

    // Si el usuario sale de pantalla completa con el Esc nativo del navegador,
    // el Modo OBS también se cierra para recuperar los controles.
    const handleFullscreenExit = () => {
      if (!isFullscreen() && active) exit();
    };
    document.addEventListener('fullscreenchange', handleFullscreenExit);
    document.addEventListener('webkitfullscreenchange', handleFullscreenExit);

    // En la ventana emergente el arranque es síncrono: el bootstrap ya ocultó
    // la interfaz, así que no hay que esperar a DOMContentLoaded (y así el
    // listener no se pierde al registrarse durante el propio evento).
    if (isPopup) autoStart();
  };

  return {
    init, start, stop, exit, openPopup, isPopup,
    requestFullscreen, exitFullscreen, anchors,
  };
})();
