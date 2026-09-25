/* 文字PVメーカー v2 — original work. AI review: checked change lists, the three looks, transcript and analysis previews, area reviews with aggregate rows and material dependencies, and the log with selective revert (DESIGN §6.4.10.5–8; DESIGN_2_1 §6.4). */
MV.def('ui/ai_review', ['ui/dom', 'ui/icons', 'ai/changes', 'i18n/t', 'ui/ai_controller', 'core/curve', 'core/shot', 'core/paths',
  'ui/fields', 'ui/selection', 'ui/material_page', 'planner/areas', 'ui/curve_widget'], (dom, I, CH, T, AC, CV, SHOT, P, F, S, MP, AREAS, CW) => {
  'use strict';

  const { h } = dom;
  const DIFF_CELLS = 40000;               // above this the middle of a text diff is shown as one replaced run
  const TRANSCRIPT_SHOWN = 12;            // transcript rows shown in the preview before 「ほか n 行」
  const LYRIC_KINDS = ['cut', 'note', 'emphasis', 'impact', 'remove'];
  const diffs = new WeakMap();            // change.diff → its textDiff (a check or a stale mark keeps the diff object)

  // ---- text diff (pure) -----------------------------------------------------------------------------------------------

  // Longest-common-subsequence operations between two code-point arrays: [['same'|'del'|'ins', ch], …].
  function lcsOps(x, y) {
    const n = x.length, m = y.length;
    const len = [];
    for (let i = 0; i <= n; i++) len.push(new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        len[i][j] = x[i] === y[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { ops.push(['same', x[i]]); i++; j++; }
      else if (len[i + 1][j] >= len[i][j + 1]) { ops.push(['del', x[i]]); i++; }
      else { ops.push(['ins', y[j]]); j++; }
    }
    while (i < n) ops.push(['del', x[i++]]);
    while (j < m) ops.push(['ins', y[j++]]);
    return ops;
  }

  // textDiff(before, after) → [{ kind: 'same' | 'del' | 'ins', text }] by code point (so a surrogate pair is never split).
  // The common prefix and suffix are cut first; a long middle falls back to "all removed, all added".
  function textDiff(before, after) {
    const x = Array.from(String(before === null || before === undefined ? '' : before));
    const y = Array.from(String(after === null || after === undefined ? '' : after));
    let pre = 0;
    while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
    let suf = 0;
    while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
    const xm = x.slice(pre, x.length - suf);
    const ym = y.slice(pre, y.length - suf);
    const mid = xm.length * ym.length <= DIFF_CELLS ? lcsOps(xm, ym)
      : xm.map((ch) => ['del', ch]).concat(ym.map((ch) => ['ins', ch]));
    const ops = x.slice(0, pre).map((ch) => ['same', ch]).concat(mid, x.slice(x.length - suf).map((ch) => ['same', ch]));
    const out = [];
    for (const [kind, ch] of ops) {
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.text += ch;
      else out.push({ kind, text: ch });
    }
    return out;
  }

  // ---- shared pieces ---------------------------------------------------------------------------------------------------

  function button(label, opts) {
    const o = opts || {};
    return h('button', { class: o.class || 'btn small', type: 'button', disabled: !!o.disabled, title: o.title || null,
      'aria-pressed': o.pressed === undefined ? null : String(!!o.pressed), 'data-fkey': o.fkey || null,
      on: { click: o.run } }, o.icon ? I.icon(o.icon, { size: 15 }) : null, label);
  }

  function swatches(colors) {
    if (!Array.isArray(colors) || !colors.length) return null;
    return h('span', { class: 'ai-swatches', 'aria-hidden': 'true' },
      colors.map((c) => h('span', { class: 'ai-sw', style: { background: c } })));
  }

  // The before → after lines of a lyric change, the changed characters marked (not by colour alone: struck / underlined).
  function diffBlock(t, diff) {
    if (!diff) return null;
    let parts = diffs.get(diff);
    if (!parts) {
      parts = textDiff(diff.before, diff.after === null ? '' : diff.after);
      diffs.set(diff, parts);
    }
    const before = h('div', { class: 'ai-diff-line is-before' }, h('span', { class: 'sr-only', text: t('ai.review.before') + ': ' }),
      parts.filter((p) => p.kind !== 'ins').map((p) => (p.kind === 'del' ? h('del', { text: p.text }) : p.text)));
    const after = diff.after === null
      ? h('div', { class: 'ai-diff-line is-after' }, h('em', { text: t('ai.review.removed') }))
      : h('div', { class: 'ai-diff-line is-after' }, h('span', { class: 'sr-only', text: t('ai.review.after') + ': ' }),
        parts.filter((p) => p.kind !== 'del').map((p) => (p.kind === 'ins' ? h('ins', { text: p.text }) : p.text)));
    return h('div', { class: 'ai-diff' }, before, after);
  }

  function warningsBlock(t, warnings) {
    if (!warnings || !warnings.length) return null;
    return h('details', { class: 'ai-unusable' }, h('summary', { text: t('ai.review.unusable', { n: warnings.length }) }),
      h('ul', {}, warnings.map((w) => h('li', { text: CH.warningText(w, t) }))));
  }

  function lineOf(c) { return c.lineId || c.rowId || null; }

  // A row's check and stale mark, as patchRow compares them.
  function rowState(c) { return (c.checked !== false ? 'on' : 'off') + (c.stale ? ' stale' : ''); }

  // One checked row: [✓] text [この後に変更あり], then (once per lyric row) the diff and the AI's reason. Ids and focus
  // keys carry the list index: the three looks share change ids such as 'theme'.
  function changeRow(ctx, c, index, shownRows) {
    const t = ctx.t;
    const staleId = 'stale-' + index + '-' + c.id;
    const box = h('input', { type: 'checkbox', checked: c.checked !== false, 'data-fkey': 'chk:' + index + ':' + c.id,
      'aria-describedby': c.stale ? staleId : null,
      on: { change: (ev) => ctx.ctl.toggle(c.id, ev.target.checked, index) } });
    const first = c.rowId && LYRIC_KINDS.includes(c.kind) && !shownRows.has(c.rowId);
    if (first) shownRows.add(c.rowId);
    const extra = [];
    if (c.kind === 'palette' && c.to) extra.push(swatches([c.to.accent, c.to.shiftA, c.to.shiftB]));
    if (first && c.diff) extra.push(diffBlock(t, c.diff));
    if (first && c.reason) extra.push(h('div', { class: 'ai-why', text: t('ai.review.reason', { text: c.reason }) }));
    // 写真の説明 (DESIGN_2_1 §11.6.2, §11.9.5): the colours it found, the suggested 動きと重なり and why
    if (c.kind === 'media' && c.to) {
      if (Array.isArray(c.to.colors) && c.to.colors.length) extra.push(swatches(c.to.colors));
      if (c.depth && t.has('opt.depth.' + c.depth)) extra.push(h('div', { class: 'ai-why', text: t('media.ai.depth', { v: t('opt.depth.' + c.depth) }) }));
      if (c.reason) extra.push(h('div', { class: 'ai-why', text: t('ai.review.reason', { text: c.reason }) }));
    }
    return h('label', { class: ['ai-row', c.stale ? 'is-stale' : null], 'data-id': c.id, 'data-check': rowState(c),
      'data-line': lineOf(c), 'data-kind': c.kind },
      box, h('span', { class: 'ai-row-main' },
        h('span', { class: 'ai-row-text', text: CH.describe(c, t) }),
        h('span', { class: 'ai-stale', id: staleId, title: t('ai.review.staleTip'), hidden: !c.stale },
          I.icon('warn', { size: 12 }), t('ai.stale')),
        extra));
  }

  // Brings a rendered row up to date with its change (checks and stale marks only; the text never changes).
  function patchRow(row, c) {
    const st = rowState(c);
    if (row.dataset.check === st) return;
    row.dataset.check = st;
    const box = row.querySelector('input[type="checkbox"]');
    const badge = row.querySelector('.ai-stale');
    box.checked = c.checked !== false;
    row.classList.toggle('is-stale', !!c.stale);
    badge.hidden = !c.stale;
    if (c.stale) box.setAttribute('aria-describedby', badge.id); else box.removeAttribute('aria-describedby');
  }

  function patchRows(el, changes) {
    const rows = new Map();
    for (const row of el.querySelectorAll('.ai-row')) rows.set(row.dataset.id, row);
    for (const c of changes) {
      const row = rows.get(c.id);
      if (row) patchRow(row, c);
    }
  }

  // The grouped, checked list (歌詞 / 全体 / 行ごと / 時間) with [すべて] [なし].
  function changeList(ctx, changes, index) {
    const t = ctx.t;
    const shownRows = new Set();
    const k = index === undefined ? -1 : index;
    return h('div', { class: 'ai-list' },
      h('div', { class: 'ai-list-tools' },
        button(t('ai.review.all'), { class: 'link', fkey: 'all:' + k, run: () => ctx.ctl.toggleAll(true, k) }),
        button(t('ai.review.none'), { class: 'link', fkey: 'none:' + k, run: () => ctx.ctl.toggleAll(false, k) })),
      AC.grouped(changes).map((g) => h('div', { class: 'ai-group', role: 'group', 'aria-label': groupHead(t, g.group) },
        h('div', { class: 'ai-group-head', text: groupHead(t, g.group) }),
        g.changes.map((c) => changeRow(ctx, c, k, shownRows)))));
  }

  function costLine(ctx, r) {
    const text = AC.costText(ctx.t, r.provider, r.model, r.usage);
    return text ? h('div', { class: 'ai-cost', text }) : null;
  }

  function head(ctx, r, extra) {
    return h('div', { class: 'ai-review-head' },
      h('h3', { class: 'ai-h', tabindex: '-1', 'data-fkey': 'review-head', text: ctx.t('ai.review.title', { tool: ctx.t('ai.name.' + r.tool) }) }),
      extra, h('p', { class: 'note subtle', text: ctx.t('ai.review.note') }));
  }

  // ---- the review, per kind -----------------------------------------------------------------------------------------

  // [試写] / [試写をやめる]: stopping is always possible, starting needs a checked row.
  function tryButton(ctx, trying, checked, fkey, index) {
    const t = ctx.t;
    return button(trying ? t('ai.review.tryOff') : t('ai.review.tryOn'), { icon: 'play', pressed: trying, fkey,
      disabled: !trying && !checked, run: () => (trying ? ctx.ctl.endTryOn() : ctx.ctl.tryOn(index)) });
  }

  // [試写] … [捨てる] [選んだ n 件を反映].
  function listFoot(ctx, r) {
    const t = ctx.t;
    const c = AC.counts(r.changes);
    return h('div', { class: 'ai-review-foot' },
      tryButton(ctx, !!ctx.state.tryOn, c.checked, 'try', -1),
      h('span', { class: 'grow' }),
      button(t('ai.review.discard'), { fkey: 'discard', run: () => ctx.ctl.discard() }),
      button(t('ai.review.apply', { n: c.checked }), { class: 'btn small primary', fkey: 'apply', disabled: !c.checked,
        run: () => ctx.ctl.apply(-1) }));
  }

  function listReview(ctx, r) {
    return [
      head(ctx, r, r.summary ? h('p', { class: 'ai-summary', text: r.summary }) : null),
      changeList(ctx, r.changes),
      warningsBlock(ctx.t, r.warnings),
      costLine(ctx, r),
      listFoot(ctx, r),
    ];
  }

  function isTrying(ctx, i) { return !!ctx.state.tryOn && ctx.state.tryOn.index === i; }

  function lookCount(ctx, p) {
    return ctx.t('ai.looks.changes', { n: AC.counts(p.changes).checked }) + ' · ' + ctx.t('ai.looks.show');
  }

  // A card's [試写] [この案にする].
  function lookActions(ctx, p, i) {
    const checked = AC.counts(p.changes).checked;
    return h('div', { class: 'row-actions' }, tryButton(ctx, isTrying(ctx, i), checked, 'try:' + i, i),
      button(ctx.t('ai.looks.pick'), { class: 'btn small primary', fkey: 'pick:' + i, disabled: !checked, run: () => ctx.ctl.apply(i) }));
  }

  function lookCard(ctx, p, i) {
    const t = ctx.t;
    const k = AC.letter(i);
    const meta = [p.theme ? t.part('theme', p.theme) : null, p.mood ? t.part('mood', p.mood) : null].filter(Boolean).join(' · ');
    const open = ctx.openCards.has(i);
    return h('article', { class: ['ai-look', isTrying(ctx, i) ? 'is-trying' : null], 'data-k': k, 'aria-label': t('ai.looks.letter', { k }) },
      h('div', { class: 'ai-look-head' }, h('span', { class: 'ai-look-letter', text: t('ai.looks.letter', { k }) }),
        h('strong', { class: 'ai-look-title', text: p.title || t('ai.looks.letter', { k }) })),
      p.concept ? h('p', { class: 'note', text: p.concept }) : null,
      h('div', { class: 'ai-look-meta' }, swatches(p.swatches), h('span', { class: 'muted', text: meta })),
      h('details', { class: 'ai-look-changes', open, on: { toggle: (ev) => ctx.setCardOpen(i, ev.target.open) } },
        h('summary', { 'data-fkey': 'card:' + i, text: lookCount(ctx, p) }),
        open ? changeList(ctx, p.changes, i) : null),
      warningsBlock(t, p.warnings),
      lookActions(ctx, p, i));
  }

  function looksReview(ctx, r) {
    const t = ctx.t;
    const facts = [r.topic ? t('ai.looks.topic', { topic: r.topic }) : null,
      r.season ? t('ai.looks.season', { season: t('fld.season.' + r.season) }) : null].filter(Boolean);
    const shared = (r.warnings || []).filter((w) => !r.proposals.some((p) => (p.warnings || []).includes(w)));
    return [
      head(ctx, r, facts.map((f) => h('p', { class: 'ai-summary', text: f }))),
      h('div', { class: 'ai-looks' }, r.proposals.map((p, i) => lookCard(ctx, p, i))),
      warningsBlock(t, shared),
      costLine(ctx, r),
      h('div', { class: 'ai-review-foot' }, h('span', { class: 'grow' }),
        button(t('ai.review.discard'), { fkey: 'discard', run: () => ctx.ctl.discard() })),
    ];
  }

  function transcriptReview(ctx, r) {
    const t = ctx.t;
    const lines = r.result.lines;
    const shown = lines.slice(0, TRANSCRIPT_SHOWN).map((l) => h('li', {},
      r.withTimes ? h('span', { class: 'mono muted', text: T.fmtTime(l.start) }) : null, h('span', { text: l.text })));
    const more = lines.length - shown.length;
    const hasLyrics = ctx.app.doc.sheet.rows.some((row) => row.src.trim() !== '');
    return [
      head(ctx, r, h('p', { class: 'ai-summary', text: t('ai.tr.title', { n: lines.length }) })),
      r.result.note ? h('p', { class: 'note subtle', text: t('ai.tr.note', { note: r.result.note }) }) : null,
      h('ol', { class: 'ai-transcript' }, shown),
      more > 0 ? h('p', { class: 'note subtle', text: t('ai.tr.more', { n: more }) }) : null,
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: r.withTimes, 'data-fkey': 'times',
        on: { change: (ev) => ctx.ctl.setTranscriptTimes(ev.target.checked) } }), t('ai.tr.times')),
      warningsBlock(t, r.warnings),
      costLine(ctx, r),
      h('div', { class: 'ai-review-foot' },
        button(t('ai.review.discard'), { fkey: 'discard', run: () => ctx.ctl.discard() }), h('span', { class: 'grow' }),
        hasLyrics ? button(t('ai.tr.append'), { fkey: 'append', run: () => ctx.ctl.applyTranscript('append') }) : null,
        button(t('ai.tr.replace'), { class: 'btn small primary', fkey: 'replace', run: () => ctx.ctl.applyTranscript('replace') })),
    ];
  }

  function analysisReview(ctx, r) {
    const t = ctx.t;
    const info = r.info;
    const time = (s) => T.fmtTime(s).replace(/\.\d+$/, '');
    return [
      head(ctx, r, info.summary ? h('p', { class: 'ai-summary', text: info.summary }) : null),
      h('div', { class: 'ai-facts' },
        info.mood ? h('div', { text: t('ai.an.mood', { mood: info.mood }) }) : null,
        info.bpm ? h('div', { text: t('ai.an.bpm', { bpm: info.bpm }) }) : null),
      info.sections.length ? h('div', { class: 'ai-group' }, h('div', { class: 'ai-group-head', text: t('ai.an.sections') }),
        h('ul', { class: 'ai-sections' }, info.sections.map((s) => h('li', {},
          h('span', { class: 'mono muted', text: t('ai.an.range', { t0: time(s.start), t1: time(s.end) }) }),
          h('span', { text: t('songSec.' + s.kind) }))))) : null,
      info.highlights.length ? h('div', { class: 'ai-group' }, h('div', { class: 'ai-group-head', text: t('ai.an.highlights') }),
        h('ul', { class: 'ai-sections' }, info.highlights.map((x) => h('li', {},
          h('span', { class: 'mono muted', text: time(x.time) }), h('span', { text: x.what }))))) : null,
      warningsBlock(t, r.warnings),
      costLine(ctx, r),
      h('div', { class: 'ai-review-foot' },
        button(t('ai.review.discard'), { fkey: 'discard', run: () => ctx.ctl.discard() }), h('span', { class: 'grow' }),
        button(t('ai.an.save'), { class: 'btn small primary', fkey: 'save', disabled: !r.changes.length, run: () => ctx.ctl.apply(-1) })),
    ];
  }

  // ---- area reviews (指示, 素材づくり; DESIGN_2_1 §6.4) -------------------------------------------------------------------

  // The words of a slot in a review row (the change's own `field` when it has one).
  const SLOT_FIELD = Object.freeze({
    'motion.speed': 'fld.motionSpeed', 'cam.shot': 'fld.camShot', 'cam.zoom': 'fld.camZoom', 'cam.curve': 'fld.camCurve',
    'cam.follow': 'fld.camFollow', rig: 'fld.rig', 'rig.curve': 'fld.rigCurve', season: 'fld.lineSeason', avoid: 'fld.avoid',
    'arrive.flow': 'fld.flow', 'depart.flow': 'fld.flow', 'lens.curve': 'fld.lensCurve', 'dwell.curve': 'fld.holdCurve',
    'seam.curve': 'fld.seamCurve', atmos: 'fld.atmos', 'ornament.count': 'fld.count', 'filter.count': 'fld.count',
  });
  const CURVE_SLOT = /(^|\.)(ease|flow|curve)$/;
  const PCT_SLOTS = new Set(['motion.speed', 'cam.zoom', 'cam.follow']);

  function slotOf(c) {
    if (!c.path) return null;
    try { return P.parse(c.path).slot; } catch (e) { return null; }
  }

  // fieldText(t, c) → 「カメラワーク」, 「緩急（入り）」, 「入り」 …
  function fieldText(t, c) {
    if (c.field && t.has(c.field)) return t(c.field);
    const slot = slotOf(c) || '';
    if (SLOT_FIELD[slot]) return t(SLOT_FIELD[slot]);
    const ease = /^(arrive|depart)\.ease$/.exec(slot);
    if (ease) return t('ai.review.curveOf', { kind: t('kind.' + ease[1]) });
    const kind = c.partKind || (/^([a-z]+)/.exec(slot) || [])[1];
    return kind && t.has('kind.' + kind) ? t('kind.' + kind) : slot;
  }

  // valueText(t, c, v) → a value as the review shows it: parts and materials by name, curves, shots and rigs by their
  // labels, speeds and closeness in %, seasons in words; null → 自動.
  function valueText(t, c, v) {
    if (v === null || v === undefined) return t('state.auto');
    const slot = slotOf(c) || '';
    if (typeof v === 'string' && v.startsWith('mat:')) return t('ai.review.mine', { name: CH.matText(t, c) || v.slice(4) });
    if (typeof v === 'string' && /^myMat[0-9a-z]+$/.test(v)) {
      const kind = c.partKind || (slot === 'atmos' ? 'ornament' : (/^([a-z]+)/.exec(slot) || [])[1]);
      return t('ai.review.mine', { name: kind ? t.part(kind, v) : v });
    }
    if (slot === 'cam.shot') return t.label(SHOT.label(v));
    if (slot === 'rig') return t.label(SHOT.rigLabel(v));
    if (CURVE_SLOT.test(slot) && CV.isCurve(v)) return CW.curveText(t, v);
    if (PCT_SLOTS.has(slot) && typeof v === 'number') return Math.round(v * 100) + '%';
    if (slot === 'season' && typeof v === 'string') return t.has('fld.season.' + v) ? t('fld.season.' + v) : v;
    if (Array.isArray(v)) return t('ai.review.parts', { n: v.length });
    if (c.kind === 'part' && typeof v === 'string') {
      const kind = c.partKind || (slot === 'atmos' ? 'ornament' : (/^([a-z]+)/.exec(slot) || [])[1]);
      return v === 'none' ? t('fld.none') : kind ? t.part(kind, v) : v;
    }
    return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
  }

  // The 「自動（寄って落ち着く）」 of a value the planner chose.
  function fromText(t, c) {
    const v = valueText(t, c, c.from);
    return c.fromSource === 'auto' && c.from !== null && c.from !== undefined ? t('ai.ch.auto', { v }) : v;
  }

  // Where a row applies: 「12行」, 「12行 カット2」, 「作品全体」.
  function whereText(t, app, c) {
    const plan = app.plan;
    if (c.cutKey || (c.path && c.path.startsWith('cut/'))) {
      const key = c.cutKey || c.path.slice(4, c.path.indexOf(':'));
      return S.crumbs({ level: 'cut', key }, plan).slice(1).map((x) => t.label(x.label)).join(' ') || key;
    }
    const lineId = c.lineId || (c.path && c.path.startsWith('line/') ? c.path.slice(5, c.path.indexOf(':')) : null);
    if (lineId) return S.crumbs({ level: 'line', ids: [lineId] }, plan).slice(1).map((x) => t.label(x.label)).join(' ') || lineId;
    return t('area.work');
  }

  // The text of one row: ai/changes.describe for the kinds it knows, else field: from → to with the place.
  function rowText(ctx, c) {
    const t = ctx.t;
    let text = null;
    try { text = c.label ? CH.describe(c, t) : null; } catch (e) { text = null; }
    if (!text || text === (c.label && c.label[0])) {
      if (c.kind === 'material') {
        const e = c.entry || {};
        text = t('ai.ch.material', { name: CH.matText(t, c) || MP.nameText(t, e), kind: e.kind ? MP.kindText(t, e) : '',
          season: e.season ? t('fld.season.' + e.season) : t('fld.season.none') });
      } else text = t('ai.ch.value', { where: whereText(t, ctx.app, c), field: fieldText(t, c), from: fromText(t, c), to: valueText(t, c, c.to) });
    }
    return typeof c.cap === 'number' ? text + t('ai.ch.cap', { max: Math.round(c.cap * 100) / 100 }) : text;
  }

  const STALE_KEY = { changed: 'ai.stale', left: 'ai.stale.left', gone: 'ai.stale.gone', material: 'ai.stale.material' };

  function staleText(t, c) { return t(STALE_KEY[c.staleWhy] || 'ai.stale'); }

  // The review names an area by the label it had when the request was sent, or by what it is now.
  function briefTitle(t, app, b) {
    const area = app.plan ? AREAS.resolve(app.doc, app.plan, b.ref) : null;
    if (area) return F.areaTitle(t, area);
    return F.areaLabel(t, { label: b.label });
  }

  // The id a material change has in CH.apply(doc, plan, [c]): only that change is applied, so a new material takes the
  // next id (ai/changes.toCommands, §5.6), whatever its place in the review; a remade one keeps its id.
  function previewId(doc, c) {
    const next = doc.materials && Number.isInteger(doc.materials.next) ? doc.materials.next : 1;
    return c.materialId || 'm' + next.toString(36);
  }

  // ▶ 見る: a new material's thumbnail, rendered on a fork whose document holds it (the try-on registry, §5.6).
  function playMaterial(ctx, c, canvas) {
    const app = ctx.app;
    const id = previewId(app.doc, c);
    const kind = c.entry && c.entry.kind ? c.entry.kind : 'ornament';
    let fork = null;
    try {
      fork = app.engine.fork();
      fork.setDoc(CH.apply(app.doc, app.plan, [c]));
    } catch (e) { fork = null; }
    const g = canvas.getContext('2d');
    const start = performance.now();
    const step = () => {
      if (!canvas.isConnected) return;
      const tt = ((performance.now() - start) / 1000) % 3;
      try {
        fork.thumb({ kind, key: MP.keyOfId(id) }, { canvas, ctx: g, w: canvas.width, h: canvas.height },
          { t: tt, text: ctx.t('pb.sampleText'), textB: ctx.t('pb.sampleTextB'), aspect: app.doc.look.aspect });
      } catch (e) { g.fillStyle = '#222'; g.fillRect(0, 0, canvas.width, canvas.height); return; }
      if (performance.now() - start < 6000 && !dom.prefersReducedMotion()) requestAnimationFrame(step);
    };
    step();
  }

  // One row of an area review: a checkbox (disabled while its material is unchecked), the text, the stale reason.
  function directRow(ctx, r, c, all) {
    const t = ctx.t;
    const disabled = AC.isDisabled(c, all);
    const need = disabled ? all.find((x) => (c.requires || []).includes(x.id)) : null;
    const staleId = 'stale-d-' + c.id;
    const needId = 'need-d-' + c.id;
    const box = h('input', { type: 'checkbox', checked: c.checked !== false && !disabled, disabled, 'data-fkey': 'chk:d:' + c.id,
      'aria-describedby': [c.stale ? staleId : null, disabled ? needId : null].filter(Boolean).join(' ') || null,
      on: { change: (ev) => ctx.ctl.toggle(c.id, ev.target.checked, -1) } });
    const extra = [];
    if (c.kind === 'material' && c.entry) {
      const w = MP.weightOf(c.entry);
      extra.push(h('span', { class: 'mat-bars', title: t('mat.cost'), 'aria-label': t('mat.cost') + ' ' + t('mat.' + w.word),
        text: '■'.repeat(w.bars) + '□'.repeat(5 - w.bars) }));
      const canvas = h('canvas', { class: 'ai-mat-thumb', width: 192, height: 108, hidden: true, 'aria-hidden': 'true' });
      extra.push(button(t('ai.review.look'), { icon: 'play', fkey: 'look:' + c.id, run: () => { canvas.hidden = false; playMaterial(ctx, c, canvas); } }), canvas);
    }
    if (disabled && need) extra.push(h('span', { class: 'ai-need', id: needId, text: t('ai.needsMaterial', { name: CH.matText(t, need) || MP.nameText(t, need.entry || {}) }) }));
    // A vision row (ai/vision): the suggested depth and its reason next to the caption (§11.9.5).
    if (c.kind === 'media' && c.depth && t.has('opt.depth.' + c.depth)) {
      extra.push(h('div', { class: 'ai-why', text: t('media.ai.depth', { v: t('opt.depth.' + c.depth) }) }));
    }
    if (c.reason) extra.push(h('div', { class: 'ai-why', text: t('ai.review.reason', { text: c.reason }) }));
    return h('label', { class: ['ai-row', c.stale ? 'is-stale' : null, disabled ? 'is-disabled' : null], 'data-id': c.id,
      'data-line': lineOf(c) || (c.cutKey ? cutLine(c.cutKey) : null), 'data-kind': c.kind },
    box, h('span', { class: 'ai-row-main' }, h('span', { class: 'ai-row-text', text: rowText(ctx, c) }),
      h('span', { class: 'ai-stale', id: staleId, title: t('ai.review.staleTip'), hidden: !c.stale }, I.icon('warn', { size: 12 }), staleText(t, c)),
      extra));
  }

  function cutLine(key) { try { return P.lineOfCut(key); } catch (e) { return null; } }

  // An aggregate row (one change per area line): a tri-state checkbox, 「空気: 自動 → 桜吹雪（5行）」, ▸ its lines.
  function aggRow(ctx, r, row, all) {
    const t = ctx.t;
    const first = row.changes[0];
    const st = AC.aggState(row.changes);
    const disabled = row.changes.every((c) => AC.isDisabled(c, all));
    let text = null;
    try { text = CH.describeAgg(row.changes, t); } catch (e) { text = null; }
    if (!text) text = t('ai.ch.agg', { field: fieldText(t, first), from: fromText(t, first), to: valueText(t, first, first.to), n: row.changes.length });
    const stale = row.changes.filter((c) => c.stale);
    const box = h('span', { class: 'ai-agg-box', role: 'checkbox', tabindex: disabled ? '-1' : '0', 'aria-checked': st,
      'aria-disabled': disabled ? 'true' : null, 'aria-label': text, 'data-fkey': 'agg:' + row.agg,
      on: {
        click: () => { if (!disabled) ctx.ctl.toggleAgg(row.agg, st !== 'true'); },
        keydown: (ev) => { if ((ev.key === ' ' || ev.key === 'Enter') && !disabled) { ev.preventDefault(); ctx.ctl.toggleAgg(row.agg, st !== 'true'); } },
      } });
    const open = ctx.openAggs.has(row.agg);
    const more = h('button', { class: 'link ai-agg-more', type: 'button', 'aria-expanded': String(open), 'data-fkey': 'aggMore:' + row.agg,
      text: t('ai.review.aggLines', { n: row.changes.length }), on: { click: () => ctx.setAggOpen(row.agg, !open) } });
    const need = disabled ? all.find((x) => (first.requires || []).includes(x.id)) : null;
    const members = open ? h('div', { class: 'ai-agg-list', role: 'group', 'aria-label': text }, row.changes.map((c) => {
      const itemText = t('ai.review.member', { where: whereText(t, ctx.app, c), from: fromText(t, c), to: valueText(t, c, c.to) });
      const sub = directRow(ctx, r, c, all);
      sub.querySelector('.ai-row-text').textContent = itemText;
      return sub;
    })) : null;
    return h('div', { class: ['ai-agg', disabled ? 'is-disabled' : null], 'data-agg': row.agg,
      'data-lines': row.changes.map((c) => c.lineId).filter(Boolean).join(',') },
    h('div', { class: 'ai-row' }, box, h('span', { class: 'ai-row-main' }, h('span', { class: 'ai-row-text', text }),
      stale.length ? h('span', { class: 'ai-stale' }, I.icon('warn', { size: 12 }), staleText(t, stale[0])) : null,
      need ? h('span', { class: 'ai-need', text: t('ai.needsMaterial', { name: CH.matText(t, need) || MP.nameText(t, need.entry || {}) }) }) : null),
    more), members);
  }

  // A group heading: 歌詞 / 全体 / 行ごと / 時間 (ai.group.*), and the area-instruction groups 素材 / 区画 / カット / 区画の外
  // (ai.grp.*, DESIGN_2_1 §6.4).
  function groupHead(t, group) {
    if (group === 'area') return t('ai.grp.area', { area: '' }).trim();
    return AC.AREA_GROUP_ORDER.includes(group) ? t('ai.grp.' + group) : t('ai.group.' + group);
  }

  function directGroupHead(ctx, r, g) {
    const t = ctx.t;
    if (g.group === 'area') {
      const b = (r.briefs || []).find((x) => x.key === g.areaKey);
      return b ? t('ai.grp.area', { area: briefTitle(t, ctx.app, b) }) : t('ai.grp.area', { area: '' });
    }
    return groupHead(t, g.group);
  }

  function directReview(ctx, r) {
    const t = ctx.t;
    const all = r.changes;
    const briefs = r.briefs || [];
    const one = briefs.length === 1 ? briefs[0] : null;
    const title = r.tool === 'material' ? t('ai.review.title', { tool: t('ai.name.material') })
      : one ? t('ai.review.area', { area: briefTitle(t, ctx.app, one), text: one.instruction || t('ai.camera.run') })
        : t('ai.review.areas', { n: briefs.length });
    const questions = (r.questions || []).map((q) => {
      const b = briefs.find((x) => x.key === q.areaKey);
      return h('p', { class: 'ai-question', role: 'note', text: b ? t('ai.review.question', { area: briefTitle(t, ctx.app, b), q: q.text }) : q.text });
    });
    const groups = AC.directGroups(all, briefs.map((b) => b.key)).map((g) => {
      const rows = AC.aggRows(g.changes).map((row) => (row.agg ? aggRow(ctx, r, row, all) : directRow(ctx, r, row.change, all)));
      return h('details', { class: ['ai-group', 'ai-dgroup', g.group === 'outside' ? 'is-outside' : null], open: true, role: 'group',
        'data-group': g.group, 'aria-label': directGroupHead(ctx, r, g) },
      h('summary', { class: 'ai-group-head', text: directGroupHead(ctx, r, g) + ' · ' + g.changes.length }),
      g.group === 'outside' ? h('p', { class: 'note subtle', text: t('ai.grp.outsideHint') }) : null, rows);
    });
    return [
      h('div', { class: 'ai-review-head' },
        h('h3', { class: 'ai-h', tabindex: '-1', 'data-fkey': 'review-head', text: title }),
        r.summary ? h('p', { class: 'ai-summary', text: r.summary }) : null, questions,
        h('p', { class: 'note subtle', text: t('ai.review.note') })),
      h('div', { class: 'ai-list' },
        h('div', { class: 'ai-list-tools' },
          button(t('ai.review.all'), { class: 'link', fkey: 'all:-1', run: () => ctx.ctl.toggleAll(true, -1) }),
          button(t('ai.review.none'), { class: 'link', fkey: 'none:-1', run: () => ctx.ctl.toggleAll(false, -1) })),
        groups),
      warningsBlock(t, r.warnings),
      costLine(ctx, r),
      listFoot(ctx, Object.assign({}, r, { changes: all.filter((c) => !AC.isDisabled(c, all)) })),
    ];
  }

  // renderReview(ctx, review) → the review's nodes. ctx: { t, app, ctl, state, openCards: Set, setCardOpen(i, open),
  // openAggs: Set, setAggOpen(agg, open) }.
  function renderReview(ctx, r) {
    if (r.kind === 'direct') return directReview(ctx, r);
    if (r.kind === 'looks') return looksReview(ctx, r);
    if (r.kind === 'transcript') return transcriptReview(ctx, r);
    if (r.kind === 'analysis') return analysisReview(ctx, r);
    return listReview(ctx, r);
  }

  function sameIds(a, b) { return a.length === b.length && a.every((c, i) => c.id === b[i].id); }

  // Whether `r` has the same rows as the shown `prev` (only checks, stale marks or the try-on differ).
  function sameRows(prev, r) {
    if (!prev || prev.id !== r.id || prev.kind !== r.kind) return false;
    if (r.kind === 'list') return sameIds(prev.changes, r.changes);
    if (r.kind === 'looks') {
      return prev.proposals.length === r.proposals.length && r.proposals.every((p, i) => sameIds(prev.proposals[i].changes, p.changes));
    }
    return false;
  }

  // patchReview(ctx, el, prev, r) → true when `el`, showing renderReview(ctx, prev), now shows `r` without a rebuild:
  // rows get their checks and stale marks in place, only the counts and the buttons that depend on them are replaced.
  // A long review stays within the §7.4 repaint budget per click. false: rebuild with renderReview.
  function patchReview(ctx, el, prev, r) {
    if (!sameRows(prev, r)) return false;
    if (r.kind === 'list') {
      patchRows(el, r.changes);
      const foot = el.querySelector('.ai-review-foot');
      if (foot) foot.replaceWith(listFoot(ctx, r));
      return true;
    }
    const cards = el.querySelectorAll('.ai-look');
    if (cards.length !== r.proposals.length) return false;
    r.proposals.forEach((p, i) => {
      const card = cards[i];
      patchRows(card, p.changes);
      card.classList.toggle('is-trying', isTrying(ctx, i));
      const summary = card.querySelector('.ai-look-changes > summary');
      if (summary) summary.textContent = lookCount(ctx, p);
      const actions = card.querySelector(':scope > .row-actions');
      if (actions) actions.replaceWith(lookActions(ctx, p, i));
    });
    return true;
  }

  // ---- the log (§6.4.10.8) --------------------------------------------------------------------------------------------

  function clock(at) {
    if (typeof at !== 'number' || !Number.isFinite(at)) return '—';
    const d = new Date(at);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // 反映した AI の変更: newest first, each with [元に戻す] while something of it is still in the document; then
  // 「AIが決めた固定 n [すべて自動に戻す]」.
  function renderLog(ctx) {
    const t = ctx.t;
    const doc = ctx.app.doc;
    const entries = ctx.ctl.logEntries().slice().reverse();
    const pins = AC.aiPinCount(doc);
    if (!entries.length && !pins) return [];
    return [
      h('h3', { class: 'ai-h', text: t('ai.log.title') }),
      entries.length ? h('ul', { class: 'ai-log-list' }, entries.map((e) => {
        const can = AC.revertable(doc, e);
        const name = e.tool && t.has('ai.name.' + e.tool) ? t('ai.name.' + e.tool) : '—';
        // An area instruction names its areas (logEntry areas, DESIGN_2_1 §5.6).
        const areas = Array.isArray(e.areas) ? e.areas.filter((a) => a && Array.isArray(a.label)).map((a) => F.areaLabel(t, a)) : [];
        const tool = areas.length ? t('ai.log.areaTool', { tool: name, area: areas.join(t('list.sep')) }) : name;
        return h('li', { class: 'ai-log-row' },
          h('span', { class: 'grow', text: t('ai.log.entry', { time: clock(e.at), tool, n: e.n || 0 }) }),
          button(t('ai.log.revert'), { icon: 'undo', fkey: 'revert:' + e.runId, disabled: !can,
            title: can ? t('ai.log.revertTip') : t('ai.log.nothing'), run: () => ctx.ctl.revert(e.runId) }));
      })) : h('p', { class: 'note subtle', text: t('ai.log.empty') }),
      pins ? h('div', { class: 'ai-log-pins' }, h('span', { class: 'grow', text: t('ai.log.pins', { n: pins }) }),
        button(t('ai.log.unpinAll'), { fkey: 'unpinAi', run: () => ctx.ctl.clearAiPins() })) : null,
    ];
  }

  return { textDiff, renderReview, patchReview, renderLog, diffBlock, TRANSCRIPT_SHOWN, fieldText, valueText, fromText, rowText, previewId };
});
