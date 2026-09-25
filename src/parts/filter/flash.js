/* 文字PVメーカー v2 — original work. Impact blinks: the white flash pop and the inverted blink. */
MV.def('parts/filter/flash', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth } = K.math;
  const L = (ja, en) => ({ ja, en });
  const IMPULSE_GAIN = 1.6;          // plan flash impulses carry amp = amount.flash (≈ 0.6): this lifts their peak to ≈ 1
  const TONES = Object.freeze({ white: '#FFFFFF', warm: '#FFF1DC', cool: '#E8F2FF' });
  const PERIOD_PROBE = 1e-3;         // s: fx.beat just before a beat reads the previous beat, which gives the period

  // Flash safety (DESIGN §4.21: more than 3 flashes in any 1 s window is a pre-flight warning; its fix pins
  // amount.flash to 0.3, and flashes at or below that strength are not counted). Both parts keep their own flashes
  // within that rule on every cut, whatever their params:
  //   flashPop     one flash per event; 'beat' events at least 1/3 s apart;
  //   invertBlink  at most 3 blinks per event; 'beat' events at least 1 s apart (a 1 s window then meets the blinks of
  //                at most two events, and only as many of the later one's as the earlier one's it has left behind).
  // Their amount follows amount.flash from 0, so the pre-flight fix reaches them: flashPop's flash is mild at 0.3 and
  // invertBlink does not blink at all at or below it.
  const SAFE_AMOUNT = 0.3;
  const POP_GAP = 1 / 3;
  const BLINK_GAP = 1;
  const MAX_BLINKS = 3;
  const FLASH_AMOUNT = { auto: { range: [0, 1], follow: 'amount.flash', jitter: 0 } };

  // Both parts fire on an event chosen by the shared `when` param (the post stack also weights `amount` by it):
  //   'arrive' → the sung start; 'depart' → late enough that the flash is over by the sung end (where the next cut
  //   takes the screen effects over); 'beat' → beats of the grid (none without one); 'always' / 'impact' → the start
  //   of an impact cut (the planner marks `!` phrases).
  // By default they fire on impact cuts, and on other cuts when their line starts.
  const WHEN_AUTO = { fn: (f) => (f.impact ? 'impact' : 'arrive'),
    why: L('見せ場（!）の行では衝撃の瞬間、それ以外は歌い出し', 'The impact moment on a `!` line, otherwise the sung start') };

  // The preview's reduce-flash scale when the FxContext carries one (the export never dims), else 1.
  function flashScale(fx) { return typeof fx.flashScale === 'number' ? clamp(fx.flashScale) : 1; }

  // The beat period (s) at t, 0 without a grid: fx.beat just before the current beat lands in the previous one.
  function periodAt(fx, t) {
    const b = fx.beat(t);
    if (!b) return 0;
    const since = b.since;                          // fx.beat returns a pooled object: read it before the next call
    return fx.beat(t - since - PERIOD_PROBE).since + PERIOD_PROBE;
  }

  // Seconds since the last beat that fires (every stride-th beat of the grid, so fired beats are at least `gap`
  // apart), or −1 without a beat grid.
  function beatAge(fx, t, gap) {
    const b = fx.beat(t);
    if (!b) return -1;
    const index = b.index, since = b.since;
    const period = periodAt(fx, t);
    const stride = Math.max(1, Math.ceil(gap / period - 1e-9));
    return since + (((index % stride) + stride) % stride) * period;
  }

  // Seconds since the part's event at time t (negative before it or when there is none). `span` = how long the
  // part's flash lasts, so that a 'depart' event is over by the sung end; `gap` = the least time between beat events.
  function eventAge(fx, p, t, span, gap) {
    const c = fx.cut;
    if (!c) return -1;
    if (p.when === 'arrive') return c.tl;
    if (p.when === 'depart') return c.tl - Math.max(0, c.dur - span);
    if (p.when === 'beat') return beatAge(fx, t, gap);
    return c.impact ? c.tl : -1;
  }

  function decayed(age, decay) { return age < 0 ? 0 : Math.exp(-age / decay); }

  // --- flashPop --------------------------------------------------------------------------------------------------------

  // 0..1 for the part's own events. A beat flash is gone by the next beat: the post stack's 'beat' weighting lifts
  // `amount` on every beat, and a flash still lit then would flash again on a beat that does not fire.
  function ownLevel(fx, p, t) {
    const age = eventAge(fx, p, t, 2 * p.decay, POP_GAP);
    if (p.when !== 'beat' || age < 0) return decayed(age, p.decay);
    return decayed(age, p.decay) * (1 - smooth((age / periodAt(fx, t) - 0.5) / 0.5));
  }

  // 0..1. On 'always' / 'impact' the plan's flash impulses lead (the preview may dim them for sensitive viewers); a cut
  // marked impact that has no impulse of its own (amount.flash was 0 when it was planned) flashes on its own start.
  function flashLevel(fx, p, t) {
    if (p.when === 'arrive' || p.when === 'depart' || p.when === 'beat') return ownLevel(fx, p, t) * flashScale(fx);
    const hit = fx.impulse('flash', t);
    if (hit > 0) return Math.min(1, hit * IMPULSE_GAIN);
    const c = fx.cut;
    if (!c || !c.impact || fx.impulse('flash', t - c.tl + 1e-6) > 0) return 0;
    return decayed(c.tl, p.decay) * flashScale(fx);
  }

  // The frame first blows out (an additive copy of itself: highlights clip before shadows), then washes toward white.
  function pop(fx, src, p, t) {
    const a = clamp(p.amount * 1.3 * flashLevel(fx, p, t));
    if (a < 1 / 64) return src;
    const out = fx.take(), g = out.ctx;
    g.drawImage(src.canvas, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = clamp(a * 0.7);
    g.drawImage(src.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = clamp(a * a * 0.92);
    g.fillStyle = TONES[p.tone] || TONES.white;
    g.fillRect(0, 0, fx.w, fx.h);
    g.globalAlpha = 1;
    return out;
  }

  const flashPop = K.filter({
    key: 'flashPop',
    label: L('閃光', 'Flash pop'),
    blurb: L('見せ場で画面が一瞬白く光る', 'A white flash on impacts'),
    tags: ['bright', 'bold'], family: 'flash', gate: 'flash',
    stage: 'light', cost: 2, passes: 3, alphaSafe: false,
    traits: { impact: true },
    fits: (f) => (f.impact ? 1 : 0.25),
    shared: { amount: FLASH_AMOUNT, when: { auto: WHEN_AUTO } },
    params: {
      decay: { type: 'num', min: 0.05, max: 0.8, step: 0.01, unit: 's', label: L('消えるまで', 'Fade'),
        auto: { range: [0.14, 0.26], follow: '-energy' } },
      tone: { type: 'enum', of: ['white', 'warm', 'cool'], label: L('光の色', 'Tone'),
        auto: { pick: ['white', 'warm', 'cool'], weights: [3, 2, 1] } },
    },
    apply: pop,
  });

  // --- invertBlink -----------------------------------------------------------------------------------------------------

  // How many blinks an event gets: `blinks` (at most 3), and on a beat only those that are over by the next beat —
  // the post stack's 'beat' weighting lifts `amount` on every beat, which would light a blink that is on again.
  function blinkCount(fx, p, t) {
    const n = Math.max(1, Math.min(MAX_BLINKS, p.blinks | 0));
    if (p.when !== 'beat') return n;
    const period = periodAt(fx, t);
    return period > 0 ? Math.max(1, Math.min(n, Math.floor((period * p.rate + 1) / 2 + 1e-9))) : n;
  }

  // The frame inverts on alternate ticks after the event: `blinks` times on, each one tick long (fixed rate, so every
  // frame rate shows the same blinks). A blink is a full inversion while amount is above the safe amount, and none at
  // or below it: a partial inversion is not a weaker blink but a flat grey frame (at half strength every pixel lands
  // on mid grey), which the old ramp showed whenever the post stack's `when` weighting lowered amount through it. Now
  // the later blinks of an event drop out, or end early, as the weighting falls.
  function blink(fx, src, p, t) {
    const blinks = blinkCount(fx, p, t);
    const age = eventAge(fx, p, t, (2 * blinks) / p.rate, BLINK_GAP);
    if (age < 0) return src;
    const k = fx.tick(p.rate, age);
    if (k >= 2 * blinks || k % 2 === 1) return src;
    if (!(p.amount * flashScale(fx) > SAFE_AMOUNT)) return src;
    const out = fx.own(src), g = out.ctx;
    g.globalCompositeOperation = 'difference';
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, fx.w, fx.h);
    g.globalCompositeOperation = 'source-over';
    return out;
  }

  const invertBlink = K.filter({
    key: 'invertBlink',
    label: L('反転', 'Invert blink'),
    blurb: L('見せ場で画面が数コマだけ反転する', 'The frame inverts for a few frames on impacts'),
    tags: ['hard', 'digital'], family: 'flash', gate: 'flash',
    stage: 'tone', cost: 1, passes: 2, alphaSafe: false,
    traits: { impact: true },
    fits: (f) => (f.impact ? 1 : 0.25),
    shared: { amount: FLASH_AMOUNT, when: { auto: WHEN_AUTO } },
    params: {
      blinks: { type: 'int', min: 1, max: MAX_BLINKS, label: L('回数', 'Blinks'), auto: { pick: [1, 2, 2, 3] } },
      rate: { type: 'num', min: 6, max: 24, step: 0.5, unit: 'Hz', label: L('速さ', 'Rate'), auto: { range: [10, 14] } },
    },
    apply: blink,
  });

  return [flashPop, invertBlink];
});
