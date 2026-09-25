#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: materials (マイ素材) render on the lab page (DESIGN_2_1 §7.4, §8.3).

The materials are parts/mix's sampleDefs (one composite per kind and the §2.1 cherry-petal atmosphere) and 12 materials
generated from a seeded stream (every kind, many primitives, anchors, movers and appears), put into the effective
registry of the catalog. Each is shown in the canned sample cut of engine/facade.samplePlan (the material in its slot,
fallback parts elsewhere) in every aspect, at three times, through the real Canvas2D renderer. Checks: no page error,
no console error, no 'part-error' warning; per material and aspect, a frame that is not blank and that differs from the
same cut without the material at one of the times at least (the material draws something); 0 securitypolicyviolation
events on the page. It also times the cherry-petal atmosphere at 720p against the same frame without it and reports
the difference (it fails only above twice the 1.5 ms static cost, like perf.py's 2× rule on a shared machine).
Google Fonts are blocked, so fallback faces draw: the system needs a Japanese font (dev/browser.py japanese_font_missing).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/materials_gallery.py [--aspects 16:9,9:16]
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations, japanese_font_missing  # noqa: E402  (lab-page helpers)
from playwright.async_api import async_playwright  # noqa: E402

EPS = 1.0            # luminance variance (0..255 scale) below this counts as a blank frame
TIMES = (0.15, 0.5, 0.85)
WIDTH = 256
GENERATED = 12
CHERRY_BUDGET_MS = 1.5

# The materials and their registry, made in the page from the modules (the lab has no material registry of its own).
SETUP = r"""
(o) => {
  const REG = MV.use('core/registry'), MIX = MV.use('parts/mix'), R = MV.use('core/recipe'), RNG = MV.use('core/rng');
  const base = MV.use('parts/catalog').defaultRegistry();
  const rng = RNG.stream('materials-gallery', o.seed);
  const TOKENS = ['ink', 'accent', 'shiftA', 'shiftB', 'muted', 'ground2'];
  const KINDS = ['ornament', 'ornament', 'ground', 'arrive', 'depart', 'dwell', 'lens', 'filter', 'ornament', 'ground', 'ornament', 'arrive'];
  const layer = (kind, prim) => ({ prim, shape: rng.pick(R.SHAPES), glyph: rng.pick(R.GLYPHS),
    inks: [rng.pick(TOKENS), kind === 'ornament' ? 'slot' : rng.pick(TOKENS)], alpha: rng.range(0.5, 1), layer: rng.pick(R.LAYERS[kind]),
    place: { anchor: rng.pick(R.ANCHORS), x: 0, y: 0, spread: rng.range(0.8, 1.2) }, size: [rng.range(0.01, 0.02), rng.range(0.02, 0.05)],
    count: ['particles', 'lines', 'glyphs'].includes(prim) ? rng.int(20, 60) : rng.int(2, 6), stroke: prim === 'frame' ? 0.004 : 0,
    rot: [-30, 30], field: { dir: rng.range(0, 360), speed: rng.range(0.02, 0.2), sway: rng.range(0, 30), swayHz: 0.3, spin: 40,
      life: [0, 0], burst: rng.chance(0.2) ? 'beat' : 'none' },
    move: [{ what: rng.pick(['x', 'y', 'rot', 'scale']), wave: rng.pick(['sine', 'tri', 'noise', 'beat']), amp: 0.08, hz: 0.5,
      phase: rng.pick(R.PHASES) }],
    appear: { at: rng.pick(['start', 'arrive', 'rest']), draw: rng.pick(['fade', 'grow', 'wipe']), dur: 0.4 },
    style: rng.pick(R.FRAME_STYLES), pattern: rng.pick(R.PATTERNS), gap: 0.06,
    fill: { type: rng.pick(['linear', 'radial']), angle: 90, stops: [['ground', 0], [rng.pick(TOKENS), 1]] } });
  const recipeOf = (kind) => {
    switch (kind) {
      case 'ornament': return { scope: rng.chance(0.5) ? 'run' : 'cut', follow: 'own', seed: rng.int(1, 99),
        layers: ['particles', 'shape', 'lines', 'glyphs', 'frame'].filter(() => rng.chance(0.6)).concat(['particles']).map((p) => layer(kind, p)),
        knobs: [{ what: 'size' }] };
      case 'ground': return { seed: rng.int(1, 99), layers: [layer(kind, 'fill'), layer(kind, 'pattern'), layer(kind, 'particles')] };
      case 'arrive': return { motion: { unit: rng.pick(['glyph', 'word']), curve: 'backOut', dur: [0.5, 0.8], each: [0.02, 0.04], order: ['lead'],
        tracks: [{ col: 'y', from: 1.2, to: 0 }, { col: 'rot', from: -40, to: 0 }, { col: 'alpha', from: 0, to: 1 }] } };
      case 'depart': return { motion: { unit: 'glyph', curve: 'quadIn', dur: [0.4, 0.6], each: [0.02, 0.03], order: ['lead'],
        tracks: [{ col: 'x', from: 0, to: 2 }, { col: 'alpha', from: 1, to: 0 }] } };
      case 'dwell': return { osc: [{ col: 'y', amp: 0.2, hz: 1, wave: 'sine', phase: 'index', step: 0.5 },
        { col: 'rot', amp: 8, hz: 0.7, wave: 'tri', phase: 'rnd' }] };
      case 'lens': return { osc: [{ col: 'x', amp: 30, hz: 0.8, wave: 'sine' }, { col: 'zoom', amp: 0.06, hz: 0.6, wave: 'tri' }] };
      default: return { parts: [{ key: 'grainFilm', params: {} }, { key: 'edgeShade', params: {} }], mix: [0.9, 1] };
    }
  };
  const entries = [];
  for (let i = 0; i < o.count; i++) {
    const kind = KINDS[i % KINDS.length];
    let recipe = R.normalize(kind, recipeOf(kind)).recipe;
    for (let pass = 0; pass < 6 && R.problems(kind, recipe, { registry: base }).length; pass++) {
      const m = JSON.parse(JSON.stringify(recipe));
      for (const l of m.layers || []) { l.count = Math.max(1, Math.floor(l.count / 2)); l.move = []; }
      recipe = R.normalize(kind, m).recipe;
    }
    entries.push({ id: 'm' + (i + 1).toString(36), kind, by: 'user', name: { ja: '生成' + i, en: 'Generated ' + i }, tags: ['soft'],
      season: null, pool: true, rv: 1, recipe });
  }
  const eff = MIX.registryFor(base, { next: o.count + 1, list: entries });
  const generated = entries.map((e) => eff.get(e.kind, 'myMat' + e.id.slice(1))).filter(Boolean);
  const samples = MIX.sampleDefs(base).map((d) => Object.freeze(Object.assign({}, d, { key: 'myMatz' + d.key.slice(6).toLowerCase() })));
  const reg = REG.extend(base, generated.concat(samples));
  window.__materials = { reg, base };
  return { problems: eff.problems.concat(reg.problems), skipped: entries.length - generated.length,
    jobs: samples.concat(generated).map((d) => ({ kind: d.kind, key: d.key })) };
}
"""

RENDER_ALL = r"""
async (o) => {
  const FAC = MV.use('engine/facade'), HC = MV.use('engine/host/canvas'), HM = MV.use('engine/host/measure');
  const { reg } = window.__materials;
  const factory = HC.createCanvasFactory();
  const engine = FAC.createEngine({ registry: reg, canvas: factory, measurer: HM.createCanvasMeasurer(factory, null), fonts: null, assets: null });
  const frame = (plan, t, w, h) => {
    const made = factory.create(w, h, { alpha: false });
    const surface = { canvas: made.canvas, ctx: made.ctx, w, h };
    engine.setPlan(plan);
    engine.renderFrame(surface, t, { quality: 'preview', scale: Math.min(w / plan.design.w, h / plan.design.h) });
    const d = surface.ctx.getImageData(0, 0, w, h).data;
    let sum = 0, sq = 0, hash = 2166136261;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; sq += l * l;
      hash = Math.imul(hash ^ (d[i] + 7 * d[i + 1] + 13 * d[i + 2]), 16777619);
    }
    const n = d.length / 4;
    return { variance: sq / n - (sum / n) * (sum / n), hash: hash >>> 0, warnings: engine.warnings() };
  };
  const out = [];
  for (const job of o.jobs) {
    const [aw, ah] = job.aspect.split(':').map(Number);
    const [w, h] = aw >= ah ? [o.width, Math.round(o.width * ah / aw)] : [Math.round(o.width * aw / ah), o.width];
    try {
      const plan = FAC.samplePlan(reg, { kind: job.kind, key: job.key }, { aspect: job.aspect });
      const host = FAC.samplePlan(reg, {}, { aspect: job.aspect });
      const cut = plan.cuts[0];
      let differs = false, variance = Infinity;
      const bad = [];
      for (const u of o.times) {
        const t = cut.a + (cut.b - 0.001 - cut.a) * u;
        const a = frame(plan, t, w, h);
        bad.push(...a.warnings.filter((x) => x.code === 'part-error').map((x) => x.detail || x.code));
        const b = frame(host, t, w, h);
        differs = differs || a.hash !== b.hash;
        variance = Math.min(variance, a.variance);
      }
      out.push({ kind: job.kind, key: job.key, aspect: job.aspect, differs, variance, bad });
    } catch (e) {
      out.push({ kind: job.kind, key: job.key, aspect: job.aspect, error: String(e && e.stack || e) });
    }
  }
  return out;
}
"""

# The cherry-petal atmosphere at 720p: p50 frame time with it minus p50 of the same frames without it.
CHERRY_COST = r"""
async (o) => {
  const FAC = MV.use('engine/facade'), HC = MV.use('engine/host/canvas'), HM = MV.use('engine/host/measure');
  const { reg } = window.__materials;
  const factory = HC.createCanvasFactory();
  const engine = FAC.createEngine({ registry: reg, canvas: factory, measurer: HM.createCanvasMeasurer(factory, null), fonts: null, assets: null });
  const made = factory.create(1280, 720, { alpha: false });
  const surface = { canvas: made.canvas, ctx: made.ctx, w: 1280, h: 720 };
  const run = (plan) => {
    engine.setPlan(plan);
    const opts = { quality: 'export', scale: 1280 / plan.design.w };
    for (let i = 0; i < 10; i++) { engine.renderFrame(surface, 0.5 + i / 30, opts); surface.ctx.getImageData(0, 0, 1, 1); }
    const times = [];
    let particles = 0;
    for (let i = 0; i < o.frames; i++) {
      const t0 = performance.now();
      const st = engine.renderFrame(surface, 0.5 + (i % 60) / 30, opts);
      surface.ctx.getImageData(0, 0, 1, 1);
      times.push(performance.now() - t0);
      particles = Math.max(particles, st.drawn.particles);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  };
  const withIt = FAC.samplePlan(reg, { kind: 'ornament', key: 'myMatzatmos' }, { aspect: '16:9' });
  const without = FAC.samplePlan(reg, {}, { aspect: '16:9' });
  const a = [], b = [];
  for (let k = 0; k < 3; k++) { a.push(run(withIt)); b.push(run(without)); }
  const best = (xs) => Math.min(...xs);
  return { with: best(a), without: best(b), cost: best(a) - best(b), static: reg.get('ornament', 'myMatzatmos').mine.cost.ms };
}
"""


async def run(args):
    failures = []
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
            if await japanese_font_missing(page, 'materials_gallery.py'):
                return 1
            info = await page.evaluate('window.__lab.info()')
            aspects = [a for a in (args.aspects.split(',') if args.aspects else info['aspects']) if a]
            made = await page.evaluate(SETUP, {'seed': 1, 'count': GENERATED})
            if made['problems']:
                failures.append('registry problems: %r' % made['problems'][:10])
            if made['skipped']:
                failures.append('%d generated materials did not derive' % made['skipped'])
            jobs = [dict(job, aspect=aspect) for job in made['jobs'] for aspect in aspects]
            results = await page.evaluate(RENDER_ALL, {'jobs': jobs, 'times': list(TIMES), 'width': WIDTH})
            bad = 0
            for r in results:
                where = '%s/%s %s' % (r['kind'], r['key'], r['aspect'])
                if 'error' in r:
                    failures.append(where + ': ' + r['error'].splitlines()[0])
                elif r['bad']:
                    failures.append(where + ': part-error ' + '; '.join(r['bad']))
                elif r['variance'] <= EPS:
                    failures.append(where + ': blank frame')
                elif not r['differs']:
                    failures.append(where + ': the material draws nothing (every frame equals the cut without it)')
                else:
                    continue
                bad += 1
            print('%s materials: %d (%d samples, %d generated) × %d aspects × %d times = %d renders' % (
                'FAIL' if bad else 'ok  ', len(made['jobs']), len(made['jobs']) - GENERATED + made['skipped'], GENERATED,
                len(aspects), len(TIMES), 2 * len(results) * len(TIMES)))
            cherry = await page.evaluate(CHERRY_COST, {'frames': 60})
            print('cherry-petal atmosphere at 720p: %.2f ms per frame with it, %.2f ms without: %.2f ms (static cost %.2f ms)' % (
                cherry['with'], cherry['without'], cherry['cost'], cherry['static']))
            if cherry['static'] > CHERRY_BUDGET_MS:
                failures.append('the cherry-petal static cost %.2f ms is over %.1f ms' % (cherry['static'], CHERRY_BUDGET_MS))
            if cherry['cost'] > 2 * CHERRY_BUDGET_MS:
                failures.append('the cherry-petal atmosphere costs %.2f ms per frame at 720p (> 2 × %.1f ms)' % (
                    cherry['cost'], CHERRY_BUDGET_MS))
            violations = await csp_violations(page)
            if violations:
                failures.append('CSP violations: %r' % violations)
            if page.lab_errors:
                failures.append('page errors: %r' % page.lab_errors[:10])
        finally:
            await browser.close()
    for msg in failures[:60]:
        print('  ' + msg)
    if len(failures) > 60:
        print('  … and %d more' % (len(failures) - 60))
    print('materials_gallery.py: %s' % ('FAILED' if failures else 'OK (0 CSP violations, no page errors)'))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description='Render sample and generated materials in every aspect on the lab page.')
    ap.add_argument('--aspects', default='', help='comma-separated aspects (default: all seven)')
    return asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    sys.exit(main())
