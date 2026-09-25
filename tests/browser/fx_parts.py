#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: screen effects and transitions on real canvases (DESIGN §5.8, §5.9, §7.4).

The Node tests see filters and seams only as recorded draw calls; this one reads pixels. On the lab page it builds the
renderer's own FxContext (engine/render/post.createFx over a surface pool), feeds each part hand-painted frames and checks:
  transitions  a world transition shows frame a at u = 0 and frame b at u = 1, and something between at u = 0.5; a
               text transition does the same with transparent text layers (the hard cut shows both, always);
  filters      amount 0 gives the frame back unchanged; at a typical amount (flash effects on an impact) the frame
               changes; the change fades out with amount (amount 0.011 changes the frame far less than 0.1: nothing
               switches on at a fixed strength, so the post stack's `when` weighting fades every filter); alpha-safe
               filters keep an empty transparent frame empty (they move or copy content only);
  cost         the time of one call at 1920×1080 per part, best of three (printed; fails only above a generous bound);
               and each filter's declared `cost` against its measured class at 1280×720 (§7.4: the adaptive preview
               halves cost ≥ 3 and skips cost ≥ 4), in full-frame copies timed on the same canvas:
               1 ≤ 3 copies, 2 ≤ 5, 3 ≤ 10, 4 ≤ 20, 5 above (or the text re-rendered); a declared cost more than one
               class below the measured one fails.
Google Fonts are blocked. Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/fx_parts.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations  # noqa: E402  (the shared lab-page helpers)
from playwright.async_api import async_playwright  # noqa: E402

SIZE = (480, 270)          # checks
FULL = (1920, 1080)        # timings
PREVIEW = (1280, 720)      # cost classes (§7.4 budgets are at 720p)
SLOW_MS = 80               # per call at 1080p: far above the §7.4 post budget (software GL here), catches runaway parts
COST_CLASSES = (3, 5, 10, 20)   # full-frame copies: at most 3 → cost 1, 5 → 2, 10 → 3, 20 → 4, more → 5

