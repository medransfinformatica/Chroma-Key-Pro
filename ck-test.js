/* Banco de pruebas de Chroma Key Pro (Node + DOM simulado).
   Uso: node ck-test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Estructura plana: todos los archivos viven junto a este test. */
const ROOT = __dirname;
const SITE_DIR = path.basename(__dirname);
const PAGE_PATH = '/' + SITE_DIR + '/index.html';
const PAGE_URL = 'http://localhost' + PAGE_PATH;
const SCRIPTS = [
  'config.js', 'dom.js', 'engine.js', 'background.js',
  'segmentation.js', 'camera.js', 'capture.js', 'obs.js',
  'bootstrap.js', 'app.js',
];

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + name);
  } else {
    failed += 1;
    failures.push(name + (detail ? ' :: ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : ''));
  }
}

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

/* ------------------------------------------------------------------ DOM --- */

function makeStyle() {
  return { cssText: '', display: '', background: '', aspectRatio: '', setProperty() {} };
}

function makeContext(canvas) {
  return {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    clearRect() {}, fillRect() {}, drawImage() {}, putImageData() {},
    getImageData(x, y, w, h) {
      const width = Math.max(0, Math.floor(w));
      const height = Math.max(0, Math.floor(h));
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0; data[i + 1] = 177; data[i + 2] = 64; data[i + 3] = 255;
      }
      return { width, height, data };
    },
  };
}

function createElement(tagName, id) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    id: id || '',
    parentNode: null,
    childNodes: [],
    style: makeStyle(),
    dataset: {},
    attributes: {},
    classes: new Set(),
    listeners: new Map(),
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    files: [],
    src: '',
    srcObject: null,
    videoWidth: 0,
    videoHeight: 0,
    readyState: 0,
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    width: 300,
    height: 150,
    muted: false,
    loop: false,
    playsInline: false,
    preload: '',
    decoding: '',
    styleSheet: null,
  };

  el.classList = {
    add: (...names) => names.forEach((n) => el.classes.add(n)),
    remove: (...names) => names.forEach((n) => el.classes.delete(n)),
    contains: (name) => el.classes.has(name),
    toggle: (name, force) => {
      const has = el.classes.has(name);
      const next = typeof force === 'boolean' ? force : !has;
      if (next) el.classes.add(name); else el.classes.delete(name);
      return next;
    },
  };

  Object.defineProperty(el, 'className', {
    get() { return Array.from(el.classes).join(' '); },
    set(value) {
      el.classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
    },
  });

  Object.defineProperty(el, 'nextSibling', {
    get() {
      if (!el.parentNode) return null;
      const idx = el.parentNode.childNodes.indexOf(el);
      return el.parentNode.childNodes[idx + 1] || null;
    },
  });

  el.setAttribute = (name, value) => {
    el.attributes[name] = String(value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[key] = String(value);
    }
  };
  el.getAttribute = (name) => (name in el.attributes ? el.attributes[name] : null);
  el.removeAttribute = (name) => { delete el.attributes[name]; };
  el.hasAttribute = (name) => name in el.attributes;

  el.appendChild = (child) => {
    if (child.parentNode) child.parentNode.removeChild(child);
    el.childNodes.push(child);
    child.parentNode = el;
    return child;
  };
  el.insertBefore = (child, ref) => {
    if (child.parentNode) child.parentNode.removeChild(child);
    const idx = ref ? el.childNodes.indexOf(ref) : -1;
    if (idx < 0) el.childNodes.push(child); else el.childNodes.splice(idx, 0, child);
    child.parentNode = el;
    return child;
  };
  el.removeChild = (child) => {
    const idx = el.childNodes.indexOf(child);
    if (idx >= 0) el.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  };
  el.replaceChildren = (...nodes) => {
    el.childNodes.forEach((c) => { c.parentNode = null; });
    el.childNodes = [];
    nodes.forEach((n) => el.appendChild(n));
  };

  el.addEventListener = (type, handler) => {
    if (!el.listeners.has(type)) el.listeners.set(type, []);
    el.listeners.get(type).push(handler);
  };
  el.removeEventListener = (type, handler) => {
    const list = el.listeners.get(type) || [];
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  };
  el.dispatch = (type, props) => {
    const event = Object.assign({ type, target: el, preventDefault() {}, stopPropagation() {} }, props || {});
    (el.listeners.get(type) || []).slice().forEach((fn) => fn(event));
    return event;
  };
  el.click = () => el.dispatch('click', {});

  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: el.width || 640, height: el.height || 480 });
  el.getContext = (kind) => {
    if (kind !== '2d') return null;
    if (!el._ctx) el._ctx = makeContext(el);
    return el._ctx;
  };
  el.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
  el.captureStream = () => ({ id: 'stream' });
  el.load = () => {};
  el.play = () => Promise.resolve();
  el.pause = () => {};
  el.focus = () => {};

  return el;
}

