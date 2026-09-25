/* 文字PVメーカー v2 — original work. Lyric editor: a controlled textarea over a tinted mirror layer, with a gutter of times, locks, pins and warnings. */
MV.def('ui/lyric_editor', ['ui/dom', 'ui/selection', 'i18n/t', 'core/lyrics', 'planner/areas'], (dom, S, T, L, AREAS) => {
  'use strict';

  const { h } = dom;
  const SEAL_MS = 600;
  const FOLLOW_PAUSE_MS = 3000;
  const GUTTER_MARGIN_PX = 240;           // gutter entries are built for the visible rows plus this much above and below
  const STAMP = /^\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;
  const WARN_CODES = new Set(['overfull', 'orphan-pin', 'shadowed-pin', 'lock-partial', 'pin-not-applicable', 'time-order']);

  // --- mark tinting (display only; the parser is core/lyrics) --------------------------------------------------

  // Splits one row into [text, className] segments whose concatenation is exactly the row, so the mirror keeps the
  // textarea's metrics (only colours change, never widths).
  function segments(src) {
    const trimmed = src.trim();
    if (!trimmed) return [[src, '']];
    if (trimmed[0] === '#') return [[src, 'tok-comment']];
    if (L.isMetaRow(src)) return [[src, 'tok-meta']];              // the parser's own rule (§4.9.1)
    const out = [];
    let i = 0;
    const lead = /^\s*/.exec(src)[0];
    if (lead) { out.push([lead, '']); i = lead.length; }
    for (let m = STAMP.exec(src.slice(i)); m; m = STAMP.exec(src.slice(i))) { out.push([m[0], 'tok-stamp']); i += m[0].length; }
    const bang = impactIndex(src);
    let emph = false;
    let buf = '';
    const flush = (cls) => { if (buf) { out.push([buf, cls]); buf = ''; } };
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '\\' && i + 1 < src.length) { buf += ch + src[i + 1]; i++; continue; }
      if (ch === '|') { flush(emph ? 'tok-emphText' : ''); out.push([src.slice(i), 'tok-note']); return out; }
      if (i === bang) { flush(emph ? 'tok-emphText' : ''); out.push([ch, 'tok-impact']); continue; }
      if (ch === '/' || ch === '*') {
        flush(emph ? 'tok-emphText' : '');
        out.push([ch, ch === '/' ? 'tok-cut' : 'tok-emph']);
        if (ch === '*') emph = !emph;
        continue;
      }
      buf += ch;
    }
    flush(emph ? 'tok-emphText' : '');
    return out;
  }

  // Index of the trailing unescaped ASCII '!' of the text part (before any '|'), or -1.
  function impactIndex(src) {
    let end = src.length;
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '|') { end = i; break; }
    }
    let j = end - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    return j >= 0 && src[j] === '!' && src[j - 1] !== '\\' ? j : -1;
  }

  function rowIndexAt(text, offset) {
    let n = 0;
    for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  function rowStart(text, row) {
    let at = 0;
    for (let n = 0; n < row; n++) {
      const nl = text.indexOf('\n', at);
      if (nl < 0) return text.length;
      at = nl + 1;
    }
    return at;
  }

  function docText(doc) { return doc.sheet.rows.map((r) => r.src).join('\n'); }

  // The rows that differ between two row lists: old [a, oldEnd) is replaced by new [a, newEnd). Rows before a and from
  // the ends on are equal (a common prefix and suffix), so only the changed middle is rebuilt.
  function changedRows(prev, next) {
    let a = 0;
    while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
    let b = 0;
    while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
    return { a, oldEnd: prev.length - b, newEnd: next.length - b };
  }

  // Where the caret goes when undo / redo changes the text from `before` to `after`: the end of the changed span in
  // the new text (for an insertion undone, that is where it started; for a redo, after the redone text).
  function changeEnd(before, after) {
    let a = 0;
    while (a < before.length && a < after.length && before[a] === after[a]) a++;
    let b = 0;
    while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
    return after.length - b;
  }

  // The caret after undo / redo: undo goes back to where the entry's editing started (where.before, recorded before
  // the first keystroke of a typing burst); redo, and entries made elsewhere, to the end of the change.
  function caretAfterHistory(e, before, after) {
    const w = e && e.where && e.where.kind === 'lyrics' ? e.where : null;
    if (e && e.kind === 'undo' && w && typeof w.before === 'number') return Math.min(w.before, after.length);
    return changeEnd(before, after);
  }

  // --- the editor ----------------------------------------------------------------------------------------------

  function mount(app, opts) {
    const t = app.t;
    const o = opts || {};
    const textarea = h('textarea', {
      class: 'le-text', 'data-ctl': 'editor', spellcheck: false, 'aria-label': t('lyr.editor'), wrap: 'soft', autocapitalize: 'off',
      autocomplete: 'off', placeholder: '',
    });
    const mirror = h('div', { class: 'le-mirror', 'aria-hidden': 'true' });
    const gutter = h('div', { class: 'le-gutter', role: 'list', 'aria-label': t('lyr.gutter') });
    const inner = h('div', { class: 'le-inner' }, gutter, mirror, textarea);
    const sample = h('button', { class: 'btn small', type: 'button', 'data-ctl': 'sample', text: t('lyr.sample') });
    // [サンプルで試す] comes right under the title, so the syntax list below it can never push it out of view (§6.9).
    const placeholder = h('div', { class: 'le-placeholder' },
      h('p', { class: 'le-ph-title', text: t('lyr.placeholder') }), sample,
      h('ul', {}, ['lyr.ph1', 'lyr.ph2', 'lyr.ph3', 'lyr.ph4'].map((k) => h('li', { text: t(k) }))));
    const root = h('div', { class: 'lyric-editor' }, inner, placeholder);

    let composing = false;
    let pasting = false;
    let lastScroll = 0;
    let playingRow = -1;
    let rowEls = [];                        // mirror row elements, one per text row
    let rowSrcs = [];                       // the texts they show
    let caretBefore = null;                 // the caret before the pending edit (undo puts it back there)
    let gutterFrame = 0;
    let gutterStale = false;              // a gutter render came while the editor was hidden
    const seal = dom.debounce(() => app.store.seal(), SEAL_MS);

    sample.addEventListener('click', () => { if (o.onSample) o.onSample(); });

    // Typing → lyrics.set. A burst merges into one history entry (merge key, sealed after 600 ms idle, Enter, blur).
    function commit(kind) {
      const before = caretBefore;
      caretBefore = null;
      const text = textarea.value;
      if (text === docText(app.doc)) return;
      const wasEmpty = !app.doc.sheet.rows.some((r) => r.src.trim());
      const meta = kind === 'paste'
        ? { label: ['undo.paste', {}], where: whereNow(before) }
        : { label: ['undo.typing', {}], mergeKey: 'lyrics.type', where: whereNow(before) };
      if (kind === 'paste') app.store.seal();
      app.dispatch({ t: 'lyrics.set', text }, meta);
      if (kind === 'paste') app.store.seal(); else seal();
      if (wasEmpty && kind === 'paste' && o.onFirstPaste) o.onFirstPaste();
    }

    // where: the caret after the edit, and `before` = the caret before it (a typing burst keeps its first entry's).
    function whereNow(before) {
      const caret = textarea.selectionStart;
      return { kind: 'lyrics', caret, end: textarea.selectionEnd, before: typeof before === 'number' ? before : caret };
    }

    textarea.addEventListener('beforeinput', () => { if (caretBefore === null) caretBefore = textarea.selectionStart; });
    textarea.addEventListener('compositionstart', () => { composing = true; if (caretBefore === null) caretBefore = textarea.selectionStart; });
    textarea.addEventListener('compositionend', () => { composing = false; renderMirror(); commit('type'); });
    textarea.addEventListener('paste', () => { pasting = true; });
    textarea.addEventListener('input', (ev) => {
      renderMirror();
      if (composing || ev.isComposing) return;
      const kind = pasting ? 'paste' : 'type';
      pasting = false;
      commit(kind);
      // Enter ends a typing burst: the line break belongs to the burst before it (§6.4.14).
      if (ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph') { seal.cancel(); app.store.seal(); }
      caretMoved();
    });
    textarea.addEventListener('blur', () => { seal.cancel(); app.store.seal(); });
    for (const type of ['keyup', 'click']) textarea.addEventListener(type, caretMoved);
    textarea.addEventListener('focus', () => app.bus.emit('focus', { text: true }));
    textarea.addEventListener('blur', () => app.bus.emit('focus', { text: false }));
    root.addEventListener('scroll', () => { lastScroll = performanceNow(); scheduleGutter(); }, { passive: true });

    function performanceNow() { return typeof performance !== 'undefined' ? performance.now() : 0; }

    // --- caret → selection ---------------------------------------------------------------------------------------

    let lastCaretRow = -1;
    function caretMoved() {
      const row = rowIndexAt(textarea.value, textarea.selectionStart);
      if (row === lastCaretRow) return;
      lastCaretRow = row;
      const rowId = app.doc.sheet.rows[row] ? app.doc.sheet.rows[row].id : null;
      const plan = app.plan;
      if (!rowId || !plan || !plan.lines.some((l) => l.id === rowId)) return;
      app.select({ level: 'line', ids: [rowId] }, { from: 'lyrics', open: false, seek: 'ifPaused' });
    }

    // --- mirror and gutter -------------------------------------------------------------------------------------

    function rowElOf(src) {
      return h('div', { class: 'le-row' }, segments(src).map(([text, cls]) => (cls ? h('span', { class: cls, text }) : text)));
    }

    // Rebuilds only the mirror rows that changed (§7.4: typing never waits), keeps the textarea as tall as the mirror
    // (in the same task, so the textarea never scrolls inside itself), and schedules the gutter.
    function renderMirror() {
      const rows = textarea.value.split('\n');
      const d = changedRows(rowSrcs, rows);
      if (d.a < d.oldEnd || d.a < d.newEnd) {
        const fresh = rows.slice(d.a, d.newEnd).map(rowElOf);
        const anchor = rowEls[d.oldEnd] || null;
        for (let i = d.a; i < d.oldEnd; i++) rowEls[i].remove();
        const frag = document.createDocumentFragment();
        for (const el of fresh) frag.appendChild(el);
        mirror.insertBefore(frag, anchor);
        rowEls = rowEls.slice(0, d.a).concat(fresh, rowEls.slice(d.oldEnd));
        if (d.oldEnd !== d.newEnd || (playingRow >= d.a && playingRow < d.newEnd)) refreshPlaying();
      }
      rowSrcs = rows;
      textarea.style.height = Math.max(mirror.offsetHeight, root.clientHeight - 2) + 'px';
      placeholder.hidden = textarea.value.length > 0;
      root.classList.toggle('is-empty', !placeholder.hidden);   // no gutter while empty: the placeholder gets the width
      scheduleGutter();
    }

    // Rows moved: the karaoke row is found again from the playhead.
    function refreshPlaying() {
      for (const el of mirror.querySelectorAll('.le-row.is-playing')) el.classList.remove('is-playing');
      playingRow = -1;
      onTime(app.time ? app.time() : 0);
    }

    function pinCounts(doc) {
      const counts = new Map();
      for (const path of Object.keys(doc.pins)) {
        const m = /^(?:line|cut)\/(r[0-9a-z]+)(?:[.~:]|$)/.exec(path);
        if (m && doc.pins[path].by !== 'lock') counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      }
      return counts;
    }

    function scheduleGutter() {
      if (!gutterFrame) gutterFrame = requestAnimationFrame(() => { gutterFrame = 0; renderGutter(); });
    }

    // The first row whose bottom is below y (row tops only grow, so a binary search over offsetTop).
    function rowAtY(y) {
      let lo = 0, hi = rowEls.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const el = rowEls[mid];
        if (el.offsetTop + el.offsetHeight < y) lo = mid + 1; else hi = mid;
      }
      return lo;
    }

    // Gutter entries for the visible rows only (§6.4.14); scrolling and resizing build the rest when they come in. While
    // the editor is hidden (another step) its rows have no positions: the gutter is built when it shows again.
    function renderGutter() {
      if (!root.clientWidth) { gutterStale = true; return; }
      gutterStale = false;
      const doc = app.doc;
      const plan = app.plan;
      const aligned = textarea.value === docText(doc);
      const lines = new Map(plan ? plan.lines.filter((l) => l.id === l.row || !l.row).map((l) => [l.id, l]) : []);
      const warns = new Map();
      for (const w of (app.warnings ? app.warnings() : [])) {
        if (w.line && WARN_CODES.has(w.code) && !warns.has(w.line)) warns.set(w.line, w.code);
      }
      const counts = pinCounts(doc);
      const sel = S.validate(app.view.state.sel, plan);
      const selected = new Set(sel.level === 'line' ? sel.ids : [S.lineOfSel(sel)].filter(Boolean));
      const frag = document.createDocumentFragment();
      const top = root.scrollTop - GUTTER_MARGIN_PX;
      const bottom = root.scrollTop + root.clientHeight + GUTTER_MARGIN_PX;
      for (let i = rowAtY(top); i < rowEls.length; i++) {
        const rowEl = rowEls[i];
        if (rowEl.offsetTop > bottom) break;
        const row = aligned ? doc.sheet.rows[i] : null;
        if (!row) continue;
        const line = lines.get(row.id);
        const heading = /^\s*#/.test(row.src);
        if (!line && !heading) continue;
        const entry = h('div', {
          class: ['le-g', line && selected.has(row.id) ? 'is-selected' : ''], role: 'listitem', 'data-row': row.id,
          'data-heading': heading ? '1' : null, style: { top: rowEl.offsetTop, height: Math.max(18, rowEl.offsetHeight) },
        });
        if (line) fillEntry(entry, line, doc, counts.get(row.id) || 0, warns.get(row.id));
        else entry.append(h('span', { class: 'g-heading', 'aria-label': t('lyr.selectSection'), text: '§' }));
        frag.appendChild(entry);
      }
      dom.replace(gutter, frag);
    }

    function fillEntry(entry, line, doc, pins, warn) {
      const by = line.by && line.by.start;
      const time = h('span', { class: ['g-time', by === 'pin' ? 'is-pinned' : by === 'lrc' ? 'is-lrc' : 'is-auto'],
        text: T.fmtTime(line.t0).slice(0, -1) + (by === 'pin' ? '′' : '') });
      entry.append(time);
      if (by === 'lrc') entry.append(h('span', { class: 'g-badge', text: 'LRC' }));
      if (doc.locks[line.id]) entry.append(h('span', { class: 'g-lock', title: t('state.locked'), text: 'L' }));
      if (pins) entry.append(h('span', { class: 'g-pins', title: t('lyr.pinCount', { n: pins }), text: '●' + pins }));
      if (warn) entry.append(h('span', { class: 'g-warn', title: t('warn.' + warn), text: '!' }));
      const words = [T.fmtTime(line.t0), t('state.' + (by === 'pin' ? 'pinned' : by === 'lrc' ? 'mark' : 'auto'))];
      if (doc.locks[line.id]) words.push(t('state.locked'));
      if (pins) words.push(t('lyr.pinCount', { n: pins }));
      entry.setAttribute('aria-label', t('lyr.gutterEntry', { n: line.index + 1, what: words.join(', ') }));
      entry.tabIndex = -1;
    }

    // Gutter click: select the line and open 詳細 (no auto-fold); Shift = range, Ctrl = toggle; a heading selects its
    // section (the lines up to the next heading) as the area 「# サビ」 (DESIGN_2_1 §6.8).
    dom.on(gutter, 'click', '.le-g', (ev, el) => {
      const plan = app.plan;
      if (el.dataset.heading) {
        const area = AREAS.resolve(app.doc, plan, { kind: 'head', rowId: el.dataset.row });
        if (area && area.lineIds.length) { app.select(S.areaSel(area), { from: 'lyrics', open: true }); return; }
        const rows = app.doc.sheet.rows;
        const at = rows.findIndex((r) => r.id === el.dataset.row);
        const ids = [];
        for (let i = at + 1; i < rows.length && !/^\s*#/.test(rows[i].src); i++) {
          if (plan.lines.some((l) => l.id === rows[i].id)) ids.push(rows[i].id);
        }
        if (ids.length) app.select({ level: 'line', ids }, { from: 'lyrics', open: true });
        return;
      }
      const mode = ev.shiftKey ? 'range' : ev.ctrlKey || ev.metaKey ? 'toggle' : null;
      app.select(S.withLine(app.view.state.sel, plan, el.dataset.row, mode), { from: 'lyrics', open: true });
    });

    // --- sync from the document --------------------------------------------------------------------------------

    // Controlled: the textarea shows the document; undo/redo put the caret back where the entry was made.
    function sync(e) {
      const text = docText(app.doc);
      if (textarea.value !== text && !composing) {
        const old = textarea.value;
        const keep = document.activeElement === textarea;
        const history = !!e && (e.kind === 'undo' || e.kind === 'redo');
        const caret = history ? caretAfterHistory(e, old, text) : textarea.selectionStart;
        textarea.value = text;
        if (keep || history) {
          const c = Math.min(caret, text.length);
          textarea.setSelectionRange(c, c);
        }
        renderMirror();
      } else scheduleGutter();
    }

    // --- playback: karaoke row and follow ---------------------------------------------------------------------

    function onTime(tNow) {
      const plan = app.plan;
      let row = -1;
      if (plan && plan.lines.length) {
        const line = plan.lines.find((l) => l.t0 <= tNow && tNow < l.t1);
        if (line) row = app.doc.sheet.rows.findIndex((r) => r.id === (line.row || line.id));
      }
      if (row === playingRow) return;
      if (rowEls[playingRow]) rowEls[playingRow].classList.remove('is-playing');
      playingRow = row;
      if (rowEls[row]) {
        rowEls[row].classList.add('is-playing');
        const follow = app.view.state.playing && app.view.state.prefs.follow && performanceNow() - lastScroll > FOLLOW_PAUSE_MS;
        if (follow) scrollToRow(row);
      }
    }

    function scrollToRow(row) {
      const el = rowEls[row];
      if (!el) return;
      const top = el.offsetTop, bottom = top + el.offsetHeight;
      if (top < root.scrollTop + 24 || bottom > root.scrollTop + root.clientHeight - 24) {
        root.scrollTop = Math.max(0, top - root.clientHeight / 3);
        lastScroll = 0;
      }
    }

    // --- editing commands (Alt+↑/↓, Ctrl+B) ---------------------------------------------------------------------

    function caretRows() {
      const v = textarea.value;
      const a = rowIndexAt(v, textarea.selectionStart);
      const b = rowIndexAt(v, Math.max(textarea.selectionStart, textarea.selectionEnd - 1));
      return [a, Math.max(a, b)];
    }

    // Alt+↑ / Alt+↓: lyrics.move of the caret's row(s).
    function moveRows(d) {
      const rows = app.doc.sheet.rows;
      const [a, b] = caretRows();
      if (textarea.value !== docText(app.doc)) return false;
      if ((d < 0 && a === 0) || (d > 0 && b >= rows.length - 1)) return true;
      const ids = rows.slice(a, b + 1).map((r) => r.id);
      const before = d < 0 ? rows[a - 1].id : (rows[b + 2] ? rows[b + 2].id : null);
      const caretOff = textarea.selectionStart - rowStart(textarea.value, a);
      app.store.seal();
      app.dispatch({ t: 'lyrics.move', rowIds: ids, beforeRowId: before }, { label: ['undo.moveRows', {}], where: whereNow() });
      const na = a + (d < 0 ? -1 : 1);
      const start = rowStart(textarea.value, na) + caretOff;
      textarea.setSelectionRange(start, start);
      return true;
    }

    // Ctrl+B: wraps the selection (or the word at the caret) in *…*.
    function emphasis() {
      const v = textarea.value;
      const before = textarea.selectionStart;
      let s = textarea.selectionStart, e = textarea.selectionEnd;
      if (s === e) {
        while (s > 0 && !/[\s/*|!]/.test(v[s - 1])) s--;
        while (e < v.length && !/[\s/*|!\n]/.test(v[e])) e++;
      }
      if (s === e) return true;
      textarea.value = v.slice(0, s) + '*' + v.slice(s, e) + '*' + v.slice(e);
      textarea.setSelectionRange(s + 1, e + 1);
      app.store.seal();
      app.dispatch({ t: 'lyrics.set', text: textarea.value }, { label: ['undo.emphasis', {}], where: whereNow(before) });
      renderMirror();
      return true;
    }

    // The line under the caret (for Ctrl+Enter), or null.
    function caretLine() {
      const row = app.doc.sheet.rows[rowIndexAt(textarea.value, textarea.selectionStart)];
      return row && app.plan && app.plan.lines.find((l) => l.id === row.id) || null;
    }

    const api = {
      root, textarea, sync, onTime, moveRows, emphasis, caretLine, renderMirror, scrollToRow, refreshGutter: renderGutter,
      focus() { dom.focus(textarea); },
      isFocused: () => document.activeElement === textarea,
      flushTyping() { seal.cancel(); if (!composing) commit('type'); app.store.seal(); },
    };
    textarea.value = docText(app.doc);
    placeholder.hidden = textarea.value.length > 0;
    root.classList.toggle('is-empty', !placeholder.hidden);
    // Row positions depend on the width (wrapping) and are 0 while detached: re-measure whenever the size changes.
    let lastWidth = -1;
    let measureFrame = 0;
    const remeasure = () => {
      measureFrame = 0;
      if (!root.clientWidth) return;
      if (root.clientWidth !== lastWidth) { lastWidth = root.clientWidth; renderMirror(); } else if (gutterStale) renderGutter();
    };
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => { if (!measureFrame) measureFrame = requestAnimationFrame(remeasure); }).observe(root);
    }
    requestAnimationFrame(renderMirror);
    return api;
  }

  return { mount, segments, impactIndex, rowIndexAt, docText, changedRows, changeEnd, caretAfterHistory };
});
