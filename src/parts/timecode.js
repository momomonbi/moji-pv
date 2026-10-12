/* 文字PVメーカー v2 — original work. Pure playback-time formatting and bounded vector timers, exposed to parts through parts/kit. */
MV.def('parts/timecode', [], () => {
  'use strict';

  const ADVANCE = 3;
  const RESERVE = '000:00.00';
  const STROKES = Object.freeze({
    '0': [[0, 0, 2, 0, 2, 4, 0, 4, 0, 0]],
    '1': [[0, 1, 1, 0, 1, 4], [0, 4, 2, 4]],
    '2': [[0, 0, 2, 0, 2, 2, 0, 2, 0, 4, 2, 4]],
    '3': [[0, 0, 2, 0, 2, 4, 0, 4], [0, 2, 2, 2]],
    '4': [[0, 0, 0, 2, 2, 2], [2, 0, 2, 4]],
    '5': [[2, 0, 0, 0, 0, 2, 2, 2, 2, 4, 0, 4]],
    '6': [[2, 0, 0, 0, 0, 4, 2, 4, 2, 2, 0, 2]],
    '7': [[0, 0, 2, 0, 1, 4]],
    '8': [[0, 0, 2, 0, 2, 4, 0, 4, 0, 0], [0, 2, 2, 2]],
    '9': [[2, 2, 0, 2, 0, 0, 2, 0, 2, 4, 0, 4]],
    ':': [[1, .9, 1, 1.3], [1, 2.7, 1, 3.1]],
    '.': [[1, 3.6, 1, 4]],
  });

  function format(time) {
    const raw = Number.isFinite(time) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, time)) : 0;
    // Correct multiplication noise at an exact hundredth without rounding a genuinely earlier frame up.
    // Split whole seconds first so a long duration does not overflow a safe integer when multiplied by 100.
    let seconds = Math.floor(raw), hundredths = Math.floor((raw - seconds) * 100 + Math.min(1e-7, raw * Number.EPSILON * 400));
    if (hundredths === 100) { seconds++; hundredths = 0; }
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return pad(Math.floor(seconds / 60)) + ':' + pad(seconds % 60) + '.' + pad(hundredths);
  }

  function width(text, size, weight = .1) { return (((String(text).length * ADVANCE - 1) / 4) + weight) * size; }

  function visible(params) { return !params || params.showTime !== false; }

  // Each numeral rolls only when its own place changes: hundredths, tenths, seconds, tens of seconds, minutes …
  // Its phase is reconstructed from the absolute timeline, with no remembered last frame or animation clock.
  function digitState(time, index, text) {
    const value = text || format(time), ch = value[index];
    if (ch === ':' || ch === '.') return { ch, previous: null, progress: 1 };
    const colon = value.indexOf(':'), dot = value.indexOf('.');
    const period = index < colon ? 60 * Math.pow(10, colon - index - 1)
      : index < dot ? Math.pow(10, dot - index - 1) : Math.pow(10, value.length - index - 1) / 100;
    const raw = Number.isFinite(time) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, time)) : 0;
    const tick = Math.floor((raw + Math.min(1e-9, raw * Number.EPSILON * 4)) / period);
    const duration = Math.min(period * .65, .28), elapsed = Math.max(0, raw - tick * period);
    const progress = Math.min(1, elapsed / duration);
    const before = tick > 0 && progress < 1 ? format((tick - 1) * period) : '';
    const previous = before[before.length - value.length + index];
    return { ch, previous: previous && previous !== ch ? previous : null, progress };
  }

  function digitPath(g, ch, cx, cy, unit, sx = 1, sy = 1, rot = 0) {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    for (const line of STROKES[ch] || []) for (let k = 0; k < line.length; k += 2) {
      const dx = (line[k] - 1) * unit * sx, dy = (line[k + 1] - 2) * unit * sy;
      const x = cx + dx * cos - dy * sin, y = cy + dx * sin + dy * cos;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
  }

  // Displayed time comes exclusively from q.time, the actual frame time:
  // reused scenes, speed curves, backward seeks and post-effect ghost passes cannot reset or warp this timer.
  // The owning part fades the node in the scene table, so drawing and hit testing share the same visibility.
  function draw(g, t, data, q) {
    const alpha = data.alpha;
    if (alpha <= 0) return;
    const text = format(q.time), box = data.box;
    const units = (text.length * ADVANCE - 1) / 4;
    const motion = Number.isFinite(data.motion) ? Math.min(1, Math.max(0, data.motion)) : 0;
    const size = Math.min(data.size, box.w / (units + data.weight + motion * .34), box.h / (1 + data.weight + motion * .34));
    if (!(size > 0)) return;
    const stroke = size * data.weight, pad = stroke / 2, inkWidth = units * size;
    const x = data.align === 'end' ? box.x + box.w - inkWidth - pad : data.align === 'center'
      ? box.x + (box.w - inkWidth) / 2 : box.x + pad;
    const y = box.y + (box.h - size) / 2;
    g.globalAlpha *= alpha;
    g.strokeStyle = q.rgba(data.ink, 1);
    g.lineWidth = stroke;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const u = size / 4;
    if (motion) {
      g.save(); g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
      const mainAlpha = g.globalAlpha;
      for (let c = 0; c < text.length; c++) {
        const digit = digitState(q.time, c, text), p = digit.progress;
        if (!digit.previous) continue;
        g.globalAlpha = mainAlpha * motion * .22 * (1 - p) * (1 - p);
        g.beginPath();
        digitPath(g, digit.previous, x + (c * ADVANCE + 1) * u, y + size / 2 + size * (.14 + p * .25),
          u, 1, .82 - p * .18, motion * .12 * (1 - p));
        g.stroke();
      }
      g.globalAlpha = mainAlpha;
    }
    g.beginPath();
    for (let c = 0; c < text.length; c++) {
      const digit = motion ? digitState(q.time, c, text) : null;
      const p = digit && digit.previous ? digit.progress : 1;
      const flip = (1 - p) * motion, bounce = Math.sin(p * Math.PI * 2) * (1 - p) * motion;
      digitPath(g, text[c], x + (c * ADVANCE + 1) * u, y + size / 2 - size * .14 * bounce,
        u, 1 + flip * .08, 1 - flip * .42, bounce * .18);
    }
    g.stroke();
    if (motion) g.restore();
  }

  function paint(env, opts) {
    const o = opts || {}, box = o.box;
    if (!box || !(box.w > 0 && box.h > 0)) return null;
    const pin = env.cut && env.cut.els && env.cut.els[env.owner];
    const data = { kind: 'timer', box: { x: box.x, y: box.y, w: box.w, h: box.h }, size: o.size,
      ink: pin && pin.fill || o.ink || 'accent', align: o.align || 'start', alpha: o.alpha === undefined ? 1 : o.alpha,
      weight: o.weight === undefined ? .1 : o.weight, motion: o.motion === undefined ? 1 : o.motion };
    return env.sb.paint({ parent: o.parent, layer: 'text', owner: env.owner, box: data.box, bleed: 0, animated: true, draw, data });
  }

  return { format, width, visible, digitState, draw, paint, RESERVE };
});
