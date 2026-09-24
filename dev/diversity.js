/* Measure how varied the generated arrangements are, to keep a baseline before the planner or the AI changes them.
   usage: node dev/diversity.js [--seeds 40] [--out docs/diversity_baseline.json] [--compare docs/diversity_baseline.json]
   Numbers per plan (title cards and interludes excluded), averaged over seeds:
     distinct.<group>   how many different parts of that group one song uses
     entropy.layout     spread of layouts in one song (0 = one layout, 1 = every cut different)
     repeat.<group>     share of neighbouring cuts that reuse the same layout / entrance / exit
     coverage.<group>   share of the parts random picks may use that appear in at least one of the seeds
     offSeason          share of plans that show a motif of another season (e.g. snow in a summer song) */
'use strict';
const fs = require('fs'), path = require('path');
const J = require('./engine_node')();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = +arg('seeds', 40);
const OUT = arg('out', null), COMPARE = arg('compare', null);

// original test lyrics (written for this measurement)
const SONGS = {
  summer: `夏の匂いがした
入道雲を追いかけて
自転車で坂を下る
蝉の声が遠くなる
花火の夜に約束した
君の浴衣が揺れていた
*夏休み*が終わらないように!
海辺で笑った日のこと
日焼けした腕を並べて
風鈴が鳴る縁側で
かき氷が溶けていく
また来年も会えるかな`,
  winter: `白い息が消えていく
雪が降る街を歩いた
マフラーに顔をうずめて
君の手が冷たかった
凍えた窓に指で書く
*さよなら*の文字がにじむ
イルミネーションの下で
まだ言えないままでいた
こたつの中で眠る猫
春はまだ遠いみたいだ`,
  neutral: `夜明けの色を覚えてる
ほどけた声が遠くで鳴った
ねえ、まだ間に合うかな
*透明*なままじゃ終われない!
ノートの端に書いた言葉
誰にも見せないまま
信号が青に変わる
走り出したら止まれない
Don't look back
ひとりじゃないって知ってた`,
};
const SEASON_OF_SONG = { summer: 'summer', winter: 'winter', neutral: null };

const GROUPS = ['layout', 'enter', 'hold', 'exit', 'decor', 'treat', 'bg', 'cam', 'trans'];
const ent = arr => { const m = new Map(); arr.forEach(x => m.set(x, (m.get(x) || 0) + 1)); let h = 0; for (const c of m.values()) { const p = c / arr.length; h -= p * Math.log2(p); } return arr.length > 1 ? h / Math.log2(arr.length) : 0; };
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
const r3 = x => Math.round(x * 1000) / 1000;

function cutParts(c, g) {
  if (g === 'decor') return c.decor.map(d => d.id);
  if (g === 'trans') return c.trans ? [c.trans] : [];
  if (g === 'bg') return c.bg && c.bg !== 'none' ? [c.bg] : [];
  if (g === 'treat') return c.treat && c.treat !== 'none' ? [c.treat] : [];
  return [c[g]];
}

