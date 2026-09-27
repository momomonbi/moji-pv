/* 文字PVメーカー v2 — original work. The keyframe editor (キーフレーム): a shot's keys as rows, the markers on the preview and the key diamonds on the timeline (DESIGN_2_1 §6.7; EXTREME shots, DESIGN_EXTREME §2.6). */
MV.def('ui/shot_editor', ['ui/dom', 'ui/icons', 'core/shot', 'core/curve', 'ui/curve_widget', 'ui/fields', 'ui/selection'],
  (dom, I, SHOT, CV, CW, F, S) => {
    'use strict';

    const { h } = dom;
    const L = SHOT.LIMITS;
    // とき: the anchors in time order, then n語目 / n拍目 / 割合 (a number `at`). An EXTREME shot has two anchors more:
    // 強調の歌い出し (accent) and 強調の次の言葉 (accentEnd), DESIGN_EXTREME §1.4 X1.
    const WHEN = Object.freeze(['a', 'rest', 'sung', 'mid', 'end', 'out', 'b', 'emph', 'word', 'beat', 'frac']);
    const X_WHEN = Object.freeze(['a', 'rest', 'sung', 'mid', 'end', 'out', 'b', 'emph', 'accent', 'accentEnd', 'word', 'beat', 'frac']);
    // ねらい (the §6.7 table; 画面の一点 is kept when a value already has it).
    const AIMS = Object.freeze(['block', 'emph', 'first', 'last', 'word', 'line', 'glyph', 'reading', 'frame']);
    // 位置: thirds are ox / oy ±0.167 (the other axis keeps the composition's placement).
    const POS = Object.freeze(['keep', 'center', 'left', 'right', 'top', 'bottom', 'free']);
    const THIRD = 0.167;
    const MARKS = ['①', '②', '③', '④', '⑤', '⑥'];
    const START_FROM = 'settle';          // editing while the value is 'none' starts from this preset's keys
    const NEW_KEY = Object.freeze({ at: 'mid', aim: 'block' });

    function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
    function q3(x) { const r = Math.round(x * 1000) / 1000; return r === 0 ? 0 : r; }
    function clamp(x, r) { return Math.max(r[0], Math.min(r[1], x)); }

    // --- pure: keys ↔ controls (Node-tested) ------------------------------------------------------------------------

    // shotKeys(ref) → { keys: plain key objects (a copy), follow } of a ShotRef; 'none' or unreadable → the START_FROM
    // preset (the editor always has keys to show). An EXTREME value (a preset, mirrored or not, or an x-shot) also gives
    // x: true and its shot-level beat and blur, which every edit keeps (DESIGN_EXTREME §1.1).
    function shotKeys(ref) {
      const v = SHOT.coerceShot(ref);
      const src = v === undefined || v === 'none' ? SHOT.SHOTS[START_FROM] : typeof v === 'string' ? SHOT.presetOf(v) : v;
      const out = { keys: src.keys.map((k) => JSON.parse(JSON.stringify(k))), follow: src.follow || 0 };
      if (v !== undefined && SHOT.isExtreme(v)) {
        out.x = true;
        if (src.beat) out.beat = JSON.parse(JSON.stringify(src.beat));
        if (src.blur !== undefined) out.blur = src.blur;
      }
      return out;
    }

    // limitsOf(state) → the ranges the rows edit within: XLIMITS for an EXTREME shot, else LIMITS (core/shot.limitsOf).
    function limitsOf(state) { return state && state.x ? SHOT.XLIMITS : L; }

    // toShot(keys, follow, x?) → the canonical Shot object (the whole value the editor pins), or undefined. x: the state
    // of an EXTREME shot ({ x: true, beat?, blur? }): the value stays an x-shot.
    function toShot(keys, follow, x) {
      const base = Object.assign({ keys }, follow ? { follow } : {});
      if (x && x.x) {
        base.x = 1;
        if (x.beat) base.beat = x.beat;
        if (x.blur !== undefined) base.blur = x.blur;
      }
      return SHOT.coerceShot(base);
    }

    // whenOf(key) → { choice, n }: n is the 1-based word or beat, or the percentage of a number `at`.
    function whenOf(key) {
      const at = key.at;
      if (isNum(at)) return { choice: 'frac', n: Math.round(at * 100) };
      const m = /^(word|beat):(-?\d+)$/.exec(String(at));
      if (m) { const k = Number(m[2]); return { choice: m[1], n: k >= 0 ? k + 1 : k }; }
      return { choice: X_WHEN.includes(at) ? at : 'a', n: null };
    }

    // atFrom(choice, n) → the key's `at`.
    function atFrom(choice, n) {
      if (choice === 'frac') return q3(clamp((isNum(n) ? n : 50) / 100, L.at));
      if (choice === 'word' || choice === 'beat') {
        const x = isNum(n) ? Math.round(n) : 1;
        const k = x > 0 ? x - 1 : x;
        return choice + ':' + clamp(k, L[choice]);
      }
      return choice;
    }

    function aimOf(key) {
      const m = /^(word|line|glyph):(-?\d+)$/.exec(String(key.aim));
      if (m) { const k = Number(m[2]); return { choice: m[1], n: k >= 0 ? k + 1 : k }; }
      return { choice: key.aim, n: null };
    }

    function aimFrom(choice, n) {
      if (choice === 'word' || choice === 'line' || choice === 'glyph') {
        const x = isNum(n) ? Math.round(n) : 1;
        return choice + ':' + clamp(x > 0 ? x - 1 : x, L[choice]);
      }
      return choice;
    }

    const isText = (aim) => !(aim === 'frame' || aim === 'point');

    function posOf(key) {
      const hasX = key.ox !== undefined, hasY = key.oy !== undefined;
      if (!hasX && !hasY) return 'keep';
      const x = hasX ? key.ox : null, y = hasY ? key.oy : null;
      if (x === 0 && y === 0) return 'center';
      if (!hasY && Math.abs(x + THIRD) < 1e-3) return 'left';
      if (!hasY && Math.abs(x - THIRD) < 1e-3) return 'right';
      if (!hasX && Math.abs(y + THIRD) < 1e-3) return 'top';
      if (!hasX && Math.abs(y - THIRD) < 1e-3) return 'bottom';
      return 'free';
    }

    // withPos(key, choice) → the key placed: そのまま removes ox/oy (the composition keeps the aim where it is).
    function withPos(key, choice) {
      const k = Object.assign({}, key);
      delete k.ox;
      delete k.oy;
      if (choice === 'center') Object.assign(k, { ox: 0, oy: 0 });
      else if (choice === 'left') k.ox = -THIRD;
      else if (choice === 'right') k.ox = THIRD;
      else if (choice === 'top') k.oy = -THIRD;
      else if (choice === 'bottom') k.oy = THIRD;
      else if (choice === 'free') Object.assign(k, { ox: isNum(key.ox) ? key.ox : 0, oy: isNum(key.oy) ? key.oy : 0 });
      return k;
    }

    // sizeOf(key, lim?) → { kind: 'fill' | 'zoom', v, range } (大きさ: fill for text aims, zoom for the frame or a point;
    // lim: the shot's limits, LIMITS by default).
    function sizeOf(key, lim) {
      const R = lim || L;
      return isText(key.aim) ? { kind: 'fill', v: isNum(key.fill) ? key.fill : 0.6, range: R.fill }
        : { kind: 'zoom', v: isNum(key.zoom) ? key.zoom : 1, range: R.zoom };
    }

    // editKey(state, i, patch) → the Shot with key i changed (patch keys set; null removes one). Changing the aim between
    // text and the frame swaps fill and zoom.
    function editKey(state, i, patch) {
      const keys = state.keys.map((k) => Object.assign({}, k));
      if (!keys[i]) return toShot(keys, state.follow);
      const k = keys[i];
      for (const name of Object.keys(patch)) { if (patch[name] === null) delete k[name]; else k[name] = patch[name]; }
      if (patch.aim !== undefined) {
        if (isText(k.aim)) delete k.zoom; else delete k.fill;
      }
      return toShot(keys, state.follow, state);
    }

    // addKey(state) → the Shot with one more key (after the last; ≤ 6).
    function addKey(state) {
      if (state.keys.length >= L.keys[1]) return toShot(state.keys, state.follow, state);
      const last = state.keys[state.keys.length - 1] || NEW_KEY;
      const k = Object.assign({}, NEW_KEY, { aim: last.aim });
      if (isText(k.aim) && isNum(last.fill)) k.fill = last.fill;
      if (!isText(k.aim) && isNum(last.zoom)) k.zoom = last.zoom;
      return toShot(state.keys.concat([k]), state.follow, state);
    }

    // removeKey(state, i) → the Shot without key i (≥ 2 keys stay).
    function removeKey(state, i) {
      if (state.keys.length <= L.keys[0]) return toShot(state.keys, state.follow, state);
      return toShot(state.keys.filter((k, j) => j !== i), state.follow, state);
    }

    // mirrorShot(state) → the EXTREME shot mirrored left ↔ right (左右反転: every ox and roll negated, as a "~m" preset).
    function mirrorShot(state) {
      const keys = state.keys.map((key) => {
        const k = Object.assign({}, key);
        if (isNum(k.ox)) k.ox = k.ox === 0 ? 0 : -k.ox;
        if (isNum(k.roll)) k.roll = k.roll === 0 ? 0 : -k.roll;
        return k;
      });
      return toShot(keys, state.follow, state);
    }

    // --- pure: times and the preview ------------------------------------------------------------------------------

    // approxTime(cut, key, plan) → an estimate of a key's time (s) from the plan alone: exact for a, b, a number, sung
    // (t0), end (t1) and mid; rest ≈ the sung start, out ≈ the sung end; beats from the plan's grid. The timeline uses
    // engine.shotTrack (the exact, fitted times) whenever the cut has a track.
    function approxTime(cut, key, plan) {
      const a = cut.a, b = cut.b;
      const t0 = isNum(cut.t0) ? cut.t0 : a, t1 = isNum(cut.t1) ? cut.t1 : b;
      const at = key.at;
      let tt;
      if (isNum(at)) tt = a + at * (b - a);
      else if (at === 'a') tt = a;
      else if (at === 'b') tt = b;
      else if (at === 'sung' || at === 'rest') tt = t0;
      else if (at === 'end' || at === 'out') tt = t1;
      else if (/^beat:/.test(at) && plan && plan.beats && plan.beats.bpm) {
        const p = 60 / plan.beats.bpm;
        tt = plan.beats.offset + Math.ceil((t0 - plan.beats.offset) / p) * p + Number(at.slice(5)) * p;
      } else tt = (t0 + t1) / 2;
      return Math.max(a, Math.min(b, tt + (key.dt || 0)));
    }

    // trackKeys(cut, keys, plan, track) → the track key (engine.shotTrack: keys sorted by time) of each data key, matched
    // by their estimated order; null without a track that has as many keys.
    function trackKeys(cut, keys, plan, track) {
      if (!track || !Array.isArray(track.keys) || track.keys.length !== keys.length) return null;
      const est = keys.map((k, i) => ({ i, t: approxTime(cut, k, plan) }));
      const order = est.slice().sort((p, q) => p.t - q.t || p.i - q.i);
      const out = new Array(keys.length);
      order.forEach((e, j) => { out[e.i] = track.keys[j]; });
      return out;
    }

    // keyTimes(cut, keys, plan, track) → [{ i, t }] in data order: the track's times when there is one, else estimates.
    function keyTimes(cut, keys, plan, track) {
      const matched = trackKeys(cut, keys, plan, track);
      return keys.map((k, i) => ({ i, t: matched ? matched[i].t : approxTime(cut, k, plan) }));
    }

    // atOfTime(cut, t) → the number `at` of a time inside the cut (a dragged diamond).
    function atOfTime(cut, t) {
      const span = Math.max(1e-6, cut.b - cut.a);
      return q3(clamp((t - cut.a) / span, L.at));
    }

    // markerAt(trackKey, design) → where the key places its aim on the preview (design units): the view of §4.19
    // (screen = C + zoom · R(−roll) · (aim − C − cam)).
    function markerAt(k, design) {
      const C = { x: design.w / 2, y: design.h / 2 };
      const box = k.aim || null;
      const ax = box ? box.x + box.w / 2 : C.x, ay = box ? box.y + box.h / 2 : C.y;
      const dx = ax - C.x - (k.x || 0), dy = ay - C.y - (k.y || 0);
      const r = -(k.roll || 0), z = isNum(k.zoom) ? k.zoom : 1;
      return { x: C.x + z * (dx * Math.cos(r) - dy * Math.sin(r)), y: C.y + z * (dx * Math.sin(r) + dy * Math.cos(r)) };
    }

    // offsetOfPoint(p, design, lim?) → the key's { ox, oy } for a marker dropped at p (frame fractions from the centre,
    // clamped to the shot's limits: ±0.4, ±0.6 for an EXTREME shot).
    function offsetOfPoint(p, design, lim) {
      const R = lim || L;
      return { ox: q3(clamp((p.x - design.w / 2) / design.w, R.ox)), oy: q3(clamp((p.y - design.h / 2) / design.h, R.oy)) };
    }

    // screenToWorld(dx, dy, view) → a screen drag (design units) in world units under the camera { zoom, roll }: the
    // inverse of the view, so text dragged on a zoomed or rolled preview stays under the pointer (§6.7).
    function screenToWorld(dx, dy, view) {
      const z = view && isNum(view.zoom) && view.zoom > 0 ? view.zoom : 1;
      const r = view && isNum(view.roll) ? view.roll : 0;
      return { dx: (dx * Math.cos(r) - dy * Math.sin(r)) / z, dy: (dx * Math.sin(r) + dy * Math.cos(r)) / z };
    }

    // --- the page ---------------------------------------------------------------------------------------------------

    // page(app, o) → an inspector sub-page { id, crumb, el, focus, refresh, destroy }.
    //   o: { scope (the page scope of 要素 › カメラ), ctx (fields.contextOf of that page) }
    // Every edit pins the whole Shot at the scope (it becomes custom); プリセットに戻す clears that pin.
    function page(app, o) {
      const t = app.t;
      const path = o.scope + ':cam.shot';
      const rows = h('div', { class: 'ke-rows' });
      const add = h('button', { class: 'chip-btn ke-add', type: 'button', text: t('keys.add') });
      const reset = h('button', { class: 'chip-btn ke-reset', type: 'button', text: t('keys.reset') });
      // 左右反転: an EXTREME shot only (DESIGN_EXTREME §2.6)
      const mirror = h('button', { class: 'chip-btn ke-mirror', type: 'button', hidden: true, text: t('keys.mirror') });
      const markBox = h('input', { type: 'checkbox', checked: true });
      const el = h('div', { class: 'ke-page' }, rows,
        h('div', { class: 'row-actions ke-foot' }, add, mirror, reset),
        h('label', { class: 'check-row' }, markBox, h('span', { text: t('keys.markers') })));
      let state = { keys: [], follow: 0 };
      let gesture = null;
      let built = '';

      const storedPath = () => F.writePath(path, app.plan);
      const pinned = () => { const p = app.doc.pins[storedPath()]; return !!p && p.by !== 'lock'; };

      // The value shown: the pin of this scope, else what the scope inherits or the planner chose (the first cut's).
      function current() {
        let fs = null;
        try { fs = app.svc.fieldStates(app.doc, app.plan, o.ctx.sel, [path], { registry: app.reg })[0]; } catch (e) { fs = null; }
        let v = fs && fs.state !== 'mixed' ? fs.value : null;
        if (v === null || v === undefined) {
          const c = cutOf();
          v = c && c.slots && c.slots['cam.shot'] ? c.slots['cam.shot'].v : 'none';
        }
        return v;
      }

      // The cut the markers and diamonds follow: the page's cut, else the first cut of its line, else the one playing.
      function cutOf() {
        const plan = app.plan;
        if (!plan) return null;
        if (o.ctx.cut) return plan.cuts.find((c) => c.key === o.ctx.cut.key) || null;
        if (o.ctx.cuts.length) return plan.cuts.find((c) => c.key === o.ctx.cuts[0].key) || null;
        const now = app.time();
        return plan.cuts.find((c) => c.line && c.a <= now && now < c.b) || plan.cuts.find((c) => c.line) || null;
      }

      function write(shot, merge) {
        if (!shot) return;
        const meta = { label: ['undo.pin', { field: t('fld.camShot'), scope: scopeName() }], where: { scope: o.scope, field: 'cam.shot' } };
        if (merge) meta.mergeKey = merge;
        app.dispatch(F.pinCmd(path, shot, app.plan, app.svc.pinSig), meta);
      }

      function scopeName() {
        const list = S.crumbs(o.ctx.sel, app.plan).filter((c) => c.sel.level !== 'el');
        return list.length ? t.label(list[list.length - 1].label) : t('crumb.work');
      }

      // One gesture per slider drag or marker drag (one undo entry, §6.7).
      function begin(key) {
        if (!gesture) gesture = { g: app.store.gesture('keys:' + key), key: 'keys:' + key };
        return gesture;
      }
      function end() { if (gesture) { gesture.g.end(); gesture = null; render(false); } }

      const sel = (label, options, value, onChange) => {
        const s = h('select', { class: 'select ke-sel', 'aria-label': label },
          options.map((x) => h('option', { value: x.v, text: x.text })));
        s.value = value;
        s.addEventListener('change', () => onChange(s.value));
        return s;
      };
      const num = (label, value, min, max, onChange) => {
        const box = h('input', { class: 'num-input ke-num', type: 'text', inputmode: 'numeric', 'aria-label': label, value: String(value) });
        box.addEventListener('change', () => {
          const v = Number(String(box.value).replace(',', '.'));
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); else box.value = String(value);
        });
        box.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { box.blur(); ev.preventDefault(); } });
        return box;
      };

      function keyRow(k, i) {
        const n = state.keys.length;
        const lim = limitsOf(state);
        const item = t('keys.item', { n: i + 1 });
        const lab = (key) => item + ' ' + t(key);
        const w = whenOf(k);
        const whenOpts = (state.x ? X_WHEN : WHEN).map((c) => ({ v: c, text: c === 'word' || c === 'beat' ? t('at.' + c, { n: 'n' })
          : c === 'frac' ? t('keys.frac') : t('at.' + c) }));
        const when = sel(lab('keys.when'), whenOpts, w.choice, (c) => write(editKey(state, i, { at: atFrom(c, w.n) })));
        const whenN = w.n === null ? null : num(lab('keys.when'), w.n, w.choice === 'frac' ? 0 : -20, w.choice === 'frac' ? 100 : 41,
          (v) => write(editKey(state, i, { at: atFrom(w.choice, v) })));
        const a = aimOf(k);
        const aimList = AIMS.includes(a.choice) ? AIMS : AIMS.concat([a.choice]);
        const aimOpts = aimList.map((c) => ({ v: c, text: ['word', 'line', 'glyph'].includes(c) ? t('aim.' + c, { n: 'n' }) : t('aim.' + c) }));
        const aim = sel(lab('keys.aim'), aimOpts, a.choice, (c) => write(editKey(state, i, { aim: aimFrom(c, a.n) })));
        const aimN = a.n === null ? null : num(lab('keys.aim'), a.n, -20, 81, (v) => write(editKey(state, i, { aim: aimFrom(a.choice, v) })));
        const size = sizeOf(k, lim);
        const range = h('input', { class: 'w-range ke-size', type: 'range', min: String(Math.round(size.range[0] * 100)),
          max: String(Math.round(size.range[1] * 100)), step: '1', value: String(Math.round(size.v * 100)), 'aria-label': lab('keys.size') });
        const sizeText = h('output', { class: 'cw-val mono', text: Math.round(size.v * 100) + '%' });
        range.addEventListener('keydown', (ev) => { if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') ev.stopPropagation(); });
        range.addEventListener('pointerdown', () => begin(i + ':size'));
        range.addEventListener('input', () => {
          const v = Number(range.value) / 100;
          sizeText.textContent = range.value + '%';
          write(editKey(state, i, { [size.kind]: v }), gesture ? gesture.key : 'keys:' + i + ':size');
        });
        range.addEventListener('change', end);
        range.addEventListener('pointerup', end);
        const pos = sel(lab('keys.pos'), POS.map((c) => ({ v: c, text: t('pos.' + c) })), posOf(k),
          (c) => write(toShot(state.keys.map((x, j) => (j === i ? withPos(x, c) : x)), state.follow, state)));
        // 緩急 of the move into this key (absent → the cut's cam.curve) and 傾き.
        const curve = CW.make({ path: 'cam.curve', compact: true }, {
          t, label: lab('keys.curve'),
          commit: (v) => write(editKey(state, i, { curve: v })),
          unpin: () => write(editKey(state, i, { curve: null })),
          gesture: () => ({ set: (v) => write(editKey(state, i, { curve: v })), end() {} }),
        });
        curve.update({ value: k.curve === undefined ? 'linear' : k.curve, auto: k.curve === undefined, mixed: false, readOnly: false });
        const roll = num(lab('keys.roll'), k.roll || 0, lim.roll[0], lim.roll[1], (v) => write(editKey(state, i, { roll: v })));
        // An EXTREME shot's keys: 衝撃 (a shake hit at the key, 0–1) and 背景の寄り (the ground zoom, 1–1.35; text and frame
        // aims), DESIGN_EXTREME §1.1.
        const xLine = state.x ? h('div', { class: 'ke-line ke-x' },
          h('span', { class: 'ke-lab', text: t('keys.hit') }),
          num(lab('keys.hit'), isNum(k.hit) ? k.hit : 0, lim.hit[0], lim.hit[1], (v) => write(editKey(state, i, { hit: v }))),
          k.aim === 'point' ? null : h('span', { class: 'ke-lab', text: t('keys.groundZoom') }),
          k.aim === 'point' ? null : num(lab('keys.groundZoom'), isNum(k.gz) ? k.gz : 1, lim.gz[0], lim.gz[1],
            (v) => write(editKey(state, i, { gz: v })))) : null;
        const remove = h('button', { class: 'icon-btn small ke-remove', type: 'button', title: t('keys.remove'), 'aria-label': item + ' ' + t('keys.remove'),
          disabled: n <= L.keys[0], on: { click: () => write(removeKey(state, i)) } }, I.icon('close', { size: 14 }));
        return h('div', { class: 'ke-row', role: 'group', 'aria-label': item, 'data-i': String(i) },
          h('div', { class: 'ke-line' }, h('span', { class: 'ke-mark', 'aria-hidden': 'true', text: MARKS[i] || String(i + 1) }),
            h('span', { class: 'ke-lab', text: t('keys.when') }), when, whenN),
          h('div', { class: 'ke-line' }, h('span', { class: 'ke-lab', text: t('keys.aim') }), aim, aimN),
          h('div', { class: 'ke-line' }, h('span', { class: 'ke-lab', text: t('keys.size') }), range, sizeText),
          h('div', { class: 'ke-line' }, h('span', { class: 'ke-lab', text: t('keys.pos') }), pos),
          h('div', { class: 'ke-line' }, h('span', { class: 'ke-lab', text: t('keys.curve') }), curve.el,
            h('span', { class: 'ke-lab', text: t('keys.roll') }), roll, h('span', { class: 'grow' }), remove),
          xLine);
      }

      function render(force) {
        state = shotKeys(current());
        const sig = JSON.stringify(state) + '|' + pinned();
        // A drag in progress keeps its controls (the next plan would otherwise replace the slider under the pointer).
        if (!force && (gesture || (sig === built && rows.contains(document.activeElement)))) { app.bus.emit('shotEdit'); return; }
        built = sig;
        const active = document.activeElement;
        const at = active && rows.contains(active) ? { row: active.closest('.ke-row'), label: active.getAttribute('aria-label') } : null;
        dom.replace(rows, state.keys.map((k, i) => keyRow(k, i)));
        add.disabled = state.keys.length >= L.keys[1];
        mirror.hidden = !state.x;
        mirror.disabled = !state.keys.some((k) => (isNum(k.ox) && k.ox !== 0) || (isNum(k.roll) && k.roll !== 0));
        reset.disabled = !pinned();
        if (at && at.row) {
          const again = rows.querySelector('.ke-row[data-i="' + at.row.dataset.i + '"] [aria-label="' + CSS.escape(at.label || '') + '"]');
          if (again) dom.focus(again);
        }
        app.bus.emit('shotEdit');
      }

      add.addEventListener('click', () => write(addKey(state)));
      mirror.addEventListener('click', () => write(mirrorShot(state)));
      reset.addEventListener('click', () => {
        if (pinned()) app.dispatch({ t: 'pin.clear', path: storedPath() }, { label: ['undo.unpinField', { field: t('fld.camShot') }] });
      });
      markBox.addEventListener('change', () => app.bus.emit('shotEdit'));

      // What the stage and the timeline read while the page is open (DESIGN_2_1 §6.7).
      const edit = {
        get markers() { return markBox.checked; },
        cut: cutOf,
        keys: () => state.keys,
        track() {
          const c = cutOf();
          return c ? app.engine.shotTrack(c.key) : null;
        },
        times() { const c = cutOf(); return c ? keyTimes(c, state.keys, app.plan, edit.track()) : []; },
        // [{ i, x, y }] where each key places its aim on the preview (design units); [] while the cut has no track.
        marks() {
          const c = cutOf();
          const design = app.plan && app.plan.design;
          const matched = c && design ? trackKeys(c, state.keys, app.plan, edit.track()) : null;
          return matched ? matched.map((k, i) => Object.assign({ i }, markerAt(k, design))) : [];
        },
        // A marker dropped on the preview: its key's ox / oy (自由); the wheel: its closeness.
        place(i, p, design, merge) { write(editKey(state, i, offsetOfPoint(p, design, limitsOf(state))), merge); },
        grow(i, d) {
          const k = state.keys[i];
          if (!k) return;
          const size = sizeOf(k, limitsOf(state));
          write(editKey(state, i, { [size.kind]: q3(clamp(size.v + d * (size.kind === 'fill' ? 0.05 : 0.01), size.range)) }), 'keys:wheel:' + i);
        },
        // A diamond dragged on the timeline: a number `at`.
        moveTo(i, time, merge) { const c = cutOf(); if (c) write(editKey(state, i, { at: atOfTime(c, time) }), merge); },
        gesture: (key) => begin(key),
        end,
      };
      app.shotEdit = edit;
      render(true);
      return {
        id: 'keys:' + o.scope, crumb: ['keys.heading', {}], el,
        focus() { dom.focus(rows.querySelector('select') || add); },
        refresh() { render(false); },
        destroy() {
          end();
          if (app.shotEdit === edit) app.shotEdit = null;
          app.bus.emit('shotEdit');
        },
      };
    }

    return {
      WHEN, X_WHEN, AIMS, POS, THIRD, shotKeys, limitsOf, toShot, whenOf, atFrom, aimOf, aimFrom, posOf, withPos, sizeOf, editKey, addKey,
      removeKey, mirrorShot, approxTime, trackKeys, keyTimes, atOfTime, markerAt, offsetOfPoint, screenToWorld, page,
    };
  });
