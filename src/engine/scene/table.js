/* 文字PVメーカー v2 — original work. Scene node table: typed-array columns, layers and the world-transform solve (DESIGN §4.17.1–2). */
MV.def('engine/scene/table', ['core/mat'], (MAT) => {
  'use strict';

  // Bump SCHEMA whenever the column list changes (DESIGN §4.17.1 "Changing the column list").
  const SCHEMA = 1;
  const CHUNK = 256;

  const TYPE = Object.freeze({ group: 0, glyph: 1, shape: 2, paint: 3, image: 4, particles: 5, camera: 6 });
  const TYPE_NAMES = Object.freeze(['group', 'glyph', 'shape', 'paint', 'image', 'particles', 'camera']);
  const FLAG = Object.freeze({ hidden: 1, static: 2, pickable: 4, followText: 8 });

  // The 22 pose columns, in the FROZEN order.
  const POSE = Object.freeze(['x', 'y', 'z', 'rot', 'sx', 'sy', 'kx', 'ky', 'rx', 'ry', 'alpha', 'blur', 'reveal', 'tint',
    'glow', 'shard', 'echo', 'jx', 'jy', 'pixel', 'px', 'py']);
  // Combination rules: additive (+=), multiplicative (*=), set (last writer in phase order).
  const ADD = Object.freeze(['x', 'y', 'z', 'rot', 'kx', 'ky', 'rx', 'ry', 'blur', 'tint', 'glow', 'shard', 'echo', 'jx', 'jy',
    'pixel']);
  const MUL = Object.freeze(['sx', 'sy', 'alpha', 'reveal']);
  const SET = Object.freeze(['px', 'py']);
  const ANGLES = Object.freeze(['rot', 'kx', 'ky', 'rx', 'ry']);
  const IDENTITY = Object.freeze(Object.fromEntries(POSE.map((c) => [c, MUL.includes(c) ? 1 : 0])));
  const UNIT_CLAMPED = Object.freeze(['alpha', 'reveal', 'tint', 'glow', 'shard', 'echo']);
  const NON_NEGATIVE = Object.freeze(['blur', 'pixel']);

  const LAYERS = Object.freeze([
    Object.freeze({ name: 'ground', parallax: 0.25 }), Object.freeze({ name: 'far', parallax: 0.5 }),
    Object.freeze({ name: 'mid', parallax: 0.8 }), Object.freeze({ name: 'text', parallax: 1.0 }),
    Object.freeze({ name: 'near', parallax: 1.2 }), Object.freeze({ name: 'hud', parallax: 0 }),
  ]);
  const LAYER_INDEX = Object.freeze(Object.fromEntries(LAYERS.map((l, i) => [l.name, i])));
  const BLENDS = Object.freeze(['source-over', 'multiply', 'screen', 'overlay', 'lighter', 'difference']);

  const PERSPECTIVE = 1600;     // s = 1600 / (1600 + max(z, −1400))
  const Z_MIN = -1400;
  const MIN_ALPHA = 1 / 255;    // a node whose world alpha is below this is not drawn

  class TableError extends Error {
    constructor(code, message) { super(message); this.name = 'TableError'; this.code = code; }
  }

  // --- allocation -------------------------------------------------------------------------------------------

  function poseColumns(cap) {
    const cols = {};
    for (const c of POSE) cols[c] = new Float32Array(cap);
    return cols;
  }

  // createTable(capacity) → NodeTable. Columns grow in chunks of 256, only while a scene is being built.
  function createTable(capacity) {
    const cap = Math.max(CHUNK, Math.ceil((capacity || 0) / CHUNK) * CHUNK);
    return {
      schema: SCHEMA, n: 0, cap,
      type: new Uint8Array(cap), parent: new Int32Array(cap), layer: new Uint8Array(cap), owner: new Uint16Array(cap),
      payload: new Int32Array(cap), flags: new Uint8Array(cap),
      base: poseColumns(cap), live: poseColumns(cap),
      m: new Float32Array(cap * 6), wa: new Float32Array(cap), quad: new Float32Array(cap * 8),
    };
  }

  function grown(arr, cap) {
    const out = new arr.constructor(cap);
    out.set(arr);
    return out;
  }

  function grow(t, need) {
    if (need <= t.cap) return;
    const cap = Math.ceil(need / CHUNK) * CHUNK;
    for (const k of ['type', 'parent', 'layer', 'owner', 'payload', 'flags', 'wa']) t[k] = grown(t[k], cap);
    t.m = grown(t.m, cap * 6);
    t.quad = grown(t.quad, cap * 8);
    for (const c of POSE) { t.base[c] = grown(t.base[c], cap); t.live[c] = grown(t.live[c], cap); }
    t.cap = cap;
  }

  // addNode(t, { type, parent = −1, layer = 3, owner = 0, payload = −1, flags = 0 }) → index. The base pose starts at
  // identity. A parent must already exist, so index order is topological.
  function addNode(t, spec) {
    const parent = spec.parent === undefined || spec.parent === null ? -1 : spec.parent;
    if (!(Number.isInteger(parent) && parent >= -1 && parent < t.n)) {
      throw new TableError('bad-parent', 'parent ' + parent + ' does not exist yet (nodes: ' + t.n + ')');
    }
    if (!(spec.type >= 0 && spec.type < TYPE_NAMES.length)) throw new TableError('bad-type', 'unknown node type ' + spec.type);
    grow(t, t.n + 1);
    const i = t.n++;
    t.type[i] = spec.type;
    t.parent[i] = parent;
    t.layer[i] = spec.layer === undefined ? LAYER_INDEX.text : spec.layer;
    t.owner[i] = spec.owner || 0;
    t.payload[i] = spec.payload === undefined ? -1 : spec.payload;
    t.flags[i] = spec.flags || 0;
    for (const c of POSE) { t.base[c][i] = IDENTITY[c]; t.live[c][i] = IDENTITY[c]; }
    return i;
  }

  // Sets base pose values of node i from a plain object (unknown keys are ignored; angles in radians).
  function setBase(t, i, pose) {
    for (const c of POSE) {
      const v = pose[c];
      if (v !== undefined) { t.base[c][i] = v; t.live[c][i] = v; }
    }
  }

  // --- per frame --------------------------------------------------------------------------------------------

  // Live pose = base pose (whole columns; copies the capacity, so nothing is allocated).
  function resetLive(t) {
    for (let k = 0; k < POSE.length; k++) t.live[POSE[k]].set(t.base[POSE[k]]);
  }

  const LOCAL = new Float32Array(6);
  const PARENT = new Float32Array(6);

  // World transforms and alphas of every node from the pose columns P (default: live). Clamps the live values first
  // (§4.17.1: alpha reveal tint glow shard echo to [0, 1], blur pixel to ≥ 0).
  function solve(t, P, m, wa) {
    const cols = P || t.live, M = m || t.m, A = wa || t.wa;
    clampColumns(cols, t.n);
    for (let i = 0; i < t.n; i++) {
      localMatrix(LOCAL, cols, i);
      const p = t.parent[i];
      const o = i * 6;
      if (p < 0) {
        for (let k = 0; k < 6; k++) M[o + k] = LOCAL[k];
        A[i] = cols.alpha[i];
      } else {
        const q = p * 6;
        for (let k = 0; k < 6; k++) PARENT[k] = M[q + k];
        MAT.mul(LOCAL, PARENT, LOCAL);
        for (let k = 0; k < 6; k++) M[o + k] = LOCAL[k];
        A[i] = A[p] * cols.alpha[i];
      }
    }
  }

  function clampColumns(P, n) {
    for (let k = 0; k < UNIT_CLAMPED.length; k++) {
      const col = P[UNIT_CLAMPED[k]];
      for (let i = 0; i < n; i++) { const v = col[i]; if (v < 0) col[i] = 0; else if (v > 1) col[i] = 1; }
    }
    for (let k = 0; k < NON_NEGATIVE.length; k++) {
      const col = P[NON_NEGATIVE[k]];
      for (let i = 0; i < n; i++) if (col[i] < 0) col[i] = 0;
    }
  }

  // M = T(x + jx + px, y + jy + py) · R(rot) · K(kx, ky) · S(sx·cos(ry)·s, sy·cos(rx)·s) · T(−px, −py)  (FROZEN)
  function localMatrix(out, P, i) {
    const z = P.z[i];
    const s = PERSPECTIVE / (PERSPECTIVE + (z > Z_MIN ? z : Z_MIN));
    const sx = P.sx[i] * Math.cos(P.ry[i]) * s;
    const sy = P.sy[i] * Math.cos(P.rx[i]) * s;
    return MAT.compose(out, P.x[i] + P.jx[i], P.y[i] + P.jy[i], P.rot[i], P.kx[i], P.ky[i], sx, sy, P.px[i], P.py[i]);
  }

  // World matrices of the rest (base) pose, for build-time bounds. Allocates; never call per frame.
  function restWorld(t) {
    const m = new Float32Array(Math.max(1, t.n) * 6);
    const wa = new Float32Array(Math.max(1, t.n));
    const copy = {};
    for (const c of POSE) copy[c] = t.base[c].slice(0, t.n);
    solve(t, copy, m, wa);
    return { m, wa };
  }

  // Node i's world matrix as a view-free copy into out6.
  function worldOf(t, i, out6) {
    const o = i * 6;
    for (let k = 0; k < 6; k++) out6[k] = t.m[o + k];
    return out6;
  }

  // Writes node i's world quad (the local box x0,y0–x1,y1 under its world matrix) into t.quad; for picking.
  const QUAD_M = new Float32Array(6);
  const QUAD_OUT = new Float32Array(8);
  function writeQuad(t, i, x0, y0, x1, y1) {
    MAT.quad(QUAD_OUT, worldOf(t, i, QUAD_M), x0, y0, x1, y1);
    t.quad.set(QUAD_OUT, i * 8);
    return t.quad;
  }

  function isHidden(t, i) { return (t.flags[i] & FLAG.hidden) !== 0 || t.wa[i] < MIN_ALPHA; }

  // True when node i is `anc` or one of its descendants.
  function isUnder(t, i, anc) {
    for (let k = i; k >= 0; k = t.parent[k]) if (k === anc) return true;
    return false;
  }

  // LayerSpec defaults for every LAYERS entry (a scene's own copy; sb.layer patches it).
  function defaultLayers() {
    return LAYERS.map((l) => ({ name: l.name, parallax: l.parallax, blend: 'source-over', opacity: 1, isolate: false,
      filter: null, mask: null, cache: 'none' }));
  }

  // A layer needs its own surface when it is isolated: non-default blend, a filter, a mask or a static cache.
  function isIsolated(spec) {
    return !!(spec.isolate || spec.blend !== 'source-over' || spec.filter || spec.mask || spec.cache === 'static');
  }

  return {
    SCHEMA, CHUNK, TYPE, TYPE_NAMES, FLAG, POSE, ADD, MUL, SET, ANGLES, IDENTITY, LAYERS, LAYER_INDEX, BLENDS,
    PERSPECTIVE, Z_MIN, MIN_ALPHA, TableError,
    createTable, addNode, setBase, resetLive, solve, localMatrix, restWorld, worldOf, writeQuad, isHidden, isUnder,
    defaultLayers, isIsolated,
  };
});