RUN = r"""
async (o) => {
  const REG = MV.use('core/registry'), PO = MV.use('engine/render/post'), SF = MV.use('engine/render/surface');
  const HC = MV.use('engine/host/canvas'), FAC = MV.use('engine/facade');
  const cat = MV.use('parts/catalog');
  let reg;
  try { reg = cat.defaultRegistry(); } catch (e) { reg = REG.createRegistry(cat.defs(), { strict: false }); }
  const factory = HC.createCanvasFactory();
  const pool = SF.createPool(factory), tiles = PO.createTileBank(factory), ctl = PO.createFx({ pool, tiles });
  const plan = { cuts: [], seams: [], beats: { bpm: 120, offset: 0, meter: 4 },
    impulses: [{ t: 1, kind: 'flash', amp: 0.6, decay: 0.18 }, { t: 1, kind: 'slip', amp: 0.8, decay: 0.25 }] };
  const now = () => performance.now();

  // Every surface goes back before the frame size changes (the pool counts frame-sized surfaces per size).
  let info = null;
  function setup(w, h, alpha) {
    pool.end();
    pool.frame(w, h);
    info = { plan, w, h, unit: w / 1920, quality: 'export', alpha, textAt: (dt) => textLayer(w, h, dt), flashScale: 1 };
  }
  // One call = one frame of the renderer: the frame fields (and the textAt budget) are reset, then the part is chosen.
  function use(seed, cut, allowTextAt) { ctl.frame(info); ctl.use(seed, cut, allowTextAt); }
  // A stand-in for fx.textAt: a moving bar of "text" on a transparent layer.
  let emptyText = false;
  function textLayer(w, h, dt) {
    const s = pool.take(w, h);
    if (emptyText) return s;
    s.ctx.fillStyle = '#FFFFFF';
    s.ctx.fillRect(w * (0.3 - dt), h * 0.4, w * 0.3, h * 0.2);
    return s;
  }
  function frame(w, h, which, opaque) {
    const s = pool.take(w, h), g = s.ctx;
    if (opaque) {
      g.fillStyle = which === 'a' ? '#C83C3C' : '#3C50C8'; g.fillRect(0, 0, w, h);
      g.fillStyle = which === 'a' ? '#F5F0E6' : '#101418';
      g.fillRect(w * 0.2, h * 0.3, w * 0.25, h * 0.4);
      g.beginPath(); g.arc(w * 0.7, h * 0.5, h * 0.18, 0, Math.PI * 2); g.fill();
      for (let y = 0; y < h; y += 12) {
        g.fillStyle = y % 24 ? '#00000022' : '#FFFFFF22';
        g.fillRect(0, y, w, 6);
      }
    } else {
      g.fillStyle = which === 'a' ? '#E04040' : '#4060E0';
      if (which === 'a') g.fillRect(w * 0.1, h * 0.35, w * 0.35, h * 0.3); else g.fillRect(w * 0.55, h * 0.35, w * 0.35, h * 0.3);
    }
    return s;
  }
  // A light paper-like frame with dark words, for the filters.
  function scene(w, h, alpha) {
    const s = pool.take(w, h), g = s.ctx;
    if (!alpha) {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#EFE9DC'); grad.addColorStop(1, '#C9B89A');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }
    g.fillStyle = '#1C1A17'; g.fillRect(w * 0.2, h * 0.42, w * 0.6, h * 0.16);
    g.fillStyle = '#B8322A'; g.fillRect(w * 0.3, h * 0.3, w * 0.1, h * 0.1);
    return s;
  }
  const px = (s) => s.ctx.getImageData(0, 0, s.w, s.h).data;
  function mae(p, q) { let d = 0; for (let i = 0; i < p.length; i++) d += Math.abs(p[i] - q[i]); return d / p.length / 255; }
  function painted(p) { let n = 0; for (let i = 3; i < p.length; i += 4) if (p[i] > 0) n++; return n; }
  function changedPixels(p, q) { let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 12) n++; return n; }

  function paramsOf(kind, key, over) {
    const sp = FAC.samplePlan(reg, { kind, key }, {});
    const p = kind === 'seam' ? sp.seams[0].slot.p : sp.cuts[0].slots['filter#0'].p;
    return Object.assign({}, p, over || {});
  }
  const cutAt = (t, impact) => ({ tl: t - 1, dur: 2, impact, energy: 0.6 });

  const out = { seams: [], filters: [], timings: [] };
  const [w, h] = o.size, [W, H] = o.full;

  for (const key of reg.keys('seam')) {
    const d = reg.get('seam', key), world = d.scope === 'world', p = paramsOf('seam', key);
    setup(w, h, !world);
    const r = { key, scope: d.scope };
    for (const u of [0, 0.5, 1]) {
      pool.begin();
      const a = frame(w, h, 'a', world), b = frame(w, h, 'b', world);
      use(1234, null, false);
      const m = d.mix(ctl.fx, a, b, u, p);
      const pm = px(m), pa = px(a), pb = px(b);
      r['u' + u] = { toA: mae(pm, pa), toB: mae(pm, pb) };
      if (!world) {                                  // the plain overlay of both text layers, for the hard cut
        const both = pool.take(w, h); both.ctx.drawImage(a.canvas, 0, 0); both.ctx.drawImage(b.canvas, 0, 0);
        r['u' + u].toBoth = mae(pm, px(both));
      }
    }
    setup(W, H, !world);
    const a = frame(W, H, 'a', world), b = frame(W, H, 'b', world);
    let ms = Infinity;
    for (const u of [0.3, 0.5, 0.7]) {
      use(1234, null, false);
      const t0 = now();
      const m = d.mix(ctl.fx, a, b, u, p);
      px1(m);
      ms = Math.min(ms, now() - t0);
      if (m !== a && m !== b) pool.give(m);
    }
    out.timings.push({ part: 'seam/' + key, ms });
    out.seams.push(r);
  }

  function px1(s) { return s.ctx.getImageData(0, 0, 1, 1).data[0]; }   // waits for the GPU work of the call

  // A filter's time at the preview size in full-frame copies: blocks of 4 calls (the clock has 0.1 ms steps), best
  // of three blocks, against blocks of 20 plain copies measured right before it.
  function costAt(d, key, flash) {
    const [PW, PH] = o.preview;
    setup(PW, PH, false);
    const src = scene(PW, PH, false);
    px1(src);
    let copy = Infinity;
    for (let b = 0; b < 3; b++) {
      const t0 = now();
      for (let i = 0; i < 20; i++) { const c = pool.take(PW, PH); c.ctx.drawImage(src.canvas, 0, 0); px1(c); pool.give(c); }
      copy = Math.min(copy, (now() - t0) / 20);
    }
    let best = Infinity;
    for (let b = 0; b < 3; b++) {
      const t0 = now();
      for (let i = 0; i < 4; i++) {
        const t = [0.3, 1.02, 1.6, 2.2][i];
        use(99, cutAt(t, true), d.needs.includes('textAt'));
        const res = d.apply(ctl.fx, src, paramsOf('filter', key, { amount: 0.7, when: flash ? 'impact' : 'always' }), t);
        px1(res);
        if (res !== src) pool.give(res);
      }
      best = Math.min(best, (now() - t0) / 4);
    }
    return best / Math.max(copy, 1e-3);
  }

  for (const key of reg.keys('filter')) {
    const d = reg.get('filter', key), flash = key === 'flashPop' || key === 'invertBlink';
    const r = { key, alphaSafe: d.alphaSafe };
    setup(w, h, false);
    let offOk = true;
    for (const t of [0.5, 1.01, 2]) {
      pool.begin();
      const src = scene(w, h, false);
      use(99, cutAt(t, true), d.needs.includes('textAt'));
      const res = d.apply(ctl.fx, src, paramsOf('filter', key, { amount: 0 }), t);
      if (res !== src && mae(px(res), px(src)) > 0) offOk = false;
    }
    r.offOk = offOk;
    let changed = 0, pixels = 0;
    for (const t of [0.3, 1.01, 1.04, 1.6, 2.3]) {
      pool.begin();
      const src = scene(w, h, false);
      use(99, cutAt(t, true), d.needs.includes('textAt'));
      const res = d.apply(ctl.fx, src, paramsOf('filter', key, { amount: 0.7, when: flash ? 'impact' : 'always' }), t);
      if (res !== src) {
        const a = px(res), b = px(src);
        changed = Math.max(changed, mae(a, b));
        pixels = Math.max(pixels, changedPixels(a, b));
      }
    }
    r.changed = changed; r.pixels = pixels;
    // Fading: the largest change at amount 0.011 and at 0.1 over the same instants.
    const faint = { 0.011: 0, 0.1: 0 };
    for (const amount of [0.011, 0.1]) {
      for (const t of [0.3, 1.01, 1.04, 1.6, 2.3]) {
        pool.begin();
        const src = scene(w, h, false);
        use(99, cutAt(t, true), d.needs.includes('textAt'));
        const res = d.apply(ctl.fx, src, paramsOf('filter', key, { amount, when: flash ? 'impact' : 'always' }), t);
        if (res !== src) faint[amount] = Math.max(faint[amount], mae(px(res), px(src)));
      }
    }
    r.faint = faint[0.011]; r.tenth = faint[0.1];
    if (d.alphaSafe) {                              // an empty transparent frame (and empty text layers) stays empty
      setup(w, h, true);
      emptyText = true;
      let leak = 0;
      for (let t = 0.05; t < 3; t += 0.1) {
        pool.begin();
        const src = pool.take(w, h);
        use(99, cutAt(t, true), d.needs.includes('textAt'));
        const res = d.apply(ctl.fx, src, paramsOf('filter', key, { amount: 1, tint: 1 }), t);
        leak = Math.max(leak, painted(px(res)));
      }
      emptyText = false;
      r.leak = leak;
    }
    setup(W, H, false);
    const src = scene(W, H, false);
    let ms = Infinity;
    for (const t of [0.3, 1.02, 1.6]) {
      use(99, cutAt(t, true), d.needs.includes('textAt'));
      const t0 = now();
      const res = d.apply(ctl.fx, src, paramsOf('filter', key, { amount: 0.7, when: flash ? 'impact' : 'always' }), t);
      px1(res);
      ms = Math.min(ms, now() - t0);
      if (res !== src) pool.give(res);
    }
    out.timings.push({ part: 'filter/' + key, ms });
    r.cost = d.cost;
    r.copies = costAt(d, key, flash);
    out.filters.push(r);
  }
  pool.end();
  return out;
}
"""


