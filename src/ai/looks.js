/* 文字PVメーカー v2 — original work. AI 演出3案 and ひとこと修正: look requests, answer validation and changes (DESIGN §4.22.4). */
MV.def('ai/looks', ['core/color', 'core/doc', 'core/pins', 'core/lyrics', 'planner/look', 'ai/catalog', 'ai/lyricio',
  'ai/changes', 'ai/song'], (C, D, PINS, LY, LOOK, CAT, IO, CH, SONG) => {
  'use strict';

  const AI_AMOUNTS = Object.freeze(['motion', 'glitch', 'chroma', 'ornament', 'density', 'texture', 'groundSwitch']);
  const SEASON_ENUM = Object.freeze(['spring', 'summer', 'autumn', 'winter', 'none', 'any']);
  const KEEP_ON_OFF = Object.freeze(['keep', 'on', 'off']);
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const MAX_FILTER_REFS = 40;
  const MAX_EMPHASIS = 2;
  const MAX_INSTRUCTION = 300;
  const BACKDROP_GROUND = Object.freeze({ black: '#000000', chroma: '#00B140' });
  const WORK_AT = Object.freeze({ cutKey: null, pinCutKey: null, lineId: null });

  // ---- schemas (objects closed, every property required, no numeric or string limits) -----------------------------

  const AMOUNTS_SCHEMA = { type: 'object', additionalProperties: false, required: AI_AMOUNTS.slice(),
    properties: Object.fromEntries(AI_AMOUNTS.map((k) => [k, { type: 'number' }])) };
  const PALETTE_SCHEMA = { type: 'object', additionalProperties: false, required: ['accent', 'shiftA', 'shiftB'],
    properties: { accent: { type: 'string' }, shiftA: { type: 'string' }, shiftB: { type: 'string' } } };
  const STRINGS = { type: 'array', items: { type: 'string' } };
  const PROPOSAL_LINE = { type: 'object', additionalProperties: false, required: ['i', 'arrange', 'arrive', 'depart', 'dwell'],
    properties: { i: { type: 'integer' }, arrange: { type: 'string' }, arrive: { type: 'string' }, depart: { type: 'string' },
      dwell: { type: 'string' } } };
  const EDIT_LINE = { type: 'object', additionalProperties: false,
    required: ['i', 'arrange', 'arrive', 'depart', 'dwell', 'impact', 'emphasis'],
    properties: Object.assign({}, PROPOSAL_LINE.properties, { impact: { type: 'string', enum: KEEP_ON_OFF.slice() }, emphasis: STRINGS }) };

  const PROPOSALS_SCHEMA = deepFreeze({
    type: 'object', additionalProperties: false, required: ['topic', 'season', 'proposals'],
    properties: {
      topic: { type: 'string' },
      season: { type: 'string', enum: SEASON_ENUM.slice() },
      proposals: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['title', 'concept', 'theme', 'mood', 'amounts', 'flash', 'palette', 'avoid', 'lines'],
          properties: {
            title: { type: 'string' }, concept: { type: 'string' }, theme: { type: 'string' }, mood: { type: 'string' },
            amounts: AMOUNTS_SCHEMA, flash: { type: 'boolean' }, palette: PALETTE_SCHEMA, avoid: STRINGS,
            lines: { type: 'array', items: PROPOSAL_LINE },
          },
        },
      },
    },
  });

  const EDIT_SCHEMA = deepFreeze({
    type: 'object', additionalProperties: false, required: ['understood', 'summary', 'question', 'changes'],
    properties: {
      understood: { type: 'boolean' }, summary: { type: 'string' }, question: { type: 'string' },
      changes: {
        type: 'object', additionalProperties: false,
        required: ['theme', 'mood', 'season', 'amounts', 'flash', 'palette', 'avoid', 'allow', 'lines'],
        properties: {
          theme: { type: 'string' }, mood: { type: 'string' }, season: { type: 'string', enum: SEASON_ENUM.concat(['']) },
          amounts: AMOUNTS_SCHEMA, flash: { type: 'string', enum: KEEP_ON_OFF.slice() }, palette: PALETTE_SCHEMA,
          avoid: STRINGS, allow: STRINGS, lines: { type: 'array', items: EDIT_LINE },
        },
      },
    },
  });

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  // ---- pins, always resolved through core/pins.lookup (§4.3) ------------------------------------------------------

  function workPin(ix, slot) {
    const hit = PINS.lookup(ix, WORK_AT, slot);
    return hit ? hit.v : null;
  }

  // The line's own pin for a slot (not a work pin it inherits), or null.
  function linePin(ix, lineId, slot) {
    const hit = PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId }, slot);
    return hit && hit.from === 'pin:line' ? hit : null;
  }

  // Per cut of a line, the cut pin that decides `slot` there (a line pin cannot change that cut: cut > line), or null.
  function cutPinsOf(ix, cuts, slot) {
    return cuts.map((cut) => {
      const hit = PINS.lookup(ix, { cutKey: cut.key, pinCutKey: cut.pinKey || cut.key, lineId: cut.line }, slot);
      return hit && hit.from === 'pin:cut' ? hit : null;
    });
  }

  function cutIndex(plan) { return new Map((plan.cuts || []).map((c) => [c.key, c])); }

  function cutsOfLine(cutByKey, line) {
    return (line.cuts || []).map((key) => cutByKey.get(key)).filter(Boolean);
  }

  // ---- prompt pieces -----------------------------------------------------------------------------------------------

  function outLang(lang) { return lang === 'en' ? 'English' : 'Japanese'; }

  // The lines as the AI sees them: number (plan.lines index), text and what the line's first cut shows now.
  function planLines(plan) {
    const cutByKey = cutIndex(plan);
    return plan.lines.map((l, i) => {
      const cut = cutByKey.get(l.cuts && l.cuts[0]) || null;
      const v = (kind) => (cut && cut.slots && cut.slots[kind] ? cut.slots[kind].v : '');
      return { i, lineId: l.id, text: l.text, now: cut ? [v('arrange'), v('arrive'), v('depart')].join('/') : '' };
    });
  }

  // What a request sends as its numbering: i → lineId (and the text, to notice edits made while it runs).
  function sentLines(lines) { return lines.map((l) => ({ i: l.i, lineId: l.lineId, text: l.text })); }

  function lookContext(doc, plan) {
    const look = plan.look;
    const song = SONG.songContext(doc, plan);
    const amounts = AI_AMOUNTS.map((k) => k + '=' + Number(look.amounts[k] || 0).toFixed(2)).join(' ');
    return (song ? song + '\n' : '') + 'Current settings: theme=' + look.theme.v + ' mood=' + look.mood.v + ' season='
      + look.season.v + ' aspect=' + doc.look.aspect + ' ' + amounts + ' flash=' + ((look.amounts.flash || 0) > 0 ? 'on' : 'off')
      + ' lines=' + plan.lines.length + ' duration=' + Number(plan.duration).toFixed(1) + 's';
  }

  const LOOK_RULES = [
    'Seasons: parts and themes marked {spring|summer|autumn|winter} show that season (snow, cherry petals, fireworks, fireflies, '
      + 'maple leaves, heat haze).',
    'Set "season" to the season the lyrics are about, "none" if they are clearly not about any season (then no seasonal motif is '
      + 'used), or "any" if unsure. Never pick a part or theme of another season.',
    'Use only keys from the lists (theme keys, mood keys, part keys like "ornament.hairFrame" for avoid). amounts are 0..1 '
      + '(-1 = keep as is). Colors are #RRGGBB.',
    'If a song analysis from the audio is given, use its sections to find the chorus lines and its mood and tempo to set the energy.',
  ].join('\n');

  function listsText(doc, registry, uiLang, kinds) {
    return 'Themes:\n' + CAT.themesText(registry, uiLang, doc) + '\n\nMoods: ' + CAT.moodsText(registry, uiLang)
      + '\n\nParts (key=name{season}(mood tags)):\n' + CAT.catalogText(CAT.catalog(registry, doc, kinds, uiLang))
      + '\n\nScreen effects (only for avoid):\n' + CAT.catalogText(CAT.catalog(registry, doc, ['filter'], uiLang));
  }

  // ---- 2) AI 演出3案 --------------------------------------------------------------------------------------------------

  function proposalsRequest(doc, plan, registry, uiLang) {
    const system = [
      'You are an art director for lyric-motion videos (文字PV). Read the lyrics, work out what they are about (scene, season, '
        + 'feeling, where the hook / chorus is), and propose three clearly different visual directions that fit that meaning.',
      'Each proposal picks: a theme (colors + typefaces), a mood, effect amounts, an accent palette (accent + two offset colors), '
        + 'parts to avoid because they clash with the meaning (e.g. glitch effects for a quiet ballad), and for 2-6 key lines '
        + '(the hook / chorus / climax) a composition (arrange), entrance (arrive), exit (depart) and hold (dwell) from the '
        + 'lists ("" = keep).',
      LOOK_RULES,
      'Write "topic" (what the lyrics are about), "title" (a few words) and "concept" (one or two sentences that tie the look '
        + 'to the lyrics) in ' + outLang(uiLang) + '.',
    ].join('\n');
    const lines = planLines(plan);
    const prompt = lookContext(doc, plan) + '\n\n' + listsText(doc, registry, uiLang, CAT.CATALOG_KINDS)
      + '\n\nLyrics (line number: text):\n' + lines.map((l) => l.i + ': ' + l.text).join('\n');
    return { system, prompt, schema: PROPOSALS_SCHEMA, effort: 'medium', lines: sentLines(lines) };
  }

  // ---- 3) ひとこと修正 ------------------------------------------------------------------------------------------------

  // `kind=value` for a line pin; `kind(cuts)=value` when every cut of the line has its own pin for that part (a line
  // change cannot reach them) and `kind(k of n cuts)=value` when some do. Locked lines are just `locked`.
  function pinnedLinesText(doc, plan) {
    const ix = PINS.index(doc.pins);
    const cutByKey = cutIndex(plan);
    const out = [];
    plan.lines.forEach((l, i) => {
      const set = [];
      if (l.locked) set.push('locked');
      const cuts = l.locked ? [] : cutsOfLine(cutByKey, l);
      for (const kind of l.locked ? [] : CAT.LINE_KINDS) {
        const own = linePin(ix, l.id, kind);
        if (own) set.push(kind + '=' + own.v);
        const byCut = cutPinsOf(ix, cuts, kind).filter(Boolean);
        if (!byCut.length) continue;
        const values = [...new Set(byCut.map((h) => String(h.v)))].join('/');
        set.push(kind + (byCut.length === cuts.length ? '(cuts)' : '(' + byCut.length + ' of ' + cuts.length + ' cuts)') + '=' + values);
      }
      if (set.length) out.push(i + ':' + set.join(','));
    });
    return out.join(' ') || 'none';
  }

  function paletteText(doc) {
    const ix = PINS.index(doc.pins);
    const v = ['accent', 'shiftA', 'shiftB'].map((k) => workPin(ix, 'color.' + k));
    return v.every(Boolean) ? v.join(' ') : 'none (theme colors)';
  }

  // opts = { lineIds } when the instruction is about the selected lines only.
  function editRequest(doc, plan, registry, instruction, uiLang, opts) {
    const target = selectedIndexes(plan, opts);
    const system = [
      'You edit the look of a lyric-motion video (文字PV) from one short instruction by the user (e.g. "サビをもっと派手に", '
        + '"全体を落ち着いた雰囲気に", "2行目は縦書きに").',
      'Turn the instruction into the smallest set of setting changes that does what it asks; leave everything else as it is.',
      '- "keep" / "" / -1 / empty lists mean no change. Colors: all three "" to keep them.',
      '- Lines: find the lines the user means (the chorus / サビ is usually the repeated lines or the hook; line numbers start at 0). '
        + 'For each, you may set arrange / arrive / depart / dwell ("" = keep), impact ("on" adds a flash and shake) and '
        + 'emphasis (words copied exactly from that line). Locked lines keep their look, and a part set by hand on a '
        + 'line\'s cuts ("(cuts)") cannot be changed for that line.',
      '- Never change the words of the lyrics.',
      '- If the instruction is unclear or impossible with these settings, set understood=false, explain in "question" and change nothing.',
      LOOK_RULES,
      'Write "summary" (one sentence: what will change) and "question" in ' + outLang(uiLang) + '.',
    ].join('\n');
    const lines = planLines(plan);
    const parts = [
      'Instruction: ' + String(instruction || '').replace(/[\r\n]+/g, ' ').slice(0, MAX_INSTRUCTION),
      target ? 'The user selected lines ' + target.join(', ') + ': change only these lines (settings for the whole video only '
        + 'when the instruction clearly asks for them).' : '',
      '',
      lookContext(doc, plan),
      'Current palette override: ' + paletteText(doc),
      'Lines with a manual setting: ' + pinnedLinesText(doc, plan),
      'Parts turned off: ' + (CAT.offText(registry, doc) || 'none'),
      '',
      listsText(doc, registry, uiLang, CAT.CATALOG_KINDS),
      '',
      'Lyrics (line number: text · arrange/arrive/depart of its first cut now):',
      lines.map((l) => l.i + ': ' + l.text + ' · ' + l.now).join('\n'),
    ];
    return { system, prompt: parts.filter((p, k) => p !== '' || k > 1).join('\n'), schema: EDIT_SCHEMA, effort: 'low',
      lines: sentLines(lines) };
  }

  function selectedIndexes(plan, opts) {
    const ids = opts && Array.isArray(opts.lineIds) && opts.lineIds.length ? opts.lineIds : null;
    if (!ids) return null;
    const out = [];
    plan.lines.forEach((l, i) => { if (ids.includes(l.id)) out.push(i); });
    return out.length ? out : null;
  }

  // ---- validation --------------------------------------------------------------------------------------------------

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // The ground the accent must stay readable on: the plan's when the theme stays, else the new theme's swatch
  // (a ground color pin and the backdrop rules still win).
  function groundFor(ctx, themeKey) {
    const { doc, plan, registry } = ctx;
    if (themeKey === plan.look.theme.v) return plan.look.palette.ground;
    if (BACKDROP_GROUND[doc.look.backdrop]) return BACKDROP_GROUND[doc.look.backdrop];
    const pinned = workPin(ctx.ix, 'color.ground');
    if (typeof pinned === 'string' && HEX.test(pinned)) return pinned.toUpperCase();
    const def = registry.get('theme', themeKey);
    return def ? def.swatch.ground : plan.look.palette.ground;
  }

  function work(ctx, fields) { return CH.make(ctx.doc, Object.assign({ scope: 'work' }, fields), ctx.opts); }

  // The season the planner picks from the lyrics when no season is pinned (as planner/look does).
  function autoSeason(doc) { return LOOK.scanSeason(LY.parseSheet(doc.sheet.rows)).v; }

  // The answer's season → a change, and the season that will be in effect once the changes apply (the gate for every
  // seasonal pick of this answer). "any" clears a season pin (§4.22.5), which hands the season back to the lyrics'
  // keywords; without a pin, "any", "" and unknown values keep the season the plan shows.
  function seasonChanges(ctx, a, out) {
    const { doc, plan } = ctx;
    const season = SEASON_ENUM.includes(a.season) ? a.season : '';
    const eff = plan.look.season.v;
    const base = { id: 'season', kind: 'season', path: 'work:season', from: eff, fromSource: plan.look.season.from };
    if (season === 'any') {
      if (workPin(ctx.ix, 'season') === null) return eff;
      const auto = autoSeason(doc);
      out.push(work(ctx, Object.assign(base, { to: 'any', toSource: 'auto', label: ['ai.ch.season', { from: eff, to: auto }] })));
      return auto;
    }
    if (season && season !== eff) {
      out.push(work(ctx, Object.assign(base, { to: season, label: ['ai.ch.season', { from: eff, to: season }] })));
    }
    return season || eff;
  }

  function namedChange(ctx, kind, key, season, warn, out) {
    const { registry, plan } = ctx;
    if (!key) return;
    const def = registry.get(kind, key);
    if (!def) { warn(['ai.warn.unknown', { kind, key }]); return; }
    if (kind === 'theme' && !CAT.inSeason(def, season)) { warn(['ai.warn.offSeason', { kind, key }]); return; }
    // a theme the user turned off stays off unless this answer turns it on again
    if (D.FILTER_KINDS.includes(kind) && isOff(ctx.doc, kind, key) && !ctx.allowed.has(kind + '.' + key)) {
      warn(['ai.warn.turnedOff', { kind, key }]);
      return;
    }
    const cur = plan.look[kind];
    // a proposal is a whole look, so it pins what it names even when the auto value is the same today
    if (ctx.pinAll ? workPin(ctx.ix, kind) === key : key === cur.v) return;
    out.push(work(ctx, { id: kind, kind, path: 'work:' + kind, from: cur.v, fromSource: cur.from, to: key,
      label: ['ai.ch.' + kind, { from: cur.v, to: key }] }));
  }

  // The amount a key will have after this answer without an amount change: its pin, else the new mood's amount
  // when the answer changes the mood, else what the plan shows.
  function amountNow(ctx, k, moodKey) {
    const pinned = workPin(ctx.ix, 'amount.' + k);
    if (typeof pinned === 'number') return pinned;
    const mood = moodKey && moodKey !== ctx.plan.look.mood.v ? ctx.registry.get('mood', moodKey) : null;
    return Number((mood ? mood.amounts[k] : ctx.plan.look.amounts[k]) || 0);
  }

  function amountChanges(ctx, amounts, moodKey, out) {
    const look = ctx.plan.look;
    for (const k of AI_AMOUNTS) {
      const v = amounts && typeof amounts[k] === 'number' ? amounts[k] : -1;
      if (!(v >= 0) || !Number.isFinite(v)) continue;
      const to = Math.round(clamp01(v) * 100) / 100;
      const from = amountNow(ctx, k, moodKey);
      if (Math.abs(to - from) < 0.01) continue;
      out.push(work(ctx, { id: 'amount:' + k, kind: 'amount', key: k, path: 'work:amount.' + k, from,
        fromSource: look.amountsFrom && look.amountsFrom[k] ? look.amountsFrom[k] : 'auto', to,
        label: ['ai.ch.amount', { what: k, from, to }] }));
    }
  }

  function flashChange(ctx, flash, moodKey, out) {
    if (!(flash === 'on' || flash === 'off' || typeof flash === 'boolean')) return;
    const to = flash === true || flash === 'on';
    const from = amountNow(ctx, 'flash', moodKey) > 0;
    if (to === from) return;
    out.push(work(ctx, { id: 'flash', kind: 'flash', path: 'work:amount.flash', from, to, label: ['ai.ch.flash.' + (to ? 'on' : 'off'), {}] }));
  }

  // Palette only when all three are #RRGGBB; the accent is fitted to ≥ 3:1 against the resolved ground.
  function paletteChange(ctx, pal, themeKey, out) {
    const p = pal || {};
    if (!['accent', 'shiftA', 'shiftB'].every((k) => typeof p[k] === 'string' && HEX.test(p[k]))) return null;
    const ground = groundFor(ctx, themeKey);
    const to = { accent: C.fitContrast(p.accent.toUpperCase(), ground, 3), shiftA: p.shiftA.toUpperCase(), shiftB: p.shiftB.toUpperCase() };
    const from = {};
    const theme = themeKey !== ctx.plan.look.theme.v ? ctx.registry.get('theme', themeKey) : null;
    for (const k of ['accent', 'shiftA', 'shiftB']) {
      from[k] = workPin(ctx.ix, 'color.' + k) || (theme ? theme.swatch[k] : ctx.plan.look.palette[k]);
    }
    if (CH.sameJSON(from, to)) return to;
    out.push(work(ctx, { id: 'palette', kind: 'palette', path: 'work:color.accent', from, to,
      label: ['ai.ch.palette', { accent: to.accent, shiftA: to.shiftA, shiftB: to.shiftB }] }));
    return to;
  }

  // "kind.key" references to existing parts of a filterable kind.
  function refs(registry, list) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      const [kind, key, extra] = String(s).split('.');
      if (extra === undefined && D.FILTER_KINDS.includes(kind) && registry.has(kind, key)) out.push([kind, key]);
    }
    return out;
  }

  function isOff(doc, kind, key) {
    const f = doc.filters[kind];
    return !!f && ((Array.isArray(f.deny) && f.deny.includes(key)) || (Array.isArray(f.only) && !f.only.includes(key)));
  }

  function filterChanges(ctx, avoid, allow, out) {
    const { doc, registry } = ctx;
    const seen = new Set();
    const add = (kind, key, which) => {
      if (seen.has(kind + '.' + key) || seen.size >= MAX_FILTER_REFS) return;
      seen.add(kind + '.' + key);
      out.push(work(ctx, { id: which + ':' + kind + '.' + key, kind: which, filterKind: kind, partKey: key, from: null,
        to: key, label: ['ai.ch.' + which, { kind, part: key }] }));
    };
    for (const [kind, key] of refs(registry, avoid)) {
      const def = registry.get(kind, key);
      if (def.pool === false || registry.fallback(kind) === key || isOff(doc, kind, key)) continue;
      add(kind, key, 'avoid');
    }
    for (const [kind, key] of refs(registry, allow)) if (isOff(doc, kind, key)) add(kind, key, 'allow');
  }

  // One part pick for a line → a line pin by 'ai', unless nothing would change: the line pin already holds it, or
  // every cut of the line decides that part with its own pin (cut > line, §3.5), which the pick could not reach.
  function partChange(ctx, line, i, kind, key, warn, out) {
    const cuts = cutsOfLine(ctx.cutByKey, line);
    const byCut = cutPinsOf(ctx.ix, cuts, kind);
    if (cuts.length && byCut.every(Boolean)) {
      warn(byCut.every((h) => h.by === 'lock') ? ['ai.warn.locked', { n: i + 1 }] : ['ai.warn.pinned', { n: i + 1, kind }]);
      return;
    }
    const own = linePin(ctx.ix, line.id, kind);
    if (own && own.v === key) return;
    // what the line shows now: its first cut that the line pin reaches
    const cut = cuts.find((c, k) => !byCut[k]) || null;
    const slot = cut && cut.slots ? cut.slots[kind] : null;
    const from = own ? own.v : slot ? slot.v : null;
    out.push(CH.make(ctx.doc, { id: 'part:' + line.id + ':' + kind, kind: 'part', scope: 'line', lineId: line.id, rowId: line.row,
      n: i + 1, partKind: kind, path: 'line/' + line.id + ':' + kind, from, fromSource: own ? 'pin:line' : slot ? slot.from : 'auto',
      to: key, label: ['ai.ch.part', { n: i + 1, kind, from, to: key }] }, ctx.opts));
  }

  // Part picks of the answered lines → changes (line pins by 'ai'); lyric requests are returned for lyricChanges.
  function lineChanges(ctx, lines, season, warn, out) {
    const { doc, registry } = ctx;
    const lyric = [];
    const seen = new Set();
    for (const l of Array.isArray(lines) ? lines : []) {
      const i = l && Number.isInteger(l.i) ? l.i : -1;
      if (seen.has(i)) continue;
      const found = ctx.lineAt(i);
      if (found.warn) { warn(found.warn); continue; }
      seen.add(i);
      const line = found.line;
      if (ctx.target && !ctx.target.includes(line.id)) { warn(['ai.warn.notSelected', { n: i + 1 }]); continue; }
      const picks = CAT.LINE_KINDS.filter((kind) => String(l[kind] || '').trim());
      // a locked line keeps its look (its lock pins would shadow line pins anyway)
      if (line.locked && picks.length) warn(['ai.warn.locked', { n: i + 1 }]);
      for (const kind of line.locked ? [] : picks) {
        const key = String(l[kind]).trim();
        const def = registry.get(kind, key);
        if (!def || !CAT.servesLyrics(registry, kind, key)) { warn(['ai.warn.lineUnknown', { n: i + 1, kind, key }]); continue; }
        if (!CAT.inSeason(def, season)) { warn(['ai.warn.lineOffSeason', { n: i + 1, kind, key }]); continue; }
        if (isOff(doc, kind, key) && !ctx.allowed.has(kind + '.' + key)) { warn(['ai.warn.filtered', { n: i + 1, kind, key }]); continue; }
        partChange(ctx, line, i, kind, key, warn, out);
      }
      if (l.impact === 'on' || l.impact === 'off') lyric.push({ i, line, kind: 'impact', to: l.impact === 'on' });
      for (const w of (Array.isArray(l.emphasis) ? l.emphasis : []).slice(0, MAX_EMPHASIS)) {
        if (w) lyric.push({ i, line, kind: 'emphasis', word: String(w).trim() });
      }
    }
    return lyric;
  }

  // Impact / emphasis requests → lyric changes on the lines' rows, each checked with the row's earlier accepted edits so
  // the words never change. Requests that change nothing are dropped.
  function lyricChanges(ctx, reqs, warn, out) {
    const { doc } = ctx;
    if (!reqs.length) return;
    const view = new Map(IO.rowsView(doc, new Set(reqs.map((q) => q.line.row))).map((r) => [r.rowId, r]));
    const fieldsOf = new Map();
    const made = [];
    for (const q of reqs) {
      const row = view.get(q.line.row);
      if (!row || !row.lyric) continue;
      const n = q.i + 1;
      const f = fieldsOf.get(row.rowId) || { pieces: row.pieces, emph: row.emph.slice(), impact: row.impact, note: row.note };
      let next, fields;
      if (q.kind === 'impact') {
        if (f.impact === q.to) continue;
        next = Object.assign({}, f, { impact: q.to });
        fields = { id: 'impact:' + row.rowId, kind: 'impact', from: row.impact, to: q.to, label: ['ai.ch.impact.' + (q.to ? 'on' : 'off'), { n }] };
      } else {
        const hit = !q.word || IO.SYNTAX_CHARS.test(q.word) ? null : IO.findWord(row.text, row.pieces, q.word, f.emph);
        if (!hit) { warn(['ai.warn.emphasisNotFound', { n, word: q.word }]); continue; }
        if (!hit.free) continue;                                   // already (part of) an emphasis
        next = Object.assign({}, f, { emph: f.emph.concat([hit.range]) });
        fields = { id: 'emphasis:' + row.rowId + ':' + hit.range.join('-'), kind: 'emphasis', from: null, to: hit.range,
          word: row.text.slice(hit.range[0], hit.range[1]), label: ['ai.ch.emphasis', { n, word: q.word }] };
      }
      // every step must parse back as intended, or the lyric would change
      if (!IO.renderChecked(row, next).ok) { warn(['ai.warn.cannotWrite', { n }]); continue; }
      fieldsOf.set(row.rowId, next);
      made.push(Object.assign(fields, { scope: 'rows', rowId: row.rowId, lineId: q.line.id, n, repeats: row.count }));
    }
    for (const c of made) {
      const row = view.get(c.rowId);
      c.diff = { before: row.src, after: IO.renderChecked(row, fieldsOf.get(c.rowId)).src };
      out.push(CH.make(doc, c, ctx.opts));
    }
  }

  // One look answer (a proposal or an edit) → validated changes against the document and plan it was asked about.
  // Every seasonal pick is gated by the season in effect after the changes; filters apply unless the answer lifts them.
  function lookChanges(ctx, a, warn) {
    const out = [];
    const filters = [];
    filterChanges(ctx, a.avoid, a.allow, filters);
    ctx.allowed = new Set(filters.filter((c) => c.kind === 'allow').map((c) => c.filterKind + '.' + c.partKey));
    const season = seasonChanges(ctx, a, out);
    namedChange(ctx, 'theme', a.theme, season, warn, out);
    namedChange(ctx, 'mood', a.mood, season, warn, out);
    const moodKey = (out.find((c) => c.kind === 'mood') || {}).to || null;
    amountChanges(ctx, a.amounts, moodKey, out);
    flashChange(ctx, a.flash, moodKey, out);
    const themeKey = (out.find((c) => c.kind === 'theme') || {}).to || ctx.plan.look.theme.v;
    const palette = paletteChange(ctx, a.palette, themeKey, out);
    out.push(...filters);
    const lyric = lineChanges(ctx, a.lines, season, warn, out);
    lyricChanges(ctx, lyric, warn, out);
    return { changes: out, palette };
  }

  // shared: what every answer of one request validates against (indexes are built once, not per change)
  function sharedContext(doc, plan, opts) {
    const o = opts || {};
    return {
      ix: PINS.index(doc.pins), cutByKey: cutIndex(plan), srcs: CH.rowSrcs(doc),
      lineAt: CH.lineResolver(plan, Array.isArray(o.lines) ? o.lines : null),
    };
  }

  function contextOf(doc, plan, registry, opts, shared, prefix, pinAll) {
    const o = opts || {};
    const target = Array.isArray(o.lineIds) && o.lineIds.length ? o.lineIds.slice() : null;
    return Object.assign({ doc, plan, registry, target, pinAll: !!pinAll, allowed: new Set(),
      opts: { rev: o.rev, prefix: prefix || '', srcs: shared.srcs } }, shared);
  }

  // → { theme (what the lyrics are about), season, proposals: [{ title, concept, theme, mood, swatches, changes,
  // warnings }], warnings }. At most three proposals; the answer's season applies to all of them.
  // Validate against the doc and plan the request was built from; opts = { rev, lines } (lines: the request's).
  function proposalChanges(doc, plan, registry, json, opts) {
    const season = SEASON_ENUM.includes(json && json.season) ? json.season : 'any';
    const warnings = [];
    const shared = sharedContext(doc, plan, opts);
    const list = ((json && Array.isArray(json.proposals)) ? json.proposals : []).slice(0, 3).map((p, k) => {
      const w = [];
      const a = Object.assign({}, p, { season, flash: !!(p && p.flash), allow: [] });
      const res = lookChanges(contextOf(doc, plan, registry, opts, shared, 'p' + k + ':', true), a, (x) => { w.push(x); });
      warnings.push(...w);
      const named = (kind) => (res.changes.find((c) => c.kind === kind) || {}).to || null;
      return {
        title: String((p && p.title) || '').slice(0, 60), concept: String((p && p.concept) || '').slice(0, 300),
        theme: named('theme'), mood: named('mood'), swatches: res.palette ? [res.palette.accent, res.palette.shiftA, res.palette.shiftB] : null,
        changes: res.changes, warnings: w,
      };
    });
    return { theme: String((json && json.topic) || '').slice(0, 200), season, proposals: list, warnings };
  }

  // → { understood, summary, question, changes, warnings }; understood = false gives no changes. Validate against the
  // doc and plan the request was built from; opts = { rev, lineIds, lines } (lineIds: the selected lines the
  // instruction was about; lines: the request's).
  function editChanges(doc, plan, registry, json, opts) {
    const summary = String((json && json.summary) || '').slice(0, MAX_INSTRUCTION);
    const question = String((json && json.question) || '').slice(0, MAX_INSTRUCTION);
    if (!json || !json.changes || typeof json.changes !== 'object') {
      return { understood: false, summary, question, changes: [], warnings: [['ai.warn.empty', {}]] };
    }
    if (json.understood === false) return { understood: false, summary, question, changes: [], warnings: [] };
    const c = json.changes;
    const a = {
      theme: c.theme || '', mood: c.mood || '', season: c.season || '', amounts: c.amounts,
      flash: c.flash === 'on' ? 'on' : c.flash === 'off' ? 'off' : 'keep', palette: c.palette, avoid: c.avoid, allow: c.allow,
      lines: c.lines,
    };
    const warnings = [];
    const res = lookChanges(contextOf(doc, plan, registry, opts, sharedContext(doc, plan, opts), ''), a, (x) => { warnings.push(x); });
    return { understood: true, summary, question, changes: res.changes, warnings };
  }

  // The validators of this module, for the direct tool (ai/direct, DESIGN_2_1 §3.13, §5.5). Additive: the schemas and
  // the behaviour of 演出3案 and ひとこと修正 are unchanged.
  const helpers = Object.freeze({
    partChange, lineChanges, lyricChanges, filterChanges, seasonChanges, amountChanges, flashChange, paletteChange,
    namedChange, sharedContext, contextOf, lookContext, PALETTE_SCHEMA: deepFreeze(PALETTE_SCHEMA),
  });

  return {
    AI_AMOUNTS, SEASON_ENUM, PROPOSALS_SCHEMA, EDIT_SCHEMA, planLines, lookContext, proposalsRequest, proposalChanges,
    editRequest, editChanges, helpers,
  };
});
