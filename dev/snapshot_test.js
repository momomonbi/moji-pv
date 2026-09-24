/* Snapshot test: parseLyrics / computeTiming / plan / omakase with fixed seeds.
   usage: node dev/snapshot_test.js            -> compare with dev/snapshots/*.json (exit 1 on any difference)
          node dev/snapshot_test.js --update   -> rewrite the snapshots (only after checking the change is intended) */
'use strict';
const fs = require('fs'), path = require('path');
const J = require('./engine_node')();
const DIR = path.join(__dirname, 'snapshots');
const UPDATE = process.argv.includes('--update');

// JIZURA's original sample, pinned so that changing the app's default lyrics does not move the snapshots
const PINNED_SAMPLE = `夜明けの色を/覚えてる
ほどけた声が遠くで鳴った
ねえ、まだ間に合うかな
*透明*なままじゃ終われない!`;
const LYRICS = {
  sample: PINNED_SAMPLE,
  syntax: `# comment line
[ti:テストの歌]
[ar:だれか]
夜明けの色を/覚えてる|よあけ
*透明*なままじゃ終われない!

ほどけた声が遠くで鳴った
Hello/world
ねえ、まだ間に合うかな`,
  lrc: `[00:12.50]夜明けの色を覚えてる
[00:15.20]ほどけた声が遠くで鳴った
[00:19.00][00:40.00]ねえ、まだ間に合うかな
[00:23.75]*透明*なままじゃ終われない!`,
  lrcPartial: `[00:12.50]夜明けの色を覚えてる
ほどけた声が遠くで鳴った
[00:19.00]ねえ、まだ間に合うかな`,
  long: Array.from({ length: 24 }, (_, i) => ['君の名前を呼んだ', '白い息が消えていく', 'ずっとこのままでいたい', 'まだ終わらない夏の日', 'Don\'t let me go', '*光*の中で!'][i % 6]).join('\n'),
  zh: '我們的夏天\n說好了不見不散',
  ko: '우리의 여름\n너를 기다릴게',
};

const R = 1e6;
const num = x => (typeof x === 'number' && isFinite(x) ? Math.round(x * R) / R : x);
const round = v => Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, round(v[k])])) : num(v);
const fnv = s => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const digest = v => fnv(JSON.stringify(round(v)));

function planSummary(plan) {
  return {
    W: plan.W, H: plan.H, duration: num(plan.duration), styleKey: plan.styleKey, lang: plan.lang, hud: plan.hud,
    lines: plan.lines.map(l => ({ index: l.index, text: l.text, start: num(l.start), end: num(l.end), visEnd: num(l.visEnd), chunks: l.chunks, emph: l.emph, impact: l.impact, note: l.note, seed: l.seed })),
    cuts: plan.cuts.map(c => ({ i: c.index, line: c.line, text: c.text, start: num(c.start), end: num(c.end), layout: c.layout, enter: c.enter, hold: c.hold, exit: c.exit,
      inDur: num(c.inDur), outDur: num(c.outDur), decor: c.decor.map(d => d.id), treat: c.treat, bg: c.bg, cam: c.cam, trans: c.trans, scheme: c.scheme, emph: c.emph, recap: !!c.recap,
      seed: c.seed, params: digest(c.params), extras: digest([c.decor, c.treatP, c.bgP, c.camP, c.transP, c.transDur, c.stagger]) })),
    events: plan.events.map(e => [e.type, num(e.t), num(e.amp), num(e.dur)]),
  };
}

const beats = (bpm, dur, off = 0.2) => Array.from({ length: Math.floor((dur - off) * bpm / 60) }, (_, i) => off + i * 60 / bpm);
const AUDIO = { beats: beats(128, 40), duration: 40, energy: Array.from({ length: 400 }, (_, i) => 0.5 + 0.5 * Math.sin(i / 7)), energyRate: 10 };

function project(over) {
  const p = Object.assign(J.defaultProject(), { lyrics: PINNED_SAMPLE }, over);
  if (over.timing) p.timing = Object.assign(J.defaultProject().timing, over.timing);
  if (over.fx) p.fx = Object.assign(J.defaultProject().fx, over.fx);
  return p;
}

