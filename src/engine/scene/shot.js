/* 文字PVメーカー v2 — original work. Shots: camera keys aimed at the text, resolved at scene build into a closed-form track, and the follow lean (DESIGN_2_1 §3.10, §4.4, §4.5). */
MV.def('engine/scene/shot', ['core/num', 'core/curve', 'core/shot', 'core/script', 'engine/scene/table', 'engine/scene/behave',
  'engine/scene/stagger'],
(N, CV, SHOT, S, T, BH, STG) => {
  'use strict';

  // A cut's `cam.shot` (with cam.zoom, cam.curve, cam.follow and the planner's carry) becomes, at build:
  //   a Track     keys sorted by time, each a framing { X, Y, Z, R } of an aimed box, plus the reading paths;
  //   one camera behaviour (phase LENS, after the lens parts) that composes the track's pose with the lens deltas;
  //   a Lean      the post-solve follow lean toward glyphs that are away from their rest position.
  // Everything per frame is a closed-form lookup over typed arrays with pooled scratch objects (no allocation).

  const DEG = N.DEG;
  const SAFE = 0.05;              // safe margin: this share of the short side on every edge (§4.5.4)
  const FLOOR = 0.06;             // every aimed box is at least this share of the short side per side (§4.5.3)
  const BLEED_HALF = 0.6;         // the half frame (0.5) plus 0.1 of the 0.15 ground and particle bleed (§4.5.4 step 5)
  const PARALLAX_K = Object.freeze([0.5, 1.2]);
  const JUMP = 1 / 120;           // keys closer than this form a deliberate jump (§4.5.2)
  const HOP_MAX = 0.35, HOP_SHARE = 0.6;       // reading hops (§4.5.5)
  const CHUNKS = 4, CHUNK_MIN = 4, WORDS_MAX = 12;
  const BEAT_STEP = 0.5;          // beat anchors without a beat grid step every half second
  const LEAN_EM = 0.6, LEAN_C = 0.1;           // follow lean (§4.5.6)
  const Z_MIN = SHOT.LIMITS.frameZoom[0], Z_MAX = SHOT.LIMITS.frameZoom[1];
  const PLACE_ZOOM = SHOT.LIMITS.zoom;         // frame and point aims: [0.9, 1.25]

  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  // --- aims (§4.5.3) -------------------------------------------------------------------------------------------

  function isSpace(target, j) { return target.cls[j] === 'space'; }

  // Union of the rest boxes of glyphs j (target.box: x0 y0 x1 y1 per glyph) for which keep(j) holds; spaces never count.
  function unionOf(target, keep) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const n = target.to - target.from, b = target.box;
    for (let j = 0; j < n; j++) {
      if (isSpace(target, j) || !keep(j)) continue;
      if (b[j * 4] < x0) x0 = b[j * 4];
      if (b[j * 4 + 1] < y0) y0 = b[j * 4 + 1];
      if (b[j * 4 + 2] > x1) x1 = b[j * 4 + 2];
      if (b[j * 4 + 3] > y1) y1 = b[j * 4 + 3];
    }
    return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // The ordered distinct unit indices ('word' | 'line') of the non-space glyphs.
  function unitsOf(target, unit) {
    const n = target.to - target.from, of = target.unitOf[unit];
    const seen = [];
    for (let j = 0; j < n; j++) if (!isSpace(target, j) && !seen.includes(of[j])) seen.push(of[j]);
    return seen.sort((a, b) => a - b);
  }

  function nonSpace(target) {
    const out = [];
    for (let j = 0; j < target.to - target.from; j++) if (!isSpace(target, j)) out.push(j);
    return out;
  }

  // The k-th entry of a list, negative k counting from the end, clamped into the list.
  function pick(list, k) {
    if (list.length === 0) return undefined;
    return list[clamp(k < 0 ? list.length + k : k, 0, list.length - 1)];
  }

  // [first, last] glyph of the first emphasized run (spaces inside it included), or null.
  function emphRun(target) {
    const n = target.to - target.from;
    let first = -1, last = -1;
    for (let j = 0; j < n; j++) {
      if (!target.emph[j]) { if (first >= 0 && !isSpace(target, j)) break; continue; }
      if (first < 0) first = j;
      last = j;
    }
    return first < 0 ? null : [first, last];
  }

  function floored(box, m) {
    if (!box) return null;
    const w = Math.max(box.w, m), h = Math.max(box.h, m);
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  function wordBox(target, k) {
    const word = pick(unitsOf(target, 'word'), k);
    return word === undefined ? null : unionOf(target, (j) => target.unitOf.word[j] === word);
  }

  // aimBox(env, target, aim, key?) → Box { x, y, w, h } in rest-world du, or null when the aim finds no glyph. Text
  // boxes are floored at 0.06 × short per side. 'frame' is the design frame; 'point' the point (key.px, key.py) of it;
  // 'reading' (a path, §4.5.5) reports the text block.
  function aimBox(env, target, aim, key) {
    const D = env.D, m = FLOOR * D.short;
    if (aim === 'frame') return { x: 0, y: 0, w: D.w, h: D.h };
    if (aim === 'point') {
      const px = key && finite(key.px) ? key.px : 0.5, py = key && finite(key.py) ? key.py : 0.5;
      return { x: px * D.w, y: py * D.h, w: 0, h: 0 };
    }
    if (!target || target.to <= target.from) return null;
    let box = null;
    if (aim === 'block' || aim === 'reading') {
      const f = target.focus;
      box = f && f.w > 0 && f.h > 0 ? f : unionOf(target, () => true);
    } else if (aim === 'emph') {
      const run = emphRun(target);
      box = run ? unionOf(target, (j) => j >= run[0] && j <= run[1] && target.emph[j] === 1) : wordBox(target, -1);
    } else if (aim === 'first') box = wordBox(target, 0);
    else if (aim === 'last') box = wordBox(target, -1);
    else {
      const m2 = /^(word|line|glyph):(-?[0-9]+)$/.exec(String(aim));
      if (!m2) return null;
      const k = Number(m2[2]);
      if (m2[1] === 'word') box = wordBox(target, k);
      else if (m2[1] === 'line') {
        const line = pick(unitsOf(target, 'line'), k);
        box = line === undefined ? null : unionOf(target, (j) => target.unitOf.line[j] === line);
      } else {
        const j = pick(nonSpace(target), k);
        box = j === undefined ? null : unionOf(target, (x) => x === j);
      }
    }
    return floored(box, m);
  }

  // --- anchors (§4.5.2) --------------------------------------------------------------------------------------------

  function spanOf(env) {
    const cut = env.cut;
    return cut && finite(cut.t1) && finite(cut.t0) ? Math.max(0, cut.t1 - cut.t0) : Math.max(0, env.times.b);
  }

  // Cut-local sung start of glyph j's word; words' sung fractions are computed once per target and cached on a side table.
  const sungCache = new WeakMap();
  function sungOf(env, target, j) {
    let frac = sungCache.get(target);
    if (!frac) { frac = STG.sungFractions(env, target, 'word'); sungCache.set(target, frac); }
    return frac[j] * spanOf(env);
  }

  function firstGlyphOfWord(target, word) {
    for (let j = 0; j < target.to - target.from; j++) if (!isSpace(target, j) && target.unitOf.word[j] === word) return j;
    return -1;
  }

  // anchorTime(env, target, at, dt) → cut-local seconds (sung start = 0), dt added, clamped to [times.a, times.b].
  function anchorTime(env, target, at, dt) {
    const tm = env.times, span = spanOf(env);
    let t;
    if (finite(at)) t = tm.a + at * (tm.b - tm.a);
    else if (at === 'a' || at === 'rest' || at === 'out' || at === 'b') t = tm[at];
    else if (at === 'sung') t = 0;
    else if (at === 'mid') t = span / 2;
    else if (at === 'end') t = span;
    else if (at === 'emph') {
      const run = target ? emphRun(target) : null;
      t = run ? sungOf(env, target, run[0]) : span / 2;
    } else {
      const m = /^(word|beat):(-?[0-9]+)$/.exec(String(at));
      const k = m ? Number(m[2]) : 0;
      if (m && m[1] === 'word' && target) {
        const word = pick(unitsOf(target, 'word'), k);
        const j = word === undefined ? -1 : firstGlyphOfWord(target, word);
        t = j >= 0 ? sungOf(env, target, j) : span / 2;
      } else if (m && m[1] === 'beat') {
        const g = env.grid;
        if (g && g.period > 0) {
          const b0 = g.beatAt(0);
          t = (b0.phase === 0 ? 0 : g.period - b0.since) + Math.max(0, k) * g.period;
        } else t = Math.max(0, k) * BEAT_STEP;
      } else t = span / 2;
    }
    t += finite(dt) ? dt : 0;
    return clamp(t, tm.a, tm.b);
  }

  // --- framing (§4.5.4, FROZEN math) -------------------------------------------------------------------------------

  // The largest camera offset along one axis (length L of the frame) at zoom Z that keeps the layers with parallax 0.5
  // and 1.2 covered by their bleed: L · min_k (0.6 − 0.5 / (1 + (Z − 1)·k)) / k.
  function bleedLimit(L, Z) {
    let best = Infinity;
    for (const k of PARALLAX_K) best = Math.min(best, (BLEED_HALF - 0.5 / (1 + (Z - 1) * k)) / k);
    return Math.max(0, L * best);
  }

  // The camera offset for aim centre c (one axis, from the frame centre), screen position s, zoom Z, clamped to the
  // bleed limit.
  function offsetOf(c, s, Z, L) {
    const lim = bleedLimit(L, Z);
    return clamp(c - s / Z, -lim, lim);
  }

  // frame(D, box, key) → { X, Y, Z, R, cx, cy, sx, sy }: the camera that shows `box` as `key` asks. Text aims (key.fill)
  // fill that share of the frame with the box's larger side; frame and point aims use key.zoom. ox/oy place the aim
  // centre (frame fractions from the centre), absent = keep it where the composition put it; the zoomed box stays in
  // the safe area and the camera within the bleed. cx, cy = the aim centre and sx, sy = its screen position, both from
  // the frame centre (du): interpolating them and Z gives the in-between framings. R in radians.
  function frame(D, box, key) {
    const m = FLOOR * D.short;
    const text = finite(key.fill);
    const w = text ? Math.max(box.w, m) : 0, h = text ? Math.max(box.h, m) : 0;
    const Z = text ? clamp(key.fill * Math.min(D.w / w, D.h / h), Z_MIN, Z_MAX)
      : clamp(finite(key.zoom) ? key.zoom : 1, PLACE_ZOOM[0], PLACE_ZOOM[1]);
    return place(D, box.x + box.w / 2 - D.w / 2, box.y + box.h / 2 - D.h / 2, w, h, Z, key);
  }

  // Steps 2–5 of §4.5.4 for an aim centre (cx, cy from the frame centre) of size w × h (0 × 0 for frame and point aims)
  // at zoom Z: the screen position (keep, or ox/oy), clamped so the zoomed box stays in the safe area; the camera
  // offset, clamped to the bleed; and the screen position that clamped camera really gives, so interpolation passes
  // through this framing exactly.
  function place(D, cx, cy, w, h, Z, key) {
    const s = SAFE * D.short;
    const ax = Math.max(0, D.w / 2 - s - (w * Z) / 2), ay = Math.max(0, D.h / 2 - s - (h * Z) / 2);
    const sx0 = clamp(finite(key.ox) ? key.ox * D.w : cx, -ax, ax), sy0 = clamp(finite(key.oy) ? key.oy * D.h : cy, -ay, ay);
    const X = offsetOf(cx, sx0, Z, D.w), Y = offsetOf(cy, sy0, Z, D.h);
    return { X, Y, Z, R: (finite(key.roll) ? key.roll : 0) * DEG, cx, cy, sx: (cx - X) * Z, sy: (cy - Y) * Z };
  }

  // --- the reading path (§4.5.5) -----------------------------------------------------------------------------------

  // The reading units of a target: words; one word of ≥ 4 glyphs → up to 4 equal chunks in reading order; more than 12
  // words → lines. Each unit: its glyphs' box (floored), its centre and its sung start τ (cut-local).
  function readingUnits(env, target) {
    const glyphs = nonSpace(target);
    const words = unitsOf(target, 'word');
    const span = spanOf(env);
    const groups = [];
    let times;
    if (words.length === 1 && glyphs.length >= CHUNK_MIN) {
      const k = Math.min(CHUNKS, glyphs.length);
      for (let c = 0; c < k; c++) {
        groups.push(glyphs.slice(Math.floor((c * glyphs.length) / k), Math.floor(((c + 1) * glyphs.length) / k)));
      }
      const lang = target.lang || (env.cut && env.cut.lang) || 'ja';
      const mor = groups.map((g) => S.morae(g.map((j) => target.ch[j]).join(''), lang));
      const total = mor.reduce((a, b) => a + b, 0);
      times = [];
      let acc = 0;
      for (let c = 0; c < k; c++) { times.push(total > 0 ? (acc / total) * span : (c / k) * span); acc += mor[c]; }
    } else {
      const unit = words.length > WORDS_MAX ? 'line' : 'word';
      const frac = STG.sungFractions(env, target, unit);
      for (const u of unitsOf(target, unit)) groups.push(glyphs.filter((j) => target.unitOf[unit][j] === u));
      times = groups.map((g) => frac[g[0]] * span);
    }
    const m = FLOOR * env.D.short;
    const n = groups.length;
    const out = { n, tau: new Float64Array(n), start: new Float64Array(n), cx: new Float64Array(n), cy: new Float64Array(n),
      boxes: [] };
    for (let k = 0; k < n; k++) {
      const box = floored(unionOf(target, (j) => groups[k].includes(j)), m);
      out.boxes.push(box);
      out.cx[k] = box.x + box.w / 2 - env.D.w / 2;
      out.cy[k] = box.y + box.h / 2 - env.D.h / 2;
      out.tau[k] = Math.max(k > 0 ? out.tau[k - 1] : -Infinity, times[k]);
      const hop = k > 0 ? Math.min(HOP_MAX, HOP_SHARE * (out.tau[k] - out.tau[k - 1])) : 0;
      out.start[k] = out.tau[k] - hop;
    }
    return out;
  }

  // One reading key's path over the units: a constant zoom (the key's fill on the median-area unit box, so the zoom
  // never pumps) and each unit's screen position (keep, or the key's ox/oy), clamped like a key.
  function readingPath(D, units, key) {
    const byArea = units.boxes.map((b, k) => [b.w * b.h, k]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const Zr = frame(D, units.boxes[byArea[Math.floor(byArea.length / 2)][1]], { fill: key.fill }).Z;
    const sx = new Float64Array(units.n), sy = new Float64Array(units.n);
    for (let k = 0; k < units.n; k++) {
      const b = units.boxes[k];
      const f = place(D, units.cx[k], units.cy[k], b.w, b.h, Zr, key);
      sx[k] = f.sx; sy[k] = f.sy;
    }
    return { units, lz: Math.log(Zr), Z: Zr, sx, sy, curve: CV.fn(key.curve), R: (finite(key.roll) ? key.roll : 0) * DEG };
  }

  // The index of the last unit whose hop has started by t (−1 before the first), by binary search.
  function unitAt(start, n, t) {
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (start[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }

  // Fills scratch q { c x, c y, s x, s y, lz, R } with the reading pose at t: holding a unit, or hopping into it.
  function pathAt(path, t, q) {
    const u = path.units;
    const k = Math.max(0, unitAt(u.start, u.n, t));
    q.lz = path.lz; q.R = path.R;
    if (k > 0 && t < u.tau[k]) {
      const h = u.tau[k] - u.start[k];
      const f = h > 0 ? path.curve((t - u.start[k]) / h) : 1;
      q.cx = u.cx[k - 1] + (u.cx[k] - u.cx[k - 1]) * f; q.cy = u.cy[k - 1] + (u.cy[k] - u.cy[k - 1]) * f;
      q.sx = path.sx[k - 1] + (path.sx[k] - path.sx[k - 1]) * f; q.sy = path.sy[k - 1] + (path.sy[k] - path.sy[k - 1]) * f;
      return q;
    }
    q.cx = u.cx[k]; q.cy = u.cy[k]; q.sx = path.sx[k]; q.sy = path.sy[k];
    return q;
  }

  // --- the track ---------------------------------------------------------------------------------------------------

  // Track = { a, b, n, W, H, keys: [{ t, X, Y, Z, R, cx, cy, sx, sy, box, aim }], t, lz, cx, cy, sx, sy, R (typed arrays),
  // curve: [fn: the move INTO key i], paths: [reading path | null], reading, Zread, live: { x, y, zoom, roll } }.
  // `live` is the pose of the latest evaluation (runShot writes it): frame.cameraAt reads the framing zoom from it.
  function buildTrack(env, target, shot) {
    const D = env.D;
    const raw = shot.keys.map((key, i) => ({ key, i, t: anchorTime(env, target, key.at, key.dt) }));
    raw.sort((p, q) => p.t - q.t || p.i - q.i);
    const n = raw.length;
    const track = { a: env.times.a, b: env.times.b, n, W: D.w, H: D.h, keys: [], t: new Float64Array(n),
      lz: new Float64Array(n), cx: new Float64Array(n), cy: new Float64Array(n), sx: new Float64Array(n), sy: new Float64Array(n),
      R: new Float64Array(n), curve: new Array(n), paths: new Array(n).fill(null), reading: null, Zread: null,
      live: { x: 0, y: 0, zoom: 1, roll: 0, ax: 0, ay: 0 } };
    for (let i = 0; i < n; i++) {
      const { key, t } = raw[i];
      track.t[i] = t;
      track.curve[i] = CV.fn(key.curve);
      let f;
      if (key.aim === 'reading') {
        if (!track.reading) track.reading = readingUnits(env, target);
        const path = readingPath(D, track.reading, key);
        track.paths[i] = path;
        if (track.Zread === null) track.Zread = path.Z;
        const q = pathAt(path, t, {});
        f = { Z: path.Z, R: path.R, cx: q.cx, cy: q.cy, sx: q.sx, sy: q.sy };
        f.X = offsetOf(q.cx, q.sx, path.Z, D.w); f.Y = offsetOf(q.cy, q.sy, path.Z, D.h);
      } else {
        const box = aimBox(env, target, key.aim, key) || aimBox(env, target, 'block', key);
        f = frame(D, box, key);
        f.box = box;
      }
      track.lz[i] = Math.log(f.Z); track.cx[i] = f.cx; track.cy[i] = f.cy; track.sx[i] = f.sx; track.sy[i] = f.sy; track.R[i] = f.R;
      const box = f.box || boxAt(track.reading, pathUnitAt(track.paths[i], t));
      track.keys.push(Object.freeze({ t, X: f.X, Y: f.Y, Z: f.Z, R: f.R, cx: f.cx, cy: f.cy, sx: f.sx, sy: f.sy, aim: key.aim,
        box: box ? Object.freeze({ x: box.x, y: box.y, w: box.w, h: box.h }) : null }));
    }
    return track;
  }

  function pathUnitAt(path, t) { return path ? Math.max(0, unitAt(path.units.start, path.units.n, t)) : -1; }
  function boxAt(units, k) { return units && k >= 0 ? units.boxes[k] : null; }

  // Pooled scratch for poseAt (single-threaded; filled and read within one call).
  const QA = { cx: 0, cy: 0, sx: 0, sy: 0, lz: 0, R: 0 };
  const QB = { cx: 0, cy: 0, sx: 0, sy: 0, lz: 0, R: 0 };

  // The pose of key i at time t into q: a still key, or its reading path at t.
  function keyPose(track, i, t, q) {
    const path = track.paths[i];
    if (path) return pathAt(path, t, q);
    q.cx = track.cx[i]; q.cy = track.cy[i]; q.sx = track.sx[i]; q.sy = track.sy[i]; q.lz = track.lz[i]; q.R = track.R[i];
    return q;
  }

  // The index of the last key with t_i ≤ t (−1 before the first key).
  function keyAt(track, t) {
    let lo = 0, hi = track.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (track.t[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }

  function write(track, q, out) {
    const Z = clamp(Math.exp(q.lz), Z_MIN, Z_MAX);
    out.zoom = Z;
    out.x = offsetOf(q.cx, q.sx, Z, track.W);
    out.y = offsetOf(q.cy, q.sy, Z, track.H);
    out.roll = q.R;
    out.ax = Z * (q.cx - out.x);
    out.ay = Z * (q.cy - out.y);
    return out;
  }

  // poseAt(track, t, out) → out { x, y, zoom, roll, ax, ay }: the camera at cut-local t, and (additive) where the aim
  // centre shows on screen (ax, ay from the frame centre, roll 0). Between keys i → j: f = curve_j(u); zoom log-lerped,
  // the aim centre and its screen position lerped, x/y recomputed with the zoom (the aimed word travels straight on
  // screen), roll lerped. Held before the first key and after the last (a reading key keeps reading); keys closer than
  // 1/120 s jump at the later key's time. Allocation-free.
  function poseAt(track, t, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0 };
    const n = track.n;
    const i = keyAt(track, t);
    if (i < 0) return write(track, keyPose(track, 0, track.t[0], QA), o);
    if (i >= n - 1) return write(track, keyPose(track, n - 1, t, QA), o);
    const t0 = track.t[i], t1 = track.t[i + 1];
    const A = keyPose(track, i, t, QA);
    if (t1 - t0 < JUMP) return write(track, A, o);
    const B = keyPose(track, i + 1, t1, QB);
    const f = track.curve[i + 1]((t - t0) / (t1 - t0));
    A.lz += (B.lz - A.lz) * f;
    A.cx += (B.cx - A.cx) * f; A.cy += (B.cy - A.cy) * f;
    A.sx += (B.sx - A.sx) * f; A.sy += (B.sy - A.sy) * f;
    A.R += (B.R - A.R) * f;
    return write(track, A, o);
  }

  // --- the camera behaviour ----------------------------------------------------------------------------------------

  // runShot(P, t, b): after the lens behaviours (phase LENS, build order), compose the shot pose (X, Y, Z, R) with the
  // lens deltas on the camera node so lens amplitudes stay screen-constant under the shot's zoom (§4.4 step 2):
  //   x = X + x_lens/Z;  y = Y + y_lens/Z;  sx = sy = Z · sx_lens;  rot = R + rot_lens;  jx /= Z;  jy /= Z
  function runShot(P, t, b) {
    const pose = poseAt(b.track, t, b.track.live);
    const c = b.from, Z = pose.zoom, zl = P.sx[c];
    P.x[c] = pose.x + P.x[c] / Z;
    P.y[c] = pose.y + P.y[c] / Z;
    P.sx[c] = Z * zl;
    P.sy[c] = Z * zl;
    P.rot[c] = pose.roll + P.rot[c];
    P.jx[c] /= Z;
    P.jy[c] /= Z;
  }

  function textGlyphs(target) {
    if (!target || target.to <= target.from) return 0;
    let n = 0;
    for (let j = 0; j < target.to - target.from; j++) if (!isSpace(target, j)) n++;
    return n;
  }

  // makeShot(env, cam, target, d) → { behaviours, lean, track } | null. env = the cut env (D, times, cut, grid);
  // d = { shot: Decision of cam.shot, zoom, curve, follow } (cam.zoom, cam.curve, cam.follow values; absent → the
  // shot's defaults). null when the shot is 'none' (or unreadable) or the cut has no text.
  function makeShot(env, cam, target, d) {
    const dd = d || {};
    const decision = dd.shot || null;
    const ref = decision ? decision.v : undefined;
    if (ref === undefined || ref === null || ref === 'none' || textGlyphs(target) === 0) return null;
    const carry = decision.p && decision.p.carry ? decision.p.carry : null;
    const shot = SHOT.expandShot(ref, { zoom: finite(dd.zoom) ? dd.zoom : 1, curve: dd.curve === null ? undefined : dd.curve,
      carry, follow: finite(dd.follow) ? dd.follow : null });
    if (!shot) return null;
    const track = buildTrack(env, target, shot);
    const behaviour = { phase: BH.PH.LENS, live: 'always', from: cam, to: cam + 1, t0: env.times.a, t1: env.times.b,
      run: runShot, track };
    return { behaviours: [behaviour], lean: shot.follow > 0 ? leanOf(env, cam, target, shot.follow) : null, track };
  }

  // --- follow lean (§4.5.6) ----------------------------------------------------------------------------------------

  function leanOf(env, cam, target, follow) {
    const n = target.to - target.from;
    const skip = new Uint8Array(n);
    for (let j = 0; j < n; j++) skip[j] = isSpace(target, j) ? 1 : 0;
    return Object.freeze({ follow, cam, from: target.from, n, wx: target.wx, wy: target.wy, em: target.em, skip,
      c: LEAN_C * env.D.short });
  }

  // leanInto(scene): after the solve, lean the camera toward the text glyphs that are away from their rest position:
  //   d_j = world position − rest position; w_j = clamp(|d_j| / (0.6·em_j)) · wa_j
  //   L = Σ w_j·d_j / max(1, Σ w_j);  L' = L · c / (c + |L|), c = 0.1·short;  camera x/y += follow · L' / zoom
  // 0 at rest, bounded by c, continuous wherever the glyph poses are. The camera node has no children: nothing is re-solved.
  function leanInto(scene) {
    const L = scene.lean;
    if (!L || !(L.follow > 0)) return;
    const t = scene.table, m = t.m, wa = t.wa, P = t.live;
    let ax = 0, ay = 0, aw = 0;
    for (let j = 0; j < L.n; j++) {
      if (L.skip[j]) continue;
      const i = L.from + j, a = wa[i];
      if (!(a >= T.MIN_ALPHA)) continue;
      const dx = m[i * 6 + 4] - L.wx[j], dy = m[i * 6 + 5] - L.wy[j];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (!(d > 0)) continue;
      const w = clamp(d / (LEAN_EM * L.em[j]), 0, 1) * (a > 1 ? 1 : a);
      ax += w * dx; ay += w * dy; aw += w;
    }
    if (!(aw > 0)) return;
    const lx = ax / Math.max(1, aw), ly = ay / Math.max(1, aw);
    const k = L.c / (L.c + Math.sqrt(lx * lx + ly * ly));
    const c = L.cam, z = P.sx[c];
    P.x[c] += (L.follow * lx * k) / z;
    P.y[c] += (L.follow * ly * k) / z;
  }

  return { makeShot, aimBox, anchorTime, frame, poseAt, runShot, leanInto, bleedLimit, JUMP, FLOOR, SAFE };
});
