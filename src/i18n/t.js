/* 文字PVメーカー v2 — original work. Translation function and formatters over the [ja, en] string table (DESIGN §4.24). */
MV.def('i18n/t', [], () => {
  'use strict';

  const LANGS = Object.freeze(['ja', 'en']);
  const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

  class I18nError extends Error {
    constructor(code, message) { super(message); this.name = 'I18nError'; this.code = code; }
  }

  function devMode() { return typeof MV !== 'undefined' && MV.DEV === true; }

  // Splits on '|' that is not escaped as '\|'; '\|' becomes a literal bar.
  function alternatives(text) {
    const out = [''];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\' && text[i + 1] === '|') { out[out.length - 1] += '|'; i++; }
      else if (ch === '|') out.push('');
      else out[out.length - 1] += ch;
    }
    return out;
  }

  // English plurals (§4.24): 'one|other' picked by params.n (1 → first, anything else → second). Without a numeric n
  // the text is used as written (bars stay literal). Only English texts go through here: Japanese has no plural
  // forms, so a ja text about the '|' lyric mark is never cut, even with a count.
  function choosePlural(text, params) {
    if (!params || typeof params.n !== 'number' || text.indexOf('|') < 0) return text;
    const alts = alternatives(text);
    if (alts.length < 2) return alts[0];
    return params.n === 1 ? alts[0] : alts[1];
  }

  function fill(text, params) {
    if (!params) return text;
    return text.replace(PLACEHOLDER, (whole, name) => (params[name] === undefined || params[name] === null
      ? whole : String(params[name])));
  }

  // createT(lang, strings, registry?) → t(key, params?). A missing key is an error in dev builds and shows the key
  // otherwise; an empty English text falls back to Japanese.
  function createT(lang, strings, registry, opts) {
    const li = lang === 'en' ? 1 : 0;
    const table = strings || {};
    const strict = opts && opts.strict !== undefined ? !!opts.strict : devMode();

    function pairOf(key) {
      const pair = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
      if (Array.isArray(pair)) return pair;
      if (strict) throw new I18nError('missing-key', 'i18n: missing string ' + key);
      return null;
    }

    function t(key, params) {
      const pair = pairOf(key);
      if (pair === null) return key;
      // An empty English text falls back to the Japanese one, which is used as written like any ja text.
      const text = li === 1 && pair[1] ? choosePlural(pair[1], params) : (pair[0] || '');
      return fill(text, params);
    }

    t.lang = LANGS[li];
    t.has = (key) => Object.prototype.hasOwnProperty.call(table, key);
    t.part = (kind, key) => (registry ? registry.label(kind, key, t.lang) : key);
    t.why = (code, params) => t('why.' + code, params);
    t.err = (code, params) => t('err.ai.' + code, params);
    // A label tuple [stringKey, params] (undo labels, look history) or plain text.
    t.label = (label) => (Array.isArray(label) ? t(label[0], label[1]) : String(label));
    return t;
  }

  function pad(n, width) { return String(n).padStart(width, '0'); }

  // 'm:ss.cc'; with { frames: true, fps } → 'm:ss:ff'. Negative times get a leading '-'.
  function fmtTime(seconds, opts) {
    const x = Number.isFinite(seconds) ? seconds : 0;
    const sign = x < 0 ? '-' : '';
    const a = Math.abs(x);
    if (opts && opts.frames && opts.fps > 0) {
      const fps = Math.round(opts.fps);
      const total = Math.round(a * fps);
      const secs = Math.floor(total / fps);
      return sign + Math.floor(secs / 60) + ':' + pad(secs % 60, 2) + ':' + pad(total % fps, 2);
    }
    const cs = Math.round(a * 100);
    const secs = Math.floor(cs / 100);
    return sign + Math.floor(secs / 60) + ':' + pad(secs % 60, 2) + '.' + pad(cs % 100, 2);
  }

  // Bytes in binary units: '512 B', '1.5 KB', '23 MB', '1.2 GB'.
  function fmtBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let x = Math.max(0, Number.isFinite(n) ? n : 0);
    let u = 0;
    while (x >= 1024 && u < units.length - 1) { x /= 1024; u++; }
    const shown = u === 0 ? String(Math.round(x)) : x < 10 ? x.toFixed(1) : String(Math.round(x));
    return shown + ' ' + units[u];
  }

  // Money in USD for both languages (DESIGN §10.3: yen only once a display rate is decided; pass opts.yenPerUsd then).
  function fmtMoney(usd, lang, opts) {
    const x = Math.max(0, Number.isFinite(usd) ? usd : 0);
    if (lang === 'ja' && opts && opts.yenPerUsd > 0) return '¥' + Math.max(1, Math.round(x * opts.yenPerUsd));
    if (x === 0) return '$0';
    return '$' + (x < 0.01 ? x.toFixed(4) : x < 1 ? x.toFixed(3) : x.toFixed(2));
  }

  // The {name} placeholders of a text (English plural alternatives together).
  function placeholders(text) {
    const out = new Set();
    for (const m of String(text).matchAll(PLACEHOLDER)) out.add(m[1]);
    return out;
  }

  return { LANGS, I18nError, createT, fmtTime, fmtBytes, fmtMoney, placeholders };
});
