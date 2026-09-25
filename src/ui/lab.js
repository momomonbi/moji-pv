/* 文字PVメーカー v2 — original work. Part lab: one part in a canned cut with a pose-column view, contact sheets, a text mode and the browser-test API (DESIGN §6.14, §8.3). */
MV.def('ui/lab', ['core/registry', 'core/doc', 'core/script', 'core/shot', 'core/schema', 'core/rng', 'engine/facade',
  'engine/host/canvas', 'engine/host/fonts', 'engine/host/measure', 'engine/text/faces', 'engine/text/service',
  'engine/render/sprites', 'parts/kit', 'parts/mix', 'i18n/t', 'i18n/strings'],
(REG, DOC, S, SHOT, SCH, RNG, FAC, HC, HF, HM, FACES, TS, SP, K, MIX, I18N, strings) => {
  'use strict';

  // The lab is a developer page (build.py --lab → tests/www/lab.html, MV.DEV = true). It is not shipped, so its control
  // labels are plain English; only the page title comes from the string table.
  //
  // Hash routes:
  //   #<kind>:<key>@<aspect>&t=<0..1>&text=…&theme=…&orient=h|v&parts=catalog|examples|stub&backdrop=…&fonts=1
  //   #gallery@<aspect>&parts=…          every part as a thumbnail
  //   #text:<sample>@v                    the sample laid out in every theme face with the real measurer (WP2)
  //   #shot:<key>@<aspect>&t=…            a shot preset on the canned cut (DESIGN_2_1 §3.10; params zoom, curve, follow)
  //   #rig:<key>@<aspect>&t=…             a rig preset over the whole sample plan (§3.10; params amp, curve)
  //   #media:<kind>/<key>@<aspect>&asset=fixture:<name>&t=…   a part with a media param, showing a fixture asset of the
  //                                       fake store (tests/helpers/fake_media.js; §11.5.7). Test pages only: the store
  //                                       and its test parts come with the fixtures (MVLabFixtures.media).
  // `t` is normalized over the part's own window: arrive → the entrance, depart → the exit, dwell → the hold between
  // them, seam → the transition, anything else → the whole visible window of the cut.
  // Registries: parts/catalog when it is built; 'materials' = the catalog plus the sample materials of parts/mix
  // (sampleDefs, keyed myMatz<kind> as the tests key them; info() lists only the materials); the test fixtures
  // (stub_parts.js, example_parts.js) when a test page defines globalThis.MVLabFixtures = { stub, examples, projects, media }.

  const ASPECTS = DOC.ASPECTS;
  const KINDS = REG.KINDS;
  const CAM_KINDS = Object.freeze(['shot', 'rig']);     // camera presets (core/shot), shown like parts
  const FIXTURE = 'fixture:';
  const VIEW_W = 960, VIEW_H = 540;
  const POSE_COLS = ['x', 'y', 'z', 'rot', 'rx', 'ry', 'sx', 'sy', 'alpha', 'blur', 'reveal', 'tint', 'glow', 'shard', 'echo', 'pixel'];
  const ANGLE_COLS = ['rot', 'rx', 'ry'];
  const POSE_ROWS = 24;

  // --- registries and engines -----------------------------------------------------------------------------------------

  function fixtures() { return globalThis.MVLabFixtures || null; }

  const registries = new Map();

  function sources() {
    const out = [];
    if (MV.has('parts/catalog')) out.push('catalog');
    const fx = fixtures();
    if (fx && fx.examples && fx.stub) out.push('examples');
    if (fx && fx.stub) out.push('stub');
    if (MV.has('parts/catalog') && materialDefs().length) out.push('materials');
    return out;
  }

  // The sample materials (parts/mix sampleDefs over the catalog), re-keyed 'myMatS<Kind>' → 'myMatz<kind>' (NOTES v2.1-C).
  const MATERIAL_KEY = 'myMatz';
  let samples = null;
  function materialDefs() {
    if (samples) return samples;
    samples = [];
    try {
      samples = (MIX.sampleDefs(catalogRegistry()) || []).map((d) => Object.freeze(Object.assign({}, d,
        { key: MATERIAL_KEY + d.key.slice(6).toLowerCase() })));
    } catch (e) {
      notes.materials = 'parts/mix sampleDefs failed: ' + (e && e.message);
    }
    return samples;
  }

  // The keys a source shows as its own: every key, or only the materials of the 'materials' source.
  function ownKeys(source, reg, kind) {
    return source === 'materials' ? reg.keys(kind).filter((k) => k.startsWith(MATERIAL_KEY)) : reg.keys(kind);
  }

  const notes = {};

  // The catalog's registry. While the catalog is still incomplete (a strict registry does not validate), the lab shows
  // what it has: a lenient registry, with the fixture fallbacks for kinds that have no fallback part yet.
  function catalogRegistry() {
    const cat = MV.use('parts/catalog');
    try { return cat.defaultRegistry(); } catch (e) {
      const defs = cat.defs();
      const fx = fixtures();
      const have = new Set(defs.filter((d) => d.fallback).map((d) => d.kind));
      const extra = fx && fx.stub ? fx.stub.fallbackParts().filter((d) => !have.has(d.kind)) : [];
      const reg = REG.createRegistry(defs.concat(extra), { strict: false });
      notes.catalog = 'the catalog does not validate yet (' + String(e && e.message).split('\n').length + ' problems)' +
        (extra.length ? '; fixture fallbacks stand in for ' + [...new Set(extra.map((d) => d.kind))].join(' ') : '');
      return reg;
    }
  }

  function registryOf(source) {
    if (registries.has(source)) return registries.get(source);
    const fx = fixtures();
    let reg = null;
    if (source === 'catalog' && MV.has('parts/catalog')) reg = catalogRegistry();
    else if (source === 'materials' && MV.has('parts/catalog')) reg = REG.extend(catalogRegistry(), materialDefs());
    else if (source === 'stub' && fx && fx.stub) reg = REG.createRegistry(fx.stub.allStubParts());
    else if (source === 'examples' && fx && fx.examples && fx.stub) {
      const fallbacks = fx.stub.fallbackParts().filter((d) => d.kind !== 'theme' && d.kind !== 'mood');
      reg = REG.createRegistry(fx.examples.exampleParts(K).concat(fallbacks));
    }
    if (!reg) throw new Error('lab: no parts from ' + source + ' (sources here: ' + (sources().join(', ') || 'none') + ')');
    registries.set(source, reg);
    return reg;
  }

  function defaultSource() { return sources()[0] || null; }

  function cameraKeys(kind) { return kind === 'shot' ? SHOT.SHOT_KEYS : kind === 'rig' ? SHOT.RIG_KEYS : []; }

  // --- media mode: the fake store and its test parts (test pages only) -------------------------------------------------

  function hasMediaFixtures() { const fx = fixtures(); return !!(fx && fx.media); }

  function mediaFixtures() {
    if (!hasMediaFixtures()) throw new Error('lab: the media mode needs the fake store (tests/helpers/fake_media.js) on the page');
    return fixtures().media;
  }

  // The source's parts plus the fake store's test parts (one per media use), for the media mode.
  function mediaRegistry(source) {
    const id = 'media|' + source;
    if (registries.has(id)) return registries.get(id);
    const base = registryOf(source);
    const defs = [];
    for (const kind of KINDS) for (const key of base.keys(kind)) defs.push(base.get(kind, key));
    const reg = REG.createRegistry(defs.concat(mediaFixtures().testParts(K)), { strict: false });
    registries.set(id, reg);
    return reg;
  }

  // The name of a part's media param (the first of type 'media'), or null.
  function mediaParamOf(def) {
    const params = (def && def.params) || {};
    return Object.keys(params).find((k) => params[k] && params[k].type === 'media') || null;
  }

  // mediaParts(registry) → [{ kind, key, param, accept }]: every part with a media param.
  function mediaParts(reg) {
    const out = [];
    for (const kind of REG.PART_KINDS) {
      for (const key of reg.keys(kind)) {
        const def = reg.get(kind, key), param = mediaParamOf(def);
        if (param) out.push({ kind, key, param, accept: def.params[param].accept || 'any' });
      }
    }
    return out;
  }

  // 'fixture:<name>' | '<name>' | '<id>' → the fake store's asset entry.
  function fixtureAsset(ref) {
    const name = String(ref || '').startsWith(FIXTURE) ? String(ref).slice(FIXTURE.length) : String(ref || '');
    const a = mediaFixtures().fixture(name);
    if (!a) throw new Error('lab: no media fixture ' + name);
    return a;
  }

  const engines = new Map();
  const factory = HC.createCanvasFactory();

  // One engine per (source, fonts, media): with fonts the real FontBook (Google Fonts) loads faces; without, faces are
  // never requested and the fallback stacks draw (fast and deterministic, what the tests use). A media engine has the
  // fake store (checkerboard stills, bar-coded video frames) and the media registry.
  function engineFor(source, withFonts, fresh, media) {
    const id = source + '|' + (withFonts ? 'fonts' : 'plain') + (media ? '|media' : '');
    if (!fresh && engines.has(id)) return engines.get(id);
    const registry = media ? mediaRegistry(source) : registryOf(source);
    const fonts = withFonts ? HF.createFontBook({ document, timeoutMs: 8000 }) : null;
    const measurer = HM.createCanvasMeasurer(factory, fonts);
    const assets = media ? mediaFixtures().createFakeMedia(MV, { canvas: factory }) : null;
    const engine = FAC.createEngine({ registry, canvas: factory, measurer, fonts, assets });
    const rec = { engine, registry, fonts, measurer };
    if (!fresh) engines.set(id, rec);
    return rec;
  }

  // --- time windows ---------------------------------------------------------------------------------------------------

  // [t0, t1] (absolute seconds) of a part's own window in a sample plan; u in 0..1 maps linearly into it.
  function windowOf(engine, plan, kind) {
    const cut = plan.cuts[0];
    const scene = engine.scene('cut', 0);
    const tm = scene ? scene.times : { a: cut.a - cut.t0, rest: 0, out: cut.t1 - cut.t0, b: cut.b - cut.t0 };
    const end = cut.b - 0.001;
    const clampT = (x) => Math.min(end, Math.max(cut.a, x));
    if (kind === 'arrive') return [clampT(cut.t0 + tm.a), clampT(cut.t0 + Math.max(tm.rest, tm.a + 0.01))];
    if (kind === 'depart') return [clampT(cut.t0 + Math.min(tm.out, tm.b - 0.01)), end];
    if (kind === 'dwell') return [clampT(cut.t0 + tm.rest), clampT(cut.t0 + Math.max(tm.out, tm.rest + 0.01))];
    if (kind === 'seam' && plan.seams.length) {
      const s = plan.seams[0];
      return [s.at - s.dur / 2, s.at + s.dur / 2 - 0.001];
    }
    return [cut.a, end];
  }

  function timeAt(engine, plan, kind, u) {
    const [a, b] = windowOf(engine, plan, kind);
    const k = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0.5));
    return a + (b - a) * k;
  }

  // --- rendering ------------------------------------------------------------------------------------------------------

  function makeSurface(w, h, alpha) {
    const made = factory.create(w, h, { alpha: alpha !== false });
    return { canvas: made.canvas, ctx: made.ctx, w, h };
  }

  function fitSize(aspect, maxW, maxH) {
    const [w, h] = DOC.DESIGN_SIZE[aspect] || DOC.DESIGN_SIZE['16:9'];
    const k = Math.min(maxW / w, maxH / h);
    return [Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))];
  }

  // renderPart(o) → { plan, t, stats, surface, engine, registry }: o = { parts, kind, key, params, aspect, u, t, text,
  // theme, orient, backdrop, w, h, fonts, surface, glyphPath, probe, quality, fresh (a new engine: no history),
  // level (adaptive preview level to render at), prefill (a colour the surface holds before the frame), textScale (the
  // cut's text.scale), using (an engine record from engineFor to render with), asset (media mode: a fixture of the fake
  // store, 'fixture:<name>', put in the part's media param) }. kind 'shot' / 'rig' shows a camera preset (key).
  async function renderPart(o) {
    const source = o.parts || defaultSource();
    if (!source) throw new Error('lab: no parts registry on this page');
    const asset = o.asset ? fixtureAsset(o.asset) : null;
    const rec = o.using || engineFor(source, !!o.fonts, !!o.fresh, !!asset);
    const reg = rec.registry;
    const camera = CAM_KINDS.includes(o.kind);
    let params = o.params;
    if (asset) {
      const param = mediaParamOf(o.kind && o.key ? reg.get(o.kind, o.key) : null);
      if (!param) throw new Error('lab: ' + o.kind + '/' + o.key + ' has no media param');
      params = Object.assign({}, o.params, { [param]: asset.id });
    }
    const ref = o.kind && o.key ? { kind: o.kind, key: o.key, params } : {};
    if (camera && !cameraKeys(o.kind).includes(o.key)) throw new Error('lab: unknown ' + o.kind + ' preset ' + o.key);
    if (ref.kind && !camera && !reg.get(ref.kind, ref.key)) throw new Error('lab: unknown part ' + ref.kind + '/' + ref.key + ' in ' + source);
    const plan = FAC.samplePlan(reg, ref, { text: o.text, theme: o.theme, aspect: o.aspect, orient: o.orient, backdrop: o.backdrop,
      textScale: o.textScale });
    if (asset) plan.media = mediaFixtures().planMedia([asset.id]);
    rec.engine.setPlan(plan);
    if (o.fonts) await rec.engine.prepare(0, plan.duration, { export: true });
    const t = Number.isFinite(o.t) ? o.t : timeAt(rec.engine, plan, o.kind, o.u);
    const [w, h] = o.w && o.h ? [o.w, o.h] : fitSize(plan.design.aspect, VIEW_W, VIEW_H);
    const surface = o.surface || makeSurface(w, h, o.backdrop !== 'clear');
    if (o.prefill) {
      surface.ctx.setTransform(1, 0, 0, 1, 0, 0);
      surface.ctx.fillStyle = o.prefill;
      surface.ctx.fillRect(0, 0, surface.w, surface.h);
    }
    if (Number.isInteger(o.level)) rec.engine.setLevel(o.level);
    const stats = rec.engine.renderFrame(surface, t, { quality: o.quality || 'preview', pick: true,
      scale: Math.min(surface.w / plan.design.w, surface.h / plan.design.h), glyphPath: o.glyphPath, probe: o.probe,
      backdrop: o.backdrop });
    return { plan, t, stats, surface, engine: rec.engine, registry: reg };
  }

  function pixels(surface) { return surface.ctx.getImageData(0, 0, surface.w, surface.h).data; }

  // Luminance variance over the frame (0 = one flat colour).
  function variance(surface) {
    const d = pixels(surface);
    let n = 0, sum = 0, sq = 0;
    for (let i = 0; i < d.length; i += 16) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y; sq += y * y; n++;
    }
    const mean = sum / n;
    return sq / n - mean * mean;
  }

  function hashPixels(surface) {
    const d = pixels(surface);
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // --- the pose view --------------------------------------------------------------------------------------------------

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    const p = props || {};
    for (const k of Object.keys(p)) {
      if (k === 'style') Object.assign(node.style, p.style);
      else if (k === 'text') node.textContent = p.text;
      else if (k === 'on') for (const [evt, fn] of Object.entries(p.on)) node.addEventListener(evt, fn);
      else node[k] = p[k];
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) node.append(kid);
    return node;
  }

  function fmt(v, col) {
    if (!Number.isFinite(v)) return String(v);
    if (ANGLE_COLS.includes(col)) return ((v * 180) / Math.PI).toFixed(1);
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3);
  }

  // The glyph path the renderer takes for this pose (§4.19.5; 'glow' text style always glows).
  function pathOf(P, i, style) {
    const glow = P.glow[i] + (style === 'glow' ? 1 : 0);
    return P.blur[i] < SP.DIRECT_BLUR && glow < 0.01 && P.shard[i] === 0 && P.pixel[i] < 1 ? 'direct' : 'sprite';
  }

  function poseTable(scene) {
    const cell = { padding: '1px 6px', textAlign: 'right' };
    const table = el('table', { style: { borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'ui-monospace, monospace' } });
    table.append(el('tr', {}, ...['node', 'ch'].concat(POSE_COLS, ['path']).map((c) => el('th', { text: c,
      style: { padding: '2px 6px', borderBottom: '1px solid #555', textAlign: 'right' } }))));
    if (!scene) return table;
    const t = scene.table, P = t.live;
    for (let i = scene.text.from, rows = 0; i < scene.text.to && rows < POSE_ROWS; i++, rows++) {
      const rec = scene.stores.glyph[t.payload[i]];
      const cells = [String(i), rec ? rec.ch : '?'].concat(POSE_COLS.map((c) => fmt(P[c][i], c)), [rec ? pathOf(P, i, rec.style) : '']);
      table.append(el('tr', {}, ...cells.map((c) => el('td', { text: c, style: cell }))));
    }
    return table;
  }

  // --- hash routes ----------------------------------------------------------------------------------------------------

  function parseHash(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    const [head, ...rest] = raw.split('&');
    const out = { mode: 'part', kind: null, key: null, aspect: '16:9', u: 0.5, text: '', theme: '', orient: '', parts: '',
      backdrop: 'scene', fonts: false, asset: '' };
    const at = head.lastIndexOf('@');
    const main = at >= 0 ? head.slice(0, at) : head;
    const tail = at >= 0 ? decodeURIComponent(head.slice(at + 1)) : '';
    if (main === 'gallery') out.mode = 'gallery';
    else if (main.startsWith('text:')) { out.mode = 'text'; out.text = decodeURIComponent(main.slice(5)); out.orient = tail === 'v' ? 'v' : 'h'; }
    else if (main.startsWith('media:')) {
      const [kind, key] = main.slice(6).split('/');
      out.mode = 'media'; out.kind = KINDS.includes(kind) ? kind : null; out.key = key || null;
    } else if (main) {
      const [kind, key] = main.split(':');
      out.kind = KINDS.includes(kind) || CAM_KINDS.includes(kind) ? kind : null; out.key = key || null;
    }
    if (out.mode !== 'text' && ASPECTS.includes(tail)) out.aspect = tail;
    for (const pair of rest) {
      const eq = pair.indexOf('=');
      const k = eq < 0 ? pair : pair.slice(0, eq), v = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1));
      if (k === 't') out.u = Number(v);
      else if (k === 'fonts') out.fonts = v !== '0';
      else if (Object.prototype.hasOwnProperty.call(out, k) && k !== 'mode') out[k] = v;
    }
    return out;
  }

  function formatHash(s) {
    if (s.mode === 'gallery') return '#gallery@' + s.aspect + (s.parts ? '&parts=' + s.parts : '');
    if (s.mode === 'text') return '#text:' + encodeURIComponent(s.text) + '@' + (s.orient === 'v' ? 'v' : 'h');
    const u = Math.round(s.u * 1000) / 1000;
    let h = s.mode === 'media'
      ? '#media:' + (s.kind || 'ground') + '/' + (s.key || '') + '@' + s.aspect + '&asset=' + encodeURIComponent(s.asset || FIXTURE + 'jpeg') + '&t=' + u
      : '#' + (s.kind || 'arrive') + ':' + (s.key || '') + '@' + s.aspect + '&t=' + u;
    for (const k of ['text', 'theme', 'orient', 'parts']) if (s[k]) h += '&' + k + '=' + encodeURIComponent(s[k]);
    if (s.backdrop && s.backdrop !== 'scene') h += '&backdrop=' + s.backdrop;
    if (s.fonts) h += '&fonts=1';
    return h;
  }

  // --- the page -------------------------------------------------------------------------------------------------------

  function select(options, value, onChange) {
    const s = el('select', { on: { change: () => onChange(s.value) } }, ...options.map((v) => el('option', { value: v, text: v || '—' })));
    s.value = value;
    return s;
  }

  function mountPage(root, t) {
    const state = parseHash(location.hash);
    const view = el('canvas', { width: VIEW_W, height: VIEW_H, style: { background: '#111', maxWidth: '100%' } });
    const bar = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', margin: '8px 0' } });
    const info = el('div', { style: { fontSize: '12px', color: '#aaa', margin: '4px 0' } });
    const poses = el('div', { style: { overflow: 'auto', maxHeight: '420px' } });
    const main = el('main', { style: { fontFamily: 'system-ui, sans-serif', color: '#e8e8e8', padding: '16px' } },
      el('h1', { text: t('lab.title'), style: { fontSize: '20px', margin: '0 0 4px' } }), bar, view, info, poses);
    main.dataset.state = 'lab';
    root.replaceChildren(main);
    document.body.style.background = '#1b1d22';
    let playing = false, frame = 0, busy = false;

    function apply(patch) {
      Object.assign(state, patch);
      const h = formatHash(state);
      if (location.hash !== h) history.replaceState(null, '', h);
      draw();
    }

    function controls() {
      const src = state.parts || defaultSource();
      bar.replaceChildren();
      if (!src) { bar.append(el('span', { text: 'No parts yet: parts/catalog is not built, and this page has no test fixtures.' })); return null; }
      const media = state.mode === 'media';
      const reg = media ? mediaRegistry(src) : registryOf(src);
      const found = media ? mediaParts(reg) : [];
      const keysOf = (k) => (media ? found.filter((m) => m.kind === k).map((m) => m.key)
        : CAM_KINDS.includes(k) ? cameraKeys(k).slice() : reg.keys(k));
      const kinds = media ? [...new Set(found.map((m) => m.kind))] : KINDS.filter((k) => reg.keys(k).length).concat(CAM_KINDS);
      const kind = state.kind && kinds.includes(state.kind) && keysOf(state.kind).length ? state.kind : kinds[0] || 'arrive';
      const keys = keysOf(kind);
      const key = keys.includes(state.key) ? state.key : keys[0];
      state.kind = kind; state.key = key;
      if (media && !state.asset) state.asset = FIXTURE + 'jpeg';
      const slider = el('input', { type: 'range', min: '0', max: '1', step: '0.005', value: String(state.u),
        on: { input: () => apply({ u: Number(slider.value) }) } });
      const text = el('input', { type: 'text', value: state.text, placeholder: FAC.SAMPLE_TEXT, style: { width: '200px' },
        on: { change: () => apply({ text: text.value }) } });
      const play = el('button', { text: playing ? 'pause' : 'play',
        on: { click: () => { playing = !playing; play.textContent = playing ? 'pause' : 'play'; tick(); } } });
      bar.append(
        select(sources(), src, (v) => apply({ parts: v, key: null })),
        select(kinds, kind, (v) => apply({ kind: v, key: null })),
        select(keys, key, (v) => apply({ key: v })),
        media ? select(mediaFixtures().FIXTURES.map((a) => FIXTURE + a.name), state.asset, (v) => apply({ asset: v })) : null,
        select(ASPECTS, state.aspect, (v) => apply({ aspect: v })),
        select([''].concat(reg.keys('theme')), state.theme, (v) => apply({ theme: v })),
        select(['', 'h', 'v'], state.orient, (v) => apply({ orient: v })),
        select(['scene', 'chroma', 'black', 'clear'], state.backdrop, (v) => apply({ backdrop: v })),
        text, slider, play,
        el('button', { text: 'gallery', on: { click: () => apply({ mode: 'gallery' }) } }),
        hasMediaFixtures() ? el('button', { text: media ? 'parts' : 'media',
          on: { click: () => apply({ mode: media ? 'part' : 'media', kind: null, key: null }) } }) : null);
      return reg;
    }

    async function drawPart() {
      const reg = controls();
      if (!reg) return;
      const [w, h] = fitSize(state.aspect, VIEW_W, VIEW_H);
      if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
      const surface = { canvas: view, ctx: view.getContext('2d'), w, h };
      const r = await renderPart({ parts: state.parts || defaultSource(), kind: state.kind, key: state.key, aspect: state.aspect,
        u: state.u, text: state.text, theme: state.theme, orient: state.orient, backdrop: state.backdrop, fonts: state.fonts, surface,
        asset: state.mode === 'media' ? state.asset : '' });
      const scene = r.engine.scene('cut', 0);
      const tm = scene ? scene.times : null;
      const cam = CAM_KINDS.includes(state.kind) ? r.engine.viewAt(r.t) : null;
      info.textContent = state.kind + '/' + state.key + '  t=' + r.t.toFixed(3) + 's  ' + (tm ? 'times a=' + tm.a.toFixed(2) + ' rest=' +
        tm.rest.toFixed(2) + ' out=' + tm.out.toFixed(2) + ' b=' + tm.b.toFixed(2) : '') + '  drawn ' + JSON.stringify(r.stats.drawn) +
        '  passes ' + r.stats.passes + (r.stats.media ? '  media ' + JSON.stringify(r.stats.media) : '') +
        (cam ? '  camera x=' + cam.x.toFixed(1) + ' y=' + cam.y.toFixed(1) + ' zoom=' + cam.zoom.toFixed(3) + ' roll=' + cam.roll.toFixed(3) : '');
      poses.replaceChildren(poseTable(scene));
    }

    function drawGallery() {
      const src = state.parts || defaultSource();
      bar.replaceChildren(el('button', { text: 'back', on: { click: () => apply({ mode: 'part' }) } }),
        select(ASPECTS, state.aspect, (v) => apply({ aspect: v })));
      poses.replaceChildren();
      info.textContent = '';
      view.width = 1; view.height = 1;
      if (!src) return;
      const { engine, registry } = engineFor(src, false);
      const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
      for (const kind of REG.PART_KINDS) {
        for (const key of registry.keys(kind)) {
          const [w, h] = fitSize(state.aspect, 240, 135);
          const c = el('canvas', { width: w, height: h });
          engine.thumb({ kind, key }, { canvas: c, ctx: c.getContext('2d'), w, h }, { aspect: state.aspect });
          grid.append(el('figure', { style: { margin: 0, cursor: 'pointer' }, on: { click: () => apply({ mode: 'part', kind, key }) } },
            c, el('figcaption', { text: kind + '/' + key, style: { fontSize: '11px' } })));
        }
      }
      poses.style.maxHeight = 'none';
      poses.append(grid);
    }

    function drawText() {
      bar.replaceChildren(el('button', { text: 'back', on: { click: () => apply({ mode: 'part' }) } }));
      info.textContent = 'text mode: ' + (state.orient === 'v' ? 'vertical' : 'horizontal');
      view.width = 1; view.height = 1;
      poses.style.maxHeight = 'none';
      poses.replaceChildren(textSheet(state.text || FAC.SAMPLE_TEXT, state.orient === 'v', state.parts || defaultSource()));
    }

    async function draw() {
      if (busy) return;
      busy = true;
      try {
        if (state.mode === 'gallery') drawGallery();
        else if (state.mode === 'text') drawText();
        else { poses.style.maxHeight = '420px'; await drawPart(); }
      } catch (e) {
        info.textContent = 'error: ' + (e && e.message);
      } finally { busy = false; }
    }

    function tick() {
      if (!playing) { cancelAnimationFrame(frame); return; }
      state.u = (state.u + 1 / 90) % 1;
      draw().then(() => { frame = requestAnimationFrame(tick); });
    }

    window.addEventListener('hashchange', () => { Object.assign(state, parseHash(location.hash)); draw(); });
    draw();
    return { draw, state };
  }

  // --- text mode (WP2): the sample in every face the themes name, with the real measurer and FontBook ------------------

  function textSheet(sample, vertical, source) {
    const wrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px' } });
    const fonts = HF.createFontBook({ document, timeoutMs: 8000 });
    const measurer = HM.createCanvasMeasurer(factory, fonts);
    let reg = null;
    try { reg = source ? registryOf(source) : null; } catch (e) { reg = null; }
    const themes = reg ? reg.all('theme') : [];
    const lang = S.lineScript(sample, 'ja');
    const seen = new Set();
    const cards = [];
    for (const theme of themes) {
      const faces = JSON.parse(JSON.stringify(FACES.resolveFaces(theme, null, [lang])));
      for (const role of ['display', 'serif', 'body']) {
        const ref = FACES.fontFor(faces, role, lang);
        if (seen.has(ref.key)) continue;
        seen.add(ref.key);
        const c = el('canvas', { width: vertical ? 220 : 720, height: vertical ? 620 : 150 });
        cards.push({ c, faces, role, ref });
        wrap.append(el('figure', { style: { margin: 0 } }, c, el('figcaption', { text: ref.family + ' ' + ref.weight + ' (' + role + ')',
          style: { fontSize: '11px' } })));
      }
    }
    const paint = () => {
      for (const card of cards) {
        const svc = TS.createTextService({ measurer, faces: card.faces });
        const W = card.c.width, Hh = card.c.height;
        const spec = { text: sample, orient: vertical ? 'v' : 'h', face: card.role, size: vertical ? 120 : 96,
          box: { x: 10, y: 10, w: W - 20, h: Hh - 20 }, fit: 'shrink', maxLines: vertical ? 2 : 1, breakAt: 'phrase', lang };
        const lay = svc.layout(spec);
        const g = card.c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, Hh);
        g.lineWidth = 1;
        for (let i = 0; i < lay.n; i++) {
          const x = lay.box.x + lay.x[i], y = lay.box.y + lay.y[i];
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.strokeStyle = 'rgba(200,60,60,0.5)';
          g.strokeRect(x - lay.w[i] / 2, y - lay.h[i] / 2, lay.w[i], lay.h[i]);
          g.translate(x, y);
          if (lay.rot[i] === 2) g.scale(-1, 1);
          if (lay.rot[i]) g.rotate(Math.PI / 2);
          if (lay.sx && lay.sx[i] !== 1) g.scale(lay.sx[i], 1);
          g.fillStyle = '#1c1a17'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = lay.fonts[lay.font ? lay.font[i] : 0].css(lay.em ? lay.em[i] : lay.size);
          g.fillText(lay.ch[i], 0, 0);
        }
      }
    };
    fonts.on('epoch', paint);
    for (const card of cards) {
      const usage = FACES.fontUsage(card.faces, [{ role: card.role, lang, text: sample }]);
      fonts.request(usage.refs, usage.textByFamily);
    }
    paint();
    if (!cards.length) wrap.append(el('p', { text: 'No themes to take faces from (no parts registry).' }));
    return wrap;
  }

  // --- contact sheets ----------------------------------------------------------------------------------------------------

  // sheet(o) → { png: data URL, cells, errors, width, height } — a labelled grid: one row per part, one column per
  // normalized time. o = { parts, kind, keys, aspect, times, text, theme, orient, backdrop, cell (px width), fonts, asset }
  // kind 'shot' / 'rig': camera presets; asset: the media mode (the parts with a media param, showing that fixture).
  async function sheet(o) {
    const source = o.parts || defaultSource();
    const reg = o.asset ? mediaRegistry(source) : registryOf(source);
    const kind = o.kind;
    const camera = CAM_KINDS.includes(kind);
    if (!KINDS.includes(kind) && !camera) throw new Error('lab.sheet: unknown kind ' + kind);
    const all = camera ? cameraKeys(kind) : o.asset ? mediaParts(reg).filter((m) => m.kind === kind).map((m) => m.key) : reg.keys(kind);
    const keys = (o.keys && o.keys.length ? o.keys : all).filter((k) => !!k);
    const times = o.times && o.times.length ? o.times : [0.1, 0.3, 0.6, 0.9];
    const aspect = ASPECTS.includes(o.aspect) ? o.aspect : '16:9';
    const [dw, dh] = DOC.DESIGN_SIZE[aspect];
    const cellW = Math.max(80, Math.min(640, o.cell || (dw >= dh ? 320 : 200)));
    const cellH = Math.round((cellW * dh) / dw);
    const labelW = 200, headH = 54, gap = 6;
    const W = labelW + times.length * (cellW + gap) + gap, Hh = headH + keys.length * (cellH + gap) + gap;
    const canvas = el('canvas', { width: W, height: Hh });
    const g = canvas.getContext('2d');
    g.fillStyle = '#1b1d22'; g.fillRect(0, 0, W, Hh);
    g.textBaseline = 'top';
    g.fillStyle = '#e8e8e8'; g.font = '600 15px system-ui, sans-serif';
    const themeKey = o.theme || reg.fallback('theme');
    g.fillText(kind + ' · ' + aspect + ' · theme ' + themeKey + ' · parts ' + source + ' · "' + (o.text || FAC.SAMPLE_TEXT) + '"', gap, 8);
    g.font = '12px system-ui, sans-serif'; g.fillStyle = '#aaa';
    times.forEach((u, c) => g.fillText('u = ' + Number(u).toFixed(2), labelW + c * (cellW + gap) + 4, 34));
    const cell = makeSurface(cellW, cellH, o.backdrop !== 'clear');
    const errors = [];
    let cells = 0;
    for (let r = 0; r < keys.length; r++) {
      const key = keys[r];
      const y = headH + r * (cellH + gap);
      const def = camera ? { label: { ja: kind, en: kind } } : reg.get(kind, key);
      g.fillStyle = '#e8e8e8'; g.font = '600 13px system-ui, sans-serif';
      g.fillText(key, gap, y + 4);
      g.font = '12px system-ui, sans-serif'; g.fillStyle = '#aaa';
      if (def) g.fillText(def.label.ja + ' / ' + def.label.en, gap, y + 22);
      for (let c = 0; c < times.length; c++) {
        const x = labelW + c * (cellW + gap);
        try {
          if (!def) throw new Error('unknown part');
          const res = await renderPart({ parts: source, kind, key, aspect, u: times[c], text: o.text, theme: o.theme, orient: o.orient,
            backdrop: o.backdrop, fonts: o.fonts, surface: cell, quality: 'export', asset: o.asset });
          g.drawImage(cell.canvas, x, y);
          g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y + cellH - 16, 70, 16);
          g.fillStyle = '#fff'; g.font = '11px system-ui, sans-serif';
          g.fillText('t=' + res.t.toFixed(2) + 's', x + 3, y + cellH - 14);
          cells++;
        } catch (e) {
          errors.push(kind + '/' + key + ' u=' + times[c] + ': ' + (e && e.message));
          g.fillStyle = '#5a1d1d'; g.fillRect(x, y, cellW, cellH);
          g.fillStyle = '#ffb4b4'; g.font = '12px system-ui, sans-serif';
          g.fillText(String(e && e.message).slice(0, 60), x + 6, y + 6);
        }
      }
    }
    return { png: canvas.toDataURL('image/png'), cells, errors, width: W, height: Hh };
  }

  // --- browser-test API (window.__lab) -------------------------------------------------------------------------------------

  const pageErrors = [];

  // The text block's box in device px (from the pick boxes of the last frame), padded a little.
  function textBox(engine, surface, scale) {
    const box = engine.boxes().find((b) => b.owner === 'text');
    if (!box) return null;
    const q = box.quad;
    const x0 = Math.max(0, Math.floor(q[0] * scale) - 4), y0 = Math.max(0, Math.floor(q[1] * scale) - 4);
    const x1 = Math.min(surface.w, Math.ceil(q[4] * scale) + 4), y1 = Math.min(surface.h, Math.ceil(q[5] * scale) + 4);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  function region(surface, b) { return surface.ctx.getImageData(b.x, b.y, b.w, b.h).data; }

  function meanAbs(a, b) {
    let sum = 0, max = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; if (d > max) max = d; n++; }
    }
    return { mae: sum / n / 255, max: max / 255 };
  }

  const PARITY_TEXT = '夜明けの街を走る光と君のRoad声が届く';    // 20 graphemes: kana, kanji and Latin

  function sizeFor(aspect, short) {
    const [dw, dh] = DOC.DESIGN_SIZE[aspect] || DOC.DESIGN_SIZE['16:9'];
    const k = short / Math.min(dw, dh);
    return [Math.round(dw * k), Math.round(dh * k)];
  }

  // parity(o) → { mae, max, glyphs, box }: the same frame with every glyph on the direct path and on the level-0 sprite
  // path (§4.19.5), compared over the text block. o = { parts, kind, key, orient, aspect, short, text, theme }
  async function parity(o) {
    const opt = o || {};
    const aspect = opt.aspect || '16:9';
    const [w, h] = sizeFor(aspect, opt.short || 1080);
    const base = { parts: opt.parts, kind: opt.kind, key: opt.key, orient: opt.orient, aspect, text: opt.text || PARITY_TEXT,
      theme: opt.theme, w, h, quality: 'preview', level: 0 };
    const a = await renderPart(Object.assign({}, base, { glyphPath: 'direct', surface: makeSurface(w, h, false) }));
    const box = textBox(a.engine, a.surface, w / a.plan.design.w);
    const b = await renderPart(Object.assign({}, base, { glyphPath: 'sprite', surface: makeSurface(w, h, false) }));
    if (!box) return { mae: 1, max: 1, glyphs: 0, box: null };
    const r = meanAbs(region(a.surface, box), region(b.surface, box));
    return { mae: r.mae, max: r.max, glyphs: a.stats.drawn.glyphs, spriteGlyphs: b.stats.drawn.glyphs, box };
  }

  // blurSweep(o) → { steps: [{ blur, diff }], box }: the text block at increasing blur (du, added to every glyph);
  // diff = mean abs change from the previous step. The direct → sprite switch and the level crossfades must not jump.
  async function blurSweep(o) {
    const opt = o || {};
    const [w, h] = sizeFor('16:9', opt.short || 1080);
    const from = opt.from || 0, to = opt.to === undefined ? 3 : opt.to, step = opt.step || 0.025;
    const surfaces = [makeSurface(w, h, false), makeSurface(w, h, false)];
    const steps = [];
    let prev = null, box = null;
    for (let k = 0, blur = from; blur <= to + 1e-9; k++, blur = from + k * step) {
      const s = surfaces[k & 1];
      const r = await renderPart({ parts: opt.parts, aspect: '16:9', text: opt.text || PARITY_TEXT, w, h, surface: s,
        probe: { blur }, quality: 'preview', level: 0 });
      if (!box) box = textBox(r.engine, s, w / r.plan.design.w);
      const cur = region(s, box);
      steps.push({ blur: Math.round(blur * 1000) / 1000, diff: prev ? meanAbs(prev, cur).mae : 0 });
      prev = cur;
    }
    return { steps, box };
  }

  function projectDoc(name) {
    const fx = fixtures();
    const doc = fx && fx.projects && fx.projects[name];
    if (!doc) throw new Error('lab: no project fixture ' + name);
    return JSON.parse(JSON.stringify(doc));
  }

  const projectEngines = new Map();

  // frames(o) → { hashes, duration }: pixel hashes of a fixture project at the given times; fresh = a new engine.
  async function frames(o) {
    const source = o.parts || defaultSource();
    let rec = !o.fresh && projectEngines.get(source + '|' + o.project);
    if (!rec) {
      rec = engineFor(source, false, true);
      rec.engine.setDoc(projectDoc(o.project));
      if (!o.fresh) projectEngines.set(source + '|' + o.project, rec);
    }
    const plan = rec.engine.plan;
    const w = o.w || 640, h = o.h || Math.round((w * plan.design.h) / plan.design.w);
    const s = makeSurface(w, h, false);
    const hashes = [];
    for (const t of o.times) {
      rec.engine.renderFrame(s, t, { quality: o.quality || 'export', pick: false, scale: w / plan.design.w });
      hashes.push(hashPixels(s));
    }
    return { hashes, duration: plan.duration };
  }

  function percentile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0; }

  function copyPlan(plan) {
    const out = JSON.parse(JSON.stringify(plan));
    Object.defineProperty(out, 'env', { enumerable: false, value: plan.env });
    return out;
  }

  const CUT_PARTICLES = 400;         // the cut scenes' material particle budget (DESIGN_2_1 §5.9.4)

  function autoParams(reg, kind, key, feat, look, seed) {
    const ax = { f: feat, look: { amounts: look.amounts, mood: null, bpm: 120 } };
    const p = {};
    for (const { name, spec } of reg.params(kind, key)) {
      p[name] = SCH.autoValue(spec, Object.assign({}, ax, { rng: RNG.stream(seed, 'param', kind, key, name) }));
    }
    return p;
  }

  // The sample material of each kind in every slot it fits (the 'materials' source): arrive, dwell, depart, lens, one
  // ornament and one filter on every cut; the ground and the atmosphere of every segment.
  function withMaterials(plan, reg) {
    const out = copyPlan(plan);
    const mat = (kind) => reg.keys(kind).find((k) => k.startsWith(MATERIAL_KEY) && (kind !== 'ornament' ||
      reg.get(kind, k).scope !== 'run')) || null;
    const atmos = reg.keys('ornament').find((k) => k.startsWith(MATERIAL_KEY) && reg.get('ornament', k).scope === 'run') || null;
    const decision = (kind, key, feat, seed) => ({ v: key, p: autoParams(reg, kind, key, feat, out.look, seed), from: 'auto' });
    out.cuts.forEach((c, i) => {
      for (const kind of ['arrive', 'dwell', 'depart', 'lens']) if (mat(kind)) c.slots[kind] = decision(kind, mat(kind), c.feat, i);
      if (mat('ornament')) {
        c.slots['ornament.count'] = { v: Math.max(1, (c.slots['ornament.count'] || { v: 0 }).v), from: 'auto' };
        c.slots['ornament#0'] = decision('ornament', mat('ornament'), c.feat, i);
      }
      if (mat('filter')) {
        c.slots['filter.count'] = { v: Math.max(1, (c.slots['filter.count'] || { v: 0 }).v), from: 'auto' };
        const d = decision('filter', mat('filter'), c.feat, i);
        d.p.when = 'always';
        c.slots['filter#0'] = d;
      }
      c.fp += '|materials';
    });
    out.grounds.forEach((g, i) => {
      const feat = (out.cuts.find((c) => g.cuts.includes(c.key)) || out.cuts[0]).feat;
      if (mat('ground')) g.ground = decision('ground', mat('ground'), feat, 1000 + i);
      if (atmos) g.atmos = decision('ornament', atmos, feat, 2000 + i);
      g.fp += '|materials';
    });
    return out;
  }

  // perf(o) → frame times (ms) of a fixture project rendered for `seconds` at `fps` with the short side `short` (720 by
  // default). Each frame is followed by a 1-pixel read, so the time includes the canvas work, not only the recording of
  // the calls. o.camera: the automatic camerawork at full strength (work:amount.camera pinned to 1, so the planner's
  // shots, DESIGN_2_1 §4.7, are the most it makes) under a rig (work:rig pinned to slowSwell: project_long's own runs
  // draw none); o.materials: the sample materials in every slot (source 'materials'). The result adds behaveP50 (the
  // behave stage: evaluation and world solve), shots (cut scenes in the window with a shot), rigs (rig runs other than
  // 'none') and mixShare (the smallest particle share of the scenes built).
  async function perf(o) {
    const source = o.parts || defaultSource();
    const rec = engineFor(source, false, true);
    const doc = projectDoc(o.project);
    if (o.camera) {
      doc.pins = Object.assign({}, doc.pins, { 'work:amount.camera': { v: 1, by: 'user' }, 'work:rig': { v: 'slowSwell', by: 'user' } });
    }
    rec.engine.setDoc(doc);
    let plan = rec.engine.plan;
    if (o.materials) plan = withMaterials(plan, rec.engine.registry);
    if (plan !== rec.engine.plan) rec.engine.setPlan(plan);
    const short = o.short || 720;
    const k = short / Math.min(plan.design.w, plan.design.h);
    const w = Math.round(plan.design.w * k), h = Math.round(plan.design.h * k);
    const s = makeSurface(w, h, false);
    const fps = o.fps || 30, seconds = o.seconds || 10, start = o.start || 0;
    const ropts = { quality: 'export', pick: true, scale: w / plan.design.w };
    // As in the app (ui/boot installPrepare): the preview shows a frame, then prepares around the playhead — which
    // warms the sprites of blurred motion at the scale of that frame — and keeps doing so while it plays.
    rec.engine.renderFrame(s, start, ropts);
    await rec.engine.prepare(start, start + seconds, { export: false });
    for (let i = 0; i < 5; i++) { rec.engine.renderFrame(s, start + i / fps, ropts); s.ctx.getImageData(0, 0, 1, 1); }
    const times = [], behave = [];
    const stages = { behave: 0, draw: 0, post: 0 };
    const n = Math.round(seconds * fps);
    let shots = 0, share = 1;
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      rec.engine.renderFrame(s, start + i / fps, ropts);
      s.ctx.getImageData(0, 0, 1, 1);
      times.push(performance.now() - t0);
      const st = rec.engine.stats().stageMs;
      stages.behave += st.behave; stages.draw += st.draw; stages.post += st.post;
      behave.push(st.behave);
    }
    // Material particles are drawn by paints (not in drawn.particles): the budget is read from the chosen defs, Σ
    // mine.cost.particles of a cut, and the share env.mixShare scales it by (min(1, 400 / Σ), DESIGN_2_1 §5.9.4).
    let particles = 0;
    plan.cuts.forEach((c, i) => {
      if (c.b < start || c.a > start + seconds) return;
      const scene = rec.engine.scene('cut', i);
      if (scene && scene.shot) shots++;
      let sum = 0;
      for (const [slot, d] of Object.entries(c.slots)) {
        const kind = slot.split('#')[0];
        const def = d && typeof d.v === 'string' && REG.PART_KINDS.includes(kind) ? rec.engine.registry.get(kind, d.v) : null;
        const cost = def && def.mine ? def.mine.cost : null;
        if (cost && cost.particles > 0) sum += cost.particles;
      }
      particles = Math.max(particles, sum);
    });
    share = particles > CUT_PARTICLES ? CUT_PARTICLES / particles : 1;
    const sorted = times.slice().sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
    for (const k of Object.keys(stages)) stages[k] /= Math.max(1, n);
    return { frames: n, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1] || 0, mean,
      stages, behaveP50: percentile(behave.sort((a, b) => a - b), 0.5), w, h, scenes: rec.engine.stats().scenes, shots,
      rigs: (plan.rigs || []).filter((r) => r.rig && r.rig.v !== 'none').length, particles, mixShare: share };
  }

  async function renderApi(o) {
    const surface = o.w && o.h ? makeSurface(o.w, o.h, o.backdrop !== 'clear') : undefined;
    const r = await renderPart(Object.assign({}, o, { surface }));
    return { t: r.t, stats: r.stats, variance: variance(r.surface), warnings: r.engine.warnings(), w: r.surface.w, h: r.surface.h,
      hash: hashPixels(r.surface), view: r.engine.viewAt(r.t), media: r.engine.mediaAt(r.t) };
  }

  // thumb(o) → { variance, hash, w, h, stats }: engine.thumb of a part or a camera preset (kind 'shot' / 'rig'), the tile
  // the pickers show. o = { parts, kind, key, params, aspect, w, h }
  function thumbApi(o) {
    const rec = engineFor(o.parts || defaultSource(), false, false);
    const [w, h] = o.w && o.h ? [o.w, o.h] : fitSize(o.aspect || '16:9', 240, 135);
    const surface = makeSurface(w, h, true);
    const stats = rec.engine.thumb({ kind: o.kind, key: o.key, params: o.params }, surface, { aspect: o.aspect });
    return { variance: variance(surface), hash: hashPixels(surface), w, h, stats };
  }

  // sequence(o) → [{ hash, glyphs }]: one fresh engine renders o's part once per step, in order; a step { w, h, probe,
  // u, t } overrides o. Frame N of a sequence must not depend on the steps before it (determinism.py).
  async function sequence(o) {
    const using = engineFor(o.parts || defaultSource(), !!o.fonts, true, !!o.asset);
    const out = [];
    for (const step of o.steps || []) {
      const w = step.w || o.w, h = step.h || o.h;
      const surface = w && h ? makeSurface(w, h, o.backdrop !== 'clear') : undefined;
      const r = await renderPart(Object.assign({}, o, step, { surface, using }));
      out.push({ hash: hashPixels(r.surface), glyphs: r.stats.drawn.glyphs });
    }
    return out;
  }

  // info() → { sources, parts: { source: { kind: keys } }, notes: { source: text }, problems: { source: [...] }, aspects,
  //   camera: { shot: keys, rig: keys }, media: { parts: { source: [{ kind, key, param, accept }] }, fixtures: [names] } | null }
  function info() {
    const out = { sources: sources(), parts: {}, notes: {}, problems: {}, aspects: ASPECTS.slice(),
      camera: { shot: SHOT.SHOT_KEYS.slice(), rig: SHOT.RIG_KEYS.slice() }, media: null };
    if (hasMediaFixtures()) {
      out.media = { parts: {}, fixtures: mediaFixtures().FIXTURES.map((a) => a.name) };
      for (const src of out.sources) {
        try { out.media.parts[src] = mediaParts(mediaRegistry(src)); } catch (e) { out.media.parts[src] = []; }
      }
    }
    for (const src of out.sources) {
      let reg;
      try { reg = registryOf(src); } catch (e) { out.notes[src] = String(e && e.message); out.parts[src] = {}; continue; }
      out.parts[src] = {};
      for (const kind of KINDS) out.parts[src][kind] = ownKeys(src, reg, kind);
      if (notes[src]) out.notes[src] = notes[src];
      if (reg.problems && reg.problems.length) out.problems[src] = reg.problems.slice(0, 50);
    }
    return out;
  }

  function installApi(page) {
    window.addEventListener('error', (e) => pageErrors.push(String(e.message || e.error)));
    window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));
    window.__lab = Object.freeze({ info, render: renderApi, thumb: thumbApi, sequence, sheet, parity, blurSweep, frames, perf,
      errors: () => pageErrors.slice(), page });
  }

  function start() {
    const t = I18N.createT(MV.LANG, strings);
    document.title = t('lab.title');
    const page = mountPage(document.getElementById('app'), t);
    installApi(page);
    return { sources: sources() };
  }

  return { start, parseHash, formatHash };
});
