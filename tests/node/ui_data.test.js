/* 文字PVメーカー v2 — original work. Tests for the final fixes (ui-data): lyric file encodings, song pruning, damaged look history, step ③ status, palette order, the ? sheet rows. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const IO = MV.use('ui/project_io');
const LK = MV.use('ui/looks');
const STEPS = MV.use('ui/steps');
const PAL = MV.use('ui/palette');
const DLG = MV.use('ui/dialogs');
const K = MV.use('ui/keys');
const D = MV.use('core/doc');

// 「[ti:夜明けのうた]\n[00:01.00]夜明けの街を走る」 in Shift_JIS, and 「夜明けの街」 in EUC-JP (bytes from Python's codecs).
const SJIS = [91, 116, 105, 58, 150, 233, 150, 190, 130, 175, 130, 204, 130, 164, 130, 189, 93, 10, 91, 48, 48, 58, 48, 49,
  46, 48, 48, 93, 150, 233, 150, 190, 130, 175, 130, 204, 138, 88, 130, 240, 145, 150, 130, 233];
const EUC = [204, 235, 204, 192, 164, 177, 164, 206, 179, 185];

test('decodeText: BOMs, strict UTF-8, Shift_JIS and EUC-JP fallbacks (flows-7)', () => {
  const text = '夜明けの街を走る\n2行目';
  const utf8 = new TextEncoder().encode(text);
  assert.deepEqual(IO.decodeText(utf8), { text, encoding: 'utf-8', sure: true });
  assert.deepEqual(IO.decodeText(new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8])), { text, encoding: 'utf-8', sure: true }, 'the BOM is dropped');
  const le = [0xFF, 0xFE];
  const be = [0xFE, 0xFF];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    le.push(c & 0xFF, c >> 8);
    be.push(c >> 8, c & 0xFF);
  }
  assert.deepEqual(IO.decodeText(new Uint8Array(le)), { text, encoding: 'utf-16le', sure: true });
  assert.deepEqual(IO.decodeText(new Uint8Array(be)), { text, encoding: 'utf-16be', sure: true });
  assert.deepEqual(IO.decodeText(new Uint8Array(SJIS)), { text: '[ti:夜明けのうた]\n[00:01.00]夜明けの街を走る', encoding: 'shift_jis', sure: true });
  assert.deepEqual(IO.decodeText(new Uint8Array(EUC)), { text: '夜明けの街', encoding: 'euc-jp', sure: true });
  assert.deepEqual(IO.decodeText(new Uint8Array(SJIS).buffer).encoding, 'shift_jis', 'an ArrayBuffer (File.arrayBuffer()) works too');
  const junk = IO.decodeText(new Uint8Array([0x41, 0xFF, 0x42]));
  assert.equal(junk.sure, false, 'bytes that decode nowhere are flagged');
  assert.ok(junk.text.includes('�'));
});

test('songsInUse: the sha1s of kept works and of the extras; bad records keep nothing (security-3)', () => {
  const rec = (sha1) => D.serialize({ doc: Object.assign(D.defaultDoc(), sha1 ? { song: { name: 'a.wav', sha1, seconds: 3 } } : {}), side: D.defaultSide() });
  const keep = IO.songsInUse([rec('a'.repeat(40)), rec(null), '{not json', rec('b'.repeat(40))], ['c'.repeat(40), null, '', undefined]);
  assert.deepEqual([...keep].sort(), ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]);
  assert.deepEqual([...IO.songsInUse([], [])], []);
});

test('looks: a damaged history reads as its usable entries and can still be recorded into (flows-1)', () => {
  const doc = Object.assign(D.defaultDoc(), { salts: {} });
  const entry = { n: 1, seed: 1, moodSeed: 1, salts: {}, scope: 'work', label: ['look.first', {}], star: false };
  const damaged = [
    { looks: null, aiLog: [] },
    { looks: 'abc', aiLog: [] },
    { looks: { list: 'abc', cap: 50 }, aiLog: [] },
    { looks: { list: [null, entry, 7, 'x'], cap: 50 }, aiLog: [] },
  ];
  for (const side of damaged) {
    assert.doesNotThrow(() => LK.pointer(side, doc));
    const next = Object.assign({}, doc, { look: Object.assign({}, doc.look, { seed: 99 }) });
    const out = LK.record(side, next, { kind: 'append', label: ['look.omakase', {}] });
    const list = out.looks.list;
    assert.ok(Array.isArray(list) && list.every((e) => e && typeof e === 'object'), JSON.stringify(side.looks));
    assert.equal(list[list.length - 1].seed, 99);
  }
  const kept = LK.record(damaged[3], Object.assign({}, doc, { look: Object.assign({}, doc.look, { seed: 99 }) }), { kind: 'append' });
  assert.deepEqual(kept.looks.list.map((e) => e.n), [1, 2], 'the usable entry stays, the new one gets the next n');
});

test('steps: ③ is done after a look pin or a tried look, not after a tempo or timing pin (ux-11)', () => {
  const app = (pins, list) => ({ plan: null, exporting: null, doc: Object.assign(D.defaultDoc(), { pins }),
    store: { side: { looks: { list, cap: 50 }, aiLog: [] } } });
  const pin = (v) => ({ v, by: 'user' });
  const first = [{ n: 1, seed: 1, moodSeed: 1, salts: {}, scope: 'work', label: ['look.first', {}], star: false }];
  for (const p of ['work:bpm', 'work:beatOffset', 'work:readRate', 'work:length', 'work:titleCard', 'line/r1:start']) {
    assert.equal(STEPS.statusOf(app({ [p]: pin(120) }, first), 'look'), 'todo', p);
  }
  for (const p of ['work:mood', 'work:theme', 'work:color.ink', 'work:face.display.ja', 'work:amount.motion', 'work:arrive',
    'work:ornament#0', 'work:filter.count', 'work:el.text.fill', 'work:text.scale', 'work:season']) {
    assert.equal(STEPS.statusOf(app({ [p]: pin('x') }, first), 'look'), 'done', p);
  }
  const tried = first.concat([{ n: 2, seed: 5, moodSeed: 5, salts: {}, scope: 'work', label: ['look.omakase', {}], star: false }]);
  assert.equal(STEPS.statusOf(app({}, tried), 'look'), 'done');
  assert.equal(STEPS.statusOf(app({}, 'abc'), 'look'), 'todo', 'a damaged list does not throw');
  assert.equal(STEPS.statusOf(app({}, [null, 3]), 'look'), 'todo');
});

test('palette: an empty query starts with the starters, settings and the language are always last (ux-2)', () => {
  const items = ['pref.singleKeys', 'pref.autoplay', 'app.lang', 'file.new', 'look.omakase', 'play.toggle', 'help.keys',
    'step.go:lyrics', 'edit.undo', 'panel.details'].map((id, i) => ({ id, text: String.fromCharCode(0x3041 + (i * 7) % 20) + id }));
  // The Japanese labels sort 「1文字キーを使う」 first by code point; the order must not depend on that.
  items[0].text = '1文字キーを使う';
  const empty = PAL.order(items, [], '').map((x) => x.id);
  assert.deepEqual(empty.slice(0, 5), ['look.omakase', 'play.toggle', 'panel.details', 'step.go:lyrics', 'help.keys']);
  assert.deepEqual(empty.slice(-3).sort(), ['app.lang', 'pref.autoplay', 'pref.singleKeys']);
  const recent = PAL.order(items, ['edit.undo', 'pref.singleKeys'], '').map((x) => x.id);
  assert.equal(recent[0], 'edit.undo', 'recent first');
  assert.ok(recent.indexOf('pref.singleKeys') >= recent.length - 3, 'a recent setting is still last');
  const typed = PAL.order(items, [], 'o').map((x) => x.id);
  assert.ok(['app.lang', 'pref.autoplay', 'pref.singleKeys'].every((id) => typed.indexOf(id) >= typed.length - 3), 'with a query too');
  for (const id of PAL.STARTERS) assert.ok(!id.startsWith('pref.'), id);
});

test('the ? sheet: one row per command with all its keys, in every context (ux-13)', () => {
  for (const ctx of ['global', 'text', 'tap']) {
    const rows = DLG.keyRows(ctx, () => true);
    const cmds = rows.map((r) => r.cmd);
    assert.equal(new Set(cmds).size, cmds.length, ctx + ': no command twice');
    for (const r of rows) {
      const bound = K.KEYMAP.filter((b) => b.ctx === ctx && b.cmd === r.cmd).map((b) => b.key);
      assert.deepEqual(r.keys, [...new Set(bound)], ctx + ' ' + r.cmd);
    }
  }
  const seek = DLG.keyRows('tap', () => true).find((r) => r.cmd === 'tap.seek');
  assert.equal(seek.keys.length, 2, '3秒移動 lists ← and → in one row');
  assert.ok(!DLG.keyRows('global', (cmd) => cmd !== 'play.toggle').some((r) => r.cmd === 'play.toggle'), 'unnamed commands are left out');
});
