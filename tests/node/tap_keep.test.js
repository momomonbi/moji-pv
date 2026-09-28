/* 文字PVメーカー v2 — original work. Tests: 「前後の行を動かさない」 — the start pins core/tap.stillPins adds after a one-line re-tap keep the other automatic lines where they were (PV22 S2, DESIGN_2_2 §5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const TM = MV.use('core/timing');
const TAP = MV.use('core/tap');
const B = MV.use('core/beats');

// Ten lines of placeholder kana (a blank row above line 6), the song 40 s long.
const TEXTS = ['あいうえおかきく', 'さしすせそたち', 'なにぬねのはひふへ', 'まみむめもや', 'らりるれろわをん', 'がぎぐげござじずぜ',
  'だぢづでどばび', 'ぱぴぷぺぽきゃきゅ', 'あかさたなはまや', 'いきしちにひみり'];
const LINES = TEXTS.map((text, i) => ({ id: 'r' + (i + 1), text, lang: 'ja', pauseBefore: i === 5 ? 1 : 0 }));
const SCENARIOS = [
  { name: 'between anchors', base: { 'line/r1:start': { v: 5, by: 'tap' }, 'line/r10:start': { v: 30, by: 'tap' } }, re: 'r5', at: 18.3 },
  { name: 'after the last anchor', base: { 'line/r1:start': { v: 5, by: 'tap' } }, re: 'r5', at: 14.2 },
  { name: 'no anchors', base: {}, re: 'r5', at: 12.0 },
  { name: 'before the first anchor', base: { 'line/r8:start': { v: 25, by: 'tap' } }, re: 'r4', at: 13.0 },
  { name: 'crossing the next line', base: {}, re: 'r5', at: 16.5 },
];
const GRIDS = [['snap off', null], ['120 BPM beat', { bpm: 120, grid: B.grid({ bpm: 120, offset: 0, meter: 4 }), timing: { snap: 'beat' } }]];

function times(pins, g) {
  return TM.solveTimes(LINES, Object.assign({ pins, songSeconds: 40 }, g ? { bpm: g.bpm, grid: g.grid, timing: g.timing } : {}));
}

// The ui/tap loop: the re-tapped start, then up to `rounds` rounds of stillPins against a trial of the pins so far.
function keep(sc, g, rounds) {
  const before = times(sc.base, g).times;
  const pins = Object.assign({}, sc.base, { ['line/' + sc.re + ':start']: { v: sc.at, by: 'tap' } });
  let after = times(pins, g), used = 0;
  for (; used < rounds; used++) {
    const add = TAP.stillPins(before, after.times, sc.re, sc.at).filter((x) => !pins['line/' + x.lineId + ':start']);
    if (!add.length) break;
    for (const x of add) pins['line/' + x.lineId + ':start'] = { v: x.start, by: 'user' };
    after = times(pins, g);
  }
  return { before, after, pins, used };
}

// The lines the new start crossed: they must move for the order to hold (MIN_GAP from the new start).
function crossed(before, sc) {
  const i = before.findIndex((l) => l.id === sc.re);
  return new Set(before.filter((b, k) => (k > i && b.t0 < sc.at + TAP.MIN_GAP) || (k < i && b.t0 > sc.at - TAP.MIN_GAP)).map((b) => b.id));
}

test('5 scenarios × snap off / 120 BPM: only the lines the tap crossed move, in at most 3 rounds', () => {
  for (const [gname, g] of GRIDS) {
    for (const sc of SCENARIOS) {
      const where = gname + ', ' + sc.name;
      const { before, after, pins, used } = keep(sc, g, 3);
      assert.ok(used <= 3, where);
      const forced = crossed(before, sc);
      const moved = after.times.filter((l, k) => l.id !== sc.re && Math.abs(l.t0 - before[k].t0) >= TAP.STILL_EPS).map((l) => l.id);
      assert.deepEqual(moved.filter((id) => !forced.has(id)), [], where + ': moved ' + moved.join(','));
      assert.equal(after.times.find((l) => l.id === sc.re).t0, sc.at, where + ': the re-tapped start is used');
      assert.ok(!after.warnings.some((w) => w.code === 'time-order'), where + ': no pin out of order');
      // helper pins are 'user' starts at the old times of automatic lines
      for (const [path, pin] of Object.entries(pins)) {
        if (sc.base[path] || path === 'line/' + sc.re + ':start') continue;
        const id = path.slice(5, -6);
        const old = before.find((l) => l.id === id);
        assert.deepEqual([pin.by, pin.v, old.by.start], ['user', old.t0, 'auto'], where + ' ' + path);
      }
    }
  }
});

test('the rounds matter: after the last anchor one or two passes still leave lines moving, three do not', () => {
  const sc = SCENARIOS[1];
  const unforced = (rounds) => {
    const { before, after } = keep(sc, null, rounds);
    const forced = crossed(before, sc);
    return after.times.filter((l, k) => l.id !== sc.re && !forced.has(l.id) && Math.abs(l.t0 - before[k].t0) >= TAP.STILL_EPS).map((l) => l.id);
  };
  assert.ok(unforced(1).length > 0, 'one pass: ' + unforced(1));
  assert.ok(unforced(2).length > 0, 'two passes: ' + unforced(2));
  assert.deepEqual(unforced(3), []);
  assert.equal(keep(sc, null, 3).used, 3);
});
