/* 文字PVメーカー v2 — original work. Tests: core/pins — precedence lookup and cut-pin reattachment (DESIGN §3.5, §4.10.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');

const MV = load();
const PINS = MV.use('core/pins');

const user = (v, sig) => (sig === undefined ? { v, by: 'user' } : { v, by: 'user', sig });

test('index groups pins by scope, in sorted order, and collects bad paths', () => {
  const ix = PINS.index({
    'work:mood': { v: 'quietHush', by: 'user' },
    'line/r7:arrange': { v: 'giantWhisper', by: 'ai' },
    'cut/r3~4:arrive.each': user(0.05, '街を走る'),
    'cut/r3~0:el.text.nudge': user({ dx: 0, dy: -24, rot: 0, s: 1 }, '夜明けの'),
    'cut/r3~12:dwell': user('waveRun', 'x'),
    'cut/title:ground': user('washiFiber', ''),
    'nonsense:thing': user(1),
  });
  assert.equal(ix.work.get('mood').v, 'quietHush');
  assert.equal(ix.line.get('r7').get('arrange').by, 'ai');
  assert.equal(ix.cut.get('r3~4').get('arrive.each').v, 0.05);
  assert.deepEqual([...ix.cut.keys()], ['cut/r3~0', 'cut/r3~12', 'cut/r3~4', 'cut/title'].map((k) => k.slice(4)));
  assert.deepEqual(ix.byLine.get('r3'), ['r3~0', 'r3~4', 'r3~12'], 'pin cut keys of a line, by offset');
  assert.equal(ix.byLine.has('title'), false, 'special cuts belong to no line');
  assert.deepEqual(ix.bad, ['nonsense:thing']);
  const empty = PINS.index(undefined);
  assert.equal(empty.work.size + empty.line.size + empty.cut.size, 0);
});

test('lookup: cut > line > work, returning { v, from, by, at }', () => {
  const pins = {
    'work:arrive': { v: 'workRise', by: 'user' },
    'line/r3:arrive': { v: 'lineRise', by: 'ai' },
    'cut/r3~4:arrive': { v: 'cutRise', by: 'lock', sig: '街を走る' },
    'work:text.scale': { v: 0, by: 'user' },
    'line/r3:text.ink': { v: null, by: 'user' },
  };
  const ix = PINS.index(pins);
  const at = { cutKey: 'r3~4', pinCutKey: 'r3~4', lineId: 'r3' };
  deepEqual(PINS.lookup(ix, at, 'arrive'), { v: 'cutRise', from: 'pin:cut', by: 'lock', at: 'cut/r3~4:arrive' });
  deepEqual(PINS.lookup(ix, { ...at, cutKey: 'r3~0', pinCutKey: null }, 'arrive'),
    { v: 'lineRise', from: 'pin:line', by: 'ai', at: 'line/r3:arrive' });
  deepEqual(PINS.lookup(ix, { cutKey: 'r5~0', pinCutKey: null, lineId: 'r5' }, 'arrive'),
    { v: 'workRise', from: 'pin:work', by: 'user', at: 'work:arrive' });
  assert.equal(PINS.lookup(ix, at, 'dwell'), null);
  assert.equal(PINS.lookup(ix, at, 'text.scale').v, 0, 'falsy values are real pins');
  assert.equal(PINS.lookup(ix, at, 'text.ink').v, null);
  assert.equal(PINS.lookup(ix, at, 'text.ink').from, 'pin:line');
});

test('lookup: pinCutKey is the reattached key; lineId defaults from the cut key; special cuts skip line pins', () => {
  const ix = PINS.index({
    'cut/r3~5:arrive': { v: 'moved', by: 'user', sig: 'x' },
    'line/r3:arrive': { v: 'lineRise', by: 'user' },
    'line/r3:dwell': { v: 'lineHold', by: 'user' },
    'work:dwell': { v: 'workHold', by: 'user' },
    'cut/title:dwell': { v: 'titleHold', by: 'user', sig: '' },
  });
  assert.equal(PINS.lookup(ix, { cutKey: 'r3~4', pinCutKey: 'r3~5', lineId: 'r3' }, 'arrive').v, 'moved');
  assert.equal(PINS.lookup(ix, { cutKey: 'r3~5', pinCutKey: null, lineId: 'r3' }, 'arrive').v, 'lineRise',
    'an explicit null pinCutKey means no cut pins are attached');
  assert.equal(PINS.lookup(ix, { cutKey: 'r3~5' }, 'arrive').v, 'moved', 'pinCutKey defaults to cutKey');
  assert.equal(PINS.lookup(ix, { cutKey: 'r3~0' }, 'dwell').v, 'lineHold', 'lineId derived from the cut key');
  assert.equal(PINS.lookup(ix, { cutKey: 'title', lineId: null }, 'dwell').v, 'titleHold');
  assert.equal(PINS.lookup(ix, { cutKey: 'intro' }, 'dwell').v, 'workHold');
  assert.equal(PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId: null }, 'dwell').v, 'workHold');
  assert.equal(PINS.lookup(ix, { cutKey: null, lineId: 'r3' }, 'dwell').v, 'lineHold');
});

// Cut pins of one line; `sig` given → the pin carries a signature.
function lineIndex(entries) {
  const pins = {};
  for (const [key, sig] of entries) pins['cut/' + key + ':arrive'] = sig === null ? { v: 'a', by: 'user' } : user('a', sig);
  pins['cut/r9~0:arrive'] = user('other line', 'x');
  return PINS.index(pins);
}

test('attachCuts: exact keys attach first', () => {
  const ix = lineIndex([['r3~0', '夜明けの'], ['r3~4', '街を走る']]);
  const cuts = [{ key: 'r3~0', a: 0, b: 4, text: '夜明けの' }, { key: 'r3~4', a: 4, b: 8, text: '街を走る' }];
  deepEqual(PINS.attachCuts(ix, 'r3', cuts), { map: { 'r3~0': 'r3~0', 'r3~4': 'r3~4' }, orphans: [], shadowed: [] });
});

test('attachCuts: signature, then containment', () => {
  // The line gained a character in front: '夜明けの' → '朝夜明けの' moves the second piece from 4 to 5.
  const ix = lineIndex([['r3~4', '街を走る'], ['r3~2', null]]);
  const cuts = [{ key: 'r3~0', a: 0, b: 5, text: '朝夜明けの' }, { key: 'r3~5', a: 5, b: 9, text: '街を走る' }];
  const out = PINS.attachCuts(ix, 'r3', cuts);
  deepEqual(out.map, { 'r3~0': 'r3~2', 'r3~5': 'r3~4' });
  deepEqual(out.orphans, []);
  deepEqual(out.shadowed, []);
});

test('attachCuts: an ambiguous signature falls through to containment', () => {
  const ix = lineIndex([['r3~6', 'ラララ']]);
  const cuts = [{ key: 'r3~0', a: 0, b: 3, text: 'ラララ' }, { key: 'r3~3', a: 3, b: 6, text: 'ラララ' },
    { key: 'r3~7', a: 6, b: 9, text: 'ラララ' }];
  deepEqual(PINS.attachCuts(ix, 'r3', cuts).map, { 'r3~7': 'r3~6' });
});

test('attachCuts: conflicts go to the key closest to the cut start; the rest are shadowed', () => {
  const ix = lineIndex([['r3~0', null], ['r3~3', null], ['r3~6', null]]);
  const cuts = [{ key: 'r3~0', a: 0, b: 2, text: 'ab' }, { key: 'r3~2', a: 2, b: 9, text: 'cdefghi' }];
  deepEqual(PINS.attachCuts(ix, 'r3', cuts), { map: { 'r3~0': 'r3~0', 'r3~2': 'r3~3' }, orphans: [], shadowed: ['r3~6'] });
});

test('attachCuts: signature ties go to the smaller offset; shadowed keys are not retried', () => {
  // r3~3 and r3~7 both match the only '街' cut (a = 5) at distance 2: the smaller offset wins. r3~7 is shadowed
  // even though its offset would be contained in the other cut.
  const ix = lineIndex([['r3~3', '街'], ['r3~7', '街']]);
  const cuts = [{ key: 'r3~5', a: 5, b: 6, text: '街' }, { key: 'r3~6', a: 6, b: 10, text: 'を走る道' }];
  deepEqual(PINS.attachCuts(ix, 'r3', cuts), { map: { 'r3~5': 'r3~3' }, orphans: [], shadowed: ['r3~7'] });
});

test('attachCuts: leftovers are orphans; other lines and occurrences are ignored', () => {
  const pins = {
    'cut/r3~20:arrive': user('a', 'gone'),
    'cut/r3~1:arrive': user('b', 'ab'),
    'cut/r3.1~0:arrive': user('c', 'ab'),
    'line/r3:dwell': user('d'),
  };
  const ix = PINS.index(pins);
  const cuts = [{ key: 'r3~0', a: 0, b: 2, text: 'ab' }];
  deepEqual(PINS.attachCuts(ix, 'r3', cuts), { map: { 'r3~0': 'r3~1' }, orphans: ['r3~20'], shadowed: [] });
  deepEqual(PINS.attachCuts(ix, 'r3.1', [{ key: 'r3.1~0', a: 0, b: 2, text: 'ab' }]).map, { 'r3.1~0': 'r3.1~0' });
  deepEqual(PINS.attachCuts(ix, 'r4', cuts), { map: {}, orphans: [], shadowed: [] });
  deepEqual(PINS.attachCuts(ix, 'r3', []), { map: {}, orphans: ['r3~1', 'r3~20'], shadowed: [] });
});

test('pinsUnder: work, line (with its cuts) and cut scopes', () => {
  const pins = {
    'work:mood': user('m'),
    'line/r3:start': user(1),
    'cut/r3~0:arrive': user('a', 'x'),
    'cut/r3~4:depart': user('d', 'y'),
    'cut/r3.1~0:arrive': user('a', 'x'),
    'cut/gap/r3:ground': user('g', ''),
    'line/r30:start': user(2),
    'broken:path': user(0),
  };
  assert.deepEqual(PINS.pinsUnder(pins, 'work'), Object.keys(pins).filter((k) => k !== 'broken:path').sort());
  assert.deepEqual(PINS.pinsUnder(pins, 'line/r3'), ['cut/r3~0:arrive', 'cut/r3~4:depart', 'line/r3:start']);
  assert.deepEqual(PINS.pinsUnder(pins, 'cut/r3~4'), ['cut/r3~4:depart']);
  assert.deepEqual(PINS.pinsUnder(pins, 'line/r9'), []);
  assert.deepEqual(PINS.pinsUnder(undefined, 'work'), []);
});
