/* 文字PVメーカー v2 — original work. Shared navigator window and camera track geometry. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const TL = load().use('ui/timeline');

test('overview edge resize keeps the opposite song time fixed and pans the detailed view', () => {
  const initial = { t0: 30, span: 60 };
  assert.deepEqual(TL.moveWindow(180, initial, 'start', 20), { t0: 50, span: 40 });
  assert.deepEqual(TL.moveWindow(180, initial, 'end', -20), { t0: 30, span: 40 });
  assert.deepEqual(TL.moveWindow(180, initial, 'pan', 80), { t0: 110, span: 60 });
  assert.deepEqual(initial, { t0: 30, span: 60 }, 'gesture snapshots stay immutable for cancellation');
});

test('navigator edges cannot cross or escape the song, including sub-two-second songs', () => {
  assert.deepEqual(TL.moveWindow(180, { t0: 30, span: 60 }, 'start', 1000), { t0: 88, span: 2 });
  assert.deepEqual(TL.moveWindow(180, { t0: 30, span: 60 }, 'end', -1000), { t0: 30, span: 2 });
  assert.deepEqual(TL.moveWindow(180, { t0: 30, span: 60 }, 'pan', 1000), { t0: 120, span: 60 });
  assert.deepEqual(TL.moveWindow(180, { t0: 30, span: 60 }, 'pan', -1000), { t0: 0, span: 60 });
  assert.deepEqual(TL.moveWindow(0.5, { t0: 0, span: 0 }, 'start', 1), { t0: 0, span: 0.5 });
  assert.deepEqual(TL.moveWindow(0.5, { t0: 0, span: 0 }, 'end', -1), { t0: 0, span: 0.5 });
});

test('window fit, malformed inputs and duration changes remain finite and clamped', () => {
  assert.deepEqual(TL.windowBounds(180, { t0: 80, span: 0 }), { t0: 0, span: 180 });
  assert.deepEqual(TL.windowBounds(12, { t0: 100, span: 20 }), { t0: 0, span: 12 });
  assert.deepEqual(TL.windowBounds(NaN, { t0: Infinity, span: NaN }), { t0: 0, span: 1 });
  assert.deepEqual(TL.moveWindow(NaN, null, 'start', Infinity), { t0: 0, span: 1 });
  for (const d of [0.25, 1, 2, 3.5, 25, 180, 3600]) {
    for (const kind of ['start', 'end', 'pan']) {
      for (const delta of [-4000, -1, 0, 1, 4000]) {
        const w = TL.moveWindow(d, { t0: d / 5, span: d / 2 }, kind, delta);
        assert.ok(w.t0 >= 0 && w.span >= Math.min(2, d) && w.t0 + w.span <= d + 1e-9);
      }
    }
  }
});

test('long-song navigator keeps true scale and separately usable control targets at both song edges', () => {
  for (const d of [180, 3600]) {
    for (const width of [320, 1000]) {
      for (const t0 of [0, d / 2, d - 2]) {
        const geo = TL.navigatorGeometry(d, { t0, span: 2 }, width);
        assert.equal(geo.left, t0 / d * width);
        assert.equal(geo.width, 2 / d * width, 'outline never exaggerates the selected window');
        assert.equal(geo.narrow, true, 'start, end and pan use separate vertical hit regions');
        assert.equal(geo.pan.width, 40);
        for (const left of [geo.start, geo.end]) {
          assert.ok(left + geo.left >= -1e-9 && left + geo.left + 12 <= width + 1e-9, 'edge knobs stay on screen');
        }
        assert.ok(geo.pan.left + geo.left >= -1e-9 && geo.pan.left + geo.left + geo.pan.width <= width + 1e-9,
          'minimum pan target stays on screen');
      }
    }
  }
  const wide = TL.navigatorGeometry(180, { t0: 0, span: 90 }, 1000);
  assert.equal(wide.narrow, false);
  assert.equal(wide.pan.width, 476);
});

test('camera lane remains separate from draggable lyric and cut tracks at short and roomy heights', () => {
  for (const h of [120, 144, 148, 178, 250]) {
    const r = TL.trackRows(h);
    assert.equal(r.line[1], r.cut[0]);
    assert.equal(r.cut[1], r.camera[0]);
    assert.equal(r.camera[1], r.ruler[0]);
    assert.equal(r.ruler[1], h);
    assert.ok(r.camera[1] - r.camera[0] >= 27, 'camera names remain legible');
    assert.ok(r.line[1] - r.line[0] >= 28, 'lyrics retain their own draggable row');
  }
});

test('camera direction hints describe shots and support none and custom references', () => {
  assert.equal(TL.shotMotion('none'), '·');
  assert.equal(TL.shotMotion('settle'), '＋');
  assert.equal(TL.shotMotion('pullReveal'), '−');
  assert.equal(TL.shotMotion('sweepAcross'), '→');
  assert.equal(TL.shotMotion({ keys: [{ at: 'a', aim: 'block', oy: 0.1 }, { at: 'b', aim: 'block', oy: -0.1 }] }), '↑');
  assert.equal(TL.shotMotion({ keys: [{ at: 'a', aim: 'block', ox: 0.1 }, { at: 'b', aim: 'block', ox: -0.1 }] }), '←');
});
