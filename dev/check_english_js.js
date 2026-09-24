/* Helper for dev/check_english.py.
   node dev/check_english_js.js literals FILE...   -> JSON [{file, line, text}] of string / template parts that still contain Japanese
   node dev/check_english_js.js runtime            -> JSON [{where, text}] of engine labels still in Japanese after app/english.js
   Needs acorn: cd dev && npm ci */
'use strict';
const fs = require('fs'), path = require('path');
const JA = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
const mode = process.argv[2];
const out = [];
if (mode === 'literals') {
  const acorn = require(path.join(__dirname, 'node_modules', 'acorn'));
  for (const file of process.argv.slice(3)) {
    const src = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', locations: true, sourceType: 'script' });
    const visit = n => {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'Literal' && typeof n.value === 'string' && JA.test(n.value)) out.push({ file, line: n.loc.start.line, text: n.value });
      if (n.type === 'TemplateElement' && JA.test(n.value.cooked || '')) out.push({ file, line: n.loc.start.line, text: n.value.cooked });
      for (const k of Object.keys(n)) {
        if (k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(ast);
  }
} else if (mode === 'runtime') {
  const J = require('./engine_node')({ extra: ['app/english.js'] });
  for (const g of J.GROUP_KEYS) for (const k of J.order(g)) { const d = J.registry(g)[k]; if (d && JA.test(d.name || '')) out.push({ where: `${g}.${k}.name`, text: d.name }); }
  for (const k of J.STYLE_ORDER) for (const f of ['name', 'desc']) if (JA.test(J.STYLES[k][f] || '')) out.push({ where: `style.${k}.${f}`, text: J.STYLES[k][f] });
  for (const k of Object.keys(J.MOODS)) if (JA.test(J.MOODS[k].name || '')) out.push({ where: `mood.${k}.name`, text: J.MOODS[k].name });
  if (JA.test(J.SAMPLE_LYRICS)) out.push({ where: 'SAMPLE_LYRICS', text: J.SAMPLE_LYRICS });
} else {
  console.error('usage: node dev/check_english_js.js literals FILE... | runtime'); process.exit(2);
}
process.stdout.write(JSON.stringify(out));
