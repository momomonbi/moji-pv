/* 文字PVメーカー v2 — original work. Typefaces: theme faces per role and script, fallbacks, Google Fonts URLs (DESIGN §4.14). */
MV.def('engine/text/faces', ['core/script'], (S) => {
  'use strict';

  const ROLES = Object.freeze(['display', 'serif', 'body']);
  const SCRIPTS = Object.freeze(['ja', 'latin', 'ko', 'zhHant', 'zhHans']);
  const FLAVOR_NAMES = Object.freeze(['mincho', 'gothic', 'round', 'brush', 'heavy', 'antique']);
  const CSS2 = 'https://fonts.googleapis.com/css2?';
  const MAX_URL = 1800;

  // Flavor table (§4.14): families for ko / zhHant / zhHans when a theme names only ja and latin.
  const FLAVORS = deepFreeze({
    mincho: { ko: { family: 'Nanum Myeongjo' }, zhHant: { family: 'Noto Serif TC' }, zhHans: { family: 'Noto Serif SC' } },
    gothic: { ko: { family: 'Noto Sans KR' }, zhHant: { family: 'Noto Sans TC' }, zhHans: { family: 'Noto Sans SC' } },
    round: { ko: { family: 'Gowun Dodum' }, zhHant: { family: 'Noto Sans TC' }, zhHans: { family: 'Noto Sans SC' } },
    brush: { ko: { family: 'Nanum Pen Script' }, zhHant: { family: 'LXGW WenKai TC' }, zhHans: { family: 'Ma Shan Zheng' } },
    heavy: {
      ko: { family: 'Black Han Sans' }, zhHant: { family: 'Noto Sans TC', weight: 900 }, zhHans: { family: 'ZCOOL QingKe HuangYou' },
    },
    antique: { ko: { family: 'Gowun Batang' }, zhHant: { family: 'Noto Serif TC' }, zhHans: { family: 'Noto Serif SC' } },
  });

  // Every family named by the themes (§5.10) and the flavor table, with the weights Google Fonts serves (checked
  // with the CSS2 API on day one; a weight it does not serve makes the whole request fail with HTTP 400).
  // script: which faces slot the family is for; kind: its own style, used for the fallback stack.
  const FAMILY_ROWS = [
    // Japanese
    ['Yuji Syuku', 'ja', 'brush', [400]],
    ['Yuji Mai', 'ja', 'brush', [400]],
    ['Yomogi', 'ja', 'brush', [400]],
    ['Klee One', 'ja', 'brush', [400, 600]],
    ['Shippori Mincho B1', 'ja', 'mincho', [400, 500, 600, 700, 800]],
    ['Shippori Mincho', 'ja', 'mincho', [400, 500, 600, 700, 800]],
    ['Zen Old Mincho', 'ja', 'mincho', [400, 500, 600, 700, 900]],
    ['Hina Mincho', 'ja', 'mincho', [400]],
    ['Kaisei Decol', 'ja', 'mincho', [400, 500, 700]],
    ['Kaisei Tokumin', 'ja', 'mincho', [400, 500, 700, 800]],
    ['Kaisei HarunoUmi', 'ja', 'mincho', [400, 500, 700]],
    ['Kaisei Opti', 'ja', 'mincho', [400, 500, 700]],
    ['Zen Kaku Gothic New', 'ja', 'gothic', [300, 400, 500, 700, 900]],
    ['Zen Kaku Gothic Antique', 'ja', 'gothic', [300, 400, 500, 700, 900]],
    ['BIZ UDPGothic', 'ja', 'gothic', [400, 700]],
    ['M PLUS 1p', 'ja', 'gothic', [100, 300, 400, 500, 700, 800, 900]],
    ['Murecho', 'ja', 'gothic', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Noto Sans JP', 'ja', 'gothic', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Mochiy Pop One', 'ja', 'round', [400]],
    ['M PLUS Rounded 1c', 'ja', 'round', [100, 300, 400, 500, 700, 800, 900]],
    ['Zen Maru Gothic', 'ja', 'round', [300, 400, 500, 700, 900]],
    ['Dela Gothic One', 'ja', 'heavy', [400]],
    ['RocknRoll One', 'ja', 'heavy', [400]],
    ['Potta One', 'ja', 'heavy', [400]],
    ['Shippori Antique', 'ja', 'antique', [400]],
    ['Zen Antique', 'ja', 'antique', [400]],
    ['Zen Antique Soft', 'ja', 'antique', [400]],
    // Latin
    ['Fraunces', 'latin', 'serif', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Cormorant Garamond', 'latin', 'serif', [300, 400, 500, 600, 700]],
    ['EB Garamond', 'latin', 'serif', [400, 500, 600, 700, 800]],
    ['DM Serif Display', 'latin', 'serif', [400]],
    ['Instrument Serif', 'latin', 'serif', [400]],
    ['Playfair Display', 'latin', 'serif', [400, 500, 600, 700, 800, 900]],
    ['Bodoni Moda', 'latin', 'serif', [400, 500, 600, 700, 800, 900]],
    ['Lora', 'latin', 'serif', [400, 500, 600, 700]],
    ['Abril Fatface', 'latin', 'serif', [400]],
    ['Libre Baskerville', 'latin', 'serif', [400, 500, 600, 700]],
    ['Shrikhand', 'latin', 'serif', [400]],
    ['Inter', 'latin', 'sans', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Archivo Black', 'latin', 'sans', [400]],
    ['Righteous', 'latin', 'sans', [400]],
    ['Rubik', 'latin', 'sans', [300, 400, 500, 600, 700, 800, 900]],
    ['Space Grotesk', 'latin', 'sans', [300, 400, 500, 600, 700]],
    ['IBM Plex Sans', 'latin', 'sans', [100, 200, 300, 400, 500, 600, 700]],
    ['Work Sans', 'latin', 'sans', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Anton', 'latin', 'sans', [400]],
    ['Bungee', 'latin', 'sans', [400]],
    ['Nunito', 'latin', 'sans', [200, 300, 400, 500, 600, 700, 800, 900]],
    ['Syne', 'latin', 'sans', [400, 500, 600, 700, 800]],
    ['Manrope', 'latin', 'sans', [200, 300, 400, 500, 600, 700, 800]],
    ['Josefin Sans', 'latin', 'sans', [100, 200, 300, 400, 500, 600, 700]],
    ['Unbounded', 'latin', 'sans', [200, 300, 400, 500, 600, 700, 800, 900]],
    ['Caveat', 'latin', 'cursive', [400, 500, 600, 700]],
    // Korean and Chinese (flavor table)
    ['Nanum Myeongjo', 'ko', 'mincho', [400, 700, 800]],
    ['Noto Sans KR', 'ko', 'gothic', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Gowun Dodum', 'ko', 'round', [400]],
    ['Nanum Pen Script', 'ko', 'brush', [400]],
    ['Black Han Sans', 'ko', 'heavy', [400]],
    ['Gowun Batang', 'ko', 'antique', [400, 700]],
    ['Noto Serif TC', 'zhHant', 'mincho', [200, 300, 400, 500, 600, 700, 800, 900]],
    ['Noto Sans TC', 'zhHant', 'gothic', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['LXGW WenKai TC', 'zhHant', 'brush', [300, 400, 700]],
    ['Noto Serif SC', 'zhHans', 'mincho', [200, 300, 400, 500, 600, 700, 800, 900]],
    ['Noto Sans SC', 'zhHans', 'gothic', [100, 200, 300, 400, 500, 600, 700, 800, 900]],
    ['Ma Shan Zheng', 'zhHans', 'brush', [400]],
    ['ZCOOL QingKe HuangYou', 'zhHans', 'heavy', [400]],
  ];
  const FAMILIES = deepFreeze(Object.fromEntries(FAMILY_ROWS.map(([family, script, kind, weights]) =>
    [family, { script, kind, weights }])));

  // System stacks used when a face fails or times out (§4.14), per flavor; Japanese first.
  const SYSTEM_FALLBACK = Object.freeze({
    mincho: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",serif',
    gothic: '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans CJK JP",sans-serif',
    round: '"Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic","Noto Sans CJK JP",sans-serif',
    brush: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",serif',
    heavy: '"Hiragino Sans","Yu Gothic","Noto Sans CJK JP",sans-serif',
    antique: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",serif',
  });
  // Script-specific system families put before the flavor stack (serif or sans by flavor).
  const SCRIPT_FALLBACK = deepFreeze({
    latin: { serif: 'Georgia,"Times New Roman"', sans: '"Helvetica Neue",Arial' },
    ko: { serif: '"AppleMyungjo","Batang","Noto Serif CJK KR"', sans: '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans CJK KR"' },
    zhHant: { serif: '"Songti TC","PMingLiU","Noto Serif CJK TC"', sans: '"PingFang TC","Microsoft JhengHei","Noto Sans CJK TC"' },
    zhHans: { serif: '"Songti SC","SimSun","Noto Serif CJK SC"', sans: '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC"' },
  });
  const SERIF_FLAVORS = new Set(['mincho', 'brush', 'antique']);
  const ROLE_FLAVOR = Object.freeze({ display: 'gothic', serif: 'mincho', body: 'gothic' });
  const DEFAULT_FACE = Object.freeze({ ja: 'Noto Sans JP', latin: 'Inter', weight: 500, flavor: 'gothic' });
  // Characters drawn with the role's Latin face inside CJK lines (spaces follow their neighbours in the layout).
  const LATIN_FACE_CLASSES = new Set(['latin', 'digit', 'punctLatin']);

  function deepFreeze(o) {
    for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
    return Object.freeze(o);
  }

  // ---- weights --------------------------------------------------------------------------------------------------

  // The served weight the browser would pick for `want` (CSS font matching order); unknown families round to 100s.
  function snapWeight(family, want) {
    const w = clampWeight(want);
    const known = FAMILIES[family];
    if (!known) return w;
    const list = known.weights;
    if (list.includes(w)) return w;
    const up = list.filter((x) => x > w), down = list.filter((x) => x < w).reverse();
    let order;
    if (w >= 400 && w <= 500) order = up.filter((x) => x <= 500).concat(down, up.filter((x) => x > 500));
    else if (w < 400) order = down.concat(up);
    else order = up.concat(down);
    return order[0];
  }

  function clampWeight(v) {
    const n = Math.round(Number(v) / 100) * 100;
    return Number.isFinite(n) ? Math.min(900, Math.max(100, n)) : 400;
  }

  // ---- font refs ------------------------------------------------------------------------------------------------

  function quoteFamily(family) { return '"' + String(family).replace(/["\\]/g, '') + '"'; }

  function fallbackStack(family, script, flavor) {
    const known = FAMILIES[family];
    const serif = known && known.script === 'latin' && script === 'latin'
      ? known.kind !== 'sans' : SERIF_FLAVORS.has(flavor);
    const extra = SCRIPT_FALLBACK[script];
    const head = extra ? (serif ? extra.serif : extra.sans) + ',' : '';
    return head + SYSTEM_FALLBACK[flavor];
  }

  function formatSize(px) { return String(Number(Number(px).toFixed(3))); }

  const PX = /(\d+(?:\.\d+)?)px/;

  // The px size inside a CSS font string ('700 57.5px "Family", serif' → 57.5); 100 when there is none.
  function cssSize(css) {
    const m = PX.exec(String(css));
    return m ? Number(m[1]) : 100;
  }

  // The same CSS font string at another px size.
  function cssAt(css, px) {
    const s = String(css);
    return PX.test(s) ? s.replace(PX, formatSize(px) + 'px') : formatSize(px) + 'px ' + s;
  }

  // FontRef = { family, weight, script, flavor, role, key, stack, css(sizePx) }. JSON (and the Plan hash) sees only
  // { family, weight }, the §3.12 shape; faceRef rebuilds a full ref from that shape.
  function faceRef(family, weight, script = 'ja', flavor, role) {
    const fam = String(family);
    const scr = script === 'en' ? 'latin' : SCRIPTS.includes(script) ? script : 'ja';
    const known = FAMILIES[fam];
    const fl = FLAVOR_NAMES.includes(flavor) ? flavor : known && FLAVOR_NAMES.includes(known.kind) ? known.kind
      : ROLE_FLAVOR[role] || 'gothic';
    const w = snapWeight(fam, weight);
    const stack = fallbackStack(fam, scr, fl);
    const head = w + ' ';
    const tail = 'px ' + quoteFamily(fam) + ',' + stack;
    const at100 = head + '100' + tail;
    return Object.freeze({
      family: fam, weight: w, script: scr, flavor: fl, role: role || null, key: fam + ':' + w, stack,
      css: (sizePx) => (sizePx === 100 ? at100 : head + formatSize(sizePx) + tail),
      toJSON: () => ({ family: fam, weight: w }),
    });
  }

  const refCache = new Map();
  const REF_CACHE_MAX = 512;

  // A FontRef for any face entry: a FontRef for the same script is returned as is; { family, weight } is completed.
  function asRef(entry, script, role) {
    if (!entry || typeof entry.family !== 'string') return null;
    if (typeof entry.css === 'function' && entry.script === script) return entry;
    const flavor = entry.flavor;
    const id = [entry.family, entry.weight, script, flavor, role].join('|');
    let ref = refCache.get(id);
    if (!ref) {
      if (refCache.size >= REF_CACHE_MAX) refCache.clear();
      ref = faceRef(entry.family, entry.weight, script, flavor, role);
      refCache.set(id, ref);
    }
    return ref;
  }

  // ---- resolving a theme ----------------------------------------------------------------------------------------

  // A face pin's value: pins may be keyed by slot ('face.display.ja') or by path ('work:face.display.ja'), and hold
  // either the raw value or a pin record { v, by }.
  function pinValue(pins, slot) {
    if (!pins) return undefined;
    const raw = pins instanceof Map ? (pins.has(slot) ? pins.get(slot) : pins.get('work:' + slot))
      : pins[slot] !== undefined ? pins[slot] : pins['work:' + slot];
    if (raw === undefined || raw === null) return undefined;
    return typeof raw === 'object' && 'v' in raw ? raw.v : raw;
  }

  function familyPin(pins, slot) {
    const v = pinValue(pins, slot);
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }

  function weightPin(pins, slot) {
    const v = Number(pinValue(pins, slot));
    return Number.isFinite(v) && v >= 100 && v <= 900 ? v : undefined;
  }

  function scriptKeys(scriptsUsed) {
    if (!scriptsUsed) return SCRIPTS.slice();
    const used = new Set(['latin']);
    for (const s of scriptsUsed) used.add(s === 'en' ? 'latin' : s);
    return SCRIPTS.filter((s) => used.has(s));
  }

  // resolveFaces(theme, pins, scriptsUsed) → { display: { ja, latin, … }, serif, body } of FontRefs.
  // Scripts: 'latin' always, plus each script used ('en' counts as latin); every script when scriptsUsed is omitted.
  function resolveFaces(theme, pins, scriptsUsed) {
    const scripts = scriptKeys(scriptsUsed);
    const out = {};
    for (const role of ROLES) {
      const tf = (theme && theme.faces && theme.faces[role]) || DEFAULT_FACE;
      const flavor = FLAVORS[tf.flavor] ? tf.flavor : ROLE_FLAVOR[role];
      const pinnedWeight = weightPin(pins, 'face.' + role + '.weight');
      const baseWeight = pinnedWeight !== undefined ? pinnedWeight : Number(tf.weight) || 400;
      const entry = {};
      for (const script of scripts) {
        const pinned = familyPin(pins, 'face.' + role + '.' + script);
        let family = pinned, weight = baseWeight;
        if (!family && (script === 'ja' || script === 'latin')) family = tf[script] || DEFAULT_FACE[script];
        if (!family) {
          const row = FLAVORS[flavor][script];
          family = row.family;
          if (row.weight && pinnedWeight === undefined) weight = row.weight;
        }
        const known = FAMILIES[family];
        const refFlavor = pinned && known && FLAVOR_NAMES.includes(known.kind) ? known.kind : flavor;
        entry[script] = faceRef(family, weight, script, refFlavor, role);
      }
      out[role] = entry;
    }
    return out;
  }

  // fontFor(faces, role, script) → FontRef. Latin runs inside CJK lines ask for script 'latin' (or 'en').
  // A script the faces do not hold borrows the role's ja face (then latin), keeping its own fallback stack.
  function fontFor(faces, role, script) {
    const key = script === 'en' ? 'latin' : SCRIPTS.includes(script) ? script : 'ja';
    const map = faces && (faces[role] || faces.display || faces.body || faces.serif);
    const entry = map && (map[key] || map.ja || map.latin);
    return asRef(entry, key, role) || faceRef(DEFAULT_FACE[key === 'latin' ? 'latin' : 'ja'], DEFAULT_FACE.weight, key,
      DEFAULT_FACE.flavor, role);
  }

  function usesLatinFace(cls) { return LATIN_FACE_CLASSES.has(cls); }

  // ---- weight ladders (v2.2, DESIGN_2_2 §4: 太さのアニメーション) ------------------------------------------------------

  // ladderOf(ref) → the served weights of the ref's family, ascending (a family outside FAMILIES — a user's face pin —
  // has only its own weight, so it never animates).
  function ladderOf(ref) {
    const k = FAMILIES[ref.family];
    return k ? k.weights : Object.freeze([ref.weight]);
  }

  // atWeight(ref, w) → the same family, script, flavor and role at the served weight w; one stable object per (ref, w),
  // so sprite keys and draw-context comparisons stay cheap.
  const RUNGS = new WeakMap();
  function atWeight(ref, w) {
    if (w === ref.weight) return ref;
    let m = RUNGS.get(ref);
    if (!m) { m = new Map(); RUNGS.set(ref, m); }
    let r = m.get(w);
    if (!r) { r = faceRef(ref.family, w, ref.script, ref.flavor, ref.role); m.set(w, r); }
    return r;
  }

  // weightPair(ref, dw, out) → out = { lo, hi, f, plain }: the two served weights around ref.weight + dw (clamped to the
  // ladder) and how far between them (hi is null when f = 0). A pair within W_EPS of a rung snaps to it; plain = the
  // face's own weight alone. Allocation-free after the first call per rung.
  const W_EPS = 1 / 64;
  function weightPair(ref, dw, out) {
    const L = ladderOf(ref), w = ref.weight + dw, top = L[L.length - 1];
    let lo = L[0], hi = L[0], f = 0;
    if (w >= top) { lo = top; hi = top; }
    else if (w > L[0]) { let k = 0; while (L[k + 1] <= w) k++; lo = L[k]; hi = L[k + 1]; f = (w - lo) / (hi - lo); }
    if (f < W_EPS) { hi = lo; f = 0; } else if (f > 1 - W_EPS) { lo = hi; f = 0; }
    out.lo = atWeight(ref, lo);
    out.hi = f > 0 ? atWeight(ref, hi) : null;
    out.f = f;
    out.plain = f === 0 && lo === ref.weight;
    return out;
  }

  // roomOf(ref) → { below, above }: weight units between the face's weight and the lightest / heaviest served weight.
  function roomOf(ref) {
    const L = ladderOf(ref);
    return { below: ref.weight - L[0], above: L[L.length - 1] - ref.weight };
  }

  // growTop(ref) → the heaviest served weight up to GROW_TOP (the bold end of 太字へ); the face's own weight when none is.
  const GROW_TOP = 800;
  function growTop(ref) {
    let t = null;
    for (const w of ladderOf(ref)) if (w <= GROW_TOP) t = w;
    return t === null ? ref.weight : t;
  }

  // rungsBetween(ref, dlo, dhi) → the served weights a weight reach [dlo, dhi] can draw (the rungs on both sides of
  // every weight in the reach), ascending.
  function rungsBetween(ref, dlo, dhi) {
    const L = ladderOf(ref), a = ref.weight + dlo, b = ref.weight + dhi;
    let lo = L[0], hi = L[L.length - 1];
    for (const w of L) if (w <= a) lo = w;
    for (let k = L.length - 1; k >= 0; k--) if (L[k] >= b) hi = L[k];
    return L.filter((w) => w >= lo && w <= hi);
  }

  // reweigh(faces, role, w) → faces whose `role` entries are the same families at weight w (snapped per family); the
  // other roles are the same objects. Cached per (faces, role, w), so a cut's layout key stays stable.
  const REWEIGHED = new WeakMap();
  function reweigh(faces, role, w) {
    if (!faces || typeof faces !== 'object') return faces;
    const r = ROLES.includes(role) ? role : 'display';
    let m = REWEIGHED.get(faces);
    if (!m) { m = new Map(); REWEIGHED.set(faces, m); }
    const id = r + '|' + w;
    let out = m.get(id);
    if (!out) {
      const entry = faces[r] || {};
      const next = {};
      for (const script of Object.keys(entry)) {
        const e = entry[script];
        if (!e || typeof e.family !== 'string') { next[script] = e; continue; }
        const scr = typeof e.css === 'function' ? e.script : script;
        next[script] = faceRef(e.family, w, scr, e.flavor, typeof e.css === 'function' ? e.role || r : r);
      }
      out = Object.freeze(Object.assign({}, faces, { [r]: Object.freeze(next) }));
      m.set(id, out);
    }
    return out;
  }

  // ---- Google Fonts URLs ----------------------------------------------------------------------------------------

  function uniqueChars(text) {
    const set = new Set();
    for (const ch of String(text || '')) if (!/\s/.test(ch) && ch >= ' ') set.add(ch);
    return [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
  }

  // A Latin family: known as one, or (not in FAMILIES) asked for as the Latin script.
  function isLatinFamily(family, script) {
    const known = FAMILIES[family];
    return known ? known.script === 'latin' : script === 'latin' || script === 'en';
  }

  // loadText(ref, text) → the characters (sorted, unique) to load `ref` for with document.fonts.load. Google serves a
  // Latin family whole, split into unicode-range subsets, and a load for characters no subset covers (a Japanese-only
  // text) loads nothing. So a Latin family keeps only what it draws (Latin letters, digits, punctuation); '' means
  // "no such character" and the caller loads the default subset. CJK families keep every character (their URL is
  // already cut to them by text=).
  function loadText(ref, text) {
    const all = uniqueChars(text);
    if (!ref || !isLatinFamily(ref.family, ref.script)) return all;
    let out = '';
    for (const ch of all) if (usesLatinFace(S.charClass(ch))) out += ch;
    return out;
  }

  function encodeFamily(family) { return encodeURIComponent(family).replace(/%20/g, '+'); }

  function isCjkFamily(family, refs) {
    return FAMILIES[family] ? !isLatinFamily(family) : refs.some((r) => !isLatinFamily(family, r.script));
  }

  // cssUrls(refs, textByFamily) → Google Fonts CSS2 URLs, one per family, sorted by family. CJK families carry
  // &text= with the characters used (sorted, unique); Latin families are requested whole; a URL longer than 1800
  // characters drops its text=. Families outside FAMILIES are requested without a weight axis (the default face), since
  // asking for a weight a family lacks fails the whole request.
  function cssUrls(refs, textByFamily = {}) {
    const byFamily = new Map();
    for (const ref of refs || []) {
      if (!ref || !ref.family) continue;
      if (!byFamily.has(ref.family)) byFamily.set(ref.family, []);
      byFamily.get(ref.family).push(ref);
    }
    const out = [];
    for (const family of [...byFamily.keys()].sort()) {
      const list = byFamily.get(family);
      const weights = [...new Set(list.map((r) => snapWeight(family, r.weight)))].sort((a, b) => a - b);
      const axis = FAMILIES[family] ? ':wght@' + weights.join(';') : '';
      const head = CSS2 + 'family=' + encodeFamily(family) + axis;
      const tail = '&display=swap';
      const chars = isCjkFamily(family, list) ? uniqueChars(textByFamily[family]) : '';
      const withText = chars ? head + '&text=' + encodeURIComponent(chars) + tail : head + tail;
      out.push(withText.length > MAX_URL ? head + tail : withText);
    }
    return out;
  }

  // fontUsage(faces, items: [{ role, lang, text }]) → { refs, textByFamily }: which faces a set of texts needs and which
  // characters each family draws (Latin letters, digits and ASCII punctuation go to the role's Latin face).
  function fontUsage(faces, items) {
    const refs = new Map();
    const chars = new Map();
    const add = (ref, g) => {
      refs.set(ref.key + '|' + ref.script, ref);
      if (!chars.has(ref.family)) chars.set(ref.family, new Set());
      if (g) chars.get(ref.family).add(g);
    };
    for (const item of items || []) {
      const role = ROLES.includes(item.role) ? item.role : 'display';
      const main = fontFor(faces, role, item.lang);
      const latin = fontFor(faces, role, 'latin');
      add(main);
      for (const g of S.graphemes(String(item.text || ''))) {
        const cls = S.charClass(g);
        if (cls === 'space') continue;
        add(usesLatinFace(cls) ? latin : main, g);
      }
    }
    const textByFamily = {};
    for (const [family, set] of [...chars.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      textByFamily[family] = uniqueChars([...set].join(''));
    }
    const list = [...refs.values()].sort((a, b) => (a.key + a.script < b.key + b.script ? -1 : 1));
    return { refs: list, textByFamily };
  }

  return {
    ROLES, SCRIPTS, FLAVOR_NAMES, FLAVORS, FAMILIES, SYSTEM_FALLBACK, SCRIPT_FALLBACK,
    resolveFaces, fontFor, cssUrls, fontUsage, faceRef, asRef, snapWeight, usesLatinFace, uniqueChars, cssSize, cssAt,
    isLatinFamily, loadText,
    ladderOf, atWeight, weightPair, roomOf, growTop, rungsBetween, reweigh, W_EPS, GROW_TOP,
  };
});
