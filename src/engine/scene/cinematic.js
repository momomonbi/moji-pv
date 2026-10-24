/* 文字PVメーカー v2 — original work. Pure clocks and shared controls for seekable cinematic overlays. */
MV.def('engine/scene/cinematic', ['core/num', 'core/rng', 'core/color'], (N, RNG, C) => {
  'use strict';

  const LABEL = (ja, en) => ({ ja, en });
  const KEY_GREEN = '#00B140';
  const MAX_TIME = 86400;
  const params = Object.freeze({
    start: { type: 'num', min: 0, max: MAX_TIME, step: 0.01, unit: 's',
      label: LABEL('始める位置', 'Start position'), auto: { value: 0 } },
    duration: { type: 'num', min: 0, max: MAX_TIME, step: 0.01, unit: 's',
      label: LABEL('長さ（0で範囲いっぱい）', 'Duration (0 fills the range)'), auto: { value: 0 } },
    fade: { type: 'num', min: 0, max: 5, step: 0.01, unit: 's',
      label: LABEL('前後のフェード', 'Fade in and out'), auto: { value: 0.45 } },
    clock: { type: 'enum', of: ['section', 'song'], optKey: 'cinematicClock',
      label: LABEL('時間の基準', 'Time reference'), auto: { value: 'section' }, ui: 'advanced' },
    seed: { type: 'int', min: 1, max: 2147483646,
      label: LABEL('模様の番号', 'Pattern number'), auto: { value: 741 }, ui: 'advanced' },
    placement: { type: 'enum', of: ['behind', 'front'], optKey: 'cinematicPlacement',
      label: LABEL('歌詞との重なり', 'Layering with lyrics'), auto: { value: 'behind' } },
  });

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }

  // The geometry is shared across split scenes. In song-clock mode only the renderer's q.time drives the window;
  // no scene origin or mutable clock is captured in a cached paint record.
  function setup(env, values) {
    const p = values || {}, D = env.D || {}, times = env.times || {};
    const w = Math.max(1, finite(D.w, 1920)), h = Math.max(1, finite(D.h, 1080));
    const start = N.clamp(finite(p.start, 0), 0, MAX_TIME);
    const span = Math.max(0, finite(times.b, 0) - finite(times.a, 0));
    const requested = N.clamp(finite(p.duration, 0), 0, MAX_TIME);
    const clock = p.clock === 'song' ? 'song' : 'section';
    const duration = requested > 0 ? requested : Math.max(0, span - (clock === 'section' ? start : 0));
    return { w, h, short: Math.max(1, finite(D.short, Math.min(w, h))), start, duration,
      fade: Math.min(N.clamp(finite(p.fade, 0.45), 0, 5), duration / 2),
      clock,
      seed: Math.round(N.clamp(finite(p.seed, 741), 1, 2147483646)),
      amount: N.clamp(finite(p.amount, 1)), layer: p.placement === 'front' ? 'near' : 'far' };
  }

  function frame(localTime, data, q) {
    const now = data.clock === 'song' ? q && q.time : localTime;
    const duration = data.duration;
    if (!Number.isFinite(now) || !(duration > 0)) return { active: false, time: 0, u: 0, alpha: 0 };
    const elapsed = now - data.start, time = N.clamp(elapsed, 0, duration), u = time / duration;
    if (!(data.amount > 0) || elapsed < 0 || elapsed >= duration) return { active: false, time, u, alpha: 0 };
    const fade = data.fade;
    const envelope = fade > 0 ? N.smooth(time / fade) * N.smooth((duration - time) / fade) : 1;
    const alpha = data.amount * envelope;
    return { active: alpha > 0, time, u, alpha };
  }

  function random(seed) { return RNG.gen(finite(seed, 741)); }

  function grey(hex) {
    const L = C.luminance(hex), v = L <= 0.0031308 ? 12.92 * L : 1.055 * Math.pow(L, 1 / 2.4) - 0.055;
    return C.toHex({ r: v * 255, g: v * 255, b: v * 255 });
  }

  // A source effect's own swatches receive the same black/white treatment as theme colours. On a keyed frame,
  // near-key greens become neutral instead of disappearing or being mixed with the key behind the overlay.
  function color(palette, ink) {
    const pal = palette || {}, resolved = pal[ink] || ink;
    const hex = C.isHex(resolved) ? resolved.toUpperCase() : C.isHex(pal.accent) ? pal.accent.toUpperCase() : '#FFFFFF';
    const black = String(pal.ground).toUpperCase() === '#000000' && String(pal.ink).toUpperCase() === '#FFFFFF'
      && String(pal.accent).toUpperCase() === '#FFFFFF';
    const chroma = String(pal.ground).toUpperCase() === KEY_GREEN;
    return black || (chroma && C.hueDistance(hex, KEY_GREEN) < 40) ? grey(hex) : hex;
  }

  return { params, setup, frame, random, color };
});