/* ------------------------------------------------------------- entorno --- */

function createEnv(options = {}) {
  const search = options.search || '';
  const href = options.href || (PAGE_URL + search);

  const registry = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();

  const body = createElement('body');
  const head = createElement('head');
  const docEl = createElement('html');
  docEl.appendChild(head);
  docEl.appendChild(body);

  const findById = (root, id) => {
    if (!root) return null;
    if (root.id === id) return root;
    for (const child of root.childNodes || []) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  };

  const document = {
    body,
    head,
    documentElement: docEl,
    title: 'Chroma Key Pro',
    readyState: 'loading',
    fullscreenElement: null,
    webkitFullscreenElement: null,
    msFullscreenElement: null,
    exitFullscreen: () => { document.fullscreenElement = null; return Promise.resolve(); },
    webkitExitFullscreen: () => Promise.resolve(),
    msExitFullscreen: () => Promise.resolve(),
    createElement: (tag) => createElement(tag),
    getElementById: (id) => {
      const found = findById(docEl, id);
      if (found) { registry.set(id, found); return found; }
      if (!registry.has(id)) registry.set(id, createElement('div', id));
      return registry.get(id);
    },
    querySelectorAll: (selector) => {
      if (selector === '[data-v]') return registry.get('__viewButtons__') || [];
      if (selector === '[data-p]') return registry.get('__presetButtons__') || [];
      return [];
    },
    addEventListener: (type, handler) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener: () => {},
    dispatch: (type, props) => {
      const event = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, props || {});
      (documentListeners.get(type) || []).slice().forEach((fn) => fn(event));
      return event;
    },
  };

  const rafQueue = [];
  let clock = 1000;
  let timerId = 0;
  const timers = new Map();

  const api = {
    opened: [],
    closed: 0,
    focused: 0,
    revoked: [],
    created: [],
    streams: [],
    getUserMediaCalls: [],
    nextGetUserMediaError: null,
    fullscreenRequests: 0,
  };

  function makeStream(deviceId) {
    const tracks = [{
      stopped: false,
      stop() { this.stopped = true; },
      getSettings() { return { deviceId }; },
    }];
    return { getTracks: () => tracks, tracks, deviceId };
  }

  const location = { href, search, pathname: PAGE_PATH };

  const ctx = {
    console,
    URLSearchParams,
    URL: (() => {
      class MockURL extends URL {}
      MockURL.createObjectURL = () => {
        const url = 'blob:mock/' + (api.created.length + 1);
        api.created.push(url);
        return url;
      };
      MockURL.revokeObjectURL = (url) => api.revoked.push(url);
      return MockURL;
    })(),
    Blob: typeof Blob !== 'undefined' ? Blob : class { constructor(parts, opts) { this.parts = parts; this.type = (opts || {}).type || ''; } },
    Image: class {
      constructor() { this.onload = null; this.onerror = null; this._src = ''; this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
      get src() { return this._src; }
      set src(v) { this._src = v; }
    },
    MediaRecorder: class {
      static isTypeSupported() { return true; }
      constructor(stream, opts) { this.stream = stream; this.mimeType = (opts && opts.mimeType) || 'video/webm'; this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; if (this.onstop) this.onstop({}); }
    },
    navigator: {
      mediaDevices: {
        async getUserMedia(constraints) {
          api.getUserMediaCalls.push(constraints);
          if (api.nextGetUserMediaError) {
            const error = api.nextGetUserMediaError;
            api.nextGetUserMediaError = null;
            throw error;
          }
          const stream = makeStream('cam-' + (api.streams.length + 1));
          api.streams.push(stream);
          return stream;
        },
        async enumerateDevices() {
          return [{ kind: 'videoinput', deviceId: 'cam-1', label: 'Cámara 1' }];
        },
        addEventListener() {},
      },
    },
    performance: { now: () => clock },
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
    clearInterval: (id) => clearInterval(id),
    location,
    document,
    screen: { width: 1920, height: 1080 },
    self: null,
    top: null,
    open: (url, name, features) => {
      api.opened.push({ url, name, features });
      return { closed: false, focus() { api.focused += 1; } };
    },
    close: () => { api.closed += 1; },
    addEventListener: (type, handler) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      const list = windowListeners.get(type) || [];
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    },
  };

  ctx.window = ctx;
  ctx.self = ctx;
  ctx.top = ctx;
  ctx.globalThis = ctx;

  docEl.requestFullscreen = () => { api.fullscreenRequests += 1; document.fullscreenElement = docEl; return Promise.resolve(); };
  docEl.webkitRequestFullscreen = docEl.requestFullscreen;
  docEl.msRequestFullscreen = docEl.requestFullscreen;

  vm.createContext(ctx);

  /* --- contenido del HTML --- */
  const byId = (id, tag, parent) => {
    const el = document.getElementById(id);
    el.tagName = (tag || 'DIV').toUpperCase();
    if (parent) parent.appendChild(el);
    return el;
  };

  const main = byId('main', 'main', body);
  const stage = byId('stage', 'div', main);
  byId('out', 'canvas', stage).width = 640;
  byId('out', 'canvas', stage).height = 480;
  byId('ph', 'div', stage);
  byId('badge', 'span', stage);
  byId('msg', 'p', main);
  byId('chips', 'div', main);
  byId('color', 'input', main).value = '#00b140';
  byId('btnAdd', 'button', main);
  byId('btnDel', 'button', main);
  byId('btnAuto', 'button', main);
  byId('sl', 'div', main);
  byId('btnCam', 'button', main);
  byId('btnFlip', 'button', main);
  byId('btnTab', 'button', main);
  byId('camList', 'select', main).value = '';
  byId('vidSrc', 'input', main);
  byId('q', 'select', main).value = '960';
  byId('btnMirror', 'button', main);
  byId('file', 'input', main);
  byId('btnClear', 'button', main);
  byId('bgc', 'input', main).value = '#1d1d1f';
  byId('btnShot', 'button', main);
  byId('btnRec', 'button', main);
  byId('btnObs', 'button', main);

  const viewButtons = ['result', 'matte', 'orig'].map((v) => {
    const b = createElement('button');
    b.setAttribute('data-v', v);
    if (v === 'result') b.classList.add('on');
    return b;
  });
  registry.set('__viewButtons__', viewButtons);

  const presetButtons = ['#00b140', '#0047bb', '#ff00ff'].map((p) => {
    const b = createElement('button');
    b.setAttribute('data-p', p);
    return b;
  });
  registry.set('__presetButtons__', presetButtons);

  const cam = byId('cam', 'video', body);
  cam.play = () => Promise.resolve();
  cam.load = () => {};

  /* --- carga de scripts --- */
  const globalsBefore = Object.keys(ctx).sort();
  for (const rel of SCRIPTS) {
    const file = path.join(ROOT, rel);
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, ctx, { filename: rel });
  }

  return {
    ctx,
    api,
    registry,
    globalsBefore,
    document,
    body,
    cam,
    get: (id) => document.getElementById(id),
    fire: (el, type, props) => el.dispatch(type, props),
    fireWindow: (type, props) => {
      const event = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, props || {});
      (windowListeners.get(type) || []).slice().forEach((fn) => fn(event));
      return event;
    },
    fireDocument: (type, props) => document.dispatch(type, props),
    stepFrames: (count, dt) => {
      for (let i = 0; i < count; i++) {
        clock += dt === undefined ? 16 : dt;
        const queue = rafQueue.splice(0, rafQueue.length);
        queue.forEach((fn) => fn(clock));
      }
    },
    setClock: (ms) => { clock = ms; },
    tick: async () => { await new Promise((r) => setTimeout(r, 0)); },
  };
}

