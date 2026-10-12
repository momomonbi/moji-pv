/* 文字PVメーカー v2 — original work. Step ② 曲（任意）: song row or drop zone, tempo, snap to beats, tap-sync entry, AI timing (DESIGN §6.4.3, §6.11). */
MV.def('ui/step_song', ['ui/dom', 'ui/icons', 'ui/header', 'ui/selection', 'ui/timing_targets', 'i18n/t'], (dom, I, header, S, TT, T) => {
  'use strict';

  const { h } = dom;
  const BPM_MIN = 40;
  const BPM_MAX = 240;

  function mount(app) {
    const t = app.t;
    const songBox = h('div', { class: 'song-box', 'data-ctl': 'song' });
    const bpmInput = h('input', { class: 'num-input', type: 'number', min: BPM_MIN, max: BPM_MAX, step: '0.1',
      'aria-label': t('song.tempo'), inputmode: 'decimal' });
    const bpmTag = h('span', { class: 'state-tag' });
    const bpmMenu = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': t('song.tempoMenu'), title: t('song.tempoMenu') },
      I.icon('more', { size: 16 }));
    const tempo = h('div', { class: 'field', 'data-ctl': 'tempo' },
      h('label', { class: 'field-label', text: t('song.tempo') }),
      h('div', { class: 'field-row' }, bpmInput, h('span', { class: 'unit', text: 'BPM' }), bpmTag, h('span', { class: 'grow' }), bpmMenu));
    const snap = h('input', { type: 'checkbox', id: 'snap-beats' });
    const snapRow = h('label', { class: 'check-row', htmlFor: 'snap-beats', 'data-ctl': 'snap' }, snap,
      h('span', { text: t('song.snap') }));
    // Why 拍に合わせる is off, shown under it (not only as a tooltip) while there is no tempo.
    const snapWhy = h('p', { class: 'note subtle snap-why', id: 'snap-why', hidden: true, text: t('song.snapNeedsBpm') });
    const tapHint = h('span', { class: 'btn-hint' });
    const tapBtn = h('button', { class: 'btn wide tall', type: 'button', 'data-act': 'tap.start', 'data-ctl': 'tap' },
      I.icon('tap'), h('span', { class: 'btn-main', text: t('song.tap') }), tapHint);
    const aiBtn = h('button', { class: 'chip-btn', type: 'button', 'data-act': 'ai.align', 'data-ctl': 'ai' },
      I.icon('ai', { size: 15 }), t('song.aiTiming'));
    // The target is local UI state: choosing it never edits the project or adds an undo entry.
    let shiftMode = 'all', shiftArea = null, shiftSelKey = '';
    const shiftTarget = h('select', { class: 'select', 'data-ctl': 'shift-target', 'aria-label': t('song.shiftTarget') },
      ['all', 'area', 'selection'].map((v) => h('option', { value: v, text: t('song.shiftTarget.' + v) })));
    const shiftAreaPicker = h('select', { class: 'select', 'data-ctl': 'shift-area', 'aria-label': t('song.shiftArea'), hidden: true });
    const shiftStatus = h('p', { class: 'note', role: 'status', 'data-ctl': 'shift-status' });
    const shiftHint = h('p', { class: 'note subtle' });
    const shiftBtns = [-1, -0.1, 0.1, 1].map((d) => h('button', { class: 'btn small', type: 'button',
      'data-shift': String(d), text: t('song.shiftBy', { d: (d < 0 ? '−' : '+') + Math.abs(d) }), on: { click: () => shiftBy(d) } }));
    const shiftRow = h('div', { class: 'field', 'data-ctl': 'shift' },
      h('label', { class: 'field-label', text: t('song.shiftTitle') }),
      h('div', { class: 'field-row' }, h('span', { class: 'field-label inline', text: t('song.shiftTarget') }), shiftTarget),
      shiftAreaPicker, shiftStatus,
      h('div', { class: 'field-row' }, ...shiftBtns),
      shiftHint);
    const root = h('div', { class: 'step step-song' },
      h('div', { class: 'step-head' }, h('h2', { class: 'step-title', text: t('song.title') })),
      songBox, tempo, h('div', { class: 'snap-field' }, snapRow, snapWhy), tapBtn, aiBtn, shiftRow);

    function timingTarget() { return TT.resolve(app.doc, app.plan, shiftMode, app.view.state.sel, shiftArea); }

    function shiftBy(d) {
      const target = timingTarget(), result = TT.shift(app.doc, app.plan, target, d);
      if (!result.cmds.length) return;
      app.batch({ label: [target.kind === 'cut' ? 'undo.time' : 'undo.shift', { n: target.lineIds.length }],
        mergeKey: 'shift:' + (target.kind === 'cut' ? target.key : target.lineIds.join(',')) }, result.cmds);
      if (Math.abs(result.delta - d) > 0.000001) app.toast(t('song.shiftPartial', { d: (result.delta < 0 ? '−' : '+') + Math.abs(result.delta) }));
    }

    shiftTarget.addEventListener('change', () => { shiftMode = shiftTarget.value; shiftSelKey = ''; updateShift(); });
    shiftAreaPicker.addEventListener('change', () => {
      shiftArea = TT.areas(app.doc, app.plan).find((a) => a.key === shiftAreaPicker.value) || null;
      updateShift();
    });

    function updateShift() {
      const list = TT.areas(app.doc, app.plan, shiftArea), sel = S.validate(app.view.state.sel, app.plan, app.doc);
      const selKey = JSON.stringify(sel.level === 'line' ? { level: 'line', ids: sel.ids } : sel);
      if (shiftMode === 'area' && selKey !== shiftSelKey) {
        const keys = sel.level === 'line' && sel.area ? [sel.area] : [];
        const ids = sel.level === 'line' ? sel.ids : S.lineOfSel(sel) ? [S.lineOfSel(sel)] : [];
        const wanted = keys.length ? list.find((a) => JSON.stringify(a.ref) === JSON.stringify(keys[0]))
          : list.find((a) => ids.length && ids.every((id) => a.lineIds.includes(id)));
        if (wanted) shiftArea = wanted;
      }
      shiftSelKey = selKey;
      if (!shiftArea || !list.some((a) => a.key === shiftArea.key)) shiftArea = list[0] || null;
      const optsKey = JSON.stringify(list.map((a) => [a.key, a.label]));
      if (shiftAreaPicker.dataset.options !== optsKey) {
        dom.replace(shiftAreaPicker, list.map((a) => h('option', { value: a.key, text: t(a.label[0], a.label[1]) })));
        shiftAreaPicker.dataset.options = optsKey;
      }
      shiftAreaPicker.hidden = shiftMode !== 'area';
      shiftAreaPicker.disabled = !list.length;
      if (shiftArea) shiftAreaPicker.value = shiftArea.key;
      const target = timingTarget();
      shiftStatus.textContent = target ? target.kind === 'cut' ? t(target.label[0], target.label[1])
        : t('song.shiftLines', { name: t(target.label[0], target.label[1]), n: target.lineIds.length })
        : t(shiftMode === 'area' ? 'song.shiftNoArea' : 'song.shiftNone');
      shiftHint.textContent = t(target && target.kind === 'cut' ? 'song.shiftHintCut'
        : shiftMode === 'all' ? 'song.shiftHint' : 'song.shiftHintSelected');
      for (const b of shiftBtns) {
        const result = TT.shift(app.doc, app.plan, target, Number(b.dataset.shift));
        b.disabled = !result.cmds.length;
        b.title = result.reason === 'locked' ? t('song.shiftLocked') : result.reason === 'boundary' ? t('song.shiftBoundary') : '';
      }
    }

    dom.on(root, 'click', '[data-act]', (ev, b) => app.actions.run(b.dataset.act, { from: 'song' }));

    function bpmPath() { return 'work:bpm'; }
    function autoBpm() {
      const song = app.doc.song;
      return song && song.bpm ? song.bpm : null;
    }

    bpmInput.addEventListener('change', () => {
      const raw = bpmInput.value.trim();
      if (raw === '') { app.dispatch({ t: 'pin.clear', path: bpmPath() }, { label: ['undo.tempo', {}] }); return; }
      const v = Math.max(BPM_MIN, Math.min(BPM_MAX, Number(raw)));
      if (!Number.isFinite(v)) return;
      app.dispatch({ t: 'pin.set', path: bpmPath(), v: Math.round(v * 10) / 10, by: 'user' }, { label: ['undo.tempo', {}] });
    });
    bpmMenu.addEventListener('click', () => {
      const cur = currentBpm();
      header.popover(app, bpmMenu, (box, close) => {
        box.classList.add('menu');
        const item = (label, fn, disabled) => h('button', { class: 'menu-item', type: 'button', role: 'menuitem', disabled: !!disabled,
          on: { click: () => { close(); fn(); } } }, h('span', { class: 'menu-check' }), h('span', { class: 'menu-label', text: label }));
        const setBpm = (v) => app.dispatch({ t: 'pin.set', path: bpmPath(), v: Math.round(v * 10) / 10, by: 'user' }, { label: ['undo.tempo', {}] });
        box.append(
          item(t('song.double'), () => setBpm(Math.min(BPM_MAX, cur * 2)), !cur || cur * 2 > BPM_MAX),
          item(t('song.half'), () => setBpm(Math.max(BPM_MIN, cur / 2)), !cur || cur / 2 < BPM_MIN),
          item(t('song.tempoAuto'), () => app.dispatch({ t: 'pin.clear', path: bpmPath() }, { label: ['undo.tempo', {}] }),
            !app.doc.pins[bpmPath()]));
      });
    });
    snap.addEventListener('change', () => {
      app.dispatch({ t: 'timing.set', key: 'snap', v: snap.checked ? 'beat' : 'off' }, { label: ['undo.snap', {}] });
    });

    function currentBpm() {
      const pin = app.doc.pins[bpmPath()];
      return pin ? pin.v : autoBpm();
    }

    // The loading row is built once per file and then only updated: progress arrives every few milliseconds, and a
    // rebuilt [中止] would lose a click that lands between two updates.
    let loadingRow = null;                 // { name, row, progress, bar, text }
    function showProgress(st) {
      const pct = Math.round((st.progress || 0) * 100);
      const label = t('song.analyzing', { pct });
      if (!loadingRow || loadingRow.name !== st.name || !songBox.contains(loadingRow.row)) {
        const bar = h('div', { class: 'progress-bar' });
        const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
        const text = h('div', { class: 'muted small' });
        const row = h('div', { class: 'song-row busy' }, I.icon('music'),
          h('div', { class: 'song-meta' }, h('div', { class: 'song-name', text: st.name || '' }), progress, text),
          app.cancelSong ? h('button', { class: 'btn small song-cancel', type: 'button', title: t('song.cancelTip'),
            text: t('song.cancel'), on: { click: () => app.cancelSong() } }) : null);
        loadingRow = { name: st.name, row, progress, bar, text };
        dom.replace(songBox, row);
      }
      dom.setStyle(loadingRow.bar, { width: pct + '%' });
      loadingRow.progress.setAttribute('aria-valuenow', String(pct));
      loadingRow.progress.setAttribute('aria-label', label);
      loadingRow.text.textContent = label;
    }

    function renderSongBox() {
      const song = app.doc.song;
      const st = app.songState ? app.songState() : { state: song ? 'ready' : 'none' };
      if (st.state === 'decoding') {
        showProgress(st);
        return;
      }
      loadingRow = null;
      if (st.state === 'unsupported') {
        dom.replace(songBox, h('div', { class: 'inline-error', role: 'alert' }, I.icon('warn'), h('span', { text: t('err.song.unsupported') })));
        return;
      }
      // The message on its own line (it names the file and the formats that work), the button under it, and the
      // reminder that a song is optional stays below the box (§6.11).
      if (st.state === 'error') {
        const key = 'err.song.' + (st.code || 'decode');
        const params = { name: st.name || '' };
        dom.replace(songBox, h('div', { class: 'inline-error stacked', role: 'alert' },
          h('div', { class: 'inline-error-text' }, I.icon('warn'), h('span', { text: t.has(key) ? t(key, params) : t('err.song.decode', params) })),
          h('button', { class: 'btn small', type: 'button', text: t('song.pickOther'),
            on: { click: () => (st.relink ? app.pickRelink() : app.pickSong()) } })),
        app.doc.song ? null : h('p', { class: 'note', text: t('song.none') }));
        return;
      }
      if (!song) {
        dom.replace(songBox,
          h('button', { class: 'drop-zone', type: 'button', on: { click: () => app.pickSong() } },
            I.icon('music', { size: 26 }), h('span', { class: 'drop-main', text: t('song.drop') }),
            h('span', { class: 'drop-sub', text: t('song.formats') })),
          h('p', { class: 'note', text: t('song.none') }));
        return;
      }
      const missing = st.state === 'missing';
      const linking = st.state === 'linking';
      const menu = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': t('song.menu'), title: t('song.menu') }, I.icon('more', { size: 16 }));
      menu.addEventListener('click', () => header.popover(app, menu, (box, close) => {
        box.classList.add('menu');
        box.append(
          h('button', { class: 'menu-item', type: 'button', role: 'menuitem', on: { click: () => { close(); app.pickSong(); } } },
            h('span', { class: 'menu-check' }), h('span', { class: 'menu-label', text: t('song.replace') })),
          h('button', { class: 'menu-item', type: 'button', role: 'menuitem', on: { click: () => { close(); app.clearSong(); } } },
            h('span', { class: 'menu-check' }), h('span', { class: 'menu-label', text: t('song.remove') })));
      }));
      const wave = h('canvas', { class: 'song-wave', width: 560, height: 56 });
      drawWave(wave, song);
      dom.replace(songBox,
        h('div', { class: 'song-row' }, I.icon('music'),
          h('div', { class: 'song-meta' }, h('div', { class: 'song-name', text: song.name }),
            h('div', { class: 'muted small', text: T.fmtTime(song.seconds).replace(/\.\d+$/, '') })), menu),
        wave,
        linking ? h('div', { class: 'muted small', role: 'status', text: t('song.linking') }) : null,
        // §6.11: the picker re-links the project's own song (same sha1, or the same length after asking).
        missing ? h('div', { class: 'inline-error', role: 'alert' }, I.icon('warn'),
          h('span', { text: t('song.relink', { name: song.name, dur: T.fmtTime(song.seconds).replace(/\.\d+$/, '') }) }),
          h('button', { class: 'btn small', type: 'button', text: t('song.pick'), on: { click: () => app.pickRelink() } })) : null);
    }

    function drawWave(cv, song) {
      const g = cv.getContext('2d');
      const d = song.digest && typeof song.digest.loud === 'string' ? song.digest.loud : '';
      let bytes = null;
      try { bytes = Uint8Array.from(atob(d), (c) => c.charCodeAt(0)); } catch (e) { bytes = null; }
      g.clearRect(0, 0, cv.width, cv.height);
      if (!bytes || !bytes.length) return;
      g.fillStyle = '#7c8699';
      for (let x = 0; x < cv.width; x += 3) {
        const v = bytes[Math.min(bytes.length - 1, Math.floor(x / cv.width * bytes.length))] / 255;
        const a = v * cv.height * 0.45;
        g.fillRect(x, cv.height / 2 - a, 2, 2 * a);
      }
    }

    function update() {
      renderSongBox();
      const pin = app.doc.pins[bpmPath()];
      const auto = autoBpm();
      if (document.activeElement !== bpmInput) bpmInput.value = pin ? String(pin.v) : auto ? String(Math.round(auto * 10) / 10) : '';
      bpmInput.placeholder = auto ? '' : t('song.tempoNone');
      bpmTag.textContent = pin ? t('state.pinned') : auto ? t('state.auto') : '';
      bpmTag.dataset.state = pin ? 'pinned' : 'auto';
      snap.checked = app.doc.timing.snap !== 'off';
      snap.disabled = !currentBpm();
      snapRow.title = snap.disabled ? t('song.snapNeedsBpm') : '';
      snapWhy.hidden = !snap.disabled;
      if (snap.disabled) snap.setAttribute('aria-describedby', 'snap-why'); else snap.removeAttribute('aria-describedby');
      const sel = S.validate(app.view.state.sel, app.plan);
      const line = S.lineOfSel(sel);
      const info = line && app.plan ? app.plan.lines.find((l) => l.id === line) : null;
      tapHint.textContent = info ? t('song.tapFrom', { n: info.index + 1 }) : t('song.tapFromStart');
      tapBtn.disabled = !(app.plan && app.plan.lines.length);
      aiBtn.hidden = !app.view.state.prefs.ai;
      aiBtn.disabled = !app.doc.song;
      aiBtn.title = app.doc.song ? '' : t('song.aiNeedsSong');
      updateShift();
    }

    app.bus.on('song', update);
    // Undo / redo / open change the song, the tempo pin or the snap setting without a 'song' event.
    const touchesSong = (x) => !!x && (x.song || x.timing || (x.pins instanceof Set && x.pins.has(bpmPath())));
    app.bus.on('plan', (e) => {
      if (e && e.kind === 'load') { shiftArea = null; shiftSelKey = ''; }
      if (e && touchesSong(e.touched)) update(); else updateShift();
    });
    app.view.on((changed) => { if (changed.includes('sel') || changed.includes('prefs')) update(); });
    update();
    return { root, update: () => update() };
  }

  return { mount };
});
