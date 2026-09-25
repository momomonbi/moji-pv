/* 文字PVメーカー v2 — original work. Tests for ui/layout: the §6.2 table, no overlaps, auto-fold (DESIGN §6.1, §6.2, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const L = MV.use('ui/layout');

// DESIGN §6.2 measured table: viewport → [layout, tier, nothing open, 詳細 open (column kept), 詳細 + rail, drawer, 9:16].
const TABLE = [
  [1920, 1080, 'wide', 'tall', [1568, 882], [1216, 684], [1488, 837], [1344, 756], [506, 900]],
  [1440, 900, 'wide', 'tall', [1088, 612], [736, 414], [1008, 567], [1024, 576], [405, 720]],
  [1440, 789, 'wide', 'normal', [1082, 609], [736, 414], [1008, 567], [826, 465], [342, 609]],
  [1366, 768, 'wide', 'normal', [1014, 570], [662, 372], [934, 525], [789, 444], [330, 588]],
  [1280, 800, 'standard', 'normal', [952, 535], [640, 360], [888, 499], [846, 476], [348, 620]],
  [1280, 720, 'standard', 'short', [960, 540], [648, 364], [896, 504], [814, 458], [320, 570]],
  [1280, 689, 'standard', 'short', [958, 539], [648, 364], [896, 504], [759, 427], [303, 539]],
  [1200, 700, 'standard', 'short', [880, 495], [568, 319], [816, 459], [778, 438], [309, 550]],
  [1024, 768, 'compact', 'normal', [672, 378], [672, 378], null, [672, 378], [330, 588]],
  [1024, 640, 'compact', 'short', [680, 382], [680, 382], null, [672, 378], [275, 490]],
];

function size(res) { return [res.canvas.w, res.canvas.h]; }

function near(actual, expected, what) {
  assert.ok(Math.abs(actual[0] - expected[0]) <= 1 && Math.abs(actual[1] - expected[1]) <= 1,
    what + ': got ' + actual.join('×') + ', table says ' + expected.join('×'));
}

test('computeLayout reproduces the §6.2 table (±1 px)', () => {
  for (const [w, h, layout, tier, none, details, railed, drawer, portrait] of TABLE) {
    const vp = { w, h };
    const where = w + '×' + h;
    const base = L.computeLayout(vp, { panel: null, rail: false, drawer: false, aspect: '16:9' });
    assert.equal(base.layout, layout, where + ' layout');
    assert.equal(base.tier, tier, where + ' tier');
    near(size(base), none, where + ' nothing open');
    near(size(L.computeLayout(vp, { panel: 'details', rail: false, drawer: false, aspect: '16:9' })), details, where + ' 詳細');
    if (railed) near(size(L.computeLayout(vp, { panel: 'details', rail: true, drawer: false, aspect: '16:9' })), railed, where + ' rail');
    near(size(L.computeLayout(vp, { panel: null, rail: false, drawer: true, aspect: '16:9' })), drawer, where + ' drawer');
    near(size(L.computeLayout(vp, { panel: null, rail: false, drawer: false, aspect: '9:16' })), portrait, where + ' 9:16');
  }
});

test('the drawer and 詳細 together on the rail (§6.2 footnote)', () => {
  const both = { panel: 'details', rail: true, drawer: true, aspect: '16:9' };
  near(size(L.computeLayout({ w: 1280, h: 800 }, both)), [846, 476], '1280×800');
  near(size(L.computeLayout({ w: 1440, h: 900 }, both)), [1008, 567], '1440×900');
});

test('the canvas is exact to the aspect and centred in the preview area', () => {
  for (const aspect of ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9']) {
    for (const [w, h] of [[1920, 1080], [1280, 800], [1024, 640], [1440, 789]]) {
      const res = L.computeLayout({ w, h }, { panel: null, rail: false, drawer: false, aspect });
      const { preview } = res.rects;
      const c = res.canvas;
      assert.ok(Number.isInteger(c.w) && Number.isInteger(c.h), 'integer px');
      assert.ok(c.w <= preview.w && c.h <= preview.h, 'fits the preview area');
      assert.ok(c.w === preview.w || c.h === preview.h || Math.abs(c.w - preview.w) <= 1 || Math.abs(c.h - preview.h) <= 1,
        'touches one side');
      assert.ok(Math.abs((c.x - preview.x) - (preview.x + preview.w - c.x - c.w)) <= 1, 'centred horizontally');
      assert.ok(Math.abs((c.y - preview.y) - (preview.y + preview.h - c.y - c.h)) <= 1, 'centred vertically');
    }
  }
});

function allStates() {
  const out = [];
  for (const panel of [null, 'details', 'ai']) {
    for (const rail of [false, true]) {
      for (const drawer of [false, true]) out.push({ panel, rail, drawer });
    }
  }
  return out;
}

test('regions never overlap; stage parts stay inside the stage; the page fills the viewport without scrolling', () => {
  const viewports = TABLE.map(([w, h]) => ({ w, h })).concat([{ w: 1024, h: 600 }, { w: 1359, h: 859 }, { w: 1199, h: 739 }]);
  for (const vp of viewports) {
    for (const aspect of ['16:9', '9:16', '21:9']) {
      for (const state of allStates()) {
        const res = L.computeLayout(vp, Object.assign({ aspect }, state));
        const where = vp.w + '×' + vp.h + ' ' + aspect + ' ' + JSON.stringify(state);
        const regions = L.regions(res);
        for (let i = 0; i < regions.length; i++) {
          for (let j = i + 1; j < regions.length; j++) {
            assert.ok(!L.overlaps(regions[i][1], regions[j][1]), where + ': ' + regions[i][0] + ' overlaps ' + regions[j][0]);
          }
        }
        const r = res.rects;
        const inside = (box, outer) => box.x >= outer.x && box.y >= outer.y && box.x + box.w <= outer.x + outer.w
          && box.y + box.h <= outer.y + outer.h;
        for (const part of ['preview', 'lane', 'controls', 'drawer']) {
          if (r[part]) assert.ok(inside(r[part], r.stage), where + ': ' + part + ' leaves the stage');
        }
        const parts = ['preview', 'drawer', 'lane', 'controls'].map((k) => r[k]).filter(Boolean);
        for (let i = 1; i < parts.length; i++) assert.ok(parts[i].y >= parts[i - 1].y + parts[i - 1].h, where + ': stage parts overlap');
        assert.equal(res.page.scroll, false, where + ': no page scroll at ≥ 1024×600');
        const widthSum = regions.filter(([n]) => n !== 'header').reduce((s, [, b]) => s + b.w, 0);
        assert.equal(widthSum, vp.w, where + ': columns fill the width');
        assert.equal(r.controls.y + r.controls.h + res.metrics.pad, vp.h, where + ': play bar sits at the bottom');
        if (state.panel && res.layout !== 'compact') assert.ok(r.panel, where + ': panel rect');
        if (res.layout === 'compact') assert.equal(r.panel, null, where + ': compact hosts the panel in the side column');
      }
    }
  }
});

test('selection alone never reflows: geometry depends only on panel, rail, drawer, aspect and window', () => {
  const a = L.computeLayout({ w: 1440, h: 900 }, { panel: 'details', rail: true, drawer: false, aspect: '16:9' });
  const b = L.computeLayout({ w: 1440, h: 900 }, { panel: 'ai', rail: true, drawer: false, aspect: '16:9' });
  assert.deepEqual(a.rects, b.rects, '詳細 and AI share one column');
});

test('tiers and metrics: tall/normal use 48/16/12/88 (+144), short 44/12/8/74 (+112)', () => {
  assert.equal(L.tierOf(860), 'tall');
  assert.equal(L.tierOf(859), 'normal');
  assert.equal(L.tierOf(740), 'normal');
  assert.equal(L.tierOf(739), 'short');
  assert.deepEqual(['wide', 'standard', 'compact', 'stacked'], [1360, 1200, 1024, 1023].map(L.layoutOf));
  const roomy = L.metricsOf('normal');
  assert.deepEqual([roomy.header, roomy.pad, roomy.gap, roomy.playbar, roomy.drawer], [48, 16, 12, 88, 144]);
  const tight = L.metricsOf('short');
  assert.deepEqual([tight.header, tight.pad, tight.gap, tight.playbar, tight.drawer], [44, 12, 8, 74, 112]);
  const res = L.computeLayout({ w: 1440, h: 900 }, { aspect: '16:9' });
  assert.equal(res.rects.lane.h, 40);
  assert.equal(res.rects.controls.y - (res.rects.lane.y + res.rects.lane.h), 8);
  assert.equal(res.rects.steps.w, 320);
  assert.equal(L.computeLayout({ w: 1280, h: 800 }, { panel: 'details', aspect: '16:9' }).rects.panel.w, 312);
  assert.equal(L.computeLayout({ w: 1280, h: 800 }, { rail: true, aspect: '16:9' }).rects.rail.w, 48);
});

test('below 600 px of height the preview keeps 360 px and the page scrolls; stacked scrolls vertically only', () => {
  const low = L.computeLayout({ w: 1280, h: 480 }, { aspect: '16:9' });
  assert.equal(low.rects.preview.h, 360);
  assert.equal(low.page.scroll, true);
  const narrow = L.computeLayout({ w: 800, h: 900 }, { aspect: '16:9', panel: 'details' });
  assert.equal(narrow.layout, 'stacked');
  assert.ok(narrow.rects.stage.h <= 0.7 * 900 + 1, 'stage ≤ 70vh');
  assert.equal(narrow.rects.side.y, narrow.rects.stage.y + narrow.rects.stage.h, 'side column below the stage');
  assert.equal(narrow.rects.side.w, 800);
  assert.ok(narrow.canvas.w <= 800 - 2 * narrow.metrics.pad);
  assert.equal(narrow.page.w, 800, 'never wider than the window');
});

test('autoFold: wide/standard fold unless opened from the lyrics; compact never; the preference turns it off', () => {
  for (const layout of ['wide', 'standard']) {
    for (const from of ['preview', 'timeline', 'header', 'key', 'ai']) {
      assert.equal(L.autoFold({ layout, openedFrom: from, pref: true }), true, layout + ' ' + from);
    }
    assert.equal(L.autoFold({ layout, openedFrom: 'lyrics', pref: true }), false, layout + ' lyrics');
    assert.equal(L.autoFold({ layout, openedFrom: 'preview', pref: false }), false, layout + ' pref off');
  }
  assert.equal(L.autoFold({ layout: 'compact', openedFrom: 'preview', pref: true }), false);
  assert.equal(L.autoFold({ layout: 'stacked', openedFrom: 'preview', pref: true }), false);
  assert.equal(L.autoFold({ layout: 'wide', openedFrom: 'preview' }), true, 'default preference is on');
});

test('view store: auto-fold on open, restore on close only when the fold was automatic; prefs survive storage failures', () => {
  const V = MV.use('ui/view');
  const view = V.createView({ storage: null });
  const seen = [];
  view.on((changed) => seen.push(changed.join(',')));
  view.openPanel('details', { from: 'preview', layout: 'wide' });
  assert.equal(view.state.panel, 'details');
  assert.equal(view.state.rail, true, 'auto-folded');
  view.closePanel();
  assert.equal(view.state.rail, false, 'restored');
  view.openPanel('details', { from: 'lyrics', layout: 'wide' });
  assert.equal(view.state.rail, false, 'opened from the lyrics: column kept');
  view.closePanel();
  view.setRail(true);
  view.openPanel('ai', { from: 'header', layout: 'standard' });
  view.closePanel();
  assert.equal(view.state.rail, true, 'a column folded by hand stays folded');
  view.setRail(false);
  view.openPanel('details', { from: 'preview', layout: 'compact' });
  assert.equal(view.state.rail, false, 'compact never folds');
  assert.deepEqual(view.set({ sel: { level: 'work' } }), [], 'equal selection → no change event');
  assert.ok(seen.length > 0);

  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const v2 = V.createView({ storage: broken });
  assert.equal(v2.state.prefs.autoFold, true);
  assert.equal(v2.setPref('autoFold', false), true, 'applied even when it cannot be stored');
  v2.openPanel('details', { from: 'preview', layout: 'wide' });
  assert.equal(v2.state.rail, false, 'preference off → no auto-fold');
  const store = new Map();
  const mem = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  V.createView({ storage: mem }).setPref('singleKeys', false);
  assert.equal(V.createView({ storage: mem }).state.prefs.singleKeys, false, 'persisted');
  assert.equal(V.createView({ storage: mem }).setPref('singleKeys', 'no'), false, 'type-checked');
});

test('view store: the first-run autoplay mute is transient and never written to the stored preferences', () => {
  const V = MV.use('ui/view');
  const store = new Map();
  const mem = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const view = V.createView({ storage: mem });
  assert.equal(V.isMuted(view.state), false);
  assert.deepEqual(view.set({ autoMuted: true }), ['autoMuted']);
  assert.equal(V.isMuted(view.state), true, 'muted for the autoplay');
  assert.equal(view.state.prefs.muted, false, 'the preference is untouched');
  assert.equal(store.has(V.PREF_KEY), false, 'nothing stored');
  assert.equal(V.createView({ storage: mem }).state.autoMuted, false, 'a new session starts unmuted');
  view.set({ autoMuted: false });
  view.setPref('muted', true);
  assert.equal(V.isMuted(view.state), true, 'the stored preference still mutes');
  assert.equal(JSON.parse(store.get(V.PREF_KEY)).autoMuted, undefined, 'the transient flag is not a preference');
});