async def run():
    failures = []
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
            res = await page.evaluate(RUN, {'size': list(SIZE), 'full': list(FULL), 'preview': list(PREVIEW)})
            for s in res['seams']:
                u0, u5, u1 = s['u0'], s['u0.5'], s['u1']
                if s['key'] == 'hardCut':
                    if max(u0['toBoth'], u5['toBoth'], u1['toBoth']) > 0.002:
                        failures.append('seam/hardCut: not the plain overlay of both cuts')
                    continue
                if u0['toA'] > 0.004:
                    failures.append('seam/%s: u = 0 is not frame a (%.4f)' % (s['key'], u0['toA']))
                if u1['toB'] > 0.004:
                    failures.append('seam/%s: u = 1 is not frame b (%.4f)' % (s['key'], u1['toB']))
                if min(u5['toA'], u5['toB']) < 0.01:
                    failures.append('seam/%s: u = 0.5 looks like one of the two frames (%.4f / %.4f)' % (s['key'], u5['toA'], u5['toB']))
            for f in res['filters']:
                if not f['offOk']:
                    failures.append('filter/%s: amount 0 changes the frame' % f['key'])
                if f['changed'] < 0.003 and f['pixels'] < 20:
                    failures.append('filter/%s: no visible change at amount 0.7 (%.4f, %d px)' % (f['key'], f['changed'], f['pixels']))
                if f.get('leak'):
                    failures.append('filter/%s: paints %d empty pixels of a transparent frame' % (f['key'], f['leak']))
                if f['faint'] > 0.3 * f['tenth'] + 0.002:
                    failures.append('filter/%s: does not fade with amount (change %.4f at 0.011 vs %.4f at 0.1)' % (
                        f['key'], f['faint'], f['tenth']))
            print('fx_parts: filter cost at %dx%d in full-frame copies (declared cost / measured class):' % PREVIEW)
            for f in sorted(res['filters'], key=lambda x: -x['copies']):
                measured = 1 + sum(1 for limit in COST_CLASSES if f['copies'] > limit)
                print('  %-14s %5.1f copies  cost %d / class %d' % (f['key'], f['copies'], f['cost'], measured))
                if f['key'] != 'afterImage' and f['cost'] < measured - 1:
                    failures.append('filter/%s: declared cost %d, measured class %d (%.1f copies)' % (
                        f['key'], f['cost'], measured, f['copies']))
            print('fx_parts: one call at %dx%d (ms, best of 3):' % FULL)
            for t in sorted(res['timings'], key=lambda x: -x['ms']):
                print('  %-22s %6.1f' % (t['part'], t['ms']))
                if t['ms'] > SLOW_MS:
                    failures.append('%s: %.1f ms per call at 1080p' % (t['part'], t['ms']))
            failures += ['page error: ' + e for e in page.lab_errors]
            failures += ['CSP: ' + v for v in await csp_violations(page)]
        finally:
            await browser.close()
    for f in failures:
        print('FAIL ' + f)
    print('fx_parts: %s' % ('OK' if not failures else '%d failure(s)' % len(failures)))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(run()))