function measure(name, makeProject, season) {
  const per = { cuts: [], entropy: [], offSeason: [] };
  GROUPS.forEach(g => { per['distinct.' + g] = []; });
  ['layout', 'enter', 'exit'].forEach(g => { per['repeat.' + g] = []; });
  const used = Object.fromEntries(GROUPS.map(g => [g, new Set()]));
  const styles = [], moods = [];
  let eligible = null;
  for (let s = 1; s <= SEEDS; s++) {
    const p = makeProject(s);
    const plan = J.plan(p, null);
    const cuts = plan.cuts.filter(c => c.line >= 0 && c.layout !== 'interlude' && c.layout !== 'title');
    per.cuts.push(cuts.length);
    per.entropy.push(ent(cuts.map(c => c.layout)));
    for (const g of GROUPS) {
      const parts = cuts.flatMap(c => cutParts(c, g));
      per['distinct.' + g].push(new Set(parts).size);
      parts.forEach(x => used[g].add(x));
    }
    for (const g of ['layout', 'enter', 'exit']) {
      let rep = 0; for (let i = 1; i < cuts.length; i++) if (cuts[i][g] === cuts[i - 1][g]) rep++;
      per['repeat.' + g].push(cuts.length > 1 ? rep / (cuts.length - 1) : 0);
    }
    if (season && J.offSeasonMotifs) per.offSeason.push(J.offSeasonMotifs(plan, season).length ? 1 : 0);
    styles.push(p.style); moods.push(p.mood || '-');
    if (!eligible) eligible = Object.fromEntries(GROUPS.map(g => [g, J.order(g).filter(k => !(J.registry(g)[k] || {}).special && (p.enabled[g] || {})[k] !== false && J.randomOk(p, g, k) && !['none', 'push'].includes(k))]));
  }
  const res = { seeds: SEEDS };
  for (const [k, a] of Object.entries(per)) if (a.length) res[k] = { mean: r3(mean(a)), p10: r3(pct(a, 0.1)), p90: r3(pct(a, 0.9)) };
  res.coverage = Object.fromEntries(GROUPS.map(g => [g, r3([...used[g]].filter(k => eligible[g].includes(k)).length / Math.max(1, eligible[g].length))]));
  res.eligible = Object.fromEntries(GROUPS.map(g => [g, eligible[g].length]));
  if (new Set(styles).size > 1) res.styles = { distinct: new Set(styles).size, entropy: r3(ent(styles)) };
  if (new Set(moods).size > 1) res.moods = { distinct: new Set(moods).size, entropy: r3(ent(moods)) };
  return res;
}

const base = (lyrics, over = {}) => s => Object.assign(J.defaultProject(), { lyrics, seed: 1000 + s * 7919 }, over);
const omakase = (lyrics, over = {}) => s => { const p = Object.assign(J.defaultProject(), { lyrics }, over); return Object.assign(p, J.omakase(p, J.rng(s * 104729))); };
const result = { generatedBy: 'node dev/diversity.js', seeds: SEEDS, configs: {} };
for (const [song, lyrics] of Object.entries(SONGS)) {
  const season = SEASON_OF_SONG[song];
  result.configs[`${song}.default`] = measure(`${song}.default`, base(lyrics), season);
  result.configs[`${song}.extra`] = measure(`${song}.extra`, base(lyrics, { extra: true }), season);
  result.configs[`${song}.omakase`] = measure(`${song}.omakase`, omakase(lyrics), season);
  result.configs[`${song}.omakase_extra`] = measure(`${song}.omakase_extra`, omakase(lyrics, { extra: true }), season);
  // with the song's season set (what the AI proposals do): off-season motifs should disappear
  if (season) result.configs[`${song}.omakase_extra_season`] = measure(`${song}.omakase_extra_season`, omakase(lyrics, { extra: true, season }), season);
}

// summary table
const rows = Object.entries(result.configs).map(([k, r]) => [k, r.cuts.mean, r['distinct.layout'].mean, r['distinct.enter'].mean, r['distinct.exit'].mean, r.entropy.mean, r['repeat.layout'].mean, r.coverage.layout, r.coverage.decor, r.offSeason ? r.offSeason.mean : '-']);
console.log(['config', 'cuts', 'layouts', 'enters', 'exits', 'entropy', 'repeatL', 'covLayout', 'covDecor', 'offSeason'].join('\t'));
rows.forEach(r => console.log(r.join('\t')));
if (OUT) { fs.writeFileSync(path.resolve(OUT), JSON.stringify(result, null, 1) + '\n'); console.log('wrote', OUT); }
if (COMPARE) {
  const old = JSON.parse(fs.readFileSync(path.resolve(COMPARE), 'utf8'));
  console.log('\nchange vs', COMPARE);
  for (const [k, r] of Object.entries(result.configs)) {
    const o = old.configs[k]; if (!o) continue;
    const d = (a, b) => (b == null ? '-' : (a - b >= 0 ? '+' : '') + r3(a - b));
    console.log(k, 'layouts', d(r['distinct.layout'].mean, o['distinct.layout'].mean), 'entropy', d(r.entropy.mean, o.entropy.mean), 'offSeason', r.offSeason && o.offSeason ? d(r.offSeason.mean, o.offSeason.mean) : '-');
  }
}
