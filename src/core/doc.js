/* 文字PVメーカー v2 — original work. The document: defaults, validation, normalization, change sets, saving (DESIGN §3.1, §4.4). */
MV.def('core/doc', ['core/paths'], (paths) => {
  'use strict';

  const APP_VERSION = '2.0.0';
  const FORMAT = 'mojipv.project';
  const CURRENT_SCHEMA = 1;
  const DESIGN_SIZE = Object.freeze({
    '16:9': Object.freeze([1920, 1080]), '9:16': Object.freeze([1080, 1920]), '1:1': Object.freeze([1080, 1080]),
    '4:5': Object.freeze([1080, 1350]), '4:3': Object.freeze([1440, 1080]), '3:4': Object.freeze([1080, 1440]),
    '21:9': Object.freeze([2520, 1080]),
  });
  const ASPECTS = Object.freeze(Object.keys(DESIGN_SIZE));
  const LANGS = Object.freeze(['auto', 'ja', 'en', 'zhHant', 'zhHans', 'ko']);
  const BACKDROPS = Object.freeze(['scene', 'chroma', 'black', 'clear']);
  const SNAPS = Object.freeze(['off', 'beat', 'half', 'bar']);
  const PIN_BY = Object.freeze(['user', 'ai', 'tap', 'lock']);
  const FILTER_KINDS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'ground', 'ornament', 'lens', 'filter',
    'seam', 'theme']);
  const OUTPUT_CHOICES = Object.freeze({
    format: ['mp4', 'png', 'pngAlpha'], short: [720, 1080, 1440, 2160], fps: [24, 30, 60],
    quality: ['standard', 'high', 'max'],
  });
  const TIMING_NUMBERS = Object.freeze(['lead', 'tail', 'leadIn', 'outro', 'tapLatency']);
  // Section kinds of the AI song analysis (doc.song.info.sections[].kind, §4.22.4); ai/song builds its schema from it.
  const SECTION_KINDS = Object.freeze(['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'solo', 'outro',
    'other']);
  const LOOKS_CAP = 50;                        // side.looks.cap default (§3.7)
  const LOOKS_CAP_MAX = 500;                   // a larger cap in a file is taken as damage, not a choice

  // Key order of the saved file (§3.1). Keys not listed here are kept after the listed ones.
  const ORDER = {
    file: ['format', 'schema', 'doc', 'side'],
    doc: ['meta', 'sheet', 'timing', 'song', 'look', 'pins', 'salts', 'locks', 'filters', 'output'],
    meta: ['app', 'lang'],
    sheet: ['next', 'rows'],
    row: ['id', 'src'],
    timing: ['snap', 'lead', 'tail', 'leadIn', 'outro', 'tapLatency'],
    song: ['name', 'sha1', 'seconds', 'bpm', 'offset', 'meter', 'bpmConfidence', 'digest', 'info'],
    digest: ['hz', 'loud'],
    look: ['seed', 'moodSeed', 'aspect', 'backdrop'],
    pin: ['v', 'by', 'sig'],
    lock: ['n'],
    filter: ['only', 'deny'],
    output: ['format', 'short', 'fps', 'quality', 'audio', 'range', 'name'],
    range: ['t0', 't1'],
    side: ['looks', 'aiLog'],
    looks: ['list', 'cap'],
    look_entry: ['n', 'seed', 'moodSeed', 'salts', 'scope', 'label', 'star'],
  };

  const ROW_ID = /^r[0-9a-z]+$/;
  const SONG_DEFAULTS = Object.freeze({ bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null });

  // --- defaults ----------------------------------------------------------------------------------------------

  function defaultDoc() {
    return {
      meta: { app: APP_VERSION, lang: 'auto' },
      sheet: { next: 1, rows: [] },
      timing: { snap: 'off', lead: 0.12, tail: 0.25, leadIn: 1, outro: 2, tapLatency: 0.06 },
      song: null,
      look: { seed: 1, moodSeed: 1, aspect: '16:9', backdrop: 'scene' },
      pins: {},
      salts: {},
      locks: {},
      filters: {},
      output: { format: 'mp4', short: 1080, fps: 30, quality: 'high', audio: true, range: null, name: null },
    };
  }

  function defaultSide() {
    return { looks: { list: [], cap: LOOKS_CAP }, aiLog: [] };
  }

  // --- small predicates --------------------------------------------------------------------------------------

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function isUint32(v) { return Number.isInteger(v) && v >= 0 && v <= 0xffffffff; }
  function rowNumber(id) { return parseInt(id.slice(1), 36); }

  // --- validate ----------------------------------------------------------------------------------------------

  // Structural problems of a document, as readable strings ([] when valid). Unknown keys are allowed (kept on save).
  function validate(doc) {
    const out = [];
    const bad = (where, what) => { out.push(where + ': ' + what); };
    if (!isObject(doc)) { bad('doc', 'must be an object'); return out; }
    checkMeta(doc.meta, bad);
    checkSheet(doc.sheet, bad);
    checkTiming(doc.timing, bad);
    checkSong(doc.song, bad);
    checkLook(doc.look, bad);
    checkPins(doc.pins, bad);
    checkSalts(doc.salts, bad);
    checkLocks(doc.locks, bad);
    checkFilters(doc.filters, bad);
    checkOutput(doc.output, bad);
    return out;
  }

  function checkMeta(meta, bad) {
    if (!isObject(meta)) { bad('meta', 'must be an object'); return; }
    if (typeof meta.app !== 'string') bad('meta.app', 'must be a string');
    if (!LANGS.includes(meta.lang)) bad('meta.lang', 'must be one of ' + LANGS.join(' '));
  }

  function checkSheet(sheet, bad) {
    if (!isObject(sheet)) { bad('sheet', 'must be an object'); return; }
    if (!Number.isInteger(sheet.next) || sheet.next < 1) bad('sheet.next', 'must be an integer ≥ 1');
    if (!Array.isArray(sheet.rows)) { bad('sheet.rows', 'must be an array'); return; }
    const seen = new Set();
    sheet.rows.forEach((row, i) => {
      const where = 'sheet.rows[' + i + ']';
      if (!isObject(row)) { bad(where, 'must be an object'); return; }
      if (typeof row.id !== 'string' || !ROW_ID.test(row.id)) { bad(where + '.id', 'must look like r<base36>'); return; }
      if (seen.has(row.id)) bad(where + '.id', 'duplicate id ' + row.id);
      seen.add(row.id);
      if (Number.isInteger(sheet.next) && rowNumber(row.id) >= sheet.next) bad('sheet.next', 'must be greater than ' + row.id);
      if (typeof row.src !== 'string') bad(where + '.src', 'must be a string');
      else if (/[\r\n]/.test(row.src)) bad(where + '.src', 'must be a single line');
    });
  }

  function checkTiming(timing, bad) {
    if (!isObject(timing)) { bad('timing', 'must be an object'); return; }
    if (!SNAPS.includes(timing.snap)) bad('timing.snap', 'must be one of ' + SNAPS.join(' '));
    for (const k of TIMING_NUMBERS) if (!isNumber(timing[k]) || timing[k] < 0) bad('timing.' + k, 'must be a number ≥ 0');
  }

  function checkSong(song, bad) {
    if (song === null) return;
    if (!isObject(song)) { bad('song', 'must be an object or null'); return; }
    if (typeof song.name !== 'string') bad('song.name', 'must be a string');
    if (typeof song.sha1 !== 'string') bad('song.sha1', 'must be a string');
    if (!isNumber(song.seconds) || song.seconds < 0) bad('song.seconds', 'must be a number ≥ 0');
    if (song.bpm !== null && (!isNumber(song.bpm) || song.bpm <= 0)) bad('song.bpm', 'must be a positive number or null');
    if (!isNumber(song.offset)) bad('song.offset', 'must be a number');
    if (!Number.isInteger(song.meter) || song.meter < 1) bad('song.meter', 'must be an integer ≥ 1');
    if (song.bpmConfidence !== null && !isNumber(song.bpmConfidence)) bad('song.bpmConfidence', 'must be a number or null');
    const d = song.digest;
    if (d !== null && (!isObject(d) || !isNumber(d.hz) || d.hz <= 0 || typeof d.loud !== 'string')) {
      bad('song.digest', 'must be { hz, loud: base64 } or null');
    }
    if (song.info !== null) for (const p of songInfoProblems(song.info)) bad('song.info' + p.where, p.what);
  }

  // Problems of an AI song analysis (§4.22.4: { summary, mood, bpm, sections: [{ kind, start, end }], highlights:
  // [{ time, what }], duration }) as [{ where, what }]. A key may be missing (partial analyses read it as empty), but
  // one that is present must have its type, so everything that reads the analysis can rely on it.
  function songInfoProblems(info) {
    const out = [];
    const bad = (where, what) => { out.push({ where, what }); };
    if (!isObject(info)) { bad('', 'must be an object or null'); return out; }
    for (const k of ['summary', 'mood']) if (info[k] !== undefined && typeof info[k] !== 'string') bad('.' + k, 'must be a string');
    for (const k of ['bpm', 'duration']) if (info[k] !== undefined && !isNumber(info[k])) bad('.' + k, 'must be a number');
    const list = (k, check) => {
      if (info[k] === undefined) return;
      if (!Array.isArray(info[k])) { bad('.' + k, 'must be a list'); return; }
      info[k].forEach((x, i) => {
        const what = isObject(x) ? check(x) : 'must be an object';
        if (what) bad('.' + k + '[' + i + ']', what);
      });
    };
    list('sections', (s) => {
      if (!SECTION_KINDS.includes(s.kind)) return 'kind must be one of ' + SECTION_KINDS.join(' ');
      return isNumber(s.start) && isNumber(s.end) && s.start < s.end ? '' : 'must have numbers start < end';
    });
    list('highlights', (h) => (isNumber(h.time) && typeof h.what === 'string' ? '' : 'must be { time: number, what: string }'));
    return out;
  }

  function checkLook(look, bad) {
    if (!isObject(look)) { bad('look', 'must be an object'); return; }
    if (!isUint32(look.seed)) bad('look.seed', 'must be a 32-bit unsigned integer');
    if (!isUint32(look.moodSeed)) bad('look.moodSeed', 'must be a 32-bit unsigned integer');
    if (!ASPECTS.includes(look.aspect)) bad('look.aspect', 'must be one of ' + ASPECTS.join(' '));
    if (!BACKDROPS.includes(look.backdrop)) bad('look.backdrop', 'must be one of ' + BACKDROPS.join(' '));
  }

  function checkPins(pins, bad) {
    if (!isObject(pins)) { bad('pins', 'must be an object'); return; }
    for (const path of Object.keys(pins)) {
      const where = 'pins[' + path + ']';
      let parsed = null;
      try { parsed = paths.parse(path); } catch (e) { bad(where, 'path does not parse (' + (e.code || e.message) + ')'); }
      const pin = pins[path];
      if (!isObject(pin)) { bad(where, 'must be { v, by, sig? }'); continue; }
      if (pin.v === undefined) bad(where + '.v', 'is missing');
      if (!PIN_BY.includes(pin.by)) bad(where + '.by', 'must be one of ' + PIN_BY.join(' '));
      if (parsed && parsed.scope.kind === 'cut' && typeof pin.sig !== 'string') bad(where + '.sig', 'is required on cut pins');
      if (pin.sig !== undefined && typeof pin.sig !== 'string') bad(where + '.sig', 'must be a string');
    }
  }

  function checkSalts(salts, bad) {
    if (!isObject(salts)) { bad('salts', 'must be an object'); return; }
    for (const key of Object.keys(salts)) {
      try { paths.scopeKey(key); } catch (e) { bad('salts[' + key + ']', 'key does not parse (' + (e.code || e.message) + ')'); }
      if (!Number.isInteger(salts[key]) || salts[key] < 1) bad('salts[' + key + ']', 'must be a positive integer');
    }
  }

  function checkLocks(locks, bad) {
    if (!isObject(locks)) { bad('locks', 'must be an object'); return; }
    for (const id of Object.keys(locks)) {
      if (!paths.isLineId(id)) bad('locks[' + id + ']', 'key must be a line id');
      const lock = locks[id];
      if (!isObject(lock) || !Number.isInteger(lock.n) || lock.n < 0) bad('locks[' + id + ']', 'must be { n: integer ≥ 0 }');
    }
  }

  function checkFilters(filters, bad) {
    if (!isObject(filters)) { bad('filters', 'must be an object'); return; }
    for (const kind of Object.keys(filters)) {
      const where = 'filters.' + kind;
      if (!FILTER_KINDS.includes(kind)) bad(where, 'unknown kind');
      const f = filters[kind];
      if (!isObject(f)) { bad(where, 'must be { only, deny }'); continue; }
      for (const k of ['only', 'deny']) {
        const list = f[k];
        if (list !== null && list !== undefined && !(Array.isArray(list) && list.every((x) => typeof x === 'string'))) {
          bad(where + '.' + k, 'must be a list of keys or null');
        }
      }
    }
  }

  function checkOutput(output, bad) {
    if (!isObject(output)) { bad('output', 'must be an object'); return; }
    for (const k of Object.keys(OUTPUT_CHOICES)) {
      if (!OUTPUT_CHOICES[k].includes(output[k])) bad('output.' + k, 'must be one of ' + OUTPUT_CHOICES[k].join(' '));
    }
    if (typeof output.audio !== 'boolean') bad('output.audio', 'must be a boolean');
    const r = output.range;
    if (r !== null && !(isObject(r) && isNumber(r.t0) && isNumber(r.t1) && r.t0 >= 0 && r.t0 < r.t1)) {
      bad('output.range', 'must be { t0, t1 } with 0 ≤ t0 < t1, or null');
    }
    if (output.name !== null && typeof output.name !== 'string') bad('output.name', 'must be a string or null');
  }

  // --- normalize ---------------------------------------------------------------------------------------------

  // Adds missing fields from `defaults` (one level); returns `obj` itself when nothing was missing.
  function fillMissing(obj, defaults) {
    let out = obj;
    for (const k of Object.keys(defaults)) {
      if (obj[k] === undefined) {
        if (out === obj) out = { ...obj };
        out[k] = defaults[k];
      }
    }
    return out;
  }

  // Fills missing defaults; never changes a value that is present. Unchanged sub-objects are shared.
  function normalize(doc) {
    if (!isObject(doc)) return defaultDoc();
    const base = defaultDoc();
    let out = doc;
    const put = (k, v) => {
      if (v === doc[k]) return;
      if (out === doc) out = { ...doc };
      out[k] = v;
    };
    for (const k of ORDER.doc) {
      const v = doc[k];
      if (v === undefined) put(k, k === 'sheet' ? sheetDefaults(doc) : base[k]);
      else if (k === 'sheet' && isObject(v)) put(k, fillMissing(v, sheetDefaults(doc)));
      else if (k === 'song' && isObject(v)) put(k, fillMissing(v, SONG_DEFAULTS));
      else if (isObject(v) && isObject(base[k])) put(k, fillMissing(v, base[k]));
    }
    return out;
  }

  // Sheet defaults; `next` is one past the highest row id so ids are never reused.
  function sheetDefaults(doc) {
    const rows = isObject(doc.sheet) && Array.isArray(doc.sheet.rows) ? doc.sheet.rows : [];
    let next = 1;
    for (const row of rows) {
      if (isObject(row) && typeof row.id === 'string' && ROW_ID.test(row.id)) next = Math.max(next, rowNumber(row.id) + 1);
    }
    return { next, rows: [] };
  }

  function normalizeSide(side) {
    if (!isObject(side)) return defaultSide();
    const base = defaultSide();
    let out = fillMissing(side, base);
    if (isObject(out.looks)) {
      const looks = fillMissing(out.looks, base.looks);
      if (looks !== out.looks) out = { ...out, looks };
    }
    return out;
  }

  // --- side sanitizing ---------------------------------------------------------------------------------------

  // The side of a file or autosave as the app can use it (§3.1, §3.7, §4.22.5). Side is not undoable and holds only
  // history, so malformed parts are dropped instead of refusing the file: `looks` must be an object; a look entry is
  // kept when n is an integer ≥ 1 (the first entry wins for each n), seed and moodSeed are 32-bit unsigned, salts map
  // scope keys to integers ≥ 1, scope is a string, label is [string, object] and star a boolean; `cap` is an integer in
  // 1..500, else 50. An AI log entry is kept when runId and tool are strings, `at` a number, n an integer ≥ 0, applied
  // a list of objects and groups (optional) a list. Other side keys are dropped. Kept entries are the same objects.
  function sanitizeSide(side) {
    const src = isObject(side) ? side : {};
    const looks = isObject(src.looks) ? src.looks : {};
    const seen = new Set();
    const list = (Array.isArray(looks.list) ? looks.list : []).filter((e) => {
      if (!isLookEntry(e) || seen.has(e.n)) return false;
      seen.add(e.n);
      return true;
    });
    const cap = Number.isInteger(looks.cap) && looks.cap >= 1 && looks.cap <= LOOKS_CAP_MAX ? looks.cap : LOOKS_CAP;
    const aiLog = (Array.isArray(src.aiLog) ? src.aiLog : []).filter(isAiLogEntry);
    return { looks: { list, cap }, aiLog };
  }

  function isLookEntry(e) {
    return isObject(e) && Number.isInteger(e.n) && e.n >= 1 && isUint32(e.seed) && isUint32(e.moodSeed)
      && isSalts(e.salts) && typeof e.scope === 'string' && Array.isArray(e.label) && e.label.length === 2
      && typeof e.label[0] === 'string' && isObject(e.label[1]) && typeof e.star === 'boolean';
  }

  function isSalts(salts) {
    if (!isObject(salts)) return false;
    for (const key of Object.keys(salts)) {
      if (!Number.isInteger(salts[key]) || salts[key] < 1) return false;
      try { paths.scopeKey(key); } catch (e) { return false; }
    }
    return true;
  }

  function isAiLogEntry(e) {
    return isObject(e) && typeof e.runId === 'string' && typeof e.tool === 'string' && isNumber(e.at)
      && Number.isInteger(e.n) && e.n >= 0 && Array.isArray(e.applied) && e.applied.every(isObject)
      && (e.groups === undefined || Array.isArray(e.groups));
  }

  // --- touched -----------------------------------------------------------------------------------------------

  // What changed between two documents. Relies on structural sharing: equal references mean "unchanged".
  function touched(a, b) {
    return {
      rows: touchedRows(a.sheet, b.sheet),
      pins: touchedKeys(a.pins, b.pins),
      meta: a.meta !== b.meta,
      look: a.look !== b.look,
      timing: a.timing !== b.timing,
      song: a.song !== b.song,
      output: a.output !== b.output,
      filters: a.filters !== b.filters,
      salts: a.salts !== b.salts,
      locks: a.locks !== b.locks,
    };
  }

  // Set of added, removed and edited row ids; 'all' when rows moved (every later index may have changed).
  function touchedRows(sa, sb) {
    const out = new Set();
    const ra = sa && sa.rows, rb = sb && sb.rows;
    if (ra === rb) return out;
    if (!Array.isArray(ra) || !Array.isArray(rb)) return 'all';
    const before = new Map(ra.map((r) => [r.id, r]));
    const after = new Map(rb.map((r) => [r.id, r]));
    for (const row of rb) {
      const old = before.get(row.id);
      if (!old || (old !== row && old.src !== row.src)) out.add(row.id);
    }
    for (const row of ra) if (!after.has(row.id)) out.add(row.id);
    const keptA = ra.filter((r) => after.has(r.id)).map((r) => r.id);
    const keptB = rb.filter((r) => before.has(r.id)).map((r) => r.id);
    for (let i = 0; i < keptA.length; i++) if (keptA[i] !== keptB[i]) return 'all';
    return out;
  }

  function touchedKeys(a, b) {
    const out = new Set();
    if (a === b) return out;
    const ma = a || {}, mb = b || {};
    for (const k of Object.keys(mb)) if (ma[k] !== mb[k]) out.add(k);
    for (const k of Object.keys(ma)) if (!(k in mb)) out.add(k);
    return out;
  }

  // --- serialize ---------------------------------------------------------------------------------------------

  // The listed keys first (in `order`), then any other keys in their own order.
  function ordered(obj, order, each) {
    if (!isObject(obj)) return obj;
    const out = {};
    for (const k of order) if (obj[k] !== undefined) out[k] = each ? each(k, obj[k]) : obj[k];
    for (const k of Object.keys(obj)) if (!order.includes(k) && obj[k] !== undefined) out[k] = obj[k];
    return out;
  }

  // Maps keyed by user data (pins, salts, …) are written with sorted keys so equal documents give equal files.
  function sortedMap(obj, each) {
    if (!isObject(obj)) return obj;
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = each ? each(obj[k]) : obj[k];
    return out;
  }

  function orderDoc(doc) {
    return ordered(doc, ORDER.doc, (k, v) => {
      switch (k) {
        case 'meta': return ordered(v, ORDER.meta);
        case 'sheet': return ordered(v, ORDER.sheet, (sk, sv) => (sk === 'rows' && Array.isArray(sv)
          ? sv.map((row) => ordered(row, ORDER.row)) : sv));
        case 'timing': return ordered(v, ORDER.timing);
        case 'song': return ordered(v, ORDER.song, (sk, sv) => (sk === 'digest' ? ordered(sv, ORDER.digest) : sv));
        case 'look': return ordered(v, ORDER.look);
        case 'pins': return sortedMap(v, (pin) => ordered(pin, ORDER.pin));
        case 'salts': return sortedMap(v);
        case 'locks': return sortedMap(v, (lock) => ordered(lock, ORDER.lock));
        case 'filters': return sortedMap(v, (f) => ordered(f, ORDER.filter));
        case 'output': return ordered(v, ORDER.output, (ok, ov) => (ok === 'range' ? ordered(ov, ORDER.range) : ov));
        default: return v;
      }
    });
  }

  function orderSide(side) {
    return ordered(side, ORDER.side, (k, v) => (k === 'looks'
      ? ordered(v, ORDER.looks, (lk, lv) => (lk === 'list' && Array.isArray(lv)
        ? lv.map((e) => ordered(e, ORDER.look_entry, (ek, ev) => (ek === 'salts' ? sortedMap(ev) : ev))) : lv))
      : v));
  }

  // The project file text: JSON with a 1-space indent and the key order of §3.1, ending with a newline.
  function serialize({ doc, side }) {
    const file = { format: FORMAT, schema: CURRENT_SCHEMA, doc: orderDoc(doc), side: orderSide(side || defaultSide()) };
    return JSON.stringify(file, null, 1) + '\n';
  }

  return {
    APP_VERSION, FORMAT, CURRENT_SCHEMA, DESIGN_SIZE, ASPECTS, LANGS, BACKDROPS, PIN_BY, FILTER_KINDS, SECTION_KINDS,
    defaultDoc, defaultSide, validate, songInfoProblems, normalize, normalizeSide, sanitizeSide, touched, serialize,
  };
});
