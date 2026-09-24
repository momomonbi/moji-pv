/* Rough size and cost of one song's AI requests, per service and model (no network).
   Tokens are estimated from characters (ASCII ≈ 4 per token, other ≈ 1 per token); output and thinking are assumed.
   usage: node dev/ai_cost_estimate.js [--lines 40] */
'use strict';
const J = require('./engine_node')();
const AI = J.AI;
const LINES = +((process.argv.indexOf('--lines') > 0 && process.argv[process.argv.indexOf('--lines') + 1]) || 40);
const base = ['君の名前を呼んだ', '白い息が消えていく', 'ずっとこのままでいたい', 'まだ終わらない夏の日', '夜明けの色を覚えてる', 'ほどけた声が遠くで鳴った', 'ねえ、まだ間に合うかな', '*透明*なままじゃ終われない!'];
const lyrics = Array.from({ length: LINES }, (_, i) => base[i % base.length]).join('\n');
const tok = s => { let a = 0, o = 0; for (const c of s) (c.charCodeAt(0) < 128 ? a++ : o++); return Math.round(a / 4 + o); };
const out = [];
for (const extra of [false, true]) {
  const P = Object.assign(J.defaultProject(), { lyrics, extra });
  const plan = J.plan(P, null);
  const reqs = {
    prep: AI.prepRequest(P, 'ja'),
    proposals: AI.proposalsRequest(P, plan, 'ja'),
    edit: AI.editRequest(P, plan, 'サビをもっと派手に', 'ja'),
  };
  // assumed answer + thinking tokens per request (low / medium thinking)
  const OUT = { prep: 1500 + 800, proposals: 2000 + 3000, edit: 600 + 800 };
  for (const [k, q] of Object.entries(reqs)) {
    const input = tok(q.system) + tok(q.prompt) + tok(JSON.stringify(q.schema));
    out.push({ extra, kind: k, chars: q.system.length + q.prompt.length, input, output: OUT[k] });
  }
}
console.log(`${LINES}-line song`);
console.log('extra\tkind\tchars\tin tok\tout tok (assumed)');
out.forEach(r => console.log(`${r.extra}\t${r.kind}\t${r.chars}\t${r.input}\t${r.output}`));
console.log('\nOne song = prep + proposals + 3 one-line edits (追加分 off / on):');
for (const extra of [false, true]) {
  const rows = out.filter(r => r.extra === extra);
  const sum = { input: 0, output: 0 };
  for (const r of rows) { const n = r.kind === 'edit' ? 3 : 1; sum.input += r.input * n; sum.output += r.output * n; }
  const line = [];
  for (const [p, prov] of Object.entries(AI.PROVIDERS)) for (const m of prov.models) {
    const usd = AI.costUSD(p, m, sum);
    line.push(`${m} $${usd.toFixed(3)} (≈¥${(usd * 150).toFixed(0)})`);
  }
  console.log(`  extra=${extra}: in ${sum.input} / out ${sum.output} tokens -> ` + line.join(', '));
}