/* ------------------------------------------------------------- pruebas --- */

async function run() {
  section('1. Carga de módulos y estructura');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    check('CK existe', Boolean(CK));
    ['config', 'dom', 'engine', 'background', 'segmentation', 'camera', 'capture', 'obs', 'app'].forEach((m) => {
      check('módulo CK.' + m + ' disponible', Boolean(CK[m]));
    });
    check('config es inmutable', (() => {
      try { CK.config.camera.idealWidth = 1; } catch (_) { /* strict mode */ }
      return CK.config.camera.idealWidth === 1280;
    })());
    check('sliders generados (7)', env.get('sl').childNodes.length === 7);
    check('slider tol creado con valor 30', env.get('tol') && env.get('tol').value === '30');
    check('etiqueta tolV muestra 30', env.get('tolV') && env.get('tolV').textContent === '30');
    check('motor sincronizado con los sliders', CK.engine.settings.tol === 30 && CK.engine.settings.spill === 60);
    check('chip inicial renderizado', env.get('chips').childNodes.length === 1);
    check('color inicial en el selector', env.get('color').value === '#00b140');
    check('el canvas no se movió en la ventana principal', env.get('out').parentNode === env.get('stage'));
    check('body sin clase obs-mode-active', !env.body.classes.has('obs-mode-active'));
    check('botón de salida creado', env.get('obsExitBtn').parentNode === env.body);
    check('capa de avisos OBS creada', env.get('obsMsg').parentNode === env.body);
    check('vídeo de fondo creado', env.get('bgVideo').parentNode === env.body);
  }

  section('2. Controles de colores');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    env.fire(env.get('btnAdd'), 'click');
    check('btnAdd añade una clave', env.get('chips').childNodes.length === 2);
    check('btnAdd marca la nueva como activa', env.get('chips').childNodes[1].classes.has('on'));
    for (let i = 0; i < 5; i++) env.fire(env.get('btnAdd'), 'click');
    check('máximo de 5 claves respetado', env.get('chips').childNodes.length === CK.config.keys.max);
    env.fire(env.get('btnDel'), 'click');
    check('btnDel quita una clave', env.get('chips').childNodes.length === 4);
    for (let i = 0; i < 10; i++) env.fire(env.get('btnDel'), 'click');
    check('mínimo de 1 clave respetado', env.get('chips').childNodes.length === 1);

    const preset = env.registry.get('__presetButtons__')[1]; // Azul
    env.fire(preset, 'click');
    const state = CK.app.getState();
    check('preset aplicado a la clave activa', state.keys[0].b === 187 && state.keys[0].r === 0);
    check('selector de color sincronizado', env.get('color').value === '#0047bb');

    env.fire(env.get('chips').childNodes[0], 'click');
    check('clic en chip cambia la clave activa', CK.app.getState().activeKey === 0);
  }

  section('3. Vistas (resultado / máscara / original)');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    const viewButtons = env.registry.get('__viewButtons__');
    env.fire(viewButtons[1], 'click');
    check('vista matte activa', CK.app.getState().view === 'matte');
    check('clase .on sólo en la vista activa', viewButtons[1].classes.has('on') && !viewButtons[0].classes.has('on'));
    env.fire(viewButtons[2], 'click');
    check('vista orig activa', CK.app.getState().view === 'orig');
  }

  section('4. Cámara');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    const ok = await CK.camera.start();
    check('start() devuelve true con permiso', ok === true);
    check('stream activo', Boolean(CK.camera.getState().stream));
    check('kind = camera', CK.camera.getState().kind === 'camera');
    check('srcObject asignado al <video>', env.cam.srcObject !== null);
    check('espejo activo por defecto', CK.camera.isMirrored() === true);
    check('botón "Cámara activa" mostrado', env.get('btnCam').textContent === 'Cámara activa ✓');
    check('botón de cambio habilitado', env.get('btnFlip').disabled === false);

    const first = CK.camera.getState().stream;
    const second = await CK.camera.start();
    check('segundo start() correcto', second === true);
    check('el stream anterior se detiene al reemplazarlo', first.tracks[0].stopped === true);
    check('el nuevo stream sigue activo', CK.camera.getState().stream.tracks[0].stopped === false);

    // Permiso denegado: no debe perder la cámara que ya funcionaba.
    const active = CK.camera.getState().stream;
    const denied = new Error('denegado');
    denied.name = 'NotAllowedError';
    env.api.nextGetUserMediaError = denied;
    const result = await CK.camera.start();
    check('start() devuelve false si se deniega', result === false);
    check('el stream previo sigue vivo tras el rechazo', active.tracks[0].stopped === false);
    check('el stream activo no se sustituye', CK.camera.getState().stream === active);
    check('mensaje de error mostrado', env.get('msg').className === 'err');

    await CK.camera.listDevices();
    check('camaras enumeradas en el selector', env.get('camList').childNodes.length === 2);
  }

  section('5. Bucle de render');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    // Calidad reducida para que el banco no tarde una eternidad.
    env.get('q').value = '640';
    env.fire(env.get('q'), 'change');

    await CK.camera.start();
    env.cam.videoWidth = 1280;
    env.cam.videoHeight = 720;
    env.cam.readyState = 2;

    env.stepFrames(1);
    check('el motor redimensionó al tamaño del vídeo', CK.engine.raw.width === 640 && CK.engine.raw.height === 360,
      CK.engine.raw.width + 'x' + CK.engine.raw.height);
    check('aspect-ratio del stage actualizado', env.get('stage').style.aspectRatio === '640/360');
    check('el bucle está corriendo', CK.app.getState().running === true);
    check('placeholder oculto', env.get('ph').style.display === 'none');
    check('botones de captura habilitados', env.get('btnShot').disabled === false && env.get('btnRec').disabled === false);

    env.stepFrames(1, 1200);
    check('badge con resolución y FPS', /\d+×\d+ · \d+ fps/.test(env.get('badge').textContent), env.get('badge').textContent);

    // La vista "original" no debe lanzar.
    env.fire(env.registry.get('__viewButtons__')[2], 'click');
    env.stepFrames(1);
    check('vista original se renderiza sin errores', env.get('msg').className !== 'err');

    // La vista "máscara" no debe lanzar.
    env.fire(env.registry.get('__viewButtons__')[1], 'click');
    env.stepFrames(1);
    check('vista máscara se renderiza sin errores', env.get('msg').className !== 'err');
  }

  section('6. Muestreo de color y detección automática');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    await CK.camera.start();
    env.cam.videoWidth = 320;
    env.cam.videoHeight = 240;
    env.cam.readyState = 2;
    env.stepFrames(1);

    env.fire(env.get('btnAuto'), 'click');
    const auto = CK.app.getState().keys[0];
    check('Auto detecta el verde del borde', Math.round(auto.g) === 177 && Math.round(auto.b) === 64, JSON.stringify(auto));

    const preset = env.registry.get('__presetButtons__')[1];
    env.fire(preset, 'click');
    check('preset aplicado antes del muestreo', CK.app.getState().keys[0].b === 187);

    env.fire(env.get('out'), 'click', { clientX: 100, clientY: 100 });
    const sampled = CK.app.getState().keys[0];
    check('clic en el canvas muestrea el color del vídeo', Math.round(sampled.g) === 177 && Math.round(sampled.b) === 64, JSON.stringify(sampled));
  }

  section('7. Throttle de errores en el bucle');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    await CK.camera.start();
    env.cam.videoWidth = 320;
    env.cam.videoHeight = 240;
    env.cam.readyState = 2;
    env.stepFrames(1);

    const original = CK.engine.process;
    CK.engine.process = () => { throw new Error('fallo simulado'); };

    env.stepFrames(3);
    check('el error se notifica', env.get('msg').textContent.startsWith('Error al procesar'), env.get('msg').textContent);
    check('mensaje de error establecido', env.get('msg').className === 'err');
    CK.engine.process = original;
    env.stepFrames(1);
    check('el bucle sigue vivo tras el error', CK.app.getState().running === true);
  }

  section('8. Fondo (imagen / vídeo local)');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    const file = { type: 'image/png', name: 'bg.png' };
    const input = env.get('file');
    input.files = [file];
    env.fire(input, 'change');
    check('object URL creada para el fondo', env.api.created.length === 1);
    env.fire(env.get('btnClear'), 'click');
    check('object URL revocada al quitar el fondo', env.api.revoked.length === 1 && env.api.revoked[0] === env.api.created[0]);
  }

  section('9. Vídeo local como fuente (fuga de object URL)');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    const input = env.get('vidSrc');
    input.files = [{ type: 'video/mp4', name: 'clip.mp4' }];
    env.fire(input, 'change');
    await env.tick();
    check('object URL creada para el vídeo local', env.api.created.length === 1);
    check('el espejo se desactiva con vídeo local', CK.camera.isMirrored() === false);
    check('la fuente pasa a "file"', CK.camera.getState().kind === 'file');
    check('el botón de espejo refleja el estado', env.get('btnMirror').textContent === 'Espejo: no');

    await CK.camera.start();
    check('al cambiar a cámara se revoca la URL del vídeo local', env.api.revoked.includes(env.api.created[0]));
  }

  section('10. Modo OBS: ventana emergente');
  {
    const env = createEnv();
    const CK = env.ctx.CK;
    env.fire(env.get('btnObs'), 'click');
    check('window.open llamado', env.api.opened.length === 1);
    const call = env.api.opened[0];
    check('URL con ?obs=1 sobre el href completo', call.url === PAGE_URL + '?obs=1', call.url);
    check('nombre de ventana correcto', call.name === CK.config.obs.windowName);
    check('features sin barras', /menubar=no/.test(call.features) && /toolbar=no/.test(call.features) && /location=no/.test(call.features));
    check('la ventana principal NO se oculta', !env.body.classes.has('obs-mode-active'));

    env.fire(env.get('btnObs'), 'click');
    check('no se abre un segundo popup', env.api.opened.length === 1);
  }

  section('11. Modo OBS: arranque en la ventana emergente (?obs=1)');
  {
    const env = createEnv({ search: '?obs=1' });
    const CK = env.ctx.CK;
    await env.tick();
    check('CK.obs detecta el popup', CK.obs.isPopup === true);
    check('body con clase obs-mode-active', env.body.classes.has('obs-mode-active'));
    check('canvas movido a <body>', env.get('out').parentNode === env.body);
    check('posición original del canvas guardada', CK.obs.anchors.canvasHome === env.get('stage'));
    check('título de la ventana cambiado', env.document.title === CK.config.obs.title);
    check('cámara activada automáticamente', Boolean(CK.camera.getState().stream));
    check('fullscreen solicitado', env.api.fullscreenRequests === 1);

    // Salir con Escape cierra la ventana y restaura el DOM.
    env.fireWindow('keydown', { key: 'Escape', keyCode: 27 });
    check('Escape llama a window.close()', env.api.closed === 1);
    check('clase obs-mode-active eliminada', !env.body.classes.has('obs-mode-active'));
    check('canvas restaurado a su sitio original', env.get('out').parentNode === env.get('stage'));
    check('título restaurado', env.document.title === 'Chroma Key Pro');
  }

  section('12. Modo OBS: botón de salida');
  {
    const env = createEnv({ search: '?obs=1' });
    const CK = env.ctx.CK;
    await env.tick();
    check('botón de salida visible en modo OBS', env.get('obsExitBtn').parentNode === env.body);
    env.fire(env.get('obsExitBtn'), 'click');
    check('el botón de salida cierra la ventana', env.api.closed === 1);
    check('modo OBS desactivado', !env.body.classes.has('obs-mode-active'));
  }

  section('13. Modo OBS: salida de pantalla completa native');
  {
    const env = createEnv({ search: '?obs=1' });
    await env.tick();
    env.document.fullscreenElement = null;
    env.fireDocument('fullscreenchange', {});
    check('salir del fullscreen nativo cierra el modo OBS', env.api.closed === 1);
  }

  section('14. Aislamiento: sin fugas de globales');
  {
    const env = createEnv();
    check('window.currentStream eliminado', env.ctx.currentStream === undefined);
    const nuevos = Object.keys(env.ctx).sort().filter((k) => !env.globalsBefore.includes(k));
    check('ningún global nuevo aparte de CK', nuevos.length === 1 && nuevos[0] === 'CK', JSON.stringify(nuevos));
  }

  console.log('\n================================================');
  console.log('  TOTAL: ' + (passed + failed) + '  PASS: ' + passed + '  FAIL: ' + failed);
  if (failures.length) {
    console.log('\n  Fallos:');
    failures.forEach((f) => console.log('   - ' + f));
  }
  console.log('================================================');
  process.exit(failed ? 1 : 0);
}

run().catch((error) => {
  console.error('Error inesperado en el banco de pruebas:', error);
  process.exit(1);
});
