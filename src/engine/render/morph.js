/* 文字PVメーカー v2 — original work. Glyph seams: the letters two lines share travel from the old line's place to the new line's (DESIGN_2_2 §4, M4). */
MV.def('engine/render/morph', ['core/mat', 'core/num', 'engine/scene/table', 'engine/scene/frame', 'engine/render/draw',
  'engine/render/seam'], (MAT, N, T, F, DR, SE) => {
  'use strict';

  // A glyph seam's plan entry lists letter pairs [aOff, bOff, same] (planner/morph): offsets of graphemes in the two
  // cuts' texts, the `off` every glyph record carries. Here each pair becomes two glyph nodes, one per scene; those
  // nodes are left out of the side surfaces the seam part mixes (the skip mask), and drawn here instead, on the frame
  // after the mix, travelling from A's place (u = 0: exactly A's glyph) to B's (u = 1: exactly B's).

  const TYPE = T.TYPE;
  const MIN_ALPHA = T.MIN_ALPHA;
  const SPREAD_MAX = 0.95;
  const SINE = (u) => (1 - Math.cos(Math.PI * u)) / 2;
  const sm = (x) => N.smooth(x);          // smoothstep of a clamped argument

  // --- which node stands for a letter ------------------------------------------------------------------------------

  // A layer whose glyphs may travel: a text layer (text, near; the base layers are drawn before the mask is set) drawn as
  // a plain source-over composite at opacity 1 with no filter and no mask, and no other layer masked by it. isolate and
  // a static cache alone are fine (a plain composite equals a direct draw). So a knockout's text (the mask of a slab,
  // at opacity 0) never travels: it melts with the rest.
  function eligible(scene, Lk) {
    if (!SE.TEXT_LAYERS.includes(Lk)) return false;
    const specs = scene.layers || null;
    const spec = specs ? specs[Lk] : null;
    if (spec && (spec.opacity !== 1 || spec.blend !== 'source-over' || spec.filter || spec.mask)) return false;
    if (specs) for (let k = 0; k < specs.length; k++) if (specs[k] && specs[k].mask && T.LAYER_INDEX[specs[k].mask.layer] === Lk) return false;
    return true;
  }

  // The product of the base (rest) alpha of the node and its ancestors: static, from the build.
  function restAlpha(t, i) {
    let a = 1;
    for (let k = i; k >= 0; k = t.parent[k]) a *= t.base.alpha[k];
    return a;
  }

  // offIndex(scene) → Map(off → node), once per scene: of the glyph nodes of the runs that read the cut's text (a run
  // with its own `text` — a note, a ♪ — does not), in an eligible layer and not a space, the one with the highest rest
  // alpha per offset (ties: the lower node). A faint echo copy never stands for the letter; the others melt.
  const OFFS = new WeakMap();
  function offIndex(scene) {
    let m = OFFS.get(scene);
    if (m) return m;
    const t = scene.table, recs = scene.stores.glyph;
    const best = new Map();
    for (const run of scene.runs || []) {
      if (!run || (run.spec && run.spec.text !== undefined && run.spec.text !== null)) continue;
      for (let i = run.from; i < run.to; i++) {
        if (t.type[i] !== TYPE.glyph || !eligible(scene, t.layer[i])) continue;
        const rec = recs[t.payload[i]];
        if (!rec || !rec.font || rec.cls === 'space') continue;
        const ra = restAlpha(t, i);
        const had = best.get(rec.off);
        if (had === undefined || ra > had.ra || (ra === had.ra && i < had.i)) best.set(rec.off, { i, ra });
      }
    }
    m = new Map();
    for (const [off, e] of best) m.set(off, e.i);
    OFFS.set(scene, m);
    return m;
  }

  // Two records that draw alike: one version of the glyph is enough while it travels.
  function sameLook(a, b) {
    return (a.font === b.font || a.font.key === b.font.key) && a.ch === b.ch && a.style === b.style && a.ink === b.ink &&
      a.rot === b.rot && a.sx === b.sx;
  }

  // --- the pairs of one seam and two scenes ---------------------------------------------------------------------------

  // prepare(entry, sceneA, sceneB) → mv | null: the pairs whose letters both scenes hold, in bOff order, as
  // { n, ia, ib (node indexes), same, look (1 = draw one version), rank (j / (n − 1)), skip: Map(scene → Uint8Array) };
  // null without pairs. The last few are kept (by plan entry and the two scene objects): a frame draws one seam, and a
  // longer memo would keep scenes alive that the facade's scene cache has let go.
  const PREP_MAX = 4;
  const PREP = [];
  function prepare(entry, sa, sb) {
    if (!entry || !Array.isArray(entry.glyphs) || entry.glyphs.length === 0 || !sa || !sb || sa === sb) return null;
    for (let k = 0; k < PREP.length; k++) {
      const hit = PREP[k];
      if (hit.entry === entry && hit.sa === sa && hit.sb === sb) {
        if (k > 0) { PREP.splice(k, 1); PREP.unshift(hit); }
        return hit.mv;
      }
    }
    const mv = build(entry.glyphs, sa, sb);
    PREP.unshift({ entry, sa, sb, mv });
    if (PREP.length > PREP_MAX) PREP.length = PREP_MAX;
    return mv;
  }

  function build(pairs, sa, sb) {
    const ma = offIndex(sa), mb = offIndex(sb);
    const ia = [], ib = [], same = [];
    for (const p of pairs) {
      const x = ma.get(p[0]), y = mb.get(p[1]);
      if (x === undefined || y === undefined) continue;        // a letter without a node melts with the rest
      ia.push(x); ib.push(y); same.push(p[2] === 1 ? 1 : 0);
    }
    const n = ia.length;
    if (n === 0) return null;
    const ta = sa.table, tb = sb.table;
    const look = new Uint8Array(n), rank = new Float32Array(n);
    const skipA = new Uint8Array(ta.n), skipB = new Uint8Array(tb.n);
    for (let j = 0; j < n; j++) {
      look[j] = sameLook(sa.stores.glyph[ta.payload[ia[j]]], sb.stores.glyph[tb.payload[ib[j]]]) ? 1 : 0;
      rank[j] = n > 1 ? j / (n - 1) : 0;
      skipA[ia[j]] = 1; skipB[ib[j]] = 1;
    }
    return Object.freeze({ n, ia: Int32Array.from(ia), ib: Int32Array.from(ib), same: Uint8Array.from(same), look, rank,
      skip: new Map([[sa, skipA], [sb, skipB]]) });
  }

  // --- affine interpolation ---------------------------------------------------------------------------------------------

  // decompose(M) → { e, f, th, sx, m, n }: M = T(e, f) · R(th) · [[sx, m], [0, n]] (canvas order a b c d e f).
  function decompose(M, out) {
    const a = M[0], b = M[1], c = M[2], d = M[3];
    const sx = Math.hypot(a, b);
    out.e = M[4]; out.f = M[5]; out.sx = sx;
    out.th = Math.atan2(b, a);
    out.m = sx > 0 ? (a * c + b * d) / sx : 0;
    out.n = sx > 0 ? (a * d - b * c) / sx : 0;
    return out;
  }

  const DA = { e: 0, f: 0, th: 0, sx: 0, m: 0, n: 0 }, DB = { e: 0, f: 0, th: 0, sx: 0, m: 0, n: 0 };

  // lerpAffine(out, A, B, k, arc) → out: device matrices interpolated in their parts — the rotation along the shorter
  // arc, the x scale in log space, the y scale in log space (linearly through zero when it changes sign, a mirror), the
  // shear as a ratio, and the translation straight, bowed by arc · sin(πk) to the left of the travel. Exact at the ends.
  function lerpAffine(out, A, B, k, arc) {
    if (!(k > 0)) { for (let i = 0; i < 6; i++) out[i] = A[i]; return out; }
    if (k >= 1) { for (let i = 0; i < 6; i++) out[i] = B[i]; return out; }
    const a = decompose(A, DA), b = decompose(B, DB);
    if (!(a.sx > 1e-12 && b.sx > 1e-12)) {
      for (let i = 0; i < 6; i++) out[i] = A[i] + (B[i] - A[i]) * k;
    } else {
      let dth = b.th - a.th;
      while (dth > Math.PI) dth -= 2 * Math.PI;
      while (dth < -Math.PI) dth += 2 * Math.PI;
      const th = a.th + dth * k;
      const sx = Math.exp(Math.log(a.sx) + (Math.log(b.sx) - Math.log(a.sx)) * k);
      const n = a.n * b.n > 0
        ? Math.sign(a.n) * Math.exp(Math.log(Math.abs(a.n)) + (Math.log(Math.abs(b.n)) - Math.log(Math.abs(a.n))) * k)
        : a.n + (b.n - a.n) * k;
      const ra = a.n !== 0 ? a.m / a.n : 0, rb = b.n !== 0 ? b.m / b.n : 0;
      const m = (ra + (rb - ra) * k) * n;
      const cos = Math.cos(th), sin = Math.sin(th);
      out[0] = cos * sx; out[1] = sin * sx;
      out[2] = cos * m - sin * n; out[3] = sin * m + cos * n;
      out[4] = a.e + (b.e - a.e) * k; out[5] = a.f + (b.f - a.f) * k;
    }
    if (arc) {
      const bow = arc * Math.sin(Math.PI * k), dx = B[4] - A[4], dy = B[5] - A[5];
      out[4] += -dy * bow; out[5] += dx * bow;
    }
    return out;
  }

  // --- drawing ------------------------------------------------------------------------------------------------------------

  // The glyph's own turn (draw.localTurn) and its inverse, post-multiplied into M.
  function turn(M, rec) {
    if (rec.rot === 2) { M[0] = -M[0]; M[1] = -M[1]; }
    if (rec.rot) { const a = M[0], b = M[1]; M[0] = M[2]; M[1] = M[3]; M[2] = -a; M[3] = -b; }
    if (rec.sx !== 1) { M[0] *= rec.sx; M[1] *= rec.sx; }
    return M;
  }
  function unturn(M, rec) {
    if (rec.sx !== 1) { M[0] /= rec.sx; M[1] /= rec.sx; }
    if (rec.rot) { const a = M[0], b = M[1]; M[0] = -M[2]; M[1] = -M[3]; M[2] = a; M[3] = b; }
    if (rec.rot === 2) { M[0] = -M[0]; M[1] = -M[1]; }
    return M;
  }
  function scaleBy(M, s) { M[0] *= s; M[1] *= s; M[2] *= s; M[3] *= s; return M; }

  const V6 = new Float32Array(6), W6 = new Float64Array(6);
  const FA = new Float64Array(6), FB = new Float64Array(6), FK = new Float64Array(6), MY = new Float64Array(6);
  const DI = new Float64Array(6), VW = new Float64Array(6);

  // The glyph's frame in em units on the device: D · view(camera, layer) · world(node) · Turn(rec) · S(em).
  function glyphFrame(out, dc, it, i, rec) {
    const t = it.scene.table;
    F.viewMatrix(V6, it.cam, T.LAYERS[t.layer[i]].parallax, dc.W, dc.H);
    MAT.mul(out, dc.D, V6);
    const o = i * 6;
    for (let k = 0; k < 6; k++) W6[k] = t.m[o + k];
    MAT.mul(out, out, W6);
    return scaleBy(turn(out, rec), rec.em);
  }

  function alphaOf(t, i) {
    if ((t.flags[i] & T.FLAG.hidden) !== 0) return 0;
    const a = t.wa[i];
    return a > 1 ? 1 : a;
  }

  // The node frame of record `rec` at the traveller's frame Fk (em units): Fk · S(1 / em) · Turn(rec)⁻¹, into MY.
  function nodeFrame(Fk, rec) {
    for (let k = 0; k < 6; k++) MY[k] = Fk[k];
    return unturn(scaleBy(MY, 1 / rec.em), rec);
  }

  // One version of a traveller: glyph node i of item `it` drawn at the frame Fk, with this alpha and extra blur (du).
  function drawAs(dc, it, i, rec, Fk, alpha, blur) {
    if (!(alpha >= MIN_ALPHA)) return;
    if (DR.drawGlyphAs(dc, it.scene, i, nodeFrame(Fk, rec), alpha, blur) && dc.g) dc.counts.glyphs++;
  }

  // The traveller picks as B's glyph (B's cut, owner and slot) at the traveller's place.
  function pickAs(dc, it, i, rec, Fk) {
    nodeFrame(Fk, rec);
    MAT.invert(DI, dc.D);
    MAT.mul(VW, DI, MY);
    DR.pickNode(dc, it.scene, i, VW, it.cut, -rec.w / 2, -rec.h / 2, rec.w / 2, rec.h / 2);
  }

  // draw(dc, mv, A, B, w, p): the travellers of a glyph seam at warped progress w on dc.g (null: only the sprites they
  // would draw are looked up, the warm-up). A, B = the two sides' items { scene, cam, cut } (the cameras of this frame).
  // p = the seam's params { arc, spread, soften }. Each pair moves on its own eased clock, staggered by its rank; a pair
  // that draws alike travels as one glyph; a pair of equal letters that look different (face, size, ink, style, turn)
  // crossfades while it travels (never dipping below 0.99 of its alpha); a swap melts: the old letter softens and fades,
  // the new one comes into focus.
  function draw(dc, mv, A, B, w, p) {
    if (!mv || !A || !B) return;
    const g = dc.g;
    dc.font = null;
    if (g) { g.textAlign = 'center'; g.textBaseline = 'middle'; }
    const ta = A.scene.table, tb = B.scene.table;
    const s = Math.min(p.spread > 0 ? p.spread : 0, SPREAD_MAX);
    const arc = p.arc > 0 ? p.arc : 0, soften = p.soften > 0 ? p.soften : 0;
    for (let j = 0; j < mv.n; j++) {
      const ia = mv.ia[j], ib = mv.ib[j];
      const aA = alphaOf(ta, ia), aB = alphaOf(tb, ib);
      if (aA < MIN_ALPHA && aB < MIN_ALPHA) continue;
      const ra = A.scene.stores.glyph[ta.payload[ia]], rb = B.scene.stores.glyph[tb.payload[ib]];
      glyphFrame(FA, dc, A, ia, ra);
      glyphFrame(FB, dc, B, ib, rb);
      const k = SINE(N.clamp((w - s * mv.rank[j]) / (1 - s)));
      lerpAffine(FK, FA, FB, k, arc);
      const a = aA + (aB - aA) * k;
      if (mv.same[j] === 1 && mv.look[j] === 1) drawAs(dc, B, ib, rb, FK, a, 0);
      else if (mv.same[j] === 1) {
        drawAs(dc, A, ia, ra, FK, a * (1 - sm((k - 0.4) / 0.6)), 0);
        drawAs(dc, B, ib, rb, FK, a * sm(k / 0.6), 0);
      } else {
        drawAs(dc, A, ia, ra, FK, a * (1 - sm((k - 0.1) / 0.6)), soften * sm(k / 0.7));
        drawAs(dc, B, ib, rb, FK, a * sm((k - 0.3) / 0.6), soften * (1 - sm((k - 0.3) / 0.7)));
      }
      if (g && dc.pick) pickAs(dc, B, ib, rb, FK);
    }
    if (g) g.globalAlpha = 1;
  }

  return { eligible, restAlpha, offIndex, prepare, draw, lerpAffine, decompose, SPREAD_MAX };
});
