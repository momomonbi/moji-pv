/* 文字PVメーカー v2 — original work. Font book: Google Fonts stylesheets, load tracking and the font epoch (DESIGN §4.14). */
MV.def('engine/host/fonts', ['engine/text/faces'], (FACES) => {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 12000;

  // createFontBook({ document, timeoutMs? }) → FontBook
  //   request(refs, textByFamily): adds a <link rel="stylesheet"> per new URL and starts loading; returns at once.
  //   ready(refs, text, { timeoutMs }) → Promise<{ loaded, failed }>: document.fonts.load per ref, with a timeout.
  //   epoch: +1 whenever a requested face finishes loading.  status(ref)  on('epoch', fn) → off
  // A family's characters accumulate: when new ones arrive, one new URL carrying all of them is requested, because a
  // later @font-face rule for the same family replaces the earlier one rather than adding to it.
  function createFontBook({ document: doc, timeoutMs: defaultTimeout = DEFAULT_TIMEOUT_MS } = {}) {
    const sheets = new Map();          // url → Promise<boolean> (stylesheet loaded)
    const chars = new Map();           // family → characters requested so far (sorted, unique)
    const urlOf = new Map();           // family → newest URL
    const states = new Map();          // ref.key → 'loading' | 'ready' | 'failed'
    const watches = new Map();         // ref.key + url + load text → Promise<boolean> (pending or loaded; failures drop out)
    const listeners = new Set();
    const known = new Map();           // ref.key → ref (for failures())
    let epoch = 0;

    function addSheet(url) {
      if (sheets.has(url)) return sheets.get(url);
      let done;
      if (!doc || typeof doc.createElement !== 'function') {
        done = Promise.resolve(false);
      } else {
        const el = doc.createElement('link');
        el.rel = 'stylesheet';
        el.href = url;
        done = new Promise((resolve) => {
          el.addEventListener('load', () => resolve(true), { once: true });
          el.addEventListener('error', () => resolve(false), { once: true });
        });
        (doc.head || doc.documentElement).appendChild(el);
      }
      sheets.set(url, done);
      return done;
    }

    function textFor(text, family) {
      if (typeof text === 'string') return text;
      return text && typeof text[family] === 'string' ? text[family] : '';
    }

    function mergeChars(family, text) {
      const merged = FACES.uniqueChars((chars.get(family) || '') + text);
      chars.set(family, merged);
      return merged;
    }

    function bump() {
      epoch++;
      for (const fn of [...listeners]) fn({ epoch });
    }

    function familyLoaded(faces, family) {
      return Array.isArray(faces) && faces.some((f) => f && String(f.family).replace(/^["']|["']$/g, '') === family
        && f.status === 'loaded');
    }

    // Loads one ref through one stylesheet; resolves true when a face of the family is loaded. The load asks only for
    // the characters the face draws (FACES.loadText): a Latin face asked for Japanese text would load no subset and
    // look failed. A failed watch is forgotten, so a later request or ready() tries again (the ref stays 'failed'
    // until then); a stylesheet that failed to load stays failed for its URL.
    function watch(ref, url) {
      const text = FACES.loadText(ref, chars.get(ref.family) || '');
      const id = ref.key + '\u0000' + url + '\u0000' + text;
      if (watches.has(id)) return watches.get(id);
      if (!states.has(ref.key)) states.set(ref.key, 'loading');
      const p = addSheet(url).then((sheetOk) => {
        if (!sheetOk) return false;
        const fonts = doc && doc.fonts;
        if (!fonts || typeof fonts.load !== 'function') return true;
        return fonts.load(ref.css(100), text || undefined).then((list) => familyLoaded(list, ref.family), () => false);
      }).then((ok) => {
        if (ok) {
          const was = states.get(ref.key);
          states.set(ref.key, 'ready');
          if (was !== 'ready' || urlOf.get(ref.family) === url) bump();
        } else {
          if (states.get(ref.key) !== 'ready') states.set(ref.key, 'failed');
          if (watches.get(id) === p) watches.delete(id);
        }
        return ok;
      });
      watches.set(id, p);
      return p;
    }

    // FontRefs pass through; plain { family, weight } entries (plan.look.faces) become FontRefs for their family's
    // script. Anything else is a programmer error: skipping it would let ready() settle with nothing loaded or failed.
    function toRef(entry) {
      if (entry && typeof entry.css === 'function' && typeof entry.key === 'string' && entry.family) return entry;
      const known = entry && FACES.FAMILIES[entry.family];
      const ref = FACES.asRef(entry, (entry && entry.script) || (known && known.script) || 'ja');
      if (!ref) throw new TypeError('FontBook: every face entry needs a family name (a FontRef or { family, weight })');
      return ref;
    }

    function groupByFamily(refs) {
      const out = new Map();
      for (const entry of refs || []) {
        const ref = toRef(entry);
        known.set(ref.key, ref);
        if (!out.has(ref.family)) out.set(ref.family, []);
        out.get(ref.family).push(ref);
      }
      return out;
    }

    // Starts every needed download; returns [{ ref, url }] for the refs given.
    function start(refs, text) {
      const jobs = [];
      for (const [family, list] of groupByFamily(refs)) {
        const merged = mergeChars(family, textFor(text, family));
        const [url] = FACES.cssUrls(list, { [family]: merged });
        urlOf.set(family, url);
        for (const ref of list) { jobs.push({ ref, url }); watch(ref, url); }
      }
      return jobs;
    }

    function request(refs, textByFamily = {}) { start(refs, textByFamily); }

    function withTimeout(p, ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        p.then((ok) => { clearTimeout(timer); resolve(ok); }, () => { clearTimeout(timer); resolve(false); });
      });
    }

    async function ready(refs, text = '', { timeoutMs = defaultTimeout } = {}) {
      const jobs = start(refs, text);
      const results = await Promise.all(jobs.map(({ ref, url }) => withTimeout(watch(ref, url), timeoutMs)));
      const loaded = [], failed = [];
      jobs.forEach(({ ref }, i) => {
        if (results[i] || states.get(ref.key) === 'ready') loaded.push(ref);
        else { failed.push(ref); if (states.get(ref.key) !== 'ready') states.set(ref.key, 'failed'); }
      });
      return { loaded, failed };
    }

    return {
      request,
      ready,
      get epoch() { return epoch; },
      status: (ref) => (ref && states.get(ref.key)) || 'idle',
      failures: () => [...known.values()].filter((ref) => states.get(ref.key) === 'failed'),
      on(event, fn) {
        if (event !== 'epoch' || typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }

  return { createFontBook };
});
