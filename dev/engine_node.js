/* Load the browser engine (src/*.js except the editor UI) into Node for tests that do not need pixels.
   Canvas calls are stubbed. Text width is a fixed per-character table so results do not depend on
   installed fonts. Intl.Segmenter is hidden by default (the planner then uses its own splitter), because
   word segmentation changes between ICU versions and would make snapshots differ between machines.
   usage: const J = require('./engine_node')({ segmenter: false }); */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

module.exports = function loadEngine(opt = {}) {
  const noop = () => {};
  const width = s => [...String(s)].reduce((w, c) => w + (c === ' ' ? 30 : /[\x21-\x7e]/.test(c) ? 58 : /[｡-ﾟ]/.test(c) ? 50 : 100), 0);
  const ctx2d = new Proxy({}, {
    get: (t, k) => k === 'measureText' ? (s => ({ width: width(s), actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 10 }))
      : (k === 'getImageData' || k === 'createImageData') ? (() => ({ data: new Uint8ClampedArray(4) }))
      : (typeof k === 'string' && /^create/.test(k)) ? (() => ({ addColorStop: noop, setTransform: noop }))
      : k === 'getTransform' ? (() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })) : noop,
    set: () => true,
  });
  const el = () => ({ getContext: () => ctx2d, style: {}, width: 0, height: 0, appendChild: noop, addEventListener: noop, setAttribute: noop, classList: { add: noop, remove: noop, toggle: noop } });
  const IntlShim = opt.segmenter ? Intl : Object.assign(Object.create(Intl), { Segmenter: undefined });
  const sandbox = {
    console, Map, Set, WeakMap, Promise, Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp, Error, Symbol, Proxy, Reflect,
    Uint8Array, Uint8ClampedArray, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, URL, Intl: IntlShim, isFinite, isNaN, parseFloat, parseInt, setTimeout, clearTimeout,
    performance: { now: () => 0 },
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    document: { createElement: el, getElementById: () => null, querySelectorAll: () => [], head: { appendChild: noop }, fonts: { load: async () => [], ready: Promise.resolve(), add: noop }, addEventListener: noop },
    localStorage: { getItem: () => null, setItem: noop },
    OffscreenCanvas: function () { return el(); },
    Path2D: function () { return new Proxy({}, { get: () => noop }); },
    DOMMatrix: function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, scale() { return this; } }; },
    requestAnimationFrame: noop,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js') && (opt.ui || f !== '12_ui.js')).sort();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), sandbox, { filename: 'src/' + f });
  for (const f of opt.extra || []) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox.J;
};
