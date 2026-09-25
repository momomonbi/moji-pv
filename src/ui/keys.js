/* 文字PVメーカー v2 — original work. The keymap and key resolution: IME guard, text-field guard, modes (DESIGN §6.8). */
MV.def('ui/keys', [], () => {
  'use strict';

  // ctx: 'global' = focus outside text fields; 'text' = inside a text field (editor-safe chords only, so typing is never
  // hijacked); 'tap' / 'picker' / 'palette' = while that mode owns the keyboard. single = a character key (letters,
  // digits, punctuation) that the 1文字キーを使う setting can switch off (WCAG 2.1.4). Keys match on event.key.
  function b(key, ctx, cmd, args, single) {
    return Object.freeze({ key, ctx, cmd, args: args ? Object.freeze(args) : null, single: !!single });
  }

  const GLOBAL = [
    b('Space', 'global', 'play.toggle'),
    b('ArrowLeft', 'global', 'seek.step', { frames: -1 }),
    b('ArrowRight', 'global', 'seek.step', { frames: 1 }),
    b('Shift+ArrowLeft', 'global', 'seek.step', { seconds: -1 }),
    b('Shift+ArrowRight', 'global', 'seek.step', { seconds: 1 }),
    b('Home', 'global', 'seek.edge', { to: 'start' }),
    b('End', 'global', 'seek.edge', { to: 'end' }),
    b('ArrowUp', 'global', 'sel.line', { d: -1 }),
    b('ArrowDown', 'global', 'sel.line', { d: 1 }),
    b(',', 'global', 'sel.cut', { d: -1 }, true),
    b('.', 'global', 'sel.cut', { d: 1 }, true),
    b('Enter', 'global', 'sel.down'),
    b('Escape', 'global', 'sel.up'),
    b('R', 'global', 'look.omakase', null, true),
    b('Ctrl+Shift+Enter', 'global', 'look.omakase'),
    b('Shift+R', 'global', 'look.reroll', null, true),
    b('[', 'global', 'look.prev', null, true),
    b(']', 'global', 'look.next', null, true),
    b('L', 'global', 'lock.toggle', null, true),
    b('T', 'global', 'tap.start', null, true),
    b('S', 'global', 'time.pinStart', null, true),
    b('Delete', 'global', 'pin.clearField'),
    b('Backspace', 'global', 'pin.clearField'),
    b('Shift+Delete', 'global', 'pin.clearSelection'),
    b('Ctrl+Z', 'global', 'edit.undo'),
    b('Ctrl+Shift+Z', 'global', 'edit.redo'),
    b('Ctrl+Y', 'global', 'edit.redo'),
    b('Ctrl+S', 'global', 'file.save'),
    b('Ctrl+Shift+S', 'global', 'file.saveAs'),
    b('Ctrl+O', 'global', 'file.open'),
    b('Ctrl+Enter', 'global', 'play.fromLine'),
    b('Ctrl+K', 'global', 'palette.open'),
    b('Ctrl+C', 'global', 'look.copy'),
    b('Ctrl+V', 'global', 'look.paste'),
    b('1', 'global', 'step.go', { step: 'lyrics' }, true),
    b('2', 'global', 'step.go', { step: 'song' }, true),
    b('3', 'global', 'step.go', { step: 'look' }, true),
    b('4', 'global', 'step.go', { step: 'export' }, true),
    b('I', 'global', 'panel.details', null, true),
    b('A', 'global', 'panel.ai', null, true),
    b('Shift+T', 'global', 'timeline.toggle', null, true),
    b('Shift+I', 'global', 'range.in', null, true),
    b('Shift+O', 'global', 'range.out', null, true),
    b('B', 'global', 'view.compare', null, true),
    b('M', 'global', 'audio.mute', null, true),
    b('F', 'global', 'stage.fullscreen', null, true),
    b('F6', 'global', 'region.next'),
    b('Shift+F6', 'global', 'region.prev'),
    b('?', 'global', 'help.keys', null, true),
    b('Ctrl+ArrowLeft', 'global', 'timeline.nudge', { frames: -1 }),
    b('Ctrl+ArrowRight', 'global', 'timeline.nudge', { frames: 1 }),
    b('Ctrl+Shift+ArrowLeft', 'global', 'timeline.nudge', { frames: -10 }),
    b('Ctrl+Shift+ArrowRight', 'global', 'timeline.nudge', { frames: 10 }),
  ];

  // Inside text fields only Ctrl chords, Esc, F6 and the lyric editor's own chords act; plain keys type.
  const TEXT = [
    b('Ctrl+Z', 'text', 'edit.undo'),
    b('Ctrl+Shift+Z', 'text', 'edit.redo'),
    b('Ctrl+Y', 'text', 'edit.redo'),
    b('Ctrl+S', 'text', 'file.save'),
    b('Ctrl+Shift+S', 'text', 'file.saveAs'),
    b('Ctrl+O', 'text', 'file.open'),
    b('Ctrl+K', 'text', 'palette.open'),
    b('Ctrl+Enter', 'text', 'play.fromLine'),
    b('Ctrl+Shift+Enter', 'text', 'look.omakase'),
    b('Escape', 'text', 'sel.up'),
    b('F6', 'text', 'region.next'),
    b('Shift+F6', 'text', 'region.prev'),
    b('Alt+ArrowUp', 'text', 'lyrics.moveRows', { d: -1 }),
    b('Alt+ArrowDown', 'text', 'lyrics.moveRows', { d: 1 }),
    b('Ctrl+B', 'text', 'lyrics.emphasis'),
  ];

  const TAP = [
    b('Space', 'tap', 'tap.mark'),
    b('Enter', 'tap', 'tap.mark'),
    b('E', 'tap', 'tap.end'),
    b('Backspace', 'tap', 'tap.back'),
    b('ArrowLeft', 'tap', 'tap.seek', { seconds: -3 }),
    b('ArrowRight', 'tap', 'tap.seek', { seconds: 3 }),
    b('P', 'tap', 'tap.pause'),
    b('Escape', 'tap', 'tap.finish'),
    b('T', 'tap', 'tap.finish'),
  ];

  const PICKER = [
    b('ArrowLeft', 'picker', 'picker.move', { dx: -1, dy: 0 }),
    b('ArrowRight', 'picker', 'picker.move', { dx: 1, dy: 0 }),
    b('ArrowUp', 'picker', 'picker.move', { dx: 0, dy: -1 }),
    b('ArrowDown', 'picker', 'picker.move', { dx: 0, dy: 1 }),
    b('Enter', 'picker', 'picker.pick'),
    b('Escape', 'picker', 'picker.back'),
  ];

  const PALETTE = [
    b('ArrowUp', 'palette', 'palette.move', { d: -1 }),
    b('ArrowDown', 'palette', 'palette.move', { d: 1 }),
    b('Enter', 'palette', 'palette.run'),
    b('Escape', 'palette', 'palette.close'),
    b('Ctrl+K', 'palette', 'palette.close'),
  ];

  const KEYMAP = Object.freeze([].concat(GLOBAL, TEXT, TAP, PICKER, PALETTE));
  const CONTEXTS = Object.freeze(['global', 'text', 'tap', 'picker', 'palette']);

  const TABLES = new Map(CONTEXTS.map((ctx) => [ctx, new Map(KEYMAP.filter((x) => x.ctx === ctx).map((x) => [x.key, x]))]));

  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Hyper', 'Super',
    'Dead', 'Process', 'Unidentified', 'Compose']);
  const ALIASES = { ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Del: 'Delete', Left: 'ArrowLeft', Right: 'ArrowRight',
    Up: 'ArrowUp', Down: 'ArrowDown' };

  // A key event → 'Ctrl+Alt+Shift+Key'. Letters are upper-cased with an explicit Shift; for digits and punctuation
  // Shift is implied by the character itself ('?' is Shift+/ on US, a different key on JIS), so it is dropped.
  function comboOf(ev) {
    const raw = ev && ev.key;
    if (typeof raw !== 'string' || raw === '' || MODIFIER_KEYS.has(raw)) return null;
    let key = ALIASES[raw] || raw;
    const oneChar = [...key].length === 1;
    const letter = oneChar && /^[a-z]$/i.test(key);
    if (letter) key = key.toUpperCase();
    const parts = [];
    if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl');
    if (ev.altKey) parts.push('Alt');
    if (ev.shiftKey && (!oneChar || letter)) parts.push('Shift');
    parts.push(key);
    return parts.join('+');
  }

  function answer(binding) { return { cmd: binding.cmd, args: binding.args ? Object.assign({}, binding.args) : null }; }

  // resolveKey(ev, { mode, singleKeys }) → { cmd, args } | null.
  //   ev.targetKind: 'text' when focus is in a text field/select/contenteditable. mode: 'normal' | 'tap' | 'picker' |
  //   'palette'. Never fires during IME composition. In tap mode every key that would be an app shortcut is swallowed
  //   ({ cmd: 'noop' }), so no other shortcut fires; unrelated keys (F5 …) return null and keep their browser meaning.
  function resolveKey(ev, ctx) {
    if (!ev || ev.isComposing || ev.keyCode === 229) return null;
    const combo = comboOf(ev);
    if (!combo) return null;
    const c = ctx || {};
    const mode = c.mode || 'normal';
    if (mode === 'tap') {
      const hit = TABLES.get('tap').get(combo);
      if (hit) return answer(hit);
      return TABLES.get('global').has(combo) || TABLES.get('text').has(combo) ? { cmd: 'noop', args: null } : null;
    }
    if (mode === 'palette') {
      const hit = TABLES.get('palette').get(combo);
      return hit ? answer(hit) : null;
    }
    if (mode === 'picker') {
      const hit = TABLES.get('picker').get(combo);
      if (hit) return answer(hit);
    }
    const table = TABLES.get(ev.targetKind === 'text' ? 'text' : 'global');
    const hit = table.get(combo);
    if (!hit) return null;
    if (hit.single && c.singleKeys === false) return null;
    return answer(hit);
  }

  // Bindings of a command (for tooltips, the palette and the ? sheet).
  function keysFor(cmd, ctx) {
    const want = ctx || 'global';
    return KEYMAP.filter((x) => x.cmd === cmd && x.ctx === want).map((x) => x.key);
  }

  // A binding shown to people: 'Ctrl+Shift+Z' → 'Ctrl+Shift+Z'; arrows as glyphs; Space → the given word.
  function display(key, words) {
    const w = words || {};
    const GLYPH = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Delete: 'Del',
      Backspace: 'BS', Space: w.space || 'Space', Enter: w.enter || 'Enter' };
    return key.split('+').map((part) => GLYPH[part] || part).join('+');
  }

  return { KEYMAP, CONTEXTS, resolveKey, comboOf, keysFor, display };
});
