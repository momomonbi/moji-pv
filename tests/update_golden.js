/* 文字PVメーカー v2 — original work. Rewrites tests/golden/* on purpose: plan hashes and frame op hashes (DESIGN §2.1, §8.2). */
'use strict';
// Usage:
//   node tests/update_golden.js           recompute and rewrite the golden files that can be computed today
//   node tests/update_golden.js --check   recompute and compare; exit 1 on a difference; writes nothing
// Plan hashes need planner/plan; frame hashes need engine/facade, engine/render/record and engine/text/fake_measure.
// A golden whose modules do not exist yet is left as it is (or written as an empty placeholder when missing).
// Registry: the full catalog (parts/catalog) when it exists, else the stub parts (tests/fixtures/stub_parts.js).
//
// Formats:
//   plan_hashes.json  { "registry": { "kind": "stub"|"catalog", "version" } | null, "plans": { "<corpus name>": "<plan.hash>" } }
//   frame_hashes.json { "registry": … | null, "measurer": "fake",
//                       "frames": { "<project>": ["<hash of frame i's recorder ops>", … 40] } }
//   Frames are rendered at a short side of 360 px, at t = duration · (i + 0.5) / 40.

const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./helpers/load.js');
const corpus = require('./helpers/corpus.js');

const MV = load();
const H = MV.use('core/hash');
const D = MV.use('core/doc');
const GOLDEN = path.join(__dirname, 'golden');
const FRAMES = 40;
const SHORT = 360;

function pickRegistry() {
  if (MV.has('parts/catalog')) {
    const reg = MV.use('parts/catalog').defaultRegistry();
    return { reg, info: { kind: 'catalog', version: reg.version } };
  }
  const reg = corpus.stubRegistry(MV);
  return { reg, info: { kind: 'stub', version: reg.version } };
}

function planHashes(reg) {
  const { plan } = MV.use('planner/plan');
  const plans = {};
  for (const { name, doc } of corpus.corpus()) plans[name] = plan(doc, { registry: reg }).hash;
  return plans;
}

function outputSize(aspect) {
  const [w, h] = D.DESIGN_SIZE[aspect];
  const k = SHORT / Math.min(w, h);
  return [Math.round(w * k), Math.round(h * k)];
}

async function frameHashes(reg) {
  const { createEngine } = MV.use('engine/facade');
  const { createRecorder } = MV.use('engine/render/record');
  const { fakeMeasurer } = MV.use('engine/text/fake_measure');
  const frames = {};
  for (const { name, doc } of corpus.projects()) {
    const rec = createRecorder();
    const engine = createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
    const { plan } = engine.setDoc(doc);
    await engine.prepare(0, plan.duration, { export: true });
    const [w, h] = outputSize(doc.look.aspect);
    const made = rec.factory.create(w, h, { alpha: false });
    const surface = { canvas: made.canvas, ctx: made.ctx, w, h };
    const list = [];
    for (let i = 0; i < FRAMES; i++) {
      const before = rec.ops().length;
      engine.renderFrame(surface, (plan.duration * (i + 0.5)) / FRAMES, { quality: 'export', pick: false, scale: w / plan.design.w });
      list.push(H.hashJSON(rec.ops().slice(before)));
    }
    engine.dispose();
    frames[name] = list;
  }
  return frames;
}

function readGolden(file) {
  try { return JSON.parse(fs.readFileSync(path.join(GOLDEN, file), 'utf8')); } catch (e) { return null; }
}

function text(obj) { return JSON.stringify(obj, null, 1) + '\n'; }

async function main() {
  const check = process.argv.includes('--check');
  const { reg, info } = pickRegistry();
  const jobs = [
    { file: 'plan_hashes.json', needs: ['planner/plan'], empty: { registry: null, plans: {} },
      make: async () => ({ registry: info, plans: planHashes(reg) }) },
    { file: 'frame_hashes.json', needs: ['engine/facade', 'engine/render/record', 'engine/text/fake_measure'],
      empty: { registry: null, measurer: 'fake', frames: {} },
      make: async () => ({ registry: info, measurer: 'fake', frames: await frameHashes(reg) }) },
  ];
  let failed = false;
  fs.mkdirSync(GOLDEN, { recursive: true });
  for (const job of jobs) {
    const missing = job.needs.filter((id) => !MV.has(id));
    const current = readGolden(job.file);
    if (missing.length) {
      console.log(job.file + ': skipped (missing ' + missing.join(', ') + ')');
      if (!current && !check) fs.writeFileSync(path.join(GOLDEN, job.file), text(job.empty));
      continue;
    }
    const next = await job.make();
    if (check) {
      const same = current && text(current) === text(next);
      console.log(job.file + ': ' + (same ? 'matches' : 'DIFFERS'));
      failed = failed || !same;
    } else {
      fs.writeFileSync(path.join(GOLDEN, job.file), text(next));
      console.log(job.file + ': written (' + info.kind + ' registry ' + info.version + ')');
    }
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
