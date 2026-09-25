/* 文字PVメーカー v2 — original work. Tests for ui/keys: guards, modes, duplicates and the SPEC shortcuts (DESIGN §6.8, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const K = MV.use('ui/keys');
const STRINGS = MV.use('i18n/strings');

function ev(key, extra) {
  return Object.assign({ key, code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, isComposing: false,
    keyCode: 0, targetKind: 'other' }, extra || {});
}
const NORMAL = { mode: 'normal', singleKeys: true };
function cmd(e, ctx) { const r = K.resolveKey(e, ctx || NORMAL); return r && r.cmd; }

test('IME composition never fires a shortcut', () => {
  assert.equal(cmd(ev('r')), 'look.omakase');
  assert.equal(cmd(ev('r', { isComposing: true })), null);
  assert.equal(cmd(ev('Process', { keyCode: 229 })), null);
  assert.equal(cmd(ev(' ', { keyCode: 229 })), null);
  assert.equal(cmd(ev('Enter', { isComposing: true, targetKind: 'text' })), null);
});

test('typing guard: plain keys type inside text fields; Ctrl chords and Esc still act', () => {
  const text = { targetKind: 'text' };
  for (const key of ['r', 't', ' ', '1', 'ArrowLeft', 'Delete', 'Backspace', 'Enter', '[', 'l']) {
    assert.equal(cmd(ev(key, text)), null, key + ' types');
  }
  assert.equal(cmd(ev('z', { targetKind: 'text', ctrlKey: true })), 'edit.undo');
  assert.equal(cmd(ev('Z', { targetKind: 'text', ctrlKey: true, shiftKey: true })), 'edit.redo');
  assert.equal(cmd(ev('y', { targetKind: 'text', ctrlKey: true })), 'edit.redo');
  assert.equal(cmd(ev('Enter', { targetKind: 'text', ctrlKey: true, shiftKey: true })), 'look.omakase');
  assert.equal(cmd(ev('Enter', { targetKind: 'text', ctrlKey: true })), 'play.fromLine');
  assert.equal(cmd(ev('Escape', text)), 'sel.up');
  assert.equal(cmd(ev('ArrowUp', { targetKind: 'text', altKey: true })), 'lyrics.moveRows');
  assert.equal(cmd(ev('b', { targetKind: 'text', ctrlKey: true })), 'lyrics.emphasis');
  assert.equal(cmd(ev('c', { targetKind: 'text', ctrlKey: true })), null, 'Ctrl+C copies text in a field');
  assert.equal(cmd(ev('v', { targetKind: 'text', ctrlKey: true })), null, 'Ctrl+V pastes text in a field');
  assert.equal(cmd(ev('c', { ctrlKey: true })), 'look.copy', 'outside text fields Ctrl+C copies the look');
  assert.equal(cmd(ev('z', { metaKey: true })), 'edit.undo', 'Cmd works like Ctrl');
});

test('the single-key switch turns off character keys only', () => {
  const off = { mode: 'normal', singleKeys: false };
  for (const key of ['r', 'R', 't', 'l', 's', '1', '[', ']', ',', '.', '?', 'b', 'm', 'i', 'a']) {
    assert.equal(cmd(ev(key, key === 'R' ? { shiftKey: true } : null), off), null, key + ' is off');
  }
  assert.equal(cmd(ev(' '), off), 'play.toggle');
  assert.equal(cmd(ev('ArrowRight'), off), 'seek.step');
  assert.equal(cmd(ev('Escape'), off), 'sel.up');
  assert.equal(cmd(ev('z', { ctrlKey: true }), off), 'edit.undo');
  assert.equal(cmd(ev('Delete'), off), 'pin.clearField');
  assert.equal(cmd(ev(' '), { mode: 'tap', singleKeys: false }), 'tap.mark', 'tap mode keeps its keys');
  assert.equal(cmd(ev('e'), { mode: 'tap', singleKeys: false }), 'tap.end');
});

test('tap mode swallows every other shortcut', () => {
  const tap = { mode: 'tap', singleKeys: true };
  assert.equal(cmd(ev(' '), tap), 'tap.mark');
  assert.equal(cmd(ev('Enter'), tap), 'tap.mark');
  assert.equal(cmd(ev('e'), tap), 'tap.end');
  assert.equal(cmd(ev('Backspace'), tap), 'tap.back');
  assert.deepEqual(K.resolveKey(ev('ArrowLeft'), tap), { cmd: 'tap.seek', args: { seconds: -3 } });
  assert.deepEqual(K.resolveKey(ev('ArrowRight'), tap), { cmd: 'tap.seek', args: { seconds: 3 } });
  assert.equal(cmd(ev('p'), tap), 'tap.pause');
  assert.equal(cmd(ev('Escape'), tap), 'tap.finish');
  assert.equal(cmd(ev('t'), tap), 'tap.finish');
  for (const [key, extra] of [['r'], ['z', { ctrlKey: true }], ['s', { ctrlKey: true }], ['1'], ['Delete'], ['l'], ['ArrowUp'],
    ['k', { ctrlKey: true }]]) {
    assert.equal(cmd(ev(key, extra), tap), 'noop', key + ' is swallowed');
  }
  assert.equal(K.resolveKey(ev('F5'), tap), null, 'browser keys keep their meaning');
  assert.equal(cmd(ev(' ', { targetKind: 'text' }), tap), 'tap.mark', 'tap mode owns the keyboard even from a field');
});

test('palette and picker modes', () => {
  assert.equal(cmd(ev('ArrowDown'), { mode: 'palette' }), 'palette.move');
  assert.equal(cmd(ev('Escape'), { mode: 'palette' }), 'palette.close');
  assert.equal(cmd(ev('r'), { mode: 'palette' }), null, 'typing into the palette');
  assert.equal(cmd(ev('Enter'), { mode: 'picker' }), 'picker.pick');
  assert.equal(cmd(ev('Escape'), { mode: 'picker' }), 'picker.back');
  assert.equal(cmd(ev(' '), { mode: 'picker', singleKeys: true }), 'play.toggle', 'other keys fall through');
});

test('no duplicate binding within a context; contexts and shapes are valid', () => {
  const seen = new Set();
  for (const x of K.KEYMAP) {
    assert.ok(K.CONTEXTS.includes(x.ctx), x.key + ' ctx');
    assert.equal(typeof x.cmd, 'string');
    assert.equal(typeof x.single, 'boolean');
    const id = x.ctx + ' ' + x.key;
    assert.ok(!seen.has(id), 'duplicate: ' + id);
    seen.add(id);
    // Every key string is exactly what comboOf produces for it.
    const parts = x.key.split('+');
    const key = parts.pop();
    const e = ev(key, { ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') });
    assert.equal(K.comboOf(e), x.key, 'canonical form: ' + x.key);
    if (x.single) assert.ok(!parts.includes('Ctrl') && !parts.includes('Alt'), 'single keys have no Ctrl/Alt: ' + x.key);
  }
});

test('browser-reserved chords are never bound', () => {
  const reserved = ['Ctrl+N', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Tab', 'Ctrl+R', 'Ctrl+Shift+C', 'Ctrl+Shift+I', 'Ctrl+Shift+J',
    'Alt+ArrowLeft', 'Alt+ArrowRight'];
  for (const x of K.KEYMAP) assert.ok(!reserved.includes(x.key), x.key + ' is reserved');
});

test('every SPEC §2 and DESIGN §6.8 shortcut exists', () => {
  const want = [
    ['Space', 'play.toggle'], ['ArrowLeft', 'seek.step'], ['ArrowRight', 'seek.step'], ['Shift+ArrowLeft', 'seek.step'],
    ['Shift+ArrowRight', 'seek.step'], ['R', 'look.omakase'], ['T', 'tap.start'], ['Delete', 'pin.clearField'],
    ['Ctrl+Z', 'edit.undo'], ['Ctrl+Shift+Z', 'edit.redo'], ['[', 'look.prev'], [']', 'look.next'],
    ['Home', 'seek.edge'], ['End', 'seek.edge'], ['ArrowUp', 'sel.line'], ['ArrowDown', 'sel.line'], [',', 'sel.cut'],
    ['.', 'sel.cut'], ['Enter', 'sel.down'], ['Escape', 'sel.up'], ['Ctrl+Shift+Enter', 'look.omakase'],
    ['Shift+R', 'look.reroll'], ['L', 'lock.toggle'], ['S', 'time.pinStart'], ['Backspace', 'pin.clearField'],
    ['Shift+Delete', 'pin.clearSelection'], ['Ctrl+Y', 'edit.redo'], ['Ctrl+S', 'file.save'], ['Ctrl+Shift+S', 'file.saveAs'],
    ['Ctrl+O', 'file.open'], ['Ctrl+Enter', 'play.fromLine'], ['Ctrl+K', 'palette.open'], ['Ctrl+C', 'look.copy'],
    ['Ctrl+V', 'look.paste'], ['1', 'step.go'], ['4', 'step.go'], ['I', 'panel.details'], ['A', 'panel.ai'],
    ['Shift+T', 'timeline.toggle'], ['Shift+I', 'range.in'], ['Shift+O', 'range.out'], ['B', 'view.compare'],
    ['M', 'audio.mute'], ['F', 'stage.fullscreen'], ['F6', 'region.next'], ['Shift+F6', 'region.prev'], ['?', 'help.keys'],
    ['Ctrl+ArrowLeft', 'timeline.nudge'],
  ];
  for (const [key, command] of want) {
    const hit = K.KEYMAP.find((x) => x.ctx === 'global' && x.key === key);
    assert.ok(hit, 'missing ' + key);
    assert.equal(hit.cmd, command, key);
  }
  assert.deepEqual(K.resolveKey(ev('ArrowLeft', { shiftKey: true }), NORMAL), { cmd: 'seek.step', args: { seconds: -1 } });
  assert.deepEqual(K.resolveKey(ev('ArrowRight'), NORMAL), { cmd: 'seek.step', args: { frames: 1 } });
  assert.deepEqual(K.resolveKey(ev('3'), NORMAL), { cmd: 'step.go', args: { step: 'look' } });
  assert.equal(cmd(ev('R', { shiftKey: true })), 'look.reroll', 'Shift+R rerolls');
  assert.equal(cmd(ev('R')), 'look.omakase', 'Caps Lock R is still おまかせ');
  assert.equal(cmd(ev('?', { shiftKey: true })), 'help.keys', 'Shift is implied by ?');
});

test('every command in the keymap has a label for tooltips, the palette and the ? sheet', () => {
  const cmds = new Set(K.KEYMAP.map((x) => x.cmd).filter((c) => c !== 'noop'));
  for (const c of cmds) assert.ok(('cmd.' + c) in STRINGS, 'missing string cmd.' + c);
});

test('keysFor and display', () => {
  assert.deepEqual(K.keysFor('edit.redo'), ['Ctrl+Shift+Z', 'Ctrl+Y']);
  assert.deepEqual(K.keysFor('tap.mark', 'tap'), ['Space', 'Enter']);
  assert.equal(K.display('Shift+ArrowLeft'), 'Shift+←');
  assert.equal(K.display('Space', { space: 'スペース' }), 'スペース');
});
