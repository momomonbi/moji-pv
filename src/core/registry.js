/* 文字PVメーカー v2 — original work. Part registry: validation of part definitions, lookups, auto-pick pools and extension by materials (DESIGN §4.6, §4.18; DESIGN_2_1 §3.6). */
MV.def('core/registry', ['core/schema', 'core/color', 'core/hash'], (S, C, H) => {
  'use strict';

  const KINDS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'ground', 'ornament', 'lens', 'filter', 'seam',
    'theme', 'mood']);
  const PART_KINDS = Object.freeze(KINDS.slice(0, 9));
  const KINDS_SORTED = Object.freeze(KINDS.slice().sort());
  const TAGS = S.TAGS;
  const AMOUNT_KEYS = S.AMOUNT_KEYS;
  const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
  const ROLES = Object.freeze(['lyric', 'focus', 'title', 'interlude', 'outro']);
  const NEEDS = Object.freeze(['blur', 'shard', 'mask', 'depth', 'beats', 'level', 'textAt', 'media']);
  const STAGES = Object.freeze(['shape', 'tone', 'light', 'optic', 'film']);
  const UNITS = Object.freeze(['glyph', 'word', 'line', 'run']);
  const TEXT_STYLES = Object.freeze(['plain', 'outline', 'shadow', 'glow', 'duo']);
  const FACE_ROLES = Object.freeze(['display', 'serif', 'body']);
  const SCRIPTS = Object.freeze(['ja', 'en', 'zhHant', 'zhHans', 'ko']);
  const ASPECTS = Object.freeze(['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9']);
  const FIXED_FALLBACK = Object.freeze({ theme: 'sumiWashi', mood: 'quietHush' });
  const KEY = /^[a-z]+[A-Z][A-Za-z0-9]{1,30}$/;
  // Keys only `extend` may add (v2.1): materials 'myMat<id>' and the user's pooled media 'myMed<10 hex>' (§3.6).
  const MINE_KEY = /^(?:myMat[0-9a-z]+|myMed[0-9a-f]{10})$/;
  const MINE_PREFIX = /^my(?:Mat|Med)/;
  const CAM_VALUES = Object.freeze(['any', 'gentle', 'none']);
  const KEY_MAX = 32;                         // PARTKEY of the slot path grammar (§3.4): a longer key could not be pinned
  const PARAM = /^[a-z][A-Za-z0-9]{0,31}$/;
  const RESERVED_PARAMS = Object.freeze({ ornament: ['count'], filter: ['count'] });
  const TRAIT_DEFAULTS = Object.freeze({
    orient: Object.freeze(['h', 'v']), cells: Object.freeze([1, 40]), energy: Object.freeze([0, 1]),
    scripts: Object.freeze(['*']), aspects: Object.freeze(['*']), roles: Object.freeze(['lyric', 'focus']), impact: false,
  });

  // --- shared parameters (§3.4): names FROZEN; parts may narrow the range or change the auto ------------------

  const L = (ja, en) => Object.freeze({ ja, en });
  const unitAmount = (follow, lo, hi) => ({ type: 'num', min: 0, max: 1, step: 0.01, label: L('強さ', 'Amount'),
    auto: follow ? { range: [lo, hi], follow } : { range: [lo, hi] } });
  // v2.1 (DESIGN_2_1 §2.3): `ease` is a speed curve (the same picks of ease names, so old ease pins stay valid) and
  // `flow` spreads the stagger. The linear defaults of flow and the other curve params reproduce v2 motion exactly.
  const linearCurve = (ja, en, ui) => Object.assign({ type: 'curve', label: L(ja, en), auto: { value: 'linear' } },
    ui ? { ui } : {});
  const motionShared = (dur, each, orders, eases) => ({
    dur: { type: 'num', min: 0.05, max: 4, step: 0.01, unit: 's', label: L('長さ', 'Duration'),
      auto: { range: dur, follow: '-energy' } },
    each: { type: 'num', min: 0, max: 0.5, step: 0.005, unit: 's', label: L('ずらし', 'Stagger'),
      auto: { range: each, follow: '-density' } },
    order: { type: 'order', label: L('順番', 'Order'), auto: { pick: orders[0], weights: orders[1] } },
    ease: { type: 'curve', label: L('緩急', 'Speed curve'), auto: { pick: eases[0], weights: eases[1] } },
    flow: linearCurve('出方の緩急', 'Stagger curve', 'advanced'),
  });
  const SHARED = deepFreeze({
    arrange: {
      offsetX: { type: 'num', min: -0.4, max: 0.4, step: 0.005, unit: 'frac', label: L('横位置', 'Offset X'),
        auto: { value: 0 }, ui: 'advanced' },
      offsetY: { type: 'num', min: -0.4, max: 0.4, step: 0.005, unit: 'frac', label: L('縦位置', 'Offset Y'),
        auto: { value: 0 }, ui: 'advanced' },
    },
    arrive: motionShared([0.35, 0.8], [0.02, 0.07], [['lead', 'word', 'core'], [4, 2, 1]],
      [['expoOut', 'cubicOut', 'quadOut', 'backOut'], [3, 3, 2, 1]]),
    dwell: {
      amount: unitAmount('amount.motion', 0.2, 0.7),
      speed: { type: 'num', min: 0.25, max: 4, step: 0.05, unit: 'x', label: L('速さ', 'Speed'), auto: { value: 1 } },
      curve: linearCurve('見せの緩急', 'Hold curve', 'advanced'),
    },
    depart: motionShared([0.25, 0.6], [0.01, 0.04], [['lead', 'tail'], [3, 1]],
      [['quadIn', 'cubicIn', 'expoIn', 'sineIn'], [3, 2, 2, 1]]),
    ground: { amount: unitAmount(null, 0.35, 0.8) },
    ornament: {
      amount: unitAmount('amount.ornament', 0.3, 0.9),
      ink: { type: 'ink', label: L('色', 'Color'), auto: { pick: ['accent', 'ink', 'muted'], weights: [3, 1, 2] } },
    },
    lens: { amount: unitAmount('amount.camera', 0.2, 0.8), curve: linearCurve('動きの緩急', 'Motion curve') },
    filter: {
      amount: unitAmount(null, 0.3, 0.8),
      when: { type: 'enum', of: ['always', 'arrive', 'beat', 'impact', 'depart'], label: L('効くとき', 'When'),
        auto: { value: 'always' } },
    },
    seam: {
      dur: { type: 'num', min: 0.15, max: 1.2, step: 0.01, unit: 's', label: L('長さ', 'Duration'),
        auto: { range: [0.3, 0.7], follow: '-energy' } },
      curve: linearCurve('切り替えの緩急', 'Transition curve', 'advanced'),
    },
    theme: {},
    mood: {},
  });

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  class RegistryError extends Error {
    constructor(problems) {
      super('invalid part definitions:\n' + problems.join('\n'));
      this.name = 'RegistryError';
      this.code = 'invalid';
      this.problems = problems;
    }
  }

  // --- small checks ------------------------------------------------------------------------------------------

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function isText(v) { return typeof v === 'string' && v.trim() !== ''; }
  function isFn(v) { return typeof v === 'function'; }
  function isHex(v) { return C.isHex(v); }
  function isList(v, allowed) { return Array.isArray(v) && v.every((x) => allowed.includes(x)); }
  function isRange(v, lo, hi) {
    return Array.isArray(v) && v.length === 2 && isNumber(v[0]) && isNumber(v[1]) && v[0] <= v[1] && v[0] >= lo && v[1] <= hi;
  }
  function isWeights(v, keyOk) {
    return isObject(v) && Object.keys(v).every((k) => keyOk(k) && isNumber(v[k]) && v[k] >= 0);
  }

  function traitsOf(def) {
    return Object.assign({}, TRAIT_DEFAULTS, def.traits || {});
  }

  // --- validation of one definition --------------------------------------------------------------------------

  // checkDef(def, { mine }) → messages. Without `mine` (createRegistry) the keys 'myMat…'/'myMed…' and the field
  // `mine` are refused; with it (extend) the key must match MINE_KEY and `mine` must be an object.
  function checkDef(def, opts) {
    const errs = [];
    const bad = (msg) => { errs.push(msg); };
    const mine = !!(opts && opts.mine);
    if (!isObject(def)) { bad('definition must be an object'); return errs; }
    if (!KINDS.includes(def.kind)) { bad('unknown kind ' + JSON.stringify(def.kind)); return errs; }
    if (typeof def.key !== 'string' || !KEY.test(def.key)) bad('key must be camelCase with at least two words');
    else if (def.key.length > KEY_MAX) bad('key must be at most ' + KEY_MAX + ' characters (slot paths, §3.4)');
    else if (!mine && MINE_PREFIX.test(def.key)) bad('keys starting with myMat or myMed are added only through extend');
    else if (mine && !MINE_KEY.test(def.key)) bad('an added key must be myMat<id> or myMed<10 hex digits>');
    if (!mine && def.mine !== undefined) bad('mine is allowed only on definitions added through extend');
    if (mine && !isObject(def.mine)) bad('mine must be an object');
    if (!isObject(def.label) || !isText(def.label.ja) || !isText(def.label.en)) bad('label needs non-empty ja and en');
    if (PART_KINDS.includes(def.kind) && (!isObject(def.blurb) || !isText(def.blurb.ja) || !isText(def.blurb.en))) {
      bad('blurb needs ja and en');
    }
    checkCommon(def, bad);
    checkParams(def, bad, mine);
    KIND_CHECKS[def.kind](def, bad);
    return errs;
  }

  function checkCommon(def, bad) {
    if (def.tags !== undefined && !isList(def.tags, TAGS)) {
      const odd = Array.isArray(def.tags) ? def.tags.filter((t) => !TAGS.includes(t)) : def.tags;
      bad('tags outside the vocabulary: ' + JSON.stringify(odd));
    }
    if (def.season !== undefined && def.season !== null && !SEASONS.includes(def.season)) {
      bad('season must be null, spring, summer, autumn or winter');
    }
    if (def.weight !== undefined && !(isNumber(def.weight) && def.weight >= 0)) bad('weight must be a number ≥ 0');
    if (def.family !== undefined && !isText(def.family)) bad('family must be a non-empty string');
    if (def.pool !== undefined && typeof def.pool !== 'boolean') bad('pool must be a boolean');
    if (def.fallback !== undefined && typeof def.fallback !== 'boolean') bad('fallback must be a boolean');
    if (def.fits !== undefined && !isFn(def.fits)) bad('fits must be a function');
    if (def.gate !== undefined && !AMOUNT_KEYS.includes(def.gate)) bad('gate must be an amount key');
    if (def.needs !== undefined && !isList(def.needs, NEEDS)) bad('needs must list only ' + NEEDS.join(' '));
    if (def.traits !== undefined) checkTraits(def.traits, bad);
  }

  function checkTraits(t, bad) {
    if (!isObject(t)) { bad('traits must be an object'); return; }
    if (t.orient !== undefined && !(isList(t.orient, ['h', 'v']) && t.orient.length)) bad('traits.orient must list h and/or v');
    if (t.cells !== undefined && !isRange(t.cells, 0, 1000)) bad('traits.cells must be [lo, hi]');
    if (t.energy !== undefined && !isRange(t.energy, 0, 1)) bad('traits.energy must be [lo, hi] within 0..1');
    if (t.scripts !== undefined && !isList(t.scripts, ['*'].concat(SCRIPTS))) bad('traits.scripts must list * or scripts');
    if (t.aspects !== undefined && !isList(t.aspects, ['*'].concat(ASPECTS))) bad('traits.aspects must list * or aspects');
    if (t.roles !== undefined && !(isList(t.roles, ROLES) && t.roles.length)) bad('traits.roles must list cut roles');
    if (t.impact !== undefined && typeof t.impact !== 'boolean') bad('traits.impact must be a boolean');
  }

  function mergeShared(base, patch) {
    const out = Object.assign({}, base, patch);
    if (!patch.label) out.label = base.label;
    return out;
  }

  function checkParams(def, bad, mine) {
    const shared = SHARED[def.kind];
    if (def.shared !== undefined) {
      if (!isObject(def.shared)) bad('shared must be an object');
      else {
        for (const name of Object.keys(def.shared)) {
          const base = shared[name];
          const patch = def.shared[name];
          if (!base) { bad('shared.' + name + ': not a shared param of ' + def.kind); continue; }
          if (!isObject(patch)) { bad('shared.' + name + ': must be an object'); continue; }
          const merged = mergeShared(base, patch);
          for (const e of S.validateSpec(name, merged)) bad('shared.' + e);
          if (merged.type !== base.type) bad('shared.' + name + ': type cannot change');
          if (isNumber(base.min) && (!(merged.min >= base.min) || !(merged.max <= base.max))) {
            bad('shared.' + name + ': may only narrow the range ' + base.min + '..' + base.max);
          }
        }
      }
    }
    if (def.params === undefined) return;
    if (!isObject(def.params)) { bad('params must be an object'); return; }
    // The list slot's `count` is reserved on catalog parts. A definition added through extend (a material) may name its
    // count knob `count` (DESIGN_2_1 §5.7.6: `atmos@myMat3.count`); its paths always carry the key, so they cannot clash.
    const reserved = mine ? [] : RESERVED_PARAMS[def.kind] || [];
    for (const name of Object.keys(def.params)) {
      if (!PARAM.test(name)) bad('params.' + name + ': bad param name');
      if (shared[name]) bad('params.' + name + ': clashes with the shared param of ' + def.kind);
      if (reserved.includes(name)) bad('params.' + name + ': reserved name');
      for (const e of S.validateSpec(name, def.params[name])) bad('params.' + e);
    }
  }

  function needFn(def, bad, ...names) {
    for (const n of names) if (!isFn(def[n])) bad(n + '() is required for ' + def.kind);
  }

  function oneOf(def, bad, field, allowed, optional) {
    if (optional && def[field] === undefined) return;
    if (!allowed.includes(def[field])) bad(field + ' must be one of ' + allowed.join(' '));
  }

  const KIND_CHECKS = {
    arrange(def, bad) {
      needFn(def, bad, 'build');
      if (def.motion !== undefined && def.motion !== 'own') bad("motion must be 'own' when present");
      if (def.cam !== undefined && !CAM_VALUES.includes(def.cam)) bad('cam must be one of ' + CAM_VALUES.join(' '));
    },
    arrive(def, bad) { needFn(def, bad, 'make'); oneOf(def, bad, 'unit', UNITS, true); },
    dwell(def, bad) { needFn(def, bad, 'make'); },
    depart(def, bad) { needFn(def, bad, 'make'); oneOf(def, bad, 'unit', UNITS, true); },
    ground(def, bad) {
      needFn(def, bad, 'build');
      if (def.animated !== undefined && typeof def.animated !== 'boolean') bad('animated must be a boolean');
    },
    ornament(def, bad) {
      needFn(def, bad, 'build');
      oneOf(def, bad, 'scope', ['cut', 'run']);
      oneOf(def, bad, 'follow', ['text', 'own']);
    },
    lens(def, bad) {
      needFn(def, bad, 'make');
      if (def.frames !== undefined && typeof def.frames !== 'boolean') bad('frames must be a boolean');
      if (def.warp !== undefined && typeof def.warp !== 'boolean') bad('warp must be a boolean');
    },
    filter(def, bad) {
      needFn(def, bad, 'apply');
      oneOf(def, bad, 'stage', STAGES);
      if (!(Number.isInteger(def.cost) && def.cost >= 1 && def.cost <= 5)) bad('cost must be an integer 1–5');
      if (!(Number.isInteger(def.passes) && def.passes >= 0)) bad('passes must be an integer ≥ 0');
      if (typeof def.alphaSafe !== 'boolean') bad('alphaSafe must be a boolean');
      if (def.texture !== undefined && typeof def.texture !== 'boolean') bad('texture must be a boolean');
    },
    seam(def, bad) {
      needFn(def, bad, 'mix');
      oneOf(def, bad, 'scope', ['text', 'world']);
      const r = def.replaces;
      if (r !== undefined && !(isObject(r) && Object.keys(r).every((k) => (k === 'depart' || k === 'arrive') &&
          typeof r[k] === 'boolean'))) bad('replaces must be { depart?, arrive? } booleans');
    },
    theme: checkTheme,
    mood: checkMood,
  };

  function checkTheme(def, bad) {
    const sw = def.swatch;
    if (!isObject(sw) || !C.TOKENS.every((t) => isHex(sw[t]))) {
      bad('swatch needs #RRGGBB for ' + C.TOKENS.join(' '));
    } else if (C.contrast(sw.ink, sw.ground) < 4.5) {
      bad('ink/ground contrast must be ≥ 4.5 (is ' + C.contrast(sw.ink, sw.ground).toFixed(2) + ')');
    }
    const faces = def.faces;
    if (!isObject(faces)) bad('faces must name display, serif and body');
    else {
      for (const role of FACE_ROLES) {
        const f = faces[role];
        if (!isObject(f) || !isText(f.ja) || !isText(f.latin)) bad('faces.' + role + ' needs ja and latin families');
        else if (f.weight !== undefined && !(Number.isInteger(f.weight) && f.weight >= 100 && f.weight <= 900)) {
          bad('faces.' + role + '.weight must be 100–900');
        }
      }
    }
    oneOf(def, bad, 'style', TEXT_STYLES);
    if (typeof def.dark !== 'boolean') bad('dark must be a boolean');
    if (!(def.texture === null || isText(def.texture))) bad("texture must be a filter key, 'none' or null");
    if (def.prefer !== undefined && !(isObject(def.prefer) && Object.keys(def.prefer).every((k) =>
      PART_KINDS.includes(k) && isWeights(def.prefer[k], (key) => KEY.test(key))))) {
      bad('prefer must map part kinds to { key: weight ≥ 0 }');
    }
  }

  function checkMood(def, bad) {
    if (!isWeights(def.tagBias, (t) => TAGS.includes(t))) bad('tagBias must map vocabulary tags to numbers ≥ 0');
    const a = def.amounts;
    if (!isObject(a) || !AMOUNT_KEYS.every((k) => isNumber(a[k]) && a[k] >= 0 && a[k] <= 1)) {
      bad('amounts needs every amount key in 0..1: ' + AMOUNT_KEYS.join(' '));
    } else if (Object.keys(a).some((k) => !AMOUNT_KEYS.includes(k))) bad('amounts has unknown keys');
    if (!isWeights(def.themes, (k) => KEY.test(k))) bad('themes must map theme keys to weights ≥ 0');
    const p = def.pace;
    if (!isObject(p) || !isNumber(p.seam) || !isNumber(p.focus) || p.seam < 0 || p.seam > 1 || p.focus < 0 || p.focus > 1) {
      bad('pace needs seam and focus in 0..1');
    }
    if (!(isNumber(def.variety) && def.variety >= 0.6 && def.variety <= 1.2)) bad('variety must be 0.6–1.2');
    if (!isWeights(def.filters, (k) => KEY.test(k))) bad('filters must map filter keys to weights ≥ 0');
    if (def.keywords !== undefined && !(Array.isArray(def.keywords) && def.keywords.every(isText))) {
      bad('keywords must be a list of strings');
    }
  }

  // --- the registry ------------------------------------------------------------------------------------------

  function paramListOf(def) {
    const list = [];
    const shared = SHARED[def.kind];
    const patches = isObject(def.shared) ? def.shared : {};
    for (const name of Object.keys(shared)) {
      list.push(Object.freeze({ name, spec: patches[name] ? mergeShared(shared[name], patches[name]) : shared[name], shared: true }));
    }
    for (const name of Object.keys(def.params || {})) list.push(Object.freeze({ name, spec: def.params[name], shared: false }));
    return Object.freeze(list);
  }

  function seasonOk(partSeason, season) {
    if (!partSeason) return true;                         // non-seasonal parts pass every gate
    if (season === undefined || season === null || season === 'any') return true;
    return season === partSeason;                          // 'none' and other seasons keep seasonal parts out
  }

  // createRegistry(defs, { strict = true }): throws RegistryError listing every problem when strict; otherwise skips
  // invalid definitions and reports them in registry.problems.
  function createRegistry(defs, opts) {
    const strict = !(opts && opts.strict === false);
    if (!Array.isArray(defs)) throw new RegistryError(['createRegistry needs an array of part definitions']);
    const problems = [];
    const byKind = new Map(KINDS.map((k) => [k, new Map()]));
    for (const def of defs) {
      const errs = checkDef(def);
      const tag = (isObject(def) && typeof def.kind === 'string' ? def.kind : '?') + '/' +
        (isObject(def) && typeof def.key === 'string' ? def.key : '?');
      const kindMap = isObject(def) ? byKind.get(def.kind) : null;
      if (kindMap && kindMap.has(def.key)) errs.push('duplicate key in ' + def.kind);
      for (const e of errs) problems.push(tag + ': ' + e);
      if (errs.length === 0) kindMap.set(def.key, def);
    }
    crossCheck(byKind, problems);
    if (strict && problems.length) throw new RegistryError(problems);
    return buildRegistry(byKind, problems);
  }

  function crossCheck(byKind, problems) {
    for (const kind of KINDS) {
      const fallbacks = [...byKind.get(kind).values()].filter((d) => d.fallback === true).map((d) => d.key);
      if (fallbacks.length !== 1) {
        problems.push(kind + '/*: exactly one definition needs fallback: true (found ' + fallbacks.length + ')');
      } else if (FIXED_FALLBACK[kind] && fallbacks[0] !== FIXED_FALLBACK[kind]) {
        problems.push(kind + '/' + fallbacks[0] + ': the ' + kind + ' fallback must be ' + FIXED_FALLBACK[kind]);
      }
    }
    const themes = byKind.get('theme');
    for (const mood of byKind.get('mood').values()) {
      for (const key of Object.keys(mood.themes)) {
        if (!themes.has(key)) problems.push('mood/' + mood.key + ': themes names an unknown theme ' + key);
      }
    }
  }

  function buildRegistry(byKind, problems) {
    const keysOf = new Map();
    const defsOf = new Map();
    const params = new Map();
    const signature = [];
    for (const kind of KINDS) {
      const keys = [...byKind.get(kind).keys()].sort(compare);
      keysOf.set(kind, Object.freeze(keys));
      defsOf.set(kind, keys.map((key) => byKind.get(kind).get(key)));
      for (const key of keys) {
        const def = byKind.get(kind).get(key);
        params.set(kind + '/' + key, paramListOf(def));
        signature.push([kind, key, Object.keys(def.params || {}).sort(compare)]);
      }
    }
    const version = H.hashJSON(signature);
    return makeRegistry({
      keysOf, defsOf, params, version, problems,
      get: (kind, key) => { const m = byKind.get(kind); return (m && m.get(key)) || null; },
      baseParams: () => null,
      extras: { base: null, baseVersion: version, extra: Object.freeze({}), mine: () => NO_KEYS },
    });
  }

  const NO_KEYS = Object.freeze([]);

  // The Registry object over a key index: `keysOf` kind → sorted keys, `defsOf` kind → the defs in the same order,
  // `get(kind, key)`, `params` (Map of 'kind/key' → param list) with `baseParams` as the fallback lookup.
  function makeRegistry(src) {
    const { keysOf, defsOf, params, get } = src;
    function keys(kind) { return keysOf.get(kind) || NO_KEYS; }
    // Sorted by (kind, key) as strings, like keys(); registration order never matters.
    function all(kind) {
      const kinds = kind === undefined ? KINDS_SORTED : [kind];
      return kinds.flatMap((k) => defsOf.get(k) || []);
    }
    function fallback(kind) {
      for (const def of defsOf.get(kind) || []) if (def.fallback === true) return def.key;
      return null;
    }
    function label(kind, key, lang) {
      const def = get(kind, key);
      if (!def) return key;
      return (lang === 'en' ? def.label.en : def.label.ja) || def.label.ja || key;
    }
    function blurb(kind, key, lang) {
      const def = get(kind, key);
      if (!def || !def.blurb) return '';
      return (lang === 'en' ? def.blurb.en : def.blurb.ja) || '';
    }
    // Keys eligible for AUTO picks, sorted. opts: { role, season, filters, orient, script, aspect, scope, texture, amounts }
    function pool(kind, opts) {
      const o = opts || {};
      const f = o.filters && o.filters[kind];
      const only = f && Array.isArray(f.only) ? f.only : null;
      const deny = f && Array.isArray(f.deny) ? f.deny : null;
      const out = [];
      for (const def of defsOf.get(kind) || []) {
        const key = def.key;
        if (def.pool === false) continue;
        if (only && !only.includes(key)) continue;
        if (deny && deny.includes(key)) continue;
        if (!seasonOk(def.season, o.season)) continue;
        if (o.texture === true && def.texture !== true) continue;
        if (o.scope && def.scope !== undefined && def.scope !== o.scope) continue;
        if (o.amounts && def.gate && !(o.amounts[def.gate] > 0)) continue;
        if (traitsAllow(traitsOf(def), o)) out.push(key);
      }
      return out;
    }
    return Object.freeze(Object.assign({
      version: src.version, problems: Object.freeze(src.problems.slice()),
      get, has: (kind, key) => get(kind, key) !== null, keys, all, pool, fallback, label, blurb,
      params: (kind, key) => params.get(kind + '/' + key) || src.baseParams(kind, key) || null,
      traits: (kind, key) => { const d = get(kind, key); return d ? traitsOf(d) : null; },
    }, src.extras));
  }

  // What the planner reads from a definition, so a change to it changes an extended registry's version (§3.6).
  function metaHash(def) {
    return H.hashJSON({ tags: def.tags, season: def.season, weight: def.weight, traits: def.traits, pool: def.pool,
      family: def.family, gate: def.gate, scope: def.scope, follow: def.follow, frames: def.frames, cam: def.cam,
      params: def.params, shared: def.shared });
  }

  // extend(base, defs, { strict = false, problems = [] }) → Registry (DESIGN_2_1 §3.6): the base registry plus the
  // material and media definitions `defs` (keys 'myMat<id>' / 'myMed<10 hex>', each with `mine`). Only `defs` are
  // validated; an invalid or duplicate definition is skipped and listed in `problems` ('kind/key: message', after the
  // caller's own `opts.problems`), or thrown as a RegistryError when strict. The base is never mutated and its maps are
  // reused. Added members: base, baseVersion, version (base version + the added defs and what the planner reads of
  // them), extra ({ [key]: def.mine }) and mine(kind) (the added keys of a kind, sorted).
  // What extend works out for one added definition (its checks, param list and meta hash) depends on that definition
  // alone. The makers (parts/mix) deep-freeze and cache their definitions, so an edit that re-composes the registry
  // re-uses the work for every definition it did not touch: a frozen definition's results are kept here.
  const addedInfo = new WeakMap();

  function infoOf(def) {
    const frozen = isObject(def) && Object.isFrozen(def) && (def.params === undefined || Object.isFrozen(def.params));
    let info = frozen ? addedInfo.get(def) : undefined;
    if (!info) {
      info = { errs: Object.freeze(checkDef(def, { mine: true })), params: null, meta: null };
      if (frozen) addedInfo.set(def, info);
    }
    return info;
  }

  function extend(base, defs, opts) {
    const strict = !!(opts && opts.strict === true);
    if (!base || typeof base.get !== 'function' || typeof base.keys !== 'function') {
      throw new RegistryError(['extend needs a registry to extend']);
    }
    const problems = opts && Array.isArray(opts.problems) ? opts.problems.map(String) : [];
    const own = [];
    const added = new Map(KINDS.map((k) => [k, new Map()]));
    for (const def of Array.isArray(defs) ? defs : []) {
      const errs = infoOf(def).errs.slice();
      const tag = (isObject(def) && typeof def.kind === 'string' ? def.kind : '?') + '/' +
        (isObject(def) && typeof def.key === 'string' ? def.key : '?');
      if (!errs.length && def.fallback === true) errs.push('an added definition cannot be the fallback');
      if (!errs.length && (added.get(def.kind).has(def.key) || base.has(def.kind, def.key))) errs.push('duplicate key in ' + def.kind);
      for (const e of errs) own.push(tag + ': ' + e);
      if (!errs.length) added.get(def.kind).set(def.key, def);
    }
    if (strict && own.length) throw new RegistryError(own);
    const baseVersion = base.baseVersion || base.version;
    const keysOf = new Map();
    const defsOf = new Map();
    const params = new Map();
    const signature = [];
    const extra = {};
    const mineOf = new Map();
    for (const kind of KINDS) {
      const more = added.get(kind);
      const baseKeys = base.keys(kind);
      if (!more.size) {
        keysOf.set(kind, baseKeys);
        defsOf.set(kind, baseKeys.map((key) => base.get(kind, key)));
        continue;
      }
      const mineKeys = [...more.keys()].sort(compare);
      const keys = baseKeys.concat(mineKeys).sort(compare);
      keysOf.set(kind, Object.freeze(keys));
      defsOf.set(kind, keys.map((key) => more.get(key) || base.get(kind, key)));
      mineOf.set(kind, Object.freeze(mineKeys));
      for (const key of mineKeys) {
        const def = more.get(key);
        const info = infoOf(def);
        if (!info.params) {
          info.params = paramListOf(def);
          info.meta = [Object.keys(def.params || {}).sort(compare), metaHash(def)];
        }
        params.set(kind + '/' + key, info.params);
        signature.push([kind, key, info.meta[0], info.meta[1]]);
        extra[key] = def.mine;
      }
    }
    return makeRegistry({
      keysOf, defsOf, params, version: H.hashJSON([baseVersion, signature]), problems: problems.concat(own),
      get: (kind, key) => { const m = added.get(kind); return (m && m.get(key)) || base.get(kind, key); },
      baseParams: (kind, key) => base.params(kind, key),
      extras: { base, baseVersion, extra: Object.freeze(extra), mine: (kind) => mineOf.get(kind) || NO_KEYS },
    });
  }

  function traitsAllow(t, o) {
    if (o.role && !t.roles.includes(o.role)) return false;
    if (o.orient && !t.orient.includes(o.orient)) return false;
    if (o.script && !(t.scripts.includes('*') || t.scripts.includes(o.script))) return false;
    if (o.aspect && !(t.aspects.includes('*') || t.aspects.includes(o.aspect))) return false;
    return true;
  }

  function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  return {
    KINDS, PART_KINDS, TAGS, AMOUNT_KEYS, SEASONS, ROLES, NEEDS, STAGES, TEXT_STYLES, TRAIT_DEFAULTS, SHARED,
    CAM_VALUES, MINE_KEY, RegistryError, createRegistry, checkDef, extend,
  };
});
