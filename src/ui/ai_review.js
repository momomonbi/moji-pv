/* 文字PVメーカー v2 — original work. AI review: checked change lists, the three looks, transcript and analysis previews, and the log with selective revert (DESIGN §6.4.10.5–8). */
MV.def('ui/ai_review', ['ui/dom', 'ui/icons', 'ai/changes', 'i18n/t', 'ui/ai_controller'], (dom, I, CH, T, AC) => {
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
      AC.grouped(changes).map((g) => h('div', { class: 'ai-group', role: 'group', 'aria-label': t('ai.group.' + g.group) },
        h('div', { class: 'ai-group-head', text: t('ai.group.' + g.group) }),
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

  // renderReview(ctx, review) → the review's nodes. ctx: { t, app, ctl, state, openCards: Set, setCardOpen(i, open) }.
  function renderReview(ctx, r) {
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
        return h('li', { class: 'ai-log-row' },
          h('span', { class: 'grow', text: t('ai.log.entry', { time: clock(e.at), tool: e.tool ? t('ai.name.' + e.tool) : '—', n: e.n || 0 }) }),
          button(t('ai.log.revert'), { icon: 'undo', fkey: 'revert:' + e.runId, disabled: !can,
            title: can ? t('ai.log.revertTip') : t('ai.log.nothing'), run: () => ctx.ctl.revert(e.runId) }));
      })) : h('p', { class: 'note subtle', text: t('ai.log.empty') }),
      pins ? h('div', { class: 'ai-log-pins' }, h('span', { class: 'grow', text: t('ai.log.pins', { n: pins }) }),
        button(t('ai.log.unpinAll'), { fkey: 'unpinAi', run: () => ctx.ctl.clearAiPins() })) : null,
    ];
  }

  return { textDiff, renderReview, patchReview, renderLog, diffBlock, TRANSCRIPT_SHOWN };
});
