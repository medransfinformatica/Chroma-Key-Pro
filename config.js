/* ==========================================================================
   Chroma Key Pro — Configuración global
   --------------------------------------------------------------------------
   Script clásico (no ES module) a propósito: la app debe seguir funcionando
   abriendo el archivo con file://, donde los módulos ES están bloqueados por
   CORS. El orden de carga de los <script> define el orden de inicialización.
   ========================================================================== */
window.CK = window.CK || {};

/**
 * Constantes de la aplicación. Se congelan para evitar mutaciones accidentales.
 * @readonly
 */
CK.config = Object.freeze({
  /** Colores clave a quitar: máximo y valor inicial. */
  keys: Object.freeze({
    max: 5,
    initial: Object.freeze({ r: 0, g: 177, b: 64 }),
  }),

  /** Cámara: resolución ideal y modos de orientación. */
  camera: Object.freeze({
    idealWidth: 1280,
    idealHeight: 720,
    facingModes: Object.freeze(['user', 'environment']),
  }),

  /** Segmentación con IA (MediaPipe Selfie Segmentation). */
  segmentation: Object.freeze({
    baseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/',
    modelSelection: 0,
    selfieMode: false,
    /** Intervalo mínimo entre envíos al modelo (ms). ~14 análisis/s. */
    minIntervalMs: 70,
    /** Tiempo tras el cual se reintenta un envío que quedó ocupado (ms). */
    busyTimeoutMs: 2000,
    /** Frecuencia del sondeo del borde (cada N fotogramas). */
    probeEvery: 15,
    /** Fotogramas de histéresis antes de cambiar de modo. */
    hysteresis: 3,
    /** Umbral de borde para considerar que el fondo NO es uniforme. */
    borderThreshold: 0.35,
  }),

  /** Controles de ajuste fino generados dinámicamente por la interfaz. */
  sliders: Object.freeze([
    Object.freeze({ id: 'tol', label: 'Tolerancia', min: 0, max: 100, value: 30 }),
    Object.freeze({ id: 'soft', label: 'Suavizado de borde', min: 0, max: 100, value: 15 }),
    Object.freeze({ id: 'noise', label: 'Reducir ruido', min: 0, max: 6, value: 2 }),
    Object.freeze({ id: 'choke', label: 'Encoger borde', min: 0, max: 5, value: 1 }),
    Object.freeze({ id: 'feather', label: 'Difuminar borde', min: 0, max: 8, value: 1 }),
    Object.freeze({ id: 'spill', label: 'Reducir derrame', min: 0, max: 100, value: 60 }),
    Object.freeze({ id: 'temp', label: 'Estabilidad', min: 0, max: 85, value: 35 }),
  ]),

  /** Ventana emergente dedicada a OBS. */
  obs: Object.freeze({
    windowName: 'ChromaKeyOBS',
    width: 1280,
    height: 720,
    queryParam: 'obs',
    queryValue: '1',
    title: 'Chroma Key Pro - OBS Feed',
    /** Tiempo antes de que el botón de salida se desvanezca (ms). */
    exitFadeMs: 3500,
  }),

  /** Captura de foto y grabación de vídeo. */
  recorder: Object.freeze({
    fps: 30,
    mimeCandidates: Object.freeze([
      'video/webm;codecs=vp9',
      'video/webm',
      'video/mp4',
    ]),
  }),

  /** Bucle de render. */
  render: Object.freeze({
    /** Intervalo mínimo entre dos mensajes de error (ms). Evita spam en bucle. */
    errorThrottleMs: 2500,
  }),
});

/**
 * @typedef {{r:number,g:number,b:number}} Rgb
 * @typedef {{tol:number,soft:number,noise:number,choke:number,feather:number,spill:number,temp:number}} ChromaSettings
 * @typedef {{id:string,label:string,min:number,max:number,value:number}} SliderSpec
 */