function build() {
  const out = { parse: {}, timing: {}, plan: {}, omakase: {} };
  for (const [k, text] of Object.entries(LYRICS)) {
    out.parse[k] = round(J.parseLyrics(text));
  }
  const timingCases = {
    sample: project({}),
    bpm120: project({ timing: { bpm: 120, offset: 1 } }),
    manual: project({ timing: { lineTimes: { 1: 5, 3: 9.5 } } }),
    lineScale: project({ timing: { lineScale: 1.6, tail: 2 } }),
    lrc: project({ lyrics: LYRICS.lrc }),
    lrcPartial: project({ lyrics: LYRICS.lrcPartial }),
    syntaxAudio: project({ lyrics: LYRICS.syntax }),
  };
  for (const [k, p] of Object.entries(timingCases)) out.timing[k] = round(J.computeTiming(p, J.parseLyrics(p.lyrics), k === 'syntaxAudio' ? AUDIO : null));

  const planCases = [];
  for (const seed of [1, 42, 20260922]) for (const aspect of ['16:9', '9:16']) planCases.push([`sample_s${seed}_${aspect.replace(':', 'x')}`, { seed, aspect }]);
  planCases.push(['extra_on', { seed: 7, extra: true }]);
  planCases.push(['wa_off_extra_on', { seed: 7, extra: true, wa: false }]);
  planCases.push(['syntax_title', { seed: 3, lyrics: LYRICS.syntax }]);
  planCases.push(['lrc', { seed: 3, lyrics: LYRICS.lrc }]);
  planCases.push(['long_beats', { seed: 11, lyrics: LYRICS.long, timing: { snap: true } }, AUDIO]);
  planCases.push(['long_bpm', { seed: 11, lyrics: LYRICS.long, timing: { bpm: 96 } }]);
  planCases.push(['overrides', { seed: 5, overrides: { 0: { layout: 'vcols', enter: 'type' }, 1: { seed: 3 }, 2: { lock: true, lockedSeed: 12345 }, 3: { single: true, decor: ['sparks'] } } }]);
  planCases.push(['fx_extremes', { seed: 9, fx: { motion: 1, glitch: 1, chroma: 1, decor: 1, density: 1, texture: 1, bgSwitch: 1 } }]);
  planCases.push(['fx_calm', { seed: 9, fx: { motion: 0, glitch: 0, chroma: 0, decor: 0, density: 0, texture: 0, bgSwitch: 0, flash: false } }]);
  planCases.push(['zh', { seed: 2, lyrics: LYRICS.zh }]);
  planCases.push(['ko', { seed: 2, lyrics: LYRICS.ko }]);
  for (const st of ['paper', 'sakura', 'hud']) planCases.push([`style_${st}`, { seed: 4, style: st, extra: true }]);
  for (const [name, over, audio] of planCases) out.plan[name] = planSummary(J.plan(project(over), audio || null));

  for (const seed of [1, 2, 3]) {
    const p = project({ seed: 100 + seed, extra: seed === 3 });
    const r = J.omakase(p, J.rng(seed));
    const merged = Object.assign(p, r);
    out.omakase['rnd' + seed] = { result: round({ style: r.style, mood: r.mood, seed: r.seed, fx: r.fx, fonts: r.fonts, colors: r.colors, enabledOff: Object.fromEntries(Object.entries(r.enabled || {}).map(([g, m]) => [g, Object.keys(m).filter(k => m[k] === false).sort()])) }), plan: planSummary(J.plan(merged, null)) };
  }
  return out;
}

const out = build();
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
let bad = 0;
for (const [name, data] of Object.entries(out)) {
  const file = path.join(DIR, name + '.json');
  const text = JSON.stringify(data, null, 1) + '\n';
  if (UPDATE) { fs.writeFileSync(file, text); console.log('updated', path.relative(process.cwd(), file), text.length, 'bytes'); continue; }
  if (!fs.existsSync(file)) { console.log('MISSING', file, '(run with --update)'); bad++; continue; }
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of new Set([...Object.keys(want), ...Object.keys(data)])) {
    const a = JSON.stringify(want[key]), b = JSON.stringify(data[key]);
    if (a !== b) { bad++; console.log(`DIFF ${name}.${key}`); console.log('  ' + firstDiff(want[key], JSON.parse(JSON.stringify(data[key] ?? null)))); }
  }
}
if (!UPDATE) {
  if (bad) { console.log(`${bad} snapshot(s) differ. If the change is intended: node dev/snapshot_test.js --update`); process.exit(1); }
  console.log('snapshots OK:', Object.entries(out).map(([k, v]) => `${k} ${Object.keys(v).length}`).join(', '));
}

function firstDiff(a, b, where = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return firstDiff(a[k], b[k], where + '.' + k);
    }
  }
  return `${where || '(root)'}: expected ${JSON.stringify(a)?.slice(0, 160)} got ${JSON.stringify(b)?.slice(0, 160)}`;
}
