/* 文字PVメーカー v2 — original work. Parameter specs: coercion, AutoSpec evaluation, descriptions and validation (DESIGN §4.2, DESIGN_2_1 §3.5, §11.2.3). */
MV.def('core/schema', ['core/num', 'core/ease', 'core/color', 'core/curve', 'core/shot'], (N, E, C, CV, SHOT) => {
  'use strict';

  const ORDERS = Object.freeze(['lead', 'tail', 'core', 'rim', 'scatter', 'word', 'line', 'sweepX', 'sweepY', 'radial',
    'emphFirst', 'sung']);
  const TYPES = Object.freeze(['num', 'int', 'bool', 'enum', 'ease', 'order', 'ink', 'color', 'face', 'text', 'curve', 'shot',
    'rig', 'partRefs', 'media']);
  const UNITS = Object.freeze(['', 's', 'du', 'em', 'deg', 'frac', 'x', 'Hz']);
  const FACES = Object.freeze(['display', 'serif', 'body']);
  const AMOUNT_KEYS = Object.freeze(['motion', 'glitch', 'chroma', 'ornament', 'density', 'texture', 'groundSwitch',
    'flash', 'shake', 'camera', 'pace']);
  const TAGS = Object.freeze(['soft', 'hard', 'fast', 'slow', 'playful', 'serious', 'digital', 'organic', 'literary',
    'bold', 'minimal', 'busy', 'dark', 'bright', 'retro', 'wet', 'airy']);
  const SOURCES = Object.freeze(['energy', 'density', 'cells', 'dur', 'tempo', 'position', 'emph', 'impact']);
  const AUTO_FORMS = Object.freeze(['value', 'pick', 'range', 'fn']);
  const TEXT_MAX = 40;
  const JITTER = 0.2;
  const NEUTRAL = 0.5;                        // a source whose input is missing reads as the middle of its scale
  const LINE_BREAKS = /\r\n|[\n\r\u0085\u2028\u2029]/g;
  // partRefs (v2.1): "kind.key" items of these part kinds; sorted, unique, at most 24.
  const REF_KINDS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'ground', 'ornament', 'lens', 'filter', 'seam']);
  const PART_REF = /^([a-z]+)\.([a-z][A-Za-z0-9]{2,31})$/;
  const REFS_MAX = 24;
  const MEDIA_ID = /^a[0-9a-f]{24}$/;
  const ACCEPTS = Object.freeze(['image', 'video', 'any']);

  class SchemaError extends Error {
    constructor(code, message) { super(message); this.name = 'SchemaError'; this.code = code; }
  }

  // --- coerce ------------------------------------------------------------------------------------------------

  // The value v as the spec allows it, or undefined when v cannot be read as that type.
  function coerce(spec, v) {
    switch (spec && spec.type) {
      case 'num': return coerceNum(spec, v);
      case 'int': return coerceInt(spec, v);
      case 'bool': return !!v;
      case 'enum': return Array.isArray(spec.of) && spec.of.includes(v) ? v : undefined;
      case 'ease': return E.EASES.includes(v) ? v : undefined;
      case 'order': return ORDERS.includes(v) ? v : undefined;
      case 'ink': return C.TOKENS.includes(v) ? v : C.isHex(v) ? v.toUpperCase() : undefined;
      case 'color': return C.isHex(v) ? v.toUpperCase() : undefined;
      case 'face': return FACES.includes(v) ? v : undefined;
      case 'text': return coerceText(spec, v);
      case 'curve': return CV.coerce(v);
      case 'shot': return SHOT.coerceShot(v);
      case 'rig': return SHOT.coerceRig(v);
      case 'partRefs': return coerceRefs(v);
      case 'media': return v === '' || (typeof v === 'string' && MEDIA_ID.test(v)) ? v : undefined;
      default: throw new SchemaError('bad-spec', 'unknown param type ' + (spec && spec.type));
    }
  }

  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

  function bound(spec, x) {
    if (isNumber(spec.min) && x < spec.min) x = spec.min;
    if (isNumber(spec.max) && x > spec.max) x = spec.max;
    return x === 0 ? 0 : x;                  // no -0 in documents
  }

  // Snaps to base + k·step; toPrecision(12) removes binary noise such as 0.30000000000000004.
  function snap(x, step, base) {
    const k = Math.round((x - base) / step);
    return Number((base + k * step).toPrecision(12));
  }

  function coerceNum(spec, v) {
    if (!isNumber(v)) return undefined;
    const x = bound(spec, v);
    if (!(spec.step > 0)) return x;
    return bound(spec, snap(x, spec.step, isNumber(spec.min) ? spec.min : 0));
  }

  function coerceInt(spec, v) {
    return isNumber(v) ? bound(spec, Math.round(v)) : undefined;
  }

  // Line breaks become spaces; the result is cut to `max` code points (never inside a surrogate pair).
  function coerceText(spec, v) {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return undefined;
    const flat = String(v).replace(LINE_BREAKS, ' ');
    const max = spec.max > 0 ? Math.floor(spec.max) : TEXT_MAX;
    return flat.length <= max ? flat : Array.from(flat).slice(0, max).join('');
  }

  // A sorted, de-duplicated, frozen list of at most 24 "kind.key" refs; items that do not read are dropped.
  function coerceRefs(v) {
    if (!Array.isArray(v)) return undefined;
    const out = [...new Set(v.filter((x) => {
      const m = typeof x === 'string' ? PART_REF.exec(x) : null;
      return !!m && REF_KINDS.includes(m[1]);
    }))].sort();
    return Object.freeze(out.slice(0, REFS_MAX));
  }

  // A value every spec of this type accepts; used when an auto yields something the type cannot hold.
  function baseValue(spec) {
    switch (spec.type) {
      case 'num': case 'int': return coerce(spec, isNumber(spec.min) ? spec.min : 0);
      case 'bool': return false;
      case 'enum': return spec.of[0];
      case 'ease': return 'linear';
      case 'order': return ORDERS[0];
      case 'ink': return 'ink';
      case 'color': return '#000000';
      case 'face': return FACES[0];
      case 'curve': return 'linear';
      case 'shot': case 'rig': return 'none';
      case 'partRefs': return Object.freeze([]);
      default: return '';
    }
  }

  // --- AutoSpec ----------------------------------------------------------------------------------------------

  function isParamSpec(spec) { return !!spec && typeof spec === 'object' && typeof spec.type === 'string'; }

  // autoValue(ParamSpec, ax) → coerced value. It also accepts a bare AutoSpec (as planner/params passes spec.auto);
  // then the raw value is returned, since there is no type to coerce to.
  // ax = { f: CutFeatures, look: { amounts, mood: MoodDef, bpm }, rng: Stream }
  function autoValue(spec, ax) {
    if (!isParamSpec(spec)) return rawAuto(spec, ax || {});
    const v = coerce(spec, rawAuto(spec.auto, ax || {}));
    return v !== undefined ? v : baseValue(spec);
  }

  function rawAuto(auto, ax) {
    if (!auto || typeof auto !== 'object') throw new SchemaError('bad-auto', 'missing AutoSpec');
    if ('value' in auto) return auto.value;
    if (Array.isArray(auto.pick)) {
      return auto.weights ? rngOf(ax).weighted(auto.pick, auto.weights) : rngOf(ax).pick(auto.pick);
    }
    if (Array.isArray(auto.range)) return rangeValue(auto, ax);
    if (typeof auto.fn === 'function') return auto.fn(ax.f, ax.rng, ax.look);
    throw new SchemaError('bad-auto', 'unknown AutoSpec form');
  }

  function rangeValue(auto, ax) {
    const lo = auto.range[0], hi = auto.range[1];
    const r = rngOf(ax).next();
    if (auto.follow === undefined) return lo + (hi - lo) * r;
    const jitter = auto.jitter === undefined ? JITTER : auto.jitter;
    return N.lerp(lo, hi, N.clamp(sourceValue(auto.follow, ax) + (r - 0.5) * jitter));
  }

  function rngOf(ax) {
    if (!ax.rng || typeof ax.rng.next !== 'function') throw new SchemaError('no-rng', 'AutoSpec needs ax.rng');
    return ax.rng;
  }

  // Normalized SOURCE value in [0, 1] (DESIGN §4.2 table); a leading '-' inverts it.
  function sourceValue(source, ax) {
    const inverted = source.charCodeAt(0) === 45;
    const x = N.clamp(readSource(inverted ? source.slice(1) : source, (ax && ax.f) || {}, (ax && ax.look) || {}));
    return inverted ? 1 - x : x;
  }

  function scaled(v, fn) { return isNumber(v) ? fn(v) : NEUTRAL; }

  function readSource(key, f, look) {
    switch (key) {
      case 'energy': return scaled(f.energy, (x) => x);
      case 'density': return scaled(f.cps, (x) => x / 12);
      case 'cells': return scaled(f.cells, (x) => (x - 2) / 28);
      case 'dur': return scaled(f.dur, (x) => (x - 0.5) / 5.5);
      case 'tempo': return look.bpm ? scaled(look.bpm, (x) => (x - 60) / 120) : NEUTRAL;
      case 'position': return scaled(f.pos, (x) => x);
      case 'emph': return f.emph ? 1 : 0;
      case 'impact': return f.impact ? 1 : 0;
      default: break;
    }
    if (key.startsWith('amount.')) return scaled(look.amounts && look.amounts[key.slice(7)], (x) => x);
    if (key.startsWith('mood.')) {
      const bias = look.mood && look.mood.tagBias ? look.mood.tagBias[key.slice(5)] : undefined;
      return ((isNumber(bias) ? bias : 1) - 0.25) / 1.75;
    }
    throw new SchemaError('bad-source', 'unknown auto source ' + key);
  }

  function isSource(source) {
    if (typeof source !== 'string') return false;
    const key = source.charCodeAt(0) === 45 ? source.slice(1) : source;
    if (SOURCES.includes(key)) return true;
    if (key.startsWith('amount.')) return AMOUNT_KEYS.includes(key.slice(7));
    if (key.startsWith('mood.')) return TAGS.includes(key.slice(5));
    return false;
  }

  // --- describeAuto ------------------------------------------------------------------------------------------
  // core/* cannot use the i18n table (L0 < L1), so the few words this needs live here as [ja, en] pairs.

  const SOURCE_WORDS = {
    energy: ['エネルギー', 'energy'], density: ['文字の密度', 'text density'], cells: ['文字量', 'text length'],
    dur: ['カットの長さ', 'cut length'], tempo: ['テンポ', 'tempo'], position: ['曲中の位置', 'position in the song'],
    emph: ['強調', 'emphasis'], impact: ['見せ場', 'impact'],
  };
  const AMOUNT_WORDS = {
    motion: ['動き', 'motion'], glitch: ['グリッチ', 'glitch'], chroma: ['色ずれ', 'chroma'],
    ornament: ['装飾', 'decoration'], density: ['密度', 'density'], texture: ['質感', 'texture'],
    groundSwitch: ['背景の切り替え', 'background switching'], flash: ['フラッシュ', 'flash'], shake: ['揺れ', 'shake'],
    camera: ['カメラ', 'camera'], pace: ['テンポ感', 'pace'],
  };
  const TAG_WORDS = {
    soft: ['やわらか', 'soft'], hard: ['硬質', 'hard'], fast: ['速い', 'fast'], slow: ['ゆったり', 'slow'],
    playful: ['遊び心', 'playful'], serious: ['まじめ', 'serious'], digital: ['デジタル', 'digital'],
    organic: ['有機的', 'organic'], literary: ['文学的', 'literary'], bold: ['大胆', 'bold'],
    minimal: ['ミニマル', 'minimal'], busy: ['にぎやか', 'busy'], dark: ['暗め', 'dark'], bright: ['明るめ', 'bright'],
    retro: ['レトロ', 'retro'], wet: ['しっとり', 'wet'], airy: ['軽やか', 'airy'],
  };
  const PHRASES = {
    always: [(v) => '常に ' + v, (v) => 'always ' + v],
    oneOf: [(v) => v + ' から選ぶ', (v) => 'one of ' + v],
    random: [() => 'ランダム', () => 'random'],
    follows: [(s) => s + 'に連動', (s) => 'follows ' + s],
    against: [(s) => s + 'と逆に連動', (s) => 'inverse of ' + s],
    amount: [(s) => s + 'の量', (s) => s + ' amount'],
    mood: [(s) => '雰囲気（' + s + '）', (s) => 'mood (' + s + ')'],
    on: [() => 'オン', () => 'on'],
    off: [() => 'オフ', () => 'off'],
    none: [() => 'なし', () => 'none'],
    media: [() => '写真・動画', () => 'photo or video'],
  };

  // Short human text for an auto: '0.45–0.9 · エネルギーに連動' / '0.45–0.9 · follows energy'; fn autos show spec.why[lang].
  function describeAuto(spec, lang) {
    const li = lang === 'en' ? 1 : 0;
    const auto = isParamSpec(spec) ? spec.auto : spec;
    const type = isParamSpec(spec) ? spec.type : undefined;
    if (!auto || typeof auto !== 'object') return '';
    if (type === 'media' && 'value' in auto) return showValue(auto.value, li, type);
    if ('value' in auto) return PHRASES.always[li](showValue(auto.value, li, type));
    if (Array.isArray(auto.pick)) {
      const shown = [...new Set(auto.pick.map((v) => showValue(v, li, type)))];
      return PHRASES.oneOf[li](shown.join(' / '));
    }
    if (Array.isArray(auto.range)) {
      const span = showNumber(auto.range[0]) + '–' + showNumber(auto.range[1]);
      return span + ' · ' + (auto.follow === undefined ? PHRASES.random[li]() : followText(auto.follow, li));
    }
    if (typeof auto.fn === 'function') {
      const why = auto.why || {};
      return why[lang === 'en' ? 'en' : 'ja'] || why.ja || why.en || '';
    }
    return '';
  }

  function followText(source, li) {
    const inverted = source.charCodeAt(0) === 45;
    const key = inverted ? source.slice(1) : source;
    return PHRASES[inverted ? 'against' : 'follows'][li](sourceWord(key, li));
  }

  function sourceWord(key, li) {
    if (SOURCE_WORDS[key]) return SOURCE_WORDS[key][li];
    if (key.startsWith('amount.')) {
      const k = key.slice(7);
      return PHRASES.amount[li](AMOUNT_WORDS[k] ? AMOUNT_WORDS[k][li] : k);
    }
    if (key.startsWith('mood.')) {
      const t = key.slice(5);
      return PHRASES.mood[li](TAG_WORDS[t] ? TAG_WORDS[t][li] : t);
    }
    return key;
  }

  // Object values (custom curves, shots, rigs) show as the curve key or 'custom'; the inspector's display text comes
  // from core/curve.label and core/shot.label, not from here.
  function showValue(v, li, type) {
    if (typeof v === 'boolean') return PHRASES[v ? 'on' : 'off'][li]();
    if (typeof v === 'number') return showNumber(v);
    if (type === 'media') return v === '' ? PHRASES.none[li]() : PHRASES.media[li]();
    if (Array.isArray(v)) return v.length ? v.join(', ') : PHRASES.none[li]();
    if (v !== null && typeof v === 'object') return type === 'curve' || CV.isCurve(v) ? CV.keyOf(v) : 'custom';
    return String(v);
  }

  function showNumber(x) { return String(Number.isInteger(x) ? x : Math.round(x * 1000) / 1000); }

  // --- validateSpec ------------------------------------------------------------------------------------------

  // [] when valid; otherwise one message per broken rule, each starting with the param name.
  // opts.label = false skips the label rule (labels are required for part params, DESIGN §4.2).
  function validateSpec(name, spec, opts) {
    const errors = [];
    const bad = (rule) => { errors.push(name + ': ' + rule); };
    if (!spec || typeof spec !== 'object') { bad('spec must be an object'); return errors; }
    if (!TYPES.includes(spec.type)) { bad('unknown type ' + JSON.stringify(spec.type)); return errors; }
    checkShape(spec, bad);
    if (spec.unit !== undefined && !UNITS.includes(spec.unit)) bad('unknown unit ' + JSON.stringify(spec.unit));
    if (!(opts && opts.label === false) || spec.label !== undefined) checkLabel(spec.label, bad);
    if (spec.ui !== undefined && spec.ui !== 'basic' && spec.ui !== 'advanced') bad("ui must be 'basic' or 'advanced'");
    if (spec.ai !== undefined && typeof spec.ai !== 'boolean') bad('ai must be a boolean');
    checkAuto(spec, bad);
    return errors;
  }

  function checkShape(spec, bad) {
    if (spec.type === 'num' || spec.type === 'int') {
      if (!isNumber(spec.min) || !isNumber(spec.max)) bad('min and max must be finite numbers');
      else if (spec.min > spec.max) bad('min must be ≤ max');
      else if (spec.type === 'int' && !(Number.isInteger(spec.min) && Number.isInteger(spec.max))) bad('int bounds must be integers');
      if (spec.step !== undefined && !(isNumber(spec.step) && spec.step > 0)) bad('step must be a positive number');
    }
    if (spec.type === 'enum') {
      const of = spec.of;
      if (!Array.isArray(of) || of.length === 0) bad('enum needs a non-empty "of" list');
      else if (!of.every((v) => typeof v === 'string' || isNumber(v))) bad('enum values must be strings or numbers');
      else if (new Set(of).size !== of.length) bad('enum values must be unique');
    }
    if (spec.type === 'text' && spec.max !== undefined && !(Number.isInteger(spec.max) && spec.max > 0)) {
      bad('text max must be a positive integer');
    }
    if (spec.type === 'media') {
      if (spec.accept !== undefined && !ACCEPTS.includes(spec.accept)) bad('media accept must be image, video or any');
      if (!spec.auto || typeof spec.auto !== 'object' || !('value' in spec.auto)) bad('a media auto must be a constant { value }');
    }
  }

  function checkLabel(label, bad) {
    const ok = (s) => typeof s === 'string' && s.trim() !== '';
    if (!label || typeof label !== 'object' || !ok(label.ja) || !ok(label.en)) bad('label needs non-empty ja and en');
  }

  function checkAuto(spec, bad) {
    const auto = spec.auto;
    if (!auto || typeof auto !== 'object') { bad('auto is required'); return; }
    const forms = AUTO_FORMS.filter((k) => k in auto);
    if (forms.length !== 1) { bad('auto must have exactly one of value, pick, range, fn'); return; }
    if (auto.weights !== undefined && forms[0] !== 'pick') bad('auto weights only go with pick');
    if ((auto.follow !== undefined || auto.jitter !== undefined) && forms[0] !== 'range') bad('auto follow/jitter only go with range');
    if (forms[0] === 'value') checkCandidate(spec, auto.value, bad);
    if (forms[0] === 'pick') checkPick(spec, auto, bad);
    if (forms[0] === 'range') checkRange(spec, auto, bad);
    if (forms[0] === 'fn') checkFn(auto, bad);
  }

  function checkCandidate(spec, v, bad) {
    const shown = JSON.stringify(v);
    const typed = spec.type === 'bool' ? typeof v === 'boolean'
      : spec.type === 'text' ? typeof v === 'string'
        : spec.type === 'int' ? Number.isInteger(v)
          : coerce(spec, v) !== undefined;
    if (!typed) { bad('auto value ' + shown + ' is not a valid ' + spec.type); return; }
    if ((spec.type === 'num' || spec.type === 'int') && isNumber(spec.min) && isNumber(spec.max) &&
        (v < spec.min || v > spec.max)) bad('auto value ' + shown + ' is outside min..max');
  }

  function checkPick(spec, auto, bad) {
    const pick = auto.pick;
    if (!Array.isArray(pick) || pick.length === 0) { bad('auto pick must be a non-empty array'); return; }
    for (const v of pick) checkCandidate(spec, v, bad);
    if (auto.weights === undefined) return;
    const w = auto.weights;
    if (!Array.isArray(w) || w.length !== pick.length) bad('auto weights must match pick in length');
    else if (!w.every((x) => isNumber(x) && x >= 0)) bad('auto weights must be finite numbers ≥ 0');
    else if (!w.some((x) => x > 0)) bad('auto weights must not all be 0');
  }

  function checkRange(spec, auto, bad) {
    if (spec.type !== 'num' && spec.type !== 'int') { bad('auto range needs a num or int param'); return; }
    const r = auto.range;
    if (!Array.isArray(r) || r.length !== 2 || !isNumber(r[0]) || !isNumber(r[1])) {
      bad('auto range must be [lo, hi] numbers'); return;
    }
    if (r[0] > r[1]) bad('auto range lo must be ≤ hi');
    if (isNumber(spec.min) && isNumber(spec.max) && (r[0] < spec.min || r[1] > spec.max)) bad('auto range is outside min..max');
    if (auto.follow !== undefined && !isSource(auto.follow)) bad('unknown auto follow source ' + JSON.stringify(auto.follow));
    if (auto.jitter !== undefined && !(isNumber(auto.jitter) && auto.jitter >= 0)) bad('auto jitter must be a number ≥ 0');
  }

  function checkFn(auto, bad) {
    if (typeof auto.fn !== 'function') bad('auto fn must be a function');
    const why = auto.why;
    const ok = (s) => typeof s === 'string' && s.trim() !== '';
    if (!why || typeof why !== 'object' || !ok(why.ja) || !ok(why.en)) bad('auto fn needs why with non-empty ja and en');
  }

  return {
    ORDERS, TYPES, UNITS, FACES, AMOUNT_KEYS, TAGS, SOURCES,
    coerce, autoValue, sourceValue, describeAuto, validateSpec, SchemaError,
  };
});
