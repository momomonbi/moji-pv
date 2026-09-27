/* 文字PVメーカー v2 — original work. EXTREME shots: the x-track — rotation-aware safe framing, the roll fence, speed caps, jump spacing and beat-locked modulators (DESIGN_EXTREME §1.4). */
MV.def('engine/scene/xshot', ['core/num', 'core/hash', 'core/curve', 'core/shot', 'engine/scene/behave', 'engine/scene/shot'],
(N, H, CV, SHOT, BH, SS) => {
  'use strict';

  // An EXTREME cam.shot (SHOT.isExtreme) becomes, at build, an x-track: keys sorted by time, each a framing (aim centre c,
  // on-screen position P of that centre after the roll, zoom Z, roll R, ground zoom gz), reading paths, the kept
  // deliberate jumps, and the beat modulators as closed-form schedules. One camera behaviour (phase LENS, after the lens
  // parts, like engine/scene/shot) composes the pose with the lens deltas and adds the modulators. Everything per frame is
  // a closed-form lookup with pooled scratch objects (no allocation). The normal track (engine/scene/shot) is not
  // changed: the scene build sends only EXTREME shots here.

  const DEG = N.DEG;
  const XSAFE = 0.08;             // share of the short side kept free on every edge in the sung span
  const XROLL_SUNG = 30;          // |roll| of a key inside the sung span (degrees)
  const XSPIN_LAND = 180;         // |Δroll| of a segment that lands inside the sung span from before it
  const XSPIN_INSIDE = 60;        // |Δroll| of a segment that overlaps the sung span otherwise
  const XROT_SPEED = 540;         // degrees per second, average per segment
  const XZOOM_SPEED = 12;         // |Δ ln Z| per second, average per segment
  const XTRAVEL_SPEED = 10;       // frame widths per second of the aim's on-screen travel, average per segment
  const XJUMP_GAP = 0.4;          // deliberate jumps at least this far apart and from the cut's start a
  const XSNAP = 0.08;             // a jump that comes too early becomes a move of this length
  const PULSE_GAP = 1 / 3, PULSE_ATTACK = 0.035, PULSE_DECAY = 0.14, DOWNBEAT = 1.3;
  const SWING_GAP = 0.5, SWING_FLIP = 0.16;
  const HIT_GAP = 0.5, HIT_HZ = 5, HIT_DECAY = 0.09, HIT_DU = 0.018, HIT_ROLL = 1.2, HIT_WINDOW = 6;
  const CALM = 0.3;               // the modulators under 「激しいカメラを抑える」 (preview only, §3.6)
  const GENTLE = Object.freeze({ roll: 6, beatRoll: 4, off: 0.12, gz: 1.1, hop: 0.2 });   // arrange cam 'gentle' / 'none' (X7)
  const OFF_MAX = 0.6;            // outside the sung span the aim may go this far from the centre (whips leave the frame)
  const BEAT_STEP = 0.5;          // schedules without a beat grid step every half second
  const HOP_SHARE = 0.6;
  const SHUTTER = 1 / 48;         // the motion blur shutter at blur 1, g 1 (seconds; engine/render/xblur)
  const XLEAVE = 0.2;             // a reading path is left over the last XLEAVE s before the next (non-reading) key
  const JUMP = SS.JUMP;
  const XL = SHOT.XLIMITS;
  const Z_MIN = XL.frameZoom[0], Z_MAX = XL.frameZoom[1];
  const PLACE_ZOOM = XL.zoom;
  const EPS = 1e-9;
  const TAU = 2 * Math.PI;
  const DASH = CV.fn('dashStop');

  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  // isX(inputs) → whether the scene build sends the cut's shot here (its cam.shot value is EXTREME).
  function isX(inputs) { return !!(inputs && inputs.shot && inputs.shot.v !== undefined && SHOT.isExtreme(inputs.shot.v)); }

  // --- anchors (X1) --------------------------------------------------------------------------------------------------

  // The first glyph after glyph `last` that starts another word (−1 when none).
  function nextWordGlyph(target, last) {
    const n = target.to - target.from, word = target.unitOf.word[last];
    for (let j = last + 1; j < n; j++) if (target.cls[j] !== 'space' && target.unitOf.word[j] !== word) return j;
    return -1;
  }

  // anchorTime plus accent (the sung start of the emphasized word; without emphasis the first beat at or after the sung
  // start) and accentEnd (the sung start of the first word after the emphasized run; without emphasis `end`).
  function anchorTime(env, target, at, dt) {
    if (at !== 'accent' && at !== 'accentEnd') return SS.anchorTime(env, target, at, dt);
    const run = target ? SS.emphRun(target) : null;
    if (!run) return SS.anchorTime(env, target, at === 'accent' ? 'beat:0' : 'end', dt);
    let t = SS.spanOf(env);
    if (at === 'accent') t = SS.sungOf(env, target, run[0]);
    else {
      const j = nextWordGlyph(target, run[1]);
      if (j >= 0) t = SS.sungOf(env, target, j);
    }
    t += finite(dt) ? dt : 0;
    return clamp(t, env.times.a, env.times.b);
  }

  // --- aims ----------------------------------------------------------------------------------------------------------

  // An x-track's 'emph' aim with an emphasis frames the whole words the emphasized run touches (a run inside a word
  // would crop the rest of that word while it is sung, §3.1 R3); floored like engine/scene/shot's boxes. null without one.
  function emphWordsBox(D, target) {
    const run = SS.emphRun(target);
    if (!run) return null;
    const words = new Set();
    for (let j = run[0]; j <= run[1]; j++) if (target.emph[j] && target.cls[j] !== 'space') words.add(target.unitOf.word[j]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const b = target.box;
    for (let j = 0; j < target.to - target.from; j++) {
      if (target.cls[j] === 'space' || !SS.aimable(target, j) || !words.has(target.unitOf.word[j])) continue;
      x0 = Math.min(x0, b[j * 4]); y0 = Math.min(y0, b[j * 4 + 1]); x1 = Math.max(x1, b[j * 4 + 2]); y1 = Math.max(y1, b[j * 4 + 3]);
    }
    if (!(x0 <= x1)) return null;
    const m = SS.FLOOR * D.short, w = Math.max(x1 - x0, m), h = Math.max(y1 - y0, m);
    return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
  }

  function aimBoxOf(env, target, key) {
    const own = key.aim === 'emph' ? emphWordsBox(env.D, target) : null;
    return own || SS.aimBox(env, target, key.aim, key) || SS.aimBox(env, target, 'block', key);
  }

  // --- geometry ------------------------------------------------------------------------------------------------------

  // Whether some θ = ±c + kπ lies in [lo, hi].
  function crosses(c, lo, hi) {
    for (const x of [c, -c]) {
      const k = Math.ceil((lo - x) / Math.PI - 1e-12);
      if (x + k * Math.PI <= hi + 1e-12) return true;
    }
    return false;
  }

  // The largest on-screen extents [w', h'] of a w × h box rotated by any angle in [lo, hi] (radians): w' = w|cos| + h|sin|
  // peaks (√(w² + h²)) at ±atan2(h, w) + kπ, h' at ±atan2(w, h) + kπ; otherwise the ends decide.
  function rotExtent(w, h, lo, hi) {
    const at = (th) => { const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th)); return [w * c + h * s, w * s + h * c]; };
    const A = at(lo), B = at(hi), r = Math.sqrt(w * w + h * h);
    return [crosses(Math.atan2(h, w), lo, hi) ? r : Math.max(A[0], B[0]), crosses(Math.atan2(w, h), lo, hi) ? r : Math.max(A[1], B[1])];
  }

  // The key's safe-area constants (X3, X4): s = XSAFE·short, hd = the largest hit displacement, pz = the largest pulse,
  // e = the modulated tilt on top of a key's roll (swing and jolt), σ = sin e.
  function envelopeOf(D, shot, hmax) {
    const e = Math.min(Math.PI / 2, (shot.beat.roll + HIT_ROLL * hmax) * DEG);
    return { s: XSAFE * D.short, hd: HIT_DU * D.short * hmax, pz: shot.beat.zoom * DOWNBEAT, e, sigma: Math.sin(e) };
  }

  // Zfit: the largest zoom at which a box of rotated extents [w', h'] fits the XSAFE area under the pulse and the hits.
  function zfit(D, ext, env) {
    const zw = ext[0] > 0 ? (D.w - 2 * env.s - 2 * env.hd) / ext[0] : Infinity;
    const zh = ext[1] > 0 ? (D.h - 2 * env.s - 2 * env.hd) / ext[1] : Infinity;
    return Math.min(zw, zh) / (1 + env.pz);
  }

  // Clamps the on-screen position p = [x, y] of an aim of zoomed extents [w', h']·Z into the XSAFE area, with the pulse,
  // the hits and the swing (which turns p about the frame centre by up to e): |px| + σ|py| ≤ AX and |py| + σ|px| ≤ AY.
  function safeClamp(D, p, ext, Z, env) {
    const AX = Math.max(0, (D.w / 2 - env.s - env.hd) / (1 + env.pz) - (Z * ext[0]) / 2);
    const AY = Math.max(0, (D.h / 2 - env.s - env.hd) / (1 + env.pz) - (Z * ext[1]) / 2);
    let x = clamp(p[0], -AX, AX), y = clamp(p[1], -AY, AY);
    const ax = Math.abs(x), ay = Math.abs(y), sg = env.sigma;
    const need = Math.max((ax + sg * ay) / (AX || EPS), (ay + sg * ax) / (AY || EPS));
    if (need > 1) { x /= need; y /= need; }
    if (!(AX > 0)) x = 0;
    if (!(AY > 0)) y = 0;
    p[0] = x; p[1] = y;
    return p;
  }

  // The camera offset that shows aim centre c at on-screen p under zoom Z and roll θ: X = c − Rot(θ)·p/Z.
  function cameraOf(cx, cy, px, py, Z, th, out) {
    const c = Math.cos(th), s = Math.sin(th);
    out[0] = cx - (c * px - s * py) / Z;
    out[1] = cy - (s * px + c * py) / Z;
    return out;
  }

  // Gentle layouts keep the §4.5.4 bleed clamp: the camera is clamped and p recomputed from it (p = Z·Rot(−θ)·(c − X)).
  function bleedClamp(D, cx, cy, p, Z, th) {
    const X = cameraOf(cx, cy, p[0], p[1], Z, th, [0, 0]);
    const lx = SS.bleedLimit(D.w, Z), ly = SS.bleedLimit(D.h, Z);
    const x = clamp(X[0], -lx, lx), y = clamp(X[1], -ly, ly);
    if (x === X[0] && y === X[1]) return p;
    const c = Math.cos(th), s = Math.sin(th), dx = cx - x, dy = cy - y;
    p[0] = Z * (c * dx + s * dy); p[1] = Z * (-s * dx + c * dy);
    return p;
  }

  // --- segments (X5, X6) ---------------------------------------------------------------------------------------------

  // How segment (t0 → t1) is capped: the key kept is the one closer to the sung span [0, end): { fence (degrees), later
  // (true: the later key gives way) }.
  function segmentRule(t0, t1, end) {
    const in0 = t0 >= -EPS && t0 < end - 1e-6, in1 = t1 >= -EPS && t1 < end - 1e-6;
    if (t1 < -EPS) return { fence: Infinity, later: false };                 // wholly before the singing
    if (t0 >= end - 1e-6) return { fence: Infinity, later: true };           // wholly after it
    if (t0 < -EPS && in1) return { fence: XSPIN_LAND, later: false };         // lands in it
    if (in0 && !in1) return { fence: XSPIN_INSIDE, later: true };             // leaves it
    return { fence: XSPIN_INSIDE, later: false };                            // inside, or across it
  }

  // Caps |v_i − v_{i−1}| ≤ cap(i) (deliberate jumps exempt): a backward pass for the segments whose earlier key gives
  // way, then a forward pass for those whose later key does, so the keys nearest the sung span are kept.
  function capScalar(v, rules, jump, cap, fixed) {
    const n = v.length;
    for (let i = n - 1; i >= 1; i--) {
      if (jump[i] || rules[i].later || fixed[i - 1]) continue;
      const d = v[i - 1] - v[i], c = cap(i);
      if (Math.abs(d) > c) v[i - 1] = v[i] + Math.sign(d) * c;
    }
    for (let i = 1; i < n; i++) {
      if (jump[i] || !rules[i].later || fixed[i]) continue;
      const d = v[i] - v[i - 1], c = cap(i);
      if (Math.abs(d) > c) v[i] = v[i - 1] + Math.sign(d) * c;
    }
  }

  function capVector(px, py, rules, jump, cap, fixed) {
    const n = px.length;
    const pull = (from, to, c) => {
      const dx = px[from] - px[to], dy = py[from] - py[to], d = Math.sqrt(dx * dx + dy * dy);
      if (d > c) { px[from] = px[to] + (dx * c) / d; py[from] = py[to] + (dy * c) / d; }
    };
    for (let i = n - 1; i >= 1; i--) if (!jump[i] && !rules[i].later && !fixed[i - 1]) pull(i - 1, i, cap(i));
    for (let i = 1; i < n; i++) if (!jump[i] && rules[i].later && !fixed[i]) pull(i, i - 1, cap(i));
  }

  // --- modulator schedules (X8, X9) ------------------------------------------------------------------------------------

  // Beats every `every`-th beat of the grid (or every 0.5 s without one), thinned ×2 until they are ≥ gap apart, from
  // the first at or after a to b: { first, step, count, n0 (beat index of the first), E (beats per step), meter }.
  function schedule(grid, a, b, every, gap) {
    const has = grid && grid.period > 0;
    const P = has ? grid.period : BEAT_STEP, origin = has ? grid.offset : 0, meter = has ? grid.meter : 4;
    let E = every > 0 ? every : 1;
    while (E * P < gap - 1e-9) E *= 2;
    const step = E * P;
    let n0 = Math.ceil((a - origin) / P - 1e-9);
    n0 = Math.ceil(n0 / E) * E;
    const first = origin + n0 * P;
    const count = first > b ? 0 : Math.floor((b - first) / step + 1e-9) + 1;
    return { first, step, count, n0, E, meter };
  }

  // The index of the last entry of a sorted array ≤ t (−1 before the first).
  function lastAt(arr, n, t) {
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }

  // pulse(t) = beat.zoom · acc · (since < A ? since/A : exp(−(since − A)/DECAY)), acc = 1.3 on a bar's first beat; the
  // two latest pulses add (so a pulse starting never cuts the previous one's tail off), capped at beat.zoom · 1.3.
  function pulseAt(pl, t) {
    if (!pl || pl.count === 0) return 0;
    const j = Math.min(pl.count - 1, Math.floor((t - pl.first) / pl.step + 1e-9));
    if (j < 0) return 0;
    let sum = 0;
    for (let q = j; q >= 0 && q >= j - 1; q--) {
      const since = t - (pl.first + q * pl.step);
      if (since < 0) continue;
      const idx = pl.n0 + q * pl.E;
      const acc = ((idx % pl.meter) + pl.meter) % pl.meter === 0 ? DOWNBEAT : 1;
      sum += acc * (since < PULSE_ATTACK ? since / PULSE_ATTACK : Math.exp(-(since - PULSE_ATTACK) / PULSE_DECAY));
    }
    return Math.min(pl.amp * sum, pl.amp * DOWNBEAT);
  }

  // swing(t) = beat.roll · s(t), s ∈ {−1, +1} flipping at each scheduled beat with a dashStop ease over SWING_FLIP.
  function swingAt(sw, t) {
    if (!sw) return 0;
    const j = sw.count === 0 ? -1 : Math.min(sw.count - 1, Math.floor((t - sw.first) / sw.step + 1e-9));
    if (j < 0) return sw.amp * sw.s0;
    const prev = j % 2 === 0 ? sw.s0 : -sw.s0, next = -prev;
    const u = (t - (sw.first + j * sw.step)) / SWING_FLIP;
    return sw.amp * (u >= 1 ? next : prev + (next - prev) * DASH(u < 0 ? 0 : u));
  }

  // hits: a damped 5 Hz oscillation from 0 along a hashed direction (and a jolt of the roll), the two latest summed:
  //   hit(t) = HIT_DU·short·amp·e^{−τ/0.09}·sin(2π·5·τ)·(cos φ, sin φ),  jolt(t) = HIT_ROLL·amp·e^{−τ/0.09}·sin(2π·5·τ)·±1
  function hitAt(hs, t, out) {
    out.hx = 0; out.hy = 0; out.jolt = 0;
    if (!hs) return out;
    const j = lastAt(hs.t, hs.n, t);
    for (let q = j; q >= 0 && q >= j - 1; q--) {
      const tau = t - hs.t[q];
      if (!(tau >= 0) || tau >= HIT_WINDOW * HIT_DECAY) continue;
      const v = hs.amp[q] * Math.exp(-tau / HIT_DECAY) * Math.sin(TAU * HIT_HZ * tau);
      out.hx += hs.du * v * hs.cx[q];
      out.hy += hs.du * v * hs.cy[q];
      out.jolt += HIT_ROLL * DEG * v * hs.sr[q];
    }
    return out;
  }

  // modAt(track, t, out) → out { pulse, swing (radians), jolt (radians), hx, hy (du) }: the modulators at cut-local t.
  function modAt(track, t, out) {
    const o = out || { pulse: 0, swing: 0, jolt: 0, hx: 0, hy: 0 };
    o.pulse = pulseAt(track.pulse, t);
    o.swing = swingAt(track.swing, t);
    hitAt(track.hits, t, o);
    return o;
  }

  // --- build -------------------------------------------------------------------------------------------------------------

  // The keys of the expanded shot with the layout caps (X7): 'gentle' → small tilts and offsets, no whip, small ground
  // zoom, hops ≥ 0.2; 'none' → two holds at key 0's framing (a, b), then the gentle caps (only the modulators move).
  function layoutKeys(shot, trait) {
    let keys = shot.keys.map((k) => Object.assign({}, k));
    const beat = Object.assign({}, shot.beat);
    if (trait === 'none') {
      const k0 = Object.assign({}, keys[0], { dt: 0, hit: 0, whip: 0, hop: null });
      if (k0.aim === 'reading') k0.aim = 'block';
      keys = [Object.assign({}, k0, { at: 'a' }), Object.assign({}, k0, { at: 'b', curve: 'linear' })];
    }
    if (trait !== 'any') {
      for (const k of keys) {
        k.roll = clamp(k.roll, -GENTLE.roll, GENTLE.roll);
        if (k.ox !== undefined) k.ox = clamp(k.ox, -GENTLE.off, GENTLE.off);
        if (k.oy !== undefined) k.oy = clamp(k.oy, -GENTLE.off, GENTLE.off);
        k.whip = 0;
        k.gz = Math.min(k.gz, GENTLE.gz);
        if (k.hop !== null) k.hop = Math.max(GENTLE.hop, k.hop);
      }
      beat.roll = Math.min(beat.roll, GENTLE.beatRoll);
    }
    return { keys, beat };
  }

  function kindOf(aim) {
    if (aim === 'reading') return 'reading';
    if (aim === 'frame' || aim === 'point') return aim;
    return 'text';
  }

  // The hashed direction and jolt sign of hit i, from what the cut's fingerprint covers (the shot value and the text), so
  // two cuts that share one cached scene share their hits too.
  function hitPhase(seed, i) {
    const phi = (H.hash32('xhit', seed, i, 0) / 4294967296) * TAU;
    return [Math.cos(phi), Math.sin(phi), H.hash32('xhit', seed, i, 2) & 1 ? 1 : -1];
  }

  // buildTrack(env, target, shot, o) → Track (see makeShot). shot = SHOT.expandShot of an EXTREME value; o = { trait,
  // seed }.
  function buildTrack(env, target, shot, o) {
    const D = env.D, W = D.w, Hh = D.h;
    const tm = env.times, end = SS.spanOf(env);
    const trait = o.trait === 'gentle' || o.trait === 'none' ? o.trait : 'any';
    const { keys: lk, beat } = layoutKeys(shot, trait);
    const sh = { beat };
    const raw = lk.map((key, i) => ({ key, i, t: anchorTime(env, target, key.at, key.dt) }));
    raw.sort((p, q) => p.t - q.t || p.i - q.i);
    const n = raw.length;
    const t = raw.map((r) => r.t);
    const key = raw.map((r) => r.key);
    const kind = key.map((k) => kindOf(k.aim));
    const inSung = (x) => x >= -EPS && x < end - 1e-6;
    let hmax = beat.shake;
    for (const k of key) hmax = Math.max(hmax, k.hit);
    const env2 = envelopeOf(D, sh, hmax);

    // reading units (shared by the reading keys), their sung starts τ
    const units = kind.includes('reading') ? SS.readingUnits(env, target) : null;

    // X2: deliberate jumps (keys < 1/120 s apart; reading units with hop 0) at least XJUMP_GAP apart and from a
    const cands = [];
    for (let i = 1; i < n; i++) if (t[i] - t[i - 1] < JUMP) cands.push({ t: t[i], i, k: -1 });
    const unitJump = new Uint8Array(units ? units.n : 0);
    if (units) {
      for (let r = 0; r < n; r++) {
        if (kind[r] !== 'reading' || key[r].hop !== 0) continue;
        const lo = r > 0 ? t[r - 1] : tm.a, hi = r < n - 1 ? t[r + 1] : tm.b;
        for (let k = 1; k < units.n; k++) {
          if (unitJump[k] || units.tau[k] < lo || units.tau[k] > hi) continue;
          unitJump[k] = 1;
          cands.push({ t: units.tau[k], i: -1, k });
        }
      }
    }
    cands.sort((p, q) => p.t - q.t || (p.i < 0) - (q.i < 0) || p.i - q.i || p.k - q.k);
    const snapUnit = new Uint8Array(units ? units.n : 0);
    const jumps = [];
    let last = tm.a;
    for (const c of cands) {
      if (c.t - last >= XJUMP_GAP - 1e-9) { jumps.push(c.t); last = c.t; continue; }
      if (c.i >= 0) {
        const lo = c.i >= 2 ? t[c.i - 2] + JUMP : tm.a;
        const at = Math.max(lo, t[c.i] - XSNAP);
        if (at <= t[c.i] - JUMP) t[c.i - 1] = at;
        else { jumps.push(c.t); last = c.t; }         // no room to turn it into a move: it stays a jump
      } else snapUnit[c.k] = 1;
    }
    const jump = new Uint8Array(n);
    for (let i = 1; i < n; i++) jump[i] = t[i] - t[i - 1] < JUMP ? 1 : 0;
    const rules = [null];
    for (let i = 1; i < n; i++) rules.push(segmentRule(t[i - 1], t[i], end));
    const none = new Uint8Array(n);

    // X5 roll fence, X6 rotation cap (degrees)
    const R = key.map((k) => k.roll);
    for (let i = 0; i < n; i++) if (inSung(t[i])) R[i] = clamp(R[i], -XROLL_SUNG, XROLL_SUNG);
    capScalar(R, rules, jump, (i) => Math.min(rules[i].fence, XROT_SPEED * (t[i] - t[i - 1])), none);

    // boxes and aim centres
    const box = new Array(n).fill(null);
    const cx = new Float64Array(n), cy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (kind[i] === 'reading') continue;
      const b = aimBoxOf(env, target, key[i]);
      box[i] = b;
      cx[i] = b.x + b.w / 2 - W / 2; cy[i] = b.y + b.h / 2 - Hh / 2;
    }
    const extOf = (b, rDeg) => {
      const r = Math.abs(rDeg) * DEG;
      return rotExtent(Math.max(b.w, SS.FLOOR * D.short), Math.max(b.h, SS.FLOOR * D.short), r - env2.e, r + env2.e);
    };

    // X3 zoom; reading keys: the median-area unit's zoom capped by every unit's Zfit (the path's zoom is constant)
    const Z = new Float64Array(n), fit = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      const k = key[i];
      if (kind[i] === 'frame' || kind[i] === 'point') { Z[i] = clamp(finite(k.zoom) ? k.zoom : 1, PLACE_ZOOM[0], PLACE_ZOOM[1]); continue; }
      if (kind[i] === 'reading') {
        const byArea = units.boxes.map((b, j) => [b.w * b.h, j]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
        const e = extOf(units.boxes[byArea[Math.floor(byArea.length / 2)][1]], R[i]);
        let f = Infinity;
        for (const b of units.boxes) f = Math.min(f, zfit(D, extOf(b, R[i]), env2));
        fit[i] = f;
        Z[i] = Math.max(Z_MIN, Math.min(clamp(k.fill * Math.min(W / e[0], Hh / e[1]), Z_MIN, Z_MAX), f));
        continue;
      }
      const e = extOf(box[i], R[i]);
      Z[i] = clamp(k.fill * Math.min(W / e[0], Hh / e[1]), Z_MIN, Z_MAX);
      if (inSung(t[i])) { fit[i] = zfit(D, e, env2); Z[i] = Math.max(Z_MIN, Math.min(Z[i], fit[i])); }
    }
    const lz = Array.from(Z, Math.log);
    capScalar(lz, rules, jump, (i) => XZOOM_SPEED * (t[i] - t[i - 1]), none);
    for (let i = 0; i < n; i++) {
      Z[i] = clamp(Math.exp(lz[i]), Z_MIN, Z_MAX);
      if (fit[i] < Infinity) Z[i] = Math.max(Z_MIN, Math.min(Z[i], fit[i]));
    }

    // X4 on-screen positions (reading keys: their path at the key's time, fixed through the travel cap)
    const px = new Array(n).fill(0), py = new Array(n).fill(0);
    const fixed = Uint8Array.from(kind, (k) => (k === 'reading' ? 1 : 0));
    const place = (i) => {
      const k = key[i], p = [px[i], py[i]], th = R[i] * DEG;
      if (inSung(t[i])) {
        const ext = kind[i] === 'text' ? extOf(box[i], R[i]) : [0, 0];
        safeClamp(D, p, ext, Z[i], env2);
      } else { p[0] = clamp(p[0], -OFF_MAX * W, OFF_MAX * W); p[1] = clamp(p[1], -OFF_MAX * Hh, OFF_MAX * Hh); }
      if (trait !== 'any') bleedClamp(D, cx[i], cy[i], p, Z[i], th);
      px[i] = p[0]; py[i] = p[1];
      return k;
    };
    const paths = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (kind[i] === 'reading') continue;
      const k = key[i];
      px[i] = k.ox !== undefined ? k.ox * W : cx[i];
      py[i] = k.oy !== undefined ? k.oy * Hh : cy[i];
      place(i);
    }
    for (let i = 0; i < n; i++) {
      if (kind[i] !== 'reading') continue;
      paths[i] = readingPath(D, units, key[i], Z[i], R[i] * DEG, env2, trait, (j) => extOf(units.boxes[j], R[i]), snapUnit);
      const q = pathAt(paths[i], t[i], {});
      cx[i] = q.cx; cy[i] = q.cy; px[i] = q.px; py[i] = q.py;
    }
    capVector(px, py, rules, jump, (i) => XTRAVEL_SPEED * W * (t[i] - t[i - 1]), fixed);
    for (let i = 0; i < n; i++) if (kind[i] !== 'reading') place(i);

    // the track
    const track = { x: true, a: tm.a, b: tm.b, n, W, H: Hh, short: D.short, gentle: trait !== 'any', trait, keys: [],
      t: Float64Array.from(t), lz: new Float64Array(n), cx: Float64Array.from(cx), cy: Float64Array.from(cy),
      px: Float64Array.from(px), py: Float64Array.from(py), R: new Float64Array(n), lgz: new Float64Array(n),
      curve: key.map((k) => CV.fn(k.curve)), paths, reading: units, Zread: null,
      jumps: Float64Array.from(jumps), pulse: null, swing: null, hits: null,
      blur: shot.blur, g: shot.g, shutter: shot.blur * shot.g * SHUTTER, calm: 1,
      live: { x: 0, y: 0, zoom: 1, roll: 0, ax: 0, ay: 0, gz: 1 },
      mod: { pulse: 0, swing: 0, jolt: 0, hx: 0, hy: 0 } };
    for (let i = 0; i < n; i++) {
      track.lz[i] = Math.log(Z[i]); track.R[i] = R[i] * DEG; track.lgz[i] = Math.log(Math.max(1, key[i].gz));
      if (paths[i] && track.Zread === null) track.Zread = paths[i].Z;
    }

    // X8, X9: the modulators
    const grid = env.grid;
    if (beat.zoom > 0) track.pulse = Object.assign(schedule(grid, tm.a, tm.b, beat.every, PULSE_GAP), { amp: beat.zoom });
    if (beat.roll > 0) {
      const s0 = R[0] < 0 ? -1 : R[0] > 0 ? 1 : shot.m;
      track.swing = Object.assign(schedule(grid, tm.a, tm.b, beat.every, SWING_GAP), { amp: beat.roll * DEG, s0 });
    }
    const list = [];
    for (let i = 0; i < n; i++) if (key[i].hit > 0) list.push({ t: t[i], amp: key[i].hit, o: 0 });
    if (beat.shake > 0) {
      const s = schedule(grid, tm.a, tm.b, beat.every, HIT_GAP);
      for (let j = 0; j < s.count; j++) list.push({ t: s.first + j * s.step, amp: beat.shake, o: 1 });
    }
    list.sort((p, q) => p.t - q.t || p.o - q.o);
    const kept = [];
    for (const h of list) if (!kept.length || h.t - kept[kept.length - 1].t >= HIT_GAP - 1e-9) kept.push(h);
    if (kept.length) {
      const hs = { n: kept.length, t: new Float64Array(kept.length), amp: new Float64Array(kept.length), cx: new Float64Array(kept.length),
        cy: new Float64Array(kept.length), sr: new Float64Array(kept.length), du: HIT_DU * D.short };
      kept.forEach((h, i) => {
        const [c, s, r] = hitPhase(o.seed, i);
        hs.t[i] = h.t; hs.amp[i] = h.amp; hs.cx[i] = c * shot.m; hs.cy[i] = s; hs.sr[i] = r * shot.m;
      });
      track.hits = hs;
    }

    // the keys as they frame (the facade's shotTrack, the stage overlay)
    const pose = { x: 0, y: 0, zoom: 1, roll: 0, ax: 0, ay: 0, gz: 1 };
    for (let i = 0; i < n; i++) {
      write(track, keyPose(track, i, t[i], QA), pose);
      const b = box[i] || (units ? units.boxes[Math.max(0, unitAt(paths[i].start, units.n, t[i]))] : null);
      track.keys.push(Object.freeze({ t: t[i], X: pose.x, Y: pose.y, Z: pose.zoom, R: pose.roll, cx: cx[i], cy: cy[i], sx: px[i], sy: py[i],
        aim: key[i].aim, box: b ? Object.freeze({ x: b.x, y: b.y, w: b.w, h: b.h }) : null, gz: pose.gz, hit: key[i].hit }));
    }
    return track;
  }

  // --- reading paths (X10) -----------------------------------------------------------------------------------------------

  // A reading key's path over the units: its zoom Z (constant), each unit's on-screen position (the frame centre, so every
  // word is centred while it is sung (X10), or the key's ox/oy; clamped into the XSAFE area), the hops
  // h_k = min(hop, 0.6·(τ_k − τ_{k−1})) (hop absent: 0.35; hop 0: a jump, unless X2 made it a XSNAP move), the whip w
  // and each hop's direction.
  function readingPath(D, units, key, Zr, th, env2, trait, extOf, snapUnit) {
    const n = units.n;
    const px = new Float64Array(n), py = new Float64Array(n), start = new Float64Array(n);
    const dx = new Float64Array(n), dy = new Float64Array(n);
    const hop = key.hop === null || key.hop === undefined ? SS.HOP_MAX : key.hop;
    for (let k = 0; k < n; k++) {
      const p = [key.ox !== undefined ? key.ox * D.w : 0, key.oy !== undefined ? key.oy * D.h : 0];
      safeClamp(D, p, extOf(k), Zr, env2);
      if (trait !== 'any') bleedClamp(D, units.cx[k], units.cy[k], p, Zr, th);
      px[k] = p[0]; py[k] = p[1];
      if (k === 0) { start[k] = units.tau[0]; continue; }
      const gap = units.tau[k] - units.tau[k - 1];
      const h = snapUnit[k] && hop === 0 ? Math.min(XSNAP, gap) : Math.min(hop, HOP_SHARE * gap);
      start[k] = units.tau[k] - h;
      const ddx = units.cx[k] - units.cx[k - 1], ddy = units.cy[k] - units.cy[k - 1], d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d > 0) { dx[k] = ddx / d; dy[k] = ddy / d; }
    }
    return { units, Z: Zr, lz: Math.log(Zr), px, py, start, dx, dy, whip: key.whip * D.w, curve: CV.fn(key.curve), R: th,
      lgz: Math.log(Math.max(1, key.gz)) };
  }

  function unitAt(start, n, t) { return lastAt(start, n, t); }

  // Fills q { cx, cy, px, py, lz, R, lgz, wx, wy } with the reading pose at t: holding a unit, or hopping into it (the
  // camera centre overshoots along the hop by whip·4f(1 − f)/Z: the words swing past and settle).
  function pathAt(path, t, q) {
    const u = path.units;
    const k = Math.max(0, unitAt(path.start, u.n, t));
    q.lz = path.lz; q.R = path.R; q.lgz = path.lgz; q.wx = 0; q.wy = 0;
    if (k > 0 && t < u.tau[k]) {
      const h = u.tau[k] - path.start[k];
      const f = h > 0 ? path.curve((t - path.start[k]) / h) : 1;
      q.cx = u.cx[k - 1] + (u.cx[k] - u.cx[k - 1]) * f; q.cy = u.cy[k - 1] + (u.cy[k] - u.cy[k - 1]) * f;
      q.px = path.px[k - 1] + (path.px[k] - path.px[k - 1]) * f; q.py = path.py[k - 1] + (path.py[k] - path.py[k - 1]) * f;
      if (path.whip > 0) {
        const bump = (path.whip * 4 * f * (1 - f)) / path.Z;
        q.wx = bump * path.dx[k]; q.wy = bump * path.dy[k];
      }
      return q;
    }
    q.cx = u.cx[k]; q.cy = u.cy[k]; q.px = path.px[k]; q.py = path.py[k];
    return q;
  }

  // --- pose (§1.4.2) -------------------------------------------------------------------------------------------------------

  const QA = { cx: 0, cy: 0, px: 0, py: 0, lz: 0, R: 0, lgz: 0, wx: 0, wy: 0 };
  const QB = { cx: 0, cy: 0, px: 0, py: 0, lz: 0, R: 0, lgz: 0, wx: 0, wy: 0 };

  function keyPose(track, i, t, q) {
    const path = track.paths[i];
    if (path) return pathAt(path, t, q);
    q.cx = track.cx[i]; q.cy = track.cy[i]; q.px = track.px[i]; q.py = track.py[i]; q.lz = track.lz[i]; q.R = track.R[i];
    q.lgz = track.lgz[i]; q.wx = 0; q.wy = 0;
    return q;
  }

  function keyAt(track, t) { return lastAt(track.t, track.n, t); }

  // The camera of pose q: Z = e^lz, X = c − Rot(θ)·P/Z (+ the whip's overshoot), clamped to the bleed in gentle layouts;
  // ax, ay = where the aim centre shows (from the frame centre, after the roll).
  function write(track, q, out) {
    const Z = clamp(Math.exp(q.lz), Z_MIN, Z_MAX);
    const c = Math.cos(q.R), s = Math.sin(q.R);
    let X = q.cx - (c * q.px - s * q.py) / Z + q.wx;
    let Y = q.cy - (s * q.px + c * q.py) / Z + q.wy;
    if (track.gentle) {
      const lx = SS.bleedLimit(track.W, Z), ly = SS.bleedLimit(track.H, Z);
      X = clamp(X, -lx, lx); Y = clamp(Y, -ly, ly);
    }
    out.x = X; out.y = Y; out.zoom = Z; out.roll = q.R; out.gz = Math.exp(q.lgz);
    const dx = q.cx - X, dy = q.cy - Y;
    out.ax = Z * (c * dx + s * dy);
    out.ay = Z * (-s * dx + c * dy);
    return out;
  }

  // poseAt(track, t, out) → out { x, y, zoom, roll, ax, ay, gz }: the x-track camera at cut-local t, without the
  // modulators. Between keys i → j: f = curve_j(u); ln Z, the aim centre c, its on-screen position P, the roll and ln gz
  // lerped (a reading key is its path at t); then X = c − Rot(θ)·P/Z, so the aimed words travel straight on screen even
  // while rolling. A reading key followed by another aim keeps reading until XLEAVE s before that key, then moves (so
  // every word is centred while it is sung, X10). Held before the first key and after the last; keys closer than
  // 1/120 s jump at the later key's time.
  function poseAt(track, t, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0, ax: 0, ay: 0, gz: 1 };
    const n = track.n;
    const i = keyAt(track, t);
    if (i < 0) return write(track, keyPose(track, 0, track.t[0], QA), o);
    if (i >= n - 1) return write(track, keyPose(track, n - 1, t, QA), o);
    const t0 = track.t[i], t1 = track.t[i + 1];
    const A = keyPose(track, i, t, QA);
    if (t1 - t0 < JUMP) return write(track, A, o);
    const leave = track.paths[i] && !track.paths[i + 1] ? Math.max(t0, t1 - XLEAVE) : t0;
    if (t < leave) return write(track, A, o);
    const B = keyPose(track, i + 1, track.paths[i + 1] ? t : t1, QB);
    const f = track.curve[i + 1]((t - leave) / (t1 - leave));
    A.lz += (B.lz - A.lz) * f;
    A.cx += (B.cx - A.cx) * f; A.cy += (B.cy - A.cy) * f;
    A.px += (B.px - A.px) * f; A.py += (B.py - A.py) * f;
    A.R += (B.R - A.R) * f;
    A.lgz += (B.lgz - A.lgz) * f;
    A.wx += (B.wx - A.wx) * f; A.wy += (B.wy - A.wy) * f;
    return write(track, A, o);
  }

  // --- the camera behaviour (§1.4.3) ---------------------------------------------------------------------------------------

  // runShot(P, t, b): the shot pose composed with the lens deltas as engine/scene/shot.runShot does, then the modulators
  // (k = track.calm: 1, or CALM in a toned-down preview):
  //   sx, sy ×= 1 + pulse·k;  rot += (swing + jolt)·k;  jx += hit.x·k/Z;  jy += hit.y·k/Z
  function runShot(P, t, b) {
    const tr = b.track;
    const pose = poseAt(tr, t, tr.live);
    const c = b.from, Z = pose.zoom, zl = P.sx[c];
    P.x[c] = pose.x + P.x[c] / Z;
    P.y[c] = pose.y + P.y[c] / Z;
    P.sx[c] = Z * zl;
    P.sy[c] = Z * zl;
    P.rot[c] = pose.roll + P.rot[c];
    P.jx[c] /= Z;
    P.jy[c] /= Z;
    const m = modAt(tr, t, tr.mod), k = tr.calm;
    if (m.pulse !== 0) { P.sx[c] *= 1 + m.pulse * k; P.sy[c] *= 1 + m.pulse * k; }
    P.rot[c] += (m.swing + m.jolt) * k;
    P.jx[c] += (m.hx * k) / Z;
    P.jy[c] += (m.hy * k) / Z;
  }

  // camAt(track, t, out) → out { x, y, zoom, roll, jx, jy, fz, gz }: the closed-form part of the cut camera at cut-local
  // t (the pose with the modulators, lens deltas held at identity) — what engine/render/xblur differentiates. Uses its
  // own scratch, so track.live keeps the latest evaluation.
  const CAM_POSE = { x: 0, y: 0, zoom: 1, roll: 0, ax: 0, ay: 0, gz: 1 };
  const CAM_MOD = { pulse: 0, swing: 0, jolt: 0, hx: 0, hy: 0 };
  function camAt(track, t, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0, jx: 0, jy: 0, fz: 1, gz: 1 };
    const p = poseAt(track, t, CAM_POSE), m = modAt(track, t, CAM_MOD), k = track.calm;
    o.x = p.x; o.y = p.y; o.zoom = p.zoom * (1 + m.pulse * k); o.roll = p.roll + (m.swing + m.jolt) * k;
    o.jx = (m.hx * k) / p.zoom; o.jy = (m.hy * k) / p.zoom; o.fz = p.zoom; o.gz = p.gz;
    return o;
  }

  // makeShot(env, cam, target, d) → { behaviours, lean, track } | null, like engine/scene/shot.makeShot for an EXTREME
  // cam.shot. d = { shot, zoom, curve, follow, extreme (cam.extreme or null), camTrait ('any' | 'gentle' | 'none') }.
  // Track = the normal track's fields (a, b, n, W, H, keys, t, lz, cx, cy, R, curve, paths, reading, Zread, live) plus
  // x: true, px, py (on-screen positions), lgz, gentle, trait, jumps (cut-local times of the deliberate jumps kept),
  // pulse / swing / hits (schedules), blur, g, shutter (seconds), calm (evaluate sets it), live.gz, mod.
  function makeShot(env, cam, target, d) {
    const dd = d || {};
    const decision = dd.shot || null;
    const ref = decision ? decision.v : undefined;
    if (ref === undefined || !SHOT.isExtreme(ref) || SS.textGlyphs(target) === 0) return null;
    const shot = SHOT.expandShot(ref, { zoom: finite(dd.zoom) ? dd.zoom : 1, curve: dd.curve === null ? undefined : dd.curve,
      follow: finite(dd.follow) ? dd.follow : null, g: SHOT.xIntensity(dd.extreme) });
    if (!shot) return null;
    const cut = env.cut || {};
    const seed = H.hash32(typeof ref === 'string' ? ref : H.hashJSON(ref), cut.text === undefined ? '' : cut.text);
    const track = buildTrack(env, target, shot, { trait: dd.camTrait, seed });
    const behaviour = { phase: BH.PH.LENS, live: 'always', from: cam, to: cam + 1, t0: env.times.a, t1: env.times.b,
      run: runShot, track };
    return { behaviours: [behaviour], lean: shot.follow > 0 ? SS.leanOf(env, cam, target, shot.follow) : null, track };
  }

  return {
    XSAFE, XROLL_SUNG, XSPIN_LAND, XSPIN_INSIDE, XROT_SPEED, XZOOM_SPEED, XTRAVEL_SPEED, XJUMP_GAP, XSNAP, PULSE_GAP,
    PULSE_ATTACK, PULSE_DECAY, DOWNBEAT, SWING_GAP, SWING_FLIP, HIT_GAP, HIT_HZ, HIT_DECAY, HIT_DU, HIT_ROLL, CALM, GENTLE,
    OFF_MAX, SHUTTER, XLEAVE,
    isX, makeShot, anchorTime, poseAt, modAt, camAt, runShot, rotExtent, schedule, segmentRule,
  };
});
